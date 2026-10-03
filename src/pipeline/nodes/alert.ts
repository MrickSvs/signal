// Alert node (SPEC §10.10): thresholds evaluated in code on the insights touched by a run, values
// read from weighting.yaml. Anti-noise (CL-55): one alert per subject and kind over 24 h
// (dedup_key); the next feedbacks enrich the open alert instead of creating another one.
// Everything else is absorbed silently and waits for the digest. The investigation (dossier)
// comes in 4.5: until then a new alert is stored with dossier_status = en_cours and no dossier.
import type { Commitment, Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import type { Tables } from "@/lib/db/types";
import type { CommitmentCoverage } from "@/lib/insights/aggregates";
import { fetchAll, resolveCommitments } from "@/pipeline/insights";
import { computeSignals } from "@/pipeline/nodes/enrich";

const HOUR_MS = 60 * 60 * 1000;

export type AlertKind = Tables<"alerts">["kind"];

export type AlertFeedback = {
  id: string;
  received_at: string;
  urgency: Tables<"feedback_analyses">["urgency"] | null;
  churn_signal: boolean | null;
  customer_id: string | null;
  is_prospect: boolean;
  plan: Tables<"customers">["plan"];
  renewal_in_days: number | null;
};

export type AlertInsight = {
  id: string;
  status: Tables<"insights">["status"];
  product_area: string | null;
  /** Proposed by this run (SPEC §8.10). */
  isNew: boolean;
  emergingBefore: boolean;
  emergingNow: boolean;
  /** Every feedback of the insight, the new ones included. */
  feedbacks: AlertFeedback[];
};

export type AlertInput = {
  /** Feedbacks processed by this run: only they can raise an alert. */
  newFeedbackIds: readonly string[];
  /** Insights holding a new feedback, or created by the run. */
  insights: readonly AlertInsight[];
  /** New feedbacks attached to no insight (watch queue): they can still signal churn. */
  orphanFeedbacks: readonly AlertFeedback[];
  commitments: readonly CommitmentCoverage[];
  /** Scenario date (DEMO_NOW): the 48 h window of critical bugs is measured on received_at. */
  now: Date;
};

/** What an alert is about: an insight, or an account for churn (a customer, many topics). */
export type AlertCandidate = {
  kind: AlertKind;
  subject: string;
  insight_id: string | null;
  feedback_ids: string[];
};

const LIVE = new Set<Tables<"insights">["status"]>(["propose", "actif"]);
const uniq = (ids: readonly string[]) => [...new Set(ids)].sort();

export function evaluateAlerts(input: AlertInput, params: Weighting["alerts"]): AlertCandidate[] {
  const isNew = new Set(input.newFeedbackIds);
  const churnPlans = new Set<string>(params.churn_plans);
  const candidates: AlertCandidate[] = [];
  const churnByAccount = new Map<string, AlertCandidate>();

  const churn = (f: AlertFeedback, insightId: string | null) => {
    if (!isNew.has(f.id) || f.churn_signal !== true || !f.customer_id || f.is_prospect) return;
    if (f.plan === null || !churnPlans.has(f.plan)) return;
    const days = f.renewal_in_days;
    if (days === null || days < 0 || days >= params.churn_renewal_max_days) return;
    const subject = `compte:${f.customer_id}`;
    const existing = churnByAccount.get(subject);
    if (existing) {
      existing.feedback_ids = uniq([...existing.feedback_ids, f.id]);
      existing.insight_id ??= insightId;
      return;
    }
    const candidate = {
      kind: "churn" as const,
      subject,
      insight_id: insightId,
      feedback_ids: [f.id],
    };
    churnByAccount.set(subject, candidate);
    candidates.push(candidate);
  };

  for (const insight of input.insights) {
    if (!LIVE.has(insight.status)) continue; // rejected: absorbed silently
    const fresh = insight.feedbacks.filter((f) => isNew.has(f.id));
    const subject = `insight:${insight.id}`;
    const base = { subject, insight_id: insight.id };

    if (insight.isNew && insight.status === "propose") {
      candidates.push({
        ...base,
        kind: "nouveau_sujet",
        feedback_ids: uniq(insight.feedbacks.map((f) => f.id)),
      });
    }
    if (fresh.length === 0) continue;

    if (insight.emergingNow && !insight.emergingBefore) {
      candidates.push({ ...base, kind: "emergent", feedback_ids: uniq(fresh.map((f) => f.id)) });
    }

    const windowStart = input.now.getTime() - params.critical_bug_window_hours * HOUR_MS;
    const critical = insight.feedbacks.filter(
      (f) =>
        f.urgency === "critique" &&
        new Date(f.received_at).getTime() >= windowStart &&
        new Date(f.received_at).getTime() <= input.now.getTime(),
    );
    if (
      critical.length >= params.critical_bug_min_feedbacks &&
      critical.some((f) => isNew.has(f.id))
    ) {
      candidates.push({
        ...base,
        kind: "bug_critique",
        feedback_ids: uniq(critical.map((f) => f.id)),
      });
    }

    const committed = fresh.filter((f) =>
      input.commitments.some(
        (c) =>
          c.customerId === f.customer_id &&
          insight.product_area !== null &&
          c.productAreas.includes(insight.product_area),
      ),
    );
    if (committed.length) {
      candidates.push({
        ...base,
        kind: "engagement",
        feedback_ids: uniq(committed.map((f) => f.id)),
      });
    }

    for (const f of fresh) churn(f, insight.id);
  }
  for (const f of input.orphanFeedbacks) churn(f, null);
  return candidates;
}

export type OpenAlert = Pick<
  Tables<"alerts">,
  "id" | "kind" | "dedup_key" | "feedback_ids" | "created_at" | "status"
>;

export type AlertPlan = {
  create: (AlertCandidate & { dedup_key: string })[];
  enrich: {
    id: string;
    kind: AlertKind;
    subject: string;
    feedback_ids: string[];
    added: string[];
  }[];
};

/** dedup_key = kind|subject|creation time: unique, and its prefix finds the open alert. */
export const dedupPrefix = (kind: AlertKind, subject: string) => `${kind}|${subject}|`;

/**
 * Anti-noise (CL-55): a candidate enriches the open alert of the same kind and subject created
 * less than `dedup_window_hours` ago (status nouvelle or vue); otherwise it creates one.
 */
export function planAlerts(
  candidates: readonly AlertCandidate[],
  open: readonly OpenAlert[],
  now: Date,
  params: Weighting["alerts"],
): AlertPlan {
  const since = now.getTime() - params.dedup_window_hours * HOUR_MS;
  const recent = open.filter(
    (a) =>
      (a.status === "nouvelle" || a.status === "vue") && new Date(a.created_at).getTime() >= since,
  );
  const plan: AlertPlan = { create: [], enrich: [] };
  for (const c of candidates) {
    const prefix = dedupPrefix(c.kind, c.subject);
    const target = recent
      .filter((a) => a.dedup_key.startsWith(prefix))
      .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!target) {
      plan.create.push({ ...c, dedup_key: prefix + now.toISOString() });
      continue;
    }
    const pending = plan.enrich.find((e) => e.id === target.id);
    const known = new Set(pending?.feedback_ids ?? target.feedback_ids);
    const added = c.feedback_ids.filter((id) => !known.has(id));
    if (added.length === 0) continue;
    if (pending) {
      pending.feedback_ids = uniq([...pending.feedback_ids, ...added]);
      pending.added = uniq([...pending.added, ...added]);
    } else {
      plan.enrich.push({
        id: target.id,
        kind: c.kind,
        subject: c.subject,
        feedback_ids: uniq([...target.feedback_ids, ...added]),
        added,
      });
    }
  }
  return plan;
}

