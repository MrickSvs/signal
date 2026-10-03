import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";
import { readDigestContent, type DigestContent } from "@/lib/digest/content";
import { MODELS } from "@/lib/llm/models";

// Reads of the Digest screen (SPEC §12.2).

export type DigestView = Pick<
  Tables<"digests">,
  "id" | "period_start" | "period_end" | "created_at" | "markdown"
> &
  DigestContent & {
    /** Digest written just before this one, for the « digest précédent » link. */
    previousId: string | null;
    isLatest: boolean;
  };

/** The latest digest, or the one asked for; null when no digest exists yet (or unknown id). */
export async function getDigest(db: Db, id?: string): Promise<DigestView | null> {
  const select = "id, period_start, period_end, created_at, markdown, content";
  const latest = await db
    .from("digests")
    .select(select)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`Lecture du dernier digest (${latest.error.message})`);
  if (!latest.data) return null;
  let digest = latest.data;
  if (id && id !== digest.id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const asked = await db.from("digests").select(select).eq("id", id).maybeSingle();
    if (asked.error) throw new Error(`Lecture du digest ${id} (${asked.error.message})`);
    if (!asked.data) return null;
    digest = asked.data;
  }
  const previous = await db
    .from("digests")
    .select("id")
    .lt("period_end", digest.period_end)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previous.error) throw new Error(`Lecture du digest précédent (${previous.error.message})`);
  const { content, ...rest } = digest;
  return {
    ...rest,
    ...readDigestContent(content, MODELS.reasoning),
    previousId: previous.data?.id ?? null,
    isLatest: digest.id === latest.data.id,
  };
}

export type OpenAlertDossier = Pick<
  Tables<"alerts">,
  | "id"
  | "kind"
  | "insight_id"
  | "feedback_ids"
  | "dossier_status"
  | "dossier_markdown"
  | "created_at"
> & { insight_title: string | null };

/** Alerts still open now, with their dossier when it is written (SPEC §10.10), oldest first. */
export async function listOpenAlertDossiers(db: Db): Promise<OpenAlertDossier[]> {
  const { data, error } = await db
    .from("alerts")
    .select(
      "id, kind, insight_id, feedback_ids, dossier_status, dossier_markdown, created_at, insights(title)",
    )
    .in("status", ["nouvelle", "vue"])
    .order("created_at")
    .limit(20);
  if (error) throw new Error(`Lecture des alertes (${error.message})`);
  return data.map(({ insights, ...alert }) => ({
    ...alert,
    insight_title: insights?.title ?? null,
  }));
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
