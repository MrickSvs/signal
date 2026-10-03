import { describe, expect, it } from "vitest";
import {
  activeInsightFilterCount,
  cardBadges,
  feedbackIdsOfItems,
  insightFiltersToQuery,
  insightSections,
  parseInsightFilters,
  sortInsights,
  type InsightCard,
} from "./list";

const card = (id: string, extra: Partial<InsightCard> = {}): InsightCard => ({
  id,
  title: `Titre ${id}`,
  problem_statement: "Énoncé",
  product_area: "taches",
  origin: "retours",
  status: "actif",
  ranked: true,
  merged_into: null,
  feedbacks_count: 5,
  accounts_count: 3,
  mrr_exposed: 100,
  renewals_90d: 0,
  plans: {},
  weekly: [0, 1, 2, 3, 4, 5],
  growth: 1,
  is_emerging: false,
  is_new: false,
  rank: null,
  moscow: null,
  moscow_is_final: false,
  alignment: null,
  ...extra,
});

describe("parseInsightFilters / insightFiltersToQuery", () => {
  it("reads known values and ignores the others", () => {
    expect(
      parseInsightFilters({
        tri: "mrr",
        domaine: "notifications",
        alignement: ["hors_strategie", "aligne"],
        statut: "rejete",
      }),
    ).toEqual({
      tri: "mrr",
      domaine: "notifications",
      alignement: "hors_strategie",
      statut: "rejete",
    });
    expect(parseInsightFilters({ tri: "hasard", domaine: "x", statut: "fusionne" })).toEqual({
      tri: "rang",
      domaine: undefined,
      alignement: undefined,
      statut: undefined,
    });
  });

  it("round-trips through the URL, the default sort left out", () => {
    const filters = parseInsightFilters({ tri: "volume", statut: "propose" });
    expect(insightFiltersToQuery(filters)).toBe("?tri=volume&statut=propose");
    expect(
      parseInsightFilters(Object.fromEntries(new URLSearchParams("tri=volume&statut=propose"))),
    ).toEqual(filters);
    expect(insightFiltersToQuery({ tri: "rang" })).toBe("");
    expect(activeInsightFilterCount(filters)).toBe(1);
  });
});

describe("sortInsights", () => {
  const cards = [
    card("I-10", { rank: 2, mrr_exposed: 500, feedbacks_count: 4, growth: 3 }),
    card("I-02", { rank: 1, mrr_exposed: 100, feedbacks_count: 9, growth: 1 }),
    card("I-03", { rank: null, mrr_exposed: 500, feedbacks_count: 9, growth: null }),
  ];
  it("sorts by rank (unranked last), then by MRR, volume or trend, ties by rank then id", () => {
    expect(sortInsights(cards, "rang").map((c) => c.id)).toEqual(["I-02", "I-10", "I-03"]);
    expect(sortInsights(cards, "mrr").map((c) => c.id)).toEqual(["I-10", "I-03", "I-02"]);
    expect(sortInsights(cards, "volume").map((c) => c.id)).toEqual(["I-02", "I-03", "I-10"]);
    expect(sortInsights(cards, "tendance").map((c) => c.id)).toEqual(["I-10", "I-02", "I-03"]);
  });
});

describe("insightSections", () => {
  const cards = [
    card("I-01", { status: "propose", rank: 2, alignment: "aligne" }),
    card("I-02", { rank: 1, alignment: "hors_strategie", product_area: "facturation_temps" }),
    card("I-03", { status: "propose", ranked: false }),
    card("I-04", { status: "rejete", ranked: false }),
    card("I-05", { status: "fusionne", ranked: false, merged_into: "I-01" }),
    card("I-06", { status: "archive", ranked: false }),
  ];

  it("splits ranked insights and weak signals; rejected, merged and archived ones stay out (CL-17)", () => {
    const s = insightSections(cards, { tri: "rang" });
    expect(s.toReview.map((c) => c.id)).toEqual(["I-01", "I-03"]);
    expect(s.ranked.map((c) => c.id)).toEqual(["I-02", "I-01"]);
    expect(s.weak.map((c) => c.id)).toEqual(["I-03"]);
    expect(s.rejected).toEqual([]);
  });

  it("filters by area and alignment; the review section ignores the filters", () => {
    const s = insightSections(cards, { tri: "rang", alignement: "hors_strategie" });
    expect(s.ranked.map((c) => c.id)).toEqual(["I-02"]);
    expect(s.weak).toEqual([]);
    expect(s.toReview).toHaveLength(2);
    expect(
      insightSections(cards, { tri: "rang", domaine: "facturation_temps" }).ranked,
    ).toHaveLength(1);
  });

  it("shows only what awaits the PO, or only the rejected ones", () => {
    expect(
      insightSections(cards, { tri: "rang", statut: "propose" }).ranked.map((c) => c.id),
    ).toEqual(["I-01"]);
    const rejected = insightSections(cards, { tri: "rang", statut: "rejete" });
    expect(rejected.rejected.map((c) => c.id)).toEqual(["I-04"]);
    expect(rejected.ranked).toEqual([]);
    expect(rejected.weak).toEqual([]);
  });
});

describe("cardBadges", () => {
  it("keeps at most three badges: to review, emerging (else new), manual", () => {
    expect(
      cardBadges(card("I-01", { status: "propose", is_emerging: true, is_new: true })),
    ).toEqual(["a_valider", "emergent"]);
    expect(cardBadges(card("I-02", { is_new: true, origin: "manuel" }))).toEqual([
      "nouveau",
      "manuel",
    ]);
    expect(cardBadges(card("I-03"))).toEqual([]);
  });
});

describe("feedbackIdsOfItems", () => {
  it("maps items to their feedbacks, once each", () => {
    expect(feedbackIdsOfItems(["R-042.1", "R-042.2", "R-007.1", "R-1000.3"])).toEqual([
      "R-042",
      "R-007",
      "R-1000",
    ]);
  });
});
