// Embed node (SPEC §6.1, ADR 010): one vector per item, computed from « underlying problem —
// summary », never from the raw feedback text, so that grouping happens on the problem.
import { mapWithConcurrency } from "@/lib/async";
import type { Db } from "@/lib/db/create";
import type { Tables } from "@/lib/db/types";
import { embed as voyageEmbed } from "@/lib/embeddings";
import type { RunCost } from "@/lib/llm/cost";

/** Items of these types carry no problem to group (praise, usage questions, auto-replies, spam). */
export const NOT_CLUSTERED_TYPES: ReadonlySet<Tables<"feedback_items">["type"]> = new Set([
  "eloge",
  "question",
  "autre",
]);

type ItemText = Pick<Tables<"feedback_items">, "underlying_problem" | "summary">;

export function itemEmbeddingText(item: ItemText): string {
  return `${item.underlying_problem.trim()} — ${item.summary.trim()}`;
}

export function isClusterable(item: Pick<Tables<"feedback_items">, "type">): boolean {
  return !NOT_CLUSTERED_TYPES.has(item.type);
}

/** pgvector columns come back from PostgREST as a « [0.1,0.2,…] » string. */
export function parseVector(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "number")) {
    throw new Error("Vecteur illisible dans la base");
  }
  return parsed as number[];
}

export type EmbedDeps = {
  runCost?: RunCost;
  /** Injected in tests: Voyage is never called there. */
  embedFn?: (texts: string[]) => Promise<number[][]>;
  concurrency?: number;
};

export type EmbedSummary = { embedded: string[] };

/** Embeds every item that has no vector yet (new items, or items rewritten by the triage). */
export async function runEmbed(db: Db, deps: EmbedDeps = {}): Promise<EmbedSummary> {
  const { data, error } = await db
    .from("feedback_items")
    .select("id, underlying_problem, summary")
    .is("embedding", null)
    .order("id");
  if (error) throw new Error(`Embed : lecture des items (${error.message})`);
  if (data.length === 0) return { embedded: [] };

  const embedFn =
    deps.embedFn ??
    ((texts: string[]) => voyageEmbed(texts, "document", { runCost: deps.runCost }));
  const vectors = await embedFn(data.map(itemEmbeddingText));
  if (vectors.length !== data.length) throw new Error("Embed : nombre de vecteurs incohérent");

  await mapWithConcurrency(data, deps.concurrency ?? 8, async (item, i) => {
    const { error: updateError } = await db
      .from("feedback_items")
      .update({ embedding: JSON.stringify(vectors[i]) })
      .eq("id", item.id);
    if (updateError) throw new Error(`Embed : écriture de ${item.id} (${updateError.message})`);
  });
  return { embedded: data.map((d) => d.id) };
}
