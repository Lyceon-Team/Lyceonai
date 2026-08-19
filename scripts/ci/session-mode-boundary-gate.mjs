#!/usr/bin/env node
/**
 * session-mode boundary gate
 * ===========================================================================
 * `practice_sessions.mode` decides `event_source_kind` via
 * practice_session_mode_to_event_kind(), so it decides how an answer is recorded
 * in mastery. Before this gate, the practice start route accepted it as
 * `z.string().max(64)` and wrote it straight into the insert — meaning a client
 * could classify its own activity as `diagnostic_attempt`, and could create a
 * diagnostic session through the practice route, bypassing the once-only guard
 * in the diagnostic route entirely.
 *
 * That is an integrity bypass, not a lifecycle bug, which is why it is gated
 * separately and why the checks below are about WHERE the enum is enforced
 * rather than what it contains (the shared package's own test covers content).
 *
 * CHECKS
 *   (1) the practice start route's `mode` field is the shared enum, not a string
 *   (2) the diagnostic route never reads `mode` from the request body
 *   (3) SESSION_MODES_DB matches the DB CHECK exactly — no drift in either
 *       direction between the TS constant and the constraint
 *   (4) the DB CHECK still lists `flow` (owner ruling Q7: block new writes at
 *       the boundary, keep existing rows valid)
 *
 * Check (3) is the one that catches the subtle future mistake: adding a mode to
 * the constraint without adding it to the constant leaves
 * practice_session_mode_to_event_kind() as the only thing that knows about it,
 * and it RAISEs — which surfaces as a failed mastery write, not a validation
 * error.
 */
import { readFileSync } from "node:fs";

const failures = [];
const fail = (id, msg) => failures.push(`FAIL [${id}]: ${msg}`);
const pass = (id, msg) => console.log(`ok   [${id}]: ${msg}`);

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const PRACTICE_ROUTE = "server/routes/practice-canonical.ts";
const DIAGNOSTIC_ROUTE = "server/routes/diagnostic-routes.ts";
const SHARED = "packages/shared/src/session-mode.ts";
const GENESIS = "scripts/ci/genesis-schema.expected.sql";

// ---------------------------------------------------------------------------
// (1) the practice route enforces the enum at its boundary
// ---------------------------------------------------------------------------
const practice = read(PRACTICE_ROUTE);
const startSchema = practice.match(
  /const StartSessionBodySchema = z\.object\(\{([\s\S]*?)\n\}\);/,
);
if (!startSchema) {
  fail(1, `could not locate StartSessionBodySchema in ${PRACTICE_ROUTE}`);
} else {
  const body = startSchema[1];
  const modeLine = body
    .split("\n")
    .find((l) => /^\s*mode\s*:/.test(l.replace(/\/\/.*$/, "")));
  if (!modeLine) {
    fail(1, "StartSessionBodySchema has no `mode` field");
  } else if (/z\s*\.\s*string\s*\(/.test(modeLine)) {
    fail(
      1,
      `StartSessionBodySchema.mode is a free-text string again — a client can name its own session mode:\n       ${modeLine.trim()}`,
    );
  } else if (!/practiceSessionModeSchema/.test(modeLine)) {
    fail(
      1,
      `StartSessionBodySchema.mode does not use the shared practiceSessionModeSchema:\n       ${modeLine.trim()}`,
    );
  } else {
    pass(1, "practice start route validates `mode` with the shared enum");
  }
}

// ---------------------------------------------------------------------------
// (2) the diagnostic route assigns the mode server-side
// ---------------------------------------------------------------------------
const diagnostic = read(DIAGNOSTIC_ROUTE);
const diagBodySchema = diagnostic.match(
  /const StartDiagnosticBodySchema = z\.object\(\{([\s\S]*?)\n\}\);/,
);
if (!diagBodySchema) {
  fail(2, `could not locate StartDiagnosticBodySchema in ${DIAGNOSTIC_ROUTE}`);
} else if (/^\s*mode\s*:/m.test(diagBodySchema[1])) {
  fail(
    2,
    "StartDiagnosticBodySchema accepts `mode` from the request body — the diagnostic mode must be server-assigned",
  );
} else {
  pass(2, "diagnostic route takes no `mode` from the request body");
}

// ---------------------------------------------------------------------------
// (3) + (4) TS constant vs DB CHECK
// ---------------------------------------------------------------------------
const shared = read(SHARED);
const constBlock = shared.match(
  /export const SESSION_MODES_DB = \[([\s\S]*?)\] as const;/,
);
const genesis = read(GENESIS);
const checkDef = genesis.match(
  /CONSTRAINT practice_sessions_mode_check CHECK \(\(mode = ANY \(ARRAY\[([^\]]*)\]\)\)\)/,
);

if (!constBlock) {
  fail(3, `could not parse SESSION_MODES_DB from ${SHARED}`);
} else if (!checkDef) {
  fail(3, `could not parse practice_sessions_mode_check from ${GENESIS}`);
} else {
  const tsModes = [...constBlock[1].matchAll(/"([a-z_]+)"/g)]
    .map((m) => m[1])
    .sort();
  const dbModes = [...checkDef[1].matchAll(/'([a-z_]+)'::text/g)]
    .map((m) => m[1])
    .sort();

  const onlyTs = tsModes.filter((m) => !dbModes.includes(m));
  const onlyDb = dbModes.filter((m) => !tsModes.includes(m));

  if (onlyTs.length || onlyDb.length) {
    fail(
      3,
      `SESSION_MODES_DB and practice_sessions_mode_check have drifted.
       only in TS: ${onlyTs.join(", ") || "(none)"}
       only in DB: ${onlyDb.join(", ") || "(none)"}
       A mode in the constraint but not the constant is invisible to validation, and
       practice_session_mode_to_event_kind() RAISEs on it — surfacing as a failed
       mastery write rather than a 400.`,
    );
  } else {
    pass(3, `TS constant matches the DB CHECK exactly (${dbModes.join(", ")})`);
  }

  if (!dbModes.includes("flow")) {
    fail(
      4,
      "practice_sessions_mode_check no longer lists 'flow'. Owner ruling Q7: keep it in the constraint so the eight existing production rows stay valid, and block new writes at the Zod boundary instead.",
    );
  } else {
    pass(4, "'flow' is still accepted by the DB CHECK (existing rows stay valid)");
  }
}

console.log("");
if (failures.length) {
  for (const f of failures) console.error(f);
  console.error(`SESSION-MODE BOUNDARY GATE: FAIL (${failures.length})`);
  process.exit(1);
}
console.log("SESSION-MODE BOUNDARY GATE: PASS");
