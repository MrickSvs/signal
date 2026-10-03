// Generates data/reference_tickets.json: 40 tickets shipped by the Jalon team (SPEC §8.4).
// Everything numeric is planned in code (module, components, estimated and actual points, days,
// delivery date) so that the team's biases are deterministic and measurable; the tickets already
// cited in the context pack (T-104, T-108, T-112, T-117, T-121, T-124) and T-130 are written by hand.
// The model (role "generation") only writes title, description and surprises of the other slots.
// Usage: pnpm tsx scripts/generate-reference-tickets.ts (≈ 0,15 €)
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { loadContextPack, parseArchitectureModules } from "@/lib/context";
import { RunCost } from "@/lib/llm/cost";
import { invokeStructured } from "@/lib/llm/structured";
import { initTracing, shutdownTracing, withTrace } from "@/lib/llm/tracing";
import { createRandom } from "./lib/random";
import {
  biasByComponent,
  REFERENCE_TICKETS_FILE,
  referenceTicketsSchema,
  TICKET_POINTS,
  type ReferenceTicket,
} from "./lib/reference-tickets";

const SEED = 20261003;
const BATCH_SIZE = 17;
const MAX_ATTEMPTS = 3;

type Planned = Pick<
  ReferenceTicket,
  "id" | "module" | "components" | "estimated_points" | "actual_points"
>;
type Written = Pick<ReferenceTicket, "title" | "description" | "surprises">;
type Slot = Planned & ({ theme: string } | { written: Written });

