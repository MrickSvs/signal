// Full pipeline as a LangGraph StateGraph (SPEC §6.1, ADR 003 of SPEC §6.5):
// ingest → triage (fan-out by batches via Send) → enrich → embed → cluster → estimate → score →
// alert → digest.
// The state only carries ids, counters and costs: the data lives in Supabase. Every node is
// idempotent (it reads what is left to do from the base), so a run interrupted anywhere can be
// resumed from its checkpoint (`--resume <run_id>`, CL-13), and a failed element is recorded
// without stopping the run (CL-11). `cluster` covers the match and label steps of SPEC §6.1:
// they share one plan written after every model call (2.3).
import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { RunCost } from "@/lib/llm/cost";
import { withSpan } from "@/lib/llm/tracing";
import type { invokeStructured } from "@/lib/llm/structured";
import type { ReachMode } from "@/lib/scoring/reach";
import { fetchAll, runClustering } from "@/pipeline/insights";
import { emergingInsights, loadAlertInput, runAlerts } from "@/pipeline/nodes/alert";
import { runDigest } from "@/pipeline/nodes/digest";
import { runEmbed } from "@/pipeline/nodes/embed";
import { runEnrich } from "@/pipeline/nodes/enrich";
import {
  parseOkrIds,
  runEstimates,
  runScoring,
  type EstimateRunDeps,
} from "@/pipeline/nodes/score";
import { loadFeedbacksToTriage, runTriage } from "@/pipeline/nodes/triage";

export const DEFAULT_TRIAGE_BATCH_SIZE = 10;
/** Triage batches in flight (graph maxConcurrency) × calls per batch ≈ 8 parallel Haiku calls. */
export const DEFAULT_MAX_CONCURRENCY = 2;
const TRIAGE_CONCURRENCY_PER_BATCH = 4;

export type RunFailure = { step: string; id: string | null; error: string };
export type RunCostTotals = { eur: number; tokensIn: number; tokensOut: number };

const ZERO_COST: RunCostTotals = { eur: 0, tokensIn: 0, tokensOut: 0 };

