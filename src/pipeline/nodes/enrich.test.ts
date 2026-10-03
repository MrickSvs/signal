import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import {
  accountKey,
  computeSignals,
  findCitedCustomer,
  levenshtein,
  linkCustomer,
  normalizeName,
  type CustomerForLinking,
  type FeedbackForLinking,
} from "./enrich";

const { weighting } = await loadContextPack();
const now = new Date("2026-06-01T10:00:00Z");

const customer = (c: Partial<CustomerForLinking> & Pick<CustomerForLinking, "id" | "name">) =>
  ({
    status: "client",
    segment: "agence_com",
    plan: "business",
    mrr_eur: 288,
    renewal_date: null,
    email_domain: null,
    ...c,
  }) as CustomerForLinking;

const customers: CustomerForLinking[] = [
  customer({
    id: "C-013",
    name: "Studio Bastide",
    plan: "enterprise",
    segment: "agence_digitale",
    mrr_eur: 2700,
    renewal_date: "2026-06-21",
    email_domain: "studio-bastide.fr",
  }),
  customer({ id: "C-028", name: "Agence Kiosque", email_domain: "agence-kiosque.fr" }),
  customer({
    id: "C-010",
    name: "Forgeval Industrie",
    status: "prospect",
    segment: "hors_cible",
    plan: null,
    mrr_eur: 0,
    email_domain: "forgeval.fr",
  }),
  customer({ id: "C-077", name: "Atelier Mercure", plan: "enterprise" }),
  customer({ id: "C-070", name: "Trame Conseil", plan: "free", mrr_eur: 0 }),
  // A customer wrongly registered with a personal mailbox domain must never be matched by it.
  customer({ id: "C-099", name: "Agence Gmail", email_domain: "gmail.com" }),
];

const feedback = (f: Partial<FeedbackForLinking>): FeedbackForLinking => ({
  id: "R-100",
  channel: "email_client",
  source_type: "client_direct",
  author_name: "Claire Martin",
  author_email: "claire.martin@studio-bastide.fr",
  customer_id: null,
  subject: null,
  raw_text: "Bonjour",
  ...f,
});

describe("linkCustomer", () => {
  it("links a known e-mail domain (case-insensitive)", () => {
    const r = linkCustomer(feedback({ author_email: "Claire@Studio-Bastide.FR" }), customers);
    expect(r).toMatchObject({ customer: { id: "C-013" }, method: "domaine" });
  });

  it("leaves an unknown domain without account (CL-07)", () => {
    const r = linkCustomer(feedback({ author_email: "paul@inconnue.fr" }), customers);
    expect(r).toEqual({ customer: null, method: null });
  });

  it("never links a personal mailbox by its domain, even with a company signature", () => {
    const r = linkCustomer(
      feedback({ author_email: "laura.simon66@gmail.com", raw_text: "Merci\nStudio Bastide" }),
      customers,
    );
    expect(r).toEqual({ customer: null, method: null });
  });

  it("links a sales note citing a prospect by an abbreviated name (CL-08)", () => {
    const r = linkCustomer(
      feedback({
        channel: "note_sales",
        source_type: "interne",
        author_email: "lucas.morel@jalon.fr",
        raw_text: "Forgeval Indus. (~300 sièges) : veulent voir les heures passées par tâche.",
      }),
      customers,
    );
    expect(r).toMatchObject({ customer: { id: "C-010", status: "prospect" }, method: "nom_exact" });
  });

  it("links a CSM note despite a typo in the account name", () => {
    const r = linkCustomer(
      feedback({
        channel: "note_csm",
        source_type: "interne",
        author_email: "ines.marchand@jalon.fr",
        raw_text: "Point avec le directeur d'Atelier Mercur : il rappelle l'engagement signé.",
      }),
      customers,
    );
    expect(r).toMatchObject({ customer: { id: "C-077" }, method: "nom_approche" });
  });

  it("links a CSM note citing a client by the core of its name", () => {
    const r = linkCustomer(
      feedback({
        channel: "note_csm",
        source_type: "interne",
        author_email: "hugo.lefevre@jalon.fr",
        raw_text: "Kiosque (Business, 9 pers.) : plusieurs membres ne reçoivent plus les mails.",
      }),
      customers,
    );
    expect(r).toMatchObject({ customer: { id: "C-028" }, method: "nom_exact" });
  });

  it("keeps a known account and never links Jalon's own domain", () => {
    expect(linkCustomer(feedback({ customer_id: "C-028" }), customers).method).toBe("connu");
    const internal = feedback({
      channel: "slack_interne",
      source_type: "interne",
      author_email: "a@jalon.fr",
      raw_text: "Rien de précis sur un compte.",
    });
    expect(linkCustomer(internal, customers)).toEqual({ customer: null, method: null });
  });

  it("does not search company names in customer e-mails", () => {
    const r = linkCustomer(
      feedback({
        author_email: "x@inconnue.fr",
        raw_text: "On a vu Studio Bastide utiliser Jalon.",
      }),
      customers,
    );
    expect(r.customer).toBeNull();
  });
});

