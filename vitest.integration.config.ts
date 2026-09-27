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
 * HTTP, so they need no React plugin, no jsdom and no path aliases.
 */
import { defineConfig } from "vitest/config";

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
  },
});
