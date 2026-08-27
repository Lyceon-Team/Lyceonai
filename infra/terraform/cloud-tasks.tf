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

  # ╔══════════════════════════════════════════════════════════════════╗
  # ║ VERIFY before apply — run:                                     ║
  # ║   gcloud tasks queues describe lisa-crisis-notification \       ║
  # ║     --location=us-central1 --format=json                       ║
  # ║                                                                ║
  # ║ The values below are GCP defaults. If the live queue has       ║
  # ║ different rate limits or retry config, update these to match   ║
  # ║ EXACTLY — otherwise the plan proposes changes Karl did not     ║
  # ║ ask for.                                                       ║
  # ╚══════════════════════════════════════════════════════════════════╝

  rate_limits {
    max_dispatches_per_second = 500
    max_concurrent_dispatches = 1000
  }

  retry_config {
    max_attempts       = 100
    max_retry_duration = "0s"
    min_backoff        = "0.100s"
    max_backoff        = "3600s"
    max_doublings      = 16
  }

  lifecycle {
    prevent_destroy = true
  }
}
