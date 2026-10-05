// The drafted backlog of an insight (SPEC §9.1 to §9.4): the structured output asked of the model
// (a discriminated union on `kind`), and the checks done in code (P2, P5): evidence that belongs to
// the insight, 2 to 5 Gherkin scenarios with an edge case, an epic only around several items, the
// OKRs of strategy.md, the format chosen against the one proposed. Pure: no database, no model.
import { z } from "zod";
import { BACKLOG_FORMATS, type BacklogFormat } from "./choose-format";

export const GHERKIN_KEYWORDS = ["Étant donné", "Quand", "Alors", "Et", "Mais"] as const;
export type GherkinKeyword = (typeof GHERKIN_KEYWORDS)[number];

export const SEVERITIES = ["bloquant", "majeur", "mineur"] as const;

export const MIN_SCENARIOS = 2;
export const MAX_SCENARIOS = 5;
export const MAX_EVIDENCE = 5;
export const MAX_ITEMS = 8;

export type Scenario = {
  name: string;
  edge_case: boolean;
  steps: { keyword: GherkinKeyword; text: string }[];
};

const text = (max: number) => z.string().trim().min(1).max(max);
const lines = (min: number, max: number, length = 300) => z.array(text(length)).min(min).max(max);

const oneOf = (values: readonly string[], what: string) =>
  values.length > 0
    ? z.enum(values as [string, ...string[]])
    : z.string().refine(() => false, { message: `aucun ${what} disponible` });

export const scenarioSchema = z.object({
  name: text(160),
  edge_case: z.boolean().describe("true pour un cas limite ou d'erreur"),
  steps: z
    .array(z.object({ keyword: z.enum(GHERKIN_KEYWORDS), text: text(300) }))
    .min(3)
    .max(8),
});

export type DraftContext = {
  /** Feedback ids of the insight: the only evidence allowed. */
  evidenceIds: readonly string[];
  /** OKR ids of strategy.md. */
  okrIds: readonly string[];
  proposed: BacklogFormat;
  /** An epic kept from an earlier drafting (sent items): new items go into it, no new epic. */
  keptEpicId: string | null;
  /** Items kept from an earlier drafting (sent or validated). */
  keptItems: number;
};

// Evidence ids are plain strings in the schema and checked in code (evidenceIssues): an enum of the
// insight's 30+ feedback ids, repeated in every variant, makes the API's compiled grammar too large.
const evidenceIdSchema = z.string().regex(/^R-\d{3,}$/, "ID de retour attendu : R-042");

/** Evidence outside the insight; [] when every id belongs to it. */
export function evidenceIssues(label: string, ids: readonly string[], allowed: readonly string[]) {
  const outside = ids.filter((id) => !allowed.includes(id));
  return outside.length ? [`${label} : preuves hors de l'insight (${outside.join(", ")})`] : [];
}

export function draftItemSchema() {
  const evidence = z
    .array(evidenceIdSchema)
    .min(1)
    .max(MAX_EVIDENCE)
    .describe("ID de retours (R-xxx) de l'insight qui motivent l'élément");
  const dependsOn = z
    .array(z.number().int().min(1))
    .max(4)
    .describe("Positions (1, 2…) des éléments de cette liste dont celui-ci dépend ; [] sinon");
  const criteria = z.array(scenarioSchema).min(MIN_SCENARIOS).max(MAX_SCENARIOS);
  return z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("story"),
      title: text(120),
      value: text(300).describe(
        "La valeur pour l'utilisateur, sans « Afin de » ni ponctuation finale (ajoutés à l'affichage)",
      ),
      persona: text(120).describe("Un rôle de personas.md, sans « en tant que »"),
      want: text(300).describe(
        "Une capacité, pas une solution technique, sans « je veux » ni ponctuation finale",
      ),
      business_rules: lines(2, 6),
      acceptance_criteria: criteria,
      success_kpi: text(300),
      evidence,
      depends_on: dependsOn,
    }),
    z.object({
      kind: z.literal("bug"),
      title: text(120),
      expected_behavior: text(400),
      actual_behavior: text(400),
      repro_steps: lines(2, 8),
      severity: z.enum(SEVERITIES),
      acceptance_criteria: criteria,
      evidence,
      depends_on: dependsOn,
    }),
    z.object({
      kind: z.literal("tache"),
      title: text(120),
      objective: text(400),
      definition_of_done: lines(1, 6),
      risks: lines(1, 4),
      evidence,
      depends_on: dependsOn,
    }),
  ]);
}

export type DraftItem = z.infer<ReturnType<typeof draftItemSchema>>;
export type DraftKind = DraftItem["kind"];

