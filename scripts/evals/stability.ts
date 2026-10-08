// eval:stability (SPEC §14.2): replays the model's part of the score (Impact, alignment,
// MoSCoW) on the top 10 several times, effort from the cache (§8.4), and recomputes the ranking in
// code each time. Reference: the ranking computed from the stored judgments (what Léa sees).
// Measures: runs with the same top 3 (same order), mean Kendall's tau on the top 10.
// Nothing is written to scores.
// Usage: pnpm eval:stability [--runs 5] [--reach-mode comptes|mrr] [--yes]
// Cost: one Sonnet call per insight and per run (~0.035 €): 5 runs × 10 ≈ 1,75 €.
import { pathToFileURL } from "node:url";
import { mapWithConcurrency } from "@/lib/async";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import type { ReachMode } from "@/lib/scoring/reach";
import { loadSkill } from "@/lib/skills";
import {
  computeScores,
  effortOf,
  insightFacts,
  judgeInsight,
  loadCurrentScores,
  loadScoringInsights,
  parseOkrIds,
  reusableJudgment,
  type ComputeInput,
  type ScoreContext,
} from "@/pipeline/nodes/score";
import { loadCachedInsightEstimates } from "@/services/estimate";
import { checkCost, parseEvalArgs, positiveInt } from "./lib/args";
import { kendallTau, mean } from "./lib/metrics";
import { EvalRecorder } from "./lib/record";
import type { EvalSummary, Metric } from "./lib/types";

export const TOP = 10;
const COST_PER_JUDGMENT_EUR = 0.035;
const CONCURRENCY = 4;

/** Insight ids in rank order. */
export const rankOrder = (scores: readonly { insight_id: string; rank: number }[]) =>
  scores.toSorted((a, b) => a.rank - b.rank).map((s) => s.insight_id);

export const sameTop = (reference: readonly string[], other: readonly string[], k = 3) =>
  reference.slice(0, k).every((id, i) => other[i] === id);

export type RunOutcome = { order: string[]; tau: number; sameTop3: boolean };

export function compareRun(reference: readonly string[], order: readonly string[]): RunOutcome {
  const top = reference.slice(0, TOP);
  // Tau on the reference top 10, in the order the run gives them (ranks among all insights).
  const runTop = order.filter((id) => top.includes(id));
  return { order: [...order], tau: kendallTau(top, runTop), sameTop3: sameTop(reference, order) };
}

