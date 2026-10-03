import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { fakeEmbed, fakeEstimateFn, fakeInvoke, memoryDb, NOW, SKILLS, world } from "./fake-world";
import { compilePipeline, runPipeline } from "./graph";
import {
  attachItems,
  describeFeedback,
  incrementalRequestSchema,
  insertFeedbacks,
  runIncremental,
  watchGroups,
  type NewFeedback,
} from "./incremental";

const pack = await loadContextPack();
const THRESHOLD = pack.weighting.clustering.distance_threshold;

describe("attachItems", () => {
  const vectors = new Map<string, number[]>([
    ["R-1.1", [1, 0, 0]],
    ["R-2.1", [0.95, 0.05, 0]],
    ["R-3.1", [0, 1, 0]],
    ["R-4.1", [0, 0, 1]],
  ]);
  const insights = [
    { id: "I-01", status: "actif" as const, itemIds: ["R-1.1", "R-2.1"] },
    { id: "I-02", status: "rejete" as const, itemIds: ["R-3.1"] },
    { id: "I-03", status: "fusionne" as const, itemIds: ["R-4.1"] },
  ];

  it("joins the closest insight within the clustering threshold, else the watch queue", () => {
    const result = attachItems(
      [
        { id: "R-9.1", vector: [1, 0.02, 0] },
        { id: "R-8.1", vector: [0.6, 0.6, 0.5] },
      ],
      insights,
      vectors,
      THRESHOLD,
    );
    expect(result.attached).toMatchObject([{ itemId: "R-9.1", insightId: "I-01" }]);
    expect(result.attached[0].similarity).toBeGreaterThan(1 - THRESHOLD);
    expect(result.watch).toEqual(["R-8.1"]);
  });

  it("lets a rejected insight absorb its items (it stays rejected); a merged one never attracts", () => {
    const result = attachItems(
      [
        { id: "R-7.1", vector: [0, 1, 0.01] },
        { id: "R-6.1", vector: [0, 0, 1] },
      ],
      insights,
      vectors,
      THRESHOLD,
    );
    expect(result.attached.map((a) => [a.itemId, a.insightId])).toEqual([["R-7.1", "I-02"]]);
    expect(result.watch).toEqual(["R-6.1"]);
  });
});

describe("watchGroups", () => {
  it("forms a group from 3 close watched items only (CL-16)", () => {
    const close = (id: string, x: number) => ({ id, vector: [1, x, 0] });
    expect(watchGroups([close("R-1.1", 0), close("R-2.1", 0.05)], THRESHOLD, 3)).toEqual([]);
    expect(
      watchGroups(
        [
          close("R-2.1", 0.05),
          close("R-1.1", 0),
          close("R-3.1", 0.1),
          { id: "R-4.1", vector: [0, 0, 1] },
        ],
        THRESHOLD,
        3,
      ),
    ).toEqual([["R-1.1", "R-2.1", "R-3.1"]]);
  });
});

describe("incrementalRequestSchema", () => {
  const feedback = { channel: "email_client", source_type: "client_direct", raw_text: "Bonjour" };
  it("accepts 1 to 10 feedbacks and refuses unknown fields", () => {
    expect(incrementalRequestSchema.safeParse({ feedbacks: [feedback] }).success).toBe(true);
    expect(incrementalRequestSchema.safeParse({ feedbacks: [] }).success).toBe(false);
    expect(
      incrementalRequestSchema.safeParse({ feedbacks: Array(11).fill(feedback) }).success,
    ).toBe(false);
    expect(
      incrementalRequestSchema.safeParse({ feedbacks: [{ ...feedback, id: "R-001" }] }).success,
    ).toBe(false);
    expect(
      incrementalRequestSchema.safeParse({ feedbacks: [{ ...feedback, raw_text: "  " }] }).success,
    ).toBe(false);
  });
});

describe("describeFeedback", () => {
  it("says in French what happened to each item", () => {
    expect(
      describeFeedback({
        id: "R-300",
        status: "ok",
        error: null,
        items: [
          {
            id: "R-300.1",
            type: "bug",
            outcome: "rattache",
            insight_id: "I-01",
            insight_title: "Retards",
            similarity: 0.9,
          },
          {
            id: "R-300.2",
            type: "eloge",
            outcome: "non_regroupe",
            insight_id: null,
            insight_title: null,
            similarity: null,
          },
        ],
      }),
    ).toBe("R-300 : confirme un sujet connu : I-01 « Retards » ; non regroupé (eloge).");
    expect(describeFeedback({ id: "R-301", status: "failed", error: "x", items: [] })).toContain(
      "triage en échec",
    );
  });
});

// ---------------------------------------------------------------------------

