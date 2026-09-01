#!/usr/bin/env node
/**
 * @spec [owner instruction 2026-08-28 — "DELETE AND SHIP", Task 1 Gates A and B]
 *
 * TWO RULES, ONE MECHANISM: a test may not carry a private copy of the schema.
 *
 * WHY THIS EXISTS. `guardian_consent_requests` has 0 rows in production and its whole surface
 * was written against columns that do not exist — `child_id`, `expires_at`, `status='approved'`
 * where the shipped table has `student_profile_id`, `consent_token_expires_at`, and a CHECK
 * that permits none of those. CI was green the entire time. The tests mocked Supabase and
 * returned hand-written fixtures spelling THE SAME imagined names, so the code and its mock
 * agreed with each other and neither was ever compared to Postgres. Nothing raised 42703
 * because nothing ever reached a database.
 *
 * A mock is a second, unverified copy of the schema. A hand-written row fixture is a private
 * guess. Neither is reconciled against anything, and two wrong copies agreeing is what green
 * looked like.
 *
 * ---------------------------------------------------------------------------
 * RULE A — no mocked Supabase in a data path.
 *   Transport and auth may be mocked. The QUERY LAYER may not. The required pattern is
 *   `makePgSupabase` over a live `pg.Client` against genesis + migrations, which is why a
 *   wrong column name raises 42703 on the first call and the defect cannot exist.
 *
 *   THE WHOLE DIFFICULTY IS THE DISCRIMINATOR, and it is worth stating because the obvious
 *   check is wrong. Keying on `vi.mock(...supabase...)` flags `guardian-link.pg.ci.test.ts` —
 *   the exemplar. That file mocks the supabase MODULE and hands back an adapter backed by a
 *   real `pg.Client`; the mock is the seam, not the substitute. So the test is not "does it
 *   mock", it is "IS THE MOCK BACKED BY A REAL POSTGRES CONNECTION".
 *
 * RULE B — no hand-written row fixtures.
 *   An object literal whose keys are database column names is a schema copy. Rows must come
 *   from the schema, or be inserted into real Postgres and read back. The existing
 *   fixture-canonicality gate checks fixture VALUES against CHECK constraints; this is the
 *   same idea applied to COLUMN NAMES, which is the half that was missing.
 *
 * ---------------------------------------------------------------------------
 * SCOPE: guardian files only, per owner ruling 2026-08-28. The measured blast radius across
 * the repo is 45 files for Rule A and 58 for Rule B; ~39 and ~51 of those belong to other
 * workstreams. A gate that reds another team's build on arrival gets disabled, and then it
 * protects nothing. Their inventory is recorded in `docs/alignment/KNOWN-GAPS.md` under
 * `SCHEMA-TRUTH-GATE-OUT-OF-SCOPE` with an owner and an expiry.
 *
 * THE ACCEPT-LIST, and what it does and does not buy. Three guardian files predate this gate.
 * Converting them is a real piece of work (`guardian-reporting.contract.test.ts` alone is ~900
 * lines) and is NOT done here, because this change is a deletion pass. They are accepted AT A
 * SIZE with an owner and an expiry, exactly as `ci-known-gaps` accepts its suppressions. What
 * the gate buys today is that the class cannot GROW: a new guardian test that mocks the query
 * layer, or spells a row by hand, reds on arrival. Adding a file to the accept-list is a
 * deliberate, reviewable edit rather than an accident.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const GENESIS = "supabase/migrations/00000000000000_genesis.sql";

/** Guardian scope: the files these rules police. */
const IN_SCOPE = /(^|\/)(guardian|subject-resolver)[^/]*\.(test|spec)\.(ts|tsx)$/i;

/**
 * Accepted at a size, with an owner and an expiry. Every entry is a file that existed before
 * the gate and has NOT been converted. Removing an entry is the fix; adding one needs review.
 */
