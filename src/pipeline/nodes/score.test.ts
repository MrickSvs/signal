import { describe, expect, it, vi } from "vitest";
import { loadContextPack } from "@/lib/context";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { addDays, toIsoDate } from "@/lib/demo-now";
import { EMPTY_USAGE } from "@/lib/llm/cost";
import type { invokeStructured } from "@/lib/llm/structured";
import { loadSkill } from "@/lib/skills";
import type { StoredEstimate } from "@/services/estimate";
import {
  buildJudgeMessages,
  computeScores,
  insightFacts,
  judgmentSchema,
  parseOkrIds,
  runScoring,
  type Judgment,
  type ScoreContext,
  reusableJudgment,
} from "./score";

const pack = await loadContextPack();
const { weighting } = pack;
const now = new Date("2026-06-01T12:00:00Z");
const in_ = (days: number) => toIsoDate(addDays(now, days));

const context: ScoreContext = {
  weighting,
  skills: {
    riceScoring: (await loadSkill("rice-scoring")).content,
    moscow: (await loadSkill("moscow")).content,
  },
  documents: { strategy: pack.documents.strategy, commitments: pack.documents.commitments },
  okrIds: parseOkrIds(pack.documents.strategy),
};

// ---------------------------------------------------------------------------
// Fixture: a Gantt-like insight (many Pro accounts) and a permissions insight (Enterprise,
// commitment of Atelier Mercure, churn of Studio Bastide), plus a rejected one.
// ---------------------------------------------------------------------------

const customer = (id: string, name: string, plan: string, mrr: number, renewal: number) => ({
  id,
  name,
  status: "client",
  segment: "agence_com",
  plan,
  mrr_eur: mrr,
  renewal_date: in_(renewal),
  email_domain: `${id.toLowerCase()}.fr`,
});

const feedback = (
  id: string,
  customerId: string | null,
  channel = "email_client",
  source = "client_direct",
) => ({
  id,
  channel,
  source_type: source,
  author_name: `Auteur ${id}`,
  author_email: customerId ? null : `${id.toLowerCase()}@gmail.com`,
  customer_id: customerId,
  subject: null,
  raw_text: "…",
  received_at: addDays(now, -10).toISOString(),
});

const item = (feedbackId: string, type = "demande_fonctionnelle") => ({
  id: `${feedbackId}.1`,
  feedback_id: feedbackId,
  type,
  underlying_problem: `Problème ${feedbackId}`,
  summary: `Résumé ${feedbackId}`,
});

function tables(): MemoryTables {
  const ganttFeedbacks = ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006"];
  const permFeedbacks = ["R-010", "R-011", "R-012"];
  return {
    customers: [
      ...ganttFeedbacks.map((_, i) => customer(`C-00${i + 1}`, `Agence ${i + 1}`, "pro", 120, 200)),
      customer("C-077", "Atelier Mercure", "enterprise", 4200, 45),
      customer("C-078", "Studio Bastide", "enterprise", 2700, 38),
    ],
    feedbacks: [
      ...ganttFeedbacks.map((id, i) =>
        feedback(id, `C-00${i + 1}`, i % 2 ? "ticket_support" : "email_client"),
      ),
      feedback("R-010", "C-077", "note_csm", "interne"),
      // E2: Studio Bastide follows up on two channels → one account.
      feedback("R-011", "C-078", "email_client"),
      feedback("R-012", "C-078", "ticket_support", "support"),
      feedback("R-020", null),
    ],
    feedback_items: [...ganttFeedbacks, ...permFeedbacks, "R-020"].map((id) => item(id)),
    feedback_analyses: [...ganttFeedbacks, ...permFeedbacks, "R-020"].map((id) => ({
      feedback_id: id,
      status: "ok",
      churn_signal: id === "R-011",
      urgency: "moyenne",
      created_at: now.toISOString(),
    })),
    insights: [
      insightRow("I-01", "planification", "propose"),
      insightRow("I-02", "permissions_partage", "actif"),
      { ...insightRow("I-03", "autre", "rejete"), ranked: true },
    ],
    insight_items: [
      ...ganttFeedbacks.map((id) => link("I-01", id)),
      ...permFeedbacks.map((id) => link("I-02", id)),
      link("I-03", "R-020"),
    ],
    overrides: [],
    backlog_items: [],
    scores: [],
  };
}

