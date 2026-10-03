import { beforeAll, describe, expect, it } from "vitest";
import { getModel } from "./index";

// ChatAnthropic requires a key at construction; no request is ever sent here.
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY ??= "test-key";
});

describe("getModel", () => {
  it("routes each role to its model", () => {
    expect(getModel("triage").model).toBe("claude-haiku-4-5-20251001");
    expect(getModel("reasoning").model).toBe("claude-sonnet-5-5");
    expect(getModel("judge").model).toBe("claude-opus-5-5");
  });

  it("sets a temperature only on Haiku and visible adaptive thinking elsewhere", () => {
    expect(getModel("triage").temperature).toBe(0);
    const reasoning = getModel("reasoning");
    expect(reasoning.temperature).toBeUndefined();
    expect(reasoning.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });
});
