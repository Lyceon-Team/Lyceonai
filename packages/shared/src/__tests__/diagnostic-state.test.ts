/**
 * @spec [Doc-05C_V1.0 §7.4; owner rulings Q1 + Q2, 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: proves the surface-status mapping. The rule that matters is the
 * one this workstream exists to enforce — a student who COMPLETED a diagnostic is
 * never told to take one — so that case is asserted directly rather than inferred
 * from the branch coverage.
 */
import { describe, it, expect } from "vitest";
import {
  resolveEstimateStatus,
  DIAGNOSTIC_STATES,
  ESTIMATE_STATUSES,
  BASELINE_PENDING_HEADLINE,
  diagnosticStateSchema,
  type DiagnosticState,
} from "../diagnostic-state.js";

const base = {
  hasBaseline: false,
  canSeeLiveProgression: false,
  hasLiveEstimate: false,
};

describe("resolveEstimateStatus", () => {
  it("gives a completed-but-uncomputed student baseline_pending, not no_baseline", () => {
    expect(
      resolveEstimateStatus({ ...base, diagnosticState: "baseline_pending" }),
    ).toBe("baseline_pending");
  });

  /**
   * THE INVARIANT. no_baseline is the status every "take the diagnostic" surface
   * is gated on, so a completed diagnostic reaching it IS the reported defect.
   * Asserted over every state rather than the one that happens to be wrong today.
   */
  it("never returns no_baseline for a state that implies a completed diagnostic", () => {
    const completedStates: DiagnosticState[] = [
      "baseline_pending",
      "baseline_ready",
    ];
    for (const diagnosticState of completedStates) {
      for (const hasBaseline of [true, false]) {
        for (const canSeeLiveProgression of [true, false]) {
          for (const hasLiveEstimate of [true, false]) {
            expect(
              resolveEstimateStatus({
                diagnosticState,
                hasBaseline,
                canSeeLiveProgression,
                hasLiveEstimate,
              }),
            ).not.toBe("no_baseline");
          }
        }
      }
    }
  });

  it("keeps no_baseline for not_taken and in_progress", () => {
    expect(
      resolveEstimateStatus({ ...base, diagnosticState: "not_taken" }),
    ).toBe("no_baseline");
    expect(
      resolveEstimateStatus({ ...base, diagnosticState: "in_progress" }),
    ).toBe("no_baseline");
  });

  /**
   * The tie-break. The two inputs are read from different places and can disagree
   * for one request; real numbers win over "being calculated".
   */
  it("prefers a present baseline over a pending state", () => {
    expect(
      resolveEstimateStatus({
        diagnosticState: "baseline_pending",
        hasBaseline: true,
        canSeeLiveProgression: true,
        hasLiveEstimate: true,
      }),
    ).toBe("computed");
  });

  it("keeps the shipped entitlement gating unchanged", () => {
    const ready = {
      diagnosticState: "baseline_ready" as const,
      hasBaseline: true,
    };
    expect(
      resolveEstimateStatus({
        ...ready,
        canSeeLiveProgression: false,
        hasLiveEstimate: true,
      }),
    ).toBe("baseline_only");
    expect(
      resolveEstimateStatus({
        ...ready,
        canSeeLiveProgression: true,
        hasLiveEstimate: false,
      }),
    ).toBe("baseline_only");
    expect(
      resolveEstimateStatus({
        ...ready,
        canSeeLiveProgression: true,
        hasLiveEstimate: true,
      }),
    ).toBe("computed");
  });

  it("emits only declared statuses across the whole input space", () => {
    for (const diagnosticState of DIAGNOSTIC_STATES) {
      for (const hasBaseline of [true, false]) {
        for (const canSeeLiveProgression of [true, false]) {
          for (const hasLiveEstimate of [true, false]) {
            expect(ESTIMATE_STATUSES).toContain(
              resolveEstimateStatus({
                diagnosticState,
                hasBaseline,
                canSeeLiveProgression,
                hasLiveEstimate,
              }),
            );
          }
        }
      }
    }
  });
});

describe("diagnosticStateSchema", () => {
  it("rejects a value outside the state set", () => {
    expect(diagnosticStateSchema.safeParse("baseline_readyish").success).toBe(
      false,
    );
    expect(diagnosticStateSchema.safeParse(null).success).toBe(false);
  });
});

describe("BASELINE_PENDING_HEADLINE", () => {
  it("is the owner-ruled sentence", () => {
    expect(BASELINE_PENDING_HEADLINE).toBe(
      "Your baseline is being calculated.",
    );
  });
});
