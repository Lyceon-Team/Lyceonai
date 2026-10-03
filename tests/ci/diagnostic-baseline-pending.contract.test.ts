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
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const resolvePaidKpiAccessForUser = vi.fn();
const buildStudentKpiViewFromCanonical = vi.fn();
const buildScoreEstimateFromCanonical = vi.fn();
// E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
// pending Doc 04 rebuild. Dead full-length mocks (buildStudentFullLengthReportView)
// removed; they stubbed deleted exports and fed no assertion here.
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
    readAnsweredQuestionCount.mockResolvedValue(40);
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

  /**
   * UI-50 (2026-10-03): Home replaced the dashboard hero, its prompt modal and its CTA card.
   * The free Home's stage is decided by ONE function, `freeHomeStage`, and the pending arm is
   * decided before the no_baseline arm, so a student whose diagnostic is done never reaches the
   * arm that offers "Start diagnostic". Behaviour, then reading order.
   */
  it("Home decides baseline_pending before no_baseline, and pending offers no diagnostic", async () => {
    const { freeHomeStage } =
      await import("../../client/src/components/home/home-model");
    expect(freeHomeStage("baseline_pending")).toBe("pending");
    expect(freeHomeStage("no_baseline")).toBe("diagnostic");

    const src = read("client/src/components/home/home-model.ts");
    const pendingAt = src.indexOf('estimateStatus === "baseline_pending"');
    const noBaselineAt = src.indexOf('estimateStatus === "no_baseline")');
    expect(pendingAt).toBeGreaterThan(-1);
    expect(noBaselineAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeLessThan(noBaselineAt);

    // The only "Start diagnostic" on Home sits under the diagnostic stage.
    // Code only: the module comment names the route and the button it describes.
    const home = read("client/src/components/home/FreeHome.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const cardAt = home.indexOf('stage === "diagnostic" ? (');
    const startAt = home.indexOf("Start diagnostic");
    expect(cardAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(cardAt);
    expect(home.split("Start diagnostic").length - 1).toBe(1);
    expect(home.split("void startDiagnostic()").length - 1).toBe(1);
  });

  it("Home's panel says the ruled pending sentence (the shared constant)", () => {
    const panel = read("client/src/components/home/HomePanel.tsx");
    expect(panel).toContain("BASELINE_PENDING_HEADLINE");
    expect(panel).toMatch(
      /stage === "pending"\)\s*empty = BASELINE_PENDING_HEADLINE/,
    );
  });

  /**
   * @spec [Doc-05C_V1.0 §7.4; register UI-06] | @implemented [2026-09-29]
   * plain English: this used to read `ScoreProjectionCard.tsx`, the second
   * surface with a no_baseline render arm. UI-06 deleted that card (it had no
   * importer). The rule it pinned is about ANY surface, so it is now a sweep:
   * every client module that renders an arm on `estimateStatus === "no_baseline"`
   * (a ternary `?` or an `if (...)`) must carry a `baseline_pending` arm BEFORE
   * it, so a student whose diagnostic is done never falls through to the prompt.
   * A new or revived estimate surface is caught without editing this test.
   * (The dashboard's `shouldShow={... === "no_baseline"}` modal gate went with the modal in
   * UI-50; Home's stage function is pinned above.)
   */
  it("every client surface with a no_baseline render arm has a baseline_pending arm before it", () => {
    const noBaselineArm = /estimateStatus\s*===\s*"no_baseline"\s*[?)]/;
    const pendingArm = /estimateStatus\s*===\s*"baseline_pending"/;
    const surfaces = (
      readdirSync(resolve(process.cwd(), "client/src"), {
        recursive: true,
        encoding: "utf8",
      }) as string[]
    )
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel))
      .map((rel) => ({
        rel,
        code: read(`client/src/${rel}`)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, ""),
      }))
      .filter(({ code }) => noBaselineArm.test(code));

    // Presence before absence: Home's stage function is such a surface (UI-50; it replaced
    // the dashboard hero), so an empty sweep means the pattern broke, not that the rule holds.
    expect(surfaces.map((s) => s.rel)).toContain(
      "components/home/home-model.ts",
    );

    for (const { rel, code } of surfaces) {
      const pendingAt = code.search(pendingArm);
      expect(pendingAt, `${rel} has no baseline_pending arm`).toBeGreaterThan(
        -1,
      );
      expect(
        pendingAt,
        `${rel} renders no_baseline before baseline_pending`,
      ).toBeLessThan(code.search(noBaselineArm));
    }
  });
});
