// Confidence (SPEC §8.3): c = 0.4 × volume + 0.3 × diversity + 0.3 × quality, turned into a level
// (100 / 80 / 50 %), downgraded when the model flags contradictory evidence.
import type { Weighting } from "@/lib/context";

export type ConfidenceInput = {
  /** Distinct accounts or authors (CL-02): an account writing ten times weighs as one. */
  accounts: number;
  /** Distinct channels. */
  channels: number;
  /** Source weight of each feedback (client direct 1, support 1, internal relay 0.5). */
  sourceWeights: readonly number[];
  contradiction: boolean;
};

export type ConfidenceDetail = {
  c: number;
  volume: number;
  diversity: number;
  quality: number;
  /** Level before the downgrade. */
  level: number;
  downgraded: boolean;
};

export type Confidence = { value: number; detail: ConfidenceDetail };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Level values, highest first (1, 0.8, 0.5). */
export function confidenceLevels(params: Weighting["confidence"]): number[] {
  return params.levels.map((l) => l.value);
}

/** Moves a level down by `steps`, never below the lowest level. */
export function downgradeConfidence(
  value: number,
  levels: readonly number[],
  steps: number,
): number {
  const index = levels.indexOf(value);
  if (index === -1) throw new Error(`Niveau de Confidence inconnu : ${value}`);
  return levels[Math.min(index + steps, levels.length - 1)];
}

export function computeConfidence(
  input: ConfidenceInput,
  params: Weighting["confidence"],
): Confidence {
  const volume = Math.min(input.accounts / params.volume_saturation, 1);
  const diversity = Math.min(input.channels / params.diversity_saturation, 1);
  const quality =
    input.sourceWeights.length === 0
      ? 0
      : input.sourceWeights.reduce((a, b) => a + b, 0) / input.sourceWeights.length;
  const c =
    params.weights.volume * volume +
    params.weights.diversity * diversity +
    params.weights.quality * quality;
  // The last level starts at 0 (checked when weighting.yaml is loaded), so one always matches.
  const level = params.levels.find((l) => c >= l.min)!.value;
  const value = input.contradiction
    ? downgradeConfidence(level, confidenceLevels(params), params.contradiction_downgrade)
    : level;
  return {
    value,
    detail: {
      c: round3(c),
      volume: round3(volume),
      diversity: round3(diversity),
      quality: round3(quality),
      level,
      downgraded: value !== level,
    },
  };
}
