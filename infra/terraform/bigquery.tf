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

  description = "LISA analytics archive — retention pipeline destination"

  # Doc 07B §5.1, line 173: "Partition-expiration: NOT set on event
  # tables (retention is 'forever' for the pseudonymized 13+ class)."
  # default_table_expiration_ms is intentionally omitted (no expiry).

  lifecycle {
    prevent_destroy = true
  }
}
