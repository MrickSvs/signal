// Léa's answer to a recommendation of the digest (ADR-036): « fait » or « écartée », logged as a
// decision (CLAUDE.md rule 6). The next digests read it (pipeline/nodes/digest.ts) and do not
// propose the recommendation again without a new fact.
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";
import { readDigestContent } from "@/lib/digest/content";
import {
  RECOMMENDATION_ENTITY,
  recommendationKey,
  type RecommendationOutcome,
} from "@/lib/digest/handled";
import { MODELS } from "@/lib/llm/models";

export class RecommendationError extends Error {}

export type RecommendationAnswer = {
  digestId: string;
  /** 0-based position in the digest's recommendations. */
  index: number;
  outcome: RecommendationOutcome;
  reason?: string | null;
};

export async function answerRecommendation(
  db: Db,
  answer: RecommendationAnswer,
  clock: Date = new Date(),
): Promise<{ decision_id: string }> {
  const { data: digest, error } = await db
    .from("digests")
    .select("id, content")
    .eq("id", answer.digestId)
    .maybeSingle();
  if (error) throw new Error(`Lecture du digest (${error.message})`);
  if (!digest) throw new RecommendationError("Ce digest n'existe plus.");
  const recommendation = readDigestContent(digest.content, MODELS.reasoning).writing
    .recommandations[answer.index];
  if (!recommendation) throw new RecommendationError("Cette recommandation n'existe pas.");

  const key = recommendationKey(answer.digestId, answer.index);
  const { data: existing, error: existingError } = await db
    .from("decisions")
    .select("id")
    .eq("entity_type", RECOMMENDATION_ENTITY)
    .eq("entity_id", key);
  if (existingError) throw new Error(`Lecture des décisions (${existingError.message})`);
  if (existing && existing.length > 0) {
    throw new RecommendationError(`Recommandation déjà traitée (${existing[0].id}).`);
  }

  const { data: decision, error: insertError } = await db
    .from("decisions")
    .insert({
      actor: "po",
      source: "signal_ui",
      entity_type: RECOMMENDATION_ENTITY,
      entity_id: key,
      action: answer.outcome === "fait" ? "validation" : "rejet",
      field: "statut",
      before: null,
      after: {
        statut: answer.outcome,
        titre: recommendation.titre,
        preuves: recommendation.preuves,
      } as Json,
      reason: answer.reason?.trim() || null,
      created_at: clock.toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`Journal des décisions (${insertError.message})`);
  return { decision_id: decision!.id };
}
