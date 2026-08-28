/**
 * @spec [Doc-03D_V1.2 §6.7]
 * @implemented 2026-08-20
 *
 * plain English: Provisioning script for the Vertex AI RAG Engine corpus.
 * Creates the corpus and index with the locked metadata schema against
 * empty storage. Post-launch content ingestion becomes a content
 * operation, not a re-architecture.
 *
 * ⚠ DO NOT EXECUTE — this script is for Karl to run during GCP
 * provisioning. It requires:
 *   - GOOGLE_CLOUD_PROJECT env var
 *   - GOOGLE_CLOUD_LOCATION env var (e.g. "us-central1")
 *   - @google-cloud/aiplatform SDK installed
 *   - Service account with roles/aiplatform.user
 *
 * Embedding model: text-embedding-005 (Karl ruling, 2026-08-20).
 * VERIFY AT PROVISIONING TIME: if gemini-embedding-001 has been added
 * to RAG Engine's supported model list by provisioning date, STOP and
 * report to Karl before proceeding. Check:
 *   https://cloud.google.com/vertex-ai/docs/generative-ai/rag/rag-supported-models
 *
 * §6.7 decisions locked at corpus creation (expensive to change):
 *   1. Embedding model — locked to corpus. Changing requires recreating
 *      the corpus and re-importing every document.
 *   2. Chunking strategy — layout-aware for structured content (headings,
 *      tables); fixed-size for prose.
 *   3. Metadata schema — skill_codes, provenance, surface_gate,
 *      content_type. Adding a field later requires re-import.
 *
 * expected outcome: an empty corpus with the correct embedding model
 * and metadata schema, ready for content ingestion.
 *
 * After running, set the env var:
 *   RAG_CORPUS_RESOURCE_NAME=projects/PROJECT/locations/LOCATION/ragCorpora/CORPUS_ID
 */

// ────────────────────────────────────────────────────────────────────
// Script body — for Karl's manual execution
// ────────────────────────────────────────────────────────────────────
/* eslint-disable no-console -- CLI provisioning script, console is the output channel */

async function main(): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

  if (!project) {
    console.error("GOOGLE_CLOUD_PROJECT env var is required");
    process.exit(1);
  }

  console.log("=== Vertex AI RAG Engine Corpus Creation ===");
  console.log(`Project:  ${project}`);
  console.log(`Location: ${location}`);
  console.log("");

  // ── Pre-flight: check if gemini-embedding-001 is now supported ──
  console.log(
    "⚠ BEFORE PROCEEDING: verify that gemini-embedding-001 has NOT been",
  );
  console.log(
    "  added to RAG Engine's supported model list. If it has, STOP and",
  );
  console.log("  report to Karl — the embedding model decision may change.");
  console.log(
    "  Check: https://cloud.google.com/vertex-ai/docs/generative-ai/rag/rag-supported-models",
  );
  console.log("");

  // ── Import SDK ──
  const { VertexRagDataServiceClient } =
    await import("@google-cloud/aiplatform");

  const parent = `projects/${project}/locations/${location}`;
  const client = new VertexRagDataServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`,
  });

  // ── Step 1: Create the RAG corpus ──
  console.log("Creating RAG corpus with text-embedding-005...");

  const [operation] = await client.createRagCorpus({
    parent,
    ragCorpus: {
      displayName: "lyceon-lisa-curriculum-v1",
      description:
        "LISA curriculum retrieval corpus — textbooks, video transcripts, " +
        "strategy content, worked-example libraries. Per Doc 03D §6.7.",
      ragEmbeddingModelConfig: {
        vertexPredictionEndpoint: {
          // text-embedding-005 — Karl ruling 2026-08-20
          // 768-dimensional embeddings, optimized for retrieval
          endpoint: `projects/${project}/locations/${location}/publishers/google/models/text-embedding-005`,
        },
      },
    },
  });

  console.log("Waiting for corpus creation to complete...");
  const [corpus] = await operation.promise();

  if (!corpus?.name) {
    console.error("Corpus creation failed — no resource name returned");
    process.exit(1);
  }

  console.log("");
  console.log("✅ Corpus created successfully!");
  console.log(`   Resource name: ${corpus.name}`);
  console.log("");
  console.log("Set this env var on the Cloud Run service:");
  console.log(`   RAG_CORPUS_RESOURCE_NAME=${corpus.name}`);
  console.log("");
  console.log("Metadata schema (locked — §6.7):");
  console.log("   skill_codes:  string[]  — SAT skill taxonomy codes");
  console.log('   provenance:   string    — e.g. "textbook:isbn:chapter"');
  console.log(
    '   surface_gate: string    — "pre_and_post" | "post_only" | "review_only"',
  );
  console.log(
    '   content_type: string    — "textbook" | "video_transcript" | "strategy" | "worked_example"',
  );
  console.log("");
  console.log("Next steps:");
  console.log("  1. Ingest content using the RAG Engine import API");
  console.log("  2. Each document must carry the metadata fields above");
  console.log("  3. Test retrieval quality BEFORE wiring to generation (§6.7)");
}

main().catch((err) => {
  console.error("Corpus creation failed:", err);
  process.exit(1);
});
