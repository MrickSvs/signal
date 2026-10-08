import { notFound } from "next/navigation";
import { AnnotateView } from "@/components/evals/annotate-view";
import { loadAnnotations, loadCalibrationSet } from "@/lib/judge/calibration";
import { JUDGE_KINDS, loadRubric, RUBRIC_CRITERIA, rubricFor } from "@/lib/judge/judge";

export const dynamic = "force-dynamic";

/**
 * Annotation of the judge's calibration set by the PO (SPEC §14.3): one item at a time,
 * the grid of its kind. Local only: the annotations are written into the repo.
 */
export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const [items, annotations, rubric] = await Promise.all([
    loadCalibrationSet().catch(() => []),
    loadAnnotations(),
    loadRubric(),
  ]);
  if (items.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Pas de jeu de calibration : lance <code>pnpm eval:calibration-set</code>.
      </p>
    );
  }
  const grids = Object.fromEntries(
    JUDGE_KINDS.map((kind) => [
      kind,
      { text: rubricFor(rubric, kind), criteria: [...RUBRIC_CRITERIA[kind]] },
    ]),
  );
  return (
    <AnnotateView
      items={items}
      annotations={Object.fromEntries(annotations)}
      grids={grids as Record<(typeof JUDGE_KINDS)[number], { text: string; criteria: string[] }>}
    />
  );
}
