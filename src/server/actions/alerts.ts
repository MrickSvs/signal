"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { DOSSIER_ACTIONS } from "@/lib/alerts";
import { AlertError, answerAlert } from "@/services/alerts";
import { listOpenAlerts, type OpenAlert } from "@/server/queries/shell";
import { z } from "zod";

// Léa's answers to an alert from its card (header list or chat), SPEC §10.10.

const answerSchema = z.object({
  alertId: z.uuid(),
  answer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("seen") }),
    z.object({ kind: z.literal("ignore"), reason: z.string().max(500).nullish() }),
    z.object({
      kind: z.literal("act"),
      action: z.object({ type: z.enum(DOSSIER_ACTIONS), cible: z.string().max(20).nullable() }),
    }),
  ]),
});

export type AlertActionResult =
  { ok: true; decision_id: string | null } | { ok: false; message: string };

export async function answerAlertAction(
  input: z.input<typeof answerSchema>,
): Promise<AlertActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Réponse invalide." };
  try {
    const { decision_id } = await answerAlert(getDb(), parsed.data.alertId, parsed.data.answer);
    // The badge lives in the layout's header: every page shows it.
    revalidatePath("/", "layout");
    return { ok: true, decision_id };
  } catch (error) {
    if (error instanceof AlertError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: "L'alerte n'a pas pu être mise à jour. Réessaie." };
  }
}

/** Open alerts and their dossier state, for the chat cards (polled while an investigation runs). */
export async function loadOpenAlerts(): Promise<OpenAlert[] | null> {
  try {
    return await listOpenAlerts(getDb());
  } catch (error) {
    console.error(error);
    return null;
  }
}
