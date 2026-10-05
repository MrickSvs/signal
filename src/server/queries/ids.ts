import "server-only";
import type { Db } from "@/lib/db/client";
import { idKind, type IdKind } from "@/lib/chat/ids";

// Existence of the readable ids an agent answer cites (SPEC §10.7, CL-28), and the journal of the
// ones that do not exist.

const TABLES: Record<
  IdKind,
  | "feedbacks"
  | "feedback_items"
  | "insights"
  | "customers"
  | "decisions"
  | "epics"
  | "backlog_items"
  | "reference_tickets"
> = {
  feedback: "feedbacks",
  item: "feedback_items",
  insight: "insights",
  customer: "customers",
  decision: "decisions",
  epic: "epics",
  backlog: "backlog_items",
  ticket: "reference_tickets",
};

/** The ids among `ids` that exist in their table (one query per kind of id). */
export async function existingIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const byTable = new Map<(typeof TABLES)[IdKind], string[]>();
  for (const id of ids) {
    const table = TABLES[idKind(id)];
    byTable.set(table, [...(byTable.get(table) ?? []), id]);
  }
  const found = await Promise.all(
    [...byTable].map(async ([table, values]) => {
      const { data, error } = await db.from(table).select("id").in("id", values);
      if (error) throw new Error(`Vérification des ID (${table}) : ${error.message}`);
      return (data ?? []).map((row) => row.id as string);
    }),
  );
  return new Set(found.flat());
}

export async function recordIdIncidents(
  db: Db,
  threadId: string | null,
  incidents: readonly { id: string; excerpt: string }[],
): Promise<void> {
  if (incidents.length === 0) return;
  let thread = threadId;
  if (thread) {
    // The conversation may not be recorded (a turn that failed before touchThread).
    const { data } = await db.from("threads").select("id").eq("id", thread);
    if (!data?.length) thread = null;
  }
  const { error } = await db.from("id_incidents").insert(
    incidents.map((incident) => ({
      thread_id: thread,
      cited_id: incident.id,
      excerpt: incident.excerpt,
    })),
  );
  if (error) throw new Error(`Journal des ID inconnus : ${error.message}`);
}
