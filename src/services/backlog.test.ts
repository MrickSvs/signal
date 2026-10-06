import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import type { DraftItem, Scenario } from "@/lib/backlog/draft";
import { loadContextPack } from "@/lib/context";
import { RUBRIC_CRITERIA } from "@/lib/judge/judge";
import { EMPTY_USAGE } from "@/lib/llm/cost";
import type { invokeStructured } from "@/lib/llm/structured";
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
import {
  BacklogError,
  changeBacklogItemKind,
  draftBacklog,
  itemFields,
  judgeBacklogItems,
  patchBacklogItem,
  type BacklogDeps,
} from "./backlog";
import { insightNeed, loadEstimationContext, problemHash } from "./estimate";

const pack = await loadContextPack();
const estimationContext = await loadEstimationContext();

const scenarios = (): Scenario[] => [
  {
    name: "cas nominal",
    edge_case: false,
    steps: [
      { keyword: "Étant donné", text: "un membre en digest quotidien" },
      { keyword: "Quand", text: "on lui assigne une tâche" },
      { keyword: "Alors", text: "il reçoit un e-mail" },
    ],
  },
  {
    name: "plusieurs assignés",
    edge_case: true,
    steps: [
      { keyword: "Étant donné", text: "deux membres aux préférences différentes" },
      { keyword: "Quand", text: "on leur assigne la même tâche" },
      { keyword: "Alors", text: "chacun reçoit un e-mail" },
    ],
  },
];

const story = (title: string, evidence: string[], dependsOn: number[] = []): DraftItem => ({
  kind: "story",
  title,
  value: "ne plus rater une tâche",
  persona: "membre d'équipe",
  want: "être prévenu de mes assignations",
  business_rules: ["Une assignation notifie toujours", "Le digest reprend l'assignation"],
  acceptance_criteria: scenarios(),
  success_kpi: "Zéro incident de notification de plus de 24 h (O3-KR1)",
  evidence,
  depends_on: dependsOn,
});

const bug = (title: string, evidence: string[]): DraftItem => ({
  kind: "bug",
  title,
  expected_behavior: "Toute assignation déclenche un e-mail",
  actual_behavior: "En digest quotidien, rien ne part",
  repro_steps: ["activer le digest", "assigner une tâche"],
  severity: "majeur",
  acceptance_criteria: scenarios(),
  evidence,
  depends_on: [],
});

type Draft = Record<string, unknown>;

