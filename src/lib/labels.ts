// French display labels for database enums (SPEC §7). Records keyed by the generated enum types,
// so a new enum value fails the typecheck until it has a label.
import type { Database } from "@/lib/db/types";

type Enums = Database["public"]["Enums"];

export const CHANNEL_LABELS: Record<Enums["feedback_channel"], string> = {
  email_client: "E-mail client",
  ticket_support: "Ticket support",
  commentaire_in_app: "Commentaire in-app",
  nps: "NPS",
  note_csm: "Note CSM",
  note_sales: "Note sales",
  slack_interne: "Slack interne",
};

/** Who wrote a feedback, from its channel (same mapping as data/scenario.yaml). */
export const CHANNEL_SOURCE_TYPES: Record<
  Enums["feedback_channel"],
  Enums["feedback_source_type"]
> = {
  email_client: "client_direct",
  ticket_support: "support",
  commentaire_in_app: "client_direct",
  nps: "client_direct",
  note_csm: "interne",
  note_sales: "interne",
  slack_interne: "interne",
};

export const ITEM_TYPE_LABELS: Record<Enums["item_type"], string> = {
  bug: "Bug",
  demande_fonctionnelle: "Demande fonctionnelle",
  irritant_ux: "Irritant UX",
  question: "Question",
  eloge: "Éloge",
  signal_churn: "Signal de churn",
  autre: "Autre",
};

export const URGENCY_LABELS: Record<Enums["urgency"], string> = {
  basse: "Basse",
  moyenne: "Moyenne",
  haute: "Haute",
  critique: "Critique",
};

/** Sentiment from −2 to 2. */
export function sentimentLabel(sentiment: number): string {
  if (sentiment <= -2) return "Très négatif";
  if (sentiment < 0) return "Négatif";
  if (sentiment === 0) return "Neutre";
  if (sentiment < 2) return "Positif";
  return "Très positif";
}

/** Display name of an ISO 639-1 language code (« en » → « anglais »). */
export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["fr"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const PLAN_LABELS: Record<Enums["customer_plan"], string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

export const HEALTH_LABELS: Record<Enums["customer_health"], string> = {
  vert: "Santé verte",
  orange: "Santé orange",
  rouge: "Santé rouge",
};

export const SEGMENT_LABELS: Record<Enums["customer_segment"], string> = {
  agence_com: "Agence de communication",
  agence_digitale: "Agence digitale",
  conseil: "Conseil",
  pme_services: "PME de services",
  hors_cible: "Hors cible",
};

export const BACKLOG_KIND_LABELS: Record<Enums["backlog_kind"], string> = {
  story: "Story",
  bug: "Bug",
  tache: "Tâche",
};

export const BACKLOG_STATUS_LABELS: Record<Enums["backlog_status"], string> = {
  brouillon: "Brouillon",
  valide: "Validé",
  envoye: "Envoyé",
  modifie_notion: "Modifié dans Notion",
  rejete: "Rejeté",
};

export const INSIGHT_STATUS_LABELS: Record<Enums["insight_status"], string> = {
  propose: "À valider",
  actif: "Actif",
  fusionne: "Fusionné",
  rejete: "Rejeté",
  archive: "Archivé",
};

export const PRODUCT_AREA_LABELS: Record<Enums["product_area"], string> = {
  taches: "Tâches",
  tableau_kanban: "Tableau kanban",
  notifications: "Notifications",
  permissions_partage: "Permissions et partage",
  reporting_export: "Reporting et export",
  planification: "Planification",
  integrations: "Intégrations",
  facturation_temps: "Facturation et temps",
  personnalisation: "Personnalisation",
  performance: "Performance",
  autre: "Autre",
};

export const MOSCOW_LABELS: Record<Enums["moscow"], string> = {
  must: "Must",
  should: "Should",
  could: "Could",
  wont: "Won't",
};

export const ALIGNMENT_LABELS: Record<Enums["alignment"], string> = {
  aligne: "Aligné",
  neutre: "Neutre",
  hors_strategie: "Hors stratégie",
};

export const ROBUSTNESS_LABELS: Record<Enums["robustness"], string> = {
  robuste: "Robuste",
  sensible: "Sensible",
  fragile: "Fragile",
};

export const ALERT_KIND_LABELS: Record<Enums["alert_kind"], string> = {
  nouveau_sujet: "Nouveau sujet",
  emergent: "Tendance émergente",
  churn: "Risque de churn",
  bug_critique: "Bug critique",
  engagement: "Engagement contractuel",
};

export const RUN_KIND_LABELS: Record<Enums["run_kind"], string> = {
  full: "Run complet",
  incremental: "Run incrémental",
  digest: "Digest",
  eval: "Éval",
};

export const RUN_STATUS_LABELS: Record<Enums["run_status"], string> = {
  en_cours: "en cours",
  termine: "terminé",
  echec: "en échec",
};

export type ModelFamily = "Haiku" | "Sonnet" | "Opus";

/** Model family from a model id (claude-sonnet-5-5 → Sonnet), null if unknown. */
export function modelFamily(modelId: string): ModelFamily | null {
  const id = modelId.toLowerCase();
  if (id.includes("haiku")) return "Haiku";
  if (id.includes("sonnet")) return "Sonnet";
  if (id.includes("opus")) return "Opus";
  return null;
}

/** Public URL of a Notion page from its id (with or without dashes). */
export function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`;
}
