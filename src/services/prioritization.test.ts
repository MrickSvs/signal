import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import {
  fakeEmbed,
  fakeEstimateFn,
  fakeInvoke,
  memoryDb,
  NOW,
  SKILLS,
  world,
} from "@/pipeline/fake-world";
import { compilePipeline, runPipeline } from "@/pipeline/graph";
import { insightNeed, problemHash } from "./estimate";
import {
  applyOverride,
  cancelOverride,
  createManualTopic,
  getRanking,
  PrioritizationError,
} from "./prioritization";

const pack = await loadContextPack();

const common = {
  pack,
  skills: SKILLS,
  now: NOW,
  embedFn: fakeEmbed,
  estimate: { estimateFn: fakeEstimateFn as never },
  sleep: async () => {},
};

/** After a first full run: I-01 (topic a, ranked, scored) with its estimate in the cache. */
async function seeded() {
  const tables = world();
  await runPipeline(
    compilePipeline({ ...common, db: memoryDb(tables), invoke: fakeInvoke() }, new MemorySaver()),
    { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" },
  );
  const i01 = tables.insights.find((i) => i.id === "I-01")!;
  tables.complexity_estimates.push({
    id: "est-I-01",
    insight_id: "I-01",
    item_id: null,
    problem_hash: problemHash(insightNeed(i01 as never).statement),
    components: ["notifications"],
    points_min: 3,
    points_max: 5,
    tshirt_min: "M",
    tshirt_max: "M",
    confidence: "moyenne",
    analogies: [],
    rationale: "",
    risks: [],
    model: "test",
    created_at: NOW.toISOString(),
  });
  const db = memoryDb(tables);
  const invoke = fakeInvoke();
  fakeEstimateFn.mockClear();
  const deps = {
    pack,
    skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
    now: NOW,
    source: "signal_ui" as const,
    scoring: { invoke, estimateFn: fakeEstimateFn as never },
  };
  const current = (id: string) =>
    tables.scores.find((s) => s.insight_id === id && s.is_current) as
      Record<string, unknown> | undefined;
  return { tables, db, deps, invoke, current };
}

describe("getRanking", () => {
  it("recomputes both Reach modes in code from the stored judgments, without a model call", async () => {
    const { db, deps, invoke } = await seeded();
    const comptes = await getRanking(db, "comptes", deps);
    const mrr = await getRanking(db, "mrr", deps);
    expect(comptes.pending).toEqual([]);
    expect(comptes.scores.map((s) => s.insight_id)).toEqual(["I-01"]);
    // Studio Pro: one Pro account → 4 accounts concerned, or 60 € × 4 of MRR.
    expect(comptes.scores[0].reach).toBe(4);
    expect(mrr.scores[0].reach).toBe(240);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("lists a ranked insight without a cached estimate as pending", async () => {
    const { db, deps, tables } = await seeded();
    tables.complexity_estimates.length = 0;
    expect((await getRanking(db, "comptes", deps)).pending).toEqual([
      { insight: "I-01", missing: "estimation" },
    ]);
  });
});

describe("applyOverride", () => {
  it("writes the override, logs the decision and rescores (CL-23 valid value)", async () => {
    const { db, deps, tables, current } = await seeded();
    const result = await applyOverride(
      db,
      { insight_id: "I-01", param: "impact", mode: "comptes", value: 3, reason: "Bloque l'usage" },
      deps,
    );
    expect(tables.overrides).toMatchObject([
      { insight_id: "I-01", param: "impact", value: 3, active: true },
    ]);
    expect(tables.decisions.at(-1)).toMatchObject({
      action: "override",
      field: "impact",
      before: 1,
      after: 3,
      reason: "Bloque l'usage",
      source: "signal_ui",
    });
    expect(result.rescored).toEqual(["I-01"]);
    expect(current("I-01")).toMatchObject({ impact: 3, overridden: { impact: { original: 1 } } });

    // A second override replaces the first one, which stays in the history.
    await applyOverride(
      db,
      { insight_id: "I-01", param: "impact", mode: "comptes", value: 2, reason: "Finalement" },
      deps,
    );
    expect(tables.overrides.map((o) => [o.value, o.active])).toEqual([
      [3, false],
      [2, true],
    ]);
    expect(tables.decisions.at(-1)).toMatchObject({ before: 3, after: 2 });
  });

  it("refuses an invalid value or a missing reason with a clear message (CL-23)", async () => {
    const { db, deps, tables } = await seeded();
    const attempt = (value: number, reason?: string, param = "confidence") =>
      applyOverride(db, { insight_id: "I-01", param, mode: "comptes", value, reason }, deps);
    await expect(attempt(70, "Avis d'expert")).rejects.toThrow(
      /Confidence attendue dans 100 %, 80 %, 50 %/,
    );
    await expect(attempt(70, "Avis d'expert")).rejects.toBeInstanceOf(PrioritizationError);
    await expect(attempt(2.5, "Raison", "impact")).rejects.toThrow(/Impact attendu/);
    await expect(attempt(-2, "Raison", "effort")).rejects.toThrow(/strictement positif/);
    await expect(attempt(80)).rejects.toThrow(/raison est obligatoire/);
    await expect(
      applyOverride(
        db,
        { insight_id: "I-02", param: "impact", mode: "comptes", value: 2, reason: "x" },
        deps,
      ),
    ).rejects.toThrow(/pas dans le classement/);
    expect(tables.overrides).toEqual([]);
    expect(tables.decisions).toEqual([]);
  });

  it("stores Confidence as a ratio and a Reach bound to its mode", async () => {
    const { db, deps, tables } = await seeded();
    await applyOverride(
      db,
      {
        insight_id: "I-01",
        param: "confidence",
        mode: "comptes",
        value: 50,
        reason: "Peu de recul",
      },
      deps,
    );
    await applyOverride(
      db,
      { insight_id: "I-01", param: "reach", mode: "mrr", value: 1000, reason: "Comptes oubliés" },
      deps,
    );
    expect(tables.overrides.map((o) => o.value)).toEqual([0.5, { mode: "mrr", value: 1000 }]);
    expect((await getRanking(db, "mrr", deps)).scores[0].reach).toBe(1000);
    expect((await getRanking(db, "comptes", deps)).scores[0]).toMatchObject({
      reach: 4,
      confidence: 0.5,
    });
  });

  it("records the PO's final MoSCoW without a reason", async () => {
    const { db, deps, tables } = await seeded();
    await applyOverride(
      db,
      { insight_id: "I-01", param: "moscow", mode: "comptes", value: "must" },
      deps,
    );
    const score = (await getRanking(db, "comptes", deps)).scores[0];
    expect(score.moscow_final).toBe("must");
    expect(tables.decisions.at(-1)).toMatchObject({ field: "moscow", after: "must", reason: null });
    await expect(
      applyOverride(
        db,
        { insight_id: "I-01", param: "moscow", mode: "comptes", value: "must" },
        deps,
      ),
    ).rejects.toThrow(/déjà/);
  });
});

describe("cancelOverride", () => {
  it("brings the computed value back and logs it", async () => {
    const { db, deps, tables, current } = await seeded();
    await applyOverride(
      db,
      { insight_id: "I-01", param: "effort", mode: "comptes", value: 10, reason: "Migration" },
      deps,
    );
    expect(current("I-01")).toMatchObject({ effort_weeks: 10, effort_source: "manuel" });
    await cancelOverride(db, { insight_id: "I-01", param: "effort" }, deps);
    expect(tables.overrides[0].active).toBe(false);
    expect(tables.decisions.at(-1)).toMatchObject({
      field: "effort",
      before: 10,
      after: null,
      reason: "Override annulé",
    });
    expect(current("I-01")).toMatchObject({
      effort_weeks: 1.33,
      effort_source: "estimation_initiale",
    });
    await expect(cancelOverride(db, { insight_id: "I-01", param: "effort" }, deps)).rejects.toThrow(
      /Aucun override actif/,
    );
  });
});

describe("createManualTopic (CL-25)", () => {
  const topic = {
    title: "Migrer l'authentification",
    problem_statement: "L'authentification maison bloque le SSO demandé par les grands comptes.",
    reach_comptes: 30,
    reach_mrr: null,
    impact: 2,
    confidence: 80,
    effort_weeks: 4,
    reason: "Dette technique, demande de la direction",
  };

  it("creates a ranked manual insight from the PO's values, judged once, not estimated", async () => {
    const { db, deps, tables, invoke, current } = await seeded();
    const result = await createManualTopic(db, topic, deps);
    expect(result.insight_id).toBe("I-03");
    expect(result.warning).toBeNull();
    expect(tables.insights.find((i) => i.id === "I-03")).toMatchObject({
      origin: "manuel",
      status: "actif",
      ranked: true,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fakeEstimateFn).not.toHaveBeenCalledWith(
      expect.anything(),
      "I-03",
      {},
      expect.anything(),
    );
    expect(tables.decisions.map((d) => [d.action, d.field])).toEqual([
      ["validation", "creation"],
      ["override", "reach"],
      ["override", "impact"],
      ["override", "confidence"],
      ["override", "effort"],
    ]);
    // RICE = 30 × 2 × 0.8 ÷ 4 = 12: ahead of I-01.
    expect(current("I-03")).toMatchObject({
      reach: 30,
      rice: 12,
      rank: 1,
      effort_source: "manuel",
    });
    expect(current("I-01")).toMatchObject({ rank: 2 });

    const mrr = await getRanking(db, "mrr", deps);
    expect(mrr.scores.find((s) => s.insight_id === "I-03")?.reach_detail).toMatchObject({
      manual: true,
      mrr_missing: true,
    });
  });

  it("lets Signal estimate the effort when none is entered", async () => {
    const { db, deps } = await seeded();
    await createManualTopic(db, { ...topic, effort_weeks: null }, deps);
    expect(fakeEstimateFn).toHaveBeenCalledWith(db, "I-03", {}, expect.anything());
  });

  it("refuses invalid values before writing anything", async () => {
    const { db, deps, tables } = await seeded();
    const before = tables.insights.length;
    await expect(createManualTopic(db, { ...topic, confidence: 70 }, deps)).rejects.toThrow(
      /Confidence attendue/,
    );
    await expect(createManualTopic(db, { ...topic, reason: " " }, deps)).rejects.toThrow(
      /raison est obligatoire/i,
    );
    expect(tables.insights.length).toBe(before);
  });

  it("keeps the manual values: only the final MoSCoW can be cancelled", async () => {
    const { db, deps } = await seeded();
    await createManualTopic(db, topic, deps);
    await expect(cancelOverride(db, { insight_id: "I-03", param: "impact" }, deps)).rejects.toThrow(
      /sujet manuel/,
    );
    await applyOverride(
      db,
      { insight_id: "I-03", param: "reach", mode: "mrr", value: 9000, reason: "MRR connu" },
      deps,
    );
    const mrr = await getRanking(db, "mrr", deps);
    expect(mrr.scores.find((s) => s.insight_id === "I-03")?.reach).toBe(9000);
    expect(
      (await getRanking(db, "comptes", deps)).scores.find((s) => s.insight_id === "I-03")?.reach,
    ).toBe(30);
  });
});
