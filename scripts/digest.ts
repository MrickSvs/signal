// Digest CLI (PLAN 2.7): writes a digest on demand (SPEC §12.2) and prints it.
// Usage: pnpm digest. Cost: one reasoning call (~0.02 to 0.05 €). Does not process pending
// feedbacks: the cron route does (incremental, then digest).
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { generateDigest } from "@/pipeline/daily";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";
import { startSpinner } from "./lib/spinner";

async function main() {
  const db = getScriptDb(); // loads .env
  initTracing();
  const [pack, triage, riceScoring, moscow, digest] = await Promise.all([
    loadContextPack(),
    loadSkill("triage-taxonomy"),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
    loadSkill("digest"),
  ]);
  const started = Date.now();
  const progress = startSpinner("Signal rédige le digest (Sonnet)");
  const result = await withPipelineLock(() =>
    generateDigest(db, {
      pack,
      skills: {
        triage: triage.content,
        riceScoring: riceScoring.content,
        moscow: moscow.content,
        digest: digest.content,
      },
      now: getDemoNow(),
    }),
  ).finally(() => progress.stop());
  console.log(result.markdown);
  console.log(
    `Digest ${result.id} · run ${result.runId} · ${result.writer === "modele" ? "rédigé par Signal" : `REPLI (${result.error})`} · ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s · ${result.costEur.toFixed(4)} €`,
  );
  await shutdownTracing();
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
