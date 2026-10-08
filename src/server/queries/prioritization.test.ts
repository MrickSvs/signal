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
import { applyOverride } from "@/services/prioritization";
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

  it("shows a Reach override only in the mode it was entered in (F5)", async () => {
    const tables = await seeded();
    const db = memoryDb(tables);
    const deps = {
      pack,
      skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
      now: NOW,
      source: "signal_ui" as const,
    };
    await applyOverride(
      db,
      { insight_id: "I-01", param: "reach", mode: "comptes", value: 40, reason: "Salon pro" },
      deps,
    );
    await applyOverride(
      db,
      { insight_id: "I-01", param: "impact", mode: "comptes", value: 3, reason: "Direction" },
      deps,
    );
    const params = async (mode: "comptes" | "mrr") =>
      (await getPrioritizationScreen(memoryDb(tables), mode)).rows.find((r) => r.id === "I-01")!
        .params;

    const inAccounts = await params("comptes");
    expect(cell(inAccounts, "reach")).toMatchObject({ source: "ecrase", display: "40" });
    expect(cell(inAccounts, "reach").override).toMatchObject({ reason: "Salon pro" });

    // In MRR, the value is computed: no reason to show, no override to cancel from this mode.
    const inMrr = await params("mrr");
    expect(cell(inMrr, "reach")).toMatchObject({ source: "calcule", override: null });
    // It is still mentioned where a new value would be typed: saving one here replaces it.
    expect(cell(inMrr, "reach").input.hint).toContain("Ton override en mode comptes (40)");
    expect(cell(inAccounts, "reach").input.hint).toBe("S'applique au mode comptes seulement.");
    // An Impact override has no unit: it applies, and shows, in both modes.
    expect(cell(inMrr, "impact").override).toMatchObject({ reason: "Direction" });
  });
});
