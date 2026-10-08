// Live log of a digest generation (ADR-044): POST /api/digest streams one JSON object per line,
// read by the Digest screen while the writing runs. Types and parsing only: shared by both sides.
import type { DigestProgress } from "@/pipeline/nodes/digest";

export type DigestDone = {
  id: string;
  writer: "modele" | "repli";
  costEur: number;
  durationMs: number;
};

export type DigestStreamEvent =
  | { type: "progress"; at: number; event: DigestProgress }
  | { type: "done"; result: DigestDone }
  | { type: "error"; message: string };

/** One event per line (NDJSON). */
export function encodeEvent(event: DigestStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits what has arrived so far into whole events; the unfinished last line is returned as the
 * rest, to be prefixed to the next chunk. A line that is not an event is skipped.
 */
export function decodeEvents(buffer: string): { events: DigestStreamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: DigestStreamEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as DigestStreamEvent;
      if (parsed && typeof parsed === "object" && "type" in parsed) events.push(parsed);
    } catch {
      // A broken line is dropped: the final « done » or « error » still ends the log.
    }
  }
  return { events, rest };
}
