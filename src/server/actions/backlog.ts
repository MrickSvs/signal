"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import type { DraftKind } from "@/lib/backlog/draft";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";
import {
  BacklogError,
  changeBacklogItemKind,
  draftBacklog,
  patchBacklogItem,
  type BacklogDeps,
  type DraftResult,
  type UpdateResult,
} from "@/services/backlog";
import { EstimationError } from "@/services/estimate";

// The Backlog and Insight screens share the agent's service (SPEC §12.6, PLAN 4.3): a drafting
// from the « Rédiger le backlog » button, the PO's edits and changes of type (source signal_ui).

export type BacklogActionResult<T> = { ok: true; result: T } | { ok: false; message: string };

async function deps(): Promise<BacklogDeps> {
  const [pack, riceScoring, moscow] = await Promise.all([
    loadContextPack(),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
  ]);
  return {
    pack,
    skills: { riceScoring: riceScoring.content, moscow: moscow.content },
    now: getDemoNow(),
    source: "signal_ui",
    withLock: (fn) => withPipelineLock(fn),
    background: (task) => after(task),
  };
}

function refresh(insightId: string | null) {
  revalidatePath("/backlog");
  revalidatePath("/priorisation");
  revalidatePath("/");
  if (insightId) revalidatePath(`/insights/${insightId}`);
}

async function guarded<T>(
  run: () => Promise<T>,
  fallback: string,
): Promise<BacklogActionResult<T>> {
  after(flushTracing);
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    if (
      error instanceof BacklogError ||
      error instanceof EstimationError ||
      error instanceof PipelineBusyError
    ) {
      return { ok: false, message: error.message };
    }
    console.error(error);
    return { ok: false, message: fallback };
  }
}

/** « Rédiger le backlog »: `confirm` once the PO accepted to replace the existing drafts (CL-33). */
export async function draftBacklogAction(
  insightId: string,
  confirm = false,
): Promise<BacklogActionResult<DraftResult>> {
  return guarded(async () => {
    const result = await draftBacklog(getDb(), insightId, { confirm }, await deps());
    if (!result.needs_confirmation) refresh(insightId);
    return result;
  }, "La rédaction du backlog a échoué. Réessaie dans un instant.");
}

export async function patchBacklogItemAction(
  id: string,
  patch: unknown,
  reason?: string,
): Promise<BacklogActionResult<UpdateResult>> {
  return guarded(async () => {
    const result = await patchBacklogItem(getDb(), id, patch, await deps(), reason);
    refresh(null);
    return result;
  }, "La modification n'a pas pu être enregistrée. Réessaie.");
}

/** Change of type (CL-54): the dialog is the PO's confirmation. */
export async function changeBacklogItemKindAction(
  id: string,
  kind: DraftKind,
  reason?: string,
): Promise<BacklogActionResult<UpdateResult>> {
  return guarded(async () => {
    const result = await changeBacklogItemKind(
      getDb(),
      id,
      { kind, confirm: true, reason },
      await deps(),
    );
    refresh(null);
    return result;
  }, "Le changement de type a échoué. Réessaie.");
}
