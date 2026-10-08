import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, SearchX } from "lucide-react";
import { DevNote, EmptyState } from "@/components/shell/states";
import { AddFeedbackDialog } from "@/components/feedbacks/add-feedback-dialog";
import { DetailSheet } from "@/components/feedbacks/detail-sheet";
import { FeedbackDetail } from "@/components/feedbacks/feedback-detail";
import { FilterBar } from "@/components/feedbacks/filter-bar";
import { FeedbackList } from "@/components/feedbacks/feedback-list";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import {
  INBOX_PAGE_SIZE,
  activeFilterCount,
  filtersToQuery,
  neighbors,
  parseFeedbackFilters,
} from "@/lib/feedbacks/filters";
import { formatNumber } from "@/lib/format";
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
  const around = neighbors(
    rows.map((r) => r.id),
    selected,
  );
  const stepHref = (id: string | null) =>
    id ? `/retours${filtersToQuery(filters, { retour: id })}` : null;

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-4 px-8 py-6">
      <header className="flex items-center justify-between gap-4">
        <p className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{formatNumber(total)}</span>
          <span className="text-muted-foreground">
            {total > 1 ? "retours" : "retour"}
            {filtered ? " avec ces filtres" : ", du plus récent au plus ancien"}
          </span>
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
              Les retours des clients arrivent ici. Tu peux aussi en ajouter un à la main avec «
              Ajouter un retour ».
            </p>
            <DevNote command="pnpm db:seed" />
          </EmptyState>
        )
      ) : (
        <FeedbackList
          rows={rows}
          total={total}
          filters={filters}
          selected={selected}
          insightTitles={insightTitles}
          now={now}
        />
      )}

      {askedId && (
        <DetailSheet
          id={askedId}
          closeHref={`/retours${filtersToQuery(filters)}`}
          steps={
            around && {
              previousHref: stepHref(around.previous),
              nextHref: stepHref(around.next),
              label: `${formatNumber((filters.page - 1) * INBOX_PAGE_SIZE + around.position)} sur ${formatNumber(total)}`,
            }
          }
        >
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
