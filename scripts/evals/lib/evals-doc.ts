// docs/EVALS.md, generated from the latest run of each eval (eval_runs): numbers next to their
// targets (SPEC §14.2) and the data set each one is measured on. Rendering is pure.
import { formatDateTime } from "@/lib/format";
import type { EvalName, EvalSummary, Metric } from "./types";

export type StoredEvalRun = {
  id: string;
  eval_name: string;
  config: unknown;
  sample_size: number | null;
  metrics: EvalSummary | Record<string, never>;
  cost_eur: number | null;
  langfuse_url: string | null;
  git_sha: string | null;
  started_at: string;
  ended_at: string | null;
};

export const EVALS: { name: EvalName; title: string; command: string }[] = [
  { name: "triage", title: "Triage", command: "pnpm eval:triage" },
  {
    name: "triage-edge",
    title: "Triage : cas limites E1 à E8",
    command: "pnpm eval:triage --edge",
  },
  {
    name: "triage-compare",
    title: "Triage : Haiku contre Sonnet",
    command: "pnpm eval:triage --compare",
  },
  { name: "detection", title: "Détection des patterns", command: "pnpm eval:detection" },
  { name: "estimation", title: "Estimation (leave-one-out)", command: "pnpm eval:estimation" },
  { name: "stability", title: "Stabilité du classement", command: "pnpm eval:stability" },
  { name: "guardrails", title: "Garde-fous", command: "pnpm eval:guardrails" },
  {
    name: "guardrails-tools",
    title: "Choix d'outil et enquête",
    command: "pnpm eval:guardrails --tools",
  },
  {
    name: "judge-calibration",
    title: "Calibration du juge",
    command: "pnpm eval:judge-calibration",
  },
  { name: "backlog", title: "Backlog : type et note du juge", command: "pnpm eval:backlog" },
];

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function status(metric: Metric): string {
  if (!metric.target) return "—";
  if (metric.met === true) return "✅";
  if (metric.met === false) return "❌";
  return "n/a";
}

const eur = (n: number | null) =>
  n === null ? "—" : `${Number(n).toFixed(2).replace(".", ",")} €`;

/** The first metric with a target is the headline of the eval (its main number). */
function headline(run: StoredEvalRun | undefined): string {
  if (!run || !("metrics" in run.metrics)) return "pas encore mesuré";
  const main = run.metrics.metrics.find((m) => m.target);
  return main ? `${cell(main.label)} : ${cell(main.display)} ${status(main)}` : "sans cible";
}

function section(meta: (typeof EVALS)[number], run: StoredEvalRun | undefined): string[] {
  const lines = [`## ${meta.title}`, "", `Commande : \`${meta.command}\``, ""];
  if (!run || !("metrics" in run.metrics)) {
    lines.push("Pas encore mesuré.", "");
    return lines;
  }
  const s = run.metrics;
  lines.push(
    `- **Jeu :** ${s.dataset}`,
    `- **Run :** ${formatDateTime(run.started_at)} · commit \`${run.git_sha ?? "?"}\` · ` +
      `${run.sample_size ?? "?"} cas · ${eur(run.cost_eur)}` +
      (run.langfuse_url ? ` · [Langfuse](${run.langfuse_url})` : ""),
    "",
    "| Mesure | Valeur | Cible | |",
    "| --- | --- | --- | --- |",
    ...s.metrics.map(
      (m) => `| ${cell(m.label)} | ${cell(m.display)} | ${cell(m.target ?? "—")} | ${status(m)} |`,
    ),
    "",
  );
  if (s.notes?.length) lines.push(...s.notes.map((n) => `> ${n}`), "");
  return lines;
}

export function renderEvalsDoc(runs: readonly StoredEvalRun[], generatedAt: Date): string {
  const latest = new Map<string, StoredEvalRun>();
  for (const run of runs.toSorted((a, b) => b.started_at.localeCompare(a.started_at)))
    if (!latest.has(run.eval_name)) latest.set(run.eval_name, run);

  return [
    "# Evals",
    "",
    "<!-- Fichier généré par scripts/evals (pnpm eval:*) : ne pas modifier à la main. -->",
    "",
    `Derniers résultats de chaque éval, face aux cibles de SPEC §14.2. Généré le ${formatDateTime(generatedAt)}.`,
    "",
    "Deux jeux de retours : le **jeu de développement** (~214 retours, celui de la démo) sert à régler prompts et seuils ; le **jeu réservé** (77 retours, `evals/holdout`) ne sert qu'à mesurer le triage. La détection est réglée et mesurée sur le même jeu : son chiffre est optimiste par construction.",
    "",
    "| Éval | Jeu | Résultat |",
    "| --- | --- | --- |",
    ...EVALS.map((e) => {
      const run = latest.get(e.name);
      const dataset = run && "metrics" in run.metrics ? run.metrics.dataset : "—";
      return `| ${e.title} | ${cell(dataset)} | ${headline(run)} |`;
    }),
    "",
    ...EVALS.flatMap((e) => section(e, latest.get(e.name))),
  ].join("\n");
}
