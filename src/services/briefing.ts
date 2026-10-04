// Facts of the agent's briefing (SPEC §10.8), shared by the injected briefing and the get_briefing
// tool. Same facts as the digest (pipeline/nodes/digest.ts), over « since the last visit », plus a
// top 10, the recent decisions and the page Léa is on.
import type { BriefingFacts, PageContext } from "@/agent/briefing";
import type { Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { loadDigestFacts } from "@/pipeline/nodes/digest";

export const BRIEFING_TOP = 10;

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Briefing : ${what} en échec (${error.message})`);
};

/** Readable id of the entity Léa is looking at, with its title (insight, feedback, backlog item). */
async function entityLabel(db: Db, id: string): Promise<string | null> {
  if (/^I-\d{2,}$/.test(id)) {
    const { data } = await db.from("insights").select("title").eq("id", id).maybeSingle();
    return data?.title ?? null;
  }
  if (/^R-\d{3,}$/.test(id)) {
    const { data } = await db.from("feedbacks").select("subject").eq("id", id).maybeSingle();
    return data?.subject ?? null;
  }
  if (/^(?:US|BUG|TT)-\d{3,}$/.test(id)) {
    const { data } = await db.from("backlog_items").select("title").eq("id", id).maybeSingle();
    return data?.title ?? null;
  }
  return null;
}

export async function lastSeenAt(db: Db): Promise<string | null> {
  const { data, error } = await db.from("po_state").select("last_seen_at").limit(1);
  check(error, "lecture de po_state");
  return data?.[0]?.last_seen_at ?? null;
}

export async function loadBriefingFacts(
  db: Db,
  options: {
    weighting: Weighting;
    now: Date;
    /** Default: Léa's last visit (po_state.last_seen_at). */
    since?: string | null;
    page?: PageContext | null;
  },
): Promise<BriefingFacts> {
  const since = options.since !== undefined ? options.since : await lastSeenAt(db);
  const [facts, moscow, decisions, label] = await Promise.all([
    loadDigestFacts(db, {
      weighting: options.weighting,
      now: options.now,
      clock: options.now,
      since,
      topSize: BRIEFING_TOP,
    }),
    db.from("overrides").select("insight_id, value").eq("param", "moscow").eq("active", true),
    (since
      ? db.from("decisions").select("id, entity_id, action, field").gt("created_at", since)
      : db.from("decisions").select("id, entity_id, action, field")
    )
      .order("created_at", { ascending: false })
      .limit(10),
    options.page?.entity_id ? entityLabel(db, options.page.entity_id) : Promise.resolve(null),
  ]);
  check(moscow.error, "lecture des MoSCoW finaux");
  check(decisions.error, "lecture des décisions");
  const finalOf = new Map((moscow.data ?? []).map((o) => [o.insight_id, String(o.value)]));

  return {
    since,
    top: facts.ranking.top.map((t) => ({
      insight_id: t.insight_id,
      title: t.title,
      rank: t.rank,
      moscow_reco: t.moscow,
      moscow_final: finalOf.get(t.insight_id) ?? null,
    })),
    feedbacks: facts.feedbacks,
    alerts: facts.alerts,
    emerging: facts.emerging,
    new_insights: facts.new_insights,
    moves: facts.ranking.moves,
    has_history: facts.ranking.has_history,
    accounts_at_risk: facts.accounts_at_risk,
    pending: facts.pending,
    decisions: decisions.data ?? [],
    page: options.page ? { ...options.page, entity_label: label } : null,
  };
}
