import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import {
  MetricWithSource,
  type MetricBreakdownLine,
  type MetricSource,
} from "@/components/signal/metric-with-source";
import { formatEur, formatNumber, formatPercent } from "@/lib/format";
import { ALIGNMENT_LABELS, MOSCOW_LABELS, PLAN_LABELS, ROBUSTNESS_LABELS } from "@/lib/labels";
import type { ReachDetail } from "@/lib/scoring/reach";
import type { DetailScore } from "@/server/queries/insights";

type Overridden = Partial<
  Record<"reach" | "impact" | "confidence" | "effort", { original: number }>
>;

const EFFORT_SOURCES: Record<DetailScore["effort_source"], string> = {
  estimation_initiale: "Estimation initiale (milieu de la fourchette ÷ vélocité)",
  backlog: "Somme des points du backlog ÷ vélocité",
  manuel: "Saisi par le PO",
};

function Param({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-lg">{children}</dd>
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** RICE decomposed (SPEC §8), every value clickable to its breakdown; edits live in Priorisation. */
export function ScoreBreakdown({ insightId, score }: { insightId: string; score: DetailScore }) {
  const overridden = (score.overridden ?? {}) as Overridden;
  const source = (param: keyof Overridden, base: MetricSource): MetricSource =>
    overridden[param] ? "ecrase" : base;
  const original = (param: keyof Overridden, format: (n: number) => string) =>
    overridden[param]
      ? [{ label: "Valeur d'origine", value: format(overridden[param]!.original) }]
      : [];

  const reach = score.reach_detail as unknown as ReachDetail;
  const mrr = score.reach_mode === "mrr";
  const fmtReach = (n: number) => (mrr ? formatEur(n) : formatNumber(n));
  const reachLines: MetricBreakdownLine[] = [
    ...Object.entries(reach.by_plan ?? {}).map(([plan, p]) => ({
      label: `${PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? plan} : ${formatNumber(p.accounts)} × ${formatNumber(p.factor)}`,
      value: fmtReach(p.value),
    })),
    ...(reach.unidentified?.accounts
      ? [
          {
            label: `Sans compte identifiable : ${formatNumber(reach.unidentified.accounts)}`,
            value: fmtReach(reach.unidentified.value),
          },
        ]
      : []),
    ...(reach.prospects?.accounts
      ? [
          {
            label: `Prospects : ${formatNumber(reach.prospects.accounts)}`,
            value: fmtReach(reach.prospects.value),
          },
        ]
      : []),
    ...original("reach", fmtReach),
  ];

  const conf = score.confidence_detail as {
    c?: number;
    volume?: number;
    diversity?: number;
    quality?: number;
    downgraded?: boolean;
    accounts?: number;
    channels?: number;
  };
  const moscowFinal = score.overrides.find((o) => o.param === "moscow");
  const flags = Array.isArray(score.rule_flags) ? score.rule_flags.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Param label={`Reach (${mrr ? "MRR" : "comptes"})`}>
          <MetricWithSource
            label="Reach"
            value={fmtReach(Number(score.reach))}
            unit={mrr ? undefined : "comptes"}
            source={source("reach", "calcule")}
            breakdown={reachLines}
            rationale="Comptes distincts par plan × facteur d'extrapolation du plan (SPEC §8.1)."
          />
        </Param>
        <Param label="Impact">
          <MetricWithSource
            label="Impact"
            value={formatNumber(Number(score.impact), 2)}
            source={source("impact", "estime")}
            breakdown={original("impact", (n) => formatNumber(n, 2))}
            rationale={score.impact_rationale}
            evidence={score.impact_evidence}
          />
        </Param>
        <Param label="Confidence">
          <MetricWithSource
            label="Confidence"
            value={formatPercent(Number(score.confidence))}
            source={source("confidence", "calcule")}
            breakdown={[
              {
                label: "c = 0,4 × volume + 0,3 × diversité + 0,3 × qualité",
                value: formatNumber(conf.c ?? 0, 2),
              },
              {
                label: `Volume (${formatNumber(conf.accounts ?? 0)} comptes)`,
                value: formatNumber(conf.volume ?? 0, 2),
              },
              {
                label: `Diversité (${formatNumber(conf.channels ?? 0)} canaux)`,
                value: formatNumber(conf.diversity ?? 0, 2),
              },
              { label: "Qualité des sources", value: formatNumber(conf.quality ?? 0, 2) },
              ...original("confidence", (n) => formatPercent(n)),
            ]}
            rationale={
              conf.downgraded
                ? "Rétrogradée d'un niveau : le modèle a signalé des preuves contradictoires."
                : null
            }
          />
        </Param>
        <Param label="Effort">
          <MetricWithSource
            label="Effort"
            value={formatNumber(Number(score.effort_weeks))}
            unit="sem.-pers."
            source={source("effort", score.effort_source === "manuel" ? "ecrase" : "estime")}
            breakdown={[
              { label: "Source", value: EFFORT_SOURCES[score.effort_source] },
              ...original("effort", (n) => formatNumber(n)),
            ]}
          />
        </Param>
      </dl>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">RICE</span>
          <MetricWithSource
            label="RICE"
            value={formatNumber(Number(score.rice), 2)}
            source="calcule"
            breakdown={[
              { label: "Reach", value: fmtReach(Number(score.reach)) },
              { label: "× Impact", value: formatNumber(Number(score.impact), 2) },
              { label: "× Confidence", value: formatPercent(Number(score.confidence)) },
              { label: "÷ Effort", value: formatNumber(Number(score.effort_weeks)) },
            ]}
            rationale="Un score ne se compare qu'à l'intérieur d'un même mode de Reach."
          />
        </span>
        {score.rank !== null && (
          <span>
            <span className="text-muted-foreground">Rang</span>{" "}
            <span className="font-semibold tabular-nums">#{score.rank}</span>
          </span>
        )}
        {score.robustness && (
          <Pill
            className="border-border text-foreground"
            title="Rang rejoué avec un paramètre dégradé à la fois"
          >
            {ROBUSTNESS_LABELS[score.robustness]}
          </Pill>
        )}
        {score.alignment && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground">Alignement</span>
            <MetricWithSource
              label="Alignement stratégique"
              value={ALIGNMENT_LABELS[score.alignment]}
              source="estime"
              breakdown={score.okr_refs.map((okr) => ({ label: "OKR", value: okr }))}
              rationale={score.alignment_rationale}
            />
          </span>
        )}
        {score.moscow_reco && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground">MoSCoW</span>
            <MetricWithSource
              label="MoSCoW recommandé"
              value={MOSCOW_LABELS[score.moscow_reco]}
              source="estime"
              breakdown={
                flags
                  ? [{ label: "Règles appliquées ou en tension", value: formatNumber(flags) }]
                  : []
              }
              rationale={score.moscow_rationale}
            />
            {moscowFinal && typeof moscowFinal.value === "string" && (
              <span>
                →{" "}
                <span className="font-medium">
                  {MOSCOW_LABELS[moscowFinal.value as keyof typeof MOSCOW_LABELS] ??
                    moscowFinal.value}
                </span>{" "}
                <span className="text-muted-foreground">(choix du PO)</span>
              </span>
            )}
          </span>
        )}
      </div>
      <Link
        href={`/priorisation?insight=${insightId}`}
        className="inline-flex items-center gap-1 self-start font-medium text-signal underline-offset-4 hover:underline"
      >
        Ajuster dans la priorisation
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
