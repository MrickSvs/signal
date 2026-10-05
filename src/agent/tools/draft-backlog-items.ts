import { z } from "zod";
import { FORMAT_LABELS } from "@/lib/backlog/choose-format";
import { draftBacklog, type DraftResult } from "@/services/backlog";
import { backlogDeps } from "./backlog-deps";
import { signalTool, type AgentDeps } from "./shared";

/** The drafting as the agent reports it: format and reason, epic, items, total against the range (pure). */
export function compactDraft(result: DraftResult) {
  if (result.needs_confirmation) {
    return {
      confirmation_requise: true,
      insight: result.insight_id,
      brouillons_remplaces: result.drafts.map((d) => `${d.id} ${d.title}`),
      conserves: result.kept.map((k) => `${k.id} (${k.status}) ${k.title}`),
      consigne:
        "Demande à Léa si elle confirme le remplacement des brouillons ; relance avec confirm: true seulement après son oui.",
    };
  }
  const { plan } = result;
  return {
    insight: result.insight_id,
    format: {
      propose_par_le_code: `${plan.proposed} (${plan.proposed_reason})`,
      retenu: FORMAT_LABELS[plan.chosen],
      ...(plan.deviation_reason ? { ecart: plan.deviation_reason } : {}),
    },
    ...(plan.discoverability
      ? {
          rien_dans_le_backlog: true,
          action_de_decouvrabilite: plan.discoverability,
        }
      : {}),
    epic: result.epic
      ? `${result.epic.id} ${result.epic.title}${result.epic.kept ? " (conservée)" : ""}`
      : null,
    elements: result.items.map((i) => ({
      id: i.id,
      type: i.kind,
      titre: i.title,
      points: i.points,
      composants: i.components,
      preuves: i.evidence,
    })),
    total_points: plan.sum,
    fourchette_insight: `${plan.range.min}–${plan.range.max} points, confiance ${plan.confidence}`,
    ...(plan.sum_outside_range
      ? { hors_fourchette: plan.range_note ?? "somme hors de la fourchette" }
      : {}),
    ...(plan.no_close_analogue
      ? { alerte: "Aucun ticket analogue proche : fourchette élargie, confiance basse (CL-20)." }
      : {}),
    tickets_analogues: result.analogues.map((a) => a.ticket_id),
    effort_semaines: { avant: result.effort.before, apres: result.effort.after },
    ...(result.effort.decision ? { decision_ajustement: result.effort.decision } : {}),
    remplaces: result.replaced,
    conserves: result.kept,
    statut: "brouillon : rien n'est envoyé ; badge qualité calculé en arrière-plan",
    ecran: `/backlog?insight=${result.insight_id}`,
  };
}

export function draftBacklogItemsTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "draft_backlog_items",
      summary:
        "Rédige le backlog d'un insight au bon format (epic et stories, story seule, bugs, tâche technique, ou action de découvrabilité), estime chaque élément par analogie en une passe et enregistre des brouillons. Rend le format et sa raison, l'epic, les éléments {ID, type, titre, points}, le total face à la fourchette et l'effort affiné.",
      when: "Léa veut transformer un insight en backlog : « prépare les stories », « rédige le bug », « fais le backlog de I-07 ».",
      notWhen:
        "Lire le backlog existant (→ list_backlog) ; modifier un élément (→ update_backlog_item) ; remplacer des brouillons sans le oui explicite de Léa (l'outil le demande : needs confirmation).",
      schema: z.object({
        insight_id: z.string().regex(/^I-\d{2,}$/),
        consignes: z
          .string()
          .trim()
          .max(800)
          .optional()
          .describe("Consignes de Léa pour la rédaction (découpage, périmètre…)."),
        confirm: z
          .boolean()
          .default(false)
          .describe("true seulement après que Léa a confirmé le remplacement des brouillons."),
      }),
      models: ["agent", "reasoning"],
    },
    async (input, ctx, progress) =>
      compactDraft(
        await draftBacklog(
          deps.db,
          input.insight_id,
          { consignes: input.consignes, confirm: input.confirm },
          backlogDeps(deps, ctx, progress),
        ),
      ),
  );
}
