# ──────────────────────────────────────────────────────────────────────
# Cloud Tasks queue — imported from existing resource
#
# Queue: lisa-crisis-notification
# crisis-notification.ts:64-65 — default queue for crisis alerts
#
# lisa-compaction is defined at the foot of this file (2026-09-23).
#
# Phase 2 queues (NOT included here):
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
    # max_burst_size is computed by GCP from max_dispatches_per_second — not settable.
    # `gcloud tasks queues describe` shows it because GCP calculated it, not because it was set.
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

# ──────────────────────────────────────────────────────────────────────
# Cloud Tasks queue — lisa-compaction
#
# @spec [Doc-03C_V3 §8.2, §8.3; CC Brief "Close the LISA Vertical" PR 3.2]
# @implemented [2026-09-23]
#
# plain English: POST /api/tutor/conversations/:id/end enqueues a compaction
# task here (server/routes/tutor-runtime.ts). The queue was never provisioned,
# so every enqueue failed. Parameters are §8.2's: 100 req/s, max 5 retries
# (max_attempts counts the first attempt, hence 6), 5s-300s backoff.
#
# NEW RESOURCE, NOT AN IMPORT. If `gcloud tasks queues describe lisa-compaction
# --location=us-central1` already returns a queue, import it first
# (terraform import google_cloud_tasks_queue.compaction
#  projects/replit-cop/locations/us-central1/queues/lisa-compaction).
# ──────────────────────────────────────────────────────────────────────

resource "google_cloud_tasks_queue" "compaction" {
  name     = "lisa-compaction"
  location = var.region
  project  = var.project

  rate_limits {
    max_dispatches_per_second = 100
  }

  retry_config {
    max_attempts  = 6
    min_backoff   = "5s"
    max_backoff   = "300s"
    max_doublings = 16
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ── IAM: the BFF may create tasks that Cloud Tasks signs as lisa-cloud-tasks ──
#
# A compaction task carries `oidcToken.serviceAccountEmail =
# CLOUD_TASKS_SERVICE_ACCOUNT` (lisa-cloud-tasks), so the principal CREATING
# the task needs iam.serviceAccounts.actAs on that account in addition to
# cloudtasks.enqueuer. Without it CreateTask returns 403. The crisis queue does
# not need this — its tasks carry no OIDC token.
# Additive _iam_member, never _iam_binding.

resource "google_service_account_iam_member" "bff_act_as_cloud_tasks" {
  service_account_id = google_service_account.cloud_tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.bff_service_account_email}"
}
