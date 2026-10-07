import Link from "next/link";
import { EvalCard, STATUS_LABELS, StatusDot } from "@/components/evals/eval-card";
import {
  EdgeCases,
  JudgeCalibration,
  ModelComparison,
  PipelineCost,
  ProductionPanel,
} from "@/components/evals/sections";
import { getDb } from "@/lib/db/client";
import { edgeCases, modelComparison, type EvalStatus } from "@/lib/evals/dashboard";
import { formatCost } from "@/lib/format";
import { getEvalsScreen } from "@/server/queries/evals";

const LEGEND: EvalStatus[] = ["vert", "orange", "rouge"];

/** Évals (SPEC §12.7): quality against the targets of §14.2, its cost, and its use in production. */
export default async function EvalsPage() {
  const { cards, production, lastFullRun, feedbackCount } = await getEvalsScreen(getDb());
  const card = (name: string) => cards.find((c) => c.name === name)?.latest ?? null;
  const compare = card("triage-compare");
  const edge = card("triage-edge");
  const calibration = card("judge-calibration");

  const measured = cards.filter((c) => c.latest);
  const count = (status: EvalStatus) => measured.filter((c) => c.latest!.status === status).length;
  const unmeasured = cards.length - measured.length;
  const totalCost = measured.reduce((sum, c) => sum + (c.latest!.costEur ?? 0), 0);

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-base">
            <span className="font-semibold">
              {count("vert")} évals sur {cards.length} atteignent toutes leurs cibles
            </span>
            , {count("orange")} en partie, {count("rouge")} aucune
            {unmeasured > 0 && `, ${unmeasured} pas encore mesurée${unmeasured > 1 ? "s" : ""}`}.
          </p>
          {/* The annotation of the judge's calibration set writes into the repo: local only (PLAN 6.3). */}
          {process.env.NODE_ENV !== "production" && (
            <Link
              href="/evals/annotate"
              className="text-[13px] text-signal underline-offset-4 hover:underline"
            >
              Annoter le jeu de calibration du juge
            </Link>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {LEGEND.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <StatusDot status={status} />
              {STATUS_LABELS[status]}
            </span>
          ))}
          <span>
            Cibles de SPEC §14.2 · dernier run de chaque éval : {formatCost(totalCost)} au total
          </span>
        </p>
      </header>

      <section
        aria-label="Une carte par éval"
        className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-3"
      >
        {cards.map((c) => (
          <EvalCard key={c.name} card={c} />
        ))}
      </section>

      <div className="grid gap-4 @5xl:grid-cols-[3fr_2fr]">
        <ModelComparison
          rows={compare ? modelComparison(compare.metrics, feedbackCount) : null}
          feedbackCount={feedbackCount}
          measuredAt={compare?.startedAt ?? null}
          sampleSize={compare?.sampleSize ?? null}
        />
        <EdgeCases cases={edge ? edgeCases(edge.metrics) : null} />
      </div>

      <div className="grid gap-4 @5xl:grid-cols-[2fr_3fr]">
        <JudgeCalibration metrics={calibration?.metrics ?? null} notes={calibration?.notes ?? []} />
        <ProductionPanel metric={production} />
      </div>

      <PipelineCost run={lastFullRun} />
    </div>
  );
}
