import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, withBackoff } from "./async";

describe("mapWithConcurrency", () => {
  it("keeps the input order and never exceeds the concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it("handles an empty list and rejects an invalid concurrency", async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(/concurrence/);
  });
});

describe("withBackoff", () => {
  it("retries with doubling delays, then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("529"))
      .mockResolvedValueOnce("ok");
    const result = await withBackoff(fn, {
      attempts: 3,
      baseDelayMs: 100,
      shouldRetry: () => true,
      sleep,
    });
    expect(result).toBe("ok");
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("does not retry when shouldRetry is false and stops after the last attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fatal = vi.fn().mockRejectedValue(new Error("invalid"));
    await expect(
      withBackoff(fatal, { attempts: 3, baseDelayMs: 1, shouldRetry: () => false, sleep }),
    ).rejects.toThrow("invalid");
    expect(fatal).toHaveBeenCalledTimes(1);

    const flaky = vi.fn().mockRejectedValue(new Error("down"));
    await expect(
      withBackoff(flaky, { attempts: 2, baseDelayMs: 1, shouldRetry: () => true, sleep }),
    ).rejects.toThrow("down");
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
