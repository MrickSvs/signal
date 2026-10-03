// Reach (SPEC §8.1), computed on distinct accounts (CL-02). Two modes with different units:
// « comptes » (estimated accounts concerned) and « mrr » (estimated MRR concerned, in euros).
import type { Weighting } from "@/lib/context";
import type { FeedbackSignals } from "@/pipeline/nodes/enrich";

export type ReachMode = "comptes" | "mrr";

export type ReachAccount = Pick<
  FeedbackSignals,
  "account_key" | "customer_id" | "is_prospect" | "plan" | "mrr_eur"
>;

export type ReachDetail = {
  mode: ReachMode;
  /** Distinct accounts behind the insight's feedbacks, prospects and unidentified ones included. */
  accounts: number;
  by_plan: Record<string, { accounts: number; factor: number; value: number }>;
  /** Feedbacks without an identifiable account (CL-07): 1 each in « comptes », 0 in « mrr ». */
  unidentified: { accounts: number; value: number };
  /** Prospects weigh 0 (CL-08); they stay visible in the evidence. */
  prospects: { accounts: number; value: number };
  manual?: boolean;
  /** Manual insight in « mrr » mode whose MRR the PO did not fill in (SPEC §8.9). */
  mrr_missing?: boolean;
};

export type Reach = { value: number; detail: ReachDetail };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Distinct accounts of a list of feedback signals, first occurrence kept. */
export function distinctAccounts<T extends Pick<FeedbackSignals, "account_key">>(
  signals: readonly T[],
): T[] {
  return [...new Map(signals.map((s) => [s.account_key, s])).values()];
}

export function computeReach(
  signals: readonly ReachAccount[],
  mode: ReachMode,
  params: Weighting["reach"],
): Reach {
  const accounts = distinctAccounts(signals);
  const detail: ReachDetail = {
    mode,
    accounts: accounts.length,
    by_plan: {},
    unidentified: { accounts: 0, value: 0 },
    prospects: { accounts: 0, value: 0 },
  };
  let value = 0;
  for (const account of accounts) {
    if (account.is_prospect) {
      detail.prospects.accounts++;
      detail.prospects.value += params.prospect_weight;
      value += params.prospect_weight;
      continue;
    }
    if (!account.customer_id || !account.plan) {
      const unit = params.unidentified_account[mode];
      detail.unidentified.accounts++;
      detail.unidentified.value += unit;
      value += unit;
      continue;
    }
    const factor = params.extrapolation_factors[account.plan];
    const contribution = mode === "comptes" ? factor : account.mrr_eur * factor;
    const plan = (detail.by_plan[account.plan] ??= { accounts: 0, factor, value: 0 });
    plan.accounts++;
    plan.value = round2(plan.value + contribution);
    value += contribution;
  }
  return { value: round2(value), detail };
}

/** Reach of a manual insight, entered by the PO in accounts and, if known, in MRR. */
export type ManualReach = { comptes: number; mrr: number | null };

export function manualReach(input: ManualReach, mode: ReachMode): Reach {
  const detail: ReachDetail = {
    mode,
    accounts: 0,
    by_plan: {},
    unidentified: { accounts: 0, value: 0 },
    prospects: { accounts: 0, value: 0 },
    manual: true,
  };
  if (mode === "comptes") return { value: input.comptes, detail };
  if (input.mrr === null) return { value: 0, detail: { ...detail, mrr_missing: true } };
  return { value: input.mrr, detail };
}
