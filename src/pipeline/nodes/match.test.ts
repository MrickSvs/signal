import { describe, expect, it } from "vitest";
import type { Vector } from "@/lib/clustering/agglomerative";
import {
  applyMerges,
  jaccard,
  matchClusters,
  resolveMergeTarget,
  type CurrentCluster,
  type PlannedInsight,
  type PreviousInsight,
} from "./match";

// Topics are directions in 3D; items of a topic are slightly perturbed copies of it.
const TOPICS: Record<string, Vector> = { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] };
const items = (topic: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${topic}${from + i}`);
const vectors = new Map<string, Vector>();
for (const topic of Object.keys(TOPICS)) {
  for (const id of items(topic, 1, 30)) {
    const n = Number(id.slice(1));
    vectors.set(
      id,
      TOPICS[topic].map((x, d) => x + 0.01 * ((n * (d + 1)) % 5)),
    );
  }
}
const options = { jaccard: 0.5, centroidSimilarity: 0.9, vectors };

const prev = (
  p: Partial<PreviousInsight> & Pick<PreviousInsight, "id" | "itemIds">,
): PreviousInsight => ({
  status: "actif",
  mergedInto: null,
  titleLocked: false,
  ...p,
});
const cluster = (...ids: string[][]): CurrentCluster => ({ itemIds: ids.flat() });
const byKey = (result: { insights: PlannedInsight[] }) =>
  Object.fromEntries(result.insights.map((i) => [i.key, i]));

describe("jaccard and resolveMergeTarget", () => {
  it("computes the Jaccard index", () => {
    expect(jaccard(new Set(["1", "2"]), new Set(["2", "3"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("follows merge chains to a live insight, and stops on cycles", () => {
    const byId = new Map([
      ["I-01", { status: "fusionne" as const, mergedInto: "I-02" }],
      ["I-02", { status: "fusionne" as const, mergedInto: "I-03" }],
      ["I-03", { status: "actif" as const, mergedInto: null }],
      ["I-04", { status: "fusionne" as const, mergedInto: "I-05" }],
      ["I-05", { status: "fusionne" as const, mergedInto: "I-04" }],
      ["I-06", { status: "fusionne" as const, mergedInto: "I-07" }],
      ["I-07", { status: "archive" as const, mergedInto: null }],
    ]);
    expect(resolveMergeTarget("I-01", byId)).toBe("I-03");
    expect(resolveMergeTarget("I-04", byId)).toBeNull();
    expect(resolveMergeTarget("I-06", byId)).toBeNull();
  });
});

describe("matchClusters", () => {
  it("first run: every cluster is a new insight « propose », numbered by size (CL-51)", () => {
    const result = matchClusters(
      [],
      [cluster(items("a", 1, 6)), cluster(items("b", 1, 3))],
      options,
    );
    expect(
      result.insights.map((i) => [i.key, i.status, i.isNew, i.needsLabel, i.itemIds.length]),
    ).toEqual([
      ["N1", "propose", true, true, 6],
      ["N2", "propose", true, true, 3],
    ]);
    expect(result.events).toEqual([]);
  });

  it("same data twice: same ids, statuses kept, nothing to relabel (CL-14)", () => {
    const previous = [
      prev({ id: "I-01", itemIds: items("a", 1, 6), titleLocked: true }),
      prev({ id: "I-02", itemIds: items("b", 1, 3), status: "propose" }),
    ];
    const result = matchClusters(
      previous,
      [cluster(items("a", 1, 6)), cluster(items("b", 1, 3))],
      options,
    );
    expect(result.insights.map((i) => [i.key, i.status, i.titleLocked, i.needsLabel])).toEqual([
      ["I-01", "actif", true, false],
      ["I-02", "propose", false, false],
    ]);
    expect(result.matchedBy).toEqual({ "I-01": "jaccard", "I-02": "jaccard" });
    expect(result.events).toEqual([]);
  });

  it("new feedbacks: a grown cluster keeps its id through the centroids, and is relabelled", () => {
    // 4 known items in a cluster of 10: Jaccard 0.4 < 0.5, but the centroids are very close.
    const result = matchClusters(
      [prev({ id: "I-01", itemIds: items("a", 1, 4) })],
      [cluster(items("a", 1, 10))],
      options,
    );
    expect(result.matchedBy).toEqual({ "I-01": "centroide" });
    expect(byKey(result)["I-01"]).toMatchObject({ status: "actif", needsLabel: true });
    expect(result.insights).toHaveLength(1);
  });

  it("never matches a different topic through the centroids", () => {
    const result = matchClusters(
      [prev({ id: "I-01", itemIds: items("a", 1, 4) })],
      [cluster(items("b", 1, 4))],
      options,
    );
    expect(byKey(result)).toMatchObject({
      N1: { isNew: true, status: "propose" },
      "I-01": { status: "archive", itemIds: [] },
    });
    expect(result.events).toEqual([{ kind: "dissous", id: "I-01" }]);
  });

  it("fusion: two insights in one cluster → the closest keeps its id, the other is merged (CL-15)", () => {
    const result = matchClusters(
      [
        prev({ id: "I-01", itemIds: items("a", 1, 6) }),
        prev({ id: "I-02", itemIds: items("a", 7, 10) }),
      ],
      [cluster(items("a", 1, 10))],
      options,
    );
    expect(byKey(result)["I-01"]).toMatchObject({
      status: "actif",
      itemIds: items("a", 1, 10).sort(),
    });
    expect(byKey(result)["I-02"]).toMatchObject({
      status: "fusionne",
      mergedInto: "I-01",
      itemIds: items("a", 7, 10).sort(),
    });
    expect(result.events).toEqual([{ kind: "fusion", from: "I-02", into: "I-01" }]);
  });

  it("scission: the biggest part keeps the id, the rest becomes a new insight (CL-15)", () => {
    const result = matchClusters(
      [prev({ id: "I-01", itemIds: items("a", 1, 10) })],
      [cluster(items("a", 1, 6)), cluster(items("a", 7, 10))],
      options,
    );
    expect(byKey(result)["I-01"]).toMatchObject({
      itemIds: items("a", 1, 6).sort(),
      needsLabel: true,
    });
    expect(byKey(result).N1).toMatchObject({
      isNew: true,
      status: "propose",
      itemIds: items("a", 7, 10).sort(),
    });
    expect(result.events).toEqual([{ kind: "scission", from: "I-01", into: "N1" }]);
  });

  it("a split in equal parts still gives the id to one part only, deterministically", () => {
    const run = () =>
      matchClusters(
        [prev({ id: "I-01", itemIds: items("a", 1, 10) })],
        [cluster(items("a", 1, 5)), cluster(items("a", 6, 10))],
        options,
      );
    const first = run();
    expect(first.insights.filter((i) => i.key === "I-01")).toHaveLength(1);
    expect(run()).toEqual(first);
  });

  it("a rejected insight that re-forms stays rejected, without relabelling (CL-53)", () => {
    const result = matchClusters(
      [prev({ id: "I-03", itemIds: items("c", 1, 5), status: "rejete" })],
      [cluster(items("c", 1, 6))],
      options,
    );
    expect(byKey(result)["I-03"]).toMatchObject({ status: "rejete", needsLabel: false });
    expect(result.insights).toHaveLength(1);
  });

  it("a rejected insight that dissolves keeps its items, so it is still rejected when they re-form", () => {
    const first = matchClusters(
      [prev({ id: "I-03", itemIds: items("c", 1, 5), status: "rejete" })],
      [],
      options,
    );
    expect(byKey(first)["I-03"]).toMatchObject({ status: "rejete", itemIds: items("c", 1, 5) });
    const second = matchClusters(
      [prev({ id: "I-03", itemIds: items("c", 1, 5), status: "rejete" })],
      [cluster(items("c", 1, 5))],
      options,
    );
    expect(second.insights.map((i) => [i.key, i.status])).toEqual([["I-03", "rejete"]]);
  });

  it("an existing insight takes the new cluster that holds most of its items", () => {
    // 3 known items lost in 13 others: neither Jaccard nor centroids (mixed topics) match.
    const result = matchClusters(
      [prev({ id: "I-01", itemIds: items("a", 1, 3) })],
      [cluster(items("a", 1, 3), items("b", 1, 7), items("c", 1, 6))],
      options,
    );
    expect(result.matchedBy).toEqual({ "I-01": "majorite" });
    expect(result.insights.map((i) => [i.key, i.isNew, i.needsLabel])).toEqual([
      ["I-01", false, true],
    ]);
  });

  it("replays a merge when the merged insight re-forms: no new id, nothing to relabel", () => {
    // Run 1: the consolidation pass merged N2 (b) into N1 (a), written as I-01 and I-02.
    const previous = [
      prev({
        id: "I-01",
        itemIds: [...items("a", 1, 3), ...items("b", 1, 6)].sort(),
        status: "propose",
      }),
      prev({ id: "I-02", itemIds: items("b", 1, 6), status: "fusionne", mergedInto: "I-01" }),
    ];
    // Run 2: clustering separates them again — and b is the bigger part.
    const result = matchClusters(
      previous,
      [cluster(items("b", 1, 6)), cluster(items("a", 1, 3))],
      options,
    );
    expect(byKey(result)["I-01"]).toMatchObject({
      status: "propose",
      itemIds: previous[0].itemIds,
      needsLabel: false,
    });
    expect(byKey(result)["I-02"]).toMatchObject({ status: "fusionne", mergedInto: "I-01" });
    expect(result.insights.some((i) => i.isNew)).toBe(false);
    expect(result.events).toEqual([{ kind: "fusion_rejouee", from: "I-02", into: "I-01" }]);
  });

  it("a merged insight whose target is gone re-forms as « propose »", () => {
    const result = matchClusters(
      [
        prev({ id: "I-01", itemIds: items("a", 1, 5), status: "archive" }),
        prev({ id: "I-02", itemIds: items("b", 1, 5), status: "fusionne", mergedInto: "I-01" }),
      ],
      [cluster(items("b", 1, 5))],
      options,
    );
    expect(byKey(result)["I-02"]).toMatchObject({
      status: "propose",
      mergedInto: null,
      needsLabel: true,
    });
    expect(result.events).toEqual([{ kind: "reforme", id: "I-02" }]);
  });

  it("ignores archived insights", () => {
    const result = matchClusters(
      [prev({ id: "I-01", itemIds: items("a", 1, 5), status: "archive" })],
      [cluster(items("a", 1, 5))],
      options,
    );
    expect(result.insights.map((i) => i.key)).toEqual(["N1"]);
  });
});

describe("applyMerges (consolidation pass)", () => {
  const planned = (
    p: Partial<PlannedInsight> & Pick<PlannedInsight, "key" | "itemIds">,
  ): PlannedInsight => ({
    isNew: p.key.startsWith("N"),
    status: p.key.startsWith("N") ? "propose" : "actif",
    mergedInto: null,
    titleLocked: false,
    previousItemIds: p.key.startsWith("N") ? null : p.itemIds,
    needsLabel: p.key.startsWith("N"),
    ...p,
  });

  it("merges a new insight into an existing one, which keeps its id and is relabelled", () => {
    const insights = [
      planned({ key: "I-01", itemIds: ["a1"] }),
      planned({ key: "N1", itemIds: ["a2", "a3"] }),
    ];
    expect(applyMerges(insights, [{ a: "N1", b: "I-01", reason: "même problème" }])).toEqual([
      { from: "N1", into: "I-01", reason: "même problème" },
    ]);
    expect(insights[0]).toMatchObject({ itemIds: ["a1", "a2", "a3"], needsLabel: true });
    expect(insights[1]).toMatchObject({
      status: "fusionne",
      mergedInto: "I-01",
      needsLabel: false,
    });
  });

  it("between two new insights, the bigger survives (then the lower key)", () => {
    const insights = [
      planned({ key: "N1", itemIds: ["a1"] }),
      planned({ key: "N2", itemIds: ["a2", "a3"] }),
    ];
    applyMerges(insights, [{ a: "N1", b: "N2", reason: "x" }]);
    expect(insights[0]).toMatchObject({ status: "fusionne", mergedInto: "N2" });
    const tie = [planned({ key: "N2", itemIds: ["a1"] }), planned({ key: "N10", itemIds: ["a2"] })];
    applyMerges(tie, [{ a: "N10", b: "N2", reason: "x" }]);
    expect(tie[1]).toMatchObject({ status: "fusionne", mergedInto: "N2" });
  });

  it("never merges two existing insights, a rejected one, itself or an unknown key", () => {
    const insights = [
      planned({ key: "I-01", itemIds: ["a1"] }),
      planned({ key: "I-02", itemIds: ["a2"] }),
      planned({ key: "I-03", itemIds: ["a3"], status: "rejete" }),
      planned({ key: "N1", itemIds: ["a4"] }),
    ];
    const applied = applyMerges(insights, [
      { a: "I-01", b: "I-02", reason: "x" },
      { a: "N1", b: "I-03", reason: "x" },
      { a: "N1", b: "N1", reason: "x" },
      { a: "N1", b: "I-99", reason: "x" },
    ]);
    expect(applied).toEqual([]);
    expect(insights.every((i) => i.status !== "fusionne")).toBe(true);
  });

  it("follows chains: N2 → N1 then N1 → I-01 puts everything in I-01", () => {
    const insights = [
      planned({ key: "I-01", itemIds: ["a1", "a2", "a3"] }),
      planned({ key: "N1", itemIds: ["a4", "a5"] }),
      planned({ key: "N2", itemIds: ["a6"] }),
    ];
    applyMerges(insights, [
      { a: "N2", b: "N1", reason: "x" },
      { a: "N1", b: "I-01", reason: "x" },
      { a: "N2", b: "I-01", reason: "déjà fait" },
    ]);
    expect(insights[0].itemIds).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(insights[1]).toMatchObject({ status: "fusionne", mergedInto: "I-01" });
    expect(insights[2]).toMatchObject({ status: "fusionne", mergedInto: "I-01" });
  });
});
