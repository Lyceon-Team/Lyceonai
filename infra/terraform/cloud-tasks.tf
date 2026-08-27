# ──────────────────────────────────────────────────────────────────────
# Cloud Tasks queue — imported from existing resource
#
# Queue: lisa-crisis-notification
# crisis-notification.ts:64-65 — default queue for crisis alerts
#
# Phase 2 queues (NOT included here):
#   lisa-compaction              — Doc 03C V3 §8.2
#   lisa-memory-refresh          — Doc 03C V3 §8.2
#   lisa-pending-reconciliation  — Doc 03C V3 §8.2
# ──────────────────────────────────────────────────────────────────────

resource "google_cloud_tasks_queue" "crisis_notification" {
  name     = "lisa-crisis-notification"
  location = var.region
  project  = var.project

  # Verified by Karl via:
  #   gcloud tasks queues describe lisa-crisis-notification \
  #     --location=us-central1 --format=json
  # Karl tightened retry from GCP defaults (100 attempts / unlimited duration)
  # to 5 attempts / 600s — permanently-bad Slack payloads should not retry for days.

  rate_limits {
    max_burst_size            = 100
    max_dispatches_per_second = 500
    max_concurrent_dispatches = 1000
  }

  retry_config {
    max_attempts       = 5
    max_retry_duration = "600s"
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 16
  }

  lifecycle {
    prevent_destroy = true
  }
}
