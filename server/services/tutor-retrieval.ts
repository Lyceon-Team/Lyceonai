/**
 * @spec [Doc-03D_V1.2 §6.6, §6.7, §6.8; Doc-03D_V1.2 §6.3]
 * @implemented 2026-08-20
 *
 * plain English: Dual-path curriculum retrieval service for LISA. Merges
 * two retrieval paths behind the single §6.8 contract:
 *
 *   Path 1 (deterministic): question explanations from Postgres, keyed by
 *   skill_codes. This is a WHERE clause, not a similarity search — the most
 *   dangerous payload (active question's explanation pre-submit) must not
 *   travel a probabilistic path (§6.6).
 *
 *   Path 2 (semantic): textbooks, video transcripts, strategy content,
 *   worked-example libraries from Vertex AI RAG Engine. Provisioned at V1
 *   against an empty corpus per §6.7 — post-launch ingestion becomes a
 *   content operation, not a re-architecture.
 *
 * expected outcome: consumers call `retrieveCurriculum()` and receive a
 * single ranked set of RetrievedItem[]. The surface gate (§6.3) is
 * evaluated AFTER retrieval and BEFORE items enter the prompt. Items that
 * fail the gate are dropped silently.
 *
 * trade-offs:
 *  - The semantic path returns empty until content is ingested into the
 *    RAG Engine corpus. This is by design (§6.7 "scaffold against empty
 *    corpus").
 *  - Explanation retrieval is scoped to the active skill, not the whole
 *    corpus (§6.4). Broader retrieval causes session drift.
 *  - provenance carries the question ID in metadata only — never in text
 *    the model may echo (§6.5, SCL-030).
 *
 * edge cases:
 *  - RAG Engine unreachable: semantic path returns empty set. Deterministic
 *    path proceeds unaffected. Logged as warning.
 *  - Pre-submit + active question: the active question's explanation is
 *    INCLUDED in retrieval (Karl ruling, SCL-043) — LISA needs the
 *    authored reasoning path (server-to-Vertex only, never reaches
 *    student). Unseen same-skill questions are EXCLUDED.
 *  - No matching explanations: returns empty set from deterministic path.
 *    No fallback narration (§6.8).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import type {
  RetrievalRequest,
  RetrievalResponse,
  RetrievedItem,
} from "../../packages/shared/tutor-rag-types";

// ── RAG Engine config ────────────────────────────────────────────────

/**
 * Vertex AI RAG Engine corpus resource name.
 * Format: projects/PROJECT/locations/LOCATION/ragCorpora/CORPUS_ID
 *
 * @spec [Doc-03D_V1.2 §6.7]
 * Not yet provisioned — retrieval returns empty until Karl creates the corpus.
 */
const RAG_CORPUS_RESOURCE_NAME = process.env.RAG_CORPUS_RESOURCE_NAME ?? "";

// ── Surface gate evaluation (§6.3) ──────────────────────────────────

/**
 * @spec [Doc-03D_V1.2 §6.3]
 *
 * Evaluates whether a retrieved item passes the surface gate for the
 * current retrieval context. Items that fail are dropped silently —
 * the model never sees them.
 *
 * Gate rules per §6.3:
 *  - Pre-submit practice: NEVER serve active question's explanation.
 *    Prior questions' explanations (same skill only) are allowed.
 *    All items must have surface_gate "pre_and_post".
 *  - Post-submit practice / review / test_review: all gates pass.
 */
function passesGate(
  item: RetrievedItem,
  isPreSubmit: boolean,
  _surface: string,
): boolean {
  if (!isPreSubmit) {
    // Post-submit: all items are permitted regardless of gate
    return true;
  }

  // Pre-submit: only items gated for pre-submit are allowed
  return item.surface_gate === "pre_and_post";
}

// ── Deterministic path (Postgres) ────────────────────────────────────

/**
 * @spec [Doc-03D_V1.2 §6.6 Path 1]
 *
 * Retrieves question explanations from Postgres by skill_codes.
 * Deterministic, keyed retrieval — not a similarity search.
 *
 * Scoped to active skill (§6.4). For pre-submit, INCLUDES the active
 * question's explanation (Karl ruling, SCL-043) and explanations for
 * previously-answered same-skill questions. EXCLUDES explanations for
 * same-skill questions the student has NOT answered.
 *
 * "Previously seen" = practice_session_items.status='answered'
 * (submitted, not merely served). Filter is query-level, not post-retrieval.
 */
