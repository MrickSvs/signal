// Review of the insights Signal proposes (SPEC §8.10, CL-51, CL-52): the PO accepts, rewords,
// merges or rejects. Shared by the Insights screen (PLAN 3.4) and the agent's apply_decision
// (PLAN 4.4). Every choice is logged in `decisions` (rule 6). When the ranking changes (a ranked
// insight leaves it, or a merge changes an insight's facts), the scores are recomputed in code
// with the stored judgments, like the incremental mode: no model call unless an insight has no
// valid judgment yet.
import { z } from "zod";
import type { ContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import type { Json, Tables } from "@/lib/db/types";
import { computeAggregates, type InsightFeedback } from "@/lib/insights/aggregates";
import { insightReviewSchema, type InsightReview } from "@/lib/insights/review";

export { insightReviewSchema, type InsightReview };
import { RunCost } from "@/lib/llm/cost";
import { currentReachMode } from "@/pipeline/incremental";
import { fetchAll, resolveCommitments } from "@/pipeline/insights";
import { computeSignals, type CustomerForLinking } from "@/pipeline/nodes/enrich";
import {
  parseOkrIds,
  runScoring,
  type EstimateRunDeps,
  type JudgeDeps,
} from "@/pipeline/nodes/score";

type InsightStatus = Tables<"insights">["status"];

/** A refused review (business rule): the message is shown to the PO as is. */
export class InsightReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightReviewError";
  }
}

export type InsightReviewDeps = {
  pack: Pick<ContextPack, "weighting" | "documents" | "commitments">;
  skills: { riceScoring: string; moscow: string };
  now: Date;
  source: "signal_ui" | "chat";
  /** Wraps the writes (the pipeline lock in the app, CL-12); none in tests. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Injected in tests: no model or Voyage call there (rule 11). */
  scoring?: JudgeDeps & EstimateRunDeps;
};

export type InsightReviewResult = {
  action: InsightReview["action"];
  /** Insights whose status or wording changed. */
  insights: string[];
  decisions: string[];
  /** Insights that got a new score version. */
  rescored: string[];
  costEur: number;
};

const LIVE: readonly InsightStatus[] = ["propose", "actif"];

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Revue d'insight : ${what} en échec (${error.message})`);
};

type ReviewedInsight = Pick<
  Tables<"insights">,
  "id" | "status" | "origin" | "title" | "problem_statement" | "ranked" | "product_area"
>;

