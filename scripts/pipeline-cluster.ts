// Clustering CLI: embeds the items that have no vector yet, groups them by problem,
// matches the existing insights, labels the new or changed ones and detects tensions.
// Usage: pnpm pipeline:cluster [--threshold X] [--run-id X]
// Cost: only new or changed insights are labelled (Sonnet). First run ~0.5 €; a run without new
// data makes no model call.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { RunCost } from "@/lib/llm/cost";
import {
  currentTraceId,
  initTracing,
  shutdownTracing,
  traceUrl,
  withTrace,
} from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { runEmbed } from "@/pipeline/nodes/embed";
import { runClustering, type ClusteringSummary, type InsightOutcome } from "@/pipeline/insights";

export type ClusterArgs = { threshold?: number; runId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClusterArgs(argv: string[]): ClusterArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} attend une valeur`);
    return v;
  };
  const raw = value("--threshold");
  const threshold = raw === undefined ? undefined : Number(raw);
  if (threshold !== undefined && !(threshold > 0 && threshold < 2)) {
    throw new Error("--threshold attend une distance cosinus entre 0 et 2 (exclus)");
  }
  const runId = value("--run-id");
  if (runId !== undefined && !UUID.test(runId)) throw new Error("--run-id attend un UUID");
  return { threshold, runId };
}

const euros = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function describe(insight: InsightOutcome): string {
  const a = insight.aggregates;
  const flags = [
    insight.isNew ? "nouveau" : insight.matchedBy ? `apparié (${insight.matchedBy})` : null,
    insight.relabelled ? "réétiqueté" : null,
    a?.trend.is_emerging ? `ÉMERGENT ×${a.trend.growth}` : null,
    a?.trend.is_new ? "récent" : null,
  ].filter(Boolean);
  const head = `${insight.id} [${insight.status}${flags.length ? " · " + flags.join(" · ") : ""}] ${insight.title}`;
  if (!a) return head;
  const channels = Object.keys(a.channels).length;
  return [
    head,
    `      ${a.feedbacks_count} retours · ${insight.itemIds.length} items · ${a.accounts_count} comptes · ` +
      `${channels} canal(aux) (${formatCounts(a.channels)}) · MRR ${euros(a.mrr_exposed)} · ` +
      `renouvellements < 90 j : ${a.renewals_90d}` +
      (a.ranking_reasons.length ? ` · classé : ${a.ranking_reasons.join(", ")}` : ""),
    `      ${insight.productArea ?? "—"} · plans ${formatCounts(a.segments_breakdown.plans)} · 7 j : ${a.trend.recent} · semaines ${a.trend.weekly.join(" ")}`,
  ].join("\n");
}

function report(summary: ClusteringSummary, seconds: number, costEur: number): void {
  const live = summary.insights.filter((i) => i.status === "propose" || i.status === "actif");
  const ranked = live
    .filter((i) => i.aggregates?.ranked)
    .sort(
      (a, b) =>
        b.aggregates!.feedbacks_count - a.aggregates!.feedbacks_count || a.id.localeCompare(b.id),
    );
  const weak = live
    .filter((i) => !i.aggregates?.ranked)
    .sort(
      (a, b) =>
        (b.aggregates?.feedbacks_count ?? 0) - (a.aggregates?.feedbacks_count ?? 0) ||
        a.id.localeCompare(b.id),
    );

  console.log(
    `\nSeuil ${summary.threshold} · ${summary.eligibleItems} items regroupables → ${summary.clusters} groupes, ` +
      `${summary.unclustered.length} isolés (${summary.unclustered.join(", ") || "—"})`,
  );
  console.log(
    `Durée : ${seconds.toFixed(1)} s · coût : ${costEur.toFixed(4)} € · appels d'étiquetage : ${summary.labelCalls}`,
  );

  console.log(`\n== Insights classés (${ranked.length})`);
  for (const i of ranked) console.log(describe(i));
  console.log(`\n== Signaux faibles (${weak.length})`);
  for (const i of weak) console.log(describe(i));

  const others = summary.insights.filter((i) => i.status === "rejete" || i.status === "archive");
  if (others.length) {
    console.log(`\n== Rejetés ou archivés (${others.length})`);
    for (const i of others) console.log(`${i.id} [${i.status}] ${i.title}`);
  }

  const title = new Map(summary.insights.map((i) => [i.id, i.title]));
  console.log(`\n== Tensions (${summary.tensions.length})`);
  for (const t of summary.tensions) {
    console.log(
      `${t.a} ↔ ${t.b}${t.kept ? " (conservée)" : ""} : ${title.get(t.a)} / ${title.get(t.b)}`,
    );
    console.log(`      ${t.rationale}`);
  }

  const moves = [
    ...summary.events.map((e) =>
      e.kind === "dissous" || e.kind === "reforme"
        ? `${e.kind} ${e.id}`
        : `${e.kind} ${e.from} → ${e.into}`,
    ),
    ...summary.merges.map((m) => `consolidation ${m.from} → ${m.into} (${m.reason})`),
  ];
  console.log(`\n== Mouvements (${moves.length})`);
  for (const m of moves) console.log(`  ${m}`);
  if (summary.unknownCommitmentAccounts.length) {
    console.log(`Engagements sans compte connu : ${summary.unknownCommitmentAccounts.join(", ")}`);
  }
  for (const f of summary.failures) {
    console.log(`ÉCHEC ${f.pass}${f.insight ? ` ${f.insight}` : ""} : ${f.error}`);
  }
}

