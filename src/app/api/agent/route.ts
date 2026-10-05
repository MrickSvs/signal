import { randomUUID } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runTurn, type AgentEvent } from "@/agent";
import { agentRequestSchema, sseEvent } from "@/agent/http";
import { getAgentRuntime } from "@/agent/runtime";
import { getDb } from "@/lib/db/client";
import { flushTracing } from "@/lib/llm/tracing";

// A turn may chain up to 15 tool calls, and add_feedback runs the incremental pipeline (~20 s per
// feedback, ADR-013): the Hobby plan's maximum (CL-45). Full pipeline runs stay in the CLI.
export const maxDuration = 300;

/**
 * POST /api/agent {thread_id?, message, page_context?: {page, entity_id?}} → text/event-stream:
 * token, tool_start, tool_end (name, short arguments, duration, models), interrupt, done (thread,
 * cost, Langfuse link) or error. Without thread_id, a new conversation starts.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = agentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const { message, page_context } = parsed.data;
  const threadId = parsed.data.thread_id ?? randomUUID();
  after(flushTracing);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Léa may leave or start a new conversation mid-turn: the turn ends server-side (checkpoint,
      // trace, cost) even if nobody reads the stream any more.
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event)));
        } catch {
          closed = true;
        }
      };
      try {
        const { agent, deps } = await getAgentRuntime(getDb());
        await runTurn(
          agent,
          deps,
          {
            threadId,
            message,
            page: page_context
              ? { page: page_context.page, entity_id: page_context.entity_id ?? null }
              : null,
          },
          send,
        );
      } catch (error) {
        console.error("[agent]", error);
        send({
          type: "error",
          message: "Signal n'a pas pu terminer sa réponse. Réessaie dans un instant.",
        });
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
