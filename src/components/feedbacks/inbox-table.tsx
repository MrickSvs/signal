import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { InsightChip } from "@/components/signal/chips";
import { ChannelBadge, PlanBadge, Pill } from "@/components/signal/badges";
import { buttonVariants } from "@/components/ui/button";
import {
  INBOX_PAGE_SIZE,
  filtersToQuery,
  pageCount,
  type FeedbackFilters,
} from "@/lib/feedbacks/filters";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { ITEM_TYPE_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/server/queries/feedbacks";
import { FeedbackSignals } from "./signals";

const MAX_INSIGHTS = 2;

/** Server-paginated table of the feedbacks; a row opens the detail panel (?retour=…). */
export function InboxTable({
  rows,
  total,
  filters,
  selected,
  insightTitles,
  now,
}: {
  rows: InboxRow[];
  insightTitles: ReadonlyMap<string, string>;
  total: number;
  filters: FeedbackFilters;
  selected: string | undefined;
  now: Date;
}) {
  const pages = pageCount(total);
  const from = (filters.page - 1) * INBOX_PAGE_SIZE;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-36" />
            <col className="w-44" />
            <col />
            <col className="w-[30%]" />
          </colgroup>
          <thead className="bg-muted/50 text-[13px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Retour</th>
              <th className="px-3 py-2 font-medium">Compte</th>
              <th className="px-3 py-2 font-medium">Résumé</th>
              <th className="px-3 py-2 font-medium">Insights et signaux</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/retours${filtersToQuery(filters, { retour: row.id })}`;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t align-top hover:bg-muted/40",
                    selected === row.id && "bg-signal-soft hover:bg-signal-soft",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <Link
                        href={href}
                        scroll={false}
                        className="font-mono font-semibold text-signal underline-offset-4 hover:underline"
                      >
                        {row.id}
                      </Link>
                      <span
                        className="text-[13px] text-muted-foreground"
                        title={row.received_at ? formatDateTime(row.received_at) : undefined}
                      >
                        {row.received_at ? formatRelative(row.received_at, now) : "—"}
                      </span>
                      {row.channel && <ChannelBadge channel={row.channel} />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.customer_name ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="line-clamp-2 font-medium">{row.customer_name}</span>
                        {row.customer_status === "prospect" ? (
                          <Pill className="border-border text-muted-foreground">Prospect</Pill>
                        ) : (
                          <PlanBadge plan={row.customer_plan} />
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Compte non identifié</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={href}
                      scroll={false}
                      className="flex flex-col gap-1 hover:underline"
                    >
                      <span className="line-clamp-2">
                        {row.summary ?? row.subject ?? "Pas encore analysé"}
                      </span>
                    </Link>
                    {(row.item_types?.length ?? 0) > 0 && (
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {row.item_types!.map((t) => ITEM_TYPE_LABELS[t]).join(" · ")}
                        {" — "}
                        {row.product_areas!.map((a) => PRODUCT_AREA_LABELS[a]).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      {(row.insight_ids ?? []).slice(0, MAX_INSIGHTS).map((id) => (
                        <InsightChip key={id} id={id} title={insightTitles.get(id)} />
                      ))}
                      {(row.insight_ids?.length ?? 0) > MAX_INSIGHTS && (
                        <span className="text-[13px] text-muted-foreground">
                          +{row.insight_ids!.length - MAX_INSIGHTS}
                        </span>
                      )}
                      <FeedbackSignals flags={row} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="flex items-center justify-between">
        <p className="text-muted-foreground">
          {formatNumber(from + 1)}–{formatNumber(from + rows.length)} sur {formatNumber(total)}{" "}
          {total > 1 ? "retours" : "retour"}
        </p>
        <div className="flex items-center gap-2">
          <PageLink filters={filters} page={filters.page - 1} disabled={filters.page <= 1}>
            <ChevronLeft aria-hidden />
            Précédent
          </PageLink>
          <span className="text-muted-foreground tabular-nums">
            {filters.page} / {pages}
          </span>
          <PageLink filters={filters} page={filters.page + 1} disabled={filters.page >= pages}>
            Suivant
            <ChevronRight aria-hidden />
          </PageLink>
        </div>
      </nav>
    </div>
  );
}

function PageLink({
  filters,
  page,
  disabled,
  children,
}: {
  filters: FeedbackFilters;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = cn(buttonVariants({ variant: "outline" }));
  return disabled ? (
    <span aria-disabled className={cn(className, "pointer-events-none opacity-50")}>
      {children}
    </span>
  ) : (
    <Link href={`/retours${filtersToQuery({ ...filters, page })}`} className={className}>
      {children}
    </Link>
  );
}
