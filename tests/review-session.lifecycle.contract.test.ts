import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, applyMasteryEventMock, getQuestionMetadataForAttemptMock } =
  vi.hoisted(() => ({
    fromMock: vi.fn(),
    applyMasteryEventMock: vi.fn(),
    getQuestionMetadataForAttemptMock: vi.fn(),
  }));

vi.mock("../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock("../apps/api/src/services/mastery-write", () => ({
  applyMasteryEvent: applyMasteryEventMock,
}));

vi.mock("../apps/api/src/services/studentMastery", () => ({
  getQuestionMetadataForAttempt: getQuestionMetadataForAttemptMock,
}));

import {
  getReviewErrorSessionState,
  startReviewErrorSession,
  submitReviewSessionAnswer,
} from "../server/routes/review-session-routes";

/**
 * @spec [Doc-05E_V1.0 §3 rule 1/rule 3, §6 INV-05E-06] | @implemented [2026-08-19]
 *
 * plain English: the authenticated user carries a synthetic grouping identifier
 * (`actor_id`) that the route copies onto every activity row it writes. These
 * tests mock the request, so they must model that identifier the way production
 * produces it, not merely satisfy the presence guard.
 *
 * Three properties of the real thing are reproduced here:
 *   uuid          `profiles.actor_id` and `review_error_attempts.actor_id` are
 *                 both `uuid NOT NULL`. A string placeholder passes the guard
 *                 and misrepresents the column — it would let a non-uuid reach
 *                 the insert assertion without anything noticing.
 *   born dissociated (§3 rule 1) — not derived from the student id.
 *   one per user, stable (INV-05E-06) — the map is keyed by student, so the
 *                 same student always presents the same actor_id across every
 *                 request in every test. Generating one per call would satisfy
 *                 the guard while breaking the invariant the column exists for.
 *
 * Source of truth in production: `supabase-auth.ts` reads `profile.actor_id`
 * onto `req.user`; nothing generates it per request.
 */
const ACTOR_IDS: Record<string, string> = {
  "student-1": "6f1a7c48-3f2e-4b91-9d0c-2a5b8e7f4c31",
  "student-2": "b83d5e02-9c74-4a16-8f5b-1e6d3a09c7f2",
};

function asUser(id: string): { id: string; actor_id: string } {
  const actorId = ACTOR_IDS[id];
  if (!actorId) {
    throw new Error(
      `no actor_id fixture for "${id}" — add one to ACTOR_IDS rather than inlining a value, so the one-per-user invariant stays visible`,
    );
  }
  return { id, actor_id: actorId };
}

type Row = Record<string, any>;
type DbState = Record<string, Row[]>;

function makeRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  return { res, getStatus: () => statusCode, getBody: () => body };
}

function buildPracticeSessionItemsFromAttempts(
  attempts: Row[],
  questions: Row[] = [],
): Row[] {
  const byCanonical = new Map<string, Row>();
  const byId = new Map<string, Row>();
  for (const question of questions) {
    if (typeof question.canonical_id === "string") {
      byCanonical.set(question.canonical_id, question);
    }
    if (typeof question.id === "string") {
      byId.set(question.id, question);
    }
  }

  return attempts.map((row, index) => {
    const question = row.questions ?? {};
    const canonicalId =
      question.canonical_id ?? row.question_canonical_id ?? null;
    const fallback = canonicalId
      ? byCanonical.get(canonicalId)
      : row.question_id
        ? byId.get(row.question_id)
        : null;
    const options = question.options ?? fallback?.options ?? null;
    const correctAnswer =
      question.correct_answer ?? fallback?.correct_answer ?? null;
    const explanation = question.explanation ?? fallback?.explanation ?? null;
    const outcome = row.outcome ?? (row.is_correct ? "correct" : "incorrect");
    const status = outcome === "skipped" ? "skipped" : "answered";
    return {
      id: row.session_item_id ?? `legacy-item-${index + 1}`,
      session_id:
        row.session_id ?? `legacy-session-${row.user_id ?? "student"}`,
      user_id: row.user_id ?? null,
      question_id:
        row.question_id ?? question.id ?? `legacy-question-${index + 1}`,
      question_canonical_id: canonicalId,
      question_stem: question.stem ?? fallback?.stem ?? null,
      question_section: question.section ?? fallback?.section ?? null,
      question_difficulty: question.difficulty ?? fallback?.difficulty ?? null,
      question_domain: question.domain ?? fallback?.domain ?? null,
      question_skill: question.skill ?? fallback?.skill ?? null,
      question_subskill: question.subskill ?? fallback?.subskill ?? null,
      question_options: options,
      question_correct_answer: correctAnswer,
      question_explanation: explanation,
      question_exam: question.exam ?? fallback?.exam ?? null,
      question_structure_cluster_id:
        question.structure_cluster_id ?? fallback?.structure_cluster_id ?? null,
      is_correct: row.is_correct ?? null,
      outcome,
      answered_at: row.attempted_at ?? row.created_at ?? null,
      status,
    };
  });
}

