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
  {
    // CLAUDE.md rule 4: the application never reads the evaluation data (ground truth, holdout set).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/evals-guard.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/evals[\\\\/](ground-truth|holdout)/]",
          message: "src/ ne lit jamais evals/ground-truth ni evals/holdout (CLAUDE.md, règle 4).",
        },
        {
          selector: "TemplateElement[value.raw=/evals[\\\\/](ground-truth|holdout)/]",
          message: "src/ ne lit jamais evals/ground-truth ni evals/holdout (CLAUDE.md, règle 4).",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
