import { describe, expect, it } from "vitest";
import type { StoredEvalRun } from "./catalog";
import { buildEvalCards, edgeCases, evalStatus, modelComparison } from "./dashboard";
import type { Metric } from "./types";

const metric = (key: string, value: number | null, extra: Partial<Metric> = {}): Metric => ({
  key,
  label: key,
  value,
  display: String(value),
  ...extra,
});

const run = (
  eval_name: string,
  started_at: string,
  metrics: Metric[],
  extra: Partial<StoredEvalRun> = {},
): StoredEvalRun => ({
  id: `${eval_name}-${started_at}`,
  eval_name,
  config: {},
  sample_size: 10,
  metrics: { dataset: "Jeu réservé", metrics },
  cost_eur: 0.1,
  langfuse_url: null,
  git_sha: "abc123",
  started_at,
  ended_at: started_at,
  ...extra,
});

describe("evalStatus", () => {
  const ok = metric("a", 1, { target: "≥ 1", met: true });
  const ko = metric("b", 0, { target: "≥ 1", met: false });
  it("is green when every target is met, orange when some are, red when none", () => {
    expect(evalStatus([ok, ok])).toBe("vert");
    expect(evalStatus([ok, ko])).toBe("orange");
    expect(evalStatus([ko, ko])).toBe("rouge");
  });
  it("ignores metrics without a target or not measurable", () => {
    expect(evalStatus([metric("c", 3)])).toBe("aucun");
    expect(evalStatus([ok, metric("d", null, { target: "≥ 1", met: null })])).toBe("vert");
  });
});

describe("buildEvalCards", () => {
  it("gives one card per eval, even never measured", () => {
    const cards = buildEvalCards([]);
    expect(cards.map((c) => c.name)).toContain("backlog");
    expect(cards.every((c) => c.latest === null && c.trend.length === 0)).toBe(true);
  });

  it("shows the latest finished run and the headline trend, oldest first", () => {
    const headline = (value: number, met: boolean) =>
      metric("type_accuracy", value, { target: "≥ 90 %", met });
    const cards = buildEvalCards([
      run("triage", "2026-10-06T01:00:00Z", [headline(0.887, false), metric("x", 1)]),
      run("triage", "2026-10-05T01:00:00Z", [headline(0.85, false)]),
      // Unfinished and failed runs are left out.
      run("triage", "2026-10-07T01:00:00Z", [headline(0.95, true)], { ended_at: null }),
      { ...run("triage", "2026-10-08T01:00:00Z", []), metrics: {} },
    ]);
    const triage = cards.find((c) => c.name === "triage")!;
    expect(triage.trend.map((p) => p.value)).toEqual([0.85, 0.887]);
    expect(triage.latest?.headline?.value).toBe(0.887);
    expect(triage.latest?.status).toBe("rouge");
    expect(triage.latest?.missed.map((m) => m.key)).toEqual(["type_accuracy"]);
  });
});

describe("modelComparison", () => {
  it("pairs the metrics of each model and scales the cost to the full set", () => {
    const rows = modelComparison(
      [
        metric("type_accuracy_haiku", 0.89),
        metric("cost_per_100_haiku", 0.15),
        metric("type_accuracy_sonnet", 0.95),
        metric("latency_p50_sonnet", 4316),
      ],
      200,
    );
    expect(rows[0]).toMatchObject({ model: "haiku", costPer100: 0.15, costFullSet: 0.3 });
    expect(rows[0].typeAccuracy?.value).toBe(0.89);
    expect(rows[1]).toMatchObject({ model: "sonnet", costPer100: null, costFullSet: null });
    expect(rows[1].latency?.value).toBe(4316);
  });
});

describe("edgeCases", () => {
  it("keeps E1 to En in order", () => {
    const cases = edgeCases([
      metric("edge_cases_passed", 7),
      metric("E10", 1),
      metric("E2", 1),
      metric("E1", 1),
    ]);
    expect(cases.map((m) => m.key)).toEqual(["E1", "E2", "E10"]);
  });
});