// prettier-ignore
export const TICKET_PLAN: Slot[] = [
  { id: "T-101", module: "taches", components: ["taches"], estimated_points: 8, actual_points: 8, theme: "Assigner une tâche à plusieurs membres (le champ assigné devient une liste, avec migration des données)" },
  { id: "T-102", module: "liste", components: ["liste"], estimated_points: 3, actual_points: 3, theme: "Filtre par assigné dans la vue liste" },
  { id: "T-103", module: "permissions", components: ["permissions"], estimated_points: 2, actual_points: 3, theme: "Réserver la suppression d'un projet au propriétaire de l'espace (le rôle admin n'existe pas encore)" },
  {
    id: "T-104", module: "notifications", components: ["notifications", "parametres"], estimated_points: 5, actual_points: 5,
    written: {
      title: "Ajouter la préférence « digest quotidien » aux notifications",
      description: "Permettre à chaque membre de choisir entre un e-mail par événement et un récapitulatif quotidien. Nouvelle préférence dans les paramètres du compte, envoi groupé chaque matin par la file de tâches.",
      surprises: "Estimation tenue. Pour ne pas migrer tous les comptes d'un coup, la nouvelle préférence a été ajoutée à côté de l'ancienne, avec une reprise prévue plus tard : les deux champs coexistent depuis.",
    },
  },
  { id: "T-105", module: "champs_personnalises", components: ["champs_personnalises"], estimated_points: 5, actual_points: 5, theme: "Ajouter le type date aux champs personnalisés (après texte et nombre)" },
  { id: "T-106", module: "tableau", components: ["tableau"], estimated_points: 2, actual_points: 2, theme: "Réordonner les cartes à l'intérieur d'une colonne du kanban" },
  { id: "T-107", module: "parametres", components: ["parametres"], estimated_points: 2, actual_points: 2, theme: "Renommer un projet et modifier sa description depuis ses paramètres, sans passer par le propriétaire de l'espace" },
  {
    id: "T-108", module: "notifications", components: ["notifications"], estimated_points: 2, actual_points: 2,
    written: {
      title: "Corriger le double envoi des rappels d'échéance sur les tâches à plusieurs assignés",
      description: "Quand une tâche avait plusieurs assignés, chacun recevait le rappel d'échéance une fois par assigné. Dédoublonnage des destinataires avant l'envoi du rappel.",
      surprises: "Aucune : cause trouvée dès le premier jour, correctif localisé dans le module de notifications, tests d'envoi ajoutés.",
    },
  },
  { id: "T-109", module: "taches", components: ["taches"], estimated_points: 5, actual_points: 5, theme: "Sous-tâches sous forme de checklist dans le détail d'une tâche" },
  { id: "T-110", module: "export", components: ["export", "liste"], estimated_points: 1, actual_points: 2, theme: "L'export CSV ignorait les filtres actifs de la vue liste" },
  { id: "T-111", module: "liste", components: ["liste"], estimated_points: 2, actual_points: 2, theme: "Trier la vue liste par échéance ou par date de création" },
  {
    id: "T-112", module: "export", components: ["export", "permissions"], estimated_points: 2, actual_points: 3,
    written: {
      title: "Bloquer l'export CSV pour les membres désactivés",
      description: "Un membre désactivé pouvait encore télécharger l'export d'un projet depuis une session restée ouverte. Vérification du statut du membre avant la génération du fichier.",
      surprises: "Sous-estimé : l'export avait son propre contrôle d'accès, distinct de celui des écrans. Il a fallu le reprendre à part, et la recette a révélé un second chemin d'export oublié.",
    },
  },
  { id: "T-113", module: "notifications", components: ["notifications"], estimated_points: 1, actual_points: 1, theme: "Corriger le lien vers la tâche dans l'e-mail de nouveau commentaire" },
  { id: "T-114", module: "tableau", components: ["tableau", "taches"], estimated_points: 3, actual_points: 3, theme: "Changer le statut d'une tâche en glissant sa carte d'une colonne à l'autre" },
  { id: "T-115", module: "champs_personnalises", components: ["champs_personnalises", "liste"], estimated_points: 3, actual_points: 5, theme: "Afficher les champs personnalisés en colonnes dans la vue liste" },
  { id: "T-116", module: "taches", components: ["taches"], estimated_points: 2, actual_points: 3, theme: "Limite de taille des pièces jointes et message d'erreur clair" },
  {
    id: "T-117", module: "permissions", components: ["permissions", "parametres"], estimated_points: 5, actual_points: 8,
    written: {
      title: "Distinguer le rôle admin du propriétaire de l'espace",
      description: "Jusqu'ici, seul le créateur de l'espace pouvait gérer les membres. Création du rôle admin, attribuable à plusieurs membres depuis les paramètres, avec les droits de gestion de l'espace.",
      surprises: "Sous-estimé : les contrôles d'accès étaient répartis dans cinq écrans et dans l'export, chacun avec sa propre condition. Deux écrans oubliés ont été rattrapés en recette, puis il a fallu migrer les espaces existants.",
    },
  },
  { id: "T-118", module: "parametres", components: ["parametres"], estimated_points: 3, actual_points: 3, theme: "Page de gestion des membres de l'espace : liste, recherche, désactivation" },
  { id: "T-119", module: "notifications", components: ["notifications"], estimated_points: 3, actual_points: 2, theme: "E-mail de rappel la veille de l'échéance d'une tâche" },
  { id: "T-120", module: "export", components: ["export", "champs_personnalises"], estimated_points: 3, actual_points: 5, theme: "Inclure les champs personnalisés dans l'export CSV" },
  {
    id: "T-121", module: "tableau", components: ["tableau"], estimated_points: 3, actual_points: 5,
    written: {
      title: "Afficher les compteurs de commentaires et de pièces jointes sur les cartes du kanban",
      description: "Chaque carte du tableau montre le nombre de commentaires et de pièces jointes de sa tâche, pour repérer d'un coup d'œil les tâches actives.",
      surprises: "Plus long que prévu : une requête par carte faisait ramer les gros tableaux, dont le rendu n'est pas virtualisé. Il a fallu regrouper les compteurs en une seule requête par tableau.",
    },
  },
  { id: "T-122", module: "taches", components: ["taches"], estimated_points: 2, actual_points: 1, theme: "Dupliquer une tâche" },
  { id: "T-123", module: "permissions", components: ["permissions"], estimated_points: 3, actual_points: 5, theme: "Masquer aux simples membres les actions réservées aux admins dans le détail de tâche et le tableau" },
  {
    id: "T-124", module: "export", components: ["export", "permissions"], estimated_points: 3, actual_points: 5,
    written: {
      title: "Lien de téléchargement de l'export CSV réservé aux membres",
      description: "Après un export, le membre peut copier un lien vers le fichier pour un collègue. Le lien est valable 7 jours et ne s'ouvre que pour un membre connecté de l'espace.",
      surprises: "Sous-estimé : le lien a demandé son propre contrôle d'accès (membre connecté, bon espace, expiration), en plus de celui de l'export, et il n'existait aucun stockage pour les fichiers générés.",
    },
  },
  { id: "T-125", module: "champs_personnalises", components: ["champs_personnalises"], estimated_points: 2, actual_points: 2, theme: "Valider le format du champ nombre (décimales, séparateur, valeurs négatives)" },
  { id: "T-126", module: "liste", components: ["liste"], estimated_points: 5, actual_points: 5, theme: "Pagination et chargement progressif de la vue liste" },
  { id: "T-127", module: "tableau", components: ["tableau"], estimated_points: 5, actual_points: 8, theme: "Colonnes du kanban repliables, avec le nombre de cartes de chaque colonne" },
  { id: "T-128", module: "notifications", components: ["notifications"], estimated_points: 2, actual_points: 3, theme: "Ne plus notifier un membre de ses propres actions" },
  { id: "T-129", module: "parametres", components: ["parametres"], estimated_points: 1, actual_points: 1, theme: "Archiver et désarchiver un projet depuis ses paramètres" },
  {
    id: "T-130", module: "permissions", components: ["permissions"], estimated_points: 3, actual_points: 8,
    written: {
      title: "Journaliser les changements de rôle des membres",
      description: "Chaque passage d'un membre à admin, ou l'inverse, est enregistré avec son auteur, la personne concernée et le rôle avant et après, pour que le support puisse répondre aux questions d'accès.",
      surprises: "Sous-estimé : aucun journal n'existait et les changements de rôle passaient par plusieurs chemins, chacun avec son propre contrôle. Chacun a dû être retrouvé et branché sur le journal, dont deux découverts en recette.",
    },
  },
  { id: "T-131", module: "taches", components: ["taches"], estimated_points: 3, actual_points: 5, theme: "Le brouillon d'un commentaire était perdu en passant d'une tâche à l'autre" },
  { id: "T-132", module: "export", components: ["export"], estimated_points: 5, actual_points: 8, theme: "Accélérer l'export CSV des projets de plus de 2 000 tâches, qui expirait" },
  { id: "T-133", module: "champs_personnalises", components: ["champs_personnalises", "taches"], estimated_points: 3, actual_points: 3, theme: "Réordonner les champs personnalisés d'un projet dans le formulaire de tâche" },
  { id: "T-134", module: "tableau", components: ["tableau"], estimated_points: 1, actual_points: 1, theme: "Corriger le défilement horizontal du kanban sur les petits écrans" },
  { id: "T-135", module: "liste", components: ["liste"], estimated_points: 1, actual_points: 1, theme: "Le filtre par échéance ignorait le fuseau horaire du membre" },
  { id: "T-136", module: "permissions", components: ["permissions"], estimated_points: 2, actual_points: 2, theme: "Empêcher de retirer le dernier admin d'un espace" },
  { id: "T-137", module: "permissions", components: ["permissions", "taches"], estimated_points: 5, actual_points: 8, theme: "Vérifier les droits de l'espace avant le téléchargement d'une pièce jointe" },
  { id: "T-138", module: "notifications", components: ["notifications"], estimated_points: 2, actual_points: 2, theme: "Lien de désinscription en un clic dans le pied des e-mails de notification" },
  { id: "T-139", module: "taches", components: ["taches", "tableau"], estimated_points: 2, actual_points: 2, theme: "Ajouter le statut « en revue » aux tâches, avec sa colonne dans le kanban" },
  { id: "T-140", module: "parametres", components: ["parametres"], estimated_points: 2, actual_points: 2, theme: "Changer l'adresse e-mail de son compte, avec confirmation" },
];

