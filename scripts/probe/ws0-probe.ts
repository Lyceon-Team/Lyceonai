/**
 * WS-0 — Stop the Bleed — PostgREST probe
 * @spec [GAP-TB-01, GAP-TB-02, GAP-TB-03, GAP-TU-06 | docs/Spec/lyceon-coding-standards.md §5.2, §14] | @implemented [2026-06-07]
 * plain English: executable proof that anon/authenticated cannot read answer
 * content or write the locked-down tables via PostgREST; PASS/FAIL per assertion,
 * non-zero exit on any FAIL. Run post-apply against production.
 * =============================================================================
 * Exercises every contract assertion reachable via PostgREST (the anon role and,
 * optionally, an authenticated student) and prints PASS/FAIL per assertion with
 * the raw HTTP status. Exits non-zero on any FAIL.
 *
 * Contract: contracts/ws0-stop-the-bleed.contract.md
 * Proves:   GAP-TB-01, GAP-TB-02, GAP-TB-03, GAP-TU-06 (the DB-trust-boundary
 *           assertions). GAP-ID-11 is proven by the route tests
 *           (tests/ci/guardian-consent.id11.contract.test.ts), NOT here, because
 *           the forgery vector is an app-layer flow not reachable anonymously.
 *           GAP-MA-09 is proven by the migration's verification block (pg_trigger),
 *           which needs catalog access this anon/auth probe does not have.
 *
 * HOW TO RUN: manually, against PRODUCTION, AFTER the owner applies
 *   supabase/migrations/20260607_ws0_stop_the_bleed.sql. This becomes a
 *   scheduled CI job in WS-1+ once a shadow project exists.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... [TEST_STUDENT_JWT=...] \
 *     pnpm -s exec tsx scripts/probe/ws0-probe.ts
 *
 * SAFETY: write probes expect a permission-denied rejection (grants revoked +
 *   RLS enabled). When the migration is applied they are rejected at the
 *   permission layer before any row is written. If the migration is NOT applied,
 *   a write probe FAILs loudly (and may insert a stray row) — that is the signal
 *   the migration still needs to be applied.
 * =============================================================================
 */

/* eslint-disable no-console -- standalone CLI diagnostic: console is this
   script's output channel, not production logging (Coding Standards §16 targets
   product code). Consistent with the existing scripts/*.ts convention. */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEST_STUDENT_JWT = process.env.TEST_STUDENT_JWT;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_ANON_KEY are required.");
  process.exit(2);
}

type Role = "anon" | "authenticated";
type Outcome = { ok: boolean; status: number; note: string };

const results: { name: string; outcome: Outcome }[] = [];
let skipped = 0;