function setupSupabase(state: DbState) {
  class Query {
    table: string;
    op: "select" | "insert" | "update";
    payload: any;
    filters: Array<(row: Row) => boolean> = [];
    sorter: ((a: Row, b: Row) => number) | null = null;
    max: number | null = null;

    constructor(
      table: string,
      op: "select" | "insert" | "update",
      payload: any = null,
    ) {
      this.table = table;
      this.op = op;
      this.payload = payload;
    }

    select(_columns?: string) {
      return this;
    }

    insert(payload: any) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }

    update(payload: any) {
      this.op = "update";
      this.payload = payload;
      return this;
    }

    eq(column: string, value: any) {
      if (column.includes(".")) {
        this.filters.push((row) => {
          const [prefix, field] = column.split(".");
          const nested = row[prefix];
          if (nested && typeof nested === "object") {
            return nested[field] === value;
          }
          return true;
        });
        return this;
      }
      this.filters.push((row) => row[column] === value);
      return this;
    }

    /**
     * `.neq` was absent from this mock entirely. It is added because the
     * auto-abandon query calls it (review-session-routes.ts:692) and a mock that
     * throws on a real call site is a trap waiting for the next test.
     *
     * It is NOT currently reachable by any test, and that is a finding rather
     * than an omission: the `.neq("idempotency_key", key)` clause only matters
     * if a session already carries the incoming key AND the replay branch did
     * not return first — and the replay branch returns for every status, so it
     * always does. The clause is defence-in-depth against a concurrent insert
     * between the replay SELECT and the sweep, which a single-threaded mock
     * cannot stage. A test asserting it would pass without being able to fail.
     * See the PR description.
     */
    neq(column: string, value: any) {
      this.filters.push((row) => row[column] !== value);
      return this;
    }

    in(column: string, values: any[]) {
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }

    gt(column: string, value: any) {
      this.filters.push((row) => row[column] > value);
      return this;
    }

    gte(column: string, value: any) {
      this.filters.push((row) => row[column] >= value);
      return this;
    }

    contains(column: string, values: any[]) {
      this.filters.push((row) => {
        const list = row[column];
        return (
          Array.isArray(list) && values.every((value) => list.includes(value))
        );
      });
      return this;
    }

    order(column: string, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false;
      this.sorter = (a, b) => {
        if (a[column] === b[column]) return 0;
        if (a[column] == null) return 1;
        if (b[column] == null) return -1;
        return asc
          ? a[column] > b[column]
            ? 1
            : -1
          : a[column] > b[column]
            ? -1
            : 1;
      };
      return this;
    }

    limit(count: number) {
      this.max = count;
      return this;
    }

    maybeSingle() {
      return this.execute(true);
    }

    single() {
      return this.execute(false, true);
    }

    then(resolve: any, reject: any) {
      return this.execute().then(resolve, reject);
    }

    private getRows() {
      const baseRows = state[this.table] ?? [];

      if (this.table === "review_session_items") {
        const questionsByCanonicalId = new Map<string, Row>();
        for (const question of (state.questions ?? []) as Row[]) {
          const canonicalId =
            typeof question.canonical_id === "string"
              ? question.canonical_id
              : null;
          if (!canonicalId) continue;
          questionsByCanonicalId.set(canonicalId, question);
        }

        return (baseRows as Row[]).map((row) => {
          const canonicalId =
            typeof row.question_canonical_id === "string"
              ? row.question_canonical_id
              : null;
          const question = canonicalId
            ? questionsByCanonicalId.get(canonicalId)
            : null;
          return {
            ...row,
            question_section: row.question_section ?? question?.section ?? null,
            question_stem: row.question_stem ?? question?.stem ?? null,
            question_options: row.question_options ?? question?.options ?? null,
            question_difficulty:
              row.question_difficulty ?? question?.difficulty ?? null,
            question_correct_answer:
              row.question_correct_answer ?? question?.correct_answer ?? null,
            question_explanation:
              row.question_explanation ?? question?.explanation ?? null,
          };
        });
      }

      return baseRows;
    }

    private applyFilters(rows: Row[]) {
      let out = [...rows];
      for (const filter of this.filters) {
        out = out.filter(filter);
      }
      if (this.sorter) out.sort(this.sorter);
      if (typeof this.max === "number") out = out.slice(0, this.max);
      return out;
    }

    private async execute(
      maybeSingle = false,
      strictSingle = false,
    ): Promise<any> {
      const tableRows = this.getRows();

      if (this.op === "insert") {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : [this.payload];
        const inserted = rows.map((row, index) => ({
          id: row.id ?? `${this.table}-id-${tableRows.length + index + 1}`,
          created_at: row.created_at ?? "2026-03-14T10:00:00.000Z",
          updated_at: row.updated_at ?? "2026-03-14T10:00:00.000Z",
          ...row,
        }));

        if (this.table === "review_error_attempts") {
          const duplicate = inserted.find(
            (row) =>
              row.client_attempt_id &&
              tableRows.some(
                (existing) =>
                  existing.student_id === row.student_id &&
                  existing.client_attempt_id === row.client_attempt_id,
              ),
          );
          if (duplicate) {
            return {
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }
        }

        state[this.table] = [...tableRows, ...inserted];
        if (strictSingle) return { data: inserted[0], error: null };
        return { data: inserted, error: null };
      }

      if (this.op === "update") {
        const matched = this.applyFilters(tableRows);
        const updatedRows = matched.map((row) => ({ ...row, ...this.payload }));
        state[this.table] = tableRows.map((row) => {
          const hit = matched.find((m) => m.id === row.id);
          return hit ? { ...row, ...this.payload } : row;
        });

        if (strictSingle) {
          if (updatedRows.length === 0)
            return { data: null, error: { message: "No rows updated" } };
          return { data: updatedRows[0], error: null };
        }

        return { data: updatedRows, error: null };
      }

      const selected = this.applyFilters(tableRows);
      if (strictSingle) {
        if (selected.length !== 1)
          return { data: null, error: { message: "Expected single row" } };
        return { data: selected[0], error: null };
      }
      if (maybeSingle) {
        return { data: selected[0] ?? null, error: null };
      }
      return { data: selected, error: null };
    }
  }

  fromMock.mockImplementation((table: string) => new Query(table, "select"));
}

