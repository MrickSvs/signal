import { describe, expect, it } from "vitest";
import type { BacklogPlan, DraftResult } from "@/services/backlog";
import { compactDraft } from "./draft-backlog-items";
import { compactUpdate } from "./update-backlog-item";

const plan = (overrides: Partial<BacklogPlan> = {}): BacklogPlan => ({
  proposed: "epic_stories",
  proposed_reason: "Besoin fonctionnel, fourchette 13 à 21 points.",
  chosen: "epic_stories",
  deviation_reason: null,
  discoverability: null,
  range: { min: 13, max: 21 },
  confidence: "moyenne",
  no_close_analogue: false,
  sum: 16,
  sum_outside_range: false,
  range_note: null,
  epic_id: "E-01",
  item_ids: ["US-001", "US-002"],
  drafted_at: "2026-06-01T12:00:00.000Z",
  ...overrides,
});

const done = (p: BacklogPlan): DraftResult => ({
  needs_confirmation: false,
  insight_id: "I-31",
  plan: p,
  epic: { id: "E-01", title: "Travailler avec ses clients", kept: false },
  items: [
    {
      id: "US-001",
      kind: "story",
      title: "Inviter",
      points: 8,
      components: ["permissions"],
      evidence: ["R-012"],
    },
    {
      id: "US-002",
      kind: "story",
      title: "Révoquer",
      points: 8,
      components: ["permissions"],
      evidence: ["R-088"],
    },
  ],
  replaced: [],
  kept: [],
  analogues: [{ ticket_id: "T-117", similarity: 0.71, close: true }],
  effort: { before: 5.67, after: 5.33, decision: "D-012" },
});

describe("compactDraft", () => {
  it("reports the format, the items with ids and points, the analogues and the refined effort", () => {
    const out = compactDraft(done(plan()));
    expect(out).toMatchObject({
      insight: "I-31",
      epic: "E-01 Travailler avec ses clients",
      elements: [
        { id: "US-001", type: "story", points: 8 },
        { id: "US-002", type: "story", points: 8 },
      ],
      total_points: 16,
      fourchette_insight: "13–21 points, confiance moyenne",
      tickets_analogues: ["T-117"],
      effort_semaines: { avant: 5.67, apres: 5.33 },
      decision_ajustement: "D-012",
    });
    expect(out).not.toHaveProperty("alerte");
  });

  it("makes a deviation, an out-of-range total and a missing analogue visible (CL-20)", () => {
    const out = compactDraft(
      done(
        plan({
          chosen: "story",
          deviation_reason: "Une seule livraison.",
          sum_outside_range: true,
          range_note: "Découpage plus fin que prévu.",
          no_close_analogue: true,
        }),
      ),
    );
    expect(out).toMatchObject({
      format: { ecart: "Une seule livraison." },
      hors_fourchette: "Découpage plus fin que prévu.",
      alerte: expect.stringContaining("Aucun ticket analogue proche"),
    });
  });

  it("asks for confirmation before replacing drafts (CL-33)", () => {
    expect(
      compactDraft({
        needs_confirmation: true,
        insight_id: "I-31",
        drafts: [{ id: "US-003", kind: "story", title: "Inviter" }],
        kept: [{ id: "US-001", kind: "story", title: "Révoquer", status: "envoye" }],
        message: "",
      }),
    ).toMatchObject({
      confirmation_requise: true,
      brouillons_remplaces: ["US-003 Inviter"],
      conserves: ["US-001 (envoye) Révoquer"],
    });
  });
});

describe("compactUpdate", () => {
  it("asks for confirmation before a change of type, then reports both ids (CL-54)", () => {
    expect(
      compactUpdate({
        needs_confirmation: true,
        id: "US-001",
        from: "story",
        to: "bug",
        message: "",
      }),
    ).toMatchObject({ confirmation_requise: true, changement: "story → bug" });
    expect(
      compactUpdate({
        needs_confirmation: false,
        id: "BUG-004",
        previous_id: "US-001",
        kind: "bug",
        title: "Les invitations n'arrivent pas",
        changed: ["kind"],
        decision: "D-013",
        effort: null,
      }),
    ).toEqual({
      element: "BUG-004",
      ancien_id: "US-001",
      type: "bug",
      titre: "Les invitations n'arrivent pas",
      modifie: ["kind"],
      decision: "D-013",
      statut: "brouillon",
    });
  });
});