function authHeaders(role: Role): Record<string, string> {
  const bearer =
    role === "authenticated"
      ? (TEST_STUDENT_JWT as string)
      : (SUPABASE_ANON_KEY as string);
  return {
    apikey: SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${bearer}`,
  };
}

async function rest(
  method: string,
  path: string,
  role: Role,
  body?: unknown,
): Promise<{ status: number; rows: unknown }> {
  const headers: Record<string, string> = authHeaders(role);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, rows: parsed };
}

/** A read is SAFE if it errors (non-200) OR returns 200 with an empty array. */
function assertReadDenied(name: string, status: number, rows: unknown): void {
  if (status !== 200) {
    record(name, { ok: true, status, note: "privilege/RLS error (expected)" });
    return;
  }
  if (Array.isArray(rows) && rows.length === 0) {
    record(name, { ok: true, status, note: "200 but zero rows (RLS deny)" });
    return;
  }
  const n = Array.isArray(rows) ? rows.length : "non-array";
  record(name, { ok: false, status, note: `LEAK: 200 with ${n} row(s)` });
}

/** A write is SAFE if it is rejected (not a 2xx). */
function assertWriteDenied(name: string, status: number): void {
  const ok = status < 200 || status >= 300;
  record(name, {
    ok,
    status,
    note: ok ? "write rejected (expected)" : "WRITE ACCEPTED — boundary open",
  });
}

function record(name: string, outcome: Outcome): void {
  results.push({ name, outcome });
  const tag = outcome.ok ? "PASS" : "FAIL";
  console.log(
    `[${tag}] ${name} :: status=${outcome.status} :: ${outcome.note}`,
  );
}

// Answer-bearing column selects (enumerated from capture A2 in the contract).
const ANSWER_SELECTS: Record<string, string> = {
  questions: "correct_answer,explanation",
  practice_session_items: "question_correct_answer,question_explanation",
  review_session_items: "question_correct_answer,question_explanation",
  full_length_exam_questions:
    "question_correct_answer,question_explanation,question_answer_text",
};

const NINE_TABLES = [
  "test_forms",
  "constants_audit_log",
  "documents",
  "embeddings",
  "question_classification_updates",
  "question_embeddings",
  "sat_math_topics_ref",
  "sat_rw_skills_ref",
  "sat_sections_ref",
] as const;

function roles(): Role[] {
  return TEST_STUDENT_JWT ? ["anon", "authenticated"] : ["anon"];
}

async function run(): Promise<void> {
  console.log("=== WS-0 PostgREST probe ===");
  console.log(`target: ${SUPABASE_URL}`);
  if (!TEST_STUDENT_JWT) {
    console.log(
      "NOTE: TEST_STUDENT_JWT not set — authenticated-role assertions are SKIPPED.",
    );
    skipped += 1;
  }
  console.log("");

  // TB-01 — questions answer columns must not be readable.
  for (const role of roles()) {
    const r = await rest(
      "GET",
      `questions?select=${ANSWER_SELECTS.questions}`,
      role,
    );
    assertReadDenied(
      `TB-01.${role} questions(correct_answer,explanation)`,
      r.status,
      r.rows,
    );
  }

  // TB-02 — denormalized answer columns on the three session-item tables.
  for (const table of [
    "practice_session_items",
    "review_session_items",
    "full_length_exam_questions",
  ] as const) {
    for (const role of roles()) {
      const r = await rest(
        "GET",
        `${table}?select=${ANSWER_SELECTS[table]}`,
        role,
      );
      assertReadDenied(`TB-02.${role} ${table}(answers)`, r.status, r.rows);
    }
  }

  // TB-03 — nine tables: writes denied; select default-denied.
  for (const table of NINE_TABLES) {
    for (const role of roles()) {
      const ins = await rest("POST", table, role, {});
      assertWriteDenied(`TB-03.${role} ${table}.insert`, ins.status);

      const upd = await rest(
        "PATCH",
        `${table}?id=eq.00000000-0000-0000-0000-000000000000`,
        role,
        { x: 1 },
      );
      assertWriteDenied(`TB-03.${role} ${table}.update`, upd.status);

      const del = await rest(
        "DELETE",
        `${table}?id=eq.00000000-0000-0000-0000-000000000000`,
        role,
      );
      assertWriteDenied(`TB-03.${role} ${table}.delete`, del.status);

      const sel = await rest("GET", `${table}?select=*`, role);
      assertReadDenied(`TB-03.${role} ${table}.select`, sel.status, sel.rows);
    }
  }

  // TU-06 — tutor_memory_summaries: insert denied for anon/authenticated.
  for (const role of roles()) {
    const ins = await rest("POST", "tutor_memory_summaries", role, {});
    assertWriteDenied(
      `TU-06.${role} tutor_memory_summaries.insert`,
      ins.status,
    );

    const upd = await rest(
      "PATCH",
      "tutor_memory_summaries?id=eq.00000000-0000-0000-0000-000000000000",
      role,
      { summary_type: "x" },
    );
    assertWriteDenied(
      `TU-06.${role} tutor_memory_summaries.update`,
      upd.status,
    );

    const del = await rest(
      "DELETE",
      "tutor_memory_summaries?id=eq.00000000-0000-0000-0000-000000000000",
      role,
    );
    assertWriteDenied(
      `TU-06.${role} tutor_memory_summaries.delete`,
      del.status,
    );
  }

  const failed = results.filter((r) => !r.outcome.ok);
  console.log("");
  console.log(
    `=== ${results.length} assertions, ${failed.length} FAIL, ${skipped} skip-groups ===`,
  );
  if (failed.length > 0) {
    console.log("FAILURES:");
    for (const f of failed)
      console.log(
        `  - ${f.name} (status=${f.outcome.status}: ${f.outcome.note})`,
      );
    process.exit(1);
  }
  console.log("All reachable WS-0 assertions PASS.");
}

run().catch((err: unknown) => {
  console.error("PROBE ERROR:", err);
  process.exit(2);
});
