import { describe, expect, it } from "vitest";
import { chooseFormat, isTechnicalTopic, type FormatFacts } from "./choose-format";
import {
  affectedAccounts,
  checkDraft,
  checkScenarios,
  dorChecklist,
  draftSchema,
  formatGherkin,
  parseGherkin,
  storyPart,
  type Draft,
  type DraftContext,
  type DraftItem,
  type Scenario,
} from "./draft";

const facts = (overrides: Partial<FormatFacts> = {}): FormatFacts => ({
  origin: "retours",
  title: "Inviter un client sur un projet",
  problem_statement: "Les agences veulent partager un projet sans exposer les autres.",
  itemTypes: ["demande_fonctionnelle", "demande_fonctionnelle", "irritant_ux"],
  existingFeature: [false, false, false],
  range: { min: 13, max: 21 },
  ...overrides,
});

describe("chooseFormat (SPEC §9)", () => {
  it("existing feature first: nothing in the backlog", () => {
    const choice = chooseFormat(
      facts({ itemTypes: ["bug", "bug", "bug"], existingFeature: [true, true, false] }),
    );
    expect(choice.format).toBe("decouvrabilite");
    expect(choice.reason).toContain("67 %");
  });

  it("mostly bugs: bugs without epic, even with a large range", () => {
    expect(chooseFormat(facts({ itemTypes: ["bug", "bug", "irritant_ux"] })).format).toBe("bugs");
    // Exactly half is not « majoritairement ».
    expect(chooseFormat(facts({ itemTypes: ["bug", "irritant_ux"] })).format).toBe("epic_stories");
  });

  it("technical manual topic: technical task", () => {
    const manual = facts({
      origin: "manuel",
      title: "Rembourser la dette des contrôles de permissions",
      itemTypes: [],
      existingFeature: [],
    });
    expect(chooseFormat(manual).format).toBe("tache");
    expect(isTechnicalTopic({ ...manual, title: "Renforcer la sécurité" })).toBe(true);
    expect(isTechnicalTopic({ ...manual, title: "Un portail client" })).toBe(false);
    // A feedback insight is never a technical task by its wording.
    expect(isTechnicalTopic({ ...manual, origin: "retours" })).toBe(false);
  });

  it("functional: epic beyond 8 points, one story at 8 or less, one story without estimate", () => {
    expect(chooseFormat(facts()).format).toBe("epic_stories");
    expect(chooseFormat(facts({ range: { min: 3, max: 8 } })).format).toBe("story");
    expect(chooseFormat(facts({ range: null })).format).toBe("story");
  });
});

const scenario = (edge = false): Scenario => ({
  name: edge ? "accès refusé" : "cas nominal",
  edge_case: edge,
  steps: [
    { keyword: "Étant donné", text: "un projet partagé" },
    { keyword: "Quand", text: "le client ouvre le lien" },
    { keyword: "Alors", text: "il voit l'avancement" },
  ],
});

const story = (overrides: Partial<Extract<DraftItem, { kind: "story" }>> = {}): DraftItem => ({
  kind: "story",
  title: "Inviter un client sur un seul projet",
  value: "partager l'avancement sans exposer mes autres projets",
  persona: "chef de projet en agence",
  want: "inviter un client externe sur un projet précis",
  business_rules: ["Un invité ne voit que ses projets", "L'invitation expire après 7 jours"],
  acceptance_criteria: [scenario(), scenario(true)],
  success_kpi: "25 % des projets actifs avec un invité à 90 jours",
  evidence: ["R-001"],
  depends_on: [],
  ...overrides,
});

const bug: DraftItem = {
  kind: "bug",
  title: "Les assignations ne sont pas notifiées en digest",
  expected_behavior: "Toute assignation déclenche un e-mail",
  actual_behavior: "En digest quotidien, rien ne part",
  repro_steps: ["activer le digest", "assigner une tâche"],
  severity: "majeur",
  acceptance_criteria: [scenario(), scenario(true)],
  evidence: ["R-002"],
  depends_on: [],
};

const task: DraftItem = {
  kind: "tache",
  title: "Centraliser les contrôles de permissions",
  objective: "Un seul point de contrôle des droits",
  definition_of_done: ["tous les accès passent par le module"],
  risks: ["régression sur les droits existants"],
  evidence: ["R-001"],
  depends_on: [],
};

const ctx = (overrides: Partial<DraftContext> = {}): DraftContext => ({
  evidenceIds: ["R-001", "R-002", "R-003"],
  okrIds: ["O1-KR2", "O2-KR1"],
  proposed: "epic_stories",
  keptEpicId: null,
  keptItems: 0,
  ...overrides,
});

const epic = {
  title: "Travailler avec ses clients",
  goal: "Ouvrir Jalon aux clients",
  okr_refs: ["O2-KR1"],
  kpi: "% de projets avec un invité",
};

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  format: "epic_stories",
  deviation_reason: "",
  epic,
  items: [story(), story({ title: "Révoquer un invité" }), story({ title: "Voir ses invités" })],
  discoverability: null,
  ...overrides,
});

