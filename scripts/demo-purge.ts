// Demo base preparation (ADR-032): removes the feedbacks added while testing (ids from
// --from on) and everything they alone produced, so that the snapshot holds the scenario only.
// - insights whose live items all came from those feedbacks: deleted with their backlog, alerts
//   and decisions (scores, overrides, epics, estimates follow by cascade);
// - alerts citing one of those feedbacks: deleted with their decisions;
// - the runs that ingested them: deleted;
// - the other insights they touched: aggregates recomputed in code, then re-scored with their
//   stored judgment (a model call only when a judgment cites a removed feedback).
// Usage: pnpm tsx --conditions=react-server scripts/demo-purge.ts --from R-215 [--yes]
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb, type Db } from "@/lib/db/script-client";
import type { Json } from "@/lib/db/types";
import { getDemoNow } from "@/lib/demo-now";
import { computeAggregates } from "@/lib/insights/aggregates";
import { RunCost } from "@/lib/llm/cost";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { currentReachMode } from "@/pipeline/incremental";
import { fetchAll, loadClusteringState } from "@/pipeline/insights";
import { parseOkrIds, runScoring } from "@/pipeline/nodes/score";

const readableNumber = (id: string) => Number(id.split("-")[1]);

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} (${error.message})`);
}

async function remove(
  db: Db,
  table: "insights" | "backlog_items" | "alerts" | "decisions" | "pipeline_runs" | "feedbacks",
  ids: string[],
) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db
      .from(table)
      .delete()
      .in("id", ids.slice(i, i + 100));
    check(error, `Suppression dans ${table}`);
  }
}

async function main() {
  const fromIndex = process.argv.indexOf("--from");
  const from = fromIndex === -1 ? undefined : process.argv[fromIndex + 1];
  if (!from || !/^R-\d+$/.test(from)) throw new Error("Usage : --from R-215 [--yes]");
  const execute = process.argv.includes("--yes");
  const db = getScriptDb();

  const feedbacks = await fetchAll(
    (a, b) => db.from("feedbacks").select("id, ingested_run_id").order("id").range(a, b),
    "lecture des retours",
  );
  const purged = feedbacks.filter((f) => readableNumber(f.id) >= readableNumber(from));
  const purgedIds = new Set(purged.map((f) => f.id));
  if (purgedIds.size === 0) return console.log(`Aucun retour à partir de ${from}.`);

  const links = await fetchAll(
    (a, b) =>
      db.from("insight_items").select("insight_id, feedback_id").order("item_id").range(a, b),
    "lecture des items d'insights",
  );
  const byInsight = new Map<string, string[]>();
  for (const l of links)
    byInsight.set(l.insight_id, [...(byInsight.get(l.insight_id) ?? []), l.feedback_id]);
  const deletedInsights: string[] = [];
  const touched: string[] = [];
  for (const [insight, ids] of byInsight) {
    if (ids.every((id) => purgedIds.has(id))) deletedInsights.push(insight);
    else if (ids.some((id) => purgedIds.has(id))) touched.push(insight);
  }

  const { data: items, error: itemsError } = await db
    .from("backlog_items")
    .select("id")
    .in("insight_id", deletedInsights.length ? deletedInsights : ["-"]);
  check(itemsError, "Lecture du backlog");
  const { data: alerts, error: alertsError } = await db
    .from("alerts")
    .select("id, insight_id, feedback_ids");
  check(alertsError, "Lecture des alertes");
  const deletedAlerts = (alerts ?? [])
    .filter(
      (a) =>
        a.feedback_ids.some((id) => purgedIds.has(id)) ||
        deletedInsights.includes(a.insight_id ?? ""),
    )
    .map((a) => a.id);
  const entities = new Set([
    ...deletedInsights,
    ...(items ?? []).map((i) => i.id),
    ...deletedAlerts,
  ]);
  const decisions = await fetchAll(
    (a, b) => db.from("decisions").select("id, entity_id").order("id").range(a, b),
    "lecture des décisions",
  );
  const deletedDecisions = decisions.filter((d) => entities.has(d.entity_id)).map((d) => d.id);
  const runs = [
    ...new Set(purged.map((f) => f.ingested_run_id).filter((r): r is string => r !== null)),
  ];

  console.log(`Retours : ${[...purgedIds].join(", ")}`);
  console.log(`Insights supprimés : ${deletedInsights.sort().join(", ") || "aucun"}`);
  console.log(`Insights recalculés : ${touched.sort().join(", ") || "aucun"}`);
  console.log(`Backlog supprimé : ${(items ?? []).map((i) => i.id).join(", ") || "aucun"}`);
  console.log(
    `Alertes supprimées : ${deletedAlerts.length} · décisions : ${deletedDecisions.join(", ") || "aucune"} · runs : ${runs.length}`,
  );
  if (!execute) return console.log("\nSimulation. Relancer avec --yes pour appliquer.");

  await remove(db, "decisions", deletedDecisions);
  await remove(db, "alerts", deletedAlerts);
  await remove(
    db,
    "backlog_items",
    (items ?? []).map((i) => i.id),
  );
  await remove(db, "insights", deletedInsights);
  await remove(db, "feedbacks", [...purgedIds]);
  await remove(db, "pipeline_runs", runs);

  // Aggregates of the touched insights, as the incremental mode computes them.
  const now = getDemoNow();
  const pack = await loadContextPack();
  const { weighting } = pack;
  const state = await loadClusteringState(db, { weighting, now, commitments: pack.commitments });
  const { data: rows, error: rowsError } = await db
    .from("insights")
    .select("id, status, origin, product_area")
    .in("id", touched.length ? touched : ["-"]);
  check(rowsError, "Lecture des insights touchés");
  const { data: kept, error: keptError } = await db
    .from("insight_items")
    .select("insight_id, feedback_id")
    .in("insight_id", touched.length ? touched : ["-"]);
  check(keptError, "Lecture des items restants");
  for (const insight of rows ?? []) {
    const ids = [
      ...new Set((kept ?? []).filter((l) => l.insight_id === insight.id).map((l) => l.feedback_id)),
    ];
    const a = computeAggregates(
      {
        status: insight.status,
        origin: insight.origin,
        productArea: insight.product_area,
        feedbacks: ids.map((id) => state.feedbacks.get(id)).filter((f) => f !== undefined),
      },
      { weighting, now, commitments: state.commitments },
    );
    const { error } = await db
      .from("insights")
      .update({
        ranked: a.ranked,
        accounts_count: a.accounts_count,
        mrr_exposed: a.mrr_exposed,
        renewals_90d: a.renewals_90d,
        segments_breakdown: a.segments_breakdown as unknown as Json,
        channels: a.channels as Json,
        trend: a.trend as unknown as Json,
      })
      .eq("id", insight.id);
    check(error, `Mise à jour de ${insight.id}`);
  }

  // Re-score: stored judgments reused, a model call only for an invalid one.
  initTracing();
  const [riceScoring, moscow] = await Promise.all([loadSkill("rice-scoring"), loadSkill("moscow")]);
  const runCost = new RunCost();
  const summary = await runScoring(db, {
    mode: await currentReachMode(db, weighting.reach.default_mode),
    weighting,
    now,
    commitments: pack.commitments,
    context: {
      weighting,
      skills: { riceScoring: riceScoring.content, moscow: moscow.content },
      documents: { strategy: pack.documents.strategy, commitments: pack.documents.commitments },
      okrIds: parseOkrIds(pack.documents.strategy),
    },
    rejudge: new Set(),
    writeOnlyChanged: true,
    touched: new Set(touched),
    deps: { runCost },
  });
  await shutdownTracing();
  for (const f of summary.failures) console.log(`ÉCHEC ${f.step} ${f.insight} : ${f.error}`);
  console.log(
    `Re-score : ${summary.written.length} version(s) écrite(s), ${summary.judged} jugement(s) refait(s), ` +
      `${runCost.eur.toFixed(4)} €.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
