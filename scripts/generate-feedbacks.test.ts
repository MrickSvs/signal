import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  copiedAngle,
  loadCustomers,
  previewSelection,
  toFeedback,
  toGroundTruth,
  writtenIssues,
} from "./generate-feedbacks";
import { buildPlan } from "./lib/feedback-plan";
import { FEEDBACK_FILES, feedbackSchema, groundTruthSchema } from "./lib/feedbacks";
import { loadScenario } from "./lib/scenario";

const plan = buildPlan(loadScenario(), loadCustomers(), "development").feedbacks;
const byEdge = (e: string) => plan.find((f) => f.edge_cases.includes(e as never))!;
const plain = plan.find(
  (f) => f.channel === "email_client" && f.edge_cases.length === 0 && !f.is_injection,
)!;
const ok = {
  subject: "Tâches non reçues",
  raw_text:
    "Bonjour, depuis la dernière mise à jour certains collègues ne reçoivent pas les mails quand on leur assigne une tâche. Merci de regarder.",
};

describe("writtenIssues", () => {
  it("accepts a plain feedback", () => {
    expect(writtenIssues(plain, ok)).toEqual([]);
  });

  it("rejects pattern ids, absolute dates, weekdays and months", () => {
    expect(writtenIssues(plain, { ...ok, raw_text: `${ok.raw_text} (S1)` })[0]).toMatch(
      /identifiant/,
    );
    expect(writtenIssues(plain, { ...ok, raw_text: `${ok.raw_text} Depuis lundi.` })[0]).toMatch(
      /jour/,
    );
    expect(writtenIssues(plain, { ...ok, raw_text: `${ok.raw_text} Depuis le 12/03.` })[0]).toMatch(
      /date/,
    );
    expect(writtenIssues(plain, { ...ok, raw_text: `${ok.raw_text} Depuis mars.` })[0]).toMatch(
      /mois/,
    );
  });

  it("checks the subject against the channel", () => {
    expect(writtenIssues(plain, { ...ok, subject: null })).toContain("objet manquant");
    const inApp = plan.find(
      (f) => f.channel === "commentaire_in_app" && f.edge_cases.length === 0,
    )!;
    expect(writtenIssues(inApp, ok)).toContain("objet en trop pour ce canal");
  });

  it("checks language, length of long threads and the injection sentence", () => {
    expect(writtenIssues(byEdge("E3"), ok)).toContain("devait être rédigé en anglais");
    expect(writtenIssues(byEdge("E6"), ok).join()).toMatch(/trop court/);
    const injection = plan.find((f) => f.is_injection)!;
    expect(writtenIssues(injection, ok)).toContain("la phrase adressée à l'IA manque");
  });
});

describe("outputs", () => {
  it("produces feedbacks without any label and a valid ground truth", () => {
    for (const f of plan) {
      const feedback = toFeedback(f, {
        subject: f.has_subject ? "Objet" : null,
        raw_text: "Texte.",
      });
      expect(feedbackSchema.safeParse(feedback).success, f.key).toBe(true);
      expect(Object.keys(feedback)).not.toContain("patterns");
      expect(JSON.stringify(feedback)).not.toMatch(/"S[1-7]|pattern_id|edge_cases/);
      expect(groundTruthSchema.safeParse(toGroundTruth(f)).success, f.key).toBe(true);
    }
  });

  it("keeps the writer's brief out of the ground truth", () => {
    expect(JSON.stringify(toGroundTruth(plan[0]))).not.toContain("brief");
  });
});

describe("previewSelection", () => {
  it("picks 5 S1, 5 S3 on varied channels and 2 multi-topic feedbacks", () => {
    const selection = previewSelection(plan);
    expect(selection).toHaveLength(12);
    expect(selection.slice(0, 5).every((f) => f.items[0].pattern_id === "S1")).toBe(true);
    expect(new Set(selection.slice(0, 5).map((f) => f.channel)).size).toBe(4);
    expect(selection.slice(5, 10).every((f) => f.items[0].pattern_id === "S3")).toBe(true);
    expect(selection.slice(10).every((f) => f.edge_cases.includes("E1"))).toBe(true);
  });
});

describe.each(["development", "holdout"] as const)("versioned %s files", (dataset) => {
  const files = FEEDBACK_FILES[dataset];
  it.runIf(existsSync(files.data) && existsSync(files.truth))("follow the plan exactly", () => {
    const planned = buildPlan(loadScenario(), loadCustomers(), dataset).feedbacks;
    const feedbacks = feedbackSchema.array().parse(JSON.parse(readFileSync(files.data, "utf8")));
    const truth = groundTruthSchema.array().parse(JSON.parse(readFileSync(files.truth, "utf8")));
    expect(feedbacks).toHaveLength(planned.length);
    const byId = new Map(planned.map((f) => [f.id, f]));
    for (const f of feedbacks) {
      const p = byId.get(f.id)!;
      expect(f, f.id).toMatchObject({
        channel: p.channel,
        customer_id: p.customer_id,
        days_ago: p.days_ago,
        author_email: p.author_email,
        nps_score: p.nps_score,
        language: p.language,
      });
      if (p.min_chars) expect(f.raw_text.length).toBeGreaterThanOrEqual(p.min_chars);
      if (p.fixed_text === null) expect(f.raw_text.length, f.id).toBeGreaterThan(0);
      expect(writtenIssues(p, { subject: f.subject, raw_text: f.raw_text }), f.id).toEqual([]);
    }
    expect(truth).toEqual([...planned].sort((a, b) => a.id.localeCompare(b.id)).map(toGroundTruth));
  });
});

describe("copiedAngle", () => {
  it("flags six consecutive words of the angle, accents and case aside", () => {
    const f = plan.find((x) => /Angle à exprimer : .{40,}/.test(x.items[0].brief) && x.items.length === 1)!;
    const angle = /Angle à exprimer : (.*)\.$/.exec(f.items[0].brief)![1];
    expect(copiedAngle(f, `Bonjour. ${angle.toUpperCase()} !`)).not.toBeNull();
    expect(copiedAngle(f, "Bonjour, un texte qui dit tout autre chose avec ses propres mots.")).toBeNull();
  });
});
