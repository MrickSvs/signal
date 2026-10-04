import { z } from "zod";
import { Constants } from "@/lib/db/types";
import { sortInsights, type InsightCard } from "@/lib/insights/list";
import { getInsightsScreen } from "@/server/queries/insights";
import { LIST_LIMIT, signalTool, type AgentDeps } from "./shared";

const enums = Constants.public.Enums;
const LIVE = new Set(["propose", "actif"]);

export const listInsightsSchema = z.object({
  product_area: z.enum(enums.product_area).optional(),
  segment: z
    .enum(enums.customer_segment)
    .optional()
    .describe("Insights qui touchent au moins un compte de ce segment."),
  plan: z
    .enum(enums.customer_plan)
    .optional()
    .describe("Insights qui touchent au moins un compte de ce plan."),
  status: z
    .enum(["vivants", ...enums.insight_status])
    .default("vivants")
    .describe("vivants = proposés et actifs (défaut)."),
  emerging: z.boolean().optional().describe("true : seulement les tendances émergentes."),
  ranked: z.boolean().optional().describe("true : classés ; false : signaux faibles."),
  sort: z.enum(["rang", "mrr", "volume", "tendance"]).default("rang"),
});

export type ListInsightsInput = z.infer<typeof listInsightsSchema>;

/** Filters and sorts the cards in code; the counts come from the pipeline (pure). */
export function selectInsights(cards: readonly InsightCard[], input: ListInsightsInput) {
  const kept = cards.filter(
    (c) =>
      (input.status === "vivants" ? LIVE.has(c.status) : c.status === input.status) &&
      (!input.product_area || c.product_area === input.product_area) &&
      (!input.segment || (c.segments[input.segment] ?? 0) > 0) &&
      (!input.plan || (c.plans[input.plan] ?? 0) > 0) &&
      (input.emerging === undefined || c.is_emerging === input.emerging) &&
      (input.ranked === undefined || c.ranked === input.ranked),
  );
  const sorted = sortInsights(kept, input.sort);
  return {
    total: sorted.length,
    insights: sorted.slice(0, LIST_LIMIT).map((c) => ({
      id: c.id,
      titre: c.title,
      statut: c.status,
      origine: c.origin,
      classe: c.ranked,
      rang: c.rank,
      retours: c.feedbacks_count,
      comptes: c.accounts_count,
      mrr_expose_eur: c.mrr_exposed,
      renouvellements_90j: c.renewals_90d,
      tendance: { croissance: c.growth, emergent: c.is_emerging, nouveau: c.is_new },
      moscow: c.moscow,
      moscow_du_po: c.moscow_is_final,
      ...(c.merged_into ? { fusionne_dans: c.merged_into } : {}),
    })),
  };
}

export function listInsightsTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "list_insights",
      summary:
        "Liste les insights (sujets regroupés par problème) avec leurs comptages : retours, comptes, MRR exposé, tendance, rang, MoSCoW. 10 au plus, avec le total.",
      when: "Parcourir les sujets : par domaine, segment, plan, statut, tendance émergente ; « qu'est-ce qui remonte chez… ».",
      notWhen:
        "Le classement avec scores, robustesse ou capacité (→ get_priority) ; le détail d'un sujet (→ get_insight).",
      schema: listInsightsSchema,
    },
    async (input) => selectInsights((await getInsightsScreen(deps.db)).cards, input),
  );
}
