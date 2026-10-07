import { CheckCircle2, ChevronDown } from "lucide-react";
import { InsightChip } from "@/components/signal/chips";
import { TEXT_TONES } from "@/components/signal/tones";
import type { Recommendation, RecommendationKind } from "@/lib/prioritization/recommendations";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<RecommendationKind, string> = {
  capacite: "Capacité",
  ecart: "Écart avec Signal",
  hors_strategie: "Hors stratégie",
  tension_segments: "Tension entre segments",
  regle_en_tension: "Règles en tension",
  fragile: "Rang fragile",
  contexte_modifie: "Contexte modifié",
};

/** Kinds that put the ranking at risk (amber); the others are Signal's reading (neutral). */
const RISKS = new Set<RecommendationKind>(["capacite", "fragile", "contexte_modifie"]);

/**
 * « Recommandations de Signal » (SPEC §12.5, ADR-039), above the ranking: one line per challenge,
 * the detail and the lead unfold on click. Derived in code; Signal recommends, the PO decides.
 */
export function RecommendationsPanel({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <CheckCircle2 aria-hidden className="size-4 text-signal" />
        Tes choix suivent les recommandations de Signal et le classement est stable.
      </p>
    );
  }
  return (
    <section aria-labelledby="recos-title" className="flex flex-col gap-2">
      <h2 id="recos-title" className="flex items-baseline gap-2 text-base font-semibold">
        Recommandations de Signal
        <span className="font-normal text-muted-foreground tabular-nums">
          {recommendations.length}
        </span>
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {recommendations.map((r, i) => (
          <li key={`${r.kind}-${i}`}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-2.5 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <span
                  className={cn(
                    "w-40 shrink-0 pt-px text-[13px] font-medium",
                    RISKS.has(r.kind) ? TEXT_TONES.risk : "text-muted-foreground",
                  )}
                >
                  {KIND_LABELS[r.kind]}
                </span>
                <span className="min-w-0 flex-1 leading-snug font-medium">{r.title}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.insight_ids.map((id) => (
                    <InsightChip key={id} id={id} />
                  ))}
                  <ChevronDown
                    aria-hidden
                    className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  />
                </span>
              </summary>
              <div className="flex flex-col gap-1.5 px-3 pb-3 pl-[13.25rem] leading-relaxed">
                <p className="text-muted-foreground">{r.detail}</p>
                {r.piste && (
                  <p>
                    <span className="font-medium">Piste :</span> {r.piste}
                  </p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
