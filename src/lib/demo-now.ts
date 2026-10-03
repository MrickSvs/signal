// The whole scenario is relative to DEMO_NOW (SPEC §5.4, §16): the data stores offsets in days
// ("J+45", "5 days ago") and dates are computed at seed time, so the demo always looks fresh.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reference date of the scenario: DEMO_NOW (ISO 8601) if set, otherwise now. */
export function getDemoNow(env: Record<string, string | undefined> = process.env): Date {
  const raw = env.DEMO_NOW?.trim();
  if (!raw) return new Date();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`DEMO_NOW n'est pas une date ISO 8601 valide : « ${raw} ».`);
  }
  return date;
}

/** Adds a (possibly negative) number of days, in UTC. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Calendar date (YYYY-MM-DD) in UTC, for `date` columns. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
