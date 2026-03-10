/**
 * Practice Contract Validation Test
 * 
 * Validates the Wave 1.3 Practice Runtime Contract:
 * 1. Refresh resumes the same unanswered item (deterministic session state)
 * 2. Duplicate answer submit returns prior result (idempotency)
 * 3. Second tab gets conflict behavior using client_instance_id
 * 4. No correct_answer or explanation pre-submit (anti-leak)
 * 5. No duplicate items on resume
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express, Request, Response, NextFunction } from 'express';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000000';

// Mock supabaseServer module
vi.mock('../../apps/api/src/lib/supabase-server', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        supabaseServer: {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(),
            single: vi.fn(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
        }
    };
});

describe('Practice Runtime Contract', () => {
    let app: Express;

    const mockQuestion = {
        id: '00000000-0000-0000-0000-000000000001',
        section: 'Math',
        stem: 'What is 1+1?',
        type: 'mc',
        options: JSON.stringify([{ key: 'A', text: '2' }, { key: 'B', text: '3' }]),
        answer_choice: 'A',
        explanation: '1+1=2',
        created_at: new Date().toISOString()
    };

    const mockSession = {
        id: '00000000-0000-0000-0000-000000000002',
        user_id: TEST_USER_ID,
        section: 'Math',
        status: 'in_progress',
        metadata: { client_instance_id: 'tab1', active_question_id: '00000000-0000-0000-0000-000000000001' }
    };

    function createMockBuilder() {
        const builder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            then: vi.fn().mockImplementation(function (cb: any) {
                return Promise.resolve(cb({ data: [], error: null }));
            })
        };
        return builder;
    }

    beforeAll(async () => {
        process.env.VITEST = 'true';
        process.env.NODE_ENV = 'test';

        // Mock auth
        const authModule = await import('../../server/middleware/supabase-auth');
        vi.spyOn(authModule, 'supabaseAuthMiddleware').mockImplementation(
            (req: Request, res: Response, next: NextFunction) => {
                (req as any).user = { id: TEST_USER_ID, email: 'contract-test@example.com', role: 'student' };
                next();
            }
        );
        vi.spyOn(authModule, 'requireSupabaseAuth').mockImplementation((req, res, next) => next());
        vi.spyOn(authModule, 'requireStudentOrAdmin').mockImplementation((req, res, next) => next());

        const serverModule = await import('../../server/index');
        app = serverModule.default;
    });

    afterAll(async () => {
        delete process.env.VITEST;
        vi.restoreAllMocks();
    });

    it('CONTRACT-001: should neutralize correct_answer and explanation in /next (anti-leak)', async () => {
        (supabaseServer.from as any).mockImplementation((table: string) => {
            const builder = createMockBuilder();
            if (table === 'practice_sessions') {
                builder.maybeSingle.mockResolvedValue({ data: null, error: null }); // Force new session
                builder.single.mockResolvedValue({ data: mockSession, error: null }); // insert().select().single()
            } else if (table === 'questions') {
                // pickRandomQuestion pool
                builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [mockQuestion], error: null })));
            } else if (table === 'answer_attempts') {
                builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [], error: null })));
            }
            return builder;
        });

        const res = await request(app)
            .get('/api/practice/next?section=math&client_instance_id=tab1')
            .set('Origin', 'http://localhost:5000');

        expect(res.status).toBe(200);
        expect(res.body.question).toBeDefined();
        expect(res.body.question.correct_answer).toBeNull();
        expect(res.body.question.explanation).toBeNull();
        expect(res.body.question.answer_choice).toBeUndefined();
    });

    it('CONTRACT-002: should resume the same unanswered item on refresh', async () => {
        (supabaseServer.from as any).mockImplementation((table: string) => {
            const builder = createMockBuilder();
            if (table === 'practice_sessions') {
                builder.maybeSingle.mockResolvedValue({ data: mockSession, error: null });
                builder.update.mockResolvedValue({ error: null });
            } else if (table === 'answer_attempts') {
                builder.maybeSingle.mockResolvedValue({ data: null, error: null }); // Unanswered
                builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [], error: null }))); // getSessionStats
            } else if (table === 'questions') {
                builder.single.mockResolvedValue({ data: mockQuestion, error: null });
            }
            return builder;
        });

        const res2 = await request(app)
            .get('/api/practice/next?section=math&client_instance_id=tab1')
            .set('Origin', 'http://localhost:5000');

        expect(res2.body.sessionId).toBe(mockSession.id);
        expect(res2.body.question.id).toBe(mockQuestion.id);
    });

    it('CONTRACT-003: should return 409 Conflict when second tab attempts submission', async () => {
        const sessionTakenOver = { ...mockSession, metadata: { client_instance_id: 'tab2' } };

        (supabaseServer.from as any).mockImplementation((table: string) => {
            const builder = createMockBuilder();
            if (table === 'practice_sessions') {
                builder.single.mockResolvedValue({ data: sessionTakenOver, error: null });
            } else if (table === 'answer_attempts') {
                builder.maybeSingle.mockResolvedValue({ data: null, error: null }); // Not already answered
            } else if (table === 'questions') {
                builder.single.mockResolvedValue({ data: mockQuestion, error: null });
            }
            return builder;
        });

        const res3 = await request(app)
            .post('/api/practice/answer')
            .set('Origin', 'http://localhost:5000')
            .send({
                sessionId: mockSession.id,
                questionId: mockQuestion.id,
                selectedAnswer: 'A',
                client_instance_id: 'tab1'
            });

        expect(res3.status).toBe(409);
        expect(res3.body.error).toBe('conflict');
    });

    it('CONTRACT-004: should be idempotent for duplicate answer submissions', async () => {
        const idempotencyKey = 'ik-fixed';
        const successfulAttempt = { is_correct: true, outcome: 'correct', attempted_at: new Date().toISOString() };

        (supabaseServer.from as any).mockImplementation((table: string) => {
            const builder = createMockBuilder();
            if (table === 'practice_sessions') {
                builder.single.mockResolvedValue({ data: mockSession, error: null });
            } else if (table === 'questions') {
                builder.single.mockResolvedValue({ data: mockQuestion, error: null });
            } else if (table === 'answer_attempts') {
                builder.insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } });
                builder.single.mockResolvedValue({ data: successfulAttempt, error: null });
                builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [successfulAttempt], error: null }))); // getSessionStats
            }
            return builder;
        });

        const submit2 = await request(app)
            .post('/api/practice/answer')
            .set('Origin', 'http://localhost:5000')
            .send({
                sessionId: mockSession.id,
                questionId: mockQuestion.id,
                selectedAnswer: 'A',
                idempotencyKey,
                client_instance_id: 'tab1'
            });

        expect(submit2.status).toBe(200);
        expect(submit2.body.isCorrect).toBe(true);
        expect(submit2.body.idempotentRetried).toBe(true);
    });
});
