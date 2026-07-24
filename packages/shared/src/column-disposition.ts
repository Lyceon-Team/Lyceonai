/**
 * Column-disposition contract for the `questions` table.
 *
 * @spec [Doc-02B_V4 §14/§20; Doc 02 Preamble V3 §12 INV-02B-01; Coding Standards §5]
 * @implemented [2026-07-24]
 *
 * Maps EVERY column in public.questions to exactly one disposition:
 *   - served_pre_submit:  student-facing render content, safe before answer submission
 *   - server_only:        never reaches any student surface (internal, answer-bearing, or unused)
 *   - post_submit_only:   revealed only after the student submits (correct_answer, explanation)
 *
 * This registry is GENERAL — review and full-length surfaces inherit the same dispositions.
 * A CI test reads genesis-schema.expected.sql and fails if any questions column has no
 * declared disposition here.
 */

export type ColumnDisposition =
  | "served_pre_submit"
  | "server_only"
  | "post_submit_only";

export const QUESTIONS_COLUMN_DISPOSITION: Record<string, ColumnDisposition> = {
  // --- Student-facing render content (safe pre-submit) ---
  id: "served_pre_submit",
  section: "served_pre_submit",
  domain: "served_pre_submit",
  difficulty: "served_pre_submit",
  stem: "served_pre_submit",
  passage: "served_pre_submit",
  options: "served_pre_submit",
  assets: "served_pre_submit", // role-filtered: stimulus/option pre-submit, explanation post-submit only
  item_type: "served_pre_submit",
  skill_codes: "served_pre_submit",

  // --- Post-submit only (revealed after student submits) ---
  correct_answer: "post_submit_only",
  explanation: "post_submit_only",

  // --- Server-only (never reaches student surface) ---
  correct_variants: "server_only",
  option_metadata: "server_only",
  estimated_time_seconds: "server_only",
  source_type: "server_only",
  status: "server_only",
  version: "server_only",
  created_at: "server_only",
  published_at: "server_only",
  retired_at: "server_only",
  source_lineage: "server_only",
  generation_attribution: "server_only",
  premium_flag: "server_only", // Karl: permanently unused — no entitlement filtering
  quality_score: "server_only",
  issue_flags: "server_only",
};
