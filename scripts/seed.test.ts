import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSTOMERS_FILE } from "./generate-customers";
import { parseCsv } from "./lib/csv";
import { REFERENCE_TICKETS_FILE, type ReferenceTicket } from "./lib/reference-tickets";
import {
  customerRows,
  feedbackRows,
  parisOffsetMinutes,
  receivedAt,
  ticketEmbeddingText,
  ticketRows,
  ticketsToEmbed,
} from "./seed";

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

describe("feedback reception times", () => {
  const parisHour = (d: Date) =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(d),
    );

  it("knows the Paris offset in winter and in summer", () => {
    expect(parisOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(parisOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(120);
  });

  it("places a feedback on its day, at an office hour in Paris, stable across seeds", () => {
    const at = receivedAt("R-042", 10, now);
    expect(at).toEqual(receivedAt("R-042", 10, now));
    expect(parisHour(at)).toBeGreaterThanOrEqual(8);
    expect(parisHour(at)).toBeLessThanOrEqual(18);
    const days = (now.getTime() - at.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(9);
    expect(days).toBeLessThan(11);
  });

  it("never puts a feedback of the day in the future", () => {
    const early = new Date("2026-03-10T06:00:00Z"); // 7:00 in Paris
    for (const id of ["R-001", "R-002", "R-003", "R-004"]) {
      expect(receivedAt(id, 0, early).getTime()).toBeLessThanOrEqual(early.getTime());
    }
  });

  it("drops the offset and keeps the feedback fields", () => {
    const [row] = feedbackRows(
      [
        {
          id: "R-001",
          channel: "nps",
          source_type: "client_direct",
          author_name: "A",
          author_email: "a@b.fr",
          customer_id: "C-001",
          days_ago: 3,
          subject: null,
          raw_text: "Top",
          nps_score: 9,
          language: "fr",
        },
      ],
      now,
    );
    expect(row).not.toHaveProperty("days_ago");
    expect(row).not.toHaveProperty("language");
    expect(row).toMatchObject({ id: "R-001", channel: "nps", nps_score: 9, customer_id: "C-001" });
  });

  it("keeps the account only for connected channels (in-app, NPS)", () => {
    const base = {
      source_type: "client_direct" as const,
      author_name: "A",
      author_email: "a@b.fr",
      customer_id: "C-001",
      days_ago: 3,
      subject: null,
      raw_text: "x",
      nps_score: null,
      language: "fr" as const,
    };
    const rows = feedbackRows(
      [
        { ...base, id: "R-001", channel: "commentaire_in_app" },
        { ...base, id: "R-002", channel: "email_client" },
        { ...base, id: "R-003", channel: "note_csm", source_type: "interne" },
      ],
      now,
    );
    expect(rows.map((r) => r.customer_id)).toEqual(["C-001", null, null]);
  });
});
