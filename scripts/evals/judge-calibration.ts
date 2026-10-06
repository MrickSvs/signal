// eval:judge-calibration (PLAN 6.3, SPEC §14.3): the judge against the PO on the 15 items of the
// calibration set (evals/human-labels). Targets: notes ≤ 1 point apart on ≥ 80 % of the notes,
// Cohen's κ ≥ 0.6 on the verdict « acceptable / à reprendre ». The judge never sees the
// annotations nor which items were degraded.
// Usage: pnpm eval:judge-calibration   ·   Cost: 15 Opus calls (~0,60 €).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { mapWithConcurrency } from "@/lib/async";
import { getScriptDb } from "@/lib/db/script-client";
import {
  CALIBRATION_KEY_FILE,
  calibrationKeySchema,
  loadAnnotations,
  loadCalibrationSet,
  type Annotation,
  type CalibrationKey,
} from "@/lib/judge/calibration";
import { judgeItem, loadRubric, type ItemJudgment } from "@/lib/judge/judge";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { checkCost, parseEvalArgs } from "./lib/args";
import { cohenKappa, mean } from "./lib/metrics";
import { EvalRecorder } from "./lib/record";
import type { EvalSummary, Metric } from "./lib/types";

const COST_PER_ITEM_EUR = 0.04;
export const MAX_GAP = 1;
export const MIN_CLOSE_SHARE = 0.8;
export const MIN_KAPPA = 0.6;

export type Pairing = {
  id: string;
  kind: string;
  human: Pick<Annotation, "notes" | "verdict">;
  judge: Pick<ItemJudgment, "notes" | "verdict">;
  degradation: string | null;
};

/** Agreement between the judge and the PO (pure). */
export function agreement(pairs: readonly Pairing[]) {
  const gaps: { criterion: string; gap: number }[] = [];
  for (const p of pairs)
    for (const [criterion, human] of Object.entries(p.human.notes))
      gaps.push({ criterion, gap: (p.judge.notes[criterion] ?? 0) - human });
  const close = gaps.filter((g) => Math.abs(g.gap) <= MAX_GAP).length;
  const exact = gaps.filter((g) => g.gap === 0).length;
  const byCriterion: Record<string, { bias: number; close: number; n: number }> = {};
  for (const g of gaps) {
    const c = (byCriterion[g.criterion] ??= { bias: 0, close: 0, n: 0 });
    c.bias += g.gap;
    c.close += Math.abs(g.gap) <= MAX_GAP ? 1 : 0;
    c.n++;
  }
  for (const c of Object.values(byCriterion)) c.bias = Math.round((c.bias / c.n) * 100) / 100;
  const degraded = pairs.filter((p) => p.degradation);
  return {
    notes: gaps.length,
    closeShare: gaps.length ? close / gaps.length : 0,
    exactShare: gaps.length ? exact / gaps.length : 0,
    meanGap: mean(gaps.map((g) => g.gap)),
    kappa: cohenKappa(
      pairs.map((p) => p.human.verdict),
      pairs.map((p) => p.judge.verdict),
    ),
    verdictAgreement: pairs.length
      ? pairs.filter((p) => p.human.verdict === p.judge.verdict).length / pairs.length
      : 0,
    byCriterion,
    degradedCaught: {
      judge: degraded.filter((p) => p.judge.verdict === "a_reprendre").length,
      human: degraded.filter((p) => p.human.verdict === "a_reprendre").length,
      total: degraded.length,
    },
  };
}

const pct = (r: number) => `${Math.round(r * 100)} %`;
const dec = (n: number) => n.toFixed(2).replace(".", ",");

