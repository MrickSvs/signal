// Build time per phase: sums the sessions of docs/process/BUILD_LOG.md (time and LLM cost), by
// phase of docs/process/PLAN.md. A session outside the plan (replanning, UX redesigns, review)
// counts in « hors plan ». The parsing is pure; only main() reads the file.
// Usage: pnpm tsx scripts/build-time.ts [path to BUILD_LOG.md]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_LOG = "docs/process/BUILD_LOG.md";

/** Phase names of PLAN.md (« Vue d'ensemble »). */
export const PHASES: Record<string, string> = {
  "0": "Fondations",
  "1": "Le monde de Jalon",
  "2": "Pipeline d'ingestion",
  "3": "Cockpit Signal",
  "4": "Agent Signal",
  "5": "Envoi vers Notion",
  "6": "Qualité : tests, evals, juge",
  "7": "Prototype et MCP",
  "8": "Démo et livrables",
};
export const OUTSIDE_PLAN = "hors plan";

export type LogEntry = {
  date: string;
  step: string;
  phase: string;
  /** Minutes: the « durée » column, else end − start. Null when neither can be read. */
  minutes: number | null;
  /** Euros; null when the « coût LLM » cell cannot be read. */
  costEur: number | null;
};

export type PhaseTotal = {
  phase: string;
  name: string;
  sessions: number;
  minutes: number;
  costEur: number;
  steps: string[];
  /** Sessions whose duration or cost could not be read (not counted in the totals). */
  unreadable: string[];
};

/** « ~1 h 15 » → 75, « ~35 min » → 35, « ~1 h » → 60. */
export function parseDuration(text: string): number | null {
  const t = text.replace(/~/g, "").trim();
  const hours = /^(\d+)\s*h(?:\s*(\d{1,2}))?$/.exec(t);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  const minutes = /^(\d+)\s*min$/.exec(t);
  return minutes ? Number(minutes[1]) : null;
}

/** « 22:53 » to « 00:04 (+1 j) » → 71 minutes. */
export function minutesBetween(start: string, end: string): number | null {
  const s = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  const e = /^(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)\s*j\))?$/.exec(end.trim());
  if (!s || !e) return null;
  const from = Number(s[1]) * 60 + Number(s[2]);
  const to = Number(e[3] ?? 0) * 1440 + Number(e[1]) * 60 + Number(e[2]);
  return to >= from ? to - from : null;
}

/** « ~0,002 € » → 0.002, « 0 € » → 0. */
export function parseCost(text: string): number | null {
  const m = /^~?\s*(\d+(?:,\d+)?)\s*€$/.exec(text.trim());
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** « 4.3 (fin) » → « 4 » ; « Review, lot A » → hors plan. */
export function phaseOf(step: string): string {
  const m = /^(\d+)\.\d+/.exec(step.trim());
  return m && m[1]! in PHASES ? m[1]! : OUTSIDE_PLAN;
}

/** The session rows of the journal table (header and separator skipped). */
export function parseBuildLog(markdown: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0]!)) continue;
    const [date, step, start, end, duration, cost] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    entries.push({
      date,
      step,
      phase: phaseOf(step),
      minutes: parseDuration(duration) ?? minutesBetween(start, end),
      costEur: parseCost(cost),
    });
  }
  return entries;
}

/** Totals per phase, in the order of the plan, « hors plan » last. */
export function totalsByPhase(entries: readonly LogEntry[]): PhaseTotal[] {
  const totals = new Map<string, PhaseTotal>();
  for (const entry of entries) {
    const total = totals.get(entry.phase) ?? {
      phase: entry.phase,
      name: PHASES[entry.phase] ?? "Sessions hors des étapes du plan",
      sessions: 0,
      minutes: 0,
      costEur: 0,
      steps: [],
      unreadable: [],
    };
    total.sessions += 1;
    total.minutes += entry.minutes ?? 0;
    total.costEur += entry.costEur ?? 0;
    if (!total.steps.includes(entry.step)) total.steps.push(entry.step);
    if (entry.minutes === null || entry.costEur === null) total.unreadable.push(entry.step);
    totals.set(entry.phase, total);
  }
  const rank = (phase: string) => (phase === OUTSIDE_PLAN ? Infinity : Number(phase));
  return [...totals.values()].sort((a, b) => rank(a.phase) - rank(b.phase));
}

/** 75 → « 1 h 15 », 45 → « 45 min ». */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function renderReport(totals: readonly PhaseTotal[]): string {
  const lines = [
    "| Phase | Sessions | Temps | Coût LLM | Étapes |",
    "| --- | --- | --- | --- | --- |",
    ...totals.map(
      (t) =>
        `| ${t.phase === OUTSIDE_PLAN ? "Hors plan" : `${t.phase}. ${t.name}`} | ${t.sessions} | ` +
        `${formatMinutes(t.minutes)} | ${euros(t.costEur)} | ${t.steps.join(", ")} |`,
    ),
    `| **Total** | ${totals.reduce((s, t) => s + t.sessions, 0)} | ` +
      `**${formatMinutes(totals.reduce((s, t) => s + t.minutes, 0))}** | ` +
      `**${euros(totals.reduce((s, t) => s + t.costEur, 0))}** | |`,
  ];
  const unreadable = totals.flatMap((t) => t.unreadable);
  if (unreadable.length)
    lines.push("", `Durée ou coût illisible (non compté) : ${unreadable.join(", ")}.`);
  lines.push(
    "",
    "Temps : colonne « durée » du journal (temps de session noté), à défaut fin − début. " +
      "Coût : colonne « coût LLM » (les « ~ » sont des estimations de session).",
  );
  return lines.join("\n");
}

function main() {
  const file = process.argv[2] ?? DEFAULT_LOG;
  console.log(renderReport(totalsByPhase(parseBuildLog(readFileSync(file, "utf8")))));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
