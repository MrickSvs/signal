// eval:estimation (PLAN 6.2, SPEC §14.2): leave-one-out on the 40 reference tickets. Each ticket
// is estimated from the 39 others and architecture.md, without seeing its points, components or
// team estimate: it is removed from the analogues AND from the bias computation (the engine of
// 2.4 takes the ticket set as a parameter). Measures: share of actual points inside the range,
// mean error in Fibonacci steps between the middle of the range and the actual points, and the
// same error for the team's estimate (estimated_points). Nothing is written to the cache.
// Usage: pnpm eval:estimation [--sample N] [--yes]   ·   Cost: ~0.025 € per ticket (40: ~1 €).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { mapWithConcurrency } from "@/lib/async";
import { getScriptDb } from "@/lib/db/script-client";
import { embed } from "@/lib/embeddings";
import { ticketEmbeddingText, type ReferenceTicketForEstimate } from "@/lib/estimation/reference";
import { RunCost } from "@/lib/llm/cost";
import { currentTraceId, initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import {
  estimateNeed,
  loadEstimationContext,
  loadReferenceTickets,
  type Estimate,
} from "@/services/estimate";
import { checkCost, parseEvalArgs, sampleSize } from "./lib/args";
import { fibonacciIndex, mean, rangeStepError, spreadSample } from "./lib/metrics";
import { EvalRecorder } from "./lib/record";
import type { EvalSummary, Metric } from "./lib/types";

const COST_PER_TICKET_EUR = 0.025;
const CONCURRENCY = 4;
const TICKETS_FILE = path.join(process.cwd(), "data", "reference_tickets.json");

const ticketTruthSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  components: z.array(z.string()),
  estimated_points: z.number(),
  actual_points: z.number(),
});
export type TicketTruth = z.infer<typeof ticketTruthSchema>;

/** What the estimator sees of the evaluated ticket: its title and description, nothing else. */
export const needOf = (t: Pick<TicketTruth, "title" | "description">) => ticketEmbeddingText(t);

/** The reference set without the evaluated ticket (analogues and bias). */
export const leaveOneOut = <T extends { id: string }>(tickets: readonly T[], id: string) =>
  tickets.filter((t) => t.id !== id);

export type EstimationCase = {
  ticket: TicketTruth;
  estimate: Pick<Estimate, "points_min" | "points_max" | "confidence" | "components"> | null;
  error?: string;
};

export function scoreEstimation(cases: readonly EstimationCase[], scale: readonly number[]) {
  const done = cases.filter((c) => c.estimate);
  const inRange = done.filter(
    (c) =>
      c.ticket.actual_points >= c.estimate!.points_min &&
      c.ticket.actual_points <= c.estimate!.points_max,
  ).length;
  const ourSteps = done.map((c) =>
    rangeStepError(
      { min: c.estimate!.points_min, max: c.estimate!.points_max },
      c.ticket.actual_points,
      scale,
    ),
  );
  // The team's error on the same tickets (those the engine could estimate).
  const teamSteps = done.map((c) =>
    Math.abs(
      fibonacciIndex(c.ticket.estimated_points, scale) -
        fibonacciIndex(c.ticket.actual_points, scale),
    ),
  );
  const teamExact = done.filter((c) => c.ticket.estimated_points === c.ticket.actual_points).length;
  return {
    total: cases.length,
    estimated: done.length,
    failed: cases.filter((c) => !c.estimate).map((c) => c.ticket.id),
    inRangeShare: cases.length ? inRange / cases.length : 0,
    meanSteps: mean(ourSteps),
    teamMeanSteps: mean(teamSteps),
    teamExactShare: done.length ? teamExact / done.length : 0,
    meanWidthSteps: mean(
      done.map(
        (c) =>
          fibonacciIndex(c.estimate!.points_max, scale) -
          fibonacciIndex(c.estimate!.points_min, scale),
      ),
    ),
  };
}

const pct = (r: number) => `${Math.round(r * 100)} %`;
const dec = (n: number) => n.toFixed(2).replace(".", ",");

