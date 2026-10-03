import { startActiveObservation } from "@langfuse/tracing";
import { z } from "zod";
import type { RunCost } from "@/lib/llm/cost";
import { EMBEDDING_MODEL, EMBEDDING_PRICE_USD_PER_MTOK, EUR_PER_USD } from "@/lib/llm/models";

/** Fixed in the migration (vector(1024)); changing it requires a new migration. See ADR-002. */
export const EMBEDDING_DIMENSION = 1024;

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
// voyage-4 accepts 1,000 texts / 320K tokens per request; 128 texts of ≤ 6,000 characters stays far below.
const BATCH_SIZE = 128;
const MAX_ATTEMPTS = 4;

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
  usage: z.object({ total_tokens: z.number().int() }),
});

export type EmbedKind = "document" | "query";

export type EmbedOptions = {
  runCost?: RunCost;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
};

export class EmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}

export function embeddingCostEur(tokens: number): number {
  return (tokens * EMBEDDING_PRICE_USD_PER_MTOK * EUR_PER_USD) / 1_000_000;
}

/** Embeds texts with Voyage ("document" to store, "query" to search), in input order. */
export async function embed(
  texts: string[],
  kind: EmbedKind,
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  return startActiveObservation(
    "embed-texts",
    async (observation) => {
      observation.update({
        model: EMBEDDING_MODEL,
        input: { kind, count: texts.length },
        modelParameters: { input_type: kind, output_dimension: EMBEDDING_DIMENSION },
      });
      const vectors: number[][] = [];
      let tokens = 0;
      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const batch = await embedBatch(texts.slice(start, start + BATCH_SIZE), kind, options);
        vectors.push(...batch.vectors);
        tokens += batch.tokens;
      }
      const eur = embeddingCostEur(tokens);
      options.runCost?.addEur(eur);
      observation.update({
        output: { count: vectors.length, dimension: EMBEDDING_DIMENSION },
        usageDetails: { input: tokens },
        costDetails: { total: eur / EUR_PER_USD },
      });
      return vectors;
    },
    { asType: "embedding" },
  );
}

async function embedBatch(
  texts: string[],
  kind: EmbedKind,
  options: EmbedOptions,
): Promise<{ vectors: number[][]; tokens: number }> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new EmbeddingError("VOYAGE_API_KEY n'est pas définie.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.retryDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: texts,
          model: EMBEDDING_MODEL,
          input_type: kind,
          output_dimension: EMBEDDING_DIMENSION,
        }),
      });
      if (response.ok) {
        const parsed = responseSchema.parse(await response.json());
        const vectors = parsed.data.toSorted((a, b) => a.index - b.index).map((d) => d.embedding);
        if (
          vectors.length !== texts.length ||
          vectors.some((v) => v.length !== EMBEDDING_DIMENSION)
        ) {
          throw new EmbeddingError(
            "Réponse Voyage incohérente (nombre ou dimension des vecteurs).",
          );
        }
        return { vectors, tokens: parsed.usage.total_tokens };
      }
      const body = await response.text();
      lastError = new EmbeddingError(`Voyage ${response.status} : ${body.slice(0, 300)}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      if (error instanceof EmbeddingError || error instanceof z.ZodError) throw error;
      lastError = error; // network error: retry
    }
    if (attempt < MAX_ATTEMPTS) await sleep(delay * 2 ** (attempt - 1));
  }
  throw new EmbeddingError(`Échec de l'embedding après ${MAX_ATTEMPTS} tentatives`, {
    cause: lastError,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
