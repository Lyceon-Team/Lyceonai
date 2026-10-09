/**
 * The Question of the Day on the student's Home.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) Part B "Rules (locked)" and "API"; SCL-224 (a QOTD answer
 *       is a practice answer and does not use the free daily 40); SCL-226 (the streak);
 *       Coding Standards §5.2 (no answer or explanation before submit), §4.2 (idempotent)]
 *       | @implemented [2026-10-09]
 *
 * plain English:
 *  - TODAY is the server's: `qotd_question_for(NULL)` returns today's row (America/Chicago) from
 *    the SEO-owned `qotd_schedule`, which is only read here. No row → the card is hidden.
 *  - A student's options are in CANONICAL order, each an opaque token (the public QOTD's own
 *    HMAC token, so a token says nothing about correctness), lettered A-D by position on screen.
 *    The explanation's letters therefore always match.
 *  - The answer is graded with the shared grader, the item snapshot is built by the practice
 *    path's own builder, and ONE SQL call (`qotd_student_answer`) writes the practice session,
 *    the answered item (the review trigger queues a miss) and the attempt. The mastery event is
 *    then emitted exactly as the practice answer path emits it (best-effort).
 *  - A replay of the same idempotency key returns the original answer; a different answer the
 *    same day is a 409.
 *  - The email prompt shows after every answer until the student says yes; "Don't ask again"
 *    from the 3rd ask; never for an under-13 or a student who has already said yes.
 *
 * Privacy: logs carry the student id (digested by the logger), the date and outcomes; never the
 * question, the choice, the answer or an address.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { applyMasteryEvent } from "../../../apps/api/src/services/mastery-write";
import {
  homeQotdAnswerResponseSchema,
  homeQotdTodayResponseSchema,
  QOTD_EMAIL_NEVER_FROM_ASK,
  type HomeQotdAnswerRequest,
  type HomeQotdAnswerResponse,
  type HomeQotdResult,
  type HomeQotdTodayResponse,
  type Streak,
} from "../../../packages/shared/src/home-qotd-schema";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import {
  mapGenesisQuestionRow,
  isCanonicalRuntimeQuestion,
  parseCanonicalMcOptions,
  type CanonicalQuestionRowLike,
} from "../../../shared/question-bank-contract";
import type { QotdRow } from "../../../shared/qotd/projection";
import {
  buildSessionItemInsertRows,
  toCanonicalQuestionForServing,
} from "../../routes/practice-canonical";
import { readDailyStreak } from "../activity-streak";
import { logger } from "../../logger";
import { qotdOptionToken } from "./option-tokens";
import {
  gradeQotd,
  qotdToday,
  qotdTokenMapFor,
  readQotd,
  type QotdDbClient,
} from "./qotd-service";
import { z } from "zod";

const COMPONENT = "HOME_QOTD";

export type HomeQotdFailure =
  | { status: 400; code: "invalid_answer" | "wrong_item_type"; message: string }
  | { status: 404; code: "no_qotd_today"; message: string }
  | {
      status: 409;
      code: "qotd_already_answered" | "qotd_day_changed";
      message: string;
    }
  | { status: 503; code: "qotd_unavailable"; message: string };

/** What the routes need from the authenticated user. */
export type HomeQotdStudent = { id: string; actorId: string };

/** The analytics the route emits after the work is done (consent-gated there). */
export type HomeQotdSignals = {
  answeredNow: boolean;
  isCorrect: boolean | null;
  sectionCode: "M" | "RW" | null;
  streakExtendedTo: number | null;
  promptShownAsk: number | null;
};

const attemptRowSchema = z.object({
  selected_answer: z.string(),
  is_correct: z.boolean(),
});

const promptStateSchema = z.object({
  eligible: z.boolean(),
  consented: z.boolean(),
  never_ask: z.boolean(),
  ask_count: z.number().int().min(0),
  last_asked_on: z.string().nullable(),
  last_decided_on: z.string().nullable(),
  today: z.string(),
});
type PromptState = z.infer<typeof promptStateSchema>;

