import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { listPipelineRuns, MAX_RUNS, RUN_KINDS } from "@/server/queries/pipeline-runs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_RUNS).default(20),
  kind: z.enum(RUN_KINDS).optional(),
});

/** GET /api/pipeline/runs?limit=20&kind=full — latest pipeline runs, newest first. */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    return NextResponse.json({ runs: await listPipelineRuns(getDb(), parsed.data) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Lecture des runs impossible." }, { status: 500 });
  }
}
