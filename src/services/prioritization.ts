// Interactive prioritization (SPEC §8.5, §8.9, §12.5, PLAN 3.5). The ranking is recomputed in code
// from the stored judgments and the cached estimates, in either Reach mode, without any model
// call; every write of the PO (override, its cancellation, final MoSCoW, manual topic) is checked
// by lib/scoring, logged in `decisions` (rule 6), then the scores of the pipeline's Reach mode are
// written again so that the other screens see the new ranks. Reused by the agent in 4.4.
import { z } from "zod";
import type { ContextPack, Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";
import { RunCost } from "@/lib/llm/cost";
import {
  cancelOverrideSchema,
  manualTopicSchema,
  overrideRequestSchema,
  type CancelOverrideRequest,
  type ManualTopic,
  type OverrideRequest,
} from "@/lib/prioritization/requests";
import { isManualReach, validateOverride, type OverrideParam } from "@/lib/scoring/overrides";
import type { ReachMode } from "@/lib/scoring/reach";
import { currentReachMode } from "@/pipeline/incremental";
import {
  computeStoredRanking,
  parseOkrIds,
  runScoring,
  sameResult,
  writeScores,
  type ComputedScore,
  type EstimateRunDeps,
  type JudgeDeps,
  type RunScoringOptions,
  type StoredRanking,
} from "@/pipeline/nodes/score";

/** A refused write (business rule or invalid value): the message is shown to the PO as is. */
export class PrioritizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrioritizationError";
  }
}

export type PrioritizationDeps = {
  pack: Pick<ContextPack, "weighting" | "documents" | "commitments">;
  skills: { riceScoring: string; moscow: string };
  now: Date;
  source: "signal_ui" | "chat";
  /** Wraps the writes (the pipeline lock in the app, CL-12); none in tests. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Injected in tests: no model or Voyage call there (rule 11). */
  scoring?: JudgeDeps & EstimateRunDeps;
};

export type PrioritizationResult = {
  insight_id: string;
  decisions: string[];
  /** Insights that got a new score version (pipeline's Reach mode). */
  rescored: string[];
  costEur: number;
  /** Set when the write is done but the score could not be computed (manual topic). */
  warning: string | null;
};

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Priorisation : ${what} en échec (${error.message})`);
};

function scoringOptions(
  deps: Pick<PrioritizationDeps, "pack" | "skills" | "now">,
  mode: ReachMode,
): Pick<RunScoringOptions, "mode" | "weighting" | "now" | "commitments" | "context"> {
  const { weighting, documents, commitments } = deps.pack;
  return {
    mode,
    weighting,
    now: deps.now,
    commitments,
    context: {
      weighting,
      skills: deps.skills,
      documents: { strategy: documents.strategy, commitments: documents.commitments },
      okrIds: parseOkrIds(documents.strategy),
    },
  };
}

/** The ranking in a Reach mode, recomputed in code (read only, no model call). */
export function getRanking(
  db: Db,
  mode: ReachMode,
  deps: Pick<PrioritizationDeps, "pack" | "skills" | "now">,
): Promise<StoredRanking> {
  return computeStoredRanking(db, scoringOptions(deps, mode));
}

/**
 * The pipeline's Reach mode is the one stored in `scores` (the URL toggle is only a view): its
 * versions are written again for the touched insights and those whose result changed.
 */
async function persistRanking(
  db: Db,
  deps: PrioritizationDeps,
  touched: readonly string[],
): Promise<string[]> {
  const mode = await currentReachMode(db, deps.pack.weighting.reach.default_mode);
  const ranking = await getRanking(db, mode, deps);
  const touchedSet = new Set(touched);
  const toWrite = ranking.scores.filter(
    (s) => touchedSet.has(s.insight_id) || !sameResult(s, ranking.current.get(s.insight_id)),
  );
  await writeScores(db, toWrite);
  return toWrite.map((s) => s.insight_id);
}

async function logDecisions(
  db: Db,
  source: PrioritizationDeps["source"],
  rows: readonly {
    entity_id: string;
    action: "override" | "validation";
    field: string;
    before: Json;
    after: Json;
    reason: string | null | undefined;
  }[],
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

type ActiveOverrideRow = { id: string; param: OverrideParam; value: Json };

async function activeOverride(
  db: Db,
  insightId: string,
  param: OverrideParam,
): Promise<ActiveOverrideRow | null> {
  const { data, error } = await db
    .from("overrides")
    .select("id, param, value")
    .eq("insight_id", insightId)
    .eq("param", param)
    .eq("active", true);
  check(error, "lecture des overrides");
  return (data?.[0] as ActiveOverrideRow | undefined) ?? null;
}

async function deactivate(db: Db, id: string): Promise<void> {
  check(
    (await db.from("overrides").update({ active: false }).eq("id", id)).error,
    "désactivation d'un override",
  );
}

/** Effective value shown to the PO before the change (the decision's `before`). */
function effectiveValue(score: ComputedScore, param: OverrideParam): Json {
  switch (param) {
    case "reach":
      return score.reach;
    case "impact":
      return score.impact;
    case "confidence":
      return score.confidence;
    case "effort":
      return score.effort_weeks;
    case "moscow":
      return score.moscow_final;
  }
}

/** Confidence is entered as a percentage (80) and stored as a ratio (0.8). */
const fromPercent = (value: number) => value / 100;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function rankedScore(ranking: StoredRanking, insightId: string) {
  const insight = ranking.insights.find((i) => i.id === insightId);
  if (!insight) {
    throw new PrioritizationError(
      `${insightId} n'est pas dans le classement : seuls les insights classés reçoivent un override.`,
    );
  }
  const score = ranking.scores.find((s) => s.insight_id === insightId);
  if (!score) {
    throw new PrioritizationError(
      `${insightId} n'a pas encore de score : le prochain run le calculera.`,
    );
  }
  return { insight, score };
}

