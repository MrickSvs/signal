import { describe, expect, it } from "vitest";
import { parseDigestMarkdown, pendingDecisions, readDigestContent, splitIds } from "./content";

const facts = { period: { start: null, end: "2026-10-03T04:00:00Z" } };
const writing = {
  alertes: "Aucune alerte ouverte.",
  nouveaux_retours: "",
  tendances: "",
  comptes_a_risque: "",
  classement: "",
  a_trancher: "",
};

describe("readDigestContent", () => {
  it("keeps a current digest as is", () => {
    const content = readDigestContent(
      {
        facts,
        writing: {
          ...writing,
          recommandations: [
            { titre: "Faire", justification: "Car R-001.", preuves: ["R-001"], confiance: "haute" },
          ],
        },
        writer: "modele",
        error: null,
        model: "claude-sonnet-5-5",
      },
      "autre",
    );
    expect(content.model).toBe("claude-sonnet-5-5");
    expect(content.writing.recommandations[0]).toEqual({
      titre: "Faire",
      justification: "Car R-001.",
      preuves: ["R-001"],
      confiance: "haute",
    });
  });

  it("reads a digest written before titles and model were stored", () => {
    const content = readDigestContent(
      {
        facts,
        writing: {
          ...writing,
          recommandations: [
            { action: "Prévenir le CSM", preuves: ["C-013"], confiance: "moyenne" },
          ],
        },
        writer: "modele",
        error: null,
      },
      "claude-sonnet-5-5",
    );
    expect(content.writing.recommandations[0]).toMatchObject({
      titre: "Prévenir le CSM",
      justification: "",
    });
    expect(content.model).toBe("claude-sonnet-5-5");
  });

  it("has no model for a plain rendering, and refuses a content without facts", () => {
    expect(
      readDigestContent({ facts, writing, writer: "repli", error: "x" }, "claude-sonnet-5-5").model,
    ).toBeNull();
    expect(() => readDigestContent({}, "m")).toThrow(/illisible/);
  });
});

describe("splitIds", () => {
  it("isolates every readable id", () => {
    expect(splitIds("I-29 : 15 retours (R-001, R-025.1) chez C-076.")).toEqual([
      { kind: "id", value: "I-29" },
      { kind: "text", value: " : 15 retours (" },
      { kind: "id", value: "R-001" },
      { kind: "text", value: ", " },
      { kind: "id", value: "R-025.1" },
      { kind: "text", value: ") chez " },
      { kind: "id", value: "C-076" },
      { kind: "text", value: "." },
    ]);
    expect(splitIds("Rien.")).toEqual([{ kind: "text", value: "Rien." }]);
  });
});

describe("parseDigestMarkdown", () => {
  it("reads headings, items and paragraphs", () => {
    expect(parseDigestMarkdown("Bonjour Léa.\n\n## Tendances\n- I-29 émergent\n1. Faire")).toEqual([
      { kind: "paragraph", text: "Bonjour Léa." },
      { kind: "heading", text: "Tendances" },
      { kind: "item", text: "I-29 émergent" },
      { kind: "item", text: "Faire" },
    ]);
  });
});

describe("pendingDecisions (CL-15)", () => {
  const empty = {
    insights_to_validate: [],
    backlog_to_validate: [],
    notion_conflicts: [],
    merges: [],
    splits: [],
    overrides_context_changed: [],
  };

  it("is empty when nothing waits", () => {
    expect(pendingDecisions(empty)).toEqual([]);
  });

  it("links each decision to the screen where it is handled, merges and splits included", () => {
    const rows = pendingDecisions({
      ...empty,
      insights_to_validate: ["I-12"],
      backlog_to_validate: ["US-001", "BUG-002"],
      notion_conflicts: ["D-004"],
      merges: [{ from: "I-05", into: "I-02" }],
      splits: [{ from: "I-03", into: "I-14" }],
      overrides_context_changed: [{ insight_id: "I-07", param: "impact" }],
    });
    expect(rows.map((r) => [r.label, r.href])).toEqual([
      ["1 insight à valider", "/insights?statut=propose"],
      ["2 éléments du backlog à valider", "/backlog?statut=brouillon"],
      ["1 conflit Notion", "/backlog?conflits=notion"],
      ["Fusion d'insights", "/insights/I-02"],
      ["Scission d'insight", "/insights/I-14"],
      ["Override au contexte modifié", "/priorisation?insight=I-07"],
    ]);
    expect(rows[3]!.relation).toEqual({ left: "I-02", verb: "a absorbé", right: "I-05" });
    expect(rows[4]!.relation).toEqual({ left: "I-14", verb: "détaché de", right: "I-03" });
    expect(rows[5]!.param).toBe("impact");
  });
});
