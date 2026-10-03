// Plans every feedback of the dataset in code (SPEC §5): pattern, channel, account, author,
// days before DEMO_NOW, language, tone, NPS score and expected items. The plan IS the ground
// truth; the model only writes the subject and the text of each planned feedback.
import type { CustomerRow } from "../generate-customers";
import { slugify } from "../generate-customers";
import { createRandom, type Random } from "./random";
import type {
  Area,
  Channel,
  ItemType,
  NoiseTopic,
  PatternId,
  PatternSpec,
  Scenario,
} from "./scenario";

export type DatasetName = "development" | "holdout";
export type SentimentSign = -1 | 0 | 1;
export type EdgeCase = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8";

export type PlannedItem = {
  /** S1…S7, or "noise". */
  pattern_id: PatternId | "noise";
  /** Noise topic key (eloge, agenda…), null for patterns. */
  topic: string | null;
  expected_type: ItemType;
  acceptable_types: ItemType[];
  expected_area: Area;
  acceptable_areas: Area[];
  existing_feature: boolean;
  /** What the writer must express (truth + angle), never shown to the application. */
  brief: string;
};

export type PlannedFeedback = {
  key: string;
  channel: Channel;
  source_type: "client_direct" | "support" | "interne";
  customer_id: string | null;
  account: Pick<CustomerRow, "name" | "plan" | "segment" | "seats" | "status"> | null;
  author_name: string;
  author_email: string;
  author_role: "client" | "csm" | "sales" | "product";
  days_ago: number;
  language: "fr" | "en";
  nps_score: number | null;
  sentiment_sign: SentimentSign;
  churn_signal: boolean;
  is_injection: boolean;
  style: string;
  /** The writer adds a few typos (~25 %, SPEC §5.4). */
  typos: boolean;
  lines: [number, number];
  has_subject: boolean;
  items: PlannedItem[];
  edge_cases: EdgeCase[];
  /** Extra instruction for the writer (relaunch, irony, auto-reply…). */
  notes: string[];
  /** E4 empty message: written in code, never by the model. */
  fixed_text: string | null;
  min_chars: number | null;
};

const PERSONAL_DOMAINS = [
  "gmail.com",
  "orange.fr",
  "outlook.fr",
  "free.fr",
  "yahoo.fr",
  "hotmail.fr",
];
const FIRST_NAMES = [
  "Camille",
  "Julie",
  "Antoine",
  "Sophie",
  "Karim",
  "Léa",
  "Mathieu",
  "Nadia",
  "Pierre",
  "Claire",
  "Yasmine",
  "Romain",
  "Élodie",
  "Hugo",
  "Manon",
  "Sébastien",
  "Aïcha",
  "Thomas",
  "Laura",
  "Bastien",
  "Inès",
  "Guillaume",
  "Fatou",
  "Olivier",
  "Marion",
  "Rachid",
  "Charlotte",
  "Vincent",
  "Amandine",
  "Kevin",
  "Sarah",
  "Nicolas",
  "Émilie",
  "Damien",
  "Lucie",
  "Mehdi",
  "Anne",
  "Florian",
  "Chloé",
  "Benoît",
];
const LAST_NAMES = [
  "Martin",
  "Bernard",
  "Petit",
  "Durand",
  "Leroy",
  "Moreau",
  "Simon",
  "Laurent",
  "Lefebvre",
  "Michel",
  "Garcia",
  "David",
  "Bertrand",
  "Roux",
  "Vincent",
  "Fournier",
  "Morel",
  "Girard",
  "André",
  "Mercier",
  "Dupont",
  "Lambert",
  "Bonnet",
  "François",
  "Martinez",
  "Legrand",
  "Garnier",
  "Faure",
  "Rousseau",
  "Blanc",
  "Guerin",
  "Muller",
  "Henry",
  "Roussel",
  "Nicolas",
  "Perrin",
  "Morin",
  "Mathieu",
  "Clement",
  "Gauthier",
];
const SENTIMENT_MIX: Record<string, [SentimentSign, number][]> = {
  S2a: [
    [1, 0.4],
    [0, 0.35],
    [-1, 0.25],
  ],
  S3: [
    [-1, 0.5],
    [0, 0.4],
    [1, 0.1],
  ],
  S5b: [
    [0, 0.6],
    [1, 0.2],
    [-1, 0.2],
  ],
};
const SIGN: Record<string, SentimentSign> = { negative: -1, neutral: 0, positive: 1 };

