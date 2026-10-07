"use client";

import { useState } from "react";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { PILL_TONES, TEXT_TONES } from "@/components/signal/tones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MOSCOW_LABELS } from "@/lib/labels";
import type { MoscowCategory } from "@/lib/scoring/moscow-rules";
import type { ReachMode } from "@/lib/scoring/reach";
import { cn } from "@/lib/utils";
import { cancelOverrideAction, overrideAction } from "@/server/actions/prioritization";
import type { PriorityRow } from "@/server/queries/prioritization";
import { LABEL, usePrioritizationWrite } from "./use-write";

const CATEGORIES: MoscowCategory[] = ["must", "should", "could", "wont"];

const FLAG_STATUS: Record<string, string> = {
  appliquee: "Appliquée",
  renfort: "Renfort",
  tension: "En tension",
  correction: "Correction du modèle",
};

/** MoSCoW recommended → final (SPEC §8.6): the PO's choice is the active `moscow` override. */
export function MoscowPopover({
  insightId,
  moscow,
  mode,
}: {
  insightId: string;
  moscow: PriorityRow["moscow"];
  mode: ReachMode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, run, setError } = usePrioritizationWrite();
  const differs = moscow.final !== moscow.reco;

  const choose = (value: MoscowCategory) =>
    run(
      () =>
        overrideAction({
          insight_id: insightId,
          param: "moscow",
          mode,
          value,
          reason: reason.trim() || undefined,
        }),
      () => setOpen(false),
    );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        aria-label={`MoSCoW recommandé ${MOSCOW_LABELS[moscow.reco]}, final ${MOSCOW_LABELS[moscow.final]} : choisir`}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm whitespace-nowrap underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-signal focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {differs && (
          <>
            <span className="text-muted-foreground line-through decoration-muted-foreground/60">
              {MOSCOW_LABELS[moscow.reco]}
            </span>
            <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
          </>
        )}
        <span className={cn("font-semibold", moscow.override && TEXT_TONES.po)}>
          {MOSCOW_LABELS[moscow.final]}
        </span>
        {!moscow.override && <span className="text-[13px] text-muted-foreground">reco</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] gap-3 p-3.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">MoSCoW</p>
          <Pill className={PILL_TONES.signal}>Recommandé : {MOSCOW_LABELS[moscow.reco]}</Pill>
        </div>
        <p className="leading-relaxed">{moscow.rationale}</p>
        {moscow.flags.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-md border p-2.5">
            {moscow.flags.map((flag, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-muted-foreground">
                  {FLAG_STATUS[flag.status] ?? flag.status}
                </span>
                <span>{flag.detail}</span>
                {flag.status === "tension" && flag.piste && (
                  <span className="text-muted-foreground">Piste : {flag.piste}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="font-medium">Ton choix final</p>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Raison (facultative, journalisée)</span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              className="h-9 text-sm"
              disabled={pending}
            />
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {CATEGORIES.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={moscow.final === c ? "default" : "outline"}
                disabled={pending || (moscow.final === c && moscow.override !== null)}
                onClick={() => choose(c)}
              >
                {MOSCOW_LABELS[c]}
              </Button>
            ))}
          </div>
          {moscow.override && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              disabled={pending}
              onClick={() =>
                run(
                  () => cancelOverrideAction({ insight_id: insightId, param: "moscow" }),
                  () => setOpen(false),
                )
              }
            >
              {pending ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <RotateCcw aria-hidden />
              )}
              Revenir à la recommandation
            </Button>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
