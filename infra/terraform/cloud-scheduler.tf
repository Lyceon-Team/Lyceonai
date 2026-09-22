# ──────────────────────────────────────────────────────────────────────
# Cloud Scheduler — tutor retention sweep (7d tier)
#
# @spec [Doc-03_V1.1 §14.2, INV-03-19; Doc-03C_V3 §9.3]
# @implemented 2026-09-21
#
# plain English: `POST /api/internal/retention/sweep` has existed since
# 2026-08-20 behind an OIDC guard whose header comment says "Called by
# Cloud Scheduler (one job per retention tier)". No such job existed —
# not in this directory, not in `vercel.json`. The route has therefore
# never been invoked in production by anything. This file is the caller
# the route was written for.
#
# expected outcome: once applied, GCP delivers a signed POST to the
# retention sweep once a day, and the 7d tier hard-deletes tutor
# conversations whose `deleted_at` expired 7+ days ago.
#
# WHY CLOUD SCHEDULER AND NOT VERCEL CRON. Six sibling sweeps are
# scheduled in `vercel.json`. This one cannot join them: Vercel Cron
# issues an unauthenticated GET, and this route is a POST behind
# `oidcAuthMiddlewareWithConfigGuard`. A Vercel cron entry would get 404
# from the router and, if the method matched, 401 from the guard.
# Rewriting the route to a GET to fit the sibling pattern would mean
# removing the OIDC guard Doc 03C §9.3 requires. The managed service
# that mints an OIDC token on delivery is Cloud Scheduler, so the
# schedule goes where the auth already points.
#
# HOW THE INVOKER IS AUTHORISED. Not by IAM. The target is the Vercel
# deployment over public HTTPS, not a Cloud Run service, so there is no
# `run.invoker` binding to grant and none is created here. Authorisation
# is entirely the two claims our own middleware checks
# (`packages/shared/internal-auth/verify-oidc-middleware.ts`):
#
#   aud   — must equal RETENTION_SWEEP_OIDC_AUDIENCE (falling back to
#           CLOUD_TASKS_OIDC_AUDIENCE). Set below, and emitted as the
#           `retention_sweep_oidc_audience` output so the env var is
#           copied from Terraform rather than retyped.
#   email — must equal CLOUD_TASKS_SERVICE_ACCOUNT. That env var holds
#           exactly one address, so this job MUST sign as the same
#           service account the memory routes use. A dedicated
#           per-schedule SA would fail the check, not improve isolation.
#
# Google signs the token; the route verifies the signature against
# Google's keys before either claim is read. A caller without the
# private key cannot forge either.
#
# trade-offs:
#  - `request_id` is a fixed UUID. Cloud Scheduler bodies are static —
#    there is no per-delivery substitution — and the route's Zod schema
#    requires a UUID. So this value identifies the JOB, not the run.
#    Correlate a specific sweep by timestamp plus the `tier` field the
#    handler logs, not by `requestId`.
#  - Only the 7d tier is scheduled. See the note at the foot of this file.
#
# edge cases:
#  - Duplicate delivery on retry is safe: the DELETE is idempotent, since
#    already-deleted rows no longer match the WHERE clause.
#  - An empty sweep is the normal case and returns 200 with
#    deleted_count 0 — see the reported finding on `deleted_at`.
# ──────────────────────────────────────────────────────────────────────

resource "google_project_service" "cloudscheduler" {
  project = var.project
  service = "cloudscheduler.googleapis.com"

  disable_on_destroy = false
}

resource "google_cloud_scheduler_job" "retention_sweep_7d" {
  name        = "lyceon-retention-sweep-7d"
  project     = var.project
  region      = var.region
  description = "Tutor retention sweep, 7d tier — Doc 03 §14.2 retention matrix"

  # 05:30 UTC, after the last Vercel-scheduled sweep (notification
  # retention, 0 5) and well after execute-deletions (0 2). Vercel crons
  # are UTC, so pinning this job to UTC keeps one clock across all seven
  # sweeps rather than two.
  schedule  = "30 5 * * *"
  time_zone = "Etc/UTC"

  # Vercel's function ceiling is 300s; allow a little past it so the
  # deadline is the platform's, not the scheduler's.
  attempt_deadline = "320s"

  retry_config {
    # The route returns 500 only on unexpected errors — a tier that
    # declines to run returns 200 with ok:false, which is not retried.
    retry_count          = 3
    max_retry_duration   = "600s"
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${var.app_base_url}/api/internal/retention/sweep"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      retention_tier = "7d"
      dry_run        = false
      request_id     = "8357caf1-525c-406b-8fe6-9661967eead9"
    }))

    oidc_token {
      service_account_email = google_service_account.cloud_tasks.email
      audience              = "${var.app_base_url}/api/internal/retention/sweep"
    }
  }

  depends_on = [google_project_service.cloudscheduler]

  lifecycle {
    prevent_destroy = true
  }
}

# ──────────────────────────────────────────────────────────────────────
# The other three tiers are deliberately NOT scheduled here.
#
#   90d  — archives tutor_instruction_assignments/exposures to BigQuery
#          before deleting. Two of the three prerequisites are now met
#          (2026-09-22): the four archive tables exist in Terraform,
#          DAY-partitioned with a 730-day partition expiration
#          (bigquery.tf), and BIGQUERY_ARCHIVE_DATASET is emitted as the
#          `bigquery_archive_dataset` output with a README row. The third
#          is not: `createBigQueryArchiveClient()` requires
#          `@google-cloud/bigquery`, which is in no package.json and
#          absent from pnpm-lock.yaml — it appears only as `--external`
#          in the build:vercel esbuild line. The require therefore throws,
#          `getArchiveClient()` catches it, and the tier still returns
#          ok:false, reason:"archive_client_not_configured" even with the
#          env var set. Adding the dependency needs owner approval.
#   180d — same dependency, for resolved crisis cases.
#   365d — `sweep365d` unconditionally returns
#          ok:false, reason:"365d_tables_not_provisioned". The tables do
#          not exist. Reported, not built: the brief scoped them out.
#
# Each is a real retention gap, reported rather than papered over with a
# job that cannot do its work. Scheduling 90d and 180d is now a one-line
# change per tier, gated on that single approval.
# ──────────────────────────────────────────────────────────────────────
