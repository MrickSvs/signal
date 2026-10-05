import { describe, expect, it } from "vitest";
import { BRIEFING_LIMITS, idList, pageLabel, renderBriefing, type BriefingFacts } from "./briefing";

const facts = (extra: Partial<BriefingFacts> = {}): BriefingFacts => ({
  since: "2026-06-01T08:00:00Z",
  top: [
    {
      insight_id: "I-03",
      title: "Notifications perdues",
      rank: 1,
      moscow_reco: "must",
      moscow_final: null,
    },
    {
      insight_id: "I-07",
      title: "Vue Gantt",
      rank: 2,
      moscow_reco: "could",
      moscow_final: "should",
    },
  ],
  feedbacks: {
    total: 4,
    by_channel: { email_client: 3, ticket_support: 1 },
    ids: ["R-101", "R-102", "R-103", "R-104"],
    confirming_known: ["R-101"],
  },
  alerts: [],
  emerging: [],
  new_insights: [],
  moves: [],
  has_history: true,
  accounts_at_risk: [],
  pending: {
    insights_to_validate: [],
    backlog_to_validate: [],
    notion_conflicts: [],
    merges: [],
    splits: [],
    overrides_context_changed: [],
  },
  decisions: [],
  page: null,
  ...extra,
});

describe("renderBriefing", () => {
  it("states the ranking, the new feedbacks and the PO's final MoSCoW", () => {
    const text = renderBriefing(facts());
    expect(text).toContain("1. I-03 « Notifications perdues » · MoSCoW recommandé Must");
    expect(text).toContain(
      "2. I-07 « Vue Gantt » · MoSCoW recommandé Could → décision de Léa : Should",
    );
    expect(text).toContain(
      "4 nouveau(x) retour(s) (E-mail client 3, Ticket support 1), dont 1 confirment un sujet connu",
    );
    expect(text).toContain("Décisions en attente\n- aucune");
    expect(text).toContain("aucun mouvement de rang");
  });

  it("says when there is no visit nor history (first run, CL-18)", () => {
    const text = renderBriefing(facts({ since: null, has_history: false, top: [] }));
    expect(text).toContain("Aucune visite enregistrée");
    expect(text).toContain("classement vide");
    expect(text).toContain("pas d'historique");
  });

  it("bounds every list and counts what it leaves out", () => {
    const many = Array.from({ length: 12 }, (_, i) => `I-${String(i + 10).padStart(2, "0")}`);
    const text = renderBriefing(
      facts({
        alerts: many.map((id, i) => ({
          id: `al-${i}`,
          kind: "emergent" as const,
          insight_id: id,
          insight_title: "Sujet",
          feedback_ids: ["R-001", "R-002", "R-003", "R-004"],
          dossier_status: "pret" as const,
          dossier: "…",
        })),
        pending: { ...facts().pending, insights_to_validate: many },
      }),
    );
    expect(text.match(/^- al-/gm)).toHaveLength(BRIEFING_LIMITS.list);
    expect(text).toContain("… et 7 de plus");
    expect(text).toContain("12 insight(s) proposé(s) à valider");
    expect(text).toContain("(+4)");
    expect(text).toContain("R-001, R-002, R-003 … (+1)");
  });

  it("names the current page and its entity", () => {
    const text = renderBriefing(
      facts({ page: { page: "/insights/I-07", entity_id: "I-07", entity_label: "Vue Gantt" } }),
    );
    expect(text).toContain("Page courante : Insights · I-07 « Vue Gantt »");
  });

  it("stays compact (~1 500 tokens at most) on a busy day", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `R-${100 + i}`);
    const busy = facts({
      top: Array.from({ length: 10 }, (_, i) => ({
        insight_id: `I-${10 + i}`,
        title: "Un titre d'insight assez long pour peser son poids",
        rank: i + 1,
        moscow_reco: "should",
        moscow_final: "must",
      })),
      feedbacks: { total: 50, by_channel: { email_client: 50 }, ids, confirming_known: ids },
      moves: ids.map((id, i) => ({ insight_id: `I-${i}`, title: id, from: i, to: i + 1 })),
      pending: { ...facts().pending, backlog_to_validate: ids, insights_to_validate: ids },
    });
    // ~4 characters per token in French.
    expect(renderBriefing(busy).length / 4).toBeLessThan(1500);
  });
});

describe("helpers", () => {
  it("idList counts the ids beyond the limit", () => {
    expect(idList([], 3)).toBe("aucun");
    expect(idList(["R-001", "R-002"], 3)).toBe("R-001, R-002");
    expect(idList(["a", "b", "c", "d"], 2)).toBe("a, b … (+2)");
  });

  it("pageLabel maps a path to its screen", () => {
    expect(pageLabel("/")).toBe("Digest");
    expect(pageLabel("/priorisation")).toBe("Priorisation");
    expect(pageLabel("/insights/I-07")).toBe("Insights");
    expect(pageLabel("/inconnue")).toBe("/inconnue");
  });

  it("adds the dossier of the alert Léa wants to talk about", () => {
    const focus = {
      id: "a1",
      kind: "churn" as const,
      insight_id: "I-27",
      feedback_ids: ["R-226"],
      dossier_status: "pret" as const,
      dossier: "**Faits**\n- R-226 cite un concurrent.",
    };
    const text = renderBriefing(facts({ alert_in_focus: focus }));
    expect(text).toContain("### Alerte dont Léa veut parler");
    expect(text).toContain("R-226 cite un concurrent.");
    const failed = renderBriefing(
      facts({ alert_in_focus: { ...focus, dossier_status: "echec", dossier: null } }),
    );
    expect(failed).toContain("Dossier indisponible");
    expect(renderBriefing(facts())).not.toContain("Alerte dont Léa");
  });
});