async function retrieveDeterministic(
  request: RetrievalRequest,
): Promise<RetrievedItem[]> {
  try {
    // ── Pre-submit seen-question filter (SCL-043, LISA-RAG-001) ──────
    //
    // Karl ruling: INCLUDE active question's explanation pre-submit —
    // LISA needs the authored reasoning path (server-to-Vertex only,
    // never reaches student). EXCLUDE explanations for same-skill
    // questions the student has NOT answered. Entire leak defense
    // becomes the output serializer (INV-03-04).
    //
    // "Previously seen" = practice_session_items.status='answered'
    // (submitted, not merely served — a served-but-unanswered item is
    // still an open question). Filter is query-level, not post-retrieval.
    //
    // Post-submit: all same-skill explanations permitted (student has
    // already committed an answer).
    let allowedIds: string[] | null = null; // null = no filter (post-submit)

    if (request.is_pre_submit) {
      const { data: answeredItems, error: answeredError } = await supabaseServer
        .from("practice_session_items")
        .select("question_id")
        .eq("user_id", request.student_id)
        .eq("status", "answered");

      if (answeredError) {
        logger.warn(
          "TUTOR_RETRIEVAL",
          "answered_items_query_failed",
          "Failed to query answered items for seen-question filter; returning empty set",
          { dbError: answeredError.message, code: answeredError.code },
        );
        return [];
      }

      const answeredQuestionIds = (answeredItems ?? []).map(
        (i) => (i as { question_id: string }).question_id,
      );

      // Active question is always included pre-submit (Karl ruling, SCL-043)
      allowedIds = [
        ...new Set([
          ...answeredQuestionIds,
          ...(request.active_question_canonical_id
            ? [request.active_question_canonical_id]
            : []),
        ]),
      ];

      if (allowedIds.length === 0) {
        // No answered questions and no active question — nothing to retrieve
        return [];
      }
    }

    // ── Query explanations ──────────────────────────────────────────
    // The servable_questions view enforces the servable gate (only
    // published, non-retired questions). We select explanations only —
    // never correct_answer in this path.
    let query = supabaseServer
      .from("servable_questions")
      .select("canonical_id, explanation, skill_codes")
      .not("explanation", "is", null)
      .overlaps("skill_codes", request.active_skill_codes)
      .limit(request.max_items * 2); // Over-fetch to account for gating

    // Pre-submit: restrict to allowed IDs (answered + active question)
    if (allowedIds !== null) {
      query = query.in("canonical_id", allowedIds);
    }

    const { data, error } = await query;

    if (error) {
      logger.warn(
        "TUTOR_RETRIEVAL",
        "deterministic_retrieval_failed",
        "Postgres explanation retrieval failed; returning empty set",
        { dbError: error.message, code: error.code },
      );
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map to RetrievedItem contract (§6.8)
    return (
      data as Array<{
        canonical_id: string;
        explanation: string;
        skill_codes: string[];
      }>
    ).map((row) => ({
      content: row.explanation,
      skill_codes: row.skill_codes ?? [],
      // §6.5: canonical_id is in metadata (provenance), never in text
      provenance: `question_explanation:${row.canonical_id}`,
      surface_gate: "pre_and_post" as const,
      content_type: "explanation" as const,
    }));
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_RETRIEVAL",
      "deterministic_retrieval_error",
      "Unexpected error in deterministic retrieval; returning empty set",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return [];
  }
}

// ── Semantic path (Vertex AI RAG Engine) ─────────────────────────────

/**
 * @spec [Doc-03D_V1.2 §6.6 Path 2, §6.7]
 *
 * Retrieves unkeyed content (textbooks, video transcripts, strategy
 * content, worked-example libraries) from Vertex AI RAG Engine.
 *
 * Returns empty until the corpus is provisioned and content ingested
 * (§6.7: "scaffold against empty corpus").
 *
 * Embedding model: text-embedding-005 (Karl ruling). Verify at
 * provisioning time if gemini-embedding-001 has been added to RAG
 * Engine's supported list — if so, STOP and report.
 */
async function retrieveSemantic(
  _request: RetrievalRequest,
): Promise<RetrievedItem[]> {
  if (!RAG_CORPUS_RESOURCE_NAME) {
    // Corpus not yet provisioned — expected at V1 scaffold stage
    return [];
  }

  try {
    // Vertex AI RAG Engine retrieval query.
    // Uses the @google-cloud/aiplatform SDK's retrieveContexts API.
    //
    // NOT YET WIRED — this is the scaffold. The actual API call will be:
    //
    //   const { VertexRagDataServiceClient } = await import(
    //     "@google-cloud/aiplatform"
    //   );
    //   const client = new VertexRagDataServiceClient();
    //   const [response] = await client.retrieveContexts({
    //     parent: RAG_CORPUS_RESOURCE_NAME,
    //     query: {
    //       text: request.query_text ?? "",
    //       similarityTopK: request.max_items,
    //       ragMetadataFilter: {
    //         rules: [
    //           {
    //             fieldName: "skill_codes",
    //             matchType: "STRING_ANY",
    //             values: request.active_skill_codes,
    //           },
    //         ],
    //       },
    //     },
    //   });
    //
    // For now, return empty — corpus is empty per §6.7.
    logger.info(
      "TUTOR_RETRIEVAL",
      "semantic_retrieval_scaffold",
      "RAG Engine corpus configured but empty; returning empty set",
      { corpusResource: RAG_CORPUS_RESOURCE_NAME },
    );
    return [];
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_RETRIEVAL",
      "semantic_retrieval_error",
      "RAG Engine retrieval failed; returning empty set",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return [];
  }
}

// ── Main retrieval function ──────────────────────────────────────────

/**
 * @spec [Doc-03D_V1.2 §6.6, §6.8]
 *
 * Dual-path curriculum retrieval. Runs both paths concurrently, merges
 * results, applies surface gate (§6.3), and returns the unified set.
 *
 * Adding a new content type does not change this contract or its
 * consuming code (§6.8).
 */
export async function retrieveCurriculum(
  request: RetrievalRequest,
): Promise<RetrievalResponse> {
  const startMs = Date.now();

  // Run both paths concurrently
  const [deterministicItems, semanticItems] = await Promise.all([
    retrieveDeterministic(request),
    retrieveSemantic(request),
  ]);

  const deterministicCount = deterministicItems.length;
  const semanticCount = semanticItems.length;

  // Merge both sets
  const allItems = [...deterministicItems, ...semanticItems];

  // Apply surface gate (§6.3, §6.8)
  const gatedItems = allItems.filter((item) =>
    passesGate(item, request.is_pre_submit, request.surface),
  );

  const gatedOut = allItems.length - gatedItems.length;

  // Cap to max_items
  const finalItems = gatedItems.slice(0, request.max_items);

  const durationMs = Date.now() - startMs;

  return {
    items: finalItems,
    meta: {
      deterministic_candidates: deterministicCount,
      semantic_candidates: semanticCount,
      gated_out: gatedOut,
      duration_ms: durationMs,
    },
  };
}