/** Fake models of the drafting: the draft is given by the test, points are the scale's middle. */
function backlogInvoke(draft: (evidence: string[]) => Draft, points = 3) {
  const base = fakeInvoke();
  return vi.fn(async (role, schema, messages, options) => {
    const body = String(messages[1].content);
    switch (options.name) {
      case "draft-backlog-items": {
        const evidence = [...new Set([...body.matchAll(/^- (R-\d{3}) \[/gm)].map((m) => m[1]))];
        return { data: draft(evidence), usage: EMPTY_USAGE };
      }
      case "estimate-backlog-items": {
        const ids = [...body.matchAll(/^((?:US|BUG|TT)-\d{3}) \[/gm)].map((m) => m[1]);
        return {
          data: {
            items: ids.map((id) => ({
              id,
              points,
              components: ["notifications"],
              rationale: "Analogue T-108.",
            })),
            range_note: "",
          },
          usage: EMPTY_USAGE,
        };
      }
      case "retype-backlog-item": {
        const evidence = [...new Set([...body.matchAll(/^- (R-\d{3}) \[/gm)].map((m) => m[1]))];
        const kind = /type « (\w+) »/.exec(body)![1];
        return {
          data: {
            item:
              kind === "bug"
                ? bug("Régénéré en bug", evidence.slice(0, 2))
                : story("Régénéré en story", evidence.slice(0, 2)),
          },
          usage: EMPTY_USAGE,
        };
      }
      case "judge-backlog-item": {
        const kind = /\[(story|bug|tache)\]/.exec(body)![1] as keyof typeof RUBRIC_CRITERIA;
        return {
          data: {
            notes: Object.fromEntries(RUBRIC_CRITERIA[kind].map((c) => [c, 4])),
            verdict: "acceptable",
            points_forts: "Clair.",
            a_ameliorer: [],
          },
          usage: EMPTY_USAGE,
        };
      }
      default:
        return base(role, schema, messages, options);
    }
  }) as unknown as typeof invokeStructured & ReturnType<typeof vi.fn>;
}

/**
 * After a first full run: I-01 (topic a, 6 bug feedbacks, ranked) with a cached estimate of 3 to 13
 * points. `functional` turns its items into feature requests.
 */
async function seeded(options: { functional?: boolean; noCloseAnalogue?: boolean } = {}) {
  const tables = world();
  await runPipeline(
    compilePipeline(
      {
        db: memoryDb(tables),
        invoke: fakeInvoke(),
        pack,
        skills: SKILLS,
        now: NOW,
        embedFn: fakeEmbed,
        estimate: { estimateFn: fakeEstimateFn as never },
        sleep: async () => {},
      },
      new MemorySaver(),
    ),
    { runId: "11111111-1111-4111-8111-111111111111", reachMode: "comptes" },
  );
  const insight = tables.insights.find((i) => i.id === "I-01")!;
  insight.status = "actif";
  if (options.functional) {
    for (const item of tables.feedback_items) {
      if (item.type === "bug") item.type = "demande_fonctionnelle";
    }
  }
  tables.complexity_estimates.push({
    id: "est-insight",
    insight_id: "I-01",
    item_id: null,
    problem_hash: problemHash(insightNeed(insight as never).statement),
    components: ["notifications"],
    points_min: 3,
    points_max: 13,
    tshirt_min: "M",
    tshirt_max: "L",
    confidence: options.noCloseAnalogue ? "basse" : "moyenne",
    analogies: [
      {
        ticket_id: "T-108",
        raison: "même module",
        similarity: options.noCloseAnalogue ? 0.4 : 0.8,
        close: !options.noCloseAnalogue,
      },
    ],
    rationale: "",
    risks: ["couplage du digest"],
    model: "test",
    created_at: NOW.toISOString(),
  });
  const db = memoryDb(tables);
  const background: (() => Promise<void>)[] = [];
  const deps = (invoke: ReturnType<typeof backlogInvoke>): BacklogDeps => ({
    pack,
    skills: { riceScoring: SKILLS.riceScoring, moscow: SKILLS.moscow },
    now: NOW,
    source: "chat",
    invoke,
    estimate: { invoke, context: estimationContext },
    draftSkills: { backlogFormat: "skill backlog-format", userStory: "skill user-story" },
    background: (task) => background.push(task),
  });
  const effort = () =>
    tables.scores.find((s) => s.insight_id === "I-01" && s.is_current) as {
      effort_weeks: number;
      effort_source: string;
    };
  return { tables, db, deps, background, effort };
}

describe("draftBacklog (in-memory database, simulated models)", () => {
  it("a bug insight gives bugs without epic, estimated in one pass, effort refined and logged (CL-27)", async () => {
    const { tables, db, deps, background, effort } = await seeded();
    expect(effort()).toMatchObject({ effort_source: "estimation_initiale" });
    const invoke = backlogInvoke((ev) => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Assignations non notifiées en digest", ev.slice(0, 3))],
      discoverability: null,
    }));
    const result = await draftBacklog(db, "I-01", {}, deps(invoke));
    if (result.needs_confirmation) throw new Error("unexpected");

    expect(result.plan).toMatchObject({ proposed: "bugs", chosen: "bugs", deviation_reason: null });
    expect(result.epic).toBeNull();
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "BUG-001",
        kind: "bug",
        points: 3,
        components: ["notifications"],
      }),
    ]);
    // One drafting call, then ONE estimation call for every item.
    const names = invoke.mock.calls.map((c) => c[3].name);
    expect(names.filter((n) => n === "draft-backlog-items")).toHaveLength(1);
    expect(names.filter((n) => n === "estimate-backlog-items")).toHaveLength(1);

    const stored = tables.backlog_items[0];
    expect(stored).toMatchObject({
      kind: "bug",
      status: "brouillon",
      epic_id: null,
      severity: "majeur",
      // Accounts computed in code: the world's feedbacks of topic a are from C-002.
      affected_accounts: ["C-002"],
      points: 3,
      value: null,
    });
    expect(stored.dor_checklist).toMatchObject({ estimation_justifiee: true, preuves: true });
    // Effort refined: 3 points ÷ 3 = 1 week, from the backlog, logged as an adjustment by Signal.
    expect(effort()).toMatchObject({ effort_weeks: 1, effort_source: "backlog" });
    expect(tables.decisions).toEqual([
      expect.objectContaining({
        actor: "signal",
        action: "ajustement",
        entity_id: "I-01",
        field: "effort",
        after: { effort_weeks: 1, effort_source: "backlog" },
      }),
    ]);
    expect(result.effort).toMatchObject({ after: 1, decision: "D-001" });

    // The quality badge runs after the answer, with the judge role.
    expect(stored.judge).toBeNull();
    await Promise.all(background.map((task) => task()));
    expect(tables.backlog_items[0].judge).toMatchObject({
      note: 4,
      verdict: "pret",
      provisional: true,
    });
    expect(invoke.mock.calls.find((c) => c[3].name === "judge-backlog-item")![0]).toBe("judge");
  });

  it("a functional insight beyond 8 points gives an epic with stories and their dependencies", async () => {
    const { tables, db, deps } = await seeded({ functional: true });
    const invoke = backlogInvoke((ev) => ({
      format: "epic_stories",
      deviation_reason: "",
      epic: {
        title: "Ne plus rater une assignation",
        goal: "Fiabiliser",
        okr_refs: ["O3-KR1"],
        kpi: "incidents",
      },
      items: [
        story("Être notifié d'une assignation", [ev[0]]),
        story("Retrouver ses assignations dans le digest", [ev[1]], [1]),
        story("Choisir son canal de notification", [ev[2]]),
      ],
      discoverability: null,
    }));
    const result = await draftBacklog(db, "I-01", {}, deps(invoke));
    if (result.needs_confirmation) throw new Error("unexpected");
    expect(result.plan.proposed).toBe("epic_stories");
    expect(result.epic).toMatchObject({ id: "E-01", kept: false });
    expect(tables.epics).toEqual([expect.objectContaining({ id: "E-01", okr_refs: ["O3-KR1"] })]);
    expect(tables.backlog_items.map((b) => [b.id, b.epic_id, b.dependencies])).toEqual([
      ["US-001", "E-01", []],
      ["US-002", "E-01", ["US-001"]],
      ["US-003", "E-01", []],
    ]);
    expect(result.plan).toMatchObject({ sum: 9, item_ids: ["US-001", "US-002", "US-003"] });
  });

  it("a deviation from the proposed format is kept visible in the plan", async () => {
    const { db, deps } = await seeded({ functional: true });
    const invoke = backlogInvoke((ev) => ({
      format: "story",
      deviation_reason: "Une seule livraison suffit.",
      epic: null,
      items: [story("Être notifié d'une assignation", [ev[0]])],
      discoverability: null,
    }));
    const result = await draftBacklog(db, "I-01", {}, deps(invoke));
    if (result.needs_confirmation) throw new Error("unexpected");
    expect(result.plan).toMatchObject({
      proposed: "epic_stories",
      chosen: "story",
      deviation_reason: "Une seule livraison suffit.",
    });
  });

  it("without a close analogue, the plan says so with a low confidence (CL-20)", async () => {
    const { tables, db, deps } = await seeded({ noCloseAnalogue: true });
    const invoke = backlogInvoke((ev) => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Assignations non notifiées", [ev[0]])],
      discoverability: null,
    }));
    const result = await draftBacklog(db, "I-01", {}, deps(invoke));
    if (result.needs_confirmation) throw new Error("unexpected");
    expect(result.plan).toMatchObject({ no_close_analogue: true, confidence: "basse" });
    const prompt = String(invoke.mock.calls[0][2][1].content);
    expect(prompt).toContain("Aucun ticket analogue proche");
    expect(tables.insights.find((i) => i.id === "I-01")!.backlog_plan).toMatchObject({
      no_close_analogue: true,
    });
  });

  it("a re-run asks for confirmation, keeps sent items and replaces drafts only once confirmed (CL-33)", async () => {
    const { tables, db, deps } = await seeded();
    const first = backlogInvoke((ev) => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Premier bug", [ev[0]]), bug("Deuxième bug", [ev[1]])],
      discoverability: null,
    }));
    await draftBacklog(db, "I-01", {}, deps(first));
    // BUG-001 has been sent to Notion meanwhile; BUG-002 is still a draft.
    tables.backlog_items[0].status = "envoye";

    const second = backlogInvoke((ev) => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Bug complémentaire", [ev[2]])],
      discoverability: null,
    }));
    const asked = await draftBacklog(db, "I-01", {}, deps(second));
    expect(asked).toMatchObject({
      needs_confirmation: true,
      drafts: [{ id: "BUG-002" }],
      kept: [{ id: "BUG-001", status: "envoye" }],
    });
    expect(second).not.toHaveBeenCalled();
    expect(tables.backlog_items.map((b) => b.id)).toEqual(["BUG-001", "BUG-002"]);

    const done = await draftBacklog(db, "I-01", { confirm: true }, deps(second));
    if (done.needs_confirmation) throw new Error("unexpected");
    expect(done).toMatchObject({ replaced: ["BUG-002"], kept: ["BUG-001"] });
    // Sequences never reuse an id: the new draft is BUG-003.
    expect(tables.backlog_items.map((b) => [b.id, b.status])).toEqual([
      ["BUG-001", "envoye"],
      ["BUG-003", "brouillon"],
    ]);
    // The kept item is shown to the model so it completes around it.
    expect(String(second.mock.calls[0][2][1].content)).toContain(
      "BUG-001 [bug, envoye] Premier bug",
    );
  });

  it("a discoverability insight puts nothing in the backlog and proposes an action", async () => {
    const { tables, db, deps } = await seeded();
    for (const item of tables.feedback_items) item.existing_feature = true;
    const invoke = backlogInvoke((ev) => ({
      format: "decouvrabilite",
      deviation_reason: "",
      epic: null,
      items: [],
      discoverability: {
        action: "Article d'aide",
        rationale: "Le réglage existe.",
        evidence: [ev[0]],
      },
    }));
    const result = await draftBacklog(db, "I-01", {}, deps(invoke));
    if (result.needs_confirmation) throw new Error("unexpected");
    expect(result.plan).toMatchObject({
      proposed: "decouvrabilite",
      discoverability: { action: "Article d'aide" },
    });
    expect(result.items).toEqual([]);
    expect(tables.backlog_items).toEqual([]);
    expect(invoke.mock.calls.map((c) => c[3].name)).toEqual(["draft-backlog-items"]);
  });

  it("refuses evidence outside the insight (checked in code) and leaves nothing behind", async () => {
    const { tables, db, deps } = await seeded();
    const invoke = backlogInvoke(() => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Bug", ["R-999"])],
      discoverability: null,
    }));
    await expect(draftBacklog(db, "I-01", {}, deps(invoke))).rejects.toThrow(BacklogError);
    expect(tables.backlog_items).toEqual([]);
  });

  it("removes the inserted rows when the estimation fails", async () => {
    const { tables, db, deps } = await seeded();
    const invoke = backlogInvoke((ev) => ({
      format: "bugs",
      deviation_reason: "",
      epic: null,
      items: [bug("Bug", [ev[0]])],
      discoverability: null,
    }));
    const failing = vi.fn(async (role, schema, messages, options) => {
      if (options.name === "estimate-backlog-items") throw new Error("API indisponible");
      return invoke(role, schema, messages, options);
    }) as unknown as typeof invoke;
    const d = deps(failing);
    await expect(draftBacklog(db, "I-01", {}, d)).rejects.toThrow("API indisponible");
    expect(tables.backlog_items).toEqual([]);
  });

  it("refuses a merged or unknown insight", async () => {
    const { tables, db, deps } = await seeded();
    const invoke = backlogInvoke(() => ({}));
    await expect(draftBacklog(db, "I-99", {}, deps(invoke))).rejects.toThrow("I-99 introuvable");
    tables.insights.find((i) => i.id === "I-01")!.status = "fusionne";
    await expect(draftBacklog(db, "I-01", {}, deps(invoke))).rejects.toThrow("fusionné");
  });
});

