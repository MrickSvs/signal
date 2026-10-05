// Contract of the agent's apply_decision (SPEC §10.5, §10.6, PLAN 4.4): one decision of the PO
// expressed in the chat, proposed by Signal and applied only after the approval card. Pure (zod and
// lib/scoring only): shared by the tool, the human-in-the-loop predicate, the resume route and the
// card of the chat panel. Values are checked by lib/scoring/overrides.ts, as in the UI (CL-23).
import { z } from "zod";
import type { Weighting } from "@/lib/context";
import { insightReviewSchema, type InsightReview } from "@/lib/insights/review";
import { validateOverride } from "@/lib/scoring/overrides";
import type { MoscowCategory } from "@/lib/scoring/moscow-rules";

export const DECISION_KINDS = ["override", "moscow", "validation", "insight_review"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const OVERRIDE_PARAMS = ["reach", "impact", "confidence", "effort"] as const;
export type OverrideNumberParam = (typeof OVERRIDE_PARAMS)[number];

export const MOSCOW_VALUES = ["must", "should", "could", "wont"] as const;
export const VALIDATION_VALUES = ["valide", "rejete"] as const;
export const REVIEW_ACTIONS = ["accepter", "reformuler", "fusionner", "rejeter"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * Flat input of the tool (a model tool's schema must be an object, not a union): the fields used
 * depend on `kind`, checked by parseDecision.
 */
export const applyDecisionSchema = z.object({
  kind: z
    .enum(DECISION_KINDS)
    .describe(
      "override : Reach, Impact, Confidence ou Effort d'un insight classé ; moscow : MoSCoW final ; validation : valider ou rejeter un brouillon du backlog ; insight_review : revue d'un insight proposé.",
    ),
  target: z
    .string()
    .trim()
    .describe(
      "Insight (I-07) pour override, moscow et insight_review ; élément (US-001, BUG-001, TT-001) pour validation.",
    ),
  param: z.enum(OVERRIDE_PARAMS).optional().describe("override seulement : le paramètre écrasé."),
  value: z
    .union([z.number(), z.string()])
    .describe(
      "override : nombre JSON, sans unité (Impact sur l'échelle, Confidence en % : 50 pour 50 %, Reach dans l'unité du mode, Effort en semaines-personne) ; moscow : must, should, could ou wont ; validation : valide ou rejete ; insight_review : accepter, reformuler, fusionner ou rejeter.",
    ),
  title: z.string().trim().optional().describe("insight_review reformuler : nouveau titre."),
  problem_statement: z
    .string()
    .trim()
    .optional()
    .describe("insight_review reformuler : nouvel énoncé du problème."),
  into: z.string().trim().optional().describe("insight_review fusionner : insight cible (I-xx)."),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      "Raison donnée par Léa, avec ses mots ; omets-la si elle n'en a pas donné (n'en invente jamais). Obligatoire pour un override : demande-la-lui.",
    ),
  signal_position: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      "Seulement si tu as challengé cette décision et que Léa l'a confirmée : ta position en une phrase, journalisée comme désaccord.",
    ),
});

export type ApplyDecisionArgs = z.input<typeof applyDecisionSchema>;

type Common = { reason?: string; disagreement?: string };

export type DecisionRequest = Common &
  (
    | { kind: "override"; insight_id: string; param: OverrideNumberParam; value: number }
    | { kind: "moscow"; insight_id: string; value: MoscowCategory }
    | { kind: "validation"; item_id: string; value: (typeof VALIDATION_VALUES)[number] }
    | { kind: "insight_review"; review: InsightReview }
  );

export type DecisionCheck = { ok: true; request: DecisionRequest } | { ok: false; error: string };

const INSIGHT_ID = /^I-\d{2,}$/;
const ITEM_ID = /^(?:US|BUG|TT)-\d{3,}$/;

const refuse = (error: string): DecisionCheck => ({ ok: false, error });
const clean = (text: string | undefined) => text?.trim() || undefined;

/**
 * A number the model (or the card's form) may send as text: « 50 », « 50 % », « 0,5 ». Anything
 * else stays invalid.
 */
export function toNumber(value: number | string): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value.replace(/\s|%/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function reviewOf(args: z.infer<typeof applyDecisionSchema>, reason?: string): DecisionCheck {
  const action = String(args.value);
  if (!REVIEW_ACTIONS.includes(action as ReviewAction)) {
    return refuse(`Revue d'insight : action attendue parmi ${REVIEW_ACTIONS.join(", ")}`);
  }
  const base = { action, reason };
  const candidate =
    action === "accepter"
      ? { ...base, insight_ids: [args.target] }
      : action === "reformuler"
        ? {
            ...base,
            insight_id: args.target,
            title: args.title ?? "",
            problem_statement: args.problem_statement ?? "",
          }
        : action === "fusionner"
          ? { ...base, insight_id: args.target, into: args.into ?? "" }
          : { ...base, insight_id: args.target };
  const parsed = insightReviewSchema.safeParse(
    Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined)),
  );
  if (!parsed.success) return refuse(`Revue d'insight : ${z.prettifyError(parsed.error)}`);
  return { ok: true, request: { kind: "insight_review", review: parsed.data } };
}

