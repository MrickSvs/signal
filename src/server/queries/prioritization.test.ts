import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import type { MemoryTables } from "@/lib/db/memory";
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
import { insightNeed, problemHash } from "@/services/estimate";
import { getPrioritizationScreen, type ParamCell } from "./prioritization";

const pack = await loadContextPack();

/** After a first full run: I-01 is ranked; its estimate is stored as estimateInsight does. */
async function seeded(): Promise<MemoryTables> {
  const tables = world();
  await runPipeline(
    compilePipeline(
      {
        pack,
        skills: SKILLS,
        now: NOW,
        embedFn: fakeEmbed,
        estimate: { estimateFn: fakeEstimateFn as never },
        sleep: async () => {},
        db: memoryDb(tables),
        invoke: fakeInvoke(),
      },
      new MemorySaver(),
    ),
    { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" },
  );
  const insight = tables.insights.find((i) => i.id === "I-01")!;
  tables.complexity_estimates = [
    {
      id: "est-I-01",
      insight_id: "I-01",
      item_id: null,
      problem_hash: problemHash(insightNeed(insight as never).statement),
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
  return tables;
}

const cell = (cells: ParamCell[], param: ParamCell["param"]) =>
  cells.find((c) => c.param === param)!;

describe("getPrioritizationScreen", () => {
  it("marks the estimate of a reworded insight, which stays ranked (F1)", async () => {
    const tables = await seeded();
    const before = await getPrioritizationScreen(memoryDb(tables), "comptes");
    const effort = cell(before.rows.find((r) => r.id === "I-01")!.params, "effort");
    expect(effort.breakdown.map((l) => l.label)).not.toContain(
      "Énoncé modifié depuis l'estimation",
    );

    const insight = tables.insights.find((i) => i.id === "I-01")!;
    insight.problem_statement = "Les assignés apprennent trop tard qu'une tâche leur revient.";
    const after = await getPrioritizationScreen(memoryDb(tables), "comptes");
    expect(after.pending.map((p) => p.id)).not.toContain("I-01");
    const stale = cell(after.rows.find((r) => r.id === "I-01")!.params, "effort");
    expect(stale.breakdown).toContainEqual({
      label: "Énoncé modifié depuis l'estimation",
      value: "nouvelle estimation au prochain run",
    });
    expect(stale.breakdown).toContainEqual({ label: "Fourchette estimée", value: "3–5 pts (M)" });
  });
});