describe("findCitedCustomer", () => {
  it("prefers an exact match and the earliest citation", () => {
    expect(findCitedCustomer("Kiosque et Studio Bastide en parlent", customers)?.customer.id).toBe(
      "C-028",
    );
    expect(findCitedCustomer("Atelier Mercur, puis Kiosque", customers)?.customer.id).toBe("C-028");
  });

  it("matches short names exactly only", () => {
    expect(findCitedCustomer("On garde une trace écrite", customers)).toBeNull();
    expect(findCitedCustomer("Trame : demande d'export", customers)?.customer.id).toBe("C-070");
  });
});

describe("accountKey and signals (CL-02, CL-07, CL-08)", () => {
  it("gives one key to the same account on two channels", () => {
    const email = computeSignals(feedback({}), customers, weighting, now);
    const note = computeSignals(
      feedback({
        id: "R-101",
        channel: "note_csm",
        source_type: "interne",
        author_email: "ines.marchand@jalon.fr",
        raw_text: "Studio Bastide (Ent., 90 p.) : très mécontent.",
      }),
      customers,
      weighting,
      now,
    );
    expect(email.account_key).toBe("C-013");
    expect(note.account_key).toBe(email.account_key);
  });

  it("keys an unidentified author by e-mail, then by name, and an internal note by itself", () => {
    expect(accountKey(feedback({ author_email: " Anne.Dupont@Outlook.fr " }), null)).toBe(
      "email:anne.dupont@outlook.fr",
    );
    expect(accountKey(feedback({ author_email: null, author_name: "Anne Dupont" }), null)).toBe(
      "auteur:anne dupont",
    );
    expect(
      accountKey(feedback({ channel: "note_csm", source_type: "interne", id: "R-200" }), null),
    ).toBe("retour:R-200");
  });

  it("computes plan, segment, MRR, renewal, prospect flag and source weight", () => {
    const s = computeSignals(feedback({}), customers, weighting, now);
    expect(s).toMatchObject({
      customer_id: "C-013",
      plan: "enterprise",
      segment: "agence_digitale",
      mrr_eur: 2700,
      renewal_in_days: 20,
      is_prospect: false,
      source_weight: 1,
    });
    const prospect = computeSignals(
      feedback({
        channel: "note_sales",
        source_type: "interne",
        author_email: "a@jalon.fr",
        raw_text: "Forgeval Industrie veut du suivi du temps.",
      }),
      customers,
      weighting,
      now,
    );
    expect(prospect).toMatchObject({
      is_prospect: true,
      plan: null,
      mrr_eur: 0,
      source_weight: 0.5,
    });
    const unknown = computeSignals(
      feedback({ author_email: "julie.roux27@hotmail.fr" }),
      customers,
      weighting,
      now,
    );
    expect(unknown).toMatchObject({
      customer_id: null,
      plan: null,
      segment: null,
      mrr_eur: 0,
      renewal_in_days: null,
      is_prospect: false,
    });
  });
});

describe("helpers", () => {
  it("normalizes names and measures edit distance", () => {
    expect(normalizeName("Clim'Ouest Services")).toBe("clim ouest services");
    expect(normalizeName("Équinoxe  Conseil")).toBe("equinoxe conseil");
    expect(levenshtein("mercure", "mercur")).toBe(1);
    expect(levenshtein("kiosque", "kiosque")).toBe(0);
  });
});
