// Choice of the backlog format from the facts of an insight (SPEC §9, skill backlog-format). Pure:
// the code proposes, the model may deviate with a reason, and the deviation stays visible.

export const BACKLOG_FORMATS = [
  "decouvrabilite",
  "bugs",
  "tache",
  "epic_stories",
  "story",
] as const;
export type BacklogFormat = (typeof BACKLOG_FORMATS)[number];

export const FORMAT_LABELS: Record<BacklogFormat, string> = {
  decouvrabilite: "Action de découvrabilité, rien dans le backlog",
  bugs: "Un ou plusieurs bugs, sans epic",
  tache: "Tâche technique",
  epic_stories: "Epic et 3 à 6 stories",
  story: "Une story seule, sans epic",
};

/** Beyond this many points (top of the insight's range), a functional insight becomes an epic. */
export const EPIC_MIN_POINTS = 8;

export type FormatFacts = {
  origin: "retours" | "manuel";
  title: string;
  problem_statement: string | null;
  /** Types of the insight's items (feedback_items.type). */
  itemTypes: readonly string[];
  /** existing_feature flag of the same items. */
  existingFeature: readonly boolean[];
  /** The insight's points range (cached estimate), null when unknown. */
  range: { min: number; max: number } | null;
};

export type FormatChoice = { format: BacklogFormat; reason: string };

const TECHNICAL =
  /(?<!\p{L})(dette|technique|refacto\p{L}*|migration|infrastructure|prérequis|performance|sécurité|monitoring|mise à jour|montée de version)(?!\p{L})/iu;

/** A manual topic whose wording is technical (debt, prerequisite, infrastructure). */
export function isTechnicalTopic(
  facts: Pick<FormatFacts, "origin" | "title" | "problem_statement">,
) {
  return (
    facts.origin === "manuel" && TECHNICAL.test(`${facts.title} ${facts.problem_statement ?? ""}`)
  );
}

const share = (count: number, total: number) => (total === 0 ? 0 : count / total);
const pct = (ratio: number) => `${Math.round(ratio * 100)} %`;

/**
 * The order matters (skill backlog-format): existing feature, then bugs, then technical, then size.
 * « Majoritairement » means strictly more than half of the items.
 */
export function chooseFormat(facts: FormatFacts): FormatChoice {
  const total = facts.itemTypes.length;
  const existing = share(
    facts.existingFeature.filter(Boolean).length,
    facts.existingFeature.length,
  );
  if (existing > 0.5) {
    return {
      format: "decouvrabilite",
      reason: `${pct(existing)} des items décrivent une fonctionnalité qui existe déjà.`,
    };
  }
  const bugs = share(facts.itemTypes.filter((t) => t === "bug").length, total);
  if (bugs > 0.5) {
    return { format: "bugs", reason: `${pct(bugs)} des items sont des bugs.` };
  }
  if (isTechnicalTopic(facts)) {
    return { format: "tache", reason: "Sujet manuel de nature technique." };
  }
  if (facts.range && facts.range.max > EPIC_MIN_POINTS) {
    return {
      format: "epic_stories",
      reason: `Besoin fonctionnel, fourchette ${facts.range.min} à ${facts.range.max} points (au-delà de ${EPIC_MIN_POINTS}).`,
    };
  }
  return {
    format: "story",
    reason: facts.range
      ? `Besoin fonctionnel, fourchette ${facts.range.min} à ${facts.range.max} points (${EPIC_MIN_POINTS} ou moins).`
      : "Besoin fonctionnel sans estimation : une story seule par défaut.",
  };
}