describe("patchBacklogItem / changeBacklogItemKind", () => {
  async function drafted() {
    const s = await seeded({ functional: true });
    const invoke = backlogInvoke((ev) => ({
      format: "story",
      deviation_reason: "Une seule livraison.",
      epic: null,
      items: [story("Être notifié d'une assignation", [ev[0], ev[1]])],
      discoverability: null,
    }));
    await draftBacklog(s.db, "I-01", {}, s.deps(invoke));
    s.tables.decisions.length = 0;
    return { ...s, invoke };
  }

  it("edits a draft and logs the PO's modification", async () => {
    const { tables, db, deps, invoke } = await drafted();
    const result = await patchBacklogItem(
      db,
      "US-001",
      { title: "Recevoir ses assignations" },
      deps(invoke),
    );
    expect(result).toMatchObject({ id: "US-001", changed: ["title"], effort: null });
    expect(tables.backlog_items[0].title).toBe("Recevoir ses assignations");
    expect(tables.decisions).toEqual([
      expect.objectContaining({
        actor: "po",
        action: "modification",
        entity_type: "backlog_item",
        entity_id: "US-001",
        field: "title",
        before: { title: "Être notifié d'une assignation" },
        after: { title: "Recevoir ses assignations" },
      }),
    ]);
  });

  it("new points refine the effort; invalid values and fields of another type are refused", async () => {
    const { tables, db, deps, invoke, effort } = await drafted();
    await patchBacklogItem(db, "US-001", { points: 5 }, deps(invoke));
    expect(effort()).toMatchObject({ effort_source: "backlog", effort_weeks: 1.67 });
    expect(tables.decisions.map((d) => d.action)).toEqual(["modification", "ajustement"]);

    await expect(patchBacklogItem(db, "US-001", { points: 4 }, deps(invoke))).rejects.toThrow(
      "points dans 1, 2, 3, 5, 8, 13",
    );
    await expect(
      patchBacklogItem(db, "US-001", { severity: "majeur" }, deps(invoke)),
    ).rejects.toThrow("Champs d'un autre type : severity");
    await expect(
      patchBacklogItem(db, "US-001", { evidence: ["R-999"] }, deps(invoke)),
    ).rejects.toThrow("Preuves hors de l'insight : R-999");
    await expect(
      patchBacklogItem(db, "US-001", { acceptance_criteria: [scenarios()[0]] }, deps(invoke)),
    ).rejects.toThrow("cas limite");
  });

  it("refuses to edit an item already sent: « à modifier dans Notion »", async () => {
    const { tables, db, deps, invoke } = await drafted();
    tables.backlog_items[0].status = "envoye";
    await expect(patchBacklogItem(db, "US-001", { title: "X" }, deps(invoke))).rejects.toThrow(
      "à modifier dans Notion",
    );
    await expect(
      changeBacklogItemKind(db, "US-001", { kind: "bug", confirm: true }, deps(invoke)),
    ).rejects.toThrow("à modifier dans Notion");
  });

  it("changes a story into a bug after confirmation: regenerated, new id, decision logged (CL-54)", async () => {
    const { tables, db, deps, invoke, background } = await drafted();
    const asked = await changeBacklogItemKind(db, "US-001", { kind: "bug" }, deps(invoke));
    expect(asked).toMatchObject({ needs_confirmation: true, from: "story", to: "bug" });
    expect(tables.backlog_items.map((b) => b.id)).toEqual(["US-001"]);

    const done = await changeBacklogItemKind(
      db,
      "US-001",
      { kind: "bug", confirm: true },
      deps(invoke),
    );
    expect(done).toMatchObject({ id: "BUG-001", previous_id: "US-001", kind: "bug" });
    expect(tables.backlog_items).toEqual([
      expect.objectContaining({
        id: "BUG-001",
        kind: "bug",
        status: "brouillon",
        points: 3,
        severity: "majeur",
        epic_id: null,
        // The story's fields are not copied into the bug.
        value: null,
        persona: null,
        want: null,
      }),
    ]);
    expect(tables.decisions).toEqual([
      expect.objectContaining({
        actor: "po",
        action: "modification",
        field: "kind",
        entity_id: "BUG-001",
        before: expect.objectContaining({ id: "US-001", kind: "story" }),
        after: expect.objectContaining({ id: "BUG-001", kind: "bug" }),
      }),
    ]);
    expect(background).toHaveLength(2);
  });
});

