// Full pipeline CLI: ingest → triage → enrich → embed → cluster → estimate → score →
// alert → digest, as a LangGraph graph checkpointed in Postgres (schema « langgraph », out of PostgREST).
// Usage: pnpm pipeline:run [--resume <run_id>] [--reach-mode comptes|mrr] [--batch-size N]
// Cost: a run on a reset base (~215 feedbacks) is ~1.5 € (triage ~0.3, labels ~0.25, estimates
// ~0.15, judgments ~0.8); a run without new feedback relabels nothing but re-judges the ranked
// insights (~0.8 €). Runs longer than a Vercel function: CLI only (CL-45).
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { loadContextPack } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { getScriptDb } from "@/lib/db/script-client";
import type { Json } from "@/lib/db/types";
import { getDemoNow } from "@/lib/demo-now";
import {
  currentTraceId,
  initTracing,
  shutdownTracing,
  traceUrl,
  withTrace,
} from "@/lib/llm/tracing";
import type { ReachMode } from "@/lib/scoring/reach";
import { loadSkill } from "@/lib/skills";
import { compilePipeline, runPipeline, type PipelineStateType } from "@/pipeline/graph";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";

import { CHECKPOINT_SCHEMA } from "@/agent/checkpointer";
import { investigateAll, pendingInvestigations } from "@/agent/investigate";
import { loadAgentDeps } from "@/agent/runtime";

export { CHECKPOINT_SCHEMA };

