// Clustering run (PLAN 2.3): cluster → match → label → aggregates → tensions → write.
// Every model call happens before the first write; the write phase only applies the plan.
// Graph wiring (LangGraph) comes in 2.6; this module is what the nodes `cluster`, `match` and
// `label` of SPEC §6.1 do, in order.
import { mapWithConcurrency } from "@/lib/async";
import { agglomerativeCluster, type Vector } from "@/lib/clustering/agglomerative";
import type { Commitment, Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import type { Json, Tables } from "@/lib/db/types";
import {
  computeAggregates,
  type CommitmentCoverage,
  type InsightAggregates,
  type InsightFeedback,
} from "@/lib/insights/aggregates";
import type { Usage } from "@/lib/llm/cost";
import { isClusterable, parseVector } from "@/pipeline/nodes/embed";
import { computeSignals, normalizeName, type CustomerForLinking } from "@/pipeline/nodes/enrich";
import {
  detectTensions,
  labelInsight,
  proposeMerges,
  representatives,
  sumUsage,
  type ExpressedRequest,
  type InsightLabel,
  type InsightSummary,
  type LabelContext,
  type LabelDeps,
  type LabelItem,
  type Tension,
} from "@/pipeline/nodes/label-insights";
import {
  applyMerges,
  matchClusters,
  type AppliedMerge,
  type CurrentCluster,
  type MatchedBy,
  type MatchEvent,
  type PlannedInsight,
  type PreviousInsight,
} from "@/pipeline/nodes/match";

const LABEL_CONCURRENCY = 4;
const PAGE = 1000;

export type ClusteringItem = LabelItem & { vector: Vector };

type ExistingInsight = PreviousInsight &
  Pick<Tables<"insights">, "title" | "problem_statement" | "product_area" | "expressed_requests">;

type ExistingRelation = Pick<
  Tables<"insight_relations">,
  "insight_a" | "insight_b" | "segments" | "rationale"
>;

export type ClusteringState = {
  items: ClusteringItem[];
  feedbacks: Map<string, InsightFeedback>;
  previous: ExistingInsight[];
  relations: ExistingRelation[];
  commitments: CommitmentCoverage[];
  /** Commitments of commitments.md whose account is not a known customer. */
  unknownCommitmentAccounts: string[];
};

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Regroupement : ${what} en échec (${error.message})`);
}

async function fetchAll<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    check(error, what);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** A commitment covers the insights of its areas that contain a feedback of its account. */
export function resolveCommitments(
  commitments: readonly Commitment[],
  customers: readonly Pick<CustomerForLinking, "id" | "name">[],
): { coverage: CommitmentCoverage[]; unknown: string[] } {
  const byName = new Map(customers.map((c) => [normalizeName(c.name), c.id]));
  const coverage: CommitmentCoverage[] = [];
  const unknown: string[] = [];
  for (const c of commitments) {
    const id = byName.get(normalizeName(c.account));
    if (id) coverage.push({ customerId: id, productAreas: c.product_areas });
    else unknown.push(c.account);
  }
  return { coverage, unknown };
}

export async function loadClusteringState(
  db: Db,
  context: { weighting: Weighting; now: Date; commitments: readonly Commitment[] },
): Promise<ClusteringState> {
  const [items, feedbacks, customers, analyses, insights, insightItems, relations] =
    await Promise.all([
      fetchAll(
        (from, to) =>
          db
            .from("feedback_items")
            .select(
              "id, feedback_id, type, product_area, underlying_problem, summary, expressed_request, embedding",
            )
            .not("embedding", "is", null)
            .order("id")
            .range(from, to),
        "lecture des items",
      ),
      fetchAll(
        (from, to) =>
          db
            .from("feedbacks")
            .select(
              "id, channel, source_type, author_name, author_email, customer_id, subject, raw_text, received_at",
            )
            .order("id")
            .range(from, to),
        "lecture des retours",
      ),
      fetchAll(
        (from, to) =>
          db
            .from("customers")
            .select("id, name, status, segment, plan, mrr_eur, renewal_date, email_domain")
            .order("id")
            .range(from, to),
        "lecture des comptes",
      ),
      fetchAll(
        (from, to) =>
          db
            .from("feedback_analyses")
            .select("feedback_id, churn_signal, created_at")
            .eq("status", "ok")
            .order("created_at")
            .range(from, to),
        "lecture des analyses",
      ),
      fetchAll(
        (from, to) =>
          db
            .from("insights")
            .select(
              "id, status, merged_into, title_locked, title, problem_statement, product_area, expressed_requests",
            )
            .eq("origin", "retours")
            .order("id")
            .range(from, to),
        "lecture des insights",
      ),
      fetchAll(
        (from, to) =>
          db.from("insight_items").select("insight_id, item_id").order("item_id").range(from, to),
        "lecture des items d'insights",
      ),
      fetchAll(
        (from, to) =>
          db
            .from("insight_relations")
            .select("insight_a, insight_b, segments, rationale")
            .eq("kind", "tension")
            .order("insight_a")
            .range(from, to),
        "lecture des tensions",
      ),
    ]);

  const churn = new Map<string, boolean | null>();
  for (const a of analyses) churn.set(a.feedback_id, a.churn_signal); // latest wins (ordered)

  const feedbackMap = new Map<string, InsightFeedback>();
  for (const f of feedbacks) {
    feedbackMap.set(f.id, {
      id: f.id,
      channel: f.channel,
      received_at: f.received_at,
      churn_signal: churn.get(f.id) ?? null,
      signals: computeSignals(f, customers, context.weighting, context.now),
    });
  }

  const itemsOf = new Map<string, string[]>();
  for (const row of insightItems) {
    itemsOf.set(row.insight_id, [...(itemsOf.get(row.insight_id) ?? []), row.item_id]);
  }
  const { coverage, unknown } = resolveCommitments(context.commitments, customers);

  return {
    items: items.map(({ embedding, ...item }) => ({ ...item, vector: parseVector(embedding)! })),
    feedbacks: feedbackMap,
    previous: insights.map((i) => ({
      id: i.id,
      status: i.status,
      mergedInto: i.merged_into,
      titleLocked: i.title_locked,
      itemIds: (itemsOf.get(i.id) ?? []).sort(),
      title: i.title,
      problem_statement: i.problem_statement,
      product_area: i.product_area,
      expressed_requests: i.expressed_requests,
    })),
    relations,
    commitments: coverage,
    unknownCommitmentAccounts: unknown,
  };
}

/** Clusters the items that carry a problem (praise, questions and « autre » are left out, CL-04). */
export function clusterItems(
  items: readonly ClusteringItem[],
  options: { distanceThreshold: number; minClusterSize: number },
): { clusters: CurrentCluster[]; unclustered: string[]; eligible: number } {
  const eligible = items.filter(isClusterable);
  const result = agglomerativeCluster(
    eligible.map((i) => i.vector),
    options,
  );
  return {
    clusters: result.clusters.map((c) => ({ itemIds: c.map((k) => eligible[k].id).sort() })),
    unclustered: result.unclustered.map((k) => eligible[k].id),
    eligible: eligible.length,
  };
}

export type InsightOutcome = {
  id: string;
  isNew: boolean;
  status: PlannedInsight["status"];
  mergedInto: string | null;
  title: string;
  productArea: string | null;
  itemIds: string[];
  matchedBy: MatchedBy | null;
  relabelled: boolean;
  aggregates: InsightAggregates | null;
  expressedRequests: ExpressedRequest[];
};

export type ClusteringSummary = {
  runId: string;
  threshold: number;
  eligibleItems: number;
  clusters: number;
  unclustered: string[];
  insights: InsightOutcome[];
  events: MatchEvent[];
  merges: { from: string; into: string; reason: string }[];
  tensions: { a: string; b: string; rationale: string; segments: Json; kept: boolean }[];
  failures: {
    insight: string | null;
    pass: "label" | "consolidation" | "tensions";
    error: string;
  }[];
  labelCalls: number;
  usage: Usage;
  unknownCommitmentAccounts: string[];
};

export type RunClusteringOptions = {
  runId: string;
  weighting: Weighting;
  now: Date;
  commitments: readonly Commitment[];
  label: LabelContext;
  threshold?: number;
  deps?: Omit<LabelDeps, "runId">;
};

const isLive = (i: PlannedInsight) => i.status === "propose" || i.status === "actif";

export async function runClustering(
  db: Db,
  options: RunClusteringOptions,
): Promise<ClusteringSummary> {
  const { weighting, now, runId } = options;
  const deps: LabelDeps = { ...options.deps, runId };
  const threshold = options.threshold ?? weighting.clustering.distance_threshold;
  const state = await loadClusteringState(db, options);
  const itemById = new Map(state.items.map((i) => [i.id, i]));
  const vectors = new Map(state.items.map((i) => [i.id, i.vector]));
  const previousById = new Map(state.previous.map((p) => [p.id, p]));

  // 1. Cluster and match.
  const clustered = clusterItems(state.items, {
    distanceThreshold: threshold,
    minClusterSize: weighting.clustering.min_cluster_size,
  });
  const match = matchClusters(state.previous, clustered.clusters, {
    jaccard: weighting.clustering.run_matching_jaccard,
    centroidSimilarity: weighting.clustering.run_matching_centroid_similarity,
    vectors,
  });
  let plan = match.insights;

  // 2. Label new and changed insights (never the wording of a title_locked one).
  const labels = new Map<string, InsightLabel>();
  const failures: ClusteringSummary["failures"] = [];
  const usages: Usage[] = [];
  let labelCalls = 0;
  const label = async (insights: PlannedInsight[]) => {
    const results = await mapWithConcurrency(insights, LABEL_CONCURRENCY, async (insight) => {
      const items = insight.itemIds.map((id) => itemById.get(id)!).filter(Boolean);
      const { representative } = representatives(insight.itemIds, vectors);
      labelCalls++;
      return {
        insight,
        result: await labelInsight(insight.key, items, representative, options.label, deps),
      };
    });
    for (const { insight, result } of results) {
      usages.push(result.usage);
      if (result.ok) {
        labels.set(insight.key, result.value);
        insight.needsLabel = false;
      } else {
        failures.push({ insight: insight.key, pass: "label", error: result.error });
      }
    }
  };
  await label(plan.filter((i) => i.needsLabel));
  // A new insight without a label is not created: its items wait for the next run (CL-11).
  plan = plan.filter((i) => !(i.isNew && !labels.has(i.key)));
  for (const insight of plan) insight.needsLabel = false;

  const wording = (insight: PlannedInsight) => {
    const fresh = labels.get(insight.key);
    const prev = previousById.get(insight.key);
    return {
      title: insight.titleLocked && prev ? prev.title : (fresh?.title ?? prev?.title ?? ""),
      problem_statement:
        insight.titleLocked && prev
          ? prev.problem_statement
          : (fresh?.problem_statement ?? prev?.problem_statement ?? ""),
      product_area: fresh?.product_area ?? prev?.product_area ?? null,
      expressed_requests:
        fresh?.expressed_requests ?? ((prev?.expressed_requests ?? []) as ExpressedRequest[]),
    };
  };
  const summaryOf = (insight: PlannedInsight, aggregates?: InsightAggregates): InsightSummary => {
    const w = wording(insight);
    return {
      key: insight.key,
      isNew: insight.isNew,
      product_area: w.product_area ?? "autre",
      title: w.title,
      problem_statement: w.problem_statement,
      items: insight.itemIds.length,
      plans: aggregates?.segments_breakdown.plans,
      requests: w.expressed_requests,
    };
  };

  // 3. Consolidation: merges proposed by the model, applied in code; survivors are relabelled.
  let merges: AppliedMerge[] = [];
  const consolidation = await proposeMerges(
    plan.filter(isLive).map((i) => summaryOf(i)),
    options.label,
    deps,
  );
  usages.push(consolidation.usage);
  if (consolidation.ok) {
    merges = applyMerges(plan, consolidation.value);
    await label(plan.filter((i) => i.needsLabel));
  } else {
    failures.push({ insight: null, pass: "consolidation", error: consolidation.error });
  }

  // 4. Aggregates, computed in code for every insight that holds items.
  const aggregatesOf = new Map<string, InsightAggregates>();
  for (const insight of plan) {
    if (insight.status === "fusionne" || insight.itemIds.length === 0) continue;
    const feedbackIds = [...new Set(insight.itemIds.map((id) => itemById.get(id)?.feedback_id))];
    aggregatesOf.set(
      insight.key,
      computeAggregates(
        {
          status: insight.status,
          origin: "retours",
          productArea: wording(insight).product_area,
          feedbacks: feedbackIds
            .map((id) => (id ? state.feedbacks.get(id) : undefined))
            .filter((f): f is InsightFeedback => f !== undefined),
        },
        { weighting, now, commitments: state.commitments },
      ),
    );
  }

  // 5. Tensions: re-detected only when an insight was created or relabelled; relations between
  // unchanged insights are kept as they are (stable from one run to the next).
  const live = plan.filter(isLive);
  const liveKeys = new Set(live.map((i) => i.key));
  const changed = new Set(live.filter((i) => i.isNew || labels.has(i.key)).map((i) => i.key));
  const tensions: ClusteringSummary["tensions"] = state.relations
    .filter(
      (r) =>
        liveKeys.has(r.insight_a) &&
        liveKeys.has(r.insight_b) &&
        !changed.has(r.insight_a) &&
        !changed.has(r.insight_b),
    )
    .map((r) => ({
      a: r.insight_a,
      b: r.insight_b,
      rationale: r.rationale ?? "",
      segments: r.segments,
      kept: true,
    }));
  if (changed.size > 0) {
    const detected = await detectTensions(
      live.map((i) => summaryOf(i, aggregatesOf.get(i.key))),
      options.label,
      deps,
    );
    usages.push(detected.usage);
    if (detected.ok) {
      const keep = new Set(tensions.map((t) => [t.a, t.b].sort().join("|")));
      for (const t of detected.value as Tension[]) {
        if (!changed.has(t.a) && !changed.has(t.b)) continue;
        if (keep.has([t.a, t.b].sort().join("|"))) continue;
        tensions.push({
          a: t.a,
          b: t.b,
          rationale: t.rationale,
          segments: t.segments,
          kept: false,
        });
      }
    } else {
      failures.push({ insight: null, pass: "tensions", error: detected.error });
      // Without a fresh detection, the previous tensions of the changed insights stay.
      for (const r of state.relations) {
        if (!liveKeys.has(r.insight_a) || !liveKeys.has(r.insight_b)) continue;
        if (!changed.has(r.insight_a) && !changed.has(r.insight_b)) continue;
        tensions.push({
          a: r.insight_a,
          b: r.insight_b,
          rationale: r.rationale ?? "",
          segments: r.segments,
          kept: true,
        });
      }
    }
  }

  // 6. Write.
  const idOf = await writeClustering(db, {
    runId,
    plan,
    labels,
    wording,
    aggregatesOf,
    vectors,
    itemById,
    tensions,
  });
  const resolve = (key: string) => idOf.get(key) ?? key;

  const outcomes: InsightOutcome[] = plan.map((insight) => ({
    id: resolve(insight.key),
    isNew: insight.isNew,
    status: insight.status,
    mergedInto: insight.mergedInto ? resolve(insight.mergedInto) : null,
    title: wording(insight).title,
    productArea: wording(insight).product_area,
    itemIds: insight.itemIds,
    matchedBy: match.matchedBy[insight.key] ?? null,
    relabelled: labels.has(insight.key) && !insight.isNew,
    aggregates: aggregatesOf.get(insight.key) ?? null,
    expressedRequests: wording(insight).expressed_requests,
  }));

  const resolveEvent = (e: MatchEvent): MatchEvent =>
    e.kind === "dissous" || e.kind === "reforme"
      ? { ...e, id: resolve(e.id) }
      : { ...e, from: resolve(e.from), into: resolve(e.into) };

  return {
    runId,
    threshold,
    eligibleItems: clustered.eligible,
    clusters: clustered.clusters.length,
    unclustered: clustered.unclustered,
    insights: outcomes,
    events: match.events.map(resolveEvent),
    merges: merges.map((m) => ({ ...m, from: resolve(m.from), into: resolve(m.into) })),
    tensions: tensions.map((t) => ({ ...t, a: resolve(t.a), b: resolve(t.b) })),
    failures: failures.map((f) => ({ ...f, insight: f.insight ? resolve(f.insight) : null })),
    labelCalls,
    usage: sumUsage(usages),
    unknownCommitmentAccounts: state.unknownCommitmentAccounts,
  };
}

type WriteInput = {
  runId: string;
  plan: PlannedInsight[];
  labels: Map<string, InsightLabel>;
  wording: (insight: PlannedInsight) => {
    title: string;
    problem_statement: string;
    product_area: Tables<"insights">["product_area"];
    expressed_requests: ExpressedRequest[];
  };
  aggregatesOf: Map<string, InsightAggregates>;
  vectors: ReadonlyMap<string, Vector>;
  itemById: ReadonlyMap<string, ClusteringItem>;
  tensions: ClusteringSummary["tensions"];
};

/**
 * Applies the plan. New insights are inserted first, by decreasing size (« N1 » gets the lowest
 * id), then every insight of the plan is updated, its items replaced, and the tensions synced.
 */
async function writeClustering(db: Db, input: WriteInput): Promise<Map<string, string>> {
  const { runId, plan, labels, wording, aggregatesOf } = input;
  const idOf = new Map<string, string>();
  const now = new Date().toISOString();

  const fresh = plan
    .filter((i) => i.isNew)
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
  for (const insight of fresh) {
    const w = wording(insight);
    const { data, error } = await db
      .from("insights")
      .insert({
        origin: "retours",
        title: w.title,
        problem_statement: w.problem_statement,
        product_area: w.product_area,
        status: "propose",
        first_run_id: runId,
        last_run_id: runId,
      })
      .select("id")
      .single();
    check(error, `création de l'insight ${insight.key}`);
    idOf.set(insight.key, data!.id);
  }
  const resolve = (key: string) => idOf.get(key) ?? key;

  for (const insight of plan) {
    const id = resolve(insight.key);
    const w = wording(insight);
    const aggregates = aggregatesOf.get(insight.key);
    const update: Partial<Tables<"insights">> = {
      status: insight.status,
      merged_into: insight.mergedInto ? resolve(insight.mergedInto) : null,
      last_run_id: runId,
      updated_at: now,
      ranked: aggregates?.ranked ?? false,
    };
    if (labels.has(insight.key)) {
      if (!insight.titleLocked) {
        update.title = w.title;
        update.problem_statement = w.problem_statement;
      }
      update.product_area = w.product_area;
      update.expressed_requests = w.expressed_requests as unknown as Json;
    }
    if (aggregates) {
      update.accounts_count = aggregates.accounts_count;
      update.mrr_exposed = aggregates.mrr_exposed;
      update.renewals_90d = aggregates.renewals_90d;
      update.segments_breakdown = aggregates.segments_breakdown as unknown as Json;
      update.channels = aggregates.channels as Json;
      update.trend = aggregates.trend as unknown as Json;
    }
    check((await db.from("insights").update(update).eq("id", id)).error, `mise à jour de ${id}`);

    // Live insights get their similarity and representatives; a merged or dissolved-rejected
    // insight keeps its items frozen (the memory that lets the next run replay it).
    const frozen = insight.status === "fusionne" || insight.status === "rejete";
    const { similarity, representative } = frozen
      ? { similarity: new Map<string, number>(), representative: [] as string[] }
      : representatives(insight.itemIds, input.vectors);
    const rows = insight.itemIds
      .filter((itemId) => input.itemById.has(itemId))
      .map((itemId) => ({
        insight_id: id,
        item_id: itemId,
        feedback_id: input.itemById.get(itemId)!.feedback_id,
        similarity: similarity.get(itemId) ?? null,
        is_representative: representative.includes(itemId),
      }));
    check(
      (await db.from("insight_items").delete().eq("insight_id", id)).error,
      `nettoyage des items de ${id}`,
    );
    if (rows.length) {
      check((await db.from("insight_items").insert(rows)).error, `écriture des items de ${id}`);
    }
  }

  // Tensions: the final set replaces the previous one.
  const wanted = input.tensions.map((t) => {
    const [a, b] = [resolve(t.a), resolve(t.b)].sort();
    return {
      insight_a: a,
      insight_b: b,
      kind: "tension" as const,
      segments: t.segments,
      rationale: t.rationale,
      run_id: runId,
    };
  });
  const { data: existing, error } = await db
    .from("insight_relations")
    .select("id, insight_a, insight_b")
    .eq("kind", "tension");
  check(error, "lecture des tensions");
  const wantedKeys = new Set(wanted.map((w) => `${w.insight_a}|${w.insight_b}`));
  const stale = (existing ?? []).filter((r) => !wantedKeys.has(`${r.insight_a}|${r.insight_b}`));
  if (stale.length) {
    check(
      (
        await db
          .from("insight_relations")
          .delete()
          .in(
            "id",
            stale.map((r) => r.id),
          )
      ).error,
      "suppression des tensions périmées",
    );
  }
  const existingKeys = new Set((existing ?? []).map((r) => `${r.insight_a}|${r.insight_b}`));
  const toInsert = wanted.filter((w) => !existingKeys.has(`${w.insight_a}|${w.insight_b}`));
  if (toInsert.length) {
    check((await db.from("insight_relations").insert(toInsert)).error, "écriture des tensions");
  }
  return idOf;
}
