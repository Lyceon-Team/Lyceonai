import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fromMock,
  applyMasteryUpdateMock,
  getQuestionMetadataForAttemptMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  applyMasteryUpdateMock: vi.fn(),
  getQuestionMetadataForAttemptMock: vi.fn(),
}));

vi.mock('../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock('../apps/api/src/services/studentMastery', () => ({
  applyMasteryUpdate: applyMasteryUpdateMock,
  getQuestionMetadataForAttempt: getQuestionMetadataForAttemptMock,
}));

import {
  getReviewErrorSessionState,
  startReviewErrorSession,
  submitReviewSessionAnswer,
} from '../server/routes/review-session-routes';
import { MasteryEventType } from '../apps/api/src/services/mastery-constants';

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

function setupSupabase(state: DbState) {
  class Query {
    table: string;
    op: 'select' | 'insert' | 'update';
    payload: any;
    filters: Array<(row: Row) => boolean> = [];
    sorter: ((a: Row, b: Row) => number) | null = null;
    max: number | null = null;

    constructor(table: string, op: 'select' | 'insert' | 'update', payload: any = null) {
      this.table = table;
      this.op = op;
      this.payload = payload;
    }

    select(_columns?: string) {
      return this;
    }

    insert(payload: any) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload: any) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }

    eq(column: string, value: any) {
      this.filters.push((row) => row[column] === value);
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
        return Array.isArray(list) && values.every((value) => list.includes(value));
      });
      return this;
    }

    order(column: string, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false;
      this.sorter = (a, b) => {
        if (a[column] === b[column]) return 0;
        if (a[column] == null) return 1;
        if (b[column] == null) return -1;
        return asc ? (a[column] > b[column] ? 1 : -1) : (a[column] > b[column] ? -1 : 1);
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
      return state[this.table] ?? [];
    }

    private applyFilters(rows: Row[]) {
      let out = [...rows];
      for (const filter of this.filters) {
        out = out.filter(filter);
      }
      if (this.sorter) out.sort(this.sorter);
      if (typeof this.max === 'number') out = out.slice(0, this.max);
      return out;
    }

    private async execute(maybeSingle = false, strictSingle = false): Promise<any> {
      const tableRows = this.getRows();

      if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = rows.map((row, index) => ({
          id: row.id ?? `${this.table}-id-${tableRows.length + index + 1}`,
          created_at: row.created_at ?? '2026-03-14T10:00:00.000Z',
          updated_at: row.updated_at ?? '2026-03-14T10:00:00.000Z',
          ...row,
        }));

        if (this.table === 'review_error_attempts') {
          const duplicate = inserted.find((row) => row.client_attempt_id && tableRows.some((existing) => existing.student_id === row.student_id && existing.client_attempt_id === row.client_attempt_id));
          if (duplicate) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
        }

        state[this.table] = [...tableRows, ...inserted];
        if (strictSingle) return { data: inserted[0], error: null };
        return { data: inserted, error: null };
      }

      if (this.op === 'update') {
        const matched = this.applyFilters(tableRows);
        const updatedRows = matched.map((row) => ({ ...row, ...this.payload }));
        state[this.table] = tableRows.map((row) => {
          const hit = matched.find((m) => m.id === row.id);
          return hit ? { ...row, ...this.payload } : row;
        });

        if (strictSingle) {
          if (updatedRows.length === 0) return { data: null, error: { message: 'No rows updated' } };
          return { data: updatedRows[0], error: null };
        }

        return { data: updatedRows, error: null };
      }

      const selected = this.applyFilters(tableRows);
      if (strictSingle) {
        if (selected.length !== 1) return { data: null, error: { message: 'Expected single row' } };
        return { data: selected[0], error: null };
      }
      if (maybeSingle) {
        return { data: selected[0] ?? null, error: null };
      }
      return { data: selected, error: null };
    }
  }

  fromMock.mockImplementation((table: string) => new Query(table, 'select'));
}

