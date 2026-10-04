import { z } from "zod";
import type { Tables } from "@/lib/db/types";
import { Constants } from "@/lib/db/types";
import { calendarDaysBetween } from "@/lib/format";
import { fetchAll } from "@/pipeline/insights";
import { LIST_LIMIT, signalTool, type AgentDeps } from "./shared";

const enums = Constants.public.Enums;

/** What the base does not hold: Signal says so instead of computing anything (CL-29). */
export const MISSING_DATA =
  "Signal ne connaît que l'état actuel des comptes (plan, MRR, renouvellement, santé) : aucun historique financier (churn passé, revenus mensuels, évolution du MRR).";

export const queryCustomersSchema = z.object({
  ids: z
    .array(z.string().regex(/^C-\d{3,}$/))
    .max(20)
    .optional(),
  name: z.string().trim().min(2).max(100).optional().describe("Partie du nom du compte."),
  status: z.enum(enums.customer_status).optional(),
  plan: z.enum(enums.customer_plan).optional(),
  segment: z.enum(enums.customer_segment).optional(),
  health: z.enum(enums.customer_health).optional(),
  renewal_within_days: z
    .number()
    .int()
    .min(0)
    .max(730)
    .optional()
    .describe("Renouvellement dans N jours au plus (à partir de la date du scénario)."),
  insight_id: z
    .string()
    .regex(/^I-\d{2,}$/)
    .optional()
    .describe("Comptes dont au moins un retour nourrit cet insight."),
  sort: z.enum(["mrr", "renouvellement", "nom"]).default("mrr"),
});

export type QueryCustomersInput = z.infer<typeof queryCustomersSchema>;

export type CustomerRow = Pick<
  Tables<"customers">,
  | "id"
  | "name"
  | "status"
  | "segment"
  | "plan"
  | "seats"
  | "mrr_eur"
  | "renewal_date"
  | "health"
  | "csm"
>;

/** Filters, sorts and totals the accounts in code (pure); totals cover every match, not only the 10 shown. */
export function selectCustomers(
  customers: readonly CustomerRow[],
  insightsOf: ReadonlyMap<string, string[]>,
  input: QueryCustomersInput,
  now: Date,
) {
  const days = (c: CustomerRow) =>
    c.renewal_date ? calendarDaysBetween(now, `${c.renewal_date}T12:00:00Z`) : null;
  const name = input.name?.toLocaleLowerCase("fr");
  const kept = customers.filter((c) => {
    const d = days(c);
    return (
      (!input.ids || input.ids.includes(c.id)) &&
      (!name || c.name.toLocaleLowerCase("fr").includes(name)) &&
      (!input.status || c.status === input.status) &&
      (!input.plan || c.plan === input.plan) &&
      (!input.segment || c.segment === input.segment) &&
      (!input.health || c.health === input.health) &&
      (input.renewal_within_days === undefined ||
        (d !== null && d >= 0 && d <= input.renewal_within_days)) &&
      (!input.insight_id || (insightsOf.get(c.id) ?? []).includes(input.insight_id))
    );
  });
  const sorted = kept.toSorted((a, b) => {
    if (input.sort === "nom") return a.name.localeCompare(b.name, "fr");
    if (input.sort === "renouvellement")
      return (days(a) ?? Infinity) - (days(b) ?? Infinity) || a.id.localeCompare(b.id);
    return Number(b.mrr_eur) - Number(a.mrr_eur) || a.id.localeCompare(b.id);
  });
  return {
    total: sorted.length,
    totaux: {
      comptes: sorted.length,
      clients: sorted.filter((c) => c.status === "client").length,
      mrr_eur: Math.round(sorted.reduce((s, c) => s + Number(c.mrr_eur), 0) * 100) / 100,
    },
    comptes: sorted.slice(0, LIST_LIMIT).map((c) => ({
      id: c.id,
      nom: c.name,
      statut: c.status,
      plan: c.plan,
      segment: c.segment,
      sieges: c.seats,
      mrr_eur: Number(c.mrr_eur),
      renouvellement: c.renewal_date,
      renouvelle_dans_jours: days(c),
      sante: c.health,
      csm: c.csm,
      insights: insightsOf.get(c.id) ?? [],
    })),
    donnees_disponibles: MISSING_DATA,
  };
}

export function queryCustomersTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "query_customers",
      summary:
        "Comptes clients et prospects : plan, MRR actuel, renouvellement, santé, CSM et insights qui les concernent ; totaux calculés sur toute la sélection.",
      when: "Questions sur des comptes : qui renouvelle bientôt, quel MRR, quels comptes Enterprise en santé rouge, qui est touché par un insight.",
      notWhen:
        "Historique financier (churn passé, revenus d'un mois, évolution du MRR) : la donnée n'existe pas, dis-le sans rien calculer. Retours d'un compte (→ search_feedbacks).",
      schema: queryCustomersSchema,
    },
    async (input) => {
      const { db } = deps;
      const [customers, links] = await Promise.all([
        fetchAll<CustomerRow>(
          (from, to) =>
            db
              .from("customers")
              .select("id, name, status, segment, plan, seats, mrr_eur, renewal_date, health, csm")
              .order("id")
              .range(from, to),
          "Lecture des comptes",
        ),
        fetchAll<{ customer_id: string | null; insight_ids: string[] | null }>(
          (from, to) =>
            db
              .from("feedback_inbox")
              .select("customer_id, insight_ids")
              .not("customer_id", "is", null)
              .order("id")
              .range(from, to),
          "Lecture des retours par compte",
        ),
      ]);
      const insightsOf = new Map<string, string[]>();
      for (const l of links) {
        if (!l.customer_id) continue;
        const set = new Set([...(insightsOf.get(l.customer_id) ?? []), ...(l.insight_ids ?? [])]);
        insightsOf.set(l.customer_id, [...set].sort());
      }
      return selectCustomers(customers, insightsOf, input, deps.now());
    },
  );
}
