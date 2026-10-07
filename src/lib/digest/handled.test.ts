import { describe, expect, it } from "vitest";
import {
  readHandled,
  recommendationIndex,
  recommendationKey,
  repeatsHandled,
  type HandledRecommendation,
} from "./handled";

const handled = (preuves: string[]): HandledRecommendation => ({
  titre: "Prévenir le CSM de Studio Bastide",
  preuves,
  outcome: "fait",
  reason: null,
  at: "2026-10-07T09:00:00Z",
  decision_id: "D-140",
});

describe("recommendation keys", () => {
  it("round-trips the index of a recommendation within its digest", () => {
    const key = recommendationKey("abc", 2);
    expect(key).toBe("abc#3");
    expect(recommendationIndex(key, "abc")).toBe(2);
  });

  it("rejects a key of another digest or a malformed one", () => {
    expect(recommendationIndex("abc#3", "xyz")).toBeNull();
    expect(recommendationIndex("abc#0", "abc")).toBeNull();
    expect(recommendationIndex("abc#x", "abc")).toBeNull();
  });
});

describe("readHandled", () => {
  const row = {
    id: "D-140",
    entity_id: "abc#1",
    action: "validation",
    after: { statut: "fait", titre: "Prévenir le CSM", preuves: ["C-013", 7, "R-078"] },
    reason: null,
    created_at: "2026-10-07T09:00:00Z",
  };

  it("reads the outcome, title and evidence of a decision", () => {
    expect(readHandled(row)).toEqual({
      titre: "Prévenir le CSM",
      preuves: ["C-013", "R-078"],
      outcome: "fait",
      reason: null,
      at: "2026-10-07T09:00:00Z",
      decision_id: "D-140",
    });
    expect(readHandled({ ...row, after: { statut: "ecartee" }, reason: "déjà vu" })).toMatchObject({
      titre: "",
      preuves: [],
      outcome: "ecartee",
      reason: "déjà vu",
    });
  });

  it("ignores a decision that is not about a recommendation", () => {
    expect(readHandled({ ...row, after: null })).toBeNull();
    expect(readHandled({ ...row, after: { statut: "actif" } })).toBeNull();
  });
});

describe("repeatsHandled", () => {
  it("is a repeat when every cited id was already in an answered recommendation", () => {
    expect(repeatsHandled(["C-013", "R-078"], [handled(["C-013", "R-078", "I-59"])])).toBe(true);
  });

  it("is not a repeat as soon as one id is new", () => {
    expect(repeatsHandled(["C-013", "R-241"], [handled(["C-013", "R-078"])])).toBe(false);
  });

  it("is never a repeat without answered recommendations or without evidence", () => {
    expect(repeatsHandled(["C-013"], [])).toBe(false);
    expect(repeatsHandled([], [handled(["C-013"])])).toBe(false);
  });
});
