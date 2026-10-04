import { z } from "zod";
import { DETAILED_LIMITS, renderBriefing } from "@/agent/briefing";
import { loadBriefingFacts } from "@/services/briefing";
import { excerpt, signalTool, type AgentDeps } from "./shared";

const DOSSIER_CHARS = 800;

export function getBriefingTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "get_briefing",
      summary:
        "Récapitulatif détaillé de l'état de Signal : nouveaux retours par canal, alertes et leurs dossiers, décisions en attente, décisions récentes, mouvements de rang, top 10.",
      when: "« Quoi de neuf ? », un récapitulatif, le début d'une session, ou quand le briefing injecté ne suffit pas (période différente, dossiers d'alerte).",
      notWhen: "Le détail d'un sujet (→ get_insight). Inutile si le briefing injecté répond déjà.",
      schema: z.object({
        since: z.iso
          .datetime({ offset: true })
          .optional()
          .describe("Début de la période (ISO 8601). Défaut : dernière visite de Léa."),
      }),
    },
    async ({ since }, ctx) => {
      const facts = await loadBriefingFacts(deps.db, {
        weighting: deps.pack.weighting,
        now: deps.now(),
        since,
        page: ctx?.page ?? null,
      });
      const dossiers = facts.alerts
        .slice(0, DETAILED_LIMITS.list)
        .filter((a) => a.dossier)
        .map((a) => `#### Dossier ${a.id}\n${excerpt(a.dossier, DOSSIER_CHARS)}`);
      return [renderBriefing(facts, DETAILED_LIMITS), ...dossiers].join("\n\n");
    },
  );
}
