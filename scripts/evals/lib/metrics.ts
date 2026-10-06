// Pure metrics of the evals (PLAN 6.2, SPEC §14.2): item pairing, type accuracy, macro-F1,
// confusion matrix, pattern recall and purity, Kendall's tau, Fibonacci steps. No I/O here.
import { nearestFibonacci } from "@/lib/estimation/reference";

// ---------------------------------------------------------------------------
// Triage: expected items vs predicted items
// ---------------------------------------------------------------------------

export type ExpectedItem = {
  pattern_id: string;
  expected_type: string;
  acceptable_types: string[];
  expected_area: string;
  acceptable_areas: string[];
  existing_feature: boolean;
};

export type PredictedItem = { type: string; product_area: string; existing_feature: boolean };

export const typeOk = (e: ExpectedItem, p: PredictedItem) => e.acceptable_types.includes(p.type);
export const areaOk = (e: ExpectedItem, p: PredictedItem) =>
  e.acceptable_areas.includes(p.product_area);

function permutations(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n, k - 1))
    for (let i = 0; i < n; i++) if (!rest.includes(i)) out.push([...rest, i]);
  return out;
}

/**
 * Pairs each expected item with at most one predicted item, maximizing the agreement (type counts
 * twice as much as area; ties keep the predicted order). Unpaired expected items get null.
 */
export function pairItems(expected: readonly ExpectedItem[], predicted: readonly PredictedItem[]) {
  const k = Math.min(expected.length, predicted.length);
  const score = (e: ExpectedItem, p: PredictedItem) =>
    (typeOk(e, p) ? 2 : 0) + (areaOk(e, p) ? 1 : 0);
  let best: number[] = [];
  let bestScore = -1;
  // Expected items beyond the predicted count stay unpaired: choose which ones get a partner.
  for (const chosen of permutations(expected.length, k)) {
    for (const order of permutations(predicted.length, k)) {
      const total = chosen.reduce((s, e, i) => s + score(expected[e], predicted[order[i]]), 0);
      if (total > bestScore) {
        bestScore = total;
        best = expected.map((_, e) => {
          const at = chosen.indexOf(e);
          return at === -1 ? -1 : order[at];
        });
      }
    }
  }
  return expected.map((e, i) => ({
    expected: e,
    predicted: best[i] === -1 ? null : predicted[best[i]],
  }));
}

export type Pair = ReturnType<typeof pairItems>[number];

/** Share of expected items whose paired prediction has an acceptable type (unpaired: wrong). */
export function typeAccuracy(pairs: readonly Pair[]): number {
  if (pairs.length === 0) return 0;
  return pairs.filter((p) => p.predicted && typeOk(p.expected, p.predicted)).length / pairs.length;
}

export const MISSING = "∅";

/** Area labels for the F1: an acceptable area counts as the expected one; unpaired → ∅. */
export function areaLabels(pairs: readonly Pair[]): { truth: string[]; predicted: string[] } {
  return {
    truth: pairs.map((p) => p.expected.expected_area),
    predicted: pairs.map((p) =>
      !p.predicted
        ? MISSING
        : areaOk(p.expected, p.predicted)
          ? p.expected.expected_area
          : p.predicted.product_area,
    ),
  };
}

