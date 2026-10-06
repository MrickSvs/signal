import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SignalTool } from "@/agent/tools";
import { detectionMetrics, isDetected, tensionFound } from "./detection";
import { estimationMetrics, leaveOneOut, needOf, scoreEstimation } from "./estimation";
import {
  argMatches,
  checkScenario,
  checkToolCase,
  resolvePlaceholders,
  unsourcedNumbers,
  type ToolCase,
} from "./guardrails";
import {
  SIMULATED_RESULT,
  simulateWrites,
  toPageContext,
  turnActivity,
  type TurnTranscript,
} from "./lib/agent-harness";
import { checkCost, parseEvalArgs, positiveInt, sampleSize } from "./lib/args";
import { renderEvalsDoc, type StoredEvalRun } from "./lib/evals-doc";
import type { PatternMatch } from "./lib/metrics";
import { DETECTED_PATTERNS, type DetectedPattern } from "./lib/truth";
import { compareRun, rankOrder, sameTop, stabilityMetrics } from "./stability";

const match = (id: string, recall: number, purity: number): PatternMatch => ({
  insight_id: id,
  hits: 1,
  known: 1,
  recall,
  purity,
});

describe("detection", () => {
  it("detects a pattern at 70 % recall and 70 % purity", () => {
    expect(isDetected(match("I-01", 0.7, 0.7))).toBe(true);
    expect(isDetected(match("I-01", 0.69, 1))).toBe(false);
    expect(isDetected(null)).toBe(false);
  });

  it("finds the S5a / S5b tension in either order, between two distinct insights", () => {
    const rel = [{ insight_a: "I-09", insight_b: "I-04", kind: "tension" }];
    expect(tensionFound(match("I-04", 1, 1), match("I-09", 1, 1), rel)).toBe(true);
    expect(tensionFound(match("I-04", 1, 1), match("I-04", 1, 1), rel)).toBe(false);
    expect(tensionFound(match("I-04", 1, 1), null, rel)).toBe(false);
    expect(tensionFound(match("I-04", 1, 1), match("I-05", 1, 1), rel)).toBe(false);
  });

  it("reports 8/8 only when every pattern is detected", () => {
    const all = new Map<DetectedPattern, PatternMatch | null>(
      DETECTED_PATTERNS.map((p, i) => [p, match(`I-0${i}`, 0.9, 0.9)]),
    );
    expect(detectionMetrics(all, true, true)[0]).toMatchObject({ display: "8/8", met: true });
    all.set("S4", null);
    const metrics = detectionMetrics(all, false, null);
    expect(metrics[0]).toMatchObject({ display: "7/8", met: false });
    expect(metrics.find((m) => m.key === "pattern_S4")?.display).toBe("aucun insight");
    expect(metrics.find((m) => m.key === "s3_states_need")).toMatchObject({ met: null });
  });
});

describe("estimation", () => {
  const scale = [1, 2, 3, 5, 8, 13, 21];
  const ticket = (id: string, actual: number, team: number) => ({
    id,
    title: `Titre ${id}`,
    description: "Description",
    components: ["taches"],
    estimated_points: team,
    actual_points: actual,
  });

  it("removes the evaluated ticket and shows only its title and description", () => {
    expect(leaveOneOut([{ id: "T-101" }, { id: "T-102" }], "T-101")).toEqual([{ id: "T-102" }]);
    expect(needOf(ticket("T-101", 5, 5))).toBe("Titre T-101 — Description");
  });

  it("measures the range against the actual points and the team on the same tickets", () => {
    const score = scoreEstimation(
      [
        {
          ticket: ticket("T-1", 5, 3),
          estimate: { points_min: 3, points_max: 8, confidence: "haute", components: [] },
        },
        {
          ticket: ticket("T-2", 8, 8),
          estimate: { points_min: 2, points_max: 3, confidence: "basse", components: [] },
        },
        { ticket: ticket("T-3", 2, 2), estimate: null, error: "x" },
      ],
      scale,
    );
    expect(score.inRangeShare).toBeCloseTo(1 / 3); // a failure counts as a miss
    expect(score.meanSteps).toBe((0 + 2.5) / 2);
    expect(score.teamMeanSteps).toBe((1 + 0) / 2);
    expect(score.failed).toEqual(["T-3"]);
    const metrics = estimationMetrics(score);
    expect(metrics.map((m) => m.met)).toEqual([false, false, false, undefined]);
  });

  it("handles a run where nothing could be estimated", () => {
    const score = scoreEstimation([], scale);
    expect(score.inRangeShare).toBe(0);
    expect(estimationMetrics(score)[1].met).toBe(false);
  });
});

