import Link from "next/link";
import { ChevronLeft, ChevronRight, CornerDownRight } from "lucide-react";
import { CHANNEL_ICONS } from "@/components/signal/badges";
import { InsightChip } from "@/components/signal/chips";
import { buttonVariants } from "@/components/ui/button";
import {
  INBOX_PAGE_SIZE,
  filtersToQuery,
  pageCount,
  type FeedbackFilters,
} from "@/lib/feedbacks/filters";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { CHANNEL_LABELS, ITEM_TYPE_LABELS, PLAN_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/server/queries/feedbacks";
import { FeedbackSignals } from "./signals";

const MAX_INSIGHTS = 2;

function Dot() {
  return (
    <span aria-hidden className="text-border">
      ·
    </span>
  );
}

/**
 * One feedback per row (SPEC §12.3): its summary first, the signals on the right, then where it
 * comes from and the insight it joined. The whole row opens the detail panel (?retour=…).
 */
function FeedbackRow({
  row,
  href,
  selected,
  insightTitles,
  now,
}: {
  row: InboxRow;
  href: string;
  selected: boolean;
  insightTitles: ReadonlyMap<string, string>;
  now: Date;
}) {
  const ChannelIcon = row.channel ? CHANNEL_ICONS[row.channel] : null;
  const insights = row.insight_ids ?? [];
  const kinds = (row.item_types ?? []).map((t) => ITEM_TYPE_LABELS[t]);
  const areas = (row.product_areas ?? []).map((a) => PRODUCT_AREA_LABELS[a]);
  return (
    <li
      className={cn(
        "relative flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/40",
        selected &&
          "bg-signal-soft/70 shadow-[inset_3px_0_0_var(--color-signal)] hover:bg-signal-soft/70",
      )}
    >
      <div className="flex items-start gap-3">
        <Link
          href={href}
          scroll={false}
          aria-current={selected || undefined}
          className={cn(
            "line-clamp-2 min-w-0 flex-1 leading-snug font-medium",
            // The link covers the row; chips below sit above it and keep their own popover.
            "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring",
            !row.summary && !row.subject && "text-muted-foreground",
          )}
        >
          {row.summary ?? row.subject ?? "Pas encore analysé"}
        </Link>
        <span className="relative z-10 shrink-0">
          <FeedbackSignals flags={row} max={2} />
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">{row.id}</span>
        <Dot />
        {ChannelIcon && row.channel && (
          <>
            <span className="inline-flex items-center gap-1">
              <ChannelIcon aria-hidden className="size-3.5" />
              {CHANNEL_LABELS[row.channel]}
            </span>
            <Dot />
          </>
        )}
        <span
          title={
            row.received_at ? `${formatDateTime(row.received_at)} (heure de Paris)` : undefined
          }
        >
          {row.received_at ? formatRelative(row.received_at, now) : "—"}
        </span>
        <Dot />
        {row.customer_name ? (
          <span>
            <span className="text-foreground">{row.customer_name}</span>{" "}
            {row.customer_status === "prospect"
              ? "(prospect)"
              : row.customer_plan && `(${PLAN_LABELS[row.customer_plan]})`}
          </span>
        ) : (
          <span>Compte non identifié</span>
        )}
        {kinds.length > 0 && (
          <>
            <Dot />
            <span>
              {[...new Set(kinds)].join(", ")}
              {areas.length > 0 && ` · ${[...new Set(areas)].join(", ")}`}
            </span>
          </>
        )}
      </p>

      {insights.length > 0 && (
        <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 self-start">
          <CornerDownRight aria-hidden className="size-3.5 text-muted-foreground" />
          {insights.slice(0, MAX_INSIGHTS).map((id) => (
            <InsightChip key={id} id={id} title={insightTitles.get(id)} />
          ))}
          {insights.length > MAX_INSIGHTS && (
            <span className="text-[13px] text-muted-foreground">
              +{insights.length - MAX_INSIGHTS}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** Server-paginated list of the feedbacks, newest first. */
export function FeedbackList({
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
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
        {rows.map((row) => (
          <FeedbackRow
            key={row.id}
            row={row}
            href={`/retours${filtersToQuery(filters, { retour: row.id })}`}
            selected={selected === row.id}
            insightTitles={insightTitles}
            now={now}
          />
        ))}
      </ul>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <p className="text-muted-foreground tabular-nums">
            {formatNumber(from + 1)}–{formatNumber(from + rows.length)} sur {formatNumber(total)}
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
      )}
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
  const className = cn(buttonVariants({ variant: "outline", size: "sm" }));
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