export function stabilityMetrics(outcomes: readonly RunOutcome[]): Metric[] {
  const runs = outcomes.length;
  const same = outcomes.filter((o) => o.sameTop3).length;
  const tau = mean(outcomes.map((o) => o.tau));
  const needed = Math.ceil(runs * 0.8);
  return [
    {
      key: "same_top3",
      label: "Runs avec le même top 3",
      value: runs ? same / runs : null,
      display: `${same}/${runs}`,
      target: runs === 5 ? "≥ 4/5" : `≥ ${needed}/${runs} (4/5 ramené au nombre de runs)`,
      met: runs ? same >= needed : null,
    },
    {
      key: "kendall_tau",
      label: "τ de Kendall moyen sur le top 10",
      value: tau,
      display: tau.toFixed(2).replace(".", ","),
      target: "≥ 0,8",
      met: runs ? tau >= 0.8 : null,
    },
  ];
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2), { valued: ["--runs", "--reach-mode"] });
  const runs = positiveInt(args, "--runs", 5);
  const db = getScriptDb();
  initTracing();
  const [pack, riceScoring, moscow] = await Promise.all([
    loadContextPack(),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
  ]);
  const mode = (args.values.get("--reach-mode") ?? pack.weighting.reach.default_mode) as ReachMode;
  if (mode !== "comptes" && mode !== "mrr") throw new Error("--reach-mode attend comptes ou mrr");
  const context: ScoreContext = {
    weighting: pack.weighting,
    skills: { riceScoring: riceScoring.content, moscow: moscow.content },
    documents: { strategy: pack.documents.strategy, commitments: pack.documents.commitments },
    okrIds: parseOkrIds(pack.documents.strategy),
  };

  const { insights, commitments } = await loadScoringInsights(db, {
    weighting: pack.weighting,
    now: getDemoNow(),
    commitments: pack.commitments,
  });
  const [current, estimates] = await Promise.all([
    loadCurrentScores(db),
    loadCachedInsightEstimates(db, insights),
  ]);
  const inputs: ComputeInput[] = [];
  const skipped: string[] = [];
  for (const insight of insights) {
    const effort = effortOf(insight, estimates.get(insight.id)?.estimate ?? null, pack.weighting);
    const judgment = reusableJudgment(current.get(insight.id)?.judgment, insight, context);
    if (!effort || !judgment) {
      skipped.push(insight.id);
      continue;
    }
    inputs.push({ insight, facts: insightFacts(insight, commitments), judgment, effort });
  }
  const reference = rankOrder(computeScores(inputs, mode, pack.weighting).scores);
  const top = reference.slice(0, TOP);
  if (top.length < 2)
    throw new Error("Moins de deux insights classés : lance d'abord le pipeline.");
  console.log(`Top ${top.length} de référence (${mode}) : ${top.join(", ")}`);
  console.log(
    checkCost(
      runs * top.length * COST_PER_JUDGMENT_EUR,
      args,
      `${runs} runs × ${top.length} jugements Sonnet`,
    ),
  );

  const recorder = await EvalRecorder.start(db, "stability", { runs, mode, top: top.length }, runs);
  const runCost = new RunCost();
  const outcomes: RunOutcome[] = [];
  const impacts = new Map<string, number[]>(top.map((id) => [id, []]));
  const moscows = new Map<string, string[]>(top.map((id) => [id, []]));
  for (let run = 1; run <= runs; run++) {
    let traceId: string | undefined;
    const outcome = await withTrace(
      "eval-stability-run",
      {
        root: true,
        runId: recorder.runId,
        step: "eval",
        entity: `run-${run}`,
        tags: ["eval", "stability"],
      },
      { run, top },
      async () => {
        traceId = currentTraceId();
        const rejudged = new Map<string, ComputeInput["judgment"]>();
        await mapWithConcurrency(top, CONCURRENCY, async (id) => {
          const input = inputs.find((i) => i.insight.id === id)!;
          const judgment = await judgeInsight(input.insight, input.facts, context, { runCost });
          rejudged.set(id, judgment);
          impacts.get(id)!.push(judgment.impact);
          moscows.get(id)!.push(judgment.moscow_reco);
        });
        const replayed = inputs.map((i) =>
          rejudged.has(i.insight.id) ? { ...i, judgment: rejudged.get(i.insight.id)! } : i,
        );
        return compareRun(
          reference,
          rankOrder(computeScores(replayed, mode, pack.weighting).scores),
        );
      },
    );
    outcomes.push(outcome);
    console.log(
      `Run ${run}/${runs} : τ ${outcome.tau.toFixed(2)} · top 3 ${outcome.sameTop3 ? "identique" : "différent"} (${outcome.order.slice(0, 3).join(", ")})`,
    );
    recorder.add({
      item_id: `run-${run}`,
      expected: { top },
      actual: { top: outcome.order.slice(0, TOP) },
      score: outcome.tau,
      pass: outcome.sameTop3,
      traceId,
    });
  }

  const spread = top.map((id) => ({
    insight: id,
    stored_impact: inputs.find((i) => i.insight.id === id)!.judgment.impact,
    impacts: impacts.get(id),
    moscow: moscows.get(id),
  }));
  const unstable = spread.filter((s) => new Set(s.impacts).size > 1 || new Set(s.moscow).size > 1);
  const summary: EvalSummary = {
    dataset: `Insights classés en base (jeu de développement), top ${top.length}, mode ${mode}, ${runs} runs`,
    metrics: stabilityMetrics(outcomes),
    details: { reference: top, spread },
    notes: [
      "Référence : le classement recalculé à partir des jugements enregistrés. Chaque run rejuge le top 10 (Impact, alignement, MoSCoW), garde l'effort en cache et recalcule tout le classement en code.",
      ...(unstable.length
        ? [
            `Jugements variables d'un run à l'autre : ${unstable
              .map(
                (s) =>
                  `${s.insight} (Impact ${[...new Set(s.impacts)].join("/")}, MoSCoW ${[...new Set(s.moscow)].join("/")})`,
              )
              .join(" ; ")}.`,
          ]
        : ["Impact et MoSCoW identiques à chaque run sur tout le top 10."]),
      ...(skipped.length
        ? [`Sans jugement ou sans estimation en cache, hors classement : ${skipped.join(", ")}.`]
        : []),
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  for (const m of summary.metrics)
    console.log(`  ${m.label} : ${m.display} (cible ${m.target}) ${m.met ? "✓" : "✗"}`);
  for (const n of summary.notes ?? []) console.log(`  · ${n}`);
  console.log(`Coût : ${runCost.eur.toFixed(4)} € · rapport ${file} · docs/EVALS.md mis à jour`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await shutdownTracing();
    process.exit(1);
  });
}
