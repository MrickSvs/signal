import { after, NextResponse, type NextRequest } from "next/server";
import { pendingInvestigations } from "@/agent/investigate";
import { investigateInBackground } from "@/agent/runtime";
import { isBearerAuthorized } from "@/lib/basic-auth";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { runDailyDigest } from "@/pipeline/daily";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";

// Vercel Hobby: 300 s at most per function (CL-45). The incremental batches stop at 200 s so the
// digest (one reasoning call) always fits; what is left waits for the next run.
export const maxDuration = 300;
const INCREMENTAL_BUDGET_MS = 200_000;

/**
 * GET /api/cron/digest — daily cron (vercel.json): incremental pipeline on the feedbacks not
 * processed yet, then the digest. Vercel sends « Authorization: Bearer $CRON_SECRET ».
 * This daily request also keeps the Supabase project awake (CL-43).
 */
export async function GET(request: NextRequest) {
  if (!isBearerAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  after(flushTracing);
  try {
    const db = getDb();
    const [pack, triage, riceScoring, moscow, digest] = await Promise.all([
      loadContextPack(),
      loadSkill("triage-taxonomy"),
      loadSkill("rice-scoring"),
      loadSkill("moscow"),
      loadSkill("digest"),
    ]);
    const result = await withPipelineLock(() =>
      runDailyDigest(
        db,
        {
          pack,
          skills: {
            triage: triage.content,
            riceScoring: riceScoring.content,
            moscow: moscow.content,
            digest: digest.content,
          },
          now: getDemoNow(),
        },
        { budgetMs: INCREMENTAL_BUDGET_MS },
      ),
    );
    // Dossiers of the alerts the batches created, and of any investigation lost earlier (§10.10).
    await pendingInvestigations(db)
      .then((ids) => investigateInBackground(db, ids))
      .catch((error) => console.error("[enquête]", error));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Le digest quotidien a échoué." }, { status: 500 });
  }
}
