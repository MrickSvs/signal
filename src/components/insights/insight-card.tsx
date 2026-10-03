import Link from "next/link";
import { Sparkline } from "@/components/digest/sparkline";
import { Pill } from "@/components/signal/badges";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { formatEur, formatNumber } from "@/lib/format";
import { cardBadges, type InsightCard } from "@/lib/insights/list";
import {
  ALIGNMENT_LABELS,
  INSIGHT_STATUS_LABELS,
  MOSCOW_LABELS,
  PLAN_LABELS,
  PRODUCT_AREA_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

const BADGES = {
  a_valider: {
    label: "À valider",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  emergent: { label: "Émergent", className: "border-signal/40 bg-signal-soft text-signal" },
  nouveau: { label: "Nouveau", className: "border-border bg-muted text-foreground" },
  manuel: { label: "Manuel", className: "border-border text-muted-foreground" },
} as const;

const planLabel = (plan: string) =>
  plan in PLAN_LABELS
    ? PLAN_LABELS[plan as keyof typeof PLAN_LABELS]
    : plan === "prospect"
      ? "Prospects"
      : "Sans compte";

/** Accounts by plan, already counted by the pipeline (segments_breakdown, in code). */
export function accountsBreakdown(plans: Record<string, number>) {
  return Object.entries(plans)
    .toSorted((a, b) => b[1] - a[1])
    .map(([plan, n]) => ({ label: planLabel(plan), value: formatNumber(n) }));
}

/** An insight as a card: the problem, its weight, its place in the ranking (SPEC §12.4). */
export function InsightCardView({
  card,
  compact = false,
}: {
  card: InsightCard;
  compact?: boolean;
}) {
  const badges = cardBadges(card);
  return (
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-4",
        card.status === "rejete" && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{card.id}</span>
            {card.product_area && <span>{PRODUCT_AREA_LABELS[card.product_area]}</span>}
            {badges.map((b) => (
              <Pill key={b} className={BADGES[b].className}>
                {BADGES[b].label}
              </Pill>
            ))}
            {card.status === "rejete" && (
              <Pill className="border-border text-muted-foreground">
                {INSIGHT_STATUS_LABELS.rejete}
              </Pill>
            )}
          </p>
          <h4 className="leading-snug font-medium">
            <Link
              href={`/insights/${card.id}`}
              className="underline-offset-4 hover:text-signal hover:underline"
            >
              {card.title}
            </Link>
          </h4>
        </div>
        {card.ranked && card.rank !== null && (
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            <Link
              href={`/priorisation?insight=${card.id}`}
              title="Voir dans la priorisation"
              className="text-xl leading-none font-semibold tabular-nums hover:text-signal"
            >
              #{card.rank}
            </Link>
            {card.moscow && (
              <span
                className="text-[13px] text-muted-foreground"
                title={card.moscow_is_final ? "Choix du PO" : "Recommandation de Signal"}
              >
                {MOSCOW_LABELS[card.moscow]}
                {card.moscow_is_final ? "" : " (reco)"}
              </span>
            )}
          </div>
        )}
      </div>
      {!compact && (
        <p className="line-clamp-2 leading-relaxed text-muted-foreground">
          {card.problem_statement}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            href={`/retours?insight=${card.id}`}
            className="tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-signal"
          >
            {formatNumber(card.feedbacks_count)}{" "}
            <span className="text-muted-foreground">retours</span>
          </Link>
          <MetricWithSource
            label="Comptes distincts"
            value={formatNumber(card.accounts_count)}
            unit="comptes"
            source="calcule"
            breakdown={accountsBreakdown(card.plans)}
          />
          <MetricWithSource
            label="MRR exposé"
            value={formatEur(card.mrr_exposed)}
            source="calcule"
            breakdown={[
              { label: "Clients concernés", value: formatNumber(card.accounts_count) },
              { label: "Renouvellements sous 90 jours", value: formatNumber(card.renewals_90d) },
            ]}
            rationale="Somme du MRR des clients distincts concernés (prospects exclus)."
          />
          {card.alignment && (
            <span className="text-muted-foreground">{ALIGNMENT_LABELS[card.alignment]}</span>
          )}
        </div>
        {card.weekly.length > 1 && <Sparkline weekly={card.weekly} />}
      </div>
    </article>
  );
}
