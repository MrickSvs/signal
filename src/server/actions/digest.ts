"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { generateDigest } from "@/pipeline/daily";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";
import { answerRecommendation, RecommendationError } from "@/services/recommendations";
import { z } from "zod";

export type RegenerateResult =
  | { ok: true; id: string; writer: "modele" | "repli"; costEur: number; durationMs: number }
  | { ok: false; message: string };

/**
 * « Régénérer » (SPEC §12.2, on demand): writes a new digest from the facts as they are now, like
 * `pnpm digest`. One reasoning call (~0.03 €); feedbacks not processed yet are left to the cron.
 */
export async function regenerateDigest(): Promise<RegenerateResult> {
  after(flushTracing);
  const started = Date.now();
  try {
    const [pack, triage, riceScoring, moscow, digest] = await Promise.all([
      loadContextPack(),
      loadSkill("triage-taxonomy"),
      loadSkill("rice-scoring"),
      loadSkill("moscow"),
      loadSkill("digest"),
    ]);
    const result = await withPipelineLock(() =>
      generateDigest(getDb(), {
        pack,
        skills: {
          triage: triage.content,
          riceScoring: riceScoring.content,
          moscow: moscow.content,
          digest: digest.content,
        },
        now: getDemoNow(),
      }),
    );
    revalidatePath("/");
    return {
      ok: true,
      id: result.id,
      writer: result.writer,
      costEur: result.costEur,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof PipelineBusyError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: "La génération du digest a échoué. Réessaie dans un instant." };
  }
}

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
