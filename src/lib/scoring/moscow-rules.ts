// MoSCoW hard rules (SPEC §8.6, skill moscow), applied in the order of weighting.yaml (CL-24):
// engagement → hors stratégie → churn → critical bug → quartiles. The first rule that applies sets
// the category; a later rule that would give another one is a tension shown to the PO. When the
// model's recommendation differs, the code corrects it and says so (rule_flags).
import type { Weighting } from "@/lib/context";

export type MoscowCategory = "must" | "should" | "could" | "wont";
export type Alignment = "aligne" | "neutre" | "hors_strategie";
export type MoscowRule = Weighting["moscow"]["rule_order"][number];

export type MoscowFacts = {
  alignment: Alignment;
  /** Contractual commitments covering the insight, due in J+ days. */
  commitments: { account: string; due_in_days: number }[];
  /** Client accounts of the insight with a churn signal. */
  churnAccounts: { name: string; plan: string | null; renewal_in_days: number | null }[];
  /** Effective Impact (after override). */
  impact: number;
  /** Feedbacks of the insight with a critical urgency and a bug item. */
  criticalBugFeedbacks: number;
  riceQuartile: number;
  reachQuartile: number;
  /** Effective Confidence (after override). */
  confidence: number;
};

export type RuleFlag =
  | { rule: MoscowRule; status: "appliquee"; category: MoscowCategory; detail: string }
  | { rule: MoscowRule; status: "renfort"; category: MoscowCategory; detail: string }
  | {
      rule: MoscowRule;
      status: "tension";
      category: MoscowCategory;
      detail: string;
      piste: string | null;
    }
  | {
      rule: "correction";
      status: "correction";
      from: MoscowCategory;
      to: MoscowCategory;
      detail: string;
    };

export type MoscowResult = {
  reco: MoscowCategory;
  rule: MoscowRule;
  corrected: boolean;
  flags: RuleFlag[];
  /** Sentence appended to the model's rationale when the code corrected it. */
  note: string | null;
};

type Verdict = { category: MoscowCategory; detail: string } | null;

const CSM_PISTE =
  "Action CSM (accompagnement, contournement, feuille de route partagée) plutôt qu'un développement.";

/** Quartile (1 = top) of a 1-based rank among n entries. */
export function quartile(rank: number, n: number): number {
  if (n <= 0 || rank < 1 || rank > n) throw new Error(`Rang ${rank} hors de 1..${n}`);
  return Math.floor(((rank - 1) * 4) / n) + 1;
}

const days = (n: number) => `J+${n}`;

function evaluate(rule: MoscowRule, facts: MoscowFacts, params: Weighting["moscow"]): Verdict {
  const inHorizon = (n: number | null) => n !== null && n >= 0 && n <= params.horizon_days;
  switch (rule) {
    case "engagement_contractuel": {
      const due = facts.commitments.filter((c) => inHorizon(c.due_in_days));
      return due.length
        ? {
            category: "must",
            detail: `Engagement contractuel : ${due.map((c) => `${c.account} (${days(c.due_in_days)})`).join(", ")}`,
          }
        : null;
    }
    case "hors_strategie":
      return facts.alignment === "hors_strategie"
        ? { category: "wont", detail: "Hors stratégie (strategy.md, non-cibles)" }
        : null;
    case "signal_churn": {
      const plans = new Set<string>(params.must_churn_plans);
      const atRisk = facts.churnAccounts.filter(
        (a) => a.plan !== null && plans.has(a.plan) && inHorizon(a.renewal_in_days),
      );
      return atRisk.length && facts.impact >= params.must_churn_min_impact
        ? {
            category: "must",
            detail: `Signal de churn : ${atRisk.map((a) => `${a.name} (${a.plan}, renouvellement ${days(a.renewal_in_days!)})`).join(", ")}`,
          }
        : null;
    }
    case "bug_critique":
      return facts.criticalBugFeedbacks >= params.must_critical_bug_min_feedbacks
        ? { category: "must", detail: `Bug critique : ${facts.criticalBugFeedbacks} retours` }
        : null;
    case "quartiles": {
      if (facts.riceQuartile <= params.should_quartile && facts.alignment !== "hors_strategie") {
        return { category: "should", detail: `Premier quartile RICE (Q${facts.riceQuartile})` };
      }
      if (facts.confidence <= params.wont_confidence && facts.reachQuartile === 4) {
        return {
          category: "wont",
          detail: "Confidence 50 % et Reach dans le dernier quartile",
        };
      }
      return facts.alignment === "hors_strategie"
        ? { category: "wont", detail: "Hors stratégie" }
        : { category: "could", detail: `Hors premier quartile RICE (Q${facts.riceQuartile})` };
    }
  }
}

export function applyMoscowRules(
  modelReco: MoscowCategory,
  facts: MoscowFacts,
  params: Weighting["moscow"],
): MoscowResult {
  const flags: RuleFlag[] = [];
  let decided: { rule: MoscowRule; category: MoscowCategory } | null = null;

  for (const rule of params.rule_order) {
    const verdict = evaluate(rule, facts, params);
    if (!verdict) continue;
    if (!decided) {
      decided = { rule, category: verdict.category };
      flags.push({ rule, status: "appliquee", ...verdict });
    } else if (rule !== "quartiles") {
      // Quartiles are the default rule: they never stand against a hard rule.
      if (verdict.category === decided.category) {
        flags.push({ rule, status: "renfort", ...verdict });
      } else {
        const piste =
          decided.rule === "hors_strategie" && rule === "signal_churn" ? CSM_PISTE : null;
        flags.push({ rule, status: "tension", ...verdict, piste });
      }
    }
  }
  // quartiles always gives a verdict, so a rule is always decided.
  const { rule, category } = decided!;

  let note: string | null = null;
  if (modelReco !== category) {
    note = `Recommandation corrigée par le code : ${modelReco} → ${category} (règle ${rule}).`;
    flags.push({
      rule: "correction",
      status: "correction",
      from: modelReco,
      to: category,
      detail: note,
    });
  }
  return { reco: category, rule, corrected: note !== null, flags, note };
}
