import { describe, expect, it } from "vitest";
import { loadCustomers } from "../generate-feedbacks";
import { buildPlan, scaleCounts, type PlannedFeedback } from "./feedback-plan";
import { loadScenario } from "./scenario";

const scenario = loadScenario();
const customers = loadCustomers();
const dev = buildPlan(scenario, customers, "development").feedbacks;
const holdout = buildPlan(scenario, customers, "holdout").feedbacks;

const items = (plan: PlannedFeedback[]) => plan.flatMap((f) => f.items.map((i) => ({ ...i, f })));
const withPattern = (plan: PlannedFeedback[], id: string) =>
  plan.filter((f) => f.items.some((i) => i.pattern_id === id));
const edge = (plan: PlannedFeedback[], e: string) =>
  plan.filter((f) => f.edge_cases.includes(e as never));
const customer = (id: string | null) => customers.find((c) => c.id === id);

describe("scaleCounts", () => {
  it("keeps the total and the proportions", () => {
    expect(scaleCounts({ a: 7, b: 6, c: 5, d: 4 }, 7)).toEqual([
      ["a", 2],
      ["b", 2],
      ["c", 2],
      ["d", 1],
    ]);
    expect(scaleCounts({ a: 3 }, 3)).toEqual([["a", 3]]);
  });
});

