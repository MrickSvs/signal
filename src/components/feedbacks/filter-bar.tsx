"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Constants } from "@/lib/db/types";
import {
  NO_ACCOUNT,
  PERIODS,
  activeFilterCount,
  filtersToQuery,
  type FeedbackFilters,
  type Period,
} from "@/lib/feedbacks/filters";
import {
  CHANNEL_LABELS,
  ITEM_TYPE_LABELS,
  PLAN_LABELS,
  PRODUCT_AREA_LABELS,
  SEGMENT_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InsightOption } from "@/server/queries/feedbacks";

const enums = Constants.public.Enums;

type SelectKey = "canal" | "plan" | "segment" | "type" | "domaine" | "insight";
type FlagKey = "churn" | "injection" | "echec" | "existante";

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

// Same meaning, same color as the badges of a feedback (signals.tsx): amber for a churn risk, red
// for what needs checking (injection, failed analysis), neutral for the rest.
const FLAGS: { key: FlagKey; label: string; dot: string; on: string }[] = [
  {
    key: "churn",
    label: "Churn",
    dot: "bg-amber-500",
    on: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  },
  {
    key: "injection",
    label: "Injection suspectée",
    dot: "bg-red-500",
    on: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  },
  {
    key: "echec",
    label: "Échec d'analyse",
    dot: "bg-red-500",
    on: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  },
  {
    key: "existante",
    label: "Fonctionnalité existante",
    dot: "bg-muted-foreground",
    on: "border-foreground/30 bg-muted text-foreground",
  },
];

const PERIOD_CHOICES: { value: Period | undefined; label: string }[] = [
  { value: undefined, label: "Tout" },
  ...(Object.entries(PERIODS) as [Period, { days: number }][]).map(([value, p]) => ({
    value,
    label: `${p.days} jours`,
  })),
];

/** Filters of the inbox, all in the URL (SPEC §12.3); any change goes back to the first page. */
export function FilterBar({
  filters,
  insights,
}: {
  filters: FeedbackFilters;
  insights: InsightOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");

  const selects: { key: SelectKey; label: string; items: { value: string; label: string }[] }[] = [
    { key: "canal", label: "Canal", items: options(enums.feedback_channel, CHANNEL_LABELS) },
    {
      key: "plan",
      label: "Plan",
      items: [
        ...options(enums.customer_plan, PLAN_LABELS),
        { value: NO_ACCOUNT, label: "Compte non identifié" },
      ],
    },
    { key: "segment", label: "Segment", items: options(enums.customer_segment, SEGMENT_LABELS) },
    { key: "type", label: "Type", items: options(enums.item_type, ITEM_TYPE_LABELS) },
    { key: "domaine", label: "Domaine", items: options(enums.product_area, PRODUCT_AREA_LABELS) },
    {
      key: "insight",
      label: "Insight",
      items: insights.map((i) => ({ value: i.id, label: `${i.id} · ${i.title}` })),
    },
  ];
  const activeSelects = selects.filter((s) => filters[s.key]);
  const [open, setOpen] = useState(false);

  function apply(patch: Partial<Omit<FeedbackFilters, "page">>) {
    const next = { ...filters, ...patch, page: 1 };
    startTransition(() => router.push(`${pathname}${filtersToQuery(next)}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-2.5" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="relative min-w-56 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ q: query.trim() || undefined });
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher (texte, résumé, R-042)"
            aria-label="Rechercher dans les retours"
            className="h-9 pl-8 text-sm"
          />
        </form>
        <div
          role="group"
          aria-label="Période"
          className="inline-flex h-9 items-center rounded-lg border bg-background p-0.5"
        >
          {PERIOD_CHOICES.map((choice) => {
            const active = filters.periode === choice.value;
            return (
              <button
                key={choice.label}
                type="button"
                aria-pressed={active}
                onClick={() => apply({ periode: choice.value })}
                className={cn(
                  "h-full rounded-md px-2.5 text-sm text-muted-foreground",
                  active ? "bg-foreground font-medium text-background" : "hover:text-foreground",
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="more-filters"
          onClick={() => setOpen(!open)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
            open || activeSelects.length ? "border-foreground/30 bg-muted" : "bg-background",
          )}
        >
          <ListFilter aria-hidden className="size-4" />
          Filtres
          {activeSelects.length > 0 && (
            <span className="rounded-full bg-foreground px-1.5 text-[12px] leading-5 text-background tabular-nums">
              {activeSelects.length}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          id="more-filters"
          className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 @2xl:grid-cols-3"
        >
          {selects.map(({ key, label, items }) => (
            <label key={key} className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] text-muted-foreground">{label}</span>
              <select
                value={filters[key] ?? ""}
                onChange={(event) =>
                  apply({ [key]: event.target.value || undefined } as Partial<FeedbackFilters>)
                }
                className={cn(
                  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm",
                  filters[key] && "border-foreground/40 font-medium",
                )}
              >
                <option value="">Tous</option>
                {items.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {FLAGS.map((flag) => {
          const active = filters[flag.key] ?? false;
          return (
            <button
              key={flag.key}
              type="button"
              aria-pressed={active}
              onClick={() => apply({ [flag.key]: active ? undefined : true })}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px]",
                active
                  ? cn("font-medium", flag.on)
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", flag.dot)} />
              {flag.label}
            </button>
          );
        })}
        {activeSelects.map(({ key, label, items }) => (
          <button
            key={key}
            type="button"
            onClick={() => apply({ [key]: undefined } as Partial<FeedbackFilters>)}
            aria-label={`Retirer le filtre ${label}`}
            className="inline-flex h-7 max-w-64 items-center gap-1 rounded-full border border-foreground/30 bg-muted px-2.5 text-[13px]"
          >
            <span className="text-muted-foreground">{label} :</span>
            <span className="truncate font-medium">
              {items.find((i) => i.value === filters[key])?.label ?? filters[key]}
            </span>
            <X aria-hidden className="size-3 shrink-0" />
          </button>
        ))}
        {activeFilterCount(filters) > 0 && (
          <Link
            href={pathname}
            scroll={false}
            onClick={() => setQuery("")}
            className="ml-1 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Tout effacer
          </Link>
        )}
      </div>
    </div>
  );
}
