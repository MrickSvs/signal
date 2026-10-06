import { describe, expect, it } from "vitest";
import type { DraftItem } from "@/lib/backlog/draft";
import { draftedContent, typeConforms } from "./backlog";
import { agreement, calibrationMetrics, type Pairing } from "./judge-calibration";

const item = (kind: DraftItem["kind"]) =>
  ({ kind, title: kind, depends_on: [1] }) as unknown as DraftItem;

describe("typeConforms", () => {
  it("accepts the formats expected per pattern, with items that fit them", () => {
    expect(typeConforms("S1", { format: "bugs", epic: null, items: [item("bug")] }).pass).toBe(
      true,
    );
    expect(
      typeConforms("S1", { format: "bugs", epic: null, items: [item("bug"), item("story")] }),
    ).toEqual({
      pass: false,
      reason: "éléments bug, story",
    });
    expect(typeConforms("S1", { format: "story", epic: null, items: [item("story")] }).reason).toBe(
      "format story, attendu bugs",
    );
    expect(
      typeConforms("S2b", {
        format: "epic_stories",
        epic: { title: "E" },
        items: [item("tache"), item("story"), item("story")],
      }).pass,
    ).toBe(true);
    expect(
      typeConforms("S2b", {
        format: "epic_stories",
        epic: null,
        items: [item("story"), item("story")],
      }).reason,
    ).toBe("pas d'epic");
    expect(
      typeConforms("S2b", { format: "epic_stories", epic: {}, items: [item("story")] }).reason,
    ).toBe("moins de deux stories");
    expect(typeConforms("S3", { format: "story", epic: null, items: [item("story")] }).pass).toBe(
      true,
    );
    expect(typeConforms("S3", { format: "story", epic: null, items: [] }).reason).toBe(
      "aucune story",
    );
    expect(typeConforms("S7", { format: "tache", epic: null, items: [item("tache")] }).pass).toBe(
      true,
    );
    expect(typeConforms("manuel", { format: "tache", epic: null, items: [item("bug")] }).pass).toBe(
      false,
    );
  });

  it("drops the drafting positions from what the judge reads", () => {
    expect(draftedContent(item("story"))).toEqual({ kind: "story", title: "story" });
  });
});

describe("agreement", () => {
  const pair = (
    human: Record<string, number>,
    judge: Record<string, number>,
    hv: "acceptable" | "a_reprendre",
    jv: "acceptable" | "a_reprendre",
    degradation: string | null = null,
  ): Pairing => ({
    id: "CAL",
    kind: "tache",
    human: { notes: human, verdict: hv },
    judge: { notes: judge, verdict: jv },
    degradation,
  });

  it("measures notes within one point, bias, kappa and the degraded items caught", () => {
    const a = agreement([
      pair(
        { objectif: 4, definition_termine: 4 },
        { objectif: 5, definition_termine: 4 },
        "acceptable",
        "acceptable",
      ),
      pair(
        { objectif: 2, definition_termine: 1 },
        { objectif: 4, definition_termine: 2 },
        "a_reprendre",
        "a_reprendre",
        "x",
      ),
      pair(
        { objectif: 4, definition_termine: 3 },
        { objectif: 4, definition_termine: 3 },
        "acceptable",
        "a_reprendre",
      ),
    ]);
    expect(a.notes).toBe(6);
    expect(a.closeShare).toBeCloseTo(5 / 6);
    expect(a.exactShare).toBeCloseTo(3 / 6);
    expect(a.meanGap).toBeCloseTo(4 / 6);
    expect(a.byCriterion.objectif).toEqual({ bias: 1, close: 2, n: 3 });
    expect(a.verdictAgreement).toBeCloseTo(2 / 3);
    expect(a.degradedCaught).toEqual({ judge: 1, human: 1, total: 1 });
    const metrics = calibrationMetrics(a);
    expect(metrics[0]).toMatchObject({ met: true });
    expect(metrics[1].met).toBe(a.kappa >= 0.6);
  });

  it("is empty-safe", () => {
    const a = agreement([]);
    expect(a.closeShare).toBe(0);
    expect(calibrationMetrics(a)[4].value).toBeNull();
  });
});
