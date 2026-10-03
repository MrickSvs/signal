// Pipeline lock (SPEC §6.1 « Robustesse », CL-12): a Postgres session advisory lock held for the
// whole run, on a dedicated connection (PostgREST requests are pooled and cannot hold one).
// A second run polls for at most 30 s, then gives up cleanly with « run en cours ».
// DATABASE_URL must be a session connection (direct or session pooler, port 5432): the transaction
// pooler (6543) does not keep session locks.
import pg from "pg";

/** Arbitrary but fixed: every Signal pipeline run (full or incremental) shares this key. */
export const PIPELINE_LOCK_KEY = 2_026_100_206;
export const DEFAULT_LOCK_WAIT_MS = 30_000;
const POLL_MS = 1_000;

export class PipelineBusyError extends Error {
  constructor() {
    super("Run en cours, réessaie dans un instant.");
    this.name = "PipelineBusyError";
  }
}

/** One session that can try, then release, the advisory lock. */
export type LockSession = {
  tryLock(key: number): Promise<boolean>;
  unlock(key: number): Promise<void>;
  close(): Promise<void>;
};

export type LockOptions = {
  waitMs?: number;
  pollMs?: number;
  /** Injected in tests: no database there (CLAUDE.md rule 11). */
  openSession?: () => Promise<LockSession>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function openPgLockSession(
  connectionString = process.env.DATABASE_URL,
): Promise<LockSession> {
  if (!connectionString) throw new Error("DATABASE_URL doit être définie (verrou du pipeline).");
  const client = new pg.Client({ connectionString });
  await client.connect();
  return {
    async tryLock(key) {
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [key],
      );
      return rows[0]?.locked === true;
    },
    async unlock(key) {
      await client.query("select pg_advisory_unlock($1)", [key]);
    },
    close: () => client.end(),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn` while holding the pipeline lock; throws PipelineBusyError after `waitMs`. */
export async function withPipelineLock<T>(
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const session = await (options.openSession ?? openPgLockSession)();
  try {
    const deadline = now() + waitMs;
    while (!(await session.tryLock(PIPELINE_LOCK_KEY))) {
      if (now() >= deadline) throw new PipelineBusyError();
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    }
    try {
      return await fn();
    } finally {
      await session.unlock(PIPELINE_LOCK_KEY);
    }
  } finally {
    // Closing the session also releases the lock if unlock failed (or the process dies).
    await session.close();
  }
}
