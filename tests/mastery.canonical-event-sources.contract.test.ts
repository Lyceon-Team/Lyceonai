import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * canonical_mastery_events source-branch shape assertion.
 *
 * @spec [Doc-05A_V1.0 §4.4 seam guard; Doc-04B mastery_outbox scoring contract]
 * @implemented [2026-08-16]
 *
 * plain English: `canonical_mastery_events` has exactly TWO source branches —
 * practice_session_items and review_error_attempts. It has no branch that can
 * produce `full_length_answer`, so the direct applyMasteryEvent call in
 * fullLengthExam.ts fails the §4.4 seam guard with MASTERY_EVENT_NOT_DERIVED on
 * 100% of full-length events, permanently and by construction. That is invisible
 * today only because no full-length exams have been submitted.
 *
 * WHY THIS TEST AND NOT A GUARD ON THE CALL SITE: a test asserting that
 * fullLengthExam.ts makes no applyMasteryEvent call would be RED on day one,
 * because the call exists. A permanently-red committed test is not shippable, and
 * removing the call is out of scope for this workstream (owner ruling, non-goals).
 *
 * WHAT THIS GUARDS INSTEAD: the risk is that someone "fixes" the full-length seam
 * by adding a full_length_answer branch to canonical_mastery_events. Doc 04B locks
 * a mastery_outbox-in-scoring-transaction contract for that path, which the direct
 * call appears to contradict; the missing branch is consistent with 05A never
 * having expected a direct caller. Both cannot be right. Adding the branch would
 * silently ratify whichever contract happens to be wrong.
 *
 * This test is GREEN today and turns RED the moment that branch appears, forcing
 * the 04B/05A ruling to happen BEFORE the code lands rather than after.
 *
 * expected outcome: green until the seam conflict is resolved in the spec cycle.
 * When it is resolved and a branch is legitimately added, update this test in the
 * SAME change — that is the point, not an inconvenience.
 */

const repoRoot = path.resolve(__dirname, "..");
const SCHEMA = path.join(repoRoot, "scripts/ci/genesis-schema.expected.sql");

function extractFunctionBody(sql: string, signaturePrefix: string): string {
  const start = sql.indexOf(signaturePrefix);
  if (start === -1) {
    throw new Error(
      `function not found in schema snapshot: ${signaturePrefix}`,
    );
  }
  // Body runs to the terminating `$$;` of this CREATE FUNCTION.
  const end = sql.indexOf("$$;", start);
  if (end === -1) {
    throw new Error(`unterminated function body for: ${signaturePrefix}`);
  }
  return sql.slice(start, end);
}

describe("canonical_mastery_events — source branch contract", () => {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const body = extractFunctionBody(
    schema,
    "CREATE FUNCTION public.canonical_mastery_events(p_student_id uuid",
  );

  it("draws from exactly two source tables", () => {
    const practiceBranches = body.match(
      /FROM\s+public\.practice_session_items\b/g,
    );
    const reviewBranches = body.match(
      /FROM\s+public\.review_error_attempts\b/g,
    );

    expect(practiceBranches).toHaveLength(1);
    expect(reviewBranches).toHaveLength(1);

    // Exactly one UNION joining exactly those two branches.
    const unions = body.match(/\bUNION\s+ALL\b/g) ?? [];
    expect(unions).toHaveLength(1);
  });

  it("has no branch that can derive full_length_answer", () => {
    expect(body).not.toContain("full_length_answer");
    expect(body).not.toMatch(/FROM\s+public\.full_length_exam/);
  });

  it("still recognises full_length_answer as a valid apply_mastery_event kind", () => {
    // The asymmetry IS the defect, and this asserts it is still present rather
    // than having been silently resolved in one direction. apply_mastery_event
    // accepts the kind; canonical_mastery_events cannot derive it; the §4.4 guard
    // therefore rejects every full-length event.
    const applyBody = extractFunctionBody(
      schema,
      "CREATE FUNCTION public.apply_mastery_event(p_student_id uuid",
    );
    expect(applyBody).toContain("full_length_answer");
    expect(applyBody).toContain("MASTERY_EVENT_NOT_DERIVED");
  });
});
