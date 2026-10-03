// Match node (SPEC §6.1 « Stabilité entre deux runs », CL-14, CL-15, CL-51, CL-53). Pure code.
// Each new cluster takes the id of an existing insight when their items overlap (Jaccard ≥ 0.5),
// else when their centroids are very close. The id carries the status, the overrides and the
// backlog. A merged insight keeps its items frozen: when they re-form, the merge is replayed, so a
// merge decided once (by the PO or the consolidation pass) is not undone by the next run.
import { centroid, cosineSimilarity, type Vector } from "@/lib/clustering/agglomerative";
import type { Database } from "@/lib/db/types";

export type InsightStatus = Database["public"]["Enums"]["insight_status"];

export type PreviousInsight = {
  id: string;
  status: InsightStatus;
  mergedInto: string | null;
  titleLocked: boolean;
  itemIds: string[];
};

export type CurrentCluster = { itemIds: string[] };

export type MatchOptions = {
  jaccard: number;
  centroidSimilarity: number;
  /** Current vector of every item (clustered or not). */
  vectors: ReadonlyMap<string, Vector>;
};

export type PlannedInsight = {
  /** Existing id, or « N1 », « N2 »… for an insight to create (by decreasing size). */
  key: string;
  isNew: boolean;
  status: InsightStatus;
  /** Key of the insight it is merged into (status « fusionne »). */
  mergedInto: string | null;
  titleLocked: boolean;
  itemIds: string[];
  /** Items before this run (null for a new insight). */
  previousItemIds: string[] | null;
  needsLabel: boolean;
};

export type MatchEvent =
  | { kind: "fusion"; from: string; into: string }
  | { kind: "scission"; from: string; into: string }
  | { kind: "dissous"; id: string }
  | { kind: "fusion_rejouee"; from: string; into: string }
  | { kind: "reforme"; id: string };

export type MatchResult = {
  insights: PlannedInsight[];
  events: MatchEvent[];
  /** How each existing insight was matched (for the CLI and the run stats). */
  matchedBy: Record<string, MatchedBy>;
};

export type MatchedBy = "jaccard" | "centroide" | "majorite";

const LIVE = new Set<InsightStatus>(["propose", "actif", "rejete"]);

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/** Final insight a merged one points to, following chains; null if none is live. */
export function resolveMergeTarget(
  id: string,
  byId: ReadonlyMap<string, Pick<PreviousInsight, "status" | "mergedInto">>,
): string | null {
  const seen = new Set<string>();
  let current = byId.get(id)?.mergedInto ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const insight = byId.get(current);
    if (!insight) return null;
    if (insight.status !== "fusionne") return LIVE.has(insight.status) ? current : null;
    current = insight.mergedInto;
  }
  return null;
}

function centroidOf(
  itemIds: Iterable<string>,
  vectors: ReadonlyMap<string, Vector>,
): number[] | null {
  const vs = [...itemIds].map((id) => vectors.get(id)).filter((v): v is Vector => v !== undefined);
  return vs.length ? centroid(vs) : null;
}

type Candidate = { prev: string; cluster: number; score: number; overlap: number };

/** One-to-one greedy assignment: best score first, then larger overlap, then ids (deterministic). */
function assignGreedy(
  candidates: Candidate[],
  takenPrev: Map<string, number>,
  takenCluster: Map<number, string>,
  order: "score" | "overlap",
): Candidate[] {
  const sorted = candidates.toSorted((a, b) =>
    order === "score"
      ? b.score - a.score ||
        b.overlap - a.overlap ||
        a.prev.localeCompare(b.prev) ||
        a.cluster - b.cluster
      : b.overlap - a.overlap ||
        b.score - a.score ||
        a.prev.localeCompare(b.prev) ||
        a.cluster - b.cluster,
  );
  const assigned: Candidate[] = [];
  for (const c of sorted) {
    if (takenPrev.has(c.prev) || takenCluster.has(c.cluster)) continue;
    takenPrev.set(c.prev, c.cluster);
    takenCluster.set(c.cluster, c.prev);
    assigned.push(c);
  }
  return assigned;
}

/**
 * Maps the clusters of this run onto the existing insights. Clusters are expected sorted by
 * decreasing size (new insights are numbered in that order). Only « retours » insights go here.
 */
