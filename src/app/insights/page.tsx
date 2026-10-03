import Link from "next/link";
import { Eye, Layers, SearchX } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { Section } from "@/components/digest/sections";
import { InsightFilterBar } from "@/components/insights/filter-bar";
import { InsightCardView } from "@/components/insights/insight-card";
import { ReviewPanel } from "@/components/insights/review-panel";
import { EvidenceChip } from "@/components/signal/chips";
import { Pill } from "@/components/signal/badges";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { formatDate, formatRelative } from "@/lib/format";
import {
  activeInsightFilterCount,
  insightFiltersToQuery,
  insightSections,
  parseInsightFilters,
} from "@/lib/insights/list";
import { ITEM_TYPE_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { getInsightsScreen, listMergeTargets } from "@/server/queries/insights";

// A merge or a rejection re-ranks in code (a few seconds; a model call only for an insight
// without a stored judgment).
export const maxDuration = 60;

/** Insights (SPEC §12.4): what awaits the PO, the ranked problems, weak signals, the watch queue. */
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
  const nothing = sections.ranked.length + sections.weak.length + sections.rejected.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <p className="max-w-3xl leading-relaxed text-muted-foreground">
        Les problèmes derrière les demandes, regroupés par Signal. Un sujet entre dans le classement
        à partir de 5 retours, ou plus tôt s&apos;il touche un compte Business ou Enterprise qui
        menace de partir ou un engagement contractuel ; les autres restent des signaux faibles.
      </p>

      {sections.toReview.length > 0 && filters.statut !== "rejete" && (
        <ReviewPanel insights={sections.toReview} targets={targets} />
      )}

      <InsightFilterBar filters={filters} />

      {nothing && filtered && (
        <EmptyState
          icon={SearchX}
          title={
            filters.statut === "rejete" ? "Aucun insight rejeté" : "Aucun insight ne correspond"
          }
        >
          <p>
            <Link
              href={`/insights${insightFiltersToQuery({ tri: filters.tri })}`}
              className="font-medium text-signal underline-offset-4 hover:underline"
            >
              Efface les filtres
            </Link>{" "}
            pour tout revoir.
          </p>
        </EmptyState>
      )}

      {filters.statut === "rejete" ? (
        sections.rejected.length > 0 && (
          <Section title="Rejetés (hors classement)" count={sections.rejected.length}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sections.rejected.map((card) => (
                <InsightCardView key={card.id} card={card} compact />
              ))}
            </div>
          </Section>
        )
      ) : (
        <>
          {sections.ranked.length > 0 && (
            <Section title="Classés" count={sections.ranked.length}>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {sections.ranked.map((card) => (
                  <InsightCardView key={card.id} card={card} />
                ))}
              </div>
            </Section>
          )}
          {sections.weak.length > 0 && (
            <Section title="Signaux faibles" count={sections.weak.length}>
              <p className="-mt-1 text-muted-foreground">
                Suivis mais hors classement : trop peu de retours pour l&apos;instant, sans compte
                Business ou Enterprise en risque ni engagement.
              </p>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {sections.weak.map((card) => (
                  <InsightCardView key={card.id} card={card} compact />
                ))}
              </div>
            </Section>
          )}
          {!filtered && (
            <Section title="Sujets à surveiller" count={watch.length}>
              {watch.length === 0 ? (
                <p className="text-muted-foreground">
                  Aucun retour en attente : chaque retour récent a trouvé son sujet.
                </p>
              ) : (
                <>
                  <p className="-mt-1 text-muted-foreground">
                    Retours récents sans sujet proche. Dès que 3 d&apos;entre eux se ressemblent,
                    Signal propose un nouvel insight.
                  </p>
                  <ul className="flex flex-col divide-y rounded-lg border">
                    {watch.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <Eye aria-hidden className="size-4 text-muted-foreground" />
                        <EvidenceChip id={item.feedback_id} />
                        <Pill className="border-border bg-muted text-foreground">
                          {ITEM_TYPE_LABELS[item.type]}
                        </Pill>
                        {item.product_area && (
                          <span className="text-muted-foreground">
                            {PRODUCT_AREA_LABELS[item.product_area]}
                          </span>
                        )}
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={item.underlying_problem ?? undefined}
                        >
                          {item.underlying_problem ?? item.summary}
                        </span>
                        {item.received_at && (
                          <span
                            className="text-muted-foreground"
                            title={formatDate(item.received_at)}
                          >
                            {formatRelative(item.received_at, now)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
