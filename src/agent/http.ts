// HTTP contract of POST /api/agent (SPEC §10): request body and Server-Sent Events.
import { z } from "zod";
import type { AgentEvent } from "./index";

export const agentRequestSchema = z.object({
  thread_id: z.uuid().optional(),
  message: z.string().trim().min(1, "Message vide").max(20_000, "20 000 caractères au plus"),
  page_context: z
    .object({
      page: z.string().trim().min(1).max(200),
      entity_id: z.string().trim().max(40).nullish(),
      alert_id: z.uuid().nullish(),
    })
    .nullish(),
});

/** One Server-Sent Event per agent event: `event: <type>` and its JSON. */
export function sseEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * A turn streamed as Server-Sent Events. Léa may leave or start a new conversation mid-turn: the
 * turn ends server-side (checkpoint, trace, cost) even if nobody reads the stream any more.
 */
export function sseResponse(
  run: (send: (event: AgentEvent) => void) => Promise<void>,
  failure: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event)));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
      } catch (error) {
        console.error("[agent]", error);
        send({ type: "error", message: failure });
      } finally {
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
