import { z } from "zod";
import { pushBacklogItems, type PushResult } from "@/services/notion/push-backlog";
import { signalTool, type AgentDeps } from "./shared";

const ITEM_ID = /^(?:US|BUG|TT)-\d{3,}$/;

export const pushToNotionSchema = z.object({
  item_ids: z
    .array(
      z.string().trim().toUpperCase().regex(ITEM_ID, "ID d'élément attendu : US-, BUG- ou TT-"),
    )
    .min(1)
    .max(10)
    .describe("Éléments du backlog à envoyer (brouillons ou validés)"),
});

export function compactPush(results: readonly PushResult[]) {
  return results.map((r) =>
    r.ok
      ? {
          element: r.id,
          envoye: true,
          ...(r.already_sent ? { deja_envoye: true } : {}),
          ...(r.validated ? { valide_par_ce_clic: true } : {}),
          statut_notion: "Prêt",
        }
      : {
          element: r.id,
          envoye: false,
          erreur: r.error,
          ...(r.validated ? { statut: "valide (bouton « Réessayer » sur l'écran Backlog)" } : {}),
        },
  );
}

/**
 * push_to_notion (SPEC §10.5, §11.2): the only external write of the agent. The call pauses on an
 * approval card showing each page as Notion will receive it (human-in-the-loop middleware, SPEC
 * §10.6); Léa's click validates a draft and sends it. A failure is reported per item.
 */
export function pushToNotionTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "push_to_notion",
      summary:
        "Envoie des éléments du backlog (story, bug, tâche) dans le kanban Notion de l'équipe, colonne « Prêt ». L'appel affiche une carte d'approbation avec le rendu de chaque page : rien n'est envoyé avant que Léa valide ; son clic valide aussi un brouillon. Un élément déjà envoyé n'est jamais recréé. Résultat par élément, avec l'erreur s'il n'a pas pu partir.",
      when: "Léa demande d'envoyer, de pousser ou de valider-et-envoyer des éléments du backlog (« envoie US-004 dans Notion », « c'est bon, pousse les stories des permissions »).",
      notWhen:
        "Valider sans envoyer (→ apply_decision, kind validation) ; modifier un élément (→ update_backlog_item, avant l'envoi seulement) ; un élément rejeté ; de ta propre initiative sans demande de Léa.",
      schema: pushToNotionSchema,
      models: [],
    },
    async (input) =>
      compactPush(
        await pushBacklogItems(deps.db, input.item_ids, {
          now: deps.now(),
          source: "chat",
          withLock: deps.withLock,
          ...deps.notion,
        }),
      ),
  );
}
