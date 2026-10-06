// Shapes shared by the eval runners, the persistence (eval_runs, eval_results) and docs/EVALS.md.

export type EvalName =
  | "triage"
  | "triage-edge"
  | "triage-compare"
  | "detection"
  | "estimation"
  | "stability"
  | "guardrails"
  | "guardrails-tools";

/** One headline number of an eval, next to its target (SPEC §14.2). */
export type Metric = {
  key: string;
  label: string;
  value: number | null;
  /** Value as shown (« 92 % », « 7/8 », « 0,86 »). */
  display: string;
  /** Target as written in SPEC §14.2 (« ≥ 90 % »); absent when the measure has none. */
  target?: string;
  /** null: not measurable in this run (nothing to measure, failed run). */
  met?: boolean | null;
};

/** What is stored in eval_runs.metrics. */
export type EvalSummary = {
  /** The data set the numbers are measured on (shown in docs/EVALS.md). */
  dataset: string;
  metrics: Metric[];
  /** Eval-specific breakdown (confusion matrix, per-case table…). */
  details?: unknown;
  /** Honest notes: known failures, limits of the measure, what was simulated. */
  notes?: string[];
};

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
