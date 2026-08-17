/**
 * @spec [Doc-05C_V1.0 §7.4; owner rulings Q1 + Q2, 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: proves, through the real route handler, that a student who
 * COMPLETED the diagnostic is never told to take one — and that the surfaces
 * gated on no_baseline collapse for them.
 *
 * WHY THIS LIVES IN tests/ci AND NOT NEXT TO THE COMPONENTS
 *   No CI job runs client/src tests (`test:ci` is `vitest run tests/ci`). Three
 *   diagnostic component tests already exist under client/src and have never
 *   gated anything. Owner ruling, 2026-08-17: behavioural coverage for this step
 *   goes in tests/ci so it is actually a gate. Wiring client/src into CI is
 *   tracked separately and deliberately not bundled here.
 *
 * expected outcome: the pending student gets estimateStatus='baseline_pending'
 * with the ruled copy, and every "take the diagnostic" surface is gated on a
 * status they do not have.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resolvePaidKpiAccessForUser = vi.fn();
const buildStudentKpiViewFromCanonical = vi.fn();
const buildScoreEstimateFromCanonical = vi.fn();
const buildStudentFullLengthReportView = vi.fn((x: unknown) => x);
const readDiagnosticBaseline = vi.fn();
const readDiagnosticState = vi.fn();
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
    user: { id: "student-pending", role: "student" },
    requestId: "req-pending",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- express Request/Response
  await getScoreEstimate(req as any, res as any);
  return { status, body };
}

describe("baseline_pending — a completed diagnostic is never asked for again", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      accountId: "acc-free",
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
      reason: "free",
    });
    canAccessFeature.mockResolvedValue(false);
    // The production shape: the diagnostic completed, the baseline never landed.
    readDiagnosticBaseline.mockResolvedValue(null);
    readDiagnosticState.mockResolvedValue("baseline_pending");
  });

  it("serves baseline_pending, not no_baseline", async () => {
    const { status, body } = await callProjection();
    expect(status).toBe(200);
    expect(body.estimateStatus).toBe("baseline_pending");
    expect(body.estimateStatus).not.toBe("no_baseline");
  });

  it("carries the owner-ruled sentence and no instruction to take a diagnostic", async () => {
    const { body } = await callProjection();
    const explanations = body.explanations as Record<
      string,
      Record<string, string>
    >;
    const total = explanations.estimated_scaled_total;
    expect(total.whatThisMeans).toContain("Your baseline is being calculated.");

    const allCopy = Object.values(explanations)
      .flatMap((e) => Object.values(e))
      .join(" ")
      .toLowerCase();
    // The no_baseline branch says "Complete the diagnostic". For a student who
    // already completed one that is both false and unactionable — the start route
    // answers 409 diagnostic_already_completed.
    expect(allCopy).not.toContain("complete the diagnostic");
  });

  it("serves no numbers it does not have", async () => {
    const { body } = await callProjection();
    expect(body.estimate).toBeNull();
    expect(body.baseline).toBeNull();
  });

  /**
   * The failure mode that produced this whole workstream: a read error is
   * indistinguishable from "no baseline" inside readDiagnosticBaseline, which
   * returns null for both. A student mid-outage must not be told to retake.
   */
  it("still refuses no_baseline when the baseline read fails for a baseline_ready student", async () => {
    readDiagnosticState.mockResolvedValue("baseline_ready");
    readDiagnosticBaseline.mockResolvedValue(null);
    const { body } = await callProjection();
    expect(body.estimateStatus).toBe("baseline_pending");
  });

  it("falls back to the shipped behaviour when the state read itself fails", async () => {
    readDiagnosticState.mockResolvedValue(null);
    const { body } = await callProjection();
    expect(body.estimateStatus).toBe("no_baseline");
  });

  it("leaves a genuinely-undiagnosed student on no_baseline", async () => {
    readDiagnosticState.mockResolvedValue("not_taken");
    const { body } = await callProjection();
    expect(body.estimateStatus).toBe("no_baseline");
  });
});

/**
 * Surface wiring. These are source assertions in the same style as
 * tests/ci/diagnostic-prompting.contract.test.ts, which is the file that already
 * guards these two components — extending its approach rather than inventing a
 * second one. What they catch is a surface gated with a NEGATION
 * (`!== "computed"`, `!estimateData?.baseline`) instead of the exact status:
 * every such form shows the "take a diagnostic" prompt to a pending student.
 */
describe("surfaces gated on no_baseline collapse for a pending student", () => {
  const read = (rel: string): string =>
    readFileSync(resolve(process.cwd(), rel), "utf8");

  it("DiagnosticCTAGate renders on an exact no_baseline match", () => {
    const src = read("client/src/components/diagnostic/DiagnosticCTAGate.tsx");
    expect(src).toMatch(
      /if\s*\(estimateStatus\s*!==\s*"no_baseline"\)\s*return null;/,
    );
  });

  it("the dashboard modal is gated on an exact no_baseline match", () => {
    const src = read("client/src/pages/lyceon-dashboard.tsx");
    expect(src).toMatch(
      /shouldShow=\{estimateData\?\.estimateStatus === "no_baseline"\}/,
    );
  });

  /**
   * Ordering is the assertion. Both arms live in one ternary chain; if the
   * no_baseline arm came first it would match nothing extra today — but the arm
   * that renders "Start Diagnostic" must never be reachable for a status that
   * means the diagnostic is already done, and reading order is what guarantees
   * that as the chain grows.
   */
  it("the dashboard hero renders the pending arm before the no_baseline arm", () => {
    const src = read("client/src/pages/lyceon-dashboard.tsx");
    const pendingAt = src.indexOf('estimateStatus === "baseline_pending"');
    const noBaselineAt = src.indexOf('estimateStatus === "no_baseline" ?');
    expect(pendingAt).toBeGreaterThan(-1);
    expect(noBaselineAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeLessThan(noBaselineAt);
  });

  it("the pending arm offers no way to start another diagnostic", () => {
    const src = read("client/src/pages/lyceon-dashboard.tsx");
    const start = src.indexOf('estimateStatus === "baseline_pending"');
    const end = src.indexOf('estimateStatus === "no_baseline" ?');
    const arm = src.slice(start, end);
    expect(arm).toContain("Your baseline is being calculated.");
    expect(arm).not.toContain("handleStartDiagnostic");
    expect(arm).not.toContain("Start Diagnostic");
  });

  it("ScoreProjectionCard has a baseline_pending branch that does not prompt", () => {
    const src = read("client/src/components/progress/ScoreProjectionCard.tsx");
    const start = src.indexOf('data.estimateStatus === "baseline_pending"');
    const end = src.indexOf('data.estimateStatus === "no_baseline"');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(end);
    const arm = src.slice(start, end);
    expect(arm).toContain("Your baseline is being calculated.");
    expect(arm.toLowerCase()).not.toContain(
      "complete the\n              diagnostic",
    );
  });
});
