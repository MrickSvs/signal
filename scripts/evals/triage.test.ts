import { describe, expect, it } from "vitest";
import { EMPTY_USAGE } from "@/lib/llm/cost";
import type { TriageResult } from "@/pipeline/nodes/triage";
import type { Feedback, GroundTruth } from "../lib/feedbacks";
import {
  checkTriagedEdge,
  edgeMetrics,
  holdoutMetrics,
  holdoutSample,
  scoreHoldout,
  type EdgeCase,
  type EdgeOutcome,
} from "./triage";

const truth = (id: string, over: Partial<GroundTruth> = {}): GroundTruth => ({
  feedback_id: id,
  patterns: ["S1"],
  edge_cases: [],
  expected_items: [
    {
      pattern_id: "S1",
      topic: null,
      expected_type: "bug",
      acceptable_types: ["bug"],
      expected_area: "notifications",
      acceptable_areas: ["notifications"],
      existing_feature: false,
    },
  ],
  expected_sentiment_sign: -1,
  is_injection: false,
  churn_signal: false,
  ...over,
});

type Item = { type: string; area: string; existing?: boolean; summary?: string };

const result = (
  id: string,
  items: Item[],
  over: { injection?: boolean; sentiment?: number; truncated?: boolean; failed?: boolean } = {},
): TriageResult => ({
  feedbackId: id,
  truncated: over.truncated ?? false,
  language: "fr",
  analysis: over.failed
    ? { feedback_id: id, run_id: "eval", model: "m", status: "failed", error: "x" }
    : {
        feedback_id: id,
        run_id: "eval",
        model: "m",
        status: "ok",
        sentiment: over.sentiment ?? -1,
        urgency: "moyenne",
        churn_signal: false,
        injection_suspected: over.injection ?? false,
        confidence: 0.9,
      },
  items: items.map((i, n) => ({
    feedback_id: id,
    item_index: n + 1,
    type: i.type as never,
    product_area: i.area as never,
    tags: [],
    expressed_request: null,
    underlying_problem: i.summary ?? "Les notifications ne sont pas reçues par l'équipe",
    summary: i.summary ?? "Les notifications d'assignation ne sont pas reçues",
    existing_feature: i.existing ?? false,
  })),
  usage: EMPTY_USAGE,
});

const feedback = (id: string) => ({ id }) as Feedback;

describe("scoreHoldout", () => {
  it("measures type accuracy, area F1, injection recall and false positives", () => {
    const t = new Map([
      ["H-001", truth("H-001")],
      ["H-002", truth("H-002", { is_injection: true })],
      ["H-003", truth("H-003")],
    ]);
    const score = scoreHoldout(
      [
        {
          feedback: feedback("H-001"),
          result: result("H-001", [{ type: "bug", area: "notifications" }]),
        },
        {
          feedback: feedback("H-002"),
          result: result("H-002", [{ type: "bug", area: "notifications" }], { injection: true }),
        },
        {
          feedback: feedback("H-003"),
          result: result("H-003", [{ type: "question", area: "taches" }], { injection: true }),
        },
      ],
      t,
    );
    expect(score.typeAccuracy).toBeCloseTo(2 / 3);
    expect(score.injectionRecall).toBe(1);
    expect(score.injectionFalsePositives).toEqual(["H-003"]);
    expect(score.cases.map((c) => c.pass)).toEqual([true, true, false]);
    expect(score.confusion).toEqual({ bug: { bug: 2, question: 1 } });
    const metrics = holdoutMetrics(score);
    expect(metrics.map((m) => m.met)).toEqual([false, false, true]);
  });

  it("counts a failed triage as wrong and reports it; no injection → recall not measured", () => {
    const t = new Map([["H-001", truth("H-001")]]);
    const score = scoreHoldout(
      [{ feedback: feedback("H-001"), result: result("H-001", [], { failed: true }) }],
      t,
      "haiku:",
    );
    expect(score.failed).toEqual(["H-001"]);
    expect(score.typeAccuracy).toBe(0);
    expect(score.injectionRecall).toBeNull();
    expect(score.cases[0].item_id).toBe("haiku:H-001");
    expect(holdoutMetrics(score, "Haiku")[2]).toMatchObject({
      key: "injection_recall_haiku",
      met: null,
    });
  });
});

describe("holdoutSample", () => {
  it("always keeps the injection", () => {
    const feedbacks = Array.from({ length: 10 }, (_, i) => feedback(`H-00${i}`));
    const t = new Map(
      feedbacks.map((f) => [f.id, truth(f.id, { is_injection: f.id === "H-007" })]),
    );
    const sample = holdoutSample(feedbacks, t, 3);
    expect(sample).toHaveLength(3);
    expect(sample.map((f) => f.id)).toContain("H-007");
  });
});

