import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // CLAUDE.md rule 1: every LLM call goes through src/lib/llm.
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/llm/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@langchain/anthropic", "@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
              message: "Passe par src/lib/llm (routage, trace Langfuse, coût).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
