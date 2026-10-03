import { describe, expect, it } from "vitest";
import { parseRunArgs } from "./pipeline-run";

describe("parseRunArgs", () => {
  it("starts a new run by default", () => {
    expect(parseRunArgs([])).toEqual({
      resume: undefined,
      reachMode: undefined,
      batchSize: undefined,
    });
  });

  it("reads --resume, --reach-mode and --batch-size", () => {
    expect(
      parseRunArgs([
        "--resume",
        "12ed5028-5c72-41f8-98a4-532975acd3fa",
        "--reach-mode",
        "mrr",
        "--batch-size",
        "5",
      ]),
    ).toEqual({ resume: "12ed5028-5c72-41f8-98a4-532975acd3fa", reachMode: "mrr", batchSize: 5 });
  });

  it("rejects invalid values", () => {
    expect(() => parseRunArgs(["--resume"])).toThrow(/attend une valeur/);
    expect(() => parseRunArgs(["--resume", "x"])).toThrow(/UUID/);
    expect(() => parseRunArgs(["--reach-mode", "sièges"])).toThrow(/comptes/);
    expect(() => parseRunArgs(["--batch-size", "0"])).toThrow(/entier positif/);
  });
});