describe("development plan", () => {
  it("is deterministic", () => {
    expect(buildPlan(scenario, customers, "development").feedbacks).toEqual(dev);
  });

  it("has the volumes of scenario.yaml (items) and ~215 feedbacks", () => {
    for (const [id, spec] of Object.entries(scenario.patterns)) {
      expect(items(dev).filter((i) => i.pattern_id === id).length, id).toBe(spec.volume);
    }
    for (const t of scenario.noise.topics) {
      expect(items(dev).filter((i) => i.topic === t.key).length, t.key).toBe(t.count);
    }
    expect(dev).toHaveLength(214);
    expect(new Set(dev.map((f) => f.id)).size).toBe(214);
    expect(dev.map((f) => f.id)).toContain("R-001");
  });

  it("keeps every noise topic below the ranking threshold (weak signals)", () => {
    for (const t of scenario.noise.topics.filter(
      (t) => !t.variants && t.type !== "eloge" && t.type !== "autre",
    )) {
      expect(t.count, t.key).toBeLessThan(5);
    }
  });

  it("knows the account of every in-app comment and NPS answer (SPEC §4.2)", () => {
    for (const f of dev.filter((f) => f.channel === "commentaire_in_app" || f.channel === "nps")) {
      expect(f.customer_id, f.key).not.toBeNull();
    }
    for (const f of dev.filter((f) => f.channel === "nps")) expect(f.nps_score).not.toBeNull();
    for (const f of dev.filter((f) => f.channel !== "nps")) expect(f.nps_score).toBeNull();
  });

  it("spreads S1 over 4 channels and many distinct accounts", () => {
    const s1 = withPattern(dev, "S1");
    expect(new Set(s1.map((f) => f.channel)).size).toBe(4);
    expect(new Set(s1.map((f) => f.customer_id)).size).toBeGreaterThanOrEqual(10);
    for (const f of s1.filter((f) => f.channel === "note_csm")) {
      expect(["business", "enterprise"]).toContain(customer(f.customer_id)?.plan);
    }
  });

  it("gives S2a mostly to Free and Pro accounts, S2b to the accounts of SPEC §4.5", () => {
    const s2a = withPattern(dev, "S2a").filter((f) => f.customer_id);
    const small = s2a.filter((f) => ["free", "pro"].includes(customer(f.customer_id)?.plan ?? ""));
    expect(small.length / s2a.length).toBeGreaterThanOrEqual(0.75);
    const s2b = new Set(withPattern(dev, "S2b").map((f) => customer(f.customer_id)?.name));
    expect(s2b).toEqual(
      new Set([
        "Atelier Mercure",
        "Studio Bastide",
        "Groupe Hélix",
        "Agence Ponant",
        "Agence Polygone",
      ]),
    );
    expect(
      withPattern(dev, "S2b")
        .filter((f) => f.churn_signal)
        .every((f) => f.account?.name === "Studio Bastide"),
    ).toBe(true);
  });

  it("concentrates S7 on the last 5 days and nothing else is new", () => {
    expect(withPattern(dev, "S7").every((f) => f.days_ago <= 4)).toBe(true);
    for (const id of ["S1", "S2a", "S3", "S5a", "S5b"]) {
      expect(Math.max(...withPattern(dev, id).map((f) => f.days_ago)), id).toBeGreaterThanOrEqual(
        14,
      );
    }
  });

  it("ties S4 to the prospect Forgeval through internal notes only", () => {
    const s4 = withPattern(dev, "S4");
    expect(new Set(s4.map((f) => customer(f.customer_id)?.name))).toEqual(
      new Set(["Forgeval Industrie"]),
    );
    expect(s4.every((f) => f.source_type === "interne")).toBe(true);
  });

  it("plants exactly one injection, in a support ticket", () => {
    const injections = dev.filter((f) => f.is_injection);
    expect(injections).toHaveLength(1);
    expect(injections[0].channel).toBe("ticket_support");
  });

  it("plants every edge case of SPEC §5.3", () => {
    expect(edge(dev, "E1")).toHaveLength(8);
    for (const f of edge(dev, "E1")) {
      expect(f.items).toHaveLength(2);
      expect(new Set(f.items.map((i) => i.pattern_id + i.topic)).size).toBe(2);
    }
    // E2: one Free account relaunches 4 times on S2a; one Business account sends S1 by e-mail then ticket.
    const relaunch = edge(dev, "E2").filter((f) => f.items[0].pattern_id === "S2a");
    expect(relaunch).toHaveLength(4);
    expect(new Set(relaunch.map((f) => f.customer_id)).size).toBe(1);
    expect(customer(relaunch[0].customer_id)?.plan).toBe("free");
    const cross = edge(dev, "E2").filter((f) => f.items[0].pattern_id === "S1");
    expect(new Set(cross.map((f) => f.channel))).toEqual(
      new Set(["email_client", "ticket_support"]),
    );
    expect(new Set(cross.map((f) => f.customer_id)).size).toBe(1);
    expect(edge(dev, "E3").every((f) => f.language === "en")).toBe(true);
    expect(edge(dev, "E3")).toHaveLength(4);
    expect(edge(dev, "E4").every((f) => f.items[0].expected_type === "autre")).toBe(true);
    expect(edge(dev, "E4").some((f) => f.fixed_text === "")).toBe(true);
    expect(edge(dev, "E5")).toHaveLength(4);
    expect(edge(dev, "E5").every((f) => f.items[0].existing_feature)).toBe(true);
    expect(
      edge(dev, "E6").every((f) => f.channel === "ticket_support" && (f.min_chars ?? 0) > 6000),
    ).toBe(true);
    expect(edge(dev, "E6")).toHaveLength(2);
    expect(edge(dev, "E7")).toHaveLength(5);
    expect(
      edge(dev, "E7").every((f) => f.customer_id === null && f.channel === "email_client"),
    ).toBe(true);
    expect(
      edge(dev, "E7").every((f) =>
        /@(gmail|orange|outlook|free|yahoo|hotmail)\./.test(f.author_email),
      ),
    ).toBe(true);
    expect(edge(dev, "E8")).toHaveLength(3);
    expect(edge(dev, "E8").every((f) => f.sentiment_sign === -1)).toBe(true);
  });

  it("uses company e-mail domains for known accounts and @jalon.fr for internal notes", () => {
    for (const f of dev) {
      const c = customer(f.customer_id);
      if (f.source_type === "interne") expect(f.author_email, f.key).toMatch(/@jalon\.fr$/);
      else if (c && !f.edge_cases.includes("E4"))
        expect(f.author_email.endsWith(`@${c.email_domain}`), f.key).toBe(true);
    }
  });

  it("writes briefs that never leak a pattern id to the writer", () => {
    for (const f of dev) {
      for (const text of [...f.items.map((i) => i.brief), ...f.notes]) {
        expect(text, f.key).not.toMatch(/\b(S[1-7]|S2a|S2b|S5a|S5b)\b|pattern/);
      }
    }
  });
});

describe("holdout plan", () => {
  it("has ~80 feedbacks with every pattern, S6 included, and H- ids", () => {
    expect(holdout.length).toBeGreaterThanOrEqual(75);
    expect(holdout.length).toBeLessThanOrEqual(85);
    for (const id of Object.keys(scenario.patterns))
      expect(withPattern(holdout, id).length, id).toBeGreaterThan(0);
    expect(holdout.filter((f) => f.is_injection)).toHaveLength(1);
    expect(holdout.every((f) => f.id.startsWith("H-"))).toBe(true);
  });

  it("does not reuse the development angles", () => {
    const angles = Object.values(scenario.patterns).flatMap((p) => p.angles ?? []);
    for (const f of holdout)
      for (const i of f.items) for (const a of angles) expect(i.brief).not.toContain(a);
  });
});
