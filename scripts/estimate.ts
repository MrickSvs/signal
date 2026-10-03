// Estimation CLI (PLAN 2.4): estimates a free-text need or an insight by analogy (SPEC §8.4).
// Usage: pnpm estimate "<besoin>" [--force]   ·   pnpm estimate I-07 [--force]
// Cost: one Sonnet call (~0.02 €) and one Voyage query; nothing when the estimate is cached.
import { pathToFileURL } from "node:url";
import { getScriptDb } from "@/lib/db/script-client";
import { RunCost } from "@/lib/llm/cost";
import {
  currentTraceId,
  initTracing,
  shutdownTracing,
  traceUrl,
  withTrace,
} from "@/lib/llm/tracing";
import { estimateInsight, estimateText, type StoredEstimate } from "@/services/estimate";

export type EstimateArgs = { need?: string; insightId?: string; force: boolean };

const INSIGHT_ID = /^I-\d+$/;

export function parseEstimateArgs(argv: string[]): EstimateArgs {
  const force = argv.includes("--force");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--force");
  if (unknown.length) throw new Error(`Option inconnue : ${unknown.join(", ")}`);
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1 || !positional[0].trim()) {
    throw new Error('Usage : pnpm estimate "<besoin>" [--force]  (ou un ID d\'insight, ex. I-07)');
  }
  const value = positional[0].trim();
  return INSIGHT_ID.test(value) ? { insightId: value, force } : { need: value, force };
}

const ratio = (n: number) => n.toFixed(2).replace(".", ",");

function report(result: StoredEstimate, seconds: number, costEur: number): void {
  const e = result.estimate;
  const range =
    e.points_min === e.points_max ? `${e.points_min}` : `${e.points_min}–${e.points_max}`;
  const tshirt = e.tshirt_min === e.tshirt_max ? e.tshirt_min : `${e.tshirt_min}–${e.tshirt_max}`;
  console.log(
    `\n${range} points (${tshirt}) · confiance ${e.confidence} · composants ${e.components.join(", ")}`,
  );
  const adj = e.adjustments;
  if (adj) {
    console.log(
      `Brut du modèle : ${adj.raw.min}–${adj.raw.max}, confiance ${adj.raw.confidence} · ` +
        `biais ${adj.bias.applied ? `× ${ratio(adj.bias.factor)} (${adj.bias.tickets} tickets)` : `non appliqué (${adj.bias.tickets} ticket(s))`} · ` +
        `meilleure similarité ${adj.bestSimilarity === null ? "—" : ratio(adj.bestSimilarity)}` +
        (adj.noCloseAnalogue ? " · AUCUN ANALOGUE PROCHE : fourchette élargie" : ""),
    );
  }
  console.log("\nAnalogies :");
  for (const a of e.analogies) {
    console.log(
      `  ${a.ticket_id} (${ratio(a.similarity)}, ${a.close ? "proche" : "pas proche"}) : ${a.raison}`,
    );
  }
  if (e.analogies.length === 0) console.log("  aucune");
  console.log("\nRisques :");
  for (const r of e.risks) console.log(`  - ${r}`);
  console.log(`\nJustification :\n${e.rationale}`);
  console.log(
    `\n${result.cached ? "Depuis le cache (aucun appel au modèle)" : "Nouvelle estimation"} · ` +
      `${seconds.toFixed(1)} s · ${costEur.toFixed(4)} € · complexity_estimates ${result.id}`,
  );
}

async function main() {
  const args = parseEstimateArgs(process.argv.slice(2));
  const db = getScriptDb();
  initTracing();
  const runCost = new RunCost();
  const started = Date.now();
  let traceId: string | undefined;
  const result = await withTrace(
    "estimate-complexity",
    {
      step: "estimate",
      entity: args.insightId,
      tags: ["estimation", "cli"],
    },
    { need: args.need, insightId: args.insightId, force: args.force },
    async () => {
      traceId = currentTraceId();
      return args.insightId
        ? estimateInsight(db, args.insightId, { force: args.force }, { runCost })
        : estimateText(db, args.need!, { force: args.force }, { runCost });
    },
    (r) => ({ cached: r.cached, ...r.estimate }),
  );
  report(result, (Date.now() - started) / 1000, runCost.eur);
  await shutdownTracing();
  if (!result.cached) {
    console.log(`Trace Langfuse : ${(await traceUrl(traceId)) ?? "(Langfuse non configuré)"}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
