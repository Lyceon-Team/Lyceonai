/**
 * Settings → Profile background, and the college / high-school search behind its pickers.
 *
 * @spec [SCL-195 (PROPOSED); Brief 8 rulings 1 and 3 (owner, 2026-10-01); Doc 01A Part V §39–§47
 *        (RateLimitLedger; §44 the 429 shape); Coding Standards §8.1 (auth → entitlement → parse →
 *        domain → serialize), §8.3] | @implemented [2026-10-01]
 *
 * plain English:
 *   GET  /api/profile/background        the student's own background, references resolved
 *   PUT  /api/profile/background        a partial update; the response is what is now stored
 *   GET  /api/reference/colleges?q=     up to 20 colleges whose name contains q (≥ 2 chars)
 *   GET  /api/reference/high-schools?q= the same, for high schools
 *
 * Gating, by ruling: the background is student-only (`requireStudentAccount` at the mount) and
 * carries NO entitlement check — it is the student's own profile, not a paid feature. The search
 * is for signed-in student accounts (also `requireStudentAccount` at the mount: the ruling says
 * "authenticated", narrowed because only student surfaces use the pickers — register UI-S3), and
 * rate-limited through the ledger's `reference_search` bucket.
 *
 * Expected outcome: Settings and the calendar's dream-school picker share this one write path.
 * Edge cases: an unknown or retired reference id is a 400 with a code; a failed write is a 500;
 * the payload is parsed by the `.strict()` shared schema inside the service, so nothing beyond the
 * documented fields can reach the client.
 */
import {
  makeStudentBackgroundUpdateSchema,
  referenceSearchQuerySchema,
} from "@lyceon/shared";
import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { singleBucketRateLimit } from "../middleware/rate-limit";
import {
  readStudentBackground,
  saveStudentBackground,
  searchReference,
  type ReferenceKind,
} from "../services/student-background";

/** Doc 01A §39–§47: one bucket for both pickers, seeded by 20261016000000. */
export const REFERENCE_SEARCH_BUCKET = "reference_search";

function studentIdOf(req: Request, res: Response): string | null {
  const id = req.user?.id;
  if (!id) {
    // The mount's auth gate makes this unreachable; failing closed is the answer if it is not.
    res
      .status(401)
      .json({ error: "Authentication required", requestId: req.requestId });
    return null;
  }
  return id;
}

function serverError(
  res: Response,
  event: string,
  error: unknown,
  requestId: string | undefined,
): Response {
  logger.error(
    "STUDENT_BACKGROUND",
    event,
    "Student background request failed",
    {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
    },
  );
  return res.status(500).json({
    error: { message: "Something went wrong. Please try again." },
    requestId,
  });
}

export const studentBackgroundRouter = Router();

studentBackgroundRouter.get("/", async (req: Request, res: Response) => {
  const studentId = studentIdOf(req, res);
  if (studentId === null) return;
  try {
    const background = await readStudentBackground(studentId);
    return res.status(200).json({ ...background, requestId: req.requestId });
  } catch (error) {
    return serverError(res, "read_failed", error, req.requestId);
  }
});

studentBackgroundRouter.put("/", async (req: Request, res: Response) => {
  const studentId = studentIdOf(req, res);
  if (studentId === null) return;

  const parsed = makeStudentBackgroundUpdateSchema(
    new Date().getUTCFullYear(),
  ).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        message: "Invalid background",
        code: "INVALID_BACKGROUND",
        details: parsed.error.flatten(),
      },
      requestId: req.requestId,
    });
  }

  try {
    const result = await saveStudentBackground(
      studentId,
      parsed.data,
      req.requestId,
    );
    if (!result.ok) {
      if (result.error.kind === "invalid_reference") {
        return res.status(400).json({
          error: {
            message: "That school isn't in our list.",
            code: result.error.code,
          },
          requestId: req.requestId,
        });
      }
      return res.status(500).json({
        error: { message: "Something went wrong. Please try again." },
        requestId: req.requestId,
      });
    }
    return res.status(200).json({ ...result.value, requestId: req.requestId });
  } catch (error) {
    return serverError(res, "save_failed", error, req.requestId);
  }
});

export const referenceSearchRouter = Router();

const referenceSearchRateLimit = singleBucketRateLimit(
  REFERENCE_SEARCH_BUCKET,
  "reference_search",
);

function searchHandler(kind: ReferenceKind) {
  return async (req: Request, res: Response): Promise<Response> => {
    const parsed = referenceSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          message: "Search needs at least 2 characters.",
          code: "INVALID_SEARCH",
          details: parsed.error.flatten(),
        },
        requestId: req.requestId,
      });
    }
    try {
      const results = await searchReference(kind, parsed.data.q);
      return res.status(200).json({ results, requestId: req.requestId });
    } catch (error) {
      return serverError(res, "search_failed", error, req.requestId);
    }
  };
}

referenceSearchRouter.get(
  "/colleges",
  referenceSearchRateLimit,
  searchHandler("colleges"),
);
referenceSearchRouter.get(
  "/high-schools",
  referenceSearchRateLimit,
  searchHandler("high_schools"),
);
