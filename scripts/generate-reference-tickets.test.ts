import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  architectureModuleIds,
  plannedFields,
  TICKET_PLAN,
  textIssues,
  validateReferenceTickets,
} from "./generate-reference-tickets";
import {
  biasByComponent,
  REFERENCE_TICKETS_FILE,
  type ReferenceTicket,
} from "./lib/reference-tickets";

const moduleIds = architectureModuleIds();
const fields = plannedFields();

/** The plan with placeholder texts: validates everything numeric without calling a model. */
const placeholder: ReferenceTicket[] = TICKET_PLAN.map((s) => ({
  id: s.id,
  ...("written" in s
    ? s.written
    : {
        title: `Ticket ${s.id} sur ${s.module}`,
        description: `Description factice du ticket ${s.id}, assez longue pour le schéma.`,
        surprises: "Rien de notable.",
      }),
  module: s.module,
  components: s.components,
  estimated_points: s.estimated_points,
  actual_points: s.actual_points,
  ...fields[s.id],
}));

describe("ticket plan", () => {
  it("passes every check of SPEC §8.4 and PLAN 1.3", () => {
    expect(validateReferenceTickets(placeholder, moduleIds)).toEqual([]);
  });

  it("makes permissions and export underestimated, notifications accurate, the rest moderate", () => {
    const bias = biasByComponent(placeholder);
    expect(bias.permissions.ratio).toBeGreaterThan(1.4);
    expect(bias.export.ratio).toBeGreaterThan(1.4);
    expect(bias.notifications.ratio).toBeCloseTo(1, 1);
    for (const c of ["taches", "tableau", "liste", "champs_personnalises", "parametres"]) {
      expect(bias[c].ratio, c).toBeLessThanOrEqual(1.35);
    }
  });

  it("keeps the tickets already cited in the context pack (SPEC §9, skills)", () => {
    const byId = (id: string) => placeholder.find((t) => t.id === id)!;
    expect(byId("T-117")).toMatchObject({
      module: "permissions",
      components: ["permissions", "parametres"],
      estimated_points: 5,
      actual_points: 8,
    });
    expect(byId("T-108")).toMatchObject({
      module: "notifications",
      estimated_points: 2,
      actual_points: 2,
    });
    expect(byId("T-121").module).toBe("tableau");
    expect(byId("T-112").components).toEqual(["export", "permissions"]);
    expect(byId("T-124")).toMatchObject({
      components: ["export", "permissions"],
      estimated_points: 3,
      actual_points: 5,
    });
    // T-150 is the invented ticket of the estimation skill's bad example: it must not exist.
    expect(placeholder.some((t) => t.id === "T-150")).toBe(false);
  });

  it("derives days and delivery dates in code, oldest ticket first, nothing in the last 3 weeks", () => {
    const ago = placeholder.map((t) => t.shipped_days_ago);
    expect(Math.min(...ago)).toBeGreaterThanOrEqual(17);
    expect(ago[0]).toBeGreaterThan(ago[ago.length - 1]);
    for (const t of placeholder) expect(t.actual_days).toBeGreaterThan(0);
    expect(plannedFields()).toEqual(fields);
  });
});

describe("textIssues", () => {
  const ok = {
    title: "Corriger le tri de la liste",
    description: "Le tri par échéance plaçait les tâches sans échéance en tête.",
    surprises: "Rien de notable.",
  };

  it("accepts a plain ticket", () => {
    expect(textIssues("T-111", ok)).toEqual([]);
  });

  it("rejects scenario topics, absolute dates and scenario ids", () => {
    expect(textIssues("T-111", { ...ok, title: "Ajouter une vue Gantt" })[0]).toMatch(
      /sujet interdit/,
    );
    expect(textIssues("T-111", { ...ok, surprises: "Livré en mars 2025." })[0]).toMatch(/date/);
    expect(textIssues("T-111", { ...ok, description: `${ok.description} Voir S1.` })[0]).toMatch(
      /scénario/,
    );
  });

  it("lets the hand-written anchors mention the debt they explain", () => {
    const anchor = TICKET_PLAN.find((s) => s.id === "T-104")!;
    expect("written" in anchor && textIssues("T-104", anchor.written)).toEqual([]);
  });
});

describe.runIf(existsSync(REFERENCE_TICKETS_FILE))("data/reference_tickets.json", () => {
  it("is valid and follows the plan", () => {
    const tickets: ReferenceTicket[] = JSON.parse(readFileSync(REFERENCE_TICKETS_FILE, "utf8"));
    expect(validateReferenceTickets(tickets, moduleIds)).toEqual([]);
    for (const [i, slot] of TICKET_PLAN.entries()) {
      expect(tickets[i]).toMatchObject({
        id: slot.id,
        module: slot.module,
        components: slot.components,
        estimated_points: slot.estimated_points,
        actual_points: slot.actual_points,
        ...fields[slot.id],
      });
      if ("written" in slot) expect(tickets[i]).toMatchObject(slot.written);
    }
  });
});
