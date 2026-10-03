"use server";

import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import {
  BACKLOG_ITEM_ID,
  FEEDBACK_ID,
  INSIGHT_ID,
  getBacklogItemPreview,
  getFeedbackEvidence,
  getInsightPreview,
  type BacklogItemPreview,
  type FeedbackEvidence,
  type InsightPreview,
} from "@/server/queries/evidence";

// Read-only server functions behind the ID popovers: the preview is loaded when it opens,
// so a list of 50 chips costs nothing until one is clicked.

export type PreviewResult<T> =
  { ok: true; data: T } | { ok: false; reason: "introuvable" | "erreur" };

async function load<T>(
  id: string,
  pattern: RegExp,
  read: (id: string) => Promise<T | null>,
): Promise<PreviewResult<T>> {
  if (!pattern.test(id)) return { ok: false, reason: "introuvable" };
  try {
    const data = await read(id);
    return data ? { ok: true, data } : { ok: false, reason: "introuvable" };
  } catch (error) {
    console.error(error);
    return { ok: false, reason: "erreur" };
  }
}

/** With the scenario clock, so the client shows relative dates against DEMO_NOW. */
export type FeedbackEvidenceView = FeedbackEvidence & { now: string };

export async function loadFeedbackEvidence(
  id: string,
): Promise<PreviewResult<FeedbackEvidenceView>> {
  return load(id, FEEDBACK_ID, async (value) => {
    const evidence = await getFeedbackEvidence(getDb(), value);
    return evidence && { ...evidence, now: getDemoNow().toISOString() };
  });
}

export async function loadInsightPreview(id: string): Promise<PreviewResult<InsightPreview>> {
  return load(id, INSIGHT_ID, (value) => getInsightPreview(getDb(), value));
}

export async function loadBacklogItemPreview(
  id: string,
): Promise<PreviewResult<BacklogItemPreview>> {
  return load(id, BACKLOG_ITEM_ID, (value) => getBacklogItemPreview(getDb(), value));
}
