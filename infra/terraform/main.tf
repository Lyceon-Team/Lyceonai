# ──────────────────────────────────────────────────────────────────────
# Backend, provider, and API enablement
# ──────────────────────────────────────────────────────────────────────

terraform {
  backend "gcs" {
    bucket = "lyceon-terraform-state"
    prefix = "lyceon-lisa"
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

# ── API enablement ───────────────────────────────────────────────────
# Model Armor API must be enabled before templates can be created.
# disable_on_destroy = false prevents accidental API disablement.

resource "google_project_service" "modelarmor" {
  project = var.project
  service = "modelarmor.googleapis.com"

  disable_on_destroy = false
}
