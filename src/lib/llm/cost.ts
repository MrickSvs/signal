import type { AIMessage } from "@langchain/core/messages";
import { EUR_PER_USD, PRICING_USD_PER_MTOK, type ModelId } from "./models";

/** Token usage of one call, split by billing category (input excludes cached tokens). */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
};

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

type AnthropicRawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

/** Reads usage from a ChatAnthropic response (raw Anthropic usage first, LangChain usage_metadata as fallback). */
export function usageFromMessage(message: AIMessage): Usage {
  const raw = message.response_metadata?.usage as AnthropicRawUsage | undefined;
  if (raw && typeof raw.input_tokens === "number") {
    const cacheWrite = raw.cache_creation_input_tokens ?? 0;
    const write1h = raw.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    return {
      inputTokens: raw.input_tokens,
      outputTokens: raw.output_tokens ?? 0,
      cacheReadTokens: raw.cache_read_input_tokens ?? 0,
      cacheWrite5mTokens: raw.cache_creation?.ephemeral_5m_input_tokens ?? cacheWrite - write1h,
      cacheWrite1hTokens: write1h,
    };
  }
  const meta = message.usage_metadata;
  if (!meta) return EMPTY_USAGE;
  const cacheRead = meta.input_token_details?.cache_read ?? 0;
  const cacheWrite = meta.input_token_details?.cache_creation ?? 0;
  return {
    // usage_metadata.input_tokens includes cached tokens.
    inputTokens: meta.input_tokens - cacheRead - cacheWrite,
    outputTokens: meta.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: cacheWrite,
    cacheWrite1hTokens: 0,
  };
}

export function costUsd(model: ModelId, usage: Usage): number {
  const price = PRICING_USD_PER_MTOK[model];
  if (!price) throw new Error(`Prix inconnu pour le modèle ${model}`);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWrite5mTokens * price.cacheWrite5m +
      usage.cacheWrite1hTokens * price.cacheWrite1h) /
    1_000_000
  );
}

export function costEur(model: ModelId, usage: Usage): number {
  return costUsd(model, usage) * EUR_PER_USD;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
  };
}

/** Aggregates the cost of every call of a run (pipeline_runs.cost_eur, tokens_in, tokens_out). */
export class RunCost {
  private totals = new Map<string, Usage>();
  private extraEur = 0;

  add(model: ModelId, usage: Usage): void {
    this.totals.set(model, addUsage(this.totals.get(model) ?? EMPTY_USAGE, usage));
  }

  /** Costs computed elsewhere (embeddings). */
  addEur(amount: number): void {
    this.extraEur += amount;
  }

  get eur(): number {
    let total = this.extraEur;
    for (const [model, usage] of this.totals) total += costEur(model as ModelId, usage);
    return total;
  }

  get tokensIn(): number {
    let total = 0;
    for (const u of this.totals.values())
      total += u.inputTokens + u.cacheReadTokens + u.cacheWrite5mTokens + u.cacheWrite1hTokens;
    return total;
  }

  get tokensOut(): number {
    let total = 0;
    for (const u of this.totals.values()) total += u.outputTokens;
    return total;
  }
}
