import { APIErrorCode, APIResponseError, type CreatePageParameters } from "@notionhq/client";
import { describe, expect, it } from "vitest";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { patchBacklogItem } from "@/services/backlog";
import {
  logPushRefusal,
  previewPush,
  pushBacklogItems,
  resolvePushIds,
  type NotionPort,
} from "./push-backlog";

const NOW = new Date("2026-10-05T10:00:00Z");
const CONFIG = { backlogDataSourceId: "ds-backlog", appBaseUrl: "https://signal.test" };

function item(extra: Record<string, unknown> = {}) {
  return {
    id: "US-001",
    kind: "story",
    epic_id: "E-01",
    insight_id: "I-03",
    title: "Inviter un client sur un seul projet",
    value: "partager l'avancement",
    persona: "cheffe de projet",
    want: "inviter un client",
    success_kpi: "30 % des comptes Pro",
    expected_behavior: null,
    actual_behavior: null,
    repro_steps: null,
    severity: null,
    affected_accounts: [],
    objective: null,
    definition_of_done: null,
    business_rules: ["Un invité ne voit que ses projets"],
    acceptance_criteria: [],
    risks: [],
    points: 5,
    evidence: ["R-012"],
    status: "valide",
    push_error: null,
    notion_page_id: null,
    notion_status_raw: null,
    edited_in_notion: false,
    dependencies: [],
    updated_at: NOW.toISOString(),
    ...extra,
  };
}

function setup(rows: Record<string, unknown>[]) {
  const tables: MemoryTables = {
    backlog_items: rows,
    epics: [{ id: "E-01", insight_id: "I-03", title: "Permissions par projet" }],
    insights: [{ id: "I-03", title: "Partager un projet avec un client" }],
    overrides: [{ insight_id: "I-03", param: "moscow", value: "should", active: true }],
    scores: [{ insight_id: "I-03", is_current: true, moscow_reco: "must" }],
    prototypes: [],
    notion_links: [],
    decisions: [],
  };
  const db = createMemoryDb(tables, {
    defaults: {
      decisions: (_row, table) => ({ id: `D-${String(table.length + 1).padStart(3, "0")}` }),
    },
  });
  return { tables, db };
}

/** A fake Notion: records the pages and the appended batches; can fail on demand. */
function fakeNotion(fail?: { create?: unknown; append?: unknown }) {
  const pages: CreatePageParameters[] = [];
  const appended: number[] = [];
  const trashed: string[] = [];
  const notion: NotionPort = {
    async createPage(args) {
      if (fail?.create) throw fail.create;
      pages.push(args);
      return { id: `page-${pages.length}`, last_edited_time: "2026-10-05T10:00:01.000Z" };
    },
    async appendBlocks(_pageId, children) {
      if (fail?.append) throw fail.append;
      appended.push(children.length);
    },
    async trashPage(pageId) {
      trashed.push(pageId);
    },
  };
  return { notion, pages, appended, trashed };
}

const unauthorized = new APIResponseError({
  code: APIErrorCode.Unauthorized,
  status: 401,
  message: "API token is invalid.",
  headers: new Headers(),
  rawBodyText: "{}",
  additional_data: undefined,
  request_id: undefined,
});