/** Topics that would solve a scenario problem or describe a capability Jalon does not have (product.md). */
export const FORBIDDEN_TOPICS =
  /gantt|timeline|chronologie|date de début|dépendance|invit|client final|portail|partag|pdf|excel|tableau de bord|suivi du temps|temps passé|factur|virtualis|liste déroulante|formule|in-app|slack|mobile|digest|par projet/i;
const ABSOLUTE_DATES =
  /\b(19|20)\d\d\b|\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i;

const crans = (from: number, to: number) =>
  (TICKET_POINTS as readonly number[]).indexOf(to) -
  (TICKET_POINTS as readonly number[]).indexOf(from);

function direction(slot: Planned): string {
  const gap = crans(slot.estimated_points, slot.actual_points);
  if (gap === 0) return "estimation tenue";
  if (gap < 0) return "surestimé : livré plus vite que prévu";
  return `sous-estimé de ${gap} cran${gap > 1 ? "s" : ""} Fibonacci`;
}

/** Numeric fields derived in code: ~5/3 working days per point (3 points per dev-week), ±20 %. */
export function plannedFields(seed: number = SEED) {
  const random = createRandom(seed);
  return Object.fromEntries(
    TICKET_PLAN.map((slot) => {
      const n = Number(slot.id.slice(2));
      const days = Math.max(
        0.5,
        Math.round(slot.actual_points * (5 / 3) * (0.8 + random.next() * 0.4) * 2) / 2,
      );
      return [
        slot.id,
        { actual_days: days, shipped_days_ago: 21 + (140 - n) * 15 + random.int(-4, 4) },
      ];
    }),
  );
}

