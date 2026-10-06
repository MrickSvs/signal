// eval:backlog (PLAN 6.3, SPEC §14.2): drafting on 5 insights (S1, S2b, S3, S7 and a manual
// technical topic), as if their backlog were empty. Measures the type chosen against the one
// expected per pattern (S1 → bugs; S2b → epic + stories; S3 → story or epic; S7 → bug or task;
// technical topic → task), then the judge's note of every drafted item. Nothing is written but
// the estimate cache (the drafting is composeDraft, not draftBacklog).
// Usage: pnpm eval:backlog [--manual I-xx] [--yes]
// Cost: ~0,12 € per drafting + ~0,04 € per judged item: about 1,1 € for 4 to 5 insights.
import { pathToFileURL } from "node:url";
import { mapWithConcurrency } from "@/lib/async";
import { isTechnicalTopic, type BacklogFormat } from "@/lib/backlog/choose-format";
import type { DraftItem } from "@/lib/backlog/draft";
import { loadContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { JUDGE_CALIBRATED, judgeItem, loadRubric, type ItemJudgment } from "@/lib/judge/judge";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { composeDraft, loadDraftingFacts, type BacklogDeps } from "@/services/backlog";
import { checkCost, parseEvalArgs } from "./lib/args";
import { mean } from "./lib/metrics";
import { EvalRecorder } from "./lib/record";
import { loadEvalSet, loadLiveInsights, resolvePatterns } from "./lib/truth";
import type { EvalSummary, Metric } from "./lib/types";

const COST_PER_DRAFT_EUR = 0.12;
const COST_PER_JUDGMENT_EUR = 0.04;
const ITEMS_PER_DRAFT = 4;
export const MIN_NOTE = 4;

export const TARGETS = ["S1", "S2b", "S3", "S7", "manuel"] as const;
export type Target = (typeof TARGETS)[number];

/** Formats accepted per target (SPEC §14.2). */
export const EXPECTED_FORMATS: Record<Target, BacklogFormat[]> = {
  S1: ["bugs"],
  S2b: ["epic_stories"],
  S3: ["story", "epic_stories"],
  S7: ["bugs", "tache"],
  manuel: ["tache"],
};

type Drafted = { format: BacklogFormat; epic: unknown; items: DraftItem[] };

/** The format is accepted and the items fit it (bugs are bugs, an epic holds stories). Pure. */
export function typeConforms(target: Target, draft: Drafted): { pass: boolean; reason: string } {
  if (!EXPECTED_FORMATS[target].includes(draft.format))
    return {
      pass: false,
      reason: `format ${draft.format}, attendu ${EXPECTED_FORMATS[target].join(" ou ")}`,
    };
  const kinds = draft.items.map((i) => i.kind);
  const only = (k: DraftItem["kind"]) => kinds.length > 0 && kinds.every((x) => x === k);
  switch (draft.format) {
    case "bugs":
      return only("bug")
        ? { pass: true, reason: "ok" }
        : { pass: false, reason: `éléments ${kinds.join(", ")}` };
    case "tache":
      return only("tache")
        ? { pass: true, reason: "ok" }
        : { pass: false, reason: `éléments ${kinds.join(", ")}` };
    case "epic_stories":
      return draft.epic && kinds.filter((k) => k === "story").length >= 2
        ? { pass: true, reason: "ok" }
        : { pass: false, reason: draft.epic ? "moins de deux stories" : "pas d'epic" };
    default:
      return kinds.includes("story")
        ? { pass: true, reason: "ok" }
        : { pass: false, reason: "aucune story" };
  }
}

/** What the judge reads of a drafted item (not estimated here: no write). */
export function draftedContent(item: DraftItem): Record<string, unknown> {
  const { depends_on: _positions, ...content } = item;
  void _positions;
  return content;
}

async function resolveTargets(db: Db, manual: string | undefined) {
  const { truth } = loadEvalSet("development");
  const insights = await loadLiveInsights(db);
  const patterns = resolvePatterns(insights, truth);
  const targets = new Map<Target, string | null>();
  for (const t of TARGETS) {
    if (t !== "manuel") targets.set(t, patterns.get(t)?.insight_id ?? null);
  }
  if (manual) targets.set("manuel", manual);
  else {
    const { data } = await db
      .from("insights")
      .select("id, origin, title, problem_statement")
      .eq("origin", "manuel")
      .in("status", ["propose", "actif"])
      .order("id");
    targets.set("manuel", (data ?? []).find((i) => isTechnicalTopic(i))?.id ?? null);
  }
  return targets;
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2), { valued: ["--manual"] });
  const db = getScriptDb();
  initTracing();
  const targets = await resolveTargets(db, args.values.get("--manual"));
  const measured = [...targets].filter(([, id]) => id) as [Target, string][];
  console.log(`Insights : ${[...targets].map(([t, id]) => `${t} ${id ?? "—"}`).join(" · ")}`);
  console.log(
    checkCost(
      measured.length * (COST_PER_DRAFT_EUR + ITEMS_PER_DRAFT * COST_PER_JUDGMENT_EUR),
      args,
      `${measured.length} rédactions et le juge sur chaque élément`,
    ),
  );

  const [pack, riceScoring, moscow, backlogFormat, userStory, rubric] = await Promise.all([
    loadContextPack(),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
    loadSkill("backlog-format"),
    loadSkill("user-story"),
    loadRubric(),
  ]);
  const runCost = new RunCost();
  const skills = { backlogFormat: backlogFormat.content, userStory: userStory.content };
  const deps: BacklogDeps = {
    pack,
    skills: { riceScoring: riceScoring.content, moscow: moscow.content },
    now: getDemoNow(),
    source: "signal_ui",
    runCost,
    draftSkills: skills,
  };
  const recorder = await EvalRecorder.start(
    db,
    "backlog",
    { targets: Object.fromEntries(targets) },
    measured.length,
  );

  const outcomes = await mapWithConcurrency(measured, 2, ([target, insightId]) =>
    withTrace(
      "eval-backlog-case",
      {
        root: true,
        runId: recorder.runId,
        step: "eval",
        entity: insightId,
        tags: ["eval", "backlog"],
      },
      { target, insight_id: insightId },
      async () => {
        const traceId = currentTraceId();
        // As if the insight had no backlog yet: kept items would steer the drafting.
        const facts = { ...(await loadDraftingFacts(db, insightId)), backlog: [], epics: [] };
        try {
          const { draft, choice } = await composeDraft(db, facts, {}, deps);
          const items = draft.format === "decouvrabilite" ? [] : draft.items;
          const conform = typeConforms(target, {
            format: draft.format,
            epic: "epic" in draft ? draft.epic : null,
            items,
          });
          const judgments: (ItemJudgment & { title: string })[] = [];
          await mapWithConcurrency(items, 3, async (item, i) => {
            const j = await judgeItem(
              { id: `${insightId}#${i + 1}`, kind: item.kind, content: draftedContent(item) },
              { rubric, skills },
              { runCost, metadata: { eval_run_id: recorder.runId } },
            );
            judgments.push({ ...j, title: item.title });
          });
          console.log(
            `${target} ${insightId} : ${draft.format} (${items.map((i) => i.kind).join(", ")}) · ${conform.pass ? "conforme" : `NON CONFORME — ${conform.reason}`}`,
          );
          return {
            target,
            insightId,
            traceId,
            proposed: choice.format,
            draft,
            items,
            conform,
            judgments,
            error: null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`${target} ${insightId} : ÉCHEC — ${message}`);
          return {
            target,
            insightId,
            traceId,
            proposed: null,
            draft: null,
            items: [],
            conform: { pass: false, reason: message },
            judgments: [],
            error: message,
          };
        }
      },
    ),
  );

  for (const o of outcomes) {
    recorder.add({
      item_id: `${o.target}:${o.insightId}`,
      expected: { formats: EXPECTED_FORMATS[o.target] },
      actual: {
        proposed: o.proposed,
        format: o.draft?.format ?? null,
        items: o.items.map((i) => ({ kind: i.kind, title: i.title })),
        reason: o.conform.reason,
        judge: o.judgments.map((j) => ({
          title: j.title,
          note: j.note,
          notes: j.notes,
          verdict: j.verdict,
          a_ameliorer: j.a_ameliorer,
        })),
      },
      score: o.judgments.length ? mean(o.judgments.map((j) => j.note)) : null,
      pass: o.conform.pass,
      traceId: o.traceId,
    });
  }
  const conform = outcomes.filter((o) => o.conform.pass).length;
  const notes = outcomes.flatMap((o) => o.judgments.map((j) => j.note));
  const meanNote = mean(notes);
  const missing = [...targets].filter(([, id]) => !id).map(([t]) => t);
  const metrics: Metric[] = [
    {
      key: "type_conform",
      label: "Type d'élément conforme à l'attendu",
      value: measured.length ? conform / measured.length : null,
      display: `${conform}/${measured.length}${missing.length ? ` (${missing.join(", ")} non mesuré)` : ""}`,
      target: "100 %",
      met: measured.length ? conform === measured.length : null,
    },
    {
      key: "judge_note",
      label: `Note moyenne du juge (${notes.length} éléments)`,
      value: notes.length ? meanNote : null,
      display: notes.length ? meanNote.toFixed(1).replace(".", ",") + "/5" : "—",
      target: "≥ 4/5",
      met: notes.length ? meanNote >= MIN_NOTE : null,
    },
    {
      key: "judge_acceptable",
      label: "Éléments jugés acceptables",
      value: notes.length
        ? outcomes.flatMap((o) => o.judgments).filter((j) => j.verdict === "acceptable").length /
          notes.length
        : null,
      display: `${outcomes.flatMap((o) => o.judgments).filter((j) => j.verdict === "acceptable").length}/${notes.length}`,
    },
  ];
  const summary: EvalSummary = {
    dataset:
      "Insights du jeu de développement en base (S1, S2b, S3, S7) et un sujet manuel technique, rédigés comme sans backlog",
    metrics,
    details: {
      outcomes: outcomes.map((o) => ({
        target: o.target,
        insight: o.insightId,
        format: o.draft?.format,
        reason: o.conform.reason,
      })),
    },
    notes: [
      "Rédaction réelle (composeDraft, rôle agent) sans écriture ; les éléments ne sont pas estimés un à un, le juge lit donc leur contenu sans points.",
      JUDGE_CALIBRATED
        ? "Juge calibré (eval:judge-calibration)."
        : "Juge pas encore calibré : la note est indicative tant que eval:judge-calibration n'a pas atteint ses cibles.",
      ...(missing.includes("manuel")
        ? [
            "Aucun sujet manuel technique en base : créer le sujet dans Priorisation, ou passer --manual I-xx.",
          ]
        : []),
      ...outcomes
        .filter((o) => !o.conform.pass)
        .map((o) => `Non conforme : ${o.target} (${o.insightId}) — ${o.conform.reason}.`),
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  for (const m of summary.metrics)
    console.log(
      `  ${m.label} : ${m.display}${m.target ? ` (cible ${m.target}) ${m.met ? "✓" : "✗"}` : ""}`,
    );
  for (const n of summary.notes ?? []) console.log(`  · ${n}`);
  console.log(`Coût : ${runCost.eur.toFixed(4)} € · rapport ${file} · docs/EVALS.md mis à jour`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await shutdownTracing();
    process.exit(1);
  });
}
