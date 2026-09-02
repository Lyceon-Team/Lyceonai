/**
 * Student link code — generation, issue, and single-use redemption.
 *
 * @spec [SCL-080; Doc 01 V8 §35 Guardian-student linkage; §36.3 Revocation]
 *       | @implemented [2026-09-01]
 *
 * plain English: mints the code a student shares, and spends it when a guardian enters it.
 * Expected outcome: one code redeems exactly once, and the student holds a fresh one
 * immediately afterwards. Trade-off: redemption is one UPDATE rather than a read followed by
 * a write, which costs the ability to distinguish "used" from "expired" from "never existed"
 * — deliberately, because that distinction is an oracle (edge case 1). Edge cases: a
 * generated code colliding with a live one, and two guardians submitting the same code at the
 * same instant.
 *
 * WHY THE RACE IS SETTLED BY THE DATABASE. `redeemStudentLinkCode` is a single conditional
 * UPDATE whose WHERE clause names the code being spent. `profiles_student_link_code_key` is a
 * partial UNIQUE index, so at most one row can carry a given code; the first transaction to
 * match it replaces the value, and the second finds nothing to match. Both statements are
 * atomic against the same row, so the loser observes exactly what a stranger typing an
 * invalid code observes. A read-then-write would let both callers read the same live code and
 * both proceed — the classic double-spend, and the reason this is not written that way.
 *
 * WHY EXPIRY IS IN THE SAME STATEMENT. The TTL bound is a `student_link_code_issued_at`
 * predicate inside the UPDATE, not a check the caller performs first. Checking separately
 * would reintroduce the read-then-write window it exists to close, and would let an expired
 * code be spent by a caller whose clock read happened a moment earlier.
 */
import { randomInt } from "node:crypto";
import {
  STUDENT_LINK_CODE_ALPHABET,
  STUDENT_LINK_CODE_LENGTH,
} from "../../packages/shared/src/student-link-code-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";

/**
 * Bounded, because an unbounded retry on a saturated keyspace is an outage rather than a
 * retry. Three attempts against ~8.9e8 codes: the probability of three consecutive collisions
 * is negligible at any realistic population, and a fourth failure means something is wrong
 * that retrying will not fix.
 */
const MAX_GENERATION_ATTEMPTS = 3;

/** Postgres unique violation — a generated code that is already live on another row. */
const UNIQUE_VIOLATION = "23505";

export type RedeemOutcome =
  | { ok: true; studentProfileId: string }
  | { ok: false; reason: "not_redeemable" }
  | { ok: false; reason: "unavailable" };

/**
 * A fresh code.
 *
 * `randomInt` is the CSPRNG-backed, rejection-sampled integer generator from `node:crypto`.
 * `Math.random()` is not used and must not be: it is seeded predictably and a predictable
 * link code is a way to attach an adult to a minor's account.
 *
 * Modulo bias is avoided by `randomInt(max)` itself, which resamples rather than folding — so
 * every character of the 31-character alphabet is equally likely.
 */
export function generateStudentLinkCode(): string {
  let out = "";
  for (let i = 0; i < STUDENT_LINK_CODE_LENGTH; i += 1) {
    out +=
      STUDENT_LINK_CODE_ALPHABET[randomInt(STUDENT_LINK_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Issue a new code to a student, replacing whatever they had.
 *
 * Used both for first issue and for the student's own regenerate control; they are the same
 * operation, so there is one implementation. Returns the code so the caller can render it
 * without a second read.
 */
export async function issueStudentLinkCode(
  studentProfileId: string,
): Promise<{ code: string; issuedAt: string } | null> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateStudentLinkCode();
    const issuedAt = new Date().toISOString();
    const { error } = await supabaseServer
      .from("profiles")
      .update({
        student_link_code: code,
        student_link_code_issued_at: issuedAt,
      })
      .eq("id", studentProfileId);

    if (!error) return { code, issuedAt };

    // Edge case 8: the partial unique index is the arbiter. Regenerate, bounded.
    if (error.code === UNIQUE_VIOLATION) continue;

    logger.error(
      "AUTH",
      "link_code_issue",
      "Failed to issue student link code",
      {
        ...classifyError(error),
      },
    );
    return null;
  }

  logger.error(
    "AUTH",
    "link_code_issue",
    "Exhausted link code generation attempts",
    { attempts: MAX_GENERATION_ATTEMPTS },
  );
  return null;
}

/**
 * Spend a code and immediately re-issue the student's next one, in one statement.
 *
 * Returns `not_redeemable` for used, expired, and never-existed alike — one response, because
 * distinguishing them tells an attacker whether a code was ever real (edge case 1).
 */
export async function redeemStudentLinkCode(
  enteredCode: string,
  ttlSeconds: number,
): Promise<RedeemOutcome> {
  // The oldest issue time still inside the TTL. Computed once so every attempt below judges
  // the same window rather than drifting as retries take time.
  const liveSince = new Date(Date.now() - ttlSeconds * 1000).toISOString();

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const replacement = generateStudentLinkCode();

    const { data, error } = await supabaseServer
      .from("profiles")
      .update({
        student_link_code: replacement,
        student_link_code_issued_at: new Date().toISOString(),
      })
      .eq("student_link_code", enteredCode)
      .eq("role", "student")
      .gt("student_link_code_issued_at", liveSince)
      .select("id");

    // The REPLACEMENT collided with a live code on another row. The spend has not happened;
    // mint a different replacement and try the same conditional update again.
    if (error?.code === UNIQUE_VIOLATION) continue;

    if (error) {
      logger.error("AUTH", "link_code_redeem", "Link code redemption failed", {
        ...classifyError(error),
      });
      return { ok: false, reason: "unavailable" };
    }

    const rows = (data ?? []) as ReadonlyArray<{ id: string }>;
    // Zero rows is the whole point: used, expired, or never real, the caller cannot tell.
    if (rows.length === 0) return { ok: false, reason: "not_redeemable" };

    const first = rows[0];
    if (!first) return { ok: false, reason: "not_redeemable" };
    return { ok: true, studentProfileId: first.id };
  }

  logger.error(
    "AUTH",
    "link_code_redeem",
    "Exhausted replacement generation during redemption",
    { attempts: MAX_GENERATION_ATTEMPTS },
  );
  return { ok: false, reason: "unavailable" };
}

/**
 * The student's current code and when it was issued, or `null` if the read failed.
 *
 * A student who has never been issued a code returns `{ code: null, issuedAt: null }` — a
 * successful read of "nothing yet", which the caller turns into an issue. That is distinct
 * from `null`, which means the read itself failed and the caller must not invent a code.
 */
export async function readStudentLinkCode(
  studentProfileId: string,
): Promise<{ code: string | null; issuedAt: Date | null } | null> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("student_link_code, student_link_code_issued_at")
    .eq("id", studentProfileId)
    .maybeSingle();

  if (error) {
    logger.error("AUTH", "link_code_read", "Failed to read student link code", {
      ...classifyError(error),
    });
    return null;
  }

  const row = data as {
    student_link_code?: string | null;
    student_link_code_issued_at?: string | null;
  } | null;

  return {
    code: row?.student_link_code ?? null,
    issuedAt: row?.student_link_code_issued_at
      ? new Date(row.student_link_code_issued_at)
      : null,
  };
}
