// Review decisions on an insight (SPEC §8.10): the input contract shared by the Insights screen,
// the service (services/insight-review.ts) and the agent's apply_decision. Pure (zod
// only): the client components import it.
import { z } from "zod";

const insightId = z.string().regex(/^I-\d{2,}$/, "ID d'insight attendu (I-07)");
const reason = z.string().trim().max(500).optional();

export const TITLE_MAX = 140;
export const STATEMENT_MAX = 800;

/** One review decision. French action names: the agent's apply_decision passes them as is. */
export const insightReviewSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("accepter"),
    insight_ids: z.array(insightId).min(1).max(100),
    reason,
  }),
  z.strictObject({
    action: z.literal("reformuler"),
    insight_id: insightId,
    title: z.string().trim().min(3, "Titre trop court").max(TITLE_MAX, "Titre trop long"),
    problem_statement: z
      .string()
      .trim()
      .min(10, "Énoncé trop court")
      .max(STATEMENT_MAX, "Énoncé trop long"),
    reason,
  }),
  z.strictObject({
    action: z.literal("fusionner"),
    insight_id: insightId,
    into: insightId,
    reason,
  }),
  z.strictObject({ action: z.literal("rejeter"), insight_id: insightId, reason }),
]);

export type InsightReview = z.infer<typeof insightReviewSchema>;

/** Backlog items of an insight not sent yet, by status. */
export type UnsentBacklog = { brouillon: number; valide: number };

/**
 * What the reject and merge confirmations say about the insight's backlog (« I-05 a 2
 * brouillons… »): the items stay, but no longer leave for Notion. Null when there is none.
 */
export function unsentBacklogNote(insightId: string, unsent?: UnsentBacklog): string | null {
  const drafts = unsent?.brouillon ?? 0;
  const validated = unsent?.valide ?? 0;
  if (drafts + validated === 0) return null;
  const parts = [
    drafts ? `${drafts} brouillon${drafts > 1 ? "s" : ""}` : null,
    validated ? `${validated} élément${validated > 1 ? "s validés" : " validé"}` : null,
  ].filter(Boolean);
  const many = drafts + validated > 1;
  return `${insightId} a ${parts.join(" et ")} dans le backlog : ${many ? "ils y restent, mais ne partiront plus" : "il y reste, mais ne partira plus"} dans Notion. ${many ? "Rejette-les" : "Rejette-le"} depuis le Backlog.`;
}