describe('Review session lifecycle contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    applyMasteryUpdateMock.mockResolvedValue({ attemptId: 'm-1', rollupUpdated: true, error: undefined });
    getQuestionMetadataForAttemptMock.mockResolvedValue({
      canonicalId: 'SATM1ABC123',
      exam: 'SAT',
      section: 'Math',
      domain: 'alg',
      skill: 'linear_equations',
      subskill: null,
      skill_code: 'ALG-1',
      difficulty: 2,
      structure_cluster_id: null,
    });
  });

  it('starts one canonical review session and replays without duplicating items', async () => {
    const state: DbState = {
      answer_attempts: [
        {
          id: 'a1',
          question_id: 'q-source-1',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-14T09:00:00.000Z',
          user_id: 'student-1',
          questions: {
            id: 'q-source-1',
            canonical_id: 'SATM1ABC123',
            stem: 'Q1',
            section: 'Math',
            difficulty: 'medium',
            domain: 'alg',
            skill: '11111111-1111-4111-8111-111111111111',
            subskill: 'ss1',
          },
        },
      ],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions: [
        {
          canonical_id: 'SATM1ABC123',
          status: 'published',
          question_type: 'multiple_choice',
          section: 'Math',
          stem: 'Which value solves x+1=2?',
          options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }],
          difficulty: 'easy',
          correct_answer: 'A',
          explanation: 'Subtract 1.',
        },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-1' }, body: { filter: 'all', client_instance_id: 'client-a' } };
    const first = makeRes();
    await startReviewErrorSession(req, first.res);
    expect(first.getStatus()).toBe(201);
    expect(state.review_sessions).toHaveLength(1);
    expect(state.review_session_items).toHaveLength(1);

    const second = makeRes();
    await startReviewErrorSession(req, second.res);
    expect(second.getStatus()).toBe(200);
    expect(second.getBody().replayed).toBe(true);
    expect(state.review_sessions).toHaveLength(1);
    expect(state.review_session_items).toHaveLength(1);
  });

  it('replays session start deterministically by idempotency key', async () => {
    const state: DbState = {
      answer_attempts: [
        {
          id: 'a1',
          question_id: 'q-source-1',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-14T09:00:00.000Z',
          user_id: 'student-1',
          questions: { id: 'q-source-1', canonical_id: 'SATM1ABC123', stem: 'Q1', section: 'Math', difficulty: 'medium', domain: 'alg', skill: 's1', subskill: 'ss1' },
        },
      ],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: null, idempotency_key: 'idem-1', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'served', attempt_id: null, tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: null, option_token_map: null },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-1' }, body: { filter: 'all', idempotency_key: 'idem-1', client_instance_id: 'client-a' } };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(200);
    expect(res.getBody().replayed).toBe(true);
    expect(res.getBody().session.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(state.review_sessions).toHaveLength(1);
    expect(state.review_sessions[0].client_instance_id).toBe('client-a');
  });
  it('materializes deterministic ordinals with exactly one served unresolved item', async () => {
    const state: DbState = {
      answer_attempts: [
        {
          id: 'a1',
          question_id: 'q-source-1',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-14T09:00:00.000Z',
          user_id: 'student-1',
          questions: { id: 'q-source-1', canonical_id: 'SATM1ABC123', stem: 'Q1', section: 'Math', difficulty: 'medium', domain: 'alg', skill: 's1', subskill: 'ss1' },
        },
        {
          id: 'a2',
          question_id: 'q-source-2',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-14T08:59:00.000Z',
          user_id: 'student-1',
          questions: { id: 'q-source-2', canonical_id: 'SATM1DEF456', stem: 'Q2', section: 'Math', difficulty: 'medium', domain: 'alg', skill: 's1', subskill: 'ss1' },
        },
      ],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q1', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp1' },
        { canonical_id: 'SATM1DEF456', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q2', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'B', explanation: 'exp2' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-1' }, body: { filter: 'all', client_instance_id: 'client-a' } };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(201);
    expect(state.review_session_items).toHaveLength(2);
    const served = state.review_session_items.filter((row) => row.status === 'served');
    const queued = state.review_session_items.filter((row) => row.status === 'queued');
    expect(served).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(served[0].ordinal).toBe(1);
    expect(queued[0].ordinal).toBe(2);
  });

  it('fails closed when unresolved item lacks valid canonical_id even if question_id is canonical-shaped', async () => {
    const state: DbState = {
      answer_attempts: [
        {
          id: 'a-canonical-shaped-id',
          question_id: 'SATM1ABC123',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-14T09:00:00.000Z',
          user_id: 'student-1',
          questions: {
            id: 'SATM1ABC123',
            canonical_id: null,
            stem: 'Q1',
            section: 'Math',
            difficulty: 'medium',
            domain: 'alg',
            skill: 's1',
            subskill: 'ss1',
          },
        },
      ],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [],
      review_session_items: [],
      review_session_events: [],
      questions: [],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-1' }, body: { filter: 'all', client_instance_id: 'client-a' } };
    const res = makeRes();
    await startReviewErrorSession(req, res.res);

    expect(res.getStatus()).toBe(422);
    expect(res.getBody()).toMatchObject({
      code: 'REVIEW_QUEUE_MISSING_CANONICAL_ID',
    });
    expect(state.review_sessions).toHaveLength(0);
    expect(state.review_session_items).toHaveLength(0);
  });

  it('state refresh returns same served item and option tokens', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'served', attempt_id: null, tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: null, option_token_map: null },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-1' }, params: { sessionId: '11111111-1111-4111-8111-111111111111' }, query: { client_instance_id: 'client-a' } };
    const first = makeRes();
    await getReviewErrorSessionState(req, first.res);
    expect(first.getStatus()).toBe(200);
    const optionsA = first.getBody().currentItem.question.options.map((o: any) => o.id);

    const second = makeRes();
    await getReviewErrorSessionState(req, second.res);
    expect(second.getStatus()).toBe(200);
    const optionsB = second.getBody().currentItem.question.options.map((o: any) => o.id);

    expect(second.getBody().currentItem.id).toBe(first.getBody().currentItem.id);
    expect(optionsB).toEqual(optionsA);
    expect(second.getBody().currentItem.question.correct_answer).toBeNull();
    expect(second.getBody().currentItem.question.explanation).toBeNull();
    expect('questionCanonicalId' in second.getBody().currentItem).toBe(false);
    expect('sourceQuestionCanonicalId' in second.getBody().currentItem).toBe(false);
    expect('sourceQuestionId' in second.getBody().currentItem).toBe(false);
  });

  it('duplicate submit is idempotent per served item and does not double-write mastery', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'served', attempt_id: null, tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: ['A','B','C','D'], option_token_map: { opt_a: 'A', opt_b: 'B', opt_c: 'C', opt_d: 'D' } },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const preSubmitStateReq: any = {
      user: { id: 'student-1' },
      params: { sessionId: '11111111-1111-4111-8111-111111111111' },
      query: { client_instance_id: 'client-a' },
    };
    const preSubmitStateRes = makeRes();
    await getReviewErrorSessionState(preSubmitStateReq, preSubmitStateRes.res);
    expect(preSubmitStateRes.getStatus()).toBe(200);
    expect(preSubmitStateRes.getBody().currentItem.question.correct_answer).toBeNull();
    expect(preSubmitStateRes.getBody().currentItem.question.explanation).toBeNull();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        session_id: '11111111-1111-4111-8111-111111111111',
        review_session_item_id: '22222222-2222-4222-8222-222222222222',
        selected_option_id: 'opt_a',
        source_context: 'review_errors',
        client_attempt_id: 'attempt-1',
        client_instance_id: 'client-a',
      },
    };

    const first = makeRes();
    await submitReviewSessionAnswer(req, first.res);
    expect(first.getStatus()).toBe(200);
    expect(first.getBody().reviewOutcome).toBe('review_pass');
    expect(first.getBody().correctOptionId).toBe('opt_a');
    expect(first.getBody().correctAnswerText).toBe('1');
    expect(first.getBody().explanation).toBe('exp');

    const second = makeRes();
    await submitReviewSessionAnswer(req, second.res);
    expect(second.getStatus()).toBe(200);
    expect(second.getBody().idempotent).toBe(true);

    const emitted = applyMasteryUpdateMock.mock.calls.map((call) => call[0].eventType);
    expect(emitted).toEqual([MasteryEventType.REVIEW_PASS]);
  });

  it('fails closed when resolved item points to another student attempt_id', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [
        {
          id: 'attempt-foreign',
          student_id: 'student-2',
          question_id: 'q-source-1',
          context: 'review_errors',
          selected_answer: 'A',
          is_correct: true,
          created_at: '2026-03-14T09:05:00.000Z',
        },
      ],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'answered', attempt_id: 'attempt-foreign', tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: ['A','B','C','D'], option_token_map: { opt_a: 'A', opt_b: 'B', opt_c: 'C', opt_d: 'D' } },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: { id: 'student-1' },
      body: {
        session_id: '11111111-1111-4111-8111-111111111111',
        review_session_item_id: '22222222-2222-4222-8222-222222222222',
        selected_option_id: 'opt_a',
        source_context: 'review_errors',
        client_instance_id: 'client-a',
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(409);
    expect(res.getBody().code).toBe('REVIEW_SESSION_ITEM_LOCKED');
  });

  it('rejects answer submit without opaque selected_option_id', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'served', attempt_id: null, tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: ['A','B','C','D'], option_token_map: { opt_a: 'A', opt_b: 'B', opt_c: 'C', opt_d: 'D' } },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: { id: 'student-1' },
      body: {
        session_id: '11111111-1111-4111-8111-111111111111',
        review_session_item_id: '22222222-2222-4222-8222-222222222222',
        selected_answer: 'A',
        source_context: 'review_errors',
        client_instance_id: 'client-a',
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().code).toBe('REVIEW_SELECTED_OPTION_REQUIRED');
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();
  });

  it('fails closed when legacy free-response field is sent to mounted review submit', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [
        { id: '22222222-2222-4222-8222-222222222222', review_session_id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', ordinal: 1, question_canonical_id: 'SATM1ABC123', source_question_id: 'q-source-1', source_question_canonical_id: 'SATM1ABC123', source_origin: 'practice', retry_mode: 'same_question', status: 'served', attempt_id: null, tutor_opened_at: null, source_attempted_at: '2026-03-14T08:00:00.000Z', option_order: ['A','B','C','D'], option_token_map: { opt_a: 'A', opt_b: 'B', opt_c: 'C', opt_d: 'D' } },
      ],
      review_session_events: [],
      questions: [
        { canonical_id: 'SATM1ABC123', status: 'published', question_type: 'multiple_choice', section: 'Math', stem: 'Q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], difficulty: 'easy', correct_answer: 'A', explanation: 'exp' },
      ],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = {
      user: { id: 'student-1' },
      body: {
        session_id: '11111111-1111-4111-8111-111111111111',
        review_session_item_id: '22222222-2222-4222-8222-222222222222',
        selected_option_id: 'opt_a',
        free_response_answer: 'A',
        source_context: 'review_errors',
        client_instance_id: 'client-a',
      },
    };

    const res = makeRes();
    await submitReviewSessionAnswer(req, res.res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody().code).toBe('REVIEW_MC_OPTION_REQUIRED');
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();
  });

  it('denies non-owner access to another student session state', async () => {
    const state: DbState = {
      answer_attempts: [],
      full_length_exam_responses: [],
      review_error_attempts: [],
      review_sessions: [
        { id: '11111111-1111-4111-8111-111111111111', student_id: 'student-1', status: 'active', started_at: '2026-03-14T09:00:00.000Z', completed_at: null, abandoned_at: null, client_instance_id: 'client-a', created_at: '2026-03-14T09:00:00.000Z', updated_at: '2026-03-14T09:00:00.000Z' },
      ],
      review_session_items: [],
      review_session_events: [],
      questions: [],
      tutor_interactions: [],
    };

    setupSupabase(state);

    const req: any = { user: { id: 'student-2' }, params: { sessionId: '11111111-1111-4111-8111-111111111111' }, query: { client_instance_id: 'client-a' } };
    const res = makeRes();
    await getReviewErrorSessionState(req, res.res);

    expect(res.getStatus()).toBe(404);
    expect(res.getBody().code).toBe('REVIEW_SESSION_NOT_FOUND');
  });
});

