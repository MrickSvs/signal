// Reading a stored digest (digests.content, written by pipeline/nodes/digest.ts) for the Digest
// screen (SPEC §12.2). The content was validated when it was written; this only normalizes the
// versions written before a field existed, so an old digest still renders.
import type { DigestFacts, DigestWriting } from "@/pipeline/nodes/digest";

export type Recommendation = DigestWriting["recommandations"][number];

export type DigestContent = {
  facts: DigestFacts;
  writing: DigestWriting;
  writer: "modele" | "repli";
  error: string | null;
  /** Model that wrote the digest; null for a plain rendering of the facts (« repli »). */
  model: string | null;
};

type StoredRecommendation = Partial<Recommendation> & { action?: string };

/**
 * Before step 3.2 a recommendation was a single `action` line: it becomes the title, without a
 * separate justification. Digests written before the model was stored get `fallbackModel`.
 */
export function readDigestContent(raw: unknown, fallbackModel: string): DigestContent {
  const content = raw as {
    facts: DigestFacts;
    writing: Omit<DigestWriting, "recommandations"> & { recommandations?: StoredRecommendation[] };
    writer?: "modele" | "repli";
    error?: string | null;
    model?: string | null;
  };
  if (!content?.facts || !content?.writing) throw new Error("Digest illisible : faits manquants.");
  const writer = content.writer ?? "modele";
  return {
    facts: content.facts,
    writing: {
      ...content.writing,
      recommandations: (content.writing.recommandations ?? []).map((r) => ({
        titre: r.titre ?? r.action ?? "",
        justification: r.justification ?? "",
        preuves: r.preuves ?? [],
        confiance: r.confiance ?? "moyenne",
      })),
    },
    writer,
    error: content.error ?? null,
    model: writer === "repli" ? null : (content.model ?? fallbackModel),
  };
}

/** Readable ids a text cites (R-042, R-042.1, I-03, C-007, D-012, US-001, BUG-001, TT-001, E-01). */
export const READABLE_ID =
  /\b(?:R-\d{3,}(?:\.\d)?|I-\d{2,}|C-\d{3,}|D-\d{3,}|US-\d{3,}|BUG-\d{3,}|TT-\d{3,}|E-\d{2,})\b/g;

export type TextPart = { kind: "text"; value: string } | { kind: "id"; value: string };

/** Splits a text around its readable ids, so the UI turns each id into a clickable chip. */
export function splitIds(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(READABLE_ID)) {
    const at = match.index;
    if (at > last) parts.push({ kind: "text", value: text.slice(last, at) });
    parts.push({ kind: "id", value: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export type MarkdownBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string }
  | { kind: "paragraph"; text: string };

/**
 * The small Markdown subset the digest uses (« ## » headings, « - » and « 1. » items, paragraphs).
 * Rendered as text, never as HTML: titles and dossiers come from data.
 */
export function parseDigestMarkdown(markdown: string): MarkdownBlock[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): MarkdownBlock => {
      if (line.startsWith("#")) return { kind: "heading", text: line.replace(/^#+\s*/, "") };
      if (/^(?:[-*]|\d+\.)\s/.test(line))
        return { kind: "item", text: line.replace(/^(?:[-*]|\d+\.)\s+/, "") };
      return { kind: "paragraph", text: line };
    });
}

export type PendingDecision = {
  key: string;
  label: string;
  /** Where the PO handles it (SPEC §12.2). */
  href: string;
  action: string;
  /** Ids to show as chips, in reading order. */
  ids: string[];
  /** For merges and splits: « I-02 a absorbé I-05 » (CL-15). */
  relation?: { left: string; verb: string; right: string };
  /** Override parameter whose context changed. */
  param?: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Pending decisions of a digest, each with a link to the screen where it is handled. */
export function pendingDecisions(pending: DigestFacts["pending"]): PendingDecision[] {
  const rows: PendingDecision[] = [];
  if (pending.insights_to_validate.length)
    rows.push({
      key: "insights",
      label: `${plural(pending.insights_to_validate.length, "insight", "insights")} à valider`,
      href: "/insights?statut=propose",
      action: "Revue en lot",
      ids: pending.insights_to_validate,
    });
  if (pending.backlog_to_validate.length)
    rows.push({
      key: "backlog",
      label: `${plural(pending.backlog_to_validate.length, "élément", "éléments")} du backlog à valider`,
      href: "/backlog?statut=brouillon",
      action: "Ouvrir le backlog",
      ids: pending.backlog_to_validate,
    });
  if (pending.notion_conflicts.length)
    rows.push({
      key: "notion",
      label: `${plural(pending.notion_conflicts.length, "conflit", "conflits")} Notion`,
      href: "/backlog?conflits=notion",
      action: "Résoudre",
      ids: pending.notion_conflicts,
    });
  for (const m of pending.merges)
    rows.push({
      key: `fusion-${m.from}-${m.into}`,
      label: "Fusion d'insights",
      href: `/insights/${m.into}`,
      action: "Vérifier",
      ids: [m.into, m.from],
      relation: { left: m.into, verb: "a absorbé", right: m.from },
    });
  for (const s of pending.splits)
    rows.push({
      key: `scission-${s.from}-${s.into}`,
      label: "Scission d'insight",
      href: `/insights/${s.into}`,
      action: "Vérifier",
      ids: [s.into, s.from],
      relation: { left: s.into, verb: "détaché de", right: s.from },
    });
  for (const o of pending.overrides_context_changed)
    rows.push({
      key: `override-${o.insight_id}-${o.param}`,
      label: "Override au contexte modifié",
      href: `/priorisation?insight=${o.insight_id}`,
      action: "Revoir l'override",
      ids: [o.insight_id],
      param: o.param,
    });
  return rows;
}
