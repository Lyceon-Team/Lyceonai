# ──────────────────────────────────────────────────────────────────────
# Outputs — env vars to set after apply
#
# After `terraform apply`, run:
#   terraform output -json
# to get all values, then set the env vars on Cloud Run / Vercel.
# ──────────────────────────────────────────────────────────────────────

# ── Model Armor ──────────────────────────────────────────────────────

output "model_armor_input_template_id" {
  description = "Short template ID → MODEL_ARMOR_INPUT_TEMPLATE_ID env var"
  value       = google_model_armor_template.input.template_id
}

output "model_armor_input_template_name" {
  description = "Full resource name (projects/.../templates/...) — passed to Vertex inline config"
  value       = google_model_armor_template.input.name
}

output "model_armor_output_template_id" {
  description = "Short template ID → MODEL_ARMOR_OUTPUT_TEMPLATE_ID env var"
  value       = google_model_armor_template.output.template_id
}

output "model_armor_output_template_name" {
  description = "Full resource name (projects/.../templates/...) — passed to sanitizeModelResponse API"
  value       = google_model_armor_template.output.name
}

# ── Cloud Tasks OIDC SA ──────────────────────────────────────────────

output "cloud_tasks_sa_email" {
  description = "Service account email → CLOUD_TASKS_SERVICE_ACCOUNT env var"
  value       = google_service_account.cloud_tasks.email
}

# ── Cloud Scheduler — retention sweep ────────────────────────────────

output "retention_sweep_oidc_audience" {
  description = <<-EOT
    Audience claim the retention sweep job signs with → set this verbatim
    as RETENTION_SWEEP_OIDC_AUDIENCE on Vercel. The route compares the
    token's `aud` to this string exactly; a mismatch is a 401, not a
    warning.
  EOT
  value       = google_cloud_scheduler_job.retention_sweep_7d.http_target[0].oidc_token[0].audience
}

output "retention_sweep_job_name" {
  description = "Cloud Scheduler job name — `gcloud scheduler jobs describe` target"
  value       = google_cloud_scheduler_job.retention_sweep_7d.name
}
