// Production metric (SPEC §14.4), computed from the decision journal: how much of what Signal
// proposes the PO keeps as is. Pure: the decisions are read by src/server/queries/evals.ts.

export type DecisionRow = {
  id: string;
  actor: "po" | "signal";
  entity_type: string;
  entity_id: string;
  action: string;
  field: string | null;
  after: unknown;
  created_at: string;
};

export type ProductionMetric = {
  backlog: {
    /** Backlog items the PO validated. */
    validated: string[];
    /** Among them, those the PO never modified. */
    unmodified: string[];
  };
  moscow: {
    /** Insights whose MoSCoW recommendation the PO reviewed (validated the insight or overrode it). */
    reviewed: string[];
    /** Among them, those whose recommendation stands (no override, or the override was cancelled). */
    kept: string[];
  };
  /** Times Signal disagreed with a PO decision (decision ids). */
  disagreements: string[];
};

const byId = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true });

export function productionMetric(decisions: readonly DecisionRow[]): ProductionMetric {
  const validated = new Set<string>();
  const modified = new Set<string>();
  const reviewed = new Set<string>();
  /** Latest MoSCoW override per insight: `after` null means it was cancelled. */
  const lastMoscow = new Map<string, DecisionRow>();
  const disagreements: string[] = [];

  for (const d of decisions.toSorted((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (d.action === "desaccord") disagreements.push(d.id);
    if (d.actor !== "po") continue;
    if (d.entity_type === "backlog_item") {
      if (d.action === "validation" && d.field === "status") validated.add(d.entity_id);
      if (d.action === "modification") modified.add(d.entity_id);
    }
    if (d.entity_type === "insight") {
      if (d.action === "validation" && d.field === "status") reviewed.add(d.entity_id);
      if (d.action === "override" && d.field === "moscow") {
        reviewed.add(d.entity_id);
        lastMoscow.set(d.entity_id, d);
      }
    }
  }

  const overridden = (id: string) => {
    const last = lastMoscow.get(id);
    return last !== undefined && last.after !== null;
  };
  const validatedIds = [...validated].toSorted(byId);
  const reviewedIds = [...reviewed].toSorted(byId);
  return {
    backlog: {
      validated: validatedIds,
      unmodified: validatedIds.filter((id) => !modified.has(id)),
    },
    moscow: { reviewed: reviewedIds, kept: reviewedIds.filter((id) => !overridden(id)) },
    disagreements: disagreements.toSorted(byId),
  };
}
