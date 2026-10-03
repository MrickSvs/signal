// Business aggregates of an insight (SPEC §7 insights, §8 « Qui est classé », §8.8). Pure code:
// every number shown next to an insight is computed here, never by a model (P5).
import type { Weighting } from "@/lib/context";
import type { Database } from "@/lib/db/types";
import type { FeedbackSignals } from "@/pipeline/nodes/enrich";

type Enums = Database["public"]["Enums"];

export type InsightFeedback = {
  id: string;
  channel: Enums["feedback_channel"];
  received_at: string;
  signals: FeedbackSignals;
  /** From the latest successful triage; null when the feedback has no analysis. */
  churn_signal: boolean | null;
};

/** A commitment resolved to its customer: it covers insights of these areas citing this account. */
export type CommitmentCoverage = {
  customerId: string;
  productAreas: readonly string[];
  /** Account name and due date in J+ days, for the MoSCoW rule and its rationale. */
  account?: string;
  dueInDays?: number;
};

export type Trend = {
  /** Feedbacks per week, oldest first; the last entry is the last 7 days. */
  weekly: number[];
  recent: number;
  baseline: number;
  growth: number;
  is_emerging: boolean;
  is_new: boolean;
};

export type SegmentsBreakdown = {
  /** Distinct accounts by plan; « prospect » and « sans_compte » apart. */
  plans: Record<string, number>;
  /** Distinct accounts by customer segment; « sans_compte » when unknown. */
  segments: Record<string, number>;
};

export type RankingReason = "volume" | "churn" | "engagement" | "manuel";

export type InsightAggregates = {
  feedbacks_count: number;
  accounts_count: number;
  mrr_exposed: number;
  renewals_90d: number;
  segments_breakdown: SegmentsBreakdown;
  channels: Record<string, number>;
  trend: Trend;
  ranked: boolean;
  ranking_reasons: RankingReason[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RANKABLE_STATUSES = new Set<Enums["insight_status"]>(["propose", "actif"]);
const NO_ACCOUNT = "sans_compte";

const ageInDays = (date: string, now: Date) => (now.getTime() - new Date(date).getTime()) / DAY_MS;

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * SPEC §8.8: growth = feedbacks of the last 7 days ÷ max(feedbacks of the 21 days before ÷ 3 ;
 * floor) — the floor avoids a division by zero for a topic without history (CL-19).
 */
export function computeTrend(dates: string[], now: Date, params: Weighting["trend"]): Trend {
  const ages = dates.map((d) => Math.max(0, ageInDays(d, now)));
  const weekly = new Array<number>(params.history_weeks).fill(0);
  for (const age of ages) {
    const week = Math.floor(age / 7);
    if (week < params.history_weeks) weekly[params.history_weeks - 1 - week]++;
  }
  const recent = ages.filter((a) => a < params.recent_days).length;
  const baseline = ages.filter(
    (a) => a >= params.recent_days && a < params.recent_days + params.baseline_days,
  ).length;
  const periods = params.baseline_days / params.recent_days;
  const growth = recent / Math.max(baseline / periods, params.denominator_floor);
  return {
    weekly,
    recent,
    baseline,
    growth: Math.round(growth * 100) / 100,
    is_emerging:
      growth >= params.emerging_min_growth && recent >= params.emerging_min_recent_feedbacks,
    is_new: ages.length > 0 && Math.max(...ages) < params.new_max_age_days,
  };
}

export type AggregateInput = {
  status: Enums["insight_status"];
  origin: Enums["insight_origin"];
  productArea: string | null;
  feedbacks: InsightFeedback[];
};

/** Aggregates over the distinct feedbacks of an insight, counted by distinct account (CL-02). */
export function computeAggregates(
  input: AggregateInput,
  context: { weighting: Weighting; now: Date; commitments: readonly CommitmentCoverage[] },
): InsightAggregates {
  const { weighting, now } = context;
  const feedbacks = [...new Map(input.feedbacks.map((f) => [f.id, f])).values()];

  const accounts = new Map<string, FeedbackSignals>();
  for (const f of feedbacks) {
    if (!accounts.has(f.signals.account_key)) accounts.set(f.signals.account_key, f.signals);
  }

  const plans: Record<string, number> = {};
  const segments: Record<string, number> = {};
  let mrr = 0;
  let renewals = 0;
  for (const account of accounts.values()) {
    increment(
      plans,
      account.is_prospect
        ? "prospect"
        : account.customer_id
          ? (account.plan ?? NO_ACCOUNT)
          : NO_ACCOUNT,
    );
    increment(segments, account.segment ?? NO_ACCOUNT);
    if (!account.customer_id || account.is_prospect) continue;
    mrr += account.mrr_eur;
    const days = account.renewal_in_days;
    if (days !== null && days >= 0 && days <= weighting.moscow.horizon_days) renewals++;
  }

  const channels: Record<string, number> = {};
  for (const f of feedbacks) increment(channels, f.channel);

  const reasons: RankingReason[] = [];
  if (input.origin === "manuel") reasons.push("manuel");
  if (feedbacks.length >= weighting.ranking.min_feedbacks) reasons.push("volume");
  const churnPlans = new Set<string>(weighting.ranking.churn_plans);
  if (
    feedbacks.some(
      (f) =>
        f.churn_signal === true &&
        !f.signals.is_prospect &&
        f.signals.plan !== null &&
        churnPlans.has(f.signals.plan),
    )
  ) {
    reasons.push("churn");
  }
  if (
    input.productArea !== null &&
    context.commitments.some(
      (c) =>
        c.productAreas.includes(input.productArea!) &&
        feedbacks.some((f) => f.signals.customer_id === c.customerId),
    )
  ) {
    reasons.push("engagement");
  }
  const rankable = RANKABLE_STATUSES.has(input.status);

  return {
    feedbacks_count: feedbacks.length,
    accounts_count: accounts.size,
    mrr_exposed: Math.round(mrr * 100) / 100,
    renewals_90d: renewals,
    segments_breakdown: { plans, segments },
    channels,
    trend: computeTrend(
      feedbacks.map((f) => f.received_at),
      now,
      weighting.trend,
    ),
    ranked: rankable && reasons.length > 0,
    ranking_reasons: rankable ? reasons : [],
  };
}
