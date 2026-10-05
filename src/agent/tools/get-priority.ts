import { z } from "zod";
import type { StoredRanking } from "@/pipeline/nodes/score";
import { currentReachMode } from "@/pipeline/incremental";
import { getRanking, simulateRanking, whatIfSchema } from "@/services/prioritization";
import { signalTool, type AgentDeps } from "./shared";

const MAX_TOP = 20;

export const getPrioritySchema = z.object({
  mode: z
    .enum(["comptes", "mrr"])
    .optional()
    .describe("Mode de Reach. Défaut : celui du dernier run du pipeline."),
  top: z.number().int().min(1).max(MAX_TOP).default(10),
  what_if: whatIfSchema
    .optional()
    .describe(
      "Simulation « et si » : valeurs hypothétiques par insight (Impact sur l'échelle, Confidence en %, Reach dans l'unité du mode, Effort en semaines-personne, MoSCoW). Rien n'est enregistré.",
    ),
});

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Compact ranking, capacity of the Musts and pending insights (pure). */
export function compactRanking(ranking: StoredRanking, top: number) {
  const titleOf = new Map(ranking.insights.map((i) => [i.id, i.title]));
  const scores = ranking.scores.toSorted((a, b) => a.rank - b.rank);
  return {
    classes: scores.length,
    classement: scores.slice(0, top).map((s) => ({
      rang: s.rank,
      id: s.insight_id,
      titre: titleOf.get(s.insight_id) ?? "",
      rice: round(s.rice),
      reach: round(s.reach),
      impact: s.impact,
      confidence: s.confidence,
      effort_semaines: round(s.effort_weeks),
      robustesse: s.robustness,
      alignement: s.alignment,
      moscow_reco: s.moscow_reco,
      moscow_final: s.moscow_final,
      ...(Object.keys(s.overridden).length ? { overrides: Object.keys(s.overridden) } : {}),
    })),
    capacite: {
      capacite_semaines: ranking.capacity.capacity_weeks,
      must_semaines: ranking.capacity.must_weeks,
      part: ranking.capacity.share,
      alerte: ranking.capacity.alert,
      a_retrograder: ranking.capacity.downgrade,
    },
    en_attente: ranking.pending,
  };
}

export function getPriorityTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "get_priority",
      summary:
        "Classement RICE recalculé en code (scores, robustesse, alignement, MoSCoW recommandé et final) et capacité des Must. Avec what_if : simulation, mouvements de rang, rien n'est enregistré.",
      when: "Le classement, la robustesse d'un rang, la capacité des Must ; « et si l'Impact de I-07 passait à 3 ? ».",
      notWhen:
        "Enregistrer un changement : c'est une décision du PO (→ apply_decision). Liste de sujets sans score (→ list_insights).",
      schema: getPrioritySchema,
    },
    async (input) => {
      const { db, pack } = deps;
      const mode = input.mode ?? (await currentReachMode(db, pack.weighting.reach.default_mode));
      const scoringDeps = {
        pack,
        skills: { riceScoring: deps.skills.riceScoring, moscow: deps.skills.moscow },
        now: deps.now(),
      };
      if (!input.what_if) {
        const ranking = await getRanking(db, mode, scoringDeps);
        return { mode, simulation: false, ...compactRanking(ranking, input.top) };
      }
      const { simulated, moves } = await simulateRanking(db, mode, input.what_if, scoringDeps);
      return {
        mode,
        simulation: true,
        note: "Simulation : rien n'a été enregistré. Appliquer ces valeurs est une décision de Léa.",
        hypotheses: input.what_if,
        mouvements: moves.map((m) => ({ id: m.insight_id, de: m.from, a: m.to })),
        ...compactRanking(simulated, input.top),
      };
    },
  );
}
