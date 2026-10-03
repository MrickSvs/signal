// Generates data/customers.csv deterministically (fixed seed, no LLM). SPEC §4.2, §4.5, §5.1.
// Usage: pnpm tsx scripts/generate-customers.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toCsv } from "./lib/csv";
import { createRandom, type Random } from "./lib/random";

const SEED = 20261002;
export const CUSTOMERS_FILE = path.join(process.cwd(), "data", "customers.csv");

export const PLANS = ["free", "pro", "business", "enterprise"] as const;
export const SEGMENTS = [
  "agence_com",
  "agence_digitale",
  "conseil",
  "pme_services",
  "hors_cible",
] as const;
export type Plan = (typeof PLANS)[number];
export type Segment = (typeof SEGMENTS)[number];
export type Health = "vert" | "orange" | "rouge";

export type CustomerRow = {
  id: string;
  name: string;
  status: "client" | "prospect";
  segment: Segment;
  plan: Plan | null;
  seats: number;
  mrr_eur: number;
  /** Days from DEMO_NOW to the renewal (Business and Enterprise only); turned into a date at seed time. */
  renewal_in_days: number | null;
  health: Health | null;
  csm: string | null;
  email_domain: string;
};

export const CUSTOMER_COLUMNS: (keyof CustomerRow)[] = [
  "id",
  "name",
  "status",
  "segment",
  "plan",
  "seats",
  "mrr_eur",
  "renewal_in_days",
  "health",
  "csm",
  "email_domain",
];

/** Price per member per month (SPEC §4.2; Enterprise is quoted around 30 €). */
export const PRICE_PER_SEAT: Record<Plan, number> = {
  free: 0,
  pro: 12,
  business: 24,
  enterprise: 30,
};

/** Accounts of SPEC §4.5 and §5.1 that later steps (scenario, demo) refer to by name. */
export const SCENARIO_ACCOUNTS = {
  sensitive: ["Atelier Mercure", "Studio Bastide", "Groupe Hélix"],
  /** The 2 Business accounts concerned by the per-project permissions pattern, besides the 3 above. */
  permissionsBusiness: ["Agence Ponant", "Agence Polygone"],
  prospect: "Forgeval Industrie",
} as const;

const CSMS = ["Inès Marchand", "Thomas Roussel", "Clara Benali", "Hugo Lefèvre"] as const;

type Fixed = Omit<CustomerRow, "id" | "email_domain" | "mrr_eur">;

// SPEC §4.5, exact values. Seats × 30 € gives the MRR of the spec (4 200, 2 700, 3 300 €).
const SENSITIVE: Fixed[] = [
  {
    name: "Atelier Mercure",
    status: "client",
    segment: "agence_com",
    plan: "enterprise",
    seats: 140,
    renewal_in_days: 45,
    health: "orange",
    csm: "Inès Marchand",
  },
  {
    name: "Studio Bastide",
    status: "client",
    segment: "agence_digitale",
    plan: "enterprise",
    seats: 90,
    renewal_in_days: 38,
    health: "rouge",
    csm: "Thomas Roussel",
  },
  {
    name: "Groupe Hélix",
    status: "client",
    segment: "agence_com",
    plan: "enterprise",
    seats: 110,
    renewal_in_days: 70,
    health: "orange",
    csm: "Clara Benali",
  },
];

const PERMISSIONS_BUSINESS: Fixed[] = [
  {
    name: "Agence Ponant",
    status: "client",
    segment: "agence_com",
    plan: "business",
    seats: 16,
    renewal_in_days: 55,
    health: "orange",
    csm: "Hugo Lefèvre",
  },
  {
    name: "Agence Polygone",
    status: "client",
    segment: "agence_digitale",
    plan: "business",
    seats: 14,
    renewal_in_days: 160,
    health: "orange",
    csm: "Inès Marchand",
  },
];

