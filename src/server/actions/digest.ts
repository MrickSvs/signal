"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { answerRecommendation, RecommendationError } from "@/services/recommendations";
import { z } from "zod";

const answerSchema = z.object({
  digestId: z.uuid(),
  index: z.number().int().min(0).max(9),
  outcome: z.enum(["fait", "ecartee"]),
  reason: z.string().max(500).nullish(),
});

export type RecommendationActionResult =
  { ok: true; decision_id: string } | { ok: false; message: string };

/** « Fait » / « Écarter » on a recommendation of the digest (ADR-036), logged as a decision. */
export async function answerRecommendationAction(
  input: z.input<typeof answerSchema>,
): Promise<RecommendationActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Réponse invalide." };
  try {
    const { decision_id } = await answerRecommendation(getDb(), parsed.data, getDemoNow());
    revalidatePath("/");
    return { ok: true, decision_id };
  } catch (error) {
    if (error instanceof RecommendationError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: "La recommandation n'a pas pu être mise à jour. Réessaie." };
  }
}
