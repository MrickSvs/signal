import { describe, expect, it, vi } from "vitest";
import { loadContextPack } from "@/lib/context";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { EMPTY_USAGE } from "@/lib/llm/cost";
import type { invokeStructured } from "@/lib/llm/structured";
import { clusterItems, resolveCommitments, runClustering, type ClusteringItem } from "./insights";

const { weighting, commitments } = await loadContextPack();
const now = new Date("2026-06-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000).toISOString();

// Three topics as orthogonal directions: a = notifications, b and c = personnalisation.
const DIRECTIONS: Record<string, number[]> = { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] };
const vector = (topic: string, n: number) =>
  JSON.stringify(DIRECTIONS[topic].map((x, d) => x + 0.02 * ((n + d) % 3)));

function world(): MemoryTables {
  const customers = [
    {
      id: "C-001",
      name: "Atelier Mercure",
      status: "client",
      segment: "agence_com",
      plan: "enterprise",
      mrr_eur: 4200,
      renewal_date: "2026-07-15",
      email_domain: "mercure.fr",
    },
    {
      id: "C-002",
      name: "Studio Pro",
      status: "client",
      segment: "agence_digitale",
      plan: "pro",
      mrr_eur: 60,
      renewal_date: null,
      email_domain: "studio-pro.fr",
    },
  ];
  const feedbacks: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const analyses: Record<string, unknown>[] = [];
  let n = 0;
  const add = (
    topic: string,
    area: string,
    count: number,
    extra: { customer?: string; type?: string; age?: number } = {},
  ) => {
    for (let i = 0; i < count; i++) {
      const id = `R-${String(++n).padStart(3, "0")}`;
      feedbacks.push({
        id,
        channel: i % 2 ? "ticket_support" : "commentaire_in_app",
        source_type: i % 2 ? "support" : "client_direct",
        author_name: null,
        author_email: null,
        customer_id: extra.customer ?? null,
        subject: null,
        raw_text: "…",
        received_at: daysAgo(extra.age ?? 2 + i),
      });
      items.push({
        id: `${id}.1`,
        feedback_id: id,
        type: extra.type ?? "bug",
        product_area: area,
        underlying_problem: `Problème ${topic} ${i}`,
        summary: `Résumé ${topic} ${i}`,
        expressed_request: i < 2 ? `Solution ${topic}` : null,
        embedding: vector(topic, i),
      });
      analyses.push({ feedback_id: id, status: "ok", churn_signal: false, created_at: daysAgo(0) });
    }
  };
  add("a", "notifications", 6, { customer: "C-002" });
  add("b", "personnalisation", 3);
  add("c", "personnalisation", 3, { customer: "C-001" });
  add("a", "notifications", 1, { type: "eloge" }); // praise: never clustered
  return {
    customers,
    feedbacks,
    feedback_items: items,
    feedback_analyses: analyses,
    insights: [],
    insight_items: [],
    insight_relations: [],
  };
}

const memoryDb = (tables: MemoryTables) =>
  createMemoryDb(tables, {
    defaults: {
      insights: (_row, table) => ({
        id: `I-${String(table.length + 1).padStart(2, "0")}`,
        origin: "retours",
        status: "propose",
        title_locked: false,
        merged_into: null,
        expressed_requests: [],
      }),
      insight_relations: (_row, table) => ({ id: `rel-${table.length + 1}` }),
    },
  });

const humanText = (messages: Parameters<typeof invokeStructured>[2]) => String(messages[1].content);

