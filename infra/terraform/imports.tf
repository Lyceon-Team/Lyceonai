# ──────────────────────────────────────────────────────────────────────
# Import blocks — Terraform 1.5+
#
# These adopt existing GCP resources into Terraform state WITHOUT
# destroying or recreating them. Processed during `terraform plan`
# (read-only); state write happens only on `terraform apply`.
#
# IMPORTANT: remove these import blocks after the first successful
# apply. Leaving them in is harmless but noisy (Terraform re-checks
# the import ID on every plan even though the resource is already in
# state).
# ──────────────────────────────────────────────────────────────────────

# ── BigQuery dataset (provisioned by Karl, ad hoc) ───────────────────
import {
  to = google_bigquery_dataset.archive
  id = "projects/replit-cop/datasets/lyceon_analytics_archive_prod"
}

# ── Cloud Tasks queue (provisioned by Karl, ad hoc) ──────────────────
import {
  to = google_cloud_tasks_queue.crisis_notification
  id = "projects/replit-cop/locations/us-central1/queues/lisa-crisis-notification"
}

# ── Cloud Run service (deployed by Cloud Build / CI) ─────────────────
import {
  to = google_cloud_run_v2_service.tutor_orchestrator
  id = "projects/replit-cop/locations/us-central1/services/lyceon-tutor-orchestrator"
}
