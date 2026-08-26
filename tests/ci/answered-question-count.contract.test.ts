/**
 * @spec [Doc-05C_V1.0 §7.4; Doc-01_V8 product pillar: honest progress signals;
 *        owner ruling 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: proves the answered-question count is TRUE in every branch of
 * /api/progress/projection, not just the paid one.
 *
 * WHAT IT CATCHES
 *   The shipped behaviour hardcoded 0 in three of the four branches, so a student
 *   who had answered forty questions was told they had answered none. The
 *   assertion is written over EVERY branch rather than the three that were wrong,
 *   because the next branch added is the one that will get it wrong again.
 *
 *   MUTATION: replace `answeredQuestionCount` with `0` in any branch — the branch
 *   loop below reds on that branch by name.
 *
 * expected outcome: a student with N answered items reports N whatever their
 * entitlement or diagnostic state; a student whose count could not be read
 * reports null, never 0.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePaidKpiAccessForUser = vi.fn();
const buildStudentKpiViewFromCanonical = vi.fn();
const buildScoreEstimateFromCanonical = vi.fn();
const buildStudentFullLengthReportView = vi.fn((x: unknown) => x);
const readDiagnosticBaseline = vi.fn();
const readDiagnosticState = vi.fn();
const readAnsweredQuestionCount = vi.fn();
const canAccessFeature = vi.fn();

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser,
}));

vi.mock("../../server/services/canonical-runtime-views", () => ({
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
  buildStudentFullLengthReportView,
  readDiagnosticBaseline,
  readDiagnosticState,
  readAnsweredQuestionCount,
}));

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature,
    isEntitlementActiveForProfile: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

type JsonBody = Record<string, unknown>;

const BASELINE = {
  composite: 1000,
  math: 500,
  rw: 500,
  range: { low: 940, high: 1060 },
  confidence: 0.6,
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const LIVE_ESTIMATE = {
  composite: 1120,
  math: 560,
  rw: 560,
  range: { low: 1060, high: 1180 },
  confidence: 0.7,
};

/**
 * The four branches, each set up by the inputs that actually reach it. Naming
 * them here is what makes a failure say WHICH surface lies.
 */
const BRANCHES = [
  {
    status: "baseline_pending",
    arrange: () => {
      readDiagnosticState.mockResolvedValue("baseline_pending");
      readDiagnosticBaseline.mockResolvedValue(null);
      canAccessFeature.mockResolvedValue(false);
    },
  },
  {
    status: "no_baseline",
    arrange: () => {
      readDiagnosticState.mockResolvedValue("not_taken");
      readDiagnosticBaseline.mockResolvedValue(null);
      canAccessFeature.mockResolvedValue(false);
    },
  },
  {
    status: "baseline_only",
    arrange: () => {
      readDiagnosticState.mockResolvedValue("baseline_ready");
      readDiagnosticBaseline.mockResolvedValue(BASELINE);
      canAccessFeature.mockResolvedValue(false);
    },
  },
  {
    status: "computed",
    arrange: () => {
      readDiagnosticState.mockResolvedValue("baseline_ready");
      readDiagnosticBaseline.mockResolvedValue(BASELINE);
      canAccessFeature.mockResolvedValue(true);
      buildScoreEstimateFromCanonical.mockResolvedValue({
        status: "computed",
        estimate: LIVE_ESTIMATE,
        // Deliberately DIFFERENT from the real count. This figure comes from
        // student_overall_kpi.events_total, a mastery rollup that was empty for
        // every student for seven weeks; if the paid branch still read it, this
        // test would see 7 where it expects 40.
        totalQuestionsAttempted: 7,
        lastUpdated: "2026-08-17T00:00:00.000Z",
      });
    },
  },
] as const;

async function callProjection(): Promise<{ status: number; body: JsonBody }> {
  const { getScoreEstimate } =
    await import("../../server/routes/legacy/progress");

  let status = 200;
  let body: JsonBody = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: JsonBody) {
      body = payload;
      return this;
    },
  };
  const req = {
    user: { id: "student-counted", role: "student" },
    requestId: "req-count",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- express Request/Response
  await getScoreEstimate(req as any, res as any);
  return { status, body };
}

describe("totalQuestionsAttempted is the true count in every branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      accountId: "acc",
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
      reason: "free",
    });
  });

  for (const branch of BRANCHES) {
    it(`reports 40 for a student with 40 answered items — ${branch.status}`, async () => {
      branch.arrange();
      readAnsweredQuestionCount.mockResolvedValue(40);

      const { status, body } = await callProjection();

      expect(status).toBe(200);
      expect(body.estimateStatus).toBe(branch.status);
      expect(body.totalQuestionsAttempted).toBe(40);
    });

    it(`reports null, never 0, when the count cannot be read — ${branch.status}`, async () => {
      branch.arrange();
      readAnsweredQuestionCount.mockResolvedValue(null);

      const { body } = await callProjection();

      expect(body.estimateStatus).toBe(branch.status);
      expect(body.totalQuestionsAttempted).toBeNull();
      // The distinction is the whole point: 0 is a claim about the student, null
      // is an admission about the read.
      expect(body.totalQuestionsAttempted).not.toBe(0);
    });
  }

  it("still reports a genuine zero as zero", async () => {
    BRANCHES[1].arrange();
    readAnsweredQuestionCount.mockResolvedValue(0);

    const { body } = await callProjection();

    expect(body.totalQuestionsAttempted).toBe(0);
  });

  /**
   * The count is read once per request and used by every branch. If a future
   * change reads it per-branch, two branches can disagree within one response.
   */
  it("reads the count exactly once per request", async () => {
    BRANCHES[3].arrange();
    readAnsweredQuestionCount.mockResolvedValue(40);

    await callProjection();

    expect(readAnsweredQuestionCount).toHaveBeenCalledTimes(1);
    expect(readAnsweredQuestionCount).toHaveBeenCalledWith("student-counted");
  });
});
