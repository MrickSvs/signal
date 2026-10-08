import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import type { InsightCard } from "@/lib/insights/list";
import { loadContextPack } from "@/lib/context";
import { RunCost } from "@/lib/llm/cost";
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
import type { StoredEstimate } from "@/services/estimate";
import { getRanking } from "@/services/prioritization";
import { touchThread, threadTitle } from "../threads";
import { MODELS } from "@/lib/llm/models";
import { PIPELINE_TRIAGE_MODEL, TRIAGE_MODEL_ROLES } from "@/pipeline/nodes/triage";
import { ADD_FEEDBACK_MODELS, addFeedbackTool } from "./add-feedback";
import { compactEstimate } from "./estimate-complexity";
import { compactRanking } from "./get-priority";
import { loadSkillTool } from "./load-skill";
import { listInsightsSchema, selectInsights } from "./list-insights";
import {
  MISSING_DATA,
  queryCustomersSchema,
  selectCustomers,
  type CustomerRow,
} from "./query-customers";
import { excerpt, type AgentDeps, type TurnContext } from "./shared";

const pack = await loadContextPack();

const customer = (id: string, extra: Partial<CustomerRow> = {}): CustomerRow => ({
  id,
  name: `Agence ${id}`,
  status: "client",
  segment: "agence_com",
  plan: "business",
  seats: 10,
  mrr_eur: 500,
  renewal_date: null,
  health: "vert",
  csm: "Inès",
  ...extra,
});

describe("query_customers", () => {
  const customers = [
    customer("C-001", {
      plan: "enterprise",
      mrr_eur: 4000,
      renewal_date: "2026-07-01",
      health: "rouge",
    }),
    customer("C-002", { plan: "enterprise", mrr_eur: 3000, renewal_date: "2026-12-01" }),
    customer("C-003", { plan: "pro", mrr_eur: 60, renewal_date: "2026-06-10" }),
    customer("C-004", { status: "prospect", plan: null, mrr_eur: 0 }),
  ];
  const insightsOf = new Map([
    ["C-001", ["I-03", "I-07"]],
    ["C-003", ["I-07"]],
  ]);
  const query = (input: object) =>
    selectCustomers(customers, insightsOf, queryCustomersSchema.parse(input), NOW);

  it("filters on renewal from the scenario date and totals every match in code", () => {
    const result = query({ renewal_within_days: 45 });
    expect(result.comptes.map((c) => [c.id, c.renouvelle_dans_jours])).toEqual([
      ["C-001", 30],
      ["C-003", 9],
    ]);
    expect(result.totaux).toEqual({ comptes: 2, clients: 2, mrr_eur: 4060 });
  });

  it("finds the accounts touched by an insight, by plan or by name", () => {
    expect(query({ insight_id: "I-07" }).comptes.map((c) => c.id)).toEqual(["C-001", "C-003"]);
    expect(query({ plan: "enterprise", health: "rouge" }).comptes.map((c) => c.id)).toEqual([
      "C-001",
    ]);
    expect(query({ name: "c-004" }).comptes[0]).toMatchObject({ statut: "prospect", insights: [] });
  });

  it("says which data does not exist instead of computing it (CL-29)", () => {
    expect(query({}).donnees_disponibles).toBe(MISSING_DATA);
    expect(MISSING_DATA).toContain("churn passé");
  });

  it("bounds the list to 10 accounts but keeps the full total", () => {
    const many = Array.from({ length: 14 }, (_, i) => customer(`C-1${String(i).padStart(2, "0")}`));
    const result = selectCustomers(many, new Map(), queryCustomersSchema.parse({}), NOW);
    expect(result.comptes).toHaveLength(10);
    expect(result.total).toBe(14);
    expect(result.totaux.mrr_eur).toBe(7000);
  });
});

