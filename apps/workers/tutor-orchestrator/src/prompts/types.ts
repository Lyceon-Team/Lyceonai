/**
 * @spec [Doc-03C_V3 §4.3 — prompt artifact system]
 * @implemented 2026-08-17
 *
 * plain English: Type definitions for the prompt template artifact system.
 * A PromptArtifact is a versioned, immutable prompt template loaded at
 * bootstrap. A PromptFields object captures the typed envelope fields
 * needed for field substitution.
 *
 * expected outcome: compile-time safety for prompt construction — a missing
 * or mistyped field is a build error, not a silent prompt defect.
 *
 * trade-offs: PromptFields is a curated projection of OrchestrateRequest,
 * not the full envelope. Fields are selected for prompt relevance only —
 * raw numeric mastery scores, KPI counts, and UUIDs are excluded because
 * the model should never see them (Doc 03D §7.1 ordinal bands only;
 * CLAUDE.md "never claim to know a predicted score").
 */

import type { OrchestrateRequest } from "../lib/schema.js";

// ── Ordinal mastery band (Doc 03D §7.1) ─────────────────────────────

/** Ordinal mastery band — the ONLY form in which mastery reaches the model.
 * Numeric scores are never exposed. */
export type MasteryBand = "needs_work" | "developing" | "proficient" | "strong";

// ── Prompt fields (curated projection of the envelope) ──────────────

/** Fields available for substitution inside a prompt artifact's
 * systemInstruction renderer. Pure data — no functions, no IO. */
export type PromptFields = {
  /** Entry mode from the envelope. */
  entryMode: OrchestrateRequest["entry_mode"];
  /** Source surface from the envelope. */
  sourceSurface: OrchestrateRequest["source_surface"];
  /** Policy variant (e.g. "default", "concise"). */
  policyVariant: string;
  /** Whether the question is post-submit (is_post_submit on envelope, Doc 03D §6.3). */
  isPostSubmit: boolean;
  /** The item's subject (`question_content.section`, from questions.section); null if none or unread. */
  questionSection: "M" | "RW" | null;
  /** The way of solving the student's current message asks for (`requested_method`); null if none. */
  requestedMethod: "desmos" | "algebraic" | "backsolve" | null;
};

// ── Prompt artifact (the versioned, immutable template) ─────────────

/** A prompt artifact is a versioned, immutable prompt template.
 * @spec [Doc-03C_V3 §4.3]
 *
 * - `version`: unique identifier, e.g. "lisa-default-v1". Immutable once published.
 * - `policyVariant`: which policy variant this artifact serves.
 * - `renderSystemInstruction`: pure function — takes typed fields, returns the
 *   full system instruction text. This IS field substitution (type-checked). */
export type PromptArtifact = {
  readonly version: string;
  readonly policyVariant: string;
  readonly renderSystemInstruction: (fields: PromptFields) => string;
  /** G2-1: the artifact's rules carry DATA_BLOCK_RULE, so the state blocks render data-derived
   * values as data blocks. Absent (v1–v4): the blocks render exactly as they always did. */
  readonly dataBoundary?: true;
  /** SCL-275: the state blocks carry the [HELP LEVEL] block when the request carries a help level
   * (`help_level`, decided by the BFF). Absent (v1–v5): no help block, output unchanged. */
  readonly helpLevelBlock?: true;
};
