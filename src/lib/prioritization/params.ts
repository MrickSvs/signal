// URL of the Priorisation screen: ?reach=comptes|mrr (the toggle is a view, SPEC §8.1) and
// ?insight=I-07 to bring a row into view (link from an insight's page or the digest).
import type { ReachMode } from "@/lib/scoring/reach";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parsePrioritizationParams(
  params: SearchParams,
  defaultMode: ReachMode,
): { mode: ReachMode; focus: string | null } {
  const reach = first(params.reach);
  const insight = first(params.insight);
  return {
    mode: reach === "mrr" || reach === "comptes" ? reach : defaultMode,
    focus: insight && /^I-\d+$/.test(insight) ? insight : null,
  };
}
