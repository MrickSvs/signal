"use server";

import { z } from "zod";
import { visibleHistory, type ChatHistoryMessage } from "@/agent/history";
import { getCheckpointer } from "@/agent/checkpointer";
import { citedIds, excerptAround } from "@/lib/chat/ids";
import { getDb } from "@/lib/db/client";
import { existingIds, recordIdIncidents } from "@/server/queries/ids";
import { listThreads, type ThreadSummary } from "@/server/queries/threads";

// Server functions of the chat panel: conversations, their history, and the check of the ids an
// answer cites (SPEC §10.7). The turn itself streams from POST /api/agent.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const threadId = z.uuid();

export async function loadThreads(): Promise<ActionResult<ThreadSummary[]>> {
  try {
    return { ok: true, data: await listThreads(getDb()) };
  } catch (error) {
    console.error("[chat]", error);
    return { ok: false, message: "Impossible de charger les conversations." };
  }
}

export async function loadThreadHistory(id: string): Promise<ActionResult<ChatHistoryMessage[]>> {
  if (!threadId.safeParse(id).success) return { ok: false, message: "Conversation inconnue." };
  try {
    const saver = await getCheckpointer();
    const tuple = await saver.getTuple({ configurable: { thread_id: id } });
    const values = tuple?.checkpoint.channel_values as
      { messages?: Parameters<typeof visibleHistory>[0] } | undefined;
    return { ok: true, data: visibleHistory(values?.messages ?? []) };
  } catch (error) {
    console.error("[chat]", error);
    return { ok: false, message: "Impossible de relire cette conversation." };
  }
}

const verifySchema = z.object({
  text: z.string().max(100_000),
  threadId: z.uuid().nullable(),
  /** false when re-reading a past conversation: its incidents were journaled when it streamed. */
  record: z.boolean(),
});

/**
 * Which ids of an answer exist (SPEC §10.7, CL-28). The unknown ones are journaled in
 * `id_incidents` with the sentence around them, and the chat shows them as « ID inconnu ».
 */
export async function verifyAnswerIds(
  input: z.input<typeof verifySchema>,
): Promise<ActionResult<{ known: string[]; unknown: string[] }>> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Vérification impossible." };
  const { text, record } = parsed.data;
  const ids = citedIds(text);
  if (ids.length === 0) return { ok: true, data: { known: [], unknown: [] } };
  try {
    const db = getDb();
    const found = await existingIds(db, ids);
    const unknown = ids.filter((id) => !found.has(id));
    if (record && unknown.length > 0) {
      console.warn(`[chat] ID inconnu(s) dans une réponse : ${unknown.join(", ")}`);
      await recordIdIncidents(
        db,
        parsed.data.threadId,
        unknown.map((id) => ({ id, excerpt: excerptAround(text, id) })),
      );
    }
    return { ok: true, data: { known: ids.filter((id) => found.has(id)), unknown } };
  } catch (error) {
    console.error("[chat]", error);
    return { ok: false, message: "Vérification des ID indisponible." };
  }
}
