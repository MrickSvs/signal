// Generates the feedback datasets of the master scenario (SPEC §5) from data/scenario.yaml.
// The plan (scripts/lib/feedback-plan.ts) fixes everything that is ground truth; the model
// (role "generation") only writes subjects and texts, by batches of 10, with checks and retries.
// Texts are cached in .cache/ so that an interrupted run, or the preview, is never paid twice.
//
// Usage:
//   pnpm tsx scripts/generate-feedbacks.ts --preview            5 S1, 5 S3 and 2 E1 examples, no file written
//   pnpm tsx scripts/generate-feedbacks.ts [--dataset development|holdout|all]   (≈ 2,5 € for all)
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { loadContextPack } from "@/lib/context";
import { RunCost } from "@/lib/llm/cost";
import { invokeStructured } from "@/lib/llm/structured";
import { initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import { CUSTOMERS_FILE, type CustomerRow } from "./generate-customers";
import { parseCsv } from "./lib/csv";
import { buildPlan, type DatasetName, type PlannedFeedback } from "./lib/feedback-plan";
import { FEEDBACK_FILES, type Feedback, type GroundTruth } from "./lib/feedbacks";
import { loadScenario, type Scenario } from "./lib/scenario";

const BATCH_SIZE = 10;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const CACHE_DIR = path.join(process.cwd(), ".cache", "feedback-texts");

export type Written = { subject: string | null; raw_text: string };

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};
const SEGMENT_LABELS: Record<string, string> = {
  agence_com: "agence de communication",
  agence_digitale: "agence digitale",
  conseil: "cabinet de conseil",
  pme_services: "PME de services",
  hors_cible: "entreprise industrielle ou de commerce",
};
const SENTIMENT_LABELS = { "-1": "négatif", "0": "neutre", "1": "positif" } as const;

export function loadCustomers(): CustomerRow[] {
  return parseCsv(readFileSync(CUSTOMERS_FILE, "utf8")).map((r) => ({
    ...r,
    seats: Number(r.seats),
    mrr_eur: Number(r.mrr_eur),
    renewal_in_days: r.renewal_in_days === "" ? null : Number(r.renewal_in_days),
    plan: (r.plan || null) as CustomerRow["plan"],
    health: (r.health || null) as CustomerRow["health"],
    csm: r.csm || null,
  })) as CustomerRow[];
}

// ---------------------------------------------------------------------------
// Checks on a written feedback
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  { re: /\b(S[1-7]|S2a|S2b|S5a|S5b|E[1-8])\b/, why: "identifiant de pattern ou de cas limite" },
  { re: /\bpattern|scénario\b/i, why: "mot « pattern » ou « scénario »" },
  { re: /\b(19|20)\d\d\b/, why: "année" },
  {
    re: /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    why: "jour de la semaine",
  },
  {
    re: /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|june|july|august|september|october|november|december)\b/i,
    why: "nom de mois",
  },
  { re: /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/, why: "date absolue" },
  { re: /\bSignal\b/, why: "nom de l'agent Signal" },
];
const EN_WORDS = /\b(the|and|we|our|is|to|it|you|with|for)\b/gi;
const FR_WORDS = /\b(le|la|les|des|est|pour|nous|vous|une|pas|que|sur)\b/gi;

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/**
 * Six consecutive words of the brief's angle found in the text: the writer copied the angle,
 * which would plant a common keyword across feedbacks of a pattern (SPEC §5.4).
 */
export function copiedAngle(f: PlannedFeedback, text: string): string | null {
  const haystack = ` ${words(text).join(" ")} `;
  for (const item of f.items) {
    const angle = /Angle à exprimer : (.*)\.$/.exec(item.brief)?.[1];
    if (!angle) continue;
    const w = words(angle);
    for (let i = 0; i + 6 <= w.length; i++) {
      const gram = w.slice(i, i + 6).join(" ");
      if (haystack.includes(` ${gram} `)) return gram;
    }
  }
  return null;
}

