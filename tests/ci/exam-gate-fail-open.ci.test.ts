/**
 * @spec [Doc-03B_V4.1 §3.4, INV-03-02, SCL-032, SCL-079]
 * @implemented 2026-09-01
 *
 * plain English: CI gate for SCL-079 — the live exam gate fails OPEN on query
 * error. Four cases prove the contract:
 *
 *   1. Table absent / query error → allow (fail OPEN), warning logged.
 *   2. Table present, active exam row → block (INV-03-02 enforced).
 *   3. Table present, no active exam row → allow.
 *   4. Query throws for any reason → allow (fail OPEN), warning logged.
 *
 * This is a narrow, stated exception (SCL-079). Every other fail-closed gate
 * on the LISA surface stays closed. Do not generalise this pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock supabase BEFORE importing the service — vi.hoisted so the factory
// closures can reference these fns (vi.mock is hoisted above imports).
// ---------------------------------------------------------------------------

const {
  mockMaybeSingle,
  mockLimit,
  mockEqStatus,
  mockEqUserId,
  mockSelect,
  mockFrom,
  warnSpy,
} = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockEqStatus = vi.fn(() => ({ limit: mockLimit }));
  const mockEqUserId = vi.fn(() => ({ eq: mockEqStatus }));
  const mockSelect = vi.fn(() => ({ eq: mockEqUserId }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const warnSpy = vi.fn();
  return {
    mockMaybeSingle,
    mockLimit,
    mockEqStatus,
    mockEqUserId,
    mockSelect,
    mockFrom,
    warnSpy,
  };
});

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { from: mockFrom },
}));

vi.mock("../../server/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: warnSpy,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { EntitlementService } from "../../server/services/entitlement-service";

// ---------------------------------------------------------------------------
// SCL-079: exam gate fail-open contract
// ---------------------------------------------------------------------------

describe("SCL-079: isLiveExamInProgress fail-open contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Case 1: Table absent / query error → ALLOW, warning logged
  it("query error (e.g. missing table) → returns false (allow), logs warning", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "public.full_length_exam_sessions" does not exist',
        code: "42P01",
      },
    });

    const result = await EntitlementService.isLiveExamInProgress("student-123");

    expect(result).toBe(false); // fail OPEN — allow the turn
    expect(warnSpy).toHaveBeenCalledWith(
      "ENTITLEMENT",
      "live_exam_check_failed_open",
      expect.stringContaining("failing OPEN per SCL-079"),
      expect.objectContaining({
        studentId: "student-123",
        code: "42P01",
      }),
    );
  });

  // Case 2: Table present, active exam row → BLOCK (INV-03-02)
  it("active exam found → returns true (block)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "exam-abc" },
      error: null,
    });

    const result = await EntitlementService.isLiveExamInProgress("student-123");

    expect(result).toBe(true); // block — exam in progress
    expect(warnSpy).not.toHaveBeenCalled(); // no warning on success
  });

  // Case 3: Table present, no active exam row → ALLOW
  it("no active exam → returns false (allow)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await EntitlementService.isLiveExamInProgress("student-123");

    expect(result).toBe(false); // allow — no exam
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // Case 4: Query throws (connection error, etc.) → ALLOW, warning logged
  it("connection error → returns false (allow), logs warning", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        message: "connection refused",
        code: "ECONNREFUSED",
      },
    });

    const result = await EntitlementService.isLiveExamInProgress("student-123");

    expect(result).toBe(false); // fail OPEN
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  // Edge: missing studentId still fails closed (programming error)
  it("missing studentId → returns true (fail closed — programming error)", async () => {
    const result = await EntitlementService.isLiveExamInProgress("");

    expect(result).toBe(true); // fail closed
    expect(mockFrom).not.toHaveBeenCalled(); // no query attempted
  });

  // Structural: queries the correct table and column
  it("queries full_length_exam_sessions with user_id column", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await EntitlementService.isLiveExamInProgress("student-xyz");

    expect(mockFrom).toHaveBeenCalledWith("full_length_exam_sessions");
    expect(mockSelect).toHaveBeenCalledWith("id");
    expect(mockEqUserId).toHaveBeenCalledWith("user_id", "student-xyz");
    expect(mockEqStatus).toHaveBeenCalledWith("status", "in_progress");
  });
});