/**
 * Checks a proposed decision: shape by kind, then values on lib/scoring's scales (Impact scale,
 * Confidence levels in %, strictly positive Reach and Effort, mandatory reason of an override).
 * Pure: the predicate of the approval card and the tool run the same check.
 */
export function checkDecision(input: unknown, weighting: Weighting): DecisionCheck {
  const parsed = applyDecisionSchema.safeParse(input);
  if (!parsed.success) return refuse(z.prettifyError(parsed.error));
  const args = parsed.data;
  const common: Common = {
    reason: clean(args.reason),
    disagreement: clean(args.signal_position),
  };

  switch (args.kind) {
    case "override": {
      if (!INSIGHT_ID.test(args.target)) return refuse("Override : insight attendu (I-07)");
      if (!args.param)
        return refuse("Override : param attendu (reach, impact, confidence, effort)");
      const number = toNumber(args.value);
      if (number === null) return refuse("Override : une valeur numérique est attendue (ex. 50)");
      // Confidence is entered as a percentage (80) and checked as a ratio (0.8).
      const value = args.param === "confidence" ? number / 100 : number;
      const checked = validateOverride(
        { param: args.param, value, reason: common.reason },
        weighting,
      );
      if (!checked.ok) return refuse(`Override : ${checked.error}`);
      return {
        ok: true,
        request: {
          ...common,
          kind: "override",
          insight_id: args.target,
          param: args.param,
          value: number,
        },
      };
    }
    case "moscow": {
      if (!INSIGHT_ID.test(args.target)) return refuse("MoSCoW : insight attendu (I-07)");
      const value = String(args.value).toLowerCase();
      if (!MOSCOW_VALUES.includes(value as MoscowCategory)) {
        return refuse(`MoSCoW attendu parmi ${MOSCOW_VALUES.join(", ")}`);
      }
      return {
        ok: true,
        request: {
          ...common,
          kind: "moscow",
          insight_id: args.target,
          value: value as MoscowCategory,
        },
      };
    }
    case "validation": {
      if (!ITEM_ID.test(args.target)) {
        return refuse("Validation : élément du backlog attendu (US-001, BUG-001, TT-001)");
      }
      const value = String(args.value);
      if (!VALIDATION_VALUES.includes(value as "valide")) {
        return refuse(`Validation : valeur attendue parmi ${VALIDATION_VALUES.join(", ")}`);
      }
      return {
        ok: true,
        request: { ...common, kind: "validation", item_id: args.target, value: value as "valide" },
      };
    }
    case "insight_review": {
      if (!INSIGHT_ID.test(args.target)) return refuse("Revue d'insight : insight attendu (I-07)");
      const review = reviewOf(args, common.reason);
      return review.ok ? { ok: true, request: { ...common, ...review.request } } : review;
    }
  }
}

/** Entity a decision is about, as stored in `decisions`. */
export function decisionEntity(request: DecisionRequest): {
  entity_type: "insight" | "backlog_item";
  entity_id: string;
} {
  switch (request.kind) {
    case "validation":
      return { entity_type: "backlog_item", entity_id: request.item_id };
    case "insight_review":
      return {
        entity_type: "insight",
        entity_id:
          request.review.action === "accepter"
            ? request.review.insight_ids[0]
            : request.review.insight_id,
      };
    default:
      return { entity_type: "insight", entity_id: request.insight_id };
  }
}

const PARAM_LABEL: Record<OverrideNumberParam, string> = {
  reach: "Reach",
  impact: "Impact",
  confidence: "Confidence",
  effort: "Effort",
};

const MOSCOW_LABEL: Record<MoscowCategory, string> = {
  must: "Must",
  should: "Should",
  could: "Could",
  wont: "Won't",
};

function overrideValue(param: OverrideNumberParam, value: number): string {
  if (param === "confidence") return `${value} %`;
  if (param === "effort") return `${value} semaine${value > 1 ? "s" : ""}-personne`;
  return String(value);
}

/** The decision in one plain sentence: the exact content of the approval card (SPEC §10.6). */
export function describeDecision(request: DecisionRequest): string {
  switch (request.kind) {
    case "override":
      return `${PARAM_LABEL[request.param]} de ${request.insight_id} fixé à ${overrideValue(request.param, request.value)}`;
    case "moscow":
      return `MoSCoW final de ${request.insight_id} : ${MOSCOW_LABEL[request.value]}`;
    case "validation":
      return request.value === "valide"
        ? `Valider le brouillon ${request.item_id}`
        : `Rejeter le brouillon ${request.item_id}`;
    case "insight_review": {
      const r = request.review;
      if (r.action === "accepter") return `Accepter l'insight proposé ${r.insight_ids.join(", ")}`;
      if (r.action === "reformuler") {
        return `Reformuler ${r.insight_id} : « ${r.title} » (titre verrouillé)`;
      }
      if (r.action === "fusionner") return `Fusionner ${r.insight_id} dans ${r.into}`;
      return `Rejeter l'insight ${r.insight_id}`;
    }
  }
}

/** Short human-readable label of a decision kind (card header). */
export const KIND_LABEL: Record<DecisionKind, string> = {
  override: "Override",
  moscow: "MoSCoW",
  validation: "Backlog",
  insight_review: "Revue d'insight",
};
