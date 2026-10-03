import { SystemMessage } from "@langchain/core/messages";

// Prompt caching is a prefix match: stable blocks (context pack, skills) go first, in a fixed
// order, and volatile content (the feedback, the question) goes in later messages.
// Minimum cacheable prefix: 512 tokens on Sonnet 5.5 / Opus 5.5, 4096 on Haiku 4.5;
// shorter prefixes are silently not cached (check usage.cacheReadTokens).

export type StableBlock = {
  /** Shown as a heading so the model knows what each block is (e.g. "skill: triage-taxonomy"). */
  label: string;
  text: string;
};

export type CacheTtl = "5m" | "1h";

/** One system message whose last block carries the cache breakpoint (it caches everything before it). */
export function buildCachedSystem(blocks: StableBlock[], ttl: CacheTtl = "5m"): SystemMessage {
  if (blocks.length === 0) throw new Error("buildCachedSystem: au moins un bloc est requis");
  const cacheControl = ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  return new SystemMessage({
    content: blocks.map((block, index) => ({
      type: "text",
      text: `## ${block.label}\n\n${block.text}`,
      ...(index === blocks.length - 1 && { cache_control: cacheControl }),
    })),
  });
}
