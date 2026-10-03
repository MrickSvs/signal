// Seeds Supabase with the versioned data: customers and prospects, reference tickets (with the
// embedding of « title — description »). Idempotent: upsert by id, embeddings recomputed only for
// new or edited tickets. Dates are computed from DEMO_NOW (renewals, deliveries).
// Usage: pnpm db:seed
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Database } from "@/lib/db/types";
import { getScriptDb, type Db } from "@/lib/db/script-client";
import { addDays, getDemoNow, toIsoDate } from "@/lib/demo-now";
import { embed } from "@/lib/embeddings";
import { RunCost } from "@/lib/llm/cost";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";
import { CUSTOMERS_FILE, type CustomerRow } from "./generate-customers";
import { parseCsv } from "./lib/csv";
import {
  REFERENCE_TICKETS_FILE,
  referenceTicketsSchema,
  type ReferenceTicket,
} from "./lib/reference-tickets";

type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type TicketInsert = Database["public"]["Tables"]["reference_tickets"]["Insert"];

const orNull = (value: string) => (value === "" ? null : value);
const intOrNull = (value: string) => (value === "" ? null : Number.parseInt(value, 10));

/** CSV rows of data/customers.csv → customers rows, renewal_in_days turned into a date. */
export function customerRows(csv: Record<string, string>[], now: Date): CustomerInsert[] {
  return csv.map((r) => {
    const renewal = intOrNull(r.renewal_in_days);
    return {
      id: r.id,
      name: r.name,
      status: r.status as CustomerRow["status"],
      segment: r.segment as CustomerRow["segment"],
      plan: orNull(r.plan) as CustomerRow["plan"],
      seats: intOrNull(r.seats),
      mrr_eur: Number(r.mrr_eur),
      renewal_date: renewal === null ? null : toIsoDate(addDays(now, renewal)),
      health: orNull(r.health) as CustomerRow["health"],
      csm: orNull(r.csm),
      email_domain: r.email_domain,
    };
  });
}

/** Text embedded for the semantic search of analogues (SPEC §8.4). */
export const ticketEmbeddingText = (t: Pick<ReferenceTicket, "title" | "description">) =>
  `${t.title} — ${t.description}`;

export function ticketRows(tickets: ReferenceTicket[], now: Date): TicketInsert[] {
  return tickets.map(({ shipped_days_ago, ...t }) => ({
    ...t,
    shipped_at: toIsoDate(addDays(now, -shipped_days_ago)),
  }));
}

/** Tickets whose embedding is missing or whose text changed since the last seed. */
export function ticketsToEmbed(
  tickets: Pick<ReferenceTicket, "id" | "title" | "description">[],
  existing: { id: string; title: string; description: string; has_embedding: boolean }[],
): string[] {
  const current = new Map(existing.map((e) => [e.id, e]));
  return tickets
    .filter((t) => {
      const e = current.get(t.id);
      return !e || !e.has_embedding || e.title !== t.title || e.description !== t.description;
    })
    .map((t) => t.id);
}

async function check<T>(
  label: string,
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label} : ${JSON.stringify(error)}`);
  return data;
}

async function seedCustomers(db: Db, now: Date) {
  const rows = customerRows(parseCsv(readFileSync(CUSTOMERS_FILE, "utf8")), now);
  await check("customers", db.from("customers").upsert(rows, { onConflict: "id" }));
  await check("customers sequence", db.rpc("sync_id_sequence", { entity: "customers" }));
  return rows.length;
}

async function seedTickets(db: Db, now: Date, runCost: RunCost) {
  const tickets = referenceTicketsSchema.parse(
    JSON.parse(readFileSync(REFERENCE_TICKETS_FILE, "utf8")),
  );
  const existing = await check(
    "reference_tickets (lecture)",
    db.from("reference_tickets").select("id, title, description, embedding"),
  );
  const toEmbed = new Set(
    ticketsToEmbed(
      tickets,
      (existing ?? []).map((e) => ({ ...e, has_embedding: e.embedding !== null })),
    ),
  );

  const rows = ticketRows(tickets, now);
  const fresh = rows.filter((r) => toEmbed.has(r.id!));
  const vectors = await embed(fresh.map(ticketEmbeddingText), "document", { runCost });
  const withEmbedding = fresh.map((r, i) => ({ ...r, embedding: JSON.stringify(vectors[i]) }));
  // Two upserts: an upsert only writes the columns it receives, so unchanged tickets keep their embedding.
  if (withEmbedding.length > 0) {
    await check(
      "reference_tickets",
      db.from("reference_tickets").upsert(withEmbedding, { onConflict: "id" }),
    );
  }
  const unchanged = rows.filter((r) => !toEmbed.has(r.id!));
  if (unchanged.length > 0) {
    await check(
      "reference_tickets",
      db.from("reference_tickets").upsert(unchanged, { onConflict: "id" }),
    );
  }
  await check(
    "reference_tickets sequence",
    db.rpc("sync_id_sequence", { entity: "reference_tickets" }),
  );
  return { total: rows.length, embedded: fresh.length };
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  initTracing();
  const db = getScriptDb();
  const now = getDemoNow();
  const runCost = new RunCost();

  const customers = await seedCustomers(db, now);
  const tickets = await seedTickets(db, now, runCost);

  const [{ count: customerCount }, { count: ticketCount }, { count: missing }] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }),
    db.from("reference_tickets").select("id", { count: "exact", head: true }),
    db.from("reference_tickets").select("id", { count: "exact", head: true }).is("embedding", null),
  ]);
  console.log(`DEMO_NOW : ${now.toISOString()}`);
  console.log(`Clients et prospects : ${customers} upserts, ${customerCount} en base.`);
  console.log(
    `Tickets de référence : ${tickets.total} upserts, ${tickets.embedded} embeddings calculés, ${ticketCount} en base, ${missing} sans embedding.`,
  );
  console.log(`Coût : ${runCost.eur.toFixed(5)} €`);
  await shutdownTracing();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