export function matchClusters(
  previous: readonly PreviousInsight[],
  clusters: readonly CurrentCluster[],
  options: MatchOptions,
): MatchResult {
  const byId = new Map(previous.map((p) => [p.id, p]));
  const live = previous.filter((p) => LIVE.has(p.status) && p.itemIds.length > 0);
  const merged = previous.filter((p) => p.status === "fusionne" && p.itemIds.length > 0);
  const targetOf = new Map(merged.map((m) => [m.id, resolveMergeTarget(m.id, byId)]));

  // Items a live insight absorbed through a merge: matching uses its own items as well, otherwise
  // a merge would lower its Jaccard with the cluster that is still its own.
  const absorbed = new Map<string, Set<string>>();
  for (const m of merged) {
    const target = targetOf.get(m.id);
    if (!target) continue;
    const set = absorbed.get(target) ?? new Set<string>();
    for (const item of m.itemIds) set.add(item);
    absorbed.set(target, set);
  }

  const sets = new Map([...live, ...merged].map((p) => [p.id, new Set(p.itemIds)] as const));
  const ownSets = new Map(
    live.map((p) => {
      const extra = absorbed.get(p.id);
      return [
        p.id,
        extra ? new Set(p.itemIds.filter((i) => !extra.has(i))) : sets.get(p.id)!,
      ] as const;
    }),
  );
  const clusterSets = clusters.map((c) => new Set(c.itemIds));

  // 1. Jaccard ≥ threshold.
  const takenPrev = new Map<string, number>();
  const takenCluster = new Map<number, string>();
  const matchedBy: Record<string, MatchedBy> = {};
  const jaccardCandidates: Candidate[] = [];
  for (const p of [...live, ...merged]) {
    const all = sets.get(p.id)!;
    const own = ownSets.get(p.id);
    clusterSets.forEach((c, index) => {
      const score = Math.max(jaccard(all, c), own ? jaccard(own, c) : 0);
      if (score >= options.jaccard) {
        jaccardCandidates.push({ prev: p.id, cluster: index, score, overlap: overlap(all, c) });
      }
    });
  }
  for (const c of assignGreedy(jaccardCandidates, takenPrev, takenCluster, "score")) {
    matchedBy[c.prev] = "jaccard";
  }

  // 2. Very close centroids, among what is left. Item overlap first: the biggest part of a split
  // keeps the id.
  const centroidCandidates: Candidate[] = [];
  const clusterCentroids = clusters.map((c) => centroidOf(c.itemIds, options.vectors));
  for (const p of [...live, ...merged]) {
    if (takenPrev.has(p.id)) continue;
    const pc = centroidOf(p.itemIds, options.vectors);
    if (!pc) continue;
    clusterCentroids.forEach((cc, index) => {
      if (!cc || takenCluster.has(index)) return;
      const score = cosineSimilarity(pc, cc);
      if (score >= options.centroidSimilarity) {
        centroidCandidates.push({
          prev: p.id,
          cluster: index,
          score,
          overlap: overlap(sets.get(p.id)!, clusterSets[index]),
        });
      }
    });
  }
  for (const c of assignGreedy(centroidCandidates, takenPrev, takenCluster, "overlap")) {
    matchedBy[c.prev] = "centroide";
  }

  // 3. Build the plan. Clusters matched to a live insight keep it; clusters matched to a merged
  // insight replay the merge if its target is in this run, otherwise the insight re-forms.
  const events: MatchEvent[] = [];
  const keyOfCluster = new Map<number, string>();
  const plan = new Map<string, PlannedInsight>();
  let newCount = 0;

  clusters.forEach((cluster, index) => {
    const prevId = takenCluster.get(index);
    const prev = prevId ? byId.get(prevId)! : null;
    if (prev && LIVE.has(prev.status)) {
      keyOfCluster.set(index, prev.id);
      plan.set(prev.id, {
        key: prev.id,
        isNew: false,
        status: prev.status,
        mergedInto: null,
        titleLocked: prev.titleLocked,
        itemIds: [...cluster.itemIds],
        previousItemIds: prev.itemIds,
        needsLabel: false,
      });
    } else if (!prev) {
      const key = `N${++newCount}`;
      keyOfCluster.set(index, key);
      plan.set(key, {
        key,
        isNew: true,
        status: "propose",
        mergedInto: null,
        titleLocked: false,
        itemIds: [...cluster.itemIds],
        previousItemIds: null,
        needsLabel: true,
      });
    }
  });

  clusters.forEach((cluster, index) => {
    const prevId = takenCluster.get(index);
    const prev = prevId ? byId.get(prevId)! : null;
    if (!prev || prev.status !== "fusionne") return;
    const target = targetOf.get(prev.id);
    const host = target ? plan.get(target) : undefined;
    if (host && !host.isNew) {
      host.itemIds.push(...cluster.itemIds);
      keyOfCluster.set(index, host.key);
      plan.set(prev.id, {
        key: prev.id,
        isNew: false,
        status: "fusionne",
        mergedInto: host.key,
        titleLocked: prev.titleLocked,
        itemIds: [...cluster.itemIds],
        previousItemIds: prev.itemIds,
        needsLabel: false,
      });
      events.push({ kind: "fusion_rejouee", from: prev.id, into: host.key });
    } else {
      keyOfCluster.set(index, prev.id);
      plan.set(prev.id, {
        key: prev.id,
        isNew: false,
        status: "propose",
        mergedInto: null,
        titleLocked: prev.titleLocked,
        itemIds: [...cluster.itemIds],
        previousItemIds: prev.itemIds,
        needsLabel: true,
      });
      events.push({ kind: "reforme", id: prev.id });
    }
  });

  // 4. Live insights left without a cluster. If most of their items sit in a cluster that got no
  // insight, they take it (the topic grew around them); if that cluster already has an insight,
  // they merge into it; otherwise they dissolve. A rejected insight is never merged: it keeps its
  // items as a memory, so it stays rejected if they re-form later (CL-53).
  const unmatched = live
    .filter((p) => !takenPrev.has(p.id))
    .toSorted((a, b) => b.itemIds.length - a.itemIds.length || a.id.localeCompare(b.id));
  for (const p of unmatched) {
    const own = sets.get(p.id)!;
    let best = -1;
    let bestOverlap = 0;
    clusterSets.forEach((c, index) => {
      const n = overlap(own, c);
      if (n > bestOverlap) {
        best = index;
        bestOverlap = n;
      }
    });
    const host = best >= 0 ? plan.get(keyOfCluster.get(best)!) : undefined;
    const majority = bestOverlap * 2 > own.size;
    if (p.status !== "rejete" && host && majority && host.isNew) {
      plan.delete(host.key);
      keyOfCluster.set(best, p.id);
      takenPrev.set(p.id, best);
      matchedBy[p.id] = "majorite";
      plan.set(p.id, {
        ...host,
        key: p.id,
        isNew: false,
        status: p.status,
        titleLocked: p.titleLocked,
        previousItemIds: p.itemIds,
        needsLabel: false,
      });
    } else if (p.status !== "rejete" && host && majority) {
      plan.set(p.id, {
        key: p.id,
        isNew: false,
        status: "fusionne",
        mergedInto: host.key,
        titleLocked: p.titleLocked,
        itemIds: [...p.itemIds],
        previousItemIds: p.itemIds,
        needsLabel: false,
      });
      events.push({ kind: "fusion", from: p.id, into: host.key });
    } else {
      plan.set(p.id, {
        key: p.id,
        isNew: false,
        status: p.status === "rejete" ? "rejete" : "archive",
        mergedInto: null,
        titleLocked: p.titleLocked,
        itemIds: p.status === "rejete" ? [...p.itemIds] : [],
        previousItemIds: p.itemIds,
        needsLabel: false,
      });
      events.push({ kind: "dissous", id: p.id });
    }
  }

  // 5. Relabel what changed; report splits (a new insight made mostly of an existing one's items).
  for (const insight of plan.values()) {
    if (insight.isNew || insight.status === "fusionne" || insight.status === "archive") continue;
    if (insight.status === "rejete") continue; // out of ranking: its wording is not refreshed
    if (insight.previousItemIds && !sameSet(insight.itemIds, insight.previousItemIds)) {
      insight.needsLabel = true;
    }
  }
  for (const insight of plan.values()) {
    if (!insight.isNew) continue;
    const items = new Set(insight.itemIds);
    for (const p of live) {
      if (!takenPrev.has(p.id) || plan.get(p.id)?.status === "fusionne") continue;
      if (overlap(sets.get(p.id)!, items) * 2 >= items.size) {
        events.push({ kind: "scission", from: p.id, into: insight.key });
        break;
      }
    }
  }

  for (const insight of plan.values()) insight.itemIds.sort();
  return { insights: [...plan.values()], events, matchedBy };
}

