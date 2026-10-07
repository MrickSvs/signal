import { describe, expect, it } from "vitest";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { answerRecommendation, RecommendationError } from "./recommendations";

const CLOCK = new Date("2026-10-07T09:00:00Z");

function world(): MemoryTables {
  return {
    digests: [
      {
        id: "dg1",
        content: {
          facts: {},
          writing: {
            recommandations: [
              {
                titre: "Prévenir le CSM de Studio Bastide",
                justification: "C-013 renouvelle à J+38.",
                preuves: ["C-013", "R-078"],
                confiance: "moyenne",
              },
            ],
          },
        },
      },
    ],
    decisions: [],
  };
}

const db = (tables: MemoryTables) =>
  createMemoryDb(tables, {
    defaults: {
      decisions: (_r, rows) => ({ id: `D-${String(rows.length + 1).padStart(3, "0")}` }),
    },
  });

describe("answerRecommendation", () => {
  it("logs « fait » as a validation with the recommendation's title and evidence", async () => {
    const tables = world();
    const result = await answerRecommendation(
      db(tables),
      { digestId: "dg1", index: 0, outcome: "fait" },
      CLOCK,
    );
    expect(result).toEqual({ decision_id: "D-001" });
    expect(tables.decisions[0]).toMatchObject({
      actor: "po",
      source: "signal_ui",
      entity_type: "recommandation",
      entity_id: "dg1#1",
      action: "validation",
      after: {
        statut: "fait",
        titre: "Prévenir le CSM de Studio Bastide",
        preuves: ["C-013", "R-078"],
      },
      reason: null,
      created_at: CLOCK.toISOString(),
    });
  });

  it("logs « écartée » as a rejection with its reason", async () => {
    const tables = world();
    await answerRecommendation(
      db(tables),
      { digestId: "dg1", index: 0, outcome: "ecartee", reason: "  déjà géré par le CSM " },
      CLOCK,
    );
    expect(tables.decisions[0]).toMatchObject({ action: "rejet", reason: "déjà géré par le CSM" });
  });

  it("refuses a second answer, an unknown recommendation or digest", async () => {
    const tables = world();
    await answerRecommendation(db(tables), { digestId: "dg1", index: 0, outcome: "fait" }, CLOCK);
    await expect(
      answerRecommendation(db(tables), { digestId: "dg1", index: 0, outcome: "ecartee" }, CLOCK),
    ).rejects.toThrow("déjà traitée (D-001)");
    await expect(
      answerRecommendation(db(tables), { digestId: "dg1", index: 3, outcome: "fait" }, CLOCK),
    ).rejects.toBeInstanceOf(RecommendationError);
    await expect(
      answerRecommendation(db(tables), { digestId: "nope", index: 0, outcome: "fait" }, CLOCK),
    ).rejects.toThrow("n'existe plus");
  });
});
