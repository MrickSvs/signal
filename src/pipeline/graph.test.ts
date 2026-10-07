import { readFileSync } from "node:fs";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { loadContextPack } from "@/lib/context";
import { fakeEmbed, fakeEstimateFn, fakeInvoke, memoryDb, NOW, SKILLS, world } from "./fake-world";
import { addCostTotals, chunk, compilePipeline, runPipeline, type PipelineContext } from "./graph";

const pack = await loadContextPack();

function context(
  tables: ReturnType<typeof world>,
  overrides: Partial<PipelineContext> = {},
): PipelineContext {
  return {
    db: memoryDb(tables),
    pack,
    skills: SKILLS,
    now: NOW,
    triageBatchSize: 4,
    invoke: fakeInvoke(),
    embedFn: fakeEmbed,
    estimate: { estimateFn: fakeEstimateFn as never },
    sleep: async () => {},
    ...overrides,
  };
}

const RUN = "11111111-1111-4111-8111-111111111111";
const triageCalls = (invoke: ReturnType<typeof fakeInvoke>) =>
  invoke.mock.calls.filter((c) => c[3].name === "triage-feedback").length;

describe("chunk", () => {
  it("splits a list in batches of a given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("addCostTotals", () => {
  it("sums the totals and the cost of each node, even from a checkpoint without byNode", () => {
    const legacy = { eur: 1, tokensIn: 10, tokensOut: 2 } as never;
    const sum = addCostTotals(legacy, {
      eur: 0.5,
      tokensIn: 5,
      tokensOut: 1,
      byNode: { triage: 0.5 },
    });
    expect(sum).toEqual({ eur: 1.5, tokensIn: 15, tokensOut: 3, byNode: { triage: 0.5 } });
    expect(
      addCostTotals(sum, { eur: 0.25, tokensIn: 0, tokensOut: 0, byNode: { triage: 0.25 } }).byNode,
    ).toEqual({ triage: 0.75 });
  });
});

describe("pipeline graph (in-memory database, simulated models)", () => {
  it("runs end to end: triage fan-out, clustering, estimate, score; no alert on a first run", async () => {
    const tables = world();
    const ctx = context(tables);
    const graph = compilePipeline(ctx, new MemorySaver());
    const state = await runPipeline(graph, { runId: RUN, reachMode: "comptes" });

    expect(triageCalls(ctx.invoke as never)).toBe(10); // 10 feedbacks, batches of 4 (Send)
    expect(state.triaged.toSorted()).toEqual(tables.feedbacks.map((f) => f.id));
    expect(state.failures).toEqual([]);
    expect(tables.feedbacks.every((f) => f.ingested_run_id === RUN)).toBe(true);
    expect(tables.insights.map((i) => [i.id, i.status, i.product_area, i.ranked])).toEqual([
      ["I-01", "propose", "notifications", true],
      ["I-02", "propose", "performance", false],
    ]);
    expect(tables.scores.map((s) => [s.insight_id, s.rank, s.is_current])).toEqual([
      ["I-01", 1, true],
    ]);
    expect(tables.scores[0].judgment).toMatchObject({ impact: 1 });
    expect(state.stats).toMatchObject({
      ingest: { pending: 10 },
      triage: { ok: 10, failed: 0 },
      embed: { embedded: 10 },
      cluster: { created: ["I-01", "I-02"], ranked: ["I-01"] },
      estimate: { insights: 1, cached: 1 },
      score: { ranked: ["I-01"], judged: 1 },
      alert: { skipped: "premier run" },
    });
    expect(tables.alerts).toEqual([]);
    // Évals screen: the cost of the run, split by node, adds up to the total.
    const byNode = Object.values(state.cost.byNode).reduce((a, b) => a + b, 0);
    expect(byNode).toBeCloseTo(state.cost.eur, 10);
    expect(Object.keys(state.cost.byNode)).toContain("triage");
  });

  it("records a failed feedback without stopping the run (CL-11)", async () => {
    const tables = world();
    tables.feedbacks[7].raw_text = "[topic:b] [fail] lenteur";
    const state = await runPipeline(compilePipeline(context(tables), new MemorySaver()), {
      runId: RUN,
      reachMode: "comptes",
    });
    expect(state.failures).toMatchObject([{ step: "triage", id: "R-008" }]);
    expect(state.triaged).toHaveLength(9);
    expect(tables.feedback_analyses.find((a) => a.feedback_id === "R-008")?.status).toBe("failed");
    expect(state.stats).toMatchObject({ score: { ranked: ["I-01"] } });
  });

  it("resumes an interrupted run from its checkpoint without replaying finished nodes (CL-13)", async () => {
    const tables = world();
    const invoke = fakeInvoke();
    let failures = 2; // the node's retry policy absorbs one: two failures interrupt the run
    const flakyEmbed = vi.fn(async (texts: string[]) => {
      if (failures-- > 0) throw new Error("Voyage indisponible");
      return fakeEmbed(texts);
    });
    const checkpointer = new MemorySaver();
    const graph = compilePipeline(context(tables, { invoke, embedFn: flakyEmbed }), checkpointer);

    await expect(runPipeline(graph, { runId: RUN, reachMode: "comptes" })).rejects.toThrow(
      "Voyage indisponible",
    );
    expect(triageCalls(invoke)).toBe(10);
    expect(tables.insights).toEqual([]);

    const state = await runPipeline(graph, { runId: RUN, reachMode: "comptes", resume: true });
    expect(triageCalls(invoke)).toBe(10); // ingest and triage are not replayed
    expect(state.triaged).toHaveLength(10);
    expect(tables.insights.map((i) => i.id)).toEqual(["I-01", "I-02"]);

    // Resuming a finished run returns its final state without running anything.
    invoke.mockClear();
    const again = await runPipeline(graph, { runId: RUN, reachMode: "comptes", resume: true });
    expect(invoke).not.toHaveBeenCalled();
    expect(again.stats).toMatchObject({ score: { ranked: ["I-01"] } });
  });

  it("counts the whole batch when it is replayed after a failure mid-batch", async () => {
    const tables = world();
    const db = memoryDb(tables);
    let failOnce = true;
    // The write of R-003's analysis fails once: the node throws after R-001 and R-002 were
    // written, and its retry skips them (already triaged) but must still count them.
    const flaky = {
      from(table: string) {
        const query = db.from(table as never);
        if (table !== "feedback_analyses") return query;
        return {
          ...query,
          upsert: (row: { feedback_id: string }, opts: unknown) => {
            if (row.feedback_id === "R-003" && failOnce) {
              failOnce = false;
              return Promise.resolve({ data: null, error: { message: "réseau" } });
            }
            return (query as never as { upsert: (r: unknown, o: unknown) => unknown }).upsert(
              row,
              opts,
            );
          },
        };
      },
    } as unknown as typeof db;
    const invoke = fakeInvoke();
    const ctx = context(tables, { db: flaky, invoke, triageBatchSize: 10 });
    const state = await runPipeline(compilePipeline(ctx, new MemorySaver()), {
      runId: RUN,
      reachMode: "comptes",
    });
    expect(state.triaged.toSorted()).toEqual(tables.feedbacks.map((f) => f.id));
    expect(state.stats).toMatchObject({ triage: { ok: 10, failed: 0 } });
  });

  it("raises alerts on a later run, for the feedbacks of that run only", async () => {
    const tables = world();
    await runPipeline(compilePipeline(context(tables), new MemorySaver()), {
      runId: RUN,
      reachMode: "comptes",
    });
    // A churn signal from an Enterprise account renewing in 60 days.
    tables.feedbacks.push({
      ...tables.feedbacks[0],
      id: "R-050",
      customer_id: "C-001",
      raw_text: "[topic:a] [churn] on va partir",
      ingested_run_id: null,
    });
    const state = await runPipeline(compilePipeline(context(tables), new MemorySaver()), {
      runId: "22222222-2222-4222-8222-222222222222",
      reachMode: "comptes",
    });
    expect(state.triaged).toEqual(["R-050"]);
    expect(tables.alerts).toMatchObject([
      { kind: "churn", insight_id: "I-01", feedback_ids: ["R-050"], dossier_status: "en_cours" },
    ]);
  });
});

describe("docs/ARCHITECTURE.md", () => {
  it("shows the current graph in Mermaid (section « Pipeline »)", async () => {
    const graph = compilePipeline(context(world()));
    const mermaid = (await graph.getGraphAsync()).drawMermaid().trim();
    const doc = readFileSync("docs/ARCHITECTURE.md", "utf8");
    expect(doc).toContain("## Pipeline");
    expect(doc).toContain(mermaid);
  });
});
