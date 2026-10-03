import { describe, expect, it } from "vitest";
import { parseTriageArgs } from "./pipeline-triage";

describe("parseTriageArgs", () => {
  it("defaults to haiku, concurrency 8, no sample", () => {
    expect(parseTriageArgs([])).toEqual({
      model: "haiku",
      sample: undefined,
      runId: undefined,
      retryFailed: false,
      concurrency: 8,
    });
  });

  it("reads every flag", () => {
    const runId = "3f2c1b9e-8a4d-4c6e-9b1a-2d3e4f5a6b7c";
    expect(
      parseTriageArgs([
        "--model",
        "sonnet",
        "--sample",
        "20",
        "--run-id",
        runId,
        "--retry-failed",
        "--concurrency",
        "4",
      ]),
    ).toEqual({ model: "sonnet", sample: 20, runId, retryFailed: true, concurrency: 4 });
  });

  it("rejects invalid values", () => {
    expect(() => parseTriageArgs(["--model", "opus"])).toThrow(/haiku ou sonnet/);
    expect(() => parseTriageArgs(["--sample", "0"])).toThrow(/entier positif/);
    expect(() => parseTriageArgs(["--sample", "--retry-failed"])).toThrow(/attend une valeur/);
    expect(() => parseTriageArgs(["--run-id", "R-1"])).toThrow(/UUID/);
  });
});
