// Context briefing of the agent (SPEC §10.8): a compact state of the application, computed in
// code and injected at every turn after the cached blocks, so Signal knows where things stand
// without calling a tool. Pure: the facts are loaded by services/briefing.ts; get_briefing renders
// the same facts in more detail. Every list is bounded (~1 500 tokens at most).
import { formatDateTime } from "@/lib/format";
import { ALERT_KIND_LABELS, CHANNEL_LABELS, MOSCOW_LABELS, PLAN_LABELS } from "@/lib/labels";
import type { DigestFacts } from "@/pipeline/nodes/digest";

export type PageContext = {
  /** Path of the page Léa is on (e.g. "/insights"). */
  page: string;
  entity_id?: string | null;
};

export type BriefingFacts = {
  /** Start of « since your last visit » (null: no visit recorded, everything is new). */
  since: string | null;
  top: {
    insight_id: string;
    title: string;
    rank: number;
    moscow_reco: string | null;
    moscow_final: string | null;
  }[];
  feedbacks: DigestFacts["feedbacks"];
  alerts: DigestFacts["alerts"];
  emerging: DigestFacts["emerging"];
  new_insights: DigestFacts["new_insights"];
  moves: DigestFacts["ranking"]["moves"];
  has_history: boolean;
  accounts_at_risk: DigestFacts["accounts_at_risk"];
  pending: DigestFacts["pending"];
  /** Recent decisions of the period (journal), newest first. */
  decisions: { id: string; entity_id: string; action: string; field: string | null }[];
  page: (PageContext & { entity_label: string | null }) | null;
};

export type BriefingLimits = { list: number; ids: number };

/** Injected briefing: short lists. get_briefing uses DETAILED_LIMITS. */
export const BRIEFING_LIMITS: BriefingLimits = { list: 5, ids: 8 };
export const DETAILED_LIMITS: BriefingLimits = { list: 10, ids: 20 };

const PAGE_LABELS: Record<string, string> = {
  "/": "Digest",
  "/retours": "Retours",
  "/insights": "Insights",
  "/priorisation": "Priorisation",
  "/backlog": "Backlog",
  "/evals": "Évals",
  "/contexte": "Contexte",
};

/** « R-001, R-002 … (+3) »: ids beyond the limit are counted, never silently dropped. */
export function idList(ids: readonly string[], limit: number): string {
  if (ids.length === 0) return "aucun";
  const shown = ids.slice(0, limit).join(", ");
  return ids.length > limit ? `${shown} … (+${ids.length - limit})` : shown;
}

function bounded<T>(items: readonly T[], limit: number, line: (item: T) => string): string[] {
  const lines = items.slice(0, limit).map((item) => `- ${line(item)}`);
  if (items.length > limit) lines.push(`- … et ${items.length - limit} de plus`);
  return lines;
}

export function pageLabel(page: string): string {
  const base = `/${page.replace(/^\/+/, "").split("/")[0]}`;
  return PAGE_LABELS[base === "/" ? "/" : base] ?? page;
}

const moscowLabel = (value: string | null) =>
  value && value in MOSCOW_LABELS ? MOSCOW_LABELS[value as keyof typeof MOSCOW_LABELS] : "—";

function channels(byChannel: Record<string, number>): string {
  const entries = Object.entries(byChannel).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  return entries
    .map(([c, n]) => `${CHANNEL_LABELS[c as keyof typeof CHANNEL_LABELS] ?? c} ${n}`)
    .join(", ");
}

function pendingLines(pending: BriefingFacts["pending"], limits: BriefingLimits): string[] {
  const lines: string[] = [];
  if (pending.insights_to_validate.length)
    lines.push(
      `- ${pending.insights_to_validate.length} insight(s) proposé(s) à valider : ${idList(pending.insights_to_validate, limits.ids)}`,
    );
  if (pending.backlog_to_validate.length)
    lines.push(
      `- ${pending.backlog_to_validate.length} élément(s) du backlog en brouillon : ${idList(pending.backlog_to_validate, limits.ids)}`,
    );
  if (pending.notion_conflicts.length)
    lines.push(
      `- ${pending.notion_conflicts.length} conflit(s) Notion : ${idList(pending.notion_conflicts, limits.ids)}`,
    );
  for (const m of pending.merges.slice(0, limits.list))
    lines.push(`- fusion à confirmer : ${m.from} → ${m.into}`);
  for (const s of pending.splits.slice(0, limits.list))
    lines.push(`- scission à confirmer : ${s.from} → ${s.into}`);
  for (const o of pending.overrides_context_changed.slice(0, limits.list))
    lines.push(`- override « ${o.param} » de ${o.insight_id} : contexte modifié, à revoir`);
  return lines.length ? lines : ["- aucune"];
}

