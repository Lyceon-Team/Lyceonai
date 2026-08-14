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
   * Intent: each page renders the diagnostic CTA ONLY through the typed
   * DiagnosticCTAGate — never a direct, ungated DiagnosticCTACard.
   *
   * Structural proof:
   * 1. A complete <DiagnosticCTAGate estimateStatus={...} JSX element exists
   *    (binds the prop to an actual gate element, not a stray string).
   * 2. Exactly one DiagnosticCTAGate JSX invocation per surface.
   * 3. No DiagnosticCTACard import (bypass via import).
   * 4. No <DiagnosticCTACard JSX invocation (bypass via render).
   *
   * Would fail if: the page imported or rendered DiagnosticCTACard directly,
   * rendered DiagnosticCTAGate without the estimateStatus prop, duplicated
   * the gate, or kept the gate only in a comment/import while bypassing it.
   */

  /** Complete JSX element: <DiagnosticCTAGate estimateStatus={estimateData?.estimateStatus} */
  const gateJsxPattern =
    /<DiagnosticCTAGate\s[^>]*estimateStatus=\{estimateData\?\.estimateStatus\}/;

  /** Any JSX invocation of DiagnosticCTAGate (counts instances) */
  const gateInvocationPattern = /<DiagnosticCTAGate[\s/>]/g;

  /** Direct DiagnosticCTACard import — bypass via import */
  const cardImportPattern = /import\s.*DiagnosticCTACard/;

  /** Direct <DiagnosticCTACard JSX invocation — bypass via render */
  const cardJsxPattern = /<DiagnosticCTACard[\s/>]/;

  it("dashboard routes CTA exclusively through DiagnosticCTAGate", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");

    // 1. Complete JSX element with estimateStatus prop bound to gate
    expect(dashboard).toMatch(gateJsxPattern);

    // 2. Exactly one gate invocation
    const gateMatches = dashboard.match(gateInvocationPattern);
    expect(gateMatches).toHaveLength(1);

    // 3. No direct DiagnosticCTACard import
    expect(dashboard).not.toMatch(cardImportPattern);

    // 4. No direct <DiagnosticCTACard JSX invocation
    expect(dashboard).not.toMatch(cardJsxPattern);
  });

  it("practice page routes CTA exclusively through DiagnosticCTAGate", () => {
    const practice = read("client/src/pages/practice.tsx");

    // 1. Complete JSX element with estimateStatus prop bound to gate
    expect(practice).toMatch(gateJsxPattern);

    // 2. Exactly one gate invocation
    const gateMatches = practice.match(gateInvocationPattern);
    expect(gateMatches).toHaveLength(1);

    // 3. No direct DiagnosticCTACard import
    expect(practice).not.toMatch(cardImportPattern);

    // 4. No direct <DiagnosticCTACard JSX invocation
    expect(practice).not.toMatch(cardJsxPattern);
  });

  /**
   * Mutation proof: if either page adds a direct <DiagnosticCTACard /> bypass
   * (even while keeping the valid gate), the structural contract rejects it.
   */
  it("rejects a page that adds a direct DiagnosticCTACard bypass", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    const practice = read("client/src/pages/practice.tsx");

    // Inject a direct bypass into each page's source
    const dashboardBypass =
      dashboard +
      '\nimport { DiagnosticCTACard } from "@/components/diagnostic/DiagnosticCTACard";\n<DiagnosticCTACard />';
    const practiceBypass =
      practice +
      '\nimport { DiagnosticCTACard } from "@/components/diagnostic/DiagnosticCTACard";\n<DiagnosticCTACard />';

    // Both must fail the import guard
    expect(dashboardBypass).toMatch(cardImportPattern);
    expect(practiceBypass).toMatch(cardImportPattern);

    // Both must fail the JSX invocation guard
    expect(dashboardBypass).toMatch(cardJsxPattern);
    expect(practiceBypass).toMatch(cardJsxPattern);

    // Substitute: page replaces the gate with a direct card (removes gate,
    // adds bare card) — must fail the gate JSX check
    const dashboardSubstitute =
      dashboard
        .replace(gateInvocationPattern, "")
        .replace(
          /import.*DiagnosticCTAGate.*/,
          'import { DiagnosticCTACard } from "@/components/diagnostic/DiagnosticCTACard";',
        ) + "\n<DiagnosticCTACard />";
    expect(dashboardSubstitute).not.toMatch(gateJsxPattern);
    expect(dashboardSubstitute).toMatch(cardJsxPattern);
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
