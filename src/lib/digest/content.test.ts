import { describe, expect, it } from "vitest";
import {
  digestLede,
  digestPulse,
  evidenceNotInText,
  parseDigestMarkdown,
  pendingDecisions,
  quietSections,
  readDigestContent,
  splitIds,
} from "./content";

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
      merges: [{ from: "I-05", into: "I-02" }],
      splits: [{ from: "I-03", into: "I-14" }],
      overrides_context_changed: [{ insight_id: "I-07", param: "impact" }],
    });
    expect(rows.map((r) => [r.label, r.href])).toEqual([
      ["1 insight à valider", "/insights?statut=propose"],
      ["2 éléments du backlog à valider", "/backlog?statut=brouillon"],
      ["Fusion d'insights", "/insights/I-02"],
      ["Scission d'insight", "/insights/I-14"],
      ["Override au contexte modifié", "/priorisation?insight=I-07"],
    ]);
    expect(rows[2]!.relation).toEqual({ left: "I-02", verb: "a absorbé", right: "I-05" });
    expect(rows[3]!.relation).toEqual({ left: "I-14", verb: "détaché de", right: "I-03" });
    expect(rows[4]!.param).toBe("impact");
  });
});

const emptyFacts = {
  feedbacks: { total: 0, by_channel: {}, ids: [], confirming_known: [] },
  emerging: [],
  new_insights: [],
  accounts_at_risk: [],
  ranking: { has_history: true, moves: [], top: [] },
  pending: {
    insights_to_validate: [],
    backlog_to_validate: [],
    merges: [],
    splits: [],
    overrides_context_changed: [],
  },
};

describe("digestPulse", () => {
  it("counts every pending item, the accounts and the new feedbacks", () => {
    const pulse = digestPulse(
      {
        ...emptyFacts,
        feedbacks: { ...emptyFacts.feedbacks, total: 4 },
        accounts_at_risk: [
          {
            customer_id: "C-013",
            name: "Studio Bastide",
            plan: "enterprise",
            renewal_in_days: 37,
            health: "rouge",
            churn_feedback_ids: [],
            insight_ids: [],
          },
        ],
        pending: {
          insights_to_validate: ["I-12"],
          backlog_to_validate: ["US-001", "US-002"],
          merges: [{ from: "I-05", into: "I-02" }],
          splits: [],
          overrides_context_changed: [{ insight_id: "I-03", param: "impact" }],
        },
      },
      2,
      3,
    );
    expect(pulse).toEqual({
      alerts: 2,
      recommendations: 3,
      pending: 5,
      accountsAtRisk: 1,
      newFeedbacks: 4,
    });
  });
});

describe("digestLede", () => {
  const zero = { alerts: 0, recommendations: 0, pending: 0, accountsAtRisk: 0, newFeedbacks: 0 };

  it("puts what waits for a decision first, with singulars and plurals", () => {
    expect(
      digestLede({ ...zero, alerts: 1, recommendations: 3, pending: 5, newFeedbacks: 1 }, false),
    ).toBe(
      "1 alerte attend ta décision. Signal a 3 recommandations. 5 décisions sont en attente. 1 nouveau retour depuis ta dernière visite.",
    );
    expect(digestLede({ ...zero, alerts: 2, recommendations: 1, pending: 1 }, false)).toBe(
      "2 alertes attendent ta décision. Signal a 1 recommandation. 1 décision est en attente. Aucun nouveau retour depuis ta dernière visite.",
    );
  });

  it("says when nothing waits, and does not count new feedbacks on a first digest", () => {
    expect(digestLede(zero, false)).toBe(
      "Rien n'attend ta décision. Aucun nouveau retour depuis ta dernière visite.",
    );
    expect(digestLede({ ...zero, newFeedbacks: 240 }, true)).toBe(
      "Rien n'attend ta décision. C'est le premier digest.",
    );
  });
});

describe("quietSections", () => {
  it("gathers every empty section", () => {
    expect(quietSections(emptyFacts, true)).toEqual([
      "aucune décision en attente",
      "aucune tendance émergente ni sujet nouveau",
      "aucun mouvement dans le classement",
      "aucun compte à risque",
      "aucun nouveau retour",
    ]);
  });

  it("says there is no ranking history yet on a first run (CL-18)", () => {
    const first = { ...emptyFacts, ranking: { has_history: false, moves: [], top: [] } };
    expect(quietSections(first, false)).toContain("pas encore d'historique de classement");
    expect(quietSections(first, false)).not.toContain("aucune décision en attente");
  });

  it("leaves out the sections that have something to show", () => {
    const busy = {
      ...emptyFacts,
      feedbacks: { ...emptyFacts.feedbacks, total: 3 },
      new_insights: [{ insight_id: "I-12", title: "T", ranked: false }],
      ranking: {
        has_history: true,
        moves: [{ insight_id: "I-35", title: "T", from: 9, to: null }],
        top: [],
      },
    };
    expect(quietSections(busy, false)).toEqual(["aucun compte à risque"]);
  });
});

describe("evidenceNotInText", () => {
  it("drops the ids the texts already cite, and duplicates", () => {
    expect(
      evidenceNotInText(
        ["C-013", "I-31", "R-078", "R-078", "R-111"],
        ["Prévenir le CSM", "Deux comptes rattachés à I-31 (C-013 à J+37)."],
      ),
    ).toEqual(["R-078", "R-111"]);
    expect(evidenceNotInText(["R-001"], [])).toEqual(["R-001"]);
  });
});
