// Small async helpers for batch work (pipeline nodes): bounded concurrency and retries with backoff.

/** Maps over `items` with at most `concurrency` calls in flight; results keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`mapWithConcurrency: concurrence invalide (${concurrency})`);
  }
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export type BackoffOptions = {
  /** Total number of attempts, the first one included. */
  attempts: number;
  /** Delay before the second attempt; doubles at each new attempt. */
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries `fn` with exponential backoff while `shouldRetry(error)` holds; rethrows the last error. */
export async function withBackoff<T>(fn: () => Promise<T>, options: BackoffOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.attempts || !options.shouldRetry(error)) throw error;
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
