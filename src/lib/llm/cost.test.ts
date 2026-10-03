import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { costEur, costUsd, RunCost, usageFromMessage, type Usage } from "./cost";
import { EUR_PER_USD } from "./models";

const usage = (partial: Partial<Usage>): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...partial,
});

describe("costUsd / costEur", () => {
  it("prices every token category for Sonnet 5.5", () => {
    const u = usage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
    });
    // 2 + 10 + 0.2 + 2.5 + 4
    expect(costUsd("claude-sonnet-5-5", u)).toBeCloseTo(18.7, 10);
    expect(costEur("claude-sonnet-5-5", u)).toBeCloseTo(18.7 * EUR_PER_USD, 10);
  });

  it("prices a typical Haiku triage call", () => {
    const u = usage({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000 });
    // (1200 * 1 + 300 * 5 + 4000 * 0.1) / 1e6
    expect(costUsd("claude-haiku-4-5-20251001", u)).toBeCloseTo(0.0031, 10);
  });

  it("refuses an unknown model", () => {
    expect(() => costUsd("gpt-x" as never, usage({ inputTokens: 1 }))).toThrow();
  });
});

describe("usageFromMessage", () => {
  it("reads the raw Anthropic usage, cache writes split by TTL", () => {
    const message = new AIMessage({
      content: "",
      response_metadata: {
        usage: {
          input_tokens: 18,
          output_tokens: 433,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 2960,
          cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 960 },
        },
      },
    });
    expect(usageFromMessage(message)).toEqual(
      usage({
        inputTokens: 18,
        outputTokens: 433,
        cacheReadTokens: 100,
        cacheWrite5mTokens: 2000,
        cacheWrite1hTokens: 960,
      }),
    );
  });

  it("falls back to usage_metadata, whose input count includes cached tokens", () => {
    const message = new AIMessage({
      content: "",
      usage_metadata: {
        input_tokens: 1100,
        output_tokens: 50,
        total_tokens: 1150,
        input_token_details: { cache_read: 1000, cache_creation: 0 },
      },
    });
    expect(usageFromMessage(message)).toEqual(
      usage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000 }),
    );
  });
});

describe("RunCost", () => {
  it("aggregates calls across models plus extra costs", () => {
    const run = new RunCost();
    run.add("claude-haiku-4-5-20251001", usage({ inputTokens: 1_000_000 }));
    run.add("claude-haiku-4-5-20251001", usage({ outputTokens: 1_000_000, cacheReadTokens: 10 }));
    run.add("claude-sonnet-5-5", usage({ inputTokens: 500_000 }));
    run.addEur(0.5);
    expect(run.eur).toBeCloseTo((1 + 5 + 0.000001 + 1) * EUR_PER_USD + 0.5, 10);
    expect(run.tokensIn).toBe(1_500_010);
    expect(run.tokensOut).toBe(1_000_000);
  });
});
