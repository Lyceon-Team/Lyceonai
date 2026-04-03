import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const fetchSkillMasteryRows = vi.fn();
const buildMasterySummaryFromRows = vi.fn();
const buildMasterySkillTreeFromRows = vi.fn();
const fetchWeakestSkills = vi.fn();

vi.mock('../../apps/api/src/services/mastery-read', () => ({
  fetchSkillMasteryRows,
  buildMasterySummaryFromRows,
  buildMasterySkillTreeFromRows,
  fetchWeakestSkills,
}));

vi.mock('../../server/services/kpi-access', () => ({
  resolvePaidKpiAccessForUser: vi.fn(async () => ({
    hasPaidAccess: true,
    accountId: 'acc-paid',
    plan: 'paid',
    status: 'active',
    currentPeriodEnd: null,
    reason: 'Active paid entitlement.',
  })),
}));

async function buildApp() {
  const { masteryRouter } = await import('../../apps/api/src/routes/mastery');
  const app = express();
  app.use((req: any, _res, next) => {
    req.user = { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false };
    req.requestId ??= 'req-mastery-read';
    next();
  });
  app.use('/api/me/mastery', masteryRouter);
  return app;
}

describe('Mastery Read Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSkillMasteryRows.mockResolvedValue([
      { section: 'math', domain: 'algebra', skill: 'linear_equations', attempts: 4, correct: 2, accuracy: 0.5, mastery_score: 50 },
    ]);
    buildMasterySummaryFromRows.mockReturnValue([
      {
        section: 'math',
        totalAttempts: 4,
        totalCorrect: 2,
        overallAccuracy: 0.5,
        domainBreakdown: [{ domain: 'algebra', attempts: 4, correct: 2, accuracy: 0.5 }],
      },
    ]);
    buildMasterySkillTreeFromRows.mockReturnValue([
      { id: 'math', label: 'Math', domains: [], avgMastery: 50 },
    ]);
    fetchWeakestSkills.mockResolvedValue([
      { section: 'math', domain: 'algebra', skill: 'linear_equations', attempts: 4, correct: 2, accuracy: 0.5, mastery_score: 50 },
    ]);
  });

  it('uses canonical mastery read layer for summary', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/me/mastery/summary');

    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(1);
    expect(fetchSkillMasteryRows).toHaveBeenCalledWith({ userId: 'student-1', section: undefined });
    expect(buildMasterySummaryFromRows).toHaveBeenCalled();
  });

  it('uses canonical mastery read layer for skill tree', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/me/mastery/skills');

    expect(res.status).toBe(200);
    expect(fetchSkillMasteryRows).toHaveBeenCalledWith({ userId: 'student-1' });
    expect(buildMasterySkillTreeFromRows).toHaveBeenCalled();
  });

  it('uses canonical mastery read layer for weakest skills', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/me/mastery/weakest');

    expect(res.status).toBe(200);
    expect(fetchWeakestSkills).toHaveBeenCalledWith({
      userId: 'student-1',
      limit: 5,
      minAttempts: 2,
    });
  });
});
