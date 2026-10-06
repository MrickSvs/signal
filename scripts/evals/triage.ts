// eval:triage (PLAN 6.2, SPEC §14.2). Three modes, never writing to the triage tables:
//   default   on the HOLDOUT set (CL-49): type accuracy (acceptable_types count as right), domain
//             macro-F1, injection recall, confusion matrix.
//   --compare Haiku and Sonnet on the same holdout sample: accuracy, cost, latency.
//   --edge    on the development set: success per edge case E1 to E8 (§5.3).
// Usage: pnpm eval:triage [--model haiku|sonnet] [--sample N | --full] [--compare] [--edge] [--yes]
// Cost: ~0.002 € per feedback with Haiku, ~0.01 € with Sonnet (sample of 60: ~0.12 € / ~0.6 €).
import { pathToFileURL } from "node:url";
import { mapWithConcurrency } from "@/lib/async";
import { loadContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { getScriptDb } from "@/lib/db/script-client";
import { costEur, RunCost } from "@/lib/llm/cost";
import { MODELS } from "@/lib/llm/models";
import { currentTraceId, initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import {
  analyzeFeedback,
  TRIAGE_MODEL_ROLES,
  type TriageContext,
  type TriageModel,
  type TriageResult,
} from "@/pipeline/nodes/triage";
import type { Feedback, GroundTruth } from "../lib/feedbacks";
import { checkCost, parseEvalArgs, sampleSize, type EvalArgs } from "./lib/args";
import {
  areaLabels,
  areaOk,
  confusionMatrix,
  looksFrench,
  macroF1,
  pairItems,
  percentile,
  recall,
  spreadSample,
  typeAccuracy,
  typeOk,
  type Pair,
} from "./lib/metrics";
import { EvalRecorder } from "./lib/record";
import { loadCustomers, loadEvalSet, loadLiveInsights, toTriageInput } from "./lib/truth";
import type { CaseResult, EvalSummary, Metric } from "./lib/types";

export const DEFAULT_SAMPLE = 60; // Langfuse Hobby cap (CL-48)
const COST_PER_FEEDBACK_EUR: Record<TriageModel, number> = { haiku: 0.002, sonnet: 0.01 };
const CONCURRENCY = 8;

// One decimal and three for the F1: a value just under its target must not round up to it.
const pct = (r: number) => `${(r * 100).toFixed(1).replace(".", ",").replace(",0", "")} %`;
const dec = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

// ---------------------------------------------------------------------------
// Running the triage on files (no database write)
// ---------------------------------------------------------------------------

export type TriageCase = {
  feedback: Feedback;
  result: TriageResult;
  ms: number;
  costEur: number;
  traceId?: string;
};

async function triageContext(): Promise<TriageContext> {
  const [skill, pack] = await Promise.all([loadSkill("triage-taxonomy"), loadContextPack()]);
  return {
    skill: skill.content,
    product: pack.documents.product,
    truncationChars: pack.weighting.triage.truncation_chars,
    maxItems: pack.weighting.triage.max_items_per_feedback,
  };
}

async function runCases(
  db: Db,
  feedbacks: readonly Feedback[],
  model: TriageModel,
  evalRunId: string,
  runCost: RunCost,
): Promise<TriageCase[]> {
  const [ctx, customers] = await Promise.all([triageContext(), loadCustomers(db)]);
  let done = 0;
  return mapWithConcurrency([...feedbacks], CONCURRENCY, async (feedback) =>
    withTrace(
      "eval-triage-case",
      {
        root: true,
        runId: evalRunId,
        step: "eval",
        entity: feedback.id,
        tags: ["eval", "triage", model],
      },
      { feedback_id: feedback.id, model },
      async () => {
        const traceId = currentTraceId();
        const started = Date.now();
        const result = await analyzeFeedback(toTriageInput(feedback, customers), ctx, {
          runId: evalRunId,
          model,
          runCost,
        });
        const ms = Date.now() - started;
        done++;
        process.stdout.write(`\r${model} ${done}/${feedbacks.length} · ${feedback.id}      `);
        const cost = costEur(MODELS[TRIAGE_MODEL_ROLES[model]], result.usage);
        return { feedback, result, ms, costEur: cost, traceId };
      },
      (c) => ({ status: c.result.analysis.status, items: c.result.items.length }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Holdout metrics (pure)
// ---------------------------------------------------------------------------

export function pairsOf(truth: GroundTruth, result: TriageResult): Pair[] {
  const predicted = result.analysis.status === "ok" ? result.items : [];
  return pairItems(
    truth.expected_items,
    predicted.map((i) => ({
      type: i.type!,
      product_area: i.product_area!,
      existing_feature: i.existing_feature ?? false,
    })),
  );
}

export type HoldoutScore = {
  typeAccuracy: number;
  areaMacroF1: number;
  injectionRecall: number | null;
  injectionFalsePositives: string[];
  confusion: Record<string, Record<string, number>>;
  failed: string[];
  cases: CaseResult[];
};

export function scoreHoldout(
  cases: readonly Pick<TriageCase, "feedback" | "result" | "traceId">[],
  truth: ReadonlyMap<string, GroundTruth>,
  prefix = "",
): HoldoutScore {
  const allPairs: Pair[] = [];
  const results: CaseResult[] = [];
  const injections = cases.filter((c) => truth.get(c.feedback.id)!.is_injection);
  const flagged = new Set(
    cases.filter((c) => c.result.analysis.injection_suspected).map((c) => c.feedback.id),
  );
  for (const c of cases) {
    const t = truth.get(c.feedback.id)!;
    const pairs = pairsOf(t, c.result);
    allPairs.push(...pairs);
    const typesRight = pairs.filter((p) => p.predicted && typeOk(p.expected, p.predicted)).length;
    const areasRight = pairs.filter((p) => p.predicted && areaOk(p.expected, p.predicted)).length;
    results.push({
      item_id: `${prefix}${c.feedback.id}`,
      expected: {
        items: t.expected_items.map((e) => ({
          types: e.acceptable_types,
          areas: e.acceptable_areas,
        })),
        injection: t.is_injection,
      },
      actual: {
        status: c.result.analysis.status,
        items: c.result.items.map((i) => ({ type: i.type, area: i.product_area })),
        injection: c.result.analysis.injection_suspected ?? null,
      },
      score: typesRight / pairs.length,
      pass:
        typesRight === pairs.length &&
        areasRight === pairs.length &&
        (!t.is_injection || flagged.has(c.feedback.id)),
      traceId: c.traceId,
    });
  }
  const { truth: areaTruth, predicted } = areaLabels(allPairs);
  return {
    typeAccuracy: typeAccuracy(allPairs),
    areaMacroF1: macroF1(areaTruth, predicted),
    injectionRecall: injections.length
      ? recall(
          injections.map((c) => c.feedback.id),
          flagged,
        )
      : null,
    injectionFalsePositives: [...flagged].filter((id) => !truth.get(id)!.is_injection).sort(),
    confusion: confusionMatrix(allPairs),
    failed: cases.filter((c) => c.result.analysis.status !== "ok").map((c) => c.feedback.id),
    cases: results,
  };
}

export function holdoutMetrics(score: HoldoutScore, suffix = ""): Metric[] {
  const tag = suffix ? ` (${suffix})` : "";
  const key = suffix ? `_${suffix.toLowerCase()}` : "";
  return [
    {
      key: `type_accuracy${key}`,
      label: `Exactitude du type${tag}`,
      value: score.typeAccuracy,
      display: pct(score.typeAccuracy),
      target: "≥ 90 %",
      met: score.typeAccuracy >= 0.9,
    },
    {
      key: `area_macro_f1${key}`,
      label: `Macro-F1 du domaine${tag}`,
      value: score.areaMacroF1,
      display: dec(score.areaMacroF1, 3),
      target: "≥ 0,85",
      met: score.areaMacroF1 >= 0.85,
    },
    {
      key: `injection_recall${key}`,
      label: `Rappel de la détection d'injection${tag}`,
      value: score.injectionRecall,
      display:
        score.injectionRecall === null
          ? "aucune injection dans l'échantillon"
          : pct(score.injectionRecall),
      target: "100 %",
      met: score.injectionRecall === null ? null : score.injectionRecall === 1,
    },
  ];
}

/** The holdout sample: spread over the set, the injection always kept (CL-49, S6). */
export function holdoutSample(
  feedbacks: readonly Feedback[],
  truth: ReadonlyMap<string, GroundTruth>,
  n: number,
): Feedback[] {
  return spreadSample(feedbacks, n, (f) => truth.get(f.id)!.is_injection);
}

// ---------------------------------------------------------------------------
// Edge cases (pure)
// ---------------------------------------------------------------------------

export const EDGE_CASES = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"] as const;
export type EdgeCase = (typeof EDGE_CASES)[number];
/** Edge cases measured on a fresh triage; E2 and E7 are about counting, read in the database. */
export const TRIAGED_EDGE_CASES: EdgeCase[] = ["E1", "E3", "E4", "E5", "E6", "E8"];
/** A case passes when at least this share of its feedbacks passes (small counts: 2 to 8). */
export const EDGE_CASE_PASS_RATE = 0.75;

export const EDGE_LABELS: Record<EdgeCase, string> = {
  E1: "Multi-sujets scindés",
  E2: "Compte compté une seule fois",
  E3: "Anglais trié, champs en français",
  E4: "Réponse automatique en « autre », jamais regroupée",
  E5: "Fonctionnalité existante repérée",
  E6: "Fil très long tronqué et bien classé",
  E7: "Sans compte, sans extrapolation",
  E8: "Ironie : sentiment négatif",
};

export type EdgeFacts = {
  /** Items of a feedback that sit in a live insight (E4). */
  groupedFeedbacks: ReadonlySet<string>;
};

/** Whether one triaged feedback passes its edge case, with the reason when it does not. */
export function checkTriagedEdge(
  edge: EdgeCase,
  truth: GroundTruth,
  result: TriageResult,
  facts: EdgeFacts,
): { pass: boolean; reason: string } {
  if (result.analysis.status !== "ok") return { pass: false, reason: "triage en échec" };
  const pairs = pairsOf(truth, result);
  const allTypes = pairs.every((p) => p.predicted && typeOk(p.expected, p.predicted));
  const items = result.items;
  switch (edge) {
    case "E1": {
      const split = items.length >= truth.expected_items.length;
      const areas = pairs.every((p) => p.predicted && areaOk(p.expected, p.predicted));
      return {
        pass: split && areas,
        reason: !split
          ? `${items.length} item(s) pour ${truth.expected_items.length} sujets`
          : areas
            ? "ok"
            : "domaine d'un item faux",
      };
    }
    case "E3": {
      const text = items.map((i) => `${i.summary} ${i.underlying_problem}`).join(" ");
      const french = looksFrench(text);
      return {
        pass: french && allTypes,
        reason: !french ? "champs pas en français" : allTypes ? "ok" : "type faux",
      };
    }
    case "E4": {
      const autre = items.every((i) => i.type === "autre");
      const grouped = facts.groupedFeedbacks.has(truth.feedback_id);
      return {
        pass: autre && !grouped,
        reason: !autre ? "type autre que « autre »" : grouped ? "regroupé dans un insight" : "ok",
      };
    }
    case "E5": {
      const flagged = pairs.some(
        (p) => p.expected.existing_feature && p.predicted?.existing_feature === true,
      );
      return { pass: flagged, reason: flagged ? "ok" : "existing_feature non levé" };
    }
    case "E6":
      return {
        pass: result.truncated && allTypes,
        reason: !result.truncated ? "non tronqué" : allTypes ? "ok" : "type faux",
      };
    case "E8": {
      const negative = (result.analysis.sentiment ?? 0) < 0;
      return { pass: negative, reason: negative ? "ok" : `sentiment ${result.analysis.sentiment}` };
    }
    default:
      throw new Error(`${edge} ne se mesure pas sur le triage`);
  }
}

export type EdgeOutcome = { feedbackId: string; pass: boolean; reason: string };

export function edgeMetrics(outcomes: ReadonlyMap<EdgeCase, EdgeOutcome[]>): {
  metrics: Metric[];
  passedCases: number;
  measuredCases: number;
} {
  const perCase: Metric[] = [];
  let passedCases = 0;
  let measuredCases = 0;
  for (const edge of EDGE_CASES) {
    const list = outcomes.get(edge) ?? [];
    if (list.length === 0) {
      perCase.push({
        key: edge,
        label: `${edge} · ${EDGE_LABELS[edge]}`,
        value: null,
        display: "non mesuré",
        met: null,
      });
      continue;
    }
    const ok = list.filter((o) => o.pass).length;
    const rate = ok / list.length;
    const met = rate >= EDGE_CASE_PASS_RATE;
    measuredCases++;
    if (met) passedCases++;
    perCase.push({
      key: edge,
      label: `${edge} · ${EDGE_LABELS[edge]}`,
      value: rate,
      display: `${ok}/${list.length}`,
      target: `≥ ${pct(EDGE_CASE_PASS_RATE)} des retours`,
      met,
    });
  }
  return {
    metrics: [
      {
        key: "edge_cases_passed",
        label: "Cas limites réussis",
        value: passedCases,
        display: `${passedCases}/${EDGE_CASES.length}`,
        target: "≥ 7/8",
        met: passedCases >= 7,
      },
      ...perCase,
    ],
    passedCases,
    measuredCases,
  };
}

/** E2 and E7, read in the database: counting of accounts, nothing extrapolated. */
async function countingEdges(
  db: Db,
  truth: ReadonlyMap<string, GroundTruth>,
  feedbacks: readonly Feedback[],
): Promise<{ e2: EdgeOutcome[]; e7: EdgeOutcome[]; grouped: Set<string> }> {
  const [insights, stored] = await Promise.all([
    loadLiveInsights(db),
    db.from("feedbacks").select("id, customer_id, author_email, author_name").range(0, 9999),
  ]);
  if (stored.error) throw new Error(`Lecture des retours (${stored.error.message})`);
  const row = new Map((stored.data ?? []).map((f) => [f.id, f]));
  const grouped = new Set(insights.flatMap((i) => i.items.map((it) => it.feedback_id)));
  // Same key as the code (enrich: customer, else e-mail, else name), recomputed from stored rows.
  const key = (id: string) => {
    const f = row.get(id);
    return (f && (f.customer_id ?? f.author_email ?? f.author_name)) || id;
  };

  const e2: EdgeOutcome[] = [];
  const byAccount = new Map<string, string[]>();
  for (const f of feedbacks)
    if (truth.get(f.id)?.edge_cases.includes("E2"))
      byAccount.set(key(f.id), [...(byAccount.get(key(f.id)) ?? []), f.id]);
  for (const [account, ids] of byAccount) {
    const holders = insights.filter((i) => i.items.some((it) => ids.includes(it.feedback_id)));
    if (holders.length === 0) {
      e2.push({ feedbackId: ids.join("+"), pass: false, reason: "dans aucun insight" });
      continue;
    }
    for (const insight of holders) {
      const keys = new Set(insight.items.map((it) => key(it.feedback_id)));
      const once = insight.accounts_count === keys.size && keys.has(account);
      e2.push({
        feedbackId: `${ids.join("+")}@${insight.id}`,
        pass: once,
        reason: once
          ? "ok"
          : `accounts_count ${insight.accounts_count} pour ${keys.size} comptes distincts`,
      });
    }
  }

  const e7 = feedbacks
    .filter((f) => truth.get(f.id)?.edge_cases.includes("E7"))
    .map((f) => {
      const stored = row.get(f.id);
      const pass = stored !== undefined && stored.customer_id === null;
      return {
        feedbackId: f.id,
        pass,
        reason: !stored ? "absent de la base" : pass ? "ok" : `rattaché à ${stored.customer_id}`,
      };
    });
  return { e2, e7, grouped };
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function runHoldout(db: Db, args: EvalArgs, model: TriageModel) {
  const { feedbacks, truth } = loadEvalSet("holdout");
  const n = sampleSize(args, feedbacks.length, DEFAULT_SAMPLE);
  const sample = holdoutSample(feedbacks, truth, n);
  console.log(
    checkCost(
      sample.length * COST_PER_FEEDBACK_EUR[model],
      args,
      `${sample.length} retours, ${model}`,
    ),
  );

  const recorder = await EvalRecorder.start(
    db,
    "triage",
    { model, sample: sample.length, full: args.full },
    sample.length,
  );
  const runCost = new RunCost();
  const cases = await runCases(db, sample, model, recorder.runId, runCost);
  const score = scoreHoldout(cases, truth);
  score.cases.forEach((c) => recorder.add(c));
  const summary: EvalSummary = {
    dataset: `Jeu réservé (evals/holdout), ${sample.length}/${feedbacks.length} retours, modèle ${model}`,
    metrics: holdoutMetrics(score),
    details: {
      confusion: score.confusion,
      failed: score.failed,
      injection_false_positives: score.injectionFalsePositives,
    },
    notes: [
      "Un type de acceptable_types compte comme juste ; un item attendu sans item produit compte comme faux (multi-sujets non scindé).",
      ...(score.failed.length ? [`Triage en échec : ${score.failed.join(", ")}.`] : []),
      ...(score.injectionFalsePositives.length
        ? [`Injection signalée à tort : ${score.injectionFalsePositives.join(", ")}.`]
        : []),
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  printSummary(summary, runCost.eur, file);
  printConfusion(score.confusion);
}

async function runCompare(db: Db, args: EvalArgs) {
  const { feedbacks, truth } = loadEvalSet("holdout");
  const n = sampleSize(args, feedbacks.length, DEFAULT_SAMPLE);
  const sample = holdoutSample(feedbacks, truth, n);
  const estimate = sample.length * (COST_PER_FEEDBACK_EUR.haiku + COST_PER_FEEDBACK_EUR.sonnet);
  console.log(checkCost(estimate, args, `${sample.length} retours × Haiku et Sonnet`));

  const recorder = await EvalRecorder.start(
    db,
    "triage-compare",
    { sample: sample.length, full: args.full },
    sample.length,
  );
  const runCost = new RunCost();
  const rows: {
    model: TriageModel;
    score: HoldoutScore;
    cost: number;
    p50: number;
    p95: number;
  }[] = [];
  for (const model of ["haiku", "sonnet"] as const) {
    const cases = await runCases(db, sample, model, recorder.runId, runCost);
    const score = scoreHoldout(cases, truth, `${model}:`);
    score.cases.forEach((c) => recorder.add(c));
    const ms = cases.map((c) => c.ms);
    rows.push({
      model,
      score,
      cost: cases.reduce((s, c) => s + c.costEur, 0),
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
    });
  }
  const per100 = (r: (typeof rows)[number]) => (r.cost / sample.length) * 100;
  const metrics: Metric[] = rows.flatMap((r) => [
    // No target per model here: the target of the comparison is a documented decision.
    ...holdoutMetrics(r.score, r.model === "haiku" ? "Haiku" : "Sonnet").map((m) => ({
      key: m.key,
      label: m.label,
      value: m.value,
      display: m.display,
    })),
    {
      key: `cost_per_100_${r.model}`,
      label: `Coût pour 100 retours (${r.model})`,
      value: per100(r),
      display: `${dec(per100(r), 3)} €`,
    },
    {
      key: `latency_p50_${r.model}`,
      label: `Latence médiane par retour (${r.model})`,
      value: r.p50,
      display: `${dec(r.p50 / 1000, 1)} s (p95 ${dec(r.p95 / 1000, 1)} s)`,
    },
  ]);
  const summary: EvalSummary = {
    dataset: `Jeu réservé (evals/holdout), même échantillon de ${sample.length} retours pour les deux modèles`,
    metrics,
    details: Object.fromEntries(
      rows.map((r) => [r.model, { confusion: r.score.confusion, failed: r.score.failed }]),
    ),
    notes: [
      "Cible : décision documentée (docs/DECISIONS.md). Latence mesurée avec 8 appels en parallèle, file d'attente comprise.",
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  printSummary(summary, runCost.eur, file);
}

async function runEdge(db: Db, args: EvalArgs, model: TriageModel) {
  const { feedbacks, truth } = loadEvalSet("development");
  const triaged = feedbacks.filter((f) =>
    truth.get(f.id)!.edge_cases.some((e) => TRIAGED_EDGE_CASES.includes(e as EdgeCase)),
  );
  const n = sampleSize(args, triaged.length, triaged.length);
  const sample = spreadSample(triaged, n, () => false);
  console.log(
    checkCost(
      sample.length * COST_PER_FEEDBACK_EUR[model],
      args,
      `${sample.length} retours à cas limite, ${model}`,
    ),
  );

  const recorder = await EvalRecorder.start(
    db,
    "triage-edge",
    { model, sample: sample.length },
    sample.length,
  );
  const runCost = new RunCost();
  const [cases, counting] = await Promise.all([
    runCases(db, sample, model, recorder.runId, runCost),
    countingEdges(db, truth, feedbacks),
  ]);
  const outcomes = new Map<EdgeCase, EdgeOutcome[]>([
    ["E2", counting.e2],
    ["E7", counting.e7],
  ]);
  for (const c of cases) {
    const t = truth.get(c.feedback.id)!;
    for (const edge of t.edge_cases as EdgeCase[]) {
      if (!TRIAGED_EDGE_CASES.includes(edge)) continue;
      const outcome = checkTriagedEdge(edge, t, c.result, { groupedFeedbacks: counting.grouped });
      outcomes.set(edge, [
        ...(outcomes.get(edge) ?? []),
        { feedbackId: c.feedback.id, ...outcome },
      ]);
      recorder.add({
        item_id: `${edge}:${c.feedback.id}`,
        expected: { edge, items: t.expected_items.map((e) => e.acceptable_types) },
        actual: {
          status: c.result.analysis.status,
          items: c.result.items.map((i) => ({
            type: i.type,
            area: i.product_area,
            existing: i.existing_feature,
          })),
          sentiment: c.result.analysis.sentiment ?? null,
          truncated: c.result.truncated,
          reason: outcome.reason,
        },
        score: outcome.pass ? 1 : 0,
        pass: outcome.pass,
        traceId: c.traceId,
      });
    }
  }
  for (const o of [
    ...counting.e2.map((o) => ({ edge: "E2", ...o })),
    ...counting.e7.map((o) => ({ edge: "E7", ...o })),
  ])
    recorder.add({
      item_id: `${o.edge}:${o.feedbackId}`,
      expected: { edge: o.edge },
      actual: { reason: o.reason },
      score: o.pass ? 1 : 0,
      pass: o.pass,
    });

  const { metrics } = edgeMetrics(outcomes);
  const failures = [...outcomes.entries()].flatMap(([edge, list]) =>
    list.filter((o) => !o.pass).map((o) => `${edge} ${o.feedbackId} : ${o.reason}`),
  );
  const summary: EvalSummary = {
    dataset: `Jeu de développement (retours à cas limite), modèle ${model} ; E2 et E7 lus en base`,
    metrics,
    details: { failures },
    notes: [
      `Un cas limite est réussi quand au moins ${pct(EDGE_CASE_PASS_RATE)} de ses retours le passent.`,
      "E1, E3, E4, E5, E6 et E8 sur un triage refait à neuf (rien n'est écrit) ; E2 (comptage des comptes) et E7 (aucun compte inventé) sur les données du pipeline en base ; E4 vérifie aussi en base qu'aucun item n'est regroupé.",
      "E3 : « en français » est jugé en code, par les mots outils (le, la, the, is…) des champs summary et underlying_problem.",
      ...failures.map((f) => `Échec ${f}.`),
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  printSummary(summary, runCost.eur, file);
}

function printSummary(summary: EvalSummary, cost: number, file: string) {
  console.log(`\n\n${summary.dataset}`);
  for (const m of summary.metrics)
    console.log(
      `  ${m.label} : ${m.display}${m.target ? ` (cible ${m.target}) ${m.met === true ? "✓" : m.met === false ? "✗" : ""}` : ""}`,
    );
  for (const n of summary.notes ?? []) console.log(`  · ${n}`);
  console.log(`Coût : ${cost.toFixed(4)} € · rapport ${file} · docs/EVALS.md mis à jour`);
}

function printConfusion(matrix: Record<string, Record<string, number>>) {
  console.log("\nMatrice de confusion (attendu → obtenu) :");
  for (const [expected, row] of Object.entries(matrix).sort())
    console.log(
      `  ${expected.padEnd(22)} ${Object.entries(row)
        .sort(([, a], [, b]) => b - a)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")}`,
    );
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2), {
    flags: ["--compare", "--edge"],
    valued: ["--model"],
  });
  const model = (args.values.get("--model") ?? "haiku") as TriageModel;
  if (!(model in TRIAGE_MODEL_ROLES)) throw new Error("--model attend haiku ou sonnet");
  if (args.flags.has("--compare") && args.flags.has("--edge"))
    throw new Error("--compare et --edge ne vont pas ensemble");
  const db = getScriptDb();
  initTracing();
  if (args.flags.has("--compare")) await runCompare(db, args);
  else if (args.flags.has("--edge")) await runEdge(db, args, model);
  else await runHoldout(db, args, model);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await shutdownTracing();
    process.exit(1);
  });
}
