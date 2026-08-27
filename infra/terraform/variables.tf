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
