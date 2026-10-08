/**
 * The integration suite's own config — the one that does NOT exclude it.
 *
 * @spec [Brief 8 Step 5] @implemented [2026-09-23]
 *
 * WHY THIS FILE EXISTS. `vitest.config.ts` excludes `tests/integration/**` so the default
 * suite stays hermetic (those two tests need a real Supabase project). The `integration`
 * CI job then ran `vitest run tests/integration` against that same config, so the filter
 * selected a directory the config had already excluded and vitest exited 1 with
 *
 *     No test files found, exiting with code 1
 *
 * on every push to `main`. The job had never passed. Its two tests — `auth.integration`
 * and `protected-routes.integration` — are real and the job already carries the secrets
 * they need; nothing was wrong with them except that nothing ran them.
 *
 * `--exclude` on the CLI does not fix it: vitest 4 APPENDS that pattern to the configured
 * list rather than replacing it, so `tests/integration/**` stays excluded. A separate
 * config is the smallest honest fix — the default suite keeps its exclusion, this one
 * drops it, and neither has to know about the other.
 *
 * It inherits nothing by design: the integration tests run against a real server over
 * HTTP, so they need no React plugin and no jsdom.
 *
 * THEY DO NEED ONE ALIAS, and this file used to say they needed none — which was true when
 * it was written and became false silently. These tests import the real Express app, and
 * that import chain now reaches `@lyceon/shared`:
 *
 *     Cannot find package '@lyceon/shared' imported from
 *     server/services/calendar/read-service.ts
 *     ❯ server/routes/student-resources.ts:75:1
 *
 * `@lyceon/shared` is NOT installed: it is absent from the root package.json and from
 * node_modules, and its own `main` points at `./src/index.js` where only `.ts` exists. It
 * resolves through a bundler alias and nothing else — `vite.config.ts` and
 * `vitest.config.ts` both carry one. So the moment any server module the app imports began
 * importing it, this config could no longer load the app at all, and BOTH suites failed at
 * import time rather than on any behaviour they assert.
 *
 * It failed only in CI, which is what let it through: without SUPABASE_* set, both files
 * `describe.skipIf` themselves and the import chain is never evaluated, so the suite is
 * green locally and red in the one place the secrets exist.
 */
import path from "path";
import { defineConfig } from "vitest/config";
import { loadTutorPromptFingerprints, makeTutorConsoleGuard } from "./tests/ci/lib/tutor-log-guard";

// CI logs are public: console output carrying LISA's prompt text is dropped and fails the run
// (tests/ci/lib/tutor-log-guard.ts; owner decision 2026-10-07).
const tutorConsoleGuard = makeTutorConsoleGuard(loadTutorPromptFingerprints(__dirname));

export default defineConfig({
  test: {
    globals: true,
    // A real Supabase round trip is slower than a unit test's; the default 5s timeout
    // fails these on latency rather than on behaviour.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    onConsoleLog: tutorConsoleGuard.onConsoleLog,
  },
  resolve: {
    alias: {
      // The same mapping vite.config.ts and vitest.config.ts use, for the same reason: the
      // package is not installed, so this alias IS its resolution. Kept to the one alias
      // these tests actually need — they render no React and touch no `@/` client path.
      "@lyceon/shared": path.resolve(__dirname, "./packages/shared/src"),
    },
  },
});
