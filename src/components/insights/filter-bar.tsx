"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Constants } from "@/lib/db/types";
import {
  INSIGHT_SORTS,
  STATUS_FILTERS,
  activeInsightFilterCount,
  insightFiltersToQuery,
  type InsightFilters,
} from "@/lib/insights/list";
import { ALIGNMENT_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const enums = Constants.public.Enums;
const SELECT = "h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-sm";
const ACTIVE = "border-signal/60 bg-signal-soft font-medium";

/** Sort and filters of the insight cards, in the URL (PLAN 3.4). */
export function InsightFilterBar({ filters }: { filters: InsightFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const apply = (patch: Partial<InsightFilters>) =>
    startTransition(() =>
      router.push(`${pathname}${insightFiltersToQuery({ ...filters, ...patch })}`, {
        scroll: false,
      }),
    );

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <select
        aria-label="Trier par"
        value={filters.tri}
        onChange={(e) => apply({ tri: e.target.value as InsightFilters["tri"] })}
        className={SELECT}
      >
        {Object.entries(INSIGHT_SORTS).map(([value, label]) => (
          <option key={value} value={value}>
            Tri : {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Domaine"
        value={filters.domaine ?? ""}
        onChange={(e) =>
          apply({ domaine: (e.target.value || undefined) as InsightFilters["domaine"] })
        }
        className={cn(SELECT, filters.domaine && ACTIVE)}
      >
        <option value="">Domaine : tous</option>
        {enums.product_area.map((a) => (
          <option key={a} value={a}>
            {PRODUCT_AREA_LABELS[a]}
          </option>
        ))}
      </select>
      <select
        aria-label="Alignement"
        value={filters.alignement ?? ""}
        onChange={(e) =>
          apply({ alignement: (e.target.value || undefined) as InsightFilters["alignement"] })
        }
        className={cn(SELECT, filters.alignement && ACTIVE)}
      >
        <option value="">Alignement : tous</option>
        {enums.alignment.map((a) => (
          <option key={a} value={a}>
            {ALIGNMENT_LABELS[a]}
          </option>
        ))}
      </select>
      <select
        aria-label="Statut"
        value={filters.statut ?? ""}
        onChange={(e) =>
          apply({ statut: (e.target.value || undefined) as InsightFilters["statut"] })
        }
        className={cn(SELECT, filters.statut && ACTIVE)}
      >
        <option value="">Statut : en cours</option>
        {Object.entries(STATUS_FILTERS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {activeInsightFilterCount(filters) > 0 && (
        <Link
          href={`${pathname}${insightFiltersToQuery({ tri: filters.tri })}`}
          scroll={false}
          className="inline-flex items-center gap-1 px-1 font-medium text-signal underline-offset-4 hover:underline"
        >
          <X aria-hidden className="size-3.5" />
          Effacer les filtres
        </Link>
      )}
    </div>
  );
}
