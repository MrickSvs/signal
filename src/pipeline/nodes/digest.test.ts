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
import { insertFeedbacks, runIncremental } from "@/pipeline/incremental";
import {
  accountsAtRisk,
  digestPeriod,
  digestWritingSchema,
  factsProgress,
  fallbackWriting,
  hasUnsourcedNumber,
  knownIds,
  NO_HISTORY,
  rankMoves,
  renderDigest,
  runDigest,
  type DigestFacts,
  type DigestProgress,
  type DigestWriting,
} from "./digest";

const pack = await loadContextPack();
const { weighting } = pack;

describe("digestPeriod (SPEC §12.2)", () => {
  const clock = new Date("2026-06-02T04:00:00Z");
  it("starts at the previous digest, or at the last visit when it is older", () => {
    expect(digestPeriod(null, null, clock)).toEqual({ start: null, end: clock.toISOString() });
    expect(digestPeriod("2026-06-01T04:00:00Z", null, clock).start).toBe("2026-06-01T04:00:00Z");
    expect(digestPeriod("2026-06-01T04:00:00Z", "2026-05-28T10:00:00Z", clock).start).toBe(
      "2026-05-28T10:00:00Z",
    );
    expect(digestPeriod("2026-06-01T04:00:00Z", "2026-06-01T20:00:00Z", clock).start).toBe(
      "2026-06-01T04:00:00Z",
    );
  });
});

describe("accountsAtRisk", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const customer = (id: string, renewal: string | null, health = "vert", status = "client") => ({
    id,
    name: `Compte ${id}`,
    status: status as "client" | "prospect",
    plan: "enterprise" as const,
    renewal_date: renewal,
    health: health as "vert" | "orange" | "rouge",
  });
  it("keeps renewals within 90 days with a churn signal or a red health, soonest first", () => {
    const result = accountsAtRisk(
      [
        customer("C-001", "2026-08-01", "orange"), // churn → kept
        customer("C-002", "2026-07-01", "rouge"), // red health → kept
        customer("C-003", "2026-07-01", "orange"), // no negative signal
        customer("C-004", "2026-09-01", "rouge"), // J+92
        customer("C-005", "2026-05-01", "rouge"), // already past
        customer("C-006", "2026-07-01", "rouge", "prospect"),
        customer("C-007", null, "rouge"),
      ],
      new Map([["C-001", ["R-010"]]]),
      new Map([["C-001", ["I-02"]]]),
      now,
      weighting.moscow.horizon_days,
    );
    expect(result.map((a) => [a.customer_id, a.renewal_in_days, a.churn_feedback_ids])).toEqual([
      ["C-002", 30, []],
      ["C-001", 61, ["R-010"]],
    ]);
    expect(result[1].insight_ids).toEqual(["I-02"]);
  });
});

