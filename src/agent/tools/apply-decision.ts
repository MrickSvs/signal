import { applyDecisionSchema, checkDecision } from "@/lib/decisions/apply-decision";
import { applyDecision, type ApplyDecisionResult } from "@/services/apply-decision";
import { signalTool, ToolError, type AgentDeps } from "./shared";

export function compactDecision(result: ApplyDecisionResult) {
  return {
    applique: result.summary,
    cible: result.target,
    decisions: result.decisions,
    ...(result.disagreement ? { desaccord: result.disagreement } : {}),
    ...(result.rescored.length ? { reclasses: result.rescored.slice(0, 10) } : {}),
  };
}

/**
 * apply_decision (SPEC §10.5): the only writing path of a PO decision from the chat. The call
 * pauses on an approval card (human-in-the-loop middleware, SPEC §10.6) and runs only once Léa
 * validates it, possibly with her edits.
 */
export function applyDecisionTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "apply_decision",
      summary:
        "Enregistre une décision de Léa : override (Reach, Impact, Confidence, Effort), MoSCoW final, validation ou rejet d'un brouillon du backlog, revue d'un insight proposé (accepter, reformuler, fusionner, rejeter). L'appel affiche une carte d'approbation : rien n'est écrit avant que Léa valide ; elle peut modifier ou refuser. Journalisé dans les décisions.",
      when: "Léa exprime une décision dans le chat (« passe le Gantt en Must », « mets l'Impact de I-07 à 2, parce que… », « valide US-004 ») ; un insight proposé naît pendant la conversation (proposer de l'accepter) ; Léa confirme une décision que tu as challengée (avec signal_position).",
      notWhen:
        "Simulation ou « et si » (→ get_priority avec what_if) ; décision contraire aux preuves pas encore challengée (charge la skill challenge, objecte une fois, attends sa confirmation) ; modifier le contenu d'un brouillon (→ update_backlog_item). Une décision par appel.",
      schema: applyDecisionSchema,
      models: [],
    },
    async (input) => {
      // Same check as the approval card's predicate: an invalid proposal never reaches Léa and
      // is never written (CL-23).
      const checked = checkDecision(input, deps.pack.weighting);
      if (!checked.ok)
        throw new ToolError(`${checked.error}. Corrige la proposition ou demande à Léa.`);
      const result = await applyDecision(deps.db, input, {
        pack: deps.pack,
        skills: { riceScoring: deps.skills.riceScoring, moscow: deps.skills.moscow },
        now: deps.now(),
        source: "chat",
        withLock: deps.withLock,
      });
      return compactDecision(result);
    },
  );
}
