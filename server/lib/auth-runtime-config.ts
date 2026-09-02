/**
 * Reader for `auth_runtime_config` — the one owner of that config read.
 *
 * @spec [SCL-080 (student link code TTL); Doc 01 §1705 "All identity/access constants live in
 *        DB per cross-cutting constants doctrine"] | @implemented [2026-09-01]
 *
 * plain English: reads operator-tunable identity constants out of the database instead of
 * hard-coding them. Expected outcome: changing how long a student link code lives is an
 * operator action, not a deploy.
 *
 * WHY THIS TABLE. `auth_runtime_config` already exists with the same shape as every other
 * `*_runtime_config` (key PK, jsonb value, CHECK-constrained `value_type`), and the link code
 * is an identity artifact on `profiles` — Doc 01 is "Identity, Access, Billing & Guardian
 * Trust". Owner ruling 2026-09-01. It holds zero rows today, so this reader is its first
 * consumer; the row is queued as D-9 in `docs/plans/GUARDIAN_LINK_CODE_DDL.md`.
 *
 * WHY IT MIRRORS `entitlement-runtime-config.ts` RATHER THAN GENERALISING. Each config domain
 * has its own reader in this repo. A generic reader would have to take the table name as a
 * parameter, which turns a typo into a silent empty read; the per-domain form makes the table
 * a constant. Extending the pattern is the established shape, not a fork.
 *
 * WHY NO CACHE. The call sites are the student's own settings panel and the guardian's redeem
 * request — neither is a hot path, and inventing a TTL for the TTL would be a second
 * unreviewed constant.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";

/** The key D-9 seeds. Named once so the reader and the DML cannot disagree. */
export const STUDENT_LINK_CODE_TTL_KEY = "student_link_code_ttl_seconds";

/**
 * Code lifetime in seconds, or `null` when it cannot be read as a positive number.
 *
 * `null` is NOT a default. `isLinkCodeLive` treats a non-positive or non-finite TTL as
 * expired, so an unconfigured TTL makes every code dead rather than eternal. That is the
 * fail-closed direction and it is deliberate: a code that never expires because its config
 * row is missing is the failure mode this whole mechanism exists to avoid.
 */
export async function getStudentLinkCodeTtlSeconds(): Promise<number | null> {
  const { data, error } = await supabaseServer
    .from("auth_runtime_config")
    .select("value")
    .eq("key", STUDENT_LINK_CODE_TTL_KEY)
    .maybeSingle();

  if (error) {
    logger.error(
      "AUTH",
      "link_code_ttl_read",
      "Failed to read student link code TTL",
      { key: STUDENT_LINK_CODE_TTL_KEY, ...classifyError(error) },
    );
    return null;
  }

  const raw = (data as { value?: unknown } | null)?.value;
  const ttl = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}
