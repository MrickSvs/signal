// Scoring CLI: judges every ranked insight (Sonnet: Impact, evidence, alignment,
// MoSCoW recommendation), estimates its effort (cached), then computes RICE, rank, robustness,
// MoSCoW rules and capacity in code, and writes a new version in scores.
// Usage: pnpm pipeline:score [--reach-mode comptes|mrr] [--run-id X]
// Cost: one Sonnet call per ranked insight (~0.03 €) plus the estimates not cached yet (~0.025 €).
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { RunCost } from "@/lib/llm/cost";
import {
  currentTraceId,
  initTracing,
  shutdownTracing,
  traceUrl,
  withTrace,
} from "@/lib/llm/tracing";
import type { ReachMode } from "@/lib/scoring/reach";
import { loadSkill } from "@/lib/skills";
import { parseOkrIds, runScoring, type ScoringSummary } from "@/pipeline/nodes/score";

export type ScoreArgs = { reachMode?: ReachMode; runId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseScoreArgs(argv: string[]): ScoreArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} attend une valeur`);
    return v;
  };
  const mode = value("--reach-mode");
  if (mode !== undefined && mode !== "comptes" && mode !== "mrr") {
    throw new Error("--reach-mode attend « comptes » ou « mrr »");
  }
  const runId = value("--run-id");
  if (runId !== undefined && !UUID.test(runId)) throw new Error("--run-id attend un UUID");
  return { reachMode: mode, runId };
}

const num = (n: number, digits = 2) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });

function report(
  summary: ScoringSummary,
  titles: Map<string, string>,
  seconds: number,
  costEur: number,
): void {
  const mode = summary.scores[0]?.reach_mode ?? "—";
  console.log(
    `\nMode ${mode} · ${summary.scores.length} insights classés · ${summary.judged} jugements · ` +
      `estimations en cache : ${summary.estimatesCached} · ${seconds.toFixed(1)} s · ${costEur.toFixed(4)} €`,
  );
  console.log(
    "\nRang  Insight  RICE        R          I     C     E (sem.)  MoSCoW         Robustesse  Alignement",
  );
  for (const s of summary.scores) {
    const moscow =
      s.moscow_final === s.moscow_reco
        ? s.moscow_reco
        : `${s.moscow_reco} (PO : ${s.moscow_final})`;
    const overridden = Object.keys(s.overridden);
    console.log(
      `${String(s.rank).padStart(4)}  ${s.insight_id.padEnd(7)}  ${num(s.rice).padEnd(10)}  ${num(s.reach).padEnd(9)}  ` +
        `${String(s.impact).padEnd(4)}  ${String(s.confidence).padEnd(4)}  ${num(s.effort_weeks).padEnd(8)}  ` +
        `${moscow.padEnd(13)}  ${(s.robustness ?? "—").padEnd(10)}  ${s.alignment}` +
        (overridden.length ? `  [override : ${overridden.join(", ")}]` : ""),
    );
    console.log(`      ${titles.get(s.insight_id) ?? ""}`);
    for (const f of s.rule_flags) {
      if (f.status === "appliquee")
        console.log(`      règle ${f.rule} → ${f.category} : ${f.detail}`);
      else if (f.status === "tension") {
        console.log(
          `      TENSION ${f.rule} (${f.category}) : ${f.detail}${f.piste ? ` · piste : ${f.piste}` : ""}`,
        );
      } else if (f.status === "correction") console.log(`      ${f.detail}`);
    }
  }
  const c = summary.capacity;
  console.log(
    `\nCapacité : Must ${num(c.must_weeks)} sem. sur ${num(c.capacity_weeks)} (${Math.round(c.share * 100)} %)` +
      (c.alert
        ? ` · ALERTE au-delà de 60 %, à rétrograder d'abord : ${c.downgrade.join(", ")}`
        : " · sous la limite de 60 %"),
  );
  if (summary.contextChanged.length) {
    console.log(`Overrides « contexte modifié » : ${summary.contextChanged.join(", ")}`);
  }
  for (const f of summary.failures) console.log(`ÉCHEC ${f.step} ${f.insight} : ${f.error}`);
}

async function main() {
  const args = parseScoreArgs(process.argv.slice(2));
  const db = getScriptDb();
  initTracing();
  const [pack, riceScoring, moscow] = await Promise.all([
    loadContextPack(),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
  ]);
  const mode = args.reachMode ?? pack.weighting.reach.default_mode;

  const runId = args.runId ?? randomUUID();
  const { error: runError } = await db
    .from("pipeline_runs")
    .upsert({ id: runId, kind: "full", status: "en_cours", ended_at: null }, { onConflict: "id" });
  if (runError) throw new Error(`Création du run en échec (${runError.message})`);
  console.log(`Run ${runId}`);

  const runCost = new RunCost();
  const started = Date.now();
  let traceId: string | undefined;
  try {
    const summary = await withTrace(
      "score-insights",
      { runId, step: "score", tags: ["pipeline", "score"] },
      { mode },
      async () => {
        traceId = currentTraceId();
        return runScoring(db, {
          mode,
          weighting: pack.weighting,
          now: getDemoNow(),
          commitments: pack.commitments,
          context: {
            weighting: pack.weighting,
            skills: { riceScoring: riceScoring.content, moscow: moscow.content },
            documents: {
              strategy: pack.documents.strategy,
              commitments: pack.documents.commitments,
            },
            okrIds: parseOkrIds(pack.documents.strategy),
          },
          deps: { runCost },
        });
      },
      (s) => ({
        ranked: s.scores.map((x) => [x.rank, x.insight_id, x.rice, x.moscow_reco]),
        capacity: s.capacity,
        failures: s.failures.length,
      }),
    );
    const seconds = (Date.now() - started) / 1000;
    const { data: insights } = await db
      .from("insights")
      .select("id, title")
      .in(
        "id",
        summary.scores.map((s) => s.insight_id),
      );
    report(summary, new Map((insights ?? []).map((i) => [i.id, i.title])), seconds, runCost.eur);
    await shutdownTracing();
    const url = await traceUrl(traceId);
    await db
      .from("pipeline_runs")
      .update({
        status: "termine",
        ended_at: new Date().toISOString(),
        stats: {
          step: "score",
          reach_mode: mode,
          ranked: summary.scores.map((s) => s.insight_id),
          capacity: summary.capacity,
          context_changed: summary.contextChanged,
          failures: summary.failures,
          judged: summary.judged,
          estimates_cached: summary.estimatesCached,
          duration_s: Math.round(seconds),
        },
        tokens_in: runCost.tokensIn,
        tokens_out: runCost.tokensOut,
        cost_eur: Number(runCost.eur.toFixed(4)),
        langfuse_url: url,
      })
      .eq("id", runId);
    console.log(`Trace Langfuse : ${url ?? "(Langfuse non configuré)"}`);
  } catch (error) {
    await db
      .from("pipeline_runs")
      .update({ status: "echec", ended_at: new Date().toISOString() })
      .eq("id", runId);
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
