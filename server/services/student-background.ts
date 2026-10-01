/**
 * Student background (Settings → Profile; the calendar's dream-school picker) and the reference
 * search behind its two pickers.
 *
 * @spec [SCL-195 (PROPOSED); Brief 8 rulings 1 and 3 (owner, 2026-10-01); Coding Standards §3.6
 *        (Result for expected failures), §8.1 (domain module behind a thin handler), §12.1]
 * | @implemented [2026-10-01]
 *
 * plain English: reads a student's own background and resolves each reference id to the row it
 * names; writes through the ONE SQL writer (`save_student_background`); and runs the two
 * searches. Expected outcome: Settings and the calendar picker share this module, so they can
 * never disagree about what a background is or how it is saved.
 *
 * Trade-offs and edge cases:
 *   - Every payload is parsed through the `.strict()` shared schema before it leaves this module,
 *     so a column added to a table later cannot reach the client by being spread (CLAUDE.md's
 *     chokepoint rule) — it fails the parse and is a 500, never a leak.
 *   - A retired reference row (absent from the latest snapshot) still RESOLVES for a student who
 *     already chose it, but cannot be chosen again: the writer refuses it, and search hides it.
 *   - Nothing here is logged except ids, codes and the request id — never a school, a year or a
 *     GPA band (tests/ci/log-personal-fields.ci.test.ts covers these field names).
 */
import {
  err,
  ok,
  REFERENCE_SEARCH_MAX_RESULTS,
  referenceSchoolSchema,
  studentBackgroundSchema,
  type ReferenceSchool,
  type Result,
  type StudentBackground,
  type StudentBackgroundErrorCode,
  type StudentBackgroundUpdate,
} from "@lyceon/shared";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";

export type ReferenceKind = "colleges" | "high_schools";

const SEARCH_FUNCTION: Record<ReferenceKind, string> = {
  colleges: "search_ref_colleges",
  high_schools: "search_ref_high_schools",
};

const REFERENCE_COLUMNS = "id, name, city, state";

const backgroundRowSchema = z.object({
  graduation_year: z.number().int().nullable(),
  gpa_range: z.string().nullable(),
  high_school_id: z.string().nullable(),
});
const dreamRowSchema = z.object({
  position: z.number().int(),
  college_id: z.string(),
});
/** The writer's expected refusals, as `save_student_background` returns them. */
const saveRefusalSchema = z.enum([
  "unknown_high_school",
  "unknown_college",
  "too_many_dream_schools",
  "duplicate_dream_school",
]);
const saveOutcomeSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: saveRefusalSchema }),
]);

const SAVE_ERROR_CODES: Record<
  z.infer<typeof saveRefusalSchema>,
  StudentBackgroundErrorCode
> = {
  unknown_high_school: "UNKNOWN_HIGH_SCHOOL",
  unknown_college: "UNKNOWN_COLLEGE",
  too_many_dream_schools: "TOO_MANY_DREAM_SCHOOLS",
  duplicate_dream_school: "DUPLICATE_DREAM_SCHOOL",
};

export class StudentBackgroundReadError extends Error {
  constructor(stage: string) {
    super(`student background read failed at ${stage}`);
    this.name = "StudentBackgroundReadError";
  }
}

async function readReferenceRows(
  table: "ref_colleges" | "ref_high_schools",
  ids: string[],
): Promise<Map<string, ReferenceSchool>> {
  const rows = new Map<string, ReferenceSchool>();
  if (ids.length === 0) return rows;
  const { data, error } = await supabaseServer
    .from(table)
    .select(REFERENCE_COLUMNS)
    .in("id", ids);
  if (error) throw new StudentBackgroundReadError(table);
  for (const row of z.array(referenceSchoolSchema).parse(data ?? [])) {
    rows.set(row.id, row);
  }
  return rows;
}

/**
 * The student's own background, every reference resolved. A student who has never saved one
 * gets the empty background (all null, no dream schools) — not a 404, because "nothing given"
 * is the expected state of an optional form.
 */
