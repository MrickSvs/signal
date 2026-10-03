// Capacity (SPEC §4.6, §8.6): the cumulated effort of the Musts must stay ≤ 60 % of the quarter's
// roadmap capacity (DSDM rule). Beyond, an alert and the Musts to downgrade first.
import type { Weighting } from "@/lib/context";
import type { MoscowCategory } from "./moscow-rules";

export type CapacityEntry = {
  id: string;
  moscow: MoscowCategory;
  effort_weeks: number;
  rice: number;
  /** Must imposed by a hard rule (engagement, churn, critical bug), not only by the PO. */
  imposed: boolean;
};

export type CapacityReport = {
  capacity_weeks: number;
  must_weeks: number;
  share: number;
  alert: boolean;
  /** Musts to move to Should until the share is back under the limit, in order. */
  downgrade: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function roadmapCapacityWeeks(params: Weighting["capacity"]): number {
  return round2(params.developers * params.quarter_weeks * params.roadmap_share);
}

export function mustCapacity(
  entries: readonly CapacityEntry[],
  weighting: Weighting,
): CapacityReport {
  const capacity = roadmapCapacityWeeks(weighting.capacity);
  const limit = capacity * weighting.moscow.must_capacity_share;
  const musts = entries.filter((e) => e.moscow === "must");
  let weeks = musts.reduce((s, e) => s + e.effort_weeks, 0);
  const report = {
    capacity_weeks: capacity,
    must_weeks: round2(weeks),
    share: round2(weeks / capacity),
    alert: weeks > limit,
  };

  // Musts that no hard rule imposes go first, then the lowest scores.
  const downgrade: string[] = [];
  const candidates = musts.toSorted(
    (a, b) => Number(a.imposed) - Number(b.imposed) || a.rice - b.rice || a.id.localeCompare(b.id),
  );
  for (const must of candidates) {
    if (weeks <= limit) break;
    downgrade.push(must.id);
    weeks -= must.effort_weeks;
  }
  return { ...report, downgrade };
}
