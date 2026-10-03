// Contracts of the generated feedback files (SPEC §5, §7 feedbacks) and of their ground truth.
// The ground truth lives under evals/ and is read only by scripts (CLAUDE.md, rule 4).
import path from "node:path";
import { z } from "zod";
import { AREAS, CHANNELS, ITEM_TYPES, PATTERN_IDS } from "./scenario";
import type { DatasetName } from "./feedback-plan";

const root = process.cwd();
export const FEEDBACK_FILES: Record<DatasetName, { data: string; truth: string }> = {
  development: {
    data: path.join(root, "data", "feedbacks.json"),
    truth: path.join(root, "evals", "ground-truth", "feedbacks.gt.json"),
  },
  holdout: {
    data: path.join(root, "evals", "holdout", "feedbacks.json"),
    truth: path.join(root, "evals", "holdout", "feedbacks.gt.json"),
  },
};

export const feedbackSchema = z.strictObject({
  id: z.string().regex(/^[RH]-\d{3}$/),
  channel: z.enum(CHANNELS),
  source_type: z.enum(["client_direct", "support", "interne"]),
  author_name: z.string().min(1),
  author_email: z.string().email(),
  customer_id: z
    .string()
    .regex(/^C-\d{3}$/)
    .nullable(),
  /** Days before DEMO_NOW; turned into received_at at seed time. */
  days_ago: z.number().int().min(0),
  subject: z.string().min(1).nullable(),
  raw_text: z.string(),
  nps_score: z.number().int().min(0).max(10).nullable(),
  language: z.enum(["fr", "en"]),
});
export type Feedback = z.infer<typeof feedbackSchema>;

const patternRef = z.enum([...PATTERN_IDS, "noise"]);

export const groundTruthSchema = z.strictObject({
  feedback_id: z.string().regex(/^[RH]-\d{3}$/),
  patterns: z.array(patternRef).min(1),
  edge_cases: z.array(z.enum(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"])),
  expected_items: z
    .array(
      z.strictObject({
        pattern_id: patternRef,
        /** Noise topic (eloge, agenda…): small topics must stay weak signals. */
        topic: z.string().nullable(),
        expected_type: z.enum(ITEM_TYPES),
        acceptable_types: z.array(z.enum(ITEM_TYPES)).min(1),
        expected_area: z.enum(AREAS),
        acceptable_areas: z.array(z.enum(AREAS)).min(1),
        existing_feature: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
  expected_sentiment_sign: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  is_injection: z.boolean(),
  churn_signal: z.boolean(),
});
export type GroundTruth = z.infer<typeof groundTruthSchema>;
