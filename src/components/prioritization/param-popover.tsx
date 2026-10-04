"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { EvidenceChip } from "@/components/signal/chips";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { ReachMode } from "@/lib/scoring/reach";
import { cn } from "@/lib/utils";
import { cancelOverrideAction, overrideAction } from "@/server/actions/prioritization";
import type { CellSource, ParamCell } from "@/server/queries/prioritization";
import { FIELD, LABEL, usePrioritizationWrite } from "./use-write";

const SOURCE_LABELS: Record<CellSource, string> = {
  calcule: "Calculé",
  estime: "Estimé par Signal",
  ecrase: "Écrasé par le PO",
  saisi: "Saisi par le PO",
};

const SOURCE_STYLES: Record<CellSource, string> = {
  calcule: "border-border text-muted-foreground",
  estime:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  ecrase:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  saisi: "border-border bg-muted text-foreground",
};

/**
 * One RICE parameter (SPEC §12.5): value, source, breakdown, rationale and evidence, then the
 * override form (reason mandatory). Checked on the server by lib/scoring: nothing computed here.
 */
export function ParamPopover({
  insightId,
  cell,
  mode,
}: {
  insightId: string;
  cell: ParamCell;
  mode: ReachMode;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(cell.input.value));
  const [reason, setReason] = useState("");
  const { pending, error, run, setError } = usePrioritizationWrite();
  const number = Number(value.replace(",", "."));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setValue(String(cell.input.value));
          setReason("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        aria-label={`${cell.label} : ${cell.display}${cell.unit ? ` ${cell.unit}` : ""}, détail et override`}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-signal focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          cell.source === "ecrase" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {cell.display}
        {cell.override?.context_changed && (
          <AlertTriangle aria-label="contexte modifié" className="size-3.5 text-amber-600" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] gap-3 p-3.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{cell.label}</p>
          <Pill className={SOURCE_STYLES[cell.source]}>{SOURCE_LABELS[cell.source]}</Pill>
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {cell.display}
          {cell.unit && <span className="ml-1 text-base text-muted-foreground">{cell.unit}</span>}
          {cell.original && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              d&apos;origine : {cell.original}
            </span>
          )}
        </p>
        {cell.breakdown.length > 0 && (
          <dl className="divide-y rounded-md border">
            {cell.breakdown.map((line) => (
              <div key={line.label} className="flex justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="text-right font-medium tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {cell.rationale && <p className="leading-relaxed">{cell.rationale}</p>}
        {cell.evidence.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">Preuves :</span>
            {cell.evidence.map((id) => (
              <EvidenceChip key={id} id={id} />
            ))}
          </div>
        )}
        {cell.override && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 dark:border-amber-900 dark:bg-amber-950/40">
            <p>
              <span className="font-medium">Ta raison :</span> {cell.override.reason ?? "—"}
            </p>
            {cell.override.context_changed && (
              <p className="mt-1 text-amber-800 dark:text-amber-200">
                Contexte modifié : plus de 30 % des retours ont changé depuis cet override.
              </p>
            )}
          </div>
        )}

        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                overrideAction({
                  insight_id: insightId,
                  param: cell.param,
                  mode,
                  value: number,
                  reason,
                }),
              () => setOpen(false),
            );
          }}
        >
          <p className="font-medium">
            {cell.override ? "Modifier l'override" : "Écraser la valeur"}
          </p>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>
              Nouvelle valeur{cell.input.unit ? ` (${cell.input.unit})` : ""}
            </span>
            <input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={FIELD}
              disabled={pending}
              required
            />
            <span className="text-[13px] text-muted-foreground">{cell.input.hint}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Raison (obligatoire, journalisée)</span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              className="min-h-16 text-sm"
              disabled={pending}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {cell.override && cell.cancellable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => cancelOverrideAction({ insight_id: insightId, param: cell.param }),
                    () => setOpen(false),
                  )
                }
              >
                <RotateCcw aria-hidden />
                Annuler l&apos;override
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={pending || value.trim() === ""}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
