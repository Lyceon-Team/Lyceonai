# ──────────────────────────────────────────────────────────────────────
# Cloud Scheduler — crisis review SLA-breach sweep (hourly)
#
# @spec [Doc-03_V3 §21.3; Doc-03C_V3 §9.3; CC Brief "Close the LISA Vertical" PR 2.2]
# @implemented [2026-09-23]
#
# plain English: `POST /api/internal/crisis-sla-sweep` lists open crisis review
# cases past their 48h SLA and logs an ERROR alert. It has existed since
# 2026-08-13 and nothing has ever called it — it was in neither vercel.json nor
# this directory — so a case whose Slack alert was lost was never surfaced
# again. This job is its caller.
#
# WHY HERE AND NOT vercel.json. The handler is meant to run hourly; the Vercel
# Hobby plan rejects any cron more frequent than daily (server/routes/
# internal-cron-routes.ts, baseline-pending-sweep). Cloud Scheduler signs an
# OIDC token, so the route moved from GET + CRON_SECRET to POST + the same
# OIDC guard the retention sweep uses, with the same service account for the
# same reason recorded on the 7d job above (CLOUD_TASKS_SERVICE_ACCOUNT holds
# exactly one address).
#
# WHY A SEPARATE FILE. cloud-scheduler.tf holds the retention tiers, and
# tests/ci/retention-policy-publication.contract.test.ts treats every job in it
# as a retention tier. The API enablement (`google_project_service.cloudscheduler`)
# and service account are shared from there.
#
# trade-offs:
#  - Minute 15, so it never coincides with the 05:30/05:40/05:50 retention
#    jobs' start minute.
#  - No body: the handler takes no input. Duplicate delivery on retry only
#    repeats a read and a log line.
#  - Hourly means a breach is surfaced within an hour of the deadline.
# ──────────────────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "crisis_sla_sweep" {
  name        = "lyceon-crisis-sla-sweep"
  project     = var.project
  region      = var.region
  description = "Crisis review SLA-breach sweep — Doc 03 §21.3"

  schedule  = "15 * * * *"
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
    uri         = "${var.app_base_url}/api/internal/crisis-sla-sweep"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({}))

    oidc_token {
      service_account_email = google_service_account.cloud_tasks.email
      audience              = "${var.app_base_url}/api/internal/crisis-sla-sweep"
    }
  }

  depends_on = [google_project_service.cloudscheduler]

  lifecycle {
    prevent_destroy = true
  }
}
