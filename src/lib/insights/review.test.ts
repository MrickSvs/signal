import { describe, expect, it } from "vitest";
import { unsentBacklogNote } from "./review";

describe("unsentBacklogNote", () => {
  it("names the drafts and validated items a rejection or a merge leaves behind", () => {
    expect(unsentBacklogNote("I-05", { brouillon: 2, valide: 1 })).toBe(
      "I-05 a 2 brouillons et 1 élément validé dans le backlog : ils y restent, mais ne partiront plus dans Notion. Rejette-les depuis le Backlog.",
    );
    expect(unsentBacklogNote("I-05", { brouillon: 0, valide: 3 })).toBe(
      "I-05 a 3 éléments validés dans le backlog : ils y restent, mais ne partiront plus dans Notion. Rejette-les depuis le Backlog.",
    );
    expect(unsentBacklogNote("I-05", { brouillon: 1, valide: 0 })).toBe(
      "I-05 a 1 brouillon dans le backlog : il y reste, mais ne partira plus dans Notion. Rejette-le depuis le Backlog.",
    );
  });

  it("says nothing without items left", () => {
    expect(unsentBacklogNote("I-05")).toBeNull();
    expect(unsentBacklogNote("I-05", { brouillon: 0, valide: 0 })).toBeNull();
  });
});
