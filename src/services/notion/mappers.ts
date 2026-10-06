// Backlog item → Notion page (SPEC §11.1, §9, CL-41), pure: the properties of the Backlog data
// source and the blocks of the page body, in the format of the item's type. Long texts are cut in
// rich text objects of 2 000 characters at most, page bodies in batches of 100 blocks at most, and
// every link to Signal is built from APP_BASE_URL.
import type {
  BlockObjectRequest,
  CreateDatabaseParameters,
  CreatePageParameters,
} from "@notionhq/client";
import { storyPart, type Scenario } from "@/lib/backlog/draft";
import type { Enums } from "@/lib/db/types";
import { BACKLOG_KIND_LABELS, MOSCOW_LABELS } from "@/lib/labels";

/** Notion API limits (developers.notion.com/reference/request-limits). */
export const RICH_TEXT_MAX = 2000;
export const BLOCKS_PER_REQUEST = 100;
const RICH_TEXT_ITEMS_MAX = 100;

export const BACKLOG_DATABASE_TITLE = "Backlog";
export const NOTION_STATUSES = ["Prêt", "En cours", "En revue", "Fait"] as const;
export const NOTION_SENT_STATUS = "Prêt";

/** Properties of the Backlog data source (SPEC §11.1); Type and Statut are selects. */
export const BACKLOG_PROPERTIES = {
  Nom: { title: {} },
  ID: { rich_text: {} },
  Type: {
    select: {
      options: [
        { name: "Story", color: "blue" },
        { name: "Bug", color: "red" },
        { name: "Tâche", color: "gray" },
      ],
    },
  },
  Statut: {
    select: {
      options: [
        { name: "Prêt", color: "default" },
        { name: "En cours", color: "blue" },
        { name: "En revue", color: "purple" },
        { name: "Fait", color: "green" },
      ],
    },
  },
  Epic: { rich_text: {} },
  Insight: { rich_text: {} },
  MoSCoW: {
    select: {
      options: [
        { name: "Must", color: "red" },
        { name: "Should", color: "orange" },
        { name: "Could", color: "yellow" },
        { name: "Won't", color: "gray" },
      ],
    },
  },
  Points: { number: { format: "number" } },
  Énoncé: { rich_text: {} },
  Prototype: { url: {} },
  "Lien Signal": { url: {} },
  "Validé le": { date: {} },
} satisfies NonNullable<CreateDatabaseParameters["initial_data_source"]>["properties"];

export type BacklogPropertyName = keyof typeof BACKLOG_PROPERTIES;

/** What the page is built from: the stored item plus its epic, insight and final MoSCoW. */
export type NotionBacklogItem = {
  id: string;
  kind: Enums<"backlog_kind">;
  title: string;
  points: number | null;
  value: string | null;
  persona: string | null;
  want: string | null;
  success_kpi: string | null;
  expected_behavior: string | null;
  actual_behavior: string | null;
  repro_steps: string[];
  severity: Enums<"bug_severity"> | null;
  affected_accounts: string[];
  objective: string | null;
  definition_of_done: string[];
  risks: string[];
  business_rules: string[];
  acceptance_criteria: Scenario[];
  evidence: string[];
  epic: { id: string; title: string } | null;
  insight: { id: string; title: string } | null;
  moscow: Enums<"moscow"> | null;
  prototype_url: string | null;
};

type RichText = { type: "text"; text: { content: string; link?: { url: string } | null } } & {
  annotations?: { bold?: boolean; code?: boolean };
};

/** Cuts a text in pieces of `max` characters at most, on a space when there is one nearby. */
export function splitText(text: string, max = RICH_TEXT_MAX): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest); // never empty, unless the text itself is
  return pieces;
}

/** A text as rich text objects of 2 000 characters at most (CL-41). */
export function richText(
  text: string,
  options: { bold?: boolean; code?: boolean; link?: string } = {},
): RichText[] {
  const annotations =
    options.bold || options.code ? { bold: options.bold, code: options.code } : undefined;
  return splitText(text)
    .slice(0, RICH_TEXT_ITEMS_MAX)
    .map((content) => ({
      type: "text",
      text: { content, ...(options.link ? { link: { url: options.link } } : {}) },
      ...(annotations ? { annotations } : {}),
    }));
}

/** Batches of `size` at most (page bodies: 100 blocks per request, CL-41). */
export function chunk<T>(items: readonly T[], size = BLOCKS_PER_REQUEST): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** An absolute link to a screen of Signal. */
export function signalUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/** « Afin de …, en tant que …, je veux … » ; the observed behavior ; the objective. */
export function statement(item: NotionBacklogItem): string {
  switch (item.kind) {
    case "story":
      return `Afin de ${storyPart("value", item.value)}, en tant que ${storyPart("persona", item.persona)}, je veux ${storyPart("want", item.want)}.`;
    case "bug":
      return item.actual_behavior ?? "";
    case "tache":
      return item.objective ?? "";
  }
}

const label = (ref: { id: string; title: string }) => `${ref.id} · ${ref.title}`;

/** Properties of the page in the Backlog data source; it is born « Prêt » (SPEC §11.2). */
export function backlogPageProperties(
  item: NotionBacklogItem,
  context: { baseUrl: string; validatedAt: Date },
): NonNullable<CreatePageParameters["properties"]> {
  return {
    Nom: { title: richText(item.title) },
    ID: { rich_text: richText(item.id) },
    Type: { select: { name: BACKLOG_KIND_LABELS[item.kind] } },
    Statut: { select: { name: NOTION_SENT_STATUS } },
    Epic: { rich_text: item.epic ? richText(label(item.epic)) : [] },
    Insight: { rich_text: item.insight ? richText(label(item.insight)) : [] },
    MoSCoW: { select: item.moscow ? { name: MOSCOW_LABELS[item.moscow] } : null },
    Points: { number: item.points },
    Énoncé: { rich_text: richText(statement(item)) },
    Prototype: { url: item.prototype_url },
    "Lien Signal": { url: signalUrl(context.baseUrl, `/backlog?element=${item.id}`) },
    "Validé le": { date: { start: context.validatedAt.toISOString() } },
  } satisfies Record<BacklogPropertyName, unknown>;
}

