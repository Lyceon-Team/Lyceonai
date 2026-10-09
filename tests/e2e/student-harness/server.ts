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
import {
  applyQuotaConfig,
  buildStudentHarnessDb,
  seedPaidNotifications,
} from "./db";
import {
  BARE_PAGE_PERSONAS,
  isBarePagePersona,
  isStudentPersona,
  PERSONA_HEADER,
  PERSONAS,
} from "./personas";
import {
  seedBarePagePersonas,
  seedLisaHistory,
  seedPracticeHistory,
} from "./seed";

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "the student screenshot harness never runs with NODE_ENV=production",
  );
}

const PORT = Number(process.env.HARNESS_PORT ?? "5056");

/**
 * UI-59 (`seed: "bare-pages"`): the bare-card pages' personas exist, and the account-deletion
 * lifecycle flag is on in THIS process, as it is wherever the pending-deletion screen can be
 * reached in production (`isDeletionLifecycleV2Enabled`, server/lib/account-deletion-execute.ts):
 * without it `/api/profile` never reports `pendingDeletion`. The deletion routes are mounted as
 * server/index.ts mounts them, so the recovery page's request reaches the real route. Off in
 * every other run, so their pages and payloads do not change.
 */
const BARE_PAGES = process.env.STUDENT_HARNESS_SEED === "bare-pages";
if (BARE_PAGES) process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";
// The Home QOTD's option tokens are an HMAC under the public secret (option-tokens.ts); a
// throwaway value here, never a real one.
process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET ??= "student-harness-only";

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
  // SEO Wave 2, plan Q6: the review prompt, reviews and feedback (server/index.ts mounts it
  // with the same auth guard).
  const { default: productFeedbackRoutes } =
    await import("../../../server/routes/product-feedback-routes");
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
  const { calendarRouter } =
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
  const accountDeletionRoutes = BARE_PAGES
    ? (await import("../../../server/routes/account-deletion-routes")).default
    : null;
  const { legalRouter } = await import("../../../server/routes/legal-routes");
  const { default: homeQotdRoutes } =
    await import("../../../server/routes/home-qotd-routes");
  const { default: tutorRuntimeRouter } =
    await import("../../../server/routes/tutor-runtime");
  const { TutorConfig } = await import("../../../server/services/tutor-config");
  // As server/index.ts: the tutor's runtime config, read once from this database.
  await TutorConfig.bootLoad();

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
    // UI-59: the bare-page personas exist only in a `bare-pages` run (db.ts).
    const personaId = isStudentPersona(as)
      ? PERSONAS[as].id
      : isBarePagePersona(as) && BARE_PAGES
        ? BARE_PAGE_PERSONAS[as].id
        : null;
    if (personaId === null) return next();
    pg.query<ProfileRow>(
      `SELECT id, email, display_name, role, is_under_13, profile_completed_at, actor_id
         FROM public.profiles WHERE id = $1`,
      [personaId],
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
  app.use("/api/feedback", auth.requireSupabaseAuth, productFeedbackRoutes);
  // Owner brief "Question of the Day on Home" (2026-10-08/09): as server/index.ts mounts it.
  app.use(
    "/api/qotd",
    auth.requireSupabaseAuth,
    auth.requireStudentAccount,
    homeQotdRoutes,
  );
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
  if (accountDeletionRoutes) app.use("/api/account", accountDeletionRoutes);
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
  // UI-56: LISA. A tutor TURN is never served here: `POST /api/tutor/messages` calls the model
  // (the tutor orchestrator) and Google's safety services, and this harness reaches neither. It
  // is refused before the router; the typing-state capture holds the browser's request instead
  // (capture.ts `holdRequest`), so it never arrives. Every other tutor route (list, detail,
  // create, end) is the real router, behind the stub's guards.
  app.post("/api/tutor/messages", (_req: Request, res: Response) => {
    res.status(503).json({
      error: {
        code: "not_in_student_harness",
        message: "The student harness never runs a tutor turn.",
      },
    });
  });
  app.use(
    "/api/tutor",
    auth.requireSupabaseAuth,
    auth.requireStudentOnly,
    tutorRuntimeRouter,
  );

  // Anything else the client asks for is outside this harness; capture.ts lists each miss.
  app.use("/api", (req, res) => {
    console.log(`student harness: not served ${req.method} ${req.path}`);
    res.status(404).json({
      error: {
        code: "not_in_student_harness",
        message: "Not served by the student harness.",
      },
    });
  });

  const server = app.listen(PORT, () => {
    void seedPracticeHistory(`http://localhost:${PORT}`, {
      // capture.ts passes the group's `seed` (groups/types.ts); only UI-52 asks for this.
      reviewHistory: process.env.STUDENT_HARNESS_SEED === "review-history",
      // UI-54: a scored and an in-progress full-length test for the paid student.
      examHistory: process.env.STUDENT_HARNESS_SEED === "exam-history",
      // UI-55: the paid student's SAT date inside the current week (the starred test day).
      calendarGoal: process.env.STUDENT_HARNESS_SEED === "calendar-goal",
    })
      .then(async (seeded) => {
        // UI-56: the paid student's LISA history (seed.ts `seedLisaHistory`).
        if (process.env.STUDENT_HARNESS_SEED === "lisa-history") {
          seeded.paid.lisaConversationId = await seedLisaHistory(
            `http://localhost:${PORT}`,
            pg,
          );
        }
        // UI-59: the bare-page personas' current legal acceptance (seed.ts).
        if (BARE_PAGES) await seedBarePagePersonas(`http://localhost:${PORT}`);
        // QA 2026-10-07 (UI-41): unread in-app notifications for the paid student (db.ts).
        if (process.env.STUDENT_HARNESS_SEED === "notifications")
          await seedPaidNotifications(pg);
        // W6 UI-64: non-default practice config (db.ts `applyQuotaConfig`), after the base
        // seed; then the practice config cache (30 s, practice-canonical.ts) is waited out.
        if (process.env.STUDENT_HARNESS_SEED === "quota-config") {
          await applyQuotaConfig(pg);
          await new Promise((resolve) => setTimeout(resolve, 31_000));
        }
        return seeded;
      })
      .then(
        (seeded) => {
          console.log(`student harness ready ${JSON.stringify(seeded)}`);
        },
        (err: unknown) => {
          console.error("student harness seed failed:", err);
          server.close();
          process.exit(1);
        },
      );
  });
}

void main();
