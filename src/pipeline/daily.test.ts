import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { runDailyDigest } from "./daily";
import {
  fakeEmbed,
  fakeEstimateFn,
  fakeInvoke,
  feedbackRow,
  memoryDb,
  NOW,
  SKILLS,
  world,
} from "./fake-world";
import { compilePipeline, runPipeline } from "./graph";

const pack = await loadContextPack();

async function seeded() {
  const tables = world();
  const ctx = {
    pack,
    skills: SKILLS,
    now: NOW,
    embedFn: fakeEmbed,
    estimate: { estimateFn: fakeEstimateFn as never },
    sleep: async () => {},
    invoke: fakeInvoke(),
  };
  await runPipeline(compilePipeline({ ...ctx, db: memoryDb(tables) }, new MemorySaver()), {
    runId: "11111111-1111-4111-8111-111111111111",
    reachMode: "comptes",
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // Feedbacks arrived since, never processed (the cron's job).
  for (let i = 0; i < 12; i++) {
    tables.feedbacks.push(
      feedbackRow(`[topic:a] notification manquée ${i}`, { created_at: new Date().toISOString() }),
    );
  }
  return { tables, ctx };
}

describe("runDailyDigest", () => {
  it("absorbs the pending feedbacks by batches of 10, then writes the digest", async () => {
    const { tables, ctx } = await seeded();
    const result = await runDailyDigest(memoryDb(tables), ctx, { budgetMs: 60_000 });
    expect(result.processed).toHaveLength(12);
    expect(result.postponed).toEqual([]);
    const runs = tables.pipeline_runs.map((r) => [r.kind, r.status]);
    expect(runs.filter(([k]) => k === "incremental")).toHaveLength(2); // 10 + 2
    expect(runs.at(-1)).toEqual(["digest", "termine"]);
    const digest = tables.digests.at(-1)!;
    expect(digest.id).toBe(result.digest.id);
    expect(
      (digest.content as { facts: { feedbacks: { total: number } } }).facts.feedbacks.total,
    ).toBe(12);
  });

  it("postpones the batches beyond the time budget but still writes the digest", async () => {
    const { tables, ctx } = await seeded();
    const result = await runDailyDigest(memoryDb(tables), ctx, { budgetMs: 0 });
    expect(result.processed).toEqual([]);
    expect(result.postponed).toHaveLength(12);
    expect(result.digest.writer).toBe("modele");
    expect(tables.pipeline_runs.at(-1)).toMatchObject({ kind: "digest", status: "termine" });
  });
});
