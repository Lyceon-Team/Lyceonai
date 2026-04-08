import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../apps/api/src/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '../apps/api/src/lib/supabase-admin';
import { applyLearningEventToMastery } from '../apps/api/src/services/mastery-write';

describe('Canonical Mastery Event Behavior', () => {
  let rpcMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

    (getSupabaseAdmin as Mock).mockReturnValue({
      rpc: rpcMock,
    });

    vi.clearAllMocks();
  });

  it('routes mastery events through apply_learning_event_to_mastery with deterministic payload', async () => {
    const input = {
      studentId: 'user-1',
      section: 'Math',
      domain: 'algebra',
      skill: 'linear_equations',
      difficulty: 2,
      sourceFamily: 'practice',
      correct: true,
      latencyMs: 42000,
      occurredAt: '2026-04-01T12:00:00.000Z',
    } as const;

    await applyLearningEventToMastery(input);
    await applyLearningEventToMastery(input);

    const rpcCalls = rpcMock.mock.calls.filter((call) => call[0] === 'apply_learning_event_to_mastery');
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0][1]).toEqual(rpcCalls[1][1]);
    expect(rpcCalls[0][1]).toMatchObject({
      p_student_id: 'user-1',
      p_section: 'Math',
      p_domain: 'algebra',
      p_skill: 'linear_equations',
      p_difficulty: 2,
      p_source_family: 'practice',
      p_correct: true,
      p_latency_ms: 42000,
      p_occurred_at: '2026-04-01T12:00:00.000Z',
    });
  });

  it('fails closed on invalid difficulty bucket and does not call RPC', async () => {
    const result = await applyLearningEventToMastery({
      studentId: 'user-2',
      section: 'Math',
      domain: 'algebra',
      skill: 'linear_equations',
      difficulty: 4 as any,
      sourceFamily: 'practice',
      correct: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid difficulty bucket');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
