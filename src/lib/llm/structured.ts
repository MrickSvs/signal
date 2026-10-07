import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
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
  /** Output cap for this call, thinking included (default: the role's cap). */
  maxTokens?: number;
  /**
   * "grammar" (default): native structured outputs, the API constrains the decoding.
   * "prompt": the JSON schema is given in the prompt, without constrained decoding, for a schema
   * whose compiled grammar the API refuses as too large (ADR-023). Same zod check and retry.
   */
  schemaMode?: "grammar" | "prompt";
  /** Effort of the call (thinking and answer); default: the model's. */
  effort?: "low" | "medium" | "high";
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
  const base = getModel(role, { maxTokens: options.maxTokens });
  const byPrompt = options.schemaMode === "prompt";
  const effort = options.effort ? { effort: options.effort } : {};
  const model = byPrompt
    ? options.effort
      ? base.withConfig({ outputConfig: effort })
      : base
    : base.withConfig({
        outputConfig: {
          ...effort,
          format: { type: "json_schema", schema: toStrictJsonSchema(schema) },
        },
      });

  let usage = EMPTY_USAGE;
  let lastIssue = "";
  const prompted = byPrompt ? [...messages, schemaInstruction(schema)] : messages;
  let conversation = prompted;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let message: AIMessage;
    try {
      message = await model.invoke(conversation, {
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

    const text = textOf(message);
    const result = schema.safeParse(stripJsonLeaks(parseJson(text)));
    if (result.success) {
      return { data: result.data, usage, costEur: costEur(modelId, usage), attempts: attempt };
    }
    lastIssue = result.error.message;
    // The new attempt sees its invalid answer and the issues: the same prompt would give the same error.
    conversation = [
      ...prompted,
      new AIMessage(text || "(réponse vide)"),
      new HumanMessage(
        `Ta réponse ne respecte pas le schéma attendu :\n${z.prettifyError(result.error)}\n` +
          "Renvoie l'objet JSON complet, corrigé.",
      ),
    ];
  }

  throw new StructuredOutputError(
    `Sortie invalide après ${MAX_ATTEMPTS} tentatives (${options.name}) : ${lastIssue}`,
    { kind: "validation", attempts: MAX_ATTEMPTS, usage },
  );
}

type JsonSchema = { [key: string]: unknown };

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Copies `enum` (and `const`, as a one-value enum: the discriminant of a union) from the source
 * schema onto the strict one, walking both trees in parallel.
 */
function restoreEnums(source: JsonSchema, strict: JsonSchema): void {
  if (Array.isArray(source.enum)) strict.enum = source.enum;
  else if (source.const !== undefined) strict.enum = [source.const];
  for (const key of ["properties", "$defs"] as const) {
    const from = source[key];
    const to = strict[key];
    if (!isSchema(from) || !isSchema(to)) continue;
    for (const [name, child] of Object.entries(from)) {
      if (isSchema(child) && isSchema(to[name])) restoreEnums(child, to[name]);
    }
  }
  if (isSchema(source.items) && isSchema(strict.items)) restoreEnums(source.items, strict.items);
  const variants = (source.anyOf ?? source.oneOf ?? source.allOf) as unknown;
  const strictVariants = (strict.anyOf ?? strict.allOf) as unknown;
  if (Array.isArray(variants) && Array.isArray(strictVariants)) {
    variants.forEach((v, i) => {
      if (isSchema(v) && isSchema(strictVariants[i])) restoreEnums(v, strictVariants[i]);
    });
  }
}

/**
 * JSON schema for output_config.format. transformJSONSchema (SDK 0.122) drops the keywords
 * that structured outputs reject (min/max, maxItems, pattern) into the description, but it also
 * drops `enum`, which constrained decoding supports: it is put back so enums are enforced.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const source = toJsonSchema(schema) as JsonSchema;
  const strict = transformJSONSchema(source) as JsonSchema;
  restoreEnums(source, strict);
  return strict;
}

/** The schema in the prompt (schemaMode "prompt"), after the caller's messages. */
export function schemaInstruction(schema: z.ZodType): HumanMessage {
  return new HumanMessage(
    "Réponds uniquement par un objet JSON compact (sur une ligne, sans indentation, sans texte autour ni bloc de code) conforme à ce schéma JSON :\n" +
      JSON.stringify(toJsonSchema(schema)),
  );
}

/** Text blocks only: thinking blocks come first when adaptive thinking is on. */
function textOf(message: AIMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

// A text field that ends a sentence and then carries JSON punctuation (« …nécessaire.}], ») has
// swallowed the end of the structure: the punctuation after the sentence is dropped.
const LEAKED_JSON_TAIL = /([.!?…»)])\s*(?=[\s"',]*[}\]])[\s"'},\]]+$/;

/** Removes leaked JSON punctuation at the end of every string of a parsed output (pure). */
export function stripJsonLeaks(value: unknown): unknown {
  if (typeof value === "string") return value.replace(LEAKED_JSON_TAIL, "$1");
  if (Array.isArray(value)) return value.map(stripJsonLeaks);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripJsonLeaks(v)]));
  }
  return value;
}

function parseJson(text: string): unknown {
  // Without constrained decoding the model may still wrap its JSON in a code block.
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return undefined;
  }
}