export function estimationMetrics(s: ReturnType<typeof scoreEstimation>): Metric[] {
  return [
    {
      key: "in_range",
      label: "Points réels dans la fourchette",
      value: s.inRangeShare,
      display: `${pct(s.inRangeShare)} (${Math.round(s.inRangeShare * s.total)}/${s.total})`,
      target: "≥ 70 %",
      met: s.inRangeShare >= 0.7,
    },
    {
      key: "mean_steps",
      label: "Erreur moyenne du milieu de la fourchette (crans Fibonacci)",
      value: s.meanSteps,
      display: dec(s.meanSteps),
      target: "≤ 1 cran",
      met: s.estimated > 0 && s.meanSteps <= 1,
    },
    {
      key: "vs_team",
      label: "Erreur moyenne de l'équipe (estimated_points), mêmes tickets",
      value: s.teamMeanSteps,
      display: `${dec(s.teamMeanSteps)} (Signal : ${dec(s.meanSteps)})`,
      target: "Signal au moins aussi bien",
      met: s.estimated > 0 && s.meanSteps <= s.teamMeanSteps,
    },
    {
      key: "mean_width",
      label: "Largeur moyenne de la fourchette (crans)",
      value: s.meanWidthSteps,
      display: dec(s.meanWidthSteps),
    },
  ];
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const db = getScriptDb();
  initTracing();
  const truth = z.array(ticketTruthSchema).parse(JSON.parse(readFileSync(TICKETS_FILE, "utf8")));
  const stored = await loadReferenceTickets(db);
  const storedIds = new Set(stored.map((t) => t.id));
  const missing = truth.filter((t) => !storedIds.has(t.id)).map((t) => t.id);
  if (missing.length)
    throw new Error(`Tickets absents de la base : ${missing.join(", ")} (pnpm db:seed)`);

  const n = sampleSize(args, truth.length, truth.length);
  const sample = spreadSample(truth, n, () => false);
  console.log(
    checkCost(
      sample.length * COST_PER_TICKET_EUR,
      args,
      `${sample.length} tickets, un appel Sonnet chacun`,
    ),
  );

  const context = await loadEstimationContext();
  const scale = context.weighting.effort.fibonacci;
  const recorder = await EvalRecorder.start(
    db,
    "estimation",
    { sample: sample.length },
    sample.length,
  );
  const runCost = new RunCost();
  // One Voyage call for every need (rate limit without a payment method).
  const needs = sample.map(needOf);
  const vectors = await embed(needs, "query", { runCost });
  const vectorOf = new Map(needs.map((need, i) => [need, vectors[i]]));

  let done = 0;
  const cases = await mapWithConcurrency(sample, CONCURRENCY, async (ticket) =>
    withTrace(
      "eval-estimation-case",
      {
        root: true,
        runId: recorder.runId,
        step: "eval",
        entity: ticket.id,
        tags: ["eval", "estimation"],
      },
      { ticket_id: ticket.id },
      async () => {
        const traceId = currentTraceId();
        const references: ReferenceTicketForEstimate[] = leaveOneOut(stored, ticket.id);
        let result: EstimationCase;
        try {
          const estimate = await estimateNeed(
            {
              need: needOf(ticket),
              tickets: references,
              metadata: { eval_run_id: recorder.runId, ticket_id: ticket.id },
            },
            { runCost, context, embedQuery: async (text) => vectorOf.get(text)! },
          );
          result = { ticket, estimate };
        } catch (error) {
          result = {
            ticket,
            estimate: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        done++;
        process.stdout.write(`\r${done}/${sample.length} · ${ticket.id}      `);
        return { ...result, traceId };
      },
    ),
  );

  for (const c of cases) {
    const e = c.estimate;
    const inRange =
      e !== null &&
      c.ticket.actual_points >= e.points_min &&
      c.ticket.actual_points <= e.points_max;
    recorder.add({
      item_id: c.ticket.id,
      expected: {
        actual_points: c.ticket.actual_points,
        team: c.ticket.estimated_points,
        components: c.ticket.components,
      },
      actual: e
        ? {
            points_min: e.points_min,
            points_max: e.points_max,
            confidence: e.confidence,
            components: e.components,
          }
        : { error: c.error },
      score: e
        ? rangeStepError({ min: e.points_min, max: e.points_max }, c.ticket.actual_points, scale)
        : null,
      pass: inRange,
      traceId: c.traceId,
    });
  }
  const score = scoreEstimation(cases, scale);
  const summary: EvalSummary = {
    dataset: `Tickets de référence (data/reference_tickets.json), leave-one-out, ${sample.length}/${truth.length} tickets`,
    metrics: estimationMetrics(score),
    details: { failed: score.failed, team_exact_share: score.teamExactShare },
    notes: [
      "Chaque ticket est retiré des analogues et du calcul de biais ; l'estimateur ne voit que son titre et sa description.",
      "Erreur en crans : distance, sur l'échelle de Fibonacci, entre le milieu de la fourchette (moyenne des deux bornes en crans) et les points réels.",
      `L'équipe tombe juste (estimé = réel) sur ${pct(score.teamExactShare)} des tickets.`,
      ...(score.failed.length
        ? [`Estimation en échec (comptée hors fourchette) : ${score.failed.join(", ")}.`]
        : []),
    ],
  };
  const file = await recorder.finish(summary, runCost.eur);
  console.log(`\n\n${summary.dataset}`);
  for (const m of summary.metrics)
    console.log(
      `  ${m.label} : ${m.display}${m.target ? ` (cible ${m.target}) ${m.met ? "✓" : "✗"}` : ""}`,
    );
  for (const note of summary.notes ?? []) console.log(`  · ${note}`);
  console.log(`Coût : ${runCost.eur.toFixed(4)} € · rapport ${file} · docs/EVALS.md mis à jour`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await shutdownTracing();
    process.exit(1);
  });
}