function insightRow(id: string, area: string, status: string) {
  return {
    id,
    origin: "retours",
    status,
    ranked: status !== "rejete",
    title: `Titre ${id}`,
    problem_statement: `Énoncé ${id}`,
    product_area: area,
    expressed_requests: [],
    mrr_exposed: 0,
    accounts_count: 0,
    renewals_90d: 0,
    trend: {},
  };
}

const link = (insightId: string, feedbackId: string) => ({
  insight_id: insightId,
  item_id: `${feedbackId}.1`,
  is_representative: true,
});

const judgment = (j: Partial<Judgment> = {}): Judgment => ({
  impact: 1,
  impact_rationale: "Friction réelle mais contournable.",
  impact_evidence: ["R-001", "R-002"],
  contradictory_evidence: { flag: false, reason: null },
  alignment: "neutre",
  okr_refs: [],
  alignment_rationale: "Ni cible ni non-cible.",
  moscow_reco: "could",
  moscow_rationale: "Hors premier quartile.",
  ...j,
});

const JUDGMENTS: Record<string, Judgment> = {
  "I-01": judgment({ impact: 2, moscow_reco: "should" }),
  "I-02": judgment({
    impact: 3,
    impact_evidence: ["R-010", "R-011"],
    alignment: "aligne",
    okr_refs: ["O1-KR2", "O2-KR1"],
    moscow_reco: "should",
    moscow_rationale: "Engagement Atelier Mercure.",
  }),
};

function mockInvoke(judgments: Record<string, unknown> = JUDGMENTS) {
  return vi.fn(
    async (
      _role: unknown,
      _schema: unknown,
      _messages: unknown,
      options: { metadata?: Record<string, string> },
    ) => {
      const data = judgments[options.metadata!.insight_id];
      if (data instanceof Error) throw data;
      return { data, usage: EMPTY_USAGE, costEur: 0, attempts: 1 };
    },
  );
}

const estimate = (min: number, max: number): StoredEstimate => ({
  id: `est-${min}-${max}`,
  cached: true,
  estimate: {
    components: ["taches"],
    points_min: min,
    points_max: max,
    tshirt_min: "M",
    tshirt_max: "L",
    confidence: "moyenne",
    analogies: [],
    rationale: "",
    risks: [],
    model: "test",
  },
});

const estimateFn = vi.fn(async (_db: unknown, insightId: string) =>
  insightId === "I-02" ? estimate(13, 21) : estimate(5, 8),
);

function run(
  t: MemoryTables,
  mode: "comptes" | "mrr" = "comptes",
  judgments?: Record<string, unknown>,
) {
  let n = 0;
  const db = createMemoryDb(t, {
    defaults: { scores: () => ({ id: `score-${++n}` }) },
  });
  const invoke = mockInvoke(judgments);
  return {
    invoke,
    summary: runScoring(db, {
      mode,
      weighting,
      now,
      commitments: pack.commitments,
      context,
      deps: {
        invoke: invoke as unknown as typeof invokeStructured,
        estimateFn: estimateFn as never,
      },
    }),
  };
}

// ---------------------------------------------------------------------------

describe("judgmentSchema", () => {
  const schema = judgmentSchema(
    ["R-001", "R-002", "R-003"],
    context.okrIds,
    weighting.impact.scale,
  );

  it("accepts a valid judgment", () => {
    expect(schema.safeParse(judgment()).success).toBe(true);
  });

  it("rejects evidence outside the insight, a value off the scale, an unknown OKR, a silent contradiction and long rationales", () => {
    const invalid = [
      judgment({ impact_evidence: ["R-001", "R-999"] }),
      judgment({ impact_evidence: ["R-001"] }),
      judgment({ impact_evidence: ["R-001", "R-001"] }),
      judgment({ impact: 2.5 }),
      judgment({ okr_refs: ["O9-KR9"] }),
      judgment({ contradictory_evidence: { flag: true, reason: null } }),
      judgment({ impact_rationale: "mot ".repeat(81) }),
      judgment({ moscow_rationale: "mot ".repeat(61) }),
    ];
    for (const value of invalid) expect(schema.safeParse(value).success).toBe(false);
  });

  it("reads the OKR ids of strategy.md", () => {
    expect(context.okrIds).toEqual(["O1-KR1", "O1-KR2", "O2-KR1", "O2-KR2", "O3-KR1", "O3-KR2"]);
  });
});

