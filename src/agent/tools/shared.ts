// Shared contract of the agent's tools (SPEC §10.5): zod input, a description built from « quand
// l'utiliser » and « pas quand », a compact output with ids and bounded lists, wrapped as data
// (wrapExternal, CL-10), and short actionable errors instead of stack traces.
import { tool, type DynamicStructuredTool, type ToolRuntime } from "langchain";
import { z } from "zod";
import type { PageContext } from "@/agent/briefing";
import type { ContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { RunCost } from "@/lib/llm/cost";
import { wrapExternal } from "@/lib/llm/data";
import type { ModelRole } from "@/lib/llm/models";
import type { EstimateDeps } from "@/services/estimate";
import type { IncrementalContext } from "@/pipeline/incremental";

/** At most 10 items per list, 5 verbatims per insight (SPEC §10.5). */
export const LIST_LIMIT = 10;
export const VERBATIM_LIMIT = 5;

/** What every tool can use, fixed when the agent is created. */
export type AgentDeps = {
  db: Db;
  pack: ContextPack;
  skills: { triage: string; riceScoring: string; moscow: string };
  /** Scenario clock (DEMO_NOW). */
  now: () => Date;
  /** Wraps the incremental pipeline: the pipeline lock in the app (CL-12). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Injected in tests: no model, Voyage or database call there (rule 11). */
  embedQuery?: (text: string) => Promise<number[]>;
  estimate?: Omit<EstimateDeps, "runCost">;
  incremental?: Pick<IncrementalContext, "invoke" | "embedFn" | "estimate" | "sleep">;
};

/**
 * Per-turn runtime context: cost of the turn and where Léa is. A middleware only sees the context
 * fields its own schema declares. (The briefing is a message of the turn, see runTurn.)
 */
export const turnContextSchema = z.object({
  threadId: z.string(),
  runCost: z.custom<RunCost>((v) => v instanceof RunCost),
  page: z.custom<PageContext | null>(),
});

export type TurnContext = z.infer<typeof turnContextSchema>;

/** An expected failure (unknown id, invalid value): its message goes back to the model as is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolContract<S extends z.ZodType> = {
  name: string;
  /** One sentence: what the tool returns. */
  summary: string;
  when: string;
  notWhen: string;
  schema: S;
  /** Models the tool may call (shown in the live trace). */
  models?: ModelRole[];
  /**
   * Whether the output carries third-party text and must be wrapped as data (default true).
   * Only load_skill opts out: a skill is first-party guidance, versioned in the context pack.
   */
  wrap?: boolean;
};

export function describeTool(
  contract: Pick<ToolContract<z.ZodType>, "summary" | "when" | "notWhen">,
) {
  return `${contract.summary}\nQuand l'utiliser : ${contract.when}\nPas quand : ${contract.notWhen}`;
}

/** Errors the model can act on: business refusals keep their message, the rest is shortened. */
export function toolErrorMessage(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known =
    error instanceof ToolError ||
    (error instanceof Error &&
      ["PrioritizationError", "EstimationError", "SkillError", "PipelineBusyError"].includes(
        error.name,
      ));
  if (known) return `Erreur : ${message}`;
  return (
    `Erreur : ${name} a échoué (${message.slice(0, 200)}). ` +
    "Dis à Léa que la donnée est indisponible pour l'instant ; n'invente rien."
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools of different schemas in one list
export type SignalTool = DynamicStructuredTool<any, any, any, any> & { models: ModelRole[] };

/**
 * A tool of Signal: the output is serialized compactly (JSON), wrapped as data, and every error
 * becomes a short message the model can act on.
 */
export function signalTool<S extends z.ZodObject>(
  contract: ToolContract<S>,
  run: (
    input: z.infer<S>,
    ctx: TurnContext,
    progress: (message: string) => void,
  ) => Promise<unknown>,
): SignalTool {
  const instance = tool(
    async (input: z.infer<S>, runtime: ToolRuntime<unknown, TurnContext>) => {
      // Steps of a long tool reach the live trace as custom stream events (no-op outside a stream).
      const progress = (message: string) =>
        runtime?.writer?.({ type: "tool_progress", id: runtime.toolCallId, message });
      try {
        const output = await run(input, runtime?.context, progress);
        const text = typeof output === "string" ? output : JSON.stringify(output);
        return contract.wrap === false ? text : wrapExternal(`outil ${contract.name}`, text);
      } catch (error) {
        if (!(error instanceof ToolError)) console.error(`[agent] ${contract.name}`, error);
        return toolErrorMessage(contract.name, error);
      }
    },
    { name: contract.name, description: describeTool(contract), schema: contract.schema },
  );
  return Object.assign(instance, { models: contract.models ?? [] });
}

/** Text cut at `max` characters, with a visible marker (never a silent truncation). */
export function excerpt(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}… [tronqué]` : clean;
}

/** « I-42 introuvable ; les ID valides vont de I-01 à I-48. » */
export async function unknownId(
  db: Db,
  table: "insights" | "feedbacks" | "customers",
  id: string,
): Promise<ToolError> {
  const { data } = await db.from(table).select("id").order("id");
  const ids = (data ?? []).map((r) => r.id as string);
  const range = ids.length
    ? `les ID valides vont de ${ids[0]} à ${ids.at(-1)}`
    : "la base est vide";
  return new ToolError(`${id} introuvable ; ${range}.`);
}
