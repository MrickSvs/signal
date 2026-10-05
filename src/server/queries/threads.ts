import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";

// Conversations of the chat panel (SPEC §10.8): the `threads` table lists them; the messages
// live in the checkpointer.

export type ThreadSummary = Pick<Tables<"threads">, "id" | "title" | "last_message_at">;

export const THREAD_LIST_LIMIT = 30;

export async function listThreads(db: Db, limit = THREAD_LIST_LIMIT): Promise<ThreadSummary[]> {
  const { data, error } = await db
    .from("threads")
    .select("id, title, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Lecture des conversations (${error.message})`);
  return data;
}