export const PipelineState = Annotation.Root({
  runId: Annotation<string>,
  reachMode: Annotation<ReachMode>,
  /** Feedbacks left to triage when the run started (ingest). */
  pending: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  /** Payload of one triage task (Send); never merged back into the state. */
  batch: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  /** No live insight before the run: every alert would be noise, all goes to the digest. */
  bootstrap: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  emergingBefore: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  triaged: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  createdInsights: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  failures: Annotation<RunFailure[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  stats: Annotation<Record<string, unknown>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  cost: Annotation<RunCostTotals>({
    reducer: (a, b) => ({
      eur: a.eur + b.eur,
      tokensIn: a.tokensIn + b.tokensIn,
      tokensOut: a.tokensOut + b.tokensOut,
    }),
    default: () => ZERO_COST,
  }),
});

export type PipelineStateType = typeof PipelineState.State;
export type PipelineUpdate = typeof PipelineState.Update;

export type PipelineContext = {
  db: Db;
  pack: Pick<ContextPack, "weighting" | "documents" | "commitments">;
  skills: { triage: string; riceScoring: string; moscow: string; digest: string };
  now: Date;
  triageBatchSize?: number;
  /** Injected in tests: no model, Voyage or Langfuse call there (CLAUDE.md rule 11). */
  invoke?: typeof invokeStructured;
  embedFn?: (texts: string[]) => Promise<number[][]>;
  estimate?: Omit<EstimateRunDeps, "runCost">;
  sleep?: (ms: number) => Promise<void>;
};

const totals = (cost: RunCost): RunCostTotals => ({
  eur: cost.eur,
  tokensIn: cost.tokensIn,
  tokensOut: cost.tokensOut,
});

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk : taille invalide (${size})`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ranked live insights, in id order (what estimate and score work on). */
async function rankedInsights(db: Db) {
  return fetchAll(
    (from, to) =>
      db
        .from("insights")
        .select("id, title, problem_statement")
        .in("status", ["propose", "actif"])
        .eq("ranked", true)
        .order("id")
        .range(from, to),
    "lecture des insights classés",
  );
}

export function buildPipelineGraph(ctx: PipelineContext) {
  const { db, pack, now } = ctx;
  const { weighting } = pack;

  const ingest = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-ingest", { runId: state.runId }, async () => {
      // Full run: previously failed feedbacks are retried (CL-11).
      const pending = (await loadFeedbacksToTriage(db, { retryFailed: true })).map((f) => f.id);
      for (const ids of chunk(pending, 200)) {
        const { error } = await db
          .from("feedbacks")
          .update({ ingested_run_id: state.runId })
          .in("id", ids)
          .is("ingested_run_id", null);
        if (error) throw new Error(`Ingest : marquage des retours (${error.message})`);
      }
      const { data: live, error } = await db
        .from("insights")
        .select("id")
        .in("status", ["propose", "actif"])
        .limit(1);
      if (error) throw new Error(`Ingest : lecture des insights (${error.message})`);
      return {
        pending,
        bootstrap: (live ?? []).length === 0,
        emergingBefore: await emergingInsights(db),
        stats: { ingest: { pending: pending.length } },
      };
    });

  const triage = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-triage", { runId: state.runId, batch: state.batch }, async () => {
      // Only what is still to do: a batch replayed on resume skips its triaged feedbacks.
      const feedbacks = await loadFeedbacksToTriage(db, { retryFailed: true, ids: state.batch });
      const runCost = new RunCost();
      const summary = await runTriage(db, {
        runId: state.runId,
        model: "haiku",
        runCost,
        invoke: ctx.invoke,
        sleep: ctx.sleep,
        ctx: {
          skill: ctx.skills.triage,
          product: pack.documents.product,
          truncationChars: weighting.triage.truncation_chars,
          maxItems: weighting.triage.max_items_per_feedback,
        },
        feedbacks,
        concurrency: TRIAGE_CONCURRENCY_PER_BATCH,
      });
      const failed = new Set(summary.failures.map((f) => f.feedbackId));
      return {
        // The whole batch: on resume, feedbacks triaged by the interrupted attempt are skipped
        // here but still belong to the run (count, alerts).
        triaged: state.batch.filter((id) => !failed.has(id)),
        failures: summary.failures.map((f) => ({
          step: "triage",
          id: f.feedbackId,
          error: f.error,
        })),
        cost: totals(runCost),
      };
    });

  const enrich = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-enrich", { runId: state.runId }, async () => {
      const summary = await runEnrich(db, { weighting, now });
      const triageFailures = state.failures.filter((f) => f.step === "triage").length;
      return {
        stats: {
          triage: { ok: state.triaged.length, failed: triageFailures },
          enrich: { linked: summary.linked.length, by_method: summary.byMethod },
        },
      };
    });

  const embed = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-embed", { runId: state.runId }, async () => {
      const runCost = new RunCost();
      const summary = await runEmbed(db, { runCost, embedFn: ctx.embedFn });
      return { stats: { embed: { embedded: summary.embedded.length } }, cost: totals(runCost) };
    });

  const cluster = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-cluster", { runId: state.runId }, async () => {
      const runCost = new RunCost();
      const summary = await runClustering(db, {
        runId: state.runId,
        weighting,
        now,
        commitments: pack.commitments,
        label: { skill: ctx.skills.triage },
        deps: { runCost, invoke: ctx.invoke, sleep: ctx.sleep },
      });
      // The full run regroups everything: an item now inside an insight leaves the watch queue.
      const grouped = summary.insights
        .filter((i) => i.status === "propose" || i.status === "actif" || i.status === "rejete")
        .flatMap((i) => i.itemIds);
      for (const ids of chunk(grouped, 200)) {
        const { error } = await db
          .from("feedback_items")
          .update({ watch: false })
          .in("id", ids)
          .eq("watch", true);
        if (error) throw new Error(`Cluster : sortie de la file à surveiller (${error.message})`);
      }
      const created = summary.insights.filter((i) => i.isNew).map((i) => i.id);
      return {
        createdInsights: created,
        failures: summary.failures.map((f) => ({
          step: `cluster:${f.pass}`,
          id: f.insight,
          error: f.error,
        })),
        stats: {
          // Read by the digest (2.7): fusions and splits are reported to the PO (CL-15).
          cluster: {
            threshold: summary.threshold,
            clusters: summary.clusters,
            unclustered: summary.unclustered.length,
            created,
            relabelled: summary.insights.filter((i) => i.relabelled).map((i) => i.id),
            ranked: summary.insights.filter((i) => i.aggregates?.ranked).map((i) => i.id),
            events: summary.events,
            merges: summary.merges,
            tensions: summary.tensions.map((t) => [t.a, t.b]),
            label_calls: summary.labelCalls,
          },
        },
        cost: totals(runCost),
      };
    });

  const estimate = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-estimate", { runId: state.runId }, async () => {
      const runCost = new RunCost();
      const insights = await rankedInsights(db);
      const { estimates, failures } = await runEstimates(db, insights, {
        ...ctx.estimate,
        runCost,
      });
      return {
        failures: failures.map((f) => ({ step: "estimate", id: f.insight, error: f.error })),
        stats: {
          estimate: {
            insights: insights.length,
            cached: [...estimates.values()].filter((e) => e.cached).length,
          },
        },
        cost: totals(runCost),
      };
    });

  const score = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-score", { runId: state.runId, mode: state.reachMode }, async () => {
      const runCost = new RunCost();
      const summary = await runScoring(db, {
        mode: state.reachMode,
        weighting,
        now,
        commitments: pack.commitments,
        context: {
          weighting,
          skills: { riceScoring: ctx.skills.riceScoring, moscow: ctx.skills.moscow },
          documents: { strategy: pack.documents.strategy, commitments: pack.documents.commitments },
          okrIds: parseOkrIds(pack.documents.strategy),
        },
        deps: { runCost, invoke: ctx.invoke, ...ctx.estimate },
      });
      return {
        // Estimation failures are already reported by the estimate node.
        failures: summary.failures
          .filter((f) => f.step === "jugement")
          .map((f) => ({ step: "score", id: f.insight, error: f.error })),
        stats: {
          score: {
            reach_mode: state.reachMode,
            ranked: summary.scores.map((s) => s.insight_id),
            judged: summary.judged,
            capacity: summary.capacity,
            context_changed: summary.contextChanged,
          },
        },
        cost: totals(runCost),
      };
    });

  const alert = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-alert", { runId: state.runId }, async () => {
      if (state.bootstrap) {
        // First run: everything is new; the PO reviews it in the digest (CL-18, CL-52).
        return { stats: { alert: { skipped: "premier run", created: [], enriched: [] } } };
      }
      const input = await loadAlertInput(db, {
        newFeedbackIds: state.triaged,
        createdInsights: state.createdInsights,
        emergingBefore: state.emergingBefore,
        weighting,
        now,
        commitments: pack.commitments,
      });
      const summary = await runAlerts(db, input, weighting.alerts);
      return { stats: { alert: summary } };
    });

  const digest = async (state: PipelineStateType): Promise<PipelineUpdate> =>
    withSpan("pipeline-digest", { runId: state.runId }, async () => {
      const runCost = new RunCost();
      const result = await runDigest(db, {
        runId: state.runId,
        weighting,
        skill: ctx.skills.digest,
        now,
        runCost,
        invoke: ctx.invoke,
      });
      return {
        failures: result.error ? [{ step: "digest", id: result.id, error: result.error }] : [],
        stats: { digest: { id: result.id, writer: result.writer } },
        cost: totals(runCost),
      };
    });

  const batchSize = ctx.triageBatchSize ?? DEFAULT_TRIAGE_BATCH_SIZE;
  const fanOut = (state: PipelineStateType) =>
    state.pending.length === 0
      ? "enrich"
      : chunk(state.pending, batchSize).map((batch) => new Send("triage", { ...state, batch }));

  // Transient errors (network, database) are retried once: every node is idempotent.
  const retryPolicy = { maxAttempts: 2 };
  return new StateGraph(PipelineState)
    .addNode("ingest", ingest, { retryPolicy })
    .addNode("triage", triage, { retryPolicy })
    .addNode("enrich", enrich, { retryPolicy })
    .addNode("embed", embed, { retryPolicy })
    .addNode("cluster", cluster, { retryPolicy })
    .addNode("estimate", estimate, { retryPolicy })
    .addNode("score", score, { retryPolicy })
    .addNode("alert", alert, { retryPolicy })
    .addNode("digest", digest, { retryPolicy })
    .addEdge(START, "ingest")
    .addConditionalEdges("ingest", fanOut, ["triage", "enrich"])
    .addEdge("triage", "enrich")
    .addEdge("enrich", "embed")
    .addEdge("embed", "cluster")
    .addEdge("cluster", "estimate")
    .addEdge("estimate", "score")
    .addEdge("score", "alert")
    .addEdge("alert", "digest")
    .addEdge("digest", END);
}

export function compilePipeline(ctx: PipelineContext, checkpointer?: BaseCheckpointSaver) {
  return buildPipelineGraph(ctx).compile({ checkpointer, name: "signal-pipeline" });
}

export type CompiledPipeline = ReturnType<typeof compilePipeline>;

export type RunPipelineOptions = {
  runId: string;
  reachMode: ReachMode;
  /** Resume the checkpointed run instead of starting it (CL-13). */
  resume?: boolean;
  maxConcurrency?: number;
};

/**
 * Starts or resumes a run. On resume, the graph restarts from its last checkpoint: finished
 * nodes (and finished triage batches) are not replayed; without a checkpoint, it starts over.
 */
export async function runPipeline(
  graph: CompiledPipeline,
  options: RunPipelineOptions,
): Promise<PipelineStateType> {
  const config = {
    configurable: { thread_id: options.runId },
    maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    recursionLimit: 50,
  };
  if (options.resume) {
    const snapshot = await graph.getState(config);
    if (snapshot.values && Object.keys(snapshot.values).length > 0) {
      if (snapshot.next.length === 0) return snapshot.values as PipelineStateType;
      return (await graph.invoke(null, config)) as PipelineStateType;
    }
  }
  return (await graph.invoke(
    { runId: options.runId, reachMode: options.reachMode },
    config,
  )) as PipelineStateType;
}
