import { ArrowDownRight, ArrowRight, ArrowUpRight, ExternalLink } from "lucide-react";
import type { EvalCard as EvalCardData, EvalStatus, TrendPoint } from "@/lib/evals/dashboard";
import { METRIC_HELP } from "@/lib/evals/catalog";
import type { Metric } from "@/lib/evals/types";
import { formatCost, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProofNumber } from "./proof-number";

export const STATUS_LABELS: Record<EvalStatus, string> = {
  vert: "Toutes les cibles atteintes",
  orange: "Cibles en partie atteintes",
  rouge: "Aucune cible atteinte",
  aucun: "Sans cible",
};

/** One or two words next to the dot of a card. */
const STATUS_SHORT: Record<EvalStatus, string> = {
  vert: "Cibles atteintes",
  orange: "En partie",
  rouge: "Cibles manquées",
  aucun: "Sans cible",
};

export const STATUS_DOTS: Record<EvalStatus, string> = {
  vert: "bg-emerald-500",
  orange: "bg-amber-500",
  rouge: "bg-red-500",
  aucun: "bg-muted-foreground/40",
};

const STATUS_BORDERS: Record<EvalStatus, string> = {
  vert: "border-l-emerald-500",
  orange: "border-l-amber-500",
  rouge: "border-l-red-500",
  aucun: "border-l-border",
};

export function StatusDot({ status, className }: { status: EvalStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABELS[status]}
      title={STATUS_LABELS[status]}
      className={cn("inline-block size-2.5 shrink-0 rounded-full", STATUS_DOTS[status], className)}
    />
  );
}

function metMark(metric: Metric): string {
  if (!metric.target) return "";
  if (metric.met === true) return "✓";
  if (metric.met === false) return "✗";
  return "n/a";
}

/** Every measure of the run next to its target, and the honest notes of the runner. */
export function MetricsTable({ metrics, notes = [] }: { metrics: Metric[]; notes?: string[] }) {
  return (
    <>
      <table className="w-full text-[13px]">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 pr-2 font-normal">Mesure</th>
            <th className="py-1 pr-2 font-normal">Valeur</th>
            <th className="py-1 pr-2 font-normal">Cible</th>
            <th className="py-1 font-normal">
              <span className="sr-only">Atteinte</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key} className="border-b last:border-0 align-top">
              <td className="py-1 pr-2">
                {m.label}
                {METRIC_HELP[m.key] && (
                  <span className="block text-muted-foreground">{METRIC_HELP[m.key]}</span>
                )}
              </td>
              <td className="py-1 pr-2 font-medium whitespace-nowrap tabular-nums">{m.display}</td>
              <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                {m.target ?? "—"}
              </td>
              <td
                className={cn(
                  "py-1 font-medium",
                  m.met === true && "text-emerald-700 dark:text-emerald-300",
                  m.met === false && "text-red-700 dark:text-red-300",
                )}
              >
                {metMark(m)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </>
  );
}

const WIDTH = 88;
const HEIGHT = 24;
const PAD = 3;

/** Headline value of the previous runs, oldest first; values are those stored by the runners. */
function TrendLine({ points }: { points: TrendPoint[] }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const x = (i: number) => PAD + (i * (WIDTH - 2 * PAD)) / (points.length - 1);
  const y = (v: number) => HEIGHT - PAD - ((v - min) / span) * (HEIGHT - 2 * PAD);
  const label = `Runs successifs : ${points.map((p) => p.display).join(", ")}`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="shrink-0 overflow-visible text-signal"
    >
      <title>{label}</title>
      <polyline
        points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(points.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill="currentColor" />
    </svg>
  );
}

function Trend({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return <span className="text-[13px] text-muted-foreground">Premier run, pas de tendance</span>;
  }
  const [previous, last] = points.slice(-2);
  const Icon =
    last.value > previous.value
      ? ArrowUpRight
      : last.value < previous.value
        ? ArrowDownRight
        : ArrowRight;
  return (
    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <TrendLine points={points} />
      <span className="flex items-center gap-0.5">
        <Icon aria-hidden className="size-3.5" />
        {points.length} runs · précédent {previous.display}
      </span>
    </span>
  );
}

export function EvalCard({ card }: { card: EvalCardData }) {
  const { latest } = card;
  if (!latest) {
    return (
      <article className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
        <h3 className="font-medium">{card.title}</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{card.measures}</p>
        <p className="font-medium text-muted-foreground">Pas encore mesuré.</p>
        <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-[13px]">{card.command}</code>
      </article>
    );
  }
  const { headline } = latest;
  return (
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-l-4 p-4",
        STATUS_BORDERS[latest.status],
      )}
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{card.title}</h3>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            {STATUS_SHORT[latest.status]}
            <StatusDot status={latest.status} />
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{card.measures}</p>
      </header>

      {headline && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-muted-foreground">{headline.label}</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <ProofNumber
              label={card.title}
              value={headline.display}
              className="text-2xl leading-tight"
            >
              <MetricsTable metrics={latest.metrics} notes={latest.notes} />
            </ProofNumber>
            {headline.target && (
              <span className="text-muted-foreground">cible {headline.target}</span>
            )}
          </span>
          {METRIC_HELP[headline.key] && (
            <span className="text-[12px] leading-snug text-muted-foreground">
              {METRIC_HELP[headline.key]}
            </span>
          )}
        </div>
      )}

      {latest.missed.length > 0 && (
        <p className="text-[13px] leading-relaxed text-amber-800 dark:text-amber-200">
          Cible manquée : {latest.missed.map((m) => `${m.label} (${m.display})`).join(" · ")}
        </p>
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-medium">Mesuré sur :</span> {latest.dataset}
      </p>

      <Trend points={card.trend} />

      <footer className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-[13px] text-muted-foreground">
        <span>{formatDateTime(latest.startedAt)}</span>
        <span>·</span>
        <span className="tabular-nums">
          {latest.costEur === null ? "coût inconnu" : formatCost(latest.costEur)}
        </span>
        {latest.gitSha && (
          <>
            <span>·</span>
            <span title="Version du code mesurée (commit)" className="font-mono">
              {latest.gitSha}
            </span>
          </>
        )}
        {latest.langfuseUrl && (
          <a
            href={latest.langfuseUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-medium text-signal underline-offset-4 hover:underline"
          >
            Langfuse
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </footer>
    </article>
  );
}
