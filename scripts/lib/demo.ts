// Demo snapshot (PLAN 8.1, ADR-032): which tables it holds, in which order they are restored, what
// is left out (rehearsal backlog), and how dates are moved so the demo always looks fresh.
// Pure functions: the scripts demo-snapshot.ts and demo-reset.ts do the I/O.

export type Row = Record<string, unknown>;

/** Restore order (foreign keys first). Customers are upserted, never deleted. */
export const SNAPSHOT_TABLES = [
  "pipeline_runs",
  "customers",
  "feedbacks",
  "feedback_analyses",
  "feedback_items",
  "insights",
  "insight_items",
  "insight_relations",
  "complexity_estimates",
  "scores",
  "overrides",
  "epics",
  "backlog_items",
  "decisions",
  "alerts",
  "notion_links",
] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/** Delete order of a reset: what the pipeline, the PO and the agent produced, chat included (threads
 * and the unknown ids they cited). Customers, reference tickets and evals are kept. */
export const RESET_TABLES = [
  ["digests", "id"],
  ["alerts", "id"],
  ["notion_links", "entity_id"],
  ["decisions", "id"],
  ["overrides", "id"],
  ["scores", "id"],
  ["prototypes", "id"],
  ["backlog_items", "id"],
  ["epics", "id"],
  ["complexity_estimates", "id"],
  ["insight_relations", "id"],
  ["insight_items", "insight_id"],
  ["insights", "id"],
  ["feedback_items", "feedback_id"],
  ["feedback_analyses", "feedback_id"],
  ["feedbacks", "id"],
  ["pipeline_runs", "id"],
  ["id_incidents", "id"],
  ["threads", "id"],
  ["notion_sync_state", "data_source"],
] as const;

/** Column used to order an export, so that two snapshots of the same base are identical. */
export const ORDER_COLUMN: Record<SnapshotTable, string> = {
  pipeline_runs: "started_at",
  customers: "id",
  feedbacks: "id",
  feedback_analyses: "created_at",
  feedback_items: "id",
  insights: "id",
  insight_items: "item_id",
  insight_relations: "id",
  complexity_estimates: "id",
  scores: "created_at",
  overrides: "created_at",
  epics: "id",
  backlog_items: "id",
  decisions: "id",
  alerts: "created_at",
  notion_links: "entity_id",
};

/** Generated columns: read in the export, never written back. */
export const OMIT_ON_INSERT: Partial<Record<SnapshotTable, string[]>> = {
  feedback_items: ["id"],
};

/** Self or circular references: inserted as null, then set row by row once both sides exist. */
export const DEFERRED: Partial<Record<SnapshotTable, { key: string; column: string }>> = {
  insights: { key: "id", column: "merged_into" },
  complexity_estimates: { key: "id", column: "item_id" },
};

/** Scenario dates, relative to DEMO_NOW in the data (SPEC §5.4): moved by whole days so that the
 * offsets of the scenario (« reçu il y a 2 jours », renouvellement à J+38) stay exact. A feedback's
 * insertion moves with its reception: the next snapshot finds the scenario date from it. */
export const SCENARIO_COLUMNS = new Set([
  "feedbacks.received_at",
  "feedbacks.created_at",
  "customers.renewal_date",
]);

