// Conversation memory (SPEC §10.8): LangGraph's PostgresSaver in the `langgraph` schema (outside
// PostgREST, ADR-013), over DATABASE_URL — the Supabase pooler in SESSION mode (port 5432): the
// saver's prepared statements and transactions need a session connection, which the transaction
// pooler (6543) does not keep.
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

export const CHECKPOINT_SCHEMA = "langgraph";

const globalState = globalThis as typeof globalThis & {
  __signalCheckpointer?: Promise<PostgresSaver>;
};

/** One saver per process (a serverless instance keeps it across requests); tables set up once. */
export function getCheckpointer(
  connectionString = process.env.DATABASE_URL,
): Promise<PostgresSaver> {
  if (!connectionString)
    throw new Error("DATABASE_URL doit être définie (mémoire des conversations).");
  globalState.__signalCheckpointer ??= (async () => {
    // Small pool: the session pooler has few connections and Vercel runs many instances.
    const pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });
    const saver = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
    await saver.setup();
    return saver;
  })().catch((error) => {
    globalState.__signalCheckpointer = undefined;
    throw error;
  });
  return globalState.__signalCheckpointer;
}
