# ──────────────────────────────────────────────────────────────────────
# Cloud Run service — imported from existing resource
#
# Service: lyceon-tutor-orchestrator
# Deployed by Cloud Build (CI) via apps/workers/tutor-orchestrator/cloudbuild.yaml
#
# Terraform imports the service definition but does NOT manage the
# deployment (container image, env vars, traffic). CI owns those via
# `gcloud run deploy --source`. lifecycle.ignore_changes ensures
# Terraform never reverts a CI deployment.
#
# Terraform DOES manage:
#   - IAM bindings (iam.tf — run.invoker for Cloud Tasks SA)
#   - Service existence (prevent_destroy)
# ──────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "tutor_orchestrator" {
  name     = "lyceon-tutor-orchestrator"
  location = var.region
  project  = var.project

  # Placeholder template — CI manages the actual deployment.
  # On import, Terraform reads the real config from GCP and stores it
  # in state. ignore_changes prevents any HCL/state diff from being
  # applied, so this placeholder is never pushed to the live service.
  template {
    containers {
      image = "gcr.io/${var.project}/lyceon-tutor-orchestrator:ci-managed"
    }
    service_account = "lyceon-tasks-sa@${var.project}.iam.gserviceaccount.com"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      template,
      traffic,
      labels,
      annotations,
      client,
      custom_audiences,
      launch_stage,
    ]
  }
}
