/**
 * Public Question of the Day API — no login.
 *
 *   GET  /api/public/qotd/today          today's question, answer and explanation null
 *   GET  /api/public/qotd/archive        the past days (date, section, domain) for the hub
 *   GET  /api/public/qotd/:date          a PAST day, with answer + explanation (the archive)
 *   POST /api/public/qotd/today/answer   grade, count once per hashed IP per day, reveal
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16 (anyone, no login), R17 (reveal on submit,
 *       no quota charge, aggregate stats, "N% answered correctly" at >= 5 attempts), R18, R19, R20a,
 *       Q2; SCL-202 (Turnstile on submit before any other work; HMAC-IP ledger); Coding Standards
 *       §5.2, §7.1, §8.1-§8.3, §12.1; owner Step 0 decisions 2026-10-05 (no CSRF: no ambient
 *       credential is used and Turnstile gates the write; future dates 404)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the handlers are thin — limiter / Turnstile, Zod parse, the service in
 * server/services/qotd/qotd-service.ts, and a response parsed against the strict schema in
 * packages/shared/src/qotd-schema.ts. Nothing here reads `req.user`, writes a practice quota row,
 * or logs the submitted answer (student answers are never logged, Coding Standards §12.1).
 *
 * Future days: the database function returns nothing for them, and `/:date` additionally refuses
 * today and later, so a date is readable here only once it has passed. Today's answer is reachable
 * only through a Turnstile-verified submit.
 */
import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { verifyTurnstile } from "../lib/turnstile";
import {
  anonymousBucketRateLimit,
  applyRateLimitHeaders,
  checkAnonymousBucket,
  denyRateLimited,
} from "../middleware/rate-limit";
import { RateLimitUnavailableError } from "../../packages/shared/src/services/rate-limit-ledger";
import {
  qotdDateSchema,
  qotdStat,
  qotdSubmitRequestSchema,
  qotdSubmitResponseSchema,
} from "../../packages/shared/src/qotd-schema";
import {
  gradeQotd,
  qotdDayWindow,
  qotdToday,
  QotdUnavailableError,
  readQotd,
  isPublishableArchiveRow,
  readQotdArchive,
  toArchiveIndexResponse,
  toArchiveResponse,
  toTodayResponse,
  type QotdDbClient,
} from "../services/qotd/qotd-service";

const router = Router();
const db = (): QotdDbClient => supabaseServer as unknown as QotdDbClient;

function errorBody(
  code: string,
  message: string,
  requestId: string | undefined,
): { error: { code: string; message: string }; requestId: string | undefined } {
  return { error: { code, message }, requestId };
}

function unavailable(
  res: Response,
  req: Request,
  operation: string,
  reason: string,
): void {
  logger.error("QOTD", operation, "QOTD request failed", {
    requestId: req.requestId,
    reason,
  });
  res
    .status(503)
    .json(
      errorBody(
        "qotd_unavailable",
        "The question of the day is temporarily unavailable.",
        req.requestId,
      ),
    );
}

router.get(
  "/today",
  anonymousBucketRateLimit("qotd_read_ip", "qotd_read"),
  async (req: Request, res: Response) => {
    try {
      const row = await readQotd(db(), null);
      if (!row) {
        return res
          .status(404)
          .json(
            errorBody(
              "qotd_not_scheduled",
              "There is no question today yet.",
              req.requestId,
            ),
          );
      }
      // Owner ruling 2026-10-05: every response carries its own shuffle, so nothing may cache it.
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ data: toTodayResponse(row) });
    } catch (err: unknown) {
      return unavailable(
        res,
        req,
        "read_today",
        err instanceof QotdUnavailableError ? "db" : "error",
      );
    }
  },
);

// Registered before "/:date", which would otherwise take "archive" as a (malformed) date.
router.get(
  "/archive",
  anonymousBucketRateLimit("qotd_read_ip", "qotd_read"),
  async (req: Request, res: Response) => {
    try {
      const rows = await readQotdArchive(db());
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json({ data: toArchiveIndexResponse(rows) });
    } catch (err: unknown) {
      return unavailable(
        res,
        req,
        "read_archive_index",
        err instanceof QotdUnavailableError ? "db" : "error",
      );
    }
  },
);

router.get(
  "/:date",
  anonymousBucketRateLimit("qotd_read_ip", "qotd_read"),
  async (req: Request, res: Response) => {
    const parsed = qotdDateSchema.safeParse(req.params.date);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          errorBody(
            "invalid_date",
            "Use a date in the form YYYY-MM-DD.",
            req.requestId,
          ),
        );
    }
    // Only a day that has passed is an archive day. Today is answered via /today (no answer);
    // a future day does not exist yet.
    if (parsed.data >= qotdToday()) {
      return res
        .status(404)
        .json(errorBody("not_found", "Not found.", req.requestId));
    }
    try {
      const row = await readQotd(db(), parsed.data);
      // A withheld day (no question prompt; owner 2026-10-08) is not found, like a missing one.
      if (!row || !isPublishableArchiveRow(row)) {
        return res
          .status(404)
          .json(errorBody("not_found", "Not found.", req.requestId));
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json({ data: toArchiveResponse(row) });
    } catch (err: unknown) {
      return unavailable(
        res,
        req,
        "read_archive",
        err instanceof QotdUnavailableError ? "db" : "error",
      );
    }
  },
);

