import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { beforeAll, describe, expect, it } from "vitest";

// Applies the real migrations, in order, to an in-memory Postgres (no network, no Docker).
// Supabase-provided objects (roles, extensions schema, storage.buckets) are stubbed.
const SUPABASE_STUBS = `
  create schema extensions;
  create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
`;

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));

let db: PGlite;

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

const insertFeedback = () =>
  one<{ id: string }>(
    `insert into feedbacks (channel, source_type, received_at, raw_text)
     values ('email_client', 'client_direct', now(), 'texte') returning id`,
  );

const insertInsight = () =>
  one<{ id: string }>(
    `insert into insights (title, problem_statement) values ('t', 'p') returning id`,
  );

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(SUPABASE_STUBS);
  for (const migration of migrations) await db.exec(migration);
  await db.exec("set search_path = public, extensions");
}, 60_000);

describe("readable ids", () => {
  it("numbers feedbacks R-001, R-002… and never reuses an id", async () => {
    const a = await insertFeedback();
    const b = await insertFeedback();
    expect(a.id).toBe("R-001");
    expect(b.id).toBe("R-002");
    await db.query("delete from feedbacks where id = $1", [b.id]);
    expect((await insertFeedback()).id).toBe("R-003");
  });

  it("derives item ids from the feedback id (R-001.1)", async () => {
    const item = await one<{ id: string }>(
      `insert into feedback_items (feedback_id, item_index, type, product_area, underlying_problem, summary)
       values ('R-001', 2, 'bug', 'notifications', 'p', 's') returning id`,
    );
    expect(item.id).toBe("R-001.2");
  });

  it("uses the width of each entity and does not truncate past it", async () => {
    expect((await insertInsight()).id).toBe("I-01");
    const epic = await one<{ id: string }>(
      `insert into epics (insight_id, title) values ('I-01', 'e') returning id`,
    );
    expect(epic.id).toBe("E-01");
    const decision = await one<{ id: string }>(
      `insert into decisions (actor, source, entity_type, entity_id, action)
       values ('po', 'signal_ui', 'insight', 'I-01', 'validation') returning id`,
    );
    expect(decision.id).toBe("D-001");
    const customer = await one<{ id: string }>(
      `insert into customers (name, segment, plan) values ('Atelier', 'agence_com', 'pro') returning id`,
    );
    expect(customer.id).toBe("C-001");
    const big = await one<{ id: string }>(`select format_readable_id('R', 1000, 3) as id`);
    expect(big.id).toBe("R-1000");
  });

  it("starts reference tickets at T-101", async () => {
    const ticket = await one<{ id: string }>(
      `insert into reference_tickets (title, description, module, estimated_points, actual_points)
       values ('t', 'd', 'permissions', 3, 5) returning id`,
    );
    expect(ticket.id).toBe("T-101");
  });

  it("numbers backlog items per kind (US, BUG, TT)", async () => {
    const ids = [];
    for (const kind of ["story", "story", "bug", "tache"]) {
      ids.push(
        (
          await one<{ id: string }>(
            `insert into backlog_items (kind, title) values ($1, 'x') returning id`,
            [kind],
          )
        ).id,
      );
    }
    expect(ids).toEqual(["US-001", "US-002", "BUG-001", "TT-001"]);
  });
});

describe("constraints", () => {
  it("refuses a bug attached to an epic", async () => {
    await expect(
      db.query(`insert into backlog_items (kind, title, epic_id) values ('bug', 'x', 'E-01')`),
    ).rejects.toThrow();
  });

  it("requires a reason on every override except moscow", async () => {
    await expect(
      db.query(`insert into overrides (insight_id, param, value) values ('I-01', 'impact', '2')`),
    ).rejects.toThrow();
    await db.query(
      `insert into overrides (insight_id, param, value) values ('I-01', 'moscow', '"must"')`,
    );
  });

  it("keeps a single current score per insight", async () => {
    const insert = (version: number) =>
      db.query(
        `insert into scores (insight_id, version, reach_mode, reach, impact, confidence, effort_weeks, effort_source, rice)
         values ('I-01', $1, 'comptes', 10, 2, 0.8, 2, 'estimation_initiale', 8)`,
        [version],
      );
    await insert(1);
    await expect(insert(2)).rejects.toThrow();
  });

  it("keeps po_state to a single row", async () => {
    await expect(db.query(`insert into po_state (id) values (false)`)).rejects.toThrow();
    expect((await one<{ n: number }>(`select count(*)::int as n from po_state`)).n).toBe(1);
  });
});

describe("vectors, access and storage", () => {
  it("stores 1024-dimension embeddings and ranks by cosine distance", async () => {
    const vec = (first: number) => `[${[first, ...Array(1023).fill(0.01)].join(",")}]`;
    await db.query(`update feedback_items set embedding = $1::vector where id = 'R-001.2'`, [
      vec(1),
    ]);
    const row = await one<{ distance: number }>(
      `select embedding <=> $1::vector as distance from feedback_items where id = 'R-001.2'`,
      [vec(1)],
    );
    expect(row.distance).toBeCloseTo(0, 5);
    await expect(
      db.query(`update feedback_items set embedding = '[1,2,3]' where id = 'R-001.2'`),
    ).rejects.toThrow();
  });

  it("enables RLS on every public table", async () => {
    const rows = (
      await db.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      )
    ).rows;
    expect(rows).toEqual([]);
  });

  it("creates a private prototypes bucket", async () => {
    const bucket = await one<{ public: boolean }>(
      `select public from storage.buckets where id = 'prototypes'`,
    );
    expect(bucket.public).toBe(false);
  });
});

describe("sync_id_sequence", () => {
  const ticket = (id: string | null) =>
    one<{ id: string }>(
      `insert into reference_tickets (${id ? "id, " : ""}title, description, module, estimated_points, actual_points)
       values (${id ? `'${id}', ` : ""}'t', 'd', 'export', 2, 3) returning id`,
    );
  const sync = async (entity: string) =>
    Number((await one<{ n: string }>(`select sync_id_sequence($1) as n`, [entity])).n);

  it("moves the sequence past seeded ids, so the next generated id does not collide", async () => {
    // T-101 already exists (generated by an earlier test).
    await ticket("T-140");
    expect(await sync("reference_tickets")).toBe(140);
    expect((await ticket(null)).id).toBe("T-141");
  });

  it("never moves a sequence backwards", async () => {
    await db.query(`delete from reference_tickets where id in ('T-140', 'T-141')`);
    expect(await sync("reference_tickets")).toBe(141);
    expect((await ticket(null)).id).toBe("T-142");
  });

  it("handles customers and rejects an unknown entity", async () => {
    await db.query(`insert into customers (id, name, segment) values ('C-095', 'Seed', 'conseil')`);
    expect(await sync("customers")).toBe(95);
    await expect(sync("insights")).rejects.toThrow(/unknown entity/);
  });
});