describe("rankMoves", () => {
  const titles = new Map([
    ["I-01", "Un"],
    ["I-02", "Deux"],
    ["I-03", "Trois"],
  ]);
  const v = (insight_id: string, rank: number, created_at: string) => ({
    insight_id,
    rank,
    created_at,
    is_current: false,
  });
  it("compares the rank at the start of the period with the current one", () => {
    const scores = [
      v("I-01", 2, "2026-05-30T00:00:00Z"),
      v("I-01", 3, "2026-05-31T00:00:00Z"), // latest before the period
      v("I-02", 1, "2026-05-31T00:00:00Z"),
      v("I-01", 1, "2026-06-01T10:00:00Z"), // inside the period
    ];
    const current = new Map([
      ["I-01", 1],
      ["I-03", 2],
    ]);
    expect(rankMoves(scores, current, titles, "2026-06-01T00:00:00Z")).toEqual([
      { insight_id: "I-01", title: "Un", from: 3, to: 1 },
      { insight_id: "I-03", title: "Trois", from: null, to: 2 }, // enters
      { insight_id: "I-02", title: "Deux", from: 1, to: null }, // leaves
    ]);
    expect(rankMoves(scores, current, titles, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const facts = (f: Partial<DigestFacts> = {}): DigestFacts => ({
  period: { start: "2026-06-01T04:00:00Z", end: "2026-06-02T04:00:00Z" },
  first: false,
  alerts: [],
  feedbacks: {
    total: 2,
    by_channel: { email_client: 2 },
    ids: ["R-010", "R-011"],
    confirming_known: ["R-010"],
  },
  emerging: [
    {
      insight_id: "I-07",
      title: "Tableau lent",
      recent: 12,
      growth: 4,
      recent_feedback_ids: ["R-201", "R-214"],
    },
  ],
  new_insights: [],
  ranking: { has_history: true, moves: [], top: [] },
  accounts_at_risk: [
    {
      customer_id: "C-013",
      name: "Studio Bastide",
      plan: "enterprise",
      renewal_in_days: 38,
      health: "rouge",
      churn_feedback_ids: ["R-088"],
      insight_ids: ["I-02"],
    },
  ],
  pending: {
    insights_to_validate: ["I-12"],
    backlog_to_validate: [],
    merges: [{ from: "I-05", into: "I-02" }],
    splits: [],
    overrides_context_changed: [],
  },
  ...f,
});

const writing = (w: Partial<DigestWriting> = {}): DigestWriting => ({
  alertes: "Aucune alerte ouverte.",
  nouveaux_retours: "2 retours (R-010, R-011) : e-mail 2 — dont 1 confirme un sujet connu (R-010).",
  tendances: "- I-07 Tableau lent : émergent, 12 retours sur 7 jours (R-201, R-214).",
  comptes_a_risque: "- Studio Bastide (Enterprise, J+38) : santé rouge, churn R-088 — I-02.",
  classement: "Aucun mouvement.",
  a_trancher: "- 1 nouveau sujet à valider : I-12.\n- Fusion : I-02 a absorbé I-05.",
  recommandations: [
    {
      titre: "Prévenir le CSM de Studio Bastide avant J+38",
      justification: "Santé rouge et churn dans R-088.",
      preuves: ["C-013", "R-088"],
      confiance: "moyenne",
    },
  ],
  ...w,
});

describe("digestWritingSchema (skill digest, rules 1, 2, 5, 7, 10)", () => {
  const schema = digestWritingSchema(knownIds(facts()));

  it("accepts a writing where every number carries an id from the facts", () => {
    expect(schema.safeParse(writing()).success).toBe(true);
  });

  it("rejects an invented id, a number without id, a weekday, an absolute date, too many items", () => {
    const issues = (w: Partial<DigestWriting>) => {
      const r = schema.safeParse(writing(w));
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(issues({ tendances: "- I-99 explose (R-201)." })).toEqual([
      "I-99 n'existe pas dans les faits",
    ]);
    expect(issues({ nouveaux_retours: "14 retours ce matin." })).toEqual([
      "chiffre sans ID : « 14 retours ce matin. »",
    ]);
    expect(issues({ a_trancher: "- Rien depuis mardi (I-12)." })[0]).toMatch(/jour de la semaine/);
    expect(issues({ a_trancher: "- Depuis le 3 juin (I-12)." })[0]).toMatch(/date absolue/);
    expect(
      issues({
        recommandations: [
          { titre: "Faire", justification: "Parce que.", preuves: ["R-404"], confiance: "haute" },
        ],
      }),
    ).toEqual(["R-404 n'existe pas dans les faits"]);
    const four = Array(4).fill({
      titre: "Faire",
      justification: "Parce que.",
      preuves: ["I-07"],
      confiance: "basse",
    });
    expect(schema.safeParse(writing({ recommandations: four })).success).toBe(false);
    const long = Array.from({ length: 26 }, (_, i) => `- ligne ${i} (I-07)`).join("\n");
    expect(issues({ tendances: long })[0]).toMatch(/au plus hors alertes/);
  });

  it("lets J+n, OKR ids and list numbers through", () => {
    expect(hasUnsourcedNumber("1. Prévenir le CSM avant J+38, aligné O3-KR2")).toBe(false);
    expect(hasUnsourcedNumber("Pas encore d'historique.")).toBe(false);
    expect(hasUnsourcedNumber("3 sujets")).toBe(true);
  });
});

describe("renderDigest", () => {
  it("keeps the fixed order and adds the recommendations with their evidence", () => {
    const md = renderDigest(facts(), writing());
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Alertes",
      "Nouveaux retours",
      "Tendances",
      "Comptes à risque",
      "Classement",
      "À trancher",
      "Mes recommandations",
    ]);
    expect(md).toMatch(/^Bonjour Léa\. Voici ce qui a changé depuis ta dernière visite\./);
    expect(md).toContain(
      "1. **Prévenir le CSM de Studio Bastide avant J+38** Santé rouge et churn dans R-088. — C-013, R-088 — confiance moyenne.",
    );
  });

  it("imposes « pas encore d'historique » without history, whatever the writing says (CL-18)", () => {
    const md = renderDigest(
      facts({ ranking: { has_history: false, moves: [], top: [] } }),
      writing({ classement: "- I-07 passe de 9 à 1." }),
    );
    expect(md).toContain(`## Classement\n${NO_HISTORY}`);
    expect(md).not.toContain("passe de 9");
  });

  it("renders the facts as is when the writing failed, ids included", () => {
    const fallback = fallbackWriting(facts());
    expect(digestWritingSchema(knownIds(facts())).safeParse(fallback).success).toBe(true);
    const md = renderDigest(facts(), fallback);
    expect(md).toContain(
      "I-07 « Tableau lent » : émergent, 12 retours sur 7 jours (R-201, R-214).",
    );
    expect(md).toContain("Fusion : I-02 a absorbé I-05."); // CL-15
    expect(md).toContain(
      "Studio Bastide C-013 (enterprise, J+38) : santé rouge : churn R-088 — I-02.",
    );
  });
});

// ---------------------------------------------------------------------------

async function scenario() {
  const tables = world();
  const common = {
    pack,
    skills: SKILLS,
    now: NOW,
    embedFn: fakeEmbed,
    estimate: { estimateFn: fakeEstimateFn as never },
    sleep: async () => {},
  };
  const invoke = fakeInvoke();
  const state = await runPipeline(
    compilePipeline({ ...common, db: memoryDb(tables), invoke }, new MemorySaver()),
    { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" },
  );
  return { tables, state, common, invoke };
}

describe("runDigest (in-memory database, simulated model)", () => {
  it("first digest: everything is new, no ranking history, stored and linked in po_state (CL-18)", async () => {
    const { tables, state } = await scenario();
    expect(state.stats).toMatchObject({ digest: { writer: "modele" } });
    expect(tables.digests).toHaveLength(1);
    const digest = tables.digests[0];
    const content = digest.content as { facts: DigestFacts };
    expect(content.facts.first).toBe(true);
    expect(content.facts.feedbacks.total).toBe(10);
    expect(content.facts.feedbacks.confirming_known).toEqual([]);
    expect(content.facts.ranking.has_history).toBe(false);
    expect(content.facts.new_insights.map((i) => i.insight_id)).toEqual(["I-01", "I-02"]);
    expect(content.facts.pending.insights_to_validate).toEqual(["I-01", "I-02"]);
    expect(digest.markdown).toContain(NO_HISTORY);
    expect(tables.po_state[0].last_digest_id).toBe(digest.id);
  });

  it("next digest: covers the period since the previous one, with rank history and accounts at risk", async () => {
    const { tables, common } = await scenario();
    const db = memoryDb(tables);
    // A churn signal from Atelier Mercure (Enterprise, renewing in 60 days) on a known topic.
    await new Promise((resolve) => setTimeout(resolve, 5)); // after the first digest's end
    const ids = await insertFeedbacks(
      db,
      [
        {
          channel: "email_client",
          source_type: "client_direct",
          customer_id: "C-001",
          raw_text: "[topic:a] [churn] on part",
        },
      ],
      NOW,
    );
    await runIncremental(db, ids, { ...common, invoke: fakeInvoke() });

    const result = await runDigest(db, {
      runId: null,
      weighting,
      skill: SKILLS.digest,
      now: NOW,
      clock: new Date(Date.now() + 1000),
      invoke: fakeInvoke(),
    });
    expect(result.facts.first).toBe(false);
    expect(result.facts.period.start).toBe(tables.digests[0].period_end);
    expect(result.facts.feedbacks).toMatchObject({
      total: 1,
      ids: ["R-011"],
      confirming_known: ["R-011"],
    });
    expect(result.facts.ranking.has_history).toBe(true);
    expect(result.facts.alerts).toMatchObject([
      { kind: "churn", insight_id: "I-01", feedback_ids: ["R-011"] },
    ]);
    expect(result.facts.accounts_at_risk).toMatchObject([
      {
        customer_id: "C-001",
        name: "Atelier Mercure",
        renewal_in_days: 60,
        churn_feedback_ids: ["R-011"],
        insight_ids: ["I-01"],
      },
    ]);
    expect(result.markdown).not.toContain(NO_HISTORY);
    expect(tables.digests).toHaveLength(2);
  });

  it("regenerated (ADR-043): keeps the current digest's start, ends now; the next one starts at its end", async () => {
    const { tables } = await scenario();
    const db = memoryDb(tables);
    const t0 = Date.now();
    const at = (ms: number) => new Date(t0 + ms);
    const digest = (ms: number, samePeriod?: boolean) =>
      runDigest(db, {
        runId: null,
        weighting,
        skill: SKILLS.digest,
        now: NOW,
        clock: at(ms),
        samePeriod,
        invoke: fakeInvoke(),
      });
    const visit = (ms: number) => (tables.po_state[0].last_seen_at = at(ms).toISOString());
    const original = (tables.digests[0].content as { facts: DigestFacts }).facts;

    // The first digest regenerated twice stays a first digest: everything is still new.
    visit(500);
    for (const ms of [1000, 2000]) {
      const again = await digest(ms, true);
      expect(again.facts.period).toEqual({ start: null, end: at(ms).toISOString() });
      expect({ ...again.facts, period: null }).toEqual({ ...original, period: null });
    }

    // The cron opens a new period from the regenerated digest's end.
    visit(2500);
    const next = await digest(3000);
    expect(next.facts.period).toEqual({
      start: at(2000).toISOString(),
      end: at(3000).toISOString(),
    });

    // Regenerated twice after a visit: the period still starts where that digest started.
    visit(3500);
    for (const ms of [4000, 5000]) {
      const again = await digest(ms, true);
      expect(again.facts.first).toBe(false);
      expect(again.facts.period).toEqual({
        start: at(2000).toISOString(),
        end: at(ms).toISOString(),
      });
      expect(tables.po_state[0].last_digest_id).toBe(again.id);
    }
    expect(tables.digests.at(-1)).toMatchObject({
      period_start: at(2000).toISOString(),
      period_end: at(5000).toISOString(),
    });
    // The page reloads after a regeneration (a visit): the next digest starts at its end.
    visit(5500);
    expect((await digest(6000)).facts.period.start).toBe(at(5000).toISOString());
  });

  it("does not propose again a recommendation Léa answered, unless it cites a new id (ADR-036)", async () => {
    const { tables } = await scenario();
    const previous = (tables.digests[0].content as { writing: DigestWriting }).writing;
    const [reco] = previous.recommandations;
    tables.decisions.push({
      id: "D-900",
      entity_type: "recommandation",
      entity_id: `${tables.digests[0].id}#1`,
      action: "validation",
      after: { statut: "fait", titre: reco.titre, preuves: reco.preuves },
      reason: null,
      created_at: new Date().toISOString(),
    });
    const invoke = fakeInvoke();
    const result = await runDigest(memoryDb(tables), {
      runId: null,
      weighting,
      skill: SKILLS.digest,
      now: NOW,
      clock: new Date(Date.now() + 1000),
      invoke,
    });
    expect(result.writer).toBe("modele");
    const written = (tables.digests.at(-1)!.content as { writing: DigestWriting }).writing;
    expect(written.recommandations).toEqual([]);
    const prompt = JSON.stringify(invoke.mock.calls.at(-1)![2]);
    expect(prompt).toContain("Recommandations déjà traitées par Léa");
    expect(prompt).toContain(reco.titre);
  });

  it("reports each step in order with the figures it has read", async () => {
    const { tables } = await scenario();
    const events: DigestProgress[] = [];
    const result = await runDigest(memoryDb(tables), {
      runId: null,
      weighting,
      skill: SKILLS.digest,
      now: NOW,
      clock: new Date(Date.now() + 1000),
      invoke: fakeInvoke(),
      onProgress: (event) => events.push(event),
    });
    expect(events.map((e) => e.step)).toEqual([
      "period",
      "facts",
      "memory",
      "writing",
      "written",
      "saved",
    ]);
    expect(events[1]).toEqual(factsProgress(result.facts));
    expect(events[1]).toMatchObject({ feedbacks: result.facts.feedbacks.total });
    expect(events.at(-2)).toMatchObject({ writer: "modele" });
    expect(events.at(-1)).toEqual({ step: "saved", id: result.id });
  });

  it("reports the fallback when the writing fails", async () => {
    const { tables } = await scenario();
    tables.insights[0].title = "[digest-fail] sujet";
    const events: DigestProgress[] = [];
    await runDigest(memoryDb(tables), {
      runId: null,
      weighting,
      skill: SKILLS.digest,
      now: NOW,
      clock: new Date(Date.now() + 1000),
      invoke: fakeInvoke(),
      onProgress: (event) => events.push(event),
    });
    expect(events.find((e) => e.step === "written")).toMatchObject({ writer: "repli" });
    expect(events.at(-1)?.step).toBe("saved");
  });

  it("falls back on a plain rendering of the facts when the writing fails", async () => {
    const { tables } = await scenario();
    tables.insights[0].title = "[digest-fail] sujet"; // the fake model fails on this marker
    const result = await runDigest(memoryDb(tables), {
      runId: null,
      weighting,
      skill: SKILLS.digest,
      now: NOW,
      clock: new Date(Date.now() + 1000),
      invoke: fakeInvoke(),
    });
    expect(result).toMatchObject({ writer: "repli", error: "API indisponible" });
    expect(result.markdown).toContain("## À trancher\n- 2 sujets à valider : I-01, I-02.");
    expect((tables.digests.at(-1)!.content as { writer: string }).writer).toBe("repli");
  });
});
