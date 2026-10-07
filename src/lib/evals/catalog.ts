// The evals of SPEC §14.2, in display order, and the shape of a stored run (eval_runs). Shared by
// docs/EVALS.md (scripts/evals) and the Évals screen (SPEC §12.7).
import type { EvalName, EvalSummary } from "./types";

export type StoredEvalRun = {
  id: string;
  eval_name: string;
  config: unknown;
  sample_size: number | null;
  metrics: EvalSummary | Record<string, never>;
  cost_eur: number | null;
  langfuse_url: string | null;
  git_sha: string | null;
  started_at: string;
  ended_at: string | null;
};

export const EVALS: { name: EvalName; title: string; command: string }[] = [
  { name: "triage", title: "Triage", command: "pnpm eval:triage" },
  {
    name: "triage-edge",
    title: "Triage : cas limites E1 à E8",
    command: "pnpm eval:triage --edge",
  },
  {
    name: "triage-compare",
    title: "Triage : Haiku contre Sonnet",
    command: "pnpm eval:triage --compare",
  },
  { name: "detection", title: "Détection des patterns", command: "pnpm eval:detection" },
  { name: "estimation", title: "Estimation (leave-one-out)", command: "pnpm eval:estimation" },
  { name: "stability", title: "Stabilité du classement", command: "pnpm eval:stability" },
  { name: "guardrails", title: "Garde-fous", command: "pnpm eval:guardrails" },
  {
    name: "guardrails-tools",
    title: "Choix d'outil et enquête",
    command: "pnpm eval:guardrails --tools",
  },
  {
    name: "judge-calibration",
    title: "Calibration du juge",
    command: "pnpm eval:judge-calibration",
  },
  { name: "backlog", title: "Backlog : type et note du juge", command: "pnpm eval:backlog" },
];
