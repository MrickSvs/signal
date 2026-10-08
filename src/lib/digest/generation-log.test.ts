import { describe, expect, it } from "vitest";
import type { DigestStreamEvent } from "@/lib/digest/stream";
import type { DigestProgress } from "@/pipeline/nodes/digest";
import { buildGenerationLog, stepsDone } from "./generation-log";

const at = (event: DigestProgress, ms = 100): DigestStreamEvent => ({
  type: "progress",
  at: ms,
  event,
});

const facts: DigestProgress = {
  step: "facts",
  feedbacks: 14,
  channels: 3,
  alerts: 2,
  emerging: 1,
  newInsights: 0,
  moves: 0,
  accountsAtRisk: 1,
  pending: 0,
};

const upToWriting: DigestStreamEvent[] = [
  at({ step: "period", first: false, start: "2026-10-07T06:00:00Z", end: "2026-10-08T08:00:00Z" }),
  at(facts),
  at({ step: "memory", handled: 2 }),
  at({ step: "writing", model: "claude-sonnet-5-5" }),
];

describe("buildGenerationLog", () => {
  it("shows Signal connecting before any step", () => {
    const lines = buildGenerationLog([], { first: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: "connect", tone: "active" });
  });

  it("keeps only the figures that are not zero", () => {
    const lines = buildGenerationLog(upToWriting, { first: false });
    const factsLine = lines.find((l) => l.key === "facts")!;
    expect(factsLine.figures.map((f) => f.value)).toEqual([14, 2, 1, 1]);
    expect(factsLine.figures[0].label).toBe("retours");
    expect(factsLine.figures[2].label).toBe("sujet émergent");
  });

  it("says when there is nothing new", () => {
    const empty = {
      ...facts,
      feedbacks: 0,
      alerts: 0,
      emerging: 0,
      accountsAtRisk: 0,
      channels: 0,
    };
    const [, line] = buildGenerationLog([upToWriting[0], at(empty)], { first: false });
    expect(line.figures).toEqual([]);
    expect(line.detail).toBeUndefined();
  });

  it("ends on the model writing, active, until the writing is checked", () => {
    const lines = buildGenerationLog(upToWriting, { first: false });
    expect(lines.at(-1)).toMatchObject({ key: "writing", tone: "active", at: null });
    expect(lines.at(-1)!.title).toContain("Sonnet");
    expect(stepsDone(lines)).toBe(3);

    const written = buildGenerationLog(
      [...upToWriting, at({ step: "written", writer: "modele", recommendations: 3 }, 9000)],
      { first: false },
    );
    expect(written.filter((l) => l.key === "writing")).toHaveLength(1);
    expect(written.find((l) => l.key === "writing")).toMatchObject({ tone: "done", at: 9000 });
    expect(stepsDone(written)).toBe(4);
  });

  it("flags the fallback rendering as a warning", () => {
    const lines = buildGenerationLog(
      [...upToWriting, at({ step: "written", writer: "repli", recommendations: 0 })],
      { first: false },
    );
    expect(lines.find((l) => l.key === "writing")!.tone).toBe("warning");
  });

  it("finishes with the duration and the cost, and no active line", () => {
    const lines = buildGenerationLog(
      [
        ...upToWriting,
        at({ step: "written", writer: "modele", recommendations: 1 }),
        at({ step: "saved", id: "d1" }),
        { type: "done", result: { id: "d1", writer: "modele", costEur: 0.03, durationMs: 14_200 } },
      ],
      { first: true },
    );
    expect(lines.some((l) => l.tone === "active")).toBe(false);
    expect(lines.at(-1)).toMatchObject({ key: "done", title: "Ton premier digest est prêt" });
    expect(lines.at(-1)!.detail).toMatch(/^14 s · /);
    expect(stepsDone(lines)).toBe(5);
  });

  it("ends on the error, without an active line", () => {
    const lines = buildGenerationLog([{ type: "error", message: "Un run est en cours." }], {
      first: false,
    });
    expect(lines).toEqual([
      { key: "error", tone: "error", at: null, title: "Un run est en cours.", figures: [] },
    ]);
  });
});
