import { ChatAnthropic } from "@langchain/anthropic";
import { MODELS, type ModelRole } from "./models";

// The 5.5 models reject any non-default temperature (400, and @langchain/anthropic throws before
// sending): no role sets one. They think adaptively; "summarized" makes the reasoning visible in
// Langfuse traces (same billing). See ADR-003 and ADR-041.
// The agent's cap counts its thinking too (~1 200 tokens of answer asked in the prompt, plus room
// for thinking and tool arguments): a guard rail, the length itself is set by the prompt (ADR-022).
const ROLE_CONFIG: Record<ModelRole, { maxTokens: number }> = {
  triage: { maxTokens: 8000 },
  reasoning: { maxTokens: 16000 },
  agent: { maxTokens: 4000 },
  judge: { maxTokens: 16000 },
  generation: { maxTokens: 16000 },
};

/** Chat model for a role. The SDK retries 408/409/429/5xx and network errors (maxRetries). */
export function getModel(
  role: ModelRole,
  options: { maxTokens?: number; effort?: "low" | "medium" | "high" } = {},
): ChatAnthropic {
  const maxTokens = options.maxTokens ?? ROLE_CONFIG[role].maxTokens;
  return new ChatAnthropic({
    model: MODELS[role],
    maxTokens,
    maxRetries: 2,
    ...(options.effort ? { outputConfig: { effort: options.effort } } : {}),
    thinking: { type: "adaptive", display: "summarized" },
  });
}

export { MODELS, type ModelRole } from "./models";
