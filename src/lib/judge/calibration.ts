// Calibration of the judge (SPEC §14.3): the 15 items annotated by the PO and their annotations,
// stored in evals/human-labels/ (never the ground truth nor the holdout set, CLAUDE.md rule 4).
// The set holds only what the annotator sees; which items were degraded lives in a separate key
// read by eval:judge-calibration alone.
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { JUDGE_KINDS, RUBRIC_CRITERIA, VERDICTS, type JudgeKind } from "./judge";

const DIR = path.join(process.cwd(), "evals", "human-labels");
export const CALIBRATION_SET_FILE = path.join(DIR, "calibration-set.json");
export const CALIBRATION_KEY_FILE = path.join(DIR, "calibration-key.json");
export const ANNOTATIONS_FILE = path.join(DIR, "backlog.jsonl");

export const calibrationItemSchema = z.object({
  id: z.string().regex(/^CAL-\d{2}$/),
  kind: z.enum(JUDGE_KINDS),
  content: z.record(z.string(), z.unknown()),
});
export type CalibrationItem = z.infer<typeof calibrationItemSchema>;

export const calibrationKeySchema = z.object({
  id: z.string(),
  source_id: z.string(),
  insight_id: z.string(),
  /** null for an item as Signal drafted it; else the degradation applied by the script. */
  degradation: z.string().nullable(),
});
export type CalibrationKey = z.infer<typeof calibrationKeySchema>;

export const annotationSchema = z
  .object({
    item_id: z.string().regex(/^CAL-\d{2}$/),
    kind: z.enum(JUDGE_KINDS),
    notes: z.record(z.string(), z.number().int().min(1).max(5)),
    verdict: z.enum(VERDICTS),
    comment: z.string().trim().max(1000).default(""),
    annotated_at: z.string(),
  })
  .refine(
    (a) => {
      const expected = RUBRIC_CRITERIA[a.kind as JudgeKind];
      const keys = Object.keys(a.notes);
      return keys.length === expected.length && expected.every((c) => keys.includes(c));
    },
    { message: "une note par critère de la grille du type" },
  );
export type Annotation = z.infer<typeof annotationSchema>;

export async function loadCalibrationSet(): Promise<CalibrationItem[]> {
  return z
    .array(calibrationItemSchema)
    .parse(JSON.parse(await readFile(CALIBRATION_SET_FILE, "utf8")));
}

/** Annotations, the latest line of an item winning (an item can be annotated again). Pure. */
export function parseAnnotations(jsonl: string): Map<string, Annotation> {
  const latest = new Map<string, Annotation>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const parsed = annotationSchema.safeParse(JSON.parse(line));
    if (parsed.success) latest.set(parsed.data.item_id, parsed.data);
  }
  return latest;
}

export async function loadAnnotations(): Promise<Map<string, Annotation>> {
  try {
    return parseAnnotations(await readFile(ANNOTATIONS_FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

export async function appendAnnotation(annotation: Annotation): Promise<void> {
  await appendFile(ANNOTATIONS_FILE, JSON.stringify(annotation) + "\n", "utf8");
}
