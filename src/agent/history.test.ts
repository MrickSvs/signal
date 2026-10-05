import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "langchain";
import { describe, expect, it } from "vitest";
import { visibleHistory } from "./history";

describe("visibleHistory", () => {
  it("keeps Léa's messages and Signal's answers, not briefings nor tools", () => {
    const history = visibleHistory([
      new HumanMessage({
        content: "Here is a summary of the conversation to date:\n\n…",
        additional_kwargs: { lc_source: "summarization" },
      }),
      new HumanMessage("Pourquoi I-27 ?"),
      new SystemMessage("## Briefing de ce tour"),
      new AIMessage({
        content: "Je regarde.",
        tool_calls: [{ id: "c1", name: "get_insight", args: {} }],
      }),
      new ToolMessage({ content: "<contenu_externe>…</contenu_externe>", tool_call_id: "c1" }),
      new AIMessage({ content: "", tool_calls: [{ id: "c2", name: "get_priority", args: {} }] }),
      new ToolMessage({ content: "…", tool_call_id: "c2" }),
      new AIMessage("I-27 est premier."),
    ]);
    expect(history).toEqual([
      { role: "summary" },
      { role: "user", text: "Pourquoi I-27 ?" },
      { role: "assistant", text: "Je regarde.\n\nI-27 est premier." },
    ]);
  });
});