function draftObjectSchema(ctx: DraftContext) {
  return z.object({
    format: z.enum(BACKLOG_FORMATS),
    deviation_reason: z
      .string()
      .describe("Si le format diffère de celui proposé par le code, pourquoi ; sinon chaîne vide"),
    epic: z
      .object({
        title: text(140),
        goal: text(400),
        okr_refs: z.array(oneOf(ctx.okrIds, "OKR")).min(1).max(3),
        kpi: text(300),
      })
      .nullable(),
    items: z.array(draftItemSchema()).max(MAX_ITEMS),
    discoverability: z
      .object({
        action: text(400).describe("Article d'aide, info-bulle, amélioration d'onboarding…"),
        rationale: text(400),
        evidence: z.array(evidenceIdSchema).min(1).max(MAX_EVIDENCE),
      })
      .nullable(),
  });
}

export type Draft = z.infer<ReturnType<typeof draftObjectSchema>>;

/** The output asked of the model: the checks of checkDraft run inside, so a retry sees them. */
export function draftSchema(ctx: DraftContext) {
  return draftObjectSchema(ctx).superRefine((draft, check) => {
    for (const message of checkDraft(draft, ctx)) check.addIssue({ code: "custom", message });
  });
}

/** Scenario rules of a story or a bug (SPEC §9.4); [] when they hold. */
export function checkScenarios(label: string, scenarios: readonly Scenario[]): string[] {
  const issues: string[] = [];
  if (scenarios.length < MIN_SCENARIOS || scenarios.length > MAX_SCENARIOS) {
    issues.push(`${label} : ${MIN_SCENARIOS} à ${MAX_SCENARIOS} scénarios Gherkin attendus`);
  }
  if (!scenarios.some((s) => s.edge_case)) {
    issues.push(`${label} : au moins un scénario de cas limite ou d'erreur (edge_case: true)`);
  }
  for (const s of scenarios) {
    const keywords = new Set(s.steps.map((step) => step.keyword));
    if (!keywords.has("Étant donné") || !keywords.has("Quand") || !keywords.has("Alors")) {
      issues.push(`${label}, scénario « ${s.name} » : Étant donné, Quand et Alors attendus`);
    }
  }
  return issues;
}

