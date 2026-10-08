// Daily digest (SPEC §12.2, §16): the cron absorbs the feedbacks not processed yet
// (incremental mode, by batches of 10, within a time budget) then writes the digest. The same
// request keeps the Supabase project awake (CL-43). The caller holds the pipeline lock.
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, traceUrl, withTrace } from "@/lib/llm/tracing";
import { chunk } from "@/pipeline/graph";
import {
  MAX_INCREMENTAL_FEEDBACKS,
  runIncremental,
  type IncrementalContext,
} from "@/pipeline/incremental";
import { runDigest, type DigestResult } from "@/pipeline/nodes/digest";
import { loadFeedbacksToTriage } from "@/pipeline/nodes/triage";

export type DigestContext = IncrementalContext & {
  skills: IncrementalContext["skills"] & { digest: string };
};

/**
 * Writes a digest as its own run (kind « digest »): cost, duration and trace in pipeline_runs.
 * A new period by default (cron, `pnpm digest`); `samePeriod` rewrites the current one (ADR-043).
 */
export async function generateDigest(
  db: Db,
  ctx: DigestContext,
  options: { clock?: Date; samePeriod?: boolean } = {},
): Promise<DigestResult & { runId: string; costEur: number }> {
  const started = Date.now();
  const { data: run, error } = await db
    .from("pipeline_runs")
    .insert({ kind: "digest", status: "en_cours" })
    .select("id")
    .single();
  if (error) throw new Error(`Digest : création du run (${error.message})`);
  const runId = run!.id;
  const runCost = new RunCost();
  let traceId: string | undefined;
  try {
    const result = await withTrace(
      "run-digest",
      { runId, step: "digest", tags: ["pipeline", "digest"] },
      {},
      async () => {
        traceId = currentTraceId();
        return runDigest(db, {
          runId,
          weighting: ctx.pack.weighting,
          skill: ctx.skills.digest,
          now: ctx.now,
          clock: options.clock,
          samePeriod: options.samePeriod,
          runCost,
          invoke: ctx.invoke,
        });
      },
      (r) => ({ id: r.id, writer: r.writer, error: r.error }),
    );
    await db
      .from("pipeline_runs")
      .update({
        status: "termine",
        ended_at: new Date().toISOString(),
        stats: {
          mode: "digest",
          digest_id: result.id,
          writer: result.writer,
          error: result.error,
          first: result.facts.first,
          duration_ms: Date.now() - started,
        } as unknown as Json,
        tokens_in: runCost.tokensIn,
        tokens_out: runCost.tokensOut,
        cost_eur: Number(runCost.eur.toFixed(4)),
        langfuse_url: await traceUrl(traceId),
      })
      .eq("id", runId);
    return { ...result, runId, costEur: runCost.eur };
  } catch (e) {
    await db
      .from("pipeline_runs")
      .update({
        status: "echec",
        ended_at: new Date().toISOString(),
        stats: { mode: "digest", error: e instanceof Error ? e.message : String(e) },
      })
      .eq("id", runId);
    throw e;
  }
}

export type DailyResult = {
  /** Feedbacks absorbed by the incremental mode before the digest. */
  processed: string[];
  failed: string[];
  /** Left for the next run: the time budget was spent (they will be in the next digest). */
  postponed: string[];
  digest: { id: string; runId: string; writer: DigestResult["writer"]; costEur: number };
  costEur: number;
};

export async function runDailyDigest(
  db: Db,
  ctx: DigestContext,
  options: { budgetMs: number; now?: () => number },
): Promise<DailyResult> {
  const clock = options.now ?? Date.now;
  const deadline = clock() + options.budgetMs;
  // Previously failed feedbacks wait for a full run (`pnpm pipeline:run` retries them).
  const pending = (await loadFeedbacksToTriage(db, { retryFailed: false })).map((f) => f.id);
  const processed: string[] = [];
  const failed: string[] = [];
  const postponed: string[] = [];
  let costEur = 0;
  for (const batch of chunk(pending, MAX_INCREMENTAL_FEEDBACKS)) {
    if (clock() >= deadline) {
      postponed.push(...batch);
      continue;
    }
    const result = await runIncremental(db, batch, ctx);
    costEur += result.costEur;
    for (const f of result.feedbacks) (f.status === "ok" ? processed : failed).push(f.id);
  }
  const digest = await generateDigest(db, ctx);
  return {
    processed,
    failed,
    postponed,
    digest: { id: digest.id, runId: digest.runId, writer: digest.writer, costEur: digest.costEur },
    costEur: costEur + digest.costEur,
  };
}
