#!/usr/bin/env node
/**
 * @spec [Doc-05C_V1.0 §7.4; owner rulings Q1 + Q2, 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: the diagnostic lifecycle is declared in THREE places that cannot
 * import from each other —
 *
 *   1. the CASE arms in supabase/migrations/20260817010000_student_diagnostic_state.sql
 *   2. DIAGNOSTIC_STATES in packages/shared/src/diagnostic-state.ts
 *   3. the EstimateStatus union in client/src/lib/projectionApi.ts
 *
 * — because one is SQL, one is server TypeScript, and the client has no module
 * path to packages/shared. Three declarations of one thing drift. This gate is
 * what makes them not drift.
 *
 * WHY THE DRIFT IS DANGEROUS RATHER THAN UNTIDY
 *   A state the SQL can emit and the TypeScript cannot name is narrowed away by
 *   diagnosticStateSchema and logged as "unrecognized", degrading the student to
 *   the pre-step-1 behaviour — silently, and only for the state that was added.
 *   A status the server can emit and the client cannot name renders as an
 *   unhandled ternary arm: a blank card, not a type error.
 *
 * This is the same drift check step 3 applied to session modes
 * (scripts/ci/session-mode-boundary-gate.mjs); the mechanism is deliberately
 * copied rather than reinvented.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let failures = 0;
const fail = (id, msg) => {
  console.error(`FAIL [${id}]: ${msg}`);
  failures += 1;
};
const pass = (id, msg) => console.log(`ok   [${id}]: ${msg}`);

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// (1) SQL CASE arms  ==  DIAGNOSTIC_STATES
// ---------------------------------------------------------------------------
const migration = read(
  "supabase/migrations/20260817010000_student_diagnostic_state.sql",
);
const caseBlock = migration.slice(
  migration.indexOf("  CASE"),
  migration.indexOf("AS state"),
);
// Every literal the CASE can produce: the THEN arms plus the ELSE.
const sqlStates = [
  ...caseBlock.matchAll(/(?:THEN|ELSE)\s+'([a-z_]+)'/g),
].map((m) => m[1]);

// The default the accessor returns for a student with no row must also be a
// declared state — it is a fifth exit from the same decision.
const fallback = /COALESCE\([\s\S]*?'([a-z_]+)'\s*\n?\s*\);/.exec(
  migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION")),
);

const sharedSrc = read("packages/shared/src/diagnostic-state.ts");
const sharedStates = [
  ...sharedSrc
    .slice(
      sharedSrc.indexOf("export const DIAGNOSTIC_STATES"),
      sharedSrc.indexOf("] as const", sharedSrc.indexOf("DIAGNOSTIC_STATES")),
    )
    .matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]);

if (sqlStates.length === 0 || sharedStates.length === 0) {
  fail(
    "D1",
    `could not parse the state sets (sql=${sqlStates.length}, ts=${sharedStates.length}) — the gate must not pass by finding nothing`,
  );
} else if (!eq([...sqlStates].sort(), [...sharedStates].sort())) {
  fail(
    "D1",
    `SQL emits [${[...sqlStates].sort()}] but DIAGNOSTIC_STATES declares [${[...sharedStates].sort()}]`,
  );
} else {
  pass("D1", `SQL CASE arms match DIAGNOSTIC_STATES (${sharedStates.length})`);
}

if (!fallback) {
  fail("D2", "could not find the COALESCE fallback in student_diagnostic_state()");
} else if (!sharedStates.includes(fallback[1])) {
  fail(
    "D2",
    `the accessor falls back to '${fallback[1]}', which is not a declared state`,
  );
} else {
  pass("D2", `the no-row fallback ('${fallback[1]}') is a declared state`);
}

// ---------------------------------------------------------------------------
// (2) ESTIMATE_STATUSES  ==  the client EstimateStatus union
// ---------------------------------------------------------------------------
const sharedStatuses = [
  ...sharedSrc
    .slice(
      sharedSrc.indexOf("export const ESTIMATE_STATUSES"),
      sharedSrc.indexOf("] as const", sharedSrc.indexOf("ESTIMATE_STATUSES")),
    )
    .matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]);

const clientSrc = read("client/src/lib/projectionApi.ts");
const unionAt = clientSrc.indexOf("export type EstimateStatus");
const clientStatuses = [
  ...clientSrc
    .slice(unionAt, clientSrc.indexOf(";", unionAt))
    .matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]);

if (sharedStatuses.length === 0 || clientStatuses.length === 0) {
  fail(
    "D3",
    `could not parse the status sets (shared=${sharedStatuses.length}, client=${clientStatuses.length})`,
  );
} else if (!eq([...sharedStatuses].sort(), [...clientStatuses].sort())) {
  fail(
    "D3",
    `ESTIMATE_STATUSES is [${[...sharedStatuses].sort()}] but the client union is [${[...clientStatuses].sort()}]`,
  );
} else {
  pass(
    "D3",
    `ESTIMATE_STATUSES matches the client EstimateStatus union (${clientStatuses.length})`,
  );
}

// ---------------------------------------------------------------------------
// (3) Every status the server can emit has a client response-union member.
//     A status in the type union with no response variant type-checks and then
//     renders nothing.
// ---------------------------------------------------------------------------
const responseBlock = clientSrc.slice(
  clientSrc.indexOf("export type EstimateResponse"),
);
const missingVariant = clientStatuses.filter(
  (s) => !responseBlock.includes(`estimateStatus: "${s}"`),
);
if (missingVariant.length > 0) {
  fail(
    "D4",
    `no EstimateResponse variant for: ${missingVariant.join(", ")} — the client can name the status but has no shape for it`,
  );
} else {
  pass("D4", "every status has an EstimateResponse variant");
}

// ---------------------------------------------------------------------------
// (4) The server never emits a status literal that is not declared.
// ---------------------------------------------------------------------------
const routeSrc = read("server/routes/legacy/progress.ts");
const emitted = [
  ...routeSrc.matchAll(/estimateStatus:\s*"([a-z_]+)"/g),
].map((m) => m[1]);
const undeclared = emitted.filter((s) => !sharedStatuses.includes(s));
if (undeclared.length > 0) {
  fail(
    "D5",
    `the projection route emits undeclared status literal(s): ${[...new Set(undeclared)].join(", ")}`,
  );
} else {
  pass(
    "D5",
    `the projection route emits only declared statuses (${emitted.length} literal(s))`,
  );
}

console.log("");
if (failures > 0) {
  console.error(`DIAGNOSTIC-STATE DRIFT GATE: FAIL (${failures} check(s))`);
  process.exit(1);
}
console.log("DIAGNOSTIC-STATE DRIFT GATE: PASS");
