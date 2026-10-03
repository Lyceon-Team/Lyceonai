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
   * and DiagnosticCTAGate on 2026-10-03; UI-51 then removed the gate from Practice and deleted
   * the gate and the old CTA card, so Home's card is the one diagnostic prompt) shows for exactly `estimateStatus === "no_baseline"`,
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
   * Intent: Home is the ONE diagnostic entry. UI-51 (2026-10-03) rebuilt Practice to DESIGN.md
   * §4 and Practice.dc.html, which have no diagnostic prompt, and deleted `DiagnosticCTAGate` and
   * `DiagnosticCTACard` (Practice was their only surface). The gate's guard used to prove that
   * Practice routed the old card exclusively through the gate; with no card and no gate the claim
   * becomes "Practice offers no diagnostic entry at all, and the old card's module stays gone",
   * checked by one validator, which the mutation proofs below exercise.
   *
   * Would fail if: Practice imported anything from the diagnostic components folder (aliased,
   * multiline or not), reused the diagnostic starter, or named the diagnostic route; or if the
   * deleted card module came back.
   */

  /** The deleted card's module path: you can alias a symbol, never a path. */
  const CARD_MODULE_PATH = "@/components/diagnostic/DiagnosticCTACard";

  /** Direct <DiagnosticCTACard JSX invocation — un-aliased render. */
  const cardJsxPattern = /<DiagnosticCTACard[\s/>]/;

  /** Code only: comments describe history and may name what the code must not use. */
  function code(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  type NoEntryResult = { pass: true } | { pass: false; reason: string };

  function validateNoDiagnosticEntry(source: string): NoEntryResult {
    const src = code(source);
    if (src.includes("@/components/diagnostic/")) {
      return {
        pass: false,
        reason: "imports from the diagnostic components folder",
      };
    }
    if (src.includes("useDiagnosticStart")) {
      return { pass: false, reason: "reuses the diagnostic starter" };
    }
    if (src.includes("/api/practice/diagnostic")) {
      return { pass: false, reason: "names the diagnostic route" };
    }
    if (cardJsxPattern.test(src)) {
      return { pass: false, reason: "renders <DiagnosticCTACard>" };
    }
    return { pass: true };
  }

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

  it("Practice offers no diagnostic entry (DESIGN.md §4 Practice; UI-51)", () => {
    const practice = read("client/src/pages/practice.tsx");
    // Presence first: this is the rebuilt page (its filter bar and Start), not an empty file.
    expect(code(practice)).toContain("<FilterBar");
    expect(code(practice)).toContain('data-testid="practice-start"');
    expect(validateNoDiagnosticEntry(practice)).toEqual({ pass: true });
    // The deleted modules stay deleted.
    for (const gone of [
      "client/src/components/diagnostic/DiagnosticCTACard.tsx",
      "client/src/components/diagnostic/DiagnosticCTAGate.tsx",
    ]) {
      expect(fs.existsSync(path.join(repoRoot, gone)), gone).toBe(false);
    }
  });

  // ── Mutation proofs: the same validator, on Practice with an entry added back ─────────────

  it("rejects Practice with the old card imported back (plain and multiline aliased)", () => {
    const practice = read("client/src/pages/practice.tsx");
    const plain = validateNoDiagnosticEntry(
      practice +
        `\nimport { DiagnosticCTACard } from "${CARD_MODULE_PATH}";\n<DiagnosticCTACard />`,
    );
    expect(plain.pass).toBe(false);
    const aliased = validateNoDiagnosticEntry(
      practice +
        `\nimport {\n  DiagnosticCTACard as UngatedCTA\n} from "${CARD_MODULE_PATH}";\n<UngatedCTA />`,
    );
    expect(aliased).toEqual({
      pass: false,
      reason: "imports from the diagnostic components folder",
    });
  });

  it("rejects Practice that starts the diagnostic itself", () => {
    const practice = read("client/src/pages/practice.tsx");
    expect(
      validateNoDiagnosticEntry(
        practice +
          `\nimport { useDiagnosticStart } from "@/hooks/useDiagnosticStart";`,
      ),
    ).toEqual({ pass: false, reason: "reuses the diagnostic starter" });
    expect(
      validateNoDiagnosticEntry(
        practice + `\nconst url = "/api/practice/diagnostic/sessions";`,
      ),
    ).toEqual({ pass: false, reason: "names the diagnostic route" });
  });

  it("the one start surface reuses useDiagnosticStart (no forked start flow)", () => {
    // UI-50: Home's diagnostic card replaced DiagnosticPromptModal (deleted); UI-51 deleted the
    // old CTA card, the only other caller. Code only: the module comment names the route.
    const home = code(read("client/src/components/home/FreeHome.tsx"));
    expect(home).toContain("useDiagnosticStart");
    expect(home).not.toContain("/api/practice/diagnostic/sessions");
  });

  it("Home's diagnostic copy names the projected-score payoff", () => {
    // Home's card (UI-50) uses the signed-off prototype's words ("Start diagnostic",
    // Main.dc.html; owner ruling 2026-10-03: copy from the prototype). The old card's
    // action-neutral "Work on Diagnostic" left with the card (UI-51).
    const home = code(read("client/src/components/home/FreeHome.tsx"));
    expect(home).toContain("projected SAT score");
  });
});