export async function readStudentBackground(
  studentId: string,
): Promise<StudentBackground> {
  const [backgroundRead, dreamRead] = await Promise.all([
    supabaseServer
      .from("student_background")
      .select("graduation_year, gpa_range, high_school_id")
      .eq("student_id", studentId)
      .maybeSingle(),
    supabaseServer
      .from("student_dream_schools")
      .select("position, college_id")
      .eq("student_id", studentId)
      .order("position", { ascending: true }),
  ]);
  if (backgroundRead.error) {
    throw new StudentBackgroundReadError("student_background");
  }
  if (dreamRead.error) {
    throw new StudentBackgroundReadError("student_dream_schools");
  }

  const background =
    backgroundRead.data === null
      ? null
      : backgroundRowSchema.parse(backgroundRead.data);
  const dreams = z.array(dreamRowSchema).parse(dreamRead.data ?? []);

  const [schools, colleges] = await Promise.all([
    readReferenceRows(
      "ref_high_schools",
      background?.high_school_id ? [background.high_school_id] : [],
    ),
    readReferenceRows(
      "ref_colleges",
      dreams.map((d) => d.college_id),
    ),
  ]);

  const highSchoolId = background?.high_school_id ?? null;
  const highSchool = highSchoolId === null ? null : schools.get(highSchoolId);
  if (highSchoolId !== null && highSchool === undefined) {
    // The foreign key makes this unreachable; if it is reached, the data is wrong, not the input.
    throw new StudentBackgroundReadError("high_school_unresolved");
  }

  const dreamSchools = dreams.map((dream) => {
    const college = colleges.get(dream.college_id);
    if (college === undefined) {
      throw new StudentBackgroundReadError("college_unresolved");
    }
    return { ...college, position: dream.position };
  });

  return studentBackgroundSchema.parse({
    graduation_year: background?.graduation_year ?? null,
    gpa_range: background?.gpa_range ?? null,
    high_school: highSchool ?? null,
    dream_schools: dreamSchools,
  });
}

export type StudentBackgroundFailure =
  | { kind: "invalid_reference"; code: StudentBackgroundErrorCode }
  | { kind: "write_failed" };

/**
 * Save a PARTIAL update through `save_student_background`, then read back what is stored.
 * `update` has already been parsed by `makeStudentBackgroundUpdateSchema`; only the keys it
 * carries are sent, so an absent key leaves the stored value alone.
 */
export async function saveStudentBackground(
  studentId: string,
  update: StudentBackgroundUpdate,
  requestId?: string,
): Promise<Result<StudentBackground, StudentBackgroundFailure>> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) patch[key] = value;
  }

  const { data, error } = await supabaseServer.rpc("save_student_background", {
    p_student_id: studentId,
    p_patch: patch,
  });
  if (error) {
    logger.error(
      "STUDENT_BACKGROUND",
      "save_failed",
      "save_student_background failed",
      { ...classifyError(error), requestId },
    );
    return err({ kind: "write_failed" });
  }

  const outcome = saveOutcomeSchema.safeParse(data);
  if (!outcome.success) {
    logger.error(
      "STUDENT_BACKGROUND",
      "save_outcome_unexpected",
      "save_student_background returned an unexpected shape",
      { requestId },
    );
    return err({ kind: "write_failed" });
  }
  if (!outcome.data.ok) {
    return err({
      kind: "invalid_reference",
      code: SAVE_ERROR_CODES[outcome.data.error],
    });
  }

  return ok(await readStudentBackground(studentId));
}

/**
 * Ruling 3's search: at most 20 rows, the 2-character floor already enforced by the route's
 * schema and again inside the SQL function.
 */
export async function searchReference(
  kind: ReferenceKind,
  query: string,
): Promise<ReferenceSchool[]> {
  const { data, error } = await supabaseServer.rpc(SEARCH_FUNCTION[kind], {
    p_query: query,
    p_limit: REFERENCE_SEARCH_MAX_RESULTS,
  });
  if (error) throw new StudentBackgroundReadError(SEARCH_FUNCTION[kind]);
  return z
    .array(referenceSchoolSchema)
    .max(REFERENCE_SEARCH_MAX_RESULTS)
    .parse(data ?? []);
}
