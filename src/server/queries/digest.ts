import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";
import { readDigestContent, type DigestContent } from "@/lib/digest/content";
import { MODELS } from "@/lib/llm/models";

// Reads of the Digest screen (SPEC §12.2).

export type DigestView = Pick<
  Tables<"digests">,
  "id" | "period_start" | "period_end" | "created_at"
> &
  DigestContent;

/** The latest digest; null before the first one (ADR-033: older digests are not shown). */
export async function getDigest(db: Db): Promise<DigestView | null> {
  const { data, error } = await db
    .from("digests")
    .select("id, period_start, period_end, created_at, content")
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Lecture du dernier digest (${error.message})`);
  if (!data) return null;
  const { content, ...rest } = data;
  return { ...rest, ...readDigestContent(content, MODELS.reasoning) };
}

/** Feedbacks per week over the history window (insights.trend.weekly, oldest first, §8.8). */
export async function getWeeklyTrends(
  db: Db,
  insightIds: readonly string[],
): Promise<Map<string, number[]>> {
  if (insightIds.length === 0) return new Map();
  const { data, error } = await db
    .from("insights")
    .select("id, trend")
    .in("id", [...insightIds]);
  if (error) throw new Error(`Lecture des tendances (${error.message})`);
  return new Map(
    data.flatMap((i) => {
      const weekly = (i.trend as { weekly?: unknown } | null)?.weekly;
      return Array.isArray(weekly) && weekly.every((n) => typeof n === "number")
        ? [[i.id, weekly as number[]]]
        : [];
    }),
  );
}

/** Current MRR of the accounts at risk (the digest facts do not store it). */
export async function getCustomersMrr(
  db: Db,
  customerIds: readonly string[],
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();
  const { data, error } = await db
    .from("customers")
    .select("id, mrr_eur")
    .in("id", [...customerIds]);
  if (error) throw new Error(`Lecture des comptes (${error.message})`);
  return new Map(data.map((c) => [c.id, Number(c.mrr_eur)]));
}

/** Each visit of the Digest screen moves the start of the next digest's period (SPEC §12.2). */
export async function markSeen(db: Db, at: Date): Promise<void> {
  const { error } = await db
    .from("po_state")
    .update({ last_seen_at: at.toISOString() })
    .eq("id", true);
  if (error) throw new Error(`Mise à jour de po_state (${error.message})`);
}
