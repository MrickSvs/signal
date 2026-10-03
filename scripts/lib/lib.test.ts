import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { createRandom } from "./random";

describe("createRandom", () => {
  it("is reproducible for a given seed and differs across seeds", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it("keeps int within bounds and shuffles without losing items", () => {
    const random = createRandom(1);
    for (let i = 0; i < 200; i++) {
      const n = random.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    const items = [1, 2, 3, 4, 5, 6];
    expect([...random.shuffle(items)].sort()).toEqual(items);
  });
});

describe("csv", () => {
  it("round-trips commas, quotes, line breaks and empty cells", () => {
    const rows = [
      { id: "C-001", name: 'Plume & Cie, "agence"', note: "ligne 1\nligne 2", seats: 3 },
      { id: "C-002", name: "Atelier", note: null, seats: 0 },
    ];
    const parsed = parseCsv(toCsv(["id", "name", "note", "seats"], rows));
    expect(parsed).toEqual([
      { id: "C-001", name: 'Plume & Cie, "agence"', note: "ligne 1\nligne 2", seats: "3" },
      { id: "C-002", name: "Atelier", note: "", seats: "0" },
    ]);
  });

  it("rejects a row with the wrong number of columns", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/ligne 2/);
  });
});
