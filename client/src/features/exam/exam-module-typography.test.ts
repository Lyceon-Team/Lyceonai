/**
 * UI-54: the timed module keeps its Bluebook layout and colours; only its type moves onto the
 * student typography tokens.
 *
 * @spec [student-UI register UI-54 ("the timed module keeps its Bluebook layout; typography
 *        tokens only"); DESIGN.md §1 ("Nothing below 14px anywhere"; headings Source Serif 4),
 *        §2 ("The timed exam module keeps its Bluebook layout, with no back arrow and light
 *        theme only")] | @implemented [2026-10-03]
 *
 * plain English: a source scan of every file the timed module renders. Presence first (each
 * file exists and still draws with the exam's own colour tokens, i.e. the Bluebook look is
 * kept), then absence: no Tailwind text size under 14px, no generic `font-serif` (the serif is
 * the student token `font-lyc-serif`) and no raw hex colour in a class.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(new URL(import.meta.url).pathname);

const MODULE_FILES = [
  "pages/ExamModulePage.tsx",
  "components/ExamHeader.tsx",
  "components/ExamTimer.tsx",
  "components/ExamQuestionView.tsx",
  "components/ChoiceList.tsx",
  "components/PassageView.tsx",
  "components/QuestionCell.tsx",
  "components/ModuleReview.tsx",
  "components/NavigatorDialog.tsx",
  "components/SubmitModuleDialog.tsx",
] as const;

const SMALL_TEXT = /\btext-(?:xs|\[(?:[0-9]|1[0-3])(?:\.\d+)?px\])(?![\w-])/;
const GENERIC_SERIF = /\bfont-serif\b/;
const RAW_HEX_CLASS = /\[#[0-9a-fA-F]{3,8}\]/;

describe("the timed module's typography (UI-54)", () => {
  it.each(MODULE_FILES)(
    "%s: exam colours kept, nothing under 14px, the student serif",
    (file) => {
      const source = readFileSync(path.join(HERE, file), "utf8");
      expect(source.length).toBeGreaterThan(0);
      expect(source).toMatch(/var\(--exam-/);
      expect(source).not.toMatch(SMALL_TEXT);
      expect(source).not.toMatch(GENERIC_SERIF);
      expect(source).not.toMatch(RAW_HEX_CLASS);
    },
  );

  it("the module's headings use the student serif token", () => {
    const sources = MODULE_FILES.map((f) =>
      readFileSync(path.join(HERE, f), "utf8"),
    ).join("\n");
    expect(sources).toMatch(/font-lyc-serif/);
    expect(sources).toMatch(/text-lyc-meta/);
  });
});