// ---------------------------------------------------------------------------
// Page body
// ---------------------------------------------------------------------------

const heading = (text: string): BlockObjectRequest => ({
  type: "heading_2",
  heading_2: { rich_text: richText(text) },
});

const paragraph = (rich: RichText[]): BlockObjectRequest => ({
  type: "paragraph",
  paragraph: { rich_text: rich },
});

const bullets = (lines: readonly string[]): BlockObjectRequest[] =>
  lines.map((line) => ({
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(line) },
  }));

const numbered = (lines: readonly string[]): BlockObjectRequest[] =>
  lines.map((line) => ({
    type: "numbered_list_item",
    numbered_list_item: { rich_text: richText(line) },
  }));

const SEVERITY_LABELS = { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" } as const;

/** One Gherkin scenario: its name in bold, then one line per step with the keyword in bold. */
function scenarioBlocks(scenario: Scenario): BlockObjectRequest[] {
  const name = `Scénario${scenario.edge_case ? " (cas limite)" : ""} : ${scenario.name}`;
  return [
    paragraph(richText(name, { bold: true })),
    ...scenario.steps.map((step) =>
      paragraph([...richText(`${step.keyword} `, { bold: true }), ...richText(step.text)]),
    ),
  ];
}

function evidenceBlocks(item: NotionBacklogItem, baseUrl: string): BlockObjectRequest[] {
  if (item.evidence.length === 0) return [];
  const rich = item.evidence.flatMap((id, i) => [
    ...(i > 0 ? richText(", ") : []),
    ...richText(id, { link: signalUrl(baseUrl, `/retours?retour=${id}`) }),
  ]);
  return [heading("Preuves"), paragraph(rich.slice(0, RICH_TEXT_ITEMS_MAX))];
}

/** The page body in the format of the item's type (SPEC §9.1 to §9.3), evidence last. */
export function backlogPageBlocks(item: NotionBacklogItem, baseUrl: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  const criteria = () =>
    item.acceptance_criteria.length > 0
      ? [heading("Critères d'acceptation"), ...item.acceptance_criteria.flatMap(scenarioBlocks)]
      : [];
  switch (item.kind) {
    case "story":
      blocks.push(
        paragraph([
          ...richText("Afin de ", { bold: true }),
          ...richText(`${storyPart("value", item.value)}, `),
          ...richText("en tant que ", { bold: true }),
          ...richText(`${storyPart("persona", item.persona)}, `),
          ...richText("je veux ", { bold: true }),
          ...richText(`${storyPart("want", item.want)}.`),
        ]),
      );
      if (item.business_rules.length > 0)
        blocks.push(heading("Règles de gestion"), ...bullets(item.business_rules));
      blocks.push(...criteria());
      if (item.success_kpi)
        blocks.push(heading("KPI de succès"), paragraph(richText(item.success_kpi)));
      break;
    case "bug":
      blocks.push(
        paragraph([
          ...richText("Sévérité : ", { bold: true }),
          ...richText(item.severity ? SEVERITY_LABELS[item.severity] : "—"),
          ...richText(` · comptes touchés : ${item.affected_accounts.length}`),
        ]),
        heading("Comportement attendu"),
        paragraph(richText(item.expected_behavior ?? "")),
        heading("Comportement constaté"),
        paragraph(richText(item.actual_behavior ?? "")),
      );
      if (item.repro_steps.length > 0)
        blocks.push(heading("Étapes de reproduction"), ...numbered(item.repro_steps));
      blocks.push(...criteria());
      break;
    case "tache":
      blocks.push(heading("Objectif"), paragraph(richText(item.objective ?? "")));
      if (item.definition_of_done.length > 0)
        blocks.push(heading("Définition de terminé"), ...bullets(item.definition_of_done));
      if (item.risks.length > 0) blocks.push(heading("Risques"), ...bullets(item.risks));
      break;
  }
  blocks.push(...evidenceBlocks(item, baseUrl));
  return blocks;
}

/** The page as plain text (approval card, SPEC §10.6): what Léa sees is what Notion receives. */
export function backlogPagePreview(item: NotionBacklogItem): string {
  const lines = [
    `${item.id} · ${BACKLOG_KIND_LABELS[item.kind]} · ${item.title}`,
    [
      `Statut ${NOTION_SENT_STATUS}`,
      item.points === null ? "non estimé" : `${item.points} points`,
      item.moscow ? MOSCOW_LABELS[item.moscow] : null,
      item.epic ? `epic ${item.epic.id}` : null,
      item.insight ? `insight ${item.insight.id}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    statement(item),
  ];
  const sections: [string, number][] = [
    ["règles", item.kind === "story" ? item.business_rules.length : 0],
    ["scénarios", item.kind === "tache" ? 0 : item.acceptance_criteria.length],
    ["étapes de reproduction", item.kind === "bug" ? item.repro_steps.length : 0],
    ["critères de terminé", item.kind === "tache" ? item.definition_of_done.length : 0],
    ["preuves", item.evidence.length],
  ];
  const body = sections.filter(([, n]) => n > 0).map(([what, n]) => `${n} ${what}`);
  if (body.length) lines.push(`Corps : ${body.join(", ")}.`);
  return lines.join("\n");
}
