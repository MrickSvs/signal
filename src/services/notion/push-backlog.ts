// Sending validated backlog items to Notion (SPEC §11.2, ADR-026, CL-35, CL-41): the only
// external write of Signal, always after Léa's approval — the approval card of push_to_notion in
// the chat, or « Valider et envoyer » on the Backlog screen. A draft is validated first (logged),
// then its page is created in the Backlog data source (Statut = Prêt), linked in notion_links, and
// the item becomes « envoye » (logged). A failure leaves it « valide » with push_error, ready for
// « Réessayer ». Shared by the agent's tool and the screen.
import type { BlockObjectRequest, CreatePageParameters } from "@notionhq/client";
import type { Scenario } from "@/lib/backlog/draft";
import type { Db } from "@/lib/db/create";
import type { Enums, Json, Tables } from "@/lib/db/types";
import { reviewBacklogItem } from "@/services/backlog";
import {
  NotionError,
  notionClient,
  notionConfig,
  notionErrorMessage,
  type NotionConfig,
} from "./client";
import {
  backlogPageBlocks,
  backlogPagePreview,
  backlogPageProperties,
  chunk,
  signalUrl,
  type NotionBacklogItem,
} from "./mappers";

/** The few Notion calls the push needs; a fake in tests (rule 11). */
export type NotionPort = {
  createPage(args: CreatePageParameters): Promise<{ id: string; last_edited_time: string | null }>;
  appendBlocks(pageId: string, children: BlockObjectRequest[]): Promise<void>;
  trashPage(pageId: string): Promise<void>;
};

export function notionPort(config: Pick<NotionConfig, "token">): NotionPort {
  const client = notionClient(config);
  return {
    async createPage(args) {
      const page = await client.pages.create(args);
      return {
        id: page.id,
        last_edited_time: "last_edited_time" in page ? page.last_edited_time : null,
      };
    },
    async appendBlocks(pageId, children) {
      await client.blocks.children.append({ block_id: pageId, children });
    },
    async trashPage(pageId) {
      await client.pages.update({ page_id: pageId, in_trash: true });
    },
  };
}

export type PushDeps = {
  /** Scenario clock (DEMO_NOW): « Validé le », last_pushed_at. */
  now: Date;
  source: "chat" | "signal_ui";
  /** The pipeline lock in the app: no drafting replaces an item while it is being sent. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Injected in tests; default from the environment. */
  config?: Pick<NotionConfig, "backlogDataSourceId" | "appBaseUrl">;
  notion?: NotionPort;
};

export type PushResult = {
  id: string;
  title: string | null;
  ok: boolean;
  /** Notion page of the item (sent now or before). */
  notion_page_id: string | null;
  /** Already sent: nothing was created again. */
  already_sent: boolean;
  /** The draft was validated by this push (decision logged). */
  validated: boolean;
  error: string | null;
};

const fail = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`Envoi Notion : ${what} en échec (${error.message})`);
};

const strings = (value: Json | null): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const MOSCOW = new Set<string>(["must", "should", "could", "wont"]);

function moscowOf(value: Json): Enums<"moscow"> | null {
  const raw = typeof value === "string" ? value : (value as { value?: unknown } | null)?.value;
  return typeof raw === "string" && MOSCOW.has(raw) ? (raw as Enums<"moscow">) : null;
}

type ItemRow = Tables<"backlog_items">;

/**
 * Everything the Notion page shows, read from the base: the item, its epic, its insight and the
 * insight's final MoSCoW (Léa's override, else Signal's recommendation), its latest prototype.
 */