const ACCEPTED = new Map([
  ["tests/ci/guardian-reporting.contract.test.ts",
   { owner: "guardian", expires: "2026-11-01", why: "~900 lines; conversion is its own change" }],
  ["tests/ci/guardian.anti-leak.ci.test.ts",
   { owner: "guardian", expires: "2026-11-01", why: "RULE-4 walker asserts on projections, not rows" }],
  ["server/__tests__/guardian-payment-access.test.ts",
   { owner: "guardian", expires: "2026-11-01", why: "predates the PG harness" }],
  // NOT the same kind of entry as the three above, and the difference is the open question.
  // This file deliberately INJECTS decisions a real database cannot produce — an RPC error, a
  // CASE arm no build recognises, a failed audit write — to prove the resolver fails closed on
  // each. Those cases cannot be driven from Postgres by construction. But its four REAL
  // decisions (self / allow / not_linked / student_unentitled) could be, and its one row
  // literal asserts the shape of a row the resolver WRITES, which is exactly the kind of
  // private schema copy Rule B exists to stop. The right end state is a split file, not a
  // converted one. See owner question.
  ["tests/ci/subject-resolver.contract.test.ts",
   { owner: "guardian", expires: "2026-11-01", why: "injects decisions Postgres cannot produce; needs splitting, not converting" }],
]);

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/** Column vocabulary, read from the shipped schema — never restated here. */
const genesis = fs.readFileSync(path.join(ROOT, GENESIS), "utf8");
const COLUMNS = new Set([...genesis.matchAll(/^\s{2}([a-z][a-z0-9_]{2,})\s+[A-Z]/gm)].map((m) => m[1]));
if (COLUMNS.size < 50) {
  console.log(`FAIL: only ${COLUMNS.size} column names parsed from ${GENESIS} — the gate cannot`);
  console.log("      police a vocabulary it failed to read. Refusing to pass.");
  process.exit(1);
}

/** Backed by a real Postgres connection? This is the discriminator, not the presence of vi.mock. */
const isPgBacked = (src) => /makePgSupabase|new Client\(|from "pg"|from 'pg'/.test(src);
const mocksSupabase = (src) => /vi\.mock\(\s*['"][^'"]*supabase[^'"]*['"]/.test(src);

const files = tracked.filter((f) => IN_SCOPE.test(f));
const violations = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const accepted = ACCEPTED.get(f);

  // RULE A
  if (mocksSupabase(src) && !isPgBacked(src)) {
    if (!accepted) {
      violations.push({ f, rule: "A", detail: "mocks the supabase query layer with no real pg.Client behind it" });
    }
  }

  // RULE B — object literals whose keys are column names
  const rowLiterals = [];
  for (const m of src.matchAll(/\{[^{}]{0,600}\}/gs)) {
    const keys = new Set([...m[0].matchAll(/([a-z][a-z0-9_]{2,})\s*:/g)].map((k) => k[1]));
    const hits = [...keys].filter((k) => COLUMNS.has(k));
    if (hits.length >= 2) rowLiterals.push(hits.slice(0, 4).join(", "));
  }
  if (rowLiterals.length > 0 && !isPgBacked(src) && !accepted) {
    violations.push({ f, rule: "B", detail: `${rowLiterals.length} hand-written row literal(s), e.g. {${rowLiterals[0]}}` });
  }
}

// An accept-list entry for a file that no longer exists is stale bookkeeping, and a stale
// accept-list is how a gate quietly stops covering what it claims to.
const stale = [...ACCEPTED.keys()].filter((f) => !tracked.includes(f));
const expired = [...ACCEPTED.entries()].filter(([, v]) => new Date(v.expires) < new Date());

console.log(`GUARDIAN SCHEMA-TRUTH GATE — ${files.length} guardian test file(s) in scope, ` +
            `${COLUMNS.size} column names from ${GENESIS}`);
if (files.length === 0) {
  console.log("FAIL: zero files scanned. Zero scanned files is not zero violations (CR-STD-01).");
  process.exit(1);
}
for (const [f, v] of ACCEPTED) if (tracked.includes(f)) console.log(`  accepted until ${v.expires} (${v.owner}): ${f} — ${v.why}`);
for (const f of stale) console.log(`  STALE ACCEPT-LIST ENTRY (file is gone, remove it): ${f}`);
for (const [f, v] of expired) console.log(`  EXPIRED ${v.expires}: ${f}`);
for (const v of violations) console.log(`  RULE ${v.rule} VIOLATION: ${v.f}\n      ${v.detail}`);

const failures = violations.length + stale.length + expired.length;
console.log(failures === 0
  ? "GUARDIAN SCHEMA-TRUTH GATE: PASS"
  : `GUARDIAN SCHEMA-TRUTH GATE: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
