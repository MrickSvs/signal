// Enrich node (SPEC §6.1, §8.1, §8.3): links each feedback to its account and computes its
// business signals. Pure code, no LLM. Only customer_id is persisted; the signals are derived on
// demand from the customer row, so they never go stale when a customer changes.
import type { Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import type { Tables } from "@/lib/db/types";

export type CustomerForLinking = Pick<
  Tables<"customers">,
  "id" | "name" | "status" | "segment" | "plan" | "mrr_eur" | "renewal_date" | "email_domain"
>;

export type FeedbackForLinking = Pick<
  Tables<"feedbacks">,
  | "id"
  | "channel"
  | "source_type"
  | "author_name"
  | "author_email"
  | "customer_id"
  | "subject"
  | "raw_text"
>;

export type LinkMethod = "connu" | "domaine" | "nom_exact" | "nom_approche";

export type FeedbackSignals = {
  feedback_id: string;
  customer_id: string | null;
  link_method: LinkMethod | null;
  /** Counting key for distinct accounts (CL-02): customer id, else author e-mail or name. */
  account_key: string;
  is_prospect: boolean;
  plan: CustomerForLinking["plan"];
  segment: CustomerForLinking["segment"] | null;
  mrr_eur: number;
  renewal_in_days: number | null;
  source_weight: number;
};

// Personal mailboxes: their domain never identifies an account.
export const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "aol.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "bbox.fr",
  "laposte.net",
  "gmx.fr",
  "gmx.com",
  "proton.me",
  "protonmail.com",
]);

// Jalon's own staff (CSM, sales, Slack): their domain is never a customer's.
export const INTERNAL_EMAIL_DOMAIN = "jalon.fr";

const INTERNAL_CHANNELS = new Set(["note_csm", "note_sales", "slack_interne"]);

// Words that do not identify a company on their own: « Kiosque » cites Agence Kiosque,
// « Forgeval Indus. » cites Forgeval Industrie.
const GENERIC_NAME_WORDS = new Set([
  "agence",
  "studio",
  "cabinet",
  "atelier",
  "groupe",
  "maison",
  "bureau",
  "conseil",
  "services",
  "service",
  "industrie",
  "communication",
  "associes",
  "partenaires",
  "cie",
  "co",
  "fils",
  "les",
  "le",
  "la",
  "l",
  "de",
  "des",
  "du",
  "et",
]);
const MIN_CORE_LENGTH = 5;

/** Lowercase, no accents, punctuation turned into spaces. */
export function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Typos tolerated by the approximate match: 1 below 9 characters, 2 above. */
const maxTypos = (length: number) => (length < 9 ? 1 : 2);
// Shorter names are matched exactly only: « trame » is one typo away from « trace ».
const MIN_APPROXIMATE_LENGTH = 7;

type NameVariant = { customer: CustomerForLinking; tokens: string[]; text: string };

/** Full name, and its distinctive core when it differs (« Agence Kiosque » → « kiosque »). */
function nameVariants(customer: CustomerForLinking): NameVariant[] {
  const full = normalizeName(customer.name).split(" ").filter(Boolean);
  const core = full.filter((t) => !GENERIC_NAME_WORDS.has(t));
  const variants = [{ customer, tokens: full, text: full.join(" ") }];
  const coreText = core.join(" ");
  if (core.length > 0 && core.length < full.length && coreText.length >= MIN_CORE_LENGTH) {
    variants.push({ customer, tokens: core, text: coreText });
  }
  return variants;
}

type NameMatch = { customer: CustomerForLinking; position: number; exact: boolean; length: number };

/**
 * Company cited in a text: exact match first, then a simple approximate match (a few typos on a
 * window of the same number of words). Several candidates → the earliest cited, then the longest.
 */
export function findCitedCustomer(
  text: string,
  customers: CustomerForLinking[],
): { customer: CustomerForLinking; exact: boolean } | null {
  const words = normalizeName(text).split(" ").filter(Boolean);
  const matches: NameMatch[] = [];
  for (const variant of customers.flatMap(nameVariants)) {
    const n = variant.tokens.length;
    for (let i = 0; i + n <= words.length; i++) {
      const window = words.slice(i, i + n).join(" ");
      if (window === variant.text) {
        matches.push({ customer: variant.customer, position: i, exact: true, length: n });
      } else if (
        variant.text.length >= MIN_APPROXIMATE_LENGTH &&
        Math.abs(window.length - variant.text.length) <= maxTypos(variant.text.length) &&
        levenshtein(window, variant.text) <= maxTypos(variant.text.length)
      ) {
        matches.push({ customer: variant.customer, position: i, exact: false, length: n });
      }
    }
  }
  const pick = (candidates: NameMatch[]) =>
    candidates.sort((a, b) => a.position - b.position || b.length - a.length)[0];
  const best = pick(matches.filter((m) => m.exact)) ?? pick(matches);
  return best ? { customer: best.customer, exact: best.exact } : null;
}