export type AlertSummary = {
  created: { id: string; kind: AlertKind; insight_id: string | null; feedback_ids: string[] }[];
  enriched: { id: string; kind: AlertKind; added: string[] }[];
};

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Alertes : ${what} en échec (${error.message})`);
};

/** Evaluates, deduplicates and writes. `clock` is the real time of alerts.created_at. */
export async function runAlerts(
  db: Db,
  input: AlertInput,
  params: Weighting["alerts"],
  clock: Date = new Date(),
): Promise<AlertSummary> {
  const candidates = evaluateAlerts(input, params);
  if (candidates.length === 0) return { created: [], enriched: [] };
  const since = new Date(clock.getTime() - params.dedup_window_hours * HOUR_MS).toISOString();
  const { data: open, error } = await db
    .from("alerts")
    .select("id, kind, dedup_key, feedback_ids, created_at, status")
    .gte("created_at", since)
    .in("status", ["nouvelle", "vue"]);
  check(error, "lecture des alertes ouvertes");
  const plan = planAlerts(candidates, open ?? [], clock, params);

  const summary: AlertSummary = { created: [], enriched: [] };
  for (const c of plan.create) {
    const { data, error: insertError } = await db
      .from("alerts")
      .insert({
        kind: c.kind,
        insight_id: c.insight_id,
        feedback_ids: c.feedback_ids,
        dedup_key: c.dedup_key,
        status: "nouvelle",
        dossier_status: "en_cours",
        created_at: clock.toISOString(),
      })
      .select("id")
      .single();
    check(insertError, `création de l'alerte ${c.kind}`);
    summary.created.push({
      id: data!.id,
      kind: c.kind,
      insight_id: c.insight_id,
      feedback_ids: c.feedback_ids,
    });
  }
  for (const e of plan.enrich) {
    check(
      (await db.from("alerts").update({ feedback_ids: e.feedback_ids }).eq("id", e.id)).error,
      `enrichissement de l'alerte ${e.id}`,
    );
    summary.enriched.push({ id: e.id, kind: e.kind, added: e.added });
  }
  return summary;
}

