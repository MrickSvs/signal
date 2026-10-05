// A conversation as the chat panel shows it again (SPEC §10.8): Léa's messages and Signal's
// answers, read from the checkpointer. Briefings, tool calls and tool results stay out.
import { AIMessage, HumanMessage, type BaseMessage } from "langchain";

export type ChatHistoryMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  /** The oldest messages were summarized (CL-30): they cannot be shown any more. */
  | { role: "summary" };

/** Pure: the visible messages of a conversation, consecutive answers of a turn joined. */
export function visibleHistory(messages: readonly BaseMessage[]): ChatHistoryMessage[] {
  const out: ChatHistoryMessage[] = [];
  for (const message of messages) {
    if (HumanMessage.isInstance(message)) {
      if (message.additional_kwargs?.lc_source === "summarization") out.push({ role: "summary" });
      else out.push({ role: "user", text: message.text });
      continue;
    }
    if (!AIMessage.isInstance(message)) continue;
    const text = message.text.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last?.role === "assistant") last.text = `${last.text}\n\n${text}`;
    else out.push({ role: "assistant", text });
  }
  return out;
}
