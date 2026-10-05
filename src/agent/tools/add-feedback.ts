import { z } from "zod";
import { CHANNEL_SOURCE_TYPES } from "@/lib/labels";
import { Constants } from "@/lib/db/types";
import {
  insertFeedbacks,
  MAX_INCREMENTAL_FEEDBACKS,
  runIncremental,
  type IncrementalResult,
} from "@/pipeline/incremental";
import { signalTool, type AgentDeps } from "./shared";

const enums = Constants.public.Enums;

export const addFeedbackSchema = z.object({
  feedbacks: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(50_000)
          .describe("Le texte du retour client, tel quel, sans le reformuler."),
        channel: z.enum(enums.feedback_channel).default("email_client"),
        customer_id: z
          .string()
          .regex(/^C-\d{3,}$/)
          .optional()
          .describe("Seulement si Léa nomme le compte et que son ID est connu."),
        author_name: z.string().trim().min(1).max(200).optional(),
        author_email: z.email().optional(),
        subject: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(MAX_INCREMENTAL_FEEDBACKS),
});

/** Steps of the incremental pipeline, as the live trace shows them. */
export const STEP_LABELS: Record<string, string> = {
  triage: "Triage des retours",
  enrich: "Rattachement au compte",
  embed: "Vectorisation",
  load: "Lecture des insights",
  match: "Rattachement aux insights",
  label: "Nommage des sujets proposés",
  score: "Re-score des insights touchés",
  alert: "Alertes",
};

/** What the chat shows for each pasted feedback (pure). */
export function compactIncremental(result: IncrementalResult) {
  return {
    retours: result.feedbacks.map((f) => ({
      id: f.id,
      statut: f.status,
      resume: f.summary,
      items: f.items.map((i) => ({
        id: i.id,
        type: i.type,
        resultat: i.outcome,
        insight: i.insight_id,
        similarite: i.similarity === null ? null : Math.round(i.similarity * 100) / 100,
      })),
    })),
    insights_proposes: result.proposedInsights.map((i) => ({ id: i.id, titre: i.title })),
    insights_rescores: result.rescored,
    alertes: result.alerts,
    echecs: result.failures,
    run: result.runId,
  };
}

export function addFeedbackTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "add_feedback",
      summary:
        "Ajoute 1 à 10 retours clients collés par Léa et les passe dans le pipeline incrémental : triage, rattachement au compte, rattachement à un insight ou file « à surveiller », re-score des insights touchés, alertes.",
      when: "Léa colle un ou plusieurs retours de clients (mail, ticket, note) pour qu'ils soient traités.",
      notWhen:
        "Le texte est une question ou une consigne de Léa, même entre guillemets ou citée en exemple : réponds-lui, n'ajoute rien. En cas de doute, demande-lui si c'est un retour à enregistrer.",
      schema: addFeedbackSchema,
      models: ["triage", "reasoning"],
    },
    async ({ feedbacks }, ctx, progress) => {
      const now = deps.now();
      const result = await deps.withLock(async () => {
        const ids = await insertFeedbacks(
          deps.db,
          feedbacks.map((f) => ({
            channel: f.channel,
            source_type: CHANNEL_SOURCE_TYPES[f.channel],
            raw_text: f.text,
            customer_id: f.customer_id ?? null,
            author_name: f.author_name ?? null,
            author_email: f.author_email ?? null,
            subject: f.subject ?? null,
          })),
          now,
        );
        return runIncremental(deps.db, ids, {
          pack: deps.pack,
          skills: deps.skills,
          now,
          ...deps.incremental,
          onStep: (step) => progress(STEP_LABELS[step] ?? step),
        });
      });
      ctx?.runCost.addEur(result.costEur);
      deps.onAlerts?.(result.alerts.created.map((a) => a.id));
      return compactIncremental(result);
    },
  );
}
