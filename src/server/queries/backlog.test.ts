import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db/memory";
import { getBacklogScreen, getUnsentBacklog } from "./backlog";

const item = (id: string, insightId: string, status = "brouillon") => ({
  id,
  kind: "story",
  title: `Titre de ${id}`,
  epic_id: null,
  insight_id: insightId,
  status,
  points: 3,
  affected_accounts: [],
  evidence: [],
  dependencies: [],
  complexity_estimate_id: null,
  judge: null,
});

describe("getBacklogScreen", () => {
  it("gives each group its insight's status, and leaves the rejected items out", async () => {
    const db = createMemoryDb({
      backlog_items: [
        item("US-001", "I-03"),
        item("US-002", "I-05", "valide"),
        item("US-003", "I-07"),
        item("US-004", "I-03", "rejete"),
      ],
      epics: [],
      insights: [
        { id: "I-03", title: "Partage", status: "actif", merged_into: null, backlog_plan: null },
        { id: "I-05", title: "Accès", status: "fusionne", merged_into: "I-03", backlog_plan: null },
        { id: "I-07", title: "Droits", status: "rejete", merged_into: null, backlog_plan: null },
      ],
    });
    const { groups } = await getBacklogScreen(db);
    expect(groups.map((g) => [g.insight, g.items.map((i) => i.id)])).toEqual([
      [{ id: "I-03", title: "Partage", status: "actif", merged_into: null }, ["US-001"]],
      [{ id: "I-05", title: "Accès", status: "fusionne", merged_into: "I-03" }, ["US-002"]],
      [{ id: "I-07", title: "Droits", status: "rejete", merged_into: null }, ["US-003"]],
    ]);
  });

  it("counts the items not sent yet per insight, drafts and validated ones", async () => {
    const db = createMemoryDb({
      backlog_items: [
        item("US-001", "I-03"),
        item("US-002", "I-03"),
        item("US-003", "I-03", "valide"),
        item("US-004", "I-03", "envoye"),
        item("US-005", "I-03", "rejete"),
        item("US-006", "I-05", "envoye"),
        item("US-007", "I-07"),
      ],
    });
    expect(await getUnsentBacklog(db, ["I-03", "I-05"])).toEqual({
      "I-03": { brouillon: 2, valide: 1 },
    });
    expect(await getUnsentBacklog(db, [])).toEqual({});
  });
});