describe("pushBacklogItems (SPEC §11.2)", () => {
  it("creates the page « Prêt », links it, marks the item sent and logs the decision", async () => {
    const { tables, db } = setup([item()]);
    const fake = fakeNotion();
    const [result] = await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "signal_ui",
      config: CONFIG,
      notion: fake.notion,
    });

    expect(result).toMatchObject({ id: "US-001", ok: true, notion_page_id: "page-1" });
    expect(fake.pages[0]).toMatchObject({
      parent: { data_source_id: "ds-backlog" },
      properties: {
        Statut: { select: { name: "Prêt" } },
        Type: { select: { name: "Story" } },
        // Léa's MoSCoW override wins over Signal's recommendation.
        MoSCoW: { select: { name: "Should" } },
        Insight: { rich_text: [{ text: { content: "I-03 · Partager un projet avec un client" } }] },
      },
    });
    expect(tables.backlog_items[0]).toMatchObject({
      status: "envoye",
      notion_page_id: "page-1",
      push_error: null,
    });
    expect(tables.notion_links).toEqual([
      expect.objectContaining({
        entity_type: "backlog_item",
        entity_id: "US-001",
        notion_page_id: "page-1",
        data_source: "backlog",
        last_pushed_at: NOW.toISOString(),
        last_notion_edited_time: "2026-10-05T10:00:01.000Z",
      }),
    ]);
    expect(tables.decisions).toEqual([
      expect.objectContaining({
        actor: "po",
        source: "signal_ui",
        entity_id: "US-001",
        action: "validation",
        field: "notion",
        before: "valide",
      }),
    ]);
  });

  it("validates a draft first: Léa's click is her validation, logged", async () => {
    const { tables, db } = setup([item({ status: "brouillon" })]);
    const [result] = await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fakeNotion().notion,
    });
    expect(result).toMatchObject({ ok: true, validated: true });
    expect(tables.decisions.map((d) => [d.action, d.field, d.after])).toEqual([
      ["validation", "status", "valide"],
      ["validation", "notion", { status: "envoye", notion_page_id: "page-1" }],
    ]);
  });

  it("never creates a second page: a sent item is reported, a linked one is only marked", async () => {
    const { tables, db } = setup([
      item({ status: "envoye", notion_page_id: "page-0" }),
      item({ id: "US-002" }),
    ]);
    tables.notion_links.push({
      entity_type: "backlog_item",
      entity_id: "US-002",
      notion_page_id: "page-9",
      data_source: "backlog",
    });
    const fake = fakeNotion();
    const results = await pushBacklogItems(db, ["US-001", "US-002", "US-001"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fake.notion,
    });
    expect(fake.pages).toHaveLength(0);
    expect(results).toEqual([
      expect.objectContaining({ id: "US-001", ok: true, already_sent: true }),
      expect.objectContaining({ id: "US-002", ok: true, notion_page_id: "page-9" }),
    ]);
    expect(tables.backlog_items[1]).toMatchObject({ status: "envoye", notion_page_id: "page-9" });
  });

  it("CL-35: a Notion failure keeps the item « valide » with the error, then a retry works", async () => {
    const { tables, db } = setup([item({ status: "brouillon" })]);
    const [failed] = await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "signal_ui",
      config: CONFIG,
      notion: fakeNotion({ create: unauthorized }).notion,
    });
    expect(failed).toMatchObject({ ok: false, validated: true });
    expect(failed.error).toMatch(/jeton/);
    expect(tables.backlog_items[0]).toMatchObject({ status: "valide", notion_page_id: null });
    expect(tables.backlog_items[0].push_error).toMatch(/jeton/);
    expect(tables.notion_links).toHaveLength(0);

    const [retried] = await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "signal_ui",
      config: CONFIG,
      notion: fakeNotion().notion,
    });
    expect(retried.ok).toBe(true);
    expect(tables.backlog_items[0]).toMatchObject({ status: "envoye", push_error: null });
  });

  it("CL-35: without a data source id, the error says how to fix it", async () => {
    const { tables, db } = setup([item()]);
    const [result] = await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "chat",
      config: { ...CONFIG, backlogDataSourceId: null },
      notion: fakeNotion().notion,
    });
    expect(result.ok).toBe(false);
    expect(tables.backlog_items[0].push_error).toMatch(/notion:setup/);
  });

  it("CL-41: a long body is sent in batches of 100 blocks; a half-created page is trashed", async () => {
    const rules = Array.from({ length: 230 }, (_, i) => `Règle ${i + 1}`);
    const { db } = setup([item({ business_rules: rules })]);
    const fake = fakeNotion();
    await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fake.notion,
    });
    expect(fake.pages[0].children).toHaveLength(100);
    expect(fake.appended).toEqual([100, 36]);

    const broken = setup([item({ business_rules: rules })]);
    const failing = fakeNotion({ append: new Error("socket hang up") });
    const [result] = await pushBacklogItems(broken.db, ["US-001"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: failing.notion,
    });
    expect(result.ok).toBe(false);
    expect(failing.trashed).toEqual(["page-1"]);
    expect(broken.tables.notion_links).toHaveLength(0);
  });

  it("refuses rejected and unknown items without calling Notion", async () => {
    const { db } = setup([item({ status: "rejete" })]);
    const fake = fakeNotion();
    const results = await pushBacklogItems(db, ["US-001", "US-404"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fake.notion,
    });
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      ["US-001", false],
      ["US-404", false],
    ]);
    expect(results[1].error).toMatch(/introuvable/);
    expect(fake.pages).toHaveLength(0);
  });

  it("refuses an item whose insight was rejected or merged, before validating it", async () => {
    const { tables, db } = setup([
      item({ status: "brouillon" }),
      item({ id: "US-002", insight_id: "I-05" }),
      item({ id: "US-003", status: "envoye", notion_page_id: "page-0" }),
    ]);
    tables.insights[0].status = "rejete";
    tables.insights.push({ id: "I-05", status: "fusionne", merged_into: "I-03", title: "Accès" });
    const fake = fakeNotion();
    const results = await pushBacklogItems(db, ["US-001", "US-002", "US-003"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fake.notion,
    });
    expect(results.map((r) => [r.id, r.ok, r.error])).toEqual([
      ["US-001", false, "US-001 ne part pas : I-03 est rejeté. Rejette US-001 dans le Backlog."],
      [
        "US-002",
        false,
        "US-002 ne part pas : I-05 est fusionné dans I-03. Rédige le backlog de I-03, puis rejette US-002.",
      ],
      // Already sent before the rejection: still reported as sent.
      ["US-003", true, null],
    ]);
    expect(fake.pages).toHaveLength(0);
    expect(tables.backlog_items.map((r) => [r.id, r.status, r.push_error])).toEqual([
      ["US-001", "brouillon", null],
      ["US-002", "valide", null],
      ["US-003", "envoye", null],
    ]);
    expect(tables.decisions).toEqual([]);
    expect(await previewPush(db, ["US-001"], "https://signal.test")).toBe(
      "US-001 ne part pas : I-03 est rejeté. Rejette US-001 dans le Backlog.",
    );
  });

  it("CL-36: a sent item can no longer be edited in Signal", async () => {
    const { db } = setup([item()]);
    await pushBacklogItems(db, ["US-001"], {
      now: NOW,
      source: "chat",
      config: CONFIG,
      notion: fakeNotion().notion,
    });
    await expect(
      patchBacklogItem(db, "US-001", { title: "Autre titre" }, {
        now: NOW,
        source: "signal_ui",
      } as never),
    ).rejects.toThrow(/à modifier dans Notion/);
  });
});

