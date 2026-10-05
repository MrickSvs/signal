// Small readings of a turn's live trace (PLAN 4.2). Pure.

/** Skills loaded during a turn, from the arguments of its load_skill calls. */
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
  return [...new Set(names)];
}

/** « 850 ms », « 12,4 s », « 1 min 05 s ». */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}
