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

# ── BigQuery archive ─────────────────────────────────────────────────

output "bigquery_archive_dataset" {
  description = <<-EOT
    Archive dataset ID → set this verbatim as BIGQUERY_ARCHIVE_DATASET on
    Vercel. `getArchiveClient()` in server/routes/internal-retention-routes.ts
    returns undefined when the var is unset, and the 90d/180d retention tiers
    then decline to run with reason "archive_client_not_configured".

    Setting it is necessary and NOT sufficient: the client also requires the
    `@google-cloud/bigquery` package, which is in no package.json and absent
    from pnpm-lock.yaml. Until that dependency is approved and installed, the
    require() throws and the two tiers decline for the same reason.
  EOT
  value       = google_bigquery_dataset.archive.dataset_id
}

output "bigquery_archive_tables" {
  description = <<-EOT
    The four DAY-partitioned archive tables Terraform manages, with the
    partition-expiration each one carries (730 days — Privacy Policy v4 §6.6).
    Read this after apply to confirm expiration actually landed; an
    unpartitioned pre-existing table silently accepts rows forever.
  EOT
  value = {
    for name, t in google_bigquery_table.retention_archive :
    name => {
      partition_field        = t.time_partitioning[0].field
      partition_expiration_d = t.time_partitioning[0].expiration_ms / 86400000
    }
  }
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
