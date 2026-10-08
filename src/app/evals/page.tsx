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
import {
  edgeCases,
  modelComparison,
  type EvalCard as EvalCardData,
  type EvalStatus,
} from "@/lib/evals/dashboard";
import type { EvalName } from "@/lib/evals/types";
import { formatCost } from "@/lib/format";
import { PIPELINE_TRIAGE_MODEL } from "@/pipeline/nodes/triage";
import { getEvalsScreen } from "@/server/queries/evals";

const LEGEND: EvalStatus[] = ["vert", "orange", "rouge", "aucun"];

/** The evals grouped by the question they answer, in the order of the pipeline. */
const GROUPS: { id: string; title: string; question: string; evals: EvalName[] }[] = [
  {
    id: "comprendre",
    title: "Comprendre les retours",
    question: "Signal lit-il un retour client comme le ferait un humain ?",
    evals: ["triage", "triage-edge", "triage-compare"],
  },
  {
    id: "prioriser",
    title: "Regrouper et prioriser",
    question: "Retrouve-t-il les vrais problèmes, estime-t-il juste, et son classement tient-il ?",
    evals: ["detection", "estimation", "stability"],
  },
  {
    id: "garde-fous",
    title: "Agir sans déraper",
    question: "Respecte-t-il ses garde-fous et choisit-il le bon outil ?",
    evals: ["guardrails", "guardrails-tools"],
  },
  {
    id: "rediger",
    title: "Rédiger le backlog",
    question: "Le backlog est-il au bon format, et le juge qui le note est-il fiable ?",
    evals: ["judge-calibration", "backlog"],
  },
];

const MODEL_LABELS: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet" };

function Group({
  id,
  title,
  question,
  cards,
  children,
}: {
  id: string;
  title: string;
  question: string;
  cards: EvalCardData[];
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5 border-b pb-2">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        <p className="text-[13px] text-muted-foreground">{question}</p>
      </header>
      <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
        {cards.map((c) => (
          <EvalCard key={c.name} card={c} />
        ))}
      </div>
      {children}
    </section>
  );
}

/** Évals (SPEC §12.7): quality against the targets of §14.2, its cost, and its use in production. */
export default async function EvalsPage() {
  const { cards, production, lastFullRun, feedbackCount } = await getEvalsScreen(getDb());
  const byName = (name: EvalName) => cards.find((c) => c.name === name)!;
  const latest = (name: EvalName) => byName(name)?.latest ?? null;
  const compare = latest("triage-compare");
  const edge = latest("triage-edge");
  const calibration = latest("judge-calibration");
  const triageModel = MODEL_LABELS[PIPELINE_TRIAGE_MODEL] ?? PIPELINE_TRIAGE_MODEL;

  const measured = cards.filter((c) => c.latest);
  const count = (status: EvalStatus) => measured.filter((c) => c.latest!.status === status).length;
  const unmeasured = cards.length - measured.length;
  // One run counted once: the triage card can show the production half of the comparison run.
  const costByRun = new Map(measured.map((c) => [c.latest!.runId, c.latest!.costEur ?? 0]));
  const comparisonRun = compare?.runId;
  if (comparisonRun) costByRun.set(comparisonRun, compare!.costEur ?? 0);
  const totalCost = [...costByRun.values()].reduce((sum, eur) => sum + eur, 0);

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-8 px-6 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <p className="text-lg font-semibold">Est-ce que Signal fait bien son travail ?</p>
            <p className="leading-relaxed text-muted-foreground">
              Chaque éval rejoue une étape de Signal sur des données dont on connaît la bonne
              réponse, et compare le résultat à une cible fixée à l&apos;avance (SPEC §14.2). Clique
              sur un chiffre souligné pour voir le détail de la mesure.
            </p>
          </div>
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
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-4 py-3">
          <p>
            <span className="font-semibold">
              {count("vert")} évals sur {cards.length} atteignent toutes leurs cibles
            </span>
            , {count("orange")} en partie, {count("rouge")} aucune
            {count("aucun") > 0 && `, ${count("aucun")} sans cible`}
            {unmeasured > 0 && `, ${unmeasured} pas encore mesurée${unmeasured > 1 ? "s" : ""}`}.
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {LEGEND.map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <StatusDot status={status} />
                {STATUS_LABELS[status]}
              </span>
            ))}
            <span>
              Dernière mesure de chaque éval : {formatCost(totalCost)} au total. Le triage est
              mesuré avec le modèle du pipeline ({triageModel}).
            </span>
          </p>
        </div>
      </header>

      {GROUPS.map((group) => (
        <Group
          key={group.id}
          id={group.id}
          title={group.title}
          question={group.question}
          cards={group.evals.map(byName).filter(Boolean)}
        >
          {group.id === "comprendre" && (
            <div className="grid gap-4 @5xl:grid-cols-[3fr_2fr]">
              <ModelComparison
                rows={compare ? modelComparison(compare.metrics, feedbackCount) : null}
                feedbackCount={feedbackCount}
                measuredAt={compare?.startedAt ?? null}
                sampleSize={compare?.sampleSize ?? null}
                productionModel={PIPELINE_TRIAGE_MODEL}
              />
              <EdgeCases cases={edge ? edgeCases(edge.metrics) : null} />
            </div>
          )}
          {group.id === "rediger" && (
            <JudgeCalibration
              metrics={calibration?.metrics ?? null}
              notes={calibration?.notes ?? []}
            />
          )}
        </Group>
      ))}

      <section aria-labelledby="production" className="flex flex-col gap-3">
        <header className="flex flex-col gap-0.5 border-b pb-2">
          <h2 id="production" className="font-semibold">
            En production
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Au-delà des jeux de test : ce que le PO garde vraiment de Signal, et ce que coûte un
            passage complet du pipeline.
          </p>
        </header>
        <ProductionPanel metric={production} />
        <PipelineCost run={lastFullRun} triageModel={triageModel} />
      </section>
    </div>
  );
}
