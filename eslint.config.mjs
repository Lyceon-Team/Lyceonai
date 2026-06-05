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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
    },
  },
);
