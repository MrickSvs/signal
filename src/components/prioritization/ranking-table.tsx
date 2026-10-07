"use client";

import { useEffect, useRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { InsightChip } from "@/components/signal/chips";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { PILL_TONES } from "@/components/signal/tones";
import { formatNumber } from "@/lib/format";
import { ALIGNMENT_LABELS, ROBUSTNESS_LABELS } from "@/lib/labels";
import type { ReachMode } from "@/lib/scoring/reach";
import { cn } from "@/lib/utils";
import type { PriorityRow } from "@/server/queries/prioritization";
import { MoscowPopover } from "./moscow-popover";
import { ParamPopover } from "./param-popover";

const GRID = "grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_7.5rem] items-start gap-x-3";

const PARAM_LETTERS: Record<PriorityRow["params"][number]["param"], string> = {
  reach: "R",
  impact: "I",
  confidence: "C",
  effort: "E",
};

const BADGES: Record<PriorityRow["badges"][number], { label: string; className: string }> = {
  a_valider: { label: "À valider", className: PILL_TONES.po },
  manuel: { label: "Manuel", className: PILL_TONES.neutral },
  contexte_modifie: { label: "Contexte modifié", className: PILL_TONES.risk },
};

const ROBUSTNESS_STYLES: Record<NonNullable<PriorityRow["robustness"]>, string> = {
  robuste: "border-transparent text-muted-foreground",
  sensible: PILL_TONES.neutral,
  fragile: PILL_TONES.risk,
};

/** Trend (SPEC §8.8, computed by the pipeline): emerging, new, or growth over 7 days. */
function Trend({ trend }: { trend: PriorityRow["trend"] }) {
  const title = `Retours par semaine sur 6 semaines : ${trend.weekly.join(", ") || "—"}`;
  if (trend.is_emerging)
    return (
      <Pill className={PILL_TONES.signal}>
        <TrendingUp aria-hidden />
        <span title={title}>Émergent</span>
      </Pill>
    );
  if (trend.is_new)
    return (
      <span title={title} className="text-muted-foreground">
        Nouveau
      </span>
    );
  if (trend.growth === null) return null;
  return (
    <span title={title} className="text-muted-foreground tabular-nums">
      tendance ×{formatNumber(trend.growth)}
    </span>
  );
}

/**
 * The ranked insights (SPEC §12.5, ADR-039): the title on its own line, the four RICE parameters
 * under it (each opens its source and the override), the score and the MoSCoW on the right. Rows
 * keep their key across a Reach toggle or an override, so framer-motion's layout animation shows
 * them moving to their new rank.
 */
export function RankingTable({
  rows,
  mode,
  focus,
}: {
  rows: PriorityRow[];
  mode: ReachMode;
  focus: string | null;
}) {
  const reduce = useReducedMotion();
  const focused = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focused.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div role="table" aria-label="Classement RICE" className="min-w-0 rounded-lg border">
      <div
        role="row"
        className={cn(
          GRID,
          "border-b bg-muted/50 px-3 py-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground",
        )}
      >
        <span role="columnheader" className="text-right">
          Rang
        </span>
        <span role="columnheader" title="RICE = Reach × Impact × Confidence ÷ Effort">
          Insight · R × I × C ÷ E
        </span>
        <span role="columnheader" className="text-right">
          RICE
        </span>
        <span role="columnheader" title="Recommandation de Signal → ton choix">
          MoSCoW
        </span>
      </div>
      <LayoutGroup>
        {rows.map((row) => (
          <motion.div
            key={row.id}
            layout={reduce ? false : "position"}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            ref={row.id === focus ? focused : undefined}
            role="row"
            data-insight={row.id}
            className={cn(
              GRID,
              "border-b bg-background px-3 py-3 last:border-b-0",
              row.id === focus &&
                "bg-blue-50/60 shadow-[inset_3px_0_0_var(--color-blue-500)] dark:bg-blue-950/30",
            )}
          >
            <span role="cell" className="text-right text-lg leading-6 font-semibold tabular-nums">
              {row.rank}
            </span>
            <div role="cell" className="flex min-w-0 flex-col gap-1.5">
              <p className="flex min-w-0 items-start gap-2 leading-snug">
                <span className="shrink-0">
                  <InsightChip id={row.id} />
                </span>
                <span className="font-medium">{row.title}</span>
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {row.params.map((cell) => (
                  <span key={cell.param} className="inline-flex items-baseline gap-1">
                    <span className="text-[13px] text-muted-foreground" title={cell.label}>
                      {PARAM_LETTERS[cell.param]}
                    </span>
                    <ParamPopover insightId={row.id} cell={cell} mode={mode} />
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <MetricWithSource
                  label="Alignement stratégique"
                  value={ALIGNMENT_LABELS[row.alignment.value]}
                  source="estime"
                  breakdown={row.alignment.okr_refs.map((okr) => ({ label: "OKR", value: okr }))}
                  rationale={row.alignment.rationale}
                  className={cn(
                    "font-normal text-muted-foreground",
                    row.alignment.value === "hors_strategie" && "font-medium text-foreground",
                  )}
                />
                <Trend trend={row.trend} />
                {row.badges.map((b) => (
                  <Pill key={b} className={BADGES[b].className}>
                    {BADGES[b].label}
                  </Pill>
                ))}
              </div>
            </div>
            <div role="cell" className="flex flex-col items-end gap-1">
              <MetricWithSource
                label="RICE"
                value={row.rice}
                source="calcule"
                breakdown={row.riceBreakdown}
                rationale="Un score ne se compare qu'à l'intérieur d'un même mode de Reach."
                className="text-base font-semibold"
              />
              {row.robustness && (
                <MetricWithSource
                  label="Robustesse du rang"
                  value={ROBUSTNESS_LABELS[row.robustness]}
                  source="calcule"
                  breakdown={row.robustnessLines}
                  rationale="Rang rejoué avec un seul paramètre dégradé à la fois : « bouge » si le rang change de plus d'une place."
                  className={cn(
                    "rounded-md border px-1.5 text-[13px] font-normal no-underline",
                    ROBUSTNESS_STYLES[row.robustness],
                  )}
                />
              )}
            </div>
            <span role="cell" className="pt-0.5">
              <MoscowPopover insightId={row.id} moscow={row.moscow} mode={mode} />
            </span>
          </motion.div>
        ))}
      </LayoutGroup>
    </div>
  );
}
