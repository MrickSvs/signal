// Calibration set of the judge (SPEC §14.3): 15 items drafted by Signal (10 stories,
// 3 bugs, 2 tasks) over at least 4 insights, 5 of them degraded in code. No model call.
// Writes evals/human-labels/calibration-set.json (what the PO annotates, shuffled, CAL-01…) and
// calibration-key.json (source and degradation, read by eval:judge-calibration only).
// Usage: pnpm eval:calibration-set [--force]   (refuses to replace a set already annotated)
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getScriptDb } from "@/lib/db/script-client";
import {
  CALIBRATION_KEY_FILE,
  CALIBRATION_SET_FILE,
  loadAnnotations,
  type CalibrationItem,
  type CalibrationKey,
} from "@/lib/judge/calibration";
import type { JudgeInput } from "@/lib/judge/judge";
import { loadJudgeInputs } from "@/services/backlog";
import { createRandom } from "../lib/random";
import { DEGRADATIONS, type Degradation } from "./lib/degrade";

export const SET_SEED = 63;
const REAL_STORIES = 6;
const MIN_INSIGHTS = 4;

export type Source = JudgeInput & { insight_id: string };
export type Planned = {
  kind: JudgeInput["kind"];
  source_id: string;
  insight_id: string;
  degradation: Degradation | null;
  content: Record<string, unknown>;
};

const byId = (a: { id: string }, b: { id: string }) =>
  Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]);

/** Round-robin over the insights, in id order: as many insights as possible. */
function spread(items: readonly Source[], n: number): Source[] {
  const groups = new Map<string, Source[]>();
  for (const item of items.toSorted(byId))
    groups.set(item.insight_id, [...(groups.get(item.insight_id) ?? []), item]);
  const picked: Source[] = [];
  while (picked.length < n && [...groups.values()].some((g) => g.length)) {
    for (const group of groups.values()) {
      const next = group.shift();
      if (next && picked.length < n) picked.push(next);
    }
  }
  return picked;
}

/** The 15 items: 6 + 4 degraded stories, 2 + 1 degraded bugs, 2 tasks. Pure. */
export function planCalibrationSet(sources: readonly Source[]): Planned[] {
  const stories = sources.filter((s) => s.kind === "story");
  const bugs = sources.filter((s) => s.kind === "bug").toSorted(byId);
  const tasks = sources.filter((s) => s.kind === "tache").toSorted(byId);
  if (stories.length < 12 || bugs.length < 2 || tasks.length < 2)
    throw new Error(
      `Backlog trop court : ${stories.length} stories (12 requises), ${bugs.length} bugs (2), ${tasks.length} tâches (2).`,
    );

  const real = spread(stories, REAL_STORIES);
  const left = stories.filter((s) => !real.includes(s));
  // The story too big glues three stories of one insight: the insight with most left.
  const counts = new Map<string, number>();
  for (const s of left) counts.set(s.insight_id, (counts.get(s.insight_id) ?? 0) + 1);
  const bigInsight = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!bigInsight || bigInsight[1] < 3) throw new Error("Aucun insight avec 3 stories libres");
  const [big, ...glued] = left
    .filter((s) => s.insight_id === bigInsight[0])
    .toSorted(byId)
    .slice(0, 3);
  const others = spread(
    left.filter((s) => s.insight_id !== bigInsight[0] || ![big, ...glued].includes(s)),
    3,
  );
  if (others.length < 3) throw new Error("Pas assez de stories à dégrader");

  const keep = (s: Source): Planned => ({
    kind: s.kind,
    source_id: s.id,
    insight_id: s.insight_id,
    degradation: null,
    content: s.content,
  });
  const degrade = (
    s: Source,
    degradation: Degradation,
    content: Record<string, unknown>,
  ): Planned => ({
    ...keep(s),
    degradation,
    content,
  });
  const bugWithSteps =
    bugs.find((b) => Array.isArray(b.content.repro_steps) && b.content.repro_steps.length) ??
    bugs[0];
  const planned = [
    ...real.map(keep),
    degrade(others[0], "valeur_repetee", DEGRADATIONS.valeur_repetee(others[0].content)),
    degrade(
      others[1],
      "criteres_non_testables",
      DEGRADATIONS.criteres_non_testables(others[1].content),
    ),
    degrade(others[2], "preuves_absentes", DEGRADATIONS.preuves_absentes(others[2].content)),
    degrade(
      big,
      "story_trop_grosse",
      DEGRADATIONS.story_trop_grosse(
        big.content,
        glued.map((g) => g.content),
      ),
    ),
    ...bugs.slice(0, 2).map(keep),
    degrade(
      bugWithSteps,
      "bug_sans_reproduction",
      DEGRADATIONS.bug_sans_reproduction(bugWithSteps.content),
    ),
    ...tasks.slice(0, 2).map(keep),
  ];
  const insights = new Set(planned.map((p) => p.insight_id));
  if (insights.size < MIN_INSIGHTS)
    throw new Error(`${insights.size} insights seulement (${MIN_INSIGHTS} requis)`);
  return planned;
}

/** Shuffled with a fixed seed and numbered CAL-01…: the order tells nothing. Pure. */
export function numberSet(planned: readonly Planned[], seed = SET_SEED) {
  const shuffled = createRandom(seed).shuffle([...planned]);
  const items: CalibrationItem[] = [];
  const key: CalibrationKey[] = [];
  shuffled.forEach((p, i) => {
    const id = `CAL-${String(i + 1).padStart(2, "0")}`;
    items.push({ id, kind: p.kind, content: p.content });
    key.push({ id, source_id: p.source_id, insight_id: p.insight_id, degradation: p.degradation });
  });
  return { items, key };
}

async function main() {
  const force = process.argv.includes("--force");
  if ((await loadAnnotations()).size > 0 && !force)
    throw new Error(
      "Des annotations existent déjà : régénérer le jeu changerait les éléments annotés (--force pour forcer).",
    );
  const db = getScriptDb();
  const { data, error } = await db
    .from("backlog_items")
    .select("id, insight_id")
    .neq("status", "rejete");
  if (error) throw new Error(`Lecture du backlog (${error.message})`);
  const insightOf = new Map((data ?? []).map((r) => [r.id, r.insight_id]));
  const inputs = await loadJudgeInputs(db, [...insightOf.keys()]);
  const planned = planCalibrationSet(
    inputs.map((i) => ({ ...i, insight_id: insightOf.get(i.id)! })),
  );
  const { items, key } = numberSet(planned);
  writeFileSync(CALIBRATION_SET_FILE, JSON.stringify(items, null, 2) + "\n");
  writeFileSync(CALIBRATION_KEY_FILE, JSON.stringify(key, null, 2) + "\n");
  const count = (k: string) => items.filter((i) => i.kind === k).length;
  console.log(
    `Jeu de calibration : ${items.length} éléments (${count("story")} stories, ${count("bug")} bugs, ${count("tache")} tâches), ` +
      `${new Set(key.map((k) => k.insight_id)).size} insights, ${key.filter((k) => k.degradation).length} dégradés.`,
  );
  console.log("À annoter sur /evals/annotate (pnpm dev).");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
