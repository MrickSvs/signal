import { z } from "zod";
import { estimateInsight, estimateText, type StoredEstimate } from "@/services/estimate";
import { signalTool, type AgentDeps } from "./shared";

type TicketPoints = {
  id: string;
  title: string;
  estimated_points: number | null;
  actual_points: number | null;
};

/** The estimate as the agent quotes it: range, T-shirt, confidence, analogues with real points (pure). */
export function compactEstimate(
  stored: StoredEstimate,
  tickets: ReadonlyMap<string, TicketPoints>,
) {
  const e = stored.estimate;
  return {
    points: e.points_min === e.points_max ? `${e.points_min}` : `${e.points_min}–${e.points_max}`,
    tshirt: e.tshirt_min === e.tshirt_max ? e.tshirt_min : `${e.tshirt_min}–${e.tshirt_max}`,
    confiance: e.confidence,
    composants: e.components,
    analogues: e.analogies.slice(0, 3).map((a) => {
      const t = tickets.get(a.ticket_id);
      return {
        id: a.ticket_id,
        titre: t?.title ?? null,
        points_estimes: t?.estimated_points ?? null,
        points_reels: t?.actual_points ?? null,
        similarite: Math.round(a.similarity * 100) / 100,
        proche: a.close,
        raison: a.raison,
      };
    }),
    ...(e.adjustments?.noCloseAnalogue
      ? { alerte: "Aucun ticket analogue proche : fourchette élargie, confiance basse (CL-20)." }
      : {}),
    risques: e.risks,
    justification: e.rationale,
    depuis_le_cache: stored.cached,
    estimation_id: stored.id,
  };
}

export function estimateComplexityTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "estimate_complexity",
      summary:
        "Estime l'effort d'un insight ou d'un besoin par analogie avec les tickets livrés : fourchette de points, T-shirt, confiance, composants, 3 analogues (points estimés et réels), risques. Mis en cache par énoncé.",
      when: "« Combien ça coûte ? », l'effort d'un insight ou d'un besoin décrit par Léa.",
      notWhen:
        "Les points d'un élément du backlog (rédaction du backlog). Ne relance pas avec force sans demande explicite de Léa.",
      schema: z
        .object({
          insight_id: z
            .string()
            .regex(/^I-\d{2,}$/)
            .optional(),
          besoin: z.string().trim().min(10).max(1500).optional().describe("Besoin en texte libre."),
          force: z.boolean().default(false).describe("Ignorer le cache et réestimer."),
        })
        .refine((v) => Boolean(v.insight_id) !== Boolean(v.besoin), {
          message: "Donne soit insight_id, soit besoin (un seul des deux).",
        }),
      models: ["reasoning"],
    },
    async (input, ctx) => {
      const estimateDeps = { runCost: ctx?.runCost, ...deps.estimate };
      const stored = input.insight_id
        ? await estimateInsight(deps.db, input.insight_id, { force: input.force }, estimateDeps)
        : await estimateText(deps.db, input.besoin!, { force: input.force }, estimateDeps);
      const ids = stored.estimate.analogies.map((a) => a.ticket_id);
      const { data, error } = ids.length
        ? await deps.db
            .from("reference_tickets")
            .select("id, title, estimated_points, actual_points")
            .in("id", ids)
        : { data: [], error: null };
      if (error) throw new Error(error.message);
      return compactEstimate(stored, new Map((data ?? []).map((t) => [t.id, t])));
    },
  );
}