function weighted<T>(random: Random, options: [T, number][]): T {
  const total = options.reduce((a, [, w]) => a + w, 0);
  let roll = random.next() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

/** Splits `total` across keys proportionally to `counts` (largest remainder), keeping order. */
export function scaleCounts<K extends string>(
  counts: Partial<Record<K, number>>,
  total: number,
): [K, number][] {
  const entries = Object.entries(counts) as [K, number][];
  const sum = entries.reduce((a, [, c]) => a + c, 0);
  const raw = entries.map(([k, c]) => [k, (c * total) / sum] as const);
  const floored = raw.map(([k, v]) => [k, Math.floor(v)] as [K, number]);
  let left = total - floored.reduce((a, [, c]) => a + c, 0);
  const order = raw.map(([, v], i) => [i, v - Math.floor(v)] as const).sort((a, b) => b[1] - a[1]);
  for (const [i] of order) {
    if (left-- <= 0) break;
    floored[i][1]++;
  }
  return floored;
}

class Planner {
  readonly random: Random;
  private readonly authors = new Map<string, { name: string; email: string }[]>();
  private readonly used = new Map<string, number>();
  private readonly takenNames = new Set<string>();

  constructor(
    readonly scenario: Scenario,
    readonly customers: CustomerRow[],
    readonly dataset: DatasetName,
  ) {
    this.random = createRandom(scenario.seeds[dataset]);
  }

  byName(name: string): CustomerRow {
    const c = this.customers.find((x) => x.name === name);
    if (!c) throw new Error(`Compte inconnu dans customers.csv : ${name}`);
    return c;
  }

  /** Least-used client matching the filters, ties broken at random: spreads feedback over accounts. */
  pickAccount(
    plans: Partial<Record<string, number>> | undefined,
    segments?: string[],
    channel?: Channel,
  ): CustomerRow {
    let weights = Object.entries(plans ?? { free: 1, pro: 1, business: 1, enterprise: 1 }) as [
      string,
      number,
    ][];
    if (channel === "note_csm")
      weights = weights.filter(([p]) => p === "business" || p === "enterprise");
    if (weights.length === 0) weights = [["business", 1]];
    const plan = weighted(this.random, weights);
    const pool = this.customers.filter(
      (c) =>
        c.status === "client" &&
        c.plan === plan &&
        (!segments || segments.includes(c.segment)) &&
        !["Atelier Mercure", "Studio Bastide", "Groupe Hélix"].includes(c.name),
    );
    if (pool.length === 0) throw new Error(`Aucun compte ${plan} pour ${segments?.join(",")}`);
    const min = Math.min(...pool.map((c) => this.used.get(c.id) ?? 0));
    const account = this.random.pick(pool.filter((c) => (this.used.get(c.id) ?? 0) === min));
    this.used.set(account.id, min + 1);
    return account;
  }

  personName(): string {
    for (;;) {
      const name = `${this.random.pick(FIRST_NAMES)} ${this.random.pick(LAST_NAMES)}`;
      if (!this.takenNames.has(name)) {
        this.takenNames.add(name);
        return name;
      }
    }
  }

  /** A contact of the account: reuses one of up to 3 people per account. */
  contact(account: CustomerRow, fresh = false): { name: string; email: string } {
    const people = this.authors.get(account.id) ?? [];
    if (!fresh && people.length > 0 && (people.length >= 3 || this.random.next() < 0.4)) {
      return this.random.pick(people);
    }
    const name = this.personName();
    const [first, ...last] = slugify(name).split("-");
    const person = { name, email: `${first}.${last.join("-")}@${account.email_domain}` };
    this.authors.set(account.id, [...people, person]);
    return person;
  }

  personalContact(): { name: string; email: string } {
    const name = this.personName();
    const [first, ...last] = slugify(name).split("-");
    const suffix = this.random.next() < 0.5 ? String(this.random.int(10, 99)) : "";
    return {
      name,
      email: `${first}.${last.join("")}${suffix}@${this.random.pick(PERSONAL_DOMAINS)}`,
    };
  }

  staff(role: "sales" | "product" | "support"): { name: string; email: string } {
    const name = this.random.pick(this.scenario.staff[role]);
    const [first, ...last] = slugify(name).split("-");
    return { name, email: `${first}.${last.join("-")}@jalon.fr` };
  }

  sentiment(patternOrTopic: string, spec: string): SentimentSign {
    if (spec === "mixed") return weighted(this.random, SENTIMENT_MIX[patternOrTopic] ?? [[0, 1]]);
    return SIGN[spec];
  }

  npsScore(sign: SentimentSign): number {
    return sign < 0
      ? this.random.int(0, 6)
      : sign === 0
        ? this.random.int(7, 8)
        : this.random.int(9, 10);
  }

  feedback(
    key: string,
    channel: Channel,
    account: CustomerRow | null,
    items: PlannedItem[],
    sign: SentimentSign,
    days: number,
  ): PlannedFeedback {
    const spec = this.scenario.channels[channel];
    const role =
      channel === "note_csm"
        ? "csm"
        : channel === "note_sales"
          ? "sales"
          : channel === "slack_interne"
            ? "sales"
            : "client";
    const author =
      role === "csm"
        ? (() => {
            const [first, ...last] = slugify(account?.csm ?? "Inès Marchand").split("-");
            return {
              name: account?.csm ?? "Inès Marchand",
              email: `${first}.${last.join("-")}@jalon.fr`,
            };
          })()
        : role === "sales"
          ? this.staff(
              channel === "slack_interne" && this.random.next() < 0.5 ? "product" : "sales",
            )
          : account
            ? this.contact(account)
            : this.personalContact();
    const internal = spec.source_type === "interne";
    return {
      key,
      channel,
      source_type: spec.source_type,
      customer_id: account?.id ?? null,
      account: account
        ? {
            name: account.name,
            plan: account.plan,
            segment: account.segment,
            seats: account.seats,
            status: account.status,
          }
        : null,
      author_name: author.name,
      author_email: author.email,
      author_role: role,
      days_ago: days,
      language: "fr",
      nps_score: channel === "nps" ? this.npsScore(sign) : null,
      sentiment_sign: sign,
      churn_signal: false,
      is_injection: false,
      style: internal
        ? "note interne télégraphique, abréviations, sans formule de politesse"
        : this.random.pick(
            this.scenario.styles.filter((st) => sign >= 0 || !/enthousiaste/.test(st)),
          ),
      typos: this.random.next() < 0.25,
      lines: spec.lines,
      has_subject: spec.subject,
      items,
      edge_cases: [],
      notes: [],
      fixed_text: null,
      min_chars: null,
    };
  }
}

function patternItem(id: PatternId, spec: PatternSpec, brief: string): PlannedItem {
  return {
    pattern_id: id,
    topic: null,
    expected_type: spec.item.type,
    acceptable_types: spec.item.acceptable_types,
    expected_area: spec.item.area,
    acceptable_areas: [spec.item.area],
    existing_feature: false,
    brief,
  };
}

function planPattern(
  p: Planner,
  id: PatternId,
  spec: PatternSpec,
  volume: number,
): PlannedFeedback[] {
  const holdout = p.dataset === "holdout";
  const channels = p.random.shuffle(
    scaleCounts(spec.channels, volume).flatMap(([c, n]) => Array<Channel>(n).fill(c)),
  );
  const angles = p.random.shuffle(spec.angles ?? []);
  const solutions = spec.solutions
    ? scaleCounts(
        Object.fromEntries(spec.solutions.map((s) => [s.request, s.count])),
        volume,
      ).flatMap(([s, n]) => Array<string>(n).fill(s))
    : [];
  const fixed = spec.fixed
    ? holdout
      ? [0, 3, 5, 7].map((i) => spec.fixed![i])
      : spec.fixed
    : null;

  return Array.from({ length: volume }, (_, i) => {
    const f = fixed?.[i];
    const channel = f?.channel ?? channels[i];
    const account = f
      ? p.byName(f.account)
      : spec.accounts
        ? p.byName(p.random.pick(spec.accounts))
        : p.pickAccount(spec.plans, spec.segments, channel);
    const parts = [spec.truth];
    if (f) parts.push(`Ce retour : ${f.brief}`);
    else if (holdout) parts.push("Trouve un angle concret et une formulation qui te sont propres.");
    else parts.push(`Angle à exprimer : ${angles[i % angles.length]}.`);
    if (solutions[i])
      parts.push(`Solution demandée par le client dans ce retour : ${solutions[i]}.`);
    const sign = p.sentiment(id, spec.sentiment);
    const days = p.random.int(spec.days_ago[0], spec.days_ago[1]);
    const fb = p.feedback(
      `${id}-${String(i + 1).padStart(2, "0")}`,
      channel,
      account,
      [patternItem(id, spec, parts.join(" "))],
      sign,
      days,
    );
    fb.churn_signal = f?.churn ?? false;
    fb.is_injection = spec.injection ?? false;
    if (fb.is_injection)
      fb.notes.push(
        "Le texte contient une phrase qui s'adresse à une IA pour manipuler le classement (voir l'angle).",
      );
    if (fb.churn_signal)
      fb.notes.push(
        "Le retour laisse clairement entendre un risque de départ ou de non-renouvellement.",
      );
    return fb;
  });
}

function noiseItem(topic: NoiseTopic, i: number): { item: PlannedItem; needsAccount: boolean } {
  const variant = topic.variants?.[i % topic.variants.length];
  const area = (variant?.area ?? topic.area)!;
  return {
    item: {
      pattern_id: "noise",
      topic: topic.key,
      expected_type: topic.type,
      acceptable_types: [topic.type],
      expected_area: area,
      acceptable_areas: variant?.acceptable_areas ?? topic.acceptable_areas ?? [area],
      existing_feature: topic.existing_feature ?? false,
      brief: variant?.brief ?? topic.brief!,
    },
    needsAccount: variant?.account ?? !topic.no_account,
  };
}

function planNoise(p: Planner, topic: NoiseTopic, volume: number): PlannedFeedback[] {
  const [from, to] = p.scenario.noise.window;
  return Array.from({ length: volume }, (_, i) => {
    const { item, needsAccount } = noiseItem(topic, i);
    const channel = topic.channels[i % topic.channels.length];
    const account = needsAccount ? p.pickAccount(topic.plans) : null;
    const sign = SIGN[topic.sentiment];
    const fb = p.feedback(
      `${topic.key}-${String(i + 1).padStart(2, "0")}`,
      channel,
      account,
      [item],
      sign,
      p.random.int(from, to),
    );
    fb.churn_signal = topic.churn ?? false;
    return fb;
  });
}

/** Picks a feedback of a pattern (or noise topic) that no edge case has used yet. */
function take(
  all: PlannedFeedback[],
  source: string,
  filter: (f: PlannedFeedback) => boolean = () => true,
) {
  const found = all.find(
    (f) =>
      f.edge_cases.length === 0 &&
      f.items.length === 1 &&
      (f.items[0].pattern_id === source || f.items[0].topic === source) &&
      filter(f),
  );
  if (!found) throw new Error(`Plus de retour disponible pour ${source}`);
  return found;
}

/** E1: the clearly negative subject wins (a bug, a blocker); otherwise the two tones add up. */
function mergedSentiment(
  scenario: Scenario,
  a: PlannedFeedback,
  b: PlannedFeedback,
): SentimentSign {
  const spec = (f: PlannedFeedback) => {
    const item = f.items[0];
    return item.pattern_id === "noise"
      ? scenario.noise.topics.find((t) => t.key === item.topic)?.sentiment
      : scenario.patterns[item.pattern_id].sentiment;
  };
  if (spec(a) === "negative" || spec(b) === "negative") {
    return Math.min(a.sentiment_sign, b.sentiment_sign) as SentimentSign;
  }
  return Math.sign(a.sentiment_sign + b.sentiment_sign) as SentimentSign;
}

function applyEdgeCases(p: Planner, all: PlannedFeedback[]): PlannedFeedback[] {
  const e = p.scenario.edge_cases;
  const holdout = p.dataset === "holdout";

  // E1 — two subjects in one feedback: the second planned feedback is merged into the first.
  for (const combo of e.E1.combos.slice(0, holdout ? e.E1.holdout : undefined)) {
    const [a, b] = combo.patterns;
    const ownSlot = (f: PlannedFeedback) =>
      !combo.account ||
      !f.account ||
      f.account.name === combo.account ||
      !p.scenario.patterns[a as PatternId]?.fixed;
    const first = take(all, a, ownSlot);
    const second = take(all, b, (f) => f !== first);
    const segments = [a, b]
      .map((x) => p.scenario.patterns[x as PatternId]?.segments)
      .find((x) => x !== undefined);
    const account = combo.account
      ? p.byName(combo.account)
      : p.pickAccount({ [combo.plan!]: 1 }, segments);
    const merged = p.feedback(
      first.key,
      combo.channel,
      account,
      [...first.items, ...second.items],
      mergedSentiment(p.scenario, first, second),
      Math.min(first.days_ago, second.days_ago),
    );
    Object.assign(first, merged, {
      edge_cases: ["E1"],
      notes: [
        "Le retour aborde DEUX sujets distincts, chacun clairement exprimé, dans l'ordre des sujets donnés.",
      ],
    });
    all.splice(all.indexOf(second), 1);
  }
  const pool = all;

  if (!holdout) {
    // E2 — a Free account relaunches 4 times on the same request; a Business account reports the same bug twice.
    const r = e.E2.relaunch;
    const account = p.pickAccount({ [r.plan]: 1 });
    const author = p.contact(account, true);
    const relaunchDays = [38, 27, 15, 4];
    for (let k = 0; k < r.count; k++) {
      const f = take(pool, r.pattern);
      const again = p.feedback(
        f.key,
        r.channels[k],
        account,
        f.items,
        k === 0 ? 0 : -1,
        relaunchDays[k],
      );
      Object.assign(f, again, {
        author_name: author.name,
        author_email: author.email,
        edge_cases: ["E2"],
        notes: [
          k === 0
            ? "Première demande de ce client sur ce sujet."
            : `Relance n°${k} du même client sur la même demande, de plus en plus insistante ; il rappelle qu'il l'a déjà demandé.`,
        ],
      });
    }
    const x = e.E2.cross_channel;
    const xAccount = p.pickAccount({ [x.plan]: 1 });
    const xAuthor = p.contact(xAccount, true);
    x.channels.forEach((channel, k) => {
      const f = take(pool, x.pattern);
      const same = p.feedback(f.key, channel, xAccount, f.items, -1, k === 0 ? 20 : 17);
      Object.assign(same, {
        author_name: xAuthor.name,
        author_email: xAuthor.email,
        edge_cases: ["E2"],
        notes: [
          k === 0
            ? "Premier signalement, par e-mail."
            : "Le même client signale le même problème par ticket, quelques jours après son e-mail resté sans réponse.",
        ],
      });
      Object.assign(f, same);
    });
  }

  for (const source of e.E3.patterns.slice(0, holdout ? e.E3.holdout : undefined)) {
    const f = take(pool, source, (x) => x.channel !== "note_csm" && x.channel !== "nps");
    Object.assign(f, { language: "en", edge_cases: ["E3"] });
    f.notes.push("Rédigé entièrement en anglais (client non francophone).");
  }

  const kinds = holdout ? e.E4.kinds.slice(0, 1) : e.E4.kinds;
  for (const [i, f] of pool.filter((x) => x.items[0].topic === "autre_auto").entries()) {
    const kind = kinds[i % kinds.length];
    f.edge_cases = ["E4"];
    if (kind === "absence") f.notes.push("Réponse automatique d'absence du bureau, rien d'autre.");
    if (kind === "spam") {
      Object.assign(f, {
        customer_id: null,
        account: null,
        ...(() => {
          const c = p.personalContact();
          return { author_name: c.name, author_email: c.email };
        })(),
      });
      f.notes.push("Spam commercial sans rapport avec Jalon (promotion douteuse).");
    }
    if (kind === "vide") Object.assign(f, { fixed_text: "", style: "message vide" });
  }

  for (const f of pool.filter((x) => x.items[0].topic === e.E5.topic)) f.edge_cases = ["E5"];

  if (!holdout) {
    for (const source of e.E6.patterns) {
      const f = take(pool, source, (x) => x.channel === "ticket_support");
      Object.assign(f, { edge_cases: ["E6"], min_chars: e.E6.min_chars, lines: [80, 140] });
      f.notes.push(
        `Long fil de ticket : plusieurs échanges entre le client et le support (${p.scenario.staff.support.join(", ")}), avec citations des messages précédents et signatures, au moins ${e.E6.min_chars} caractères au total. Le sujet reste le même du début à la fin.`,
      );
    }
  }

  for (const source of e.E7.patterns.slice(0, holdout ? e.E7.holdout : undefined)) {
    const f = take(pool, source, (x) => x.channel !== "note_csm");
    const c = p.personalContact();
    Object.assign(f, {
      channel: "email_client",
      source_type: "client_direct",
      has_subject: true,
      lines: p.scenario.channels.email_client.lines,
      nps_score: null,
      customer_id: null,
      account: null,
      author_name: c.name,
      author_email: c.email,
      edge_cases: ["E7"],
    });
    f.notes.push("Envoyé depuis une adresse personnelle ; l'auteur ne nomme pas son entreprise.");
  }

  for (const source of e.E8.patterns.slice(0, holdout ? e.E8.holdout : undefined)) {
    const f = take(pool, source, (x) => x.channel !== "note_csm");
    Object.assign(f, { sentiment_sign: -1, edge_cases: ["E8"] });
    f.notes.push(
      "Ton ironique : des mots positifs pour dire un mécontentement (ex. « Génial, encore… 👏 »).",
    );
  }
  return pool;
}

export type FeedbackPlan = {
  dataset: DatasetName;
  feedbacks: (PlannedFeedback & { id: string })[];
};

export function buildPlan(
  scenario: Scenario,
  customers: CustomerRow[],
  dataset: DatasetName,
): FeedbackPlan {
  const p = new Planner(scenario, customers, dataset);
  const holdout = dataset === "holdout";
  const all: PlannedFeedback[] = [];
  for (const [id, spec] of Object.entries(scenario.patterns) as [PatternId, PatternSpec][]) {
    all.push(...planPattern(p, id, spec, holdout ? spec.holdout : spec.volume));
  }
  for (const topic of scenario.noise.topics)
    all.push(...planNoise(p, topic, holdout ? topic.holdout : topic.count));
  const planned = applyEdgeCases(p, all);
  // Ids after a seeded shuffle: the order reveals nothing (SPEC §5.4).
  const prefix = holdout ? "H" : "R";
  return {
    dataset,
    feedbacks: p.random
      .shuffle(planned)
      .map((f, i) => ({ ...f, id: `${prefix}-${String(i + 1).padStart(3, "0")}` })),
  };
}