/**
 * Builds the alert input of a run from the base: the insights holding a new feedback (or created
 * by the run), all their feedbacks with triage and account signals, and the orphan new feedbacks.
 */
export async function loadAlertInput(
  db: Db,
  options: {
    newFeedbackIds: readonly string[];
    createdInsights: readonly string[];
    emergingBefore: readonly string[];
    weighting: Weighting;
    now: Date;
    commitments: readonly Commitment[];
  },
): Promise<AlertInput> {
  const newIds = [...new Set(options.newFeedbackIds)];
  const { data: newLinks, error: linkError } = newIds.length
    ? await db.from("insight_items").select("insight_id, feedback_id").in("feedback_id", newIds)
    : { data: [], error: null };
  check(linkError, "lecture des items des nouveaux retours");
  const insightIds = [
    ...new Set([...(newLinks ?? []).map((l) => l.insight_id), ...options.createdInsights]),
  ];

  const [insightsRes, linksRes, customers] = await Promise.all([
    insightIds.length
      ? db.from("insights").select("id, status, product_area, trend").in("id", insightIds)
      : Promise.resolve({ data: [], error: null }),
    insightIds.length
      ? db.from("insight_items").select("insight_id, feedback_id").in("insight_id", insightIds)
      : Promise.resolve({ data: [], error: null }),
    fetchAll(
      (from, to) =>
        db
          .from("customers")
          .select("id, name, status, segment, plan, mrr_eur, renewal_date, email_domain")
          .order("id")
          .range(from, to),
      "lecture des comptes",
    ),
  ]);
  check(insightsRes.error, "lecture des insights touchés");
  check(linksRes.error, "lecture des items des insights touchés");
  const links = linksRes.data ?? [];
  const feedbackIds = [...new Set([...newIds, ...links.map((l) => l.feedback_id)])];

  const [feedbacksRes, analysesRes] = await Promise.all([
    db
      .from("feedbacks")
      .select(
        "id, channel, source_type, author_name, author_email, customer_id, subject, raw_text, received_at",
      )
      .in("id", feedbackIds),
    db
      .from("feedback_analyses")
      .select("feedback_id, churn_signal, urgency, created_at")
      .eq("status", "ok")
      .in("feedback_id", feedbackIds)
      .order("created_at"),
  ]);
  check(feedbacksRes.error, "lecture des retours");
  check(analysesRes.error, "lecture des analyses");
  const analysis = new Map((analysesRes.data ?? []).map((a) => [a.feedback_id, a])); // latest wins

  const byId = new Map<string, AlertFeedback>();
  for (const f of feedbacksRes.data ?? []) {
    const signals = computeSignals(f, customers, options.weighting, options.now);
    byId.set(f.id, {
      id: f.id,
      received_at: f.received_at,
      urgency: analysis.get(f.id)?.urgency ?? null,
      churn_signal: analysis.get(f.id)?.churn_signal ?? null,
      customer_id: signals.customer_id,
      is_prospect: signals.is_prospect,
      plan: signals.plan,
      renewal_in_days: signals.renewal_in_days,
    });
  }

  const created = new Set(options.createdInsights);
  const emergingBefore = new Set(options.emergingBefore);
  const insights: AlertInsight[] = (insightsRes.data ?? []).map((i) => {
    const ids = [...new Set(links.filter((l) => l.insight_id === i.id).map((l) => l.feedback_id))];
    return {
      id: i.id,
      status: i.status,
      product_area: i.product_area,
      isNew: created.has(i.id),
      emergingBefore: emergingBefore.has(i.id),
      emergingNow: (i.trend as { is_emerging?: boolean } | null)?.is_emerging === true,
      feedbacks: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    };
  });
  const linked = new Set((newLinks ?? []).map((l) => l.feedback_id));
  return {
    newFeedbackIds: newIds,
    insights,
    orphanFeedbacks: newIds
      .filter((id) => !linked.has(id) && byId.has(id))
      .map((id) => byId.get(id)!),
    commitments: resolveCommitments(options.commitments, customers).coverage,
    now: options.now,
  };
}

/** Insights that are emerging right now: snapshot taken before a run, to detect « devient émergent ». */
export async function emergingInsights(db: Db): Promise<string[]> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("insights")
        .select("id, trend")
        .in("status", ["propose", "actif"])
        .order("id")
        .range(from, to),
    "lecture des tendances",
  );
  return rows
    .filter((r) => (r.trend as { is_emerging?: boolean } | null)?.is_emerging === true)
    .map((r) => r.id);
}
