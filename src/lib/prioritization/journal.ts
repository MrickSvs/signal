// « Journal des décisions » drawer (SPEC §12.5, rule 6): filters and display of the decisions.
import { MOSCOW_LABELS } from "@/lib/labels";
import type { Database, Json } from "@/lib/db/types";
import { formatEur, formatNumber, formatPercent } from "@/lib/format";

type Enums = Database["public"]["Enums"];

export type JournalEntry = {
  id: string;
  actor: Enums["decision_actor"];
  source: Enums["decision_source"];
  entity_type: string;
  entity_id: string;
  action: Enums["decision_action"];
  field: string | null;
  before: Json | null;
  after: Json | null;
  reason: string | null;
  created_at: string;
};

export const DECISION_ACTION_LABELS: Record<Enums["decision_action"], string> = {
  override: "Override",
  validation: "Validation",
  rejet: "Rejet",
  modification: "Modification",
  desaccord: "Désaccord",
  conflit: "Conflit",
  ajustement: "Ajustement",
};

export const DECISION_SOURCE_LABELS: Record<Enums["decision_source"], string> = {
  signal_ui: "Cockpit",
  chat: "Chat",
  notion: "Notion",
};

export type JournalFilter = {
  action: Enums["decision_action"] | null;
  source: Enums["decision_source"] | null;
  /** Substring of the entity id (« I-07 »), case-insensitive. */
  entity: string;
};

export const EMPTY_JOURNAL_FILTER: JournalFilter = { action: null, source: null, entity: "" };

export function filterJournal(
  entries: readonly JournalEntry[],
  filter: JournalFilter,
): JournalEntry[] {
  const entity = filter.entity.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (filter.action === null || e.action === filter.action) &&
      (filter.source === null || e.source === filter.source) &&
      (entity === "" || e.entity_id.toLowerCase().includes(entity)),
  );
}

/** A before / after value as one short line (numbers, MoSCoW, Reach by mode, objects). */
export function journalValue(value: Json | null, field: string | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return field === "confidence" ? formatPercent(value) : formatNumber(value, 2);
  }
  if (typeof value === "string") return (MOSCOW_LABELS as Record<string, string>)[value] ?? value;
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (Array.isArray(value)) return value.map((v) => journalValue(v, field)).join(", ");
  const o = value as Record<string, Json>;
  if (typeof o.mode === "string" && typeof o.value === "number") {
    return o.mode === "mrr" ? `${formatEur(o.value)} (MRR)` : `${formatNumber(o.value)} comptes`;
  }
  if (typeof o.comptes === "number") {
    const mrr = typeof o.mrr === "number" ? formatEur(o.mrr) : "non renseigné";
    return `${formatNumber(o.comptes)} comptes, MRR ${mrr}`;
  }
  if (typeof o.title === "string") return o.title;
  return JSON.stringify(value);
}
