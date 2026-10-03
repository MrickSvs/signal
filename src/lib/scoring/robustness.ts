// Robustness (SPEC §8.5), top 5 only: the ranking is replayed with one parameter of the insight
// degraded at a time — Impact −1 level, Confidence −1 level, Effort at the high bound of its range
// (× 1.5 when it is not a range), Reach −30 %. Scenarios where its rank moves by more than one
// place: 0 → robuste, 1 → sensible, 2 or more → fragile.
import type { Weighting } from "@/lib/context";
import { rankEntries, rice, type RankEntry, type RiceParam, type RiceParams } from "./rice";

export type Robustness = "robuste" | "sensible" | "fragile";

export type RobustnessEntry = Omit<RankEntry, "rice"> & {
  params: RiceParams;
  /** High bound of the effort range in weeks; null when the effort is not a range. */
  effortHighWeeks: number | null;
};

export type Scenario = { param: RiceParam; value: number; rank: number; moved: boolean };

export type RobustnessResult = {
  robustness: Robustness;
  detail: { rank: number; moves: number; scenarios: Scenario[] };
};

export type RobustnessContext = {
  impactScale: readonly number[];
  confidenceLevels: readonly number[];
  params: Weighting["robustness"];
  defaultRangeMultiplier: number;
  tieBreakers: Weighting["ranking"]["tie_breakers"];
};

/** Next value down a decreasing scale; the lowest value stays. */
export function oneLevelDown(value: number, scale: readonly number[]): number {
  const lower = scale.filter((v) => v < value);
  return lower.length > 0 ? Math.max(...lower) : value;
}

export function degrade(entry: RobustnessEntry, param: RiceParam, ctx: RobustnessContext): number {
  const value = entry.params[param];
  switch (param) {
    case "impact":
      return oneLevelDown(value, ctx.impactScale);
    case "confidence":
      return oneLevelDown(value, ctx.confidenceLevels);
    case "effort":
      return Math.max(entry.effortHighWeeks ?? value * ctx.defaultRangeMultiplier, value);
    case "reach":
      return value * (1 - ctx.params.reach_degradation);
  }
}

export function classify(moves: number, params: Weighting["robustness"]): Robustness {
  if (moves === 0) return "robuste";
  return moves <= params.sensible_max_moves ? "sensible" : "fragile";
}

export function computeRobustness(
  entries: readonly RobustnessEntry[],
  ctx: RobustnessContext,
): Map<string, RobustnessResult> {
  const scored = entries.map((e) => ({ ...e, rice: rice(e.params) }));
  const ranked = rankEntries(scored, ctx.tieBreakers);
  const results = new Map<string, RobustnessResult>();

  for (const target of ranked.slice(0, ctx.params.top_n)) {
    const scenarios: Scenario[] = (["impact", "confidence", "effort", "reach"] as const).map(
      (param) => {
        const value = degrade(target, param, ctx);
        const replay = scored.map((e) =>
          e.id === target.id ? { ...e, rice: rice({ ...e.params, [param]: value }) } : e,
        );
        const rank = rankEntries(replay, ctx.tieBreakers).find((e) => e.id === target.id)!.rank;
        return {
          param,
          value: Math.round(value * 1000) / 1000,
          rank,
          moved: Math.abs(rank - target.rank) > ctx.params.rank_shift_tolerance,
        };
      },
    );
    const moves = scenarios.filter((s) => s.moved).length;
    results.set(target.id, {
      robustness: classify(moves, ctx.params),
      detail: { rank: target.rank, moves, scenarios },
    });
  }
  return results;
}
