import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCost } from "@/lib/llm/cost";
import { embed, EMBEDDING_DIMENSION, EmbeddingError } from "./index";

const vector = (seed: number) => Array(EMBEDDING_DIMENSION).fill(seed);

const ok = (texts: string[], tokens = 10) =>
  new Response(
    JSON.stringify({
      // returned out of order on purpose
      data: texts.map((_, index) => ({ embedding: vector(index), index })).reverse(),
      usage: { total_tokens: tokens },
    }),
    { status: 200 },
  );

beforeEach(() => {
  process.env.VOYAGE_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.VOYAGE_API_KEY;
});

describe("embed", () => {
  it("returns vectors in input order and sends the input type", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "voyage-4",
        input_type: "query",
        output_dimension: 1024,
      });
      return ok(body.input);
    });
    const vectors = await embed(["a", "b", "c"], "query", { fetchImpl: fetchImpl as typeof fetch });
    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2]);
  });

  it("splits large inputs into batches and records the cost", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      ok(JSON.parse(String(init?.body)).input, 1000),
    );
    const runCost = new RunCost();
    const texts = Array.from({ length: 300 }, (_, i) => `texte ${i}`);
    const vectors = await embed(texts, "document", {
      fetchImpl: fetchImpl as typeof fetch,
      runCost,
    });
    expect(vectors).toHaveLength(300);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(runCost.eur).toBeGreaterThan(0);
  });

  it("retries on 429 and network errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(async () => ok(["a"]));
    const vectors = await embed(["a"], "document", { fetchImpl, retryDelayMs: 0 });
    expect(vectors).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a client error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(embed(["a"], "document", { fetchImpl, retryDelayMs: 0 })).rejects.toBeInstanceOf(
      EmbeddingError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails without an API key and returns nothing for an empty input", async () => {
    delete process.env.VOYAGE_API_KEY;
    expect(await embed([], "document")).toEqual([]);
    await expect(embed(["a"], "document")).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});
