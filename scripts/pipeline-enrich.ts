// Enrich CLI (PLAN 2.2): links feedbacks to their account and prints the business signals.
// Usage: pnpm pipeline:enrich. No LLM, no cost.
import { pathToFileURL } from "node:url";
import { loadContextPack } from "@/lib/context";
import { getScriptDb } from "@/lib/db/script-client";
import { getDemoNow } from "@/lib/demo-now";
import { runEnrich } from "@/pipeline/nodes/enrich";

async function main() {
  const db = getScriptDb();
  const { weighting } = await loadContextPack();
  const summary = await runEnrich(db, { weighting, now: getDemoNow() });

  const { signals, linked, byMethod } = summary;
  console.log(`Retours : ${signals.length}`);
  console.log(
    `Rattachement : déjà connu ${byMethod.connu} · domaine ${byMethod.domaine} · ` +
      `nom exact ${byMethod.nom_exact} · nom approché ${byMethod.nom_approche} · aucun ${byMethod.aucun}`,
  );
  console.log(`customer_id renseigné par ce run : ${linked.length}`);
  for (const l of linked.filter((l) => l.method.startsWith("nom"))) {
    console.log(`  ${l.feedbackId} → ${l.customerId} (${l.method})`);
  }
  const accounts = new Set(signals.map((s) => s.account_key));
  console.log(
    `Comptes distincts : ${accounts.size} · prospects : ${signals.filter((s) => s.is_prospect).length} retours · ` +
      `sans compte : ${
        signals
          .filter((s) => !s.customer_id)
          .map((s) => s.feedback_id)
          .join(", ") || "—"
      }`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
