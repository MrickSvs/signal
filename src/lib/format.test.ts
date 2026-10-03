import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  formatCost,
  formatDate,
  formatDateTime,
  formatDaysUntil,
  formatEur,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  parisDay,
} from "./format";

// Intl uses narrow no-break spaces in French; compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("numbers", () => {
  it("formats numbers, euros, costs and percentages in French", () => {
    expect(plain(formatNumber(1234.56))).toBe("1 234,6");
    expect(plain(formatNumber(2.345, 2))).toBe("2,35");
    expect(plain(formatEur(12400))).toBe("12 400 €");
    expect(plain(formatCost(0.2349))).toBe("0,23 €");
    expect(plain(formatPercent(0.27))).toBe("27 %");
  });
});

describe("dates in Paris time (CL-44)", () => {
  it("shows Paris time in summer and winter, whatever the process time zone", () => {
    // 22:30 UTC on 3 Oct is 00:30 on 4 Oct in Paris (UTC+2).
    expect(formatDate("2026-10-03T22:30:00Z")).toBe("4 oct. 2026");
    expect(formatTime("2026-10-03T22:30:00Z")).toBe("00:30");
    // Winter: UTC+1.
    expect(formatTime("2026-12-15T08:00:00Z")).toBe("09:00");
    expect(plain(formatDateTime("2026-12-15T08:00:00Z"))).toBe("15 déc. 2026, 09:00");
  });

  it("does not depend on the TZ of the running process", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Sao_Paulo";
      expect(formatTime("2026-10-03T22:30:00Z")).toBe("00:30");
      process.env.TZ = "Asia/Tokyo";
      expect(parisDay("2026-10-03T22:30:00Z")).toBe("2026-10-04");
    } finally {
      process.env.TZ = previous;
    }
  });

  it("reads date-only columns as that calendar day", () => {
    expect(formatDate("2026-12-01")).toBe("1 déc. 2026");
  });

  it("rejects invalid dates", () => {
    expect(() => formatDate("pas une date")).toThrow(/Date invalide/);
  });
});

describe("relative dates", () => {
  const now = "2026-10-03T10:00:00Z"; // 12:00 in Paris

  it("covers minutes, hours, days, months and years", () => {
    expect(formatRelative("2026-10-03T09:59:30Z", now)).toBe("à l'instant");
    expect(formatRelative("2026-10-03T09:55:00Z", now)).toBe("il y a 5 minutes");
    expect(formatRelative("2026-10-03T07:00:00Z", now)).toBe("il y a 3 heures");
    expect(formatRelative("2026-10-02T09:00:00Z", now)).toBe("hier");
    expect(formatRelative("2026-09-28T10:00:00Z", now)).toBe("il y a 5 jours");
    expect(formatRelative("2026-10-13T10:00:00Z", now)).toBe("dans 10 jours");
    expect(formatRelative("2026-06-01T10:00:00Z", now)).toBe("il y a 4 mois");
    expect(formatRelative("2024-10-01T10:00:00Z", now)).toBe("il y a 2 ans");
  });

  it("counts calendar days in Paris, not elapsed hours", () => {
    // Now is 00:30 on 3 Oct in Paris; 23:00 on 2 Oct (UTC 21:00) is already the day before.
    const justAfterMidnight = "2026-10-02T22:30:00Z";
    expect(calendarDaysBetween(justAfterMidnight, "2026-10-02T21:00:00Z")).toBe(-1);
    // 10 hours earlier, but on the previous Paris day: « hier ».
    expect(formatRelative("2026-10-02T12:30:00Z", justAfterMidnight)).toBe("hier");
  });

  it("formats days before a renewal", () => {
    expect(formatDaysUntil("2026-11-17", now)).toBe("J+45");
    expect(formatDaysUntil("2026-10-03", now)).toBe("aujourd'hui");
    expect(formatDaysUntil("2026-09-30", now)).toBe("dépassé de 3 j");
  });
});
