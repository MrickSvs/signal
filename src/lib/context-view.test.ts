import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_DIR } from "./context";
import { markdownSection, weightingSections } from "./context-view";

const SOURCE = `# Header of the file.

version: 1

# §8.1 Reach.
reach:
  default_mode: comptes # comptes | mrr
  factors: # one complaint stands for N accounts
    free: 6
    pro: 4
  plain: 0

# Two lines
# of comment.
levels:
  list: [3, 2, 1]
  objects:
    - { min: 0.7, value: 1 }
    - { min: 0, value: 0.5 }
`;

describe("weightingSections", () => {
  it("keeps one section per top-level map, with its comment, and skips scalars", () => {
    const sections = weightingSections(SOURCE);
    expect(sections.map((s) => [s.key, s.comment])).toEqual([
      ["reach", "§8.1 Reach."],
      ["levels", "Two lines of comment."],
    ]);
  });

  it("renders values on one line and keeps inline and collection comments", () => {
    const [reach, levels] = weightingSections(SOURCE);
    expect(reach.rows).toEqual([
      { key: "default_mode", value: "comptes", comment: "comptes | mrr" },
      {
        key: "factors",
        value: "{ free 6, pro 4 }",
        comment: "one complaint stands for N accounts",
      },
      { key: "plain", value: "0", comment: null },
    ]);
    expect(levels.rows.map((r) => r.value)).toEqual([
      "3, 2, 1",
      "{ min 0.7, value 1 }, { min 0, value 0.5 }",
    ]);
  });

  it("rejects invalid YAML", () => {
    expect(() => weightingSections("a: [1, 2")).toThrow(/weighting.yaml/);
  });

  it("covers every section of the real weighting.yaml", async () => {
    const source = await readFile(path.join(DEFAULT_CONTEXT_DIR, "weighting.yaml"), "utf8");
    const sections = weightingSections(source);
    expect(sections.map((s) => s.key)).toContain("moscow");
    expect(sections.every((s) => s.rows.length > 0)).toBe(true);
  });
});

describe("markdownSection", () => {
  const md = "# Title\n\nIntro.\n\n## First\n\nA.\n\n## Second step\n\n1. One\n2. Two\n";

  it("returns the body of a « ## » section, without its heading", () => {
    expect(markdownSection(md, "Second step")).toBe("1. One\n2. Two");
    expect(markdownSection(md, "First")).toBe("A.");
  });

  it("returns null when the heading is missing", () => {
    expect(markdownSection(md, "Missing")).toBeNull();
  });

  it("finds the 3 adaptation steps in the real pack README", async () => {
    const readme = await readFile(path.join(DEFAULT_CONTEXT_DIR, "README.md"), "utf8");
    const steps = markdownSection(readme, "Adapter Signal à un autre produit");
    expect(steps?.match(/^\d\. /gm)).toHaveLength(3);
  });
});
