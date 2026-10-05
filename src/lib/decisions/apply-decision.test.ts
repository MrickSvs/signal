import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { checkDecision, decisionEntity, describeDecision } from "./apply-decision";

const { weighting } = await loadContextPack();

const ok = (input: unknown) => {
  const result = checkDecision(input, weighting);
  if (!result.ok) throw new Error(result.error);
  return result.request;
};
const error = (input: unknown) => {
  const result = checkDecision(input, weighting);
  return result.ok ? null : result.error;
};

describe("checkDecision (CL-23)", () => {
  it("accepts overrides on lib/scoring's scales, Confidence in %", () => {
    expect(
      ok({ kind: "override", target: "I-04", param: "impact", value: 3, reason: "Salon" }),
    ).toEqual({
      kind: "override",
      insight_id: "I-04",
      param: "impact",
      value: 3,
      reason: "Salon",
    });
    expect(
      ok({ kind: "override", target: "I-04", param: "confidence", value: 80, reason: "r" }),
    ).toMatchObject({ value: 80 });
    expect(
      ok({ kind: "override", target: "I-04", param: "effort", value: 2.5, reason: "r" }),
    ).toMatchObject({ value: 2.5 });
  });

  it("refuses an invalid override value, a missing param or reason", () => {
    expect(
      error({ kind: "override", target: "I-04", param: "impact", value: 4, reason: "r" }),
    ).toMatch(/Impact attendu/);
    expect(
      error({ kind: "override", target: "I-04", param: "confidence", value: 0.8, reason: "r" }),
    ).toMatch(/Confidence attendue/);
    expect(
      error({ kind: "override", target: "I-04", param: "reach", value: 0, reason: "r" }),
    ).toMatch(/Reach strictement positif/);
    expect(
      error({ kind: "override", target: "I-04", param: "effort", value: -1, reason: "r" }),
    ).toMatch(/Effort strictement positif/);
    expect(error({ kind: "override", target: "I-04", param: "impact", value: 2 })).toMatch(
      /raison est obligatoire/,
    );
    expect(error({ kind: "override", target: "I-04", value: 2, reason: "r" })).toMatch(
      /param attendu/,
    );
    expect(
      error({ kind: "override", target: "I-04", param: "impact", value: "haut", reason: "r" }),
    ).toMatch(/numérique/);
    expect(
      error({ kind: "override", target: "US-001", param: "impact", value: 2, reason: "r" }),
    ).toMatch(/insight attendu/);
  });

  it("checks MoSCoW and backlog validations; MoSCoW needs no reason", () => {
    expect(ok({ kind: "moscow", target: "I-04", value: "Must" })).toMatchObject({ value: "must" });
    expect(error({ kind: "moscow", target: "I-04", value: "urgent" })).toMatch(/MoSCoW attendu/);
    expect(ok({ kind: "validation", target: "BUG-002", value: "valide" })).toMatchObject({
      item_id: "BUG-002",
    });
    expect(error({ kind: "validation", target: "I-04", value: "valide" })).toMatch(
      /élément du backlog/,
    );
    expect(error({ kind: "validation", target: "US-001", value: "envoye" })).toMatch(
      /valide, rejete/,
    );
  });

  it("maps the four insight reviews onto the shared review contract (CL-51)", () => {
    expect(ok({ kind: "insight_review", target: "I-09", value: "accepter" })).toMatchObject({
      review: { action: "accepter", insight_ids: ["I-09"] },
    });
    expect(
      ok({
        kind: "insight_review",
        target: "I-09",
        value: "reformuler",
        title: "Exports illisibles",
        problem_statement: "Les exports PDF sont illisibles.",
      }),
    ).toMatchObject({
      review: { action: "reformuler", insight_id: "I-09", title: "Exports illisibles" },
    });
    expect(
      ok({ kind: "insight_review", target: "I-09", value: "fusionner", into: "I-02" }),
    ).toMatchObject({
      review: { action: "fusionner", into: "I-02" },
    });
    expect(error({ kind: "insight_review", target: "I-09", value: "fusionner" })).toMatch(
      /Revue d'insight/,
    );
    expect(
      error({ kind: "insight_review", target: "I-09", value: "reformuler", title: "X" }),
    ).toMatch(/Revue d'insight/);
    expect(error({ kind: "insight_review", target: "I-09", value: "supprimer" })).toMatch(
      /action attendue/,
    );
  });

  it("carries Signal's disagreement and names the decision's entity", () => {
    const request = ok({
      kind: "moscow",
      target: "I-04",
      value: "must",
      signal_position: "  Contre les preuves. ",
    });
    expect(request.disagreement).toBe("Contre les preuves.");
    expect(decisionEntity(request)).toEqual({ entity_type: "insight", entity_id: "I-04" });
    expect(decisionEntity(ok({ kind: "validation", target: "TT-003", value: "rejete" }))).toEqual({
      entity_type: "backlog_item",
      entity_id: "TT-003",
    });
  });
});

describe("override values sent as text", () => {
  it("accepts a number written as text, and still checks it on the scale", () => {
    for (const value of ["50", "50 %", " 50% "]) {
      expect(
        ok({ kind: "override", target: "I-30", param: "confidence", value, reason: "r" }),
      ).toMatchObject({ value: 50 });
    }
    expect(
      ok({ kind: "override", target: "I-30", param: "impact", value: "0,5", reason: "r" }),
    ).toMatchObject({ value: 0.5 });
    expect(
      error({ kind: "override", target: "I-30", param: "confidence", value: "70", reason: "r" }),
    ).toMatch(/Confidence attendue/);
    expect(
      error({ kind: "override", target: "I-30", param: "impact", value: "élevé", reason: "r" }),
    ).toMatch(/numérique/);
  });
});

describe("describeDecision", () => {
  it("states the exact decision in plain words", () => {
    expect(describeDecision(ok({ kind: "moscow", target: "I-04", value: "wont" }))).toBe(
      "MoSCoW final de I-04 : Won't",
    );
    expect(
      describeDecision(
        ok({ kind: "override", target: "I-04", param: "confidence", value: 50, reason: "r" }),
      ),
    ).toBe("Confidence de I-04 fixé à 50 %");
    expect(describeDecision(ok({ kind: "validation", target: "US-004", value: "valide" }))).toBe(
      "Valider le brouillon US-004",
    );
    expect(
      describeDecision(ok({ kind: "insight_review", target: "I-09", value: "accepter" })),
    ).toBe("Accepter l'insight proposé I-09");
  });
});
