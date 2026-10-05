import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db/memory";
import { existingIds, recordIdIncidents } from "./ids";

function world() {
  const tables = {
    feedbacks: [{ id: "R-042" }],
    feedback_items: [{ id: "R-042.1" }],
    insights: [{ id: "I-07" }],
    customers: [{ id: "C-013" }],
    decisions: [],
    epics: [],
    backlog_items: [{ id: "US-001" }],
    reference_tickets: [{ id: "T-101" }],
    threads: [{ id: "11111111-1111-4111-8111-111111111111" }],
    id_incidents: [] as Record<string, unknown>[],
  };
  return { tables, db: createMemoryDb(tables) };
}

describe("id checks (CL-28)", () => {
  it("tells the ids that exist from the invented ones, per table", async () => {
    const { db } = world();
    const found = await existingIds(db, [
      "R-042",
      "R-042.1",
      "R-042.9",
      "I-07",
      "I-99",
      "C-013",
      "D-001",
      "E-01",
      "US-001",
      "BUG-001",
      "T-101",
    ]);
    expect([...found].sort()).toEqual(["C-013", "I-07", "R-042", "R-042.1", "T-101", "US-001"]);
  });

  it("journals unknown ids, without a thread that was never recorded", async () => {
    const { db, tables } = world();
    await recordIdIncidents(db, "11111111-1111-4111-8111-111111111111", [
      { id: "R-999", excerpt: "…R-999…" },
    ]);
    await recordIdIncidents(db, "22222222-2222-4222-8222-222222222222", [
      { id: "I-99", excerpt: "…I-99…" },
    ]);
    await recordIdIncidents(db, null, []);
    expect(tables.id_incidents).toMatchObject([
      { thread_id: "11111111-1111-4111-8111-111111111111", cited_id: "R-999", excerpt: "…R-999…" },
      { thread_id: null, cited_id: "I-99" },
    ]);
  });
});
