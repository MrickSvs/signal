import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/backlog/draft";
import {
  BACKLOG_PROPERTIES,
  backlogPageBlocks,
  backlogPagePreview,
  backlogPageProperties,
  chunk,
  richText,
  RICH_TEXT_MAX,
  signalUrl,
  splitText,
  statement,
  type NotionBacklogItem,
} from "./mappers";

const scenario = (name: string, edge = false): Scenario => ({
  name,
  edge_case: edge,
  steps: [
    { keyword: "Étant donné", text: "un client invité sur un projet" },
    { keyword: "Quand", text: "il ouvre l'espace" },
    { keyword: "Alors", text: "il ne voit que ce projet" },
  ],
});

const story: NotionBacklogItem = {
  id: "US-004",
  kind: "story",
  title: "Inviter un client sur un seul projet",
  points: 5,
  value: "Afin de partager l'avancement sans tout exposer",
  persona: "en tant que cheffe de projet",
  want: "je veux inviter un client sur un seul projet",
  success_kpi: "30 % des comptes Pro invitent un client en 60 jours",
  expected_behavior: null,
  actual_behavior: null,
  repro_steps: [],
  severity: null,
  affected_accounts: [],
  objective: null,
  definition_of_done: [],
  risks: [],
  business_rules: ["Un invité ne voit que les projets partagés", "L'invitation expire en 7 jours"],
  acceptance_criteria: [scenario("Invitation"), scenario("Lien expiré", true)],
  evidence: ["R-012", "R-044"],
  epic: { id: "E-02", title: "Permissions par projet" },
  insight: { id: "I-03", title: "Partager un projet avec un client" },
  moscow: "must",
  prototype_url: null,
};

const bug: NotionBacklogItem = {
  ...story,
  id: "BUG-002",
  kind: "bug",
  title: "Notifications en retard",
  value: null,
  persona: null,
  want: null,
  success_kpi: null,
  business_rules: [],
  expected_behavior: "La notification arrive en moins d'une minute",
  actual_behavior: "Elle arrive avec 2 heures de retard",
  repro_steps: ["Assigner une tâche", "Attendre"],
  severity: "majeur",
  affected_accounts: ["C-001", "C-002"],
  epic: null,
};

const task: NotionBacklogItem = {
  ...bug,
  id: "TT-001",
  kind: "tache",
  title: "Centraliser les permissions",
  expected_behavior: null,
  actual_behavior: null,
  repro_steps: [],
  severity: null,
  acceptance_criteria: [],
  objective: "Un seul point de contrôle des droits",
  definition_of_done: ["6 contrôles migrés", "Tests verts"],
  risks: ["Régression sur l'export"],
};

const BASE = "https://signal.example.app/";
const text = (blocks: unknown) => JSON.stringify(blocks);

describe("long texts (CL-41)", () => {
  it("cuts a text in pieces of 2 000 characters at most, without losing a character", () => {
    const long = "mot ".repeat(1500).trim();
    const pieces = splitText(long);
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(RICH_TEXT_MAX);
    expect(pieces.join("")).toBe(long);
    expect(splitText("x".repeat(4500)).map((p) => p.length)).toEqual([2000, 2000, 500]);
    expect(splitText("")).toEqual([""]);
  });

  it("turns a long text into several rich text objects", () => {
    const rich = richText("a".repeat(4100), { bold: true });
    expect(rich).toHaveLength(3);
    expect(rich[0]).toMatchObject({
      text: { content: "a".repeat(2000) },
      annotations: { bold: true },
    });
  });

  it("batches page bodies by 100 blocks", () => {
    const batches = chunk(Array.from({ length: 250 }, (_, i) => i));
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(chunk([])).toEqual([]);
  });
});

describe("page properties (SPEC §11.1)", () => {
  it("fills every property of the Backlog data source, born « Prêt »", () => {
    const props = backlogPageProperties(story, {
      baseUrl: BASE,
      validatedAt: new Date("2026-10-05T10:00:00Z"),
    });
    expect(Object.keys(props).sort()).toEqual(Object.keys(BACKLOG_PROPERTIES).sort());
    expect(props).toMatchObject({
      Type: { select: { name: "Story" } },
      Statut: { select: { name: "Prêt" } },
      MoSCoW: { select: { name: "Must" } },
      Points: { number: 5 },
      Epic: { rich_text: [{ text: { content: "E-02 · Permissions par projet" } }] },
      "Lien Signal": { url: "https://signal.example.app/backlog?element=US-004" },
      "Validé le": { date: { start: "2026-10-05T10:00:00.000Z" } },
    });
  });

  it("maps each type and leaves an empty epic or MoSCoW empty", () => {
    const props = backlogPageProperties(
      { ...bug, moscow: null },
      { baseUrl: BASE, validatedAt: new Date() },
    );
    expect(props).toMatchObject({
      Type: { select: { name: "Bug" } },
      Epic: { rich_text: [] },
      MoSCoW: { select: null },
    });
    expect(backlogPageProperties(task, { baseUrl: BASE, validatedAt: new Date() })).toMatchObject({
      Type: { select: { name: "Tâche" } },
    });
  });

  it("states the item in one sentence per type", () => {
    expect(statement(story)).toBe(
      "Afin de partager l'avancement sans tout exposer, en tant que cheffe de projet, je veux inviter un client sur un seul projet.",
    );
    expect(statement(bug)).toBe("Elle arrive avec 2 heures de retard");
    expect(statement(task)).toBe("Un seul point de contrôle des droits");
  });

  it("builds links from APP_BASE_URL", () => {
    expect(signalUrl("https://a.app///", "/proto/1")).toBe("https://a.app/proto/1");
  });
});

