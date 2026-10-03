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
 *      Focus shell has a live runner to show at /practice/session/:id.
 * Every request goes through the real router, guards (the harness stub), Zod parse, domain code
 * and SQL. Nothing is inserted by hand. The ids are returned for capture.ts to template routes.
 *
 * Determinism: option order is tokenised per session by the server, so which answers are right
 * is the server's choice, not ours; the NUMBER of answers is fixed.
 */
import { PERSONA_HEADER, type StudentPersona } from "./personas";

export type SeededPersona = {
  completedPracticeSessionId: string;
  openPracticeSessionId: string;
  diagnosticSessionId: string | null;
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
  method: "GET" | "POST",
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
  section: "math" | "rw",
): Promise<string> {
  const { json } = await call(base, persona, "POST", "/api/practice/sessions", {
    section,
    client_instance_id: CLIENT_INSTANCE,
    idempotency_key: `student-harness-${persona}-${section}`,
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
      `/api/practice/sessions/${sessionId}/next?client_instance_id=${CLIENT_INSTANCE}`,
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
    await call(base, persona, "POST", "/api/practice/answer", body);
    answered += 1;
  }
  return answered;
}

export async function seedPracticeHistory(base: string): Promise<SeedManifest> {
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
    out[persona] = {
      completedPracticeSessionId: completed,
      openPracticeSessionId: open,
      diagnosticSessionId,
      answered: answeredDiagnostic + answeredCompleted + answeredOpen,
    };
  }
  return out as SeedManifest;
}
