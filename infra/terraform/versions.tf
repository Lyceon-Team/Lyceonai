# ──────────────────────────────────────────────────────────────────────
# WS-G1 Phase 1 — Terraform for GCP declared state
# Provider and version constraints
# ──────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"    # Pinned to 8.x — installed version; avoids major drift
    }
  }
}
