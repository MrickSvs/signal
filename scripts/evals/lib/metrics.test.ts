import { describe, expect, it } from "vitest";
import {
  areaLabels,
  bestInsightFor,
  cohenKappa,
  confusionMatrix,
  fibonacciIndex,
  itemInPattern,
  kendallTau,
  looksFrench,
  macroF1,
  mean,
  numbersIn,
  pairItems,
  percentile,
  rangeStepError,
  recall,
  spreadSample,
  typeAccuracy,
  type ExpectedItem,
  type TruthForItems,
} from "./metrics";

const expected = (type: string, area: string, extra: Partial<ExpectedItem> = {}): ExpectedItem => ({
  pattern_id: "S1",
  expected_type: type,
  acceptable_types: [type],
  expected_area: area,
  acceptable_areas: [area],
  existing_feature: false,
  ...extra,
});
const predicted = (type: string, area: string) => ({
  type,
  product_area: area,
  existing_feature: false,
});

describe("pairItems", () => {
  it("pairs each expected item with the best matching prediction, whatever the order", () => {
    const pairs = pairItems(
      [expected("bug", "notifications"), expected("demande_fonctionnelle", "planification")],
      [predicted("demande_fonctionnelle", "planification"), predicted("bug", "notifications")],
    );
    expect(pairs.map((p) => p.predicted?.type)).toEqual(["bug", "demande_fonctionnelle"]);
  });

  it("leaves an expected item unpaired when the model produced fewer items (E1 not split)", () => {
    const pairs = pairItems(
      [expected("bug", "notifications"), expected("demande_fonctionnelle", "planification")],
      [predicted("demande_fonctionnelle", "planification")],
    );
    expect(pairs[0].predicted).toBeNull();
    expect(pairs[1].predicted?.type).toBe("demande_fonctionnelle");
    expect(typeAccuracy(pairs)).toBe(0.5);
  });

  it("pairs nothing without predictions (failed triage)", () => {
    const pairs = pairItems([expected("bug", "notifications")], []);
    expect(pairs[0].predicted).toBeNull();
    expect(typeAccuracy(pairs)).toBe(0);
    expect(typeAccuracy([])).toBe(0);
  });
});

describe("type and area metrics", () => {
  it("counts an acceptable type as right, in the accuracy and the confusion matrix", () => {
    const e = expected("irritant_ux", "taches", {
      acceptable_types: ["irritant_ux", "demande_fonctionnelle"],
    });
    const pairs = pairItems([e], [predicted("demande_fonctionnelle", "taches")]);
    expect(typeAccuracy(pairs)).toBe(1);
    expect(confusionMatrix(pairs)).toEqual({ irritant_ux: { irritant_ux: 1 } });
  });

  it("records wrong and missing types in the confusion matrix", () => {
    const pairs = [
      ...pairItems([expected("bug", "notifications")], [predicted("question", "notifications")]),
      ...pairItems([expected("bug", "notifications")], []),
    ];
    expect(confusionMatrix(pairs)).toEqual({ bug: { question: 1, "∅": 1 } });
  });

  it("maps an acceptable area onto the expected one and an unpaired item onto ∅", () => {
    const e = expected("bug", "performance", {
      acceptable_areas: ["performance", "tableau_kanban"],
    });
    const pairs = [
      ...pairItems([e], [predicted("bug", "tableau_kanban")]),
      ...pairItems([expected("bug", "taches")], [predicted("bug", "autre")]),
      ...pairItems([expected("bug", "taches")], []),
    ];
    expect(areaLabels(pairs)).toEqual({
      truth: ["performance", "taches", "taches"],
      predicted: ["performance", "autre", "∅"],
    });
  });

  it("computes the macro-F1 over the classes seen, ∅ excluded", () => {
    expect(macroF1(["a", "a", "b"], ["a", "a", "b"])).toBe(1);
    // a: tp 1, fn 1 → 2/3 ; b: tp 1, fp 1 → 2/3
    expect(macroF1(["a", "a", "b"], ["a", "b", "b"])).toBeCloseTo(2 / 3);
    // a: tp 0 → 0 ; ∅ ignored
    expect(macroF1(["a"], ["∅"])).toBe(0);
    expect(macroF1([], [])).toBe(0);
  });

  it("computes a recall, 1 when nothing is expected", () => {
    expect(recall(["H-001", "H-002"], new Set(["H-001"]))).toBe(0.5);
    expect(recall([], new Set())).toBe(1);
  });
});

describe("spreadSample", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  it("keeps the required items and spreads the others", () => {
    const sample = spreadSample(items, 4, (i) => i === 9);
    expect(sample).toHaveLength(4);
    expect(sample).toContain(9);
    expect(sample).toEqual([0, 3, 6, 9]);
  });
  it("returns everything when the sample is not smaller", () => {
    expect(spreadSample(items, 20, () => false)).toEqual(items);
  });
  it("never drops a required item, even beyond n", () => {
    expect(spreadSample(items, 1, (i) => i < 2)).toEqual([0, 1]);
  });
});

