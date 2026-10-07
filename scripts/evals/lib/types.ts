// Shapes of the eval runners. The stored shapes (eval_runs.metrics) live in src/lib/evals: the
// Évals screen reads them too.
export type { EvalName, EvalSummary, Metric } from "@/lib/evals/types";

/** One row of eval_results. */
export type CaseResult = {
  item_id: string;
  expected: unknown;
  actual: unknown;
  score: number | null;
  pass: boolean | null;
  /** Trace of the case in Langfuse (dataset run item). */
  traceId?: string;
};
