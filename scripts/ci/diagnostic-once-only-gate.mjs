#!/usr/bin/env node
/**
 * diagnostic once-only gate
 * ===========================================================================
 * The RULE is proven behaviourally by
 * packages/shared/src/__tests__/diagnostic-eligibility.test.ts, which runs
 * resolveDiagnosticStartDecision over every input shape including the
 * completed+in-flight shape production holds today.
 *
 * That test cannot catch the mutation that actually matters. The rule only sees
 * what the QUERY hands it: narrow the route's status filter back to
 * ['created','active'] and the function never receives the completed row, returns
 * `allow`, and the defect is back — while every unit test stays green.
 *
 * This gate covers that seam. It is deliberately about WIRING, not the rule:
 *   (1) the start route's status filter includes 'completed'
 *   (2) the route delegates to resolveDiagnosticStartDecision rather than
 *       re-implementing the decision inline (one rule, one home)
 *   (3) both outcomes exist as DISTINCT error codes — collapsing them would make
 *       a completed student look resumable to the client
 *   (4) the client handles diagnostic_already_completed explicitly, so the
 *       student is not shown "Something went wrong" for a state that is not wrong
 */
import { readFileSync } from "node:fs";

const failures = [];
const fail = (id, msg) => failures.push(`FAIL [${id}]: ${msg}`);
const pass = (id, msg) => console.log(`ok   [${id}]: ${msg}`);
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const ROUTE = "server/routes/diagnostic-routes.ts";
const HOOK = "client/src/hooks/useDiagnosticStart.ts";
const route = read(ROUTE);
const hook = read(HOOK);

// The prior-diagnostics lookup: the `.in("status", [...])` that feeds the rule.
//
// Anchored on the `priorDiagnostics` binding specifically. An earlier revision of
// this gate anchored on `.eq("mode", "diagnostic")` and matched the IDEMPOTENCY
// REPLAY query higher in the same handler, which legitimately reads only
// ['created','active'] — so the gate failed against correct code. Anchoring on
// the binding name is what makes it point at the guard and nothing else.
const statusFilter = route.match(
  /const \{\s*data:\s*priorDiagnostics[\s\S]{0,400}?\.in\(\s*"status",\s*\[([^\]]*)\]/,
);
if (!statusFilter) {
  fail(
    1,
    `could not locate the diagnostic prior-session status filter in ${ROUTE}`,
  );
} else {
  const statuses = [...statusFilter[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  if (!statuses.includes("completed")) {
    fail(
      1,
      `the diagnostic start route reads only [${statuses.join(", ")}] — without 'completed' the once-only rule never sees a completed diagnostic and a second one is startable. This is the exact regression this gate exists for.`,
    );
  } else {
    pass(1, `start route reads prior diagnostics as [${statuses.join(", ")}]`);
  }
}

if (!/resolveDiagnosticStartDecision\s*\(/.test(route)) {
  fail(
    2,
    `${ROUTE} does not call resolveDiagnosticStartDecision — the once-only rule has been re-implemented inline, so the shared test no longer proves the shipped behaviour`,
  );
} else {
  pass(2, "route delegates the decision to the shared pure function");
}

const hasCompleted = /"diagnostic_already_completed"/.test(route);
const hasActive = /"diagnostic_session_active"/.test(route);
if (!hasCompleted || !hasActive) {
  fail(
    3,
    `the route must return BOTH distinct codes; found already_completed=${hasCompleted} session_active=${hasActive}. They are different situations: one is resumable, one is terminal.`,
  );
} else {
  pass(3, "both outcomes return distinct error codes");
}

if (!/diagnostic_already_completed/.test(hook)) {
  fail(
    4,
    `${HOOK} does not handle diagnostic_already_completed — it would fall through to the generic "Something went wrong", which misdescribes a state that is not an error`,
  );
} else {
  pass(4, "client handles the completed refusal explicitly");
}

console.log("");
if (failures.length) {
  for (const f of failures) console.error(f);
  console.error(`DIAGNOSTIC ONCE-ONLY GATE: FAIL (${failures.length})`);
  process.exit(1);
}
console.log("DIAGNOSTIC ONCE-ONLY GATE: PASS");
