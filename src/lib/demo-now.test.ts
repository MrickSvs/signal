import { describe, expect, it } from "vitest";
import { addDays, getDemoNow, toIsoDate } from "./demo-now";

describe("getDemoNow", () => {
  it("reads DEMO_NOW when set", () => {
    expect(getDemoNow({ DEMO_NOW: "2026-03-10T09:00:00Z" }).toISOString()).toBe(
      "2026-03-10T09:00:00.000Z",
    );
  });

  it("falls back to now when DEMO_NOW is empty", () => {
    const before = Date.now();
    const now = getDemoNow({ DEMO_NOW: " " }).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("rejects an invalid date", () => {
    expect(() => getDemoNow({ DEMO_NOW: "demain" })).toThrow(/DEMO_NOW/);
  });
});

describe("addDays and toIsoDate", () => {
  it("shifts in both directions and formats a UTC calendar date", () => {
    const now = new Date("2026-03-10T23:30:00Z");
    expect(toIsoDate(addDays(now, 45))).toBe("2026-04-24");
    expect(toIsoDate(addDays(now, -10))).toBe("2026-02-28");
  });
});
