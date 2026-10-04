"use client";

import { useEffect, useRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Pill } from "@/components/signal/badges";
import { InsightChip } from "@/components/signal/chips";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { formatNumber } from "@/lib/format";
import { ALIGNMENT_LABELS, ROBUSTNESS_LABELS } from "@/lib/labels";
import type { ReachMode } from "@/lib/scoring/reach";
import { cn } from "@/lib/utils";
import type { PriorityRow } from "@/server/queries/prioritization";
import { MoscowPopover } from "./moscow-popover";
import { ParamPopover } from "./param-popover";

const GRID =
  "grid grid-cols-[2.25rem_minmax(8rem,1fr)_4.75rem_2.75rem_3.25rem_3.25rem_5rem_6rem] items-center gap-x-2";

const BADGES: Record<PriorityRow["badges"][number], { label: string; className: string }> = {
  a_valider: {
    label: "À valider",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  manuel: { label: "Manuel", className: "border-border text-muted-foreground" },
  contexte_modifie: {
    label: "Contexte modifié",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
};

const ROBUSTNESS_STYLES: Record<NonNullable<PriorityRow["robustness"]>, string> = {
  robuste: "border-border text-muted-foreground",
  sensible:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  fragile:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

/** Trend (SPEC §8.8, computed by the pipeline): emerging, new, or growth over 7 days. */
function Trend({ trend }: { trend: PriorityRow["trend"] }) {
  const title = `Retours par semaine sur 6 semaines : ${trend.weekly.join(", ") || "—"}`;
  if (trend.is_emerging)
    return (
      <span title={title} className="font-medium text-signal">
        Émergent
      </span>
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
      Tendance ×{formatNumber(trend.growth)}
    </span>
  );
}

/**
 * The ranked insights (SPEC §12.5). Rows keep their key across a Reach toggle or an override, so
 * framer-motion's layout animation shows them moving to their new rank.
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
    <div role="table" aria-label="Classement RICE" className="min-w-0 overflow-x-auto">
      <div
        role="row"
        className={cn(
          GRID,
          "border-b pb-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground",
        )}
      >
        <span role="columnheader">Rang</span>
        <span role="columnheader">Insight</span>
        <span
          role="columnheader"
          title={mode === "mrr" ? "MRR concerné estimé" : "Comptes concernés estimés"}
        >
          R ({mode === "mrr" ? "€" : "cptes"})
        </span>
        <span role="columnheader">I</span>
        <span role="columnheader">C</span>
        <span role="columnheader" title="Semaines-personne">
          E (sem.)
        </span>
        <span role="columnheader">RICE</span>
        <span role="columnheader">MoSCoW</span>
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
              "border-b bg-background py-2.5",
              row.id === focus && "rounded-md ring-2 ring-signal/60",
            )}
          >
            <span role="cell" className="text-lg font-semibold tabular-nums">
              #{row.rank}
            </span>
            <div role="cell" className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-start gap-1.5">
                <span className="shrink-0">
                  <InsightChip id={row.id} />
                </span>
                <span className="line-clamp-2 leading-snug" title={row.title}>
                  {row.title}
                </span>
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
                    row.alignment.value === "hors_strategie" &&
                      "text-amber-700 dark:text-amber-300",
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
            {row.params.map((cell) => (
              <span role="cell" key={cell.param}>
                <ParamPopover insightId={row.id} cell={cell} mode={mode} />
              </span>
            ))}
            <div role="cell" className="flex flex-col items-start gap-1">
              <MetricWithSource
                label="RICE"
                value={row.rice}
                source="calcule"
                breakdown={row.riceBreakdown}
                rationale="Un score ne se compare qu'à l'intérieur d'un même mode de Reach."
                className="font-semibold"
              />
              {row.robustness && (
                <MetricWithSource
                  label="Robustesse du rang"
                  value={ROBUSTNESS_LABELS[row.robustness]}
                  source="calcule"
                  breakdown={row.robustnessLines}
                  rationale="Rang rejoué avec un seul paramètre dégradé à la fois : « bouge » si le rang change de plus d'une place."
                  className={cn(
                    "rounded-md border px-1.5 text-[13px] no-underline",
                    ROBUSTNESS_STYLES[row.robustness],
                  )}
                />
              )}
            </div>
            <span role="cell">
              <MoscowPopover insightId={row.id} moscow={row.moscow} mode={mode} />
            </span>
          </motion.div>
        ))}
      </LayoutGroup>
    </div>
  );
}
