// Seeds Supabase with the versioned data: customers and prospects, reference tickets (with the
// embedding of « title — description ») and the development feedbacks. Idempotent: upsert by id,
// embeddings recomputed only for new or edited tickets. Dates are computed from DEMO_NOW
// (renewals, deliveries, receptions). The holdout set is never inserted (SPEC §5.5).
// Usage: pnpm db:seed
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Database } from "@/lib/db/types";
import { getScriptDb, type Db } from "@/lib/db/script-client";
import { addDays, getDemoNow, toIsoDate } from "@/lib/demo-now";
import { embed } from "@/lib/embeddings";
import { ticketEmbeddingText } from "@/lib/estimation/reference";
import { RunCost } from "@/lib/llm/cost";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";
import { CUSTOMERS_FILE, type CustomerRow } from "./generate-customers";
import { FEEDBACK_FILES, feedbackSchema, type Feedback } from "./lib/feedbacks";
import { createRandom } from "./lib/random";
import { parseCsv } from "./lib/csv";
import {
  REFERENCE_TICKETS_FILE,
  referenceTicketsSchema,
  type ReferenceTicket,
} from "./lib/reference-tickets";

type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
type TicketInsert = Database["public"]["Tables"]["reference_tickets"]["Insert"];
type FeedbackInsert = Database["public"]["Tables"]["feedbacks"]["Insert"];

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

export { ticketEmbeddingText };

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

/** Offset of Europe/Paris from UTC, in minutes, at a given instant (CET +60, CEST +120). */
export function parisOffsetMinutes(date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/**
 * received_at = DEMO_NOW − days_ago, at an office hour in Paris (8:30 to 18:30), stable for a given
 * feedback. A feedback of the day never lands in the future: it falls a few minutes to hours ago.
 */
export function receivedAt(id: string, daysAgo: number, now: Date): Date {
  const random = createRandom([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const minutes = 8 * 60 + 30 + random.int(0, 600);
  const day = addDays(now, -daysAgo);
  const offset = parisOffsetMinutes(day);
  // Paris wall-clock date of that instant, then its midnight expressed in UTC.
  const parisDay = new Date(day.getTime() + offset * 60000);
  const midnight =
    Date.UTC(parisDay.getUTCFullYear(), parisDay.getUTCMonth(), parisDay.getUTCDate()) -
    offset * 60000;
  const at = new Date(midnight + minutes * 60000);
  return at > now ? new Date(now.getTime() - random.int(5, 240) * 60000) : at;
}

// Only connected users (in-app comments, NPS answers) come with a known account (SPEC §4.2).
// E-mails, tickets and internal notes arrive without one: the enrich node links them. The planned
// account stays in data/feedbacks.json to measure the linking. The language is set by the triage.
const CONNECTED_CHANNELS = new Set<Feedback["channel"]>(["commentaire_in_app", "nps"]);

export function feedbackRows(feedbacks: Feedback[], now: Date): FeedbackInsert[] {
  return feedbacks.map((f) => ({
    id: f.id,
    channel: f.channel,
    source_type: f.source_type,
    author_name: f.author_name,
    author_email: f.author_email,
    customer_id: CONNECTED_CHANNELS.has(f.channel) ? f.customer_id : null,
    received_at: receivedAt(f.id, f.days_ago, now).toISOString(),
    subject: f.subject,
    raw_text: f.raw_text,
    nps_score: f.nps_score,
  }));
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

async function seedFeedbacks(db: Db, now: Date) {
  const feedbacks = feedbackSchema
    .array()
    .parse(JSON.parse(readFileSync(FEEDBACK_FILES.development.data, "utf8")));
  const rows = feedbackRows(feedbacks, now);
  for (let i = 0; i < rows.length; i += 100) {
    await check(
      "feedbacks",
      db.from("feedbacks").upsert(rows.slice(i, i + 100), { onConflict: "id" }),
    );
  }
  await check("feedbacks sequence", db.rpc("sync_id_sequence", { entity: "feedbacks" }));
  return rows.length;
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  initTracing();
  const db = getScriptDb();
  const now = getDemoNow();
  const runCost = new RunCost();

  const customers = await seedCustomers(db, now);
  const tickets = await seedTickets(db, now, runCost);
  const feedbacks = existsSync(FEEDBACK_FILES.development.data) ? await seedFeedbacks(db, now) : 0;

  const [
    { count: customerCount },
    { count: ticketCount },
    { count: missing },
    { count: feedbackCount },
  ] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }),
    db.from("reference_tickets").select("id", { count: "exact", head: true }),
    db.from("reference_tickets").select("id", { count: "exact", head: true }).is("embedding", null),
    db.from("feedbacks").select("id", { count: "exact", head: true }),
  ]);
  console.log(`DEMO_NOW : ${now.toISOString()}`);
  console.log(`Clients et prospects : ${customers} upserts, ${customerCount} en base.`);
  console.log(
    `Tickets de référence : ${tickets.total} upserts, ${tickets.embedded} embeddings calculés, ${ticketCount} en base, ${missing} sans embedding.`,
  );
  console.log(`Retours : ${feedbacks} upserts, ${feedbackCount} en base.`);
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
