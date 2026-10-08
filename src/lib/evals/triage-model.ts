// The « Triage » card measures the model the pipeline triages with (ADR-041): a run on another
// model is an exploration and belongs to the comparison card. When the production model was last
// measured inside a comparison, its half of that comparison stands for it. Shared by the Évals
// screen and docs/EVALS.md. Pure.
import type { StoredEvalRun } from "./catalog";
import type { EvalSummary, Metric } from "./types";

/** Targets of the triage on the holdout set (SPEC §14.2), shared with scripts/evals/triage.ts. */
export const TRIAGE_TARGETS: Record<string, { target: string; met: (v: number) => boolean }> = {
  type_accuracy: { target: "≥ 90 %", met: (v) => v >= 0.9 },
  area_macro_f1: { target: "≥ 0,85", met: (v) => v >= 0.85 },
  injection_recall: { target: "100 %", met: (v) => v === 1 },
};

const configModel = (run: StoredEvalRun): string | null => {
  const model = (run.config as { model?: unknown } | null)?.model;
  return typeof model === "string" ? model : null;
};

const summaryOf = (run: StoredEvalRun): EvalSummary | null =>
  "metrics" in run.metrics && Array.isArray(run.metrics.metrics)
    ? (run.metrics as EvalSummary)
    : null;

/** The production model's half of a comparison run, as a « triage » run (null if absent). */
export function triageRunFromComparison(run: StoredEvalRun, model: string): StoredEvalRun | null {
  const summary = summaryOf(run);
  if (!summary) return null;
  const suffix = `_${model}`;
  const tag = new RegExp(`\\s*\\(${model}\\)`, "i");
  const metrics: Metric[] = summary.metrics
    .filter((m) => m.key.endsWith(suffix))
    .map((m) => {
      const key = m.key.slice(0, -suffix.length);
      const goal = TRIAGE_TARGETS[key];
      return {
        key,
        label: m.label.replace(tag, ""),
        value: m.value,
        display: m.display,
        ...(goal ? { target: goal.target, met: m.value === null ? null : goal.met(m.value) } : {}),
      };
    })
    // Target metrics first: the card's headline is its first metric with a target.
    .toSorted((a, b) => Number(Boolean(b.target)) - Number(Boolean(a.target)));
  if (!metrics.some((m) => m.target)) return null;
  const per100 = metrics.find((m) => m.key === "cost_per_100")?.value ?? null;
  return {
    ...run,
    eval_name: "triage",
    config: { model, from_comparison: run.id },
    cost_eur: per100 !== null && run.sample_size !== null ? (per100 * run.sample_size) / 100 : null,
    metrics: {
      ...summary,
      dataset: `${summary.dataset} : partie ${model} du comparatif`,
      metrics,
      details: undefined,
      notes: [`Mesuré dans le comparatif (pnpm eval:triage --compare) : modèle ${model} seul.`],
    },
  };
}

/**
 * Runs as the triage card should see them: « triage » runs on another model than `model` are
 * dropped, and the production model's half of every comparison is added as a « triage » run.
 */
export function withProductionTriage(
  runs: readonly StoredEvalRun[],
  model: string,
): StoredEvalRun[] {
  const kept = runs.filter((r) => r.eval_name !== "triage" || configModel(r) === model);
  const derived = runs
    .filter((r) => r.eval_name === "triage-compare")
    .flatMap((r) => triageRunFromComparison(r, model) ?? []);
  return [...kept, ...derived];
}
