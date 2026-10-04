import { z } from "zod";
import { loadSkill } from "@/lib/skills";
import { signalTool } from "./shared";

export function loadSkillTool(skillsDir?: string) {
  return signalTool(
    {
      name: "load_skill",
      summary:
        "Charge le contenu complet d'une skill du pack de contexte (règles, gabarits, exemples).",
      when: "Avant toute tâche couverte par une skill (rédaction, MoSCoW, challenge, estimation, digest).",
      notWhen: "La skill est déjà chargée dans cette conversation.",
      schema: z.object({ name: z.string().describe("Nom de la skill, tel que dans l'index.") }),
      // A skill is first-party guidance from the versioned pack, not third-party data.
      wrap: false,
    },
    async ({ name }) => {
      const skill = await loadSkill(name, skillsDir);
      return `# Skill ${skill.name}\n\n${skill.content}`;
    },
  );
}
