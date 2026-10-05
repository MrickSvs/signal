import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";
import {
  INBOX_PAGE_SIZE,
  NO_ACCOUNT,
  containsPattern,
  periodStart,
  type FeedbackFilters,
} from "@/lib/feedbacks/filters";

// Reads of the « Retours » screen (SPEC §12.3).

export type InboxRow = Omit<Tables<"feedback_inbox">, "search_text" | "customer_id"> & {
  id: string;
};

/** One page of the feedbacks matching the filters, newest first, with the total count. */
export async function listFeedbackInbox(
  db: Db,
  filters: FeedbackFilters,
  now: Date,
): Promise<{ rows: InboxRow[]; total: number }> {
  let query = db
    .from("feedback_inbox")
    .select(
      "id, channel, received_at, subject, truncated, language, customer_name, customer_status, customer_plan, customer_segment, analysis_status, churn_signal, injection_suspected, item_types, product_areas, existing_feature, summary, insight_ids",
      { count: "exact" },
    );
  if (filters.canal) query = query.eq("channel", filters.canal);
  if (filters.plan === NO_ACCOUNT) query = query.is("customer_id", null);
  else if (filters.plan) query = query.eq("customer_plan", filters.plan);
  if (filters.segment) query = query.eq("customer_segment", filters.segment);
  if (filters.type) query = query.contains("item_types", [filters.type]);
  if (filters.domaine) query = query.contains("product_areas", [filters.domaine]);
  if (filters.insight) query = query.contains("insight_ids", [filters.insight]);
  const start = periodStart(filters.periode, now);
  if (start) query = query.gte("received_at", start.toISOString());
  if (filters.injection) query = query.eq("injection_suspected", true);
  if (filters.existante) query = query.eq("existing_feature", true);
  if (filters.echec) query = query.eq("analysis_status", "failed");
  if (filters.q) query = query.ilike("search_text", containsPattern(filters.q));

  const from = (filters.page - 1) * INBOX_PAGE_SIZE;
  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + INBOX_PAGE_SIZE - 1);
  // PostgREST answers 416 past the last page: an empty page, not an error.
  if (error && error.code !== "PGRST103") throw new Error(`Lecture des retours (${error.message})`);
  return {
    rows: (data ?? []).filter((r): r is InboxRow => r.id !== null),
    total: count ?? 0,
  };
}

export type InsightOption = Pick<Tables<"insights">, "id" | "title" | "status">;
export type CustomerOption = Pick<Tables<"customers">, "id" | "name" | "plan" | "status">;

/** Choices of the insight filter (open insights) and of the account picker of the modal. */
export async function listInboxOptions(
  db: Db,
): Promise<{ insights: InsightOption[]; customers: CustomerOption[] }> {
  const [insights, customers] = await Promise.all([
    db.from("insights").select("id, title, status").in("status", ["propose", "actif"]).order("id"),
    db.from("customers").select("id, name, plan, status").order("name"),
  ]);
  if (insights.error) throw new Error(`Lecture des insights (${insights.error.message})`);
  if (customers.error) throw new Error(`Lecture des comptes (${customers.error.message})`);
  return { insights: insights.data, customers: customers.data };
}

export type FeedbackDetail = Tables<"feedbacks"> & {
  customer: Pick<
    Tables<"customers">,
    "id" | "name" | "status" | "plan" | "segment" | "mrr_eur" | "renewal_date" | "health"
  > | null;
  analysis: Pick<
    Tables<"feedback_analyses">,
    | "status"
    | "error"
    | "model"
    | "sentiment"
    | "urgency"
    | "churn_signal"
    | "injection_suspected"
    | "confidence"
    | "created_at"
  > | null;
  items: (Omit<Tables<"feedback_items">, "embedding" | "created_at"> & {
    insights: {
      id: string;
      title: string;
      status: Tables<"insights">["status"];
      similarity: number | null;
      is_representative: boolean;
    }[];
  })[];
};

/** Everything the detail panel shows about one feedback; null when the id is unknown. */
export async function getFeedbackDetail(db: Db, id: string): Promise<FeedbackDetail | null> {
  const [feedback, analysis, items, links] = await Promise.all([
    db
      .from("feedbacks")
      .select("*, customers(id, name, status, plan, segment, mrr_eur, renewal_date, health)")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("feedback_analyses")
      .select(
        "status, error, model, sentiment, urgency, churn_signal, injection_suspected, confidence, created_at",
      )
      .eq("feedback_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("feedback_items")
      .select(
        "id, feedback_id, item_index, type, product_area, tags, expressed_request, underlying_problem, summary, existing_feature, watch",
      )
      .eq("feedback_id", id)
      .order("item_index"),
    db
      .from("insight_items")
      .select("item_id, similarity, is_representative, insights(id, title, status)")
      .eq("feedback_id", id),
  ]);
  for (const [what, result] of [
    ["retour", feedback],
    ["analyse", analysis],
    ["items", items],
    ["insights", links],
  ] as const) {
    if (result.error)
      throw new Error(`Lecture du retour ${id} : ${what} (${result.error.message})`);
  }
  if (!feedback.data) return null;
  const { customers, ...rest } = feedback.data;
  return {
    ...rest,
    customer: customers,
    analysis: analysis.data,
    items: (items.data ?? []).map((item) => ({
      ...item,
      // A merged insight keeps frozen items as matching memory (ADR-010): not where the item lives.
      insights: (links.data ?? [])
        .filter((l) => l.item_id === item.id && l.insights && l.insights.status !== "fusionne")
        .map((l) => ({
          ...l.insights!,
          similarity: l.similarity,
          is_representative: l.is_representative,
        })),
    })),
  };
}
