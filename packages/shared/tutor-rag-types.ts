/**
 * @spec [Doc-03D_V1.2 §6.6, §6.7, §6.8]
 * @implemented 2026-08-20
 *
 * plain English: Shared types for LISA curriculum retrieval — the unified
 * contract that merges deterministic Postgres retrieval (question explanations)
 * and semantic retrieval (textbooks, video transcripts, strategy content,
 * worked-example libraries). Both paths return RetrievedItem[] per §6.8.
 * The semantic store is pgvector in Postgres (`curriculum_chunks`), not
 * Vertex AI RAG Engine: SCL-231, PROPOSED 2026-10-15, after four failed
 * corpus creations (LISA_Video_RAG_Closure_Plan.md row C).
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
 *  - The four §6.7 metadata fields (skill_codes, provenance, surface_gate,
 *    content_type) are columns of `curriculum_chunks`, with CHECKs carrying
 *    the enums below. Adding a field is a migration, not a re-import.
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
   *  - "textbook"            — from curriculum_chunks (pgvector)
   *  - "video_transcript"    — from curriculum_chunks (pgvector)
   *  - "strategy_content"    — from curriculum_chunks (pgvector)
   *  - "worked_example"      — from curriculum_chunks (pgvector)
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

  // No pre-submit field, deliberately. Doc 03D §6.3: pre-submit state is derived server-side
  // from the item's submission state (isPreSubmitForSurface, server/services/tutor-antileak.ts)
  // and is never supplied by the caller. A caller-supplied boolean gating a safety decision is
  // a boolean an attacker sets. Removed 2026-10-13 (video RAG plan Step B).

  /**
   * The active question's canonical ID. It is not a route to that question's explanation:
   * the explanation reaches the model only post-submit, on `question_content.explanation`
   * (SCL-144, owner ruling 2026-09-25, reversing SCL-060), and the question bank is not a
   * retrieval source (owner ruling 2026-10-13).
   */
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
 * Metadata of a semantic-store item: one `curriculum_chunks` row (migration
 * 20261101010000_lisa_curriculum_chunks.sql). The enums here and that table's
 * CHECK constraints are the same lists; change both in one change.
 *
 * @spec [Doc-03D_V1.2 §6.7; SCL-231 (PROPOSED 2026-10-15): pgvector store]
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