describe("checkDraft (SPEC §9.4)", () => {
  it("accepts a well-formed epic with three stories", () => {
    expect(checkDraft(draft(), ctx())).toEqual([]);
  });

  it("refuses a deviation from the proposed format without a reason, accepts it with one", () => {
    const single = draft({ format: "story", epic: null, items: [story()] });
    expect(checkDraft(single, ctx())).toEqual([expect.stringContaining("justifie l'écart")]);
    expect(
      checkDraft({ ...single, deviation_reason: "Une seule livraison suffit." }, ctx()),
    ).toEqual([]);
  });

  it("an epic only around several items; bugs and a lone story never in an epic", () => {
    const lone = draft({ format: "story", epic, items: [story()] });
    expect(checkDraft(lone, ctx({ proposed: "story" }))).toEqual(
      expect.arrayContaining([
        "Une epic n'existe que si elle regroupe plusieurs éléments",
        "Une story seule ne reçoit pas d'epic",
      ]),
    );
    const bugs = draft({ format: "bugs", epic, items: [bug, { ...bug, title: "Autre bug" }] });
    expect(checkDraft(bugs, ctx({ proposed: "bugs" }))).toContain(
      "Des bugs ne vont pas dans une epic",
    );
    expect(
      checkDraft(draft({ format: "bugs", epic: null, items: [bug] }), ctx({ proposed: "bugs" })),
    ).toEqual([]);
  });

  it("an epic kept from an earlier drafting: no new epic, fewer stories allowed (CL-33)", () => {
    const kept = ctx({ keptEpicId: "E-01", keptItems: 2 });
    expect(checkDraft(draft(), kept)).toContain(
      "L'epic E-01 est conservée : ne crée pas de nouvelle epic",
    );
    expect(checkDraft(draft({ epic: null, items: [story()] }), kept)).toEqual([]);
  });

  it("epic_stories needs 3 to 6 stories; a technical task may join them", () => {
    expect(checkDraft(draft({ items: [story(), story()] }), ctx())).toContain(
      "Format epic_stories : 3 à 6 stories découpées verticalement",
    );
    expect(
      checkDraft(draft({ items: [task, story(), story(), story({ depends_on: [1] })] }), ctx()),
    ).toEqual([]);
  });

  it("Gherkin: 2 to 5 scenarios with an edge case and Étant donné / Quand / Alors", () => {
    const issues = checkDraft(
      draft({
        items: [
          story({ acceptance_criteria: [scenario()] }),
          story({ acceptance_criteria: [scenario(), scenario()] }),
          story({
            acceptance_criteria: [
              scenario(),
              { ...scenario(true), steps: [{ keyword: "Quand", text: "rien" }] },
            ],
          }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([
      "Élément 1 (story) : 2 à 5 scénarios Gherkin attendus",
      "Élément 1 (story) : au moins un scénario de cas limite ou d'erreur (edge_case: true)",
      "Élément 2 (story) : au moins un scénario de cas limite ou d'erreur (edge_case: true)",
      "Élément 3 (story), scénario « accès refusé » : Étant donné, Quand et Alors attendus",
    ]);
  });

  it("dependencies are positions of other items; evidence cited once", () => {
    const issues = checkDraft(
      draft({
        items: [
          story({ depends_on: [1] }),
          story({ depends_on: [9] }),
          story({ evidence: ["R-001", "R-001"] }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([
      "Élément 1 (story) : dépendance 1 invalide (positions 1 à 3, pas lui-même)",
      "Élément 2 (story) : dépendance 9 invalide (positions 1 à 3, pas lui-même)",
      "Élément 3 (story) : une preuve citée une seule fois",
    ]);
  });

  it("discoverability: nothing in the backlog, an action instead", () => {
    const action = {
      action: "Article d'aide sur le filtre",
      rationale: "Le filtre existe",
      evidence: ["R-003"],
    };
    const ok = draft({ format: "decouvrabilite", epic: null, items: [], discoverability: action });
    expect(checkDraft(ok, ctx({ proposed: "decouvrabilite" }))).toEqual([]);
    expect(checkDraft({ ...ok, items: [story()] }, ctx({ proposed: "decouvrabilite" }))).toContain(
      "Découvrabilité : rien dans le backlog (ni epic ni élément)",
    );
    expect(checkDraft({ ...draft(), discoverability: action }, ctx())).toContain(
      "discoverability seulement pour le format decouvrabilite",
    );
  });
});

describe("draftSchema", () => {
  it("refuses evidence outside the insight and OKRs outside strategy.md", () => {
    const schema = draftSchema(ctx());
    expect(schema.safeParse(draft()).success).toBe(true);
    expect(
      schema.safeParse(draft({ items: [story({ evidence: ["R-999"] }), story(), story()] }))
        .success,
    ).toBe(false);
    expect(schema.safeParse(draft({ epic: { ...epic, okr_refs: ["O9-KR9"] } })).success).toBe(
      false,
    );
  });

  it("each kind requires its own fields (discriminated union)", () => {
    const schema = draftSchema(ctx({ proposed: "bugs" }));
    const incomplete = { ...bug, expected_behavior: undefined };
    expect(
      schema.safeParse(
        draft({ format: "bugs", epic: null, items: [incomplete as unknown as DraftItem] }),
      ).success,
    ).toBe(false);
    expect(schema.safeParse(draft({ format: "bugs", epic: null, items: [bug] })).success).toBe(
      true,
    );
  });
});

describe("affectedAccounts (computed in code)", () => {
  const customers = [
    { id: "C-001", plan: "enterprise" },
    { id: "C-002", plan: "pro" },
    { id: "C-003", plan: "enterprise" },
  ];
  const feedbacks = [
    { id: "R-001", customer_id: "C-001" },
    { id: "R-002", customer_id: "C-002" },
    { id: "R-003", customer_id: "C-003" },
    { id: "R-004", customer_id: null },
    { id: "R-005", customer_id: "C-001" },
  ];

  it("counts the distinct accounts of the bug items, with the Enterprise ones", () => {
    const items = [
      { type: "bug", feedback_id: "R-001" },
      { type: "bug", feedback_id: "R-002" },
      { type: "bug", feedback_id: "R-004" },
      { type: "bug", feedback_id: "R-005" },
      { type: "irritant_ux", feedback_id: "R-003" },
    ];
    expect(affectedAccounts(items, feedbacks, customers)).toEqual({
      ids: ["C-001", "C-002"],
      enterprise: 1,
    });
  });

  it("falls back on every item when none is a bug", () => {
    const items = [
      { type: "irritant_ux", feedback_id: "R-002" },
      { type: "irritant_ux", feedback_id: "R-003" },
    ];
    expect(affectedAccounts(items, feedbacks, customers)).toEqual({
      ids: ["C-002", "C-003"],
      enterprise: 1,
    });
  });
});

describe("dorChecklist", () => {
  it("checks purpose, testable criteria, estimate and evidence per kind", () => {
    const s = story() as Extract<DraftItem, { kind: "story" }>;
    expect(
      dorChecklist({
        kind: "story",
        value: s.value,
        acceptance_criteria: s.acceptance_criteria,
        estimated: true,
        evidence: ["R-001"],
      }),
    ).toEqual({
      valeur_ou_objectif: true,
      criteres_testables: true,
      estimation_justifiee: true,
      preuves: true,
      dependances_listees: true,
    });
    const t = dorChecklist({
      kind: "tache",
      objective: "",
      definition_of_done: [],
      estimated: false,
      evidence: [],
    });
    expect(t).toMatchObject({
      valeur_ou_objectif: false,
      criteres_testables: false,
      estimation_justifiee: false,
      preuves: false,
    });
  });
});

describe("Gherkin as text", () => {
  it("round-trips scenarios, the edge case included", () => {
    const scenarios = [
      scenario(),
      {
        ...scenario(true),
        steps: [...scenario().steps, { keyword: "Et" as const, text: "rien d'autre" }],
      },
    ];
    const text = formatGherkin(scenarios);
    expect(text).toContain("Scénario (cas limite) : accès refusé");
    expect(text).toContain("  Étant donné un projet partagé");
    expect(parseGherkin(text)).toEqual({ ok: true, scenarios });
  });

  it("reports an unreadable line instead of dropping it", () => {
    expect(parseGherkin("Étant donné un projet")).toEqual({
      ok: false,
      error: "Le texte doit commencer par « Scénario : … »",
    });
    const result = parseGherkin("Scénario : a\n  Étant donné x\n  Puis y");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Ligne 3 illisible");
  });

  it("checkScenarios reads the parsed text", () => {
    const parsed = parseGherkin(formatGherkin([scenario(), scenario(true)]));
    expect(parsed.ok && checkScenarios("x", parsed.scenarios)).toEqual([]);
  });
});

describe("storyPart", () => {
  it("drops the template's words and the final punctuation the model sometimes writes", () => {
    expect(storyPart("value", "Afin de ne plus reformater un export,,")).toBe(
      "ne plus reformater un export",
    );
    expect(storyPart("value", "afin d'éviter une erreur.")).toBe("éviter une erreur");
    expect(storyPart("persona", "En tant que chef de projet en agence")).toBe(
      "chef de projet en agence",
    );
    expect(storyPart("persona", "en tant qu'admin")).toBe("admin");
    expect(storyPart("want", "je veux exporter l'avancement..")).toBe("exporter l'avancement");
    expect(storyPart("want", "voir mes invités")).toBe("voir mes invités");
    expect(storyPart("value", null)).toBe("");
  });
});
