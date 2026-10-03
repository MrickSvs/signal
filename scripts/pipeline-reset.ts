// Resets what the pipeline produced (PLAN 2.6 test: « base remise à zéro, hors clients et
// tickets »): alerts, digests, insights (and everything hanging from them: items, tensions,
// scores, overrides, backlog), estimates, feedbacks (with their analyses and items) and runs.
// Customers and reference tickets are kept; `pnpm db:seed` then reinserts the feedbacks.
// Id sequences are not rewound: ids are never reused (SPEC §7).
// Usage: pnpm pipeline:reset --yes
import { pathToFileURL } from "node:url";
import { getScriptDb } from "@/lib/db/script-client";

const TABLES = [
  ["alerts", "id"],
  ["digests", "id"],
  ["insights", "id"],
  ["complexity_estimates", "id"],
  ["feedbacks", "id"],
  ["pipeline_runs", "id"],
] as const;

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error(
      "Supprime retours, analyses, insights, scores, estimations, alertes, digests et runs.\n" +
        "Clients et tickets de référence conservés. Relancer avec --yes pour confirmer.",
    );
    process.exit(1);
  }
  const db = getScriptDb();
  const { error: stateError } = await db
    .from("po_state")
    .update({ last_digest_id: null })
    .eq("id", true);
  if (stateError) throw new Error(`po_state (${stateError.message})`);
  for (const [table, column] of TABLES) {
    const { error, count } = await db
      .from(table)
      .delete({ count: "exact" })
      .not(column, "is", null);
    if (error) throw new Error(`Suppression de ${table} (${error.message})`);
    console.log(`${table} : ${count ?? 0} ligne(s) supprimée(s)`);
  }
  console.log("Base remise à zéro. Ensuite : pnpm db:seed && pnpm pipeline:run");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