// CSRF_EXEMPT_REASON: unauthenticated; no cookie or session is read, so there is no ambient credential to forge; Turnstile-gated (SCL-202; owner Step 0 2026-10-05).
router.post("/today/answer", async (req: Request, res: Response) => {
  const requestId = req.requestId;

  // 1. Turnstile, before any other work (SCL-202 item 2).
  const body: unknown = req.body;
  const token =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).turnstile_token === "string"
      ? ((body as Record<string, unknown>).turnstile_token as string)
      : undefined;
  const turnstile = await verifyTurnstile(token);
  if (turnstile.outcome === "unavailable") {
    return unavailable(res, req, "turnstile", turnstile.reason);
  }
  if (turnstile.outcome === "reject") {
    return res
      .status(403)
      .json(
        errorBody(
          "turnstile_failed",
          "Please complete the check and try again.",
          requestId,
        ),
      );
  }

  // 2. The hashed-IP submit limiter.
  try {
    const limit = await checkAnonymousBucket(req, "qotd_submit_ip");
    applyRateLimitHeaders(res, limit);
    if (!limit.allowed) {
      denyRateLimited(res, "qotd_submit_ip", limit, requestId);
      return;
    }
  } catch (err: unknown) {
    return unavailable(
      res,
      req,
      "submit_limit",
      err instanceof RateLimitUnavailableError ? "limiter" : "error",
    );
  }

  // 3. Parse.
  const parsed = qotdSubmitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "invalid_input",
        message: "Invalid input",
        details: parsed.error.flatten(),
      },
      requestId,
    });
  }
  const today = qotdToday();
  if (parsed.data.qotd_date !== today) {
    return res
      .status(409)
      .json(
        errorBody(
          "qotd_day_changed",
          "A new question is up. Reload to see it.",
          requestId,
        ),
      );
  }

  try {
    // 4. Grade with the shared grader.
    const row = await readQotd(db(), today);
    if (!row) {
      return res
        .status(404)
        .json(
          errorBody(
            "qotd_not_scheduled",
            "There is no question today yet.",
            requestId,
          ),
        );
    }
    const graded = gradeQotd(row, parsed.data.answer);
    if (!graded.ok) {
      return res
        .status(graded.status)
        .json(errorBody(graded.error, graded.message, requestId));
    }

    // 5. Count the first submit per hashed IP per Chicago day; later submits are graded and
    //    revealed but not counted. A limiter failure means "not counted", never a block.
    let attempts = row.attempts ?? 0;
    let correct = row.correct ?? 0;
    let countable = false;
    try {
      countable = (
        await checkAnonymousBucket(req, "qotd_stat_ip", qotdDayWindow(today))
      ).allowed;
    } catch (err: unknown) {
      logger.warn(
        "QOTD",
        "stat_limit",
        "Stat bucket unavailable; attempt not counted",
        {
          requestId,
          reason:
            err instanceof RateLimitUnavailableError ? "limiter" : "error",
        },
      );
    }
    if (countable) {
      // A counter failure never costs the visitor the reveal: they are graded and shown the
      // answer, and the attempt is simply not counted (the same rule as a limiter failure
      // above). This also absorbs a submit that crosses Chicago midnight, where the database's
      // own day has moved on and qotd_record_attempt refuses the date (22023).
      const { data, error } = await db().rpc("qotd_record_attempt", {
        p_date: today,
        p_correct: graded.isCorrect,
      });
      if (error) {
        logger.warn("QOTD", "record_attempt", "Attempt not counted", {
          requestId,
          reason: "db",
        });
      } else {
        const counted = Array.isArray(data)
          ? (data[0] as Record<string, unknown> | undefined)
          : undefined;
        if (counted) {
          attempts = Number(counted.attempts ?? attempts);
          correct = Number(counted.correct ?? correct);
        }
      }
    }

    // 6. Reveal, parsed against the strict schema.
    const response = qotdSubmitResponseSchema.parse({
      qotd_date: today,
      is_correct: graded.isCorrect,
      // The correct option's TOKEN, so the browser marks it in the visitor's own order.
      correct_option_id: graded.correctOptionId,
      correct_answer: row.item_type === "grid_in" ? row.correct_answer : null,
      explanation: row.explanation ?? "",
      stats: qotdStat(attempts, correct),
    });
    return res.json({ data: response });
  } catch (err: unknown) {
    return unavailable(
      res,
      req,
      "submit",
      err instanceof QotdUnavailableError ? "db" : "error",
    );
  }
});

export default router;