describe("Review session lifecycle contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    applyMasteryEventMock.mockResolvedValue({ ok: true, error: undefined });
    getQuestionMetadataForAttemptMock.mockResolvedValue({
      canonicalId: "SATM1ABC123",
      exam: "SAT",
      section: "Math",
      domain: "alg",
      skill: "linear_equations",
      subskill: null,
      skill_code: "ALG-1",
      difficulty: 2,
      structure_cluster_id: null,
    });
  });

  /**
   * @spec [lyceon-coding-standards §4.2 (idempotency via `idempotency_key`), §9] |
   * @rewritten [2026-08-19]
   *
   * plain English: a repeat start with no `idempotency_key` does NOT replay. It
   * auto-abandons the prior session and creates a fresh one.
   *
   * WHY THIS TEST CHANGED. It previously asserted 200 + `replayed: true` for a
   * second start carrying the same `client_instance_id` and no idempotency key.
   * That contract no longer exists and the spec does not support it: §4.2 keys
   * idempotency on `idempotency_key`, and `client_instance_id` is the multi-tab
   * binding (§8.3 — 409 on conflict), not a replay key. The route reads
   * `body.idempotency_key` and nothing else (review-session-routes.ts:536), so
   * with no key the replay branch at :574 is skipped entirely and the
   * auto-abandon sweep at :681 runs — which is what 412c38e introduced and what
   * production does today.
   *
   * The replay contract itself is still asserted, correctly, by
   * "replays session start deterministically by idempotency key" below.
   *
   * Note for anyone re-diagnosing this: the mock's missing `.neq()` was NOT the
   * cause of the old failure. `.neq` is called only when an idempotency key is
   * present, and in that case the route returns at the replay branch before ever
   * reaching the abandon query. It has been added to the mock regardless, and
   * the test after this one is what actually exercises it.
   */
  it("starts one canonical review session; a second start with no idempotency key abandons the first", async () => {
    const questions = [
      {
        canonical_id: "SATM1ABC123",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Which value solves x+1=2?",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "Subtract 1.",
      },
    ];
    const attempts = [
      {
        id: "a1",
        question_id: "q-source-1",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T09:00:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-1",
          canonical_id: "SATM1ABC123",
          stem: "Q1",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "11111111-1111-4111-8111-111111111111",
          subskill: "ss1",
        },
      },
    ];
    const state: DbState = {
      practice_session_items: buildPracticeSessionItemsFromAttempts(
        attempts,
        questions,
      ),
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions,
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "all_past_mistakes",
        filter: "all",
        client_instance_id: "client-a",
      },
    };
    const first = makeRes();
    await startReviewErrorSession(req, first.res);
    expect(first.getStatus()).toBe(201);
    expect(state.review_sessions).toHaveLength(1);
    expect(state.review_session_items).toHaveLength(1);
    const firstSessionId = state.review_sessions[0].id;

    // Second start, same client instance, still no idempotency_key. Replay is
    // NOT reachable here — see the test name and the block comment above.
    const second = makeRes();
    await startReviewErrorSession(req, second.res);
    expect(second.getStatus()).toBe(201);
    expect(second.getBody().replayed).toBe(false);

    // Exactly one session is startable at a time: the prior one is abandoned,
    // not left racing the new one.
    expect(state.review_sessions).toHaveLength(2);
    const abandoned = state.review_sessions.filter(
      (row: Row) => row.status === "abandoned",
    );
    const live = state.review_sessions.filter(
      (row: Row) => row.status !== "abandoned",
    );
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].id).toBe(firstSessionId);
    expect(abandoned[0].abandoned_at).toBeTruthy();
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(firstSessionId);
  });

  it("replays session start deterministically by idempotency key", async () => {
    const questions = [
      {
        canonical_id: "SATM1ABC123",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "exp",
      },
    ];
    const attempts = [
      {
        id: "a1",
        question_id: "q-source-1",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T09:00:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-1",
          canonical_id: "SATM1ABC123",
          stem: "Q1",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
    ];
    const state: DbState = {
      practice_session_items: buildPracticeSessionItemsFromAttempts(
        attempts,
        questions,
      ),
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: null,
          idempotency_key: "idem-1",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: null,
          option_token_map: null,
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "all_past_mistakes",
        filter: "all",
        idempotency_key: "idem-1",
        client_instance_id: "client-a",
      },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().replayed).toBe(true);
    expect(res.getBody().session.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(state.review_sessions).toHaveLength(1);
    expect(state.review_sessions[0].client_instance_id).toBe("client-a");
  });
  it("materializes deterministic ordinals with exactly one served unresolved item", async () => {
    const questions = [
      {
        canonical_id: "SATM1ABC123",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q1",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "exp1",
      },
      {
        canonical_id: "SATM1DEF456",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q2",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "B",
        explanation: "exp2",
      },
    ];
    const attempts = [
      {
        id: "a1",
        question_id: "q-source-1",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T09:00:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-1",
          canonical_id: "SATM1ABC123",
          stem: "Q1",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
      {
        id: "a2",
        question_id: "q-source-2",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T08:59:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-2",
          canonical_id: "SATM1DEF456",
          stem: "Q2",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
    ];
    const state: DbState = {
      practice_session_items: buildPracticeSessionItemsFromAttempts(
        attempts,
        questions,
      ),
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions,
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "all_past_mistakes",
        filter: "all",
        client_instance_id: "client-a",
      },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(201);
    expect(state.review_session_items).toHaveLength(2);
    const served = state.review_session_items.filter(
      (row) => row.status === "served",
    );
    const queued = state.review_session_items.filter(
      (row) => row.status === "queued",
    );
    expect(served).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(served[0].ordinal).toBe(1);
    expect(queued[0].ordinal).toBe(2);
  });

  it("requires explicit review mode on session start", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions: [],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: { filter: "all", client_instance_id: "client-a" },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody()).toMatchObject({ code: "REVIEW_MODE_REQUIRED" });
  });

  it("fails closed when unresolved item lacks valid canonical_id even if question_id is canonical-shaped", async () => {
    const questions = [
      {
        id: "SATM1ABC123",
        canonical_id: null,
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q1",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "exp",
      },
    ];
    const attempts = [
      {
        id: "a-canonical-shaped-id",
        question_id: "SATM1ABC123",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T09:00:00.000Z",
        user_id: "student-1",
        questions: {
          id: "SATM1ABC123",
          canonical_id: null,
          stem: "Q1",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
    ];
    const state: DbState = {
      practice_session_items: buildPracticeSessionItemsFromAttempts(
        attempts,
        questions,
      ),
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions,
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "all_past_mistakes",
        filter: "all",
        client_instance_id: "client-a",
      },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(422);
    expect(res.getBody()).toMatchObject({
      code: "REVIEW_QUEUE_MISSING_CANONICAL_ID",
    });
    expect(state.review_sessions).toHaveLength(0);
    expect(state.review_session_items).toHaveLength(0);
  });

  it("state refresh returns same served item and option tokens", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: null,
          option_token_map: null,
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      params: { sessionId: "11111111-1111-4111-8111-111111111111" },
      query: { client_instance_id: "client-a" },
    };
    const first = makeRes();
    await getReviewErrorSessionState(req, first.res);
    expect(first.getStatus()).toBe(200);
    const optionsA = first
      .getBody()
      .currentItem.question.options.map((o: any) => o.id);

    const second = makeRes();
    await getReviewErrorSessionState(req, second.res);
    expect(second.getStatus()).toBe(200);
    const optionsB = second
      .getBody()
      .currentItem.question.options.map((o: any) => o.id);

    expect(second.getBody().currentItem.id).toBe(
      first.getBody().currentItem.id,
    );
    expect(optionsB).toEqual(optionsA);
    expect(second.getBody().currentItem.question.correct_answer).toBeNull();
    expect(second.getBody().currentItem.question.explanation).toBeNull();
    expect("questionCanonicalId" in second.getBody().currentItem).toBe(false);
    expect("sourceQuestionCanonicalId" in second.getBody().currentItem).toBe(
      false,
    );
    expect("sourceQuestionId" in second.getBody().currentItem).toBe(false);
  });

  it("duplicate submit is idempotent per served item and does not double-write mastery", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
          question_section: "Math",
          question_domain: "algebra",
          question_skill: "linear_equations",
          question_difficulty_bucket: 1,
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const preSubmitStateReq: any = {
      user: asUser("student-1"),
      params: { sessionId: "11111111-1111-4111-8111-111111111111" },
      query: { client_instance_id: "client-a" },
    };
    const preSubmitStateRes = makeRes();
    await getReviewErrorSessionState(preSubmitStateReq, preSubmitStateRes.res);
    expect(preSubmitStateRes.getStatus()).toBe(200);
    expect(
      preSubmitStateRes.getBody().currentItem.question.correct_answer,
    ).toBeNull();
    expect(
      preSubmitStateRes.getBody().currentItem.question.explanation,
    ).toBeNull();

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_attempt_id: "attempt-1",
        client_instance_id: "client-a",
      },
    };

    const first = makeRes();
    await submitReviewSessionAnswer(req, first.res);
    expect(first.getStatus()).toBe(200);
    expect(first.getBody().reviewOutcome).toBe("review_pass");
    expect(first.getBody().correctOptionId).toBe("opt_a");
    expect(first.getBody().correctAnswerText).toBe("1");
    expect(first.getBody().explanation).toBe("exp");

    const second = makeRes();
    await submitReviewSessionAnswer(req, second.res);
    expect(second.getStatus()).toBe(200);
    expect(second.getBody().idempotent).toBe(true);

    const emitted = applyMasteryEventMock.mock.calls.map(
      (call) => call[0].sourceFamily,
    );
    expect(emitted).toEqual(["review"]);
  });

  it("skips mastery emission when review item difficulty bucket is invalid", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
          question_section: "Math",
          question_stem: "Q",
          question_options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          question_difficulty_bucket: 9,
          question_correct_answer: "A",
          question_explanation: "exp",
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_attempt_id: "attempt-invalid-difficulty",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().masteryApplied).toBe(false);
    expect(res.getBody().masteryErrors).toContain(
      "Invalid difficulty bucket for mastery emission",
    );
    expect(applyMasteryEventMock).not.toHaveBeenCalled();
  });

  it("does not derive mastery difficulty from raw difficulty when bucket is missing", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
          question_section: "Math",
          question_stem: "Q",
          question_options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          question_difficulty: "easy",
          question_correct_answer: "A",
          question_explanation: "exp",
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_attempt_id: "attempt-missing-bucket",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().masteryApplied).toBe(false);
    expect(res.getBody().masteryErrors).toContain(
      "Invalid difficulty bucket for mastery emission",
    );
    expect(applyMasteryEventMock).not.toHaveBeenCalled();
  });

  it("fails closed when resolved item points to another student attempt_id", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [
        {
          id: "attempt-foreign",
          student_id: "student-2",
          question_id: "q-source-1",
          context: "review_errors",
          selected_answer: "A",
          is_correct: true,
          created_at: "2026-03-14T09:05:00.000Z",
        },
      ],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "answered",
          attempt_id: "attempt-foreign",
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(409);
    expect(res.getBody().code).toBe("REVIEW_SESSION_ITEM_LOCKED");
  });

  it("rejects answer submit without opaque selected_option_id", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_answer: "A",
        source_context: "review_errors",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().code).toBe("REVIEW_SELECTED_OPTION_REQUIRED");
    expect(applyMasteryEventMock).not.toHaveBeenCalled();
  });

  it("fails closed when legacy free-response field is sent to mounted review submit", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        free_response_answer: "A",
        source_context: "review_errors",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().code).toBe("REVIEW_MC_OPTION_REQUIRED");
    expect(applyMasteryEventMock).not.toHaveBeenCalled();
  });

  it("denies non-owner answer submit to another student review session", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "served",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-2"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(404);
    expect(res.getBody().code).toBe("REVIEW_SESSION_NOT_FOUND");
  });

  it("fails closed when resolved item sees client_attempt_id bound to a different question", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [
        {
          id: "attempt-student-mismatch",
          student_id: "student-1",
          question_id: "q-other",
          context: "review_errors",
          selected_answer: "A",
          is_correct: false,
          created_at: "2026-03-14T09:05:00.000Z",
          client_attempt_id: "attempt-1",
        },
      ],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          review_session_id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          ordinal: 1,
          question_canonical_id: "SATM1ABC123",
          source_question_id: "q-source-1",
          source_question_canonical_id: "SATM1ABC123",
          source_origin: "practice",
          retry_mode: "same_question",
          status: "answered",
          attempt_id: null,
          tutor_opened_at: null,
          source_attempted_at: "2026-03-14T08:00:00.000Z",
          option_order: ["A", "B", "C", "D"],
          option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
        },
      ],
      review_session_events: [],
      questions: [
        {
          canonical_id: "SATM1ABC123",
          status: "published",
          question_type: "multiple_choice",
          section: "Math",
          stem: "Q",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          difficulty: "easy",
          correct_answer: "A",
          explanation: "exp",
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        session_id: "11111111-1111-4111-8111-111111111111",
        review_session_item_id: "22222222-2222-4222-8222-222222222222",
        selected_option_id: "opt_a",
        source_context: "review_errors",
        client_attempt_id: "attempt-1",
        client_instance_id: "client-a",
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(409);
    expect(res.getBody().code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("denies non-owner access to another student session state", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          student_id: "student-1",
          status: "active",
          started_at: "2026-03-14T09:00:00.000Z",
          completed_at: null,
          abandoned_at: null,
          client_instance_id: "client-a",
          created_at: "2026-03-14T09:00:00.000Z",
          updated_at: "2026-03-14T09:00:00.000Z",
        },
      ],
      review_session_items: [],
      review_session_events: [],
      questions: [],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-2"),
      params: { sessionId: "11111111-1111-4111-8111-111111111111" },
      query: { client_instance_id: "client-a" },
    };
    const res = makeRes();
    await getReviewErrorSessionState(req, res.res);

    expect(res.getStatus()).toBe(404);
    expect(res.getBody().code).toBe("REVIEW_SESSION_NOT_FOUND");
  });

  it("filters review session start by practice session when mode=by_practice_session", async () => {
    const questions = [
      {
        canonical_id: "SATM1ABC123",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q1",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "exp1",
      },
      {
        canonical_id: "SATM1DEF456",
        status: "published",
        question_type: "multiple_choice",
        section: "Math",
        stem: "Q2",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
        difficulty: "easy",
        correct_answer: "A",
        explanation: "exp2",
      },
    ];
    const attempts = [
      {
        id: "a1",
        session_id: "11111111-1111-4111-8111-111111111111",
        session_item_id: "item-a",
        question_id: "q-source-1",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T09:00:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-1",
          canonical_id: "SATM1ABC123",
          stem: "Q1",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
      {
        id: "a2",
        session_id: "22222222-2222-4222-8222-222222222222",
        session_item_id: "item-b",
        question_id: "q-source-2",
        is_correct: false,
        outcome: "incorrect",
        attempted_at: "2026-03-14T08:59:00.000Z",
        user_id: "student-1",
        questions: {
          id: "q-source-2",
          canonical_id: "SATM1DEF456",
          stem: "Q2",
          section: "Math",
          difficulty: "medium",
          domain: "alg",
          skill: "s1",
          subskill: "ss1",
        },
      },
    ];
    const state: DbState = {
      practice_session_items: buildPracticeSessionItemsFromAttempts(
        attempts,
        questions,
      ),
      full_length_exam_responses: [],
      full_length_exam_questions: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions,
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "by_practice_session",
        practice_session_id: "11111111-1111-4111-8111-111111111111",
        filter: "all",
        client_instance_id: "client-a",
      },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(201);
    expect(state.review_session_items).toHaveLength(1);
    expect(state.review_session_items[0].source_question_id).toBe("q-source-1");
  });

  it("filters review session start by full-length session when mode=by_full_length_session", async () => {
    const state: DbState = {
      practice_session_items: [],
      full_length_exam_responses: [
        {
          id: "f1",
          session_id: "33333333-3333-4333-8333-333333333333",
          module_id: "module-a",
          question_id: "q10",
          is_correct: false,
          answered_at: "2026-03-14T09:10:00.000Z",
        },
        {
          id: "f2",
          session_id: "44444444-4444-4444-8444-444444444444",
          module_id: "module-b",
          question_id: "q11",
          is_correct: false,
          answered_at: "2026-03-14T09:11:00.000Z",
        },
      ],
      full_length_exam_questions: [
        {
          module_id: "module-a",
          question_id: "q10",
          question_canonical_id: "SATM1GHI789",
          question_stem: "Q10",
          question_section: "Math",
          question_options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          question_correct_answer: "A",
          question_explanation: "exp",
        },
        {
          module_id: "module-b",
          question_id: "q11",
          question_canonical_id: "SATM1JKL012",
          question_stem: "Q11",
          question_section: "Math",
          question_options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
          question_correct_answer: "A",
          question_explanation: "exp",
        },
      ],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions: [],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: asUser("student-1"),
      body: {
        mode: "by_full_length_session",
        full_length_session_id: "33333333-3333-4333-8333-333333333333",
        filter: "all",
        client_instance_id: "client-a",
      },
    };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(201);
    expect(state.review_session_items).toHaveLength(1);
    expect(state.review_session_items[0].source_origin).toBe("full_test");
  });
});
