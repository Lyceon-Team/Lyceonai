# ──────────────────────────────────────────────────────────────────────
# Cloud Tasks OIDC service account — unblock LISA (Phase 1 blocker #2)
#
# Retention and memory routes crash at boot because the OIDC SA does
# not exist. Creating this SA and granting run.invoker on the Cloud Run
# service fixes the crash.
#
# Doc 03C V3 §9.2 (SA topology, line 3194):
#   lisa-cloud-tasks | run.invoker on async handler only
#
# Operations Runbook V3 §5.1 (SA provisioning, line 896-906)
# ──────────────────────────────────────────────────────────────────────

resource "google_service_account" "cloud_tasks" {
  account_id   = "lisa-cloud-tasks"
  display_name = "LISA cloud-tasks"
  description  = "Cloud Tasks queue invoker — signs OIDC tokens for async handler invocations"
  project      = var.project
}

# ── IAM: allow Cloud Tasks SA to invoke the Cloud Run async handler ──
# Uses _iam_member (additive) — never _iam_binding (authoritative).
# Doc 03C V3 §9.2: "run.invoker on async handler only"
# Operations Runbook V3 §5.3 (line 966-969)

resource "google_cloud_run_v2_service_iam_member" "cloud_tasks_invoker" {
  project  = var.project
  location = var.region
  name     = google_cloud_run_v2_service.tutor_orchestrator.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_tasks.email}"
}
