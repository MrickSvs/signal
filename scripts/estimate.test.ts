import { describe, expect, it } from "vitest";
import { parseEstimateArgs } from "./estimate";

describe("parseEstimateArgs", () => {
  it("reads a free-text need or an insight id, and --force", () => {
    expect(parseEstimateArgs(["Ajouter un suivi du temps"])).toEqual({
      need: "Ajouter un suivi du temps",
      force: false,
    });
    expect(parseEstimateArgs(["I-07", "--force"])).toEqual({ insightId: "I-07", force: true });
  });

  it("rejects a missing need, several needs and unknown options", () => {
    expect(() => parseEstimateArgs([])).toThrow(/Usage/);
    expect(() => parseEstimateArgs(["a", "b"])).toThrow(/Usage/);
    expect(() => parseEstimateArgs(["a", "--k", "3"])).toThrow(/Option inconnue/);
  });
});
