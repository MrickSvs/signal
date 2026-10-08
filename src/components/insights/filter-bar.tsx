"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Constants } from "@/lib/db/types";
import { SCREEN_SORTS, insightFiltersToQuery, type InsightFilters } from "@/lib/insights/list";
import { ALIGNMENT_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const enums = Constants.public.Enums;
const SELECT = "h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-[13px]";
const ACTIVE = "border-foreground/40 bg-muted font-medium";

/** Sort and filters of the insight cards, in the URL. */
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
      <div
        role="group"
        aria-label="Trier par"
        className="inline-flex h-8 items-center rounded-lg border bg-background p-0.5"
      >
        {Object.entries(SCREEN_SORTS).map(([value, label]) => {
          const active = filters.tri === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => apply({ tri: value as InsightFilters["tri"] })}
              className={cn(
                "h-full rounded-md px-2.5 text-[13px] text-muted-foreground",
                active ? "bg-foreground font-medium text-background" : "hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
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
      {filters.statut === "propose" && (
        <button
          type="button"
          onClick={() => apply({ statut: undefined })}
          aria-label="Retirer le filtre À valider"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-[13px] font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200"
        >
          À valider seulement
          <X aria-hidden className="size-3" />
        </button>
      )}
      {(filters.domaine || filters.alignement) && (
        <button
          type="button"
          onClick={() => apply({ domaine: undefined, alignement: undefined })}
          className="px-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Tout effacer
        </button>
      )}
    </div>
  );
}
