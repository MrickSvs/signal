"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { flushTracing } from "@/lib/llm/tracing";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";
import {
  applyOverride,
  cancelOverride,
  createManualTopic,
  PrioritizationError,
  type PrioritizationDeps,
  type PrioritizationResult,
} from "@/services/prioritization";
import { loadScoringContext } from "@/server/scoring-context";

export type PrioritizationActionResult =
  { ok: true; result: PrioritizationResult } | { ok: false; message: string };

/**
 * Writes of the Priorisation screen (SPEC §8.5, §8.9): one shared service, under the pipeline
 * lock so a run never overwrites them; the screens that show ranks are refreshed.
 */
async function run(
  write: (deps: PrioritizationDeps) => Promise<PrioritizationResult>,
): Promise<PrioritizationActionResult> {
  after(flushTracing);
  try {
    const context = await loadScoringContext();
    const result = await write({
      ...context,
      source: "signal_ui",
      withLock: (fn) => withPipelineLock(fn),
    });
    revalidatePath("/priorisation");
    revalidatePath("/insights");
    revalidatePath("/insights/[id]", "page");
    revalidatePath("/");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof PrioritizationError || error instanceof PipelineBusyError) {
      return { ok: false, message: error.message };
    }
    console.error(error);
    return { ok: false, message: "La décision n'a pas pu être enregistrée. Réessaie." };
  }
}

export async function overrideAction(input: unknown): Promise<PrioritizationActionResult> {
  return run((deps) => applyOverride(getDb(), input, deps));
}

export async function cancelOverrideAction(input: unknown): Promise<PrioritizationActionResult> {
  return run((deps) => cancelOverride(getDb(), input, deps));
}

export async function createTopicAction(input: unknown): Promise<PrioritizationActionResult> {
  return run((deps) => createManualTopic(getDb(), input, deps));
}
