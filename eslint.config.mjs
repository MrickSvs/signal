import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// CLAUDE.md rule 1: every LLM call goes through src/lib/llm.
const LLM_SDK_IMPORT = {
  group: ["@langchain/anthropic", "@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
  message: "Passe par src/lib/llm (routage, trace Langfuse, coût).",
};

// CLAUDE.md rule 4: the application never imports the evaluation data (ground truth, holdout set).
const EVALS_DATA_IMPORT = {
  regex: "(^|/)evals/(ground-truth|holdout)(/|$)",
  message: "src/ ne lit jamais evals/ground-truth ni evals/holdout (CLAUDE.md, règle 4).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // Rule 1 for the scripts; scripts/evals/ keeps its access to the evaluation data.
    files: ["scripts/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [LLM_SDK_IMPORT] }] },
  },
  {
    // Rules 1 and 4 for the application. Options of a rule are not merged across blocks, so each
    // block lists every pattern that applies to it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/llm/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [LLM_SDK_IMPORT, EVALS_DATA_IMPORT] }],
    },
  },
  {
    files: ["src/lib/llm/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [EVALS_DATA_IMPORT] }] },
  },
  {
    // Rule 4 beyond static imports: paths in strings, dynamic imports, fs reads.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/evals-guard.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/evals[\\\\/](ground-truth|holdout)/]:not(ImportDeclaration > Literal)",
          message: "src/ ne lit jamais evals/ground-truth ni evals/holdout (CLAUDE.md, règle 4).",
        },
        {
          selector: "TemplateElement[value.raw=/evals[\\\\/](ground-truth|holdout)/]",
          message: "src/ ne lit jamais evals/ground-truth ni evals/holdout (CLAUDE.md, règle 4).",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
