import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { investigateInBackground } from "@/agent/runtime";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { incrementalRequestSchema, insertFeedbacks, runIncremental } from "@/pipeline/incremental";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";

// SPEC §15: adding a feedback takes < 15 s; the lock may wait 30 s for a running run (CL-12).
// Well under the 300 s of a Vercel function (CL-45): full runs go through the CLI. The
// investigations of the alerts it creates run after the response, within the same duration.
export const maxDuration = 180;

/**
 * POST /api/pipeline/incremental { feedbacks: [...] } (1 to 10): inserts the feedbacks and runs
 * the incremental pipeline. 409 when another run holds the lock: nothing was inserted, retry.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = incrementalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  after(flushTracing);
  try {
    const db = getDb();
    const [pack, triage, riceScoring, moscow] = await Promise.all([
      loadContextPack(),
      loadSkill("triage-taxonomy"),
      loadSkill("rice-scoring"),
      loadSkill("moscow"),
    ]);
    const now = getDemoNow();
    const result = await withPipelineLock(async () => {
      const ids = await insertFeedbacks(db, parsed.data.feedbacks, now);
      return runIncremental(db, ids, {
        pack,
        skills: {
          triage: triage.content,
          riceScoring: riceScoring.content,
          moscow: moscow.content,
        },
        now,
      });
    });
    // Each new alert gets its dossier in the background (SPEC §10.10); the answer does not wait.
    await investigateInBackground(
      db,
      result.alerts.created.map((a) => a.id),
    ).catch((error) => console.error("[enquête]", error));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Le pipeline incrémental a échoué." }, { status: 500 });
  }
}
