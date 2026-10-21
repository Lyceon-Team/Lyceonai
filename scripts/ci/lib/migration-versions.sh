# shellcheck shell=bash
# ============================================================================
# Duplicate migration versions — a ratchet. Sourced (not executed).
# ============================================================================
# @spec [owner brief "migration inventory gate fails on duplicate versions" (Karl, 2026-10-21):
#       "make the migration inventory gate fail on any duplicate migration version (two files
#       sharing the same leading timestamp)"] | @implemented [2026-10-21]
#
# plain English: a migration's version is the digits before its first underscore. Two files with
# the same version are two migrations Supabase's ledger cannot tell apart, and the order they apply
# in is an accident of the rest of the filename. seo carried 20261109000000 twice (lifecycle
# reminder + funnel milestones) through CI without one gate failing; that is the case this closes.
#
# Fifteen duplicates already existed when this was written, all applied in production long ago and
# named by later migrations, mutation scripts and the SCL log. Renaming them is a separate decision,
# so they are frozen below as EXACT file sets:
#   - a version not in the list with two or more files fails  (a NEW duplicate)
#   - a listed version whose file set changed fails            (e.g. a third file joins it)
#   - a listed version that is no longer duplicated fails      (STALE: delete its line, so the
#                                                                list can only ever shrink)
#
# Provides: migration_version_findings <migrations-dir> [<known-list>]
#   prints one finding per line ("NEW …", "CHANGED …", "STALE …"); prints nothing when clean.
#   Returns 0 when clean, 1 on any finding, 2 when the directory cannot be read.
#   <known-list> defaults to KNOWN_DUPLICATE_MIGRATION_VERSIONS; pass "" for none.
# ============================================================================

# One line per grandfathered version: "<version>|<file> <file> [...]", files in sorted order.
# NEVER add a line. Remove one only when that duplicate has been resolved.
KNOWN_DUPLICATE_MIGRATION_VERSIONS='20260827000000|20260827000000_explicit_service_role_grants.sql 20260827000000_guardian_view_decision.sql
20260901000000|20260901000000_scl_080_guardian_link_code.sql 20260901000000_tutor_config_seeds_and_turn_metrics.sql
20260917000000|20260917000000_deletion_evidence_bundle.sql 20260917000000_layer1_crisis_schema_extensions.sql
20260917130000|20260917130000_calendar_v1.sql 20260917130000_declarative_fk_delete_actions.sql
20260921000000|20260921000000_operational_log_retention.sql 20260921000000_review_queue_runtime.sql
20260922000000|20260922000000_calendar_system_triggers_from_tomorrow.sql 20260922000000_lisa_session_lifecycle.sql 20260922000000_seven_year_retention.sql
20260930000000|20260930000000_deletion_verification_in_t3.sql 20260930000000_tutor_conversation_assignment_key_unique.sql
20261005000000|20261005000000_actor_id_integrity_sentinel.sql 20261005000000_review_attempt_used_tutor.sql
20261010000000|20261010000000_exam_domain_breakdown.sql 20261010000000_full_length_interval_weeks.sql
20261013000000|20261013000000_first_sitting_rule.sql 20261013000000_guardian_revoke_party_check.sql
20261014000000|20261014000000_guardian_link_party_roles.sql 20261014000000_hot_path_fk_index_practice_items_question.sql
20261020010000|20261020010000_exam_scored_sessions.sql 20261020010000_rate_limit_ledger_anon.sql
20261027000000|20261027000000_audit_purge_keeps_guardian_consent.sql 20261027000000_marketing_consent_and_product_reviews.sql
20261031000000|20261031000000_notification_quiet_hours_expiry.sql 20261031000000_qotd_readability_scheduler.sql
20261105000000|20261105000000_calendar_config_cache_ttl_seed.sql 20261105000000_getting_started_blind_spots_not_qotd.sql'

migration_version_findings() {
  local dir="$1"
  local known="${2-$KNOWN_DUPLICATE_MIGRATION_VERSIONS}"
  [ -d "$dir" ] || { echo "UNREADABLE $dir is not a directory"; return 2; }

  # "<version>|<sorted files>" for every version with two or more files.
  local actual
  actual="$(
    find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort |
      awk '{ v = $0; sub(/_.*/, "", v); if (n[v]++) files[v] = files[v] " " $0; else files[v] = $0 }
           END { for (v in n) if (n[v] > 1) print v "|" files[v] }' |
      LC_ALL=C sort
  )"

  local found=0 version files expected
  while IFS='|' read -r version files; do
    [ -z "$version" ] && continue
    expected="$(awk -F'|' -v v="$version" '$1 == v { print $2 }' <<<"$known")"
    if [ -z "$expected" ]; then
      echo "NEW $version is shared by: $files"
      found=1
    elif [ "$expected" != "$files" ]; then
      echo "CHANGED $version was frozen as [$expected] but is now [$files]"
      found=1
    fi
  done <<<"$actual"

  while IFS='|' read -r version files; do
    [ -z "$version" ] && continue
    if ! grep -q "^$version|" <<<"$actual"; then
      echo "STALE $version is no longer duplicated; delete its line from KNOWN_DUPLICATE_MIGRATION_VERSIONS"
      found=1
    fi
  done <<<"$known"

  return "$found"
}
