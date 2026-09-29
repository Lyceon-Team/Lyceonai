/**
 * PUT /api/calendar/profile → real route, real service, real PostgreSQL.
 *
 * @spec [Doc_05F_Study_Calendar §8.1 (profile write), §17.5 (setup), §7.8 idempotency
 *        (INV-08-09), R-08-27; lyceon-coding-standards §4.2, §8.3] | @implemented [2026-09-29]
 *
 * plain English: it sends the body a new student's setup form actually produces, to the real
 * route, against a database with the real migrations applied, and looks at the row. What no
 * mock can establish is here: whether `student_study_profile` ends up holding what the
 * student chose, and whether `full_length_pair` accepts it.
 *
 * WHAT THIS FILE WAS WRITTEN FOR — two defects on one save path.
 *
 *   (1) 2026-09-28, production: every new premium student stopped at their first screen.
 *       `400 INVALID_BODY`, `fieldErrors: { idempotency_key: ["Required"] }`, eight times,
 *       zero rows in `student_study_profile`, zero plan versions. The setup popup did not
 *       send the key; the settings sheet did. Cases 1 and 2 below are that 400 and its fix.
 *
 *   (2) Found while fixing (1), and live on the same endpoint: `upsertStudyProfile` never
 *       copied `full_length_interval_weeks` into the row it upserts. The schema refuses a
 *       body naming one half of the pair without the other, so every accepted exam-touching
 *       body carries both — and the writer stored only the weekday. Turning exams ON wrote
 *       `weekday = 6` beside an interval still NULL, `full_length_pair` (20261010000000)
 *       rejected it as 23514, and the service reported `write_failed`: a 500 served for a
 *       body that was perfectly valid. Case 4 is that, and it can only be proved here —
 *       the service's own suite hands the fake client a row and asks what came back, which
 *       is a question about the fake.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (`supabaseServer` → real SQL via
 * `tests/helpers/pg-supabase`), the AUTH boundary (a session fixture) and CSRF. NOT
 * substituted: `calendar-routes`, `profile-service`, `makeStudyProfileUpsertSchema`,
 * `loadCalendarConfig`, and the schema itself — every module whose behaviour is under test
 * runs for real, against real SQL, including every CHECK constraint on the table.
 */
import express from "express";
import request from "supertest";
import { Client } from "pg";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { logger } from "../../server/logger";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "calendar_profile_upsert_ci";
const STUDENT = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

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

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));

// §16: the profile WRITE is not gated (SCL-130), but the router pulls the entitlement
// service in regardless. Answering true keeps a network-shaped dependency out of a test
// about a database write.
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature: vi.fn(async () => true) },
}));

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/calendar-routes"))
    .calendarRouter;
  const app = express();
  app.use(express.json());
  // `calendarRouter` carries no auth of its own — the real server mounts
  // `requireSupabaseAuth` ahead of it, and `callerOf` reads `req.user`. The session is
  // supplied here in the SupabaseUser shape rather than a narrowed `{id, role}`: the route
  // reads `actor_id` off it, and a hand-narrowed user is how SCL-151 wrote the identity key
  // into the pseudonymous column.
  app.use((req, _res, next) => {
    req.requestId = "brief-16";
    req.user = {
      id: STUDENT,
      email: "student@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: ACTOR,
    };
    next();
  });
  app.use("/api/calendar", router);
  return app;
}

let app: express.Express;

/**
 * THE BODY THE SETUP FORM PRODUCES, minus the key — exactly the payload
 * `calendar.setup-wire-contract.test.tsx` pulls off the wire in the browser. Written here
 * as a function so each case starts from the same seven fields and differs only in the one
 * thing it is about.
 */
function setupBody(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    timezone: "America/Chicago",
    target_exam_date: null,
    target_score: null,
    study_days_mask: 62,
    daily_minutes: 60,
    full_length_weekday: null,
    full_length_interval_weeks: null,
    ...over,
  };
}

/**
 * A rejected value distinctive enough to prove its own absence. Well in the past, so the
 * schema refuses it whatever today is.
 */
const PAST_DATE_SENTINEL = "1999-07-04";

/** A fresh key, the way `newIntent` mints one per intent in the client. */
function key(): string {
  return crypto.randomUUID();
}

async function profileRows(): Promise<
  {
    student_id: string;
    study_days_mask: number;
    daily_minutes: number;
    full_length_weekday: number | null;
    full_length_interval_weeks: number | null;
    setup_completed_at: string | null;
  }[]