describe("checkTriagedEdge", () => {
  const none = { groupedFeedbacks: new Set<string>() };
  const multi = truth("R-011", {
    patterns: ["S1", "S2a"],
    edge_cases: ["E1"],
    expected_items: [
      truth("x").expected_items[0],
      {
        pattern_id: "S2a",
        topic: null,
        expected_type: "demande_fonctionnelle",
        acceptable_types: ["demande_fonctionnelle"],
        expected_area: "planification",
        acceptable_areas: ["planification"],
        existing_feature: false,
      },
    ],
  });

  it("E1: split into as many items as topics, each in the right area", () => {
    const split = result("R-011", [
      { type: "bug", area: "notifications" },
      { type: "demande_fonctionnelle", area: "planification" },
    ]);
    expect(checkTriagedEdge("E1", multi, split, none).pass).toBe(true);
    const merged = result("R-011", [{ type: "bug", area: "notifications" }]);
    expect(checkTriagedEdge("E1", multi, merged, none)).toEqual({
      pass: false,
      reason: "1 item(s) pour 2 sujets",
    });
    const wrongArea = result("R-011", [
      { type: "bug", area: "notifications" },
      { type: "demande_fonctionnelle", area: "taches" },
    ]);
    expect(checkTriagedEdge("E1", multi, wrongArea, none).reason).toBe("domaine d'un item faux");
  });

  it("E3: fields in French and right type", () => {
    const t = truth("R-020", { edge_cases: ["E3"] });
    expect(
      checkTriagedEdge("E3", t, result("R-020", [{ type: "bug", area: "notifications" }]), none)
        .pass,
    ).toBe(true);
    const english = result("R-020", [
      { type: "bug", area: "notifications", summary: "The notifications are not sent to the team" },
    ]);
    expect(checkTriagedEdge("E3", t, english, none).reason).toBe("champs pas en français");
    const wrongType = result("R-020", [{ type: "question", area: "notifications" }]);
    expect(checkTriagedEdge("E3", t, wrongType, none).reason).toBe("type faux");
  });

  it("E4: type autre and never grouped", () => {
    const t = truth("R-030", { edge_cases: ["E4"] });
    const autre = result("R-030", [{ type: "autre", area: "autre" }]);
    expect(checkTriagedEdge("E4", t, autre, none).pass).toBe(true);
    expect(checkTriagedEdge("E4", t, autre, { groupedFeedbacks: new Set(["R-030"]) }).reason).toBe(
      "regroupé dans un insight",
    );
    expect(
      checkTriagedEdge("E4", t, result("R-030", [{ type: "question", area: "autre" }]), none).pass,
    ).toBe(false);
  });

  it("E5: existing_feature raised on the item", () => {
    const t = truth("R-010", {
      edge_cases: ["E5"],
      expected_items: [{ ...truth("x").expected_items[0], existing_feature: true }],
    });
    expect(
      checkTriagedEdge(
        "E5",
        t,
        result("R-010", [{ type: "bug", area: "notifications", existing: true }]),
        none,
      ).pass,
    ).toBe(true);
    expect(
      checkTriagedEdge("E5", t, result("R-010", [{ type: "bug", area: "notifications" }]), none)
        .pass,
    ).toBe(false);
  });

  it("E6: truncated and right type; E8: negative sentiment", () => {
    const t = truth("R-040");
    const item = [{ type: "bug", area: "notifications" }];
    expect(checkTriagedEdge("E6", t, result("R-040", item, { truncated: true }), none).pass).toBe(
      true,
    );
    expect(checkTriagedEdge("E6", t, result("R-040", item), none).reason).toBe("non tronqué");
    expect(
      checkTriagedEdge(
        "E6",
        t,
        result("R-040", [{ type: "question", area: "x" }], { truncated: true }),
        none,
      ).reason,
    ).toBe("type faux");
    expect(checkTriagedEdge("E8", t, result("R-040", item, { sentiment: -2 }), none).pass).toBe(
      true,
    );
    expect(checkTriagedEdge("E8", t, result("R-040", item, { sentiment: 1 }), none).reason).toBe(
      "sentiment 1",
    );
  });

  it("fails a failed triage and refuses the counting cases", () => {
    const t = truth("R-050");
    expect(checkTriagedEdge("E8", t, result("R-050", [], { failed: true }), none).reason).toBe(
      "triage en échec",
    );
    expect(() =>
      checkTriagedEdge("E2", t, result("R-050", [{ type: "bug", area: "x" }]), none),
    ).toThrow();
  });
});

describe("edgeMetrics", () => {
  it("passes a case at 75 % of its feedbacks and counts the cases", () => {
    const o = (pass: boolean): EdgeOutcome => ({ feedbackId: "R", pass, reason: "" });
    const outcomes = new Map<EdgeCase, EdgeOutcome[]>([
      ["E1", [o(true), o(true), o(true), o(false)]],
      ["E4", [o(true), o(true), o(false)]],
      ["E8", [o(true)]],
    ]);
    const { metrics, passedCases, measuredCases } = edgeMetrics(outcomes);
    expect(passedCases).toBe(2);
    expect(measuredCases).toBe(3);
    expect(metrics[0]).toMatchObject({ display: "2/8", met: false });
    expect(metrics.find((m) => m.key === "E4")).toMatchObject({ display: "2/3", met: false });
    expect(metrics.find((m) => m.key === "E2")).toMatchObject({ display: "non mesuré", met: null });
  });
});
