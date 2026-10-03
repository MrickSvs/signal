// In-memory stand-in for the Supabase client, for tests only (CLAUDE.md rule 11: tests never
// call a remote database). It covers the query-builder calls the pipeline uses: select with
// eq / in / is / not-is-null / gt / gte / order / range / single, insert (+ select().single()),
// upsert (onConflict), update and delete. Column lists are applied when they are plain (no embedded relations).
import type { Db } from "./create";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

export type MemoryTables = Record<string, Row[]>;

export type MemoryDbOptions = {
  /** Default values filled on insert, per table (e.g. readable ids). */
  defaults?: Record<string, (row: Row, table: Row[]) => Row>;
};

class Query implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private columns: string[] | null = null;
  private wantSingle = false;
  private returning = false;

  constructor(
    private readonly tables: MemoryTables,
    private readonly table: string,
    private readonly options: MemoryDbOptions,
    private readonly action:
      | { kind: "select" }
      | { kind: "insert"; rows: Row[] }
      | { kind: "upsert"; rows: Row[]; onConflict: string[] }
      | { kind: "update"; patch: Row }
      | { kind: "delete" },
  ) {}

  select(columns?: string) {
    if (this.action.kind !== "select") this.returning = true;
    if (columns && !columns.includes("(")) this.columns = columns.split(",").map((c) => c.trim());
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  gt(column: string, value: number) {
    this.filters.push((row) => (row[column] as number) > value);
    return this;
  }
  gte(column: string, value: number | string) {
    this.filters.push((row) => (row[column] as number | string) >= value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  not(column: string, operator: "is", value: null) {
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  limit(n: number) {
    this.window = [0, n - 1];
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private project(row: Row): Row {
    if (!this.columns) return structuredClone(row);
    return Object.fromEntries(this.columns.map((c) => [c, structuredClone(row[c] ?? null)]));
  }

  private run(): Result {
    const rows = (this.tables[this.table] ??= []);
    const matches = (row: Row) => this.filters.every((f) => f(row));
    let out: Row[];
    switch (this.action.kind) {
      case "insert": {
        const defaults = this.options.defaults?.[this.table];
        out = this.action.rows.map((r) => ({ ...(defaults ? defaults(r, rows) : {}), ...r }));
        rows.push(...out.map((r) => structuredClone(r)));
        if (!this.returning) return { data: null, error: null };
        break;
      }
      case "upsert": {
        const { onConflict } = this.action;
        const defaults = this.options.defaults?.[this.table];
        out = this.action.rows.map((r) => {
          const existing = rows.find((row) => onConflict.every((c) => row[c] === r[c]));
          if (existing) return Object.assign(existing, structuredClone(r));
          const created = { ...(defaults ? defaults(r, rows) : {}), ...r };
          rows.push(structuredClone(created));
          return created;
        });
        if (!this.returning) return { data: null, error: null };
        break;
      }
      case "update":
        out = rows.filter(matches);
        for (const row of out) Object.assign(row, structuredClone(this.action.patch));
        if (!this.returning) return { data: null, error: null };
        break;
      case "delete": {
        const kept = rows.filter((r) => !matches(r));
        out = rows.filter(matches);
        this.tables[this.table] = kept;
        if (!this.returning) return { data: null, error: null };
        break;
      }
      default:
        out = rows.filter(matches);
    }
    for (const { column, ascending } of [...this.orders].reverse()) {
      out = out.toSorted((a, b) => {
        const x = String(a[column] ?? "");
        const y = String(b[column] ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    const data = out.map((r) => this.project(r));
    if (this.wantSingle) {
      return data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { message: `${data.length} lignes au lieu d'une` } };
    }
    return { data, error: null };
  }
}

/** Builds a fake Db over plain arrays; `tables` is mutated, so tests can inspect it. */
export function createMemoryDb(tables: MemoryTables, options: MemoryDbOptions = {}): Db {
  const db = {
    from(table: string) {
      return {
        select: (columns?: string) =>
          new Query(tables, table, options, { kind: "select" }).select(columns),
        insert: (rows: Row | Row[]) =>
          new Query(tables, table, options, {
            kind: "insert",
            rows: Array.isArray(rows) ? rows : [rows],
          }),
        upsert: (rows: Row | Row[], opts: { onConflict?: string } = {}) =>
          new Query(tables, table, options, {
            kind: "upsert",
            rows: Array.isArray(rows) ? rows : [rows],
            onConflict: (opts.onConflict ?? "id").split(",").map((c) => c.trim()),
          }),
        update: (patch: Row) => new Query(tables, table, options, { kind: "update", patch }),
        delete: () => new Query(tables, table, options, { kind: "delete" }),
      };
    },
  };
  return db as unknown as Db;
}
