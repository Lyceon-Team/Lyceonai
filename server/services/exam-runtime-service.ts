/**
 * Full-length exam runtime — domain orchestration over the exam_* SQL functions.
 *
 * @spec [Doc-04A_V2.2, §7.3, §8.3-§8.5, §9, §10.1-§10.2, §11.2, §12, §13.1-§13.3,
 *        §15.1, §16; Doc-04B_V4.3 §12]
 *       [E6 rulings: SCL-132 (Module 2 = '2'), SCL-133 (practice's option shuffle),
 *        SCL-136 (inline scoring after commit)]
 * @implemented [2026-09-24]
 *
 * plain English: one function per API operation. Each makes ONE call to its
 * exam_* SQL function (one transaction: state checks, timeouts, routing and writes
 * all happen there), then does the three things that belong in TypeScript:
 *   1. mint the option shuffle for items served for the first time, with practice's
 *      buildServedOptions, and persist it (exam_record_item_options);
 *   2. resolve the student's selected token to the canonical letter with the shared
 *      resolveSelectedCanonicalKey BEFORE the answer is stored — is_answer_correct
 *      compares canonical letters, so a stored token would silently score wrong;
 *   3. score any outbox row the transaction wrote, right after it committed
 *      (exam_score_outbox_event), so a finished session has its score on return.
 *
 * expected outcome: a Result for the handler to serialise. Question payloads are
 * built by toExamQuestionPayload and parsed against the strict shared schema, so an
 * answer-bearing field can never reach the response.
 *
 * trade-offs: scoring failures do not fail the student's request — the session is
 * over and committed; the failure is logged and the outbox row stays pending for
 * the sweep (exam_abandonment_sweep) to retry. Grading never happens here: Module 1
 * is graded inside exam_submit_module / the timeout path, in SQL.
 *
 * edge cases: every RPC response is parsed as `unknown` through Zod; a malformed
 * envelope throws (handler -> 500), it is never guessed at.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  buildServedOptions,
  buildStudentSafeOptionsFromStoredMap,
  parseCanonicalMcOptions,
  parseStudentSafeOptionTokenMap,
  resolveSelectedCanonicalKey,
  type StudentSafeOption,
} from "../../shared/question-bank-contract";
import { filterAssetsPreSubmit } from "../routes/practice-canonical";
import {
  examErrorCodeSchema,
  examAnswerResponseSchema,
  examHeartbeatResponseSchema,
  examQuestionPayloadSchema,
  examSectionStateResponseSchema,
  examSessionResponseSchema,
  examSubmitModuleResponseSchema,
  type ExamAnswerRequest,
  type ExamAnswerResponse,
  type ExamErrorCode,
  type ExamMode,
  type ExamModule,
  type ExamQuestionPayload,
  type ExamSection,
  type ExamSessionResponse,
} from "../../packages/shared/src/exam-runtime-schema";

const COMPONENT = "EXAM_RUNTIME";

// ── Result type ─────────────────────────────────────────────────────────────

export type ExamFailure = {
  status: number;
  code: ExamErrorCode;
  message: string;
  details?: unknown;
};

export type ExamResult<T> =
  | { ok: true; status: number; value: T }
  | { ok: false; error: ExamFailure };

// ── The SQL envelope ────────────────────────────────────────────────────────

const rpcErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .passthrough();

const rpcEnvelopeSchema = z.object({
  status: z.number().int(),
  body: z.unknown().optional(),
  error: rpcErrorSchema.optional(),
  outbox_ids: z.array(z.string().uuid()).optional(),
  body_mismatch_fields: z.array(z.string()).optional(),
});
type RpcEnvelope = z.infer<typeof rpcEnvelopeSchema>;

/** Server-side item row from exam_module_items. Carries canonical option keys. */
const examItemRowSchema = z.object({
  ordinal: z.number().int(),
  question_id: z.string(),
  item_type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  passage: z.string().nullable(),
  options: z.unknown(),
  assets: z.unknown().nullable(),
  served: z.boolean(),
  option_order: z.array(z.string()).nullable(),
  option_token_map: z.record(z.string()).nullable(),
  has_answer: z.boolean(),
  current_answer: z.string().nullable(),
});
type ExamItemRow = z.infer<typeof examItemRowSchema>;

