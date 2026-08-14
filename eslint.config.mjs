// @spec [Coding Standards, §16 ESLint + @typescript-eslint; §17 hard stops] | @implemented 2026-06-05
// plain English: Flat ESLint config. The §17 hard-stops run at ERROR. Enforcement
// is split (Wave 0 ruling Q4): BLOCKING for packages/shared (the new canon is born
// clean) via `pnpm lint:shared`; ADVISORY for the legacy tree via `pnpm lint` in the
// non-blocking ci-known-gaps job. Standing rule: every wave lint-cleans the files it
// touches; lint graduates to fully blocking when advisory violations reach zero
// (ledger graduation criterion). Non-type-checked rules only (fast, no project wiring).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "client/dist/**",
      "build/**",
      "coverage/**",
      "**/node_modules/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // §17 hard stops — error level.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-var": "error",
      // §16 — no console.log in product code (use the structured logger).
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          // §17 — caught error vars must be used; with no-empty this closes the
          // silent-catch hole (both empty-body and unused-error swallows).
          caughtErrors: "all",
        },
      ],
    },
  },
  {
    // apps/workers/** run as separate Cloud Run processes with no access to
    // server/logger.ts (the shared structured logger is a main-API-only
    // utility; workers are built in isolation per their own package.json —
    // see apps/workers/tutor-orchestrator/src/lib/schema.ts). §16's intent
    // ("use the structured logger utility") is met here via console.error +
    // JSON, the agreed worker-process logging convention. Scoped to
    // console.error only — console.log/warn/debug remain banned everywhere.
    files: ["apps/workers/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error"] }],
    },
  },
);
