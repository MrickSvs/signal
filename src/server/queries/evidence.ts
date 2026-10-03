import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";

// Previews behind the clickable IDs of the UI (SPEC §12.1: every ID opens a preview).

export const FEEDBACK_ID = /^R-\d{3,}$/;
export const INSIGHT_ID = /^I-\d{2,}$/;
export const BACKLOG_ITEM_ID = /^(?:US|BUG|TT)-\d{3,}$/;

export type FeedbackEvidence = Pick<
  Tables<"feedbacks">,
  "id" | "channel" | "received_at" | "subject" | "raw_text" | "truncated" | "author_name"
> & {
  customer: Pick<Tables<"customers">, "id" | "name" | "plan" | "status" | "health"> | null;
  notion_page_id: string | null;
};

export async function getFeedbackEvidence(db: Db, id: string): Promise<FeedbackEvidence | null> {
  const [feedback, link] = await Promise.all([
    db
      .from("feedbacks")
      .select(
        "id, channel, received_at, subject, raw_text, truncated, author_name, customers(id, name, plan, status, health)",
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("notion_links")
      .select("notion_page_id")
      .eq("data_source", "retours")
      .eq("entity_id", id)
      .maybeSingle(),
  ]);
  if (feedback.error) throw new Error(`Lecture du retour ${id} (${feedback.error.message})`);
  if (link.error) throw new Error(`Lecture du lien Notion de ${id} (${link.error.message})`);
  if (!feedback.data) return null;
  const { customers, ...rest } = feedback.data;
  return { ...rest, customer: customers, notion_page_id: link.data?.notion_page_id ?? null };
}

export type InsightPreview = Pick<
  Tables<"insights">,
  | "id"
  | "title"
  | "problem_statement"
  | "status"
  | "origin"
  | "product_area"
  | "accounts_count"
  | "mrr_exposed"
  | "ranked"
  | "merged_into"
> & {
  score: Pick<Tables<"scores">, "rank" | "rice" | "moscow_reco" | "reach_mode"> | null;
};

export async function getInsightPreview(db: Db, id: string): Promise<InsightPreview | null> {
  const [insight, score] = await Promise.all([
    db
      .from("insights")
      .select(
        "id, title, problem_statement, status, origin, product_area, accounts_count, mrr_exposed, ranked, merged_into",
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("scores")
      .select("rank, rice, moscow_reco, reach_mode")
      .eq("insight_id", id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (insight.error) throw new Error(`Lecture de l'insight ${id} (${insight.error.message})`);
  if (score.error) throw new Error(`Lecture du score de ${id} (${score.error.message})`);
  if (!insight.data) return null;
  return { ...insight.data, score: score.data };
}

export type BacklogItemPreview = Pick<
  Tables<"backlog_items">,
  | "id"
  | "kind"
  | "title"
  | "status"
  | "points"
  | "insight_id"
  | "epic_id"
  | "persona"
  | "want"
  | "value"
  | "severity"
  | "objective"
  | "evidence"
  | "notion_page_id"
>;

export async function getBacklogItemPreview(
  db: Db,
  id: string,
): Promise<BacklogItemPreview | null> {
  const { data, error } = await db
    .from("backlog_items")
    .select(
      "id, kind, title, status, points, insight_id, epic_id, persona, want, value, severity, objective, evidence, notion_page_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Lecture de l'élément ${id} (${error.message})`);
  return data;
}
