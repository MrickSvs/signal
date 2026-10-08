import { NextResponse, type NextRequest } from "next/server";
import { annotationSchema, appendAnnotation, loadCalibrationSet } from "@/lib/judge/calibration";

/**
 * POST /api/evals/annotations {item_id, kind, notes, verdict, comment} → appends the PO's
 * annotation to evals/human-labels/backlog.jsonl, read by eval:judge-calibration. Local only: the
 * file lives in the repo, so the route does not exist in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = annotationSchema.safeParse({ ...body, annotated_at: new Date().toISOString() });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Annotation incomplète : une note par critère et un verdict." },
      { status: 400 },
    );
  }
  const item = (await loadCalibrationSet()).find((i) => i.id === parsed.data.item_id);
  if (!item || item.kind !== parsed.data.kind) {
    return NextResponse.json({ error: "Élément inconnu du jeu de calibration." }, { status: 400 });
  }
  await appendAnnotation(parsed.data);
  return NextResponse.json({ ok: true });
}
