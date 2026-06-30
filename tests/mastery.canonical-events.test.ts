import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "../apps/api/src/lib/supabase-admin";
import { applyMasteryEvent } from "../apps/api/src/services/mastery-write";

describe("Canonical Mastery Event Behavior", () => {
  let rpcMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

    (getSupabaseAdmin as Mock).mockReturnValue({
      rpc: rpcMock,
    });

    vi.clearAllMocks();
  });

  it("routes mastery events through apply_mastery_event with all required params", async () => {
    const input = {
      studentId: "user-1",
      section: "Math",
      domain: "algebra",
      skill: "linear_equations",
      difficulty: 2,
      sourceFamily: "practice",
      eventSourceKind: "practice_attempt",
      correct: true,
      occurredAt: "2026-04-01T12:00:00.000Z",
      eventId: "evt-001",
      questionId: "q-001",
    } as const;

    await applyMasteryEvent(input);
    await applyMasteryEvent(input);

    const rpcCalls = rpcMock.mock.calls.filter(
      (call) => call[0] === "apply_mastery_event",
    );
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0][1]).toEqual(rpcCalls[1][1]);
    expect(rpcCalls[0][1]).toMatchObject({
      p_student_id: "user-1",
      p_section: "Math",
      p_domain: "algebra",
      p_skill: "linear_equations",
      p_difficulty: 2,
      p_source_family: "practice",
      p_event_source_kind: "practice_attempt",
      p_correct: true,
      p_occurred_at: "2026-04-01T12:00:00.000Z",
      p_event_id: "evt-001",
      p_question_id: "q-001",
    });
  });

  it("fails closed on invalid difficulty bucket and does not call RPC", async () => {
    const result = await applyMasteryEvent({
      studentId: "user-2",
      section: "Math",
      domain: "algebra",
      skill: "linear_equations",
      difficulty: 4 as unknown as 1,
      sourceFamily: "practice",
      eventSourceKind: "practice_attempt",
      correct: false,
      eventId: "evt-002",
      questionId: "q-002",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid difficulty bucket");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on missing event id", async () => {
    const result = await applyMasteryEvent({
      studentId: "user-3",
      section: "Math",
      domain: "algebra",
      skill: "linear_equations",
      difficulty: 1,
      sourceFamily: "practice",
      eventSourceKind: "practice_attempt",
      correct: true,
      eventId: "",
      questionId: "q-003",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing event id");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on missing question id", async () => {
    const result = await applyMasteryEvent({
      studentId: "user-4",
      section: "Math",
      domain: "algebra",
      skill: "linear_equations",
      difficulty: 2,
      sourceFamily: "review",
      eventSourceKind: "review_error_attempt",
      correct: false,
      eventId: "evt-004",
      questionId: "",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing question id");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on missing event source kind", async () => {
    const result = await applyMasteryEvent({
      studentId: "user-5",
      section: "Math",
      domain: "algebra",
      skill: "linear_equations",
      difficulty: 3,
      sourceFamily: "test",
      eventSourceKind: "" as unknown as "practice_attempt",
      correct: true,
      eventId: "evt-005",
      questionId: "q-005",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing event source kind");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls apply_mastery_event (not the legacy RPC name)", async () => {
    await applyMasteryEvent({
      studentId: "user-6",
      section: "RW",
      domain: "information_ideas",
      skill: "central_ideas",
      difficulty: 1,
      sourceFamily: "review",
      eventSourceKind: "review_error_attempt",
      correct: true,
      eventId: "evt-006",
      questionId: "q-006",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("apply_mastery_event");
    expect(rpcMock.mock.calls[0][0]).not.toBe(
      "apply_learning_event_to_mastery",
    );
  });
});
