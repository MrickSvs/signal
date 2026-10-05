// Incremental mode (SPEC §6.1 « Deux modes », « Rythme », « Sujets à surveiller »): 1 to 10 new
// feedbacks → triage → enrich → embed → attachment to the closest insight, or the watch queue
// (CL-16) → new proposed insight once 3 queued items are close (SPEC §8.10, CL-51) → re-score of
// the touched insights (stored judgments, computed in code) → alerts. The caller holds the
// pipeline lock (withPipelineLock).
// The result says, per feedback, what happened, so that the chat can show it to the PO.
import { z } from "zod";
import {
  agglomerativeCluster,
  cosineSimilarity,
  type Vector,
} from "@/lib/clustering/agglomerative";
import type { ContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { Constants, type Json, type Tables } from "@/lib/db/types";
import { computeAggregates, type InsightFeedback } from "@/lib/insights/aggregates";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, traceUrl, withSpan, withTrace } from "@/lib/llm/tracing";
import type { invokeStructured } from "@/lib/llm/structured";
import type { ReachMode } from "@/lib/scoring/reach";
import { loadClusteringState, type ClusteringItem } from "@/pipeline/insights";
import {
  emergingInsights,
  loadAlertInput,
  runAlerts,
  type AlertSummary,
} from "@/pipeline/nodes/alert";
import { isClusterable, runEmbed } from "@/pipeline/nodes/embed";
import { runEnrich } from "@/pipeline/nodes/enrich";
import { labelInsight, representatives } from "@/pipeline/nodes/label-insights";
import { parseOkrIds, runScoring, type EstimateRunDeps } from "@/pipeline/nodes/score";
import { loadFeedbacksToTriage, runTriage } from "@/pipeline/nodes/triage";

export const MAX_INCREMENTAL_FEEDBACKS = 10;
const enums = Constants.public.Enums;

// ---------------------------------------------------------------------------
// New feedbacks (route input)
// ---------------------------------------------------------------------------

export const newFeedbackSchema = z.strictObject({
  channel: z.enum(enums.feedback_channel),
  source_type: z.enum(enums.feedback_source_type),
  author_name: z.string().trim().min(1).max(200).nullish(),
  author_email: z.email().nullish(),
  customer_id: z
    .string()
    .regex(/^C-\d{3,}$/)
    .nullish(),
  subject: z.string().trim().max(500).nullish(),
  raw_text: z.string().trim().min(1).max(50_000),
  nps_score: z.number().int().min(0).max(10).nullish(),
  /** Defaults to the scenario date (DEMO_NOW). */
  received_at: z.iso.datetime({ offset: true }).optional(),
});

export const incrementalRequestSchema = z.strictObject({
  feedbacks: z.array(newFeedbackSchema).min(1).max(MAX_INCREMENTAL_FEEDBACKS),
});

export type NewFeedback = z.infer<typeof newFeedbackSchema>;