/** The value stored in `overrides`, in lib/scoring's units (SPEC §8.5). */
function storedValue(
  request: OverrideRequest,
  insight: StoredRanking["insights"][number],
): unknown {
  if (request.param === "moscow") return request.value;
  if (request.param === "confidence") return fromPercent(request.value);
  if (request.param !== "reach") return request.value;
  if (insight.origin !== "manuel") return { mode: request.mode, value: request.value };
  // A manual insight's Reach is entered in accounts and, if known, in MRR (SPEC §8.9).
  const previous = insight.overrides.find((o) => o.param === "reach")?.value;
  const base = isManualReach(previous) ? previous : { comptes: request.value, mrr: null };
  return request.mode === "comptes"
    ? { ...base, comptes: request.value }
    : { ...base, mrr: request.value };
}

/** An override from the Priorisation screen (or the chat in 4.4). */
export async function applyOverride(
  db: Db,
  input: unknown,
  deps: PrioritizationDeps,
): Promise<PrioritizationResult> {
  const parsed = overrideRequestSchema.safeParse(input);
  if (!parsed.success) throw new PrioritizationError(z.prettifyError(parsed.error));
  const request = parsed.data;
  const withLock = deps.withLock ?? (<T>(fn: () => Promise<T>) => fn());

  return withLock(async () => {
    const ranking = await getRanking(db, request.mode, deps);
    const { insight, score } = rankedScore(ranking, request.insight_id);
    const value = storedValue(request, insight);
    const checked = validateOverride(
      { param: request.param, value, reason: request.reason },
      deps.pack.weighting,
    );
    if (!checked.ok) throw new PrioritizationError(`${checked.error}.`);

    const previous = await activeOverride(db, insight.id, request.param);
    if (previous && sameJson(previous.value, value)) {
      throw new PrioritizationError("Cette valeur est déjà celle de ton override.");
    }
    if (previous) await deactivate(db, previous.id);
    check(
      (
        await db.from("overrides").insert({
          insight_id: insight.id,
          param: request.param,
          value: value as Json,
          reason: request.reason?.trim() || null,
          active: true,
          feedback_ids: insight.feedbacks.map((f) => f.id),
        })
      ).error,
      "écriture de l'override",
    );
    const decisions = await logDecisions(db, deps.source, [
      {
        entity_id: insight.id,
        action: "override",
        field: request.param,
        before: effectiveValue(score, request.param),
        after: value as Json,
        reason: request.reason,
      },
    ]);
    const rescored = await persistRanking(db, deps, [insight.id]);
    return { insight_id: insight.id, decisions, rescored, costEur: 0, warning: null };
  });
}

/** « Annuler l'override »: the computed value comes back (the override stays in the history). */
export async function cancelOverride(
  db: Db,
  input: unknown,
  deps: PrioritizationDeps,
): Promise<PrioritizationResult> {
  const parsed = cancelOverrideSchema.safeParse(input);
  if (!parsed.success) throw new PrioritizationError(z.prettifyError(parsed.error));
  const request: CancelOverrideRequest = parsed.data;
  const withLock = deps.withLock ?? (<T>(fn: () => Promise<T>) => fn());

  return withLock(async () => {
    const { data, error } = await db
      .from("insights")
      .select("id, origin")
      .eq("id", request.insight_id);
    check(error, "lecture de l'insight");
    const insight = data?.[0];
    if (!insight) throw new PrioritizationError(`Insight introuvable : ${request.insight_id}.`);
    if (insight.origin === "manuel" && request.param !== "moscow") {
      throw new PrioritizationError(
        "Les valeurs d'un sujet manuel sont les tiennes : modifie-les au lieu de les annuler.",
      );
    }
    const previous = await activeOverride(db, insight.id, request.param);
    if (!previous) throw new PrioritizationError("Aucun override actif sur ce paramètre.");
    await deactivate(db, previous.id);
    const decisions = await logDecisions(db, deps.source, [
      {
        entity_id: insight.id,
        action: "override",
        field: request.param,
        before: previous.value,
        after: null,
        reason: request.reason?.trim() || "Override annulé",
      },
    ]);
    const rescored = await persistRanking(db, deps, [insight.id]);
    return { insight_id: insight.id, decisions, rescored, costEur: 0, warning: null };
  });
}

