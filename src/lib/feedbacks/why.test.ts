import { describe, expect, it } from "vitest";
import { explainItem, type WhyItem } from "./why";

const options = { distanceThreshold: 0.28, minClusterSize: 2, watchMinItems: 3 };
const item: WhyItem = {
  type: "demande_fonctionnelle",
  product_area: "reporting_export",
  expressed_request: "un export Excel",
  underlying_problem: "rendre compte de l'avancement au client",
  existing_feature: false,
  watch: false,
};

describe("explainItem", () => {
  it("separates the expressed request from the problem and gives the similarity", () => {
    const lines = explainItem(
      item,
      [{ id: "I-03", status: "actif", similarity: 0.812, is_representative: true }],
      options,
    );
    expect(lines[0]).toContain("Demande fonctionnelle");
    expect(lines[0]).toContain("Reporting et export");
    expect(lines[1]).toContain("un export Excel");
    expect(lines[1]).toContain("rendre compte");
    expect(lines[2]).toContain("I-03");
    expect(lines[2]).toContain("0,81");
    expect(lines[2]).toContain("0,72");
    expect(lines[2]).toContain("représentatif");
  });

  it("flags an existing feature as a discoverability need (CL-05)", () => {
    const lines = explainItem({ ...item, existing_feature: true }, [], options);
    expect(lines.some((l) => l.includes("découvrabilité"))).toBe(true);
  });

  it("explains why praise, questions and « autre » are never grouped", () => {
    const lines = explainItem({ ...item, type: "autre", expressed_request: null }, [], options);
    expect(lines.at(-1)).toContain("aucun insight");
  });

  it("tells a watched item from an isolated one", () => {
    expect(explainItem({ ...item, watch: true }, [], options).at(-1)).toContain("à surveiller");
    expect(explainItem(item, [], options).at(-1)).toContain("isolé");
  });

  it("mentions a rejected insight and omits an unknown similarity", () => {
    const [, , line] = explainItem(
      item,
      [{ id: "I-12", status: "rejete", similarity: null, is_representative: false }],
      options,
    );
    expect(line).toBe("Rattaché à I-12 (insight rejeté par le PO).");
  });
});
