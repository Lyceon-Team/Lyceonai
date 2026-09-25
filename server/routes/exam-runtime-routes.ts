/**
 * Full-length exam runtime API — /api/tests/*
 *
 * @spec [Doc-04A_V2.2, §16 (surface), §16.1 (precondition order), §16.2 (codes),
 *        §7.3, §8.3, §8.5, §10.1, §11.2, §12, §15.1; Coding Standards §8.1 (thin
 *        handlers: auth -> entitlement -> Zod -> domain -> serialize), §8.2]
 *       [E6 rulings: no admin surface; entitlement = exam_full_length via
 *        EntitlementService.canAccessFeature; Module 2 addressed as '2' (SCL-132)]
 * @implemented [2026-09-24]
 *
 * plain English: the seven student endpoints of 04A §16, plus E7a's three
 * (GET /forms — SCL-147; GET and PUT the module workspace — SCL-145), and nothing
 * else — no form publish, no report (04C's own router), no outbox re-drive. Every handler runs, in this order:
 *   1. auth       — req.user from supabaseAuthMiddleware (mount also requires it);
 *   2. entitlement — canAccessFeature(user.id, 'exam_full_length'), 403 forbidden;
 *   3. Zod        — params and body through the shared schemas, 400 invalid_request;
 *   4. domain     — one exam-runtime-service call (session ownership, grace, state
 *                   and timing are decided in SQL, by server time);
 *   5. serialize  — 04A's body on success, {error:{code,message,details?}} on refusal.
 *
 * trade-offs: canAccessFeature checks tier + enabled only; Doc 01 §27.3's age,
 * country and abuse steps are not implemented there and are not added here. No
 * quota is enforced: usage_rate_limit_ledger accepts scope full_length but
 * rate_limit_runtime_config has no exam key, so any number would be invented.
 */
import { Router, type Request, type Response } from "express";
import type { ZodTypeAny, z } from "zod";
import {
  requireProfileComplete,
  requireConsentCompliance,
} from "../middleware/supabase-auth.js";
import { logger } from "../logger";
import { EntitlementService } from "../services/entitlement-service";
import {
  EXAM_FEATURE_KEY,
  createExamSession,
  listExamForms,
  listExamModuleItems,
  readModuleWorkspace,
  readExamSessionState,
  recordExamHeartbeat,
  saveItemWorkspace,
  startExamModule,
  submitExamAnswer,
  submitExamModule,
  type ExamFailure,
  type ExamResult,
} from "../services/exam-runtime-service";
import {
  examAnswerRequestSchema,
  examCreateSessionRequestSchema,
  examHeartbeatRequestSchema,
  examModuleParamsSchema,
  examSectionParamsSchema,
  examSessionParamsSchema,
  examWorkspaceSaveRequestSchema,
} from "../../packages/shared/src/exam-runtime-schema";

// Defined beside the service so a non-route caller (the calendar adapter) reads the same
// key without importing this router; re-exported so existing importers are unchanged.
export { EXAM_FEATURE_KEY };
const COMPONENT = "EXAM_ROUTES";

const router = Router();

// ── Response helpers (§8.2) ─────────────────────────────────────────────────

function sendFailure(
  res: Response,
  failure: ExamFailure,
  requestId: string | undefined,
): Response {
  return res.status(failure.status).json({
    error:
      failure.details === undefined
        ? { code: failure.code, message: failure.message }
        : {
            code: failure.code,
            message: failure.message,
            details: failure.details,
          },
    requestId,
  });
}

function sendResult<T>(
  res: Response,
  result: ExamResult<T>,
  requestId: string | undefined,
): Response {
  if (!result.ok) return sendFailure(res, result.error, requestId);
  return res.status(result.status).json(result.value);
}

/** The only 500 in this file. The caught value is classified, never spread. */
function sendServerError(
  res: Response,
  operation: string,
  error: unknown,
  requestId: string | undefined,
): Response {
  logger.error(COMPONENT, `${operation}_failed`, "an exam route failed", {
    operation,
    requestId,
    reason: error instanceof Error ? error.message : "unknown",
  });
  return res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong." },
    requestId,
  });
}

// ── Steps 1-3 ───────────────────────────────────────────────────────────────

/** Step 1 + 2. Returns the student id, or null after sending 401/403. */
async function authorizeExamCaller(
  req: Request,
  res: Response,
): Promise<string | null> {
  const user = req.user;
  if (user === undefined) {
    sendFailure(
      res,
      { status: 401, code: "unauthenticated", message: "Sign in to continue." },
      req.requestId,
    );
    return null;
  }
  if (!(await EntitlementService.canAccessFeature(user.id, EXAM_FEATURE_KEY))) {
    logger.info(
      COMPONENT,
      "entitlement_denied",
      "a caller without exam_full_length was refused",
      {
        path: req.path,
        requestId: req.requestId,
      },
    );
    sendFailure(
      res,
      {
        status: 403,
        code: "forbidden",
        message: "Full-length exams need an active subscription.",
      },
      req.requestId,
    );
    return null;
  }
  return user.id;
}

