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

  it('uses deterministic PRACTICE_SUBMIT payload for canonical skill rollup writes', async () => {
    const input = {
      userId: 'user-1',
      questionCanonicalId: 'q-1',
      sessionId: 'session-1',
      isCorrect: true,
      selectedChoice: 'A',
      timeSpentMs: 42000,
      eventType: MasteryEventType.PRACTICE_SUBMIT,
      metadata: {
        exam: 'SAT',
        section: 'Math',
        domain: 'algebra',
        skill: 'linear_equations',
        subskill: null,
        difficulty_bucket: 'medium',
        structure_cluster_id: null,
      },
    } as const;

    await applyMasteryUpdate(input);
    await applyMasteryUpdate(input);

    const skillCalls = rpcMock.mock.calls.filter((call) => call[0] === 'upsert_skill_mastery');
    expect(skillCalls).toHaveLength(2);
    expect(skillCalls[0][1]).toEqual(skillCalls[1][1]);
    expect(skillCalls[0][1].p_event_type).toBe(MasteryEventType.PRACTICE_SUBMIT);
    expect(skillCalls[0][1].p_event_weight).toBe(EVENT_WEIGHTS[MasteryEventType.PRACTICE_SUBMIT]);
  });

  it('tutor open (TUTOR_VIEW) logs attempt but performs no mastery rollup mutation', async () => {
    await applyMasteryUpdate({
      userId: 'user-2',
      questionCanonicalId: 'q-2',
      sessionId: null,
      isCorrect: false,
      eventType: MasteryEventType.TUTOR_VIEW,
      metadata: {
        exam: 'SAT',
        section: 'Math',
        domain: 'algebra',
        skill: 'linear_equations',
        subskill: null,
        difficulty_bucket: 'easy',
        structure_cluster_id: 'cluster-1',
      },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('full-length event remains distinct and higher-trust than practice', () => {
    expect(EVENT_WEIGHTS[MasteryEventType.FULL_LENGTH_SUBMIT]).toBeGreaterThan(
      EVENT_WEIGHTS[MasteryEventType.PRACTICE_SUBMIT]
    );
    expect(EVENT_WEIGHTS[MasteryEventType.FULL_LENGTH_SUBMIT]).toBeGreaterThan(
      EVENT_WEIGHTS[MasteryEventType.TUTOR_RETRY_SUBMIT]
    );
    expect(EVENT_WEIGHTS[MasteryEventType.FULL_LENGTH_SUBMIT]).not.toBe(
      EVENT_WEIGHTS[MasteryEventType.PRACTICE_SUBMIT]
    );
  });
});
