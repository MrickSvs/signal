"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Constants } from "@/lib/db/types";
import {
  NO_ACCOUNT,
  PERIODS,
  activeFilterCount,
  filtersToQuery,
  type FeedbackFilters,
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

type SelectKey = "canal" | "plan" | "segment" | "type" | "domaine" | "insight" | "periode";
type FlagKey = "injection" | "existante" | "echec";

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

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

  function apply(patch: Partial<Omit<FeedbackFilters, "page">>) {
    const next = { ...filters, ...patch, page: 1 };
    startTransition(() => router.push(`${pathname}${filtersToQuery(next)}`, { scroll: false }));
  }

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
    {
      key: "periode",
      label: "Période",
      items: Object.entries(PERIODS).map(([value, p]) => ({ value, label: p.label })),
    },
  ];
  const flags: { key: FlagKey; label: string }[] = [
    { key: "injection", label: "Injection suspectée" },
    { key: "existante", label: "Fonctionnalité existante" },
    { key: "echec", label: "Échec d'analyse" },
  ];

  return (
    <div className="flex flex-col gap-2.5" aria-busy={pending}>
      <form
        role="search"
        className="relative max-w-md"
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
          placeholder="Rechercher dans les retours (texte, résumé, R-042)…"
          aria-label="Rechercher dans les retours"
          className="h-9 pl-8 text-sm"
        />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {selects.map(({ key, label, items }) => (
          <select
            key={key}
            aria-label={label}
            value={filters[key] ?? ""}
            onChange={(event) =>
              apply({ [key]: event.target.value || undefined } as Partial<FeedbackFilters>)
            }
            className={cn(
              "h-8 max-w-48 rounded-lg border border-input bg-background px-2 text-sm",
              filters[key] && "border-signal/60 bg-signal-soft font-medium",
            )}
          >
            <option value="">{label} : tous</option>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ))}
        {flags.map(({ key, label }) => (
          <label
            key={key}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2 text-sm",
              filters[key] && "border-signal/60 bg-signal-soft font-medium",
            )}
          >
            <input
              type="checkbox"
              checked={filters[key] ?? false}
              onChange={(event) => apply({ [key]: event.target.checked || undefined })}
              className="accent-[var(--signal)]"
            />
            {label}
          </label>
        ))}
        {activeFilterCount(filters) > 0 && (
          <Link
            href={pathname}
            scroll={false}
            onClick={() => setQuery("")}
            className="inline-flex items-center gap-1 px-1 font-medium text-signal underline-offset-4 hover:underline"
          >
            <X aria-hidden className="size-3.5" />
            Effacer les filtres
          </Link>
        )}
      </div>
    </div>
  );
}
