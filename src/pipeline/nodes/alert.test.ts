import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import {
  dedupPrefix,
  evaluateAlerts,
  planAlerts,
  runAlerts,
  type AlertFeedback,
  type AlertInput,
  type AlertInsight,
  type OpenAlert,
} from "./alert";

const { weighting } = await loadContextPack();
const params = weighting.alerts;
const now = new Date("2026-06-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();

const feedback = (id: string, f: Partial<AlertFeedback> = {}): AlertFeedback => ({
  id,
  received_at: hoursAgo(2),
  urgency: "moyenne",
  churn_signal: false,
  customer_id: null,
  is_prospect: false,
  plan: null,
  renewal_in_days: null,
  ...f,
});

const insight = (id: string, feedbacks: AlertFeedback[], i: Partial<AlertInsight> = {}) => ({
  id,
  status: "actif" as const,
  product_area: "notifications",
  isNew: false,
  emergingBefore: false,
  emergingNow: false,
  feedbacks,
  ...i,
});

const input = (i: Partial<AlertInput>): AlertInput => ({
  newFeedbackIds: [],
  insights: [],
  orphanFeedbacks: [],
  commitments: [],
  now,
  ...i,
});

const kinds = (i: AlertInput) => evaluateAlerts(i, params).map((c) => [c.kind, c.subject]);

describe("evaluateAlerts (SPEC §10.10)", () => {
  it("nouveau_sujet: an insight proposed by the run", () => {
    const i = insight("I-09", [feedback("R-1"), feedback("R-2"), feedback("R-3")], {
      isNew: true,
      status: "propose",
    });
    expect(evaluateAlerts(input({ newFeedbackIds: ["R-3"], insights: [i] }), params)).toEqual([
      {
        kind: "nouveau_sujet",
        subject: "insight:I-09",
        insight_id: "I-09",
        feedback_ids: ["R-1", "R-2", "R-3"],
      },
    ]);
  });

  it("emergent: only when the insight becomes emerging", () => {
    const fs = [feedback("R-1")];
    const becomes = insight("I-01", fs, { emergingNow: true });
    const already = insight("I-02", fs, { emergingNow: true, emergingBefore: true });
    expect(kinds(input({ newFeedbackIds: ["R-1"], insights: [becomes, already] }))).toEqual([
      ["emergent", "insight:I-01"],
    ]);
  });

  it("churn: Business or Enterprise customer renewing in less than 90 days, one per account", () => {
    const churn = (id: string, f: Partial<AlertFeedback>) =>
      feedback(id, {
        churn_signal: true,
        customer_id: "C-001",
        plan: "enterprise",
        renewal_in_days: 40,
        ...f,
      });
    const i = insight("I-01", [
      churn("R-1", {}),
      churn("R-2", {}), // same account: same alert
      churn("R-3", { customer_id: "C-002", plan: "pro" }), // plan not watched
      churn("R-4", { customer_id: "C-003", renewal_in_days: 90 }), // not < 90 days
      churn("R-5", { customer_id: "C-004", is_prospect: true }),
      churn("R-6", { customer_id: "C-005", renewal_in_days: null }),
      churn("R-8", { customer_id: "C-007" }), // not a feedback of this run
    ]);
    const orphan = churn("R-7", { customer_id: "C-006", plan: "business", renewal_in_days: 0 });
    const result = evaluateAlerts(
      input({
        newFeedbackIds: ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7"],
        insights: [i],
        orphanFeedbacks: [orphan],
      }),
      params,
    );
    expect(result).toEqual([
      { kind: "churn", subject: "compte:C-001", insight_id: "I-01", feedback_ids: ["R-1", "R-2"] },
      { kind: "churn", subject: "compte:C-006", insight_id: null, feedback_ids: ["R-7"] },
    ]);
  });

  it("bug_critique: 3 critical feedbacks on one insight within 48 h, one of them new", () => {
    const critical = (id: string, h: number) =>
      feedback(id, { urgency: "critique", received_at: hoursAgo(h) });
    const two = insight("I-01", [critical("R-1", 50), critical("R-2", 10), critical("R-3", 1)]);
    expect(kinds(input({ newFeedbackIds: ["R-3"], insights: [two] }))).toEqual([]); // R-1 too old
    const three = insight("I-01", [critical("R-1", 47), critical("R-2", 10), critical("R-3", 1)]);
    expect(
      evaluateAlerts(input({ newFeedbackIds: ["R-3"], insights: [three] }), params),
    ).toMatchObject([{ kind: "bug_critique", feedback_ids: ["R-1", "R-2", "R-3"] }]);
    // Nothing new among them: no alert.
    expect(kinds(input({ newFeedbackIds: ["R-9"], insights: [three] }))).toEqual([]);
  });

  it("engagement: a new feedback of a committed account on a covered area", () => {
    const commitments = [{ customerId: "C-077", productAreas: ["permissions_partage"] }];
    const f = feedback("R-1", { customer_id: "C-077" });
    const covered = insight("I-07", [f], { product_area: "permissions_partage" });
    const other = insight("I-01", [f], { product_area: "notifications" });
    expect(
      kinds(input({ newFeedbackIds: ["R-1"], insights: [covered, other], commitments })),
    ).toEqual([["engagement", "insight:I-07"]]);
  });

  it("absorbs silently what touches a rejected insight, or no new feedback", () => {
    const f = feedback("R-1", {
      churn_signal: true,
      customer_id: "C-1",
      plan: "enterprise",
      renewal_in_days: 5,
    });
    expect(
      kinds(
        input({ newFeedbackIds: ["R-1"], insights: [insight("I-01", [f], { status: "rejete" })] }),
      ),
    ).toEqual([]);
    expect(
      kinds(input({ newFeedbackIds: [], insights: [insight("I-01", [f], { emergingNow: true })] })),
    ).toEqual([]);
  });
});

describe("planAlerts (anti-noise, CL-55)", () => {
  const open = (o: Partial<OpenAlert>): OpenAlert => ({
    id: "alert-1",
    kind: "churn",
    dedup_key: `${dedupPrefix("churn", "compte:C-001")}${hoursAgo(1)}`,
    feedback_ids: ["R-1"],
    created_at: hoursAgo(1),
    status: "nouvelle",
    ...o,
  });
  const candidate = {
    kind: "churn" as const,
    subject: "compte:C-001",
    insight_id: "I-01",
    feedback_ids: ["R-2"],
  };

  it("enriches the open alert of the same kind and subject within 24 h", () => {
    expect(planAlerts([candidate], [open({})], now, params)).toEqual({
      create: [],
      enrich: [
        {
          id: "alert-1",
          kind: "churn",
          subject: "compte:C-001",
          feedback_ids: ["R-1", "R-2"],
          added: ["R-2"],
        },
      ],
    });
    // Already known feedbacks change nothing.
    expect(planAlerts([{ ...candidate, feedback_ids: ["R-1"] }], [open({})], now, params)).toEqual({
      create: [],
      enrich: [],
    });
  });

  it("creates a new alert after 24 h, after the alert was handled, or for another subject", () => {
    for (const o of [
      open({ created_at: hoursAgo(25) }),
      open({ status: "traitee" }),
      open({ dedup_key: `${dedupPrefix("churn", "compte:C-002")}x` }),
      open({ kind: "emergent", dedup_key: `${dedupPrefix("emergent", "compte:C-001")}x` }),
    ]) {
      const plan = planAlerts([candidate], [o], now, params);
      expect(plan.enrich).toEqual([]);
      expect(plan.create).toEqual([
        { ...candidate, dedup_key: `churn|compte:C-001|${now.toISOString()}` },
      ]);
    }
  });

  it("merges two candidates hitting the same open alert", () => {
    const plan = planAlerts(
      [candidate, { ...candidate, feedback_ids: ["R-3"] }],
      [open({})],
      now,
      params,
    );
    expect(plan.enrich).toMatchObject([
      { feedback_ids: ["R-1", "R-2", "R-3"], added: ["R-2", "R-3"] },
    ]);
  });
});

describe("runAlerts", () => {
  it("writes new alerts with an empty dossier being prepared, and enriches the open ones", async () => {
    const tables: MemoryTables = { alerts: [] };
    let n = 0;
    const db = createMemoryDb(tables, { defaults: { alerts: () => ({ id: `alert-${++n}` }) } });
    const f = (id: string) =>
      feedback(id, {
        churn_signal: true,
        customer_id: "C-001",
        plan: "enterprise",
        renewal_in_days: 40,
      });
    const first = await runAlerts(
      db,
      input({ newFeedbackIds: ["R-1"], orphanFeedbacks: [f("R-1")] }),
      params,
      now,
    );
    expect(first.created).toMatchObject([{ id: "alert-1", kind: "churn" }]);
    expect(tables.alerts[0]).toMatchObject({
      status: "nouvelle",
      dossier_status: "en_cours",
      feedback_ids: ["R-1"],
    });

    const later = new Date(now.getTime() + 3600 * 1000);
    const second = await runAlerts(
      db,
      input({ newFeedbackIds: ["R-2"], orphanFeedbacks: [f("R-2")] }),
      params,
      later,
    );
    expect(second).toEqual({
      created: [],
      enriched: [{ id: "alert-1", kind: "churn", added: ["R-2"] }],
    });
    expect(tables.alerts).toHaveLength(1);
    expect(tables.alerts[0].feedback_ids).toEqual(["R-1", "R-2"]);

    expect(await runAlerts(db, input({}), params, later)).toEqual({ created: [], enriched: [] });
  });
});
