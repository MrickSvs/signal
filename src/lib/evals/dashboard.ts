// What the Évals screen (SPEC §12.7) shows of the stored runs: the latest run of each eval, its
// status against the targets of SPEC §14.2, its trend over the previous runs, and the Haiku /
// Sonnet comparison. Pure: the runs are read by src/server/queries/evals.ts.
import { EVALS, type StoredEvalRun } from "./catalog";
import type { EvalName, EvalSummary, Metric } from "./types";

/** vert: every target met · orange: some met · rouge: none met · aucun: nothing to compare. */
export type EvalStatus = "vert" | "orange" | "rouge" | "aucun";

const summaryOf = (run: StoredEvalRun): EvalSummary | null =>
  "metrics" in run.metrics && Array.isArray(run.metrics.metrics)
    ? (run.metrics as EvalSummary)
    : null;

export function evalStatus(metrics: readonly Metric[]): EvalStatus {
  const judged = metrics.filter((m) => m.target && typeof m.met === "boolean");
  if (judged.length === 0) return "aucun";
  const met = judged.filter((m) => m.met).length;
  if (met === judged.length) return "vert";
  return met === 0 ? "rouge" : "orange";
}

/** The main number of an eval: its first metric with a target, else its first metric. */
export function headlineMetric(metrics: readonly Metric[]): Metric | null {
  return metrics.find((m) => m.target) ?? metrics[0] ?? null;
}

export type TrendPoint = { runId: string; startedAt: string; value: number; display: string };

export type EvalCard = {
  name: EvalName;
  title: string;
  command: string;
  /** null: never measured (or only failed runs). */
  latest: {
    runId: string;
    startedAt: string;
    dataset: string;
    sampleSize: number | null;
    costEur: number | null;
    langfuseUrl: string | null;
    gitSha: string | null;
    headline: Metric | null;
    status: EvalStatus;
    /** Targets missed by this run, named on the card. */
    missed: Metric[];
    metrics: Metric[];
    notes: string[];
    details: unknown;
  } | null;
  /** Headline value of every finished run of this eval, oldest first. */
  trend: TrendPoint[];
};

/** One card per eval of SPEC §14.2, in the catalog order, from finished runs (any order). */
export function buildEvalCards(runs: readonly StoredEvalRun[]): EvalCard[] {
  const byName = new Map<string, StoredEvalRun[]>();
  for (const run of runs) {
    if (!run.ended_at || !summaryOf(run)) continue;
    byName.set(run.eval_name, [...(byName.get(run.eval_name) ?? []), run]);
  }
  return EVALS.map((meta) => {
    const ordered = (byName.get(meta.name) ?? []).toSorted((a, b) =>
      a.started_at.localeCompare(b.started_at),
    );
    const trend: TrendPoint[] = [];
    for (const run of ordered) {
      const headline = headlineMetric(summaryOf(run)!.metrics);
      if (headline && headline.value !== null)
        trend.push({
          runId: run.id,
          startedAt: run.started_at,
          value: headline.value,
          display: headline.display,
        });
    }
    const last = ordered.at(-1);
    if (!last) return { ...meta, latest: null, trend };
    const summary = summaryOf(last)!;
    return {
      ...meta,
      trend,
      latest: {
        runId: last.id,
        startedAt: last.started_at,
        dataset: summary.dataset,
        sampleSize: last.sample_size,
        costEur: last.cost_eur === null ? null : Number(last.cost_eur),
        langfuseUrl: last.langfuse_url,
        gitSha: last.git_sha,
        headline: headlineMetric(summary.metrics),
        status: evalStatus(summary.metrics),
        missed: summary.metrics.filter((m) => m.target && m.met === false),
        metrics: summary.metrics,
        notes: summary.notes ?? [],
        details: summary.details,
      },
    };
  });
}

export const COMPARED_MODELS = ["haiku", "sonnet"] as const;
export type ComparedModel = (typeof COMPARED_MODELS)[number];

export type ModelComparisonRow = {
  model: ComparedModel;
  typeAccuracy: Metric | null;
  areaMacroF1: Metric | null;
  injectionRecall: Metric | null;
  /** € per 100 feedbacks, as measured. */
  costPer100: number | null;
  /** € to triage the whole demo set (costPer100 scaled in code). */
  costFullSet: number | null;
  latency: Metric | null;
};

/** Haiku / Sonnet side by side, from the metrics of a `triage-compare` run (keys `<metric>_<model>`). */
export function modelComparison(
  metrics: readonly Metric[],
  fullSetSize: number,
): ModelComparisonRow[] {
  const find = (key: string) => metrics.find((m) => m.key === key) ?? null;
  return COMPARED_MODELS.map((model) => {
    const cost = find(`cost_per_100_${model}`)?.value ?? null;
    return {
      model,
      typeAccuracy: find(`type_accuracy_${model}`),
      areaMacroF1: find(`area_macro_f1_${model}`),
      injectionRecall: find(`injection_recall_${model}`),
      costPer100: cost,
      costFullSet: cost === null ? null : (cost * fullSetSize) / 100,
      latency: find(`latency_p50_${model}`),
    };
  });
}

const EDGE_KEY = /^E\d+$/;

/** E1 to E8 of a `triage-edge` run: one metric per case. */
export function edgeCases(metrics: readonly Metric[]): Metric[] {
  return metrics
    .filter((m) => EDGE_KEY.test(m.key))
    .toSorted((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
}
