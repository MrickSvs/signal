import { describe, expect, it } from "vitest";
import { annotationSchema, parseAnnotations } from "./calibration";

const annotation = (over: Record<string, unknown> = {}) => ({
  item_id: "CAL-01",
  kind: "tache",
  notes: { objectif: 4, definition_termine: 3 },
  verdict: "acceptable",
  comment: "",
  annotated_at: "2026-10-05T20:00:00.000Z",
  ...over,
});

describe("annotationSchema", () => {
  it("wants one note per criterion of the item's grid, nothing else", () => {
    expect(annotationSchema.safeParse(annotation()).success).toBe(true);
    expect(annotationSchema.safeParse(annotation({ notes: { objectif: 4 } })).success).toBe(false);
    expect(
      annotationSchema.safeParse(
        annotation({ notes: { objectif: 4, definition_termine: 3, invest: 2 } }),
      ).success,
    ).toBe(false);
    expect(
      annotationSchema.safeParse(annotation({ notes: { objectif: 0, definition_termine: 3 } }))
        .success,
    ).toBe(false);
    expect(annotationSchema.safeParse(annotation({ item_id: "US-001" })).success).toBe(false);
  });
});

describe("parseAnnotations", () => {
  it("keeps the latest annotation of each item and skips invalid lines", () => {
    const jsonl = [
      JSON.stringify(annotation({ verdict: "a_reprendre" })),
      "",
      JSON.stringify(annotation({ item_id: "CAL-02" })),
      JSON.stringify({ item_id: "CAL-03" }),
      JSON.stringify(annotation()),
    ].join("\n");
    const parsed = parseAnnotations(jsonl);
    expect([...parsed.keys()]).toEqual(["CAL-01", "CAL-02"]);
    expect(parsed.get("CAL-01")?.verdict).toBe("acceptable");
  });
});
