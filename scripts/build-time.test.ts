import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOG,
  formatMinutes,
  minutesBetween,
  OUTSIDE_PLAN,
  parseBuildLog,
  parseCost,
  parseDuration,
  phaseOf,
  renderReport,
  totalsByPhase,
} from "./build-time";

const LOG = `# Journal de build

- **Dettes** : une liste | avec une barre, pas une ligne du tableau.

| date       | étape | début | fin          | durée   | coût LLM | notes |
| ---------- | ----- | ----- | ------------ | ------- | -------- | ----- |
| 2026-10-02 | 0.1   | 20:07 | 20:11        | ~4 min  | 0 €      | Socle. |
| 2026-10-02 | 1.4   | 22:53 | 00:04 (+1 j) | ~1 h 25 | ~2,1 €   | Retours. |
| 2026-10-04 | 4.3   | 22:27 | 23:05        | ~40 min | ~0,45 €  | Backlog. |
| 2026-10-05 | 4.3 (fin) | 12:36 | 12:58    | ~25 min | ~0,40 €  | Suite. |
| 2026-10-05 | replanif. | 19:56 | 20:07    | ?       | 0 €      | Notion. |
| 2026-10-08 | Review, lot A | 17:16 | 18:02 | ~50 min | n/a     | Lot A. |

## Notes d'exploitation

| colonne | pas une session |
`;

describe("cells", () => {
  it("reads the durations of the journal", () => {
    expect(parseDuration("~4 min")).toBe(4);
    expect(parseDuration("~1 h 15")).toBe(75);
    expect(parseDuration("~1 h 05")).toBe(65);
    expect(parseDuration("~1 h")).toBe(60);
    expect(parseDuration("?")).toBeNull();
  });

  it("falls back on end − start, across midnight", () => {
    expect(minutesBetween("20:07", "20:11")).toBe(4);
    expect(minutesBetween("22:53", "00:04 (+1 j)")).toBe(71);
    expect(minutesBetween("18:31", "18:31")).toBe(0);
    expect(minutesBetween("20:00", "19:00")).toBeNull();
    expect(minutesBetween("—", "19:00")).toBeNull();
  });

  it("reads costs with a decimal comma", () => {
    expect(parseCost("0 €")).toBe(0);
    expect(parseCost("~0,002 €")).toBe(0.002);
    expect(parseCost("~2,1 €")).toBe(2.1);
    expect(parseCost("n/a")).toBeNull();
  });

  it("puts a step in its phase, anything else outside the plan", () => {
    expect(phaseOf("0.1")).toBe("0");
    expect(phaseOf("4.3 (fin)")).toBe("4");
    expect(phaseOf("8.1 (base de démo)")).toBe("8");
    expect(phaseOf("replanif.")).toBe(OUTSIDE_PLAN);
    expect(phaseOf("Digest (refonte UX)")).toBe(OUTSIDE_PLAN);
    expect(phaseOf("12.1")).toBe(OUTSIDE_PLAN);
  });

  it("formats minutes as the journal does", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(65)).toBe("1 h 05");
  });
});

describe("parseBuildLog", () => {
  it("keeps the session rows only, duration from the column or else from the times", () => {
    const entries = parseBuildLog(LOG);
    expect(entries.map((e) => e.step)).toEqual([
      "0.1",
      "1.4",
      "4.3",
      "4.3 (fin)",
      "replanif.",
      "Review, lot A",
    ]);
    expect(entries[1]).toEqual({
      date: "2026-10-02",
      step: "1.4",
      phase: "1",
      minutes: 85,
      costEur: 2.1,
    });
    expect(entries[4]!.minutes).toBe(11); // « ? » → 20:07 − 19:56
    expect(entries[5]!.costEur).toBeNull();
  });
});

describe("totalsByPhase", () => {
  it("sums each phase in plan order, outside the plan last, and lists what it could not read", () => {
    const totals = totalsByPhase(parseBuildLog(LOG));
    expect(totals.map((t) => [t.phase, t.sessions, t.minutes])).toEqual([
      ["0", 1, 4],
      ["1", 1, 85],
      ["4", 2, 65],
      [OUTSIDE_PLAN, 2, 61],
    ]);
    expect(totals[2]!.costEur).toBeCloseTo(0.85);
    expect(totals[2]!.steps).toEqual(["4.3", "4.3 (fin)"]);
    expect(totals[3]!.unreadable).toEqual(["Review, lot A"]);
  });

  it("renders a table with the grand total and the unreadable sessions", () => {
    const report = renderReport(totalsByPhase(parseBuildLog(LOG)));
    expect(report).toContain("| 4. Agent Signal | 2 | 1 h 05 | 0,85 € | 4.3, 4.3 (fin) |");
    expect(report).toContain("| **Total** | 6 | **3 h 35** | **2,95 €** | |");
    expect(report).toContain("non compté) : Review, lot A.");
  });
});

describe("the real journal", () => {
  it("reads every session row, each with a duration and a cost", () => {
    const markdown = readFileSync(DEFAULT_LOG, "utf8");
    const rows = markdown.split("\n").filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
    const entries = parseBuildLog(markdown);
    expect(entries).toHaveLength(rows.length);
    expect(entries.filter((e) => e.minutes === null || e.costEur === null)).toEqual([]);
  });
});
