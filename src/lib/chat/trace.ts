// Small readings of a turn's live trace (PLAN 4.2). Pure.

/** Skills a tool loads by itself (its own prompt), shown in the trace like load_skill's. */
export const TOOL_SKILLS: Record<string, readonly string[]> = {
  estimate_complexity: ["estimation"],
  draft_backlog_items: ["backlog-format", "user-story", "estimation"],
  update_backlog_item: ["backlog-format", "user-story"],
};

/** Skills loaded during a turn: load_skill's arguments, then the skills of the tools called. */
export function loadedSkills(tools: readonly { name: string; args: string }[]): string[] {
  const names = tools
    .filter((t) => t.name === "load_skill")
    .map((t) => {
      try {
        const name = (JSON.parse(t.args) as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      } catch {
        return null;
      }
    })
    .filter((name): name is string => name !== null);
  return [...new Set([...names, ...tools.flatMap((t) => TOOL_SKILLS[t.name] ?? [])])];
}

/** « 850 ms », « 12,4 s », « 1 min 05 s ». */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}