> {
  const r = await pg.query(
    `SELECT student_id, study_days_mask, daily_minutes, full_length_weekday,
            full_length_interval_weeks, setup_completed_at
       FROM public.student_study_profile WHERE student_id = $1`,
    [STUDENT],
  );
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)(
  "PUT /api/calendar/profile — the setup save, against real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
        STUDENT,
        "student@example.test",
      ]);
      // `student_study_profile.student_id` references `public.profiles(id)`, not
      // `auth.users` — the row has to exist or every write here is a 23503.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name)
         VALUES ($1, $2, 'student', 'Sam')`,
        [STUDENT, "student@example.test"],
      );
      app = await buildApp();
    });

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(
        `DELETE FROM public.student_study_profile WHERE student_id = $1`,
        [STUDENT],
      );
    });

    // ── (1) the production 400, reproduced ────────────────────────────────
    it("REFUSES a setup-shaped body with no idempotency_key, and names the field", async () => {
      const res = await request(app)
        .put("/api/calendar/profile")
        .send(setupBody());

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_BODY");
      // The exact `fieldErrors` shape production served. Asserting the KEY rather than the
      // message: the message is copy and may be rewritten, the field name is the contract.
      expect(Object.keys(res.body.error?.details?.fieldErrors ?? {})).toContain(
        "idempotency_key",
      );
      // And nothing was written — which is the half that made this fatal rather than
      // annoying. A new student with no row has no plan and no calendar.
      expect(await profileRows()).toHaveLength(0);
    });

    // ── (2) the same body WITH the key ────────────────────────────────────
    it("ACCEPTS the same body once it carries a key, and the row exists", async () => {
      const res = await request(app)
        .put("/api/calendar/profile")
        .send({ ...setupBody(), idempotency_key: key() });

      expect(res.status).toBe(200);
      const rows = await profileRows();
      expect(rows).toHaveLength(1);
      // Presence before absence: the row holds the student's real answers, not defaults.
      expect(rows[0]!.study_days_mask).toBe(62);
      expect(rows[0]!.daily_minutes).toBe(60);
      // §17.5 / SCL-130: the FIRST write completes setup, whatever it did or did not carry.
      // Without this stamp the read keeps answering `setup_required` and R-08-04 never
      // generates a first plan — the student saves, and the popup reopens forever.
      expect(rows[0]!.setup_completed_at).not.toBeNull();
    });

    // ── (3) replay ────────────────────────────────────────────────────────
    it("the SAME key twice leaves ONE profile", async () => {
      const replayed = key();
      const first = await request(app)
        .put("/api/calendar/profile")
        .send({ ...setupBody(), idempotency_key: replayed });
      const second = await request(app)
        .put("/api/calendar/profile")
        .send({ ...setupBody(), idempotency_key: replayed });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // §4.2: a retried intent is the same intent. One student, one profile row — the
      // table's own primary key settles it, which is why this is asserted against SQL and
      // not against what the service returned.
      expect(await profileRows()).toHaveLength(1);
    });

    // ── (4) the pair the writer dropped ───────────────────────────────────
    it("stores BOTH halves when a student picks a test day", async () => {
      const res = await request(app)
        .put("/api/calendar/profile")
        .send({
          ...setupBody({
            full_length_weekday: 6,
            full_length_interval_weeks: 2,
          }),
          idempotency_key: key(),
        });

      // Before the fix this was a 500: the writer sent only `full_length_weekday`, the
      // interval stayed NULL, and `full_length_pair` rejected the row as 23514, which the
      // service reports as `write_failed`.
      expect(res.status).toBe(200);
      const rows = await profileRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.full_length_weekday).toBe(6);
      expect(rows[0]!.full_length_interval_weeks).toBe(2);
      // The response says the same thing, so a client that never re-reads is not lied to.
      expect(res.body.profile?.full_length_interval_weeks).toBe(2);
    });

    // ── (5) turning exams back off ────────────────────────────────────────
    it("clears BOTH halves when a student turns exams off", async () => {
      await request(app)
        .put("/api/calendar/profile")
        .send({
          ...setupBody({
            full_length_weekday: 6,
            full_length_interval_weeks: 2,
          }),
          idempotency_key: key(),
        });

      // PRESENCE BEFORE ABSENCE. Without this, a first write that stored nothing would make
      // the two `toBeNull()` assertions below pass for the wrong reason — there would be no
      // `6` and no `2` to clear, and the case would read green while proving nothing.
      const before = await profileRows();
      expect(before[0]!.full_length_weekday).toBe(6);
      expect(before[0]!.full_length_interval_weeks).toBe(2);

      // The FULL draft, which is what the settings sheet sends — every field it holds,
      // with the exam pair set to null. Not a two-field body: see the note below.
      const res = await request(app)
        .put("/api/calendar/profile")
        .send({ ...setupBody(), idempotency_key: key() });

      expect(res.status).toBe(200);
      const rows = await profileRows();
      // The mirror of case 4, and the reason it is a separate case: a writer that copied
      // the interval only when truthy would pass case 4 and leave `2` standing here, which
      // `full_length_pair` would then reject in the other direction.
      expect(rows[0]!.full_length_weekday).toBeNull();
      expect(rows[0]!.full_length_interval_weeks).toBeNull();
    });

    // ── (6) Step 4: the 400 says WHICH field, without saying what was in it ──
    /**
     * Two bodies, because Zod reports them through two different mechanisms and only one of
     * them was ever in evidence. A missing required key fails the BASE object parse, and a
     * base failure short-circuits `superRefine` entirely — which is why the production 400
     * named `idempotency_key` alone and nothing else about that body. The second case is a
     * body that gets past the base parse and is refused by the refinements, so the log has
     * to carry SEVERAL field names rather than the first one it meets.
     */
    function rejectionsFrom(
      warn: ReturnType<typeof vi.spyOn>,
    ): { code: string; fields: string[]; method?: string; path?: string }[] {
      return warn.mock.calls
        .filter((call) => call[1] === "request_rejected")
        .map(
          (call) =>
            call[3] as {
              code: string;
              fields: string[];
              method?: string;
              path?: string;
            },
        );
    }

    it("LOGS the rejected field names at WARN, and no values", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        // (a) the production body: the base parse refuses it for the missing key.
        const missingKey = await request(app)
          .put("/api/calendar/profile")
          .send(setupBody());
        expect(missingKey.status).toBe(400);

        let logged = rejectionsFrom(warn);
        // Presence before absence: there IS a log line, before anything asserts what is in
        // it or missing from it.
        expect(logged).toHaveLength(1);
        expect(logged[0]!.code).toBe("INVALID_BODY");
        expect(logged[0]!.fields).toEqual(["idempotency_key"]);
        // It names the route, so a log reader knows which form drifted.
        expect(logged[0]!.method).toBe("PUT");
        expect(logged[0]!.path).toContain("/profile");

        // (b) past the base parse, refused by the refinements — TWO fields, both named.
        warn.mockClear();
        const refused = await request(app)
          .put("/api/calendar/profile")
          .send({
            ...setupBody({
              // A DISTINCTIVE sentinel, not a bare `37`. A two-digit number matches
              // incidental digits anywhere in the serialised call — a requestId, a
              // timestamp, a future field — so the absence assertion below would be
              // satisfiable by accident and could also go red for no defect. A full date
              // string cannot appear inside a uuid or a duration.
              target_exam_date: PAST_DATE_SENTINEL, // refused: in the past
              full_length_weekday: 6, // half a pair: no interval beside it
              full_length_interval_weeks: undefined,
            }),
            idempotency_key: key(),
          });
        expect(refused.status).toBe(400);

        logged = rejectionsFrom(warn);
        expect(logged).toHaveLength(1);
        expect([...logged[0]!.fields].sort()).toEqual([
          "full_length_interval_weeks",
          "target_exam_date",
        ]);

        // §12.1: paths only, on every line. The rejected VALUES are part of the request
        // body, and a log line is not a place for either of them.
        const serialised = JSON.stringify(warn.mock.calls);
        expect(serialised).not.toContain(PAST_DATE_SENTINEL);
        expect(serialised).not.toContain("America/Chicago");
      } finally {
        warn.mockRestore();
      }
    });

    /**
     * A LIMITATION FOUND HERE AND DELIBERATELY NOT FIXED IN THIS CHANGE, recorded so it is
     * not re-discovered as a mystery.
     *
     * `makeStudyProfileUpsertSchema` documents a PARTIAL body — "the settings sheet sends
     * what changed" — and accepts one. `upsertStudyProfile` then writes it with
     * `.upsert(row, { onConflict: "student_id" })`, whose INSERT arm names only the keys the
     * body carried. PostgreSQL checks NOT NULL on that INSERT before it resolves the
     * conflict, so a body omitting `timezone`, `study_days_mask` or `daily_minutes` raises
     * 23502 even when the row already exists and already has them. Confirmed here:
     * `{full_length_weekday: null, full_length_interval_weeks: null, idempotency_key}`
     * against an existing profile answers 500, not 200.
     *
     * It is not reachable from any shipped surface — both writers (the §17.5 popup and the
     * §8.1 sheet) send the full field set — which is why it is reported rather than fixed
     * alongside a production stoppage. The fix is an UPDATE when a row exists rather than an
     * upsert of a partial row, and it belongs to its own change with its own denial tests.
     */
  },
);
