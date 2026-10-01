/**
 * Settings → Profile background and the reference search — real PostgreSQL proof.
 *
 * @spec [SCL-195; Brief 8 rulings 1 and 3 (owner, 2026-10-01); Doc 01A §39–§47 (RateLimitLedger);
 *        Doc 01 V8 §40.5 (hard delete); CLAUDE.md "derive the fixture from real output"]
 * | @implemented [2026-10-01]
 *
 * plain English: every migration applied to a throwaway Postgres, the COMMITTED snapshot loaded
 * by the REAL import script, then the REAL routers behind the REAL `requireStudentAccount` gate
 * and the REAL ledger rate limiter, talking to the REAL SQL writer and search functions through
 * the pg-backed Supabase shim. Substituted: only the database transport and the signed-in user.
 *
 * Proves: each Zod boundary (out-of-range year, unknown GPA band, a 4th dream school, a duplicate,
 * an unknown reference id); that partial updates leave other fields alone and every field clears;
 * that guardians and admins are refused and no entitlement is needed; that account deletion
 * removes the rows; the search floor, cap and rate limit; and that nothing outside the one service
 * reads these tables (so no guardian surface can).
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import request from "supertest";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SupabaseUser } from "../../server/middleware/supabase-auth";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "student_background_ci";
const STUDENT = "5b000000-0000-4000-8000-00000000000a";
const OTHER_STUDENT = "5b000000-0000-4000-8000-00000000000b";
const GUARDIAN = "5b000000-0000-4000-8000-00000000000c";
const ADMIN = "5b000000-0000-4000-8000-00000000000d";
const YOUNG_STUDENT = "5b000000-0000-4000-8000-00000000000e";

let pg: Client;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

type Who = "student" | "other" | "guardian" | "admin" | "young";
let caller: Who = "student";

function userFor(who: Who): SupabaseUser {
  const base = {
    display_name: null,
    isAdmin: false,
    isGuardian: false,
    actor_id: STUDENT,
  };
  switch (who) {
    case "student":
      return {
        ...base,
        id: STUDENT,
        email: "a@example.test",
        role: "student",
        is_under_13: false,
      };
    case "other":
      return {
        ...base,
        id: OTHER_STUDENT,
        email: "b@example.test",
        role: "student",
        is_under_13: false,
      };
    case "guardian":
      return {
        ...base,
        id: GUARDIAN,
        email: "g@example.test",
        role: "guardian",
        isGuardian: true,
      };
    case "admin":
      return {
        ...base,
        id: ADMIN,
        email: "x@example.test",
        role: "admin",
        isAdmin: true,
      };
    case "young":
      return {
        ...base,
        id: YOUNG_STUDENT,
        email: "y@example.test",
        role: "student",
        is_under_13: true,
      };
  }
}

let app: express.Express;
let collegeIds: string[];
let highSchoolId: string;
const THIS_YEAR = new Date().getUTCFullYear();

async function buildApp(): Promise<express.Express> {
  const { requireStudentAccount } =
    await import("../../server/middleware/supabase-auth");
  const { studentBackgroundRouter, referenceSearchRouter } =
    await import("../../server/routes/student-background-routes");
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "brief-8";
    req.user = userFor(caller);
    next();
  });
  a.use(
    "/api/profile/background",
    requireStudentAccount,
    studentBackgroundRouter,
  );
  a.use("/api/reference", requireStudentAccount, referenceSearchRouter);
  return a;
}

async function seedProfile(
  id: string,
  role: string,
  dob: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.test`],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
     VALUES ($1, $2, $3, 'Someone', $4)`,
    [id, `${id}@example.test`, role, dob],
  );
}

async function storedRows(
  studentId: string,
): Promise<{ background: unknown[]; dreams: unknown[] }> {
  const background = await pg.query(
    `SELECT graduation_year, gpa_range, high_school_id FROM public.student_background WHERE student_id = $1`,
    [studentId],
  );
  const dreams = await pg.query(
    `SELECT position, college_id FROM public.student_dream_schools WHERE student_id = $1 ORDER BY position`,
    [studentId],
  );
  return { background: background.rows, dreams: dreams.rows };
}

describe.skipIf(!PG_AVAILABLE)(
  "student background + reference search (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      const { importReferenceData } =
        await import("../../scripts/reference-data/import-reference-data");
      const outcomes = await importReferenceData(pg);
      // Presence before absence: the real snapshot is loaded, not an empty table.
      expect(outcomes.map((o) => o.rows)).toEqual([2663, 35714]);

      const colleges = await pg.query(
        `SELECT id FROM public.ref_colleges WHERE name IN
         ('Harvard University', 'Massachusetts Institute of Technology', 'Stanford University',
          'Yale University')
       ORDER BY name`,
      );
      collegeIds = colleges.rows.map((r: { id: string }) => r.id);
      expect(collegeIds).toHaveLength(4);
      const school = await pg.query(
        `SELECT id FROM public.ref_high_schools WHERE id LIKE 'nces:%' ORDER BY id LIMIT 1`,
      );
      highSchoolId = String(school.rows[0]?.id);

      await seedProfile(STUDENT, "student", "2009-05-01");
      await seedProfile(OTHER_STUDENT, "student", "2009-06-01");
      await seedProfile(GUARDIAN, "guardian", "1980-01-01");
      await seedProfile(ADMIN, "admin", "1980-01-01");
      await seedProfile(YOUNG_STUDENT, "student", `${THIS_YEAR - 11}-01-01`);
      app = await buildApp();
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      caller = "student";
      await pg.query(`DELETE FROM public.student_dream_schools`);
      await pg.query(`DELETE FROM public.student_background`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(
        `UPDATE public.ref_colleges SET retired_at = NULL WHERE retired_at IS NOT NULL`,
      );
    });

    // ── GET / PUT ───────────────────────────────────────────────────────────────────────────────
    it("a student who has given nothing reads the empty background — no entitlement needed", async () => {
      const res = await request(app).get("/api/profile/background");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        graduation_year: null,
        gpa_range: null,
        high_school: null,
        dream_schools: [],
        requestId: "brief-8",
      });
      const ent = await pg.query(
        `SELECT 1 FROM public.entitlements WHERE profile_id = $1`,
        [STUDENT],
      );
      expect(ent.rowCount).toBe(0);
    });

    it("saves every field, reads them back resolved, and stores exactly what was sent", async () => {
      const [harvard, mit, stanford] = collegeIds as [
        string,
        string,
        string,
        string,
      ];
      const put = await request(app)
        .put("/api/profile/background")
        .send({
          graduation_year: THIS_YEAR + 2,
          gpa_range: "3_5_3_79",
          high_school_id: highSchoolId,
          dream_school_ids: [stanford, harvard, mit],
        });
      expect(put.status).toBe(200);
      expect(put.body.graduation_year).toBe(THIS_YEAR + 2);
      expect(put.body.gpa_range).toBe("3_5_3_79");
      expect(put.body.high_school.id).toBe(highSchoolId);
      expect(
        put.body.dream_schools.map((d: { id: string; position: number }) => [
          d.position,
          d.id,
        ]),
      ).toEqual([
        [1, stanford],
        [2, harvard],
        [3, mit],
      ]);
      // The payload is exactly the documented shape — nothing spread in from a row.
      expect(Object.keys(put.body).sort()).toEqual([
        "dream_schools",
        "gpa_range",
        "graduation_year",
        "high_school",
        "requestId",
      ]);
      expect(Object.keys(put.body.dream_schools[0]).sort()).toEqual([
        "city",
        "id",
        "name",
        "position",
        "state",
      ]);

      const get = await request(app).get("/api/profile/background");
      expect(get.body).toEqual(put.body);
      expect(await storedRows(STUDENT)).toEqual({
        background: [
          {
            graduation_year: THIS_YEAR + 2,
            gpa_range: "3_5_3_79",
            high_school_id: highSchoolId,
          },
        ],
        dreams: [
          { position: 1, college_id: stanford },
          { position: 2, college_id: harvard },
          { position: 3, college_id: mit },
        ],
      });
    });

    it("a partial update leaves the other fields alone, and each field clears on its own", async () => {
      const [harvard] = collegeIds as [string];
      await request(app)
        .put("/api/profile/background")
        .send({
          graduation_year: THIS_YEAR,
          gpa_range: "gt_4_0",
          high_school_id: highSchoolId,
          dream_school_ids: [harvard],
        });

      // A body naming ONE field changes that field and nothing else.
      const yearOnly = await request(app)
        .put("/api/profile/background")
        .send({ graduation_year: THIS_YEAR + 1 });
      expect(yearOnly.status).toBe(200);
      expect(yearOnly.body).toMatchObject({
        graduation_year: THIS_YEAR + 1,
        gpa_range: "gt_4_0",
      });
      expect(yearOnly.body.high_school.id).toBe(highSchoolId);
      expect(
        yearOnly.body.dream_schools.map((d: { id: string }) => d.id),
      ).toEqual([harvard]);

      const clearGpa = await request(app)
        .put("/api/profile/background")
        .send({ gpa_range: null });
      expect(clearGpa.status).toBe(200);
      expect(clearGpa.body).toMatchObject({
        graduation_year: THIS_YEAR + 1,
        gpa_range: null,
      });
      expect(clearGpa.body.high_school.id).toBe(highSchoolId);
      expect(clearGpa.body.dream_schools).toHaveLength(1);

      await request(app)
        .put("/api/profile/background")
        .send({ graduation_year: null });
      await request(app)
        .put("/api/profile/background")
        .send({ high_school_id: null });
      const cleared = await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [] });
      expect(cleared.body).toMatchObject({
        graduation_year: null,
        gpa_range: null,
        high_school: null,
        dream_schools: [],
      });
      expect(await storedRows(STUDENT)).toEqual({
        background: [
          { graduation_year: null, gpa_range: null, high_school_id: null },
        ],
        dreams: [],
      });
    });

    it.each([
      [
        "a graduation year before this year",
        { graduation_year: THIS_YEAR - 1 },
        "INVALID_BACKGROUND",
      ],
      [
        "a graduation year past this year + 6",
        { graduation_year: THIS_YEAR + 7 },
        "INVALID_BACKGROUND",
      ],
      [
        "a fractional graduation year",
        { graduation_year: THIS_YEAR + 0.5 },
        "INVALID_BACKGROUND",
      ],
      ["an unknown GPA band", { gpa_range: "4_0_4_5" }, "INVALID_BACKGROUND"],
      [
        "a malformed high-school id",
        { high_school_id: "Lincoln High" },
        "INVALID_BACKGROUND",
      ],
      [
        "a malformed college id",
        { dream_school_ids: ["harvard"] },
        "INVALID_BACKGROUND",
      ],
      [
        "a free-text school name (unknown key)",
        { high_school_name: "My School" },
        "INVALID_BACKGROUND",
      ],
      ["an empty body", {}, "INVALID_BACKGROUND"],
      [
        "an unknown high school",
        { high_school_id: "nces:000000000000" },
        "UNKNOWN_HIGH_SCHOOL",
      ],
      [
        "an unknown college",
        { dream_school_ids: ["000000"] },
        "UNKNOWN_COLLEGE",
      ],
    ])("refuses %s and stores nothing", async (_label, body, code) => {
      const res = await request(app).put("/api/profile/background").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(code);
      expect(await storedRows(STUDENT)).toEqual({ background: [], dreams: [] });
    });

    it("refuses a 4th dream school and a duplicate — at the route and again in the SQL writer", async () => {
      const [a, b, c, d] = collegeIds as [string, string, string, string];
      const fourth = await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [a, b, c, d] });
      const duplicate = await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [a, b, a] });
      expect(fourth.status).toBe(400);
      expect(duplicate.status).toBe(400);
      expect(fourth.body.error.code).toBe("INVALID_BACKGROUND");
      expect(duplicate.body.error.code).toBe("INVALID_BACKGROUND");

      // Defence in depth: a caller that skips the route still cannot store either.
      const sqlFourth = await pg.query(
        `SELECT public.save_student_background($1, $2::jsonb) AS r`,
        [STUDENT, JSON.stringify({ dream_school_ids: [a, b, c, d] })],
      );
      const sqlDuplicate = await pg.query(
        `SELECT public.save_student_background($1, $2::jsonb) AS r`,
        [STUDENT, JSON.stringify({ dream_school_ids: [a, a] })],
      );
      expect(sqlFourth.rows[0].r).toEqual({
        ok: false,
        error: "too_many_dream_schools",
      });
      expect(sqlDuplicate.rows[0].r).toEqual({
        ok: false,
        error: "duplicate_dream_school",
      });
      expect(await storedRows(STUDENT)).toEqual({ background: [], dreams: [] });
    });

    it("a retired college keeps resolving for a student who chose it, but cannot be chosen or found", async () => {
      const [harvard] = collegeIds as [string];
      await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [harvard] });
      await pg.query(
        `UPDATE public.ref_colleges SET retired_at = now() WHERE id = $1`,
        [harvard],
      );

      const read = await request(app).get("/api/profile/background");
      expect(read.body.dream_schools.map((d: { id: string }) => d.id)).toEqual([
        harvard,
      ]);

      // Holding it is not choosing it: the student can re-save and reorder a list that holds it.
      const mit = collegeIds[1] as string;
      const resave = await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [mit, harvard] });
      expect(resave.status).toBe(200);
      expect(
        resave.body.dream_schools.map((d: { id: string }) => d.id),
      ).toEqual([mit, harvard]);

      caller = "other";
      const choose = await request(app)
        .put("/api/profile/background")
        .send({ dream_school_ids: [harvard] });
      expect(choose.status).toBe(400);
      expect(choose.body.error.code).toBe("UNKNOWN_COLLEGE");
      const search = await request(app)
        .get("/api/reference/colleges")
        .query({ q: "Harvard University" });
      expect(
        search.body.results.map((r: { id: string }) => r.id),
      ).not.toContain(harvard);
    });

    // ── Who may call ────────────────────────────────────────────────────────────────────────────
    it("a guardian and an admin are refused with ROLE_NOT_PERMITTED, for read and write", async () => {
      for (const who of ["guardian", "admin"] as const) {
        caller = who;
        const read = await request(app).get("/api/profile/background");
        const write = await request(app)
          .put("/api/profile/background")
          .send({ gpa_range: "gt_4_0" });
        expect(read.status).toBe(403);
        expect(write.status).toBe(403);
        expect(read.body.code).toBe("ROLE_NOT_PERMITTED");
      }
      const all = await pg.query(
        `SELECT count(*)::int AS n FROM public.student_background`,
      );
      expect(all.rows[0].n).toBe(0);
    });

    it("search is for student accounts: a guardian and an admin are refused", async () => {
      for (const who of ["guardian", "admin"] as const) {
        caller = who;
        const res = await request(app)
          .get("/api/reference/colleges")
          .query({ q: "harvard" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("ROLE_NOT_PERMITTED");
      }
    });

    it("an under-13 student with no active guardian link is refused, as on every learning surface (SCL-187)", async () => {
      caller = "young";
      const res = await request(app).get("/api/profile/background");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("GUARDIAN_LINK_REQUIRED");
    });

    // ── Deletion ────────────────────────────────────────────────────────────────────────────────
    it("account deletion removes the background and the dream schools, and nobody else's", async () => {
      const [harvard, mit] = collegeIds as [string, string];
      await request(app)
        .put("/api/profile/background")
        .send({
          graduation_year: THIS_YEAR + 1,
          high_school_id: highSchoolId,
          dream_school_ids: [harvard, mit],
        });
      caller = "other";
      await request(app)
        .put("/api/profile/background")
        .send({ gpa_range: "3_0_3_49", dream_school_ids: [mit] });

      // Presence first: both students have rows.
      expect((await storedRows(STUDENT)).dreams).toHaveLength(2);
      expect((await storedRows(OTHER_STUDENT)).dreams).toHaveLength(1);

      const req = await pg.query(
        `INSERT INTO public.account_deletion_requests
         (profile_id, scheduled_hard_delete_at, actor_profile_id, status, requested_at)
       VALUES ($1, now() - interval '1 hour', $1, 'pending', now() - interval '8 days')
       RETURNING id`,
        [STUDENT],
      );
      await pg.query(`SELECT public.complete_and_anonymize_account($1, $2)`, [
        req.rows[0].id,
        STUDENT,
      ]);

      expect(await storedRows(STUDENT)).toEqual({ background: [], dreams: [] });
      expect(await storedRows(OTHER_STUDENT)).toEqual({
        background: [
          {
            graduation_year: null,
            gpa_range: "3_0_3_49",
            high_school_id: null,
          },
        ],
        dreams: [{ position: 1, college_id: mit }],
      });
      // Reference data is not personal data and is untouched.
      const ref = await pg.query(
        `SELECT count(*)::int AS n FROM public.ref_colleges`,
      );
      expect(ref.rows[0].n).toBe(2663);

      // Restore the deleted student for the remaining cases.
      await seedProfile(STUDENT, "student", "2009-05-01");
    });

    // ── Search ──────────────────────────────────────────────────────────────────────────────────
    it("search needs 2 characters, caps at 20, and matches case-insensitively with prefixes first", async () => {
      const short = await request(app)
        .get("/api/reference/colleges")
        .query({ q: "h" });
      const padded = await request(app)
        .get("/api/reference/high-schools")
        .query({ q: "  h  " });
      const missing = await request(app).get("/api/reference/colleges");
      expect(short.status).toBe(400);
      expect(padded.status).toBe(400);
      expect(missing.status).toBe(400);

      const harvard = await request(app)
        .get("/api/reference/colleges")
        .query({ q: "HARVARD" });
      expect(harvard.status).toBe(200);
      expect(harvard.body.results[0]).toMatchObject({
        name: "Harvard University",
        state: "MA",
      });

      const broad = await request(app)
        .get("/api/reference/high-schools")
        .query({ q: "high" });
      expect(broad.status).toBe(200);
      expect(broad.body.results).toHaveLength(20);
      for (const row of broad.body.results) {
        expect(Object.keys(row).sort()).toEqual([
          "city",
          "id",
          "name",
          "state",
        ]);
      }

      // A LIKE metacharacter is matched literally, not as "everything".
      const wildcard = await request(app)
        .get("/api/reference/colleges")
        .query({ q: "%%" });
      expect(wildcard.body.results).toEqual([]);
    });

    it("search is rate-limited through the ledger's reference_search bucket (seeded 300 / hour)", async () => {
      const seeded = await pg.query(
        `SELECT value -> 'reference_search' AS def FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
      );
      expect(seeded.rows[0].def).toEqual({ limit: 300, window_seconds: 3600 });

      // The mechanism, at a limit small enough to reach: both pickers share the one bucket.
      await pg.query(
        `UPDATE public.rate_limit_runtime_config
          SET value = jsonb_set(value, '{reference_search,limit}', '3')
        WHERE key = 'bucket_definitions'`,
      );
      try {
        const statuses: number[] = [];
        for (const path of [
          "colleges",
          "high-schools",
          "colleges",
          "high-schools",
        ]) {
          const res = await request(app)
            .get(`/api/reference/${path}`)
            .query({ q: "lincoln" });
          statuses.push(res.status);
          if (res.status === 429)
            expect(res.headers["x-ratelimit-limit"]).toBe("3");
        }
        expect(statuses).toEqual([200, 200, 200, 429]);
      } finally {
        await pg.query(
          `UPDATE public.rate_limit_runtime_config
            SET value = jsonb_set(value, '{reference_search,limit}', '300')
          WHERE key = 'bucket_definitions'`,
        );
      }
    });
  },
);

// ── No guardian surface can read these tables ─────────────────────────────────────────────────
describe("the background tables have one reader (ruling 1: never on a guardian surface)", () => {
  const ROOT = join(__dirname, "..", "..");
  const TABLES =
    /\b(student_background|student_dream_schools|save_student_background)\b/;
  const ALLOWED = new Set(["server/services/student-background.ts"]);

  function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...files(full));
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry))
        out.push(full);
    }
    return out;
  }

  it("only server/services/student-background.ts names them in server or API code", () => {
    const hits = ["server", "apps/api/src"]
      .flatMap((d) => files(join(ROOT, d)))
      .filter((f) => TABLES.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    // Presence: the reader itself is found, so the scan is looking at real files.
    expect(hits).toContain("server/services/student-background.ts");
    expect(hits.filter((h) => !ALLOWED.has(h))).toEqual([]);
  });
});
