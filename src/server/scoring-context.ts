import "server-only";
import { loadContextPack } from "@/lib/context";
import { getDemoNow } from "@/lib/demo-now";
import { loadSkill } from "@/lib/skills";

/** Context pack, scoring skills and scenario clock, as the scoring services expect them. */
export async function loadScoringContext() {
  const [pack, riceScoring, moscow] = await Promise.all([
    loadContextPack(),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
  ]);
  return {
    pack,
    skills: { riceScoring: riceScoring.content, moscow: moscow.content },
    now: getDemoNow(),
  };
}