describe("runScoring", () => {
  it("re-judges only the given insights in incremental mode and writes only what changed", async () => {
    const t = tables();
    await run(t).summary;
    expect(t.scores.every((s) => s.judgment !== null)).toBe(true);
    const before = t.scores.length;

    let n = 100;
    const db = createMemoryDb(t, { defaults: { scores: () => ({ id: `score-${++n}` }) } });
    const invoke = mockInvoke();
    const result = await runScoring(db, {
      mode: "comptes",
      weighting,
      now,
      commitments: pack.commitments,
      context,
      rejudge: new Set(["I-01"]),
      writeOnlyChanged: true,
      deps: {
        invoke: invoke as unknown as typeof invokeStructured,
        estimateFn: estimateFn as never,
      },
    });
    expect(invoke.mock.calls.map((c) => c[3].metadata!.insight_id)).toEqual(["I-01"]);
    expect(result).toMatchObject({ judged: 1, reused: ["I-02"], written: ["I-01"] });
    expect(result.scores.map((s) => s.insight_id).sort()).toEqual(["I-01", "I-02"]);
    expect(t.scores).toHaveLength(before + 1);
    expect(
      t.scores
        .filter((s) => s.is_current)
        .map((s) => s.insight_id)
        .sort(),
    ).toEqual(["I-01", "I-02"]);
  });

  it("scores ranked insights only: a rejected insight is neither judged nor ranked", async () => {
    const t = tables();
    const { invoke, summary } = run(t);
    const result = await summary;
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.scores.map((s) => s.insight_id).sort()).toEqual(["I-01", "I-02"]);
    expect(t.scores.map((s) => s.insight_id)).not.toContain("I-03");
  });

  it("counts a follow-up account once (E2) and computes Reach in both modes (CL-02)", async () => {
    const comptes = await run(tables(), "comptes").summary;
    const perm = comptes.scores.find((s) => s.insight_id === "I-02")!;
    expect(perm.reach).toBe(1.5 * 2); // Atelier Mercure + Studio Bastide (counted once)
    expect(perm.confidence_detail.accounts).toBe(2);
    const gantt = comptes.scores.find((s) => s.insight_id === "I-01")!;
    expect(gantt.reach).toBe(6 * 4);
    expect(gantt.rank).toBe(1);

    const mrr = await run(tables(), "mrr").summary;
    expect(mrr.scores.find((s) => s.insight_id === "I-02")!).toMatchObject({
      reach: (4200 + 2700) * 1.5,
      rank: 1,
    });
  });

  it("makes the committed insight a Must and corrects the model, citing the commitment", async () => {
    const result = await run(tables()).summary;
    const perm = result.scores.find((s) => s.insight_id === "I-02")!;
    expect(perm.moscow_reco).toBe("must");
    expect(perm.rule_flags[0]).toMatchObject({
      rule: "engagement_contractuel",
      status: "appliquee",
      detail: expect.stringContaining("Atelier Mercure (J+75)"),
    });
    expect(perm.rule_flags).toContainEqual(
      expect.objectContaining({ rule: "signal_churn", status: "renfort" }),
    );
    expect(perm.moscow_rationale).toContain("should → must");
    expect(result.capacity.must_weeks).toBeCloseTo(17 / 3, 1);
  });

  it("writes a new version each run and keeps an override after a new run (CL-22)", async () => {
    const t = tables();
    await run(t).summary;
    t.overrides.push({
      id: "ov-1",
      insight_id: "I-01",
      param: "impact",
      value: 3,
      reason: "Le PO a parlé aux clients",
      active: true,
      context_changed: false,
      feedback_ids: ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006"],
    });
    const second = await run(t).summary;
    const gantt = second.scores.find((s) => s.insight_id === "I-01")!;
    expect(gantt.impact).toBe(3);
    expect(gantt.overridden).toEqual({ impact: { original: 2, value: 3 } });

    const rows = t.scores.filter((s) => s.insight_id === "I-01");
    expect(rows.map((r) => [r.version, r.is_current])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(t.overrides[0].context_changed).toBe(false);
  });

  it("flags an override when more than 30 % of the feedbacks changed since", async () => {
    const t = tables();
    t.overrides.push({
      id: "ov-2",
      insight_id: "I-01",
      param: "effort",
      value: 1,
      reason: "Découpage",
      active: true,
      context_changed: false,
      feedback_ids: ["R-001", "R-090", "R-091"],
    });
    const result = await run(t).summary;
    expect(result.contextChanged).toEqual(["I-01:effort"]);
    expect(t.overrides[0].context_changed).toBe(true);
    expect(result.scores.find((s) => s.insight_id === "I-01")).toMatchObject({
      effort_weeks: 1,
      effort_source: "manuel",
    });
  });

  it("reports a failed judgment and still scores the others", async () => {
    const result = await run(tables(), "comptes", {
      ...JUDGMENTS,
      "I-01": new Error("API en panne"),
    }).summary;
    expect(result.failures).toEqual([{ insight: "I-01", step: "jugement", error: "API en panne" }]);
    expect(result.scores.map((s) => [s.insight_id, s.rank])).toEqual([["I-02", 1]]);
  });

  it("rejects evidence that does not belong to the insight (rule 9)", async () => {
    const result = await run(tables(), "comptes", {
      ...JUDGMENTS,
      "I-01": judgment({ impact_evidence: ["R-001", "R-010"] }),
    }).summary;
    expect(result.failures[0]).toMatchObject({ insight: "I-01", step: "jugement" });
  });
});

