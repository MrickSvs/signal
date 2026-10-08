import "server-only";
import type { Scenario } from "@/lib/backlog/draft";
import type { Db } from "@/lib/db/client";
import type { Database, Json, Tables } from "@/lib/db/types";
import type { BacklogPlan } from "@/services/backlog";

// Reads of the Backlog screen (SPEC §12.6): per insight, its epic(s) then their items, each with
// its format, its estimate (components, analogue tickets with estimated and actual points), the
// insight's range, its evidence and the provisional quality badge.

type Kind = Database["public"]["Enums"]["backlog_kind"];

export const BACKLOG_KINDS: readonly Kind[] = ["story", "bug", "tache"];

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} (${error.message})`);
};

const strings = (value: Json | null): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export type JudgeBadge = {
  note: number;
  verdict: "pret" | "a_revoir";
  points_forts: string;
  a_ameliorer: string[];
  /** Note per criterion of the grid (calibrated judge, lib/judge); {} for an older badge. */
  notes: Record<string, number>;
  provisional: boolean;
};

export type ItemEstimate = {
  components: string[];
  rationale: string | null;
  analogues: {
    ticket_id: string;
    estimated_points: number | null;
    actual_points: number | null;
    close: boolean;
  }[];
};

export type BacklogViewItem = Pick<
  Tables<"backlog_items">,
  | "id"
  | "kind"
  | "title"
  | "epic_id"
  | "status"
  | "points"
  | "value"
  | "persona"
  | "want"
  | "success_kpi"
  | "expected_behavior"
  | "actual_behavior"
  | "severity"
  | "affected_accounts"
  | "objective"
  | "evidence"
  | "dependencies"
  | "notion_page_id"
  | "push_error"
> & {
  business_rules: string[];
  repro_steps: string[];
  definition_of_done: string[];
  risks: string[];
  acceptance_criteria: Scenario[];
  judge: JudgeBadge | null;
  estimate: ItemEstimate | null;
  enterprise_accounts: number;
};

export type BacklogGroup = {
  insight: { id: string; title: string };
  plan: BacklogPlan | null;
  epics: (Pick<Tables<"epics">, "id" | "title" | "goal" | "okr_refs"> & { kpis: string[] })[];
  items: BacklogViewItem[];
};

export type BacklogScreen = {
  groups: BacklogGroup[];
  counts: Record<Kind, number>;
};

function asJudge(value: Json | null): JudgeBadge | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return typeof v.note === "number"
    ? {
        note: v.note,
        verdict: v.verdict === "pret" ? "pret" : "a_revoir",
        points_forts: typeof v.points_forts === "string" ? v.points_forts : "",
        a_ameliorer: Array.isArray(v.a_ameliorer) ? v.a_ameliorer.map(String) : [],
        notes:
          v.notes && typeof v.notes === "object" && !Array.isArray(v.notes)
            ? Object.fromEntries(
                Object.entries(v.notes).filter(([, n]) => typeof n === "number") as [
                  string,
                  number,
                ][],
              )
            : {},
        provisional: v.provisional !== false,
      }
    : null;
}

export async function getBacklogScreen(
  db: Db,
  filters: { kind?: Kind | null; insight?: string | null } = {},
): Promise<BacklogScreen> {
  const [items, epics, plans] = await Promise.all([
    db.from("backlog_items").select("*").neq("status", "rejete").order("id"),
    db.from("epics").select("id, insight_id, title, goal, okr_refs, kpis").order("id"),
    db.from("insights").select("id, title, backlog_plan").not("backlog_plan", "is", null),
  ]);
  fail("Lecture du backlog", items.error);
  fail("Lecture des epics", epics.error);
  fail("Lecture des plans de backlog", plans.error);
  const rows = items.data ?? [];

  const estimateIds = rows.flatMap((r) =>
    r.complexity_estimate_id ? [r.complexity_estimate_id] : [],
  );
  const accountIds = [...new Set(rows.flatMap((r) => r.affected_accounts))];
  const insightIds = [
    ...new Set([
      ...rows.flatMap((r) => (r.insight_id ? [r.insight_id] : [])),
      ...(plans.data ?? []).map((p) => p.id),
    ]),
  ];
  const [estimates, accounts, insights] = await Promise.all([
    estimateIds.length
      ? db
          .from("complexity_estimates")
          .select("id, components, rationale, analogies")
          .in("id", estimateIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? db.from("customers").select("id, plan").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    insightIds.length
      ? db.from("insights").select("id, title, backlog_plan").in("id", insightIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  fail("Lecture des estimations", estimates.error);
  fail("Lecture des comptes", accounts.error);
  fail("Lecture des insights", insights.error);

  const analogies = (estimates.data ?? []).flatMap((e) =>
    Array.isArray(e.analogies) ? (e.analogies as { ticket_id?: string }[]) : [],
  );
  const ticketIds = [...new Set(analogies.flatMap((a) => (a.ticket_id ? [a.ticket_id] : [])))];
  const tickets = ticketIds.length
    ? await db
        .from("reference_tickets")
        .select("id, estimated_points, actual_points")
        .in("id", ticketIds)
    : { data: [], error: null };
  fail("Lecture des tickets de référence", tickets.error);
  const ticketById = new Map((tickets.data ?? []).map((t) => [t.id, t]));
  const estimateById = new Map(
    (estimates.data ?? []).map((e) => [
      e.id,
      {
        components: e.components,
        rationale: e.rationale,
        analogues: (Array.isArray(e.analogies)
          ? (e.analogies as { ticket_id: string; close?: boolean }[])
          : []
        ).map((a) => ({
          ticket_id: a.ticket_id,
          estimated_points: ticketById.get(a.ticket_id)?.estimated_points ?? null,
          actual_points: ticketById.get(a.ticket_id)?.actual_points ?? null,
          close: a.close !== false,
        })),
      } satisfies ItemEstimate,
    ]),
  );
  const enterprise = new Set(
    (accounts.data ?? []).filter((c) => c.plan === "enterprise").map((c) => c.id),
  );

  const counts: Record<Kind, number> = { story: 0, bug: 0, tache: 0 };
  for (const r of rows) {
    if (!filters.insight || r.insight_id === filters.insight) counts[r.kind] += 1;
  }

  const view = (r: (typeof rows)[number]): BacklogViewItem => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    epic_id: r.epic_id,
    status: r.status,
    points: r.points,
    value: r.value,
    persona: r.persona,
    want: r.want,
    success_kpi: r.success_kpi,
    expected_behavior: r.expected_behavior,
    actual_behavior: r.actual_behavior,
    severity: r.severity,
    affected_accounts: r.affected_accounts,
    objective: r.objective,
    evidence: r.evidence,
    dependencies: r.dependencies,
    notion_page_id: r.notion_page_id,
    push_error: r.push_error,
    business_rules: strings(r.business_rules),
    repro_steps: strings(r.repro_steps),
    definition_of_done: strings(r.definition_of_done),
    risks: strings(r.risks),
    acceptance_criteria: (Array.isArray(r.acceptance_criteria)
      ? r.acceptance_criteria
      : []) as unknown as Scenario[],
    judge: asJudge(r.judge),
    estimate: r.complexity_estimate_id
      ? (estimateById.get(r.complexity_estimate_id) ?? null)
      : null,
    enterprise_accounts: r.affected_accounts.filter((id) => enterprise.has(id)).length,
  });

  const groups: BacklogGroup[] = (insights.data ?? [])
    .filter((i) => !filters.insight || i.id === filters.insight)
    .map((i) => ({
      insight: { id: i.id, title: i.title },
      plan: (i.backlog_plan as unknown as BacklogPlan | null) ?? null,
      epics: (epics.data ?? [])
        .filter((e) => e.insight_id === i.id)
        .map((e) => ({
          id: e.id,
          title: e.title,
          goal: e.goal,
          okr_refs: e.okr_refs,
          kpis: strings(e.kpis),
        })),
      items: rows
        .filter((r) => r.insight_id === i.id && (!filters.kind || r.kind === filters.kind))
        .map(view),
    }))
    .filter((g) => g.items.length > 0 || (!filters.kind && g.plan?.discoverability))
    // Most recently drafted first.
    .sort((a, b) => (b.plan?.drafted_at ?? "").localeCompare(a.plan?.drafted_at ?? ""));
  return { groups, counts };
}
