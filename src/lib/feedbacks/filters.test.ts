import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  containsPattern,
  filtersToQuery,
  pageCount,
  parseFeedbackFilters,
  periodStart,
} from "./filters";

describe("parseFeedbackFilters", () => {
  it("keeps known values and drops unknown ones", () => {
    expect(
      parseFeedbackFilters({
        canal: "ticket_support",
        plan: "sans_compte",
        type: "pas_un_type",
        insight: "I-07",
        injection: "1",
        existante: "0",
        echec: ["1", "0"],
        q: "  kanban lent ",
        page: "3",
      }),
    ).toEqual({
      canal: "ticket_support",
      plan: "sans_compte",
      insight: "I-07",
      injection: true,
      echec: true,
      q: "kanban lent",
      page: 3,
    });
  });

  it("rejects malformed insight ids and pages", () => {
    expect(parseFeedbackFilters({ insight: "I-7'; drop", page: "-2" })).toEqual({ page: 1 });
    expect(parseFeedbackFilters({ page: "abc", periode: "1an" })).toEqual({ page: 1 });
  });

  it("caps the search text", () => {
    expect(parseFeedbackFilters({ q: "x".repeat(500) }).q).toHaveLength(200);
  });
});

describe("filtersToQuery", () => {
  it("round-trips through the URL and omits the first page", () => {
    const filters = parseFeedbackFilters({ domaine: "performance", injection: "1", page: "1" });
    const query = filtersToQuery(filters);
    expect(query).toBe("?domaine=performance&injection=1");
    expect(parseFeedbackFilters(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
  });

  it("adds extra parameters (detail panel) and keeps the page", () => {
    expect(filtersToQuery({ page: 2 }, { retour: "R-042", vide: undefined })).toBe(
      "?page=2&retour=R-042",
    );
    expect(filtersToQuery({ page: 1 })).toBe("");
  });

  it("counts the active filters without the page", () => {
    expect(activeFilterCount({ page: 4 })).toBe(0);
    expect(activeFilterCount({ page: 1, q: "x", canal: "nps" })).toBe(2);
  });
});

describe("helpers", () => {
  it("computes the start of a period from the scenario clock", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(periodStart("7j", now)?.toISOString()).toBe("2026-09-26T12:00:00.000Z");
    expect(periodStart(undefined, now)).toBeNull();
  });

  it("escapes ilike wildcards", () => {
    expect(containsPattern("100%_sûr\\")).toBe("%100\\%\\_sûr\\\\%");
  });

  it("always has at least one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
  });
});
