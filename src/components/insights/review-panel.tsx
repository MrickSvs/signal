"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/signal/badges";
import { formatEur, formatNumber } from "@/lib/format";
import type { InsightCard } from "@/lib/insights/list";
import { MOSCOW_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import type { MergeTarget } from "@/server/queries/insights";
import { ReviewActions, useReview } from "./review-actions";

/**
 * « À valider » (SPEC §8.10, CL-52): every proposed insight, all checked; « Tout accepter »
 * accepts the checked ones in one go (one decision each). Each row keeps its own actions.
 */
export function ReviewPanel({
  insights,
  targets,
}: {
  insights: InsightCard[];
  targets: MergeTarget[];
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const batch = useReview();
  const selected = insights.filter((i) => !excluded.has(i.id)).map((i) => i.id);
  const all = selected.length === insights.length;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      aria-labelledby="a-valider"
      className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="a-valider" className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden className="size-2 rounded-full bg-blue-500" />À valider
            <span className="font-normal text-muted-foreground tabular-nums">
              {insights.length}
            </span>
          </h3>
          <p className="text-muted-foreground">
            Proposés par Signal, déjà scorés. Décoche ceux que tu veux traiter un par un.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setExcluded(all ? new Set(insights.map((i) => i.id)) : new Set())}
              className="accent-blue-600"
            />
            Tout cocher
          </label>
          <Button
            onClick={() =>
              batch.run({ action: "accepter", insight_ids: selected }, () => setExcluded(new Set()))
            }
            disabled={batch.pending || selected.length === 0}
          >
            {batch.pending ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <CheckCheck aria-hidden />
            )}
            {all ? "Tout accepter" : "Accepter la sélection"} ({selected.length})
          </Button>
        </div>
      </div>
      {batch.error && (
        <p role="alert" className="text-destructive">
          {batch.error}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg border bg-background">
        {insights.map((insight) => (
          <li key={insight.id} className="flex items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              aria-label={`Inclure ${insight.id} dans l'acceptation groupée`}
              checked={!excluded.has(insight.id)}
              onChange={() => toggle(insight.id)}
              className="mt-1 accent-blue-600"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono font-semibold">{insight.id}</span>
                <Link
                  href={`/insights/${insight.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {insight.title}
                </Link>
              </p>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                  {insight.product_area && <span>{PRODUCT_AREA_LABELS[insight.product_area]}</span>}
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {formatNumber(insight.feedbacks_count)} retours,{" "}
                    {formatNumber(insight.accounts_count)} comptes, {formatEur(insight.mrr_exposed)}
                  </span>
                  <span aria-hidden>·</span>
                  {insight.ranked && insight.rank !== null ? (
                    <span className="tabular-nums">
                      rang {insight.rank}
                      {insight.moscow ? ` · ${MOSCOW_LABELS[insight.moscow]}` : ""}
                    </span>
                  ) : (
                    <Pill className="border-border text-muted-foreground">Signal faible</Pill>
                  )}
                </p>
                <ReviewActions insight={insight} targets={targets} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
