// Recommendations Léa marked « fait » or « écartée » on the Digest screen (ADR-036). Each answer is
// a decision (entity_type « recommandation »); the next digests read them so that Signal does not
// propose again what she already settled, unless a new fact comes in. Pure functions.

export const RECOMMENDATION_ENTITY = "recommandation";
/** How long an answered recommendation keeps Signal from proposing it again without a new fact. */
export const HANDLED_WINDOW_DAYS = 30;

export type RecommendationOutcome = "fait" | "ecartee";

export type HandledRecommendation = {
  titre: string;
  preuves: string[];
  outcome: RecommendationOutcome;
  reason: string | null;
  at: string;
  decision_id: string;
};

/** Stable id of the n-th recommendation (0-based) of a digest: the decision's entity_id. */
export function recommendationKey(digestId: string, index: number): string {
  return `${digestId}#${index + 1}`;
}

/** The index (0-based) a key points to within its digest, null for another digest or a bad key. */
export function recommendationIndex(key: string, digestId: string): number | null {
  const prefix = `${digestId}#`;
  if (!key.startsWith(prefix)) return null;
  const n = Number(key.slice(prefix.length));
  return Number.isInteger(n) && n >= 1 ? n - 1 : null;
}

type DecisionRow = {
  id: string;
  entity_id: string;
  action: string;
  after: unknown;
  reason: string | null;
  created_at: string;
};

/** A decision on a recommendation, read back (null if it is not one). */
export function readHandled(row: DecisionRow): HandledRecommendation | null {
  const after = row.after as { statut?: unknown; titre?: unknown; preuves?: unknown } | null;
  if (!after || (after.statut !== "fait" && after.statut !== "ecartee")) return null;
  return {
    titre: typeof after.titre === "string" ? after.titre : "",
    preuves: Array.isArray(after.preuves)
      ? after.preuves.filter((p): p is string => typeof p === "string")
      : [],
    outcome: after.statut,
    reason: row.reason,
    at: row.created_at,
    decision_id: row.id,
  };
}

/**
 * A new recommendation repeats an answered one when every id it cites was already cited by
 * answered recommendations: nothing new justifies it. One new id (a new feedback, alert or
 * insight) is enough to propose it again.
 */
export function repeatsHandled(
  preuves: readonly string[],
  handled: readonly HandledRecommendation[],
): boolean {
  if (preuves.length === 0 || handled.length === 0) return false;
  const known = new Set(handled.flatMap((h) => h.preuves));
  return preuves.every((id) => known.has(id));
}