export function writtenIssues(f: PlannedFeedback, w: Written): string[] {
  const issues: string[] = [];
  const all = `${w.subject ?? ""}\n${w.raw_text}`;
  for (const { re, why } of FORBIDDEN) {
    const m = all.match(re);
    if (m && !(f.is_injection && why === "nom de l'agent Signal"))
      issues.push(`${why} (« ${m[0]} »)`);
  }
  if (f.fixed_text === null && w.raw_text.trim().length === 0) issues.push("texte vide");
  if (f.has_subject && !w.subject?.trim()) issues.push("objet manquant");
  if (!f.has_subject && w.subject) issues.push("objet en trop pour ce canal");
  if (w.subject && w.subject.length > 140) issues.push("objet trop long");
  if (f.min_chars !== null && w.raw_text.length < f.min_chars) {
    issues.push(`texte trop court : ${w.raw_text.length} caractères, ${f.min_chars} attendus`);
  }
  if (f.min_chars === null && w.raw_text.length > 3000) issues.push("texte trop long");
  const en = (w.raw_text.match(EN_WORDS) ?? []).length;
  const fr = (w.raw_text.match(FR_WORDS) ?? []).length;
  if (f.language === "en" && en < 3) issues.push("devait être rédigé en anglais");
  if (f.language === "fr" && w.raw_text.length > 80 && en > fr)
    issues.push("devait être rédigé en français");
  const copied = copiedAngle(f, w.raw_text);
  if (copied) issues.push(`reprend l'angle de la fiche mot pour mot (« ${copied} »), reformule`);
  if (f.is_injection && !/ignore|consigne|instruction|priorit/i.test(w.raw_text)) {
    issues.push("la phrase adressée à l'IA manque");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function systemPrompt(product: string, holdout: boolean, devAngles: string[]): string {
  return `Tu écris des retours clients réalistes reçus par Jalon, un SaaS français de gestion de projet pour agences et PME de services. Ils servent de jeu de test : chaque retour est décrit par une fiche (canal, auteur, sujet à exprimer, ton, longueur), et tu écris son objet éventuel et son texte, exactement comme la personne l'aurait écrit.

Règles :
- Respecte chaque fiche : canal, auteur, langue, ton, sentiment visé, longueur en lignes, sujet(s) et consignes.
- La personne décrit ce qu'elle vit, avec ses mots, du point de vue d'un utilisateur. Elle ne connaît ni l'architecture ni les causes internes, et ne reprend jamais la formulation de la fiche.
- Varie vraiment : vocabulaire, structure, longueur, ponctuation. Pas de mot-clé commun forcé entre retours sur un même sujet. Pas de tics d'écriture d'IA (pas de « Je me permets de… » systématique, pas de listes à puces dans un message spontané, pas de conclusion moralisatrice).
- Réalisme : fautes occasionnelles quand la fiche le demande, signatures d'e-mail (prénom, nom, fonction, entreprise) pour les e-mails, historique d'échanges possible dans un ticket, notes internes télégraphiques, verbatims NPS courts, commentaires in-app d'une à quatre lignes.
- Aucune date absolue, aucun nom de jour de la semaine ni de mois, aucune année : utilise « depuis la dernière mise à jour », « depuis quelques jours », « la semaine dernière ».
- N'écris jamais les mots « pattern » ou « scénario », ni d'identifiant technique.
- N'ajoute aucune menace de départ, de résiliation ou de non-renouvellement si les consignes de la fiche ne le demandent pas ; à l'inverse, quand elles le demandent, rends-la claire.
- Le ton suit le sentiment visé : un retour négatif n'est pas enthousiaste (sauf ironie demandée).
- Objet : seulement pour les e-mails et les tickets (null sinon), court et naturel.
- Un retour du canal NPS est le commentaire libre qui accompagne la note donnée.
- Les notes internes (CSM, sales, Slack) sont écrites par l'équipe Jalon à propos du client.
${holdout ? `- Ce lot sert à une évaluation : invente des formulations neuves. N'utilise aucune des tournures suivantes, déjà employées ailleurs :\n${devAngles.map((a) => `  · ${a}`).join("\n")}\n` : ""}
Ce que fait Jalon aujourd'hui (pour que les clients en parlent de façon plausible) :
<produit>
${product}
</produit>`;
}

function brief(f: PlannedFeedback) {
  const author =
    f.author_role === "client"
      ? f.account
        ? `${f.author_name}, chez ${f.account.name} (${SEGMENT_LABELS[f.account.segment]}, ${f.account.seats} personnes, plan ${PLAN_LABELS[f.account.plan ?? ""] ?? "inconnu"})`
        : `${f.author_name}, écrit depuis une adresse personnelle`
      : `${f.author_name}, ${f.author_role === "csm" ? "CSM" : f.author_role === "sales" ? "équipe sales ou produit" : "équipe produit"} de Jalon${f.account ? `, à propos du compte ${f.account.name} (${f.account.status === "prospect" ? "prospect" : `plan ${PLAN_LABELS[f.account.plan ?? ""]}`}, ${f.account.seats} personnes)` : ""}`;
  return {
    key: f.key,
    canal: f.channel,
    objet: f.has_subject,
    longueur: f.min_chars
      ? `au moins ${f.min_chars} caractères`
      : `${f.lines[0]} à ${f.lines[1]} lignes`,
    auteur: author,
    langue: f.language === "en" ? "anglais" : "français",
    ton: f.style,
    sentiment: SENTIMENT_LABELS[String(f.sentiment_sign) as "-1" | "0" | "1"],
    ...(f.nps_score !== null ? { note_nps: `${f.nps_score}/10` } : {}),
    fautes: f.typos ? "quelques fautes de frappe ou d'accord" : "aucune",
    sujets: f.items.map((i) => i.brief),
    consignes: f.notes,
  };
}

const writtenSchema = z.object({
  feedbacks: z.array(
    z.object({
      key: z.string(),
      subject: z.string().nullable().describe("Objet (e-mail et ticket seulement), sinon null"),
      raw_text: z.string().describe("Texte du retour, tel qu'écrit par son auteur"),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Cache and batches
// ---------------------------------------------------------------------------

/** A cached text is reused only if both the planned feedback and the writer prompt are unchanged. */
const cacheKey = (f: PlannedFeedback, system: string) =>
  createHash("sha256").update(JSON.stringify({ f, system })).digest("hex").slice(0, 16);

function readCache(dataset: DatasetName): Record<string, Written> {
  const file = path.join(CACHE_DIR, `${dataset}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function writeCache(dataset: DatasetName, cache: Record<string, Written>) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path.join(CACHE_DIR, `${dataset}.json`), JSON.stringify(cache, null, 2));
}

async function writeBatch(
  batch: PlannedFeedback[],
  system: string,
  runCost: RunCost,
): Promise<Map<string, Written>> {
  let feedback = "";
  const done = new Map<string, Written>();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const todo = batch.filter((f) => !done.has(f.key));
    const { data } = await invokeStructured(
      "generation",
      writtenSchema,
      [
        new SystemMessage(system),
        new HumanMessage(
          `Écris ces ${todo.length} retours, un par fiche, avec la même clé.\n${JSON.stringify(todo.map(brief), null, 2)}${feedback}`,
        ),
      ],
      { name: "write-feedbacks", runCost, metadata: { keys: todo.map((f) => f.key).join(",") } },
    );
    const byKey = new Map(data.feedbacks.map((w) => [w.key, w]));
    const issues: string[] = [];
    for (const f of todo) {
      const w = byKey.get(f.key);
      const written = w
        ? { subject: w.subject?.trim() || null, raw_text: w.raw_text.trim() }
        : null;
      const problems = written ? writtenIssues(f, written) : ["retour manquant"];
      if (problems.length === 0) done.set(f.key, written!);
      else issues.push(`${f.key} : ${problems.join(" ; ")}`);
    }
    if (issues.length === 0) return done;
    console.warn(
      `  tentative ${attempt} : ${issues.length} retour(s) à réécrire\n    ${issues.join("\n    ")}`,
    );
    feedback = `\n\nUne version précédente de ces fiches a été rejetée pour ces raisons, corrige-les :\n- ${issues.join("\n- ")}`;
  }
  throw new Error(
    `Lot ${batch.map((f) => f.key).join(", ")} : invalide après ${MAX_ATTEMPTS} tentatives.`,
  );
}

