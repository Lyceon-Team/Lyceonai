/**
 * @spec [Coding Standards §16 (no console in product code), §17; student-ui Brief 5, audit
 *        finding 4] | @implemented [2026-09-30] |
 * plain English: the auth provider writes nothing to the browser console. There is no approved
 * client logger, so the `authLog` helper that wrapped `console.warn`/`console.error` behind a
 * local `no-console` suppression was removed with no replacement (owner ruling, Brief 5).
 * ESLint's `no-console` already covers this file, but a suppression comment silences it — which
 * is exactly how the helper got in — so this gate also refuses the suppression itself.
 *
 * Presence first: the file must be the real provider (it defines `SupabaseAuthProvider`), so an
 * emptied or moved file cannot pass for the wrong reason. Comments are stripped before the
 * `console.` check, so prose that mentions the console does not trip it; the suppression check
 * reads the raw text, because a suppression IS a comment.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FILE = "client/src/contexts/SupabaseAuthContext.tsx";
const source = fs.readFileSync(path.resolve(__dirname, "../..", FILE), "utf8");

/**
 * Blanks // and /* *\/ comments, keeping every newline so reported line numbers stay true.
 * String contents are kept (a string cannot call console).
 */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("SupabaseAuthContext writes nothing to the console (Brief 5, audit finding 4)", () => {
  it("presence: the file is the auth provider", () => {
    expect(source).toContain("export function SupabaseAuthProvider");
  });

  it("no console.* call in code", () => {
    const hits = withoutComments(source)
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => /\bconsole\s*\./.test(text))
      .map(({ line, text }) => `${FILE}:${line}: ${text.trim()}`);
    expect(hits).toEqual([]);
  });

  it("no no-console suppression", () => {
    const hits = source
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => /eslint-disable[^\n]*no-console/.test(text))
      .map(({ line, text }) => `${FILE}:${line}: ${text.trim()}`);
    expect(hits).toEqual([]);
  });
});
