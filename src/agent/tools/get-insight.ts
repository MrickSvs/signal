import { z } from "zod";
import { parisDay } from "@/lib/format";
import { getInsightDetail, type InsightDetail } from "@/server/queries/insights";
import {
  excerpt,
  LIST_LIMIT,
  signalTool,
  unknownId,
  VERBATIM_LIMIT,
  type AgentDeps,
} from "./shared";

const KEY_ACCOUNTS = 5;
const VERBATIM_CHARS = 400;
const EXPRESSED_LIMIT = 8;

export type BacklogSummary = {
  epics: { id: string; title: string }[];
  items: { id: string; kind: string; status: string }[];
};

/**
 * The insight as the agent sees it: problem, expressed requests, segments, 5 key accounts,
 * 5 verbatims, tensions, decomposed score and a backlog summary. Pure: everything is already
 * counted by the pipeline and the queries; nothing is recomputed here.
 */
export function compactInsight(
  detail: InsightDetail,
  texts: ReadonlyMap<string, string>,
  backlog: BacklogSummary,
) {
  const verbatims = [
    ...detail.representative,
    ...detail.feedbacks.filter((f) => !detail.representative.some((r) => r.id === f.id)),
  ].slice(0, VERBATIM_LIMIT);
  const score = detail.score;
  const final = score?.overrides.find((o) => o.param === "moscow")?.value ?? null;
  const byStatus: Record<string, number> = {};
  for (const item of backlog.items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;

  return {
    id: detail.id,
    titre: detail.title,
    statut: detail.status,
    origine: detail.origin,
    ...(detail.merged_into ? { fusionne_dans: detail.merged_into } : {}),
    domaine: detail.product_area,
    probleme: detail.problem_statement,
    demandes_exprimees: detail.expressed.slice(0, EXPRESSED_LIMIT).map((e) => ({
      demande: e.solution,
      frequence: e.frequency,
    })),
    comptages: {
      retours: detail.feedbacks.length,
      comptes: detail.accounts_count,
      retours_sans_compte: detail.unidentified,
      mrr_expose_eur: Number(detail.mrr_exposed),
      renouvellements_90j: detail.renewals_90d,
      canaux: Object.fromEntries(detail.channelCounts),
      plans: detail.breakdown.plans,
      segments: detail.breakdown.segments,
    },
    tendance: {
      comptes_par_semaine: detail.trendData.weekly ?? [],
      croissance: detail.trendData.growth ?? null,
      emergent: detail.trendData.is_emerging ?? false,
    },
    premier_retour: detail.feedbacks.at(-1)?.received_at
      ? parisDay(detail.feedbacks.at(-1)!.received_at)
      : null,
    comptes_cles: detail.accounts.slice(0, KEY_ACCOUNTS).map((a) => ({
      id: a.id,
      nom: a.name,
      statut: a.status,
      plan: a.plan,
      mrr_eur: Number(a.mrr_eur),
      renouvellement: a.renewal_date,
      sante: a.health,
      retours: a.feedback_ids.slice(0, LIST_LIMIT),
    })),
    verbatims: verbatims.map((f) => ({
      id: f.id,
      date: parisDay(f.received_at),
      canal: f.channel,
      compte: f.customer
        ? `${f.customer.id} ${f.customer.name}`
        : f.is_prospect
          ? "prospect"
          : null,
      texte: excerpt(texts.get(f.id) ?? f.summary, VERBATIM_CHARS),
    })),
    tensions: detail.tensions.map((t) => ({
      avec: t.other.id,
      titre: t.other.title,
      raison: t.rationale,
      segments: t.segments,
    })),
    absorbes: detail.absorbed.map((a) => a.id),
    score: score
      ? {
          mode_reach: score.reach_mode,
          rang: score.rank,
          rice: Number(score.rice),
          reach: Number(score.reach),
          impact: Number(score.impact),
          impact_justification: score.impact_rationale,
          confidence: Number(score.confidence),
          effort_semaines: Number(score.effort_weeks),
          effort_source: score.effort_source,
          robustesse: score.robustness,
          alignement: score.alignment,
          okr: score.okr_refs,
          moscow_reco: score.moscow_reco,
          moscow_justification: score.moscow_rationale,
          moscow_final: final,
          regles: score.rule_flags,
          overrides: score.overrides.map((o) => ({
            parametre: o.param,
            valeur: o.value,
            raison: o.reason,
            contexte_modifie: o.context_changed,
          })),
        }
      : null,
    backlog: {
      epics: backlog.epics.map((e) => e.id),
      elements: backlog.items.length,
      par_statut: byStatus,
      ids: backlog.items.slice(0, LIST_LIMIT).map((i) => i.id),
    },
  };
}

export function getInsightTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "get_insight",
      summary:
        "Détail d'un insight : problème, demandes exprimées et fréquences, segments, 5 comptes clés, 5 verbatims, tensions, score décomposé, résumé du backlog.",
      when: "Comprendre un sujet : « pourquoi », « qui », « depuis quand », « pourquoi est-il classé ici ».",
      notWhen: "Une liste de sujets (→ list_insights) ; le classement complet (→ get_priority).",
      schema: z.object({ id: z.string().regex(/^I-\d{2,}$/, "ID d'insight attendu (I-07)") }),
    },
    async ({ id }) => {
      const { db } = deps;
      const detail = await getInsightDetail(db, id, {
        weighting: deps.pack.weighting,
        now: deps.now(),
      });
      if (!detail) throw await unknownId(db, "insights", id);
      const verbatimIds = [
        ...detail.representative,
        ...detail.feedbacks.filter((f) => !detail.representative.some((r) => r.id === f.id)),
      ]
        .slice(0, VERBATIM_LIMIT)
        .map((f) => f.id);
      const [texts, epics, items] = await Promise.all([
        verbatimIds.length
          ? db.from("feedbacks").select("id, raw_text").in("id", verbatimIds)
          : Promise.resolve({ data: [], error: null }),
        db.from("epics").select("id, title").eq("insight_id", id).order("id"),
        db.from("backlog_items").select("id, kind, status").eq("insight_id", id).order("id"),
      ]);
      for (const r of [texts, epics, items]) if (r.error) throw new Error(r.error.message);
      return compactInsight(detail, new Map((texts.data ?? []).map((t) => [t.id, t.raw_text])), {
        epics: epics.data ?? [],
        items: items.data ?? [],
      });
    },
  );
}
