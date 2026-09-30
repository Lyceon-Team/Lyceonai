import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * @spec [Coding Standards §12.1 "never log sensitive content"; Doc 01A §14 PII redaction;
 *   register F-10, OQ-14 ruling 2026-09-29; F-29, OQ-17 ruling 2026-09-30] |
 *   @implemented [2026-09-29; extended 2026-09-30] |
 * plain English: a whole-server gate with two halves.
 *   1. KEYS (F-10): no `logger.*` / `console.*` call in production server code may pass a
 *      personal field (email, name, date of birth, phone) as a key of its data object. The
 *      logger's sink blanks an `email` KEY, but the value still reached the logger and any sink
 *      that skips redaction would write it.
 *   2. VALUES (OQ-17): no log call may carry an email in any form, masked or not, under ANY key.
 *      `recipient: redactEmail(input.to)` passed the key check for months because the key was
 *      innocent and the value was a masked address. So the value side is checked too: a value
 *      expression whose last segment names an email or address (`input.guardianEmail`,
 *      `user.email`), or any call to a redact/mask helper (`redactEmail(input.to)`), fails the
 *      gate. A bare `input.to` is not caught by name; the behavioural tests cover the sends. String literals and comments are
 *      skipped (message prose may say "email"); template `${…}` expressions are kept, because
 *      an address interpolated into a message is exactly the leak.
 *
 * trade-offs: this reads source text, not runtime output. The behavioural tests in
 * auth-signup.contract.test.ts, auth-middleware-log-redaction.test.ts and
 * notifications.direct-sends.test.ts prove the runtime half. A value named for what it is
 * (`emailOwner.id` is a profile id) passes, because only the LAST segment of a member chain is
 * judged.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["server", "apps/api/src"];
const LOG_CALL =
  /\b(?:logger|console|this\.logger|req\.log)\s*\.\s*(?:log|info|warn|error|debug|trace|fatal)\s*\(/g;
const PERSONAL_KEY =
  /[{,]\s*(email|guardianEmail|parentEmail|studentEmail|display_name|displayName|full_name|fullName|first_name|firstName|last_name|lastName|dateOfBirth|date_of_birth|dob|phone|phoneNumber)\s*[:,}]/;
/** A value expression: an identifier chain that is not itself an object key. */
const VALUE_CHAIN =
  /(?<![\w$.])([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)(?!\s*:)/g;
const EMAIL_SEGMENT = /e_?mail|address/i;
/** A masking helper for an address (`redactEmail`, `maskRecipient`); not the logger's own `redactSensitive`. */
const MASK_HELPER = /^(?:redact|mask)\w*(?:e_?mail|address|recipient)\w*$/i;

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

/**
 * The code of a call body with string contents and comments removed. Template literal text is
 * removed but each `${…}` expression is kept, since that is code that runs.
 */
function codeOnly(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    const next = body[i + 1];
    if (ch === "/" && next === "/") {
      while (i < body.length && body[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < body.length && !(body[i] === "*" && body[i + 1] === "/"))
        i += 1;
      i += 2;
    } else if (ch === '"' || ch === "'") {
      i += 1;
      while (i < body.length && body[i] !== ch) i += body[i] === "\\" ? 2 : 1;
      i += 1;
      out += '""';
    } else if (ch === "`") {
      i += 1;
      out += '""';
      while (i < body.length && body[i] !== "`") {
        if (body[i] === "\\") {
          i += 2;
        } else if (body[i] === "$" && body[i + 1] === "{") {
          i += 2;
          let depth = 1;
          let expr = "";
          while (i < body.length && depth > 0) {
            if (body[i] === "{") depth += 1;
            if (body[i] === "}") depth -= 1;
            if (depth > 0) expr += body[i];
            i += 1;
          }
          out += ` ${codeOnly(expr)} `;
        } else {
          i += 1;
        }
      }
      i += 1;
    } else {
      out += ch;
      i += 1;
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
    const line = source.slice(0, match.index ?? 0).split("\n").length;
    const site = `${file}:${line}`;
    const code = codeOnly(source.slice(match.index ?? 0, i));

    const keyHit = PERSONAL_KEY.exec(code);
    if (keyHit?.[1]) violations.push({ site, key: keyHit[1] });

    for (const value of code.matchAll(VALUE_CHAIN)) {
      const chain = value[1] ?? "";
      const last = chain.split(/\??\./).pop() ?? "";
      if (EMAIL_SEGMENT.test(last) || MASK_HELPER.test(last)) {
        violations.push({ site, key: `value:${chain}` });
      }
    }
  }
  return { calls, violations };
}

describe("log calls carry no personal fields (F-10, F-29)", () => {
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
    expect(bad.violations.length).toBeGreaterThan(0);
    expect(shorthand.violations.length).toBeGreaterThan(0);
    expect(good.violations).toEqual([]);
  });

  it("the scanner flags an email VALUE under any key, masked or not", () => {
    const masked = findPersonalFieldLogs(
      "fixture.ts",
      'logger.info("N", "sent", "Email accepted", { recipient: redactEmail(input.to) });',
    );
    const underNeutralKey = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("N", "x", "y", { target: input.guardianEmail });',
    );
    const inTemplate = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("N", "x", `sent to ${user.email}`);',
    );
    expect(masked.violations.map((v) => v.key)).toEqual(["value:redactEmail"]);
    expect(underNeutralKey.violations.map((v) => v.key)).toEqual([
      "value:input.guardianEmail",
    ]);
    expect(inTemplate.violations.map((v) => v.key)).toEqual([
      "value:user.email",
    ]);
  });

  it("the scanner passes ids named after an email owner, prose and comments", () => {
    const ownerId = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("AUTH", "x", "y", { existingProfileId: emailOwner.id });',
    );
    const prose = findPersonalFieldLogs(
      "fixture.ts",
      'logger.warn("N", "address_read_failed", "Could not read the address", {\n  // no email, no address here\n  requestId,\n});',
    );
    expect(ownerId.violations).toEqual([]);
    expect(prose.violations).toEqual([]);
  });

  it("no server log call passes an email, name, date of birth or phone, as a key or a value", () => {
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
