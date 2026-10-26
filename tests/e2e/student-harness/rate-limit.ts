/**
 * The student harness's own request ceiling: higher than production's, for the TEST SERVER ONLY.
 *
 * @spec [owner ruling (Karl, 2026-10-24, follow-ups to #1305/#1310): "Raise the rate limit for
 *        the e2e test server ONLY (test config/env of tests/e2e/student-harness); production
 *        limits unchanged"] | @implemented [2026-10-24]
 *
 * plain English: production's global limiter (server/index.ts) allows 1000 requests per 15
 * minutes per client. Every harness request comes from one machine, so one screenshot run of a
 * large group (dozens of shots x three viewports x two themes, each with its own session) used to
 * pass it and start answering 429, which the app reads as signed out; groups were split in two to
 * stay under it (LISA-DOCK-2, LISA-LAUNCHER-2). The harness keeps the SAME limiter middleware in
 * the same place (so its persona lookup and routes still sit behind one), with the same window,
 * and a higher ceiling: HARNESS_RATE_LIMIT_MAX, or `STUDENT_HARNESS_RATE_LIMIT_MAX` when a run
 * sets it.
 *
 * trade-offs: the override is read HERE ONLY. Production's limiter is inline in server/index.ts
 * and reads no environment variable for its values; tests/ci/rate-limit-production.guard.test.ts
 * pins both (the production values, and that this variable is never consulted outside the
 * harness). An unparseable or non-positive value falls back to the harness default, never to
 * "no limit".
 */

/** The harness's ceiling per window when no override is set. */
export const HARNESS_RATE_LIMIT_MAX = 20_000;

/** Production's window (server/index.ts), kept as is. */
export const HARNESS_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** The test-only override: the harness's requests per window. */
export const HARNESS_RATE_LIMIT_ENV = "STUDENT_HARNESS_RATE_LIMIT_MAX";

export function harnessRateLimitMax(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env[HARNESS_RATE_LIMIT_ENV];
  if (raw === undefined || raw.trim() === "") return HARNESS_RATE_LIMIT_MAX;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : HARNESS_RATE_LIMIT_MAX;
}
