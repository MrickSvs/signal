// Conversations of the chat (SPEC §10.8): one LangGraph thread_id per conversation, listed in the
// `threads` table. The messages themselves live in the checkpointer (schema langgraph).
import type { PageContext } from "@/agent/briefing";
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";

const TITLE_CHARS = 80;

/** First line of the first message, shortened: the conversation's title in the list. */
export function threadTitle(message: string): string {
  const line = message.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

/** Creates the conversation on its first message, then only moves last_message_at. */
export async function touchThread(
  db: Db,
  threadId: string,
  firstMessage: string,
  page: PageContext | null,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const { data, error } = await db.from("threads").select("id").eq("id", threadId);
  if (error) throw new Error(`Conversation : lecture en échec (${error.message})`);
  if (data.length > 0) {
    const update = await db
      .from("threads")
      .update({ last_message_at: now.toISOString(), page_context: page as Json })
      .eq("id", threadId);
    if (update.error)
      throw new Error(`Conversation : mise à jour en échec (${update.error.message})`);
    return { created: false };
  }
  const insert = await db.from("threads").insert({
    id: threadId,
    title: threadTitle(firstMessage),
    page_context: page as Json,
    last_message_at: now.toISOString(),
  });
  if (insert.error) throw new Error(`Conversation : création en échec (${insert.error.message})`);
  return { created: true };
}
