# ──────────────────────────────────────────────────────────────────────
# Model Armor templates — unblock LISA (Phase 1 blocker #1)
#
# Every Vertex call currently fails with `vertex_model_armor_unconfigured`
# because no templates exist. These two templates enable:
#   1. Input scanning  — inline on generateContent (promptTemplateName)
#   2. Output scanning — standalone sanitizeModelResponse API
#
# Filter settings derived from Doc 03C V3 §5.7 (safety settings) and
# Doc 03 §18.2 (5-layer injection defense). See README.md §Model Armor
# for the full settings-to-source mapping.
# ──────────────────────────────────────────────────────────────────────

resource "google_model_armor_template" "input" {
  template_id = "lyceon-lisa-input-v1"
  location    = var.region
  project     = var.project

  filter_config {
    # ── RAI content filters ────────────────────────────────────────
    # Thresholds from Doc 03C V3 §5.7, line 1228-1243:
    #   "BLOCK_LOW_AND_ABOVE for sexually explicit (tighter than other
    #    categories) given minor audience. Other categories at
    #    MEDIUM_AND_ABOVE to avoid over-triggering on legitimate
    #    academic content (e.g., SAT passages about historical atrocities)."
    rai_settings {
      rai_filters {
        filter_type      = "SEXUALLY_EXPLICIT"
        confidence_level = "LOW_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "HARASSMENT"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "HATE_SPEECH"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "DANGEROUS"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
    }

    # ── Prompt injection + jailbreak detection ─────────────────────
    # Doc 03 §18.2 Layer 3 — Model Armor scanning. LOW_AND_ABOVE is
    # the most protective setting; appropriate for minor-facing tutor.
    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "LOW_AND_ABOVE"
    }

    # ── Malicious URI detection ────────────────────────────────────
    # Defense-in-depth against prompt-injected URLs.
    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }
  }

  depends_on = [google_project_service.modelarmor]
}

resource "google_model_armor_template" "output" {
  template_id = "lyceon-lisa-output-v1"
  location    = var.region
  project     = var.project

  filter_config {
    # ── RAI content filters (same thresholds as input) ─────────────
    rai_settings {
      rai_filters {
        filter_type      = "SEXUALLY_EXPLICIT"
        confidence_level = "LOW_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "HARASSMENT"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "HATE_SPEECH"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "DANGEROUS"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
    }

    # ── Prompt injection + jailbreak detection ─────────────────────
    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "LOW_AND_ABOVE"
    }

    # ── Malicious URI detection ────────────────────────────────────
    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }

    # ── Sensitive Data Protection (output only) ────────────────────
    # Doc 03 §18.2 Layer 4 — output scanning for system prompt leak
    # signatures, policy_variant names, canonical question IDs, and
    # character-break signals. Basic SDP config provides defense-in-
    # depth on top of the deterministic PII guard (Doc 03C V3 §30.7).
    sdp_settings {
      basic_config {
        filter_enforcement = "ENABLED"
      }
    }
  }

  depends_on = [google_project_service.modelarmor]
}
