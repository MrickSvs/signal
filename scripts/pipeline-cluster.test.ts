import { describe, expect, it } from "vitest";
import { parseClusterArgs } from "./pipeline-cluster";

describe("parseClusterArgs", () => {
  it("defaults to the threshold of weighting.yaml", () => {
    expect(parseClusterArgs([])).toEqual({ threshold: undefined, runId: undefined });
  });

  it("reads --threshold and --run-id", () => {
    expect(
      parseClusterArgs(["--threshold", "0.3", "--run-id", "12ed5028-5c72-41f8-98a4-532975acd3fa"]),
    ).toEqual({ threshold: 0.3, runId: "12ed5028-5c72-41f8-98a4-532975acd3fa" });
  });

  it("rejects invalid values", () => {
    expect(() => parseClusterArgs(["--threshold"])).toThrow(/attend une valeur/);
    expect(() => parseClusterArgs(["--threshold", "0"])).toThrow(/entre 0 et 2/);
    expect(() => parseClusterArgs(["--threshold", "abc"])).toThrow(/entre 0 et 2/);
    expect(() => parseClusterArgs(["--run-id", "x"])).toThrow(/UUID/);
  });
});