export type ConsolidationMerge = { a: string; b: string; reason: string };

export type AppliedMerge = { from: string; into: string; reason: string };

/**
 * Applies the merges proposed by the consolidation pass. Only merges involving at least one new
 * insight are kept: two existing insights are merged by the PO, not by a run. The survivor is the
 * existing one, otherwise the bigger one (then the lower key). Rejected insights are left alone.
 */
export function applyMerges(
  insights: PlannedInsight[],
  merges: readonly ConsolidationMerge[],
): AppliedMerge[] {
  const byKey = new Map(insights.map((i) => [i.key, i]));
  /** The insight a key stands for now, following the merges applied so far (N3 → N1 → I-02). */
  const current = (key: string) => {
    let insight = byKey.get(key);
    const seen = new Set<string>();
    while (insight?.status === "fusionne" && insight.mergedInto && !seen.has(insight.key)) {
      seen.add(insight.key);
      insight = byKey.get(insight.mergedInto);
    }
    return insight && (insight.status === "propose" || insight.status === "actif") ? insight : null;
  };
  const applied: AppliedMerge[] = [];
  for (const merge of merges) {
    const a = current(merge.a);
    const b = current(merge.b);
    if (!a || !b || a === b || (!a.isNew && !b.isNew)) continue;

    const [survivor, absorbed] =
      a.isNew !== b.isNew
        ? a.isNew
          ? [b, a]
          : [a, b]
        : a.itemIds.length !== b.itemIds.length
          ? a.itemIds.length > b.itemIds.length
            ? [a, b]
            : [b, a]
          : a.key.localeCompare(b.key, undefined, { numeric: true }) < 0
            ? [a, b]
            : [b, a];

    survivor.itemIds = [...new Set([...survivor.itemIds, ...absorbed.itemIds])].sort();
    survivor.needsLabel = true;
    absorbed.status = "fusionne";
    absorbed.mergedInto = survivor.key;
    absorbed.needsLabel = false;
    for (const other of insights)
      if (other.mergedInto === absorbed.key) other.mergedInto = survivor.key;
    applied.push({ from: absorbed.key, into: survivor.key, reason: merge.reason });
  }
  return applied;
}
