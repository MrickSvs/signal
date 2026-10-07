import Link from "next/link";
import { Hourglass, ListOrdered } from "lucide-react";
import { AddTopicDialog } from "@/components/prioritization/add-topic-dialog";
import { CapacityGauge } from "@/components/prioritization/capacity-gauge";
import { DecisionJournal } from "@/components/prioritization/decision-journal";
import { RankingTable } from "@/components/prioritization/ranking-table";
import { RecommendationsPanel } from "@/components/prioritization/recommendations-panel";
import { EmptyState } from "@/components/shell/states";
import { InsightChip } from "@/components/signal/chips";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { parsePrioritizationParams } from "@/lib/prioritization/params";
import { confidenceLevels } from "@/lib/scoring/confidence";
import type { ReachMode } from "@/lib/scoring/reach";
import { cn } from "@/lib/utils";
import { getPrioritizationScreen } from "@/server/queries/prioritization";

// A manual topic is judged (and possibly estimated) by Signal: one or two model calls.
export const maxDuration = 60;

const MODES: { mode: ReachMode; label: string; hint: string }[] = [
  { mode: "comptes", label: "Comptes", hint: "Comptes concernés estimés" },
  { mode: "mrr", label: "MRR", hint: "MRR concerné estimé, en euros" },
];

/**
 * Priorisation (SPEC §12.5, ADR-039): « in which order, and why? ». Signal's challenges first, then
 * the RICE ranking the PO toggles, overrides and completes.
 */
export default async function PrioritizationPage({ searchParams }: PageProps<"/priorisation">) {
  const pack = await loadContextPack();
  const { mode, focus } = parsePrioritizationParams(
    await searchParams,
    pack.weighting.reach.default_mode,
  );
  const screen = await getPrioritizationScreen(getDb(), mode);
  const now = getDemoNow().toISOString();
  const impactScale = pack.weighting.impact.scale;
  const levels = confidenceLevels(pack.weighting.confidence);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <AddTopicDialog impactScale={impactScale} confidenceLevels={levels} />
      <DecisionJournal entries={screen.journal} now={now} initialEntity={focus ?? ""} />
    </div>
  );

  if (screen.rows.length === 0 && screen.pending.length === 0) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <EmptyState icon={ListOrdered} title="Pas encore de classement">
          <p>
            Le classement naît du scoring des insights classés. Lance le pipeline avec{" "}
            <code className="font-mono">pnpm pipeline:run</code>, ou ajoute un sujet hors retours.
          </p>
        </EmptyState>
        <div className="flex justify-center">{toolbar}</div>
      </div>
    );
  }

  return (
    <div className="@container mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Reach</span>
          <div role="group" aria-label="Unité du Reach" className="flex rounded-lg border p-0.5">
            {MODES.map((m) => (
              <Link
                key={m.mode}
                href={`/priorisation?reach=${m.mode}${focus ? `&insight=${focus}` : ""}`}
                scroll={false}
                aria-current={m.mode === mode ? "true" : undefined}
                title={m.hint}
                className={cn(
                  "rounded-md px-3 py-1 font-medium",
                  m.mode === mode
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </Link>
            ))}
          </div>
        </div>
        <CapacityGauge capacity={screen.capacity} />
        {toolbar}
      </div>

      <RecommendationsPanel recommendations={screen.recommendations} />

      <RankingTable rows={screen.rows} mode={mode} focus={focus} />

      {screen.pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Hourglass aria-hidden className="size-4" />
          En attente de score (prochain run) :
          {screen.pending.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1">
              <InsightChip id={p.id} />
              <span>({p.missing === "jugement" ? "jugement" : "estimation"} manquant)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
