/**
 * UI-64: the configured numbers in student copy come from the server, never from a literal.
 *
 * @spec [student-UI register UI-64, owner ruling OQ-68 (d) (Karl, 2026-10-08): "The '40
 *        questions' copy reads the server quota value (the same source as the 402)". Row proof:
 *        "Changing the config value in a test changes the rendered copy; grep shows no literal
 *        left"] | @implemented [2026-10-08]
 *
 * plain English: two halves.
 *   - The sentence builder: `planFreeIncludes` prints exactly the number it is given, and no
 *     number at all when it has none (the read has not answered or failed).
 *   - The grep: every string the client can render (string literals, template text, JSX text,
 *     read with the TypeScript parser, so comments that quote the ruling are not counted) is
 *     searched for "40 questions", "40 practice questions", "forty questions" and the like. A
 *     literal that comes back, anywhere in `client/src`, fails here.
 * Presence before absence: the scan must have read a realistic number of files and strings, and
 * the matcher must catch the two literals this row removed, or an empty scan could pass.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PLAN_PAID_ADDS, planFreeIncludes } from "./plan-copy";

const CLIENT_SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name): string[] => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(name)) return [];
    if (/\.test\.(ts|tsx)$/.test(name)) return [];
    return [full];
  });
}

/** The renderable text of a file: string literals, template pieces and JSX text, not comments. */
function strings(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    } else if (ts.isJsxText(node)) {
      out.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** "40 questions", "40 practice questions", "Forty questions", "forty practice questions". */
const CONFIGURED_COUNT_LITERAL =
  /\b(?:40|forty)\s+(?:practice\s+|more\s+)?questions?\b/i;

describe("planFreeIncludes (OQ-68 (d))", () => {
  it("prints the number it is given: a config value that is not 40 changes the copy", () => {
    expect(planFreeIncludes(37)).toBe(
      "Free: the diagnostic, your projected score, 37 practice questions a day and unlimited review.",
    );
    expect(planFreeIncludes(1)).toContain("1 practice question a day");
  });

  it("prints no number while the read has not answered or failed", () => {
    const line = planFreeIncludes(null);
    expect(line).toBe(
      "Free: the diagnostic, your projected score, daily practice questions and unlimited review.",
    );
    expect(line).not.toMatch(/\d/);
    expect(PLAN_PAID_ADDS).not.toMatch(/\d/);
  });
});

describe("no configured count is written as a literal in client copy (UI-64 grep)", () => {
  const files = sourceFiles(CLIENT_SRC).map((full) => ({
    path: relative(CLIENT_SRC, full),
    strings: strings(full, readFileSync(full, "utf8")),
  }));

  it("the matcher catches the two literals this row removed (presence first)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.reduce((n, f) => n + f.strings.length, 0)).toBeGreaterThan(
      5000,
    );
    for (const removed of [
      "Free: the diagnostic, your projected score, 40 practice questions a day and unlimited review.",
      "40 questions, five from each of the eight SAT domains.",
      "Forty questions across every domain give you a projected score and a starting point.",
      "Forty practice questions a day, and every question you miss comes back until you get it right.",
    ]) {
      expect(removed).toMatch(CONFIGURED_COUNT_LITERAL);
    }
    // Copy that states a number the server supplies does not match.
    expect(planFreeIncludes(37)).not.toMatch(CONFIGURED_COUNT_LITERAL);
  });

  it("no string or JSX text in client/src states 40 (or forty) questions", () => {
    const hits = files.flatMap((f) =>
      f.strings
        .filter((s) => CONFIGURED_COUNT_LITERAL.test(s))
        .map((s) => `${f.path}: ${s.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
