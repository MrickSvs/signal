import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_COLUMNS,
  CUSTOMERS_FILE,
  generateCustomers,
  PLANS,
  PRICE_PER_SEAT,
  PUBLIC_EMAIL_DOMAINS,
  SCENARIO_ACCOUNTS,
  SEGMENT_QUOTAS,
  SEGMENTS,
  slugify,
} from "./generate-customers";
import { parseCsv, toCsv } from "./lib/csv";

const customers = generateCustomers();
const clients = customers.filter((c) => c.status === "client");
const byName = (name: string) => customers.find((c) => c.name === name);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

describe("generateCustomers", () => {
  it("is deterministic and matches the versioned data/customers.csv", () => {
    expect(generateCustomers()).toEqual(customers);
    expect(readFileSync(CUSTOMERS_FILE, "utf8")).toBe(toCsv(CUSTOMER_COLUMNS, customers));
    expect(parseCsv(readFileSync(CUSTOMERS_FILE, "utf8"))).toHaveLength(95);
  });

  it("has 90 clients split by plan as in SPEC §4.2, and 5 prospects", () => {
    expect(clients).toHaveLength(90);
    const counts = Object.fromEntries(
      PLANS.map((p) => [p, clients.filter((c) => c.plan === p).length]),
    );
    expect(counts).toEqual({ free: 25, pro: 30, business: 25, enterprise: 10 });
    const prospects = customers.filter((c) => c.status === "prospect");
    expect(prospects).toHaveLength(5);
    expect(prospects.map((p) => p.name)).toContain(SCENARIO_ACCOUNTS.prospect);
    for (const p of prospects) {
      expect(p.plan).toBeNull();
      expect(p.mrr_eur).toBe(0);
      expect(p.renewal_in_days).toBeNull();
    }
  });

  it("respects the segment quotas (~55 % agencies, 15 % consulting, 20 % SMBs, 10 % off-target)", () => {
    for (const plan of PLANS) {
      for (const segment of SEGMENTS) {
        const n = clients.filter((c) => c.plan === plan && c.segment === segment).length;
        expect(n, `${plan}/${segment}`).toBe(SEGMENT_QUOTAS[plan][segment]);
      }
    }
    const share = (segments: string[]) =>
      clients.filter((c) => segments.includes(c.segment)).length / 90;
    expect(share(["agence_com", "agence_digitale"])).toBeCloseTo(0.55, 1);
    expect(share(["hors_cible"])).toBeCloseTo(0.1, 1);
    expect(byName(SCENARIO_ACCOUNTS.prospect)?.segment).toBe("hors_cible");
  });

  it("keeps seats and MRR consistent with prices and SPEC §4.2 averages", () => {
    for (const c of clients) expect(c.mrr_eur).toBe(c.seats * PRICE_PER_SEAT[c.plan!]);
    const seats = (plan: string) =>
      mean(clients.filter((c) => c.plan === plan).map((c) => c.seats));
    expect(
      Math.max(...clients.filter((c) => c.plan === "free").map((c) => c.seats)),
    ).toBeLessThanOrEqual(3);
    expect(seats("pro")).toBeGreaterThan(4);
    expect(seats("pro")).toBeLessThan(6);
    expect(seats("business")).toBeGreaterThan(10);
    expect(seats("business")).toBeLessThan(14);
    expect(seats("enterprise")).toBeGreaterThan(110);
    expect(seats("enterprise")).toBeLessThan(130);
    for (const c of clients.filter((c) => c.plan === "enterprise")) {
      expect(c.seats).toBeGreaterThanOrEqual(80);
      expect(c.seats).toBeLessThanOrEqual(300);
    }
  });

  it("reproduces the accounts of SPEC §4.5 exactly", () => {
    expect(byName("Atelier Mercure")).toMatchObject({
      plan: "enterprise",
      seats: 140,
      mrr_eur: 4200,
      renewal_in_days: 45,
      health: "orange",
    });
    expect(byName("Studio Bastide")).toMatchObject({
      plan: "enterprise",
      seats: 90,
      mrr_eur: 2700,
      renewal_in_days: 38,
      health: "rouge",
    });
    expect(byName("Groupe Hélix")).toMatchObject({
      plan: "enterprise",
      seats: 110,
      mrr_eur: 3300,
      renewal_in_days: 70,
      health: "orange",
    });
    expect(byName("Forgeval Industrie")).toMatchObject({ status: "prospect", seats: 300 });
    for (const name of SCENARIO_ACCOUNTS.permissionsBusiness)
      expect(byName(name)?.plan).toBe("business");
  });

  it("keeps the other Enterprise accounts out of the 90-day renewal window", () => {
    const others = clients.filter(
      (c) => c.plan === "enterprise" && !SCENARIO_ACCOUNTS.sensitive.includes(c.name as never),
    );
    for (const c of others) expect(c.renewal_in_days).toBeGreaterThan(90);
  });

  it("gives renewal and CSM to Business and Enterprise only", () => {
    for (const c of clients) {
      const paid = c.plan === "business" || c.plan === "enterprise";
      expect(c.renewal_in_days !== null, c.name).toBe(paid);
      expect(c.csm !== null, c.name).toBe(paid);
      expect(c.health).not.toBeNull();
    }
  });

  it("uses unique ids, names and company domains, never a public mailbox", () => {
    expect(new Set(customers.map((c) => c.id)).size).toBe(95);
    expect(customers.map((c) => c.id)).toContain("C-001");
    expect(new Set(customers.map((c) => c.name)).size).toBe(95);
    expect(new Set(customers.map((c) => c.email_domain)).size).toBe(95);
    for (const c of customers) {
      expect(PUBLIC_EMAIL_DOMAINS).not.toContain(c.email_domain);
      expect(c.email_domain).toMatch(/^[a-z0-9-]+\.(fr|com|eu)$/);
    }
  });
});

describe("slugify", () => {
  it("removes accents and symbols", () => {
    expect(slugify("Clim'Ouest Services")).toBe("clim-ouest-services");
    expect(slugify("Plume & Cie")).toBe("plume-et-cie");
    expect(slugify("Groupe Hélix")).toBe("groupe-helix");
  });
});