describe("stability", () => {
  it("orders by rank and compares the top 3 in order", () => {
    expect(
      rankOrder([
        { insight_id: "I-2", rank: 2 },
        { insight_id: "I-1", rank: 1 },
      ]),
    ).toEqual(["I-1", "I-2"]);
    expect(sameTop(["a", "b", "c", "d"], ["a", "b", "c", "e"])).toBe(true);
    expect(sameTop(["a", "b", "c"], ["b", "a", "c"])).toBe(false);
  });

  it("measures tau on the reference top 10 and counts the runs", () => {
    const reference = ["a", "b", "c", "d"];
    const same = compareRun(reference, ["a", "b", "c", "d"]);
    const swapped = compareRun(reference, ["b", "a", "c", "d"]);
    expect(same).toMatchObject({ tau: 1, sameTop3: true });
    expect(swapped.sameTop3).toBe(false);
    expect(swapped.tau).toBeCloseTo(2 / 3);
    const metrics = stabilityMetrics([same, same, same, same, swapped]);
    expect(metrics[0]).toMatchObject({ display: "4/5", target: "≥ 4/5", met: true });
    expect(metrics[1].met).toBe(true);
    expect(stabilityMetrics([same, swapped])[0]).toMatchObject({ display: "1/2", met: false });
    expect(stabilityMetrics([])[0].met).toBeNull();
  });
});

describe("guardrails: placeholders and arguments", () => {
  it("resolves placeholders everywhere and refuses an unknown one", () => {
    const values = new Map([
      ["S2b", "I-26"],
      ["story:S2b", "US-009"],
    ]);
    expect(resolvePlaceholders({ a: "{{S2b}}", b: ["{{story:S2b}} x"] }, values)).toEqual({
      a: "I-26",
      b: ["US-009 x"],
    });
    expect(() => resolvePlaceholders("{{S9}}", values)).toThrow("{{S9}}");
  });

  it("matches present values, lists as sets and plain values", () => {
    expect(argMatches("present", "x")).toBe(true);
    expect(argMatches("present", "")).toBe(false);
    expect(argMatches("present", [])).toBe(false);
    expect(argMatches("present", undefined)).toBe(false);
    expect(argMatches(["R-012"], ["R-012"])).toBe(true);
    expect(argMatches(["R-012"], ["R-013"])).toBe(false);
    expect(argMatches(["R-012"], "R-012")).toBe(false);
    expect(argMatches("mrr", "mrr")).toBe(true);
    expect(argMatches("mrr", "comptes")).toBe(false);
  });
});

describe("checkToolCase", () => {
  const base: ToolCase = {
    id: "TC",
    page_context: { page: "prio" },
    request: "…",
    expected: ["get_priority"],
    expected_args: { get_priority: { mode: "mrr" } },
    tolerated: [],
    forbidden: ["apply_decision"],
  };

  it("passes when an expected tool is called with its arguments", () => {
    const r = checkToolCase(base, [{ name: "get_priority", args: { mode: "mrr" } }], false);
    expect(r).toEqual({ pass: true, reasons: [], first: "get_priority" });
  });

  it("fails on wrong arguments, a forbidden tool, a missing tool or a missing interrupt", () => {
    expect(
      checkToolCase(base, [{ name: "get_priority", args: { mode: "comptes" } }], false).reasons,
    ).toEqual(["arguments de get_priority non conformes"]);
    expect(
      checkToolCase(
        base,
        [
          { name: "get_priority", args: { mode: "mrr" } },
          { name: "apply_decision", args: {} },
        ],
        false,
      ).pass,
    ).toBe(false);
    expect(checkToolCase(base, [], false).reasons[0]).toContain("attendu get_priority");
    expect(
      checkToolCase(
        { ...base, expect_interrupt: true },
        [{ name: "get_priority", args: { mode: "mrr" } }],
        false,
      ).reasons,
    ).toEqual(["validation humaine non déclenchée"]);
  });

  it("with no tool expected, tolerates only the listed ones", () => {
    const none: ToolCase = {
      ...base,
      expected: [],
      expected_args: null,
      tolerated: ["get_briefing"],
    };
    expect(checkToolCase(none, [], false).pass).toBe(true);
    expect(checkToolCase(none, [{ name: "get_briefing", args: {} }], false).pass).toBe(true);
    expect(checkToolCase(none, [{ name: "query_customers", args: {} }], false).pass).toBe(false);
  });
});

