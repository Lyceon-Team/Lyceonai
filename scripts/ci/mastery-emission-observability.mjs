#!/usr/bin/env node
/**
 * CI gate: mastery-emission failures are observable.
 *
 * @spec [Doc-01A_V1.0 §10–§13 structured logging, §19.1 migration path steps (1) and (5);
 *        Lyceon Coding Standards §16 "no console.log in production code"]
 *
 * Mastery emission failed 100% of the time for seven weeks with nobody alerted. Two
 * defects made that possible, and this gate blocks both from returning:
 *
 *   1. console.* on a mastery path. It bypasses redaction and the Cloud Logging
 *      severity mapping entirely, so full-length and review failures were not even
 *      WARNING-classified.
 *
 *   2. A miscalled structured logger. The logger's signature is
 *      (component, operation, message, error?, data?), but the practice/diagnostic
 *      sites called logger.error(message, data) — two args. The data object landed in
 *      the `event` field, and an `event` holding an object cannot be matched by any
 *      log-based filter. The logs looked structured and were unfilterable.
 *
 * The gate therefore checks a NEGATIVE (no console on mastery paths) and a POSITIVE
 * (every mastery log site uses the shared vocabulary with the correct arity). Checking
 * only the negative would let defect 2 back in silently.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

/** Files that call applyMasteryEvent, i.e. every mastery emission call site. */
const EMISSION_FILES = [
  "server/routes/practice-canonical.ts",
  "server/routes/review-session-routes.ts",
  "apps/api/src/services/fullLengthExam.ts",
];

const SHARED_MODULE = "packages/shared/src/mastery-emission.ts";

/** A line is "mastery-adjacent" if it or its neighbourhood mentions mastery. */
const NEIGHBOURHOOD = 25;
const CONSOLE_CALL = /\bconsole\.(log|warn|error|info|debug)\s*\(/;
const MASTERY_HINT = /mastery/i;

const violations = [];

// ---------------------------------------------------------------------------
// 0. The shared vocabulary must exist. Everything else depends on it.
// ---------------------------------------------------------------------------
if (!existsSync(path.join(ROOT, SHARED_MODULE))) {
  violations.push(
    `${SHARED_MODULE}: missing — the stable mastery failure-code vocabulary must exist`,
  );
}

for (const rel of EMISSION_FILES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel}: missing (expected a mastery emission call site)`);
    continue;
  }
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");

  if (!/applyMasteryEvent\s*\(/.test(src)) {
    violations.push(
      `${rel}: no applyMasteryEvent call found — update EMISSION_FILES in this gate if the seam moved`,
    );
    continue;
  }

  // -------------------------------------------------------------------------
  // 1. NEGATIVE — no console.* anywhere near mastery handling.
  // -------------------------------------------------------------------------
  for (let i = 0; i < lines.length; i++) {
    if (!CONSOLE_CALL.test(lines[i])) continue;
    const from = Math.max(0, i - NEIGHBOURHOOD);
    const to = Math.min(lines.length, i + NEIGHBOURHOOD + 1);
    const neighbourhood = lines.slice(from, to).join("\n");
    if (MASTERY_HINT.test(neighbourhood)) {
      violations.push(
        `${rel}:${i + 1}: console.* on a mastery path — use the structured logger ` +
          `(console bypasses redaction and the Cloud Logging severity mapping)\n` +
          `      ${lines[i].trim()}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. POSITIVE — the shared vocabulary is imported and actually used.
  // -------------------------------------------------------------------------
  if (!/MASTERY_EMISSION_COMPONENT/.test(src)) {
    violations.push(
      `${rel}: does not import MASTERY_EMISSION_COMPONENT — mastery log sites must use ` +
        `the shared vocabulary so one filter covers every call site`,
    );
  }
  if (!/MASTERY_EMISSION_FAILURE_CODE\./.test(src)) {
    violations.push(
      `${rel}: emits no MASTERY_EMISSION_FAILURE_CODE — every failure branch needs a ` +
        `stable machine-readable code`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. ARITY — a logger call naming MASTERY_EMISSION_COMPONENT must pass it FIRST.
  //    logger.error(MASTERY_EMISSION_COMPONENT, MASTERY_EMISSION_EVENT.X, ...)
  //    Catches the two-arg regression that put a data object into `event`.
  // -------------------------------------------------------------------------
  const loggerCalls = src.matchAll(
    /logger\.(error|warn|info|debug)\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*,/g,
  );
  const seenGoodCall = [];
  for (const m of loggerCalls) {
    if (m[2].includes("MASTERY_EMISSION_COMPONENT")) {
      if (!m[3].includes("MASTERY_EMISSION_EVENT.")) {
        violations.push(
          `${rel}: logger call passes MASTERY_EMISSION_COMPONENT but the second argument ` +
            `is not a MASTERY_EMISSION_EVENT — the logger signature is ` +
            `(component, operation, message, error?, data?)`,
        );
      } else {
        seenGoodCall.push(m[2]);
      }
    }
  }
  if (seenGoodCall.length === 0) {
    violations.push(
      `${rel}: no correctly-shaped mastery logger call found — expected ` +
        `logger.error(MASTERY_EMISSION_COMPONENT, MASTERY_EMISSION_EVENT.*, message, undefined, { code, ... })`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Two-arg logger calls are the exact defect that made these logs
  //    unfilterable. Reject any that remain in these files.
  // -------------------------------------------------------------------------
  const twoArg =
    /logger\.(error|warn)\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*,\s*\{/g;
  for (const m of src.matchAll(twoArg)) {
    const line = src.slice(0, m.index).split("\n").length;
    violations.push(
      `${rel}:${line}: two-argument logger call — the message lands in \`component\` and ` +
        `the data object lands in \`event\`, which no log filter can match. Use ` +
        `logger.error(component, operation, message, error, data).\n      ${m[0].trim()}`,
    );
  }
}

if (violations.length > 0) {
  console.error("MASTERY EMISSION OBSERVABILITY GATE: FAIL\n");
  for (const v of violations) console.error("  - " + v);
  console.error(
    `\n${violations.length} violation(s). A mastery failure that cannot be filtered ` +
      `from logs is a mastery failure nobody will see.`,
  );
  process.exit(1);
}

console.log(
  `MASTERY EMISSION OBSERVABILITY GATE: PASS (${EMISSION_FILES.length} call-site files checked)`,
);
