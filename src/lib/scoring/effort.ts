// Effort (SPEC §8.4): person-weeks = points ÷ velocity. From the estimate's range (its middle),
// then, once the backlog is written, from the sum of its items' points.
import type { PointsRange } from "@/lib/estimation/reference";

export type EffortSource = "estimation_initiale" | "backlog" | "manuel";

export type Effort = {
  weeks: number;
  source: EffortSource;
  /** Bounds of the range in weeks; null when the effort is not a range (backlog, override). */
  low_weeks: number | null;
  high_weeks: number | null;
  points: { min: number; max: number } | { sum: number } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function checkVelocity(velocity: number): void {
  if (!(velocity > 0)) throw new Error("La vélocité doit être strictement positive");
}

export function effortFromRange(range: PointsRange, velocity: number): Effort {
  checkVelocity(velocity);
  if (!(range.min > 0) || range.min > range.max) throw new Error("Fourchette de points invalide");
  return {
    weeks: round2((range.min + range.max) / 2 / velocity),
    source: "estimation_initiale",
    low_weeks: round2(range.min / velocity),
    high_weeks: round2(range.max / velocity),
    points: { min: range.min, max: range.max },
  };
}

export function effortFromBacklog(points: readonly number[], velocity: number): Effort {
  checkVelocity(velocity);
  const sum = points.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error("Aucun point dans le backlog");
  return {
    weeks: round2(sum / velocity),
    source: "backlog",
    low_weeks: null,
    high_weeks: null,
    points: { sum },
  };
}

/** The backlog refines the initial estimate as soon as one of its items has points. */
export function chooseEffort(
  range: PointsRange | null,
  backlogPoints: readonly (number | null)[],
  velocity: number,
): Effort | null {
  const points = backlogPoints.filter((p): p is number => p !== null && p > 0);
  if (points.length > 0) return effortFromBacklog(points, velocity);
  return range ? effortFromRange(range, velocity) : null;
}