/** Fake reasoning model: names insights after their area, sees a tension between b and c. */
function fakeInvoke() {
  return vi.fn(async (_role, _schema, messages, options) => {
    const text = humanText(messages);
    if (options.name === "label-insight") {
      const area = /\[\w+ \/ (\w+)\]/.exec(text)![1];
      const ids = [...text.matchAll(/(R-\d{3}\.\d) : /g)].map((m) => m[1]);
      return {
        data: {
          title: `Problème de ${area}`,
          problem_statement: `Les utilisateurs souffrent d'un problème de ${area}.`,
          product_area: area,
          // An invented id (R-999.1) and an id without request must be dropped by the code.
          expressed_requests: [{ solution: "Une solution", item_ids: [...ids, "R-999.1"] }],
        },
        usage: EMPTY_USAGE,
      };
    }
    if (options.name === "consolidate-insights")
      return { data: { merges: [] }, usage: EMPTY_USAGE };
    const section = text.split("## Domaine personnalisation")[1] ?? "";
    const keys = [...section.matchAll(/^(\S+) \(\d+ items\)/gm)].map((m) => m[1]);
    return {
      data: {
        tensions:
          keys.length === 2
            ? [
                {
                  a: keys[0],
                  b: keys[1],
                  segments: [
                    { segment: "Free / Pro", position: "moins d'options" },
                    { segment: "Enterprise", position: "plus de champs" },
                  ],
                  rationale: "Demandes opposées.",
                },
              ]
            : [],
      },
      usage: EMPTY_USAGE,
    };
  }) as unknown as typeof invokeStructured & ReturnType<typeof vi.fn>;
}

const run = (tables: MemoryTables, invoke: ReturnType<typeof fakeInvoke>, runId: string) =>
  runClustering(memoryDb(tables), {
    runId,
    weighting,
    now,
    commitments,
    label: { skill: "skill triage-taxonomy" },
    deps: { invoke, sleep: async () => {} },
  });

describe("clusterItems", () => {
  it("leaves praise, questions and « autre » out of the clustering (CL-04)", () => {
    const item = (id: string, type: ClusteringItem["type"], v: number[]): ClusteringItem => ({
      id,
      feedback_id: id.split(".")[0],
      type,
      product_area: "taches",
      underlying_problem: "p",
      summary: "s",
      expressed_request: null,
      vector: v,
    });
    const result = clusterItems(
      [
        item("R-1.1", "bug", [1, 0]),
        item("R-2.1", "bug", [1, 0.01]),
        item("R-3.1", "eloge", [1, 0]),
        item("R-4.1", "question", [1, 0]),
        item("R-5.1", "autre", [1, 0]),
      ],
      { distanceThreshold: 0.28, minClusterSize: 2 },
    );
    expect(result).toEqual({
      clusters: [{ itemIds: ["R-1.1", "R-2.1"] }],
      unclustered: [],
      eligible: 2,
    });
  });
});

describe("resolveCommitments", () => {
  it("finds the account of each commitment by name, and reports the unknown ones", () => {
    expect(
      resolveCommitments(commitments, [
        { id: "C-077", name: "Atelier  Mercure" },
        { id: "C-001", name: "Autre" },
      ]),
    ).toEqual({
      coverage: [
        {
          customerId: "C-077",
          productAreas: ["permissions_partage"],
          account: "Atelier Mercure",
          dueInDays: 75,
        },
      ],
      unknown: [],
    });
    expect(resolveCommitments(commitments, []).unknown).toEqual(["Atelier Mercure"]);
  });
});

