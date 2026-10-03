// RICE = Reach × Impact × Confidence ÷ Effort (SPEC §8, §8.5): active overrides replace the
// computed parameters (the original stays visible), ties are broken by MRR exposed, then accounts,
// then id (CL-21). Only ranked insights enter the ranking (CL-17).
import type { Weighting } from "@/lib/context";

export const RICE_PARAMS = ["reach", "impact", "confidence", "effort"] as const;
export type RiceParam = (typeof RICE_PARAMS)[number];

export type RiceParams = Record<RiceParam, number>;

export type Overridden = Partial<Record<RiceParam, { original: number; value: number }>>;

/** Scores are compared at this precision, so that float noise never breaks a tie. */
const PRECISION = 1e6;

export function rice(params: RiceParams): number {
  if (!(params.effort > 0)) throw new Error("L'effort doit être strictement positif");
  const value = (params.reach * params.impact * params.confidence) / params.effort;
  return Math.round(value * PRECISION) / PRECISION;
}

/** Effective parameters: each active override replaces the computed value, which is kept. */
export function applyOverrides(
  computed: RiceParams,
  overrides: Partial<RiceParams>,
): { effective: RiceParams; overridden: Overridden } {
  const effective = { ...computed };
  const overridden: Overridden = {};
  for (const param of RICE_PARAMS) {
    const value = overrides[param];
    if (value === undefined) continue;
    effective[param] = value;
    overridden[param] = { original: computed[param], value };
  }
  return { effective, overridden };
}

export type RankEntry = {
  id: string;
  rice: number;
  mrr_exposed: number;
  accounts_count: number;
};

export function compareEntries(
  a: RankEntry,
  b: RankEntry,
  tieBreakers: Weighting["ranking"]["tie_breakers"],
): number {
  if (a.rice !== b.rice) return b.rice - a.rice;
  for (const key of tieBreakers) {
    if (key === "id") {
      const byId = a.id.localeCompare(b.id, "en", { numeric: true });
      if (byId !== 0) return byId;
    } else if (a[key] !== b[key]) {
      return b[key] - a[key];
    }
  }
  return 0;
}

/** Ranks from 1, highest score first. */
export function rankEntries<T extends RankEntry>(
  entries: readonly T[],
  tieBreakers: Weighting["ranking"]["tie_breakers"],
): (T & { rank: number })[] {
  return entries
    .toSorted((a, b) => compareEntries(a, b, tieBreakers))
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}
