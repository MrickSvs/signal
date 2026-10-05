import { z } from "zod";
import {
  backlogPatchSchema,
  changeBacklogItemKind,
  patchBacklogItem,
  type UpdateResult,
} from "@/services/backlog";
import { backlogDeps } from "./backlog-deps";
import { signalTool, type AgentDeps } from "./shared";

export function compactUpdate(result: UpdateResult) {
  if (result.needs_confirmation) {
    return {
      confirmation_requise: true,
      element: result.id,
      changement: `${result.from} → ${result.to}`,
      consigne: "Demande à Léa de confirmer ; relance avec confirm: true seulement après son oui.",
    };
  }
  return {
    element: result.id,
    ...(result.previous_id ? { ancien_id: result.previous_id } : {}),
    type: result.kind,
    titre: result.title,
    modifie: result.changed,
    decision: result.decision,
    ...(result.effort?.decision
      ? { effort_semaines: { avant: result.effort.before, apres: result.effort.after } }
      : {}),
    statut: "brouillon",
  };
}

export function updateBacklogItemTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "update_backlog_item",
      summary:
        "Modifie un brouillon du backlog (champs de son type, points Fibonacci, preuves de l'insight) ou change son type (story, bug, tâche) : l'élément est alors régénéré au bon format avec un nouvel ID. Chaque modification est journalisée comme décision de Léa.",
      when: "Léa demande de corriger un brouillon (« renomme US-004 », « passe-le à 5 points ») ou dit qu'un élément est du mauvais type (« c'est un bug, pas une story »).",
      notWhen:
        "Élément déjà envoyé dans Notion (à modifier dans Notion) ; rédiger tout le backlog d'un insight (→ draft_backlog_items) ; changer de type sans le oui explicite de Léa.",
      schema: z
        .object({
          id: z.string().regex(/^(?:US|BUG|TT)-\d{3,}$/, "ID attendu : US-001, BUG-001 ou TT-001"),
          patch: backlogPatchSchema
            .optional()
            .describe("Champs à modifier, au format du type de l'élément."),
          kind: z.enum(["story", "bug", "tache"]).optional().describe("Nouveau type."),
          consignes: z.string().trim().max(500).optional(),
          reason: z.string().trim().max(300).optional().describe("Raison donnée par Léa."),
          confirm: z
            .boolean()
            .default(false)
            .describe("Changement de type : true seulement après le oui explicite de Léa."),
        })
        .refine((v) => Boolean(v.patch) !== Boolean(v.kind), {
          message: "Donne soit patch, soit kind (un seul des deux).",
        }),
      models: ["agent"],
    },
    async (input, ctx, progress) => {
      const d = backlogDeps(deps, ctx, progress);
      const result = input.kind
        ? await changeBacklogItemKind(
            deps.db,
            input.id,
            {
              kind: input.kind,
              confirm: input.confirm,
              consignes: input.consignes,
              reason: input.reason,
            },
            d,
          )
        : await patchBacklogItem(deps.db, input.id, input.patch, d, input.reason);
      return compactUpdate(result);
    },
  );
}
