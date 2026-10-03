import { existsSync } from "node:fs";
import { createDbClient, type Db } from "./create";

let db: Db | undefined;

/** Supabase client for CLI scripts (tsx): loads .env, no "server-only" guard. */
export function getScriptDb(): Db {
  if (!db) {
    if (existsSync(".env")) process.loadEnvFile(".env");
    db = createDbClient();
  }
  return db;
}

export type { Db };
