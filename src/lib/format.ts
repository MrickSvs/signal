// Display formatting (SPEC §12.1): French, and every date in Paris time whatever the browser or
// server time zone (CL-44). Dates are stored in UTC; "now" is always passed in (getDemoNow() on
// the server) so relative dates follow the scenario clock and render the same on both sides.

export const DISPLAY_TIME_ZONE = "Europe/Paris";
const LOCALE = "fr-FR";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

type DateInput = Date | string;

function toDate(value: DateInput): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`Date invalide : « ${String(value)} ».`);
  return date;
}

// Intl formatters are costly to build: one per option set.
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, options);
    numberFormats.set(key, format);
  }
  return format;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: DISPLAY_TIME_ZONE });
    dateFormats.set(key, format);
  }
  return format;
}

/** French number with narrow no-break spaces: 1 234,5. */
export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return numberFormat({ maximumFractionDigits }).format(value);
}

/** Whole euros: 12 400 €. */
export function formatEur(value: number): string {
  return numberFormat({ style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    value,
  );
}

/** Small amounts such as LLM costs, with cents: 0,23 €. */
export function formatCost(value: number): string {
  return numberFormat({
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** A ratio (0.27) as a percentage: 27 %. */
export function formatPercent(ratio: number, maximumFractionDigits = 0): string {
  return numberFormat({ style: "percent", maximumFractionDigits }).format(ratio);
}

/** 3 oct. 2026 (Paris). */
export function formatDate(value: DateInput): string {
  return dateFormat({ day: "numeric", month: "short", year: "numeric" }).format(toDate(value));
}

/** 3 oct. 2026, 14:05 (Paris). */
export function formatDateTime(value: DateInput): string {
  return dateFormat({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(value));
}

/** 14:05 (Paris). */
export function formatTime(value: DateInput): string {
  return dateFormat({ hour: "2-digit", minute: "2-digit" }).format(toDate(value));
}

/** Calendar day in Paris, as YYYY-MM-DD. */
export function parisDay(value: DateInput): string {
  const parts = dateFormat({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    toDate(value),
  );
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole calendar days from `now` to `value`, counted in Paris (negative in the past). */
export function calendarDaysBetween(now: DateInput, value: DateInput): number {
  const day = (input: DateInput) => Date.parse(`${parisDay(input)}T00:00:00Z`);
  return Math.round((day(value) - day(now)) / (24 * HOUR_MS));
}

const relative = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

/** « à l'instant », « il y a 5 minutes », « hier », « il y a 3 jours », « dans 2 mois ». */
export function formatRelative(value: DateInput, now: DateInput): string {
  const diffMs = toDate(value).getTime() - toDate(now).getTime();
  const absMs = Math.abs(diffMs);
  if (absMs < MINUTE_MS) return "à l'instant";
  const days = calendarDaysBetween(now, value);
  if (days === 0 || absMs < 6 * HOUR_MS) {
    if (absMs < HOUR_MS) return relative.format(Math.trunc(diffMs / MINUTE_MS), "minute");
    return relative.format(Math.trunc(diffMs / HOUR_MS), "hour");
  }
  if (Math.abs(days) < 60) return relative.format(days, "day");
  if (Math.abs(days) < 365) return relative.format(Math.round(days / 30), "month");
  return relative.format(Math.round(days / 365), "year");
}

/** Days left before a date (renewals): « J+45 », « aujourd'hui », « dépassé de 3 j ». */
export function formatDaysUntil(value: DateInput, now: DateInput): string {
  const days = calendarDaysBetween(now, value);
  if (days === 0) return "aujourd'hui";
  if (days < 0) return `dépassé de ${-days} j`;
  return `J+${days}`;
}