/** Macro-F1 over the labels seen in truth or prediction (∅ is never a class of its own). */
export function macroF1(truth: readonly string[], predicted: readonly string[]): number {
  const labels = [...new Set([...truth, ...predicted])].filter((l) => l !== MISSING);
  if (labels.length === 0) return 0;
  const f1s = labels.map((label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    truth.forEach((t, i) => {
      const p = predicted[i];
      if (t === label && p === label) tp++;
      else if (p === label) fp++;
      else if (t === label) fn++;
    });
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  });
  return f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

/** confusion[expected][predicted] = count (an acceptable type counts as the expected one). */
export function confusionMatrix(pairs: readonly Pair[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const { expected, predicted } of pairs) {
    const got = !predicted
      ? MISSING
      : typeOk(expected, predicted)
        ? expected.expected_type
        : predicted.type;
    matrix[expected.expected_type] ??= {};
    matrix[expected.expected_type][got] = (matrix[expected.expected_type][got] ?? 0) + 1;
  }
  return matrix;
}

/** Share of `relevant` that is in `found` (1 when nothing is relevant). */
export function recall(relevant: readonly string[], found: ReadonlySet<string>): number {
  if (relevant.length === 0) return 1;
  return relevant.filter((id) => found.has(id)).length / relevant.length;
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

/** Picks `n` items spread evenly over the list, always keeping `mustKeep` (deterministic). */
export function spreadSample<T>(items: readonly T[], n: number, mustKeep: (item: T) => boolean) {
  if (n >= items.length) return [...items];
  const kept = items.filter(mustKeep);
  const rest = items.filter((i) => !mustKeep(i));
  const room = Math.max(0, n - kept.length);
  const picked = Array.from(
    { length: Math.min(room, rest.length) },
    (_, i) => rest[Math.floor((i * rest.length) / room)],
  );
  const chosen = new Set<T>([...kept, ...picked]);
  return items.filter((i) => chosen.has(i));
}

// ---------------------------------------------------------------------------
// Detection: patterns vs insights
// ---------------------------------------------------------------------------

export type TruthForItems = {
  patterns: string[];
  expected_items: Pick<ExpectedItem, "pattern_id" | "acceptable_areas">[];
};

export type InsightItem = { id: string; feedback_id: string; product_area: string };

/**
 * Whether a stored item belongs to a pattern: its feedback carries the pattern and, when the
 * feedback mixes several patterns (E1), the item's area is one of the pattern's areas.
 */
export function itemInPattern(
  item: Pick<InsightItem, "product_area">,
  truth: TruthForItems,
  pattern: string,
): boolean {
  const mine = truth.expected_items.filter((e) => e.pattern_id === pattern);
  if (mine.length === 0) return false;
  if (mine.length === truth.expected_items.length) return true;
  return mine.some((e) => e.acceptable_areas.includes(item.product_area));
}

export type PatternMatch = {
  insight_id: string;
  /** Items of the pattern in the insight. */
  hits: number;
  /** Items of the insight with a ground truth (feedbacks added later have none). */
  known: number;
  recall: number;
  purity: number;
};

/**
 * For one pattern, the insight that holds most of its items (ties: higher purity, then id).
 * Recall: share of the pattern's expected items found in it; purity: share of its known items
 * that belong to the pattern.
 */
export function bestInsightFor(
  pattern: string,
  insights: readonly { id: string; items: readonly InsightItem[] }[],
  truth: ReadonlyMap<string, TruthForItems>,
): PatternMatch | null {
  const expected = [...truth.values()].reduce(
    (n, t) => n + t.expected_items.filter((e) => e.pattern_id === pattern).length,
    0,
  );
  const candidates = insights.map((insight) => {
    const known = insight.items.filter((i) => truth.has(i.feedback_id));
    const hits = known.filter((i) => itemInPattern(i, truth.get(i.feedback_id)!, pattern)).length;
    return {
      insight_id: insight.id,
      hits,
      known: known.length,
      recall: expected === 0 ? 0 : Math.min(1, hits / expected),
      purity: known.length === 0 ? 0 : hits / known.length,
    };
  });
  const ranked = candidates
    .filter((c) => c.hits > 0)
    .sort(
      (a, b) => b.hits - a.hits || b.purity - a.purity || a.insight_id.localeCompare(b.insight_id),
    );
  return ranked[0] ?? null;
}

// ---------------------------------------------------------------------------
// Stability and estimation
// ---------------------------------------------------------------------------

/**
 * Kendall's tau-a between two orderings, on the items present in both (1 = same order,
 * −1 = reversed). Fewer than two common items: 1.
 */
export function kendallTau(reference: readonly string[], other: readonly string[]): number {
  const position = new Map(other.map((id, i) => [id, i]));
  const common = reference.filter((id) => position.has(id));
  const n = common.length;
  if (n < 2) return 1;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (position.get(common[i])! < position.get(common[j])!) concordant++;
      else discordant++;
    }
  return (concordant - discordant) / ((n * (n - 1)) / 2);
}

/** Index of a value on the Fibonacci scale (rounded to the closest value first). */
export function fibonacciIndex(points: number, scale: readonly number[]): number {
  return scale.indexOf(nearestFibonacci(points, scale));
}

/** Distance in Fibonacci steps between the middle of the range (in steps) and the actual points. */
export function rangeStepError(
  range: { min: number; max: number },
  actual: number,
  scale: readonly number[],
): number {
  const middle = (fibonacciIndex(range.min, scale) + fibonacciIndex(range.max, scale)) / 2;
  return Math.abs(middle - fibonacciIndex(actual, scale));
}

export const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ---------------------------------------------------------------------------
// Text checks
// ---------------------------------------------------------------------------

const FRENCH = new Set(
  "le la les des du de un une est sont pas et sur pour dans qui que ne plus au aux en avec sans leur".split(
    " ",
  ),
);
const ENGLISH = new Set(
  "the is are and to of in not for on with it this that be from have can".split(" "),
);

/** French vs English by function words: true when French ones dominate (E3, fields in French). */
export function looksFrench(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const raw of words) {
    const w = raw.replace(/^[a-z]'/, "");
    if (FRENCH.has(w)) fr++;
    if (ENGLISH.has(w)) en++;
  }
  return fr > en;
}

/** Numbers of a text, normalized (French thousands separators and decimal comma). */
export function numbersIn(text: string): number[] {
  const matches = text.match(/\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
  return matches.map((m) => Number(m.replace(/[   ]/g, "").replace(",", ".")));
}

// ---------------------------------------------------------------------------
// Judge calibration
// ---------------------------------------------------------------------------

/**
 * Cohen's kappa between two raters on the same items (agreement beyond chance). 1 when both
 * agree perfectly with a single class used by both (chance agreement = 1 then).
 */
export function cohenKappa(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const labels = new Set([...a, ...b]);
  let expected = 0;
  for (const label of labels)
    expected +=
      (a.filter((x) => x === label).length / n) * (b.filter((x) => x === label).length / n);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}
