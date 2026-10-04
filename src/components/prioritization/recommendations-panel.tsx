import { CheckCircle2 } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { InsightChip } from "@/components/signal/chips";
import type { Recommendation, RecommendationKind } from "@/lib/prioritization/recommendations";

const KIND_LABELS: Record<RecommendationKind, string> = {
  capacite: "Capacité",
  ecart: "Écart avec Signal",
  hors_strategie: "Hors stratégie",
  tension_segments: "Tension entre segments",
  regle_en_tension: "Règles en tension",
  fragile: "Rang fragile",
  contexte_modifie: "Contexte modifié",
};

/**
 * « Recommandations de Signal » (SPEC §12.5): gaps between the recommendation and the PO's
 * choice, off-strategy insights, segment tensions, MoSCoW rules in tension, fragile ranks and
 * overrides whose context changed. Derived in code; Signal recommends, the PO decides.
 */
export function RecommendationsPanel({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <section aria-labelledby="recos-title" className="flex flex-col gap-3">
      <h2 id="recos-title" className="text-base font-semibold">
        Recommandations de Signal
      </h2>
      {recommendations.length === 0 ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4 text-signal" />
          Rien à signaler : tes choix suivent les recommandations et le classement est stable.
        </p>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {recommendations.map((r, i) => (
            <li key={`${r.kind}-${i}`} className="flex flex-col gap-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill className="border-border text-muted-foreground">{KIND_LABELS[r.kind]}</Pill>
                {r.insight_ids.map((id) => (
                  <InsightChip key={id} id={id} />
                ))}
              </div>
              <p className="font-medium">{r.title}</p>
              <p className="leading-relaxed text-muted-foreground">{r.detail}</p>
              {r.piste && (
                <p className="leading-relaxed">
                  <span className="font-medium">Piste :</span> {r.piste}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
