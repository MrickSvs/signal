import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db/memory";
import { listBacklogTool } from "./list-backlog";
import { LIST_LIMIT, type AgentDeps } from "./shared";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: id.startsWith("BUG") ? "bug" : id.startsWith("TT") ? "tache" : "story",
  title: `Titre de ${id}`,
  points: 3,
  status: "brouillon",
  notion_status_raw: null,
  epic_id: null,
  insight_id: "I-07",
  push_error: null,
  ...extra,
});

function tool(items: Record<string, unknown>[], epics: Record<string, unknown>[] = []) {
  const db = createMemoryDb({ backlog_items: items, epics });
  return listBacklogTool({ db } as unknown as AgentDeps);
}

/** The tool's JSON, out of its <contenu_externe> wrapper. */
async function list(t: ReturnType<typeof tool>, input: Record<string, unknown>) {
  const text = String(await t.invoke(input));
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

describe("list_backlog", () => {
  const items = [
    item("US-001", { epic_id: "E-01", status: "envoye", notion_status_raw: "En cours" }),
    item("US-002", { epic_id: "E-01", status: "valide", push_error: "Notion indisponible" }),
    item("BUG-001"),
    item("TT-001", { insight_id: "I-03" }),
  ];
  const epics = [{ id: "E-01", title: "Droits par client", insight_id: "I-07" }];

  it("gives an insight's epics and items with their Signal and Notion status", async () => {
    const out = await list(tool(items, epics), { insight_id: "I-07" });
    expect(out.total).toBe(3);
    expect(out.epics).toEqual([{ id: "E-01", titre: "Droits par client" }]);
    expect(out.elements.map((e: { id: string }) => e.id)).toEqual(["BUG-001", "US-001", "US-002"]);
    expect(out.elements[1]).toMatchObject({
      type: "story",
      statut: "envoye",
      statut_notion: "En cours",
      epic: "E-01",
    });
    expect(out.elements[2].erreur_envoi).toBe("Notion indisponible");
    expect(out.elements[0]).not.toHaveProperty("erreur_envoi");
    expect(out).not.toHaveProperty("introuvables");
  });

  it("names the requested ids that do not exist", async () => {
    const out = await list(tool(items), { ids: ["US-001", "US-999"] });
    expect(out.elements.map((e: { id: string }) => e.id)).toEqual(["US-001"]);
    expect(out.introuvables).toEqual(["US-999"]);
    expect(out).not.toHaveProperty("note");
  });

  it("answers in one short sentence when none of the requested ids exists", async () => {
    const out = await tool(items).invoke({ ids: ["US-998", "BUG-999"] });
    expect(String(out)).toBe("Erreur : Aucun de ces éléments n'existe : US-998, BUG-999.");
  });

  it("says when nothing matches instead of returning a bare empty list", async () => {
    const out = await list(tool(items), { status: "rejete" });
    expect(out).toMatchObject({ total: 0, elements: [], epics: [] });
    expect(out.note).toBe("Aucun élément du backlog pour ces critères.");
  });

  it("lists 10 items at most but keeps the total", async () => {
    const many = Array.from({ length: 13 }, (_, i) => item(`US-${String(i + 1).padStart(3, "0")}`));
    const out = await list(tool(many), {});
    expect(out.total).toBe(13);
    expect(out.elements).toHaveLength(LIST_LIMIT);
  });
});
