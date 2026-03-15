import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../apps/api/src/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '../apps/api/src/lib/supabase-admin';
import { applyMasteryUpdate } from '../apps/api/src/services/mastery-write';
import { EVENT_WEIGHTS, MasteryEventType } from '../apps/api/src/services/mastery-constants';

describe('Canonical Mastery Event Behavior', () => {
  let insertMock: ReturnType<typeof vi.fn>;
  let rpcMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    insertMock = vi.fn().mockResolvedValue({ error: null });
    rpcMock = vi.fn().mockResolvedValue({ error: null });

    (getSupabaseAdmin as Mock).mockReturnValue({
      from: vi.fn(() => ({
        insert: insertMock,
      })),
      rpc: rpcMock,
    });

    vi.clearAllMocks();
  });

  it('uses deterministic practice_pass payload for canonical skill rollup writes', async () => {
    const input = {
      userId: 'user-1',
      questionCanonicalId: 'q-1',
      sessionId: 'session-1',
      isCorrect: true,
      selectedChoice: 'A',
      timeSpentMs: 42000,
      eventType: MasteryEventType.PRACTICE_PASS,
      metadata: {
        exam: 'SAT',
        section: 'Math',
        domain: 'algebra',
        skill: 'linear_equations',
        subskill: null,
        skill_code: 'ALG-1',
        difficulty: 2,
        structure_cluster_id: null,
      },
    } as const;

    await applyMasteryUpdate(input);
    await applyMasteryUpdate(input);

    const skillCalls = rpcMock.mock.calls.filter((call) => call[0] === 'upsert_skill_mastery');
    expect(skillCalls).toHaveLength(2);
    expect(skillCalls[0][1]).toEqual(skillCalls[1][1]);
    expect(skillCalls[0][1].p_event_type).toBe(MasteryEventType.PRACTICE_PASS);
    expect(skillCalls[0][1].p_event_weight).toBe(EVENT_WEIGHTS[MasteryEventType.PRACTICE_PASS]);

    const firstInsertPayload = insertMock.mock.calls[0][0];
    expect(firstInsertPayload.event_type).toBe(MasteryEventType.PRACTICE_PASS);
  });

  it('fails closed on invalid event type and does not write canonical mastery state', async () => {
    const result = await applyMasteryUpdate({
      userId: 'user-2',
      questionCanonicalId: 'q-2',
      sessionId: null,
      isCorrect: false,
      eventType: 'tutor_view' as any,
      metadata: {
        exam: 'SAT',
        section: 'Math',
        domain: 'algebra',
        skill: 'linear_equations',
        subskill: null,
        skill_code: 'ALG-1',
        difficulty: 1,
        structure_cluster_id: 'cluster-1',
      },
    });

    expect(result.rollupUpdated).toBe(false);
    expect(result.error).toContain('Invalid event type');
    expect(insertMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('keeps review and test signals stronger than practice while preserving test anchor priority', () => {
    expect(EVENT_WEIGHTS[MasteryEventType.REVIEW_PASS]).toBeGreaterThan(
      EVENT_WEIGHTS[MasteryEventType.PRACTICE_PASS]
    );
    expect(EVENT_WEIGHTS[MasteryEventType.TEST_PASS]).toBeGreaterThan(
      EVENT_WEIGHTS[MasteryEventType.REVIEW_PASS]
    );
    expect(EVENT_WEIGHTS[MasteryEventType.TEST_PASS]).toBeGreaterThan(
      EVENT_WEIGHTS[MasteryEventType.TUTOR_HELPED]
    );
    expect(EVENT_WEIGHTS[MasteryEventType.TEST_PASS]).toBe(
      EVENT_WEIGHTS[MasteryEventType.TEST_FAIL]
    );
  });
});
