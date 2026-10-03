import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSTOMERS_FILE } from "./generate-customers";
import { parseCsv } from "./lib/csv";
import { REFERENCE_TICKETS_FILE, type ReferenceTicket } from "./lib/reference-tickets";
import { customerRows, ticketEmbeddingText, ticketRows, ticketsToEmbed } from "./seed";

const now = new Date("2026-03-10T09:00:00Z");

describe("customerRows", () => {
  const rows = customerRows(parseCsv(readFileSync(CUSTOMERS_FILE, "utf8")), now);

  it("turns renewal offsets into dates relative to DEMO_NOW", () => {
    expect(rows.find((r) => r.name === "Atelier Mercure")).toMatchObject({
      plan: "enterprise",
      seats: 140,
      mrr_eur: 4200,
      renewal_date: "2026-04-24", // J+45
      health: "orange",
    });
  });

  it("maps empty cells to null for prospects and free accounts", () => {
    expect(rows.find((r) => r.name === "Forgeval Industrie")).toMatchObject({
      status: "prospect",
      plan: null,
      renewal_date: null,
      health: null,
      csm: null,
      seats: 300,
    });
    expect(rows.filter((r) => r.plan === "free").every((r) => r.renewal_date === null)).toBe(true);
  });
});

describe("ticketRows and embeddings", () => {
  const tickets: ReferenceTicket[] = JSON.parse(readFileSync(REFERENCE_TICKETS_FILE, "utf8"));

  it("turns delivery offsets into past dates and drops the offset", () => {
    const [first] = ticketRows(tickets, now);
    expect(first).not.toHaveProperty("shipped_days_ago");
    expect(first.shipped_at! < "2026-03-10").toBe(true);
  });

  it("embeds « title — description », never the points", () => {
    expect(ticketEmbeddingText({ title: "Titre", description: "Description." })).toBe(
      "Titre — Description.",
    );
  });

  it("re-embeds only new, edited or embedding-less tickets", () => {
    const [a, b, c, d] = tickets;
    const existing = [
      { id: a.id, title: a.title, description: a.description, has_embedding: true },
      { id: b.id, title: "ancien titre", description: b.description, has_embedding: true },
      { id: c.id, title: c.title, description: c.description, has_embedding: false },
    ];
    expect(ticketsToEmbed([a, b, c, d], existing)).toEqual([b.id, c.id, d.id]);
  });
});
