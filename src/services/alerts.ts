// Léa's answer to an alert (SPEC §10.10): she opens it (« vue »), does the proposed
// action (« traitee »: the action itself goes through the chat and its approval card) or ignores
// it (« ignoree »). Handling and ignoring are journaled in decisions (rule 6).
import type { Db } from "@/lib/db/create";
import type { Json, Tables } from "@/lib/db/types";

export class AlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertError";
  }
}

type AlertStatus = Tables<"alerts">["status"];
const OPEN = new Set<AlertStatus>(["nouvelle", "vue"]);

export type AlertAnswer =
  | { kind: "seen" }
  | { kind: "ignore"; reason?: string | null }
  | { kind: "act"; action: { type: string; cible: string | null } };

const TARGET: Record<AlertAnswer["kind"], AlertStatus> = {
  seen: "vue",
  ignore: "ignoree",
  act: "traitee",
};

/** Applies Léa's answer to an open alert; returns the decision id when one is journaled. */
export async function answerAlert(
  db: Db,
  alertId: string,
  answer: AlertAnswer,
  clock: Date = new Date(),
): Promise<{ status: AlertStatus; decision_id: string | null }> {
  const { data: alert, error } = await db
    .from("alerts")
    .select("id, status, kind, insight_id")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de l'alerte (${error.message})`);
  if (!alert) throw new AlertError("Alerte introuvable.");
  if (!OPEN.has(alert.status)) {
    if (answer.kind === "seen") return { status: alert.status, decision_id: null };
    throw new AlertError("Cette alerte est déjà traitée ou ignorée.");
  }
  const status = TARGET[answer.kind];
  if (answer.kind === "seen" && alert.status === "vue") return { status, decision_id: null };

  const { error: updateError } = await db.from("alerts").update({ status }).eq("id", alertId);
  if (updateError) throw new Error(`Mise à jour de l'alerte (${updateError.message})`);
  if (answer.kind === "seen") return { status, decision_id: null };

  const { data: decision, error: decisionError } = await db
    .from("decisions")
    .insert({
      actor: "po",
      source: "signal_ui",
      entity_type: "alert",
      entity_id: alertId,
      action: answer.kind === "ignore" ? "rejet" : "validation",
      field: answer.kind === "ignore" ? "statut" : "action_proposee",
      before: { status: alert.status, kind: alert.kind, insight_id: alert.insight_id } as Json,
      after: (answer.kind === "ignore"
        ? { status }
        : { status, action: answer.action.type, cible: answer.action.cible }) as Json,
      reason: answer.kind === "ignore" ? answer.reason?.trim() || null : null,
      created_at: clock.toISOString(),
    })
    .select("id")
    .single();
  if (decisionError) throw new Error(`Journal de la décision (${decisionError.message})`);
  return { status, decision_id: decision.id as string };
}
