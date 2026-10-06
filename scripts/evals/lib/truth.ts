// Evaluation data (CLAUDE.md rule 4: only scripts/evals reads it) and the stored insights it is
// compared with: pattern → insight resolution shared by detection, tool choice and guardrails.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Db } from "@/lib/db/create";
import type { FeedbackToTriage } from "@/pipeline/nodes/triage";
import {
  FEEDBACK_FILES,
  feedbackSchema,
  groundTruthSchema,
  type Feedback,
  type GroundTruth,
} from "../../lib/feedbacks";
import type { DatasetName } from "../../lib/feedback-plan";
import { bestInsightFor, type InsightItem, type PatternMatch } from "./metrics";

export const DETECTED_PATTERNS = ["S1", "S2a", "S2b", "S3", "S4", "S5a", "S5b", "S7"] as const;
export type DetectedPattern = (typeof DETECTED_PATTERNS)[number];

export type EvalSet = { feedbacks: Feedback[]; truth: Map<string, GroundTruth> };

export function loadEvalSet(name: DatasetName): EvalSet {
  const files = FEEDBACK_FILES[name];
  const feedbacks = z.array(feedbackSchema).parse(JSON.parse(readFileSync(files.data, "utf8")));
  const truth = z.array(groundTruthSchema).parse(JSON.parse(readFileSync(files.truth, "utf8")));
  return { feedbacks, truth: new Map(truth.map((t) => [t.feedback_id, t])) };
}

export type CustomerInfo = NonNullable<FeedbackToTriage["customer"]>;

export async function loadCustomers(db: Db): Promise<Map<string, CustomerInfo>> {
  const { data, error } = await db.from("customers").select("id, name, status, plan, segment");
  if (error) throw new Error(`Lecture des comptes (${error.message})`);
  return new Map((data ?? []).map(({ id, ...c }) => [id, c]));
}

/** A feedback of the files, in the shape the triage node takes (customer as in the database). */
export function toTriageInput(
  f: Feedback,
  customers: ReadonlyMap<string, CustomerInfo>,
): FeedbackToTriage {
  return {
    id: f.id,
    channel: f.channel,
    source_type: f.source_type,
    subject: f.subject,
    raw_text: f.raw_text,
    nps_score: f.nps_score,
    customer: f.customer_id ? (customers.get(f.customer_id) ?? null) : null,
  };
}

export type StoredInsight = {
  id: string;
  title: string;
  problem_statement: string | null;
  status: string;
  accounts_count: number | null;
  items: InsightItem[];
};

/** Proposed and active insights with their items (a merged or rejected insight is skipped). */
export async function loadLiveInsights(db: Db): Promise<StoredInsight[]> {
  const [insights, links, items] = await Promise.all([
    db
      .from("insights")
      .select("id, title, problem_statement, status, accounts_count")
      .in("status", ["propose", "actif"])
      .order("id"),
    db.from("insight_items").select("insight_id, item_id").range(0, 9999),
    db.from("feedback_items").select("id, feedback_id, product_area").range(0, 9999),
  ]);
  for (const r of [insights, links, items])
    if (r.error) throw new Error(`Lecture des insights (${r.error.message})`);
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  return (insights.data ?? []).map((insight) => ({
    ...insight,
    items: (links.data ?? [])
      .filter((l) => l.insight_id === insight.id)
      .flatMap((l) => {
        const item = itemById.get(l.item_id);
        return item ? [item] : [];
      }),
  }));
}

/** The best stored insight of each pattern of the scenario (null when none holds any item). */
export function resolvePatterns(
  insights: readonly StoredInsight[],
  truth: ReadonlyMap<string, GroundTruth>,
): Map<DetectedPattern, PatternMatch | null> {
  return new Map(DETECTED_PATTERNS.map((p) => [p, bestInsightFor(p, insights, truth)]));
}