describe("judgeBacklogItems", () => {
  it("does nothing without items", async () => {
    const invoke = vi.fn();
    await judgeBacklogItems(memoryDb(world()), [], { invoke: invoke as never, now: NOW });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("judges each item with the grid of its kind and writes a provisional badge", async () => {
    const tables = world();
    const row = (id: string, kind: string) => ({
      id,
      kind,
      insight_id: "I-01",
      title: `Titre ${id}`,
      status: "brouillon",
      evidence: ["R-001"],
      dependencies: [],
      points: 3,
      complexity_estimate_id: null,
      judge: null,
    });
    tables.backlog_items = [row("US-001", "story"), row("TT-001", "tache")] as never;
    const invoke = vi.fn(
      async (_role: string, _schema: unknown, messages: { content: unknown }[]) => {
        if (JSON.stringify(messages[1].content).includes("TT-001")) throw new Error("API en panne");
        return {
          data: {
            notes: { invest: 4, testabilite: 5, tracabilite: 4, format: 4 },
            verdict: "acceptable",
            points_forts: "Valeur nette.",
            a_ameliorer: [],
          },
          usage: EMPTY_USAGE,
          costEur: 0,
          attempts: 1,
        };
      },
    );
    await judgeBacklogItems(memoryDb(tables), ["US-001", "TT-001"], {
      invoke: invoke as never,
      now: NOW,
      draftSkills: { backlogFormat: "f", userStory: "s" },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    const [story, task] = tables.backlog_items as unknown as { judge: unknown }[];
    expect(story.judge).toMatchObject({
      note: 4.3,
      notes: { invest: 4, testabilite: 5, tracabilite: 4, format: 4 },
      verdict: "pret",
      provisional: true,
    });
    expect(task.judge).toBeNull(); // a failed call leaves its item without a badge, not the others
  });
});

describe("itemFields", () => {
  it("stores the story sentence without the template's words; other kinds' fields stay empty", () => {
    const fields = itemFields(
      {
        ...(story("Inviter", ["R-001"]) as Extract<DraftItem, { kind: "story" }>),
        value: "Afin de partager l'avancement,",
        want: "je veux inviter un client.",
      },
      { ids: ["C-001"], enterprise: 1 },
    );
    expect(fields).toMatchObject({
      value: "partager l'avancement",
      want: "inviter un client",
      expected_behavior: null,
      affected_accounts: [],
      objective: null,
    });
  });
});
