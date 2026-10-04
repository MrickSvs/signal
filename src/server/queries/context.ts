import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONTEXT_DOCUMENTS, DEFAULT_CONTEXT_DIR, type ContextDocument } from "@/lib/context";
import { markdownSection, weightingSections, type WeightingSection } from "@/lib/context-view";
import { listSkills, loadSkill, type Skill } from "@/lib/skills";

// Reads of the Context screen (SPEC §12.8): the pack as files, straight from the repo.

export type ContextScreen = {
  documents: { name: ContextDocument; file: string; content: string }[];
  weighting: WeightingSection[];
  skills: Skill[];
  /** « Adapter Signal à un autre produit » of the pack README: one source for the 3 steps. */
  adapt: string | null;
};

const read = (file: string) => readFile(path.join(DEFAULT_CONTEXT_DIR, file), "utf8");

export async function getContextScreen(): Promise<ContextScreen> {
  const [documents, weightingSource, readme, index] = await Promise.all([
    Promise.all(
      CONTEXT_DOCUMENTS.map(async (name) => ({
        name,
        file: `${name}.md`,
        content: await read(`${name}.md`),
      })),
    ),
    read("weighting.yaml"),
    read("README.md"),
    listSkills(),
  ]);
  const skills = await Promise.all(index.map((s) => loadSkill(s.name)));
  return {
    documents,
    weighting: weightingSections(weightingSource),
    skills,
    adapt: markdownSection(readme, "Adapter Signal à un autre produit"),
  };
}
