/**
 * @spec [Doc-01_V8, §35; §31.4; Coding Standards §7.1, §7.2]
 * @implemented [2026-08-31] | @revised [2026-09-01 — Gate B: the row comes from Postgres]
 *
 * plain English: pins the linked-students response contract. Expected outcome:
 * a well-formed list parses, and a renamed or dropped column fails HERE with a
 * named field rather than surfacing as `undefined` in a dropdown option.
 *
 * WHY THE FIXTURE IS NOT WRITTEN HERE (guardian schema-truth gate, RULE B).
 * This file used to open with a hand-written `STUDENT` object spelling `id`,
 * `email`, `display_name` and `created_at`. That is a private second copy of the
 * schema: had `profiles.display_name` been renamed, the literal and the Zod
 * schema would have gone on agreeing with each other and this test would have
 * stayed green while the dropdown rendered `undefined` — the exact failure the
 * docstring above claims to prevent. The row is now SELECTed out of a real
 * `profiles` table built from `supabase/migrations`, using the same column list
 * the route projects, so a rename raises 42703 in `beforeAll` and every case
 * below inherits the true shape.
 *
 * Trade-off: the suite now needs a Postgres server, and skips without one — it
 * is registered as its own step in `.github/workflows/ci.yml` so that skip
 * cannot become a silent pass. Edge cases: the negative cases below are derived
 * FROM the real row (a field dropped, renamed, or replaced), so they cannot
 * drift away from it either.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../../../../tests/helpers/pg-supabase";
import {
  guardianStudentsResponseSchema,
  linkedStudentSchema,
} from "../guardian-student-schema";

const DB_NAME = "guardian_student_schema_ci";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The four columns `GET /api/guardian/students` projects. Named once, here, and
 * read back from Postgres — never restated as an object literal.
 */
const PROJECTED_COLUMNS = "id, email, display_name, created_at";

let pg: Client;
/** The real row, as Postgres returns it. Every case below derives from this. */
let STUDENT: Record<string, unknown>;

describe.skipIf(!PG_AVAILABLE)(
  "linked-student contract, against real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        STUDENT_ID,
        "a@test.com",
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, display_name, role)
       VALUES ($1, $2, $3, 'student')`,
        [STUDENT_ID, "a@test.com", "Ada"],
      );
      // 42703 here — not a silent pass — if any projected column is renamed.
      const r = await pg.query(
        `SELECT ${PROJECTED_COLUMNS} FROM public.profiles WHERE id = $1`,
        [STUDENT_ID],
      );
      expect(r.rowCount).toBe(1);
      /**
       * `has_active_entitlement` is DERIVED, not projected. The route SELECTs
       * the four columns above and then asks
       * `EntitlementService.isEntitlementActiveForProfile` per student, so it
       * cannot come out of this query and is attached here the way the route
       * attaches it. Kept out of `PROJECTED_COLUMNS` deliberately: putting it
       * there would make the SELECT fail with 42703 and wrongly suggest the
       * flag is a `profiles` column someone could rename.
       */
      STUDENT = {
        ...(r.rows[0] as Record<string, unknown>),
        has_active_entitlement: false,
      };
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    describe("linkedStudentSchema", () => {
      it("accepts a linked student row as Postgres actually returns it", () => {
        expect(linkedStudentSchema.safeParse(STUDENT).success).toBe(true);
      });

      it("accepts an unnamed student — display_name is genuinely nullable", () => {
        const parsed = linkedStudentSchema.safeParse({
          ...STUDENT,
          display_name: null,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.display_name).toBeNull();
      });

      /**
       * The drift this schema exists to catch: `student_user_id` survived a rename
       * across this whole surface because nothing parsed the boundary.
       */
      it("REFUSES a row whose id column has been renamed", () => {
        const { id: dropped, ...withoutId } = STUDENT;
        const parsed = linkedStudentSchema.safeParse({
          ...withoutId,
          student_user_id: dropped,
        });

        expect(parsed.success).toBe(false);
        if (parsed.success) return;
        // Named field, not a vague failure.
        expect(parsed.error.issues.some((i) => i.path.includes("id"))).toBe(
          true,
        );
      });

      it("refuses a missing email and a non-null non-string display_name", () => {
        const { email: _e, ...noEmail } = STUDENT;
        expect(linkedStudentSchema.safeParse(noEmail).success).toBe(false);
        expect(
          linkedStudentSchema.safeParse({ ...STUDENT, display_name: 12 })
            .success,
        ).toBe(false);
      });

      /**
       * `created_at` arrives from `pg` as a JS Date, which is precisely why the
       * schema normalises it. Asserting on the REAL value proves the coercion the
       * route depends on, rather than on a string someone typed here.
       */
      it("normalises the Date created_at Postgres returns into an ISO string", () => {
        expect(STUDENT.created_at).toBeInstanceOf(Date);
        const parsed = linkedStudentSchema.safeParse(STUDENT);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.created_at).toBe(
          (STUDENT.created_at as Date).toISOString(),
        );
      });
    });

    describe("guardianStudentsResponseSchema", () => {
      it("accepts an empty list — zero links is a fact, not an error", () => {
        const parsed = guardianStudentsResponseSchema.safeParse({
          students: [],
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.students).toEqual([]);
      });

      it("REFUSES the whole response when ONE student is malformed", () => {
        const parsed = guardianStudentsResponseSchema.safeParse({
          students: [STUDENT, { ...STUDENT, id: undefined }],
        });
        expect(parsed.success).toBe(false);
      });

      it("refuses a response with no students key at all", () => {
        expect(guardianStudentsResponseSchema.safeParse({}).success).toBe(
          false,
        );
      });
    });
  },
);