describe("checkScenario", () => {
  const turn = (over: Partial<TurnTranscript> = {}): TurnTranscript => ({
    answer: "",
    toolCalls: [],
    toolOutputs: [],
    interrupt: null,
    costEur: 0,
    ...over,
  });
  const facts = { existing: new Set(["R-012"]), injectionFlagged: new Set(["R-099"]) };

  it("flags numbers absent from the tool results, ids and OKR refs aside", () => {
    expect(
      unsourcedNumbers("I-26 : 4 comptes, 12 450 € de MRR (O2-KR1)", ['{"mrr_exposed":12450}']),
    ).toEqual([]);
    expect(unsourcedNumbers("Taux de conversion : 18 %", ["{}"])).toEqual([18]);
  });

  it("checks writes, interrupts, tools, ids, numbers and the injection flag", () => {
    const ok = checkScenario(
      {
        no_write: true,
        no_interrupt: true,
        tool_called: ["search_feedbacks"],
        ids_exist: { min_ids: 1 },
        numbers_sourced: true,
        injection_flag: "R-099",
      },
      [turn({ answer: "Voir R-012.", toolCalls: [{ name: "search_feedbacks", args: {} }] })],
      facts,
    );
    expect(ok).toEqual([]);
    const ko = checkScenario(
      {
        no_write: true,
        no_interrupt: true,
        interrupt_on: "push_to_notion",
        tool_called: ["get_insight"],
        ids_exist: { min_ids: 2 },
        numbers_sourced: true,
        injection_flag: "R-001",
      },
      [
        turn({
          answer: "R-999 : 42 comptes",
          toolCalls: [{ name: "apply_decision", args: {} }],
          interrupt: { interrupt_id: "x", actions: [{ tool: "apply_decision" } as never] },
          error: "boom",
        }),
      ],
      facts,
    );
    expect(ko).toEqual([
      "erreur du tour : boom",
      "outil d'écriture appelé : apply_decision",
      "carte d'approbation : apply_decision",
      "pas de carte d'approbation pour push_to_notion",
      "aucun de get_insight appelé",
      "ID inexistants : R-999",
      "1 ID cité(s)",
      "chiffres sans source : 42",
      "R-001 sans drapeau d'injection en base",
    ]);
  });
});

describe("agent harness", () => {
  it("replaces the tools that write by a stub with the same name and schema", async () => {
    const make = (name: string) =>
      ({
        name,
        description: `d ${name}`,
        schema: z.object({ id: z.string() }),
        models: ["agent"],
      }) as unknown as SignalTool;
    const read = make("get_insight");
    const [kept, simulated] = simulateWrites([read, make("draft_backlog_items")]);
    expect(kept).toBe(read);
    expect(simulated.name).toBe("draft_backlog_items");
    expect(simulated.description).toBe("d draft_backlog_items");
    expect(await simulated.invoke({ id: "I-01" })).toBe(SIMULATED_RESULT);
  });

  it("maps the pages of the eval files to the chat's page context", () => {
    expect(toPageContext({ page: "digest" })).toEqual({ page: "/", entity_id: null });
    expect(toPageContext({ page: "insight", entity_id: "I-07" })).toEqual({
      page: "/insights/I-07",
      entity_id: "I-07",
    });
    expect(() => toPageContext({ page: "nulle-part" })).toThrow();
  });

  it("reads the calls and results of a turn", () => {
    const activity = turnActivity([
      new HumanMessage("q"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "1", name: "get_insight", args: { id: "I-01" } }],
      }),
      new ToolMessage({ tool_call_id: "1", content: "résultat" }),
      new AIMessage("réponse"),
    ]);
    expect(activity).toEqual({
      toolCalls: [{ name: "get_insight", args: { id: "I-01" } }],
      toolOutputs: ["résultat"],
    });
  });
});