async function loadInsights(db: Db, ids: readonly string[]): Promise<Map<string, ReviewedInsight>> {
  const { data, error } = await db
    .from("insights")
    .select("id, status, origin, title, problem_statement, ranked, product_area")
    .in("id", [...ids]);
  check(error, "lecture des insights");
  const byId = new Map((data ?? []).map((i) => [i.id, i]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new InsightReviewError(`Insight introuvable : ${missing.join(", ")}.`);
  return byId;
}

function requireStatus(insight: ReviewedInsight, allowed: readonly InsightStatus[], what: string) {
  if (!allowed.includes(insight.status)) {
    throw new InsightReviewError(
      `${insight.id} est au statut « ${insight.status} » : impossible ${what}.`,
    );
  }
}

type DecisionRow = {
  entity_id: string;
  action: Tables<"decisions">["action"];
  field: string;
  before: Json;
  after: Json;
  reason?: string;
};

async function logDecisions(
  db: Db,
  source: InsightReviewDeps["source"],
  rows: readonly DecisionRow[],
): Promise<string[]> {
  const { data, error } = await db
    .from("decisions")
    .insert(
      rows.map((r) => ({
        actor: "po" as const,
        source,
        entity_type: "insight",
        entity_id: r.entity_id,
        action: r.action,
        field: r.field,
        before: r.before,
        after: r.after,
        reason: r.reason?.trim() || null,
      })),
    )
    .select("id");
  check(error, "journalisation des décisions");
  return (data ?? []).map((d) => d.id);
}

/** The current score of an insight that leaves the ranking is archived (no rank left behind). */
async function archiveScores(db: Db, ids: readonly string[]): Promise<void> {
  check(
    (
      await db
        .from("scores")
        .update({ is_current: false })
        .in("insight_id", [...ids])
        .eq("is_current", true)
    ).error,
    "archivage des scores",
  );
}

/** Feedbacks of an insight with their account signals, as the pipeline computes them. */
async function insightFeedbacks(
  db: Db,
  feedbackIds: readonly string[],
  deps: Pick<InsightReviewDeps, "pack" | "now">,
): Promise<{ feedbacks: InsightFeedback[]; customers: CustomerForLinking[] }> {
  const [feedbacks, customers, analyses] = await Promise.all([
    db
      .from("feedbacks")
      .select(
        "id, channel, source_type, author_name, author_email, customer_id, subject, raw_text, received_at",
      )
      .in("id", [...feedbackIds]),
    fetchAll(
      (from, to) =>
        db
          .from("customers")
          .select("id, name, status, segment, plan, mrr_eur, renewal_date, email_domain")
          .order("id")
          .range(from, to),
      "lecture des comptes",
    ),
    db
      .from("feedback_analyses")
      .select("feedback_id, churn_signal, created_at")
      .eq("status", "ok")
      .in("feedback_id", [...feedbackIds])
      .order("created_at"),
  ]);
  check(feedbacks.error, "lecture des retours");
  check(analyses.error, "lecture des analyses");
  const churn = new Map<string, boolean | null>();
  for (const a of analyses.data ?? []) churn.set(a.feedback_id, a.churn_signal); // latest wins
  return {
    customers,
    feedbacks: (feedbacks.data ?? []).map((f) => ({
      id: f.id,
      channel: f.channel,
      received_at: f.received_at,
      churn_signal: churn.get(f.id) ?? null,
      signals: computeSignals(f, customers, deps.pack.weighting, deps.now),
    })),
  };
}

/** Recomputes in code the aggregates of an insight whose items changed (merge). */
async function refreshAggregates(
  db: Db,
  insight: ReviewedInsight,
  deps: Pick<InsightReviewDeps, "pack" | "now">,
): Promise<boolean> {
  const { data: links, error } = await db
    .from("insight_items")
    .select("feedback_id")
    .eq("insight_id", insight.id);
  check(error, `lecture des items de ${insight.id}`);
  const feedbackIds = [...new Set((links ?? []).map((l) => l.feedback_id))];
  const { feedbacks, customers } = await insightFeedbacks(db, feedbackIds, deps);
  const a = computeAggregates(
    {
      status: insight.status,
      origin: insight.origin,
      productArea: insight.product_area,
      feedbacks,
    },
    {
      weighting: deps.pack.weighting,
      now: deps.now,
      commitments: resolveCommitments(deps.pack.commitments, customers).coverage,
    },
  );
  check(
    (
      await db
        .from("insights")
        .update({
          ranked: a.ranked,
          accounts_count: a.accounts_count,
          mrr_exposed: a.mrr_exposed,
          renewals_90d: a.renewals_90d,
          segments_breakdown: a.segments_breakdown as unknown as Json,
          channels: a.channels as Json,
          trend: a.trend as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq("id", insight.id)
    ).error,
    `mise à jour de ${insight.id}`,
  );
  return a.ranked;
}

/** New ranks for everyone, with the stored judgments (SPEC §8.5: re-ranking is immediate). */
async function rescore(
  db: Db,
  touched: readonly string[],
  deps: InsightReviewDeps,
  runCost: RunCost,
): Promise<string[]> {
  const { weighting } = deps.pack;
  const summary = await runScoring(db, {
    mode: await currentReachMode(db, weighting.reach.default_mode),
    weighting,
    now: deps.now,
    commitments: deps.pack.commitments,
    context: {
      weighting,
      skills: deps.skills,
      documents: {
        strategy: deps.pack.documents.strategy,
        commitments: deps.pack.documents.commitments,
      },
      okrIds: parseOkrIds(deps.pack.documents.strategy),
    },
    rejudge: new Set(),
    writeOnlyChanged: true,
    touched: new Set(touched),
    deps: { runCost, ...deps.scoring },
  });
  if (summary.failures.length) {
    // The review itself is done; the insight keeps its previous score until the next run.
    console.error("Revue d'insight : re-score partiel", summary.failures);
  }
  return summary.written;
}

/** Applies one review decision of the PO. Throws InsightReviewError when it is refused. */
export async function reviewInsight(
  db: Db,
  input: unknown,
  deps: InsightReviewDeps,
): Promise<InsightReviewResult> {
  const parsed = insightReviewSchema.safeParse(input);
  if (!parsed.success) throw new InsightReviewError(z.prettifyError(parsed.error));
  const review = parsed.data;
  const withLock = deps.withLock ?? (<T>(fn: () => Promise<T>) => fn());
  const runCost = new RunCost();
  return withLock(async () => {
    const result = await apply(db, review, deps, runCost);
    return { ...result, action: review.action, costEur: runCost.eur };
  });
}

async function apply(
  db: Db,
  review: InsightReview,
  deps: InsightReviewDeps,
  runCost: RunCost,
): Promise<Omit<InsightReviewResult, "action" | "costEur">> {
  const now = new Date().toISOString();

  if (review.action === "accepter") {
    const ids = [...new Set(review.insight_ids)];
    const insights = await loadInsights(db, ids);
    for (const insight of insights.values()) requireStatus(insight, ["propose"], "de l'accepter");
    check(
      (await db.from("insights").update({ status: "actif", updated_at: now }).in("id", ids)).error,
      "acceptation",
    );
    const decisions = await logDecisions(
      db,
      deps.source,
      ids.map((id) => ({
        entity_id: id,
        action: "validation",
        field: "status",
        before: "propose",
        after: "actif",
        reason: review.reason,
      })),
    );
    // Proposed and active insights are ranked alike: nothing to rescore.
    return { insights: ids, decisions, rescored: [] };
  }

  if (review.action === "reformuler") {
    const insight = (await loadInsights(db, [review.insight_id])).get(review.insight_id)!;
    requireStatus(insight, LIVE, "de le reformuler");
    const unchanged =
      insight.title === review.title && insight.problem_statement === review.problem_statement;
    if (unchanged && insight.status === "actif") {
      throw new InsightReviewError("Le titre et l'énoncé sont identiques : rien à reformuler.");
    }
    // title_locked: the next runs never rewrite this wording (SPEC §8.10).
    check(
      (
        await db
          .from("insights")
          .update({
            title: review.title,
            problem_statement: review.problem_statement,
            title_locked: true,
            status: "actif",
            updated_at: now,
          })
          .eq("id", insight.id)
      ).error,
      `reformulation de ${insight.id}`,
    );
    const decisions = await logDecisions(db, deps.source, [
      {
        entity_id: insight.id,
        action: "modification",
        field: "formulation",
        before: {
          title: insight.title,
          problem_statement: insight.problem_statement,
          status: insight.status,
        },
        after: {
          title: review.title,
          problem_statement: review.problem_statement,
          status: "actif",
        },
        reason: review.reason,
      },
    ]);
    return { insights: [insight.id], decisions, rescored: [] };
  }

  if (review.action === "fusionner") {
    if (review.insight_id === review.into) {
      throw new InsightReviewError("Un insight ne peut pas fusionner avec lui-même.");
    }
    const insights = await loadInsights(db, [review.insight_id, review.into]);
    const source = insights.get(review.insight_id)!;
    const target = insights.get(review.into)!;
    requireStatus(source, LIVE, "de le fusionner");
    requireStatus(target, LIVE, `d'y fusionner ${source.id}`);
    for (const i of [source, target]) {
      if (i.origin !== "retours") {
        throw new InsightReviewError(
          `${i.id} est un insight manuel : seuls les insights issus des retours se fusionnent.`,
        );
      }
    }

    // The items join the target; the merged insight keeps its own, frozen, so the next runs
    // replay the merge (ADR-010).
    const [{ data: sourceItems, error: e1 }, { data: targetItems, error: e2 }] = await Promise.all([
      db.from("insight_items").select("item_id, feedback_id").eq("insight_id", source.id),
      db.from("insight_items").select("item_id").eq("insight_id", target.id),
    ]);
    check(e1, `lecture des items de ${source.id}`);
    check(e2, `lecture des items de ${target.id}`);
    const present = new Set((targetItems ?? []).map((i) => i.item_id));
    const moved = (sourceItems ?? []).filter((i) => !present.has(i.item_id));
    if (moved.length) {
      check(
        (
          await db.from("insight_items").insert(
            moved.map((i) => ({
              insight_id: target.id,
              item_id: i.item_id,
              feedback_id: i.feedback_id,
              similarity: null,
              is_representative: false,
            })),
          )
        ).error,
        `rattachement des items à ${target.id}`,
      );
    }
    check(
      (
        await db
          .from("insights")
          .update({ status: "fusionne", merged_into: target.id, ranked: false, updated_at: now })
          .eq("id", source.id)
      ).error,
      `fusion de ${source.id}`,
    );
    await archiveScores(db, [source.id]);
    const targetRanked = await refreshAggregates(db, target, deps);
    const decisions = await logDecisions(db, deps.source, [
      {
        entity_id: source.id,
        action: "modification",
        field: "merged_into",
        before: { status: source.status, merged_into: null },
        after: { status: "fusionne", merged_into: target.id, items_moved: moved.length },
        reason: review.reason,
      },
    ]);
    const rescored =
      source.ranked || targetRanked || target.ranked
        ? await rescore(db, targetRanked ? [target.id] : [], deps, runCost)
        : [];
    return { insights: [source.id, target.id], decisions, rescored };
  }

  // rejeter: out of the ranking, still visible; it stays rejected if it re-forms (CL-53).
  const insight = (await loadInsights(db, [review.insight_id])).get(review.insight_id)!;
  requireStatus(insight, LIVE, "de le rejeter");
  check(
    (
      await db
        .from("insights")
        .update({ status: "rejete", ranked: false, updated_at: now })
        .eq("id", insight.id)
    ).error,
    `rejet de ${insight.id}`,
  );
  await archiveScores(db, [insight.id]);
  const decisions = await logDecisions(db, deps.source, [
    {
      entity_id: insight.id,
      action: "rejet",
      field: "status",
      before: insight.status,
      after: "rejete",
      reason: review.reason,
    },
  ]);
  const rescored = insight.ranked ? await rescore(db, [], deps, runCost) : [];
  return { insights: [insight.id], decisions, rescored };
}