/**
 * The briefing as Markdown. Every number is counted here, in code: the agent quotes it, never
 * recomputes it (SPEC §10.2).
 */
export function renderBriefing(
  facts: BriefingFacts,
  limits: BriefingLimits = BRIEFING_LIMITS,
): string {
  const out: string[] = [];
  out.push(
    facts.since
      ? `Changements depuis la dernière visite de Léa (${formatDateTime(facts.since)}, heure de Paris).`
      : "Aucune visite enregistrée : tout est nouveau pour Léa.",
  );

  if (facts.page) {
    const entity = facts.page.entity_id
      ? ` · ${facts.page.entity_id}${facts.page.entity_label ? ` « ${facts.page.entity_label} »` : ""}`
      : "";
    out.push("", `Page courante : ${pageLabel(facts.page.page)}${entity}`);
  }

  out.push("", `### Top ${facts.top.length} du classement`);
  if (facts.top.length === 0) out.push("- classement vide (aucun run ou aucun insight classé)");
  for (const t of facts.top) {
    const final =
      t.moscow_final && t.moscow_final !== t.moscow_reco
        ? ` → décision de Léa : ${moscowLabel(t.moscow_final)}`
        : "";
    out.push(
      `${t.rank}. ${t.insight_id} « ${t.title} » · MoSCoW recommandé ${moscowLabel(t.moscow_reco)}${final}`,
    );
  }

  out.push("", "### Alertes ouvertes");
  if (facts.alerts.length === 0) out.push("- aucune");
  out.push(
    ...bounded(facts.alerts, limits.list, (a) => {
      const subject = a.insight_id ? `${a.insight_id} « ${a.insight_title ?? ""} »` : "compte";
      const dossier =
        a.dossier_status === "pret"
          ? "dossier prêt"
          : a.dossier_status === "echec"
            ? "dossier indisponible"
            : "dossier en cours";
      return `${a.id} · ${ALERT_KIND_LABELS[a.kind]} · ${subject} · retours ${idList(a.feedback_ids, 3)} · ${dossier}`;
    }),
  );

  out.push("", "### Décisions en attente", ...pendingLines(facts.pending, limits));

  out.push("", "### Nouveautés de la période");
  const fb = facts.feedbacks;
  out.push(
    `- ${fb.total} nouveau(x) retour(s)${fb.total ? ` (${channels(fb.by_channel)})` : ""}` +
      (fb.confirming_known.length
        ? `, dont ${fb.confirming_known.length} confirment un sujet connu`
        : ""),
  );
  if (facts.new_insights.length)
    out.push(
      `- nouveaux insights : ${facts.new_insights
        .slice(0, limits.list)
        .map((i) => `${i.insight_id} « ${i.title} »${i.ranked ? "" : " (signal faible)"}`)
        .join(
          " ; ",
        )}${facts.new_insights.length > limits.list ? ` … (+${facts.new_insights.length - limits.list})` : ""}`,
    );
  if (facts.emerging.length)
    out.push(
      ...bounded(
        facts.emerging,
        limits.list,
        (e) =>
          `émergent : ${e.insight_id} « ${e.title} » · ${e.recent} compte(s) récent(s), croissance × ${e.growth}`,
      ),
    );
  if (!facts.has_history) out.push("- mouvements de rang : pas d'historique sur la période");
  else if (facts.moves.length === 0) out.push("- aucun mouvement de rang");
  else
    out.push(
      ...bounded(
        facts.moves,
        limits.list,
        (m) =>
          `rang ${m.insight_id} : ${m.from ?? "hors classement"} → ${m.to ?? "hors classement"}`,
      ),
    );
  if (facts.decisions.length)
    out.push(
      `- décisions récentes : ${facts.decisions
        .slice(0, limits.list)
        .map((d) => `${d.id} (${d.action}${d.field ? ` ${d.field}` : ""} sur ${d.entity_id})`)
        .join(", ")}`,
    );

  if (facts.accounts_at_risk.length) {
    out.push("", "### Comptes à risque (renouvellement proche)");
    out.push(
      ...bounded(
        facts.accounts_at_risk,
        limits.list,
        (a) =>
          `${a.customer_id} ${a.name} · ${a.plan ? (PLAN_LABELS[a.plan as keyof typeof PLAN_LABELS] ?? a.plan) : "plan inconnu"} · renouvelle dans ${a.renewal_in_days} j · insights ${idList(a.insight_ids, 3)}`,
      ),
    );
  }
  return out.join("\n");
}
