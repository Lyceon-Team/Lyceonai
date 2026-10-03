import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Diagnostic prompting contract", () => {
  /**
   * Intent: Home's diagnostic card (UI-50, which replaced the dashboard's DiagnosticPromptModal
   * and DiagnosticCTAGate on 2026-10-03) shows for exactly `estimateStatus === "no_baseline"`,
   * and a finished diagnostic (`baseline_pending`, `baseline_only`, `computed`) never shows it.
   * The stage function is the card's only gate (`FreeHome.tsx` renders the card under
   * `stage === "diagnostic"`, pinned below).
   *
   * Would fail if: the card were offered on any other status, or on an unknown one.
   */
  it("Home shows the diagnostic card for estimateStatus === 'no_baseline' only", async () => {
    const { freeHomeStage } =
      await import("../../client/src/components/home/home-model");
    expect(freeHomeStage("no_baseline")).toBe("diagnostic");
    for (const status of [
      "baseline_pending",
      "baseline_only",
      "computed",
      undefined,
    ] as const) {
      expect(freeHomeStage(status)).not.toBe("diagnostic");
    }
    // Code only: the module comment names the route and the button it describes.
    const home = read("client/src/components/home/FreeHome.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(home).toMatch(/stage === "diagnostic" \? \(\s*<section/);
    expect(home.match(/data-testid="home-diagnostic"/g)?.length).toBe(1);
  });

  /**
   * Intent: neither page may import or render the diagnostic CTA card outside
   * the gate — regardless of aliasing, whitespace, or multiline formatting.
   *
   * Structural proof (reusable validator):
   * 1. A complete <DiagnosticCTAGate estimateStatus={...} JSX element exists
   *    (binds the prop to an actual gate element, not a stray string).
   * 2. Exactly one DiagnosticCTAGate JSX invocation per surface.
   * 3. No import of the DiagnosticCTACard MODULE PATH — the path is unforgeable;
   *    you can alias the symbol but not the path, so a path-based prohibition
   *    catches aliased imports that a symbol-name regex would miss.
   * 4. No <DiagnosticCTACard JSX invocation (un-aliased direct render).
   *    Aliased renders are already blocked at the import: if the module path
   *    can't be imported, there's no alias to render.
   *
   * Would fail if: the page imported the card module (aliased or not), rendered
   * DiagnosticCTACard directly, rendered DiagnosticCTAGate without the
   * estimateStatus prop, or duplicated the gate.
   */

  // ── Patterns ──────────────────────────────────────────────────────────

  /** Complete JSX element: <DiagnosticCTAGate estimateStatus={estimateData?.estimateStatus} */
  const gateJsxPattern =
    /<DiagnosticCTAGate\s[^>]*estimateStatus=\{estimateData\?\.estimateStatus\}/;

  /** Any JSX invocation of DiagnosticCTAGate (counts instances) */
  const gateInvocationPattern = /<DiagnosticCTAGate[\s/>]/g;

  /**
   * The unforgeable module path for the card component. Any import of the
   * card — aliased or not, single-line or multiline — MUST reference this
   * path string. Prohibiting the path catches every alias variant.
   */
  const CARD_MODULE_PATH = "@/components/diagnostic/DiagnosticCTACard";

  /** Direct <DiagnosticCTACard JSX invocation — un-aliased bypass via render */
  const cardJsxPattern = /<DiagnosticCTACard[\s/>]/;

  // ── Reusable validator ────────────────────────────────────────────────

  type ExclusiveRouteResult = { pass: true } | { pass: false; reason: string };

  /**
   * Validates that `source` routes the diagnostic CTA exclusively through
   * DiagnosticCTAGate. Returns { pass: true } or { pass: false, reason }.
   * The mutation proof exercises this same function.
   */
  function validateExclusiveGateRouting(source: string): ExclusiveRouteResult {
    // 1. Complete JSX element with estimateStatus prop bound to gate
    if (!gateJsxPattern.test(source)) {
      return {
        pass: false,
        reason:
          "Missing <DiagnosticCTAGate estimateStatus={estimateData?.estimateStatus}> JSX element",
      };
    }

    // 2. Exactly one gate invocation
    const gateMatches = source.match(gateInvocationPattern);
    if (!gateMatches || gateMatches.length !== 1) {
      return {
        pass: false,
        reason: `Expected exactly 1 DiagnosticCTAGate JSX invocation, found ${gateMatches?.length ?? 0}`,
      };
    }

    // 3. No import of the card MODULE PATH (unforgeable — catches aliases)
    if (source.includes(CARD_MODULE_PATH)) {
      return {
        pass: false,
        reason: `Page imports the card module path "${CARD_MODULE_PATH}" — bypass via import`,
      };
    }

    // 4. No direct <DiagnosticCTACard JSX invocation (un-aliased render)
    if (cardJsxPattern.test(source)) {
      return {
        pass: false,
        reason:
          "Page contains a direct <DiagnosticCTACard> JSX invocation — bypass via render",
      };
    }

    return { pass: true };
  }

  // ── Contract assertions ───────────────────────────────────────────────

  it("Home never imports or renders the ungated DiagnosticCTACard", () => {
    // UI-50: Home draws its own diagnostic card (DESIGN.md §4), gated by `freeHomeStage`
    // above, so it carries no DiagnosticCTAGate; the card module must still not appear.
    for (const file of [
      "client/src/pages/lyceon-dashboard.tsx",
      "client/src/components/home/FreeHome.tsx",
      "client/src/components/home/PaidHome.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain(CARD_MODULE_PATH);
      expect(cardJsxPattern.test(source), file).toBe(false);
    }
  });

  it("practice page routes CTA exclusively through DiagnosticCTAGate", () => {
    const practice = read("client/src/pages/practice.tsx");
    const result = validateExclusiveGateRouting(practice);
    expect(result).toEqual({ pass: true });
  });

  // ── Mutation proofs ───────────────────────────────────────────────────

  /**
   * Mutation proof: exercises the SAME validator to prove it rejects every
   * bypass variant — un-aliased, aliased (multiline), and substitution.
   */
  it("rejects a page that adds a direct DiagnosticCTACard bypass", () => {
    // The practice page is the surface that still routes through the gate (UI-50 moved Home
    // off it), so the mutations are applied to it.
    const dashboard = read("client/src/pages/practice.tsx");

    // ── Un-aliased bypass: single-line import + direct render ──
    const unaliasedBypass =
      dashboard +
      `\nimport { DiagnosticCTACard } from "${CARD_MODULE_PATH}";\n<DiagnosticCTACard />`;
    const unaliasedResult = validateExclusiveGateRouting(unaliasedBypass);
    expect(unaliasedResult.pass).toBe(false);
    expect(unaliasedResult).toHaveProperty(
      "reason",
      expect.stringContaining("card module path"),
    );

    // ── Substitute: remove gate, add bare card ──
    const substitute =
      dashboard
        .replace(/<DiagnosticCTAGate[\s/>]/g, "")
        .replace(
          /import.*DiagnosticCTAGate.*/,
          `import { DiagnosticCTACard } from "${CARD_MODULE_PATH}";`,
        ) + "\n<DiagnosticCTACard />";
    const substituteResult = validateExclusiveGateRouting(substitute);
    expect(substituteResult.pass).toBe(false);
  });

  /**
   * Decisive mutation: a MULTILINE ALIASED import that the previous
   * symbol-name regex would have missed. The module path prohibition
   * catches it because you can alias the symbol but not the path.
   */
  it("rejects a multiline aliased DiagnosticCTACard import", () => {
    const dashboard = read("client/src/pages/practice.tsx");

    // Multiline aliased import — the symbol name "DiagnosticCTACard" does
    // NOT appear at the JSX call site; only the alias "UngatedCTA" does.
    const aliasedBypass =
      dashboard +
      `\nimport {\n  DiagnosticCTACard as UngatedCTA\n} from "${CARD_MODULE_PATH}";\n<UngatedCTA />`;
    const result = validateExclusiveGateRouting(aliasedBypass);
    expect(result.pass).toBe(false);
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("card module path"),
    );
  });

  it("practice page fetches estimateStatus via projection API", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(practice).toContain("fetchScoreEstimate");
    expect(practice).toContain("EstimateResponse");
    expect(practice).toContain("/api/progress/projection");
  });

  it("both start surfaces reuse useDiagnosticStart (no forked start flow)", () => {
    // UI-50: Home's diagnostic card replaced DiagnosticPromptModal (deleted).
    // Code only: the module comment names the route and the button it describes.
    const home = read("client/src/components/home/FreeHome.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const card = read("client/src/components/diagnostic/DiagnosticCTACard.tsx");
    expect(home).toContain("useDiagnosticStart");
    expect(home).not.toContain("/api/practice/diagnostic/sessions");
    expect(card).toContain("useDiagnosticStart");
  });

  it("CTA copy is action-neutral (no 'Start' or 'Resume' in button text)", () => {
    const card = read("client/src/components/diagnostic/DiagnosticCTACard.tsx");
    // Button text should be "Work on Diagnostic" — action-neutral for both
    // fresh (201) and resume (409) cases.
    expect(card).toContain("Work on Diagnostic");
    // Must reference projected-score payoff
    expect(card).toContain("projected SAT score");
    // Home's card (UI-50) uses the signed-off prototype's words instead ("Start diagnostic",
    // Main.dc.html; owner ruling 2026-10-03: copy from the prototype), with the same payoff.
    // Code only: the module comment names the route and the button it describes.
    const home = read("client/src/components/home/FreeHome.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(home).toContain("projected SAT score");
  });
});
