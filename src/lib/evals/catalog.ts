// The evals of SPEC §14.2, in display order, and the shape of a stored run (eval_runs). Shared by
// docs/EVALS.md (scripts/evals) and the Évals screen (SPEC §12.7).
import type { EvalName, EvalSummary } from "./types";

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

export type EvalMeta = {
  name: EvalName;
  title: string;
  command: string;
  /** What the eval checks, in plain words, for someone who does not know the project. */
  measures: string;
};

export const EVALS: EvalMeta[] = [
  {
    name: "triage",
    title: "Triage",
    command: "pnpm eval:triage",
    measures:
      "Chaque retour est-il bien classé (type, domaine, tentative d'injection) ? Comparé à la bonne réponse sur des retours mis de côté, jamais utilisés pour régler les prompts.",
  },
  {
    name: "triage-edge",
    title: "Triage : cas limites E1 à E8",
    command: "pnpm eval:triage --edge",
    measures:
      "Huit situations piégeuses : plusieurs sujets dans un message, anglais, réponse automatique, ironie… Un cas est réussi si au moins 75 % de ses retours le sont.",
  },
  {
    name: "triage-compare",
    title: "Triage : Haiku contre Sonnet",
    command: "pnpm eval:triage --compare",
    measures:
      "Le même échantillon trié par deux modèles, pour choisir celui du pipeline : qualité, coût, rapidité. Pas de cible : la décision est documentée.",
  },
  {
    name: "detection",
    title: "Détection des patterns",
    command: "pnpm eval:detection",
    measures:
      "Les huit problèmes cachés dans le jeu de démo sont-ils retrouvés, chacun dans un seul insight propre ? Réglé et mesuré sur le même jeu : chiffre optimiste.",
  },
  {
    name: "estimation",
    title: "Estimation (leave-one-out)",
    command: "pnpm eval:estimation",
    measures:
      "Chaque ticket déjà livré est ré-estimé à partir des 39 autres, sans voir son résultat : la fourchette contient-elle les points réels ?",
  },
  {
    name: "stability",
    title: "Stabilité du classement",
    command: "pnpm eval:stability",
    measures:
      "Relancé cinq fois sur les mêmes données, le classement reste-t-il le même ? Un modèle n'est pas déterministe ; les priorités doivent l'être.",
  },
  {
    name: "guardrails",
    title: "Garde-fous",
    command: "pnpm eval:guardrails",
    measures:
      "Six pièges : consigne cachée dans un retour, chiffre inventé, ID inexistant, envoi Notion sans validation, donnée absente, demande hors stratégie.",
  },
  {
    name: "guardrails-tools",
    title: "Choix d'outil et enquête",
    command: "pnpm eval:guardrails --tools",
    measures:
      "Vingt demandes du PO : l'agent choisit-il le bon outil ? Et l'enquête sur une alerte n'appelle-t-elle jamais un outil qui écrit ?",
  },
  {
    name: "judge-calibration",
    title: "Calibration du juge",
    command: "pnpm eval:judge-calibration",
    measures:
      "Le modèle qui note le backlog est-il d'accord avec le PO ? Comparé à quinze éléments notés à la main avec la même grille.",
  },
  {
    name: "backlog",
    title: "Backlog : type et note du juge",
    command: "pnpm eval:backlog",
    measures:
      "Le backlog rédigé a-t-il le bon format (bug, epic et stories, tâche) et une note suffisante du juge calibré ?",
  },
];

/** Short definitions of the measures whose name alone says little (shown under them). */
export const METRIC_HELP: Record<string, string> = {
  area_macro_f1:
    "Justesse du domaine, calculée domaine par domaine puis moyennée : un petit domaine compte autant qu'un gros. 1 = parfait.",
  verdict_kappa:
    "κ de Cohen : accord sur « acceptable / à reprendre » au-delà du hasard. 0 = hasard, 1 = accord parfait.",
  notes_within_1: "Part des notes du juge à 1 point au plus de celle du PO.",
  kendall_tau:
    "τ de Kendall : ressemblance de l'ordre du top 10 d'un run à l'autre. 1 = ordre identique.",
  in_range: "Part des tickets dont les points réels tombent dans la fourchette estimée.",
  mean_gap:
    "Écart moyen, en crans de la suite de Fibonacci, entre le milieu de la fourchette et les points réels.",
  patterns_detected:
    "Problème retrouvé : un insight contient au moins 70 % de ses retours, et ceux-ci y sont au moins 70 %.",
};
