import { describe, expect, it } from "vitest";
import { dossierSummary } from "@/server/queries/shell";
import { alertActionMessage, discussAlertMessage, type AlertSubject } from "./alerts";

const alert = (action: AlertSubject["action"]): AlertSubject => ({
  kind: "nouveau_sujet",
  insight_id: "I-52",
  action,
});

describe("alert messages", () => {
  it("turns each proposed action into a request to Signal, never a direct write", () => {
    expect(alertActionMessage(alert({ type: "valider_insight", cible: "I-52" }))).toMatch(
      /^Accepte l'insight proposé I-52 : .*« Nouveau sujet » sur I-52\.$/,
    );
    expect(alertActionMessage(alert({ type: "rediger_backlog", cible: "I-52" }))).toContain(
      "Rédige le backlog de I-52",
    );
    expect(alertActionMessage(alert({ type: "prevenir_csm", cible: "C-013" }))).toContain(
      "Je l'enverrai moi-même",
    );
  });

  it("has nothing to do without an action or a target", () => {
    expect(alertActionMessage(alert(null))).toBeNull();
    expect(alertActionMessage(alert({ type: "aucune", cible: null }))).toBeNull();
    expect(alertActionMessage(alert({ type: "valider_insight", cible: null }))).toBeNull();
  });

  it("pre-fills « En parler à Signal »", () => {
    expect(discussAlertMessage(alert(null))).toBe(
      "À propos de l'alerte « Nouveau sujet » sur I-52 : ",
    );
  });

  it("reads the cards' summary from a stored dossier, ignoring an unknown action", () => {
    expect(
      dossierSummary({
        titre: "T",
        confiance: "haute",
        action: { type: "prevenir_csm", cible: "C-013" },
      }),
    ).toEqual({ titre: "T", confiance: "haute", action: { type: "prevenir_csm", cible: "C-013" } });
    expect(dossierSummary({ erreur: "budget" })).toEqual({
      titre: null,
      confiance: null,
      action: null,
    });
    expect(dossierSummary({ action: { type: "envoyer_mail", cible: "x" } }).action).toBeNull();
    expect(dossierSummary(null).action).toBeNull();
  });
});