export type SnapshotMeta = {
  /** When the snapshot was taken: activity dates (runs, reviews, drafts) are moved relative to it. */
  taken_at: string;
  /** The scenario's « now » in the data (seed time): scenario dates are moved relative to it. */
  scenario_now: string;
  /** Insights whose backlog is kept (the fallback backlog); every other backlog item is left out. */
  kept_backlog: string[];
  counts: Record<string, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Seed time of the base: the earliest feedback insertion. */
export function scenarioAnchor(feedbacks: Row[]): string | null {
  let earliest: string | null = null;
  for (const f of feedbacks) {
    const created = f.created_at;
    if (typeof created !== "string") continue;
    if (earliest === null || new Date(created) < new Date(earliest)) earliest = created;
  }
  return earliest;
}

/** `nowMs`: no date is moved past it (a feedback pasted in real time is not relative to the
 * scenario). */
export type Shifts = { scenarioMs: number; activityMs: number; nowMs: number };

/** Scenario dates move by whole days, rounded down so that a date of the scenario never lands in
 * the future; activity dates move by the exact time elapsed since the snapshot, so the preparation
 * stays in the past, in its order, just before the demo. */
export function computeShifts(
  meta: Pick<SnapshotMeta, "taken_at" | "scenario_now">,
  now: Date,
): Shifts {
  const scenarioMs =
    Math.floor((now.getTime() - new Date(meta.scenario_now).getTime()) / DAY_MS) * DAY_MS;
  return {
    scenarioMs,
    activityMs: now.getTime() - new Date(meta.taken_at).getTime(),
    nowMs: now.getTime(),
  };
}

function shiftValue(value: unknown, ms: number, nowMs: number): unknown {
  if (typeof value !== "string") return value;
  if (DATE_ONLY.test(value)) {
    const days = Math.round(ms / DAY_MS);
    return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS)
      .toISOString()
      .slice(0, 10);
  }
  if (TIMESTAMP.test(value)) {
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return value;
    return new Date(Math.min(time + ms, nowMs)).toISOString();
  }
  return value;
}

/** Moves the top-level dates of a row (jsonb contents are left as they are). */
export function shiftRow(table: string, row: Row, shifts: Shifts): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const ms = SCENARIO_COLUMNS.has(`${table}.${key}`) ? shifts.scenarioMs : shifts.activityMs;
    out[key] = shiftValue(value, ms, shifts.nowMs);
  }
  return out;
}

/** Row ready to insert: generated columns removed, deferred references set to null. */
export function insertableRow(table: SnapshotTable, row: Row): Row {
  const out: Row = { ...row };
  for (const column of OMIT_ON_INSERT[table] ?? []) delete out[column];
  const deferred = DEFERRED[table];
  if (deferred) out[deferred.column] = null;
  return out;
}

const BACKLOG_ENTITY_TYPES = new Set(["backlog_item", "epic"]);

/** Keeps the backlog of the listed insights only (the fallback backlog): every other backlog item
 * and epic is a rehearsal, left out with its decisions and Notion links. Prototypes are not in the
 * snapshot, so no item points to one. */
export function selectSnapshot(
  tables: Record<SnapshotTable, Row[]>,
  keptBacklog: ReadonlySet<string>,
): { tables: Record<SnapshotTable, Row[]>; dropped: string[] } {
  const keep = (r: Row) => typeof r.insight_id === "string" && keptBacklog.has(r.insight_id);
  const items = tables.backlog_items.filter(keep);
  const epics = tables.epics.filter(keep);
  const kept = new Set([...items, ...epics].map((r) => String(r.id)));
  const dropped = [...tables.backlog_items, ...tables.epics]
    .map((r) => String(r.id))
    .filter((id) => !kept.has(id))
    .sort();
  const droppedSet = new Set(dropped);
  return {
    dropped,
    tables: {
      ...tables,
      epics,
      backlog_items: items.map((r) => ({ ...r, prototype_id: null })),
      complexity_estimates: tables.complexity_estimates.map((r) =>
        typeof r.item_id === "string" && droppedSet.has(r.item_id) ? { ...r, item_id: null } : r,
      ),
      decisions: tables.decisions.filter(
        (d) =>
          !(BACKLOG_ENTITY_TYPES.has(String(d.entity_type)) && droppedSet.has(String(d.entity_id))),
      ),
      notion_links: tables.notion_links.filter((l) => !droppedSet.has(String(l.entity_id))),
    },
  };
}

/** Notion pages created since the snapshot (rehearsals): to be moved to the trash by the reset. */
export function pagesToTrash(current: Row[], snapshot: Row[]): string[] {
  const kept = new Set(snapshot.map((l) => String(l.notion_page_id)));
  return current.map((l) => String(l.notion_page_id)).filter((id) => !kept.has(id));
}
