import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { BacklogItemChip, InsightChip } from "@/components/signal/chips";
import { ModelBadge } from "@/components/signal/badges";
import type { ModelComparisonRow } from "@/lib/evals/dashboard";
import type { ProductionMetric } from "@/lib/evals/production";
import type { Metric } from "@/lib/evals/types";
import { formatCost, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FullRunCost } from "@/server/queries/evals";
import { MetricsTable } from "./eval-card";
import { ProofNumber } from "./proof-number";

export function Panel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border p-4", className)}>
      <header className="flex flex-col gap-0.5">
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

const NotMeasured = ({ command }: { command: string }) => (
  <p className="text-muted-foreground">
    Pas encore mesuré :{" "}
    <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">{command}</code>
  </p>
);

const show = (metric: Metric | null) => metric?.display.replace(/\s*\(.*\)$/, "") ?? "—";

/** Haiku / Sonnet on the same holdout sample (`eval:triage --compare`). */
export function ModelComparison({
  rows,
  feedbackCount,
  measuredAt,
  sampleSize,
  productionModel,
}: {
  rows: ModelComparisonRow[] | null;
  feedbackCount: number;
  measuredAt: string | null;
  sampleSize: number | null;
  /** The model the pipeline triages with (PIPELINE_TRIAGE_MODEL). */
  productionModel: string;
}) {
  return (
    <Panel
      title="Triage : Haiku ou Sonnet"
      subtitle={
        rows && measuredAt
          ? `Même échantillon de ${sampleSize ?? "?"} retours du jeu réservé · ${formatDateTime(measuredAt)}`
          : undefined
      }
    >
      {!rows ? (
        <NotMeasured command="pnpm eval:triage --compare" />
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-normal">Modèle</th>
              <th className="py-1.5 pr-3 font-normal">Exactitude du type</th>
              <th className="py-1.5 pr-3 font-normal">Macro-F1 domaine</th>
              <th className="py-1.5 pr-3 font-normal">
                Coût, {formatNumber(feedbackCount)} retours
              </th>
              <th className="py-1.5 font-normal">Latence médiane</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <ModelBadge model={row.model} />
                    {row.model === productionModel && (
                      <span className="rounded-sm bg-signal/10 px-1.5 py-0.5 text-[12px] font-medium text-signal">
                        dans le pipeline
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pr-3 font-medium tabular-nums">{show(row.typeAccuracy)}</td>
                <td className="py-2 pr-3 font-medium tabular-nums">{show(row.areaMacroF1)}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {row.costFullSet === null ? (
                    "—"
                  ) : (
                    <ProofNumber
                      label={`Coût du triage du jeu de démo (${row.model})`}
                      value={formatCost(row.costFullSet)}
                    >
                      <p className="leading-relaxed">
                        {formatCost(row.costPer100!)} pour 100 retours, mesuré sur
                        l&apos;échantillon, × {formatNumber(feedbackCount)} retours du jeu de démo.
                      </p>
                    </ProofNumber>
                  )}
                </td>
                <td className="py-2 tabular-nums">{row.latency?.display ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Cibles du triage : exactitude ≥ 90 %, macro-F1 ≥ 0,85. Latence mesurée avec 8 appels en
        parallèle. Le pipeline garde Sonnet pour son domaine plus juste, dont dépend le regroupement
        (ADR-041) ; Haiku, bien moins cher, deviendrait le bon choix à fort volume.
      </p>
    </Panel>
  );
}

/** E1 to E8 (`eval:triage --edge`): one tile per case. */
export function EdgeCases({ cases }: { cases: Metric[] | null }) {
  return (
    <Panel
      title="Cas limites du triage"
      subtitle="Les situations piégeuses, une par une · réussie quand au moins 75 % de ses retours le sont"
    >
      {!cases ? (
        <NotMeasured command="pnpm eval:triage --edge" />
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {cases.map((m) => {
            const [code, ...rest] = m.label.split(" · ");
            return (
              <li
                key={m.key}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2.5 py-2 text-[13px]",
                  m.met === false &&
                    "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
                )}
              >
                {m.met === false ? (
                  <XCircle aria-label="Échoué" className="mt-0.5 size-4 shrink-0 text-red-600" />
                ) : (
                  <CheckCircle2
                    aria-label="Réussi"
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {code} <span className="tabular-nums text-muted-foreground">{m.display}</span>
                  </span>
                  <span className="leading-snug text-muted-foreground">{rest.join(" · ")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Agreement of the judge with the PO (`eval:judge-calibration`, SPEC §14.3). */
export function JudgeCalibration({
  metrics,
  notes,
}: {
  metrics: Metric[] | null;
  notes: string[];
}) {
  const within = metrics?.find((m) => m.key === "notes_within_1");
  const kappa = metrics?.find((m) => m.key === "verdict_kappa");
  const calibrated = within?.met === true && kappa?.met === true;
  return (
    <Panel
      title="Calibration du juge"
      subtitle="Opus note le backlog ; on vérifie d'abord qu'il note comme le PO, sur 15 éléments annotés à la main"
    >
      {!metrics ? (
        <NotMeasured command="pnpm eval:judge-calibration" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            {[within, kappa].map(
              (m) =>
                m && (
                  <div key={m.key} className="flex flex-col gap-0.5 rounded-md bg-muted/50 p-3">
                    <dt className="text-[13px] text-muted-foreground">{m.label}</dt>
                    <dd className="flex flex-wrap items-baseline gap-x-2">
                      <ProofNumber
                        label="Calibration du juge"
                        value={m.display}
                        className="text-xl"
                      >
                        <MetricsTable metrics={metrics} notes={notes} />
                      </ProofNumber>
                      <span className="text-[13px] text-muted-foreground">cible {m.target}</span>
                    </dd>
                  </div>
                ),
            )}
          </dl>
          <p
            className={cn(
              "text-[13px] font-medium",
              calibrated
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-800 dark:text-amber-200",
            )}
          >
            {calibrated
              ? "Juge calibré : il note le backlog (badge qualité)."
              : "Juge pas encore calibré : il ne note pas le backlog."}
          </p>
        </>
      )}
    </Panel>
  );
}

function IdList({ ids, kind }: { ids: string[]; kind: "insight" | "backlog" }) {
  if (ids.length === 0) return <p className="text-muted-foreground">Aucun.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <li key={id}>
          {kind === "insight" ? <InsightChip id={id} /> : <BacklogItemChip id={id} />}
        </li>
      ))}
    </ul>
  );
}

function Share({
  label,
  part,
  whole,
  kind,
  detail,
}: {
  label: string;
  part: string[];
  whole: string[];
  kind: "insight" | "backlog";
  detail: string;
}) {
  const others = whole.filter((id) => !part.includes(id));
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 p-3">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        {whole.length === 0 ? (
          <span className="text-xl font-semibold text-muted-foreground">—</span>
        ) : (
          <ProofNumber
            label={label}
            value={formatPercent(part.length / whole.length)}
            className="text-xl"
          >
            <p className="text-muted-foreground">{detail}</p>
            <p className="font-medium">Retenus tels quels ({part.length})</p>
            <IdList ids={part} kind={kind} />
            <p className="font-medium">Modifiés par le PO ({others.length})</p>
            <IdList ids={others} kind={kind} />
          </ProofNumber>
        )}
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {part.length} sur {whole.length}
        </span>
      </dd>
    </div>
  );
}

/** SPEC §14.4: what the PO keeps of Signal's proposals, from the decision journal. */
export function ProductionPanel({ metric }: { metric: ProductionMetric }) {
  return (
    <Panel
      title="Ce que le PO garde des propositions de Signal"
      subtitle="Calculé depuis le journal de ses décisions réelles, pas sur un jeu de test"
    >
      <dl className="grid grid-cols-3 gap-3">
        <Share
          label="Backlog validé sans modification"
          part={metric.backlog.unmodified}
          whole={metric.backlog.validated}
          kind="backlog"
          detail="Éléments du backlog validés par le PO, et ceux qu'il n'a jamais modifiés."
        />
        <Share
          label="MoSCoW recommandés retenus"
          part={metric.moscow.kept}
          whole={metric.moscow.reviewed}
          kind="insight"
          detail="Insights validés ou dont le PO a changé le MoSCoW ; retenu = aucun override MoSCoW en vigueur."
        />
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 p-3">
          <dt className="text-[13px] text-muted-foreground">Désaccords de Signal</dt>
          <dd>
            <ProofNumber
              label="Désaccords de Signal"
              value={formatNumber(metric.disagreements.length)}
              className="text-xl"
            >
              <p className="text-muted-foreground">
                Décisions où Signal a exprimé un désaccord avec le PO, qui reste maître :
              </p>
              <p className="font-mono">{metric.disagreements.join(", ") || "Aucune."}</p>
              <p className="text-muted-foreground">
                Le détail est dans le journal de Priorisation.
              </p>
            </ProofNumber>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

const NODE_LABELS: Record<string, string> = {
  embed: "Vectorisation (Voyage)",
  cluster: "Regroupement et titres",
  estimate: "Estimation",
  score: "Jugements de score et MoSCoW",
  digest: "Digest",
};

/** SPEC §15: the cost of the latest full pipeline run, split by node. */
export function PipelineCost({
  run,
  triageModel,
}: {
  run: FullRunCost | null;
  /** Shown next to the triage node (« Sonnet »). */
  triageModel: string;
}) {
  if (!run) {
    return (
      <Panel title="Coût d'un run complet du pipeline">
        <NotMeasured command="pnpm pipeline:run" />
      </Panel>
    );
  }
  const nodes = Object.entries(run.byNode ?? {})
    .filter(([, eur]) => eur > 0)
    .toSorted((a, b) => b[1] - a[1]);
  const max = Math.max(...nodes.map(([, eur]) => eur), 0);
  return (
    <Panel
      title="Coût d'un run complet du pipeline"
      subtitle={`Tous les retours traités d'un coup (triage, regroupement, scores, digest) · dernier run : ${formatDateTime(run.startedAt)}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{formatCost(run.costEur)}</span>
        {run.durationS !== null && (
          <span className="text-muted-foreground tabular-nums">
            {formatNumber(Math.round(run.durationS / 60))} min
          </span>
        )}
        <span className="text-muted-foreground tabular-nums">
          {formatNumber(run.tokensIn / 1000, 0)} k tokens en entrée ·{" "}
          {formatNumber(run.tokensOut / 1000, 0)} k en sortie
        </span>
        {run.langfuseUrl && (
          <a
            href={run.langfuseUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-signal underline-offset-4 hover:underline"
          >
            Trace Langfuse
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
      {run.byNode === null ? (
        <p className="text-[13px] text-muted-foreground">
          Ce run a été enregistré avant la répartition par nœud : elle apparaîtra au prochain run
          complet. Le détail par appel est dans la trace Langfuse.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {nodes.map(([node, eur]) => (
            <li key={node} className="grid grid-cols-[14rem_1fr_auto] items-center gap-3 text-sm">
              <span>
                {node === "triage" ? `Triage (${triageModel})` : (NODE_LABELS[node] ?? node)}
              </span>
              <span aria-hidden className="h-2 rounded-full bg-muted">
                <span
                  className="block h-2 rounded-full bg-signal"
                  style={{ width: `${max > 0 ? (eur / max) * 100 : 0}%` }}
                />
              </span>
              <span className="text-right tabular-nums">
                {formatCost(eur)}{" "}
                <span className="text-muted-foreground">
                  {formatPercent(run.costEur > 0 ? eur / run.costEur : 0)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
