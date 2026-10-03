/**
 * Practice history for the student harness's personas, written through the REAL routes.
 *
 * @spec [CLAUDE.md "derive the fixture from real output"; Coding Standards §9 (practice engine
 *        contracts: POST /api/practice/sessions, GET .../next, POST /api/practice/answer)]
 * @implemented [2026-10-03]
 *
 * plain English: for each student persona, over HTTP against the harness server itself:
 *   0. the current Terms and Privacy Policy accepted (POST /api/legal/reaccept, the route the
 *      re-consent modal calls), and for the paid student only the diagnostic answered through
 *      POST /api/practice/diagnostic/sessions + /next + /answer (the free student has not taken
 *      it, as on the free Home prototype);
 *   1. one Math practice session answered to the end (the first served option each time, so
 *      some answers are right and some wrong, which feeds mastery and the review pool through
 *      the real answer path: attempts, mastery events, review eligibility);
 *   2. one Reading and Writing session answered partway (three items) and left open, so the
 *      Focus shell has a live runner to show at /practice/session/:id;
 *   3. only when the page group asks (`seed: "review-history"`, UI-52): five more short practice
 *      sessions, each started with a section and a domain (5 questions, answered to the end, so
 *      each leaves misses in the review queue under its own criteria), then one review session
 *      over the queue's first Math domain, answered once and left open. Review's queue, domain
 *      chips and past-session list (more than five rows, so Load more shows) come from these.
 *      Five, not more: the free plan's 40 a day must still cover them (13 + 25 served).
 * Every request goes through the real router, guards (the harness stub), Zod parse, domain code
 * and SQL. Nothing is inserted by hand. The ids are returned for capture.ts to template routes.
 *
 * Determinism: option order is tokenised per session by the server, so which answers are right
 * is the server's choice, not ours; the NUMBER of answers is fixed.
 */
import type { Client } from "pg";
import { PERSONA_HEADER, PERSONAS, type StudentPersona } from "./personas";

export type SeededPersona = {
  completedPracticeSessionId: string;
  openPracticeSessionId: string;
  /** The open review session (`seed: "review-history"` only), else null. */
  openReviewSessionId: string | null;
  diagnosticSessionId: string | null;
  /** UI-54 (`seed: "exam-history"`, paid only): a full-length test walked to `scored`, else null. */
  scoredExamSessionId: string | null;
  /** UI-54: a full-length test left in Reading and Writing Module 2, else null. */
  inProgressExamSessionId: string | null;
  /** UI-56 (`seed: "lisa-history"`, paid only): the LISA conversation with turns, else null. */
  lisaConversationId: string | null;
  answered: number;
};
export type SeedManifest = Record<StudentPersona, SeededPersona>;

/**
 * The client instance the seed binds its sessions to. A shot that opens a seeded session presets
 * it as the browser's own (`lyceon_client_instance_id`), i.e. "the browser that started it";
 * any other instance is refused 409 CLIENT_INSTANCE_CONFLICT, as in production.
 */
export const SEED_CLIENT_INSTANCE = "student-harness-seed";
const CLIENT_INSTANCE = SEED_CLIENT_INSTANCE;
const OPEN_SESSION_ANSWERS = 3;

