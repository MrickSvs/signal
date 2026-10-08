// The only place where model identifiers live (CLAUDE.md, SPEC §10.3).

export type ModelRole = "triage" | "reasoning" | "agent" | "judge" | "generation";

export const MODELS = {
  triage: "claude-haiku-5-5",
  reasoning: "claude-sonnet-5-5",
  agent: "claude-sonnet-5-5",
  judge: "claude-opus-5-5",
  generation: "claude-sonnet-5-5",
} as const satisfies Record<ModelRole, string>;

export type ModelId = (typeof MODELS)[ModelRole];

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

// USD per million tokens. Verified 2026-10-08 against Anthropic's model pricing
// (cache writes: 1.25x input for the 5-minute TTL, 2x for the 1-hour TTL; cache reads 0.1x input,
// 0.05x on Sonnet 5.5 and Opus 5.5). Haiku 5.5: prices for prompts up to 100k tokens (the triage
// prompt is far below; above, they are 5x).
export const PRICING_USD_PER_MTOK: Record<ModelId, ModelPricing> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
};

export const EMBEDDING_MODEL = "voyage-4";
// USD per million tokens, verified 2026-10-02 (Voyage pricing page; 200M free tokens per account).
export const EMBEDDING_PRICE_USD_PER_MTOK = 0.06;

// ECB reference rate on 2026-10-02: 1 EUR = 1.1225 USD.
export const EUR_PER_USD = 1 / 1.1225;
