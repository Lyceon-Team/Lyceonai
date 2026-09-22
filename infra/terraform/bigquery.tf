# ──────────────────────────────────────────────────────────────────────
# BigQuery archive dataset — imported, and now unused
#
# Dataset: lyceon_analytics_archive_prod
#
# @spec [Doc-07B_V1.0 §5.1 (dataset layout) + §5.4 (no-PII invariant);
#        owner ruling 2026-09-22; SCL-106, SCL-108] | @implemented [2026-09-22]
#
# plain English: this dataset was provisioned for the LISA retention archive.
# The retention archive no longer exists. Nothing in this repo writes to the
# dataset, and no table resource is declared for it.
#
# WHY THE RESOURCE BLOCK STAYS ANYWAY. It is an IMPORT of a dataset that
# really exists in GCP (imports.tf). Deleting the block does not tidy
# anything up — Terraform would plan a DESTROY, `prevent_destroy` would
# refuse it, and the apply would fail. Whether the dataset itself is deleted
# in GCP is an owner decision with no code consequence either way, so the
# import stays and this comment records the state rather than a plan doing it
# silently.
#
# WHAT HAPPENED. From 2026-08-26 the 90d and 180d retention tiers exported
# every expired row here before deleting it, and refused to delete when they
# could not. The exported rows were raw Supabase rows: every one carried a
# real `student_id`, and `retention__crisis_review_cases` also carried
# `reviewer_id` and `review_notes` — free text written by a human reviewer
# about a minor in crisis. Doc 07B §5.4 bans identity-bearing columns in the
# warehouse absolutely ("no `supabase_user_id`"), and §5.3's "retention is
# 'forever' for the pseudonymized 13+ class" never described these rows,
# because they are not pseudonymized.
#
# The owner ruling of 2026-09-22: "stop archiving, delete outright ...
# BigQuery is the worst home for those. Nothing has ever been archived, so
# there's nothing to migrate." Nothing ever was: the archive client's
# `@google-cloud/bigquery` dependency was never installed, so every attempt
# declined with `archive_client_not_configured`. The dataset has been empty
# for its whole existence.
#
# The four `retention__*` tables were never created by Terraform and are not
# created here. If any exist in GCP from a manual `bq mk`, they are empty and
# can be dropped at the owner's convenience.
# ──────────────────────────────────────────────────────────────────────

resource "google_bigquery_dataset" "archive" {
  dataset_id = "lyceon_analytics_archive_prod"
  project    = var.project

  # Verified by Karl via:
  #   bq show --format=prettyjson replit-cop:lyceon_analytics_archive_prod | grep location
  # Returns "us-central1" (regional, not the multi-region "US" default).
  # BigQuery location is immutable — a mismatch here would propose destroy+recreate.
  location = "us-central1"

  description = "LISA retention archive per Doc 03 §14.2 — retired 2026-09-22, see the header"

  lifecycle {
    prevent_destroy = true
  }
}