/** Problems of a written ticket that justify asking the model again. */
export function textIssues(id: string, text: Written): string[] {
  const issues: string[] = [];
  const all = `${text.title}\n${text.description}\n${text.surprises}`;
  const anchor = TICKET_PLAN.find((s) => s.id === id && "written" in s);
  if (!anchor && FORBIDDEN_TOPICS.test(all))
    issues.push(`${id} : sujet interdit (${all.match(FORBIDDEN_TOPICS)?.[0]})`);
  if (ABSOLUTE_DATES.test(all)) issues.push(`${id} : date absolue, mois ou jour de la semaine`);
  if (/\bS[1-7]\b|\bE[1-8]\b|pattern/i.test(all)) issues.push(`${id} : identifiant de scénario`);
  if (text.title.length > 120) issues.push(`${id} : titre trop long`);
  if (text.description.length < 40 || text.description.length > 600)
    issues.push(`${id} : description hors 40-600 caractères`);
  if (text.surprises.length < 10 || text.surprises.length > 400)
    issues.push(`${id} : surprises hors 10-400 caractères`);
  return issues;
}

/** Checks of SPEC §8.4 and PLAN 1.3 on the whole set; returns the list of violations. */
export function validateReferenceTickets(
  tickets: ReferenceTicket[],
  moduleIds: string[],
): string[] {
  const issues: string[] = [];
  const parsed = referenceTicketsSchema.safeParse(tickets);
  if (!parsed.success) return [z.prettifyError(parsed.error)];

  const ids = tickets.map((t) => t.id);
  const expected = Array.from({ length: 40 }, (_, i) => `T-${101 + i}`);
  if (JSON.stringify(ids) !== JSON.stringify(expected))
    issues.push("Les ID doivent aller de T-101 à T-140, dans l'ordre.");

  for (const t of tickets) {
    if (t.components[0] !== t.module)
      issues.push(`${t.id} : le module principal doit être le premier composant.`);
    for (const c of t.components)
      if (!moduleIds.includes(c)) issues.push(`${t.id} : composant inconnu « ${c} ».`);
    if (new Set(t.components).size !== t.components.length)
      issues.push(`${t.id} : composant en double.`);
    issues.push(...textIssues(t.id, t));
  }

  const bias = biasByComponent(tickets);
  for (const c of ["permissions", "notifications", "export", "tableau", "champs_personnalises"]) {
    if ((bias[c]?.tickets ?? 0) < 3) issues.push(`Moins de 3 tickets pour ${c}.`);
  }
  for (const c of ["permissions", "export"]) {
    if (bias[c].ratio < 1.4)
      issues.push(`${c} doit être nettement sous-estimé (ratio ${bias[c].ratio.toFixed(2)}).`);
    for (const t of tickets.filter((t) => t.components.includes(c))) {
      const gap = crans(t.estimated_points, t.actual_points);
      if (gap < 0 || gap > 2)
        issues.push(`${t.id} : écart de ${gap} crans sur ${c} (attendu 0 à 2).`);
    }
  }
  if (Math.abs(bias.notifications.ratio - 1) > 0.1)
    issues.push("Les notifications doivent être bien estimées.");
  for (const c of moduleIds.filter(
    (m) => !["permissions", "export", "notifications"].includes(m),
  )) {
    if (bias[c] && (bias[c].ratio < 0.85 || bias[c].ratio > 1.35))
      issues.push(`${c} : écart non modéré (${bias[c].ratio.toFixed(2)}).`);
  }
  return issues;
}

