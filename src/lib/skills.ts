// Business skills (SPEC §6.4, §10.4): one SKILL.md per folder, shared by the pipeline and the agent.
// The agent sees the index (name + description) and loads a skill on demand by name.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { DEFAULT_CONTEXT_DIR } from "./context";

export const DEFAULT_SKILLS_DIR = path.join(DEFAULT_CONTEXT_DIR, "skills");

const frontmatterSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case"),
  description: z.string().trim().min(20).max(300),
});

export type SkillSummary = z.infer<typeof frontmatterSchema>;
export type Skill = SkillSummary & { content: string };

export class SkillError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SkillError";
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Splits a SKILL.md into its validated frontmatter and its markdown body. */
export function parseSkill(source: string, folder: string): Skill {
  const match = FRONTMATTER.exec(source);
  if (!match) throw new SkillError(`skills/${folder}: missing YAML frontmatter`);

  let raw: unknown;
  try {
    raw = parseYaml(match[1]);
  } catch (error) {
    throw new SkillError(`skills/${folder}: invalid YAML frontmatter`, { cause: error });
  }
  const parsed = frontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SkillError(`skills/${folder}: ${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  if (parsed.data.name !== folder) {
    throw new SkillError(`skills/${folder}: name « ${parsed.data.name} » must match its folder`);
  }
  return { ...parsed.data, content: source.slice(match[0].length).trim() };
}

async function skillFolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function readSkill(dir: string, folder: string): Promise<Skill> {
  const file = path.join(dir, folder, "SKILL.md");
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    throw new SkillError(`skills/${folder}: cannot read SKILL.md`, { cause: error });
  }
  return parseSkill(source, folder);
}

/** Index of the skills (name + description), sorted by name. */
export async function listSkills(dir: string = DEFAULT_SKILLS_DIR): Promise<SkillSummary[]> {
  const skills = await Promise.all((await skillFolders(dir)).map((f) => readSkill(dir, f)));
  return skills.map(({ name, description }) => ({ name, description }));
}

/**
 * Loads one skill by name. Only names present in the index are accepted, so a name coming
 * from a model can never point outside the skills folder.
 */
export async function loadSkill(name: string, dir: string = DEFAULT_SKILLS_DIR): Promise<Skill> {
  const folders = await skillFolders(dir);
  if (!folders.includes(name)) {
    throw new SkillError(
      `Skill « ${name} » introuvable. Skills disponibles : ${folders.join(", ")}.`,
    );
  }
  return readSkill(dir, name);
}