/** The rules of SPEC §9 that a schema cannot express; [] when the draft holds. */
export function checkDraft(draft: Draft, ctx: DraftContext): string[] {
  const issues: string[] = [];
  const { items } = draft;
  const kinds = items.map((i) => i.kind);
  const count = (kind: DraftKind) => kinds.filter((k) => k === kind).length;

  if (draft.format !== ctx.proposed && !draft.deviation_reason.trim()) {
    issues.push(
      `Le code propose « ${ctx.proposed} » : justifie l'écart dans deviation_reason ou suis la proposition`,
    );
  }
  if (draft.format === "decouvrabilite") {
    if (items.length > 0 || draft.epic) {
      issues.push("Découvrabilité : rien dans le backlog (ni epic ni élément)");
    }
    if (!draft.discoverability) issues.push("Découvrabilité : action proposée attendue");
    else
      issues.push(
        ...evidenceIssues("Découvrabilité", draft.discoverability.evidence, ctx.evidenceIds),
      );
    return issues;
  }
  if (draft.discoverability) issues.push("discoverability seulement pour le format decouvrabilite");
  if (items.length === 0) issues.push("Au moins un élément attendu");

  if (draft.epic) {
    if (ctx.keptEpicId) {
      issues.push(`L'epic ${ctx.keptEpicId} est conservée : ne crée pas de nouvelle epic`);
    } else if (items.length + ctx.keptItems < 2) {
      issues.push("Une epic n'existe que si elle regroupe plusieurs éléments");
    }
  }
  switch (draft.format) {
    case "bugs":
      if (draft.epic) issues.push("Des bugs ne vont pas dans une epic");
      if (count("bug") === 0) issues.push("Format bugs : au moins un élément de type bug");
      break;
    case "story":
      if (draft.epic) issues.push("Une story seule ne reçoit pas d'epic");
      if (items.length !== 1 || kinds[0] !== "story") {
        issues.push("Format story : exactement une story");
      }
      break;
    case "tache":
      if (count("tache") === 0) issues.push("Format tache : au moins une tâche technique");
      break;
    case "epic_stories":
      if (!draft.epic && !ctx.keptEpicId) issues.push("Format epic_stories : epic attendue");
      if (ctx.keptItems === 0 && (count("story") < 3 || count("story") > 6)) {
        issues.push("Format epic_stories : 3 à 6 stories découpées verticalement");
      }
      break;
  }

  items.forEach((item, index) => {
    const label = `Élément ${index + 1} (${item.kind})`;
    if (item.kind !== "tache") issues.push(...checkScenarios(label, item.acceptance_criteria));
    issues.push(...evidenceIssues(label, item.evidence, ctx.evidenceIds));
    if (new Set(item.evidence).size !== item.evidence.length) {
      issues.push(`${label} : une preuve citée une seule fois`);
    }
    for (const d of item.depends_on) {
      if (d === index + 1 || d > items.length) {
        issues.push(
          `${label} : dépendance ${d} invalide (positions 1 à ${items.length}, pas lui-même)`,
        );
      }
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Story sentence: the template's words are added at display time
// ---------------------------------------------------------------------------

const LEADS = {
  value: /^\s*afin\s+(?:de|d['’])\s*/i,
  persona: /^\s*en\s+tant\s+qu(?:e|['’])\s*/i,
  want: /^\s*je\s+veux\s*/i,
} as const;

/**
 * One part of « Afin de…, en tant que…, je veux… » without the template's words nor a final
 * punctuation (the model sometimes writes them: « Afin de Afin de …,, »).
 */
export function storyPart(part: keyof typeof LEADS, text: string | null): string {
  return (text ?? "")
    .replace(LEADS[part], "")
    .replace(/[\s.,;:]+$/u, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Bugs: accounts touched, computed in code (skill backlog-format)
// ---------------------------------------------------------------------------

export type AffectedAccounts = { ids: string[]; enterprise: number };

/**
 * Accounts touched by a bug: the customers of the insight's feedbacks whose items are bugs (all of
 * its feedbacks when none is). Prospects included: they hit the bug too.
 */
export function affectedAccounts(
  items: readonly { type: string; feedback_id: string }[],
  feedbacks: readonly { id: string; customer_id: string | null }[],
  customers: readonly { id: string; plan: string }[],
): AffectedAccounts {
  const bugFeedbacks = new Set(items.filter((i) => i.type === "bug").map((i) => i.feedback_id));
  const pool = bugFeedbacks.size > 0 ? bugFeedbacks : new Set(items.map((i) => i.feedback_id));
  const ids = [
    ...new Set(feedbacks.filter((f) => pool.has(f.id) && f.customer_id).map((f) => f.customer_id!)),
  ].sort();
  const plans = new Map(customers.map((c) => [c.id, c.plan]));
  return { ids, enterprise: ids.filter((id) => plans.get(id) === "enterprise").length };
}

// ---------------------------------------------------------------------------
// Definition of Ready, checked in code on the stored item
// ---------------------------------------------------------------------------

export type DorChecklist = {
  valeur_ou_objectif: boolean;
  criteres_testables: boolean;
  estimation_justifiee: boolean;
  preuves: boolean;
  dependances_listees: boolean;
};

export function dorChecklist(item: {
  kind: DraftKind;
  value?: string | null;
  objective?: string | null;
  expected_behavior?: string | null;
  acceptance_criteria?: readonly Scenario[] | null;
  definition_of_done?: readonly string[] | null;
  /** Points with their justification (components, analogues). */
  estimated: boolean;
  evidence: readonly string[];
}): DorChecklist {
  const purpose =
    item.kind === "story"
      ? item.value
      : item.kind === "bug"
        ? item.expected_behavior
        : item.objective;
  const testable =
    item.kind === "tache"
      ? (item.definition_of_done?.length ?? 0) > 0
      : checkScenarios("", item.acceptance_criteria ?? []).length === 0;
  return {
    valeur_ou_objectif: Boolean(purpose?.trim()),
    criteres_testables: testable,
    estimation_justifiee: item.estimated,
    preuves: item.evidence.length > 0,
    // Listed or « aucune »: the field always exists once drafted.
    dependances_listees: true,
  };
}

// ---------------------------------------------------------------------------
// Gherkin as text (edition of a draft)
// ---------------------------------------------------------------------------

const EDGE_MARK = "(cas limite)";

/** « Scénario (cas limite) : … » then one indented step per line. */
export function formatGherkin(scenarios: readonly Scenario[]): string {
  return scenarios
    .map((s) =>
      [
        `Scénario${s.edge_case ? ` ${EDGE_MARK}` : ""} : ${s.name}`,
        ...s.steps.map((step) => `  ${step.keyword} ${step.text}`),
      ].join("\n"),
    )
    .join("\n");
}

const KEYWORD_PATTERN = new RegExp(`^(${GHERKIN_KEYWORDS.join("|")})(?:\\s+(.*))?$`, "u");

/** Inverse of formatGherkin; a line it cannot read is an error, never silently dropped. */
export function parseGherkin(
  source: string,
): { ok: true; scenarios: Scenario[] } | { ok: false; error: string } {
  const scenarios: Scenario[] = [];
  const rows = source.split("\n").map((l) => l.trim());
  for (const [index, line] of rows.entries()) {
    if (!line) continue;
    const header = /^Scénario\s*(\(cas limite\))?\s*:\s*(.+)$/i.exec(line);
    if (header) {
      scenarios.push({ name: header[2].trim(), edge_case: Boolean(header[1]), steps: [] });
      continue;
    }
    const step = KEYWORD_PATTERN.exec(line);
    if (!step || !step[2]?.trim()) {
      return {
        ok: false,
        error: `Ligne ${index + 1} illisible : « ${line} » (Scénario, Étant donné, Quand, Alors, Et, Mais)`,
      };
    }
    const current = scenarios.at(-1);
    if (!current) return { ok: false, error: "Le texte doit commencer par « Scénario : … »" };
    current.steps.push({ keyword: step[1] as GherkinKeyword, text: step[2].trim() });
  }
  return { ok: true, scenarios };
}
