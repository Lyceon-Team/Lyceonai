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
  diagnosticProjectionStatus: null,
  canSeeLiveProgression: false,
  hasLiveEstimate: false,
};

const PROJECTION_STATUSES = [
  null,
  "computed",
  "insufficient_evidence",
] as const;

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
      for (const diagnosticProjectionStatus of PROJECTION_STATUSES) {
        for (const canSeeLiveProgression of [true, false]) {
          for (const hasLiveEstimate of [true, false]) {
            expect(
              resolveEstimateStatus({
                diagnosticState,
                diagnosticProjectionStatus,
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
    for (const canSeeLiveProgression of [true, false]) {
      for (const hasLiveEstimate of [true, false]) {
        for (const diagnosticState of ["not_taken", "in_progress"] as const) {
          expect(
            resolveEstimateStatus({
              ...base,
              diagnosticState,
              canSeeLiveProgression,
              hasLiveEstimate,
            }),
          ).toBe("no_baseline");
        }
      }
    }
  });

  /**
   * The tie-break. The state read and the stored rows are read separately and can disagree for
   * one request; a stored row only exists for a completed diagnostic, so it wins.
   */
  it("treats a stored diagnostic row as proof the diagnostic is done (free)", () => {
    expect(
      resolveEstimateStatus({
        ...base,
        diagnosticState: "not_taken",
        diagnosticProjectionStatus: "computed",
      }),
    ).toBe("baseline_only");
    expect(
      resolveEstimateStatus({
        ...base,
        diagnosticState: "in_progress",
        diagnosticProjectionStatus: "insufficient_evidence",
      }),
    ).toBe("insufficient_evidence");
  });

  /** SCL-235: free sees only the stored diagnostic projection. */
  it("free: the stored diagnostic projection decides, the live one never does", () => {
    for (const hasLiveEstimate of [true, false]) {
      const free = {
        diagnosticState: "baseline_ready" as const,
        canSeeLiveProgression: false,
        hasLiveEstimate,
      };
      expect(
        resolveEstimateStatus({
          ...free,
          diagnosticProjectionStatus: "computed",
        }),
      ).toBe("baseline_only");
      expect(
        resolveEstimateStatus({
          ...free,
          diagnosticProjectionStatus: "insufficient_evidence",
        }),
      ).toBe("insufficient_evidence");
      expect(
        resolveEstimateStatus({ ...free, diagnosticProjectionStatus: null }),
      ).toBe("baseline_pending");
    }
  });

  /** SCL-235 / ruling 4: paid sees only the live projection; the stored one is ignored. */
  it("paid: the live projection decides, the stored diagnostic one never does", () => {
    for (const diagnosticProjectionStatus of PROJECTION_STATUSES) {
      const paid = {
        diagnosticState: "baseline_ready" as const,
        diagnosticProjectionStatus,
        canSeeLiveProgression: true,
      };
      expect(resolveEstimateStatus({ ...paid, hasLiveEstimate: true })).toBe(
        "computed",
      );
      expect(resolveEstimateStatus({ ...paid, hasLiveEstimate: false })).toBe(
        "insufficient_evidence",
      );
    }
  });

  it("emits only declared statuses across the whole input space", () => {
    for (const diagnosticState of DIAGNOSTIC_STATES) {
      for (const diagnosticProjectionStatus of PROJECTION_STATUSES) {
        for (const canSeeLiveProgression of [true, false]) {
          for (const hasLiveEstimate of [true, false]) {
            expect(ESTIMATE_STATUSES).toContain(
              resolveEstimateStatus({
                diagnosticState,
                diagnosticProjectionStatus,
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
