import { cn } from "@/lib/utils";

// Building blocks of the digest's « À traiter » list (SPEC §12.2), shared by server rows and the
// client alert row. One color per kind of item, the same in the counters, the group header and
// the row marker: amber for alerts, Signal green for its recommendations, blue for Léa's pending
// decisions. Confidence reads by shape (bars), never by color.

export type InboxTone = "alert" | "recommendation" | "decision";

export const TONES: Record<InboxTone, { dot: string; text: string; marker: string; row?: string }> =
  {
    alert: {
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-300",
      marker:
        "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
      row: "bg-amber-50/60 dark:bg-amber-950/25",
    },
    recommendation: {
      dot: "bg-signal",
      text: "text-signal",
      marker: "border border-signal/25 bg-signal-soft text-signal",
    },
    decision: {
      dot: "bg-blue-500",
      text: "text-blue-700 dark:text-blue-300",
      marker:
        "border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
    },
  };

export type Confidence = "haute" | "moyenne" | "basse";

const CONFIDENCE_LEVEL: Record<Confidence, number> = { basse: 1, moyenne: 2, haute: 3 };

/** Three bars, filled by level: the confidence reads by shape, not by color. */
export function ConfidenceMeter({ level }: { level: Confidence }) {
  const filled = CONFIDENCE_LEVEL[level];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-1 rounded-[1px]",
              bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-3.5",
              bar <= filled ? "bg-foreground/70" : "bg-border",
            )}
          />
        ))}
      </span>
      Confiance {level}
    </span>
  );
}

export function InboxGroup({
  tone,
  label,
  count,
  children,
}: {
  tone: InboxTone;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col">
      <p
        className={cn(
          "flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide uppercase",
          TONES[tone].text,
        )}
      >
        <span aria-hidden className={cn("size-2 rounded-full", TONES[tone].dot)} />
        {label}
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      </p>
      <ul className="flex flex-col divide-y">{children}</ul>
    </li>
  );
}

/** A line of ids with its label (« Preuves »), shown only when there is something to show. */
export function InboxMeta({
  confidence,
  label,
  children,
}: {
  confidence?: Confidence | null;
  label?: string;
  children?: React.ReactNode;
}) {
  if (!confidence && !children) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
      {confidence && <ConfidenceMeter level={confidence} />}
      {children && (
        <span className="flex flex-wrap items-center gap-1">
          {label && <span className="mr-0.5 text-[13px] text-muted-foreground">{label}</span>}
          {children}
        </span>
      )}
    </div>
  );
}

/** One thing to act on: marker, title, one-sentence summary, meta line, action on the right. */
export function InboxRow({
  tone,
  marker,
  title,
  summary,
  meta,
  actions,
  children,
}: {
  tone: InboxTone;
  marker: React.ReactNode;
  title: React.ReactNode;
  summary?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Unfolded content (a dossier), under the title. */
  children?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 @xl:grid-cols-[1.5rem_minmax(0,1fr)_auto]",
        TONES[tone].row,
      )}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums [&>svg]:size-3.5",
          TONES[tone].marker,
        )}
      >
        {marker}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="leading-snug font-semibold">{title}</p>
        {summary && <p className="leading-relaxed text-muted-foreground">{summary}</p>}
        {meta}
      </div>
      {actions && (
        <div className="col-start-2 flex flex-wrap items-start gap-2 @xl:col-start-3 @xl:justify-end">
          {actions}
        </div>
      )}
      {children && (
        <div className="col-span-full flex flex-col gap-2 @xl:col-start-2">{children}</div>
      )}
    </li>
  );
}
