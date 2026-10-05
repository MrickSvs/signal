// A decision of the PO taken in the chat (SPEC §10.5, §10.6, PLAN 4.4), applied after the approval
// card through the same services as the UI: overrides and MoSCoW (services/prioritization), review
// of a proposed insight (services/insight-review), validation of a backlog draft
// (services/backlog). A confirmed challenge also logs Signal's disagreement; a refused card logs
// the refusal. Every outcome is in `decisions` (rule 6).
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";
import {
  checkDecision,
  decisionEntity,
  describeDecision,
  type DecisionRequest,
} from "@/lib/decisions/apply-decision";
import { currentReachMode } from "@/pipeline/incremental";
import { reviewBacklogItem } from "@/services/backlog";
import { reviewInsight, type InsightReviewDeps } from "@/services/insight-review";
import {
  applyOverride,
  PrioritizationError,
  type PrioritizationDeps,
} from "@/services/prioritization";

export type ApplyDecisionDeps = PrioritizationDeps & Pick<InsightReviewDeps, "scoring">;

export type ApplyDecisionResult = {
  kind: DecisionRequest["kind"];
  target: string;
  summary: string;
  /** Decisions of the PO written by the service. */
  decisions: string[];
  /** Signal's logged disagreement, when the decision was challenged. */
  disagreement: string | null;
  rescored: string[];
  costEur: number;
};

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Décision : ${what} en échec (${error.message})`);
};

async function apply(
  db: Db,
  request: DecisionRequest,
  deps: ApplyDecisionDeps,
): Promise<Pick<ApplyDecisionResult, "decisions" | "rescored" | "costEur">> {
  switch (request.kind) {
    case "override":
    case "moscow": {
      const mode = await currentReachMode(db, deps.pack.weighting.reach.default_mode);
      const result = await applyOverride(
        db,
        request.kind === "moscow"
          ? {
              param: "moscow",
              insight_id: request.insight_id,
              mode,
              value: request.value,
              reason: request.reason,
            }
          : {
              param: request.param,
              insight_id: request.insight_id,
              mode,
              value: request.value,
              reason: request.reason,
            },
        deps,
      );
      return { decisions: result.decisions, rescored: result.rescored, costEur: result.costEur };
    }
    case "validation": {
      const result = await reviewBacklogItem(
        db,
        request.item_id,
        request.value,
        deps,
        request.reason,
      );
      return { decisions: [result.decision], rescored: [], costEur: 0 };
    }
    case "insight_review": {
      const result = await reviewInsight(db, request.review, deps);
      return { decisions: result.decisions, rescored: result.rescored, costEur: result.costEur };
    }
  }
}

/** Value of the decision as logged with the disagreement and the refusal. */
function decisionValue(request: DecisionRequest): Json {
  switch (request.kind) {
    case "override":
      return { param: request.param, value: request.value };
    case "moscow":
    case "validation":
      return request.value;
    case "insight_review":
      return request.review as unknown as Json;
  }
}

function fieldOf(request: DecisionRequest): string {
  return request.kind === "override" ? request.param : request.kind;
}

/**
 * Applies a decision Léa approved (or edited) on the card. The check is the tool's and the card's
 * (lib/decisions): an invalid value is refused before any write (CL-23).
 */
export async function applyDecision(
  db: Db,
  input: unknown,
  deps: ApplyDecisionDeps,
): Promise<ApplyDecisionResult> {
  const checked = checkDecision(input, deps.pack.weighting);
  if (!checked.ok) throw new PrioritizationError(`${checked.error}.`);
  const request = checked.request;
  const applied = await apply(db, request, deps);
  const { entity_id } = decisionEntity(request);

  let disagreement: string | null = null;
  if (request.disagreement) {
    const { entity_type } = decisionEntity(request);
    const { data, error } = await db
      .from("decisions")
      .insert({
        actor: "signal",
        source: deps.source,
        entity_type,
        entity_id,
        action: "desaccord",
        field: fieldOf(request),
        before: null,
        after: decisionValue(request),
        reason: request.disagreement,
      })
      .select("id")
      .single();
    check(error, "journalisation du désaccord");
    disagreement = data!.id;
  }
  return {
    kind: request.kind,
    target: entity_id,
    summary: describeDecision(request),
    disagreement,
    ...applied,
  };
}

/**
 * Léa refused the approval card: nothing is applied (the tool never runs), the refusal of Signal's
 * proposal is logged with her reason. A malformed proposal is logged by its raw arguments.
 */
export async function logRefusal(
  db: Db,
  input: unknown,
  deps: Pick<ApplyDecisionDeps, "pack" | "source">,
  reason?: string,
): Promise<string> {
  const checked = checkDecision(input, deps.pack.weighting);
  const raw = (input ?? {}) as { target?: unknown };
  const entity = checked.ok
    ? decisionEntity(checked.request)
    : { entity_type: "insight", entity_id: String(raw.target ?? "—") };
  const { data, error } = await db
    .from("decisions")
    .insert({
      actor: "po",
      source: deps.source,
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      action: "rejet",
      field: "proposition_signal",
      before: null,
      after: (checked.ok
        ? {
            kind: checked.request.kind,
            value: decisionValue(checked.request),
            summary: describeDecision(checked.request),
          }
        : input) as Json,
      reason: reason?.trim() || null,
    })
    .select("id")
    .single();
  check(error, "journalisation du refus");
  return data!.id;
}
