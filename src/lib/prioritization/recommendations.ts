// « Recommandations de Signal » on the Priorisation screen (SPEC §12.5): everything the PO should
// look at, derived in code from the computed ranking. Signal recommends, the PO decides (P1).
import { MOSCOW_LABELS } from "@/lib/labels";
import type { CapacityReport } from "@/lib/scoring/capacity";
import type { Alignment, MoscowCategory, RuleFlag } from "@/lib/scoring/moscow-rules";
import type { Robustness } from "@/lib/scoring/robustness";

export type RecommendationKind =
  | "capacite"
  | "ecart"
  | "hors_strategie"
  | "tension_segments"
  | "regle_en_tension"
  | "fragile"
  | "contexte_modifie";

export type Recommendation = {
  kind: RecommendationKind;
  insight_ids: string[];
  title: string;
  detail: string;
  piste: string | null;
};

export type RecommendationRow = {
  id: string;
  title: string;
  moscow_reco: MoscowCategory;
  moscow_final: MoscowCategory;
  alignment: Alignment;
  alignment_rationale: string;
  rule_flags: readonly RuleFlag[];
  robustness: Robustness | null;
  /** Overrides whose insight changed by more than 30 % since they were set (CL-22). */
  context_changed: readonly string[];
};

export type TensionRelation = {
  insight_a: string;
  insight_b: string;
  rationale: string | null;
  segments: unknown;
};

const PARAMS: Record<string, string> = {
  reach: "Reach",
  impact: "Impact",
  confidence: "Confidence",
  effort: "Effort",
  moscow: "MoSCoW",
};

/** Segments of a tension (label-insights: { segment, position }[]), as « Free / Pro / Business ». */
const segmentsText = (segments: unknown): string | null => {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return segments
    .map((s) =>
      typeof s === "object" && s !== null && "segment" in s ? String(s.segment) : String(s),
    )
    .join(" / ");
};

/** In the order of SPEC §12.5, the capacity alert first: it concerns every Must. */
export function buildRecommendations(input: {
  rows: readonly RecommendationRow[];
  tensions: readonly TensionRelation[];
  capacity: CapacityReport;
  /** Insight titles, for the tensions whose other side is outside the ranking. */
  titles: ReadonlyMap<string, string>;
}): Recommendation[] {
  const { rows, capacity } = input;
  const result: Recommendation[] = [];
  const ranked = new Set(rows.map((r) => r.id));

  if (capacity.alert) {
    result.push({
      kind: "capacite",
      insight_ids: capacity.downgrade,
      title: "Les Must dépassent 60 % de la capacité du trimestre",
      detail: `Les Must demandent ${capacity.must_weeks} semaines-personne sur ${capacity.capacity_weeks} (${Math.round(capacity.share * 100)} %).`,
      piste: capacity.downgrade.length
        ? `Passer en Should, dans l'ordre : ${capacity.downgrade.join(", ")}.`
        : null,
    });
  }

  for (const r of rows) {
    if (r.moscow_final !== r.moscow_reco) {
      result.push({
        kind: "ecart",
        insight_ids: [r.id],
        title: `${r.id} : ton choix (${MOSCOW_LABELS[r.moscow_final]}) diffère de la recommandation (${MOSCOW_LABELS[r.moscow_reco]})`,
        detail: r.title,
        piste: null,
      });
    }
  }

  for (const r of rows) {
    if (r.alignment !== "hors_strategie") continue;
    result.push({
      kind: "hors_strategie",
      insight_ids: [r.id],
      title: `${r.id} est hors stratégie`,
      detail: r.alignment_rationale,
      piste:
        r.moscow_final === "wont"
          ? null
          : "Le développer a un coût d'opportunité sur les OKRs du trimestre.",
    });
  }

  for (const t of input.tensions) {
    if (!ranked.has(t.insight_a) && !ranked.has(t.insight_b)) continue;
    const segments = segmentsText(t.segments);
    result.push({
      kind: "tension_segments",
      insight_ids: [t.insight_a, t.insight_b],
      title: `Tension entre ${t.insight_a} et ${t.insight_b}${segments ? ` (${segments})` : ""}`,
      detail:
        t.rationale ??
        `${input.titles.get(t.insight_a) ?? t.insight_a} / ${input.titles.get(t.insight_b) ?? t.insight_b}`,
      piste: "Trancher pour un segment, ou concevoir une option qui serve les deux.",
    });
  }

  for (const r of rows) {
    for (const flag of r.rule_flags) {
      if (flag.status !== "tension") continue;
      result.push({
        kind: "regle_en_tension",
        insight_ids: [r.id],
        title: `${r.id} : règles MoSCoW en tension`,
        detail: flag.detail,
        piste: flag.piste,
      });
    }
  }

  for (const r of rows) {
    if (r.robustness !== "fragile") continue;
    result.push({
      kind: "fragile",
      insight_ids: [r.id],
      title: `${r.id} : rang fragile`,
      detail:
        "Son rang bouge de plus d'une place dans au moins deux scénarios dégradés : vérifie ses paramètres avant de t'engager.",
      piste: null,
    });
  }

  for (const r of rows) {
    if (r.context_changed.length === 0) continue;
    result.push({
      kind: "contexte_modifie",
      insight_ids: [r.id],
      title: `${r.id} : contexte modifié depuis ton override`,
      detail: `Plus de 30 % de ses retours ont changé depuis l'override ${r.context_changed.map((p) => PARAMS[p] ?? p).join(", ")}.`,
      piste: "Confirmer ou annuler l'override.",
    });
  }

  return result;
}