// Prospects carry no plan, MRR, renewal or health: they are not customers yet. Seats are potential seats.
const PROSPECTS: Fixed[] = [
  {
    name: "Forgeval Industrie",
    status: "prospect",
    segment: "hors_cible",
    plan: null,
    seats: 300,
    renewal_in_days: null,
    health: null,
    csm: null,
  },
  {
    name: "Maison Lumen",
    status: "prospect",
    segment: "agence_com",
    plan: null,
    seats: 45,
    renewal_in_days: null,
    health: null,
    csm: null,
  },
  {
    name: "Cabinet Ardent",
    status: "prospect",
    segment: "conseil",
    plan: null,
    seats: 25,
    renewal_in_days: null,
    health: null,
    csm: null,
  },
  {
    name: "Agence Myrtille",
    status: "prospect",
    segment: "agence_digitale",
    plan: null,
    seats: 18,
    renewal_in_days: null,
    health: null,
    csm: null,
  },
  {
    name: "Services Ondine",
    status: "prospect",
    segment: "pme_services",
    plan: null,
    seats: 12,
    renewal_in_days: null,
    health: null,
    csm: null,
  },
];

// Fictional names, one pool per segment (fixed accounts are drawn from the same pools).
const NAMES: Record<Segment, string[]> = {
  agence_com: [
    "Atelier Mercure",
    "Groupe Hélix",
    "Agence Ponant",
    "Les Faiseurs",
    "Studio Alizé",
    "Maison Cardinal",
    "Agence Boréale",
    "Plume & Cie",
    "Agence Saltimbanque",
    "Héliotrope Communication",
    "Agence Contrepoint",
    "Le Bureau des Idées",
    "Agence Mistral",
    "Maison Orage",
    "Agence Grand Large",
    "Atelier Vermillon",
    "Agence Fil Rouge",
    "Agence Archipel",
    "Oxalis Communication",
    "Agence Belvédère",
    "Studio Capucine",
    "Agence Tamaris",
    "Agence Quai Ouest",
    "Agence Sémaphore",
    "Atelier Pivoine",
  ],
  agence_digitale: [
    "Studio Bastide",
    "Agence Polygone",
    "Pixelune",
    "Agence Octet",
    "Nuage Rose",
    "Studio Lagune",
    "Studio Néon Bleu",
    "Agence Hublot",
    "Code & Craie",
    "Studio Bifurque",
    "Agence Sillage",
    "Lumière Numérique",
    "Agence Pixel Sauvage",
    "Studio Origami",
    "Agence Galaxie",
    "Studio Coquelicot",
    "Agence Rivage",
    "Les Artisans du Web",
    "Agence Vif-Argent",
    "Studio Marelle",
    "Agence Tangente",
    "Studio Escale",
    "Agence Kiosque",
    "Agence Carambole",
    "Studio Lucarne",
  ],
  conseil: [
    "Cabinet Arpège",
    "Valmont Conseil",
    "Cap Horizon Conseil",
    "Sextant Partenaires",
    "Cabinet Lorient & Associés",
    "Ferrand Stratégie",
    "Boussole Conseil",
    "Cabinet Ouessant",
    "Altitude RH Conseil",
    "Cabinet Médiane",
    "Trame Conseil",
    "Cabinet Brévent",
    "Équinoxe Conseil",
  ],
  pme_services: [
    "Maintenance Delorme",
    "Netéa Services",
    "Clim'Ouest Services",
    "Bureau Vauban Ingénierie",
    "Thermique Rousseau",
    "Propreté Lumière",
    "Sécuria Services",
    "Logis Entretien",
    "Ascenseurs Guérin",
    "TechniPlus Maintenance",
    "Jardins de l'Estuaire",
    "Diagnostic Habitat Morel",
    "Hygiène Pro Atlantique",
    "Énergie Services Ouest",
    "Domicile Services Plus",
    "Archives & Co",
    "Traducteurs Associés Lyon",
    "Événements Garance",
  ],
  hors_cible: [
    "Métallerie Brunet",
    "Plasturgie Vallière",
    "BTP Ravel & Fils",
    "Charpentes Lemoine",
    "Boulangeries Fournil d'Or",
    "Boutique Les Galets",
    "Menuiserie Arnoux",
    "Fonderie du Lac",
    "Carrelages Sudre",
  ],
};

// Segments by plan (SPEC §4.2: ~55 % agencies, 15 % consulting, 20 % service SMBs, 10 % off-target),
// with off-target accounts mostly on small plans. Includes the fixed accounts.
export const SEGMENT_QUOTAS: Record<Plan, Record<Segment, number>> = {
  enterprise: { agence_com: 4, agence_digitale: 3, conseil: 2, pme_services: 1, hors_cible: 0 },
  business: { agence_com: 7, agence_digitale: 7, conseil: 4, pme_services: 5, hors_cible: 2 },
  pro: { agence_com: 8, agence_digitale: 8, conseil: 4, pme_services: 7, hors_cible: 3 },
  free: { agence_com: 6, agence_digitale: 7, conseil: 3, pme_services: 5, hors_cible: 4 },
};

