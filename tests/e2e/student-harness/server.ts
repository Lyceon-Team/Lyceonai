/**
 * Student screenshot harness server.
 *
 * @spec [student-UI register §6 Wave 5 (side-by-side screenshots for every page PR); the E7b
 *        harness pattern (owner ruling 6: real routers, real SQL, real client, nothing under
 *        server/ importing it)] | @implemented [2026-10-03]
 *
 * plain English: the exam harness generalised to the student app. It mounts the REAL routers
 * the student pages read (profile, practice, review, full-length, calendar, progress,
 * notifications, billing, students, guardian) as server/index.ts mounts them, over a throwaway
 * database built from this repo's migrations (db.ts). The substitutions are the exam harness's
 * module hooks minus one: the Supabase clients go to this Postgres and the auth guards to the
 * exam harness stub, but the EntitlementService is the PRODUCTION one, so free and paid (and
 * the profile's feature-access map that draws the rail locks) come from real `entitlements`
 * rows. Who is signed in comes from the `x-harness-as` header (personas.ts); the user object is
 * read from `profiles` the way the real auth middleware builds it.
 *
 * After it listens it seeds practice history through the real practice routes (seed.ts) and
 * prints one `student harness ready <json>` line carrying the seeded ids, which capture.ts reads.
 *
 * NOT a server mode: nothing under server/ or client/ imports this directory, it is reachable
 * only through `--import ./tests/e2e/student-harness/register.mjs`, and it refuses to start
 * with NODE_ENV=production.
 *
 * run: pnpm exec tsx --import ./tests/e2e/student-harness/register.mjs tests/e2e/student-harness/server.ts
 * (capture.ts starts it for you; see README.md)
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { setHarnessPg } from "../exam-harness/pg";
import { buildStudentHarnessDb } from "./db";
import { isStudentPersona, PERSONA_HEADER, PERSONAS } from "./personas";
import { seedPracticeHistory } from "./seed";

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "the student screenshot harness never runs with NODE_ENV=production",
  );
}

const PORT = Number(process.env.HARNESS_PORT ?? "5056");

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: "student" | "admin" | "guardian";
  is_under_13: boolean | null;
  profile_completed_at: string | null;
  actor_id: string;
};

async function main(): Promise<void> {
  const pg = await buildStudentHarnessDb();
  setHarnessPg(pg);

  const auth = await import("../../../server/middleware/supabase-auth");
  const { default: profileRoutes } =
    await import("../../../server/routes/profile-routes");
  const { default: practiceRouter } =
    await import("../../../server/routes/practice-canonical");
  const { default: reviewRouter } =
    await import("../../../server/routes/review-canonical");
  const { default: diagnosticRouter } =
    await import("../../../server/routes/diagnostic-routes");
  const { getPracticeTopics, getPracticeQuestions } =
    await import("../../../server/routes/practice-topics-routes");
  const { default: examRuntimeRouter } =
    await import("../../../server/routes/exam-runtime-routes");
  const { default: examReportRouter } =
    await import("../../../server/routes/exam-report-routes");
  const { calendarRouter, streakRouter } =
    await import("../../../server/routes/calendar-routes");
  const { scoreReportRouter } =
    await import("../../../server/routes/score-report-routes");
  const { getScoreEstimate, getRecencyKpis } =
    await import("../../../server/routes/legacy/progress");
  const { default: notificationsRouter } =
    await import("../../../server/routes/notifications");
  const { NOTIFICATION_API_MOUNT } =
    await import("../../../packages/shared/src/notifications-schema");
  const { default: studentResourcesRouter } =
    await import("../../../server/routes/student-resources");
  const { default: guardianRouter } =
    await import("../../../server/routes/guardian-routes");
  const { default: billingRoutes } =
    await import("../../../server/routes/billing-routes");
  const { default: accountRoutes } =
    await import("../../../server/routes/account-routes");
  const { legalRouter } = await import("../../../server/routes/legal-routes");

  const app = express();
  app.use(express.json());
  // The same global limiter, with the same values, that server/index.ts mounts before every
  // route, so the harness's persona lookup and routes sit behind it as production's do.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // The persona, read from `profiles` as the real supabaseAuthMiddleware builds req.user. No
  // header (or `signed-out`) leaves req.user unset, so every guarded route answers 401.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { requestId: string }).requestId =
      `student-harness-${Date.now()}`;
    const as = req.header(PERSONA_HEADER);
    if (!isStudentPersona(as)) return next();
    pg.query<ProfileRow>(
      `SELECT id, email, display_name, role, is_under_13, profile_completed_at, actor_id
         FROM public.profiles WHERE id = $1`,
      [PERSONAS[as].id],
    ).then((r: { rows: ProfileRow[] }) => {
      const row = r.rows[0];
      if (!row) return next(new Error(`persona ${as} has no profile row`));
      (req as unknown as { user: unknown }).user = {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        isAdmin: false,
        isGuardian: false,
        is_under_13: row.is_under_13 ?? undefined,
        profile_completed_at: row.profile_completed_at,
        actor_id: row.actor_id,
      };
      return next();
    }, next);
  });

  // The client fetches a CSRF token before any write; CSRF itself is outside this harness.
  app.get("/api/csrf-token", (_req, res) =>
    res.json({ csrfToken: "student-harness" }),
  );

  // Mounted in server/index.ts's order and with its guard chains (the guards are the stub's).
  app.use("/api/legal", auth.requireSupabaseAuth, legalRouter);
  app.use("/api/profile", auth.requireSupabaseAuth, profileRoutes);
  app.use(
    NOTIFICATION_API_MOUNT,
    auth.requireSupabaseAuth,
    notificationsRouter,
  );
  app.use("/api/students", auth.requireSupabaseAuth, studentResourcesRouter);
  app.use(
    "/api/calendar",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    calendarRouter,
  );
  app.use(
    "/api/me",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    streakRouter,
  );
  app.use(
    "/api/score-report",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    scoreReportRouter,
  );
  app.get(
    "/api/progress/projection",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    getScoreEstimate,
  );
  app.get(
    "/api/progress/kpis",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    getRecencyKpis,
  );
  app.use("/api/guardian", auth.requireSupabaseAuth, guardianRouter);
  app.use("/api/billing", billingRoutes);
  app.use("/api/account", accountRoutes);
  app.get(
    "/api/practice/topics",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    getPracticeTopics,
  );
  app.get(
    "/api/practice/reference/questions",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    getPracticeQuestions,
  );
  app.use(
    "/api/practice/diagnostic",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    diagnosticRouter,
  );
  app.use(
    "/api/practice",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    practiceRouter,
  );
  app.use(
    "/api/tests",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    examRuntimeRouter,
  );
  app.use(
    "/api/tests",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    examReportRouter,
  );
  app.use(
    "/api/review",
    auth.requireSupabaseAuth,
    auth.requireStudentOrAdmin,
    reviewRouter,
  );

  // Anything else the client asks for is outside this harness; capture.ts lists each miss.
  app.use("/api", (req, res) => {
    // eslint-disable-next-line no-console -- harness diagnostics: which endpoints a page wanted
    console.log(`student harness: not served ${req.method} ${req.path}`);
    res.status(404).json({
      error: {
        code: "not_in_student_harness",
        message: "Not served by the student harness.",
      },
    });
  });

  const server = app.listen(PORT, () => {
    void seedPracticeHistory(`http://localhost:${PORT}`).then(
      (seeded) => {
        // eslint-disable-next-line no-console -- the readiness line capture.ts waits for
        console.log(`student harness ready ${JSON.stringify(seeded)}`);
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console -- a failed seed must stop the run, loudly
        console.error("student harness seed failed:", err);
        server.close();
        process.exit(1);
      },
    );
  });
}

void main();
