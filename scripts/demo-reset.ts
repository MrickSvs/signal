// Demo reset (PLAN 8.1, ADR-032, CL-46): puts the base back in the state of data/demo-snapshot/,
// dates moved so that the scenario looks fresh, in less than 2 minutes and without any model call.
// 1. Notion: the Backlog pages created since the snapshot (rehearsals) go to the trash; the pages
//    of the snapshot are kept, and taken out of the trash on restore.
// 2. Everything the pipeline, the PO and the agent produced is deleted (customers, reference
//    tickets, evals and Notion sync state are kept), chat threads and digests included.
// 3. The snapshot is restored (customers upserted), unless --empty: then the app is empty, to show
//    its empty states before restoring.
// The digest is not restored: it is generated live afterwards (pnpm digest).
// Usage: pnpm demo:reset [--empty]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDemoNow } from "@/lib/demo-now";
import { getScriptDb, type Db } from "@/lib/db/script-client";
import { notionClient, notionConfig, notionErrorMessage } from "@/services/notion/client";
import {
  computeShifts,
  DEFERRED,
  insertableRow,
  pagesToTrash,
  RESET_TABLES,
  shiftRow,
  SNAPSHOT_TABLES,
  type Row,
  type SnapshotMeta,
  type SnapshotTable,
} from "./lib/demo";
import { readTable, SNAPSHOT_DIR } from "./demo-snapshot";

const CHUNK = 100;

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), "utf8")) as T;
}

function notionOrWarn(what: string): ReturnType<typeof notionClient> | null {
  try {
    return notionClient(notionConfig());
  } catch (error) {
    console.warn(`Notion ignoré (${notionErrorMessage(error)}) : ${what} à la main.`);
    return null;
  }
}

/** Moves pages to the trash (rehearsals) or out of it (pages of the snapshot, trashed by an
 * earlier --empty). A page that fails is reported, never blocking. */
async function setTrashed(pageIds: string[], inTrash: boolean): Promise<void> {
  if (pageIds.length === 0) return;
  const what = inTrash
    ? "page(s) de répétition à la corbeille"
    : "page(s) du snapshot restaurée(s)";
  const client = notionOrWarn(`${pageIds.length} ${what}`);
  if (!client) return;
  let done = 0;
  for (const pageId of pageIds) {
    try {
      await client.pages.update({ page_id: pageId, in_trash: inTrash });
      done++;
    } catch (error) {
      console.warn(`Notion : page ${pageId} (${notionErrorMessage(error)}).`);
    }
  }
  console.log(`Notion : ${done}/${pageIds.length} ${what}.`);
}

async function clearBase(db: Db): Promise<void> {
  const { error } = await db
    .from("po_state")
    .update({ last_digest_id: null, last_seen_at: null })
    .eq("id", true);
  if (error) throw new Error(`po_state (${error.message})`);
  for (const [table, column] of RESET_TABLES) {
    const { error: deleteError } = await db.from(table).delete().not(column, "is", null);
    if (deleteError) throw new Error(`Suppression de ${table} (${deleteError.message})`);
  }
}

async function restore(db: Db, tables: Record<SnapshotTable, Row[]>): Promise<void> {
  for (const table of SNAPSHOT_TABLES) {
    const rows = tables[table].map((r) => insertableRow(table, r));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK) as never[];
      const { error } =
        table === "customers"
          ? await db.from(table).upsert(batch)
          : await db.from(table).insert(batch);
      if (error) throw new Error(`Restauration de ${table} (${error.message})`);
    }
  }
  // Self and circular references, once every table is in.
  for (const table of SNAPSHOT_TABLES) {
    const deferred = DEFERRED[table];
    if (!deferred) continue;
    for (const row of tables[table]) {
      if (row[deferred.column] === null || row[deferred.column] === undefined) continue;
      const { error } = await db
        .from(table)
        .update({ [deferred.column]: row[deferred.column] } as never)
        .eq(deferred.key, row[deferred.key] as string);
      if (error) throw new Error(`Restauration de ${table}.${deferred.column} (${error.message})`);
    }
  }
  // Ids are never reused (SPEC §7): the feedback sequence never falls behind the restored ids.
  const { error } = await db.rpc("sync_id_sequence", { entity: "feedbacks" });
  if (error) throw new Error(`Séquence des retours (${error.message})`);
}

async function main() {
  const started = Date.now();
  const empty = process.argv.includes("--empty");
  if (!empty && !existsSync(join(SNAPSHOT_DIR, "meta.json"))) {
    throw new Error("Pas de snapshot : lance d'abord pnpm demo:snapshot --keep-backlog I-xx.");
  }
  const db = getScriptDb();
  const meta = empty ? null : readJson<SnapshotMeta>("meta.json");
  // The pages of the snapshot are never trashed, not even by --empty: the restore needs them.
  const snapshotLinks = existsSync(join(SNAPSHOT_DIR, "notion_links.json"))
    ? readJson<Row[]>("notion_links.json")
    : [];
  const snapshot = {} as Record<SnapshotTable, Row[]>;
  if (meta) {
    const shifts = computeShifts(meta, getDemoNow());
    for (const table of SNAPSHOT_TABLES) {
      snapshot[table] = readJson<Row[]>(`${table}.json`).map((r) => shiftRow(table, r, shifts));
    }
  }

  await setTrashed(pagesToTrash(await readTable(db, "notion_links"), snapshotLinks), true);
  await clearBase(db);
  if (meta) {
    await restore(db, snapshot);
    await setTrashed(
      snapshotLinks.map((l) => String(l.notion_page_id)),
      false,
    );
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  if (meta) {
    console.log(
      `Snapshot restauré en ${seconds} s : ${snapshot.feedbacks.length} retours, ${snapshot.insights.length} insights, ` +
        `${snapshot.backlog_items.length} éléments de backlog (${meta.kept_backlog.join(", ") || "aucun"}).`,
    );
    console.log("Ensuite : pnpm digest (le digest du matin, généré en direct).");
  } else {
    console.log(
      `Base vidée en ${seconds} s (clients et tickets de référence conservés). Restaurer : pnpm demo:reset`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