function db(): QotdDbClient {
  return supabaseServer;
}

/** Canonical order, tokenised. Grid-in: no options. */
function studentOptions(row: QotdRow): { id: string; text: string }[] {
  if (row.item_type === "grid_in") return [];
  return parseCanonicalMcOptions(row.options).map((o) => ({
    id: qotdOptionToken(row.qotd_date, o.key),
    text: o.text,
  }));
}

function studentQuestion(
  row: QotdRow,
): HomeQotdTodayResponse extends infer T
  ? T extends { question: infer Q }
    ? Q
    : never
  : never {
  return {
    section_code: row.section,
    domain: row.domain,
    item_type: row.item_type,
    stem: row.stem,
    passage: row.passage,
    options: studentOptions(row),
    correct_answer: null,
    explanation: null,
  };
}

/** The canonical key of each on-screen position: options are in canonical order. */
function displayLetterOf(
  row: QotdRow,
  canonicalKey: string,
): "A" | "B" | "C" | "D" | null {
  const keys = parseCanonicalMcOptions(row.options).map((o) => o.key);
  const index = keys.indexOf(canonicalKey as (typeof keys)[number]);
  const letters = ["A", "B", "C", "D"] as const;
  return index >= 0 && index < letters.length ? (letters[index] ?? null) : null;
}

function resultFor(
  row: QotdRow,
  selectedAnswer: string,
  isCorrect: boolean,
): HomeQotdResult {
  if (row.item_type === "grid_in") {
    return {
      is_correct: isCorrect,
      selected_option_id: null,
      correct_option_id: null,
      correct_display_letter: null,
      correct_answer: row.correct_answer,
      explanation: row.explanation ?? "",
    };
  }
  const correctKey = (row.correct_answer ?? "").trim().toUpperCase();
  return {
    is_correct: isCorrect,
    selected_option_id: qotdOptionToken(row.qotd_date, selectedAnswer),
    correct_option_id: qotdOptionToken(row.qotd_date, correctKey),
    correct_display_letter: displayLetterOf(row, correctKey),
    correct_answer: null,
    explanation: row.explanation ?? "",
  };
}

async function readPromptState(
  studentId: string,
  now: Date,
): Promise<PromptState> {
  const { data, error } = await db().rpc("qotd_email_prompt_state", {
    p_student_id: studentId,
    p_now: now.toISOString(),
  });
  if (error)
    throw new Error(`qotd_email_prompt_state failed: ${error.message}`);
  return promptStateSchema.parse(data);
}

/** Whether the prompt may show today, given that today's question has been answered. */
function promptFlags(
  state: PromptState,
  answeredToday: boolean,
): { show_email_prompt: boolean; show_dont_ask_again: boolean } {
  const show =
    answeredToday &&
    state.eligible &&
    !state.consented &&
    !state.never_ask &&
    state.last_decided_on !== state.today;
  return {
    show_email_prompt: show,
    show_dont_ask_again: show && state.ask_count >= QOTD_EMAIL_NEVER_FROM_ASK,
  };
}

async function readAttempt(
  studentId: string,
  qotdDate: string,
): Promise<z.infer<typeof attemptRowSchema> | null> {
  const { data, error } = await supabaseServer
    .from("student_qotd_attempts")
    .select("selected_answer, is_correct")
    .eq("student_id", studentId)
    .eq("qotd_date", qotdDate)
    .maybeSingle();
  if (error)
    throw new Error(`student_qotd_attempts read failed: ${error.message}`);
  return data === null ? null : attemptRowSchema.parse(data);
}