export async function loadNotionItem(
  db: Db,
  row: ItemRow,
  baseUrl: string,
): Promise<NotionBacklogItem> {
  const [epic, insight, override, score, prototype] = await Promise.all([
    row.epic_id
      ? db.from("epics").select("id, title").eq("id", row.epic_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.insight_id
      ? db.from("insights").select("id, title").eq("id", row.insight_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.insight_id
      ? db
          .from("overrides")
          .select("value")
          .eq("insight_id", row.insight_id)
          .eq("param", "moscow")
          .eq("active", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.insight_id
      ? db
          .from("scores")
          .select("moscow_reco")
          .eq("insight_id", row.insight_id)
          .eq("is_current", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("prototypes")
      .select("id, created_at")
      .eq("item_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  for (const [result, what] of [
    [epic, "lecture de l'epic"],
    [insight, "lecture de l'insight"],
    [override, "lecture du MoSCoW du PO"],
    [score, "lecture du score"],
    [prototype, "lecture du prototype"],
  ] as const)
    fail(result.error, what);
  const proto = (prototype.data ?? [])[0] as { id: string } | undefined;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    points: row.points,
    value: row.value,
    persona: row.persona,
    want: row.want,
    success_kpi: row.success_kpi,
    expected_behavior: row.expected_behavior,
    actual_behavior: row.actual_behavior,
    repro_steps: strings(row.repro_steps),
    severity: row.severity,
    affected_accounts: row.affected_accounts,
    objective: row.objective,
    definition_of_done: strings(row.definition_of_done),
    risks: strings(row.risks),
    business_rules: strings(row.business_rules),
    acceptance_criteria: (Array.isArray(row.acceptance_criteria)
      ? row.acceptance_criteria
      : []) as unknown as Scenario[],
    evidence: row.evidence,
    epic: epic.data ?? null,
    insight: insight.data ?? null,
    moscow:
      (override.data ? moscowOf(override.data.value) : null) ??
      (score.data?.moscow_reco as Enums<"moscow"> | null | undefined) ??
      null,
    prototype_url: proto ? signalUrl(baseUrl, `/proto/${proto.id}`) : null,
  };
}

async function loadRows(db: Db, ids: readonly string[]): Promise<Map<string, ItemRow>> {
  const { data, error } = await db
    .from("backlog_items")
    .select("*")
    .in("id", [...ids]);
  fail(error, "lecture des éléments");
  return new Map((data ?? []).map((r) => [r.id, r]));
}

/**
 * Items whose insight was rejected or merged: they are not sent, with what to do instead. Their
 * drafts stay in the backlog until Léa rejects them.
 */
async function deadInsightRefusals(db: Db, rows: readonly ItemRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.insight_id ? [r.insight_id] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("insights").select("id, status, merged_into").in("id", ids);
  fail(error, "lecture des insights");
  const dead = new Map(
    (data ?? [])
      .filter((i) => i.status === "rejete" || i.status === "fusionne")
      .map((i) => [i.id, i]),
  );
  const refusals = new Map<string, string>();
  for (const row of rows) {
    const insight = row.insight_id ? dead.get(row.insight_id) : undefined;
    if (!insight) continue;
    refusals.set(
      row.id,
      insight.status === "fusionne" && insight.merged_into
        ? `${row.id} ne part pas : ${insight.id} est fusionné dans ${insight.merged_into}. Rédige le backlog de ${insight.merged_into}, puis rejette ${row.id}.`
        : `${row.id} ne part pas : ${insight.id} est rejeté. Rejette ${row.id} dans le Backlog.`,
    );
  }
  return refusals;
}

/** Items a push targets: listed ids, or every item of an epic still to send (ADR-027). */
export type PushTarget = { item_ids?: readonly string[]; epic_id?: string };

/** At most 10 pages per push: one approval card stays readable. */
export const PUSH_MAX = 10;

/** A push that cannot be resolved (unknown epic, nothing left to send): shown as is. */
export class PushTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushTargetError";
  }
}

/**
 * The item ids of a push. For an epic: its drafts and validated items, in order; rejected and
 * already sent ones are left out. Resolved in code, never by the model (rule 9).
 */
export async function resolvePushIds(db: Db, target: PushTarget): Promise<string[]> {
  if (!target.epic_id)
    return [...new Set((target.item_ids ?? []).map((id) => id.trim().toUpperCase()))];
  const epicId = target.epic_id.trim().toUpperCase();
  const epic = await db.from("epics").select("id").eq("id", epicId).maybeSingle();
  fail(epic.error, "lecture de l'epic");
  if (!epic.data) throw new PushTargetError(`${epicId} introuvable.`);
  const { data, error } = await db
    .from("backlog_items")
    .select("id, status")
    .eq("epic_id", epicId)
    .order("id");
  fail(error, "lecture des éléments de l'epic");
  const ids = (data ?? [])
    .filter((r) => r.status === "brouillon" || r.status === "valide")
    .map((r) => r.id);
  if (ids.length === 0)
    throw new PushTargetError(`${epicId} n'a plus d'élément à envoyer (tous envoyés ou rejetés).`);
  if (ids.length > PUSH_MAX)
    throw new PushTargetError(
      `${epicId} a ${ids.length} éléments : envoie-les en deux fois (${PUSH_MAX} au plus).`,
    );
  return ids;
}

/** The approval card's content: each page as Notion will receive it (SPEC §10.6). */
export async function previewPush(
  db: Db,
  ids: readonly string[],
  baseUrl = process.env.APP_BASE_URL ?? "",
): Promise<string> {
  const rows = await loadRows(db, ids);
  const refusals = await deadInsightRefusals(db, [...rows.values()]);
  const parts = await Promise.all(
    ids.map(async (id) => {
      const row = rows.get(id);
      if (!row) return `${id} : introuvable dans le backlog.`;
      if (row.status === "envoye" || row.status === "modifie_notion")
        return `${id} : déjà envoyé (rien ne sera recréé).`;
      if (row.status === "rejete") return `${id} : rejeté, ne sera pas envoyé.`;
      const refusal = refusals.get(id);
      if (refusal) return refusal;
      const preview = backlogPagePreview(await loadNotionItem(db, row, baseUrl));
      return row.status === "brouillon" ? `${preview}\n(brouillon : validé par ton clic)` : preview;
    }),
  );
  return parts.join("\n\n");
}

/** Creates the page with its body (100 blocks per request); a half-created page is trashed. */
async function createPage(
  notion: NotionPort,
  dataSourceId: string,
  item: NotionBacklogItem,
  context: { baseUrl: string; validatedAt: Date },
) {
  const [first = [], ...rest] = chunk(backlogPageBlocks(item, context.baseUrl));
  const page = await notion.createPage({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: backlogPageProperties(item, context),
    children: first,
  });
  try {
    for (const batch of rest) await notion.appendBlocks(page.id, batch);
  } catch (error) {
    // Best effort: an incomplete page must not stay in the team's kanban.
    await notion.trashPage(page.id).catch(() => {});
    throw error;
  }
  return page;
}

async function pushOne(
  db: Db,
  row: ItemRow,
  deps: PushDeps,
  context: () => { notion: NotionPort; config: NonNullable<PushDeps["config"]> },
  /** Its insight was rejected or merged (deadInsightRefusals). */
  refusal: string | undefined,
): Promise<PushResult> {
  const base = {
    id: row.id,
    title: row.title,
    notion_page_id: row.notion_page_id,
    already_sent: false,
    validated: false,
  };
  if (row.status === "envoye" || row.status === "modifie_notion") {
    return { ...base, ok: true, already_sent: true, error: null };
  }
  if (row.status === "rejete") {
    return { ...base, ok: false, error: `${row.id} est rejeté : il ne part pas dans Notion.` };
  }
  // Checked before the validation: a refused draft stays a draft.
  if (refusal) return { ...base, ok: false, error: refusal };
  let validated = false;
  if (row.status === "brouillon") {
    // Léa's click is her validation (approval card or « Valider et envoyer »): logged as such.
    await reviewBacklogItem(db, row.id, "valide", { source: deps.source, now: deps.now });
    validated = true;
  }

  let pageId: string;
  let editedTime: string | null = null;
  const link = await db
    .from("notion_links")
    .select("notion_page_id")
    .eq("entity_type", "backlog_item")
    .eq("entity_id", row.id)
    .maybeSingle();
  fail(link.error, "lecture du lien Notion");
  try {
    if (link.data) {
      // Sent before but not marked (interrupted push): never a second page.
      pageId = link.data.notion_page_id;
    } else {
      const { notion, config } = context();
      if (!config.backlogDataSourceId) {
        throw new NotionError(
          "NOTION_DS_BACKLOG manque : lance « pnpm notion:setup » puis copie l'ID dans .env.",
        );
      }
      const item = await loadNotionItem(db, row, config.appBaseUrl);
      const page = await createPage(notion, config.backlogDataSourceId, item, {
        baseUrl: config.appBaseUrl,
        validatedAt: deps.now,
      });
      pageId = page.id;
      editedTime = page.last_edited_time;
      fail(
        (
          await db.from("notion_links").insert({
            entity_type: "backlog_item",
            entity_id: row.id,
            notion_page_id: pageId,
            data_source: "backlog",
            last_pushed_at: deps.now.toISOString(),
            last_notion_edited_time: editedTime,
          })
        ).error,
        "écriture du lien Notion",
      );
    }
  } catch (error) {
    const message = notionErrorMessage(error);
    fail(
      (
        await db
          .from("backlog_items")
          .update({ push_error: message, updated_at: deps.now.toISOString() })
          .eq("id", row.id)
      ).error,
      "enregistrement de l'erreur",
    );
    return { ...base, ok: false, validated, error: message };
  }

  fail(
    (
      await db
        .from("backlog_items")
        .update({
          status: "envoye",
          notion_page_id: pageId,
          push_error: null,
          updated_at: deps.now.toISOString(),
        })
        .eq("id", row.id)
    ).error,
    "passage en « envoyé »",
  );
  fail(
    (
      await db.from("decisions").insert({
        actor: "po",
        source: deps.source,
        entity_type: "backlog_item",
        entity_id: row.id,
        action: "validation",
        field: "notion",
        before: "valide",
        after: { status: "envoye", notion_page_id: pageId },
        reason: null,
      })
    ).error,
    "journalisation de l'envoi",
  );
  return { ...base, ok: true, validated, notion_page_id: pageId, error: null };
}

/**
 * Sends backlog items to Notion, one after the other. Each item gets its own result: a failure
 * on one (Notion down, invalid token) never blocks the others and is stored in push_error.
 */
export async function pushBacklogItems(
  db: Db,
  ids: readonly string[],
  deps: PushDeps,
): Promise<PushResult[]> {
  const withLock = deps.withLock ?? (<T>(fn: () => Promise<T>) => fn());
  // Notion is reached lazily: an unconfigured token becomes the item's push_error (CL-35).
  let resolved: { notion: NotionPort; config: NonNullable<PushDeps["config"]> } | null = null;
  const context = () => {
    if (!resolved) {
      const env = deps.config && deps.notion ? null : notionConfig();
      resolved = {
        config: deps.config ?? {
          backlogDataSourceId: env!.backlogDataSourceId,
          appBaseUrl: env!.appBaseUrl,
        },
        notion: deps.notion ?? notionPort(env!),
      };
    }
    return resolved;
  };
  return withLock(async () => {
    const rows = await loadRows(db, ids);
    const refusals = await deadInsightRefusals(db, [...rows.values()]);
    const results: PushResult[] = [];
    for (const id of [...new Set(ids)]) {
      const row = rows.get(id);
      results.push(
        row
          ? await pushOne(db, row, deps, context, refusals.get(id))
          : {
              id,
              title: null,
              ok: false,
              notion_page_id: null,
              already_sent: false,
              validated: false,
              error: `${id} introuvable dans le backlog.`,
            },
      );
    }
    return results;
  });
}

/** Léa refused the card: nothing is sent; the refusal is logged per item. */
export async function logPushRefusal(
  db: Db,
  args: unknown,
  source: "chat" | "signal_ui",
  reason?: string,
): Promise<string> {
  const raw = (args ?? {}) as { item_ids?: unknown };
  const ids = Array.isArray(raw.item_ids) ? raw.item_ids.map(String) : ["—"];
  const { data, error } = await db
    .from("decisions")
    .insert(
      ids.map((id) => ({
        actor: "po" as const,
        source,
        entity_type: "backlog_item",
        entity_id: id,
        action: "rejet" as const,
        field: "proposition_signal",
        before: null,
        after: { envoi_notion: false },
        reason: reason?.trim() || null,
      })),
    )
    .select("id");
  fail(error, "journalisation du refus");
  return (data ?? []).map((d) => d.id).join(", ");
}
