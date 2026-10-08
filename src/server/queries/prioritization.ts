import "server-only";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { formatEur, formatNumber, formatPercent } from "@/lib/format";
import type { Trend } from "@/lib/insights/aggregates";
import { PLAN_LABELS } from "@/lib/labels";
import type { JournalEntry } from "@/lib/prioritization/journal";
import { buildRecommendations, type Recommendation } from "@/lib/prioritization/recommendations";
import { confidenceLevels } from "@/lib/scoring/confidence";
import type { CapacityReport } from "@/lib/scoring/capacity";
import type { RuleFlag } from "@/lib/scoring/moscow-rules";
import type { ReachMode } from "@/lib/scoring/reach";
import type { ComputedScore } from "@/pipeline/nodes/score";
import { getRanking } from "@/services/prioritization";
import { loadScoringContext } from "@/server/scoring-context";

// Reads of the Priorisation screen (SPEC §12.5). Every value is computed by lib/scoring on the
// server and arrives formatted: the client never computes a score.

type Enums = Database["public"]["Enums"];

export type ParamKey = "reach" | "impact" | "confidence" | "effort";
export type CellSource = "calcule" | "estime" | "ecrase" | "saisi";

export type BreakdownLine = { label: string; value: string };

export type ParamCell = {
  param: ParamKey;
  label: string;
  display: string;
  unit: string | null;
  source: CellSource;
  /** Value computed or estimated before the override, formatted. */
  original: string | null;
  breakdown: BreakdownLine[];
  rationale: string | null;
  evidence: string[];
  override: { reason: string | null; context_changed: boolean; created_at: string } | null;
  /** Current value in the unit the PO types (percentage for Confidence). */
  input: { value: number; unit: string; hint: string };
  /** False for a manual topic's own values: they are edited, not cancelled. */
  cancellable: boolean;
};

export type PriorityRow = {
  id: string;
  title: string;
  status: Enums["insight_status"];
  origin: Enums["insight_origin"];
  rank: number;
  rice: string;
  riceBreakdown: BreakdownLine[];
  params: ParamCell[];
  robustness: Enums["robustness"] | null;
  robustnessLines: BreakdownLine[];
  moscow: {
    reco: Enums["moscow"];
    final: Enums["moscow"];
    rationale: string;
    flags: RuleFlag[];
    override: { reason: string | null } | null;
  };
  alignment: {
    value: Enums["alignment"];
    rationale: string;
    okr_refs: string[];
  };
  trend: { weekly: number[]; growth: number | null; is_emerging: boolean; is_new: boolean };
  badges: ("a_valider" | "manuel" | "contexte_modifie")[];
};

