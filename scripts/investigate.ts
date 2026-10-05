// Investigation of alerts (PLAN 4.5, SPEC §10.10): runs the read-only investigation on one alert,
// or on every open alert still waiting for its dossier, and prints the dossier.
// Usage: pnpm investigate <alert_uuid> | --pending   (≈ 0.05 € per alert)
import { investigate, investigateAll, pendingInvestigations } from "@/agent/investigate";
import { loadAgentDeps } from "@/agent/runtime";
import { getScriptDb } from "@/lib/db/script-client";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("Usage : pnpm investigate <alert_uuid> | --pending");
  const db = getScriptDb(); // loads .env
  initTracing();
  const { deps, skills } = await loadAgentDeps(db);
  const ids = arg === "--pending" ? await pendingInvestigations(db) : [arg];
  if (ids.length === 0) console.log("Aucune alerte sans dossier.");
  const results =
    ids.length === 1
      ? [await investigate(ids[0]!, deps, { skills })]
      : await investigateAll(ids, deps, { skills });
  for (const r of results) {
    console.log(
      `\n${r.alertId} · ${r.status} · ${r.costEur.toFixed(4)} € · ${(r.durationMs / 1000).toFixed(1)} s`,
    );
    if (r.error) console.log(`Erreur : ${r.error}`);
    const { data } = await db
      .from("alerts")
      .select("dossier_markdown")
      .eq("id", r.alertId)
      .single();
    if (data?.dossier_markdown) console.log(data.dossier_markdown);
    console.log(`Trace : ${r.langfuseUrl ?? "(Langfuse non configuré)"}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(shutdownTracing);