/** GET /api/qotd/today */
export async function getHomeQotdToday(
  student: HomeQotdStudent,
  now: Date = new Date(),
): Promise<HomeQotdTodayResponse> {
  const [row, streak, state] = await Promise.all([
    readQotd(db(), null),
    readDailyStreak(student.id, now),
    readPromptState(student.id, now),
  ]);
  if (row === null || row.qotd_date !== qotdToday(now)) {
    return homeQotdTodayResponseSchema.parse({
      state: "none",
      streak,
      show_email_prompt: false,
      show_dont_ask_again: false,
    });
  }
  const attempt = await readAttempt(student.id, row.qotd_date);
  if (attempt === null) {
    return homeQotdTodayResponseSchema.parse({
      state: "unanswered",
      qotd_date: row.qotd_date,
      question: studentQuestion(row),
      streak,
      show_email_prompt: false,
      show_dont_ask_again: false,
    });
  }
  return homeQotdTodayResponseSchema.parse({
    state: "answered",
    qotd_date: row.qotd_date,
    question: studentQuestion(row),
    result: resultFor(row, attempt.selected_answer, attempt.is_correct),
    streak,
    ...promptFlags(state, true),
  });
}

/** The practice item snapshot for today's question, built by the practice path's builder. */
async function buildItemSnapshot(
  row: QotdRow,
  student: HomeQotdStudent,
  now: Date,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseServer
    // The servable view (published, no issue flags), the read every student-serving path uses
    // (Doc 02A §16): a scheduled question that has since been flagged is not served.
    .from("servable_questions")
    .select("*")
    .eq("id", row.question_id)
    .single();
  if (error || data === null) {
    throw new Error(`question read failed: ${error?.message ?? "missing"}`);
  }
  const mapped = mapGenesisQuestionRow(data as CanonicalQuestionRowLike);
  if (!isCanonicalRuntimeQuestion(mapped)) {
    throw new Error("today's question is not a canonical runtime question");
  }
  const [item] = buildSessionItemInsertRows(
    [toCanonicalQuestionForServing(mapped)],
    {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: student.id,
      actorId: student.actorId,
      clientInstanceId: null,
      now: now.toISOString(),
    },
  );
  if (!item) throw new Error("item snapshot was not built");
  if (row.item_type === "mcq") {
    item.option_order = parseCanonicalMcOptions(row.options).map((o) => o.key);
    item.option_token_map = qotdTokenMapFor(row);
  }
  return item;
}

const answerRpcSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("created"),
      practice_session_item_id: z.string().uuid(),
      selected_answer: z.string(),
      is_correct: z.boolean(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("replay"),
      selected_answer: z.string(),
      is_correct: z.boolean(),
    })
    .passthrough(),
  z.object({ status: z.literal("conflict") }).passthrough(),
  z.object({ status: z.literal("not_today") }).passthrough(),
]);

/** POST /api/qotd/answer */
export async function answerHomeQotd(
  student: HomeQotdStudent,
  body: HomeQotdAnswerRequest,
  requestId: string | undefined,
  now: Date = new Date(),
): Promise<
  Result<
    { response: HomeQotdAnswerResponse; signals: HomeQotdSignals },
    HomeQotdFailure
  >
