// Persistence of an eval run (SPEC §14.2): eval_runs + eval_results, a JSON report in
// evals/reports/, the dataset run and its scores in Langfuse, then docs/EVALS.md regenerated.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LangfuseClient } from "@langfuse/client";
import type { Db } from "@/lib/db/create";
import type { Json } from "@/lib/db/types";
import { isTracingConfigured, shutdownTracing, traceUrl } from "@/lib/llm/tracing";
import { mapWithConcurrency } from "@/lib/async";
import { withProductionTriage } from "@/lib/evals/triage-model";
import { PIPELINE_TRIAGE_MODEL } from "@/pipeline/nodes/triage";
import { renderEvalsDoc, type StoredEvalRun } from "./evals-doc";
import type { CaseResult, EvalName, EvalSummary } from "./types";

const REPORTS_DIR = path.join(process.cwd(), "evals", "reports");
const EVALS_DOC = path.join(process.cwd(), "docs", "EVALS.md");

/** Short commit of the code measured; « -dirty » when the working tree has changes. */
export function gitSha(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "inconnu";
  }
}

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Eval : ${what} en échec (${error.message})`);
};

export class EvalRecorder {
  readonly results: CaseResult[] = [];
  private readonly started = new Date();

  private constructor(
    private readonly db: Db,
    readonly runId: string,
    readonly name: EvalName,
    readonly config: Record<string, unknown>,
  ) {}

  static async start(
    db: Db,
    name: EvalName,
    config: Record<string, unknown>,
    sampleSize: number,
  ): Promise<EvalRecorder> {
    const { data, error } = await db
      .from("eval_runs")
      .insert({
        eval_name: name,
        config: config as Json,
        sample_size: sampleSize,
        git_sha: gitSha(),
      })
      .select("id")
      .single();
    check(error, "création du run");
    return new EvalRecorder(db, data!.id, name, config);
  }

  add(result: CaseResult): void {
    this.results.push(result);
  }

  /** Writes everything and returns the path of the JSON report. */
  async finish(summary: EvalSummary, costEur: number): Promise<string> {
    const rows = this.results.map((r) => ({
      eval_run_id: this.runId,
      item_id: r.item_id,
      expected: (r.expected ?? null) as Json,
      actual: (r.actual ?? null) as Json,
      score: r.score,
      pass: r.pass,
    }));
    for (let i = 0; i < rows.length; i += 500)
      check((await this.db.from("eval_results").insert(rows.slice(i, i + 500))).error, "résultats");

    // Spans first: a dataset run item points to a trace that must be ingested.
    await shutdownTracing();
    const langfuseUrl = await pushToLangfuse(this.name, this.runId, this.results, summary).catch(
      (error: unknown) => {
        console.warn(`Langfuse : envoi des scores en échec (${String(error)})`);
        return null;
      },
    );

    const ended = new Date();
    check(
      (
        await this.db
          .from("eval_runs")
          .update({
            metrics: summary as unknown as Json,
            cost_eur: Number(costEur.toFixed(4)),
            langfuse_url: langfuseUrl,
            ended_at: ended.toISOString(),
          })
          .eq("id", this.runId)
      ).error,
      "clôture du run",
    );

    mkdirSync(REPORTS_DIR, { recursive: true });
    const stamp = this.started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(REPORTS_DIR, `${this.name}-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          eval: this.name,
          run_id: this.runId,
          git_sha: gitSha(),
          config: this.config,
          started_at: this.started.toISOString(),
          ended_at: ended.toISOString(),
          cost_eur: Number(costEur.toFixed(4)),
          langfuse_url: langfuseUrl,
          ...summary,
          results: this.results,
        },
        null,
        2,
      ) + "\n",
    );
    await writeEvalsDoc(this.db);
    return file;
  }
}

/** Regenerates docs/EVALS.md from the latest run of each eval. */
export async function writeEvalsDoc(db: Db): Promise<void> {
  const { data, error } = await db
    .from("eval_runs")
    .select(
      "id, eval_name, config, sample_size, metrics, cost_eur, langfuse_url, git_sha, started_at, ended_at",
    )
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(200);
  check(error, "lecture des runs");
  writeFileSync(
    EVALS_DOC,
    renderEvalsDoc(
      withProductionTriage((data ?? []) as unknown as StoredEvalRun[], PIPELINE_TRIAGE_MODEL),
      new Date(),
    ) + "\n",
  );
}

let client: LangfuseClient | undefined;

/**
 * Dataset `signal-eval-<name>` (one item per case), a run named after the eval run, a score per
 * case on its trace and the headline metrics on the run. Returns the dataset's URL.
 */
async function pushToLangfuse(
  name: EvalName,
  runId: string,
  results: readonly CaseResult[],
  summary: EvalSummary,
): Promise<string | null> {
  if (!isTracingConfigured()) return null;
  client ??= new LangfuseClient();
  const datasetName = `signal-eval-${name}`;
  const dataset = await client.api.datasets.create({
    name: datasetName,
    description: `Éval ${name} de Signal (${summary.dataset})`,
  });
  const runName = `${name}-${runId.slice(0, 8)}`;
  let datasetRunId: string | null = null;
  const traced = results.filter((r) => r.traceId);
  await mapWithConcurrency(traced, 4, async (r) => {
    const itemId = `${datasetName}-${r.item_id}`.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 255);
    await client!.api.datasetItems.create({
      datasetName,
      id: itemId,
      input: { item_id: r.item_id },
      expectedOutput: r.expected ?? null,
    });
    const runItem = await client!.api.datasetRunItems.create({
      runName,
      runDescription: `git ${gitSha()} · ${summary.dataset}`,
      datasetItemId: itemId,
      traceId: r.traceId,
    });
    datasetRunId ??= runItem.datasetRunId;
    if (r.score !== null)
      client!.score.create({ traceId: r.traceId, name: `eval-${name}`, value: r.score });
  });
  if (datasetRunId) {
    for (const m of summary.metrics)
      if (m.value !== null) client.score.create({ datasetRunId, name: m.key, value: m.value });
  }
  await client.score.flush();

  const anyTrace = traced[0]?.traceId;
  const base = anyTrace ? await traceUrl(anyTrace) : null;
  return base ? base.replace(/\/traces\/.*$/, `/datasets/${dataset.id}`) : null;
}