/** Step 3. Returns parsed data, or null after sending 400. */
function parseOr400<S extends ZodTypeAny>(
  schema: S,
  input: unknown,
  req: Request,
  res: Response,
): z.infer<S> | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    sendFailure(
      res,
      {
        status: 400,
        code: "invalid_request",
        message: "Invalid input",
        details: parsed.error.flatten(),
      },
      req.requestId,
    );
    return null;
  }
  return parsed.data;
}

const studentGuards = [requireProfileComplete, requireConsentCompliance];

// ── §16 endpoints ───────────────────────────────────────────────────────────

router.post(
  "/sessions",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const body = parseOr400(examCreateSessionRequestSchema, req.body, req, res);
    if (body === null) return;
    try {
      return sendResult(
        res,
        await createExamSession(studentId, body.test_form_id, body.mode),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "create_session", error, req.requestId);
    }
  },
);

router.get(
  "/sessions/:session_id/state",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examSessionParamsSchema, req.params, req, res);
    if (params === null) return;
    try {
      return sendResult(
        res,
        await readExamSessionState(studentId, params.session_id),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "session_state", error, req.requestId);
    }
  },
);

router.post(
  "/sessions/:session_id/sections/:section/modules/:module/start",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examModuleParamsSchema, req.params, req, res);
    if (params === null) return;
    try {
      return sendResult(
        res,
        await startExamModule(
          studentId,
          params.session_id,
          params.section,
          params.module,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "module_start", error, req.requestId);
    }
  },
);

router.get(
  "/sessions/:session_id/sections/:section/modules/:module/items",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examModuleParamsSchema, req.params, req, res);
    if (params === null) return;
    try {
      return sendResult(
        res,
        await listExamModuleItems(
          studentId,
          params.session_id,
          params.section,
          params.module,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "module_items", error, req.requestId);
    }
  },
);

router.post(
  "/answer",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const body = parseOr400(examAnswerRequestSchema, req.body, req, res);
    if (body === null) return;
    try {
      return sendResult(
        res,
        await submitExamAnswer(studentId, body),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "answer_submit", error, req.requestId);
    }
  },
);

router.post(
  "/sessions/:session_id/sections/:section/modules/:module/submit",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examModuleParamsSchema, req.params, req, res);
    if (params === null) return;
    try {
      return sendResult(
        res,
        await submitExamModule(
          studentId,
          params.session_id,
          params.section,
          params.module,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "module_submit", error, req.requestId);
    }
  },
);

router.post(
  "/sessions/:session_id/sections/:section/heartbeat",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examSectionParamsSchema, req.params, req, res);
    if (params === null) return;
    // SCL-146: an optional resume position; no body is the E6 heartbeat.
    const body = parseOr400(
      examHeartbeatRequestSchema,
      req.body ?? {},
      req,
      res,
    );
    if (body === null) return;
    try {
      return sendResult(
        res,
        await recordExamHeartbeat(
          studentId,
          params.session_id,
          params.section,
          body.ordinal ?? null,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "heartbeat", error, req.requestId);
    }
  },
);

// ── E7a (SCL-147, SCL-145) ──────────────────────────────────────────────────

router.get("/forms", ...studentGuards, async (req: Request, res: Response) => {
  const studentId = await authorizeExamCaller(req, res);
  if (studentId === null) return;
  try {
    return sendResult(res, await listExamForms(studentId), req.requestId);
  } catch (error) {
    return sendServerError(res, "list_forms", error, req.requestId);
  }
});

router.get(
  "/sessions/:session_id/sections/:section/modules/:module/workspace",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examModuleParamsSchema, req.params, req, res);
    if (params === null) return;
    try {
      return sendResult(
        res,
        await readModuleWorkspace(
          studentId,
          params.session_id,
          params.section,
          params.module,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "workspace_read", error, req.requestId);
    }
  },
);

router.put(
  "/sessions/:session_id/sections/:section/modules/:module/workspace",
  ...studentGuards,
  async (req: Request, res: Response) => {
    const studentId = await authorizeExamCaller(req, res);
    if (studentId === null) return;
    const params = parseOr400(examModuleParamsSchema, req.params, req, res);
    if (params === null) return;
    const body = parseOr400(examWorkspaceSaveRequestSchema, req.body, req, res);
    if (body === null) return;
    try {
      return sendResult(
        res,
        await saveItemWorkspace(
          studentId,
          params.session_id,
          params.section,
          params.module,
          body,
        ),
        req.requestId,
      );
    } catch (error) {
      return sendServerError(res, "workspace_save", error, req.requestId);
    }
  },
);

export default router;
