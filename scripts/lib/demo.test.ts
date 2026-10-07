import { describe, expect, it } from "vitest";
import {
  computeShifts,
  insertableRow,
  pagesToTrash,
  scenarioAnchor,
  selectSnapshot,
  shiftRow,
  SNAPSHOT_TABLES,
  type Row,
  type SnapshotTable,
} from "./demo";

const DAY = 24 * 60 * 60 * 1000;

function emptyTables(): Record<SnapshotTable, Row[]> {
  return Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, []])) as unknown as Record<
    SnapshotTable,
    Row[]
  >;
}

describe("scenarioAnchor", () => {
  it("returns the earliest feedback insertion", () => {
    expect(
      scenarioAnchor([
        { created_at: "2026-10-05T10:00:00Z" },
        { created_at: "2026-10-03T17:22:00Z" },
        { created_at: null },
      ]),
    ).toBe("2026-10-03T17:22:00Z");
  });

  it("is null without feedbacks", () => {
    expect(scenarioAnchor([])).toBeNull();
  });
});

describe("computeShifts", () => {
  it("moves the scenario by whole days and the activity by the exact elapsed time", () => {
    const shifts = computeShifts(
      { scenario_now: "2026-10-03T17:00:00Z", taken_at: "2026-10-06T23:00:00Z" },
      new Date("2026-10-20T09:00:00Z"),
    );
    expect(shifts.scenarioMs).toBe(16 * DAY);
    expect(shifts.activityMs).toBe(13 * DAY + 10 * 60 * 60 * 1000);
    expect(shifts.nowMs).toBe(Date.parse("2026-10-20T09:00:00Z"));
  });
});

describe("shiftRow", () => {
  const shifts = {
    scenarioMs: 10 * DAY,
    activityMs: 2 * DAY,
    nowMs: Date.parse("2027-01-01T00:00:00Z"),
  };

  it("moves scenario columns with the scenario shift and the others with the activity shift", () => {
    const row = shiftRow(
      "feedbacks",
      {
        id: "R-001",
        received_at: "2026-10-01T08:30:00+00:00",
        created_at: "2026-10-03T17:22:00.53232+00:00",
        updated_at: "2026-10-03T17:22:00.53232+00:00",
        subject: "2026-10-01T08:30 dans un texte",
        nps_score: 7,
        language: null,
      },
      shifts,
    );
    expect(row).toEqual({
      id: "R-001",
      received_at: "2026-10-11T08:30:00.000Z",
      created_at: "2026-10-13T17:22:00.532Z",
      updated_at: "2026-10-05T17:22:00.532Z",
      subject: "2026-10-01T08:30 dans un texte",
      nps_score: 7,
      language: null,
    });
  });

  it("moves date-only columns by whole days", () => {
    expect(shiftRow("customers", { renewal_date: "2026-11-10" }, shifts)).toEqual({
      renewal_date: "2026-11-20",
    });
    expect(
      shiftRow("epics", { due: "2026-11-10" }, { scenarioMs: 0, activityMs: 1.6 * DAY, nowMs: 0 }),
    ).toEqual({
      due: "2026-11-12",
    });
  });

  it("never moves a timestamp past now", () => {
    expect(
      shiftRow(
        "feedbacks",
        { received_at: "2026-10-05T17:36:00Z" },
        { scenarioMs: 3 * DAY, activityMs: 0, nowMs: Date.parse("2026-10-07T02:00:00Z") },
      ),
    ).toEqual({ received_at: "2026-10-07T02:00:00.000Z" });
  });

  it("leaves an unparsable timestamp-like value as it is", () => {
    expect(shiftRow("alerts", { x: "2026-13-45T99:99" }, shifts)).toEqual({
      x: "2026-13-45T99:99",
    });
  });
});

describe("insertableRow", () => {
  it("drops generated columns and nulls deferred references", () => {
    expect(insertableRow("feedback_items", { id: "R-001.1", feedback_id: "R-001" })).toEqual({
      feedback_id: "R-001",
    });
    expect(insertableRow("insights", { id: "I-02", merged_into: "I-01" })).toEqual({
      id: "I-02",
      merged_into: null,
    });
    expect(insertableRow("scores", { id: "s" })).toEqual({ id: "s" });
  });
});

describe("selectSnapshot", () => {
  it("keeps the fallback backlog only, with its decisions and Notion links", () => {
    const tables = emptyTables();
    tables.epics = [
      { id: "E-01", insight_id: "I-31" },
      { id: "E-02", insight_id: "I-28" },
    ];
    tables.backlog_items = [
      { id: "US-001", insight_id: "I-31", prototype_id: "p" },
      { id: "US-005", insight_id: "I-28", prototype_id: null },
      { id: "BUG-001", insight_id: null },
    ];
    tables.complexity_estimates = [
      { id: "c1", item_id: "US-005" },
      { id: "c2", item_id: "US-001" },
      { id: "c3", item_id: null },
    ];
    tables.decisions = [
      { id: "D-001", entity_type: "backlog_item", entity_id: "US-005" },
      { id: "D-002", entity_type: "backlog_item", entity_id: "US-001" },
      { id: "D-003", entity_type: "epic", entity_id: "E-02" },
      { id: "D-004", entity_type: "insight", entity_id: "I-28" },
    ];
    tables.notion_links = [
      { entity_id: "US-005", notion_page_id: "n5" },
      { entity_id: "US-001", notion_page_id: "n1" },
    ];
    tables.insights = [{ id: "I-31" }];

    const { tables: out, dropped } = selectSnapshot(tables, new Set(["I-31"]));

    expect(dropped).toEqual(["BUG-001", "E-02", "US-005"]);
    expect(out.epics.map((r) => r.id)).toEqual(["E-01"]);
    expect(out.backlog_items).toEqual([{ id: "US-001", insight_id: "I-31", prototype_id: null }]);
    expect(out.complexity_estimates).toEqual([
      { id: "c1", item_id: null },
      { id: "c2", item_id: "US-001" },
      { id: "c3", item_id: null },
    ]);
    expect(out.decisions.map((d) => d.id)).toEqual(["D-002", "D-004"]);
    expect(out.notion_links.map((l) => l.entity_id)).toEqual(["US-001"]);
    expect(out.insights).toBe(tables.insights);
  });
});

describe("pagesToTrash", () => {
  it("lists the pages created since the snapshot", () => {
    expect(
      pagesToTrash([{ notion_page_id: "a" }, { notion_page_id: "b" }], [{ notion_page_id: "a" }]),
    ).toEqual(["b"]);
  });
});