export type PrioritizationScreen = {
  mode: ReachMode;
  rows: PriorityRow[];
  pending: { id: string; title: string; missing: "jugement" | "estimation" }[];
  capacity: CapacityReport & { limit_share: number; must_ids: string[] };
  recommendations: Recommendation[];
  journal: JournalEntry[];
  titles: Record<string, string>;
};

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} (${error.message})`);
};

const SCENARIOS: Record<string, string> = {
  impact: "Impact −1 niveau",
  confidence: "Confidence −1 niveau",
  effort: "Effort à la borne haute",
  reach: "Reach −30 %",
};

const EFFORT_SOURCES: Record<string, string> = {
  estimation_initiale: "Milieu de la fourchette ÷ vélocité",
  backlog: "Σ points du backlog ÷ vélocité",
  manuel: "Saisi par le PO",
};

type OverrideRow = {
  insight_id: string;
  param: Enums["override_param"];
  reason: string | null;
  context_changed: boolean;
  created_at: string;
};

function reachCell(
  s: ComputedScore,
  manual: boolean,
  override: OverrideRow | undefined,
  mode: ReachMode,
): ParamCell {
  const mrr = mode === "mrr";
  const fmt = (n: number) => (mrr ? formatEur(n) : formatNumber(n));
  const d = s.reach_detail;
  const missing = d.mrr_missing === true && !s.overridden.reach;
  const breakdown: BreakdownLine[] = manual
    ? [{ label: "Sujet manuel", value: mrr ? "MRR saisi par le PO" : "Comptes saisis par le PO" }]
    : [
        ...Object.entries(d.by_plan).map(([plan, p]) => ({
          label: `${PLAN_LABELS[plan as Enums["customer_plan"]] ?? plan} : ${formatNumber(p.accounts)} compte${p.accounts > 1 ? "s" : ""} × ${formatNumber(p.factor)}`,
          value: fmt(p.value),
        })),
        ...(d.unidentified.accounts
          ? [
              {
                label: `Sans compte identifiable : ${formatNumber(d.unidentified.accounts)}`,
                value: fmt(d.unidentified.value),
              },
            ]
          : []),
        ...(d.prospects.accounts
          ? [
              {
                label: `Prospects : ${formatNumber(d.prospects.accounts)} (comptent pour 0)`,
                value: fmt(d.prospects.value),
              },
            ]
          : []),
      ];
  return {
    param: "reach",
    label: mrr ? "Reach (MRR concerné)" : "Reach (comptes concernés)",
    display: missing ? "—" : fmt(s.reach),
    unit: mrr ? null : "comptes",
    source: s.overridden.reach ? "ecrase" : manual ? "saisi" : "calcule",
    original: s.overridden.reach && !manual ? fmt(s.overridden.reach.original) : null,
    breakdown,
    rationale: missing
      ? "MRR non renseigné : saisis-le pour classer ce sujet en mode MRR."
      : manual
        ? null
        : mrr
          ? "MRR de chaque compte distinct × facteur de son plan (SPEC §8.1)."
          : "Comptes distincts par plan × facteur d'extrapolation du plan (SPEC §8.1).",
    evidence: [],
    override: override ? pickOverride(override) : null,
    input: {
      value: s.reach,
      unit: mrr ? "€ de MRR" : "comptes",
      hint: manual
        ? "Valeur du sujet manuel."
        : `S'applique au mode ${mrr ? "MRR" : "comptes"} seulement.`,
    },
    cancellable: !manual,
  };
}

const pickOverride = (o: OverrideRow) => ({
  reason: o.reason,
  context_changed: o.context_changed,
  created_at: o.created_at,
});

