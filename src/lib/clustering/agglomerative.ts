// Agglomerative clustering (SPEC §6.1, node `cluster`): average linkage on cosine distance.
// Pure and deterministic: same vectors and parameters → same clusters, whatever the run.

export type Vector = readonly number[];

export function dot(a: Vector, b: Vector): number {
  if (a.length !== b.length)
    throw new Error(`Vecteurs de dimensions différentes (${a.length}, ${b.length})`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function norm(v: Vector): number {
  return Math.sqrt(dot(v, v));
}

/** Cosine similarity in [-1, 1]; 0 when a vector is null. */
export function cosineSimilarity(a: Vector, b: Vector): number {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

/** Cosine distance in [0, 2]. */
export function cosineDistance(a: Vector, b: Vector): number {
  return 1 - cosineSimilarity(a, b);
}

/** Mean of the unit vectors, normalized: the direction a cluster points to. */
export function centroid(vectors: readonly Vector[]): number[] {
  if (vectors.length === 0) throw new Error("centroid : aucun vecteur");
  const sum = new Array<number>(vectors[0].length).fill(0);
  for (const v of vectors) {
    const n = norm(v) || 1;
    for (let i = 0; i < v.length; i++) sum[i] += v[i] / n;
  }
  const n = norm(sum) || 1;
  return sum.map((x) => x / n);
}

export type ClusteringOptions = {
  /** Two groups merge while their average cosine distance is at most this value. */
  distanceThreshold: number;
  /** Groups smaller than this are returned as `unclustered`. */
  minClusterSize: number;
};

export type ClusteringResult = {
  /** Indices into the input, sorted; clusters sorted by size desc, then smallest index. */
  clusters: number[][];
  /** Indices left alone or in groups below the minimum size, sorted. */
  unclustered: number[];
};

/**
 * Average-linkage agglomerative clustering (Lance-Williams update), O(n³) — fine for a few
 * hundred items. At each step the closest pair of groups merges (ties: smallest indices first),
 * until the closest pair is farther than the threshold.
 */
export function agglomerativeCluster(
  vectors: readonly Vector[],
  options: ClusteringOptions,
): ClusteringResult {
  const n = vectors.length;
  const members: (number[] | null)[] = vectors.map((_, i) => [i]);
  const distance: number[][] = vectors.map((a, i) =>
    vectors.map((b, j) => (i === j ? 0 : cosineDistance(a, b))),
  );

  for (;;) {
    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!members[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!members[j]) continue;
        if (distance[i][j] < best) {
          best = distance[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi === -1 || best > options.distanceThreshold) break;

    const a = members[bi]!;
    const b = members[bj]!;
    for (let k = 0; k < n; k++) {
      if (!members[k] || k === bi || k === bj) continue;
      const merged =
        (a.length * distance[bi][k] + b.length * distance[bj][k]) / (a.length + b.length);
      distance[bi][k] = merged;
      distance[k][bi] = merged;
    }
    members[bi] = [...a, ...b].sort((x, y) => x - y);
    members[bj] = null;
  }

  const groups = members.filter((m): m is number[] => m !== null);
  const clusters = groups
    .filter((g) => g.length >= options.minClusterSize)
    .sort((x, y) => y.length - x.length || x[0] - y[0]);
  const unclustered = groups
    .filter((g) => g.length < options.minClusterSize)
    .flat()
    .sort((x, y) => x - y);
  return { clusters, unclustered };
}