describe("approval card and refusal", () => {
  it("previews each page, and says what will not be sent", async () => {
    const { db } = setup([item({ status: "brouillon" }), item({ id: "US-002", status: "envoye" })]);
    const preview = await previewPush(db, ["US-001", "US-002", "US-404"], "https://signal.test");
    expect(preview).toContain("US-001 · Story · Inviter un client sur un seul projet");
    expect(preview).toContain("brouillon : validé par ton clic");
    expect(preview).toContain("US-002 : déjà envoyé");
    expect(preview).toContain("US-404 : introuvable");
  });

  it("logs a refusal per item", async () => {
    const { tables, db } = setup([item()]);
    await logPushRefusal(db, { item_ids: ["US-001", "US-002"] }, "chat", "pas encore");
    expect(tables.decisions.map((d) => [d.entity_id, d.action, d.reason])).toEqual([
      ["US-001", "rejet", "pas encore"],
      ["US-002", "rejet", "pas encore"],
    ]);
  });
});

describe("resolvePushIds: a whole epic (ADR-027)", () => {
  it("takes the epic's drafts and validated items, without the rejected or sent ones", async () => {
    const { db } = setup([
      item({ id: "US-001", status: "brouillon" }),
      item({ id: "US-002", status: "envoye" }),
      item({ id: "US-003", status: "rejete" }),
      item({ id: "TT-001", kind: "tache", status: "valide" }),
      item({ id: "US-004", epic_id: "E-02" }),
    ]);
    expect(await resolvePushIds(db, { epic_id: "e-01" })).toEqual(["TT-001", "US-001"]);
    expect(await resolvePushIds(db, { item_ids: ["us-004", "US-004"] })).toEqual(["US-004"]);
  });

  it("says when the epic is unknown or has nothing left to send", async () => {
    const { db } = setup([item({ status: "envoye" })]);
    await expect(resolvePushIds(db, { epic_id: "E-09" })).rejects.toThrow(/E-09 introuvable/);
    await expect(resolvePushIds(db, { epic_id: "E-01" })).rejects.toThrow(/plus d'élément/);
  });

  it("refuses more than 10 pages in one card", async () => {
    const { db } = setup(Array.from({ length: 11 }, (_, i) => item({ id: `US-${100 + i}` })));
    await expect(resolvePushIds(db, { epic_id: "E-01" })).rejects.toThrow(/en deux fois/);
  });
});