export type RunArgs = { resume?: string; reachMode?: ReachMode; batchSize?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRunArgs(argv: string[]): RunArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} attend une valeur`);
    return v;
  };
  const resume = value("--resume");
  if (resume !== undefined && !UUID.test(resume)) throw new Error("--resume attend un UUID");
  const mode = value("--reach-mode");
  if (mode !== undefined && mode !== "comptes" && mode !== "mrr") {
    throw new Error("--reach-mode attend « comptes » ou « mrr »");
  }
  const rawBatch = value("--batch-size");
  const batchSize = rawBatch === undefined ? undefined : Number(rawBatch);
  if (batchSize !== undefined && !(Number.isInteger(batchSize) && batchSize > 0)) {
    throw new Error("--batch-size attend un entier positif");
  }
  return { resume, reachMode: mode, batchSize };
}

function report(state: PipelineStateType, seconds: number): void {
  const s = state.stats as Record<string, Record<string, unknown> | undefined>;
  console.log(`\nDurée : ${seconds.toFixed(1)} s · coût : ${state.cost.eur.toFixed(4)} €`);
  console.log(
    `Tokens : entrée ${state.cost.tokensIn}, sortie ${state.cost.tokensOut} · ` +
      `retours à trier : ${(s.ingest?.pending as number | undefined) ?? 0}, triés ok : ${state.triaged.length}`,
  );
  if (s.cluster) {
    console.log(
      `Regroupement : ${s.cluster.clusters} groupes · créés ${(s.cluster.created as string[]).join(", ") || "—"} · ` +
        `classés ${(s.cluster.ranked as string[]).join(", ") || "—"}`,
    );
  }
  if (s.score) {
    console.log(
      `Classement (${s.score.reach_mode}) : ${(s.score.ranked as string[]).join(", ") || "—"} · jugements ${s.score.judged}`,
    );
  }
  if (s.alert) console.log(`Alertes : ${JSON.stringify(s.alert)}`);
  for (const f of state.failures)
    console.log(`ÉCHEC ${f.step}${f.id ? ` ${f.id}` : ""} : ${f.error}`);
}

/** Dossiers of the alerts created by the run, and of any investigation lost earlier (§10.10). */
async function investigatePending(db: Db): Promise<void> {
  const ids = await pendingInvestigations(db);
  if (ids.length === 0) return;
  console.log(`\nEnquêtes : ${ids.length} alerte(s) sans dossier…`);
  const { deps, skills } = await loadAgentDeps(db);
  for (const r of await investigateAll(ids, deps, { skills })) {
    console.log(
      `- ${r.alertId} : ${r.status === "pret" ? "dossier prêt" : `dossier indisponible (${r.error})`} · ` +
        `${r.costEur.toFixed(4)} € · ${(r.durationMs / 1000).toFixed(1)} s`,
    );
  }
}

async function main() {
  const args = parseRunArgs(process.argv.slice(2));
  const db = getScriptDb(); // loads .env
  initTracing();
  const [pack, triage, riceScoring, moscow, digest] = await Promise.all([
    loadContextPack(),
    loadSkill("triage-taxonomy"),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
    loadSkill("digest"),
  ]);
  const runId = args.resume ?? randomUUID();
  const reachMode = args.reachMode ?? pack.weighting.reach.default_mode;

  await withPipelineLock(async () => {
    if (args.resume) {
      const { data, error } = await db
        .from("pipeline_runs")
        .select("id, status, kind")
        .eq("id", runId)
        .maybeSingle();
      if (error) throw new Error(`Lecture du run (${error.message})`);
      if (!data || data.kind !== "full") throw new Error(`Run complet ${runId} introuvable`);
      if (data.status === "termine") {
        console.log(`Le run ${runId} est déjà terminé.`);
        return;
      }
      await db.from("pipeline_runs").update({ status: "en_cours", ended_at: null }).eq("id", runId);
    } else {
      const { error } = await db
        .from("pipeline_runs")
        .insert({ id: runId, kind: "full", status: "en_cours" });
      if (error) throw new Error(`Création du run en échec (${error.message})`);
    }
    console.log(`${args.resume ? "Reprise du run" : "Run"} ${runId} · mode ${reachMode}`);

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const checkpointer = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
    const started = Date.now();
    let traceId: string | undefined;
    try {
      await checkpointer.setup();
      const graph = compilePipeline(
        {
          db,
          pack,
          skills: {
            triage: triage.content,
            riceScoring: riceScoring.content,
            moscow: moscow.content,
            digest: digest.content,
          },
          now: getDemoNow(),
          triageBatchSize: args.batchSize,
        },
        checkpointer,
      );
      const state = await withTrace(
        "run-pipeline",
        { runId, step: "run", tags: ["pipeline", "full"] },
        { resume: Boolean(args.resume), reachMode },
        async () => {
          traceId = currentTraceId();
          return runPipeline(graph, { runId, reachMode, resume: Boolean(args.resume) });
        },
        (s) => ({ triaged: s.triaged.length, failures: s.failures.length, cost: s.cost }),
      );
      const seconds = (Date.now() - started) / 1000;
      report(state, seconds);
      await investigatePending(db);
      await shutdownTracing();
      const url = await traceUrl(traceId);
      const { data: previous } = await db
        .from("pipeline_runs")
        .select("stats")
        .eq("id", runId)
        .single();
      const before = (previous?.stats ?? {}) as { duration_s?: number };
      await db
        .from("pipeline_runs")
        .update({
          status: "termine",
          ended_at: new Date().toISOString(),
          stats: {
            mode: "full",
            ...state.stats,
            failures: state.failures,
            // Évals screen (SPEC §12.7): what each node cost, rounded like cost_eur.
            cost_by_node: Object.fromEntries(
              Object.entries(state.cost.byNode ?? {}).map(([node, eur]) => [
                node,
                Number(eur.toFixed(4)),
              ]),
            ),
            // A resumed run adds the durations of its attempts.
            duration_s: Math.round(seconds) + (args.resume ? (before.duration_s ?? 0) : 0),
          } as unknown as Json,
          tokens_in: state.cost.tokensIn,
          tokens_out: state.cost.tokensOut,
          cost_eur: Number(state.cost.eur.toFixed(4)),
          langfuse_url: url,
        })
        .eq("id", runId);
      console.log(`Trace Langfuse : ${url ?? "(Langfuse non configuré)"}`);
    } catch (error) {
      const seconds = Math.round((Date.now() - started) / 1000);
      await db
        .from("pipeline_runs")
        .update({
          status: "echec",
          ended_at: new Date().toISOString(),
          stats: {
            mode: "full",
            error: error instanceof Error ? error.message : String(error),
            duration_s: seconds,
          },
        })
        .eq("id", runId);
      console.error(`\nRun interrompu. Reprendre avec : pnpm pipeline:run --resume ${runId}`);
      throw error;
    } finally {
      await pool.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    await shutdownTracing();
    if (error instanceof PipelineBusyError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  });
}
