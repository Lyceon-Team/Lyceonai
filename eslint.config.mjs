// @spec [Coding Standards, §16 ESLint + @typescript-eslint; §17 hard stops] | @implemented 2026-06-05
// plain English: Flat ESLint config. The §17 hard-stops run at ERROR. Enforcement
// is split (Wave 0 ruling Q4): BLOCKING for packages/shared (the new canon is born
// clean) via `pnpm lint:shared`; ADVISORY for the legacy tree via `pnpm lint` in the
// non-blocking ci-known-gaps job (accepted under ci/known-gaps.yaml -> eslint-legacy-tree, which expires). Standing rule: every wave lint-cleans the files it
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
    // scripts/**/*.mjs are Node CLI programs — CI gates, proving harnesses,
    // one-shot operator tools. Two rules misfire on them, and both misfires were
    // being carried in the eslint-legacy-tree accepted count as if they were
    // backlog:
    //
    //   no-undef reported `process`, `console`, `URL` and `fetch` as undefined in
    //   files where they ARE defined. 185 findings, every one of them false. This
    //   is the same config defect ci/known-gaps.yaml already names for the
    //   TypeScript tree; declaring the execution environment is telling ESLint the
    //   truth, not suppressing a finding. A genuine typo'd identifier is still
    //   caught, because only the real globals are declared.
    //
    //   no-console: §16's rule is "no console.log in PRODUCT code — use the
    //   structured logger". These scripts are not product code, ship in no bundle,
    //   and have no access to server/logger.ts; their stdout is the deliverable a
    //   CI job reads. Same carve-out, same reasoning as the apps/workers block
    //   below.
    //
    // Removing 287 false findings from an accepted count is not loosening the
    // ratchet — it is making the number mean what it claims to measure. Deliberately
    // NOT extended to scripts/**/*.ts and scripts/**/*.js (335 further findings):
    // that is a wider call than this change, and it is Karl's.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-console": "off",
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
