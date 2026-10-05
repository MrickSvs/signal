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
import { applyDecision, logRefusal } from "./apply-decision";
import { insightNeed, problemHash } from "./estimate";

const pack = await loadContextPack();

/** After a first full run: I-01 (ranked, proposed, estimated) and I-02 (weak signal, proposed). */
async function seeded() {
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
  // I-01's estimate in the cache, so that it gets a score (as in prioritization.test.ts).
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
  const deps = {
    pack,
    skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
    now: NOW,
    source: "chat" as const,
    scoring: { invoke: fakeInvoke(), estimateFn: fakeEstimateFn as never },
  };
  return { tables, db, deps };
}

describe("applyDecision (in-memory database, simulated models)", () => {
  it("applies a challenged MoSCoW: the override and Signal's disagreement are logged", async () => {
    const { tables, db, deps } = await seeded();
    const result = await applyDecision(
      db,
      {
        kind: "moscow",
        target: "I-01",
        value: "must",
        reason: "La direction le veut pour le salon",
        signal_position: "Must non justifié par les retours, dépasse la capacité.",
      },
      deps,
    );
    expect(result).toMatchObject({ kind: "moscow", target: "I-01" });
    expect(tables.overrides).toMatchObject([
      { insight_id: "I-01", param: "moscow", value: "must" },
    ]);
    expect(tables.decisions).toMatchObject([
      { actor: "po", source: "chat", action: "override", field: "moscow", after: "must" },
      {
        actor: "signal",
        source: "chat",
        entity_type: "insight",
        entity_id: "I-01",
        action: "desaccord",
        field: "moscow",
        reason: "Must non justifié par les retours, dépasse la capacité.",
      },
    ]);
    expect(result.disagreement).toBe(tables.decisions[1].id);
  });

  it("refuses an invalid override value before any write (CL-23)", async () => {
    const { tables, db, deps } = await seeded();
    await expect(
      applyDecision(
        db,
        { kind: "override", target: "I-01", param: "impact", value: 4, reason: "x" },
        deps,
      ),
    ).rejects.toThrow(/Impact attendu/);
    await expect(
      applyDecision(
        db,
        { kind: "override", target: "I-01", param: "confidence", value: 70, reason: "x" },
        deps,
      ),
    ).rejects.toThrow(/Confidence attendue/);
    await expect(
      applyDecision(db, { kind: "override", target: "I-01", param: "effort", value: 2 }, deps),
    ).rejects.toThrow(/raison est obligatoire/);
    expect(tables.overrides).toHaveLength(0);
    expect(tables.decisions).toHaveLength(0);
  });

  it("reviews a proposed insight through the shared service: reword → active, title locked (CL-51)", async () => {
    const { tables, db, deps } = await seeded();
    await applyDecision(
      db,
      {
        kind: "insight_review",
        target: "I-02",
        value: "reformuler",
        title: "Exports PDF illisibles",
        problem_statement: "Les exports PDF des rapports sont illisibles pour les clients finaux.",
      },
      deps,
    );
    const i02 = tables.insights.find((i) => i.id === "I-02")!;
    expect(i02).toMatchObject({
      status: "actif",
      title_locked: true,
      title: "Exports PDF illisibles",
    });
    expect(tables.decisions).toMatchObject([
      { entity_id: "I-02", action: "modification", field: "formulation", source: "chat" },
    ]);
  });

  it("validates a backlog draft, and refuses an item that is not a draft", async () => {
    const { tables, db, deps } = await seeded();
    tables.backlog_items.push(
      {
        id: "US-001",
        kind: "story",
        status: "brouillon",
        title: "Filtrer",
        insight_id: "I-01",
      } as never,
      {
        id: "US-002",
        kind: "story",
        status: "envoye",
        title: "Exporter",
        insight_id: "I-01",
      } as never,
    );
    await applyDecision(db, { kind: "validation", target: "US-001", value: "valide" }, deps);
    expect(tables.backlog_items[0].status).toBe("valide");
    expect(tables.decisions).toMatchObject([
      {
        entity_type: "backlog_item",
        entity_id: "US-001",
        action: "validation",
        before: "brouillon",
        after: "valide",
      },
    ]);
    await expect(
      applyDecision(db, { kind: "validation", target: "US-002", value: "valide" }, deps),
    ).rejects.toThrow(/à modifier dans Notion/);
  });
});

describe("logRefusal", () => {
  it("logs a refused card as the PO's rejection of Signal's proposal, nothing else", async () => {
    const { tables, db, deps } = await seeded();
    const id = await logRefusal(
      db,
      { kind: "moscow", target: "I-01", value: "must" },
      deps,
      "Pas ce trimestre",
    );
    expect(tables.overrides).toHaveLength(0);
    expect(tables.decisions).toMatchObject([
      {
        id,
        actor: "po",
        source: "chat",
        entity_type: "insight",
        entity_id: "I-01",
        action: "rejet",
        field: "proposition_signal",
        after: { kind: "moscow", value: "must", summary: "MoSCoW final de I-01 : Must" },
        reason: "Pas ce trimestre",
      },
    ]);
    expect(tables.insights.find((i) => i.id === "I-01")!.status).toBe("propose");
  });
});
