/**
 * @spec [SCL-186 (strikes Doc 05 Parent §12.2 "your recency-weighted accuracy is Y%");
 *   owner ruling 6, 2026-09-29; Doc 05 AC#20] | @implemented [2026-09-29] |
 * plain English: ONE shared scenario for the student `/api/progress/kpis` payload, used by
 * every render test that proves no raw accuracy figure reaches a student surface.
 *
 * WHY THE PAYLOAD IS BUILT BY THE REAL PRODUCER. The route returns what
 * `buildStudentKpiViewFromCanonical` builds. A hand-written payload could omit the very
 * field the test is about (or shape it in a way the server never emits) and the absence
 * assertion would pass for the wrong reason. So the only hand-written input here is the
 * database row the builder reads; the builder itself runs for real and its output is
 * round-tripped through JSON, as the wire does.
 *
 * The row carries a NON-NULL accuracy on purpose: the payload the client receives has
 * `week.accuracy`, `recency.accuracy` and the `week_accuracy` / `recency_accuracy`
 * metrics populated, so a surface that renders any of them shows a `%`.
 *
 * Usage: the calling test file must register the stub with
 *   vi.mock("<relative path>/apps/api/src/lib/supabase-server", async () => ({
 *     supabaseServer: (await import("@/test-support/student-kpi.harness")).supabaseServerStub,
 *   }));
 * This module never imports the builder statically, so that factory cannot form a cycle.
 */

/** The `student_overall_kpi` row the builder reads (the single hand-written input). */
export const STUDENT_OVERALL_KPI_ROW = {
  events_total: 120,
  events_last_7d: 17,
  events_last_30d: 64,
  accuracy_overall: 0.71,
  accuracy_last_7d: 0.73,
  accuracy_last_30d: 0.69,
  current_streak_days: 4,
  longest_streak_days: 9,
  sections_active: 2,
  // Today: since G-NEW-16 the builder serves the streak AS OF TODAY, so a last active day
  // before yesterday would read 0. Dated now, the stored 4 is the current streak.
  last_active_at: new Date().toISOString(),
} as const;

/** `student_study_profile.timezone`, read by `currentStreakAsOfToday` (G-NEW-16). */
export const STUDENT_TIMEZONE = "America/New_York";

/** `practice_runtime_config.quota_reset_timezone`, read by the builder's timezone step. */
export const QUOTA_RESET_TIMEZONE = "America/New_York";

type StubResult = { data: unknown; error: null };

function rowFor(table: string): StubResult {
  if (table === "student_overall_kpi") {
    return { data: STUDENT_OVERALL_KPI_ROW, error: null };
  }
  if (table === "student_study_profile") {
    return { data: { timezone: STUDENT_TIMEZONE }, error: null };
  }
  if (table === "practice_runtime_config") {
    return { data: { value: QUOTA_RESET_TIMEZONE }, error: null };
  }
  throw new Error(`student-kpi.harness: unexpected table ${table}`);
}

type StubChain = {
  select: () => StubChain;
  eq: () => StubChain;
  maybeSingle: () => Promise<StubResult>;
  single: () => Promise<StubResult>;
};

function chainFor(table: string): StubChain {
  const chain: StubChain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => rowFor(table),
    single: async () => rowFor(table),
  };
  return chain;
}

/** Stand-in for `supabaseServer`: answers only the reads the KPI builder makes (the KPI row, the
 * platform zone, and since G-NEW-16 the student's own zone). */
export const supabaseServerStub = {
  from: (table: string): StubChain => chainFor(table),
};

/** The student KPI payload exactly as the real builder produces it, after a JSON round trip. */
export async function buildStudentKpiPayload(): Promise<unknown> {
  const { buildStudentKpiViewFromCanonical } = await import(
    "../../../server/services/canonical-runtime-views"
  );
  const view = await buildStudentKpiViewFromCanonical("student-kpi-harness", true);
  const payload: unknown = JSON.parse(JSON.stringify(view));
  return payload;
}
