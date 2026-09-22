# ──────────────────────────────────────────────────────────────────────
# BigQuery dataset — imported from existing resource
#
# Dataset: lyceon_analytics_archive_prod
# Doc 07B §5.1: "System-state-archive aggregates"
# Naming: lyceon_analytics_archive_<env> (retention-archive.ts:73-78)
#
# Tables (Phase 2):
#   retention__tutor_instruction_assignments
#   retention__tutor_instruction_exposures
#   retention__crisis_review_cases
#   retention__tutor_injection_log
# ──────────────────────────────────────────────────────────────────────

resource "google_bigquery_dataset" "archive" {
  dataset_id = "lyceon_analytics_archive_prod"
  project    = var.project

  # Verified by Karl via:
  #   bq show --format=prettyjson replit-cop:lyceon_analytics_archive_prod | grep location
  # Returns "us-central1" (regional, not the multi-region "US" default).
  # BigQuery location is immutable — a mismatch here would propose destroy+recreate.
  location = "us-central1"

  description = "LISA retention archive per Doc 03 §14.2"

  # Doc 07B §5.1, line 173: "Partition-expiration: NOT set on event
  # tables (retention is 'forever' for the pseudonymized 13+ class)."
  # default_table_expiration_ms is intentionally omitted (no expiry).
  #
  # THAT JUSTIFICATION DOES NOT DESCRIBE THE RETENTION ARCHIVE, and the
  # archive is being retired because of it (owner ruling 2026-09-22, SCL-106).
  # The four `retention__*` tables this dataset was provisioned for hold raw
  # rows exported straight out of Supabase — every one carries a real
  # `student_id`, and the crisis table also carries `reviewer_id` and
  # free-text reviewer notes about a minor. They are not pseudonymized, so
  # the sentence above never applied to them, and Doc 07B §5.4's no-PII
  # invariant for the archive layer forbids them outright. Nothing has ever
  # been archived (the client's dependency was never installed), so there is
  # nothing to migrate: the 90d and 180d tutor tiers will delete outright
  # instead, and a follow-up PR removes the archive path, its schemas and
  # this dataset's only consumer. No table resource is declared here.

  lifecycle {
    prevent_destroy = true
  }
}
