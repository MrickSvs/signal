// Filters of the « Retours » screen (SPEC §12.3), kept in the URL so that a filtered view can be
// shared and reloaded. Pure: parsing never throws, an unknown value is simply ignored.
import { Constants, type Database } from "@/lib/db/types";
import { addDays } from "@/lib/demo-now";

type Enums = Database["public"]["Enums"];
const enums = Constants.public.Enums;

export const INBOX_PAGE_SIZE = 25;

/** Plan filter: a plan, or feedbacks without an identified account (E7). */
export const NO_ACCOUNT = "sans_compte";

export const PERIODS = {
  "7j": { days: 7, label: "7 derniers jours" },
  "30j": { days: 30, label: "30 derniers jours" },
} as const;
export type Period = keyof typeof PERIODS;

export type FeedbackFilters = {
  canal?: Enums["feedback_channel"];
  plan?: Enums["customer_plan"] | typeof NO_ACCOUNT;
  segment?: Enums["customer_segment"];
  type?: Enums["item_type"];
  domaine?: Enums["product_area"];
  insight?: string;
  periode?: Period;
  injection?: true;
  existante?: true;
  echec?: true;
  q?: string;
  page: number;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.includes(value as T) ? (value as T) : undefined;
}

const MAX_QUERY_CHARS = 200;

export function parseFeedbackFilters(params: SearchParams): FeedbackFilters {
  const flag = (key: string) => (first(params[key]) === "1" ? (true as const) : undefined);
  const page = Number.parseInt(first(params.page) ?? "", 10);
  const insight = first(params.insight);
  const filters: FeedbackFilters = {
    canal: oneOf(enums.feedback_channel, first(params.canal)),
    plan: oneOf([...enums.customer_plan, NO_ACCOUNT], first(params.plan)),
    segment: oneOf(enums.customer_segment, first(params.segment)),
    type: oneOf(enums.item_type, first(params.type)),
    domaine: oneOf(enums.product_area, first(params.domaine)),
    insight: insight && /^I-\d{2,}$/.test(insight) ? insight : undefined,
    periode: oneOf(Object.keys(PERIODS) as Period[], first(params.periode)),
    injection: flag("injection"),
    existante: flag("existante"),
    echec: flag("echec"),
    q: first(params.q)?.slice(0, MAX_QUERY_CHARS),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined),
  ) as FeedbackFilters;
}

/** URL query of the filters, without the page when it is the first one. */
export function filtersToQuery(
  filters: FeedbackFilters,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || (key === "page" && value === 1)) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Number of active filters (page excluded), for the « Effacer les filtres » link. */
export function activeFilterCount(filters: FeedbackFilters): number {
  return Object.keys(filters).filter((key) => key !== "page").length;
}

/** Start of the period, relative to the scenario clock (DEMO_NOW), null for « toute la période ». */
export function periodStart(period: Period | undefined, now: Date): Date | null {
  return period ? addDays(now, -PERIODS[period].days) : null;
}

/** ilike pattern matching the text anywhere, with the wildcards of the query escaped. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
}
