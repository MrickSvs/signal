// CLAUDE.md rule 4: no file of src/ reads the evaluation data. ESLint catches literal paths;
// this test also catches split paths (path.join("evals", "holdout")) and folder names alone.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
const SELF = path.join(SRC, "lib", "evals-guard.test.ts");
const FORBIDDEN = /ground-truth|ground_truth|["'`/\\]holdout["'`/\\]/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.(ts|tsx|js|mjs)$/.test(e.name) ? [full] : [];
  });
}

describe("evaluation data guard", () => {
  it("finds no reference to evals/ground-truth or evals/holdout in src/", () => {
    const offenders = files(SRC)
      .filter((f) => f !== SELF)
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });

  it("would catch a split path", () => {
    expect(FORBIDDEN.test(`path.join("evals", "holdout", "x.json")`)).toBe(true);
    expect(FORBIDDEN.test(`"evals/ground-truth/feedbacks.gt.json"`)).toBe(true);
  });
});