/** Checks a manual topic's values with lib/scoring before anything is written. */
export function checkManualTopic(topic: ManualTopic, weighting: Weighting): string[] {
  const confidence = fromPercent(topic.confidence);
  const checks = [
    validateOverride(
      {
        param: "reach",
        value: { comptes: topic.reach_comptes, mrr: topic.reach_mrr },
        reason: topic.reason,
      },
      weighting,
    ),
    validateOverride({ param: "impact", value: topic.impact, reason: topic.reason }, weighting),
    validateOverride({ param: "confidence", value: confidence, reason: topic.reason }, weighting),
    ...(topic.effort_weeks === null
      ? []
      : [
          validateOverride(
            { param: "effort", value: topic.effort_weeks, reason: topic.reason },
            weighting,
          ),
        ]),
  ];
  return checks.flatMap((c) => (c.ok ? [] : [c.error]));
}

/**
 * « Ajouter un sujet » (SPEC §8.9, CL-25): a manual insight, born `actif` and ranked, whose Reach,
 * Impact, Confidence and possibly Effort are the PO's overrides. Signal judges its alignment and
 * recommends a MoSCoW (one model call), and estimates its effort when none is entered.
 */
export async function createManualTopic(
  db: Db,
  input: unknown,
  deps: PrioritizationDeps,
): Promise<PrioritizationResult> {
  const parsed = manualTopicSchema.safeParse(input);
  if (!parsed.success) throw new PrioritizationError(z.prettifyError(parsed.error));
  const topic = parsed.data;
  const errors = checkManualTopic(topic, deps.pack.weighting);
  if (errors.length) throw new PrioritizationError(`${errors.join(". ")}.`);
  const withLock = deps.withLock ?? (<T>(fn: () => Promise<T>) => fn());
  const runCost = new RunCost();

  return withLock(async () => {
    const { data: created, error } = await db
      .from("insights")
      .insert({
        origin: "manuel",
        status: "actif",
        ranked: true,
        title: topic.title,
        problem_statement: topic.problem_statement,
      })
      .select("id")
      .single();
    check(error, "création du sujet");
    const id = created!.id;

    const values: { param: OverrideParam; value: Json }[] = [
      { param: "reach", value: { comptes: topic.reach_comptes, mrr: topic.reach_mrr } },
      { param: "impact", value: topic.impact },
      { param: "confidence", value: fromPercent(topic.confidence) },
      ...(topic.effort_weeks === null
        ? []
        : [{ param: "effort" as const, value: topic.effort_weeks }]),
    ];
    check(
      (
        await db.from("overrides").insert(
          values.map((v) => ({
            insight_id: id,
            param: v.param,
            value: v.value,
            reason: topic.reason,
            feedback_ids: [],
            active: true,
          })),
        )
      ).error,
      "écriture des valeurs du sujet",
    );
    const decisions = await logDecisions(db, deps.source, [
      {
        entity_id: id,
        action: "validation",
        field: "creation",
        before: null,
        after: { title: topic.title, problem_statement: topic.problem_statement },
        reason: topic.reason,
      },
      ...values.map((v) => ({
        entity_id: id,
        action: "override" as const,
        field: v.param,
        before: null,
        after: v.value,
        reason: topic.reason,
      })),
    ]);

    const mode = await currentReachMode(db, deps.pack.weighting.reach.default_mode);
    const summary = await runScoring(db, {
      ...scoringOptions(deps, mode),
      rejudge: new Set([id]),
      writeOnlyChanged: true,
      touched: new Set([id]),
      deps: { runCost, ...deps.scoring },
    });
    const failure = summary.failures.find((f) => f.insight === id);
    return {
      insight_id: id,
      decisions,
      rescored: summary.written,
      costEur: runCost.eur,
      warning: failure
        ? `Sujet ${id} créé, mais son ${failure.step} a échoué : il sera classé au prochain run.`
        : null,
    };
  });
}
