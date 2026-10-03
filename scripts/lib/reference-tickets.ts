// Contract of data/reference_tickets.json (SPEC §7 reference_tickets, §8.4), shared by the
// generator, the seed and the estimation eval.
import path from "node:path";
import { z } from "zod";

export const REFERENCE_TICKETS_FILE = path.join(process.cwd(), "data", "reference_tickets.json");

/** Points of a backlog item or a shipped ticket (team.md). */
export const TICKET_POINTS = [1, 2, 3, 5, 8, 13] as const;

const points = z
  .number()
  .int()
  .refine((p) => (TICKET_POINTS as readonly number[]).includes(p), "not a Fibonacci point");

export const referenceTicketSchema = z.strictObject({
  id: z.string().regex(/^T-1\d\d$/),
  title: z.string().min(10).max(120),
  description: z.string().min(40).max(600),
  /** Main module: an id of the « Modules » table of architecture.md. */
  module: z.string().min(1),
  /** Every module touched, main module first. */
  components: z.array(z.string().min(1)).min(1),
  estimated_points: points,
  actual_points: points,
  actual_days: z.number().positive(),
  surprises: z.string().min(10).max(400),
  /** Days between the delivery and DEMO_NOW; turned into shipped_at at seed time. */
  shipped_days_ago: z.number().int().positive(),
});

export type ReferenceTicket = z.infer<typeof referenceTicketSchema>;

export const referenceTicketsSchema = z.array(referenceTicketSchema);

/** Mean ratio actual ÷ estimated points of the tickets touching each component. */
export function biasByComponent(
  tickets: Pick<ReferenceTicket, "components" | "estimated_points" | "actual_points">[],
): Record<string, { tickets: number; ratio: number }> {
  const ratios = new Map<string, number[]>();
  for (const t of tickets) {
    for (const c of t.components) {
      ratios.set(c, [...(ratios.get(c) ?? []), t.actual_points / t.estimated_points]);
    }
  }
  return Object.fromEntries(
    [...ratios].map(([c, r]) => [
      c,
      { tickets: r.length, ratio: r.reduce((a, b) => a + b, 0) / r.length },
    ]),
  );
}
