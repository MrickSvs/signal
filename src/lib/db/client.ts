import "server-only";
import { createDbClient, type Db } from "./create";

let db: Db | undefined;

/** Server-side Supabase client (service role), shared across requests. */
export function getDb(): Db {
  db ??= createDbClient();
  return db;
}

export type { Db };