const storedOptionsRowSchema = z.object({
  ordinal: z.number().int(),
  question_id: z.string(),
  option_order: z.array(z.string()).nullable(),
  option_token_map: z.record(z.string()).nullable(),
});

const answerOptionMapSchema = z.object({
  question_id: z.string().nullable(),
  item_type: z.enum(["mcq", "grid_in"]).nullable(),
  option_token_map: z.unknown().nullable(),
});

async function callExamRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcEnvelope> {
  const { data, error } = await supabaseServer.rpc(fn, args);
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return rpcEnvelopeSchema.parse(data);
}

/** A refusal from SQL. Its code must be one of the contract's; anything else throws. */
function failureFrom(env: RpcEnvelope): ExamFailure {
  if (!env.error) {
    throw new Error(`exam RPC returned status ${env.status} without an error`);
  }
  const { code, message, ...details } = env.error;
  return {
    status: env.status,
    code: examErrorCodeSchema.parse(code),
    message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

/**
 * §13.3 hand-off, after the transaction that wrote the outbox row committed. Runs
 * for every operation, because any touch can time out a final Module 2 and complete
 * the session. Failures are recorded on the outbox row by SQL and logged here.
 */
async function scoreCommittedOutboxEvents(
  ids: readonly string[] | undefined,
): Promise<void> {
  for (const outboxEventId of ids ?? []) {
    const env = await supabaseServer.rpc("exam_score_outbox_event", {
      p_outbox_event_id: outboxEventId,
    });
    if (env.error) {
      logger.error(COMPONENT, "score_outbox_event", "scoring hand-off failed", {
        outboxEventId,
        reason: env.error.message,
      });
      continue;
    }
    const parsed = z
      .object({ ok: z.boolean(), sqlstate: z.string().optional() })
      .passthrough()
      .safeParse(env.data);
    if (!parsed.success || !parsed.data.ok) {
      logger.warn(
        COMPONENT,
        "score_outbox_event",
        "scoring deferred to the sweep",
        {
          outboxEventId,
          sqlstate: parsed.success ? parsed.data.sqlstate : "unparsed",
        },
      );
    }
  }
}

async function runExamRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcEnvelope> {
  const env = await callExamRpc(fn, args);
  await scoreCommittedOutboxEvents(env.outbox_ids);
  return env;
}

// ── §10.2 serializer ────────────────────────────────────────────────────────

/**
 * @spec [Doc-04A_V2.2 §10.2; Coding Standards §5.2] | @implemented [2026-09-24]
 * plain English: the single function that reduces a served item to an
 * ExamQuestionPayload. Its input row never contains correct_answer,
 * correct_variants, explanation, domain, skill_code or difficulty (the SQL does not
 * select them); its output is parsed against the strict shared schema, so a stray
 * field throws instead of shipping. Assets pass practice's fail-closed filter.
 */
export function toExamQuestionPayload(
  row: Pick<
    ExamItemRow,
    "ordinal" | "question_id" | "item_type" | "stem" | "passage" | "assets"
  >,
  safeOptions: StudentSafeOption[],
  currentAnswer: string | null,
): ExamQuestionPayload {
  return examQuestionPayloadSchema.parse({
    question_id: row.question_id,
    ordinal: row.ordinal,
    question_type:
      row.item_type === "grid_in"
        ? "student_produced_response"
        : "multiple_choice",
    stem: row.stem,
    passage: row.passage,
    options: safeOptions,
    assets: filterAssetsPreSubmit(row.assets),
    current_answer: currentAnswer,
    correct_answer: null,
    explanation: null,
  });
}

/** The stored canonical answer, as the client saw it: its token for an mcq. */
function displayAnswer(
  row: Pick<ExamItemRow, "item_type" | "current_answer">,
  tokenMap: Record<string, string> | null,
): string | null {
  if (row.current_answer === null) return null;
  if (row.item_type === "grid_in") return row.current_answer;
  const entry = Object.entries(tokenMap ?? {}).find(
    ([, key]) => key === row.current_answer,
  );
  return entry ? entry[0] : null;
}

type ServedModule = {
  section_state: z.infer<typeof examSectionStateResponseSchema>;
  items: ExamQuestionPayload[];
};

/**
 * §10.1 + the practice shuffle. Items with no persisted shuffle get one minted by
 * buildServedOptions and written once (first writer wins); the payload is then built
 * from what is STORED, so two tabs racing see one screen.
 */
async function serveModule(
  studentId: string,
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamResult<ServedModule>> {
  const env = await runExamRpc("exam_module_items", {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_section: section,
    p_module: module,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };

  const body = z
    .object({
      section_state: examSectionStateResponseSchema,
      items: z.array(examItemRowSchema),
    })
    .parse(env.body);

  const unserved = body.items.filter((item) => !item.served);
  const stored = new Map<number, z.infer<typeof storedOptionsRowSchema>>();
  for (const item of body.items) {
    if (item.served) {
      stored.set(item.ordinal, {
        ordinal: item.ordinal,
        question_id: item.question_id,
        option_order: item.option_order,
        option_token_map: item.option_token_map,
      });
    }
  }

  if (unserved.length > 0) {
    const rows = unserved.map((item) => {
      if (item.item_type === "grid_in") {
        return {
          ordinal: item.ordinal,
          question_id: item.question_id,
          option_order: null,
          option_token_map: null,
        };
      }
      const served = buildServedOptions(parseCanonicalMcOptions(item.options));
      return {
        ordinal: item.ordinal,
        question_id: item.question_id,
        option_order: served.optionOrder,
        option_token_map: served.optionTokenMap,
      };
    });
    const recorded = await callExamRpc("exam_record_item_options", {
      p_student_id: studentId,
      p_session_id: sessionId,
      p_section: section,
      p_module: module,
      p_rows: rows,
    });
    if (recorded.status !== 200)
      return { ok: false, error: failureFrom(recorded) };
    const recordedBody = z
      .object({ items: z.array(storedOptionsRowSchema) })
      .parse(recorded.body);
    for (const row of recordedBody.items) stored.set(row.ordinal, row);
  }

  const items: ExamQuestionPayload[] = [];
  for (const item of body.items) {
    const persisted = stored.get(item.ordinal);
    if (item.item_type === "grid_in") {
      items.push(toExamQuestionPayload(item, [], displayAnswer(item, null)));
      continue;
    }
    const safeOptions = buildStudentSafeOptionsFromStoredMap(
      parseCanonicalMcOptions(item.options),
      persisted?.option_order ?? null,
      persisted?.option_token_map ?? null,
    );
    if (!safeOptions) {
      // Fail closed (§17 question_integrity_violation): never improvise a screen.
      throw new Error(
        `exam item ${item.question_id} has no valid persisted option shuffle`,
      );
    }
    items.push(
      toExamQuestionPayload(
        item,
        safeOptions,
        displayAnswer(item, persisted?.option_token_map ?? null),
      ),
    );
  }

  return {
    ok: true,
    status: 200,
    value: { section_state: body.section_state, items },
  };
}

// ── Operations ──────────────────────────────────────────────────────────────

/** §7.3 */
export async function createExamSession(
  studentId: string,
  testFormId: string,
  mode: ExamMode,
): Promise<ExamResult<ExamSessionResponse>> {
  const env = await runExamRpc("exam_create_session", {
    p_student_id: studentId,
    p_test_form_id: testFormId,
    p_mode: mode,
  });
  if (env.status !== 200 && env.status !== 201)
    return { ok: false, error: failureFrom(env) };
  return {
    ok: true,
    status: env.status,
    value: examSessionResponseSchema.parse(env.body),
  };
}

/** §15.1 */
export async function readExamSessionState(
  studentId: string,
  sessionId: string,
): Promise<ExamResult<ExamSessionResponse>> {
  const env = await runExamRpc("exam_session_state", {
    p_student_id: studentId,
    p_session_id: sessionId,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };
  return {
    ok: true,
    status: 200,
    value: examSessionResponseSchema.parse(env.body),
  };
}

/** §8.5: start, then "Return the first question and current section state". */
export async function startExamModule(
  studentId: string,
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<
  ExamResult<{
    section_state: z.infer<typeof examSectionStateResponseSchema>;
    first_item: ExamQuestionPayload | null;
  }>
> {
  const env = await runExamRpc("exam_start_module", {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_section: section,
    p_module: module,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };
  const served = await serveModule(studentId, sessionId, section, module);
  if (!served.ok) return served;
  return {
    ok: true,
    status: 200,
    value: {
      section_state: served.value.section_state,
      first_item: served.value.items[0] ?? null,
    },
  };
}

/** §10.1 */
export async function listExamModuleItems(
  studentId: string,
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamResult<ServedModule>> {
  return serveModule(studentId, sessionId, section, module);
}

/**
 * §11.2. Resolution happens BEFORE the store: the SQL keeps the canonical value
 * (mcq letter / grid-in string / NULL = explicit omit) and echoes the client's own
 * value back in `stored.answer`.
 */
export async function submitExamAnswer(
  studentId: string,
  request: ExamAnswerRequest,
): Promise<ExamResult<ExamAnswerResponse>> {
  const mapEnv = await callExamRpc("exam_answer_option_map", {
    p_student_id: studentId,
    p_session_id: request.test_session_id,
    p_section: request.section,
    p_module: request.module,
    p_ordinal: request.ordinal,
  });
  if (mapEnv.status !== 200) return { ok: false, error: failureFrom(mapEnv) };
  const item = answerOptionMapSchema.parse(mapEnv.body);

  let canonical: string | null = request.answer;
  if (request.answer !== null && item.item_type === "mcq") {
    const tokenMap = parseStudentSafeOptionTokenMap(item.option_token_map);
    if (!tokenMap) {
      return {
        ok: false,
        error: {
          status: 409,
          code: "session_item_mapping_missing",
          message: "The served option mapping is missing for this item.",
        },
      };
    }
    canonical = resolveSelectedCanonicalKey(request.answer, tokenMap);
    if (canonical === null) {
      return {
        ok: false,
        error: {
          status: 400,
          code: "invalid_answer",
          message: "Unrecognised option.",
        },
      };
    }
  } else if (request.answer !== null && item.item_type === "grid_in") {
    canonical = request.answer.trim();
    if (canonical.length === 0) {
      return {
        ok: false,
        error: {
          status: 400,
          code: "invalid_answer",
          message: "Send null to clear a grid-in answer.",
        },
      };
    }
  }

  const env = await runExamRpc("exam_submit_answer", {
    p_student_id: studentId,
    p_session_id: request.test_session_id,
    p_section: request.section,
    p_module: request.module,
    p_ordinal: request.ordinal,
    p_question_id: request.question_id,
    p_answer: canonical,
    p_display_answer: request.answer,
    p_client_latency_ms: request.client_latency_ms ?? null,
    p_idempotency_key: request.idempotency_key,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };

  if (env.body_mismatch_fields && env.body_mismatch_fields.length > 0) {
    // §11.2 step 2 body-mismatch audit: WHICH fields differed, never their values.
    logger.warn(
      COMPONENT,
      "idempotency_body_mismatch",
      "idempotency key reused with a different body",
      {
        testSessionId: request.test_session_id,
        fields: env.body_mismatch_fields,
      },
    );
  }
  if (request.audit_meta?.client_instance_id) {
    logger.info(COMPONENT, "answer_audit_meta", "answer submitted", {
      testSessionId: request.test_session_id,
      clientInstanceId: request.audit_meta.client_instance_id,
    });
  }
  return {
    ok: true,
    status: 200,
    value: examAnswerResponseSchema.parse(env.body),
  };
}

/** §12 */
export async function submitExamModule(
  studentId: string,
  sessionId: string,
  section: ExamSection,
  module: ExamModule,
): Promise<ExamResult<z.infer<typeof examSubmitModuleResponseSchema>>> {
  const env = await runExamRpc("exam_submit_module", {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_section: section,
    p_module: module,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };
  return {
    ok: true,
    status: 200,
    value: examSubmitModuleResponseSchema.parse(env.body),
  };
}

/** §8.3 */
export async function recordExamHeartbeat(
  studentId: string,
  sessionId: string,
  section: ExamSection,
): Promise<ExamResult<z.infer<typeof examHeartbeatResponseSchema>>> {
  const env = await runExamRpc("exam_heartbeat", {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_section: section,
  });
  if (env.status !== 200) return { ok: false, error: failureFrom(env) };
  return {
    ok: true,
    status: 200,
    value: examHeartbeatResponseSchema.parse(env.body),
  };
}