async function main() {
  const args = parseClusterArgs(process.argv.slice(2));
  const db = getScriptDb();
  initTracing();
  const [skill, pack] = await Promise.all([loadSkill("triage-taxonomy"), loadContextPack()]);

  const runId = args.runId ?? randomUUID();
  const { error: runError } = await db
    .from("pipeline_runs")
    .upsert({ id: runId, kind: "full", status: "en_cours", ended_at: null }, { onConflict: "id" });
  if (runError) throw new Error(`Création du run en échec (${runError.message})`);
  console.log(`Run ${runId}`);

  const runCost = new RunCost();
  const started = Date.now();
  let traceId: string | undefined;
  try {
    const summary = await withTrace(
      "cluster-insights",
      { runId, step: "cluster", tags: ["pipeline", "cluster"] },
      { threshold: args.threshold ?? pack.weighting.clustering.distance_threshold },
      async () => {
        traceId = currentTraceId();
        const embedded = await runEmbed(db, { runCost });
        if (embedded.embedded.length) console.log(`Items vectorisés : ${embedded.embedded.length}`);
        return runClustering(db, {
          runId,
          weighting: pack.weighting,
          now: getDemoNow(),
          commitments: pack.commitments,
          label: { skill: skill.content },
          threshold: args.threshold,
          deps: { runCost },
        });
      },
      (s) => ({
        clusters: s.clusters,
        insights: s.insights.length,
        created: s.insights.filter((i) => i.isNew).length,
        events: s.events.length,
        tensions: s.tensions.length,
        failures: s.failures.length,
      }),
    );
    const seconds = (Date.now() - started) / 1000;
    report(summary, seconds, runCost.eur);
    await shutdownTracing();
    const url = await traceUrl(traceId);
    await db
      .from("pipeline_runs")
      .update({
        status: "termine",
        ended_at: new Date().toISOString(),
        stats: {
          step: "cluster",
          threshold: summary.threshold,
          clusters: summary.clusters,
          unclustered: summary.unclustered.length,
          created: summary.insights.filter((i) => i.isNew).map((i) => i.id),
          relabelled: summary.insights.filter((i) => i.relabelled).map((i) => i.id),
          ranked: summary.insights.filter((i) => i.aggregates?.ranked).map((i) => i.id),
          // Fusions and splits (CL-15), kept in this run's stats only: the digest reads them from
          // full pipeline runs (stats.cluster), never from this command.
          events: summary.events,
          merges: summary.merges,
          tensions: summary.tensions.map((t) => [t.a, t.b]),
          failures: summary.failures,
          label_calls: summary.labelCalls,
          duration_s: Math.round(seconds),
        },
        tokens_in: runCost.tokensIn,
        tokens_out: runCost.tokensOut,
        cost_eur: Number(runCost.eur.toFixed(4)),
        langfuse_url: url,
      })
      .eq("id", runId);
    console.log(`Trace Langfuse : ${url ?? "(Langfuse non configuré)"}`);
  } catch (error) {
    await db
      .from("pipeline_runs")
      .update({ status: "echec", ended_at: new Date().toISOString() })
      .eq("id", runId);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
