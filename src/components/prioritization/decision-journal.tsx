"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { InsightChip } from "@/components/signal/chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatRelative } from "@/lib/format";
import {
  DECISION_ACTION_LABELS,
  DECISION_SOURCE_LABELS,
  EMPTY_JOURNAL_FILTER,
  filterJournal,
  journalValue,
  type JournalEntry,
  type JournalFilter,
} from "@/lib/prioritization/journal";
import { FIELD, LABEL } from "./use-write";

const FIELD_LABELS: Record<string, string> = {
  reach: "Reach",
  impact: "Impact",
  confidence: "Confidence",
  effort: "Effort",
  moscow: "MoSCoW",
  creation: "Création",
  formulation: "Formulation",
  merged_into: "Fusion",
};

/** « Journal des décisions » (SPEC §12.5, rule 6): every choice of the PO, filterable. */
export function DecisionJournal({
  entries,
  now,
  initialEntity = "",
}: {
  entries: JournalEntry[];
  now: string;
  initialEntity?: string;
}) {
  const [filter, setFilter] = useState<JournalFilter>({
    ...EMPTY_JOURNAL_FILTER,
    entity: initialEntity,
  });
  const shown = filterJournal(entries, filter);

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        <ScrollText aria-hidden />
        Journal des décisions
      </SheetTrigger>
      <SheetContent className="w-[36rem] gap-0 overflow-y-auto p-0 text-sm data-[side=right]:sm:max-w-[36rem]">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="text-base">Journal des décisions</SheetTitle>
          <SheetDescription>
            Tes overrides, validations et rejets, du plus récent au plus ancien.
          </SheetDescription>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Action</span>
              <select
                value={filter.action ?? ""}
                onChange={(e) =>
                  setFilter({
                    ...filter,
                    action: (e.target.value || null) as JournalFilter["action"],
                  })
                }
                className={FIELD}
              >
                <option value="">Toutes</option>
                {Object.entries(DECISION_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Source</span>
              <select
                value={filter.source ?? ""}
                onChange={(e) =>
                  setFilter({
                    ...filter,
                    source: (e.target.value || null) as JournalFilter["source"],
                  })
                }
                className={FIELD}
              >
                <option value="">Toutes</option>
                {Object.entries(DECISION_SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Élément</span>
              <Input
                value={filter.entity}
                onChange={(e) => setFilter({ ...filter, entity: e.target.value })}
                placeholder="I-07"
                className="h-9 text-sm"
              />
            </label>
          </div>
        </SheetHeader>
        {shown.length === 0 ? (
          <p className="p-4 text-muted-foreground">
            {entries.length === 0
              ? "Aucune décision pour l'instant."
              : "Aucune décision ne correspond à ces filtres."}
          </p>
        ) : (
          <ol className="divide-y">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[13px] text-muted-foreground">{d.id}</span>
                  <Pill className="border-border">{DECISION_ACTION_LABELS[d.action]}</Pill>
                  {d.entity_type === "insight" ? (
                    <InsightChip id={d.entity_id} />
                  ) : (
                    <span className="font-mono">{d.entity_id}</span>
                  )}
                  <span className="ml-auto text-[13px] text-muted-foreground">
                    {DECISION_SOURCE_LABELS[d.source]} · {formatRelative(d.created_at, now)}
                  </span>
                </div>
                {d.field && (
                  <p>
                    <span className="font-medium">{FIELD_LABELS[d.field] ?? d.field}</span>{" "}
                    <span className="text-muted-foreground">{journalValue(d.before, d.field)}</span>{" "}
                    → {journalValue(d.after, d.field)}
                  </p>
                )}
                {d.reason && <p className="text-muted-foreground">« {d.reason} »</p>}
              </li>
            ))}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}