const card = (id: string, extra: Partial<InsightCard> = {}): InsightCard => ({
  id,
  title: `Titre ${id}`,
  problem_statement: "Énoncé",
  product_area: "taches",
  origin: "retours",
  status: "actif",
  ranked: true,
  merged_into: null,
  feedbacks_count: 5,
  accounts_count: 3,
  mrr_exposed: 100,
  renewals_90d: 0,
  plans: { business: 2 },
  segments: { agence_com: 3 },
  weekly: [],
  growth: 1,
  is_emerging: false,
  is_new: false,
  rank: null,
  moscow: null,
  moscow_is_final: false,
  alignment: null,
  ...extra,
});

describe("list_insights", () => {
  const cards = [
    card("I-01", { rank: 2 }),
    card("I-02", { rank: 1, plans: { enterprise: 1 }, segments: { cabinet_conseil: 1 } }),
    card("I-03", { status: "propose", ranked: false, is_emerging: true }),
    card("I-04", { status: "fusionne", merged_into: "I-01" }),
  ];
  const select = (input: object) => selectInsights(cards, listInsightsSchema.parse(input));

  it("lists the live insights by rank by default", () => {
    const result = select({});
    expect(result.insights.map((i) => i.id)).toEqual(["I-02", "I-01", "I-03"]);
    expect(result.total).toBe(3);
  });

  it("filters on plan, segment, trend and status", () => {
    expect(select({ plan: "enterprise" }).insights.map((i) => i.id)).toEqual(["I-02"]);
    expect(select({ segment: "agence_com" }).insights.map((i) => i.id)).toEqual(["I-01", "I-03"]);
    expect(select({ emerging: true }).insights.map((i) => i.id)).toEqual(["I-03"]);
    expect(select({ status: "fusionne" }).insights[0]).toMatchObject({
      id: "I-04",
      fusionne_dans: "I-01",
    });
  });
});

describe("estimate_complexity", () => {
  const stored: StoredEstimate = {
    id: "est-1",
    cached: true,
    estimate: {
      components: ["notifications"],
      points_min: 5,
      points_max: 13,
      tshirt_min: "M",
      tshirt_max: "L",
      confidence: "basse",
      analogies: [
        { ticket_id: "T-104", raison: "même module", similarity: 0.512, close: false },
        { ticket_id: "T-120", raison: "proche", similarity: 0.4, close: false },
      ],
      rationale: "…",
      risks: ["préférence digest mal lue"],
      model: "m",
      adjustments: {
        raw: { min: 5, max: 8, confidence: "moyenne" },
        bias: { applied: false, factor: 1, tickets: 1 } as never,
        noCloseAnalogue: true,
        bestSimilarity: 0.512,
      },
    },
  };

  it("quotes the range with the analogues' real points and flags a missing close analogue (CL-20)", () => {
    const result = compactEstimate(
      stored,
      new Map([["T-104", { id: "T-104", title: "Digest", estimated_points: 5, actual_points: 8 }]]),
    );
    expect(result).toMatchObject({
      points: "5–13",
      tshirt: "M–L",
      confiance: "basse",
      depuis_le_cache: true,
    });
    expect(result.analogues[0]).toMatchObject({
      id: "T-104",
      points_estimes: 5,
      points_reels: 8,
      similarite: 0.51,
    });
    expect(result.analogues[1]).toMatchObject({ id: "T-120", titre: null, points_reels: null });
    expect(result.alerte).toMatch(/Aucun ticket analogue proche/);
  });
});

