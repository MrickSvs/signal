import { describe, expect, it } from "vitest";
import type { DetailFeedback, InsightDetail } from "@/server/queries/insights";
import { compactInsight, type BacklogSummary } from "./get-insight";
import { LIST_LIMIT, VERBATIM_LIMIT } from "./shared";

const feedback = (n: number, extra: Partial<DetailFeedback> = {}): DetailFeedback => ({
  id: `R-${String(n).padStart(3, "0")}`,
  channel: "email_client",
  // Newest first, as getInsightDetail sorts them.
  received_at: `2026-09-${String(30 - n).padStart(2, "0")}T10:00:00Z`,
  subject: null,
  author_name: null,
  summary: `Résumé ${n}`,
  customer: { id: `C-${String(n).padStart(3, "0")}`, name: `Compte ${n}`, plan: "pro" },
  is_prospect: false,
  similarity: null,
  ...extra,
});

/** Only the fields compactInsight reads; the others of the table row do not matter here. */
function detail(extra: Partial<InsightDetail> = {}): InsightDetail {
  const feedbacks = Array.from({ length: 8 }, (_, i) => feedback(i + 1));
  return {
    id: "I-07",
    title: "Droits par client",
    status: "actif",
    origin: "retours",
    merged_into: null,
    product_area: "permissions",
    problem_statement: "Les agences ne peuvent pas limiter ce que voit chaque client.",
    expressed: Array.from({ length: 10 }, (_, i) => ({
      solution: `Demande ${i}`,
      frequency: 10 - i,
    })),
    accounts_count: 7,
    unidentified: 1,
    mrr_exposed: 4200,
    renewals_90d: 2,
    channelCounts: [
      ["email_client", 5],
      ["ticket_support", 3],
    ],
    breakdown: { plans: { pro: 4, business: 3 }, segments: { agence: 7 } },
    trendData: { weekly: [1, 2, 3], growth: 2.5, is_emerging: true },
    feedbacks,
    // Representative feedbacks come first in the verbatims, even when they are older.
    representative: [feedbacks[6], feedbacks[2]],
    accounts: Array.from({ length: 7 }, (_, i) => ({
      id: `C-${String(i + 1).padStart(3, "0")}`,
      name: `Compte ${i + 1}`,
      status: "client",
      plan: "pro",
      segment: "agence",
      mrr_eur: 600,
      renewal_date: "2026-12-01",
      health: "orange",
      feedback_ids: Array.from({ length: 12 }, (_, k) => `R-${String(100 + k)}`),
    })),
    tensions: [],
    absorbed: [{ id: "I-12", title: "Accès client" }],
    score: null,
    ...extra,
  } as unknown as InsightDetail;
}

const noBacklog: BacklogSummary = { epics: [], items: [] };

describe("compactInsight (get_insight output)", () => {
  it("gives the representative verbatims first, without duplicates, 5 at most", () => {
    const out = compactInsight(detail(), new Map(), noBacklog);
    expect(out.verbatims).toHaveLength(VERBATIM_LIMIT);
    expect(out.verbatims.map((v) => v.id)).toEqual(["R-007", "R-003", "R-001", "R-002", "R-004"]);
    expect(new Set(out.verbatims.map((v) => v.id)).size).toBe(VERBATIM_LIMIT);
  });

  it("quotes the full text when known, else the summary, cut at 400 characters with a marker", () => {
    const long = "mot ".repeat(200);
    const texts = new Map([
      ["R-007", long],
      ["R-003", "Texte court du retour."],
    ]);
    const [first, second, third] = compactInsight(detail(), texts, noBacklog).verbatims;
    expect(first.texte).toMatch(/… \[tronqué\]$/);
    expect(first.texte!.length).toBeLessThanOrEqual(400 + " [tronqué]".length + 1);
    expect(second.texte).toBe("Texte court du retour.");
    expect(third.texte).toBe("Résumé 1");
  });

  it("names the account of a verbatim, or says it is a prospect", () => {
    const prospect = feedback(9, { customer: null, is_prospect: true });
    const out = compactInsight(detail({ representative: [prospect] }), new Map(), noBacklog);
    expect(out.verbatims[0].compte).toBe("prospect");
    expect(out.verbatims[1].compte).toBe("C-001 Compte 1");
  });

  it("counts from the pipeline's figures and bounds every list", () => {
    const out = compactInsight(detail(), new Map(), noBacklog);
    expect(out.comptages).toMatchObject({
      retours: 8,
      comptes: 7,
      retours_sans_compte: 1,
      mrr_expose_eur: 4200,
      renouvellements_90j: 2,
      canaux: { email_client: 5, ticket_support: 3 },
    });
    expect(out.demandes_exprimees).toHaveLength(8);
    expect(out.demandes_exprimees[0]).toEqual({ demande: "Demande 0", frequence: 10 });
    expect(out.comptes_cles).toHaveLength(5);
    expect(out.comptes_cles[0].retours).toHaveLength(LIST_LIMIT);
    expect(out.absorbes).toEqual(["I-12"]);
  });

  it("dates the first feedback from the oldest one, and gives none without feedbacks", () => {
    expect(compactInsight(detail(), new Map(), noBacklog).premier_retour).toBe("2026-09-22");
    const empty = compactInsight(
      detail({ feedbacks: [], representative: [] }),
      new Map(),
      noBacklog,
    );
    expect(empty.premier_retour).toBeNull();
    expect(empty.verbatims).toEqual([]);
  });

  it("gives the PO's final MoSCoW when an override exists, null otherwise", () => {
    const score = {
      reach_mode: "comptes",
      rank: 3,
      rice: "12.5",
      reach: "10",
      impact: "2",
      impact_rationale: "Bloque le partage avec le client final.",
      confidence: "0.8",
      effort_weeks: "1.33",
      effort_source: "estimation_initiale",
      robustness: "robuste",
      alignment: "aligne",
      okr_refs: ["O1-KR2"],
      moscow_reco: "should",
      moscow_rationale: "Premier quartile.",
      rule_flags: [],
      overrides: [
        { param: "impact", value: 3, reason: "Demande de la direction", context_changed: false },
      ],
    };
    const recommended = compactInsight(
      detail({ score: score as unknown as InsightDetail["score"] }),
      new Map(),
      noBacklog,
    ).score!;
    expect(recommended).toMatchObject({ rang: 3, rice: 12.5, moscow_reco: "should" });
    expect(recommended.moscow_final).toBeNull();
    expect(recommended.overrides).toEqual([
      {
        parametre: "impact",
        valeur: 3,
        raison: "Demande de la direction",
        contexte_modifie: false,
      },
    ]);

    const decided = compactInsight(
      detail({
        score: {
          ...score,
          overrides: [
            ...score.overrides,
            { param: "moscow", value: "must", reason: null, context_changed: false },
          ],
        } as unknown as InsightDetail["score"],
      }),
      new Map(),
      noBacklog,
    ).score!;
    expect(decided.moscow_final).toBe("must");
    expect(compactInsight(detail(), new Map(), noBacklog).score).toBeNull();
  });

  it("summarizes the backlog by status, with 10 ids at most", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `US-${String(i + 1).padStart(3, "0")}`,
      kind: "story",
      status: i < 9 ? "brouillon" : "envoye",
    }));
    const out = compactInsight(detail(), new Map(), {
      epics: [{ id: "E-01", title: "Droits" }],
      items,
    });
    expect(out.backlog).toMatchObject({
      epics: ["E-01"],
      elements: 12,
      par_statut: { brouillon: 9, envoye: 3 },
    });
    expect(out.backlog.ids).toHaveLength(LIST_LIMIT);
  });
});
