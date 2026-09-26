/**
 * E7b exam e2e harness server.
 *
 * @spec [E7b owner ruling 6: "Auth stubbed to one student, real routers, real SQL,
 *        real client, nothing under server/ importing it. Confirm the stub can't be
 *        reached from a production build."]
 * @implemented [2026-09-25]
 *
 * plain English: mounts the REAL /api/tests routers (runtime + 04C report) and, since E9b,
 * the REAL /api/calendar and /api/me routers, over a throwaway database built from this
 * repo's migrations. The only substitutions are
 * the four imports in hooks.mjs (Supabase clients -> this Postgres; auth guards and
 * entitlement -> one fixed student). The real client runs unmodified under Vite and
 * reaches this server through Vite's /api proxy; it learns who is signed in from
 * /api/profile, which this server answers for the fixed student.
 *
 * NOT a server mode: nothing under server/ or client/ imports this directory, the
 * production bundle cannot contain it (scripts/ci/exam-harness-isolation.sh), and it
 * refuses to start with NODE_ENV=production.
 *
 * run:  PGHOST=localhost PGPORT=54331 pnpm exec tsx --import ./tests/e2e/exam-harness/register.mjs tests/e2e/exam-harness/server.ts
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { buildHarnessDb, STUDENT_ID } from "./db";
import { setHarnessPg } from "./pg";

if (process.env.NODE_ENV === "production") {
  throw new Error("the exam e2e harness never runs with NODE_ENV=production");
}

const PORT = Number(process.env.HARNESS_PORT ?? "5055");

async function main(): Promise<void> {
  const pg = await buildHarnessDb();
  setHarnessPg(pg);

  const { default: runtimeRouter } = await import("../../../server/routes/exam-runtime-routes");
  const { default: reportRouter } = await import("../../../server/routes/exam-report-routes");
  const { calendarRouter, streakRouter } = await import("../../../server/routes/calendar-routes");

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: STUDENT_ID, actor_id: STUDENT_ID, role: "student" };
    (req as unknown as { requestId: string }).requestId = `e2e-${Date.now()}`;
    next();
  });
  // The client's auth context and RequireRole read these two and nothing else.
  app.get("/api/csrf-token", (_req, res) => res.json({ csrfToken: "e2e-harness" }));
  app.get("/api/profile", (_req, res) =>
    res.json({
      authenticated: true,
      user: {
        id: STUDENT_ID,
        email: "student@example.test",
        display_name: "Sam Rivera",
        role: "student",
        is_under_13: false,
        guardian_consent: true,
        profileCompletedAt: "2026-09-01T00:00:00Z",
        requiredProfileComplete: true,
        guardianConsentRequired: false,
        outstandingLegal: [],
      },
    }),
  );
  app.use("/api/tests", runtimeRouter);
  app.use("/api/tests", reportRouter);
  // E9b: the calendar a full-length block is launched from (Doc 05F §15, §9.4).
  app.use("/api/calendar", calendarRouter);
  app.use("/api/me", streakRouter);
  // Anything else the app shell asks for is outside this harness.
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_in_harness", message: "Not served by the exam harness." } }));

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console -- harness startup line
    console.log(`exam e2e harness listening on :${PORT}`);
  });
}

void main();