function cells(
  s: ComputedScore,
  manual: boolean,
  overrides: Map<string, OverrideRow>,
  mode: ReachMode,
  estimate: {
    points_min: number;
    points_max: number;
    tshirt_min: string;
    tshirt_max: string;
    confidence: string;
    rationale: string;
    /** The statement was reworded since: the next run estimates it again. */
    stale: boolean;
  } | null,
  scales: { impact: number[]; confidence: number[] },
): ParamCell[] {
  const source = (param: ParamKey, base: CellSource): CellSource =>
    manual && param !== "reach" && overrides.has(param)
      ? "saisi"
      : s.overridden[param]
        ? "ecrase"
        : base;
  const original = (param: ParamKey, f: (n: number) => string) =>
    s.overridden[param] && !manual ? f(s.overridden[param]!.original) : null;
  const ov = (param: ParamKey) => {
    const o = overrides.get(param);
    return o ? pickOverride(o) : null;
  };
  const cancellable = !manual;
  const c = s.confidence_detail;
  const contradiction = c.contradiction.flag
    ? `Rétrogradée d'un niveau : preuves contradictoires (${c.contradiction.reason ?? "signalées par le modèle"}).`
    : null;

  return [
    reachCell(s, manual, overrides.get("reach"), mode),
    {
      param: "impact",
      label: "Impact",
      display: formatNumber(s.impact, 2),
      unit: null,
      source: source("impact", "estime"),
      original: original("impact", (n) => formatNumber(n, 2)),
      breakdown: [],
      rationale: manual ? null : s.impact_rationale,
      evidence: manual ? [] : s.impact_evidence,
      override: ov("impact"),
      input: {
        value: s.impact,
        unit: "",
        hint: `Échelle : ${scales.impact.map((v) => formatNumber(v, 2)).join(", ")}.`,
      },
      cancellable,
    },
    {
      param: "confidence",
      label: "Confidence",
      display: formatPercent(s.confidence),
      unit: null,
      source: source("confidence", "calcule"),
      original: original("confidence", (n) => formatPercent(n)),
      breakdown: manual
        ? []
        : [
            {
              label: "c = 0,4 × volume + 0,3 × diversité + 0,3 × qualité",
              value: formatNumber(c.c, 2),
            },
            {
              label: `Volume (${formatNumber(c.accounts)} comptes distincts)`,
              value: formatNumber(c.volume, 2),
            },
            {
              label: `Diversité (${formatNumber(c.channels)} canaux)`,
              value: formatNumber(c.diversity, 2),
            },
            { label: "Qualité des sources", value: formatNumber(c.quality, 2) },
          ],
      rationale: manual ? null : contradiction,
      evidence: [],
      override: ov("confidence"),
      input: {
        value: Math.round(s.confidence * 100),
        unit: "%",
        hint: `Niveaux : ${scales.confidence.map((v) => formatPercent(v)).join(", ")}.`,
      },
      cancellable,
    },
    {
      param: "effort",
      label: "Effort",
      display: formatNumber(s.effort_weeks),
      unit: "sem.",
      source: source("effort", "estime"),
      original: original("effort", (n) => formatNumber(n)),
      breakdown: [
        { label: "Source", value: EFFORT_SOURCES[s.effort.source] ?? s.effort.source },
        ...(estimate
          ? [
              {
                label: "Fourchette estimée",
                value: `${estimate.points_min}–${estimate.points_max} pts (${estimate.tshirt_min === estimate.tshirt_max ? estimate.tshirt_min : `${estimate.tshirt_min}–${estimate.tshirt_max}`})`,
              },
              { label: "Confiance de l'estimation", value: estimate.confidence },
              ...(estimate.stale
                ? [
                    {
                      label: "Énoncé modifié depuis l'estimation",
                      value: "nouvelle estimation au prochain run",
                    },
                  ]
                : []),
            ]
          : []),
        ...(s.effort.low_weeks !== null && s.effort.high_weeks !== null
          ? [
              {
                label: "Bornes en semaines-personne",
                value: `${formatNumber(s.effort.low_weeks)} à ${formatNumber(s.effort.high_weeks)}`,
              },
            ]
          : []),
      ],
      rationale: estimate?.rationale || null,
      evidence: [],
      override: ov("effort"),
      input: { value: s.effort_weeks, unit: "semaines-personne", hint: "Strictement positif." },
      cancellable,
    },
  ];
}

