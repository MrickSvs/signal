// Contracts of the Priorisation screen's writes (SPEC §8.5, §8.9), zod only so the client can
// import them. Values are checked against the scales by lib/scoring/overrides.ts on the server.
import { z } from "zod";

const insightId = z.string().regex(/^I-\d+$/, "ID d'insight attendu (I-xx)");
const reason = z.string().trim().max(500, "500 caractères au plus");

export const REACH_MODES = ["comptes", "mrr"] as const;

/**
 * An override from a parameter's popover. `value` is in the unit shown to the PO: accounts or
 * euros for Reach (in `mode`), the scale for Impact, a percentage for Confidence (80 → 0.8),
 * person-weeks for Effort, a category for MoSCoW.
 */
export const overrideRequestSchema = z.discriminatedUnion("param", [
  z.object({
    param: z.enum(["reach", "impact", "confidence", "effort"]),
    insight_id: insightId,
    mode: z.enum(REACH_MODES),
    value: z.number({ error: "Une valeur numérique est attendue" }),
    reason: reason.optional(),
  }),
  z.object({
    param: z.literal("moscow"),
    insight_id: insightId,
    mode: z.enum(REACH_MODES),
    value: z.enum(["must", "should", "could", "wont"]),
    reason: reason.optional(),
  }),
]);

export type OverrideRequest = z.infer<typeof overrideRequestSchema>;

export const cancelOverrideSchema = z.object({
  insight_id: insightId,
  param: z.enum(["reach", "impact", "confidence", "effort", "moscow"]),
  reason: reason.optional(),
});

export type CancelOverrideRequest = z.infer<typeof cancelOverrideSchema>;

/**
 * A topic that does not come from the feedbacks (SPEC §8.9): Reach in accounts and, if known, in
 * MRR; Impact and Confidence (percentage) entered by the PO with one reason; effort entered in
 * person-weeks, or null to let Signal estimate it.
 */
export const manualTopicSchema = z.object({
  title: z.string().trim().min(3, "Un titre est attendu").max(140, "140 caractères au plus"),
  problem_statement: z
    .string()
    .trim()
    .min(10, "Décris le problème en une phrase au moins")
    .max(800, "800 caractères au plus"),
  reach_comptes: z.number({ error: "Reach en comptes attendu" }),
  reach_mrr: z.number().nullable(),
  impact: z.number({ error: "Impact attendu" }),
  confidence: z.number({ error: "Confidence attendue" }),
  effort_weeks: z.number().nullable(),
  reason: z.string().trim().min(1, "Une raison est obligatoire").max(500),
});

export type ManualTopic = z.infer<typeof manualTopicSchema>;
