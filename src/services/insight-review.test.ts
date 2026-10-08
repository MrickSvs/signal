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
import { InsightReviewError, insightReviewSchema, reviewInsight } from "./insight-review";
import { getRanking } from "./prioritization";

const pack = await loadContextPack();

const common = {
  pack,
  skills: SKILLS,
  now: NOW,
  embedFn: fakeEmbed,
  estimate: { estimateFn: fakeEstimateFn as never },
  sleep: async () => {},
};

/** After a first full run: I-01 (topic a, 6 feedbacks, ranked) and I-02 (topic b, weak signal). */
async function seeded() {
  const tables = world();
  const run = async (runId: string) =>
    runPipeline(
      compilePipeline({ ...common, db: memoryDb(tables), invoke: fakeInvoke() }, new MemorySaver()),
      { runId, reachMode: "comptes" },
    );
  await run("11111111-1111-4111-8111-111111111111");
  const db = memoryDb(tables);
  const invoke = fakeInvoke();
  const deps = {
    pack,
    skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
    now: NOW,
    source: "signal_ui" as const,
    scoring: { invoke, estimateFn: fakeEstimateFn as never },
  };
  const insight = (id: string) => tables.insights.find((i) => i.id === id)!;
  const currentScores = (id: string) =>
    tables.scores.filter((s) => s.insight_id === id && s.is_current);
  return { tables, db, deps, invoke, insight, currentScores, run };
}

describe("insightReviewSchema", () => {
  it("accepts the four actions and refuses malformed ones", () => {
    expect(
      insightReviewSchema.safeParse({ action: "accepter", insight_ids: ["I-01"] }).success,
    ).toBe(true);
    expect(
      insightReviewSchema.safeParse({ action: "fusionner", insight_id: "I-01", into: "I-02" })
        .success,
    ).toBe(true);
    expect(insightReviewSchema.safeParse({ action: "accepter", insight_ids: [] }).success).toBe(
      false,
    );
    expect(insightReviewSchema.safeParse({ action: "rejeter", insight_id: "R-001" }).success).toBe(
      false,
    );
    expect(
      insightReviewSchema.safeParse({
        action: "reformuler",
        insight_id: "I-01",
        title: "",
        problem_statement: "Un énoncé assez long.",
      }).success,
    ).toBe(false);
    expect(insightReviewSchema.safeParse({ action: "supprimer", insight_id: "I-01" }).success).toBe(
      false,
    );
  });
});

