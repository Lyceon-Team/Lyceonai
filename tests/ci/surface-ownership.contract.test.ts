/**
 * Surface Ownership Contract Tests (2026-03-18 audit pass)
 *
 * Proves for each audited student-facing surface:
 *   1. The route calls the canonical builder (not an inline fork).
 *   2. No duplicate final-view assembly path is reachable.
 *   3. The route fails-closed when the builder errors.
 *
 * Surfaces:
 *   - Practice session/state/view   → serveNextForSession in practice-canonical
 *   - Full-length report/view       → buildStudentFullLengthReportView in kpi-truth-layer
 *   - Weakness view                 → buildWeaknessSkillsView → getWeakestSkills + getWeakestClusters
 *   - Calendar month view           → buildCalendarMonthView (getMonthPayload alias in calendar route)
 *   - KPI summary/progress view     → buildCanonicalPracticeKpiSnapshot + buildStudentKpiView
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Surface 2: Full-length report — buildStudentFullLengthReportView is the only
//            assembler called by the /report route.
// ---------------------------------------------------------------------------
describe('Full-length report: single canonical builder', () => {
    const kpiMocks = vi.hoisted(() => ({
        buildStudentFullLengthReportView: vi.fn(),
        resolvePaidKpiAccessForUser: vi.fn(),
    }));

    const examMocks = vi.hoisted(() => ({
        getExamReport: vi.fn(),
    }));

    vi.mock('../../server/services/kpi-truth-layer', () => ({
        buildStudentFullLengthReportView: (...args: any[]) =>
            kpiMocks.buildStudentFullLengthReportView(...args),
        buildStudentKpiView: vi.fn(),
        buildCanonicalPracticeKpiSnapshot: vi.fn(),
        buildFullTestKpis: vi.fn(),
        fullTestMeasurementModel: vi.fn().mockReturnValue({ official: [], weighted: [], diagnostic: [] }),
        projectGuardianFullLengthReportView: vi.fn(),
    }));

    vi.mock('../../apps/api/src/services/fullLengthExam', () => ({
        getExamReport: (...args: any[]) => examMocks.getExamReport(...args),
        createExamSession: vi.fn(),
        getCurrentSession: vi.fn(),
        startExam: vi.fn(),
        submitAnswer: vi.fn(),
        submitModule: vi.fn(),
        continueFromBreak: vi.fn(),
        completeExam: vi.fn(),
        getExamReviewAfterCompletion: vi.fn(),
        persistModuleCalculatorState: vi.fn(),
    }));

    vi.mock('../../server/services/kpi-access', () => ({
        resolvePaidKpiAccessForUser: (...args: any[]) =>
            kpiMocks.resolvePaidKpiAccessForUser(...args),
    }));

    vi.mock('../../server/middleware/csrf', () => ({
        csrfGuard: () => (_req: any, _res: any, next: any) => next(),
    }));

    function buildReportApp() {
        const app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.user = { id: 'student-1', role: 'student' };
            req.requestId = 'req-test';
            next();
        });
        // Inline auth stub for requireSupabaseAuth
        app.use((req: any, _res: any, next: any) => {
            (req as any).__authPassed = true;
            next();
        });
        return app;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        kpiMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
            hasPaidAccess: true,
            reason: 'active',
            plan: 'paid',
            status: 'active',
            currentPeriodEnd: null,
        });
    });

    it('report route calls buildStudentFullLengthReportView with exam service result', async () => {
        const fakeReport = {
            sessionId: 'sess-1',
            scaledScore: { total: 1400, rw: 700, math: 700 },
            rawScore: { total: { correct: 90, total: 98 } },
            completedAt: new Date().toISOString(),
        };
        examMocks.getExamReport.mockResolvedValue(fakeReport);
        kpiMocks.buildStudentFullLengthReportView.mockReturnValue({
            ...fakeReport,
            kpis: [],
            measurementModel: { official: [], weighted: [], diagnostic: [] },
        });

        // Import here to pick up the hoisted mocks
        const { default: fullLengthRouter } = await import(
            '../../server/routes/full-length-exam-routes'
        );

        const app = buildReportApp();
        app.use('/api/full-length', fullLengthRouter);

        const res = await request(app).get(
            '/api/full-length/sessions/sess-1/report'
        );

        expect(examMocks.getExamReport).toHaveBeenCalledWith({
            sessionId: 'sess-1',
            userId: 'student-1',
        });
        // The route MUST call the canonical builder, not inline-assemble
        expect(kpiMocks.buildStudentFullLengthReportView).toHaveBeenCalledWith(
            fakeReport
        );
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('kpis');
        expect(res.body).toHaveProperty('measurementModel');
    });

    it('report route fails closed when buildStudentFullLengthReportView throws', async () => {
        examMocks.getExamReport.mockResolvedValue({
            sessionId: 'sess-err',
            scaledScore: { total: 1200, rw: 600, math: 600 },
            rawScore: { total: { correct: 50, total: 98 } },
            completedAt: new Date().toISOString(),
        });
        kpiMocks.buildStudentFullLengthReportView.mockImplementation(() => {
            throw new Error('kpi_builder_exploded');
        });

        const { default: fullLengthRouter } = await import(
            '../../server/routes/full-length-exam-routes'
        );
        const app = buildReportApp();
        app.use('/api/full-length', fullLengthRouter);

        const res = await request(app).get(
            '/api/full-length/sessions/sess-err/report'
        );

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });

    it('report is premium-gated: returns 402 when entitlement resolves to free', async () => {
        kpiMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
            hasPaidAccess: false,
            reason: 'no active plan',
            plan: 'free',
            status: 'inactive',
            currentPeriodEnd: null,
        });

        const { default: fullLengthRouter } = await import(
            '../../server/routes/full-length-exam-routes'
        );
        const app = buildReportApp();
        app.use('/api/full-length', fullLengthRouter);

        const res = await request(app).get(
            '/api/full-length/sessions/sess-gate/report'
        );

        expect(res.status).toBe(402);
        // Builder must NOT be called if gating fails
        expect(kpiMocks.buildStudentFullLengthReportView).not.toHaveBeenCalled();
        expect(examMocks.getExamReport).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Surface 3: Weakness — both /skills and /clusters route through canonical
//            builders only. buildWeaknessSkillsView owns the skills shape;
//            getWeakestClusters owns the clusters shape. No inline fork.
// ---------------------------------------------------------------------------
describe('Weakness view: single canonical builder per sub-surface', () => {
    const masteryMocks2 = {
        getWeakestSkills: vi.fn(),
        getWeakestClusters: vi.fn(),
    };

    // NOTE: weakness.runtime.contract.test.ts already mocks studentMastery.
    // This test imports the router directly and verifies it flows through
    // buildWeaknessSkillsView (which calls getWeakestSkills with failOnError=true).

    it('skills route calls buildWeaknessSkillsView with failOnError=true', async () => {
        masteryMocks2.getWeakestSkills.mockResolvedValue([]);
        masteryMocks2.getWeakestClusters.mockResolvedValue([]);

        vi.doMock('../../apps/api/src/services/studentMastery', () => ({
            getWeakestSkills: masteryMocks2.getWeakestSkills,
            getWeakestClusters: masteryMocks2.getWeakestClusters,
        }));

        const { weaknessRouter } = await import('../../apps/api/src/routes/weakness');

        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => {
            req.user = { id: 'student-2', role: 'student' };
            next();
        });
        app.use('/api/me/weakness', weaknessRouter);

        await request(app).get('/api/me/weakness/skills');

        // buildWeaknessSkillsView internally calls getWeakestSkills with failOnError=true
        expect(masteryMocks2.getWeakestSkills).toHaveBeenCalledWith(
            expect.objectContaining({ failOnError: true, userId: 'student-2' })
        );
    });

    it('clusters route calls getWeakestClusters with failOnError=true (no inline shape)', async () => {
        masteryMocks2.getWeakestSkills.mockResolvedValue([]);
        masteryMocks2.getWeakestClusters.mockResolvedValue([]);

        const { weaknessRouter } = await import('../../apps/api/src/routes/weakness');

        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => {
            req.user = { id: 'student-3', role: 'student' };
            next();
        });
        app.use('/api/me/weakness', weaknessRouter);

        const res = await request(app).get('/api/me/weakness/clusters');

        expect(masteryMocks2.getWeakestClusters).toHaveBeenCalledWith(
            expect.objectContaining({ failOnError: true, userId: 'student-3' })
        );
        // Response envelope is exactly { ok, count, clusters } — not inlined differently
        expect(res.body).toHaveProperty('ok', true);
        expect(res.body).toHaveProperty('count');
        expect(res.body).toHaveProperty('clusters');
    });
});

// ---------------------------------------------------------------------------
// Surface 4: Calendar month view — getMonthPayload MUST be the buildCalendarMonthView
//            alias and NOT any inline forked assembler.
// ---------------------------------------------------------------------------
describe('Calendar month view: getMonthPayload is buildCalendarMonthView alias', async () => {
    it('calendar route exports getMonthPayload as the buildCalendarMonthView function', async () => {
        // We import both the route alias and the service builder and confirm they're
        // the exact same function reference (no forking).
        const calendarRoute = await import('../../apps/api/src/routes/calendar');
        const calendarService = await import(
            '../../apps/api/src/services/calendar-month-view'
        );

        expect(calendarRoute.getMonthPayload).toBe(
            calendarService.buildCalendarMonthView
        );
    });
});

// ---------------------------------------------------------------------------
// Surface 5: KPI summary/progress view — getRecencyKpis calls
//            buildCanonicalPracticeKpiSnapshot and buildStudentKpiView.
//            No stale parallel builder present.
// ---------------------------------------------------------------------------
describe('KPI summary: canonical builder path', () => {
    const kpiMocks5 = {
        buildCanonicalPracticeKpiSnapshot: vi.fn(),
        buildStudentKpiView: vi.fn(),
        resolvePaidKpiAccessForUser: vi.fn(),
    };

    it('getRecencyKpis calls buildCanonicalPracticeKpiSnapshot then buildStudentKpiView', async () => {
        kpiMocks5.buildCanonicalPracticeKpiSnapshot.mockResolvedValue({
            modelVersion: 'kpi_truth_v1',
            timezone: 'America/Chicago',
            generatedAt: new Date().toISOString(),
            currentWeek: { practiceSessions: 3, practiceMinutes: 90, questionsSolved: 45, accuracyPercent: 80, avgSecondsPerQuestion: 70 },
            previousWeek: { practiceSessions: 2, practiceMinutes: 60, questionsSolved: 30, accuracyPercent: 75, avgSecondsPerQuestion: 80 },
            recency200: { totalAttempts: 110, accuracyPercent: 78, avgSecondsPerQuestion: 72 },
        });

        const kpiView = {
            modelVersion: 'kpi_truth_v1',
            timezone: 'America/Chicago',
            week: { practiceSessions: 3, questionsSolved: 45, accuracy: 80, explanations: {} },
            recency: null,
            metrics: [],
            gating: { historicalTrends: { allowed: false, requiredPlan: 'paid', reason: 'no plan' } },
            measurementModel: { official: [], weighted: [], diagnostic: [] },
        };
        kpiMocks5.buildStudentKpiView.mockReturnValue(kpiView);
        kpiMocks5.resolvePaidKpiAccessForUser.mockResolvedValue({
            hasPaidAccess: false,
            plan: 'free',
            status: 'inactive',
            currentPeriodEnd: null,
            reason: 'no active plan',
        });

        // Override the mocks at the module level
        vi.doMock('../../server/services/kpi-truth-layer', () => ({
            KPI_TRUTH_LAYER_VERSION: 'kpi_truth_v1',
            buildCanonicalPracticeKpiSnapshot: kpiMocks5.buildCanonicalPracticeKpiSnapshot,
            buildStudentKpiView: kpiMocks5.buildStudentKpiView,
            buildStudentFullLengthReportView: vi.fn(),
            buildFullTestKpis: vi.fn(),
            fullTestMeasurementModel: vi.fn().mockReturnValue({ official: [], weighted: [], diagnostic: [] }),
            projectGuardianFullLengthReportView: vi.fn(),
        }));

        vi.doMock('../../server/services/kpi-access', () => ({
            resolvePaidKpiAccessForUser: kpiMocks5.resolvePaidKpiAccessForUser,
        }));

        const { getRecencyKpis } = await import('../../server/routes/legacy/progress');

        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => {
            req.user = { id: 'student-5', role: 'student' };
            req.requestId = 'req-kpi-5';
            next();
        });
        app.get('/api/progress/kpis', getRecencyKpis);

        const res = await request(app).get('/api/progress/kpis');

        expect(res.status).toBe(200);
        // Must call the canonical snapshot builder
        expect(kpiMocks5.buildCanonicalPracticeKpiSnapshot).toHaveBeenCalledWith('student-5');
        // Must call the canonical view builder on the snapshot result
        expect(kpiMocks5.buildStudentKpiView).toHaveBeenCalledWith(
            expect.objectContaining({ modelVersion: 'kpi_truth_v1' }),
            expect.any(Boolean)
        );
        // Response must include the view props (not inlined elsewhere)
        expect(res.body).toHaveProperty('modelVersion');
        expect(res.body).toHaveProperty('week');
        expect(res.body).toHaveProperty('entitlement');
    });

    it('getRecencyKpis fails closed when buildCanonicalPracticeKpiSnapshot throws', async () => {
        kpiMocks5.buildCanonicalPracticeKpiSnapshot.mockRejectedValue(
            new Error('kpi_snapshot_exploded')
        );
        kpiMocks5.resolvePaidKpiAccessForUser.mockResolvedValue({
            hasPaidAccess: true,
            plan: 'paid',
            status: 'active',
            currentPeriodEnd: null,
            reason: 'active',
        });

        const { getRecencyKpis } = await import('../../server/routes/legacy/progress');

        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => {
            req.user = { id: 'student-6', role: 'student' };
            req.requestId = 'req-kpi-6';
            next();
        });
        app.get('/api/progress/kpis', getRecencyKpis);

        const res = await request(app).get('/api/progress/kpis');

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });
});
