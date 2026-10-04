// Overrides (SPEC §8.5): checked values, mandatory reason (except MoSCoW), and the « contexte
// modifié » flag when more than 30 % of the insight's feedbacks changed since the override (CL-22).
import type { Weighting } from "@/lib/context";
import { confidenceLevels } from "./confidence";
import type { MoscowCategory } from "./moscow-rules";
import type { ManualReach, ReachMode } from "./reach";
import type { RiceParams } from "./rice";

export const OVERRIDE_PARAMS = ["reach", "impact", "confidence", "effort", "moscow"] as const;
export type OverrideParam = (typeof OVERRIDE_PARAMS)[number];

const MOSCOW: readonly MoscowCategory[] = ["must", "should", "could", "wont"];

export type OverrideInput = { param: OverrideParam; value: unknown; reason?: string | null };

export type OverrideCheck = { ok: true } | { ok: false; error: string };

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** A manual insight's Reach: accounts, and MRR when the PO knows it (SPEC §8.9). */
export function isManualReach(value: unknown): value is ManualReach {
  if (typeof value !== "object" || value === null) return false;
  const { comptes, mrr } = value as Record<string, unknown>;
  return isPositive(comptes) && (mrr === null || isPositive(mrr));
}

/**
 * Reach override of an insight from the feedbacks: the two Reach modes have different units
 * (accounts, euros), so the override holds the mode it was entered in and applies only there.
 */
export type ModeReach = { mode: ReachMode; value: number };

export function isModeReach(value: unknown): value is ModeReach {
  if (typeof value !== "object" || value === null) return false;
  const { mode, value: v } = value as Record<string, unknown>;
  return (mode === "comptes" || mode === "mrr") && isPositive(v);
}

export function validateOverride(input: OverrideInput, weighting: Weighting): OverrideCheck {
  const { param, value } = input;
  if (param !== "moscow" && !input.reason?.trim()) {
    return { ok: false, error: "Une raison est obligatoire pour cet override" };
  }
  switch (param) {
    case "impact":
      return weighting.impact.scale.includes(value as number)
        ? { ok: true }
        : { ok: false, error: `Impact attendu dans ${weighting.impact.scale.join(", ")}` };
    case "confidence":
      return confidenceLevels(weighting.confidence).includes(value as number)
        ? { ok: true }
        : {
            ok: false,
            error: `Confidence attendue dans ${confidenceLevels(weighting.confidence)
              .map((v) => `${Math.round(v * 100)} %`)
              .join(", ")}`,
          };
    case "reach":
      return isPositive(value) || isManualReach(value) || isModeReach(value)
        ? { ok: true }
        : { ok: false, error: "Reach strictement positif attendu" };
    case "effort":
      return isPositive(value)
        ? { ok: true }
        : { ok: false, error: "Effort strictement positif attendu (semaines-personne)" };
    case "moscow":
      return MOSCOW.includes(value as MoscowCategory)
        ? { ok: true }
        : { ok: false, error: `MoSCoW attendu dans ${MOSCOW.join(", ")}` };
  }
}

/**
 * Share of the feedbacks that changed since the override (added or removed), over the feedbacks
 * it was set on; true beyond the threshold. Unknown snapshot: never flagged.
 */
export function contextChanged(
  snapshot: readonly string[] | null,
  current: readonly string[],
  threshold: number,
): boolean {
  if (snapshot === null) return false;
  const before = new Set(snapshot);
  const after = new Set(current);
  const changed =
    [...after].filter((id) => !before.has(id)).length +
    [...before].filter((id) => !after.has(id)).length;
  return changed / Math.max(before.size, 1) > threshold;
}

export type ActiveOverride = { param: OverrideParam; value: unknown };

export type OverrideValues = {
  rice: Partial<RiceParams>;
  moscow: MoscowCategory | null;
  /** Reach of a manual insight, entered as accounts and MRR. */
  manualReach: ManualReach | null;
};

/** Values of the active overrides; a mode-bound Reach applies only in its mode. */
export function overrideValues(
  overrides: readonly ActiveOverride[],
  mode?: ReachMode,
): OverrideValues {
  const result: OverrideValues = { rice: {}, moscow: null, manualReach: null };
  for (const o of overrides) {
    if (o.param === "moscow") result.moscow = o.value as MoscowCategory;
    // A manual insight's Reach is its computed Reach (manualReach), not an override of it.
    else if (o.param === "reach" && isManualReach(o.value)) result.manualReach = o.value;
    else if (o.param === "reach" && isModeReach(o.value)) {
      if (o.value.mode === mode) result.rice.reach = o.value.value;
    } else result.rice[o.param] = o.value as number;
  }
  return result;
}
