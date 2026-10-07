// Demo snapshot (PLAN 8.1, ADR-032): exports the business tables of a prepared base (full run,
// insights reviewed by the PO, fallback backlog) to data/demo-snapshot/, one JSON file per table.
// Only the backlog of the insights given in --keep-backlog is kept: the rest is rehearsal, left out
// with its decisions and Notion links. Digests and chat threads are never in the snapshot: the
// digest is generated live after a reset.
// Usage: pnpm demo:snapshot --keep-backlog I-31 [--scenario-now <ISO>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getScriptDb, type Db } from "@/lib/db/script-client";
import {
  ORDER_COLUMN,
  scenarioAnchor,
  selectSnapshot,
  SNAPSHOT_TABLES,
  type Row,
  type SnapshotMeta,
  type SnapshotTable,
} from "./lib/demo";

export const SNAPSHOT_DIR = join("data", "demo-snapshot");
const PAGE = 1000;

export async function readTable(db: Db, table: SnapshotTable): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(ORDER_COLUMN[table])
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Lecture de ${table} (${error.message})`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const keepArg = argValue("--keep-backlog");
  const db = getScriptDb();
  const tables = {} as Record<SnapshotTable, Row[]>;
  for (const table of SNAPSHOT_TABLES) tables[table] = await readTable(db, table);

  const withBacklog = [...new Set(tables.backlog_items.map((r) => String(r.insight_id)))].sort();
  if (keepArg === undefined) {
    console.error(
      "Indique le backlog de secours à garder : --keep-backlog I-xx[,I-yy] (ou --keep-backlog none).\n" +
        `Insights qui ont un backlog : ${withBacklog.join(", ") || "aucun"}.`,
    );
    process.exit(1);
  }
  const kept =
    keepArg === "none"
      ? []
      : keepArg
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  const unknown = kept.filter((id) => !withBacklog.includes(id));
  if (unknown.length > 0) throw new Error(`Aucun backlog pour ${unknown.join(", ")}.`);

  const running = tables.pipeline_runs.filter((r) => r.status === "en_cours");
  if (running.length > 0) throw new Error("Un run du pipeline est en cours : attends sa fin.");

  const scenarioNow = argValue("--scenario-now") ?? scenarioAnchor(tables.feedbacks);
  if (!scenarioNow || Number.isNaN(new Date(scenarioNow).getTime())) {
    throw new Error(
      "Date du scénario introuvable : base sans retours, ou --scenario-now invalide.",
    );
  }

  const { tables: selected, dropped } = selectSnapshot(tables, new Set(kept));
  const meta: SnapshotMeta = {
    taken_at: new Date().toISOString(),
    scenario_now: new Date(scenarioNow).toISOString(),
    kept_backlog: kept,
    counts: Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, selected[t].length])),
  };

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const table of SNAPSHOT_TABLES) {
    writeFileSync(
      join(SNAPSHOT_DIR, `${table}.json`),
      `${JSON.stringify(selected[table], null, 1)}\n`,
    );
  }
  writeFileSync(join(SNAPSHOT_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

  for (const table of SNAPSHOT_TABLES) console.log(`${table} : ${selected[table].length}`);
  console.log(
    `Backlog gardé : ${kept.join(", ") || "aucun"} · écartés (répétitions) : ${dropped.join(", ") || "aucun"}`,
  );
  console.log(`Date du scénario : ${meta.scenario_now} · snapshot : ${meta.taken_at}`);
  console.log(`Snapshot écrit dans ${SNAPSHOT_DIR}/. Restaurer : pnpm demo:reset`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
