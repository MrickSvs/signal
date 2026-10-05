// Alerts as Léa handles them (SPEC §10.10, PLAN 4.5): the closed list of actions a dossier may
// propose, and the chat messages behind « Faire l'action proposée » and « En parler à Signal ».
// Pure, shared by the investigation (server) and the alert cards (client).
import { ALERT_KIND_LABELS } from "@/lib/labels";
import type { Enums } from "@/lib/db/types";

export const DOSSIER_ACTIONS = [
  "valider_insight",
  "rediger_backlog",
  "prevenir_csm",
  "aucune",
] as const;
export type DossierAction = (typeof DOSSIER_ACTIONS)[number];

export const DOSSIER_ACTION_LABELS: Record<DossierAction, string> = {
  valider_insight: "Valider l'insight",
  rediger_backlog: "Rédiger le backlog",
  prevenir_csm: "Prévenir le CSM",
  aucune: "Aucune action",
};

export type AlertSubject = {
  kind: Enums<"alert_kind">;
  insight_id: string | null;
  action: { type: DossierAction; cible: string | null } | null;
};

const origin = (alert: AlertSubject) =>
  `c'est l'action proposée par le dossier de l'alerte « ${ALERT_KIND_LABELS[alert.kind]} »${alert.insight_id ? ` sur ${alert.insight_id}` : ""}`;

/**
 * What Signal is asked when Léa clicks « Faire l'action proposée »: the action goes through the
 * agent, so a decision still ends on an approval card (apply_decision) and nothing is sent.
 * Null when the dossier proposes no action.
 */
export function alertActionMessage(alert: AlertSubject): string | null {
  const action = alert.action;
  if (!action?.cible || action.type === "aucune") return null;
  switch (action.type) {
    case "valider_insight":
      return `Accepte l'insight proposé ${action.cible} : ${origin(alert)}.`;
    case "rediger_backlog":
      return `Rédige le backlog de ${action.cible} : ${origin(alert)}.`;
    case "prevenir_csm":
      return `Prépare un message court pour le CSM du compte ${action.cible} (${origin(alert)}). Je l'enverrai moi-même.`;
  }
}

/** The pre-filled start of « En parler à Signal » (the dossier itself goes in the briefing). */
export function discussAlertMessage(alert: AlertSubject): string {
  return `À propos de l'alerte « ${ALERT_KIND_LABELS[alert.kind]} »${alert.insight_id ? ` sur ${alert.insight_id}` : ""} : `;
}
