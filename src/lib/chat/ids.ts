// Readable ids in an agent answer (SPEC §10.7, CL-28): every id is checked against the database
// before it becomes a clickable chip; an id that does not exist shows as « ID inconnu ».
// Pure, shared by the chat panel (client) and the server action that checks them.

/** R-042, R-042.1, I-07, C-012, D-001, E-01, US-001, BUG-001, TT-001 and reference tickets T-101. */
export const CHAT_ID =
  /\b(?:R-\d{3,}(?:\.\d+)?|I-\d{2,}|C-\d{3,}|D-\d{3,}|E-\d{2,}|US-\d{3,}|BUG-\d{3,}|TT-\d{3,}|T-\d{3,})\b/g;

export type IdKind =
  "feedback" | "item" | "insight" | "customer" | "decision" | "epic" | "backlog" | "ticket";

export function idKind(id: string): IdKind {
  if (id.startsWith("R-")) return id.includes(".") ? "item" : "feedback";
  if (id.startsWith("I-")) return "insight";
  if (id.startsWith("C-")) return "customer";
  if (id.startsWith("D-")) return "decision";
  if (id.startsWith("E-")) return "epic";
  if (id.startsWith("T-")) return "ticket";
  return "backlog";
}

/** Distinct ids cited in a text, in order of appearance (at most `max`). */
export function citedIds(text: string, max = 100): string[] {
  return [...new Set(text.match(CHAT_ID) ?? [])].slice(0, max);
}

export const MAX_EXCERPT = 200;

/** The sentence around an id, for the incident journal (bounded, on one line). */
export function excerptAround(text: string, id: string, max = MAX_EXCERPT): string {
  const at = text.indexOf(id);
  if (at === -1) return "";
  const half = Math.floor((max - id.length) / 2);
  const start = Math.max(0, at - half);
  const end = Math.min(text.length, at + id.length + half);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

export type TextPart = { kind: "text"; value: string } | { kind: "id"; value: string };

/** Splits a text around its ids, so the renderer turns each id into a chip. */
export function splitChatIds(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CHAT_ID)) {
    if (match.index > last) parts.push({ kind: "text", value: text.slice(last, match.index) });
    parts.push({ kind: "id", value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}