/** Inserts the new feedbacks (R-xxx ids from the sequence) and returns their ids. */
export async function insertFeedbacks(
  db: Db,
  feedbacks: readonly NewFeedback[],
  now: Date,
): Promise<string[]> {
  const { data, error } = await db
    .from("feedbacks")
    .insert(
      feedbacks.map((f) => ({
        channel: f.channel,
        source_type: f.source_type,
        author_name: f.author_name ?? null,
        author_email: f.author_email ?? null,
        customer_id: f.customer_id ?? null,
        subject: f.subject ?? null,
        raw_text: f.raw_text,
        nps_score: f.nps_score ?? null,
        received_at: f.received_at ?? now.toISOString(),
      })),
    )
    .select("id");
  if (error) throw new Error(`Incrémental : insertion des retours (${error.message})`);
  return data.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Attachment (pure)
// ---------------------------------------------------------------------------

export type AttachCandidate = {
  id: string;
  status: Tables<"insights">["status"];
  itemIds: readonly string[];
};

export type Attachment = { itemId: string; insightId: string; similarity: number };

/**
 * Average-linkage similarity of an item to an insight, the measure the full run clusters with:
 * an item joins the closest insight when its mean cosine distance to the insight's items is
 * within the clustering threshold. A rejected insight still absorbs its items (it stays rejected,
 * CL-53); merged ones are frozen memories and never attract anything.
 */
export function attachItems(
  items: readonly { id: string; vector: Vector }[],
  insights: readonly AttachCandidate[],
  vectors: ReadonlyMap<string, Vector>,
  distanceThreshold: number,
): { attached: Attachment[]; watch: string[] } {
  const open = insights.filter(
    (i) => i.status === "propose" || i.status === "actif" || i.status === "rejete",
  );
  const attached: Attachment[] = [];
  const watch: string[] = [];
  for (const item of items) {
    let best: Attachment | null = null;
    for (const insight of open) {
      const others = insight.itemIds.filter((id) => id !== item.id && vectors.has(id));
      if (others.length === 0) continue;
      const mean =
        others.reduce((sum, id) => sum + cosineSimilarity(item.vector, vectors.get(id)!), 0) /
        others.length;
      if (
        !best ||
        mean > best.similarity ||
        (mean === best.similarity && insight.id < best.insightId)
      ) {
        best = { itemId: item.id, insightId: insight.id, similarity: mean };
      }
    }
    if (best && best.similarity >= 1 - distanceThreshold) attached.push(best);
    else watch.push(item.id);
  }
  return { attached, watch };
}

/** Groups of at least `minItems` close watched items: each becomes a proposed insight (CL-16). */
export function watchGroups(
  items: readonly { id: string; vector: Vector }[],
  distanceThreshold: number,
  minItems: number,
): string[][] {
  const sorted = items.toSorted((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const { clusters } = agglomerativeCluster(
    sorted.map((i) => i.vector),
    { distanceThreshold, minClusterSize: minItems },
  );
  return clusters.map((c) => c.map((k) => sorted[k].id).sort());
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type ItemOutcome = {
  id: string;
  type: Tables<"feedback_items">["type"];
  /** rattache: confirms a known topic · nouvel_insight: formed a proposed insight · surveille:
   *  waits in the watch queue · non_regroupe: praise, question or « autre » (never grouped). */
  outcome: "rattache" | "nouvel_insight" | "surveille" | "non_regroupe";
  insight_id: string | null;
  insight_title: string | null;
  similarity: number | null;
};

export type FeedbackOutcome = {
  id: string;
  status: "ok" | "failed";
  error: string | null;
  items: ItemOutcome[];
  /** One French sentence for the chat (« confirme un sujet connu : I-03 … »). */
  summary: string;
};

export type IncrementalResult = {
  runId: string;
  feedbacks: FeedbackOutcome[];
  proposedInsights: { id: string; title: string; item_ids: string[] }[];
  rescored: string[];
  alerts: AlertSummary;
  failures: { step: string; id: string | null; error: string }[];
  /** Milliseconds per step. */
  timings: Record<string, number>;
  costEur: number;
  durationMs: number;
  langfuseUrl: string | null;
};

export type IncrementalContext = {
  pack: Pick<ContextPack, "weighting" | "documents" | "commitments">;
  skills: { triage: string; riceScoring: string; moscow: string };
  now: Date;
  /** Injected in tests: no model, Voyage or Langfuse call there (CLAUDE.md rule 11). */
  invoke?: typeof invokeStructured;
  embedFn?: (texts: string[]) => Promise<number[][]>;
  estimate?: Omit<EstimateRunDeps, "runCost">;
  sleep?: (ms: number) => Promise<void>;
  /** Called when a step starts (the chat's live trace shows it during add_feedback). */
  onStep?: (step: string) => void;
};

export function describeFeedback(outcome: Omit<FeedbackOutcome, "summary">): string {
  if (outcome.status === "failed") return `${outcome.id} : triage en échec, à relancer.`;
  const parts = outcome.items.map((item) => {
    switch (item.outcome) {
      case "rattache":
        return `confirme un sujet connu : ${item.insight_id} « ${item.insight_title} »`;
      case "nouvel_insight":
        return `forme un nouveau sujet à valider : ${item.insight_id} « ${item.insight_title} »`;
      case "surveille":
        return "rejoint la file « à surveiller »";
      default:
        return `non regroupé (${item.type})`;
    }
  });
  return `${outcome.id} : ${parts.join(" ; ") || "aucun item"}.`;
}

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Incrémental : ${what} en échec (${error.message})`);
};

export async function currentReachMode(db: Db, fallback: ReachMode): Promise<ReachMode> {
  const { data, error } = await db
    .from("scores")
    .select("reach_mode, created_at")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);
  check(error, "lecture du mode de Reach");
  return data?.[0]?.reach_mode ?? fallback;
}

export async function runIncremental(
  db: Db,
  feedbackIds: readonly string[],
  ctx: IncrementalContext,
  options: { runId?: string } = {},
): Promise<IncrementalResult> {
  if (feedbackIds.length === 0 || feedbackIds.length > MAX_INCREMENTAL_FEEDBACKS) {
    throw new Error(`Incrémental : 1 à ${MAX_INCREMENTAL_FEEDBACKS} retours attendus`);
  }
  const started = Date.now();
  const { data: run, error: runError } = await db
    .from("pipeline_runs")
    .insert({
      ...(options.runId ? { id: options.runId } : {}),
      kind: "incremental",
      status: "en_cours",
    })
    .select("id")
    .single();
  check(runError, "création du run");
  const runId = run!.id;
  const runCost = new RunCost();
  let traceId: string | undefined;

  try {
    const result = await withTrace(
      "run-incremental",
      { runId, step: "incremental", tags: ["pipeline", "incremental"] },
      { feedbacks: feedbackIds },
      async () => {
        traceId = currentTraceId();
        return incrementalSteps(db, runId, feedbackIds, ctx, runCost);
      },
      (r) => ({ proposed: r.proposedInsights, rescored: r.rescored, alerts: r.alerts }),
    );
    const durationMs = Date.now() - started;
    const langfuseUrl = await traceUrl(traceId);
    check(
      (
        await db
          .from("pipeline_runs")
          .update({
            status: "termine",
            ended_at: new Date().toISOString(),
            stats: {
              mode: "incremental",
              feedbacks: result.feedbacks.map((f) => ({
                id: f.id,
                status: f.status,
                items: f.items.map((i) => [i.id, i.outcome, i.insight_id]),
              })),
              proposed: result.proposedInsights.map((i) => i.id),
              rescored: result.rescored,
              alerts: result.alerts,
              failures: result.failures,
              timings_ms: result.timings,
              duration_ms: durationMs,
            } as unknown as Json,
            tokens_in: runCost.tokensIn,
            tokens_out: runCost.tokensOut,
            cost_eur: Number(runCost.eur.toFixed(4)),
            langfuse_url: langfuseUrl,
          })
          .eq("id", runId)
      ).error,
      "clôture du run",
    );
    return { ...result, costEur: runCost.eur, durationMs, langfuseUrl };
  } catch (error) {
    await db
      .from("pipeline_runs")
      .update({
        status: "echec",
        ended_at: new Date().toISOString(),
        stats: {
          mode: "incremental",
          error: error instanceof Error ? error.message : String(error),
        },
        cost_eur: Number(runCost.eur.toFixed(4)),
      })
      .eq("id", runId);
    throw error;
  }
}

async function incrementalSteps(
  db: Db,
  runId: string,
  feedbackIds: readonly string[],
  ctx: IncrementalContext,
  runCost: RunCost,
): Promise<Omit<IncrementalResult, "costEur" | "durationMs" | "langfuseUrl">> {
  const { pack, now } = ctx;
  const { weighting } = pack;
  const threshold = weighting.clustering.distance_threshold;
  const failures: IncrementalResult["failures"] = [];
  // Duration of each step (SPEC §15: adding a feedback takes < 15 s), stored in the run's stats.
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    ctx.onStep?.(name);
    try {
      return await withSpan(`pipeline-${name}`, input, fn);
    } finally {
      timings[name] = Date.now() - t0;
    }
  };
  const emergingBefore = await emergingInsights(db);

  // 1. Triage, enrich, embed (same nodes as the full run).
  const triageResults = await step("triage", { feedbackIds }, async () => {
    const feedbacks = await loadFeedbacksToTriage(db, { retryFailed: true, ids: feedbackIds });
    check(
      (
        await db
          .from("feedbacks")
          .update({ ingested_run_id: runId })
          .in("id", [...feedbackIds])
      ).error,
      "marquage des retours",
    );
    return runTriage(db, {
      runId,
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
    });
  });
  const failedTriage = new Map(triageResults.failures.map((f) => [f.feedbackId, f.error]));
  for (const f of triageResults.failures)
    failures.push({ step: "triage", id: f.feedbackId, error: f.error });
  const okIds = feedbackIds.filter((id) => !failedTriage.has(id));

  await step("enrich", { feedbackIds }, () =>
    runEnrich(db, { weighting, now, feedbackIds: [...feedbackIds] }),
  );
  await step("embed", {}, () => runEmbed(db, { runCost, embedFn: ctx.embedFn }));

  // 2. Attachment or watch queue.
  const state = await step("load", {}, () =>
    loadClusteringState(db, { weighting, now, commitments: pack.commitments }),
  );
  const vectors = new Map(state.items.map((i) => [i.id, i.vector]));
  const okSet = new Set(okIds);
  const newItems = state.items.filter((i) => okSet.has(i.feedback_id));
  const inInsight = new Map<string, string>();
  for (const p of state.previous) for (const id of p.itemIds) inInsight.set(id, p.id);

  const toPlace = newItems.filter((i) => isClusterable(i) && !inInsight.has(i.id));
  const { attached, watch } = await step("match", { items: toPlace.length }, async () =>
    attachItems(toPlace, state.previous, vectors, threshold),
  );
  const touched = new Set<string>(attached.map((a) => a.insightId));
  if (attached.length) {
    const rows = attached.map((a) => ({
      insight_id: a.insightId,
      item_id: a.itemId,
      feedback_id: state.items.find((i) => i.id === a.itemId)!.feedback_id,
      similarity: a.similarity,
      is_representative: false,
    }));
    check((await db.from("insight_items").insert(rows)).error, "rattachement des items");
  }
  if (watch.length) {
    check(
      (await db.from("feedback_items").update({ watch: true }).in("id", watch)).error,
      "mise en file à surveiller",
    );
  }

  // 3. Watch queue → proposed insights (3 close items at least).
  const proposed: IncrementalResult["proposedInsights"] = [];
  const { data: watchedRows, error: watchError } = await db
    .from("feedback_items")
    .select("id")
    .eq("watch", true);
  check(watchError, "lecture de la file à surveiller");
  const byId = new Map<string, ClusteringItem>(state.items.map((i) => [i.id, i]));
  const watched = (watchedRows ?? [])
    .map((r) => byId.get(r.id))
    .filter((i): i is ClusteringItem => i !== undefined && !inInsight.has(i.id));
  const groups = watchGroups(watched, threshold, weighting.clustering.watch_queue_min_items);
  await step("label", { groups: groups.length }, async () => {
    for (const group of groups) {
      const items = group.map((id) => byId.get(id)!);
      const { representative, similarity } = representatives(group, vectors);
      const label = await labelInsight(
        "N-watch",
        items,
        representative,
        { skill: ctx.skills.triage },
        {
          runId,
          runCost,
          invoke: ctx.invoke,
          sleep: ctx.sleep,
        },
      );
      if (!label.ok) {
        // The items stay in the queue: the next run tries again (CL-11).
        failures.push({ step: "label", id: null, error: label.error });
        continue;
      }
      const { data, error } = await db
        .from("insights")
        .insert({
          origin: "retours",
          title: label.value.title,
          problem_statement: label.value.problem_statement,
          product_area: label.value.product_area,
          expressed_requests: label.value.expressed_requests as unknown as Json,
          status: "propose",
          first_run_id: runId,
          last_run_id: runId,
        })
        .select("id")
        .single();
      check(error, "création d'un insight proposé");
      const id = data!.id;
      check(
        (
          await db.from("insight_items").insert(
            group.map((itemId) => ({
              insight_id: id,
              item_id: itemId,
              feedback_id: byId.get(itemId)!.feedback_id,
              similarity: similarity.get(itemId) ?? null,
              is_representative: representative.includes(itemId),
            })),
          )
        ).error,
        `écriture des items de ${id}`,
      );
      check(
        (await db.from("feedback_items").update({ watch: false }).in("id", group)).error,
        "sortie de la file à surveiller",
      );
      for (const itemId of group) inInsight.set(itemId, id);
      proposed.push({ id, title: label.value.title, item_ids: group });
      touched.add(id);
    }
  });

  // 4. Aggregates of the touched insights, in code.
  const { data: touchedRows, error: touchedError } = touched.size
    ? await db
        .from("insights")
        .select("id, title, status, origin, product_area")
        .in("id", [...touched])
    : { data: [], error: null };
  check(touchedError, "lecture des insights touchés");
  const { data: links, error: linksError } = touched.size
    ? await db
        .from("insight_items")
        .select("insight_id, feedback_id")
        .in("insight_id", [...touched])
    : { data: [], error: null };
  check(linksError, "lecture des items des insights touchés");
  const title = new Map((touchedRows ?? []).map((r) => [r.id, r.title]));
  const rankedTouched: string[] = [];
  for (const insight of touchedRows ?? []) {
    const feedbacks = [
      ...new Set(
        (links ?? []).filter((l) => l.insight_id === insight.id).map((l) => l.feedback_id),
      ),
    ]
      .map((id) => state.feedbacks.get(id))
      .filter((f): f is InsightFeedback => f !== undefined);
    const a = computeAggregates(
      {
        status: insight.status,
        origin: insight.origin,
        productArea: insight.product_area,
        feedbacks,
      },
      { weighting, now, commitments: state.commitments },
    );
    if (a.ranked) rankedTouched.push(insight.id);
    check(
      (
        await db
          .from("insights")
          .update({
            ranked: a.ranked,
            accounts_count: a.accounts_count,
            mrr_exposed: a.mrr_exposed,
            renewals_90d: a.renewals_90d,
            segments_breakdown: a.segments_breakdown as unknown as Json,
            channels: a.channels as Json,
            trend: a.trend as unknown as Json,
            last_run_id: runId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", insight.id)
      ).error,
      `mise à jour de ${insight.id}`,
    );
  }

  // 5. Re-score: only the touched ranked insights are judged again; ranks are recomputed for all.
  let rescored: string[] = [];
  if (rankedTouched.length) {
    const summary = await step("score", { insights: rankedTouched }, async () =>
      runScoring(db, {
        mode: await currentReachMode(db, weighting.reach.default_mode),
        weighting,
        now,
        commitments: pack.commitments,
        context: {
          weighting,
          skills: { riceScoring: ctx.skills.riceScoring, moscow: ctx.skills.moscow },
          documents: { strategy: pack.documents.strategy, commitments: pack.documents.commitments },
          okrIds: parseOkrIds(pack.documents.strategy),
        },
        // The model's judgment of a known insight is reused: one more feedback changes its facts,
        // recomputed here in code (Reach, Confidence, MoSCoW rules, rank), not the judgment; the
        // nightly full run judges again. Only an insight without a valid judgment is judged
        // (SPEC §15: adding a feedback takes < 15 s).
        rejudge: new Set(),
        writeOnlyChanged: true,
        touched: new Set(rankedTouched),
        deps: { runCost, invoke: ctx.invoke, ...ctx.estimate },
      }),
    );
    rescored = summary.written;
    for (const f of summary.failures)
      failures.push({ step: f.step, id: f.insight, error: f.error });
  }

  // 6. Alerts.
  const alerts = await step("alert", {}, async () =>
    runAlerts(
      db,
      await loadAlertInput(db, {
        newFeedbackIds: okIds,
        createdInsights: proposed.map((p) => p.id),
        emergingBefore,
        weighting,
        now,
        commitments: pack.commitments,
      }),
      weighting.alerts,
    ),
  );

  // 7. What happened to each feedback.
  const attachedBy = new Map(attached.map((a) => [a.itemId, a]));
  const proposedBy = new Map(proposed.flatMap((p) => p.item_ids.map((id) => [id, p] as const)));
  const outcomes: FeedbackOutcome[] = feedbackIds.map((id) => {
    const error = failedTriage.get(id) ?? null;
    const items: ItemOutcome[] = error
      ? []
      : newItems
          .filter((i) => i.feedback_id === id)
          .map((item): ItemOutcome => {
            const a = attachedBy.get(item.id);
            const p = proposedBy.get(item.id);
            const known = inInsight.get(item.id);
            if (p) {
              return {
                id: item.id,
                type: item.type,
                outcome: "nouvel_insight",
                insight_id: p.id,
                insight_title: p.title,
                similarity: null,
              };
            }
            if (a || known) {
              const insightId = a?.insightId ?? known!;
              return {
                id: item.id,
                type: item.type,
                outcome: "rattache",
                insight_id: insightId,
                insight_title:
                  title.get(insightId) ??
                  state.previous.find((x) => x.id === insightId)?.title ??
                  null,
                similarity: a ? Math.round(a.similarity * 1000) / 1000 : null,
              };
            }
            return {
              id: item.id,
              type: item.type,
              outcome: isClusterable(item) ? "surveille" : "non_regroupe",
              insight_id: null,
              insight_title: null,
              similarity: null,
            };
          });
    const outcome = { id, status: error ? ("failed" as const) : ("ok" as const), error, items };
    return { ...outcome, summary: describeFeedback(outcome) };
  });

  return {
    runId,
    feedbacks: outcomes,
    proposedInsights: proposed,
    rescored,
    alerts,
    failures,
    timings,
  };
}