/** Writes the texts of the given planned feedbacks, using and filling the cache. */
async function writeAll(
  dataset: DatasetName,
  planned: PlannedFeedback[],
  system: string,
  runCost: RunCost,
): Promise<Map<string, Written>> {
  const cache = readCache(dataset);
  const result = new Map<string, Written>();
  const todo: PlannedFeedback[] = [];
  for (const f of planned) {
    const cached = cache[cacheKey(f, system)];
    if (f.fixed_text !== null)
      result.set(f.key, { subject: f.has_subject ? "(sans objet)" : null, raw_text: f.fixed_text });
    else if (cached && writtenIssues(f, cached).length === 0) result.set(f.key, cached);
    else todo.push(f);
  }
  // Long threads alone; the others by batches of 10, mixed channels within a batch.
  const batches = [
    ...todo.filter((f) => f.min_chars !== null).map((f) => [f]),
    ...chunk(
      todo.filter((f) => f.min_chars === null),
      BATCH_SIZE,
    ),
  ];
  console.log(
    `${dataset} : ${result.size} retours déjà écrits, ${todo.length} à écrire en ${batches.length} lots.`,
  );
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const written = await writeBatch(batch, system, runCost);
      for (const f of batch) {
        result.set(f.key, written.get(f.key)!);
        cache[cacheKey(f, system)] = written.get(f.key)!;
      }
      writeCache(dataset, cache);
      console.log(
        `  lot ${batch[0].key}… écrit (${result.size}/${planned.length}, ${runCost.eur.toFixed(2)} €)`,
      );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export function toFeedback(f: PlannedFeedback & { id: string }, w: Written): Feedback {
  return {
    id: f.id,
    channel: f.channel,
    source_type: f.source_type,
    author_name: f.author_name,
    author_email: f.author_email,
    customer_id: f.customer_id,
    days_ago: f.days_ago,
    subject: f.has_subject ? w.subject : null,
    raw_text: w.raw_text,
    nps_score: f.nps_score,
    language: f.language,
  };
}

export function toGroundTruth(f: PlannedFeedback & { id: string }): GroundTruth {
  return {
    feedback_id: f.id,
    patterns: [...new Set(f.items.map((i) => i.pattern_id))],
    edge_cases: f.edge_cases,
    expected_items: f.items.map((i) => ({
      pattern_id: i.pattern_id,
      topic: i.topic,
      expected_type: i.expected_type,
      acceptable_types: i.acceptable_types,
      expected_area: i.expected_area,
      acceptable_areas: i.acceptable_areas,
      existing_feature: i.existing_feature,
    })),
    expected_sentiment_sign: f.sentiment_sign,
    is_injection: f.is_injection,
    churn_signal: f.churn_signal,
  };
}

function devAngles(scenario: Scenario): string[] {
  return Object.values(scenario.patterns).flatMap((p) => p.angles ?? []);
}

async function generate(
  dataset: DatasetName,
  scenario: Scenario,
  product: string,
  runCost: RunCost,
) {
  const plan = buildPlan(scenario, loadCustomers(), dataset);
  const system = systemPrompt(product, dataset === "holdout", devAngles(scenario));
  const written = await writeAll(dataset, plan.feedbacks, system, runCost);
  const ordered = [...plan.feedbacks].sort((a, b) => a.id.localeCompare(b.id));
  const files = FEEDBACK_FILES[dataset];
  mkdirSync(path.dirname(files.truth), { recursive: true });
  writeFileSync(
    files.data,
    `${JSON.stringify(
      ordered.map((f) => toFeedback(f, written.get(f.key)!)),
      null,
      2,
    )}\n`,
  );
  writeFileSync(files.truth, `${JSON.stringify(ordered.map(toGroundTruth), null, 2)}\n`);
  console.log(
    `${dataset} : ${ordered.length} retours → ${path.relative(process.cwd(), files.data)}`,
  );
}

/** Examples to validate before the full generation (PLAN 1.4): 5 S1, 5 S3, 2 E1. */
export function previewSelection<T extends PlannedFeedback>(planned: T[]): T[] {
  const single = (id: string) =>
    planned.filter(
      (f) => f.items.length === 1 && f.edge_cases.length === 0 && f.items[0].pattern_id === id,
    );
  const varied = (list: T[]) => {
    const picked: T[] = [];
    for (const f of list)
      if (!picked.some((p) => p.channel === f.channel) && picked.length < 5) picked.push(f);
    for (const f of list) if (!picked.includes(f) && picked.length < 5) picked.push(f);
    return picked;
  };
  return [
    ...varied(single("S1")),
    ...varied(single("S3")),
    ...planned.filter((f) => f.edge_cases.includes("E1")).slice(0, 2),
  ];
}

async function preview(scenario: Scenario, product: string, runCost: RunCost) {
  const plan = buildPlan(scenario, loadCustomers(), "development");
  const selection = previewSelection(plan.feedbacks);
  const written = await writeAll(
    "development",
    selection,
    systemPrompt(product, false, []),
    runCost,
  );
  for (const f of selection) {
    const w = written.get(f.key)!;
    console.log(
      `\n━━━ ${f.id} · ${f.items.map((i) => i.pattern_id).join(" + ")} · ${f.channel} · ${f.account?.name ?? "sans compte"} · J-${f.days_ago}${f.nps_score !== null ? ` · NPS ${f.nps_score}` : ""}`,
    );
    console.log(`De : ${f.author_name} <${f.author_email}>`);
    if (w.subject) console.log(`Objet : ${w.subject}`);
    console.log(w.raw_text);
  }
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  initTracing();
  const args = process.argv.slice(2);
  const scenario = loadScenario();
  const { documents } = await loadContextPack();
  const runCost = new RunCost();
  const datasets: DatasetName[] = args.includes("--dataset")
    ? args[args.indexOf("--dataset") + 1] === "all"
      ? ["development", "holdout"]
      : [args[args.indexOf("--dataset") + 1] as DatasetName]
    : ["development", "holdout"];

  await withTrace(
    "generate-feedbacks",
    { runId: randomUUID(), step: "generation", tags: ["data"] },
    { args },
    async () => {
      if (args.includes("--preview")) await preview(scenario, documents.product, runCost);
      else for (const d of datasets) await generate(d, scenario, documents.product, runCost);
    },
  );
  console.log(`\nCoût : ${runCost.eur.toFixed(3)} €`);
  await shutdownTracing();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
