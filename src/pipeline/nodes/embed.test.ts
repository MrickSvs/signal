import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "@/lib/db/memory";
import { isClusterable, itemEmbeddingText, parseVector, runEmbed } from "./embed";

describe("itemEmbeddingText", () => {
  it("embeds « underlying problem — summary », never the raw text (ADR 010)", () => {
    expect(
      itemEmbeddingText({
        underlying_problem: " Je rate des échéances. ",
        summary: "E-mails absents. ",
      }),
    ).toBe("Je rate des échéances. — E-mails absents.");
  });
});

describe("isClusterable", () => {
  it("leaves praise, usage questions and « autre » out (CL-04)", () => {
    expect(isClusterable({ type: "bug" })).toBe(true);
    expect(isClusterable({ type: "signal_churn" })).toBe(true);
    for (const type of ["eloge", "question", "autre"] as const)
      expect(isClusterable({ type })).toBe(false);
  });
});

describe("parseVector", () => {
  it("reads pgvector strings and arrays", () => {
    expect(parseVector("[0.1,-0.2]")).toEqual([0.1, -0.2]);
    expect(parseVector([1, 2])).toEqual([1, 2]);
    expect(parseVector(null)).toBeNull();
    expect(() => parseVector('["a"]')).toThrow();
  });
});

describe("runEmbed", () => {
  it("embeds only the items without a vector and stores them", async () => {
    const tables = {
      feedback_items: [
        { id: "R-001.1", underlying_problem: "P1", summary: "S1", embedding: null },
        { id: "R-002.1", underlying_problem: "P2", summary: "S2", embedding: "[0,1]" },
        { id: "R-003.1", underlying_problem: "P3", summary: "S3", embedding: null },
      ],
    };
    const embedFn = vi.fn(async (texts: string[]) => texts.map((_, i) => [i, 0.5]));
    const summary = await runEmbed(createMemoryDb(tables), { embedFn });
    expect(embedFn).toHaveBeenCalledWith(["P1 — S1", "P3 — S3"]);
    expect(summary.embedded).toEqual(["R-001.1", "R-003.1"]);
    expect(tables.feedback_items.map((i) => i.embedding)).toEqual(["[0,0.5]", "[0,1]", "[1,0.5]"]);

    embedFn.mockClear();
    expect((await runEmbed(createMemoryDb(tables), { embedFn })).embedded).toEqual([]);
    expect(embedFn).not.toHaveBeenCalled();
  });
});
