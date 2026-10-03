import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, SearchX } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { AddFeedbackDialog } from "@/components/feedbacks/add-feedback-dialog";
import { DetailSheet } from "@/components/feedbacks/detail-sheet";
import { FeedbackDetail } from "@/components/feedbacks/feedback-detail";
import { FilterBar } from "@/components/feedbacks/filter-bar";
import { InboxTable } from "@/components/feedbacks/inbox-table";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { activeFilterCount, filtersToQuery, parseFeedbackFilters } from "@/lib/feedbacks/filters";
import { FEEDBACK_ID } from "@/server/queries/evidence";
import { getFeedbackDetail, listFeedbackInbox, listInboxOptions } from "@/server/queries/feedbacks";

/** Retours (SPEC §12.3): every feedback, filterable, and live ingestion of a new one. */
export default async function FeedbacksPage({ searchParams }: PageProps<"/retours">) {
  const params = await searchParams;
  const filters = parseFeedbackFilters(params);
  const askedId = typeof params.retour === "string" ? params.retour : undefined;
  const selected = askedId && FEEDBACK_ID.test(askedId) ? askedId : undefined;
  const db = getDb();
  const now = getDemoNow();
  const [{ rows, total }, options, detail, pack] = await Promise.all([
    listFeedbackInbox(db, filters, now),
    listInboxOptions(db),
    selected ? getFeedbackDetail(db, selected) : null,
    selected ? loadContextPack() : null,
  ]);
  // Past the last page (a stale link, fewer results after an ingestion): back to the first one.
  if (rows.length === 0 && filters.page > 1) {
    redirect(`/retours${filtersToQuery({ ...filters, page: 1 })}`);
  }
  const insightTitles = new Map(options.insights.map((i) => [i.id, i.title]));
  const filtered = activeFilterCount(filters) > 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-8 py-6">
      <header className="flex items-start justify-between gap-4">
        <p className="max-w-2xl leading-relaxed text-muted-foreground">
          Tous les retours clients, du plus récent au plus ancien. Clique un retour pour voir son
          verbatim, son analyse et pourquoi Signal l&apos;a classé ainsi.
        </p>
        <AddFeedbackDialog customers={options.customers} />
      </header>
      <FilterBar filters={filters} insights={options.insights} />

      {total === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="Aucun retour ne correspond">
            <p>
              Élargis la recherche ou{" "}
              <Link
                href="/retours"
                className="font-medium text-signal underline-offset-4 hover:underline"
              >
                efface les filtres
              </Link>
              .
            </p>
          </EmptyState>
        ) : (
          <EmptyState icon={Inbox} title="Pas encore de retours">
            <p>
              Charge le jeu de données avec <code className="font-mono">pnpm db:seed</code> ou
              ajoute un retour à la main.
            </p>
          </EmptyState>
        )
      ) : (
        <InboxTable
          rows={rows}
          total={total}
          filters={filters}
          selected={selected}
          insightTitles={insightTitles}
          now={now}
        />
      )}

      {askedId && (
        <DetailSheet id={askedId} closeHref={`/retours${filtersToQuery(filters)}`}>
          {detail && pack ? (
            <FeedbackDetail
              feedback={detail}
              now={now}
              why={{
                distanceThreshold: pack.weighting.clustering.distance_threshold,
                minClusterSize: pack.weighting.clustering.min_cluster_size,
                watchMinItems: pack.weighting.clustering.watch_queue_min_items,
              }}
            />
          ) : (
            <EmptyState icon={SearchX} title="Retour introuvable">
              <p>Le retour {askedId} n&apos;existe pas ou plus.</p>
            </EmptyState>
          )}
        </DetailSheet>
      )}
    </div>
  );
}
