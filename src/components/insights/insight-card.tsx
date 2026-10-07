import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/digest/sparkline";
import { Pill } from "@/components/signal/badges";
import { PILL_TONES } from "@/components/signal/tones";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { formatEur, formatNumber } from "@/lib/format";
import { cardBadges, type InsightCard } from "@/lib/insights/list";
import {
  ALIGNMENT_LABELS,
  INSIGHT_STATUS_LABELS,
  PLAN_LABELS,
  PRODUCT_AREA_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

// Same meaning, same color as the Digest (ADR-033): blue for what awaits Léa's decision, Signal
// green for a rising trend; everything else stays neutral.
export const TO_REVIEW_STYLE = PILL_TONES.po;

const BADGES = {
  a_valider: { label: "À valider", className: TO_REVIEW_STYLE, icon: null },
  emergent: {
    label: "Émergent",
    className: PILL_TONES.signal,
    icon: TrendingUp,
  },
  nouveau: { label: "Nouveau", className: "border-border text-muted-foreground", icon: null },
  manuel: { label: "Manuel", className: "border-border text-muted-foreground", icon: null },
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

export function InsightBadges({ card }: { card: InsightCard }) {
  return (
    <>
      {cardBadges(card).map((b) => {
        const Icon = BADGES[b].icon;
        return (
          <Pill key={b} className={BADGES[b].className}>
            {Icon && <Icon aria-hidden />}
            {BADGES[b].label}
          </Pill>
        );
      })}
      {card.status === "rejete" && (
        <Pill className="border-border text-muted-foreground">{INSIGHT_STATUS_LABELS.rejete}</Pill>
      )}
    </>
  );
}

/**
 * An insight as one row (SPEC §12.4, ADR-038): the problem, then its weight (feedbacks, accounts,
 * MRR, alignment) in columns that line up from one row to the next, and its trend. The rank lives
 * in Priorisation.
 */
export function InsightRow({ card }: { card: InsightCard }) {
  const live = card.status === "propose" || card.status === "actif";
  return (
    <li className="relative flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/40">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{card.id}</span>
        {card.product_area && <span>{PRODUCT_AREA_LABELS[card.product_area]}</span>}
        <InsightBadges card={card} />
        {live && !card.ranked && (
          <span title="Moins de 5 retours, sans compte Business ou Enterprise qui menace de partir ni engagement contractuel">
            · signal faible, hors classement
          </span>
        )}
      </p>
      <Link
        href={`/insights/${card.id}`}
        className={cn(
          "leading-snug font-medium underline-offset-4 hover:underline",
          "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring",
        )}
      >
        {card.title}
      </Link>

      <div className="relative z-10 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
        <Link
          href={`/retours?insight=${card.id}`}
          className="w-20 tabular-nums hover:text-signal"
          title="Voir ces retours"
        >
          <span className="font-medium">{formatNumber(card.feedbacks_count)}</span>{" "}
          <span className="text-muted-foreground">retours</span>
        </Link>
        <span className="w-24">
          <MetricWithSource
            label="Comptes distincts"
            value={formatNumber(card.accounts_count)}
            unit="comptes"
            source="calcule"
            breakdown={accountsBreakdown(card.plans)}
          />
        </span>
        <span className="w-24">
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
        </span>
        <span
          className={cn(
            "w-28 text-muted-foreground",
            card.alignment === "hors_strategie" && "text-foreground",
          )}
        >
          {card.alignment ? ALIGNMENT_LABELS[card.alignment] : ""}
        </span>
        {card.weekly.length > 1 && (
          <span className="ml-auto" title="Retours par semaine sur 6 semaines">
            <Sparkline weekly={card.weekly} />
          </span>
        )}
      </div>
    </li>
  );
}
