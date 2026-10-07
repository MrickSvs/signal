import { describe, expect, it } from "vitest";
import { productionMetric, type DecisionRow } from "./production";

let n = 0;
const d = (row: Partial<DecisionRow>): DecisionRow => {
  n += 1;
  return {
    id: `D-${String(n).padStart(3, "0")}`,
    actor: "po",
    entity_type: "insight",
    entity_id: "I-01",
    action: "validation",
    field: "status",
    after: null,
    created_at: `2026-10-01T10:${String(n).padStart(2, "0")}:00Z`,
    ...row,
  };
};

describe("productionMetric", () => {
  it("is empty without decisions", () => {
    expect(productionMetric([])).toEqual({
      backlog: { validated: [], unmodified: [] },
      moscow: { reviewed: [], kept: [] },
      disagreements: [],
    });
  });

  it("counts validated backlog items and those never modified", () => {
    const m = productionMetric([
      d({ entity_type: "backlog_item", entity_id: "US-002", field: "status" }),
      d({ entity_type: "backlog_item", entity_id: "US-010", field: "status" }),
      d({
        entity_type: "backlog_item",
        entity_id: "BUG-001",
        action: "modification",
        field: "title",
      }),
      d({ entity_type: "backlog_item", entity_id: "BUG-001", field: "status" }),
      // Pushing to Notion is not a second validation; a draft never validated is not counted.
      d({ entity_type: "backlog_item", entity_id: "US-002", field: "notion" }),
      d({
        entity_type: "backlog_item",
        entity_id: "US-003",
        action: "modification",
        field: "title",
      }),
      d({ entity_type: "backlog_item", entity_id: "US-004", action: "rejet", field: "status" }),
    ]);
    expect(m.backlog).toEqual({
      validated: ["BUG-001", "US-002", "US-010"],
      unmodified: ["US-002", "US-010"],
    });
  });

  it("keeps a MoSCoW recommendation unless its latest override stands", () => {
    const m = productionMetric([
      d({ entity_id: "I-01" }),
      d({ entity_id: "I-02" }),
      d({ entity_id: "I-02", action: "override", field: "moscow", after: "could" }),
      d({ entity_id: "I-03", action: "override", field: "moscow", after: "must" }),
      d({ entity_id: "I-03", action: "override", field: "moscow", after: null }),
      // Overriding another parameter leaves the MoSCoW recommendation untouched.
      d({ entity_id: "I-04", action: "override", field: "impact", after: 3 }),
      // Signal's own adjustments are not reviews by the PO.
      d({ actor: "signal", entity_id: "I-05", action: "ajustement", field: "moscow" }),
    ]);
    expect(m.moscow).toEqual({ reviewed: ["I-01", "I-02", "I-03"], kept: ["I-01", "I-03"] });
  });

  it("lists Signal's disagreements", () => {
    const m = productionMetric([
      d({ actor: "signal", action: "desaccord", field: "moscow" }),
      d({ actor: "signal", action: "desaccord", field: "confidence" }),
      d({ action: "override", field: "confidence", after: 0.5 }),
    ]);
    expect(m.disagreements).toHaveLength(2);
  });
});