export function calibrationMetrics(a: ReturnType<typeof agreement>): Metric[] {
  return [
    {
      key: "notes_within_1",
      label: "Notes à 1 point ou moins de l'humain",
      value: a.closeShare,
      display: `${pct(a.closeShare)} (${Math.round(a.closeShare * a.notes)}/${a.notes})`,
      target: `≥ ${pct(MIN_CLOSE_SHARE)}`,
      met: a.closeShare >= MIN_CLOSE_SHARE,
    },
    {
      key: "verdict_kappa",
      label: "κ de Cohen sur le verdict",
      value: a.kappa,
      display: `${dec(a.kappa)} (accord ${pct(a.verdictAgreement)})`,
      target: `≥ ${dec(MIN_KAPPA)}`,
      met: a.kappa >= MIN_KAPPA,
    },
    {
      key: "notes_exact",
      label: "Notes identiques",
      value: a.exactShare,
      display: pct(a.exactShare),
    },
    {
      key: "mean_gap",
      label: "Écart moyen juge − humain (biais)",
      value: a.meanGap,
      display: dec(a.meanGap),
    },
    {
      key: "degraded_caught",
      label: "Éléments dégradés jugés « à reprendre » (juge / humain)",
      value: a.degradedCaught.total ? a.degradedCaught.judge / a.degradedCaught.total : null,
      display: `${a.degradedCaught.judge}/${a.degradedCaught.total} / ${a.degradedCaught.human}/${a.degradedCaught.total}`,
    },
  ];
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const [items, annotations] = await Promise.all([loadCalibrationSet(), loadAnnotations()]);
  const missing = items.filter((i) => !annotations.has(i.id)).map((i) => i.id);
  if (missing.length)
    throw new Error(
      `${items.length - missing.length}/${items.length} éléments annotés : termine l'annotation sur /evals/annotate (manquent ${missing.join(", ")}).`,
    );
  const key = new Map<string, CalibrationKey>(
    z
      .array(calibrationKeySchema)
      .parse(JSON.parse(readFileSync(CALIBRATION_KEY_FILE, "utf8")))
      .map((k) => [k.id, k]),
  );
  console.log(checkCost(items.length * COST_PER_ITEM_EUR, args, `${items.length} appels au juge`));
  const db = getScriptDb();
  initTracing();
  const [rubric, backlogFormat, userStory] = await Promise.all([
    loadRubric(),
    loadSkill("backlog-format"),
    loadSkill("user-story"),
  ]);
  const ctx = {
    rubric,
    skills: { backlogFormat: backlogFormat.content, userStory: userStory.content },
  };
  const recorder = await EvalRecorder.start(db, "judge-calibration", {}, items.length);
  const runCost = new RunCost();

  const pairs = await mapWithConcurrency(items, 3, (item) =>
    withTrace(
      "eval-judge-calibration-case",
      { root: true, runId: recorder.runId, step: "eval", entity: item.id, tags: ["eval", "judge"] },
      { item_id: item.id, kind: item.kind },
      async () => {
        const traceId = currentTraceId();
        const judgment = await judgeItem(item, ctx, {
          runCost,
          metadata: { eval_run_id: recorder.runId },
        });
        process.stdout.write(
          `${item.id} juge ${judgment.verdict} · humain ${annotations.get(item.id)!.verdict}\n`,
        );
        return { item, judgment, traceId };
      },
    ),
  );

  const pairings: Pairing[] = pairs.map(({ item, judgment }) => ({
    id: item.id,
    kind: item.kind,
    human: annotations.get(item.id)!,
    judge: judgment,
    degradation: key.get(item.id)?.degradation ?? null,
  }));
  for (const [i, p] of pairings.entries()) {
    const gaps = Object.entries(p.human.notes).map(([c, h]) =>
      Math.abs((p.judge.notes[c] ?? 0) - h),
    );
    recorder.add({
      item_id: p.id,
      expected: { ...p.human, degradation: p.degradation, source: key.get(p.id)?.source_id },
      actual: {
        notes: p.judge.notes,
        verdict: p.judge.verdict,
        a_ameliorer: pairs[i].judgment.a_ameliorer,
      },
      score: gaps.filter((g) => g <= MAX_GAP).length / gaps.length,
      pass: p.human.verdict === p.judge.verdict && gaps.every((g) => g <= MAX_GAP),
      traceId: pairs[i].traceId,
    });
  }
  const a = agreement(pairings);
  const met = a.closeShare >= MIN_CLOSE_SHARE && a.kappa >= MIN_KAPPA;
  const summary: EvalSummary = {
    dataset: `Jeu de calibration (evals/human-labels) : ${items.length} éléments annotés par le PO, dont ${a.degradedCaught.total} dégradés`,
    metrics: calibrationMetrics(a),
    details: { by_criterion: a.byCriterion },
    notes: [
      "Le juge ne voit ni les annotations ni la liste des éléments dégradés ; même grille (src/lib/judge/rubric.md) pour le juge et l'humain.",
      `Biais par critère (juge − humain) : ${Object.entries(a.byCriterion)
        .map(([c, v]) => `${c} ${dec(v.bias)}`)
        .join(" ; ")}.`,
      met
        ? "Cibles atteintes : le juge peut être déclaré calibré (JUDGE_CALIBRATED)."
        : "Cibles non atteintes : ajuster la grille sur les critères les plus biaisés, puis relancer (le badge reste provisoire).",
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
