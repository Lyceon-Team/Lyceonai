/**
 * Every full-length exam HTTP call the client makes, in one module.
 *
 * @spec [Doc-04A_V2.2, §16 (the ten student endpoints, SCL-145/146/147 included);
 *        Doc-04C_V1.0, §16.1 (/report), §16.8 (envelope); Coding Standards §7.1
 *        (parse at every boundary), §11.2 (server state through the query layer)]
 *       [E7b scope: this layer consumes the E6/E7a endpoints and adds none]
 * @implemented [2026-09-25]
 *
 * plain English: each call parses its response through the SHARED strict schema
 * before a hook sees it. The question payload schema pins correct_answer and
 * explanation to null and rejects unknown keys, so a server that ever sent an answer
 * would make the call FAIL here rather than put the answer into client state. A
 * refusal surfaces as HttpApiError with the server's status and code (04A §16.2).
 *
 * edge cases: a 2xx body that does not match its schema is a contract mismatch and
 * throws; it is never defaulted to something empty.
 */
import { z } from "zod";
import {
  examAnswerResponseSchema,
  examHeartbeatResponseSchema,
  examItemsResponseSchema,
  examSessionResponseSchema,
  examStartModuleResponseSchema,
  examSubmitModuleResponseSchema,
  examWorkspaceResponseSchema,
  examWorkspaceSaveResponseSchema,
  type ExamAnswerRequest,
  type ExamAnswerResponse,
  type ExamMode,
  type ExamModule,
  type ExamSection,
  type ExamSessionResponse,
  type ExamWorkspaceItem,
  type ExamWorkspaceResponse,
  type ExamWorkspaceSaveResponse,
} from "@lyceon/shared/exam-runtime-schema";
import {
  examFormsResponseSchema,
  examReportMetaSchema,
  examReportPayloadSchema,
  examReportStatusSchema,
  type ExamFormsResponse,
  type ExamReportPayload,
  type ExamReportStatus,
} from "@lyceon/shared/exam-report-schema";
import { apiRequest } from "@/lib/queryClient";
import { HttpApiError } from "@/lib/api-error";

export const EXAM_ROOT = "/api/tests" as const;

export type ExamItemsResponse = z.infer<typeof examItemsResponseSchema>;
export type ExamStartModuleResponse = z.infer<typeof examStartModuleResponseSchema>;
export type ExamSubmitModuleResponse = z.infer<typeof examSubmitModuleResponseSchema>;
export type ExamHeartbeatResponse = z.infer<typeof examHeartbeatResponseSchema>;
export type ExamSectionStateResponse = ExamHeartbeatResponse["section_state"];

/**
 * Parses a body against its schema. The message names the resource and the failing
 * paths only — never the body, which on this surface is question content.
 */