describe("insightFacts and buildJudgeMessages", () => {
  it("computes the facts in code and wraps the insight and its feedbacks as data", async () => {
    const t = tables();
    const { loadScoringInsights } = await import("./score");
    const db = createMemoryDb(t);
    const { insights, commitments } = await loadScoringInsights(db, {
      weighting,
      now,
      commitments: pack.commitments,
    });
    const perm = insights.find((i) => i.id === "I-02")!;
    const facts = insightFacts(perm, commitments);
    expect(facts).toMatchObject({
      feedbacks_count: 3,
      accounts_count: 2,
      plans: { enterprise: 2 },
      commitments: [{ account: "Atelier Mercure", due_in_days: 75 }],
      churnAccounts: [{ name: "Studio Bastide", plan: "enterprise", renewal_in_days: 38 }],
      prospects: [],
      criticalBugFeedbacks: 0,
    });

    const [system, human] = buildJudgeMessages(perm, facts, context);
    const systemText = JSON.stringify(system.content);
    expect(systemText).toContain("skill: rice-scoring");
    expect(systemText).toContain("skill: moscow");
    expect(systemText).toContain("cache_control");
    const text = String(human.content);
    expect(text).toContain("<contenu_externe");
    expect(text).toContain("Atelier Mercure (J+75)");
    expect(text).toContain("Preuves possibles (ID de retours) : R-010, R-011, R-012");
  });

  it("counts critical bugs and prospects", () => {
    const signals = (key: string, o: object = {}) => ({
      feedback_id: key,
      customer_id: null,
      link_method: null,
      account_key: key,
      is_prospect: false,
      plan: null,
      segment: null,
      mrr_eur: 0,
      renewal_in_days: null,
      source_weight: 1,
      ...o,
    });
    const facts = insightFacts(
      {
        ...insightRow("I-09", "notifications", "propose"),
        origin: "retours",
        status: "propose",
        product_area: "notifications",
        expressed_requests: [],
        items: ["R-1", "R-2", "R-3", "R-4"].map((id) => ({
          ...item(id, "bug"),
          type: "bug" as const,
          is_representative: true,
        })),
        feedbacks: ["R-1", "R-2", "R-3", "R-4"].map((id, i) => ({
          id,
          channel: "ticket_support" as const,
          received_at: now.toISOString(),
          churn_signal: false,
          urgency: i < 3 ? ("critique" as const) : ("haute" as const),
          customer_name: i === 3 ? "Forgeval Industrie" : null,
          signals: signals(id, i === 3 ? { customer_id: "C-095", is_prospect: true } : {}) as never,
        })),
        overrides: [],
        backlogPoints: [],
      } as never,
      [],
    );
    expect(facts.criticalBugFeedbacks).toBe(3);
    expect(facts.prospects).toEqual(["Forgeval Industrie"]);
  });
});

describe("computeScores", () => {
  it("ranks nothing when nothing was judged", () => {
    expect(computeScores([], "comptes", weighting)).toMatchObject({
      scores: [],
      capacity: { must_weeks: 0, alert: false },
    });
  });
});

describe("reusableJudgment", () => {
  it("reuses a stored judgment only while it validates against the insight's feedbacks", () => {
    const insight = { feedbacks: [{ id: "R-001" }, { id: "R-002" }] } as never;
    expect(reusableJudgment(judgment(), insight, context)).toEqual(judgment());
    expect(reusableJudgment(null, insight, context)).toBeNull();
    expect(
      reusableJudgment(judgment({ impact_evidence: ["R-001", "R-404"] }), insight, context),
    ).toBeNull();
  });
});
