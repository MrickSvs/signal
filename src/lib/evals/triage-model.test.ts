import { describe, expect, it } from "vitest";
import type { StoredEvalRun } from "./catalog";
import { triageRunFromComparison, withProductionTriage } from "./triage-model";
import type { Metric } from "./types";

const run = (
  id: string,
  eval_name: string,
  config: unknown,
  metrics: Metric[],
  started_at = "2026-10-08T10:00:00Z",
): StoredEvalRun => ({
  id,
  eval_name,
  config,
  sample_size: 60,
  metrics: { dataset: "Jeu réservé, 60 retours", metrics },
  cost_eur: 0.5,
  langfuse_url: null,
  git_sha: "abc",
  started_at,
  ended_at: started_at,
});

const m = (key: string, label: string, value: number): Metric => ({
  key,
  label,
  value,
  display: String(value),
});

const comparison = run("cmp", "triage-compare", {}, [
  m("type_accuracy_haiku", "Exactitude du type (Haiku)", 0.952),
  m("type_accuracy_sonnet", "Exactitude du type (Sonnet)", 0.903),
  m("area_macro_f1_sonnet", "Macro-F1 du domaine (Sonnet)", 0.911),
  m("injection_recall_sonnet", "Rappel de la détection d'injection (Sonnet)", 1),
  m("cost_per_100_sonnet", "Coût pour 100 retours (sonnet)", 0.78),
]);

describe("triageRunFromComparison", () => {
  it("keeps the model's half, with the triage targets and its share of the cost", () => {
    const derived = triageRunFromComparison(comparison, "sonnet")!;
    expect(derived.eval_name).toBe("triage");
    expect(derived.config).toEqual({ model: "sonnet", from_comparison: "cmp" });
    expect(derived.cost_eur).toBeCloseTo(0.468, 10);
    const metrics = (derived.metrics as { metrics: Metric[] }).metrics;
    expect(metrics.map((x) => [x.key, x.label, x.target, x.met])).toEqual([
      ["type_accuracy", "Exactitude du type", "≥ 90 %", true],
      ["area_macro_f1", "Macro-F1 du domaine", "≥ 0,85", true],
      ["injection_recall", "Rappel de la détection d'injection", "100 %", true],
      ["cost_per_100", "Coût pour 100 retours", undefined, undefined],
    ]);
  });

  it("is null without a measure of the model or without a summary", () => {
    expect(triageRunFromComparison(comparison, "opus")).toBeNull();
    expect(triageRunFromComparison({ ...comparison, metrics: {} }, "sonnet")).toBeNull();
  });
});

describe("withProductionTriage", () => {
  it("drops triage runs on another model and adds the comparison's production half", () => {
    const haiku = run("h", "triage", { model: "haiku" }, [m("type_accuracy", "Type", 0.95)]);
    const sonnet = run("s", "triage", { model: "sonnet" }, [m("type_accuracy", "Type", 0.9)]);
    const other = run("d", "detection", null, []);
    const out = withProductionTriage([haiku, sonnet, other, comparison], "sonnet");
    expect(out.map((r) => `${r.eval_name}:${r.id}`)).toEqual([
      "triage:s",
      "detection:d",
      "triage-compare:cmp",
      "triage:cmp",
    ]);
  });
});
