/**
 * /api/sat-dates — the SAT-date bound every picker reads.
 *
 * @spec [owner rulings (Karl): 2026-10-11 on #1204 ruling 2 ("every SAT-date picker
 *       (onboarding, Settings, Home card, calendar) uses that one bound"); 2026-10-12 on #1211
 *       ("Serve the test-date bound from a role-agnostic read: any signed-in account (including
 *       one whose role isn't saved yet) can read latest_test_date. Use the account's stored
 *       timezone if present, else America/Chicago. Same shared helper as the save … It carries
 *       no student data, so it doesn't need the student-only gate. The student-only calendar
 *       profile routes stay student-only."); Coding Standards §8.1, §8.2] | @implemented
 *       [2026-10-12]
 *
 * plain English:
 *   GET /bound   200 { latest_test_date, requestId }: the furthest test date
 *                `PUT /api/calendar/profile` accepts for the signed-in account right now.
 *                401 without a session. Nothing else is served.
 *
 * Mounted behind `requireSupabaseAuth` only (server/index.ts), NOT `requireStudentOrAdmin`: a
 * guardian-intent account that switches to Student at onboarding is still a guardian in the
 * database until onboarding saves, and its picker must still offer the dates. That is safe
 * because the body is one configuration-derived date, built from the `.strict()`
 * `satDateBoundResponseSchema`: no profile value can be spread into it. The subject is the
 * session's own account id, never a parameter, so the read cannot be pointed at anyone else
 * (and a guardian's own id has no study profile, so it reads the Chicago bound).
 */
import { Router, type Request, type Response } from "express";
import { satDateBoundResponseSchema } from "../../packages/shared/src/calendar/api";
import { logger } from "../logger";
import { readSatDateBound } from "../services/calendar/profile-service";

export const satDateRouter = Router();

function sendServerError(
  res: Response,
  requestId: string | undefined,
  error: unknown,
): Response {
  logger.error(
    "SAT_DATES",
    "bound_read_failed",
    "the SAT-date bound read failed",
    {
      requestId,
      reason: error instanceof Error ? error.message : "unknown",
    },
  );
  return res.status(500).json({
    error: { message: "Something went wrong.", code: "SAT_DATES_ERROR" },
    requestId,
  });
}

satDateRouter.get("/bound", async (req: Request, res: Response) => {
  const user = req.user;
  if (user === undefined) {
    return res.status(401).json({
      error: { message: "Sign in to continue.", code: "UNAUTHENTICATED" },
      requestId: req.requestId,
    });
  }
  try {
    const body = satDateBoundResponseSchema.safeParse(
      await readSatDateBound(user.id, req.requestId),
    );
    if (!body.success) {
      return sendServerError(
        res,
        req.requestId,
        new Error("sat_date_bound_shape_unexpected"),
      );
    }
    return res.status(200).json({ ...body.data, requestId: req.requestId });
  } catch (error) {
    return sendServerError(res, req.requestId, error);
  }
});