/** A base after a first full run: I-01 (topic a, ranked and scored). */
async function seeded() {
  const tables = world();
  const common = {
    pack,
    skills: SKILLS,
    now: NOW,
    embedFn: fakeEmbed,
    estimate: { estimateFn: fakeEstimateFn as never },
    sleep: async () => {},
  };
  await runPipeline(
    compilePipeline({ ...common, db: memoryDb(tables), invoke: fakeInvoke() }, new MemorySaver()),
    { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" },
  );
  const deps: AgentDeps = {
    db: memoryDb(tables),
    pack,
    skills: { triage: SKILLS.triage, riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
    now: () => NOW,
    withLock: (fn) => fn(),
    incremental: {
      invoke: fakeInvoke(),
      embedFn: fakeEmbed,
      estimate: { estimateFn: fakeEstimateFn as never },
      sleep: async () => {},
    },
  };
  return { tables, deps };
}

const ctx = (): TurnContext => ({
  threadId: "t",
  runCost: new RunCost(),
  page: null,
});

describe("get_priority", () => {
  it("shows a ranked insight it cannot compute as pending, never drops it silently", async () => {
    const { deps } = await seeded();
    const ranking = await getRanking(deps.db, "comptes", {
      pack,
      skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
      now: NOW,
    });
    const compact = compactRanking(ranking, 1);
    // No cached estimate in this world: I-01 waits for one (the next run computes it).
    expect(compact.classement).toEqual([]);
    expect(compact.en_attente).toEqual([{ insight: "I-01", missing: "estimation" }]);
    expect(compact.capacite.capacite_semaines).toBeGreaterThan(0);
  });
});

describe("add_feedback", () => {
  it("adds a pasted feedback through the incremental pipeline and reports where it went", async () => {
    const { tables, deps } = await seeded();
    const before = tables.feedbacks.length;
    const turn = ctx();
    const tool = addFeedbackTool(deps);
    const out = String(
      await tool.invoke(
        {
          feedbacks: [
            {
              text: "[topic:a] Les notifications arrivent encore en retard.",
              channel: "email_client",
            },
          ],
        },
        { context: turn } as never,
      ),
    );
    expect(tables.feedbacks).toHaveLength(before + 1);
    expect(out).toContain('<contenu_externe source="outil add_feedback">');
    const json = JSON.parse(
      out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1).replaceAll("&quot;", '"'),
    );
    expect(json.retours[0].items[0]).toMatchObject({ resultat: "rattache", insight: "I-01" });
    expect(tables.feedbacks.at(-1)).toMatchObject({
      channel: "email_client",
      source_type: "client_direct",
    });
  });

  it("shows the models the pipeline really calls: its triage model (ADR-035), then reasoning", async () => {
    const { deps } = await seeded();
    expect(ADD_FEEDBACK_MODELS).toContain(TRIAGE_MODEL_ROLES[PIPELINE_TRIAGE_MODEL]);
    expect(new Set(ADD_FEEDBACK_MODELS).size).toBe(ADD_FEEDBACK_MODELS.length);
    // The pipeline triages with Sonnet (role reasoning): Haiku, the comparison model, is not shown.
    expect(addFeedbackTool(deps).models).toEqual(["reasoning"]);
    expect(addFeedbackTool(deps).models.map((role) => MODELS[role])).not.toContain(MODELS.triage);
  });
});

describe("load_skill and threads", () => {
  it("returns a skill unwrapped (first-party guidance) and an actionable error for an unknown one", async () => {
    const tool = loadSkillTool();
    expect(String(await tool.invoke({ name: "challenge" }))).toMatch(/^# Skill challenge/);
    expect(String(await tool.invoke({ name: "inconnue" }))).toMatch(
      /^Erreur : Skill « inconnue » introuvable\. Skills disponibles : backlog-format/,
    );
  });

  it("titles a conversation from its first message and only touches it afterwards", async () => {
    expect(threadTitle("  Quoi de neuf ?\nDétail")).toBe("Quoi de neuf ?");
    expect(threadTitle("x".repeat(100))).toHaveLength(80);
    const tables = { threads: [] as Record<string, unknown>[] };
    const db = memoryDb(tables as never);
    const page = { page: "/insights", entity_id: "I-07" };
    expect(await touchThread(db, "th-1", "Pourquoi I-07 ?", page, NOW)).toEqual({ created: true });
    expect(await touchThread(db, "th-1", "Et ensuite ?", null, NOW)).toEqual({ created: false });
    expect(tables.threads).toEqual([
      expect.objectContaining({
        id: "th-1",
        title: "Pourquoi I-07 ?",
        last_message_at: NOW.toISOString(),
      }),
    ]);
  });

  it("excerpt marks what it cuts", () => {
    expect(excerpt("a  b\nc", 10)).toBe("a b c");
    expect(excerpt("abcdef", 3)).toBe("abc… [tronqué]");
    expect(excerpt(null, 3)).toBeNull();
  });
});
