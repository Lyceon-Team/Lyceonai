# ──────────────────────────────────────────────────────────────────────
# BigQuery archive — dataset (imported) + the four retention tables
#
# Dataset: lyceon_analytics_archive_prod
# Doc 07B §5.1: "System-state-archive aggregates"
# Naming: lyceon_analytics_archive_<env> (retention-archive.ts)
#
# Tables (below, one per ARCHIVE_TABLE_MAP entry):
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

  # NO DATASET-LEVEL DEFAULT EXPIRATION, DELIBERATELY — and this is not the
  # same decision as the one that used to be recorded here.
  #
  # `default_partition_expiration_ms` would apply to every partitioned table
  # in the dataset, including the Doc 07B §13 system-state-archive aggregates
  # this dataset is *named* for (§5.1). Doc 07B §5.3 says those carry no
  # partition expiration, and 07E §5.2 gives them an indefinite horizon. A
  # dataset default would silently start deleting them.
  #
  # The 24-month expiration the published privacy policy promises is therefore
  # set per table, on the four `retention__*` tables below and nowhere else.
  # `default_table_expiration_ms` stays unset for the same reason.

  lifecycle {
    prevent_destroy = true
  }
}

# ──────────────────────────────────────────────────────────────────────
# Retention archive tables
#
# @spec [Doc-07B_V1.0 §5.3 partitioning discipline + §13 archive timestamp
#   semantics + §14.2 partition-required discipline; Doc-03_V1.1 §14.2;
#   Privacy Policy v4 §6.6; owner ruling 2026-09-22 B3]
# @implemented [2026-09-22]
#
# plain English: the four tables the 90d and 180d retention sweeps export to
# before deleting rows from Supabase. Each is partitioned by day on
# `event_date` — the UTC date of the archive operation — and each partition is
# dropped by BigQuery 730 days later.
#
# expected outcome: a row archived on day D is queryable until D+730 and gone
# after it, with no scheduled job, no deletion query and no application code
# involved. That is the whole point of choosing the native mechanism.
#
# WHY TERRAFORM OWNS THESE TABLES AND NOT THE APPLICATION.
# `server/services/retention-archive.ts` inserts rows; it does not issue DDL.
# The repo already had one DDL path for these tables —
# `scripts/retention/generate-bq-archive-schemas.mjs` emits the column set,
# the JSON is checked in, and `scripts/ci/retention-archive-drift-check.mjs`
# fails CI when Postgres drifts from it. Adding `createTable` to the archive
# client would have been a second path to the same four tables, and the two
# would disagree the first time one of them changed. Terraform reads the same
# checked-in JSON, so there is exactly one column set in the repo.
#
# WHY `event_date` AND NOT A SOURCE TIMESTAMP. Doc 07B §13 names the shape:
# "every archived aggregate carries the `event_date` partition + an
# `_archived_at` timestamp". The retention clock the policy promises runs from
# archival, so the partition key is `DATE(_archived_at)`. Partitioning on the
# source row's `created_at` would file a 90-day-old row into a partition
# already 90 days into its 730-day life — and a backlog row into one that had
# already expired.
#
# WHY 730 DAYS. Privacy Policy v4 §6.6: de-identified analytics data is kept
# "up to 24 months, then only in aggregate." 730 = 2 x 365 is the conservative
# reading of an upper bound. The number is
# `ARCHIVE_PARTITION_EXPIRATION_MS` in `server/services/retention-archive.ts`
# and a contract test asserts this file carries the same value, so the promise
# and the infrastructure cannot drift apart.
#
# SPEC DIVERGENCE, RECORDED NOT HIDDEN. Doc 07B §5.3 says
# "Partition-expiration: NOT set on event tables ... System-state-archive
# tables (§13) similarly carry no partition expiration", and Doc 07E §5.2
# gives class 2 an indefinite horizon with "No expiry." Setting expiration
# here contradicts both. It is filed as SCL-106 (PROPOSED) rather than worked
# around, and the spec is not edited. The short version of why the published
# policy wins: §5.3's rationale is "retention is 'forever' for the
# pseudonymized 13+ class", and these four tables are not pseudonymized —
# every one of them carries a real `student_id` (see the checked-in schemas),
# so the sentence that justified no-expiry does not describe them.
#
# trade-offs:
#  - No `clustering`. §5.3 clusters event tables by `event_name` then
#    `analytics_user_id`; these tables have neither, and each holds exactly
#    one source table, so clustering on `_source_table` would be a
#    single-valued index. Recorded rather than invented.
#  - `require_partition_filter = true` implements §14.2's partition-required
#    discipline: a query that forgets a date filter fails instead of scanning
#    every partition. It also means the §12.3 under-13 purge must carry the
#    partition predicate §12.3 already requires of it.
#  - `deletion_protection = true` keeps `terraform destroy` from taking a
#    table with archived minors' data in it.
#
# APPLY ORDER (Karl): the dataset already exists and is imported. These four
# tables are new to Terraform. If any of them already exists in BigQuery it is
# empty — nothing has ever been archived, because the 90d/180d tiers have
# never had a working archive client — and it is unpartitioned, which cannot
# be changed in place. Drop such a table (`bq rm -t PROJECT:DATASET.TABLE`)
# before `terraform apply`; do not import it, or the partitioning below
# becomes a no-op that Terraform reports as success.
# ──────────────────────────────────────────────────────────────────────

locals {
  # Must match ARCHIVE_TABLE_MAP in server/services/retention-archive.ts.
  # Keyed by BigQuery table name so `for_each` keys are stable in state.
  retention_archive_tables = toset([
    "retention__tutor_instruction_assignments",
    "retention__tutor_instruction_exposures",
    "retention__crisis_review_cases",
    "retention__tutor_injection_log",
  ])

  # 730 days in milliseconds = ARCHIVE_PARTITION_EXPIRATION_MS.
  # 730 * 24 * 60 * 60 * 1000
  retention_archive_partition_expiration_ms = 63072000000
}

resource "google_bigquery_table" "retention_archive" {
  for_each = local.retention_archive_tables

  dataset_id = google_bigquery_dataset.archive.dataset_id
  table_id   = each.value
  project    = var.project

  description = "Retention archive for public.${replace(each.value, "retention__", "")} — Doc 03 §14.2 sweep export. Partition expiry 730d per Privacy Policy v4 §6.6."

  # One schema, read from the file the generator writes and the drift-check
  # gate guards. Never inlined here — an inlined copy is a second schema.
  schema = file("${path.module}/../../scripts/retention/schemas/${each.value}.json")

  time_partitioning {
    type          = "DAY"
    field         = "event_date"
    expiration_ms = local.retention_archive_partition_expiration_ms
  }

  require_partition_filter = true

  deletion_protection = true
}