const writtenSchema = z.object({
  tickets: z.array(
    z.object({
      id: z.string(),
      title: z
        .string()
        .describe("Titre du ticket, à l'infinitif ou au constat, 120 caractères au plus"),
      description: z.string().describe("Ce qui a été livré et pourquoi, 1 à 3 phrases"),
      surprises: z.string().describe("Ce qui a coûté plus ou moins que prévu, 1 ou 2 phrases"),
    }),
  ),
});

function systemPrompt(product: string, architecture: string): string {
  const anchors = TICKET_PLAN.filter((s) => "written" in s)
    .map(
      (s) =>
        `${s.id} · ${s.components.join(", ")} · ${s.estimated_points} → ${s.actual_points} points\n${JSON.stringify((s as { written: Written }).written)}`,
    )
    .join("\n\n");
  return `Tu écris l'historique des tickets livrés par l'équipe produit de Jalon, un SaaS français de gestion de projet pour agences. Ces tickets servent de références pour estimer de nouveaux besoins par analogie.

Pour chaque ticket demandé, le module, les composants, les points estimés et réels sont déjà fixés : tu écris seulement le titre, la description et les surprises, cohérents avec ces chiffres et avec la carte d'architecture.

Règles :
- Français, ton de ticket interne d'une équipe produit : concret, technique sans jargon inutile, phrases courtes.
- Titre : 120 caractères au plus, à l'infinitif (« Ajouter… », « Corriger… ») ou au constat pour un bug.
- Description : 1 à 3 phrases, ce qui a été livré et pourquoi.
- Surprises : 1 ou 2 phrases qui expliquent l'écart. Sous-estimé → ce qui a coûté plus que prévu, en s'appuyant sur le couplage ou la dette de la carte d'architecture (contrôles d'accès dispersés, requête de la liste reprise par l'export, stockage générique des champs personnalisés…). Estimation tenue → rien de notable ou un point de vigilance. Surestimé → ce qui a été plus simple que prévu.
- Le ticket décrit une fonctionnalité qui existe aujourd'hui (voir « Fonctionnalités existantes »), un correctif ou une amélioration interne. Jamais une capacité que Jalon n'a pas : pas de Gantt, de date de début, de dépendance, d'invité, de partage avec le client, de permission par projet, d'export PDF ou Excel, de suivi du temps, de facturation, de notification in-app, d'intégration, de nouveau type de champ, de virtualisation du kanban, et ne parle pas du digest.
- Aucune date absolue, aucun nom de jour ou de mois, aucun nom de client.

Exemples déjà écrits (même ton, même longueur) :

${anchors}

<produit>
${product}
</produit>

<architecture>
${architecture}
</architecture>`;
}

