import { describe, expect, it, vi } from "vitest";
import { PIPELINE_LOCK_KEY, PipelineBusyError, withPipelineLock, type LockSession } from "./lock";

/** Fake advisory lock shared by sessions, with a fake clock (no database, CLAUDE.md rule 11). */
function fakeLocks() {
  let holder: object | null = null;
  let clock = 0;
  const sessions: { closed: boolean }[] = [];
  const openSession = async (): Promise<LockSession> => {
    const self = { closed: false };
    sessions.push(self);
    return {
      tryLock: async (key) => {
        expect(key).toBe(PIPELINE_LOCK_KEY);
        if (holder && holder !== self) return false;
        holder = self;
        return true;
      },
      unlock: async () => {
        if (holder === self) holder = null;
      },
      close: async () => {
        self.closed = true;
        if (holder === self) holder = null;
      },
    };
  };
  return {
    openSession,
    sessions,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    get clock() {
      return clock;
    },
  };
}

describe("withPipelineLock (CL-12)", () => {
  it("runs the function under the lock and releases it", async () => {
    const locks = fakeLocks();
    expect(await withPipelineLock(async () => "ok", locks)).toBe("ok");
    expect(await withPipelineLock(async () => "again", locks)).toBe("again");
    expect(locks.sessions.every((s) => s.closed)).toBe(true);
  });

  it("gives up after 30 s with « run en cours » while another run holds the lock", async () => {
    const locks = fakeLocks();
    let release!: () => void;
    const running = withPipelineLock(() => new Promise<void>((r) => (release = r)), locks);
    await vi.waitFor(() => expect(release).toBeDefined());

    await expect(withPipelineLock(async () => "second", locks)).rejects.toBeInstanceOf(
      PipelineBusyError,
    );
    expect(locks.clock).toBe(30_000);
    expect(locks.sessions[1].closed).toBe(true);
    await expect(withPipelineLock(async () => "x", locks)).rejects.toThrow(
      "Run en cours, réessaie dans un instant.",
    );

    release();
    await running;
    expect(await withPipelineLock(async () => "after", locks)).toBe("after");
  });

  it("gets the lock as soon as the other run ends, within the wait", async () => {
    const locks = fakeLocks();
    let release!: () => void;
    const running = withPipelineLock(() => new Promise<void>((r) => (release = r)), locks);
    await vi.waitFor(() => expect(release).toBeDefined());
    const sleep = async (ms: number) => {
      await locks.sleep(ms);
      if (locks.clock >= 5_000) {
        release();
        await running;
      }
    };
    expect(await withPipelineLock(async () => "waited", { ...locks, sleep })).toBe("waited");
    expect(locks.clock).toBe(5_000);
  });

  it("releases the lock when the run throws", async () => {
    const locks = fakeLocks();
    await expect(
      withPipelineLock(async () => {
        throw new Error("boom");
      }, locks),
    ).rejects.toThrow("boom");
    expect(await withPipelineLock(async () => "free", locks)).toBe("free");
  });
});
