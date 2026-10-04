// HTTP contract of POST /api/agent (SPEC §10, PLAN 4.1): request body and Server-Sent Events.
import { z } from "zod";
import type { AgentEvent } from "./index";

export const agentRequestSchema = z.object({
  thread_id: z.uuid().optional(),
  message: z.string().trim().min(1, "Message vide").max(20_000, "20 000 caractères au plus"),
  page_context: z
    .object({
      page: z.string().trim().min(1).max(200),
      entity_id: z.string().trim().max(40).nullish(),
    })
    .nullish(),
});

/** One Server-Sent Event per agent event: `event: <type>` and its JSON. */
export function sseEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
