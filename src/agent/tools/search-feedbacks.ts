import { z } from "zod";
import { Constants } from "@/lib/db/types";
import type { Db } from "@/lib/db/create";
import { embed } from "@/lib/embeddings";
import { NO_ACCOUNT, PERIODS, periodStart, type Period } from "@/lib/feedbacks/filters";
import { parisDay } from "@/lib/format";
import { excerpt, LIST_LIMIT, signalTool, ToolError, type AgentDeps } from "./shared";

const enums = Constants.public.Enums;

/** Below this cosine similarity, a feedback is not « about » the query (items embed problems). */
export const SEARCH_MIN_SIMILARITY = 0.35;
const SEARCH_CANDIDATES = 50;
const MAX_IDS = 20;
const FULL_TEXT_CHARS = 3000;

export const searchFeedbacksSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(300)
    .optional()
    .describe("Recherche par le sens (le problème décrit, pas les mots exacts)."),
  ids: z
    .array(z.string().regex(/^R-\d{3,}$/, "ID de retour attendu (R-042)"))
    .min(1)
    .max(MAX_IDS)
    .optional()
    .describe("Relire des retours précis : rend leur texte complet."),
  customer_id: z
    .string()
    .regex(/^C-\d{3,}$/)
    .optional(),
  channel: z.enum(enums.feedback_channel).optional(),
  plan: z.enum([...enums.customer_plan, NO_ACCOUNT]).optional(),
  segment: z.enum(enums.customer_segment).optional(),
  type: z.enum(enums.item_type).optional(),
  product_area: z.enum(enums.product_area).optional(),
  period: z
    .enum(Object.keys(PERIODS) as [Period, ...Period[]])
    .optional()
    .describe("7j ou 30j avant la date du scénario."),
  insight_id: z
    .string()
    .regex(/^I-\d{2,}$/)
    .optional(),
});

export type SearchFeedbacksInput = z.infer<typeof searchFeedbacksSchema>;

const INBOX_COLUMNS =
  "id, received_at, channel, customer_id, customer_name, customer_plan, summary, insight_ids, injection_suspected";

type InboxRow = {
  id: string | null;
  received_at: string | null;
  channel: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_plan: string | null;
  summary: string | null;
  insight_ids: string[] | null;
  injection_suspected: boolean | null;
};

export type FoundFeedback = {
  id: string;
  date: string | null;
  canal: string | null;
  compte: string | null;
  plan: string | null;
  resume: string | null;
  insights: string[];
  similarite?: number;
  injection_suspectee?: true;
  texte?: string | null;
};

export function toFound(row: InboxRow, extra: Partial<FoundFeedback> = {}): FoundFeedback {
  return {
    id: row.id!,
    date: row.received_at ? parisDay(row.received_at) : null,
    canal: row.channel,
    compte: row.customer_id ? `${row.customer_id} ${row.customer_name ?? ""}`.trim() : null,
    plan: row.customer_plan,
    resume: row.summary,
    insights: row.insight_ids ?? [],
    ...(row.injection_suspected ? { injection_suspectee: true as const } : {}),
    ...extra,
  };
}

/** Filters of the input, applied to the feedback_inbox view (same view as the Retours screen). */
function filtered(db: Db, input: SearchFeedbacksInput, now: Date, count = false) {
  let q = db.from("feedback_inbox").select(INBOX_COLUMNS, count ? { count: "exact" } : undefined);
  if (input.customer_id) q = q.eq("customer_id", input.customer_id);
  if (input.channel) q = q.eq("channel", input.channel);
  if (input.plan === NO_ACCOUNT) q = q.is("customer_id", null);
  else if (input.plan) q = q.eq("customer_plan", input.plan);
  if (input.segment) q = q.eq("customer_segment", input.segment);
  if (input.type) q = q.contains("item_types", [input.type]);
  if (input.product_area) q = q.contains("product_areas", [input.product_area]);
  if (input.insight_id) q = q.contains("insight_ids", [input.insight_id]);
  const start = periodStart(input.period, now);
  if (start) q = q.gte("received_at", start.toISOString());
  return q;
}

export function searchFeedbacksTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "search_feedbacks",
      summary:
        "Retrouve des retours clients par le sens (query) ou par des filtres, ou relit des retours dont on a les ID (texte complet seulement avec ids). Rend au plus 10 retours et le nombre total trouvé.",
      when: "Retrouver des retours sur un problème, ceux d'un compte, d'un canal ou d'une période ; relire le texte de retours cités.",
      notWhen:
        "Compter ou agréger des retours par sujet (→ get_insight, list_insights) ; une question sur des comptes (→ query_customers).",
      schema: searchFeedbacksSchema,
      models: [],
    },
    async (input, ctx) => {
      const { db } = deps;
      const now = deps.now();

      if (input.ids) {
        const [rows, texts] = await Promise.all([
          db.from("feedback_inbox").select(INBOX_COLUMNS).in("id", input.ids),
          db.from("feedbacks").select("id, raw_text, truncated").in("id", input.ids),
        ]);
        if (rows.error) throw new Error(rows.error.message);
        if (texts.error) throw new Error(texts.error.message);
        const textOf = new Map((texts.data ?? []).map((t) => [t.id, t.raw_text]));
        const found = (rows.data as InboxRow[]).map((r) =>
          toFound(r, { texte: excerpt(textOf.get(r.id!), FULL_TEXT_CHARS) }),
        );
        const missing = input.ids.filter((id) => !found.some((f) => f.id === id));
        if (found.length === 0)
          throw new ToolError(`Aucun de ces retours n'existe : ${missing.join(", ")}.`);
        return { mode: "ids", introuvables: missing, retours: found };
      }

      if (input.query) {
        const vector = deps.embedQuery
          ? await deps.embedQuery(input.query)
          : (await embed([input.query], "query", { runCost: ctx?.runCost }))[0];
        const { data: matches, error } = await db.rpc("match_feedback_items", {
          query_embedding: JSON.stringify(vector),
          match_count: SEARCH_CANDIDATES,
          min_similarity: SEARCH_MIN_SIMILARITY,
        });
        if (error) throw new Error(error.message);
        const similarity = new Map((matches ?? []).map((m) => [m.feedback_id, m.similarity]));
        if (similarity.size === 0)
          return {
            mode: "semantique",
            total: 0,
            retours: [],
            note: "Aucun retour proche de cette recherche.",
          };
        const { data, error: inboxError } = await filtered(db, input, now).in("id", [
          ...similarity.keys(),
        ]);
        if (inboxError) throw new Error(inboxError.message);
        const rows = (data as InboxRow[]).toSorted(
          (a, b) => similarity.get(b.id!)! - similarity.get(a.id!)!,
        );
        return {
          mode: "semantique",
          total: rows.length,
          plafond: SEARCH_CANDIDATES,
          retours: rows
            .slice(0, LIST_LIMIT)
            .map((r) => toFound(r, { similarite: Math.round(similarity.get(r.id!)! * 100) / 100 })),
        };
      }

      const { data, error, count } = await filtered(db, input, now, true)
        .order("received_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw new Error(error.message);
      return {
        mode: "filtres",
        total: count ?? data.length,
        retours: (data as InboxRow[]).map((r) => toFound(r)),
      };
    },
  );
}
