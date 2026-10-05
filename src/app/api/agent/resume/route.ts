import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resumeRequestSchema } from "@/agent/approval";
import { sseResponse } from "@/agent/http";
import { checkResume, resumeTurn, ResumeError } from "@/agent/resume";
import { getAgentRuntime } from "@/agent/runtime";
import { getDb } from "@/lib/db/client";
import { flushTracing } from "@/lib/llm/tracing";

// The approved decision may rescore the ranking, then the agent answers: same budget as a turn.
export const maxDuration = 300;

const bodySchema = resumeRequestSchema.extend({
  page_context: z
    .object({
      page: z.string().trim().min(1).max(200),
      entity_id: z.string().trim().max(40).nullish(),
    })
    .nullish(),
});

/**
 * POST /api/agent/resume {thread_id, interrupt_id, decisions: [{type: approve} | {type: edit, args}
 * | {type: reject, reason?}]} → the same event stream as /api/agent, from where the run paused
 * (SPEC §10.6). A stale card or an invalid edit is refused with 409 / 400 before anything runs.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const { thread_id, interrupt_id, decisions, page_context } = parsed.data;
  const input = {
    threadId: thread_id,
    interruptId: interrupt_id,
    decisions,
    page: page_context
      ? { page: page_context.page, entity_id: page_context.entity_id ?? null }
      : null,
  };

  const { agent, deps } = await getAgentRuntime(getDb());
  try {
    await checkResume(agent, deps, input);
  } catch (error) {
    if (error instanceof ResumeError) {
      const stale = error.message.startsWith("Cette carte");
      return NextResponse.json({ error: error.message }, { status: stale ? 409 : 400 });
    }
    throw error;
  }
  after(flushTracing);
  return sseResponse(async (send) => {
    await resumeTurn(agent, deps, input, send);
  }, "La décision n'a pas pu être traitée. Réessaie dans un instant.");
}