describe("reviewInsight (in-memory database, simulated models)", () => {
  it("accepts a batch: proposed → active, one decision each, nothing rescored (CL-51, CL-52)", async () => {
    const { tables, db, deps, insight } = await seeded();
    expect(insight("I-01").status).toBe("propose");
    expect(insight("I-02").status).toBe("propose");

    const result = await reviewInsight(
      db,
      { action: "accepter", insight_ids: ["I-01", "I-02"] },
      deps,
    );
    expect(result).toMatchObject({ action: "accepter", insights: ["I-01", "I-02"], rescored: [] });
    expect(insight("I-01").status).toBe("actif");
    expect(insight("I-02").status).toBe("actif");
    expect(tables.decisions).toMatchObject([
      {
        actor: "po",
        source: "signal_ui",
        entity_type: "insight",
        entity_id: "I-01",
        action: "validation",
        field: "status",
        before: "propose",
        after: "actif",
      },
      { entity_id: "I-02", action: "validation" },
    ]);

    // Already active: refused, nothing logged.
    await expect(
      reviewInsight(db, { action: "accepter", insight_ids: ["I-01"] }, deps),
    ).rejects.toThrow(InsightReviewError);
    expect(tables.decisions).toHaveLength(2);
  });

  it("refuses an unknown insight or a malformed input with a readable message", async () => {
    const { db, deps } = await seeded();
    await expect(
      reviewInsight(db, { action: "rejeter", insight_id: "I-99" }, deps),
    ).rejects.toThrow("Insight introuvable : I-99");
    await expect(reviewInsight(db, { action: "rejeter" }, deps)).rejects.toThrow(
      InsightReviewError,
    );
  });

  it("rewords: active, title locked, before/after logged; a later run keeps the wording", async () => {
    const { tables, db, deps, insight, run } = await seeded();
    const before = { title: insight("I-01").title, problem: insight("I-01").problem_statement };
    await reviewInsight(
      db,
      {
        action: "reformuler",
        insight_id: "I-01",
        title: "  Titre de Léa ",
        problem_statement: "Énoncé reformulé par Léa.",
        reason: "Plus clair",
      },
      deps,
    );
    expect(insight("I-01")).toMatchObject({
      status: "actif",
      title_locked: true,
      title: "Titre de Léa",
      problem_statement: "Énoncé reformulé par Léa.",
    });
    expect(tables.decisions.at(-1)).toMatchObject({
      entity_id: "I-01",
      action: "modification",
      field: "formulation",
      before: { title: before.title, problem_statement: before.problem, status: "propose" },
      after: { title: "Titre de Léa", status: "actif" },
      reason: "Plus clair",
    });

    await run("22222222-2222-4222-8222-222222222222");
    expect(insight("I-01")).toMatchObject({ status: "actif", title: "Titre de Léa" });
  });

  it("rejects a ranked insight: out of the ranking, its score archived, reason logged", async () => {
    const { tables, db, deps, insight, currentScores } = await seeded();
    expect(insight("I-01").ranked).toBe(true);
    expect(currentScores("I-01")).toHaveLength(1);

    const result = await reviewInsight(
      db,
      { action: "rejeter", insight_id: "I-01", reason: "Déjà traité" },
      deps,
    );
    expect(insight("I-01")).toMatchObject({ status: "rejete", ranked: false });
    expect(currentScores("I-01")).toHaveLength(0);
    expect(result.rescored).toEqual([]);
    expect(tables.decisions.at(-1)).toMatchObject({
      entity_id: "I-01",
      action: "rejet",
      before: "propose",
      after: "rejete",
      reason: "Déjà traité",
    });
    await expect(
      reviewInsight(db, { action: "rejeter", insight_id: "I-01" }, deps),
    ).rejects.toThrow("impossible de le rejeter");
  });

  it("merges: items join the target, aggregates and score recomputed in code, merge replayed by the next run (CL-15)", async () => {
    const { tables, db, deps, invoke, insight, currentScores, run } = await seeded();
    const accountsBefore = insight("I-01").accounts_count as number;
    const versionBefore = currentScores("I-01")[0].version as number;

    const result = await reviewInsight(
      db,
      { action: "fusionner", insight_id: "I-02", into: "I-01" },
      deps,
    );
    expect(insight("I-02")).toMatchObject({
      status: "fusionne",
      merged_into: "I-01",
      ranked: false,
    });
    const itemsOf = (id: string) => tables.insight_items.filter((r) => r.insight_id === id);
    expect(itemsOf("I-01")).toHaveLength(9);
    expect(itemsOf("I-02")).toHaveLength(3); // frozen: the memory of the merge
    expect(insight("I-01").accounts_count).toBeGreaterThan(accountsBefore);
    expect(result.rescored).toEqual(["I-01"]);
    expect(currentScores("I-01")[0].version).toBe(versionBefore + 1);
    // The stored judgment still validates: no model call.
    expect(invoke.mock.calls.filter((c) => c[3].name === "judge-insight")).toHaveLength(0);
    expect(tables.decisions.at(-1)).toMatchObject({
      entity_id: "I-02",
      action: "modification",
      field: "merged_into",
      after: { status: "fusionne", merged_into: "I-01", items_moved: 3 },
    });

    await run("33333333-3333-4333-8333-333333333333");
    expect(insight("I-02")).toMatchObject({ status: "fusionne", merged_into: "I-01" });
    expect(itemsOf("I-01")).toHaveLength(9);
  });

  it("refuses a merge into itself, into a rejected insight or with a manual one", async () => {
    const { tables, db, deps } = await seeded();
    await expect(
      reviewInsight(db, { action: "fusionner", insight_id: "I-01", into: "I-01" }, deps),
    ).rejects.toThrow("avec lui-même");
    await reviewInsight(db, { action: "rejeter", insight_id: "I-02" }, deps);
    await expect(
      reviewInsight(db, { action: "fusionner", insight_id: "I-01", into: "I-02" }, deps),
    ).rejects.toThrow("impossible d'y fusionner");
    tables.insights.push({ ...tables.insights[0], id: "I-03", origin: "manuel", status: "actif" });
    await expect(
      reviewInsight(db, { action: "fusionner", insight_id: "I-03", into: "I-01" }, deps),
    ).rejects.toThrow("insight manuel");
  });

  it("holds the lock around the writes when one is given", async () => {
    const { db, deps } = await seeded();
    const calls: string[] = [];
    await reviewInsight(
      db,
      { action: "accepter", insight_ids: ["I-02"] },
      {
        ...deps,
        withLock: async (fn) => {
          calls.push("lock");
          const result = await fn();
          calls.push("unlock");
          return result;
        },
      },
    );
    expect(calls).toEqual(["lock", "unlock"]);
  });
});

describe("a reworded insight stays in the ranking (F1)", () => {
  it("keeps the ranked insight in the recomputed ranking, on its last estimate marked stale", async () => {
    const { tables, db, deps, insight } = await seeded();
    // The estimate as estimateInsight stores it: cached under the hash of the problem statement.
    tables.complexity_estimates = [
      {
        id: "est-I-01",
        insight_id: "I-01",
        item_id: null,
        problem_hash: problemHash(insightNeed(insight("I-01") as never).statement),
        components: ["notifications"],
        points_min: 3,
        points_max: 5,
        tshirt_min: "M",
        tshirt_max: "M",
        confidence: "moyenne",
        analogies: [],
        rationale: "Analogue au ticket des rappels.",
        risks: [],
        model: "test",
        created_at: NOW.toISOString(),
      },
    ];
    const ranked = async () => {
      const ranking = await getRanking(db, "comptes", deps);
      return {
        ids: ranking.scores.map((s) => s.insight_id),
        pending: ranking.pending.map((p) => p.insight),
        estimate: ranking.estimates.get("I-01"),
      };
    };
    const before = await ranked();
    expect(before.ids).toContain("I-01");
    expect(before.estimate).toMatchObject({ id: "est-I-01" });
    expect(before.estimate).not.toHaveProperty("stale");

    await reviewInsight(
      db,
      {
        action: "reformuler",
        insight_id: "I-01",
        title: "Notifications d'assignation en retard",
        problem_statement: "Les assignés apprennent trop tard qu'une tâche leur revient.",
      },
      deps,
    );

    const after = await ranked();
    expect(after.pending).not.toContain("I-01");
    expect(after.ids).toContain("I-01");
    expect(after.estimate).toMatchObject({ id: "est-I-01", stale: true });
  });
});
