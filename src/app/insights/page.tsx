import Link from "next/link";
import { Eye, Layers, SearchX } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { InsightFilterBar } from "@/components/insights/filter-bar";
import { InsightRow } from "@/components/insights/insight-card";
import { ReviewPanel } from "@/components/insights/review-panel";
import { EvidenceChip } from "@/components/signal/chips";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import {
  INSIGHT_VIEWS,
  activeInsightFilterCount,
  insightFiltersToQuery,
  insightSections,
  insightTab,
  parseInsightFilters,
  type InsightFilters,
} from "@/lib/insights/list";
import { ITEM_TYPE_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getInsightsScreen, listMergeTargets } from "@/server/queries/insights";

// A merge or a rejection re-ranks in code (a few seconds; a model call only for an insight
// without a stored judgment).
export const maxDuration = 60;

/**
 * Insights (SPEC §12.4, ADR-038): what the customers talk about. What awaits the PO on top, then
 * the live insights by weight, the watch queue and the rejected ones. The ranking is Priorisation.
 */
export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  const filters = parseInsightFilters(await searchParams);
  const db = getDb();
  const now = getDemoNow();
  const [{ cards, watch }, targets] = await Promise.all([
    getInsightsScreen(db),
    listMergeTargets(db),
  ]);

  if (cards.length === 0 && watch.length === 0) {
    return (
      <EmptyState icon={Layers} title="Pas encore d'insights">
        <p>
          Les insights naissent du regroupement des retours par problème. Lance le pipeline avec{" "}
          <code className="font-mono">pnpm pipeline:run</code>.
        </p>
      </EmptyState>
    );
  }

  const sections = insightSections(cards, filters);
  const filtered = activeInsightFilterCount(filters) > 0;
  const tab = insightTab(filters);
  const tabHref = (patch: Partial<InsightFilters>) =>
    `/insights${insightFiltersToQuery({ ...filters, vue: undefined, statut: undefined, ...patch })}`;
  const tabs = [
    { key: "actifs", label: "Actifs", count: sections.active.length, href: tabHref({}) },
    {
      key: "surveiller",
      label: INSIGHT_VIEWS.surveiller,
      count: watch.length,
      href: tabHref({ vue: "surveiller" }),
    },
    {
      key: "rejetes",
      label: "Rejetés",
      count: cards.filter((c) => c.status === "rejete").length,
      href: tabHref({ statut: "rejete" }),
    },
  ];
  const shown = tab === "rejetes" ? sections.rejected : sections.active;

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-5 px-8 py-6">
      {sections.toReview.length > 0 && tab !== "rejetes" && (
        <ReviewPanel insights={sections.toReview} targets={targets} />
      )}

      <nav aria-label="Vues" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.href}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-baseline gap-1.5 border-b-2 px-3 py-2 font-medium",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="text-[13px] font-normal text-muted-foreground tabular-nums">
                {formatNumber(t.count)}
              </span>
            </Link>
          );
        })}
      </nav>

      {tab === "surveiller" ? (
        <section className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            Retours récents sans sujet proche. Dès que 3 d&apos;entre eux se ressemblent, Signal
            propose un nouvel insight.
          </p>
          {watch.length === 0 ? (
            <EmptyState icon={Eye} title="Rien à surveiller">
              <p>Chaque retour récent a trouvé son sujet.</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {watch.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
                  <p className="leading-snug font-medium">
                    {item.underlying_problem ?? item.summary}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
                    <EvidenceChip id={item.feedback_id} />
                    <span>{ITEM_TYPE_LABELS[item.type]}</span>
                    {item.product_area && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{PRODUCT_AREA_LABELS[item.product_area]}</span>
                      </>
                    )}
                    {item.received_at && (
                      <>
                        <span aria-hidden>·</span>
                        <span title={formatDate(item.received_at)}>
                          {formatRelative(item.received_at, now)}
                        </span>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <InsightFilterBar filters={filters} />
          {shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={
                filtered
                  ? "Aucun insight ne correspond"
                  : tab === "rejetes"
                    ? "Aucun insight rejeté"
                    : "Aucun insight actif"
              }
            >
              {filtered && (
                <p>
                  <Link
                    href={`/insights${insightFiltersToQuery({ tri: filters.tri, vue: filters.vue, statut: filters.statut === "rejete" ? "rejete" : undefined })}`}
                    className="font-medium text-signal underline-offset-4 hover:underline"
                  >
                    Efface les filtres
                  </Link>{" "}
                  pour tout revoir.
                </p>
              )}
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {shown.map((card) => (
                <InsightRow key={card.id} card={card} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
