// Triage CLI: classifies the feedbacks not analyzed yet and splits them into items.
// Usage: pnpm pipeline:triage [--model haiku|sonnet, sonnet par défaut] [--sample N] [--run-id X] [--retry-failed]
//        [--concurrency N]
// Cost: ~0.002 € per feedback with Haiku (full run of ~215 feedbacks: well under 1 €).
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { RunCost } from "@/lib/llm/cost";
import {
  currentTraceId,
  initTracing,
  shutdownTracing,
  traceUrl,
  withTrace,
} from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import {
  DEFAULT_TRIAGE_CONCURRENCY,
  loadFeedbacksToTriage,
  runTriage,
  PIPELINE_TRIAGE_MODEL,
  TRIAGE_MODEL_ROLES,
  type TriageModel,
  type TriageSummary,
} from "@/pipeline/nodes/triage";

export type TriageArgs = {
  model: TriageModel;
  sample?: number;
  runId?: string;
  retryFailed: boolean;
  concurrency: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTriageArgs(argv: string[]): TriageArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} attend une valeur`);
    return v;
  };
  const positiveInt = (flag: string) => {
    const v = value(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} attend un entier positif`);
    return n;
  };

  const model = value("--model") ?? PIPELINE_TRIAGE_MODEL;
  if (!(model in TRIAGE_MODEL_ROLES)) throw new Error("--model attend haiku ou sonnet");
  const runId = value("--run-id");
  if (runId !== undefined && !UUID.test(runId)) throw new Error("--run-id attend un UUID");
  return {
    model: model as TriageModel,
    sample: positiveInt("--sample"),
    runId,
    retryFailed: argv.includes("--retry-failed"),
    concurrency: positiveInt("--concurrency") ?? DEFAULT_TRIAGE_CONCURRENCY,
  };
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

function report(summary: TriageSummary, seconds: number, costEur: number): void {
  console.log(
    `\nRetours traités : ${summary.processed} (ok ${summary.ok}, échecs ${summary.failures.length})`,
  );
  console.log(`Durée : ${seconds.toFixed(1)} s · coût : ${costEur.toFixed(4)} €`);
  console.log(
    `Tokens : entrée ${summary.usage.inputTokens}, cache lu ${summary.usage.cacheReadTokens}, ` +
      `cache écrit ${summary.usage.cacheWrite5mTokens}, sortie ${summary.usage.outputTokens}`,
  );
  console.log(`Types : ${formatCounts(summary.typeCounts) || "—"}`);
  console.log(
    `Items par retour : ${
      Object.entries(summary.itemsPerFeedback)
        .sort()
        .map(([n, count]) => `${n} item(s) × ${count}`)
        .join(" · ") || "—"
    }`,
  );
  if (summary.truncated.length) console.log(`Tronqués : ${summary.truncated.join(", ")}`);
  if (summary.injectionSuspected.length)
    console.log(`Injection suspectée : ${summary.injectionSuspected.join(", ")}`);
  for (const f of summary.failures) console.log(`ÉCHEC ${f.feedbackId} : ${f.error}`);
}

async function main() {
  const args = parseTriageArgs(process.argv.slice(2));
  const db = getScriptDb();
  initTracing();

  const [skill, pack] = await Promise.all([loadSkill("triage-taxonomy"), loadContextPack()]);
  const ctx = {
    skill: skill.content,
    product: pack.documents.product,
    truncationChars: pack.weighting.triage.truncation_chars,
    maxItems: pack.weighting.triage.max_items_per_feedback,
  };
  const feedbacks = await loadFeedbacksToTriage(db, args);
  if (feedbacks.length === 0) {
    console.log("Aucun retour à trier.");
    await shutdownTracing();
    return;
  }

  const runId = args.runId ?? randomUUID();
  const { error: runError } = await db
    .from("pipeline_runs")
    .upsert({ id: runId, kind: "full", status: "en_cours", ended_at: null }, { onConflict: "id" });
  if (runError) throw new Error(`Création du run en échec (${runError.message})`);

  console.log(
    `Run ${runId} · ${feedbacks.length} retour(s) · modèle ${args.model} · concurrence ${args.concurrency}`,
  );
  const runCost = new RunCost();
  const started = Date.now();
  let done = 0;
  let traceId: string | undefined;

  try {
    const summary = await withTrace(
      "triage-feedbacks",
      { runId, step: "triage", tags: ["pipeline", "triage"] },
      { feedbacks: feedbacks.length, ...args },
      async () => {
        traceId = currentTraceId();
        return runTriage(db, {
          runId,
          model: args.model,
          runCost,
          ctx,
          feedbacks,
          concurrency: args.concurrency,
          onResult: (r) => {
            done++;
            const flag = r.analysis.status === "ok" ? `${r.items.length} item(s)` : "ÉCHEC";
            process.stdout.write(`\r${done}/${feedbacks.length} · ${r.feedbackId} ${flag}      `);
          },
        });
      },
      (s) => ({ ok: s.ok, failures: s.failures.length, types: s.typeCounts }),
    );
    const seconds = (Date.now() - started) / 1000;
    report(summary, seconds, runCost.eur);
    await shutdownTracing();
    const url = await traceUrl(traceId);
    await db
      .from("pipeline_runs")
      .update({
        status: "termine",
        ended_at: new Date().toISOString(),
        stats: {
          step: "triage",
          model: args.model,
          processed: summary.processed,
          ok: summary.ok,
          failed: summary.failures.map((f) => f.feedbackId),
          types: summary.typeCounts,
          items_per_feedback: summary.itemsPerFeedback,
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
