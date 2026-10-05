// Middleware of the agent (LangChain v1 createAgent): per-turn budget of tool calls (CL-31), live
// trace events and cost of the turn.
import {
  AIMessage,
  createMiddleware,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { z } from "zod";
import { usageFromMessage } from "@/lib/llm/cost";
import { MODELS } from "@/lib/llm/models";
import { turnContextSchema, type TurnContext } from "./tools/shared";

export const MAX_TOOL_CALLS_PER_TURN = 15;

export const TOOL_LIMIT_MESSAGE =
  `Limite de ${MAX_TOOL_CALLS_PER_TURN} appels d'outils atteinte pour ce tour : cet appel n'a pas été exécuté. ` +
  "N'appelle plus aucun outil. Réponds maintenant avec ce que tu as déjà, en commençant par « Réponse partielle : » et en disant ce qui manque.";

export const PARTIAL_ANSWER =
  `Réponse partielle : j'ai atteint la limite de ${MAX_TOOL_CALLS_PER_TURN} appels d'outils pour ce tour avant d'avoir fini. ` +
  "Relance-moi avec une question plus ciblée (un insight, un compte, une période) et je reprends.";

/** Messages of the current turn: everything after Léa's last message. */
export function currentTurn(messages: readonly BaseMessage[]): BaseMessage[] {
  const last = messages.findLastIndex((m) => HumanMessage.isInstance(m));
  return messages.slice(last + 1);
}

export type BudgetDecision =
  | { kind: "ok" }
  /** Some calls are blocked: they get an error result, the allowed ones run, the model answers. */
  | { kind: "block"; blocked: string[]; jumpToModel: boolean }
  /** The model kept calling tools after the warning: the turn ends on a partial answer. */
  | { kind: "stop"; blocked: string[] };

/**
 * Pure: what to do with the tool calls of the model's last message, given the calls already made
 * in the turn and whether the model was already warned.
 */
export function toolBudget(
  callIds: readonly string[],
  done: number,
  warned: boolean,
  limit = MAX_TOOL_CALLS_PER_TURN,
): BudgetDecision {
  if (callIds.length === 0 || done + callIds.length <= limit) return { kind: "ok" };
  const allowed = Math.max(0, limit - done);
  const blocked = callIds.slice(allowed);
  if (warned) return { kind: "stop", blocked };
  return { kind: "block", blocked, jumpToModel: allowed === 0 };
}

const blockedResult = (id: string, name: string) =>
  new ToolMessage({ content: TOOL_LIMIT_MESSAGE, tool_call_id: id, name, status: "error" });

/**
 * At most 15 tool calls per turn; beyond, an explicit partial answer (SPEC §10.7, CL-31). The
 * count lives in the agent state, reset at the start of each turn: the messages cannot be used,
 * the summary middleware may rewrite them in the middle of a long turn.
 */
export function toolBudgetMiddleware(limit = MAX_TOOL_CALLS_PER_TURN) {
  return createMiddleware({
    name: "SignalToolBudget",
    stateSchema: z.object({
      turnToolCalls: z.number().default(0),
      turnToolWarned: z.boolean().default(false),
    }),
    beforeAgent: () => ({ turnToolCalls: 0, turnToolWarned: false }),
    afterModel: {
      canJumpTo: ["model", "end"],
      hook: (state) => {
        const last = state.messages.at(-1);
        if (!last || !AIMessage.isInstance(last) || !last.tool_calls?.length) return;
        const calls = last.tool_calls.map((c) => c.id ?? "");
        const decision = toolBudget(calls, state.turnToolCalls, state.turnToolWarned, limit);
        if (decision.kind === "ok") return { turnToolCalls: state.turnToolCalls + calls.length };
        const nameOf = new Map(last.tool_calls.map((c) => [c.id ?? "", c.name]));
        const results = decision.blocked.map((id) => blockedResult(id, nameOf.get(id) ?? ""));
        const turnToolCalls = state.turnToolCalls + calls.length - decision.blocked.length;
        if (decision.kind === "stop") {
          return {
            turnToolCalls,
            messages: [...results, new AIMessage(PARTIAL_ANSWER)],
            jumpTo: "end" as const,
          };
        }
        return {
          turnToolCalls,
          turnToolWarned: true,
          messages: results,
          ...(decision.jumpToModel ? { jumpTo: "model" as const } : {}),
        };
      },
    },
  });
}

export type TraceEvent =
  | { type: "tool_start"; id: string; name: string; args: string }
  /** A step of a long tool (the incremental pipeline of add_feedback), shown while it runs. */
  | { type: "tool_progress"; id: string; message: string }
  | {
      type: "tool_end";
      id: string;
      name: string;
      ok: boolean;
      duration_ms: number;
      models: string[];
    };

const ARGS_CHARS = 160;

/** Arguments of a tool call in one short line for the live trace (never the full pasted text). */
export function summarizeArgs(args: unknown): string {
  const text = JSON.stringify(args ?? {}, (_key, value) =>
    typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}…` : value,
  );
  return text.length > ARGS_CHARS ? `${text.slice(0, ARGS_CHARS)}…` : text;
}

/**
 * Live trace of the turn: tool start and end (name, short arguments, duration, models) as custom
 * stream events, and the cost of every model call of the agent added to the turn's RunCost.
 */
export function traceMiddleware(modelsOf: ReadonlyMap<string, readonly string[]>) {
  return createMiddleware({
    name: "SignalTrace",
    contextSchema: turnContextSchema,
    wrapToolCall: async (request, handler) => {
      const { toolCall, runtime } = request;
      const id = toolCall.id ?? toolCall.name;
      runtime.writer?.({
        type: "tool_start",
        id,
        name: toolCall.name,
        args: summarizeArgs(toolCall.args),
      } satisfies TraceEvent);
      const started = Date.now();
      let ok = false;
      try {
        const result = await handler(request);
        ok = !(
          ToolMessage.isInstance(result) &&
          typeof result.content === "string" &&
          result.content.startsWith("Erreur")
        );
        return result;
      } finally {
        runtime.writer?.({
          type: "tool_end",
          id,
          name: toolCall.name,
          ok,
          duration_ms: Date.now() - started,
          models: [...(modelsOf.get(toolCall.name) ?? [])],
        } satisfies TraceEvent);
      }
    },
    afterModel: (state, runtime) => {
      const last = state.messages.at(-1);
      const ctx = runtime.context as TurnContext | undefined;
      if (ctx && last && AIMessage.isInstance(last))
        ctx.runCost.add(MODELS.agent, usageFromMessage(last));
    },
  });
}