async function writeBatch(
  slots: (Planned & { theme: string })[],
  system: string,
  runCost: RunCost,
) {
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const request = slots.map((s) => ({
      id: s.id,
      theme: s.theme,
      composants: s.components,
      points: `${s.estimated_points} estimés → ${s.actual_points} réels (${direction(s)})`,
    }));
    const { data } = await invokeStructured(
      "generation",
      writtenSchema,
      [
        new SystemMessage(system),
        new HumanMessage(
          `Écris ces ${slots.length} tickets, un par ID, dans le même ordre.\n${JSON.stringify(request, null, 2)}${feedback}`,
        ),
      ],
      {
        name: "write-reference-tickets",
        runCost,
        metadata: { ids: `${slots[0].id}..${slots.at(-1)!.id}` },
      },
    );
    const byId = new Map(data.tickets.map((t) => [t.id, t]));
    const issues = slots.flatMap((s) => {
      const t = byId.get(s.id);
      return t ? textIssues(s.id, t) : [`${s.id} : ticket manquant`];
    });
    if (issues.length === 0) return slots.map((s) => byId.get(s.id)!);
    console.warn(`Tentative ${attempt} rejetée :\n  ${issues.join("\n  ")}`);
    feedback = `\n\nUne version précédente a été rejetée pour ces raisons, corrige-les :\n- ${issues.join("\n- ")}`;
  }
  throw new Error(
    `Lot ${slots[0].id}..${slots.at(-1)!.id} : sortie invalide après ${MAX_ATTEMPTS} tentatives.`,
  );
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  initTracing();
  const pack = await loadContextPack();
  const moduleIds = pack.modules.map((m) => m.id);
  const system = systemPrompt(pack.documents.product, pack.documents.architecture);
  const runCost = new RunCost();
  const todo = TICKET_PLAN.filter((s): s is Planned & { theme: string } => "theme" in s);
  const written = new Map<string, Written>(
    TICKET_PLAN.flatMap((s) => ("written" in s ? [[s.id, s.written] as const] : [])),
  );

  await withTrace(
    "generate-reference-tickets",
    { runId: randomUUID(), step: "generation", tags: ["data"] },
    { count: todo.length },
    async () => {
      for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const batch = todo.slice(i, i + BATCH_SIZE);
        for (const [j, t] of (await writeBatch(batch, system, runCost)).entries()) {
          written.set(batch[j].id, {
            title: t.title.trim(),
            description: t.description.trim(),
            surprises: t.surprises.trim(),
          });
        }
        console.log(
          `Lot ${batch[0].id}..${batch.at(-1)!.id} écrit (${runCost.eur.toFixed(3)} € cumulés).`,
        );
      }
    },
    () => ({ written: written.size }),
  );

  const fields = plannedFields();
  const tickets: ReferenceTicket[] = TICKET_PLAN.map((s) => ({
    id: s.id,
    ...written.get(s.id)!,
    module: s.module,
    components: s.components,
    estimated_points: s.estimated_points,
    actual_points: s.actual_points,
    ...fields[s.id],
  }));
  const issues = validateReferenceTickets(tickets, moduleIds);
  if (issues.length > 0) throw new Error(`Tickets invalides :\n  ${issues.join("\n  ")}`);

  writeFileSync(REFERENCE_TICKETS_FILE, `${JSON.stringify(tickets, null, 2)}\n`);
  console.log(
    `${tickets.length} tickets → ${REFERENCE_TICKETS_FILE} · coût ${runCost.eur.toFixed(3)} €`,
  );
  for (const [c, b] of Object.entries(biasByComponent(tickets))) {
    console.log(
      `  ${c.padEnd(22)} ${String(b.tickets).padStart(2)} tickets · réel ÷ estimé ${b.ratio.toFixed(2)}`,
    );
  }
  await shutdownTracing();
}

// Reads the architecture without the full pack, for tests that only need the module ids.
export function architectureModuleIds(): string[] {
  const markdown = readFileSync(
    path.join(process.cwd(), "context", "jalon", "architecture.md"),
    "utf8",
  );
  return parseArchitectureModules(markdown).map((m) => m.id);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error);
    await shutdownTracing();
    process.exit(1);
  });
}
