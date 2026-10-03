import { describe, expect, it } from "vitest";
import { parseScoreArgs } from "./pipeline-score";

describe("parseScoreArgs", () => {
  it("defaults to the mode of weighting.yaml", () => {
    expect(parseScoreArgs([])).toEqual({ reachMode: undefined, runId: undefined });
  });

  it("reads --reach-mode and --run-id", () => {
    expect(
      parseScoreArgs(["--reach-mode", "mrr", "--run-id", "12ed5028-5c72-41f8-98a4-532975acd3fa"]),
    ).toEqual({ reachMode: "mrr", runId: "12ed5028-5c72-41f8-98a4-532975acd3fa" });
  });

  it("rejects invalid values", () => {
    expect(() => parseScoreArgs(["--reach-mode"])).toThrow(/attend une valeur/);
    expect(() => parseScoreArgs(["--reach-mode", "sièges"])).toThrow(/comptes/);
    expect(() => parseScoreArgs(["--run-id", "x"])).toThrow(/UUID/);
  });
});
