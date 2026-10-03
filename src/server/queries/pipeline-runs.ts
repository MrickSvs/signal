import "server-only";
import type { Db } from "@/lib/db/client";
import { Constants, type Tables } from "@/lib/db/types";

export const RUN_KINDS = Constants.public.Enums.run_kind;
export const MAX_RUNS = 100;

export type PipelineRun = Pick<
  Tables<"pipeline_runs">,
  | "id"
  | "kind"
  | "status"
  | "started_at"
  | "ended_at"
  | "stats"
  | "tokens_in"
  | "tokens_out"
  | "cost_eur"
  | "langfuse_url"
>;

/** Latest runs first (SPEC §15: cost and duration of each run). */
export async function listPipelineRuns(
  db: Db,
  options: { limit: number; kind?: Tables<"pipeline_runs">["kind"] },
): Promise<PipelineRun[]> {
  let query = db
    .from("pipeline_runs")
    .select(
      "id, kind, status, started_at, ended_at, stats, tokens_in, tokens_out, cost_eur, langfuse_url",
    );
  if (options.kind) query = query.eq("kind", options.kind);
  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(Math.min(options.limit, MAX_RUNS));
  if (error) throw new Error(`Lecture des runs (${error.message})`);
  return data;
}
