import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { z } from "zod";
import { addUsage, costEur, EMPTY_USAGE, usageFromMessage, type RunCost, type Usage } from "./cost";
import { getModel } from "./index";
import { MODELS, type ModelRole } from "./models";
import { langfuseCallbacks } from "./tracing";

const MAX_ATTEMPTS = 2; // one new attempt when validation fails (CL-11)

/** Definitive failure: the caller turns it into a "failed" status and the run goes on. */
export class StructuredOutputError extends Error {
  readonly kind: "api" | "validation";
  readonly attempts: number;
  readonly usage: Usage;

  constructor(
    message: string,
    details: { kind: "api" | "validation"; attempts: number; usage: Usage; cause?: unknown },
  ) {
    super(message, { cause: details.cause });
    this.name = "StructuredOutputError";
    this.kind = details.kind;
    this.attempts = details.attempts;
    this.usage = details.usage;
  }
}

export type StructuredOptions = {
  /** Stable, verb-first name of the generation in Langfuse (e.g. "triage-feedback"). */
  name: string;
  /** Run-level cost aggregation (pipeline_runs.cost_eur). */
  runCost?: RunCost;
  metadata?: Record<string, string>;
};

export type StructuredResult<T> = {
  data: T;
  usage: Usage;
  costEur: number;
  attempts: number;
};

/**
 * Calls a model with native structured outputs (output_config.format: no forced tool use,
 * which Sonnet 5.5 and Opus 5.5 reject) and validates the result with zod.
 * The model is invoked directly so the trace shows a single generation named `options.name`.
 */
export async function invokeStructured<T>(
  role: ModelRole,
  schema: z.ZodType<T>,
  messages: BaseMessage[],
  options: StructuredOptions,
): Promise<StructuredResult<T>> {
  const modelId = MODELS[role];
  const model = getModel(role).withConfig({
    outputConfig: {
      format: { type: "json_schema", schema: transformJSONSchema(toJsonSchema(schema)) },
    },
  });

  let usage = EMPTY_USAGE;
  let lastIssue = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let message: AIMessage;
    try {
      message = await model.invoke(messages, {
        runName: options.name,
        callbacks: langfuseCallbacks(),
        metadata: { ...options.metadata, role, attempt: String(attempt) },
      });
    } catch (error) {
      throw new StructuredOutputError(`Appel au modèle en échec (${options.name})`, {
        kind: "api",
        attempts: attempt,
        usage,
        cause: error,
      });
    }

    const callUsage = usageFromMessage(message);
    usage = addUsage(usage, callUsage);
    options.runCost?.add(modelId, callUsage);

    const result = schema.safeParse(parseJson(textOf(message)));
    if (result.success) {
      return { data: result.data, usage, costEur: costEur(modelId, usage), attempts: attempt };
    }
    lastIssue = result.error.message;
  }

  throw new StructuredOutputError(
    `Sortie invalide après ${MAX_ATTEMPTS} tentatives (${options.name}) : ${lastIssue}`,
    { kind: "validation", attempts: MAX_ATTEMPTS, usage },
  );
}

/** Text blocks only: thinking blocks come first when adaptive thinking is on. */
function textOf(message: AIMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
