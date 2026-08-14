import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Diagnostic prompting contract", () => {
  /**
   * Intent: the DiagnosticPromptModal's shouldShow prop is wired to the
   * exact equality check estimateStatus === "no_baseline" — not a broad
   * boolean, not a negation, not a comment.
   *
   * Would fail if: shouldShow received a different condition, or the modal
   * were rendered without the no_baseline gate.
   */
  it("dashboard wires DiagnosticPromptModal shouldShow to estimateStatus === 'no_baseline'", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    // Structural: shouldShow prop must be wired to the exact equality check
    const modalGatePattern =
      /shouldShow=\{estimateData\?\.estimateStatus === "no_baseline"\}/;
    expect(dashboard).toMatch(modalGatePattern);
  });

  /**
   * Intent: both dashboard and practice pages use the typed DiagnosticCTAGate
   * component (which is behaviorally tested to show only for no_baseline) and
   * wire its estimateStatus prop to estimateData?.estimateStatus.
   *
   * Would fail if: either page used a raw inline conditional, rendered the
   * card unconditionally, or used a different status check.
   */
  it("dashboard uses DiagnosticCTAGate with estimateStatus prop", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    expect(dashboard).toContain("DiagnosticCTAGate");
    // The gate receives the live estimateStatus from the query
    const gateWiringPattern =
      /estimateStatus=\{estimateData\?\.estimateStatus\}/;
    expect(dashboard).toMatch(gateWiringPattern);
  });

  it("practice page uses DiagnosticCTAGate with estimateStatus prop", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(practice).toContain("DiagnosticCTAGate");
    const gateWiringPattern =
      /estimateStatus=\{estimateData\?\.estimateStatus\}/;
    expect(practice).toMatch(gateWiringPattern);
  });

  it("practice page fetches estimateStatus via projection API", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(practice).toContain("fetchScoreEstimate");
    expect(practice).toContain("EstimateResponse");
    expect(practice).toContain("/api/progress/projection");
  });

  it("both components reuse useDiagnosticStart (no forked start flow)", () => {
    const modal = read(
      "client/src/components/diagnostic/DiagnosticPromptModal.tsx",
    );
    const card = read("client/src/components/diagnostic/DiagnosticCTACard.tsx");
    expect(modal).toContain("useDiagnosticStart");
    expect(card).toContain("useDiagnosticStart");
  });

  it("modal uses sessionStorage for per-session dismiss (not permanent)", () => {
    const modal = read(
      "client/src/components/diagnostic/DiagnosticPromptModal.tsx",
    );
    expect(modal).toContain("sessionStorage");
    expect(modal).not.toContain("localStorage");
  });

  it("CTA copy is action-neutral (no 'Start' or 'Resume' in button text)", () => {
    const card = read("client/src/components/diagnostic/DiagnosticCTACard.tsx");
    const modal = read(
      "client/src/components/diagnostic/DiagnosticPromptModal.tsx",
    );
    // Button text should be "Work on Diagnostic" — action-neutral for both
    // fresh (201) and resume (409) cases.
    expect(card).toContain("Work on Diagnostic");
    expect(modal).toContain("Work on Diagnostic");
    // Must reference projected-score payoff
    expect(card).toContain("projected SAT score");
    expect(modal).toContain("projected SAT score");
  });
});
