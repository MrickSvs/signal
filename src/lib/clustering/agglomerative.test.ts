import { describe, expect, it } from "vitest";
import {
  agglomerativeCluster,
  centroid,
  cosineDistance,
  cosineSimilarity,
  type Vector,
} from "./agglomerative";

/** Unit vector at `degrees` in the plane: cosine distance between two of them = 1 − cos(Δ). */
const at = (degrees: number): Vector => {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

describe("cosine helpers", () => {
  it("computes similarity and distance", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 2])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 0])).toThrow();
  });

  it("centroid is the normalized mean direction, insensitive to vector length", () => {
    const c = centroid([
      [1, 0],
      [0, 10],
    ]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2);
    expect(() => centroid([])).toThrow();
  });

  it("centroid of zero vectors stays the zero vector instead of dividing by zero", () => {
    expect(centroid([[0, 0]])).toEqual([0, 0]);
  });
});

describe("agglomerativeCluster", () => {
  const options = { distanceThreshold: 0.05, minClusterSize: 2 };

  it("keeps close items of different labels apart unless they are much closer", () => {
    // at(0)/at(5): distance ≈ 0.0038; at(0)/at(15): ≈ 0.034.
    const vectors = [at(0), at(5), at(15)];
    const labels = ["performance", "performance", "tableau_kanban"];
    expect(agglomerativeCluster(vectors, options).clusters).toEqual([[0, 1, 2]]);
    expect(
      agglomerativeCluster(vectors, { ...options, labels, crossLabelPenalty: 0.03 }).clusters,
    ).toEqual([[0, 1]]);
    expect(
      agglomerativeCluster(vectors, {
        ...options,
        labels: ["a", "b", "c"],
        crossLabelPenalty: 0.001,
      }).clusters,
    ).toEqual([[0, 1, 2]]);
  });

  it("finds well-separated groups and leaves isolated points out", () => {
    // Three groups around 0°, 90° and 180°, plus a lonely point at 45°.
    const vectors = [at(0), at(90), at(2), at(180), at(45), at(92), at(4), at(178)];
    const { clusters, unclustered } = agglomerativeCluster(vectors, options);
    expect(clusters).toEqual([
      [0, 2, 6],
      [1, 5],
      [3, 7],
    ]);
    expect(unclustered).toEqual([4]);
  });

  it("uses average linkage: a chain does not merge into one cluster", () => {
    // Points every 10°: neighbours are close (1 − cos 10° ≈ 0.015) but the ends are far apart.
    const chain = Array.from({ length: 10 }, (_, i) => at(i * 10));
    const { clusters } = agglomerativeCluster(chain, {
      distanceThreshold: 0.03,
      minClusterSize: 2,
    });
    expect(clusters.length).toBeGreaterThan(1);
    expect(clusters.some((c) => c.includes(0) && c.includes(9))).toBe(false);
  });

  it("applies the minimum cluster size", () => {
    const vectors = [at(0), at(1), at(90), at(91), at(92)];
    expect(agglomerativeCluster(vectors, { distanceThreshold: 0.01, minClusterSize: 3 })).toEqual({
      clusters: [[2, 3, 4]],
      unclustered: [0, 1],
    });
  });

  it("is deterministic, ties included", () => {
    const vectors = [at(0), at(10), at(20), at(0), at(10), at(20)];
    const first = agglomerativeCluster(vectors, { distanceThreshold: 0.02, minClusterSize: 2 });
    const second = agglomerativeCluster(vectors, { distanceThreshold: 0.02, minClusterSize: 2 });
    expect(second).toEqual(first);
  });

  it("handles empty and single inputs", () => {
    expect(agglomerativeCluster([], options)).toEqual({ clusters: [], unclustered: [] });
    expect(agglomerativeCluster([at(0)], options)).toEqual({ clusters: [], unclustered: [0] });
  });
});
