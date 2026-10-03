import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { mustCapacity, roadmapCapacityWeeks } from "./capacity";
import { computeConfidence, confidenceLevels, downgradeConfidence } from "./confidence";
import { chooseEffort, effortFromBacklog, effortFromRange } from "./effort";
import { applyMoscowRules, quartile, type MoscowFacts } from "./moscow-rules";
import { contextChanged, isManualReach, overrideValues, validateOverride } from "./overrides";
import { computeReach, distinctAccounts, manualReach, type ReachAccount } from "./reach";
import { applyOverrides, compareEntries, rankEntries, rice } from "./rice";
import {
  classify,
  computeRobustness,
  degrade,
  oneLevelDown,
  type RobustnessEntry,
} from "./robustness";

const { weighting } = await loadContextPack();
const TIES = weighting.ranking.tie_breakers;

const account = (key: string, a: Partial<ReachAccount> = {}): ReachAccount => ({
  account_key: key,
  customer_id: key,
  is_prospect: false,
  plan: "pro",
  mrr_eur: 100,
  ...a,
});

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

describe("computeReach", () => {
  const signals = [
    account("C-001", { plan: "enterprise", mrr_eur: 3000 }),
    // CL-02 (E2): the same account follows up twice, on two channels → counted once.
    account("C-001", { plan: "enterprise", mrr_eur: 3000 }),
    account("C-002", { plan: "free", mrr_eur: 0 }),
    account("C-003", { plan: "pro", mrr_eur: 120 }),
    // CL-07 (E7): no identifiable account.
    account("email:x@gmail.com", { customer_id: null, plan: null, mrr_eur: 0 }),
    // CL-08: a prospect weighs 0.
    account("C-090", { is_prospect: true, plan: null, mrr_eur: 0 }),
  ];

  it("counts distinct accounts × plan factor in « comptes » mode", () => {
    const { value, detail } = computeReach(signals, "comptes", weighting.reach);
    expect(value).toBe(1.5 + 6 + 4 + 1 + 0);
    expect(detail.accounts).toBe(5);
    expect(detail.by_plan.enterprise).toEqual({ accounts: 1, factor: 1.5, value: 1.5 });
    expect(detail.unidentified).toEqual({ accounts: 1, value: 1 });
    expect(detail.prospects).toEqual({ accounts: 1, value: 0 });
  });

  it("counts MRR × plan factor in « mrr » mode; unidentified and prospects weigh 0", () => {
    const { value, detail } = computeReach(signals, "mrr", weighting.reach);
    expect(value).toBe(3000 * 1.5 + 0 + 120 * 4);
    expect(detail.unidentified).toEqual({ accounts: 1, value: 0 });
  });

  it("keeps the first occurrence of each account", () => {
    expect(distinctAccounts([account("a"), account("a"), account("b")])).toHaveLength(2);
  });

  it("uses the PO's values for a manual insight, MRR possibly missing (SPEC §8.9)", () => {
    expect(manualReach({ comptes: 40, mrr: 5000 }, "comptes").value).toBe(40);
    expect(manualReach({ comptes: 40, mrr: 5000 }, "mrr").value).toBe(5000);
    const missing = manualReach({ comptes: 40, mrr: null }, "mrr");
    expect(missing).toMatchObject({ value: 0, detail: { manual: true, mrr_missing: true } });
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  const params = weighting.confidence;

  it("computes c from volume, diversity and quality and maps it to a level", () => {
    const high = computeConfidence(
      { accounts: 12, channels: 4, sourceWeights: [1, 1, 0.5, 1], contradiction: false },
      params,
    );
    expect(high.detail).toMatchObject({ volume: 1, diversity: 1, quality: 0.875 });
    expect(high.detail.c).toBeCloseTo(0.4 + 0.3 + 0.3 * 0.875);
    expect(high.value).toBe(1);

    const mid = computeConfidence(
      { accounts: 5, channels: 2, sourceWeights: [1, 1], contradiction: false },
      params,
    );
    expect(mid.detail.c).toBeCloseTo(0.2 + 0.15 + 0.3);
    expect(mid.value).toBe(0.8);

    const low = computeConfidence(
      { accounts: 1, channels: 1, sourceWeights: [0.5], contradiction: false },
      params,
    );
    expect(low.value).toBe(0.5);
    expect(
      computeConfidence(
        { accounts: 0, channels: 0, sourceWeights: [], contradiction: false },
        params,
      ).detail.quality,
    ).toBe(0);
  });

  it("downgrades one level on contradictory evidence, never below the lowest", () => {
    const flagged = computeConfidence(
      { accounts: 12, channels: 4, sourceWeights: [1], contradiction: true },
      params,
    );
    expect(flagged).toMatchObject({ value: 0.8, detail: { level: 1, downgraded: true } });
    const lowest = computeConfidence(
      { accounts: 1, channels: 1, sourceWeights: [0.5], contradiction: true },
      params,
    );
    expect(lowest).toMatchObject({ value: 0.5, detail: { downgraded: false } });
    expect(downgradeConfidence(1, confidenceLevels(params), 2)).toBe(0.5);
    expect(() => downgradeConfidence(0.7, confidenceLevels(params), 1)).toThrow(/inconnu/);
  });
});

// ---------------------------------------------------------------------------
// Effort
// ---------------------------------------------------------------------------

describe("effort", () => {
  it("takes the middle of the range ÷ velocity, with its bounds", () => {
    expect(effortFromRange({ min: 13, max: 21 }, 3)).toEqual({
      weeks: 5.67,
      source: "estimation_initiale",
      low_weeks: 4.33,
      high_weeks: 7,
      points: { min: 13, max: 21 },
    });
  });

  it("takes Σ backlog points ÷ velocity once the backlog has points", () => {
    expect(effortFromBacklog([5, 8, 3], 3)).toMatchObject({
      weeks: 5.33,
      source: "backlog",
      high_weeks: null,
    });
    expect(chooseEffort({ min: 2, max: 3 }, [5, null, 8], 3)?.source).toBe("backlog");
    expect(chooseEffort({ min: 2, max: 3 }, [null], 3)?.source).toBe("estimation_initiale");
    expect(chooseEffort(null, [], 3)).toBeNull();
  });

  it("rejects invalid inputs", () => {
    expect(() => effortFromRange({ min: 5, max: 3 }, 3)).toThrow(/invalide/);
    expect(() => effortFromRange({ min: 0, max: 3 }, 3)).toThrow(/invalide/);
    expect(() => effortFromRange({ min: 2, max: 3 }, 0)).toThrow(/vélocité/);
    expect(() => effortFromBacklog([], 3)).toThrow(/Aucun point/);
  });
});

// ---------------------------------------------------------------------------
// RICE, overrides, ties
// ---------------------------------------------------------------------------

describe("rice", () => {
  it("computes R × I × C ÷ E", () => {
    expect(rice({ reach: 30, impact: 2, confidence: 0.8, effort: 4 })).toBe(12);
    expect(() => rice({ reach: 1, impact: 1, confidence: 1, effort: 0 })).toThrow(/effort/);
  });

  it("replaces overridden parameters and keeps the original value", () => {
    const { effective, overridden } = applyOverrides(
      { reach: 30, impact: 2, confidence: 0.8, effort: 4 },
      { impact: 3 },
    );
    expect(effective).toEqual({ reach: 30, impact: 3, confidence: 0.8, effort: 4 });
    expect(overridden).toEqual({ impact: { original: 2, value: 3 } });
  });

  it("breaks ties by MRR exposed, then accounts, then id (CL-21)", () => {
    const entries = [
      { id: "I-10", rice: 12, mrr_exposed: 500, accounts_count: 3 },
      { id: "I-02", rice: 12, mrr_exposed: 500, accounts_count: 3 },
      { id: "I-03", rice: 12, mrr_exposed: 500, accounts_count: 7 },
      { id: "I-04", rice: 12, mrr_exposed: 900, accounts_count: 1 },
      { id: "I-05", rice: 20, mrr_exposed: 0, accounts_count: 1 },
    ];
    expect(rankEntries(entries, TIES).map((e) => [e.id, e.rank])).toEqual([
      ["I-05", 1],
      ["I-04", 2],
      ["I-03", 3],
      ["I-02", 4],
      ["I-10", 5], // numeric id order: I-02 before I-10
    ]);
    expect(compareEntries(entries[0], entries[0], TIES)).toBe(0);
  });

  it("ignores float noise when comparing scores", () => {
    const a = rice({ reach: 0.1 + 0.2, impact: 1, confidence: 1, effort: 1 });
    const b = rice({ reach: 0.3, impact: 1, confidence: 1, effort: 1 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

describe("robustness", () => {
  const ctx = {
    impactScale: weighting.impact.scale,
    confidenceLevels: confidenceLevels(weighting.confidence),
    params: weighting.robustness,
    defaultRangeMultiplier: weighting.effort.default_range_multiplier,
    tieBreakers: TIES,
  };
  const entry = (id: string, reach: number, o: Partial<RobustnessEntry> = {}): RobustnessEntry => ({
    id,
    mrr_exposed: 0,
    accounts_count: 1,
    params: { reach, impact: 2, confidence: 1, effort: 2 },
    effortHighWeeks: 3,
    ...o,
  });

  it("degrades one parameter at a time", () => {
    const e = entry("I-01", 10);
    expect(degrade(e, "impact", ctx)).toBe(1);
    expect(degrade(e, "confidence", ctx)).toBe(0.8);
    expect(degrade(e, "effort", ctx)).toBe(3);
    expect(degrade({ ...e, effortHighWeeks: null }, "effort", ctx)).toBe(3); // × 1.5
    expect(degrade(e, "reach", ctx)).toBe(7);
    expect(oneLevelDown(0.25, weighting.impact.scale)).toBe(0.25);
  });

  it("is robust when far ahead, fragile when every neighbour is close", () => {
    // I-01 far ahead; I-02…I-06 within a few percent of each other.
    const entries = [
      entry("I-01", 100),
      entry("I-02", 10.4),
      entry("I-03", 10.3),
      entry("I-04", 10.2),
      entry("I-05", 10.1),
      entry("I-06", 10),
      entry("I-07", 1),
    ];
    const results = computeRobustness(entries, ctx);
    expect(results.size).toBe(5); // top 5 only
    expect(results.get("I-01")).toMatchObject({
      robustness: "robuste",
      detail: { rank: 1, moves: 0 },
    });
    expect(results.get("I-02")!.robustness).toBe("fragile");
    expect(results.has("I-06")).toBe(false);
  });

  it("classifies by number of moving scenarios", () => {
    expect(classify(0, weighting.robustness)).toBe("robuste");
    expect(classify(1, weighting.robustness)).toBe("sensible");
    expect(classify(2, weighting.robustness)).toBe("fragile");
  });
});

// ---------------------------------------------------------------------------
// MoSCoW rules
// ---------------------------------------------------------------------------

describe("applyMoscowRules", () => {
  const params = weighting.moscow;
  const facts = (f: Partial<MoscowFacts> = {}): MoscowFacts => ({
    alignment: "aligne",
    commitments: [],
    churnAccounts: [],
    impact: 1,
    criticalBugFeedbacks: 0,
    riceQuartile: 2,
    reachQuartile: 2,
    confidence: 0.8,
    ...f,
  });

  it("makes a commitment due within 90 days a Must, reinforced by churn", () => {
    const result = applyMoscowRules(
      "must",
      facts({
        commitments: [{ account: "Atelier Mercure", due_in_days: 75 }],
        churnAccounts: [{ name: "Studio Bastide", plan: "enterprise", renewal_in_days: 38 }],
        impact: 3,
      }),
      params,
    );
    expect(result).toMatchObject({
      reco: "must",
      rule: "engagement_contractuel",
      corrected: false,
    });
    expect(result.flags.map((f) => [f.rule, f.status])).toEqual([
      ["engagement_contractuel", "appliquee"],
      ["signal_churn", "renfort"],
    ]);
    expect(result.flags[0]).toMatchObject({
      detail: expect.stringContaining("Atelier Mercure (J+75)"),
    });
  });

  it("ignores a commitment beyond the horizon", () => {
    const result = applyMoscowRules(
      "should",
      facts({ commitments: [{ account: "X", due_in_days: 120 }], riceQuartile: 1 }),
      params,
    );
    expect(result.reco).toBe("should");
  });

  it("follows the rule order on a conflict: at-risk Enterprise + out of strategy → Won't + tension (CL-24)", () => {
    const result = applyMoscowRules(
      "must",
      facts({
        alignment: "hors_strategie",
        churnAccounts: [{ name: "Studio Bastide", plan: "enterprise", renewal_in_days: 38 }],
        impact: 3,
      }),
      params,
    );
    expect(result).toMatchObject({ reco: "wont", rule: "hors_strategie", corrected: true });
    const tension = result.flags.find((f) => f.status === "tension");
    expect(tension).toMatchObject({
      rule: "signal_churn",
      category: "must",
      piste: expect.stringContaining("CSM"),
    });
    expect(result.flags.at(-1)).toMatchObject({ rule: "correction", from: "must", to: "wont" });
    expect(result.note).toContain("must → wont");
  });

  it("flags out of strategy against a commitment, without a CSM piste", () => {
    const result = applyMoscowRules(
      "must",
      facts({ alignment: "hors_strategie", commitments: [{ account: "A", due_in_days: 10 }] }),
      params,
    );
    expect(result.reco).toBe("must");
    expect(result.flags[1]).toMatchObject({
      rule: "hors_strategie",
      status: "tension",
      piste: null,
    });
  });

  it("requires Impact ≥ 2, a Business/Enterprise plan and a renewal within 90 days for churn", () => {
    const churn = [{ name: "B", plan: "business", renewal_in_days: 30 }];
    expect(applyMoscowRules("must", facts({ churnAccounts: churn, impact: 2 }), params).reco).toBe(
      "must",
    );
    expect(applyMoscowRules("could", facts({ churnAccounts: churn, impact: 1 }), params).reco).toBe(
      "could",
    );
    const far = [{ name: "B", plan: "enterprise", renewal_in_days: 200 }];
    expect(applyMoscowRules("could", facts({ churnAccounts: far, impact: 3 }), params).reco).toBe(
      "could",
    );
    const pro = [{ name: "P", plan: "pro", renewal_in_days: 10 }];
    expect(applyMoscowRules("could", facts({ churnAccounts: pro, impact: 3 }), params).reco).toBe(
      "could",
    );
    const unknown = [{ name: "U", plan: null, renewal_in_days: null }];
    expect(
      applyMoscowRules("could", facts({ churnAccounts: unknown, impact: 3 }), params).reco,
    ).toBe("could");
  });

  it("makes a critical bug with 3 feedbacks a Must", () => {
    const result = applyMoscowRules("should", facts({ criticalBugFeedbacks: 3 }), params);
    expect(result).toMatchObject({ reco: "must", rule: "bug_critique", corrected: true });
    expect(applyMoscowRules("could", facts({ criticalBugFeedbacks: 2 }), params).reco).toBe(
      "could",
    );
  });

  it("applies the quartiles last: Should, Won't on low confidence and reach, else Could", () => {
    expect(applyMoscowRules("should", facts({ riceQuartile: 1 }), params).reco).toBe("should");
    expect(
      applyMoscowRules(
        "could",
        facts({ confidence: 0.5, reachQuartile: 4, riceQuartile: 4 }),
        params,
      ).reco,
    ).toBe("wont");
    expect(
      applyMoscowRules("could", facts({ alignment: "neutre", riceQuartile: 3 }), params),
    ).toMatchObject({
      reco: "could",
      rule: "quartiles",
      flags: [{ rule: "quartiles", status: "appliquee" }],
    });
  });

  it("puts an out-of-strategy insight in Won't even in the first quartile", () => {
    // hors_strategie alone decides; quartiles never stand against it.
    const result = applyMoscowRules(
      "wont",
      facts({ alignment: "hors_strategie", riceQuartile: 1 }),
      params,
    );
    expect(result).toMatchObject({ reco: "wont", corrected: false });
    expect(result.flags).toHaveLength(1);
    const reordered = {
      ...params,
      rule_order: [
        "quartiles",
        "engagement_contractuel",
        "signal_churn",
        "bug_critique",
        "hors_strategie",
      ] as typeof params.rule_order,
    };
    expect(
      applyMoscowRules("wont", facts({ alignment: "hors_strategie", riceQuartile: 1 }), reordered)
        .flags[0],
    ).toMatchObject({ rule: "quartiles", category: "wont" });
  });

  it("computes quartiles from ranks", () => {
    expect([1, 3, 4, 6, 9, 11].map((r) => quartile(r, 11))).toEqual([1, 1, 2, 2, 3, 4]);
    expect(quartile(1, 1)).toBe(1);
    expect(() => quartile(0, 3)).toThrow();
    expect(() => quartile(1, 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

describe("mustCapacity", () => {
  it("computes the roadmap capacity: 5 devs × 12 weeks × 70 %", () => {
    expect(roadmapCapacityWeeks(weighting.capacity)).toBe(42);
  });

  it("alerts beyond 60 % and proposes the Musts no hard rule imposes first", () => {
    const report = mustCapacity(
      [
        { id: "I-01", moscow: "must", effort_weeks: 12, rice: 50, imposed: true },
        { id: "I-02", moscow: "must", effort_weeks: 10, rice: 80, imposed: false },
        { id: "I-03", moscow: "must", effort_weeks: 8, rice: 10, imposed: true },
        { id: "I-04", moscow: "should", effort_weeks: 30, rice: 90, imposed: false },
      ],
      weighting,
    );
    expect(report).toMatchObject({ capacity_weeks: 42, must_weeks: 30, share: 0.71, alert: true });
    expect(report.downgrade).toEqual(["I-02"]);
  });

  it("downgrades the lowest scores next, ties by id", () => {
    const report = mustCapacity(
      [
        { id: "I-09", moscow: "must", effort_weeks: 20, rice: 5, imposed: true },
        { id: "I-08", moscow: "must", effort_weeks: 20, rice: 5, imposed: true },
      ],
      weighting,
    );
    expect(report.downgrade).toEqual(["I-08"]);
  });

  it("does not alert under the limit", () => {
    const report = mustCapacity(
      [{ id: "I-01", moscow: "must", effort_weeks: 5, rice: 1, imposed: true }],
      weighting,
    );
    expect(report).toMatchObject({ alert: false, downgrade: [] });
  });
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

describe("overrides", () => {
  const check = (
    param: Parameters<typeof validateOverride>[0]["param"],
    value: unknown,
    reason: string | null = "Raison",
  ) => validateOverride({ param, value, reason }, weighting).ok;

  it("checks values against the scales", () => {
    expect(check("impact", 2)).toBe(true);
    expect(check("impact", 2.5)).toBe(false);
    expect(check("confidence", 0.8)).toBe(true);
    expect(check("confidence", 0.7)).toBe(false);
    expect(check("reach", 12)).toBe(true);
    expect(check("reach", 0)).toBe(false);
    expect(check("reach", { comptes: 40, mrr: null })).toBe(true);
    expect(check("reach", { comptes: 0, mrr: null })).toBe(false);
    expect(check("effort", 3.5)).toBe(true);
    expect(check("effort", -1)).toBe(false);
    expect(check("effort", Number.POSITIVE_INFINITY)).toBe(false);
    expect(check("moscow", "must", null)).toBe(true);
    expect(check("moscow", "maybe", null)).toBe(false);
  });

  it("requires a reason, except for MoSCoW", () => {
    expect(validateOverride({ param: "impact", value: 2, reason: "  " }, weighting)).toEqual({
      ok: false,
      error: expect.stringContaining("raison"),
    });
    expect(check("impact", 2, null)).toBe(false);
  });

  it("recognises a manual Reach", () => {
    expect(isManualReach({ comptes: 3, mrr: 400 })).toBe(true);
    expect(isManualReach({ comptes: 3, mrr: -1 })).toBe(false);
    expect(isManualReach(null)).toBe(false);
    expect(isManualReach(4)).toBe(false);
  });

  it("flags the context as changed beyond 30 % of the feedbacks (CL-22)", () => {
    const before = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8", "R-9", "R-10"];
    expect(contextChanged(before, [...before, "R-11", "R-12", "R-13"], 0.3)).toBe(false); // 30 %
    expect(contextChanged(before, [...before.slice(2), "R-11", "R-12"], 0.3)).toBe(true); // 40 %
    expect(contextChanged(null, ["R-1"], 0.3)).toBe(false);
    expect(contextChanged([], ["R-1"], 0.3)).toBe(true);
  });

  it("collects the active overrides' values", () => {
    expect(
      overrideValues([
        { param: "impact", value: 3 },
        { param: "effort", value: 4 },
        { param: "moscow", value: "should" },
        { param: "reach", value: { comptes: 20, mrr: null } },
      ]),
    ).toEqual({
      rice: { impact: 3, effort: 4 },
      moscow: "should",
      manualReach: { comptes: 20, mrr: null },
    });
    expect(overrideValues([{ param: "reach", value: 12 }]).rice).toEqual({ reach: 12 });
  });
});
