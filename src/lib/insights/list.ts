// Insights screen (SPEC §12.4, PLAN 3.4): filters in the URL, sorting and sections. Pure code.
import { Constants, type Database } from "@/lib/db/types";

type Enums = Database["public"]["Enums"];

export const INSIGHT_SORTS = {
  rang: "Rang",
  mrr: "MRR exposé",
  volume: "Volume de retours",
  tendance: "Tendance",
} as const;
export type InsightSort = keyof typeof INSIGHT_SORTS;

/**
 * Sorts of the Insights screen (ADR-038): the weight of a problem, not its rank, which belongs to
 * the Priorisation screen. Volume first: a growth ratio on a handful of feedbacks is noise.
 */
export const SCREEN_SORTS = {
  volume: "Volume",
  mrr: "MRR exposé",
  tendance: "Tendance",
} as const;
export type ScreenSort = keyof typeof SCREEN_SORTS;

/** « propose »: only what awaits the PO; « rejete »: the rejected ones (out of the ranking). */
export const STATUS_FILTERS = { propose: "À valider", rejete: "Rejetés" } as const;
export type StatusFilter = keyof typeof STATUS_FILTERS;

/** Tab of the screen besides the live insights (the rejected ones are `statut=rejete`). */
export const INSIGHT_VIEWS = { surveiller: "À surveiller" } as const;
export type InsightView = keyof typeof INSIGHT_VIEWS;

export type InsightFilters = {
  tri: ScreenSort;
  vue?: InsightView;
  domaine?: Enums["product_area"];
  alignement?: Enums["alignment"];
  statut?: StatusFilter;
};

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.includes(value as T) ? (value as T) : undefined;

/** Unknown values are ignored (a stale or hand-edited link still opens the screen). */
export function parseInsightFilters(params: Params): InsightFilters {
  const enums = Constants.public.Enums;
  return {
    tri: oneOf(Object.keys(SCREEN_SORTS) as ScreenSort[], first(params.tri)) ?? "volume",
    vue: oneOf(Object.keys(INSIGHT_VIEWS) as InsightView[], first(params.vue)),
    domaine: oneOf(enums.product_area, first(params.domaine)),
    alignement: oneOf(enums.alignment, first(params.alignement)),
    statut: oneOf(Object.keys(STATUS_FILTERS) as StatusFilter[], first(params.statut)),
  };
}

export function insightFiltersToQuery(filters: InsightFilters): string {
  const params = new URLSearchParams();
  if (filters.vue) params.set("vue", filters.vue);
  if (filters.tri !== "volume") params.set("tri", filters.tri);
  if (filters.domaine) params.set("domaine", filters.domaine);
  if (filters.alignement) params.set("alignement", filters.alignement);
  if (filters.statut) params.set("statut", filters.statut);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The open tab: the rejected ones, a view, or the live insights by default. */
export function insightTab(filters: InsightFilters): "actifs" | InsightView | "rejetes" {
  return filters.statut === "rejete" ? "rejetes" : (filters.vue ?? "actifs");
}

export function activeInsightFilterCount(filters: InsightFilters): number {
  return [filters.domaine, filters.alignement, filters.statut].filter(Boolean).length;
}

export type InsightCard = {
  id: string;
  title: string;
  problem_statement: string;
  product_area: Enums["product_area"] | null;
  origin: Enums["insight_origin"];
  status: Enums["insight_status"];
  ranked: boolean;
  merged_into: string | null;
  feedbacks_count: number;
  accounts_count: number;
  mrr_exposed: number;
  renewals_90d: number;
  plans: Record<string, number>;
  /** Distinct accounts by customer segment (agence_com, cabinet_conseil…). */
  segments: Record<string, number>;
  weekly: number[];
  growth: number | null;
  is_emerging: boolean;
  is_new: boolean;
  rank: number | null;
  /** The PO's MoSCoW (active override) when there is one, else Signal's recommendation. */
  moscow: Enums["moscow"] | null;
  moscow_is_final: boolean;
  alignment: Enums["alignment"] | null;
};

const byId = (a: InsightCard, b: InsightCard) =>
  a.id.localeCompare(b.id, undefined, { numeric: true });

/** Rank first (unranked last); the other sorts are descending, ties broken by rank then id. */
export function sortInsights(cards: readonly InsightCard[], sort: InsightSort): InsightCard[] {
  const rank = (c: InsightCard) => c.rank ?? Number.POSITIVE_INFINITY;
  const byRank = (a: InsightCard, b: InsightCard) => rank(a) - rank(b) || byId(a, b);
  const key: Record<Exclude<InsightSort, "rang">, (c: InsightCard) => number> = {
    mrr: (c) => c.mrr_exposed,
    volume: (c) => c.feedbacks_count,
    tendance: (c) => c.growth ?? 0,
  };
  if (sort === "rang") return cards.toSorted(byRank);
  return cards.toSorted((a, b) => key[sort](b) - key[sort](a) || byRank(a, b));
}

export type InsightSections = {
  /** Proposed insights (SPEC §8.10), whatever the filters: the review covers them all. */
  toReview: InsightCard[];
  /** Live insights, ranked or not (a weak signal is marked on its row, SPEC §8). */
  active: InsightCard[];
  /** Shown only with the « rejete » filter. */
  rejected: InsightCard[];
};

const LIVE = new Set<Enums["insight_status"]>(["propose", "actif"]);

export function insightSections(
  cards: readonly InsightCard[],
  filters: InsightFilters,
): InsightSections {
  const matches = (c: InsightCard) =>
    (!filters.domaine || c.product_area === filters.domaine) &&
    (!filters.alignement || c.alignment === filters.alignement) &&
    (filters.statut !== "propose" || c.status === "propose");
  const sorted = sortInsights(cards, filters.tri);
  const live = sorted.filter((c) => LIVE.has(c.status));
  const showLive = filters.statut !== "rejete";
  return {
    toReview: sortInsights(
      cards.filter((c) => c.status === "propose"),
      "rang",
    ),
    active: showLive ? live.filter(matches) : [],
    rejected:
      filters.statut === "rejete" ? sorted.filter((c) => c.status === "rejete" && matches(c)) : [],
  };
}

/** Up to three badges on a card (SPEC §12.1): to review, then emerging or new, then manual. */
export function cardBadges(card: InsightCard): ("a_valider" | "emergent" | "nouveau" | "manuel")[] {
  const badges: ("a_valider" | "emergent" | "nouveau" | "manuel")[] = [];
  if (card.status === "propose") badges.push("a_valider");
  if (card.is_emerging) badges.push("emergent");
  else if (card.is_new) badges.push("nouveau");
  if (card.origin === "manuel") badges.push("manuel");
  return badges;
}

/** Feedbacks behind item ids (R-042.1 → R-042), without duplicates. */
export function feedbackIdsOfItems(itemIds: readonly string[]): string[] {
  return [...new Set(itemIds.map((id) => id.replace(/\.\d+$/, "")))];
}
