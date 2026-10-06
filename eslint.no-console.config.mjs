// @spec [Coding Standards §16 (no console in product code; use the structured logger);
//        Codex audit of #1073 + #1108 + #1113, finding 1 (HIGH), accepted by Karl 2026-10-05:
//        "Remove every console.* from student-scope client code … Set ESLint no-console to
//        error for client/src, so CI fails on any new one."] | @implemented [2026-10-05]
//
// plain English: a BLOCKING lint of exactly one rule, `no-console`, over the shipped client
// code under client/src. `pnpm lint` (eslint.config.mjs) already sets no-console to error, but
// it runs in the advisory ci-known-gaps job, so a new console call never failed CI. This config
// runs in the required `ci` job via `pnpm run lint:no-console`.
//
// Trade-offs and edge cases:
// - Only no-console is checked, so the legacy tree's other advisory findings do not block here.
// - `noInlineConfig`: an `eslint-disable` comment cannot switch the rule off, so the only way
//   past it is an entry in the ignore list below, which a reviewer sees.
// - Test files are not shipped and are not checked (they spy on console to assert silence).
// - Two files are excluded BY NAME because they belong to the SEO vertical (owner scope
//   boundary, Karl, 2026-10-05; student-UI register §8 F-74): `pages/home.tsx` is the public
//   landing page `/`, and `lib/analytics/consent.ts` is the cookie-consent module (SEO Wave 1C).
//   Removing either exclusion makes this lint fail until that vertical removes its console calls.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "client/src/pages/home.tsx",
      "client/src/lib/analytics/consent.ts",
    ],
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    rules: { "no-console": "error" },
  },
);
