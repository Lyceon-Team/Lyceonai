/**
 * GENERATED FILE — DO NOT EDIT.
 * Written by scripts/build/generate-event-registry.mjs from infra/event-schema-registry.yaml.
 * Regenerate with: pnpm run generate:event-registry
 *
 * The event-schema registry, inlined so the serverless bundle carries it. Parsed with
 * `eventRegistrySchema` (packages/shared/src/event-registry-schema.ts) where it is used.
 */
export const GENERATED_EVENT_REGISTRY: unknown = {
  "schema_version": "1.0.0",
  "last_updated": "2026-10-05",
  "owner_doc": "07A V1.0",
  "events": [
    {
      "event_name": "user_signed_up",
      "schema_tier": "strict",
      "canonical_event_class": "auth",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when a new user completes initial account creation (post-email-verification). Does not include the email itself; only opaque analytics_user_id.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "signup_source"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "user_signed_up"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "signup_source": {
            "type": "string",
            "enum": [
              "direct",
              "referral",
              "paid_ad",
              "organic_search",
              "unknown"
            ]
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "signup_source": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "user_signed_in",
      "schema_tier": "strict",
      "canonical_event_class": "auth",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when an authenticated session begins (post-credential-verification, post-Supabase-auth-success). Per §3 threat 9, this is the auth-state-transition event, NOT a session-boundary event (PostHog session tracking owns session boundaries natively).",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "user_signed_in"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "user_signed_out",
      "schema_tier": "strict",
      "canonical_event_class": "auth",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when an authenticated session ends (explicit sign-out OR session expiry). Auth-state-transition event.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "signout_trigger"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "user_signed_out"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "signout_trigger": {
            "type": "string",
            "enum": [
              "explicit",
              "session_expiry",
              "security_logout"
            ]
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "signout_trigger": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "exam_started",
      "schema_tier": "strict",
      "canonical_event_class": "exam",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when a student starts a full-length SAT exam. BI-side observation; Doc 04A V2.2 `test_sessions` table is canonical for exam state.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "test_session_id",
          "test_form_id"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "exam_started"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "test_session_id": {
            "type": "string",
            "format": "uuid"
          },
          "test_form_id": {
            "type": "string",
            "format": "uuid"
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "test_session_id": "not_pii",
        "test_form_id": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "exam_section_submitted",
      "schema_tier": "strict",
      "canonical_event_class": "exam",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when a student submits an exam section (RW or Math). BI-side observation; Doc 04A V2.2 `test_session_sections` is canonical.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "test_session_id",
          "section",
          "module",
          "section_duration_ms"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "exam_section_submitted"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "test_session_id": {
            "type": "string",
            "format": "uuid"
          },
          "section": {
            "type": "string",
            "enum": [
              "RW",
              "M"
            ]
          },
          "module": {
            "type": "string",
            "enum": [
              "1",
              "2A",
              "2B"
            ]
          },
          "section_duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "test_session_id": "not_pii",
        "section": "not_pii",
        "module": "not_pii",
        "section_duration_ms": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "tutor_session_started",
      "schema_tier": "strict",
      "canonical_event_class": "tutor",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when a student initiates a LISA tutor session. BI-side observation; Doc 03 Main §11 owns LISA usage caps + Doc 03 Main §24 owns LISA cost discipline. Does NOT include tutor prompt content.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "tutor_session_id",
          "tutor_entry_mode"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "tutor_session_started"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "tutor_session_id": {
            "type": "string",
            "format": "uuid"
          },
          "tutor_entry_mode": {
            "type": "string",
            "enum": [
              "scoped_question",
              "scoped_session",
              "general"
            ]
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "tutor_session_id": "not_pii",
        "tutor_entry_mode": "not_pii"
      },
      "retention_class": "standard_analytics"
    },
    {
      "event_name": "tutor_session_ended",
      "schema_tier": "strict",
      "canonical_event_class": "tutor",
      "owner": "07A V1.0",
      "V1_active": true,
      "schema_version": "1.0.0",
      "description": "Emitted when a LISA tutor session ends. NO helped/failed/effectiveness measurement at V1 per Parent §10.6 KPI-TUT-02 carve-out — attribution is non-deterministic at V1; the canonical name is reserved for V1.1+ when attribution is solved.",
      "json_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_name",
          "timestamp",
          "analytics_user_id",
          "schema_version",
          "tutor_session_id",
          "session_duration_ms",
          "turn_count"
        ],
        "properties": {
          "event_name": {
            "type": "string",
            "const": "tutor_session_ended"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "analytics_user_id": {
            "type": "string",
            "format": "uuid"
          },
          "schema_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "tutor_session_id": {
            "type": "string",
            "format": "uuid"
          },
          "session_duration_ms": {
            "type": "integer",
            "minimum": 0
          },
          "turn_count": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "pii_redaction": {
        "event_name": "not_pii",
        "timestamp": "not_pii",
        "analytics_user_id": "opaque_id_only",
        "schema_version": "not_pii",
        "tutor_session_id": "not_pii",
        "session_duration_ms": "not_pii",
        "turn_count": "not_pii"
      },
      "retention_class": "standard_analytics"
    }
  ],
  "person_properties": [
    {
      "property_name": "analytics_user_id",
      "description": "The canonical analytics identifier (Doc 07A §7.1); the PostHog distinct_id for every server event.",
      "type": "string",
      "mutability": "immutable",
      "derivation": "HMAC-SHA256(ANALYTICS_SALT, supabase_user_id) -> first 128 bits -> UUID version 4 + RFC 4122 variant bits -> canonical lowercase 8-4-4-4-12",
      "pii_redaction_method": "opaque_id_only",
      "retention_class": "standard_analytics"
    }
  ],
  "retention_classes": [
    {
      "class_name": "standard_analytics",
      "description": "Placeholder retention class for V1 events; full definition pending Doc 07E V1.0 lock + FWD-06-01 resolution to Doc 06D §9.",
      "pending_07E_resolution": true
    }
  ]
};