describe("detection", () => {
  const single: TruthForItems = {
    patterns: ["S1"],
    expected_items: [{ pattern_id: "S1", acceptable_areas: ["notifications"] }],
  };
  const mixed: TruthForItems = {
    patterns: ["S1", "S2a"],
    expected_items: [
      { pattern_id: "S1", acceptable_areas: ["notifications"] },
      { pattern_id: "S2a", acceptable_areas: ["planification"] },
    ],
  };

  it("assigns the item of a multi-topic feedback by its area", () => {
    expect(itemInPattern({ product_area: "taches" }, single, "S1")).toBe(true);
    expect(itemInPattern({ product_area: "planification" }, mixed, "S2a")).toBe(true);
    expect(itemInPattern({ product_area: "planification" }, mixed, "S1")).toBe(false);
    expect(itemInPattern({ product_area: "notifications" }, single, "S2a")).toBe(false);
  });

  it("picks the insight holding most items of the pattern, with recall and purity", () => {
    const truth = new Map<string, TruthForItems>([
      ["R-001", single],
      ["R-002", single],
      ["R-003", mixed],
      [
        "R-004",
        {
          patterns: ["noise"],
          expected_items: [{ pattern_id: "noise", acceptable_areas: ["autre"] }],
        },
      ],
    ]);
    const item = (id: string, area: string) => ({
      id: `${id}.1`,
      feedback_id: id,
      product_area: area,
    });
    const insights = [
      { id: "I-02", items: [item("R-001", "notifications"), item("R-004", "autre")] },
      {
        id: "I-01",
        items: [
          item("R-002", "notifications"),
          item("R-003", "notifications"),
          item("R-004", "autre"),
          item("R-999", "notifications"), // added later, no ground truth
        ],
      },
      { id: "I-03", items: [item("R-003", "planification")] },
    ];
    expect(bestInsightFor("S1", insights, truth)).toEqual({
      insight_id: "I-01",
      hits: 2,
      known: 3,
      recall: 2 / 3,
      purity: 2 / 3,
    });
    expect(bestInsightFor("S2a", insights, truth)?.insight_id).toBe("I-03");
    expect(bestInsightFor("S7", insights, truth)).toBeNull();
  });

  it("breaks ties on purity, then on the id", () => {
    const truth = new Map<string, TruthForItems>([
      ["R-001", single],
      ["R-002", single],
      [
        "R-003",
        {
          patterns: ["noise"],
          expected_items: [{ pattern_id: "noise", acceptable_areas: ["autre"] }],
        },
      ],
    ]);
    const item = (id: string) => ({
      id: `${id}.1`,
      feedback_id: id,
      product_area: "notifications",
    });
    expect(
      bestInsightFor(
        "S1",
        [
          { id: "I-01", items: [item("R-001"), item("R-003")] },
          { id: "I-02", items: [item("R-002")] },
        ],
        truth,
      )?.insight_id,
    ).toBe("I-02");
    expect(
      bestInsightFor(
        "S1",
        [
          { id: "I-05", items: [item("R-001")] },
          { id: "I-04", items: [item("R-002")] },
          { id: "I-06", items: [item("R-999")] },
        ],
        truth,
      )?.insight_id,
    ).toBe("I-04");
  });
});

describe("kendallTau", () => {
  it("is 1 for the same order, −1 for the reverse, in between otherwise", () => {
    expect(kendallTau(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(kendallTau(["a", "b", "c"], ["c", "b", "a"])).toBe(-1);
    expect(kendallTau(["a", "b", "c"], ["b", "a", "c"])).toBeCloseTo(1 / 3);
  });
  it("works on the common items only", () => {
    expect(kendallTau(["a", "b", "c"], ["x", "a", "c"])).toBe(1);
    expect(kendallTau(["a"], ["a"])).toBe(1);
  });
});

describe("Fibonacci steps", () => {
  const scale = [1, 2, 3, 5, 8, 13, 21];
  it("indexes values on the scale", () => {
    expect(fibonacciIndex(5, scale)).toBe(3);
    expect(fibonacciIndex(4, scale)).toBe(3); // closest, ties go up
  });
  it("measures the middle of the range against the actual points, in steps", () => {
    expect(rangeStepError({ min: 3, max: 8 }, 5, scale)).toBe(0);
    expect(rangeStepError({ min: 3, max: 5 }, 8, scale)).toBe(1.5);
    expect(rangeStepError({ min: 5, max: 5 }, 2, scale)).toBe(2);
  });
});

describe("statistics", () => {
  it("averages and takes percentiles", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
});

describe("text checks", () => {
  it("tells French fields from English ones", () => {
    expect(looksFrench("Les notifications d'assignation ne sont pas reçues par l'équipe")).toBe(
      true,
    );
    expect(looksFrench("Assignment notifications are not received by the team")).toBe(false);
  });

  it("extracts numbers with French separators", () => {
    expect(numbersIn("MRR exposé : 12 450 € sur 3 comptes, Impact 0,5")).toEqual([12450, 3, 0.5]);
  });
});

describe("cohenKappa", () => {
  it("is 1 on full agreement, 0 at chance level, negative below", () => {
    expect(cohenKappa(["a", "b", "a"], ["a", "b", "a"])).toBe(1);
    expect(cohenKappa(["a", "a"], ["a", "a"])).toBe(1);
    // observed 0.5, expected 0.5 → 0
    expect(cohenKappa(["a", "a", "b", "b"], ["a", "b", "a", "b"])).toBe(0);
    expect(cohenKappa(["a", "b"], ["b", "a"])).toBe(-1);
    expect(cohenKappa([], [])).toBe(0);
  });

  it("matches a textbook case", () => {
    // 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no → κ = 0.4
    const a = [...Array(25).fill("y"), ...Array(25).fill("n")];
    const b = [
      ...Array(20).fill("y"),
      ...Array(5).fill("n"),
      ...Array(10).fill("y"),
      ...Array(15).fill("n"),
    ];
    expect(cohenKappa(a, b)).toBeCloseTo(0.4);
  });
});
