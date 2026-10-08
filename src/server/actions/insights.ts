"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";
import type { InsightReview } from "@/lib/insights/review";
import {
  InsightReviewError,
  reviewInsight,
  type InsightReviewResult,
} from "@/services/insight-review";

export type ReviewActionResult =
  { ok: true; result: InsightReviewResult } | { ok: false; message: string };

/**
 * Review of the insights Signal proposes (SPEC §8.10) from the Insights screen: one shared service
 * (also used by the agent's apply_decision), under the pipeline lock so a run never overwrites it.
 */
export async function reviewInsightAction(review: InsightReview): Promise<ReviewActionResult> {
  after(flushTracing);
  try {
    const [pack, riceScoring, moscow] = await Promise.all([
      loadContextPack(),
      loadSkill("rice-scoring"),
      loadSkill("moscow"),
    ]);
    const result = await reviewInsight(getDb(), review, {
      pack,
      skills: { riceScoring: riceScoring.content, moscow: moscow.content },
      now: getDemoNow(),
      source: "signal_ui",
      withLock: (fn) => withPipelineLock(fn),
    });
    revalidatePath("/insights");
    revalidatePath("/insights/[id]", "page");
    revalidatePath("/");
    revalidatePath("/priorisation");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof InsightReviewError || error instanceof PipelineBusyError) {
      return { ok: false, message: error.message };
    }
    console.error(error);
    return { ok: false, message: "La décision n'a pas pu être enregistrée. Réessaie." };
  }
}