async function parsed<T>(
  response: Response,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  resource: string,
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${resource}: the server returned a body this client cannot read.`);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join(".")).join(", ");
    // eslint-disable-next-line no-console -- the client has no structured logger; paths only, never the body.
    console.error(`[EXAM] ${resource}: response failed schema validation at [${paths}].`);
    throw new Error(`${resource}: the server returned a body this client cannot read.`);
  }
  return result.data;
}

function json(method: "POST" | "PUT", value: unknown): { method: string; body: string } {
  return { method, body: JSON.stringify(value) };
}

function modulePath(sessionId: string, section: ExamSection, module: ExamModule): string {
  return `${EXAM_ROOT}/sessions/${sessionId}/sections/${section}/modules/${module}`;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchExamForms(): Promise<ExamFormsResponse> {
  const res = await apiRequest(`${EXAM_ROOT}/forms`);
  return parsed(res, examFormsResponseSchema, "GET /api/tests/forms");
}

export async function fetchExamSession(sessionId: string): Promise<ExamSessionResponse> {
  const res = await apiRequest(`${EXAM_ROOT}/sessions/${sessionId}/state`);
  return parsed(res, examSessionResponseSchema, "GET session state");
}

export async function fetchModuleItems(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamItemsResponse> {
  const res = await apiRequest(`${modulePath(sessionId, section, module)}/items`);
  return parsed(res, examItemsResponseSchema, "GET module items");
}

export async function fetchModuleWorkspace(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamWorkspaceResponse> {
  const res = await apiRequest(`${modulePath(sessionId, section, module)}/workspace`);
  return parsed(res, examWorkspaceResponseSchema, "GET module workspace");
}

const reportEnvelopeSchema = z
  .object({ data: examReportPayloadSchema, meta: examReportMetaSchema })
  .strict();

export async function fetchExamReport(sessionId: string): Promise<ExamReportPayload> {
  const res = await apiRequest(`${EXAM_ROOT}/sessions/${sessionId}/report`);
  return (await parsed(res, reportEnvelopeSchema, "GET report")).data;
}

const reportStatusEnvelopeSchema = z
  .object({ data: examReportStatusSchema, meta: examReportMetaSchema })
  .strict();

/** 04C §16.1: the cheap read a pending report polls. */
export async function fetchExamReportStatus(sessionId: string): Promise<ExamReportStatus> {
  const res = await apiRequest(`${EXAM_ROOT}/sessions/${sessionId}/report/status`);
  return (await parsed(res, reportStatusEnvelopeSchema, "GET report status")).data;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function createExamSession(
  testFormId: string,
  mode: ExamMode,
): Promise<ExamSessionResponse> {
  const res = await apiRequest(
    `${EXAM_ROOT}/sessions`,
    json("POST", { test_form_id: testFormId, mode }),
  );
  return parsed(res, examSessionResponseSchema, "POST session");
}

export async function startExamModule(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamStartModuleResponse> {
  const res = await apiRequest(`${modulePath(sessionId, section, module)}/start`, {
    method: "POST",
  });
  return parsed(res, examStartModuleResponseSchema, "POST module start");
}

export async function submitExamModule(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamSubmitModuleResponse> {
  const res = await apiRequest(`${modulePath(sessionId, section, module)}/submit`, {
    method: "POST",
  });
  return parsed(res, examSubmitModuleResponseSchema, "POST module submit");
}

export async function submitExamAnswer(body: ExamAnswerRequest): Promise<ExamAnswerResponse> {
  const res = await apiRequest(`${EXAM_ROOT}/answer`, json("POST", body));
  return parsed(res, examAnswerResponseSchema, "POST answer");
}

export async function saveItemWorkspace(
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
  item: ExamWorkspaceItem,
): Promise<ExamWorkspaceSaveResponse> {
  const res = await apiRequest(
    `${modulePath(sessionId, section, module)}/workspace`,
    json("PUT", item),
  );
  return parsed(res, examWorkspaceSaveResponseSchema, "PUT item workspace");
}

/** 04A §8.3 + SCL-146: the ordinal on screen is the resume position. */
export async function sendExamHeartbeat(
  sessionId: string,
  section: ExamSection,
  ordinal: number | null,
): Promise<ExamHeartbeatResponse> {
  const res = await apiRequest(
    `${EXAM_ROOT}/sessions/${sessionId}/sections/${section}/heartbeat`,
    json("POST", ordinal === null ? {} : { ordinal }),
  );
  return parsed(res, examHeartbeatResponseSchema, "POST heartbeat");
}

// ── Errors ──────────────────────────────────────────────────────────────────

export function examErrorCode(error: unknown): string | null {
  return error instanceof HttpApiError ? (error.code ?? null) : null;
}

export function examErrorStatus(error: unknown): number | null {
  return error instanceof HttpApiError ? error.status : null;
}

/** HttpApiError.details is the whole error body: {error: {code, message, details}}. */
const existingSessionDetailsSchema = z
  .object({ error: z.object({ details: z.object({ session_id: z.string().uuid() }) }) })
  .transform((b) => ({ session_id: b.error.details.session_id }));

/** 409 existing_active_session carries the session to resume. */
export function existingSessionId(error: unknown): string | null {
  if (!(error instanceof HttpApiError) || error.code !== "existing_active_session") {
    return null;
  }
  const details = existingSessionDetailsSchema.safeParse(error.details);
  return details.success ? details.data.session_id : null;
}
