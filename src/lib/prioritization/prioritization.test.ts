import { describe, expect, it } from "vitest";
import type { CapacityReport } from "@/lib/scoring/capacity";
import { EMPTY_JOURNAL_FILTER, filterJournal, journalValue, type JournalEntry } from "./journal";
import { buildRecommendations, type RecommendationRow } from "./recommendations";
import { parsePrioritizationParams } from "./params";
import { manualTopicSchema, overrideRequestSchema } from "./requests";

const capacity: CapacityReport = {
  capacity_weeks: 42,
  must_weeks: 10,
  share: 0.24,
  alert: false,
  downgrade: [],
};

const row = (id: string, extra: Partial<RecommendationRow> = {}): RecommendationRow => ({
  id,
  title: `Titre ${id}`,
  moscow_reco: "should",
  moscow_final: "should",
  alignment: "aligne",
  alignment_rationale: "Sert O1-KR1.",
  rule_flags: [],
  robustness: "robuste",
  context_changed: [],
  ...extra,
});

describe("buildRecommendations", () => {
  it("is empty when nothing needs the PO", () => {
    expect(
      buildRecommendations({ rows: [row("I-01")], tensions: [], capacity, titles: new Map() }),
    ).toEqual([]);
  });

  it("lists capacity, gaps, off-strategy, tensions, rules in tension, fragile ranks and changed contexts, in order", () => {
    const recos = buildRecommendations({
      rows: [
        row("I-01", { moscow_final: "must" }),
        row("I-11", {
          alignment: "hors_strategie",
          alignment_rationale: "Non-cible : comptabilité.",
          moscow_reco: "wont",
          moscow_final: "wont",
          rule_flags: [
            {
              rule: "signal_churn",
              status: "tension",
              category: "must",
              detail: "Compte Enterprise à risque.",
              piste: "Action CSM.",
            },
          ],
        }),
        row("I-05", { robustness: "fragile", context_changed: ["impact"] }),
      ],
      tensions: [
        {
          insight_a: "I-30",
          insight_b: "I-32",
          rationale: "Simple contre complet.",
          segments: ["freelance", "agence"],
        },
        { insight_a: "I-40", insight_b: "I-41", rationale: null, segments: [] },
      ],
      capacity: { ...capacity, must_weeks: 30, share: 0.71, alert: true, downgrade: ["I-01"] },
      titles: new Map(),
    });
    expect(recos.map((r) => [r.kind, r.insight_ids])).toEqual([
      ["capacite", ["I-01"]],
      ["ecart", ["I-01"]],
      ["hors_strategie", ["I-11"]],
      ["regle_en_tension", ["I-11"]],
      ["fragile", ["I-05"]],
      ["contexte_modifie", ["I-05"]],
    ]);
    expect(recos[2]).toMatchObject({ detail: "Non-cible : comptabilité.", piste: null });
    expect(recos[3].piste).toBe("Action CSM.");
    expect(recos[5].detail).toContain("Impact");
  });

  it("keeps a segment tension when one side is ranked, with the titles when no rationale", () => {
    const recos = buildRecommendations({
      rows: [row("I-30")],
      tensions: [
        {
          insight_a: "I-30",
          insight_b: "I-32",
          rationale: null,
          segments: [
            { segment: "Free / Pro", position: "Plus simple" },
            { segment: "Business", position: "Plus de champs" },
          ],
        },
      ],
      capacity,
      titles: new Map([
        ["I-30", "Simple"],
        ["I-32", "Complet"],
      ]),
    });
    expect(recos).toMatchObject([
      {
        kind: "tension_segments",
        title: "Tension entre I-30 et I-32 (Free / Pro / Business)",
        detail: "Simple / Complet",
      },
    ]);
  });

  it("explains the opportunity cost of an off-strategy insight the PO keeps", () => {
    const [reco] = buildRecommendations({
      rows: [row("I-11", { alignment: "hors_strategie", moscow_reco: "should" })],
      tensions: [],
      capacity,
      titles: new Map(),
    });
    expect(reco.piste).toMatch(/coût d'opportunité/);
  });
});

describe("journal", () => {
  const entry = (id: string, extra: Partial<JournalEntry>): JournalEntry => ({
    id,
    actor: "po",
    source: "signal_ui",
    entity_type: "insight",
    entity_id: "I-07",
    action: "override",
    field: "impact",
    before: 1,
    after: 2,
    reason: null,
    created_at: "2026-06-01T10:00:00Z",
    ...extra,
  });
  const entries = [
    entry("D-001", {}),
    entry("D-002", { action: "validation", entity_id: "I-01" }),
    entry("D-003", { source: "chat", entity_id: "I-17" }),
  ];

  it("filters by action, source and entity", () => {
    expect(filterJournal(entries, EMPTY_JOURNAL_FILTER)).toHaveLength(3);
    expect(filterJournal(entries, { ...EMPTY_JOURNAL_FILTER, action: "validation" })).toEqual([
      entries[1],
    ]);
    expect(filterJournal(entries, { ...EMPTY_JOURNAL_FILTER, source: "chat" })).toEqual([
      entries[2],
    ]);
    expect(
      filterJournal(entries, { ...EMPTY_JOURNAL_FILTER, entity: " i-0" }).map((e) => e.id),
    ).toEqual(["D-001", "D-002"]);
  });

  it("renders before / after values", () => {
    expect(journalValue(null, "impact")).toBe("—");
    expect(journalValue(0.8, "confidence")).toMatch(/^80\s%$/);
    expect(journalValue(1.5, "impact")).toBe("1,5");
    expect(journalValue("wont", "moscow")).toBe("Won't");
    expect(journalValue("autre", "x")).toBe("autre");
    expect(journalValue(true, null)).toBe("oui");
    expect(journalValue(false, null)).toBe("non");
    expect(journalValue(["I-01", "I-02"], null)).toBe("I-01, I-02");
    expect(journalValue({ mode: "comptes", value: 40 }, "reach")).toBe("40 comptes");
    expect(journalValue({ mode: "mrr", value: 1200 }, "reach")).toMatch(/^1\s200\s€ \(MRR\)$/);
    expect(journalValue({ comptes: 30, mrr: null }, "reach")).toBe("30 comptes, MRR non renseigné");
    expect(journalValue({ comptes: 30, mrr: 900 }, "reach")).toMatch(/MRR 900\s€/);
    expect(journalValue({ title: "Migrer" }, "creation")).toBe("Migrer");
    expect(journalValue({ x: 1 }, null)).toBe('{"x":1}');
  });
});

describe("requests", () => {
  it("parses an override per parameter", () => {
    const base = { insight_id: "I-07", mode: "comptes" };
    expect(overrideRequestSchema.safeParse({ ...base, param: "impact", value: 2 }).success).toBe(
      true,
    );
    expect(
      overrideRequestSchema.safeParse({ ...base, param: "moscow", value: "must" }).success,
    ).toBe(true);
    expect(overrideRequestSchema.safeParse({ ...base, param: "moscow", value: 2 }).success).toBe(
      false,
    );
    expect(overrideRequestSchema.safeParse({ ...base, param: "impact", value: "2" }).success).toBe(
      false,
    );
    expect(
      overrideRequestSchema.safeParse({ ...base, insight_id: "R-001", param: "impact", value: 2 })
        .success,
    ).toBe(false);
  });

  it("parses a manual topic", () => {
    const topic = {
      title: "Migrer l'authentification",
      problem_statement: "Le SSO est bloqué par l'authentification maison.",
      reach_comptes: 30,
      reach_mrr: null,
      impact: 2,
      confidence: 80,
      effort_weeks: null,
      reason: "Dette technique",
    };
    expect(manualTopicSchema.safeParse(topic).success).toBe(true);
    expect(manualTopicSchema.safeParse({ ...topic, title: "x" }).success).toBe(false);
    expect(manualTopicSchema.safeParse({ ...topic, reason: "" }).success).toBe(false);
  });
});

describe("parsePrioritizationParams", () => {
  it("reads the Reach mode and the insight to focus, ignoring unknown values", () => {
    expect(parsePrioritizationParams({ reach: "mrr", insight: "I-07" }, "comptes")).toEqual({
      mode: "mrr",
      focus: "I-07",
    });
    expect(parsePrioritizationParams({ reach: ["comptes"], insight: "x" }, "mrr")).toEqual({
      mode: "comptes",
      focus: null,
    });
    expect(parsePrioritizationParams({ reach: "autre" }, "comptes")).toEqual({
      mode: "comptes",
      focus: null,
    });
  });
});
