// Estimation by analogy, the deterministic part (SPEC §8.4, P5): nearest reference tickets, team
// bias, Fibonacci rounding, widened range without a close analogue (CL-20), T-shirt sizes.
// The ticket set is a parameter: eval:estimation (leave-one-out) removes one ticket from it.
import { cosineSimilarity, type Vector } from "@/lib/clustering/agglomerative";
import type { Weighting } from "@/lib/context";

export type ReferenceTicketForEstimate = {
  id: string;
  title: string;
  description: string;
  components: string[];
  estimated_points: number;
  actual_points: number;
  surprises: string | null;
  vector: Vector;
};

export type Analogue<T extends ReferenceTicketForEstimate = ReferenceTicketForEstimate> = {
  ticket: T;
  similarity: number;
  close: boolean;
};

export type PointsRange = { min: number; max: number };

export type Tshirt = "S" | "M" | "L" | "XL";

export type Bias = {
  /** Mean ratio actual ÷ estimated points; 1 when not applied. */
  factor: number;
  /** Distinct tickets touching at least one of the components. */
  tickets: number;
  applied: boolean;
};

/** Text embedded for a reference ticket (scripts/seed.ts) and compared to the need. */
export function ticketEmbeddingText(
  ticket: Pick<ReferenceTicketForEstimate, "title" | "description">,
) {
  return `${ticket.title} — ${ticket.description}`;
}

export function isCloseAnalogue(similarity: number, minSimilarity: number): boolean {
  return similarity >= minSimilarity;
}

/** The k tickets closest to the need, by cosine similarity (ties broken by id). */
export function findReferenceTickets<T extends ReferenceTicketForEstimate>(
  query: Vector,
  tickets: readonly T[],
  options: { k?: number; minSimilarity: number },
): Analogue<T>[] {
  return tickets
    .map((ticket) => ({ ticket, similarity: cosineSimilarity(query, ticket.vector) }))
    .sort((a, b) => b.similarity - a.similarity || a.ticket.id.localeCompare(b.ticket.id))
    .slice(0, options.k ?? 3)
    .map((a) => ({ ...a, close: isCloseAnalogue(a.similarity, options.minSimilarity) }));
}

/**
 * Team bias on the touched components: mean actual ÷ estimated points of the distinct tickets that
 * touch at least one of them. No correction below `minTickets` tickets.
 */
export function biasFactor(
  components: readonly string[],
  tickets: readonly Pick<
    ReferenceTicketForEstimate,
    "components" | "estimated_points" | "actual_points"
  >[],
  minTickets: number,
): Bias {
  const touched = tickets.filter((t) => t.components.some((c) => components.includes(c)));
  if (touched.length < minTickets) return { factor: 1, tickets: touched.length, applied: false };
  const ratios = touched.map((t) => t.actual_points / t.estimated_points);
  const factor = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return { factor, tickets: touched.length, applied: true };
}

/** Bias of each component taken alone, shown to the model for information (skill estimation). */
export function biasByComponent(
  components: readonly string[],
  tickets: Parameters<typeof biasFactor>[1],
  minTickets: number,
): Record<string, Bias> {
  return Object.fromEntries(components.map((c) => [c, biasFactor([c], tickets, minTickets)]));
}

/** Closest Fibonacci value (ties go up). */
export function nearestFibonacci(value: number, scale: readonly number[]): number {
  return scale.reduce((best, f) =>
    Math.abs(f - value) < Math.abs(best - value) ||
    (Math.abs(f - value) === Math.abs(best - value) && f > best)
      ? f
      : best,
  );
}

const floorFibonacci = (value: number, scale: readonly number[]) =>
  scale.filter((f) => f <= value).at(-1) ?? scale[0];

const ceilFibonacci = (value: number, scale: readonly number[]) =>
  scale.find((f) => f >= value) ?? scale.at(-1)!;

/** Multiplies both bounds by the bias factor, rounded to the nearest Fibonacci value. */
export function applyBias(
  range: PointsRange,
  factor: number,
  scale: readonly number[],
): PointsRange {
  const min = nearestFibonacci(range.min * factor, scale);
  const max = nearestFibonacci(range.max * factor, scale);
  return { min: Math.min(min, max), max };
}

/** Widens the range (min ÷ factor rounded down, max × factor rounded up, on the Fibonacci scale). */
export function widenRange(
  range: PointsRange,
  factor: number,
  scale: readonly number[],
): PointsRange {
  return {
    min: floorFibonacci(range.min / factor, scale),
    max: ceilFibonacci(range.max * factor, scale),
  };
}

/** S < 3 ; M < 8 ; L < 20 ; XL above (bounds of weighting.yaml, upper bound excluded). */
export function tshirtFromPoints(
  points: number,
  bounds: Weighting["effort"]["tshirt_upper_bounds"],
): Tshirt {
  if (points < bounds.S) return "S";
  if (points < bounds.M) return "M";
  if (points < bounds.L) return "L";
  return "XL";
}
