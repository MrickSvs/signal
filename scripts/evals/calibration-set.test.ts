import { describe, expect, it } from "vitest";
import { numberSet, planCalibrationSet, type Source } from "./calibration-set";
import { DEGRADATIONS } from "./lib/degrade";

const story = (n: number, insight: string): Source => ({
  id: `US-${String(n).padStart(3, "0")}`,
  kind: "story",
  insight_id: insight,
  content: {
    title: `Story ${n}`,
    value: "rassurer mon client",
    want: `faire la chose ${n}`,
    business_rules: [`règle ${n}`],
    acceptance_criteria: [
      {
        name: "nominal",
        edge_case: true,
        steps: [
          { keyword: "Étant donné", text: "un projet" },
          { keyword: "Quand", text: "j'agis" },
          { keyword: "Alors", text: "je vois le résultat" },
        ],
      },
    ],
    success_kpi: "50 % des projets d'ici la fin du trimestre",
    evidence: ["R-001"],
    estimation: { points: 3 },
  },
});
const other = (id: string, kind: "bug" | "tache", insight: string): Source => ({
  id,
  kind,
  insight_id: insight,
  content: { title: id, repro_steps: ["ouvrir", "cliquer"] },
});

const sources = [
  ...[1, 2, 3, 4, 13, 14].map((n) => story(n, "I-01")),
  ...[5, 6, 7, 8].map((n) => story(n, "I-02")),
  ...[9, 10, 11].map((n) => story(n, "I-03")),
  story(12, "I-04"),
  other("BUG-001", "bug", "I-05"),
  other("BUG-002", "bug", "I-04"),
  other("TT-001", "tache", "I-01"),
  other("TT-002", "tache", "I-02"),
];

describe("planCalibrationSet", () => {
  const planned = planCalibrationSet(sources);

  it("gives 10 stories, 3 bugs and 2 tasks, 5 of them degraded, over at least 4 insights", () => {
    const count = (k: string) => planned.filter((p) => p.kind === k).length;
    expect([count("story"), count("bug"), count("tache")]).toEqual([10, 3, 2]);
    expect(
      planned
        .filter((p) => p.degradation)
        .map((p) => p.degradation)
        .sort(),
    ).toEqual([
      "bug_sans_reproduction",
      "criteres_non_testables",
      "preuves_absentes",
      "story_trop_grosse",
      "valeur_repetee",
    ]);
    expect(new Set(planned.map((p) => p.insight_id)).size).toBeGreaterThanOrEqual(4);
  });

  it("never uses a real story as the source of a degraded one", () => {
    const real = planned
      .filter((p) => p.kind === "story" && !p.degradation)
      .map((p) => p.source_id);
    const degraded = planned
      .filter((p) => p.kind === "story" && p.degradation)
      .map((p) => p.source_id);
    expect(real.filter((id) => degraded.includes(id))).toEqual([]);
    expect(new Set(real).size).toBe(6);
  });

  it("refuses a backlog too short", () => {
    expect(() => planCalibrationSet(sources.slice(6))).toThrow("Backlog trop court");
  });
});

describe("numberSet", () => {
  it("shuffles deterministically and keeps the degradation out of the annotated set", () => {
    const planned = planCalibrationSet(sources);
    const a = numberSet(planned);
    const b = numberSet(planned);
    expect(a).toEqual(b);
    expect(a.items[0].id).toBe("CAL-01");
    expect(JSON.stringify(a.items)).not.toContain("degradation");
    expect(a.key.filter((k) => k.degradation)).toHaveLength(5);
  });
});

describe("DEGRADATIONS", () => {
  const c = story(1, "I-01").content;
  it("damages exactly what they name", () => {
    expect(DEGRADATIONS.valeur_repetee(c).value).toBe("pouvoir faire la chose 1");
    const untestable = DEGRADATIONS.criteres_non_testables(c).acceptance_criteria as {
      edge_case: boolean;
      steps: { keyword: string; text: string }[];
    }[];
    expect(untestable[0].edge_case).toBe(false);
    expect(untestable[0].steps[2].text).toContain("fluide");
    expect(untestable[0].steps[0].text).toBe("un projet");
    const big = DEGRADATIONS.story_trop_grosse(c, [
      story(2, "I-01").content,
      story(3, "I-01").content,
    ]);
    expect(big.business_rules).toEqual(["règle 1", "règle 2", "règle 3"]);
    expect((big.estimation as { points: number }).points).toBe(21);
    expect(DEGRADATIONS.preuves_absentes(c).evidence).toEqual([]);
    expect(DEGRADATIONS.bug_sans_reproduction({ repro_steps: ["a"] }).repro_steps).toEqual([]);
    expect(DEGRADATIONS.criteres_non_testables({}).acceptance_criteria).toEqual([]);
  });
});
