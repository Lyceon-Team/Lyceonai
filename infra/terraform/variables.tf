# ──────────────────────────────────────────────────────────────────────
# Input variables
# ──────────────────────────────────────────────────────────────────────

variable "project" {
  description = "GCP project ID (live project is replit-cop — see docs/plans/Replit_Remnant_Sweep.md)"
  type        = string
  default     = "replit-cop"
}

variable "region" {
  description = "GCP region — single-region deployment (Doc 03C V3 §2.1)"
  type        = string
  default     = "us-central1"
}

variable "app_base_url" {
  description = <<-EOT
    Origin of the deployed Lyceon application, no trailing slash.

    Cloud Scheduler delivers to Vercel over public HTTPS, so it needs the
    app origin; nothing else in this directory did, which is why no such
    variable existed before. The default matches the production origin
    asserted in server/lib/startup-guards.ts (PUBLIC_SITE_URL) and the
    allow-list in server/middleware/origin-utils.ts.
  EOT
  type        = string
  default     = "https://lyceon.ai"

  validation {
    # A trailing slash would produce a double slash in the target URI and,
    # worse, a MISMATCHED OIDC audience — the token would be signed for one
    # string and the route would compare it against another.
    condition     = can(regex("^https://[^/]+$", var.app_base_url))
    error_message = "app_base_url must be an https origin with no path and no trailing slash."
  }
}

variable "bff_service_account_email" {
  description = <<-EOT
    Identity of the Vercel BFF — the `client_email` inside GCP_SERVICE_ACCOUNT_JSON.
    Holds roles/cloudtasks.enqueuer (granted out of band 2026-09-23) and, via
    cloud-tasks.tf, actAs on lisa-cloud-tasks so it can create OIDC-signed tasks.
    Verify the default against the key actually deployed before applying.
  EOT
  type        = string
  default     = "lyceon-server-sa@replit-cop.iam.gserviceaccount.com"
}
