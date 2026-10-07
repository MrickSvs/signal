import "server-only";
import type { Db } from "@/lib/db/client";
import type { StoredEvalRun } from "@/lib/evals/catalog";
import { buildEvalCards, type EvalCard } from "@/lib/evals/dashboard";
import { productionMetric, type DecisionRow, type ProductionMetric } from "@/lib/evals/production";

const MAX_EVAL_RUNS = 500;
const MAX_DECISIONS = 5000;

export type FullRunCost = {
  id: string;
  startedAt: string;
  durationS: number | null;
  costEur: number;
  tokensIn: number;
  tokensOut: number;
  langfuseUrl: string | null;
  /** € per graph node; null for a run recorded before the split existed. */
  byNode: Record<string, number> | null;
};

export type EvalsScreen = {
  cards: EvalCard[];
  production: ProductionMetric;
  lastFullRun: FullRunCost | null;
  /** Feedbacks of the demo set: scales the Haiku / Sonnet cost to the full set. */
  feedbackCount: number;
};

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Évals : ${what} (${error.message})`);
};

/** Everything the Évals screen shows (SPEC §12.7): runs, decision journal, last full run. */
export async function getEvalsScreen(db: Db): Promise<EvalsScreen> {
  const [runs, decisions, fullRun, feedbacks] = await Promise.all([
    db
      .from("eval_runs")
      .select(
        "id, eval_name, config, sample_size, metrics, cost_eur, langfuse_url, git_sha, started_at, ended_at",
      )
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(MAX_EVAL_RUNS),
    db
      .from("decisions")
      .select("id, actor, entity_type, entity_id, action, field, after, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_DECISIONS),
    db
      .from("pipeline_runs")
      .select("id, started_at, stats, cost_eur, tokens_in, tokens_out, langfuse_url")
      .eq("kind", "full")
      .eq("status", "termine")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("feedbacks").select("id", { count: "exact", head: true }),
  ]);
  check(runs.error, "lecture des runs d'évals");
  check(decisions.error, "lecture des décisions");
  check(fullRun.error, "lecture du dernier run complet");
  check(feedbacks.error, "comptage des retours");

  const run = fullRun.data;
  const stats = (run?.stats ?? {}) as {
    duration_s?: number;
    cost_by_node?: Record<string, number>;
  };
  return {
    cards: buildEvalCards((runs.data ?? []) as unknown as StoredEvalRun[]),
    production: productionMetric((decisions.data ?? []) as DecisionRow[]),
    lastFullRun: run
      ? {
          id: run.id,
          startedAt: run.started_at,
          durationS: stats.duration_s ?? null,
          costEur: Number(run.cost_eur),
          tokensIn: run.tokens_in,
          tokensOut: run.tokens_out,
          langfuseUrl: run.langfuse_url,
          byNode: stats.cost_by_node ?? null,
        }
      : null,
    feedbackCount: feedbacks.count ?? 0,
  };
}
