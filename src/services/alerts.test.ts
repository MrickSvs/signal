import { describe, expect, it } from "vitest";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { AlertError, answerAlert } from "./alerts";

const ID = "00000000-0000-4000-8000-000000000001";

function world(status = "nouvelle"): MemoryTables {
  return {
    alerts: [{ id: ID, status, kind: "churn", insight_id: "I-27" }],
    decisions: [],
  };
}

const db = (tables: MemoryTables) =>
  createMemoryDb(tables, {
    defaults: {
      decisions: (_r, rows) => ({ id: `D-${String(rows.length + 1).padStart(3, "0")}` }),
    },
  });

describe("answerAlert", () => {
  it("marks an alert as seen without journaling", async () => {
    const tables = world();
    expect(await answerAlert(db(tables), ID, { kind: "seen" })).toEqual({
      status: "vue",
      decision_id: null,
    });
    expect(tables.alerts[0].status).toBe("vue");
    expect(tables.decisions).toHaveLength(0);
  });

  it("journals an ignored alert", async () => {
    const tables = world("vue");
    const result = await answerAlert(db(tables), ID, { kind: "ignore", reason: " déjà vu " });
    expect(result).toEqual({ status: "ignoree", decision_id: "D-001" });
    expect(tables.decisions[0]).toMatchObject({
      actor: "po",
      source: "signal_ui",
      entity_type: "alert",
      entity_id: ID,
      action: "rejet",
      after: { status: "ignoree" },
      reason: "déjà vu",
    });
  });

  it("journals the proposed action Léa launched, not as done: its approval card decides", async () => {
    const tables = world();
    await answerAlert(db(tables), ID, {
      kind: "act",
      action: { type: "prevenir_csm", cible: "C-013" },
    });
    expect(tables.alerts[0].status).toBe("traitee");
    expect(tables.decisions[0]).toMatchObject({
      action: "validation",
      field: "action_lancee",
      after: { status: "traitee", action: "prevenir_csm", cible: "C-013" },
    });
  });

  it("refuses to answer a closed alert twice, but opening it again is harmless", async () => {
    const tables = world("ignoree");
    await expect(answerAlert(db(tables), ID, { kind: "ignore" })).rejects.toBeInstanceOf(
      AlertError,
    );
    expect(await answerAlert(db(tables), ID, { kind: "seen" })).toEqual({
      status: "ignoree",
      decision_id: null,
    });
    await expect(answerAlert(db(world()), "inconnue", { kind: "seen" })).rejects.toThrow(
      "introuvable",
    );
  });
});