describe("runClustering (in-memory database, simulated model)", () => {
  it("creates « propose » insights, then keeps the same ids without calling the model (CL-14, CL-51)", async () => {
    const tables = world();
    const invoke = fakeInvoke();
    const first = await run(tables, invoke, "run-1");

    expect(tables.insights.map((i) => [i.id, i.status, i.title, i.product_area])).toEqual([
      ["I-01", "propose", "Problème de notifications", "notifications"],
      ["I-02", "propose", "Problème de personnalisation", "personnalisation"],
      ["I-03", "propose", "Problème de personnalisation", "personnalisation"],
    ]);
    const i01 = tables.insights[0];
    expect(i01).toMatchObject({
      ranked: true, // 6 feedbacks
      accounts_count: 1, // the same account on two channels (CL-02)
      channels: { commentaire_in_app: 3, ticket_support: 3 },
      first_run_id: "run-1",
      last_run_id: "run-1",
    });
    // Request frequency counted in code; the invented id and the ids without request are dropped.
    expect(i01.expressed_requests).toEqual([
      { solution: "Une solution", frequency: 2, item_ids: ["R-001.1", "R-002.1"] },
    ]);
    expect((i01.trend as { is_new: boolean }).is_new).toBe(true);
    // Small insights are weak signals (CL-17)…
    expect(tables.insights[1].ranked).toBe(false);
    // …unless covered by a commitment: Atelier Mercure, permissions only — not personnalisation.
    expect(tables.insights[2].ranked).toBe(false);

    // The praise item is in no insight; representatives are flagged.
    expect(tables.insight_items.some((r) => r.item_id === "R-013.1")).toBe(false);
    expect(tables.insight_items.filter((r) => r.insight_id === "I-01")).toHaveLength(6);
    expect(
      tables.insight_items.every((r) => r.is_representative && typeof r.similarity === "number"),
    ).toBe(true);
    expect(tables.insight_relations).toMatchObject([
      { insight_a: "I-02", insight_b: "I-03", kind: "tension", run_id: "run-1" },
    ]);
    expect(first.labelCalls).toBe(3);

    // Second run, same data: same ids, same items, same tension, no model call.
    invoke.mockClear();
    const snapshot = structuredClone({
      items: tables.insight_items,
      rel: tables.insight_relations,
    });
    const second = await run(tables, invoke, "run-2");
    expect(invoke).not.toHaveBeenCalled();
    expect(tables.insights.map((i) => i.id)).toEqual(["I-01", "I-02", "I-03"]);
    expect({ items: tables.insight_items, rel: tables.insight_relations }).toEqual(snapshot);
    expect(second.events).toEqual([]);
    expect(second.tensions).toMatchObject([{ a: "I-02", b: "I-03", kept: true }]);
    expect(tables.insights[0].last_run_id).toBe("run-2");
  });

  it("keeps the PO's decisions: rejected stays rejected, a locked title is never rewritten (CL-53)", async () => {
    const tables = world();
    const invoke = fakeInvoke();
    await run(tables, invoke, "run-1");

    // The PO rejects I-02 and rewords I-01; a new feedback joins I-01's topic.
    Object.assign(tables.insights[1], { status: "rejete" });
    Object.assign(tables.insights[0], {
      status: "actif",
      title_locked: true,
      title: "Titre de Léa",
      problem_statement: "Énoncé de Léa.",
    });
    tables.feedbacks.push({ ...tables.feedbacks[0], id: "R-050", received_at: daysAgo(1) });
    tables.feedback_items.push({
      ...tables.feedback_items[0],
      id: "R-050.1",
      feedback_id: "R-050",
      embedding: vector("a", 4),
    });
    tables.feedback_analyses.push({
      feedback_id: "R-050",
      status: "ok",
      churn_signal: false,
      created_at: daysAgo(0),
    });

    invoke.mockClear();
    const summary = await run(tables, invoke, "run-2");
    const labelCalls = invoke.mock.calls.filter((c) => c[3].name === "label-insight");
    expect(labelCalls).toHaveLength(1); // only I-01 changed; a rejected insight is not relabelled
    expect(tables.insights[0]).toMatchObject({
      id: "I-01",
      status: "actif",
      title: "Titre de Léa",
      problem_statement: "Énoncé de Léa.",
      product_area: "notifications",
    });
    expect(tables.insight_items.filter((r) => r.insight_id === "I-01")).toHaveLength(7);
    expect(tables.insights[1]).toMatchObject({ id: "I-02", status: "rejete", ranked: false });
    // A tension needs two live insights: the one with the rejected insight goes.
    expect(tables.insight_relations).toEqual([]);
    expect(summary.insights.find((i) => i.id === "I-01")).toMatchObject({ relabelled: true });
  });

  it("does not create an insight whose label failed; its items wait for the next run (CL-11)", async () => {
    const tables = world();
    const good = fakeInvoke();
    const invoke = vi.fn(async (...args: Parameters<typeof invokeStructured>) => {
      if (args[3].name === "label-insight" && humanText(args[2]).includes("notifications")) {
        throw new Error("API indisponible");
      }
      return good(...args);
    }) as unknown as ReturnType<typeof fakeInvoke>;
    const summary = await run(tables, invoke, "run-1");
    expect(tables.insights.map((i) => i.product_area)).toEqual([
      "personnalisation",
      "personnalisation",
    ]);
    expect(summary.failures).toMatchObject([{ pass: "label", error: "API indisponible" }]);
  });
});