const HEALTH_WEIGHTS: Record<Plan, [Health, number][]> = {
  free: [
    ["vert", 0.85],
    ["orange", 0.15],
  ],
  pro: [
    ["vert", 0.75],
    ["orange", 0.2],
    ["rouge", 0.05],
  ],
  business: [
    ["vert", 0.7],
    ["orange", 0.22],
    ["rouge", 0.08],
  ],
  enterprise: [
    ["vert", 0.85],
    ["orange", 0.15],
  ],
};

/** Public mailbox providers: a customer domain must never be one of them. */
export const PUBLIC_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "proton.me",
  "protonmail.com",
  "gmx.fr",
  "aol.com",
];

const TLDS = ["fr", "fr", "fr", "com", "eu"];

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("&", " et ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function weighted<T>(random: Random, options: [T, number][]): T {
  let roll = random.next();
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

function generatedAccount(
  random: Random,
  name: string,
  segment: Segment,
  plan: Plan,
  csmIndex: number,
): Fixed {
  const seats = {
    free: () => random.int(1, 3),
    pro: () => random.int(2, 8),
    business: () => random.int(6, 18),
    enterprise: () => random.int(90, 170),
  }[plan]();
  const paid = plan === "business" || plan === "enterprise";
  // Other Enterprise accounts renew after 90 days: the at-risk Enterprise accounts are those of SPEC §4.5.
  const renewal =
    plan === "enterprise" ? random.int(100, 340) : plan === "business" ? random.int(8, 360) : null;
  return {
    name,
    status: "client",
    segment,
    plan,
    seats,
    renewal_in_days: renewal,
    health: weighted(random, HEALTH_WEIGHTS[plan]),
    csm: paid ? CSMS[csmIndex % CSMS.length] : null,
  };
}

export function generateCustomers(seed: number = SEED): CustomerRow[] {
  const random = createRandom(seed);
  const fixed = [...SENSITIVE, ...PERMISSIONS_BUSINESS];
  const taken = new Set([...fixed, ...PROSPECTS].map((c) => c.name));
  const accounts: Fixed[] = [...fixed];
  let csmIndex = 0;

  for (const segment of SEGMENTS) {
    const pool = random.shuffle(NAMES[segment].filter((n) => !taken.has(n)));
    for (const plan of [...PLANS].reverse()) {
      const already = fixed.filter((c) => c.plan === plan && c.segment === segment).length;
      for (let i = already; i < SEGMENT_QUOTAS[plan][segment]; i++) {
        const name = pool.pop();
        if (!name) throw new Error(`Pas assez de noms pour le segment ${segment}.`);
        accounts.push(generatedAccount(random, name, segment, plan, csmIndex++));
      }
    }
  }

  // Ids are assigned after a seeded shuffle so that they reveal neither the plan nor the scenario.
  return random.shuffle([...accounts, ...PROSPECTS]).map((account, index) => ({
    ...account,
    id: `C-${String(index + 1).padStart(3, "0")}`,
    mrr_eur: account.plan ? account.seats * PRICE_PER_SEAT[account.plan] : 0,
    email_domain: `${slugify(account.name)}.${TLDS[index % TLDS.length]}`,
  }));
}

function main() {
  const customers = generateCustomers();
  writeFileSync(CUSTOMERS_FILE, toCsv(CUSTOMER_COLUMNS, customers));
  const clients = customers.filter((c) => c.status === "client");
  console.log(
    `${clients.length} clients et ${customers.length - clients.length} prospects → ${CUSTOMERS_FILE}`,
  );
  for (const plan of PLANS) {
    const rows = clients.filter((c) => c.plan === plan);
    const seats = rows.reduce((sum, c) => sum + c.seats, 0);
    const mrr = rows.reduce((sum, c) => sum + c.mrr_eur, 0);
    console.log(
      `  ${plan.padEnd(10)} ${String(rows.length).padStart(3)} comptes · ${(seats / rows.length).toFixed(1)} sièges en moyenne · MRR ${mrr} €`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