describe("page body (SPEC §9)", () => {
  it("story: statement, rules, Gherkin, KPI and evidence linked to Signal", () => {
    const body = text(backlogPageBlocks(story, BASE));
    for (const part of [
      "Règles de gestion",
      "L'invitation expire en 7 jours",
      "Critères d'acceptation",
      "Scénario (cas limite) : Lien expiré",
      "Étant donné ",
      "KPI de succès",
      "Preuves",
      "https://signal.example.app/retours?retour=R-044",
    ])
      expect(body).toContain(part);
  });

  it("bug: expected, observed, reproduction, severity and evidence", () => {
    const blocks = backlogPageBlocks(bug, BASE);
    const body = text(blocks);
    for (const part of [
      "Sévérité : ",
      "Majeur",
      "comptes touchés : 2",
      "Comportement attendu",
      "Comportement constaté",
      "Étapes de reproduction",
      "Preuves",
    ])
      expect(body).toContain(part);
    expect(blocks.filter((b) => b.type === "numbered_list_item")).toHaveLength(2);
    expect(body).not.toContain("Règles de gestion");
  });

  it("technical task: objective, definition of done, risks, no Gherkin", () => {
    const body = text(backlogPageBlocks(task, BASE));
    for (const part of ["Objectif", "Définition de terminé", "6 contrôles migrés", "Risques"])
      expect(body).toContain(part);
    expect(body).not.toContain("Critères d'acceptation");
  });

  it("keeps every rich text of a long body within the limit (CL-41)", () => {
    const long = { ...story, business_rules: ["r ".repeat(3000)] };
    const blocks = backlogPageBlocks(long, BASE);
    const contents = text(blocks).match(/"content":"[^"]*"/g)!;
    for (const c of contents) expect(c.length - 12).toBeLessThanOrEqual(RICH_TEXT_MAX);
  });
});

describe("approval preview (SPEC §10.6)", () => {
  it("shows the page as Notion receives it", () => {
    const preview = backlogPagePreview(story);
    expect(preview).toContain("US-004 · Story · Inviter un client sur un seul projet");
    expect(preview).toContain("Statut Prêt · 5 points · Must · epic E-02 · insight I-03");
    expect(preview).toContain("Corps : 2 règles, 2 scénarios, 2 preuves.");
    expect(backlogPagePreview(task)).toContain("2 critères de terminé");
  });
});

describe("sparse items", () => {
  const bare: NotionBacklogItem = {
    ...task,
    id: "BUG-009",
    kind: "bug",
    points: null,
    objective: null,
    definition_of_done: [],
    risks: [],
    evidence: [],
    insight: null,
    moscow: null,
  };

  it("bug without behaviors, severity, steps or criteria: empty sections, no evidence", () => {
    const blocks = text(backlogPageBlocks(bare, BASE));
    expect(statement(bare)).toBe("");
    expect(blocks).toContain("—");
    expect(blocks).not.toContain("Étapes de reproduction");
    expect(blocks).not.toContain("Critères d'acceptation");
    expect(blocks).not.toContain("Preuves");
    const properties = backlogPageProperties(bare, { baseUrl: BASE, validatedAt: new Date() });
    expect(properties.Insight).toEqual({ rich_text: [] });
    expect(backlogPagePreview(bare)).toBe(
      "BUG-009 · Bug · Centraliser les permissions\nStatut Prêt · non estimé\n",
    );
  });

  it("bug preview counts its scenarios and reproduction steps", () => {
    expect(
      backlogPagePreview({ ...bare, repro_steps: ["a"], acceptance_criteria: [scenario("x")] }),
    ).toContain("Corps : 1 scénarios, 1 étapes de reproduction.");
  });

  it("story without rules or KPI, task without objective, definition of done or risks", () => {
    const plainStory = text(
      backlogPageBlocks({ ...story, business_rules: [], success_kpi: null }, BASE),
    );
    expect(plainStory).not.toContain("Règles de gestion");
    expect(plainStory).not.toContain("KPI de succès");
    const plainTask = { ...bare, kind: "tache" as const };
    expect(statement(plainTask)).toBe("");
    const blocks = text(backlogPageBlocks(plainTask, BASE));
    expect(blocks).toContain("Objectif");
    expect(blocks).not.toContain("Définition de terminé");
    expect(blocks).not.toContain("Risques");
  });

  it("a text of exactly twice the limit gives two full pieces and no empty one", () => {
    expect(splitText("a".repeat(2 * RICH_TEXT_MAX))).toEqual([
      "a".repeat(RICH_TEXT_MAX),
      "a".repeat(RICH_TEXT_MAX),
    ]);
  });
});
