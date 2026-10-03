import "server-only";
import type { Db } from "@/lib/db/client";
import type { Weighting } from "@/lib/context";
import type { Database, Tables } from "@/lib/db/types";
import type { SegmentsBreakdown, Trend } from "@/lib/insights/aggregates";
import type { InsightCard } from "@/lib/insights/list";
import { fetchAll } from "@/pipeline/insights";
import { computeSignals, type CustomerForLinking } from "@/pipeline/nodes/enrich";
import type { ExpressedRequest } from "@/pipeline/nodes/label-insights";

// Reads of the Insights screen (SPEC §12.4).

type Enums = Database["public"]["Enums"];

const LIVE = new Set<Enums["insight_status"]>(["propose", "actif"]);

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} (${error.message})`);
};

const asTrend = (value: unknown): Partial<Trend> =>
  value && typeof value === "object" ? (value as Partial<Trend>) : {};

const asBreakdown = (value: unknown): SegmentsBreakdown => {
  const v = (value && typeof value === "object" ? value : {}) as Partial<SegmentsBreakdown>;
  return { plans: v.plans ?? {}, segments: v.segments ?? {} };
};

/** The PO's MoSCoW: the active `moscow` override (SPEC §7 overrides). */
const moscowValue = (value: unknown): Enums["moscow"] | null =>
  typeof value === "string" && ["must", "should", "could", "wont"].includes(value)
    ? (value as Enums["moscow"])
    : null;

export type WatchItem = Pick<
  Tables<"feedback_items">,
  "id" | "feedback_id" | "type" | "product_area" | "summary" | "underlying_problem"
> & { received_at: string | null };

export type InsightsScreen = { cards: InsightCard[]; watch: WatchItem[] };

/** Every insight as a card (merged and archived ones included, the sections sort them out). */
export async function getInsightsScreen(db: Db): Promise<InsightsScreen> {
  const [insights, links, scores, overrides, watched] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("insights")
          .select(
            "id, title, problem_statement, product_area, origin, status, ranked, merged_into, accounts_count, mrr_exposed, renewals_90d, segments_breakdown, trend",
          )
          .order("id")
          .range(from, to),
      "Lecture des insights",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("insight_items")
          .select("insight_id, item_id, feedback_id")
          .order("item_id")
          .range(from, to),
      "Lecture des items d'insights",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("scores")
          .select("insight_id, rank, moscow_reco, alignment")
          .eq("is_current", true)
          .order("insight_id")
          .range(from, to),
      "Lecture des scores",
    ),
    db.from("overrides").select("insight_id, value").eq("param", "moscow").eq("active", true),
    db
      .from("feedback_items")
      .select(
        "id, feedback_id, type, product_area, summary, underlying_problem, feedbacks(received_at)",
      )
      .eq("watch", true)
      .order("id"),
  ]);
  fail("Lecture des MoSCoW du PO", overrides.error);
  fail("Lecture de la file à surveiller", watched.error);

  const status = new Map(insights.map((i) => [i.id, i.status]));
  const feedbacksOf = new Map<string, Set<string>>();
  const inLiveInsight = new Set<string>();
  for (const l of links) {
    const set = feedbacksOf.get(l.insight_id) ?? new Set<string>();
    set.add(l.feedback_id);
    feedbacksOf.set(l.insight_id, set);
    if (LIVE.has(status.get(l.insight_id)!)) inLiveInsight.add(l.item_id);
  }
  const scoreOf = new Map(scores.map((s) => [s.insight_id, s]));
  const finalOf = new Map((overrides.data ?? []).map((o) => [o.insight_id, moscowValue(o.value)]));

  const cards = insights.map((i): InsightCard => {
    const trend = asTrend(i.trend);
    const score = scoreOf.get(i.id);
    const final = finalOf.get(i.id) ?? null;
    return {
      id: i.id,
      title: i.title,
      problem_statement: i.problem_statement,
      product_area: i.product_area,
      origin: i.origin,
      status: i.status,
      ranked: i.ranked,
      merged_into: i.merged_into,
      feedbacks_count: feedbacksOf.get(i.id)?.size ?? 0,
      accounts_count: i.accounts_count,
      mrr_exposed: Number(i.mrr_exposed),
      renewals_90d: i.renewals_90d,
      plans: asBreakdown(i.segments_breakdown).plans,
      weekly: trend.weekly ?? [],
      growth: trend.growth ?? null,
      is_emerging: trend.is_emerging ?? false,
      is_new: trend.is_new ?? false,
      rank: i.ranked && score ? score.rank : null,
      moscow: final ?? score?.moscow_reco ?? null,
      moscow_is_final: final !== null,
      alignment: score?.alignment ?? null,
    };
  });

  // An item stays flagged « watch » after a full run puts it in an insight: those are left out.
  const watch = (watched.data ?? [])
    .filter((w) => !inLiveInsight.has(w.id))
    .map(({ feedbacks, ...w }) => ({ ...w, received_at: feedbacks?.received_at ?? null }));
  return { cards, watch };
}

/** Live insights a proposed one can be merged into. */
export type MergeTarget = Pick<Tables<"insights">, "id" | "title" | "product_area" | "status">;

export async function listMergeTargets(db: Db): Promise<MergeTarget[]> {
  const { data, error } = await db
    .from("insights")
    .select("id, title, product_area, status")
    .in("status", ["propose", "actif"])
    .eq("origin", "retours")
    .order("id");
  fail("Lecture des insights", error);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type DetailFeedback = Pick<
  Tables<"feedbacks">,
  "id" | "channel" | "received_at" | "subject" | "author_name"
> & {
  summary: string | null;
  customer: { id: string; name: string; plan: Enums["customer_plan"] | null } | null;
  is_prospect: boolean;
  similarity: number | null;
};

export type DetailAccount = Pick<
  Tables<"customers">,
  "id" | "name" | "status" | "plan" | "segment" | "mrr_eur" | "renewal_date" | "health"
> & { feedback_ids: string[] };

export type DetailTension = {
  other: Pick<Tables<"insights">, "id" | "title" | "status">;
  rationale: string | null;
  segments: { segment: string; position: string }[];
};

export type DetailScore = Tables<"scores"> & {
  /** Active overrides of the insight (the MoSCoW one is the PO's final choice). */
  overrides: Pick<Tables<"overrides">, "param" | "value" | "reason" | "context_changed">[];
};

export type InsightDetail = Tables<"insights"> & {
  expressed: ExpressedRequest[];
  breakdown: SegmentsBreakdown;
  trendData: Partial<Trend>;
  channelCounts: [Enums["feedback_channel"], number][];
  feedbacks: DetailFeedback[];
  representative: DetailFeedback[];
  accounts: DetailAccount[];
  /** Feedbacks without an identifiable account (counted without extrapolation, CL-07). */
  unidentified: number;
  tensions: DetailTension[];
  /** Insights merged into this one. */
  absorbed: Pick<Tables<"insights">, "id" | "title">[];
  score: DetailScore | null;
};

const REPRESENTATIVE = 3;

export async function getInsightDetail(
  db: Db,
  id: string,
  context: { weighting: Weighting; now: Date },
): Promise<InsightDetail | null> {
  const { data: insight, error } = await db.from("insights").select("*").eq("id", id).maybeSingle();
  fail(`Lecture de l'insight ${id}`, error);
  if (!insight) return null;

  const [links, relations, absorbed, score, overrides, customers] = await Promise.all([
    db
      .from("insight_items")
      .select("item_id, feedback_id, similarity, is_representative")
      .eq("insight_id", id),
    db
      .from("insight_relations")
      .select("insight_a, insight_b, rationale, segments")
      .or(`insight_a.eq.${id},insight_b.eq.${id}`),
    db.from("insights").select("id, title").eq("merged_into", id).order("id"),
    db
      .from("scores")
      .select("*")
      .eq("insight_id", id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("overrides")
      .select("param, value, reason, context_changed")
      .eq("insight_id", id)
      .eq("active", true),
    fetchAll(
      (from, to) =>
        db
          .from("customers")
          .select(
            "id, name, status, segment, plan, seats, mrr_eur, renewal_date, health, email_domain",
          )
          .order("id")
          .range(from, to),
      "Lecture des comptes",
    ),
  ]);
  fail("Lecture des items", links.error);
  fail("Lecture des tensions", relations.error);
  fail("Lecture des insights fusionnés", absorbed.error);
  fail("Lecture du score", score.error);
  fail("Lecture des overrides", overrides.error);

  const itemIds = (links.data ?? []).map((l) => l.item_id);
  const feedbackIds = [...new Set((links.data ?? []).map((l) => l.feedback_id))];
  const [items, feedbacks] = await Promise.all([
    itemIds.length
      ? db.from("feedback_items").select("id, feedback_id, summary").in("id", itemIds)
      : { data: [], error: null },
    feedbackIds.length
      ? db
          .from("feedbacks")
          .select(
            "id, channel, source_type, received_at, subject, raw_text, author_name, author_email, customer_id",
          )
          .in("id", feedbackIds)
      : { data: [], error: null },
  ]);
  fail("Lecture des items", items.error);
  fail("Lecture des retours", feedbacks.error);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const summaryOf = new Map<string, string>();
  for (const item of (items.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))) {
    if (!summaryOf.has(item.feedback_id) && item.summary)
      summaryOf.set(item.feedback_id, item.summary);
  }
  const best = new Map<string, { similarity: number | null; representative: boolean }>();
  for (const l of links.data ?? []) {
    const prev = best.get(l.feedback_id);
    best.set(l.feedback_id, {
      similarity: Math.max(prev?.similarity ?? -1, l.similarity ?? -1),
      representative: (prev?.representative ?? false) || l.is_representative,
    });
  }

  const accounts = new Map<string, DetailAccount>();
  let unidentified = 0;
  const detailFeedbacks = (feedbacks.data ?? [])
    .map((f): DetailFeedback => {
      // Same account linking as the pipeline (customer id, else e-mail domain, ADR-009).
      const signals = computeSignals(
        f,
        customers as CustomerForLinking[],
        context.weighting,
        context.now,
      );
      const customer = signals.customer_id ? customerById.get(signals.customer_id) : undefined;
      if (customer) {
        const account = accounts.get(customer.id) ?? {
          id: customer.id,
          name: customer.name,
          status: customer.status,
          plan: customer.plan,
          segment: customer.segment,
          mrr_eur: customer.mrr_eur,
          renewal_date: customer.renewal_date,
          health: customer.health,
          feedback_ids: [],
        };
        account.feedback_ids.push(f.id);
        accounts.set(customer.id, account);
      } else unidentified++;
      const similarity = best.get(f.id)?.similarity ?? -1;
      return {
        id: f.id,
        channel: f.channel,
        received_at: f.received_at,
        subject: f.subject,
        author_name: f.author_name,
        summary: summaryOf.get(f.id) ?? null,
        customer: customer ? { id: customer.id, name: customer.name, plan: customer.plan } : null,
        is_prospect: signals.is_prospect,
        similarity: similarity >= 0 ? similarity : null,
      };
    })
    .toSorted((a, b) => b.received_at.localeCompare(a.received_at));

  const representative = detailFeedbacks
    .filter((f) => best.get(f.id)?.representative)
    .toSorted((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, REPRESENTATIVE);

  const relationRows = relations.data ?? [];
  const otherIds = relationRows.map((r) => (r.insight_a === id ? r.insight_b : r.insight_a));
  const others = otherIds.length
    ? await db.from("insights").select("id, title, status").in("id", otherIds)
    : { data: [], error: null };
  fail("Lecture des insights en tension", others.error);
  const otherById = new Map((others.data ?? []).map((o) => [o.id, o]));
  const tensions = relationRows.flatMap((r): DetailTension[] => {
    const other = otherById.get(r.insight_a === id ? r.insight_b : r.insight_a);
    // A tension with a merged, rejected or archived insight is no longer a choice to make.
    if (!other || !LIVE.has(other.status)) return [];
    return [
      {
        other,
        rationale: r.rationale,
        segments: Array.isArray(r.segments)
          ? (r.segments as { segment: string; position: string }[])
          : [],
      },
    ];
  });

  const channels = (insight.channels ?? {}) as Record<string, number>;
  return {
    ...insight,
    expressed: ((insight.expressed_requests ?? []) as unknown as ExpressedRequest[]).toSorted(
      (a, b) => b.frequency - a.frequency,
    ),
    breakdown: asBreakdown(insight.segments_breakdown),
    trendData: asTrend(insight.trend),
    channelCounts: (Object.entries(channels) as [Enums["feedback_channel"], number][]).toSorted(
      (a, b) => b[1] - a[1],
    ),
    feedbacks: detailFeedbacks,
    representative,
    accounts: [...accounts.values()].toSorted(
      (a, b) => Number(b.mrr_eur) - Number(a.mrr_eur) || a.name.localeCompare(b.name),
    ),
    unidentified,
    tensions,
    absorbed: absorbed.data ?? [],
    score: score.data ? { ...score.data, overrides: overrides.data ?? [] } : null,
  };
}