type NextBody = {
  sessionItemId?: string;
  question?: {
    sessionItemId: string;
    options: Array<{ id: string }>;
    inputMode: string;
  } | null;
  totalQuestions?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

async function call(
  base: string,
  persona: StudentPersona,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", [PERSONA_HEADER]: persona },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, init);
  const json: unknown = await res.json();
  if (res.status >= 400) {
    throw new Error(
      `${persona} ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { status: res.status, json };
}

async function startSession(
  base: string,
  persona: StudentPersona,
  section: "math" | "rw" | null,
  criteria?: { key: string; sections: string[]; domains: string[] },
): Promise<string> {
  const body: Record<string, unknown> =
    criteria === undefined
      ? { section }
      : {
          sections: criteria.sections,
          domains: criteria.domains,
          target_question_count: REVIEW_HISTORY_SESSION_SIZE,
        };
  const { json } = await call(base, persona, "POST", "/api/practice/sessions", {
    ...body,
    client_instance_id: CLIENT_INSTANCE,
    idempotency_key: `student-harness-${persona}-${criteria?.key ?? section}`,
  });
  if (!isObject(json) || typeof json.sessionId !== "string")
    throw new Error("session start returned no sessionId");
  return json.sessionId;
}

/** Answers up to `limit` items of the session; returns how many were answered. */
async function answerItems(
  base: string,
  persona: StudentPersona,
  sessionId: string,
  limit: number,
  engine: "practice" | "review" = "practice",
): Promise<number> {
  let answered = 0;
  let total = Number.MAX_SAFE_INTEGER;
  // After the last answer the server closes the session and /next answers 409 session_closed
  // (register F-53), so the loop stops at the served total rather than asking once more.
  while (answered < Math.min(limit, total)) {
    const { json } = await call(
      base,
      persona,
      "GET",
      `/api/${engine}/sessions/${sessionId}/next?client_instance_id=${CLIENT_INSTANCE}`,
    );
    const next = json as NextBody;
    if (typeof next.totalQuestions === "number") total = next.totalQuestions;
    const q = next.question;
    if (!q) break; // the session is complete
    const body: Record<string, unknown> = {
      sessionId,
      sessionItemId: q.sessionItemId,
      clientAttemptId: `student-harness-${sessionId}-${answered}`,
      client_instance_id: CLIENT_INSTANCE,
    };
    if (q.inputMode === "numeric_entry")
      body.answer = answered % 2 === 0 ? "1" : "2";
    else body.selectedOptionId = q.options[0]?.id ?? null;
    await call(base, persona, "POST", `/api/${engine}/answer`, body);
    answered += 1;
  }
  return answered;
}

/** Questions per extra session (`seed: "review-history"`). */
const REVIEW_HISTORY_SESSION_SIZE = 5;

/** The extra sessions' criteria: a section and one domain each (the harness bank's domains). */
const REVIEW_HISTORY_SESSIONS: ReadonlyArray<{
  key: string;
  sections: string[];
  domains: string[];
}> = [
  { key: "rh-alg", sections: ["M"], domains: ["Algebra"] },
  {
    key: "rh-cas",
    sections: ["RW"],
    domains: ["Craft and Structure"],
  },
  {
    key: "rh-adv",
    sections: ["M"],
    domains: ["Advanced Math"],
  },
  {
    key: "rh-ini",
    sections: ["RW"],
    domains: ["Information and Ideas"],
  },
  {
    key: "rh-geo",
    sections: ["M"],
    domains: ["Geometry and Trigonometry"],
  },
];

/**
 * Step 3 (`seed: "review-history"`): the extra practice sessions, then one review session over
 * the queue's first Math domain, answered once and left open. Returns the review session's id.
 */
async function seedReviewHistory(
  base: string,
  persona: StudentPersona,
): Promise<{ answered: number; openReviewSessionId: string }> {
  let answered = 0;
  for (const spec of REVIEW_HISTORY_SESSIONS) {
    const id = await startSession(base, persona, null, spec);
    answered += await answerItems(base, persona, id, Number.MAX_SAFE_INTEGER);
  }
  const { json } = await call(base, persona, "POST", "/api/review/sessions", {
    mode: "filter",
    filters: { sections: ["M"], domains: ["Algebra"] },
    client_instance_id: CLIENT_INSTANCE,
    idempotency_key: `student-harness-${persona}-review`,
  });
  if (!isObject(json) || typeof json.sessionId !== "string")
    throw new Error("review session start returned no sessionId");
  answered += await answerItems(base, persona, json.sessionId, 1, "review");
  return { answered, openReviewSessionId: json.sessionId };
}

/** The exam harness's two published forms (tests/e2e/exam-harness/db.ts FORMS). */
const EXAM_FORM_SCORED = "e7b00000-0000-4000-8000-0000000000f1";
const EXAM_FORM_IN_PROGRESS = "e7b00000-0000-4000-8000-0000000000f2";

type ExamItemsBody = {
  items?: Array<{
    question_id: string;
    ordinal: number;
    question_type: string;
    options: Array<{ id: string }> | null;
  }>;
};

/**
 * Answers every item of one module through the real answer route: the first option on screen
 * for a multiple-choice item (the server tokenises and orders the options per session, so which
 * are right is its choice), "1" for a grid-in. Returns how many were answered.
 */
async function answerExamModule(
  base: string,
  persona: StudentPersona,
  sessionId: string,
  section: "RW" | "M",
  module: "1" | "2",
): Promise<number> {
  const root = `/api/tests/sessions/${sessionId}/sections/${section}/modules/${module}`;
  const { json } = await call(base, persona, "GET", `${root}/items`);
  const items = (json as ExamItemsBody).items ?? [];
  let answered = 0;
  for (const item of items) {
    const answer =
      item.question_type === "multiple_choice"
        ? (item.options?.[0]?.id ?? null)
        : "1";
    await call(base, persona, "POST", "/api/tests/answer", {
      test_session_id: sessionId,
      section,
      module,
      question_id: item.question_id,
      ordinal: item.ordinal,
      answer,
      idempotency_key: `student-harness-${sessionId}-${section}${module}-${item.ordinal}`,
    });
    answered += 1;
  }
  return answered;
}

/**
 * UI-54 (`seed: "exam-history"`): through the real exam routes, the paid student (1) sits
 * Practice Test 1 under practice timing, answering every module, and waits until the report
 * reads `scored` (scoring runs in-process on the last submit, as in the exam harness's
 * disclosure spec); then (2) starts Practice Test 2, submits Reading and Writing Module 1 and
 * starts Module 2, leaving it in progress. Practice timing, so the open module's clock pauses
 * while no heartbeat arrives.
 */
async function seedExamHistory(
  base: string,
  persona: StudentPersona,
): Promise<{
  scoredExamSessionId: string;
  inProgressExamSessionId: string;
  answered: number;
}> {
  let answered = 0;
  const create = async (formId: string): Promise<string> => {
    const { json } = await call(base, persona, "POST", "/api/tests/sessions", {
      test_form_id: formId,
      mode: "lenient",
    });
    if (!isObject(json) || typeof json.session_id !== "string")
      throw new Error("exam session create returned no session_id");
    return json.session_id;
  };
  const moduleRoot = (sid: string, section: string, module: string): string =>
    `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;

  const scored = await create(EXAM_FORM_SCORED);
  for (const section of ["RW", "M"] as const) {
    for (const module of ["1", "2"] as const) {
      await call(
        base,
        persona,
        "POST",
        `${moduleRoot(scored, section, module)}/start`,
      );
      answered += await answerExamModule(
        base,
        persona,
        scored,
        section,
        module,
      );
      await call(
        base,
        persona,
        "POST",
        `${moduleRoot(scored, section, module)}/submit`,
      );
    }
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    const { json } = await call(
      base,
      persona,
      "GET",
      `/api/tests/sessions/${scored}/report`,
    );
    const state =
      isObject(json) && isObject(json.data)
        ? json.data.report_state
        : undefined;
    if (state === "scored") break;
    if (Date.now() > deadline)
      throw new Error(
        `exam report never reached scored (last: ${String(state)})`,
      );
    await new Promise((r) => setTimeout(r, 500));
  }

  const open = await create(EXAM_FORM_IN_PROGRESS);
  await call(base, persona, "POST", `${moduleRoot(open, "RW", "1")}/start`);
  answered += await answerExamModule(base, persona, open, "RW", "1");
  await call(base, persona, "POST", `${moduleRoot(open, "RW", "1")}/submit`);
  await call(base, persona, "POST", `${moduleRoot(open, "RW", "2")}/start`);
  return {
    scoredExamSessionId: scored,
    inProgressExamSessionId: open,
    answered,
  };
}

/**
 * UI-55 (`seed: "calendar-goal"`): the paid student's SAT date, set through the real
 * `PUT /api/calendar/profile` (idempotency key and all), to the Sunday of the current week in
 * UTC (the harness student's zone), or today when today is Sunday — a day the week view shows
 * and never a past one (`makeStudyProfileUpsertSchema` refuses a date before today). The
 * target score stays the exam harness's 1400. Runs before the student first opens /calendar, so
 * the plan is generated from the profile with the date in it.
 */
async function seedCalendarGoal(base: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const sunday = new Date(`${today}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
  await call(base, "paid", "PUT", "/api/calendar/profile", {
    target_exam_date: sunday.toISOString().slice(0, 10),
    idempotency_key: "5e55a000-0000-4000-8000-000000000055",
  });
}

export async function seedPracticeHistory(
  base: string,
  options: {
    reviewHistory: boolean;
    examHistory?: boolean;
    calendarGoal?: boolean;
  } = {
    reviewHistory: false,
  },
): Promise<SeedManifest> {
  const out: Partial<SeedManifest> = {};
  for (const persona of ["free", "paid"] as const) {
    // The current Terms and Privacy Policy, accepted through the real re-accept route (the one
    // the blocking re-consent modal calls), so pages render without that modal over them.
    await call(base, persona, "POST", "/api/legal/reaccept", {});
    let diagnosticSessionId: string | null = null;
    let answeredDiagnostic = 0;
    if (persona === "paid") {
      // The paid student has taken the diagnostic (real route: 8 domains x 5), so Home shows the
      // post-diagnostic state; the free student has not, matching the free Home prototype.
      const { json } = await call(
        base,
        persona,
        "POST",
        "/api/practice/diagnostic/sessions",
        {
          client_instance_id: CLIENT_INSTANCE,
          idempotency_key: "student-harness-paid-diagnostic",
        },
      );
      if (!isObject(json)) throw new Error("diagnostic start returned no body");
      const id =
        json.sessionId ??
        (isObject(json.session) ? json.session.id : undefined);
      if (typeof id !== "string")
        throw new Error(
          `diagnostic start returned no session id: ${JSON.stringify(json).slice(0, 300)}`,
        );
      diagnosticSessionId = id;
      answeredDiagnostic = await answerItems(
        base,
        persona,
        id,
        Number.MAX_SAFE_INTEGER,
      );
    }
    const completed = await startSession(base, persona, "math");
    const answeredCompleted = await answerItems(
      base,
      persona,
      completed,
      Number.MAX_SAFE_INTEGER,
    );
    const open = await startSession(base, persona, "rw");
    const answeredOpen = await answerItems(
      base,
      persona,
      open,
      OPEN_SESSION_ANSWERS,
    );
    const review = options.reviewHistory
      ? await seedReviewHistory(base, persona)
      : null;
    // Full-Length is paid: only the paid student has exam history.
    const exam =
      options.examHistory === true && persona === "paid"
        ? await seedExamHistory(base, persona)
        : null;
    out[persona] = {
      completedPracticeSessionId: completed,
      openPracticeSessionId: open,
      openReviewSessionId: review?.openReviewSessionId ?? null,
      diagnosticSessionId,
      scoredExamSessionId: exam?.scoredExamSessionId ?? null,
      inProgressExamSessionId: exam?.inProgressExamSessionId ?? null,
      lisaConversationId: null,
      answered:
        answeredDiagnostic +
        answeredCompleted +
        answeredOpen +
        (review?.answered ?? 0) +
        (exam?.answered ?? 0),
    };
  }
  // After the personas' legal acceptance above, like every other seeded write.
  if (options.calendarGoal === true) await seedCalendarGoal(base);
  return out as SeedManifest;
}

/**
 * UI-56 (`seed: "lisa-history"`): the paid student's LISA history.
 *
 * plain English: four standalone conversations, each created through the REAL
 * `POST /api/tutor/conversations` (entitlement gate, Zod parse, scope resolution, insert), the
 * route the page's New session calls. Their turns cannot go through `POST /api/tutor/messages`:
 * that route calls the model (the tutor orchestrator) and Google's safety services, which this
 * harness never reaches. So the turns are written as rows, the way the tutor's own route tests
 * seed them (tests/helpers/fake-tutor-db.ts), with the title and times the message route would
 * have left. The words are the prototype's illustrative conversation (Lisa.dc.html), so the
 * side-by-side compares like with like. The oldest is ended (OQ-39 (f): the history includes
 * ended sessions). Returns the conversation with turns.
 */
export async function seedLisaHistory(
  base: string,
  pg: Client,
): Promise<string> {
  const day = (offsetDays: number, minute: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offsetDays);
    d.setUTCHours(10, minute, 0, 0);
    return d.toISOString();
  };
  const conversations: ReadonlyArray<{
    title: string;
    at: string;
    ended: boolean;
    turns: ReadonlyArray<readonly ["student" | "tutor", string]>;
  }> = [
    {
      title: "Feeling stuck on transitions",
      at: day(9, 5),
      ended: true,
      turns: [["student", "Feeling stuck on transitions"]],
    },
    {
      title: "What is my mastery score in algebra?",
      at: day(9, 20),
      ended: false,
      turns: [["student", "What is my mastery score in algebra?"]],
    },
    {
      title: "Math",
      at: day(0, 1),
      ended: false,
      turns: [["student", "Math"]],
    },
    {
      title: "Slope from standard form",
      at: day(0, 30),
      ended: false,
      turns: [
        [
          "student",
          "I keep getting slope questions wrong when the line is written like 3x + 2y = 12.",
        ],
        [
          "tutor",
          "Let's start with what slope tells you. If you rewrite that equation so y is by itself on one side, what do you get?",
        ],
        ["student", "y = -3/2x + 6?"],
        [
          "tutor",
          "Exactly. Now compare it with y = mx + b. Which number is the slope?",
        ],
      ],
    },
  ];
  let withTurns = "";
  for (const [index, conv] of conversations.entries()) {
    const { json } = await call(
      base,
      "paid",
      "POST",
      "/api/tutor/conversations",
      {
        entry_mode: "general",
        source_surface: "dashboard",
        idempotency_key: `5e56a000-0000-4000-8000-00000000000${index}`,
      },
    );
    const data = isObject(json) && isObject(json.data) ? json.data : null;
    const id = data?.conversation_id;
    if (typeof id !== "string")
      throw new Error("tutor conversation create returned no id");
    for (const [turn, [role, message]] of conv.turns.entries()) {
      const at = new Date(
        Date.parse(conv.at) - (conv.turns.length - turn) * 60_000,
      );
      await pg.query(
        `INSERT INTO public.tutor_messages (conversation_id, student_id, role, content_kind, message, created_at)
         VALUES ($1::uuid, $2::uuid, $3, 'message', $4, $5::timestamptz)`,
        [id, PERSONAS.paid.id, role, message, at.toISOString()],
      );
    }
    // The table's own BEFORE UPDATE trigger stamps updated_at = now(); the history's dates are
    // the point of this seed, so in this throwaway database only, that one trigger is held off
    // for this one write.
    await pg.query(
      `ALTER TABLE public.tutor_conversations DISABLE TRIGGER tutor_conversations_updated_at`,
    );
    try {
      await pg.query(
        `UPDATE public.tutor_conversations
            SET title = $2, updated_at = $3::timestamptz,
                status = CASE WHEN $4::boolean THEN 'ended' ELSE status END,
                ended_at = CASE WHEN $4::boolean THEN $3::timestamptz ELSE ended_at END
          WHERE id = $1::uuid`,
        [id, conv.title, conv.at, conv.ended],
      );
    } finally {
      await pg.query(
        `ALTER TABLE public.tutor_conversations ENABLE TRIGGER tutor_conversations_updated_at`,
      );
    }
    if (conv.turns.length > 1) withTurns = id;
  }
  return withTurns;
}
