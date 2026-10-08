import { beforeAll, describe, expect, it } from "vitest";
import { getModel } from "./index";

// ChatAnthropic requires a key at construction; no request is ever sent here.
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY ??= "test-key";
});

describe("getModel", () => {
  it("routes each role to its model", () => {
    expect(getModel("triage").model).toBe("claude-haiku-5-5");
    expect(getModel("reasoning").model).toBe("claude-sonnet-5-5");
    expect(getModel("judge").model).toBe("claude-opus-5-5");
  });

  it("sets no temperature and visible adaptive thinking on every role (5.5 models)", () => {
    for (const role of ["triage", "reasoning", "judge"] as const) {
      const model = getModel(role);
      expect(model.temperature).toBeUndefined();
      expect(model.thinking).toEqual({ type: "adaptive", display: "summarized" });
    }
  });
});
