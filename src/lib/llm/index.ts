import { ChatAnthropic } from "@langchain/anthropic";
import { MODELS, type ModelRole } from "./models";

// Claude Sonnet 5.5 and Opus 5.5 reject any non-default temperature (400, and @langchain/anthropic
// throws before sending): only the Haiku triage role sets one. They think adaptively by default;
// "summarized" makes the reasoning visible in Langfuse traces (same billing). See ADR-003.
const ROLE_CONFIG: Record<ModelRole, { maxTokens: number; temperature?: number }> = {
  triage: { maxTokens: 4096, temperature: 0 },
  reasoning: { maxTokens: 16000 },
  agent: { maxTokens: 16000 },
  judge: { maxTokens: 16000 },
  generation: { maxTokens: 16000 },
};

/** Chat model for a role. The SDK retries 408/409/429/5xx and network errors (maxRetries). */
export function getModel(role: ModelRole): ChatAnthropic {
  const { maxTokens, temperature } = ROLE_CONFIG[role];
  return new ChatAnthropic({
    model: MODELS[role],
    maxTokens,
    maxRetries: 2,
    ...(temperature !== undefined
      ? { temperature }
      : { thinking: { type: "adaptive", display: "summarized" } }),
  });
}

export { MODELS, type ModelRole } from "./models";
