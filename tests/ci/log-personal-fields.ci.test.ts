import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * @spec [Coding Standards §12.1 "never log sensitive content"; Doc 01A §14 PII redaction;
 *   register F-10, OQ-14 ruling 2026-09-29] | @implemented [2026-09-29] |
 * plain English: a whole-server gate. No `logger.*` / `console.*` call in production server code
 * may pass a personal field (email, name, date of birth, phone) as a key of its data object. The
 * logger's sink blanks an `email` KEY, but the value still reached the logger and any sink that
 * skips redaction would write it; this gate stops the pattern at the call site, so a new call
 * site cannot reintroduce it. `recipient: redactEmail(...)` is a masked form under another key
 * and is not matched here (register §8 records it as an owner question).
 *
 * trade-offs: this reads source text, not runtime output. The behavioural tests in
 * auth-signup.contract.test.ts and auth-middleware-log-redaction.test.ts prove the runtime half.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["server", "apps/api/src"];
const LOG_CALL =
  /\b(?:logger|console|this\.logger|req\.log)\s*\.\s*(?:log|info|warn|error|debug|trace|fatal)\s*\(/g;
const PERSONAL_KEY =
  /[{,]\s*(email|guardianEmail|parentEmail|studentEmail|display_name|displayName|full_name|fullName|first_name|firstName|last_name|lastName|dateOfBirth|date_of_birth|dob|phone|phoneNumber)\s*[:,}]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx|js|mjs)$/.test(entry) &&
      !/\.(test|spec)\./.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

type Violation = { site: string; key: string };

function findPersonalFieldLogs(
  file: string,
  source: string,
): {
  calls: number;
  violations: Violation[];
} {
  const violations: Violation[] = [];
  let calls = 0;
  for (const match of source.matchAll(LOG_CALL)) {
    calls += 1;
    let i = (match.index ?? 0) + match[0].length;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      i += 1;
    }
    const body = source.slice(match.index ?? 0, i);
    const hit = PERSONAL_KEY.exec(body);
    if (hit?.[1]) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      violations.push({ site: `${file}:${line}`, key: hit[1] });
    }
  }
  return { calls, violations };
}

describe("log calls carry no personal fields (F-10)", () => {
  it("the scanner flags a personal key and passes a non-identifying one", () => {
    const bad = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("AUTH", "x", "y", {\n  email: user.email,\n  requestId,\n});',
    );
    const shorthand = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("AUTH", "x", "y", { email, error: e.message });',
    );
    const good = findPersonalFieldLogs(
      "fixture.ts",
      'logger.info("NOTIFICATIONS", "email_sent", "Email accepted", { requestId });',
    );
    expect(bad.violations).toHaveLength(1);
    expect(shorthand.violations).toHaveLength(1);
    expect(good.violations).toEqual([]);
  });

  it("no server log call passes an email, name, date of birth or phone field", () => {
    let calls = 0;
    const violations: Violation[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const result = findPersonalFieldLogs(
          relative(ROOT, file),
          readFileSync(file, "utf8"),
        );
        calls += result.calls;
        violations.push(...result.violations);
      }
    }
    // Presence before absence: the scan saw the server's log calls, not an empty tree.
    expect(calls).toBeGreaterThan(500);
    expect(violations).toEqual([]);
  });
});
