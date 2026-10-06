import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Server-side query modules guard against client bundles; tests run them in plain Node.
      "server-only": path.resolve(import.meta.dirname, "src/lib/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    // pnpm test:coverage — SPEC §14.1: the deterministic core is covered at 100 %.
    coverage: {
      provider: "v8",
      include: [
        "src/lib/scoring/**/*.ts",
        "src/lib/clustering/**/*.ts",
        "src/pipeline/nodes/match.ts",
        "src/services/notion/mappers.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      exclude: ["**/*.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
