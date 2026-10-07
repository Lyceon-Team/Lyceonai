// @spec [Coding Standards, §16 ESLint + @typescript-eslint; §17 hard stops] | @implemented 2026-06-05
// plain English: Flat ESLint config. The §17 hard-stops run at ERROR. `pnpm run lint`
// (this config, whole repository) is BLOCKING in the required `ci` job as of
// 2026-10-07 (owner decision: resolve the eslint-legacy-tree exception before it
// expired on 2026-11-01). The tree was burned down to zero and the accepted-failure
// entry in ci/known-gaps.yaml was deleted, so there is no advisory tier any more:
// a new finding anywhere fails CI. Non-type-checked rules only (fast, no project wiring).
//
// Every carve-out below states why it is a statement of fact about the files it
// covers (execution environment, CLI vs product code), not a suppression.
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
      // Agent worktrees (listed in the repository's ignore file). Flat config
      // does not read that file, so running `pnpm run lint` in the main checkout
      // recursed into every .claude/worktrees/<agent>/ copy of the repository and
      // reported each finding once per worktree. Not source; never in CI's checkout.
      ".claude/worktrees/**",
      // Claude Code harness hooks (PreToolUse/PostToolUse guards wired from
      // .claude/settings.json). They are agent-tooling configuration, not
      // product, CLI or test code, and changes to them are owner-gated: an
      // agent editing the guard that blocks its own writes is the wrong
      // direction of authority. Their findings (fail-open empty catches around
      // the hook-stdin JSON.parse, one dead assignment) are reported to the
      // owner for a deliberate fix rather than being edited by an agent.
      ".claude/hooks/**",
      // Tracked one-off OUTPUT, not source: a promo-video composition
      // (capture.mjs, check.mjs, composition.js, an .mp3, a .jpg) produced on
      // 2026-09-17. Nothing imports it, nothing builds it, nothing ships it.
      // It is tracked; whether it should be is the owner's call.
      "brag-output-*/**",
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
    // no-undef is OFF for TypeScript. typescript-eslint's own docs recommend it:
    // the compiler already reports undefined identifiers (TS2304) with full type
    // and lib knowledge, while ESLint's no-undef knows nothing of TS globals,
    // ambient declarations or type-only names and so reports false positives.
    // `tseslint.configs.recommended` already applies this override; it is
    // restated here so the decision survives a change of preset. Measured
    // 2026-10-07: every one of the 228 no-undef findings was in a .js/.mjs file
    // (none in TS), so this block changed nothing on its own — the JS findings
    // are fixed by declaring the Node environment below.
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    // scripts/**/*.mjs are Node CLI programs — CI gates, proving harnesses,
    // one-shot operator tools. Two rules misfire on them, and both misfires were
    // being carried in the eslint-legacy-tree accepted count as if they were
    // backlog:
    //
    //   no-undef reported `process`, `console`, `URL` and `fetch` as undefined in
    //   files where they ARE defined. 185 findings, every one of them false.
    //   Declaring the execution environment is telling ESLint the truth, not
    //   suppressing a finding. A genuine typo'd identifier is still caught,
    //   because only the real globals are declared.
    //
    //   no-console: §16's rule is "no console.log in PRODUCT code — use the
    //   structured logger". These scripts are not product code, ship in no bundle,
    //   and have no access to server/logger.ts; their stdout is the deliverable a
    //   CI job reads. Same carve-out, same reasoning as the apps/workers block
    //   below.
    //
    // 2026-10-07 (owner decision resolving eslint-legacy-tree): extended from
    // scripts/**/*.mjs + scripts/assemble-batch.ts to every operator CLI tree —
    // scripts/** in all its languages, server/scripts/** and apps/api/scripts/**
    // (run via `tsx`, e.g. `pnpm cleanup:stems`), tests/legacy/*.js (standalone
    // Node scripts, not vitest suites — vitest only collects *.test.ts[x]) and
    // tests/eval/** (the operator-run LISA leak probe, whose stdout is the
    // synthetic golden-set responses it exists to show a human reviewer). Each
    // file under these globs is a command-line program whose stdout is its
    // output; none is imported by server/, client/, apps/*/src or packages/.
    files: [
      "scripts/**/*.{js,mjs,cjs,ts}",
      "server/scripts/**/*.ts",
      "apps/api/scripts/**/*.ts",
      "tests/legacy/**/*.js",
      "tests/eval/**/*.ts",
    ],
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
  {
    // server/logger.ts IS the structured logger: its development formatter and
    // its last-resort "monitor webhook failed" report are the console sink every
    // other file is told to route through. Banning console here would ban the
    // sink itself. Scoped to that one file by name.
    files: ["server/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Test harnesses (vitest suites, Playwright specs, RLS/integration helpers,
    // vitest.setup.ts) are not product code and ship in no bundle; a skip notice
    // or a report path printed to the operator running them is legitimate.
    //
    // NOT covered, deliberately: any test whose file name says it exercises
    // tutor (LISA) code. Coding Standards §12.1 — tutor prompts and responses
    // never reach a log, and CI output is a log. The next block switches
    // no-console back ON for those files, so a test cannot print a
    // systemInstruction into CI output again.
    files: [
      "tests/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "**/__tests__/**/*.{ts,tsx}",
      "vitest.setup.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Tutor-touching tests: console stays an ERROR (see the block above).
    // tests/eval/** is the operator CLI probe covered by the CLI block.
    files: [
      "tests/**/*lisa*.{ts,tsx}",
      "tests/**/*tutor*.{ts,tsx}",
      "**/*lisa*.test.{ts,tsx}",
      "**/*tutor*.test.{ts,tsx}",
    ],
    ignores: ["tests/eval/**"],
    rules: {
      "no-console": "error",
    },
  },
);
