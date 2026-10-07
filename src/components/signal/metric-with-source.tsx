"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Pill } from "./badges";
import { EvidenceChip } from "./chips";
import { PILL_TONES, TEXT_TONES } from "./tones";

export type MetricSource = "calcule" | "estime" | "ecrase";

const SOURCE_LABELS: Record<MetricSource, string> = {
  calcule: "Calculé",
  estime: "Estimé",
  ecrase: "Écrasé par le PO",
};

const SOURCE_STYLES: Record<MetricSource, string> = {
  calcule: PILL_TONES.neutral,
  estime: PILL_TONES.signal,
  ecrase: PILL_TONES.po,
};

export type MetricBreakdownLine = { label: string; value: string };

/**
 * A clickable number that opens its breakdown (SPEC §12.1: every number leads to its proof).
 * Values arrive already computed and formatted by the server (lib/scoring): nothing is computed here.
 */
export function MetricWithSource({
  label,
  value,
  unit,
  source,
  breakdown = [],
  rationale,
  evidence = [],
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  source?: MetricSource;
  breakdown?: MetricBreakdownLine[];
  rationale?: string | null;
  evidence?: string[];
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} : ${value}${unit ? ` ${unit}` : ""}, voir le détail`}
        className={cn(
          "inline-flex cursor-pointer items-baseline gap-1 rounded-sm font-medium tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-signal focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          source === "ecrase" && TEXT_TONES.po,
          className,
        )}
      >
        {value}
        {unit && <span className="text-muted-foreground">{unit}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-3 p-3.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{label}</p>
          {source && <Pill className={SOURCE_STYLES[source]}>{SOURCE_LABELS[source]}</Pill>}
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {value}
          {unit && <span className="ml-1 text-base text-muted-foreground">{unit}</span>}
        </p>
        {breakdown.length > 0 && (
          <dl className="divide-y rounded-md border">
            {breakdown.map((line) => (
              <div key={line.label} className="flex justify-between gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="text-right font-medium tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {rationale && <p className="leading-relaxed">{rationale}</p>}
        {evidence.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">Preuves :</span>
            {evidence.map((id) => (
              <EvidenceChip key={id} id={id} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