/** The Priorisation screen in a Reach mode (URL toggle): ranking, capacity, recommendations, journal. */
export async function getPrioritizationScreen(
  db: Db,
  mode: ReachMode,
): Promise<PrioritizationScreen> {
  const deps = await loadScoringContext();
  const [ranking, overrides, relations, decisions] = await Promise.all([
    getRanking(db, mode, deps),
    db
      .from("overrides")
      .select("insight_id, param, reason, context_changed, created_at")
      .eq("active", true),
    db
      .from("insight_relations")
      .select("insight_a, insight_b, rationale, segments")
      .eq("kind", "tension"),
    db
      .from("decisions")
      .select(
        "id, actor, source, entity_type, entity_id, action, field, before, after, reason, created_at",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(300),
  ]);
  fail("Lecture des overrides", overrides.error);
  fail("Lecture des tensions", relations.error);
  fail("Lecture du journal des décisions", decisions.error);

  const { weighting } = deps.pack;
  const scales = {
    impact: weighting.impact.scale,
    confidence: confidenceLevels(weighting.confidence),
  };
  const insightById = new Map(ranking.insights.map((i) => [i.id, i]));
  const overridesOf = new Map<string, Map<string, OverrideRow>>();
  for (const o of overrides.data ?? []) {
    const map = overridesOf.get(o.insight_id) ?? new Map<string, OverrideRow>();
    map.set(o.param, o);
    overridesOf.set(o.insight_id, map);
  }
  const fmtReach = (n: number) => (mode === "mrr" ? formatEur(n) : formatNumber(n));

  const rows = ranking.scores.map((s): PriorityRow => {
    const insight = insightById.get(s.insight_id)!;
    const manual = insight.origin === "manuel";
    const own = overridesOf.get(s.insight_id) ?? new Map<string, OverrideRow>();
    const trend = (insight.trend ?? {}) as Partial<Trend>;
    const stored = ranking.estimates.get(s.insight_id);
    const estimate = stored ? { ...stored.estimate, stale: stored.stale === true } : null;
    const contextChanged = [...own.values()].some((o) => o.context_changed);
    const moscowOverride = own.get("moscow");
    return {
      id: s.insight_id,
      title: insight.title,
      status: insight.status,
      origin: insight.origin,
      rank: s.rank,
      rice: formatNumber(s.rice, 2),
      riceBreakdown: [
        { label: "Reach", value: fmtReach(s.reach) },
        { label: "× Impact", value: formatNumber(s.impact, 2) },
        { label: "× Confidence", value: formatPercent(s.confidence) },
        { label: "÷ Effort (sem.-pers.)", value: formatNumber(s.effort_weeks) },
      ],
      params: cells(s, manual, own, mode, estimate, scales),
      robustness: s.robustness,
      robustnessLines:
        "scenarios" in s.robustness_detail
          ? s.robustness_detail.scenarios.map((sc) => ({
              label: SCENARIOS[sc.param] ?? sc.param,
              value: `#${sc.rank}${sc.moved ? " (bouge)" : ""}`,
            }))
          : [],
      moscow: {
        reco: s.moscow_reco,
        final: s.moscow_final,
        rationale: s.moscow_rationale,
        flags: s.rule_flags,
        override: moscowOverride ? { reason: moscowOverride.reason } : null,
      },
      alignment: {
        value: s.alignment,
        rationale: s.alignment_rationale,
        okr_refs: s.okr_refs,
      },
      trend: {
        weekly: trend.weekly ?? [],
        growth: trend.growth ?? null,
        is_emerging: trend.is_emerging ?? false,
        is_new: trend.is_new ?? false,
      },
      badges: [
        ...(insight.status === "propose" ? (["a_valider"] as const) : []),
        ...(manual ? (["manuel"] as const) : []),
        ...(contextChanged ? (["contexte_modifie"] as const) : []),
      ],
    };
  });

  const titles = Object.fromEntries(ranking.insights.map((i) => [i.id, i.title]));
  const liveRelations = (relations.data ?? []).filter(
    (r) => insightById.has(r.insight_a) || insightById.has(r.insight_b),
  );
  const recommendations = buildRecommendations({
    rows: ranking.scores.map((s) => ({
      id: s.insight_id,
      title: titles[s.insight_id],
      moscow_reco: s.moscow_reco,
      moscow_final: s.moscow_final,
      alignment: s.alignment,
      alignment_rationale: s.alignment_rationale,
      rule_flags: s.rule_flags,
      robustness: s.robustness,
      context_changed: [...(overridesOf.get(s.insight_id)?.values() ?? [])]
        .filter((o) => o.context_changed)
        .map((o) => o.param),
    })),
    tensions: liveRelations,
    capacity: ranking.capacity,
    titles: new Map(Object.entries(titles)),
  });

  return {
    mode,
    rows,
    pending: ranking.pending.map((p) => ({
      id: p.insight,
      title: titles[p.insight] ?? p.insight,
      missing: p.missing,
    })),
    capacity: {
      ...ranking.capacity,
      limit_share: weighting.moscow.must_capacity_share,
      must_ids: ranking.scores.filter((s) => s.moscow_final === "must").map((s) => s.insight_id),
    },
    recommendations,
    journal: (decisions.data ?? []) as JournalEntry[],
    titles,
  };
}
