# ──────────────────────────────────────────────────────────────────────
# Cloud Scheduler — LISA video library link-rot check (daily)
#
# @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §10 (a scheduled YouTube Data
#       API check marks unavailable videos; the Cloud Scheduler pattern)]
# @implemented [2026-10-15]
#
# plain English: `POST /api/internal/video-link-check` checks every video_resources row
# against the YouTube Data API and marks a deleted, private or non-embeddable video
# unavailable, so LISA stops offering it. This job is its caller, built on the crisis sweep's
# pattern (cloud-scheduler-crisis.tf): OIDC-signed, same service account, its own audience.
#
# WHY A SEPARATE FILE. cloud-scheduler.tf holds the retention tiers, and
# tests/ci/retention-policy-publication.contract.test.ts treats every job in it as a
# retention tier. The API enablement and service account are shared from there.
#
# trade-offs:
#  - Daily at 06:10 UTC: a takedown is caught within a day; ~4 quota units a run (163 videos,
#    50 per call) against the default 10,000/day. Minute 10 avoids the retention jobs'
#    05:30-05:50 window and the crisis sweep's minute 15.
#  - No body: the handler takes no input. A retried delivery repeats a read and an
#    idempotent status write.
# ──────────────────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "video_link_check" {
  name        = "lyceon-video-link-check"
  project     = var.project
  region      = var.region
  description = "LISA video library link-rot check — CC Brief Video Library §10"

  schedule  = "10 6 * * *"
  time_zone = "Etc/UTC"

  attempt_deadline = "320s"

  retry_config {
    retry_count          = 3
    max_retry_duration   = "600s"
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${var.app_base_url}/api/internal/video-link-check"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({}))

    oidc_token {
      service_account_email = google_service_account.cloud_tasks.email
      audience              = "${var.app_base_url}/api/internal/video-link-check"
    }
  }

  depends_on = [google_project_service.cloudscheduler]
}