/** A base after a first full run: I-01 (notifications, ranked, scored), I-02 (weak signal). */
async function seededWorld() {
  const tables = world();
  const common = {
    pack,
    skills: SKILLS,
    now: NOW,
    embedFn: fakeEmbed,
    estimate: { estimateFn: fakeEstimateFn as never },
    sleep: async () => {},
  };
  const graph = compilePipeline(
    { ...common, db: memoryDb(tables), invoke: fakeInvoke() },
    new MemorySaver(),
  );
  await runPipeline(graph, { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" });
  const db = memoryDb(tables);
  const invoke = fakeInvoke();
  const add = async (feedbacks: NewFeedback[]) =>
    runIncremental(db, await insertFeedbacks(db, feedbacks, NOW), { ...common, invoke });
  return { tables, add, invoke };
}

const fb = (raw_text: string, extra: Partial<NewFeedback> = {}): NewFeedback => ({
  channel: "email_client",
  source_type: "client_direct",
  raw_text,
  ...extra,
});

describe("runIncremental (in-memory database, simulated models)", () => {
  it("attaches a feedback close to a known topic and re-scores it in code", async () => {
    const { tables, add, invoke } = await seededWorld();
    const result = await add([fb("[topic:a] encore une notification ratée")]);

    expect(result.feedbacks).toMatchObject([
      {
        id: "R-011",
        status: "ok",
        items: [{ id: "R-011.1", outcome: "rattache", insight_id: "I-01" }],
      },
    ]);
    expect(result.feedbacks[0].summary).toContain("confirme un sujet connu : I-01");
    expect(tables.insight_items.filter((r) => r.insight_id === "I-01")).toHaveLength(7);
    expect(result.rescored).toEqual(["I-01"]);
    // Its stored judgment is reused: the new facts are computed in code, no model call.
    expect(invoke.mock.calls.filter((c) => c[3].name === "judge-insight")).toEqual([]);
    expect(tables.scores.filter((s) => s.insight_id === "I-01").map((s) => s.is_current)).toEqual([
      false,
      true,
    ]);
    expect(tables.pipeline_runs.at(-1)).toMatchObject({ kind: "incremental", status: "termine" });
    expect(result.alerts).toEqual({ created: [], enriched: [] });
  });

  it("queues an unknown topic, then proposes an insight at the third close item (CL-16, CL-51)", async () => {
    const { tables, add } = await seededWorld();
    const first = await add([fb("[topic:d] impossible de dupliquer une tâche")]);
    expect(first.feedbacks[0].items[0].outcome).toBe("surveille");
    const second = await add([fb("[topic:d] dupliquer une tâche, svp")]);
    expect(second.proposedInsights).toEqual([]);
    expect(tables.feedback_items.filter((i) => i.watch).map((i) => i.id)).toEqual([
      "R-011.1",
      "R-012.1",
    ]);

    const third = await add([fb("[topic:d] toujours pas de duplication")]);
    expect(third.proposedInsights).toMatchObject([
      { id: "I-03", title: "Problème de taches", item_ids: ["R-011.1", "R-012.1", "R-013.1"] },
    ]);
    expect(third.feedbacks[0].items[0]).toMatchObject({
      outcome: "nouvel_insight",
      insight_id: "I-03",
    });
    expect(tables.insights.find((i) => i.id === "I-03")).toMatchObject({
      status: "propose",
      ranked: false, // 3 feedbacks: a weak signal, scored only once it is ranked
    });
    expect(tables.feedback_items.some((i) => i.watch)).toBe(false);
    expect(third.alerts.created).toMatchObject([
      { kind: "nouveau_sujet", insight_id: "I-03", feedback_ids: ["R-011", "R-012", "R-013"] },
    ]);
  });

  it("raises one churn alert per account, enriched by a second feedback within 24 h (CL-55)", async () => {
    const { tables, add } = await seededWorld();
    const churn = (text: string) => fb(text, { customer_id: "C-001" });
    const first = await add([churn("[topic:a] [churn] on envisage de partir")]);
    expect(first.alerts.created).toMatchObject([
      { kind: "churn", insight_id: "I-01", feedback_ids: ["R-011"] },
    ]);
    const second = await add([churn("[topic:e] [churn] et l'intégration ne marche pas")]);
    expect(second.alerts).toMatchObject({
      created: [],
      enriched: [{ kind: "churn", added: ["R-012"] }],
    });
    expect(tables.alerts).toHaveLength(1);
    expect(tables.alerts[0]).toMatchObject({
      feedback_ids: ["R-011", "R-012"],
      status: "nouvelle",
      dossier_status: "en_cours",
    });
  });

  it("reports a failed triage without stopping the others (CL-11)", async () => {
    const { add } = await seededWorld();
    const result = await add([
      fb("[topic:a] [fail] texte"),
      fb("[topic:a] retard de notification"),
    ]);
    expect(result.feedbacks.map((f) => [f.id, f.status])).toEqual([
      ["R-011", "failed"],
      ["R-012", "ok"],
    ]);
    expect(result.failures).toMatchObject([{ step: "triage", id: "R-011" }]);
    expect(result.feedbacks[1].items[0].outcome).toBe("rattache");
  });

  it("refuses an empty or oversized batch", async () => {
    const { tables } = await seededWorld();
    await expect(
      runIncremental(memoryDb(tables), [], { pack, skills: SKILLS, now: NOW }),
    ).rejects.toThrow("1 à 10 retours");
  });
});
