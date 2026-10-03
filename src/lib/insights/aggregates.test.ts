import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import type { FeedbackSignals } from "@/pipeline/nodes/enrich";
import { computeAggregates, computeTrend, type InsightFeedback } from "./aggregates";

const { weighting } = await loadContextPack();
const now = new Date("2026-06-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000).toISOString();

const signals = (s: Partial<FeedbackSignals> & Pick<FeedbackSignals, "feedback_id">) =>
  ({
    customer_id: null,
    link_method: null,
    account_key: `retour:${s.feedback_id}`,
    is_prospect: false,
    plan: null,
    segment: null,
    mrr_eur: 0,
    renewal_in_days: null,
    source_weight: 1,
    ...s,
  }) as FeedbackSignals;

const feedback = (
  id: string,
  options: Partial<FeedbackSignals> & {
    age?: number;
    channel?: InsightFeedback["channel"];
    churn?: boolean;
  } = {},
): InsightFeedback => {
  const { age = 10, channel = "email_client", churn = false, ...rest } = options;
  return {
    id,
    channel,
    received_at: daysAgo(age),
    churn_signal: churn,
    signals: signals({ feedback_id: id, ...rest }),
  };
};

const enterprise = (id: string, renewal: number) => ({
  customer_id: id,
  account_key: id,
  plan: "enterprise" as const,
  segment: "agence_digitale" as const,
  mrr_eur: 2700,
  renewal_in_days: renewal,
});

const aggregate = (
  feedbacks: InsightFeedback[],
  extra: Partial<Parameters<typeof computeAggregates>[0]> = {},
) =>
  computeAggregates(
    {
      status: "propose",
      origin: "retours",
      productArea: "permissions_partage",
      feedbacks,
      ...extra,
    },
    { weighting, now, commitments: [] },
  );

describe("computeTrend (SPEC §8.8)", () => {
  it("floors the denominator when the topic has no history (CL-19)", () => {
    const trend = computeTrend([1, 1, 2, 3, 4].map(daysAgo), now, weighting.trend);
    expect(trend).toMatchObject({
      recent: 5,
      baseline: 0,
      growth: 5,
      is_emerging: true,
      is_new: true,
    });
    expect(trend.weekly).toEqual([0, 0, 0, 0, 0, 5]);
  });

  it("compares the last 7 days with a third of the 21 days before", () => {
    // 6 recent, 6 in the baseline → growth = 6 ÷ 2 = 3, emerging; old history → not new.
    const dates = [1, 2, 3, 4, 5, 6, 8, 10, 15, 18, 22, 27, 40].map(daysAgo);
    const trend = computeTrend(dates, now, weighting.trend);
    expect(trend).toMatchObject({
      recent: 6,
      baseline: 6,
      growth: 3,
      is_emerging: true,
      is_new: false,
    });
    expect(trend.weekly).toEqual([1, 0, 2, 2, 2, 6]);
  });

  it("is not emerging below 5 recent feedbacks, even with a high growth", () => {
    const trend = computeTrend([1, 2, 3, 4].map(daysAgo), now, weighting.trend);
    expect(trend.growth).toBe(4);
    expect(trend.is_emerging).toBe(false);
  });

  it("is not emerging when the growth is below 2", () => {
    const dates = [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(daysAgo);
    const trend = computeTrend(dates, now, weighting.trend);
    expect(trend.growth).toBeCloseTo(5 / (11 / 3), 2);
    expect(trend.is_emerging).toBe(false);
  });

  it("buckets weeks oldest first and drops what is older than the history", () => {
    const trend = computeTrend([0, 7, 14, 21, 28, 35, 50].map(daysAgo), now, weighting.trend);
    expect(trend.weekly).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("computeAggregates", () => {
  it("counts each account once across reminders and channels (CL-02)", () => {
    const agg = aggregate([
      feedback("R-001", { ...enterprise("C-013", 38), channel: "email_client" }),
      feedback("R-002", { ...enterprise("C-013", 38), channel: "ticket_support" }),
      feedback("R-003", { ...enterprise("C-013", 38), channel: "ticket_support" }),
    ]);
    expect(agg).toMatchObject({
      feedbacks_count: 3,
      accounts_count: 1,
      mrr_exposed: 2700,
      renewals_90d: 1,
      channels: { email_client: 1, ticket_support: 2 },
      segments_breakdown: { plans: { enterprise: 1 }, segments: { agence_digitale: 1 } },
    });
  });

  it("counts a feedback once even if several of its items are in the insight", () => {
    expect(aggregate([feedback("R-001"), feedback("R-001")]).feedbacks_count).toBe(1);
  });

  it("keeps prospects and unknown accounts out of the MRR and renewals (CL-07, CL-08)", () => {
    const agg = aggregate([
      feedback("R-001", {
        customer_id: "C-010",
        account_key: "C-010",
        is_prospect: true,
        segment: "hors_cible",
        renewal_in_days: 10,
      }),
      feedback("R-002", { account_key: "email:jean@gmail.com" }),
      feedback("R-003", { ...enterprise("C-077", 120) }),
    ]);
    expect(agg).toMatchObject({
      accounts_count: 3,
      mrr_exposed: 2700,
      renewals_90d: 0,
      segments_breakdown: {
        plans: { prospect: 1, sans_compte: 1, enterprise: 1 },
        segments: { hors_cible: 1, sans_compte: 1, agence_digitale: 1 },
      },
    });
  });

  it("ranks an insight from 5 distinct feedbacks", () => {
    const four = ["R-1", "R-2", "R-3", "R-4"].map((id) => feedback(id));
    expect(aggregate(four)).toMatchObject({ ranked: false, ranking_reasons: [] });
    expect(aggregate([...four, feedback("R-5")])).toMatchObject({
      ranked: true,
      ranking_reasons: ["volume"],
    });
  });

  it("ranks a small insight with a churn signal on a Business or Enterprise account (CL-17)", () => {
    expect(aggregate([feedback("R-1", { ...enterprise("C-013", 38), churn: true })])).toMatchObject(
      {
        ranked: true,
        ranking_reasons: ["churn"],
      },
    );
    expect(
      aggregate([
        feedback("R-1", { customer_id: "C-2", account_key: "C-2", plan: "pro", churn: true }),
      ]).ranked,
    ).toBe(false);
  });

  it("ranks a small insight covered by a contractual commitment", () => {
    const input = {
      status: "propose" as const,
      origin: "retours" as const,
      productArea: "permissions_partage",
      feedbacks: [feedback("R-1", { ...enterprise("C-077", 45) })],
    };
    const commitments = [{ customerId: "C-077", productAreas: ["permissions_partage"] }];
    expect(computeAggregates(input, { weighting, now, commitments })).toMatchObject({
      ranked: true,
      ranking_reasons: ["engagement"],
    });
    // Another area, or another account: not covered.
    expect(
      computeAggregates({ ...input, productArea: "planification" }, { weighting, now, commitments })
        .ranked,
    ).toBe(false);
    expect(
      computeAggregates(input, {
        weighting,
        now,
        commitments: [{ customerId: "C-099", productAreas: ["permissions_partage"] }],
      }).ranked,
    ).toBe(false);
  });

  it("never ranks a rejected, merged or archived insight", () => {
    const many = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6"].map((id) => feedback(id));
    for (const status of ["rejete", "fusionne", "archive"] as const) {
      expect(aggregate(many, { status })).toMatchObject({ ranked: false, ranking_reasons: [] });
    }
    expect(aggregate(many, { status: "actif" }).ranked).toBe(true);
  });

  it("always ranks a manual insight", () => {
    expect(aggregate([], { origin: "manuel", status: "actif" })).toMatchObject({
      ranked: true,
      ranking_reasons: ["manuel"],
      trend: { is_new: false },
    });
  });
});
