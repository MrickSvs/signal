import { describe, expect, it } from "vitest";
import { agentRequestSchema, sseEvent } from "./http";

describe("POST /api/agent contract", () => {
  it("accepts a message with an optional thread and page context", () => {
    expect(agentRequestSchema.safeParse({ message: "Quoi de neuf ?" }).success).toBe(true);
    expect(
      agentRequestSchema.safeParse({
        thread_id: "6f1c2b9e-3c1a-4d8e-9f00-1a2b3c4d5e6f",
        message: "Pourquoi ?",
        page_context: { page: "/insights/I-07", entity_id: "I-07" },
      }).success,
    ).toBe(true);
  });

  it("refuses an empty message or a thread id that is not a uuid", () => {
    expect(agentRequestSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(agentRequestSchema.safeParse({ message: "ok", thread_id: "abc" }).success).toBe(false);
  });

  it("frames each event as one SSE message", () => {
    expect(sseEvent({ type: "token", text: "Bon\njour" })).toBe(
      'event: token\ndata: {"type":"token","text":"Bon\\njour"}\n\n',
    );
  });
});