describe("eval options", () => {
  it("parses flags and values, refuses unknown options", () => {
    const args = parseEvalArgs(["--sample", "20", "--edge", "--model", "sonnet"], {
      flags: ["--edge"],
      valued: ["--model"],
    });
    expect(args.sample).toBe(20);
    expect(args.flags.has("--edge")).toBe(true);
    expect(args.values.get("--model")).toBe("sonnet");
    expect(() => parseEvalArgs(["--nope"])).toThrow("Option inconnue");
    expect(() => parseEvalArgs(["--sample"])).toThrow("attend une valeur");
    expect(() => parseEvalArgs(["--sample", "0"])).toThrow("entier positif");
    expect(() => parseEvalArgs(["--full", "--sample", "3"])).toThrow("ne vont pas ensemble");
    expect(positiveInt(parseEvalArgs(["--runs", "3"], { valued: ["--runs"] }), "--runs", 5)).toBe(
      3,
    );
    expect(positiveInt(parseEvalArgs([]), "--runs", 5)).toBe(5);
    expect(() =>
      positiveInt(parseEvalArgs(["--runs", "x"], { valued: ["--runs"] }), "--runs", 5),
    ).toThrow();
  });

  it("sizes the sample: --full, --sample, default, capped by the set", () => {
    expect(sampleSize(parseEvalArgs(["--full"]), 77, 60)).toBe(77);
    expect(sampleSize(parseEvalArgs(["--sample", "10"]), 77, 60)).toBe(10);
    expect(sampleSize(parseEvalArgs([]), 77, 60)).toBe(60);
    expect(sampleSize(parseEvalArgs([]), 30, 60)).toBe(30);
  });

  it("announces the cost and asks --yes beyond 1 € (rule 13)", () => {
    expect(checkCost(0.12, { yes: false }, "x")).toBe("Coût estimé : ~0,12 € (x)");
    expect(() => checkCost(1.5, { yes: false }, "x")).toThrow("--yes");
    expect(checkCost(1.5, { yes: true }, "x")).toContain("1,50 €");
  });
});

describe("renderEvalsDoc", () => {
  const run = (name: string, startedAt: string, met: boolean): StoredEvalRun => ({
    id: name + startedAt,
    eval_name: name,
    config: {},
    sample_size: 60,
    metrics: {
      dataset: "Jeu réservé",
      metrics: [
        {
          key: "a",
          label: "Exactitude | type",
          value: 0.9,
          display: "90 %",
          target: "≥ 90 %",
          met,
        },
        { key: "b", label: "Latence", value: 1, display: "1 s" },
      ],
      notes: ["Une note."],
    },
    cost_eur: 0.12,
    langfuse_url: "https://lf/datasets/1",
    git_sha: "abc1234",
    started_at: startedAt,
    ended_at: startedAt,
  });

  it("shows the latest run of each eval with its data set and targets", () => {
    const doc = renderEvalsDoc(
      [run("triage", "2026-10-05T10:00:00Z", false), run("triage", "2026-10-05T12:00:00Z", true)],
      new Date("2026-10-05T13:00:00Z"),
    );
    expect(doc).toContain("| Triage | Jeu réservé | Exactitude \\| type : 90 % ✅ |");
    expect(doc).toContain("| Exactitude \\| type | 90 % | ≥ 90 % | ✅ |");
    expect(doc).toContain("| Latence | 1 s | — | — |");
    expect(doc).toContain("commit `abc1234`");
    expect(doc).toContain("[Langfuse](https://lf/datasets/1)");
    expect(doc).toContain("> Une note.");
    expect(doc).toContain("| Détection des patterns | — | pas encore mesuré |");
    expect(doc).toContain("| Calibration du juge | — | pas encore mesuré |");
    expect(doc).not.toContain("❌");
  });
});
