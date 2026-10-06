// Degradations of the calibration set (PLAN 6.3): copies of items drafted by Signal, damaged in
// code on purpose, so the judge and the PO both meet clearly bad items. Pure.

type Content = Record<string, unknown>;
type Scenario = { name: string; edge_case: boolean; steps: { keyword: string; text: string }[] };

const scenarios = (c: Content) =>
  Array.isArray(c.acceptance_criteria) ? (c.acceptance_criteria as Scenario[]) : [];
const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export const DEGRADATIONS = {
  /** « Afin de » repeats the « je veux » instead of a result for the user. */
  valeur_repetee: (c: Content): Content => ({ ...c, value: `pouvoir ${String(c.want ?? "")}` }),
  /** Results that QA cannot observe, no edge case. */
  criteres_non_testables: (c: Content): Content => ({
    ...c,
    acceptance_criteria: scenarios(c).map((s) => ({
      ...s,
      edge_case: false,
      steps: s.steps.map((step) =>
        step.keyword === "Alors" || step.keyword === "Et"
          ? { ...step, text: "l'expérience est fluide et l'utilisateur est satisfait" }
          : step,
      ),
    })),
  }),
  /** Several stories glued together: several journeys, far beyond 8 points. */
  story_trop_grosse: (c: Content, others: readonly Content[]): Content => ({
    ...c,
    title: [c.title, ...others.map((o) => o.title)].join(", "),
    want: [c.want, ...others.map((o) => o.want)].join(", et "),
    business_rules: [c, ...others].flatMap((o) => strings(o.business_rules)),
    acceptance_criteria: [c, ...others].flatMap(scenarios),
    estimation: { ...(c.estimation as Content), points: 21 },
  }),
  /** No evidence and a vague KPI: nothing ties the story to the feedbacks. */
  preuves_absentes: (c: Content): Content => ({
    ...c,
    evidence: [],
    success_kpi: "Améliorer la satisfaction des utilisateurs.",
  }),
  /** A bug without reproduction steps. */
  bug_sans_reproduction: (c: Content): Content => ({ ...c, repro_steps: [] }),
} as const;

export type Degradation = keyof typeof DEGRADATIONS;
