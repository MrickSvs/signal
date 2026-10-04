import { AlertTriangle } from "lucide-react";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrioritizationScreen } from "@/server/queries/prioritization";

/** Share of the roadmap capacity taken by the Musts (SPEC §8.6, DSDM rule: 60 % at most). */
export function CapacityGauge({ capacity }: { capacity: PrioritizationScreen["capacity"] }) {
  const width = Math.min(capacity.share, 1) * 100;
  return (
    <div className="flex min-w-64 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">Capacité des Must</span>
        <span className="flex items-baseline gap-1">
          <MetricWithSource
            label="Part des Must dans la capacité roadmap"
            value={formatPercent(capacity.share)}
            source="calcule"
            breakdown={[
              {
                label: `Effort des Must (${capacity.must_ids.length})`,
                value: `${formatNumber(capacity.must_weeks)} sem.-pers.`,
              },
              {
                label: "Capacité roadmap du trimestre",
                value: `${formatNumber(capacity.capacity_weeks)} sem.-pers.`,
              },
              { label: "Plafond (DSDM)", value: formatPercent(capacity.limit_share) },
              ...(capacity.must_ids.length
                ? [{ label: "Must", value: capacity.must_ids.join(", ") }]
                : []),
            ]}
            rationale={
              capacity.alert
                ? `Au-delà du plafond : passer en Should, dans l'ordre, ${capacity.downgrade.join(", ")}.`
                : "Effort cumulé des Must finaux (ton choix quand tu as tranché) ÷ capacité roadmap."
            }
            className={cn("font-semibold", capacity.alert && "text-destructive")}
          />
          <span className="text-[13px] text-muted-foreground">
            / {formatPercent(capacity.limit_share)}
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Part de la capacité prise par les Must"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(capacity.share * 100)}
        className="relative h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", capacity.alert ? "bg-destructive" : "bg-signal")}
          style={{ width: `${width}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-foreground/60"
          style={{ left: `${capacity.limit_share * 100}%` }}
        />
      </div>
      {capacity.alert && (
        <p role="alert" className="flex items-center gap-1 text-[13px] text-destructive">
          <AlertTriangle aria-hidden className="size-3.5" />
          Les Must dépassent {formatPercent(capacity.limit_share)} de la capacité.
        </p>
      )}
    </div>
  );
}
