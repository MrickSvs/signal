// Notion setup (PLAN 5.1, SPEC §11.1, ADR-026): the Backlog base under NOTION_PARENT_PAGE_ID,
// with its properties (Type and Statut as selects) and a kanban view grouped by Statut.
// Idempotent: when NOTION_DS_BACKLOG answers, nothing is created; missing properties are added.
// Usage: pnpm notion:setup
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { APIErrorCode, isNotionClientError, type Client } from "@notionhq/client";
import { notionClient, notionConfig, notionErrorMessage } from "@/services/notion/client";
import {
  BACKLOG_DATABASE_TITLE,
  BACKLOG_PROPERTIES,
  richText,
  type BacklogPropertyName,
} from "@/services/notion/mappers";

/** Properties of SPEC §11.1 that the data source lacks (pure). */
export function missingProperties(existing: readonly string[]): BacklogPropertyName[] {
  const have = new Set(existing);
  return (Object.keys(BACKLOG_PROPERTIES) as BacklogPropertyName[]).filter((p) => !have.has(p));
}

async function checkExisting(client: Client, dataSourceId: string): Promise<void> {
  const source = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  if (!("properties" in source)) throw new Error("Data source Backlog illisible.");
  const missing = missingProperties(Object.keys(source.properties));
  if (missing.length === 0) {
    console.log(`Base Backlog déjà en place (${dataSourceId}) : rien à créer.`);
    return;
  }
  // The title property cannot be added: an existing base keeps its own.
  const addable = missing.filter((p) => p !== "Nom");
  await client.dataSources.update({
    data_source_id: dataSourceId,
    properties: Object.fromEntries(addable.map((p) => [p, BACKLOG_PROPERTIES[p]])),
  });
  console.log(`Base Backlog complétée : ${addable.join(", ")} ajoutée(s).`);
  if (missing.includes("Nom"))
    console.warn("La propriété titre ne s'appelle pas « Nom » : renomme-la dans Notion.");
}

async function createBacklog(client: Client, parentPageId: string): Promise<string> {
  try {
    await client.pages.retrieve({ page_id: parentPageId });
  } catch (error) {
    if (
      isNotionClientError(error) &&
      (error.code === APIErrorCode.ObjectNotFound || error.code === APIErrorCode.RestrictedResource)
    ) {
      throw new Error(
        "Page parente introuvable : partage « Jalon — Produit (Signal) » avec l'intégration (••• → Connexions) et vérifie NOTION_PARENT_PAGE_ID.",
      );
    }
    throw error;
  }
  const database = await client.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: richText(BACKLOG_DATABASE_TITLE),
    initial_data_source: { properties: BACKLOG_PROPERTIES },
  });
  const dataSourceId = "data_sources" in database ? database.data_sources[0]?.id : undefined;
  if (!dataSourceId) throw new Error("Notion n'a pas renvoyé de data source pour la base.");

  // Kanban grouped by Statut; if the views API refuses, the README explains the manual way.
  try {
    const source = await client.dataSources.retrieve({ data_source_id: dataSourceId });
    const statut = "properties" in source ? source.properties.Statut?.id : undefined;
    if (!statut) throw new Error("propriété Statut absente");
    await client.views.create({
      data_source_id: dataSourceId,
      database_id: database.id,
      name: "Kanban",
      type: "board",
      configuration: {
        type: "board",
        group_by: { type: "select", property_id: statut, sort: { type: "manual" } },
      },
    });
    console.log("Vue « Kanban » créée, groupée par Statut.");
  } catch (error) {
    console.warn(
      `Vue kanban non créée (${notionErrorMessage(error)}) : crée-la à la main (README, section Notion).`,
    );
  }
  return dataSourceId;
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = notionConfig();
  const client = notionClient(config);
  if (config.backlogDataSourceId) {
    await checkExisting(client, config.backlogDataSourceId);
    return;
  }
  if (!config.parentPageId) throw new Error("NOTION_PARENT_PAGE_ID manque dans .env.");
  const dataSourceId = await createBacklog(client, config.parentPageId);
  console.log("\nBase Backlog créée. Ajoute dans .env (et sur Vercel) :");
  console.log(`NOTION_DS_BACKLOG=${dataSourceId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(
      error instanceof Error && !isNotionClientError(error)
        ? error.message
        : notionErrorMessage(error),
    );
    process.exit(1);
  });
}
