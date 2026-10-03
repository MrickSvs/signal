import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // pnpm test:coverage — SPEC §8: the scoring code is covered at 100 %.
    coverage: {
      provider: "v8",
      include: ["src/lib/scoring/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
