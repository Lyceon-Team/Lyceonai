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

# Vector Search API: RAG Engine in Serverless mode stores each corpus's vectors in a
# RAG-managed Vector Search 2.0 collection, and corpus creation fails PERMISSION_DENIED
# without this API (LISA video RAG Step C, 2026-10-14). Enabled by hand on replit-cop
# the same day; declared here so a rebuilt project doesn't hit the same wall. Enabling an
# already-enabled service is a no-op, so no import block is needed.
resource "google_project_service" "vectorsearch" {
  project = var.project
  service = "vectorsearch.googleapis.com"

  disable_on_destroy = false
}
