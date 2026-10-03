import { describe, expect, it } from "vitest";
import { buildCachedSystem } from "./caching";

describe("buildCachedSystem", () => {
  it("puts a single cache breakpoint on the last stable block", () => {
    const message = buildCachedSystem([
      { label: "produit", text: "Jalon…" },
      { label: "skill: triage-taxonomy", text: "Règles…" },
    ]);
    const blocks = message.content as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks[1]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(blocks[1].text).toBe("## skill: triage-taxonomy\n\nRègles…");
  });

  it("supports the 1-hour TTL", () => {
    const blocks = buildCachedSystem([{ label: "a", text: "b" }], "1h").content as Array<
      Record<string, unknown>
    >;
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("refuses an empty prefix", () => {
    expect(() => buildCachedSystem([])).toThrow();
  });
});