> {
  const today = qotdToday(now);
  if (body.qotd_date !== today) {
    return err({
      status: 409,
      code: "qotd_day_changed",
      message: "Today's question has changed.",
    });
  }
  const row = await readQotd(db(), null);
  if (row === null || row.qotd_date !== today) {
    return err({
      status: 404,
      code: "no_qotd_today",
      message: "There is no question today.",
    });
  }
  const answer =
    row.item_type === "grid_in" ? body.grid_answer : body.option_token;
  if (answer === undefined) {
    return err({
      status: 400,
      code: "wrong_item_type",
      message:
        row.item_type === "grid_in" ? "Enter an answer." : "Choose an option.",
    });
  }
  const graded = gradeQotd(row, answer);
  if (!graded.ok) {
    return err({
      status: 400,
      code: "invalid_answer",
      message: graded.message,
    });
  }

  const streakBefore = await readDailyStreak(student.id, now);
  const item = await buildItemSnapshot(row, student, now);
  const { data, error } = await db().rpc("qotd_student_answer", {
    p_student_id: student.id,
    p_actor_id: student.actorId,
    p_qotd_date: today,
    p_question_id: row.question_id,
    p_item: item,
    p_selected_answer: graded.selectedCanonicalKey,
    p_is_correct: graded.isCorrect,
    p_idempotency_key: body.idempotency_key,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`qotd_student_answer failed: ${error.message}`);
  const outcome = answerRpcSchema.parse(data);
  if (outcome.status === "conflict") {
    return err({
      status: 409,
      code: "qotd_already_answered",
      message: "You've already answered today's question.",
    });
  }
  if (outcome.status === "not_today") {
    return err({
      status: 409,
      code: "qotd_day_changed",
      message: "Today's question has changed.",
    });
  }

  const created = outcome.status === "created";
  if (created) {
    // The practice answer path's own mastery emission (practice-canonical.ts), best-effort.
    const difficulty = Number(item.question_difficulty);
    const mastery = await applyMasteryEvent({
      studentId: student.id,
      section: String(item.question_section),
      domain: String(item.question_domain),
      skill: String(item.question_skill),
      difficulty: difficulty === 1 || difficulty === 3 ? difficulty : 2,
      sourceFamily: "practice",
      eventSourceKind: "practice_attempt",
      correct: outcome.is_correct,
      occurredAt: now.toISOString(),
      eventId: outcome.practice_session_item_id,
      questionId: row.question_id,
    });
    if (!mastery.ok) {
      logger.error(
        COMPONENT,
        "mastery_emission_failed",
        "QOTD mastery emission failed; the answer stands",
        undefined,
        {
          requestId,
          code: mastery.code ?? "rpc_error",
        },
      );
    }
  }

  const streak: Streak = await readDailyStreak(student.id, now);
  let state = await readPromptState(student.id, now);
  let flags = promptFlags(state, true);
  let promptShownAsk: number | null = null;
  if (flags.show_email_prompt && state.last_asked_on !== state.today) {
    const { data: count, error: askError } = await db().rpc(
      "qotd_email_record_ask",
      {
        p_student_id: student.id,
        p_now: now.toISOString(),
      },
    );
    if (askError)
      throw new Error(`qotd_email_record_ask failed: ${askError.message}`);
    promptShownAsk = z.number().int().parse(count);
    state = { ...state, ask_count: promptShownAsk, last_asked_on: state.today };
    flags = promptFlags(state, true);
  }

  const response = homeQotdAnswerResponseSchema.parse({
    qotd_date: today,
    result: resultFor(row, outcome.selected_answer, outcome.is_correct),
    streak,
    streak_extended: created && streak.today_done && !streakBefore.today_done,
    ...flags,
  });
  logger.info(COMPONENT, "qotd_answered", "Home QOTD answer recorded", {
    requestId,
    qotdDate: today,
    replay: !created,
  });
  return ok({
    response,
    signals: {
      answeredNow: created,
      isCorrect: outcome.is_correct,
      sectionCode: row.section,
      streakExtendedTo: response.streak_extended ? streak.current : null,
      promptShownAsk,
    },
  });
}

/** POST /api/qotd/email-consent */
export async function decideHomeQotdEmail(
  studentId: string,
  decision: "grant" | "not_now" | "never",
  consentVersion: string,
  now: Date = new Date(),
): Promise<
  Result<
    { consented: boolean },
    { status: 403 | 409; code: string; message: string }
  >
> {
  const { data, error } = await db().rpc("set_qotd_email_consent", {
    p_student_id: studentId,
    p_decision: decision,
    p_consent_version: consentVersion,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`set_qotd_email_consent failed: ${error.message}`);
  const parsed = z
    .union([
      z.object({ ok: z.literal(true), changed: z.boolean() }),
      z.object({ ok: z.literal(false), reason: z.string() }),
    ])
    .parse(data);
  if (!parsed.ok) {
    if (parsed.reason === "never_not_offered") {
      return err({
        status: 409,
        code: "never_not_offered",
        message: "That option isn't available yet.",
      });
    }
    return err({
      status: 403,
      code: "qotd_email_ineligible",
      message: "Daily emails aren't available for this account.",
    });
  }
  return ok({ consented: decision === "grant" });
}
