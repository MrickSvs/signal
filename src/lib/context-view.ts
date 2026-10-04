// Read-only views of the context pack for the Context screen (SPEC §12.8): weighting.yaml as
// a table that keeps its comments, and a markdown section extracted by heading.
import { isMap, isScalar, parseDocument, type Node } from "yaml";

export type WeightingRow = {
  /** Second-level key, as written in weighting.yaml. */
  key: string;
  /** Compact rendering of the value (maps and lists on one line). */
  value: string;
  comment: string | null;
};

export type WeightingSection = {
  /** Top-level key (reach, confidence…). */
  key: string;
  comment: string | null;
  rows: WeightingRow[];
};

const clean = (comment: string | null | undefined): string | null => {
  const text = comment
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return text ? text : null;
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${k} ${formatValue(v)}`);
    return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
  }
  return String(value);
}

/** A comment attached to a value: inline after a scalar, or on the line before a collection. */
function valueComment(node: Node | null): string | null {
  if (!node) return null;
  if (isScalar(node)) return clean(node.comment);
  return clean(node.commentBefore) ?? clean(node.comment);
}

/**
 * Flattens weighting.yaml into one section per top-level map and one row per second-level key.
 * Non-map top-level entries (version) are skipped: they are not tuning parameters.
 */
export function weightingSections(source: string): WeightingSection[] {
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new Error(`weighting.yaml: ${doc.errors[0].message}`);
  if (!isMap(doc.contents)) return [];

  return doc.contents.items.flatMap((pair) => {
    if (!isScalar(pair.key) || !isMap(pair.value)) return [];
    const sectionComment = clean(pair.key.commentBefore);
    const rows = pair.value.items.flatMap((item): WeightingRow[] => {
      if (!isScalar(item.key)) return [];
      const valueNode = item.value as Node | null;
      return [
        {
          key: String(item.key.value),
          value: formatValue(valueNode?.toJSON()),
          comment: valueComment(valueNode) ?? clean(item.key.comment),
        },
      ];
    });
    return [{ key: String(pair.key.value), comment: sectionComment, rows }];
  });
}

/** Body of the « ## <heading> » section of a markdown document, without its heading. */
export function markdownSection(markdown: string, heading: string): string | null {
  const section = markdown
    .split(/^## /m)
    .slice(1)
    .find((s) => s.split("\n", 1)[0].trim() === heading);
  if (!section) return null;
  return section.slice(section.indexOf("\n") + 1).trim();
}
