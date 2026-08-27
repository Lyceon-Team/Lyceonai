/**
 * @spec [Doc-03D_V1.2 §6.6, §6.7, §6.8]
 * @implemented 2026-08-20
 *
 * plain English: Shared types for LISA curriculum retrieval — the unified
 * contract that merges deterministic Postgres retrieval (question explanations)
 * and semantic Vertex AI RAG Engine retrieval (textbooks, video transcripts,
 * strategy content, worked-example libraries). Both paths return
 * RetrievedItem[] per §6.8.
 *
 * expected outcome: consuming code (tutor context assembly in Doc 03A Layer 5)
 * receives a single ranked set of RetrievedItem regardless of source. Adding
 * a new content type does not change the contract or the consuming code.
 *
 * trade-offs:
 *  - surface_gate is evaluated AFTER retrieval and BEFORE prompt assembly
 *    (§6.8). An item that fails the gate is dropped silently — the model
 *    never sees it and no fallback narration references it.
 *  - Explanations stay deterministic (Postgres WHERE clause) because the
 *    most dangerous payload in the system (active question's explanation on
 *    a pre-submit turn) must not travel a probabilistic path (§6.6).
 *  - Metadata schema is locked at corpus creation (§6.7): skill_codes,
 *    provenance, surface_gate, content_type. Adding a field later requires
 *    re-import of all corpus documents.
 */
import { z } from "zod";

// ── §6.8 Retrieval contract ─────────────────────────────────────────

/**
 * A retrieved item from either the deterministic or semantic path.
 * Shape per §6.8: regardless of source, every item carries the same fields.
 */
export const retrievedItemSchema = z.object({
  /** The retrieved content text (explanation, textbook excerpt, etc.) */
  content: z.string(),

  /** Skill codes this content is associated with (SAT skill taxonomy) */
  skill_codes: z.array(z.string()),

  /**
   * Where this content came from:
   *  - "question_explanation" — from canonical question bank (Postgres)
   *  - "textbook"            — from RAG corpus
   *  - "video_transcript"    — from RAG corpus
   *  - "strategy_content"    — from RAG corpus
   *  - "worked_example"      — from RAG corpus
   */
  provenance: z.string(),

  /**
   * Surface gating classification per §6.3. Evaluated after retrieval.
   *  - "pre_and_post" — safe for both pre-submit and post-submit
   *  - "post_only"    — only safe post-submit (contains answer-adjacent content)
   *  - "review_only"  — only safe in review mode
   */
  surface_gate: z.enum(["pre_and_post", "post_only", "review_only"]),

  /**
   * Content type classification for filtering and ranking.
   *  - "explanation"       — question explanation from canonical bank
   *  - "textbook"          — textbook chapter/section
   *  - "video_transcript"  — video transcript segment
   *  - "strategy"          — test-taking strategy content
   *  - "worked_example"    — worked example from example library
   */
  content_type: z.enum([
    "explanation",
    "textbook",
    "video_transcript",
    "strategy",
    "worked_example",
  ]),
});

export type RetrievedItem = z.infer<typeof retrievedItemSchema>;

// ── Retrieval request ────────────────────────────────────────────────

/**
 * Parameters for a curriculum retrieval query.
 */
export const retrievalRequestSchema = z.object({
  /** The student's current question's skill codes (primary retrieval scope) */
  active_skill_codes: z.array(z.string()).min(1),

  /** Whether the current question is pre-submit (gates explanation access) */
  is_pre_submit: z.boolean(),

  /** The active question's canonical ID (INCLUDED in pre-submit retrieval per SCL-043) */
  active_question_canonical_id: z.string().nullable(),

  /** Student ID for personalized ranking (exposure history) */
  student_id: z.string().uuid(),

  /** The student's message for semantic search (RAG path only) */
  query_text: z.string().optional(),

  /** Maximum number of items to return (hard cap per §6.4) */
  max_items: z.number().int().min(1).max(20).default(5),

  /**
   * Retrieval surface for gate evaluation per §6.3.
   *  - "practice"      — practice mode
   *  - "review"        — post-exam review
   *  - "test_review"   — test review mode
   */
  surface: z.enum(["practice", "review", "test_review"]),
});

export type RetrievalRequest = z.infer<typeof retrievalRequestSchema>;

// ── Retrieval response ───────────────────────────────────────────────

export const retrievalResponseSchema = z.object({
  /** The merged, ranked, surface-gated set of retrieved items */
  items: z.array(retrievedItemSchema),

  /** Metadata about the retrieval (non-student-facing, for observability) */
  meta: z.object({
    /** Number of items from deterministic path before gating */
    deterministic_candidates: z.number().int(),
    /** Number of items from semantic path before gating */
    semantic_candidates: z.number().int(),
    /** Number of items dropped by surface gate */
    gated_out: z.number().int(),
    /** Retrieval duration in ms */
    duration_ms: z.number().int(),
  }),
});

export type RetrievalResponse = z.infer<typeof retrievalResponseSchema>;

// ── RAG corpus metadata schema (locked at §6.7) ─────────────────────

/**
 * Metadata schema for Vertex AI RAG Engine corpus items.
 * Locked at corpus creation — adding a field later requires re-import.
 *
 * @spec [Doc-03D_V1.2 §6.7]
 */
export const ragCorpusMetadataSchema = z.object({
  skill_codes: z.array(z.string()),
  provenance: z.string(),
  surface_gate: z.enum(["pre_and_post", "post_only", "review_only"]),
  content_type: z.enum([
    "textbook",
    "video_transcript",
    "strategy",
    "worked_example",
  ]),
});

export type RagCorpusMetadata = z.infer<typeof ragCorpusMetadataSchema>;
