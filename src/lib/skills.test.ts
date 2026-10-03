import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContextPack } from "./context";
import { DEFAULT_SKILLS_DIR, listSkills, loadSkill, parseSkill, SkillError } from "./skills";

const EXPECTED = [
  "backlog-format",
  "challenge",
  "digest",
  "estimation",
  "moscow",
  "prototype",
  "rice-scoring",
  "triage-taxonomy",
  "user-story",
];

describe("skills (real pack)", () => {
  it("lists the 9 skills with a valid frontmatter", async () => {
    const skills = await listSkills();
    expect(skills.map((s) => s.name)).toEqual(EXPECTED);
    for (const skill of skills) expect(skill.description).toMatch(/^À utiliser /);
  });

  it("keeps every skill between 80 and 200 lines", async () => {
    for (const name of EXPECTED) {
      const source = await readFile(path.join(DEFAULT_SKILLS_DIR, name, "SKILL.md"), "utf8");
      const lines = source.trimEnd().split("\n").length;
      expect(lines, name).toBeGreaterThanOrEqual(80);
      expect(lines, name).toBeLessThanOrEqual(200);
    }
  });

  it("gives every skill the required sections", async () => {
    for (const name of EXPECTED) {
      const { content } = await loadSkill(name);
      expect(content, name).toMatch(/^## Objectif/m);
      expect(content, name).toMatch(/^## Règles/m);
      expect(content, name).toMatch(/^## Bon exemple/m);
      expect(content, name).toMatch(/^## Mauvais exemple commenté/m);
      expect(content, name).toMatch(/^## Erreurs fréquentes/m);
    }
  });

  it("backlog-format holds the choice rule and one example per type (SPEC §9)", async () => {
    const { content } = await loadSkill("backlog-format");
    expect(content).toMatch(/## Règle de choix/);
    expect(content).toMatch(/Epic \+ 3 à 6 stories/);
    expect(content).toMatch(/Rien dans le backlog/);
    expect(content).toMatch(/^US-\d{3} — /m);
    expect(content).toMatch(/^Afin de .+,\nen tant que .+,\nje veux .+\./m);
    expect(content).toMatch(/^BUG-\d{3} — /m);
    expect(content).toMatch(
      /Comportement attendu :[\s\S]*Comportement constaté :[\s\S]*Étapes de reproduction :/,
    );
    expect(content).toMatch(/^TT-\d{3} — /m);
    expect(content).toMatch(/Définition de terminé :[\s\S]*Risques :/);
  });

  it("user-story holds the full template of SPEC §9.1", async () => {
    const { content } = await loadSkill("user-story");
    const template = content.split("## Gabarit complet")[1].split("## Règles")[0];
    for (const part of [
      "Afin de",
      "en tant que",
      "je veux",
      "Règles de gestion",
      "Critères d'acceptation",
      "Scénario :",
      "Étant donné",
      "Quand",
      "Alors",
      "KPI de succès",
      "Estimation :",
      "Preuves :",
      "Maquette :",
    ]) {
      expect(template, part).toContain(part);
    }
    expect(content).toMatch(/## Checklist INVEST/);
    expect(content).toMatch(/## Découpage vertical/);
  });

  it("triage-taxonomy holds the exact enums and a multi-topic example split in two items", async () => {
    const { content } = await loadSkill("triage-taxonomy");
    const types = [
      "bug",
      "demande_fonctionnelle",
      "irritant_ux",
      "question",
      "eloge",
      "signal_churn",
      "autre",
    ];
    const areas = [
      "taches",
      "tableau_kanban",
      "notifications",
      "permissions_partage",
      "reporting_export",
      "planification",
      "integrations",
      "facturation_temps",
      "personnalisation",
      "performance",
    ];
    for (const value of [...types, ...areas, "basse", "moyenne", "haute", "critique"]) {
      expect(content, value).toContain(`\`${value}\``);
    }
    const example = content.split("## Bon exemple : retour multi-sujets")[1].split("## Mauvais")[0];
    const json = JSON.parse(example.split("```json")[1].split("```")[0]);
    expect(json.items).toHaveLength(2);
    expect(new Set(json.items.map((i: { product_area: string }) => i.product_area)).size).toBe(2);
  });

  it("estimation cites only architecture module ids in its components", async () => {
    const { modules } = await loadContextPack();
    const ids = new Set(modules.map((m) => m.id));
    const { content } = await loadSkill("estimation");
    const good = content.split("## Bon exemple")[1].split("## Mauvais")[0];
    const json = JSON.parse(good.split("```json")[1].split("```")[0]);
    for (const component of json.components) expect(ids.has(component), component).toBe(true);
  });
});

describe("loadSkill", () => {
  it("refuses a name outside the index (no path traversal)", async () => {
    await expect(loadSkill("../weighting.yaml")).rejects.toThrow(SkillError);
    await expect(loadSkill("inconnue")).rejects.toThrow(/introuvable/);
  });
});

describe("parseSkill", () => {
  const skill = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Titre\n\nCorps.\n`;

  it("splits frontmatter and body", () => {
    expect(
      parseSkill(skill("name: demo\ndescription: À utiliser pour une démonstration."), "demo"),
    ).toEqual({
      name: "demo",
      description: "À utiliser pour une démonstration.",
      content: "# Titre\n\nCorps.",
    });
  });

  it("rejects a missing frontmatter, a missing description and a name that differs from its folder", () => {
    expect(() => parseSkill("# Titre", "demo")).toThrow(/frontmatter/);
    expect(() => parseSkill(skill("name: demo"), "demo")).toThrow(/description/);
    expect(() =>
      parseSkill(skill("name: autre\ndescription: À utiliser pour une démonstration."), "demo"),
    ).toThrow(/match its folder/);
  });
});

describe("listSkills (errors)", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("names the folder whose SKILL.md is missing", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "skills-"));
    await mkdir(path.join(dir, "vide"));
    await writeFile(path.join(dir, "README.md"), "ignoré");
    await expect(listSkills(dir)).rejects.toThrow(/skills\/vide/);
  });
});
