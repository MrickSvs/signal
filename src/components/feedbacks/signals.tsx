import { AlertTriangle, Languages, LifeBuoy, Scissors, ShieldAlert, XCircle } from "lucide-react";
import { Pill } from "@/components/signal/badges";
import { languageLabel } from "@/lib/labels";

export type SignalFlags = {
  analysis_status: "ok" | "failed" | null;
  injection_suspected: boolean | null;
  churn_signal: boolean | null;
  existing_feature: boolean | null;
  language: string | null;
  truncated: boolean | null;
};

const WARN =
  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
const DANGER =
  "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
const NEUTRAL = "border-border bg-background text-muted-foreground";

/** Badges of a feedback, most serious first; at most `max` shown (SPEC §12.1, 3 per line). */
export function FeedbackSignals({ flags, max = 3 }: { flags: SignalFlags; max?: number }) {
  const badges = [
    flags.analysis_status === "failed" && (
      <Pill
        key="echec"
        className={DANGER}
        title="Le triage a échoué après les nouvelles tentatives"
      >
        <XCircle aria-hidden />
        Échec d&apos;analyse
      </Pill>
    ),
    flags.injection_suspected && (
      <Pill
        key="injection"
        className={DANGER}
        title="Le texte contient une instruction visant l'IA : classé normalement, jamais exécuté"
      >
        <ShieldAlert aria-hidden />
        Injection suspectée
      </Pill>
    ),
    flags.churn_signal && (
      <Pill key="churn" className={WARN}>
        <AlertTriangle aria-hidden />
        Churn
      </Pill>
    ),
    flags.existing_feature && (
      <Pill key="existante" className={NEUTRAL} title="Besoin de découvrabilité, pas de story">
        <LifeBuoy aria-hidden />
        Existe déjà
      </Pill>
    ),
    flags.language && flags.language !== "fr" && (
      <Pill key="langue" className={NEUTRAL} title={languageLabel(flags.language)}>
        <Languages aria-hidden />
        {flags.language.toUpperCase()}
      </Pill>
    ),
    flags.truncated && (
      <Pill key="tronque" className={NEUTRAL} title="Texte tronqué à l'ingestion (début et fin)">
        <Scissors aria-hidden />
        Tronqué
      </Pill>
    ),
  ].filter(Boolean);
  if (badges.length === 0) return null;
  const hidden = badges.length - max;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {badges.slice(0, max)}
      {hidden > 0 && <span className="text-[13px] text-muted-foreground">+{hidden}</span>}
    </span>
  );
}