export function emailDomain(email: string | null): string | null {
  const domain = email?.trim().toLowerCase().split("@")[1];
  return domain || null;
}

/**
 * Account of a feedback: the known one, else the e-mail domain (never a personal mailbox nor
 * Jalon's own), else a company cited in an internal note, else none (CL-07).
 */
export function linkCustomer(
  feedback: FeedbackForLinking,
  customers: CustomerForLinking[],
): { customer: CustomerForLinking | null; method: LinkMethod | null } {
  if (feedback.customer_id) {
    const known = customers.find((c) => c.id === feedback.customer_id) ?? null;
    return { customer: known, method: known ? "connu" : null };
  }

  const domain = emailDomain(feedback.author_email);
  if (domain && !CONSUMER_EMAIL_DOMAINS.has(domain) && domain !== INTERNAL_EMAIL_DOMAIN) {
    const byDomain = customers.find((c) => c.email_domain?.toLowerCase() === domain);
    if (byDomain) return { customer: byDomain, method: "domaine" };
  }

  if (INTERNAL_CHANNELS.has(feedback.channel) || feedback.source_type === "interne") {
    const cited = findCitedCustomer(
      [feedback.subject, feedback.raw_text].filter(Boolean).join("\n"),
      customers,
    );
    if (cited)
      return { customer: cited.customer, method: cited.exact ? "nom_exact" : "nom_approche" };
  }
  return { customer: null, method: null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Distinct-account key. An internal note without an account is not keyed by its author
 * (a CSM relays many customers): it counts on its own.
 */
export function accountKey(feedback: FeedbackForLinking, customerId: string | null): string {
  if (customerId) return customerId;
  const internal = INTERNAL_CHANNELS.has(feedback.channel) || feedback.source_type === "interne";
  if (!internal) {
    const email = feedback.author_email?.trim().toLowerCase();
    if (email) return `email:${email}`;
    const name = feedback.author_name && normalizeName(feedback.author_name);
    if (name) return `auteur:${name}`;
  }
  return `retour:${feedback.id}`;
}

export function computeSignals(
  feedback: FeedbackForLinking,
  customers: CustomerForLinking[],
  weighting: Weighting,
  now: Date,
): FeedbackSignals {
  const { customer, method } = linkCustomer(feedback, customers);
  const renewal = customer?.renewal_date ? new Date(`${customer.renewal_date}T00:00:00Z`) : null;
  return {
    feedback_id: feedback.id,
    customer_id: customer?.id ?? null,
    link_method: method,
    account_key: accountKey(feedback, customer?.id ?? null),
    is_prospect: customer?.status === "prospect",
    plan: customer?.plan ?? null,
    segment: customer?.segment ?? null,
    mrr_eur: Number(customer?.mrr_eur ?? 0),
    renewal_in_days: renewal ? Math.ceil((renewal.getTime() - now.getTime()) / DAY_MS) : null,
    source_weight: weighting.source_weights[feedback.source_type],
  };
}

export type EnrichSummary = {
  signals: FeedbackSignals[];
  /** Feedbacks whose customer_id was filled by this run. */
  linked: { feedbackId: string; customerId: string; method: LinkMethod }[];
  byMethod: Record<LinkMethod | "aucun", number>;
};

/** Computes the signals of every feedback and fills customer_id where it was missing. */
export async function runEnrich(
  db: Db,
  options: { weighting: Weighting; now: Date; feedbackIds?: string[] },
): Promise<EnrichSummary> {
  let query = db
    .from("feedbacks")
    .select("id, channel, source_type, author_name, author_email, customer_id, subject, raw_text")
    .order("id");
  if (options.feedbackIds) query = query.in("id", options.feedbackIds);
  const [feedbacks, customers] = await Promise.all([
    query,
    db
      .from("customers")
      .select("id, name, status, segment, plan, mrr_eur, renewal_date, email_domain"),
  ]);
  if (feedbacks.error) throw new Error(`Enrich : lecture des retours (${feedbacks.error.message})`);
  if (customers.error) throw new Error(`Enrich : lecture des comptes (${customers.error.message})`);

  const summary: EnrichSummary = {
    signals: [],
    linked: [],
    byMethod: { connu: 0, domaine: 0, nom_exact: 0, nom_approche: 0, aucun: 0 },
  };
  for (const feedback of feedbacks.data) {
    const signals = computeSignals(feedback, customers.data, options.weighting, options.now);
    summary.signals.push(signals);
    summary.byMethod[signals.link_method ?? "aucun"]++;
    if (!feedback.customer_id && signals.customer_id && signals.link_method) {
      summary.linked.push({
        feedbackId: feedback.id,
        customerId: signals.customer_id,
        method: signals.link_method,
      });
    }
  }

  for (const link of summary.linked) {
    const { error } = await db
      .from("feedbacks")
      .update({ customer_id: link.customerId })
      .eq("id", link.feedbackId)
      .is("customer_id", null);
    if (error) throw new Error(`Enrich : rattachement de ${link.feedbackId} (${error.message})`);
  }
  return summary;
}
