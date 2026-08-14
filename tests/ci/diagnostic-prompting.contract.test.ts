import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Diagnostic prompting contract", () => {
  it("dashboard wires DiagnosticPromptModal gated on no_baseline", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    expect(dashboard).toContain("DiagnosticPromptModal");
    expect(dashboard).toContain('"no_baseline"');
  });

  it("dashboard wires DiagnosticCTACard gated on no_baseline", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    expect(dashboard).toContain("DiagnosticCTACard");
    expect(dashboard).toContain('"no_baseline"');
  });

  it("practice page wires DiagnosticCTACard gated on no_baseline", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(practice).toContain("DiagnosticCTACard");
    expect(practice).toContain('"no_baseline"');
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
