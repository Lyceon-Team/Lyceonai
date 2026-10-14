/**
 * @spec [Doc-03D_V1.2 §6.7; LISA_Video_RAG_Plan.md Step C; closure plan R-1, ruled
 *       2026-10-13 (Karl): Serverless mode, us-central1] | @implemented [2026-08-20, rewritten 2026-10-13]
 *
 * plain English: provisions the LISA curriculum corpus in Vertex AI RAG Engine, Serverless mode,
 * us-central1, with the `text-embedding-005` embedding model. Prints the resource name for
 * `RAG_CORPUS_RESOURCE_NAME`.
 *
 * IRREVERSIBLE (§6.7): the embedding model is locked to the corpus at creation. Changing it later
 * means recreating the corpus and re-importing everything. The script is a dry run unless
 * `--execute` is passed, and the dry run prints exactly what it would send.
 *
 * What changed from the 2026-08-20 version, and why:
 *  - Serverless mode (R-1 ruling). Spanner mode was refused in us-central1 (allowlist) and failed
 *    in us-east5, us-south1 and us-west1. In Serverless mode the vector store is RAG-managed
 *    Vertex Vector Search 2.0 (`vectorDbConfig.ragManagedVertexVectorSearch`).
 *  - No metadata schema. Serverless mode has no metadata search, so no `RagDataSchema` keys are
 *    created. `skill_codes`, `provenance`, `surface_gate` and `content_type` travel with each
 *    item and are checked by the BFF after retrieval, which is the only skill filter (R-2,
 *    owner ruling 2026-10-13). The locked four-field record is unchanged; only where it is read
 *    changes.
 *  - REST, not `@google-cloud/aiplatform`. That SDK is not a dependency. Credentials are attached
 *    by the session's egress proxy (or `gcloud`'s ADC on a workstation); none are read here.
 *
 * Pre-flight (refuses to create if any check fails):
 *  1. `ragEngineConfig` for us-central1 must already report Serverless mode. The script never
 *     changes the mode: the switch is owned outside this script (Karl, 2026-10-14: Terraform
 *     owns it; see closure plan R-9 for why the provider can't express it yet).
 *  2. No corpus with the target display name may already exist (no duplicate on a re-run).
 *  3. The embedding model is `text-embedding-005` (Karl, 2026-08-20; the RAG Engine embedding
 *     page, read 2026-10-13, lists it as the default and does not list gemini-embedding-001).
 *
 * Usage (on a session whose proxy attaches the Vertex credential to
 * `us-central1-aiplatform.googleapis.com`):
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/provisioning/rag-corpus-create.ts --project replit-cop
 *   ... add --execute to act.
 */
import { parseArgs } from "node:util";
import { z } from "zod";

const LOCATION = "us-central1";
const DISPLAY_NAME = "lyceon-lisa-curriculum-v1";
const EMBEDDING_MODEL = "text-embedding-005";

const operationSchema = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  response: z.record(z.unknown()).optional(),
});

const engineConfigSchema = z.object({
  ragManagedDbConfig: z.record(z.unknown()).optional(),
});

const corporaSchema = z.object({
  ragCorpora: z
    .array(z.object({ name: z.string(), displayName: z.string() }))
    .optional(),
});

async function request(
  url: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err: unknown) {
    body = {
      non_json_body: text,
      parse_error: err instanceof Error ? err.message : "unknown",
    };
  }
  if (response.status === 401) {
    throw new Error(
      `${init.method} ${new URL(url).host} → 401: no credential was attached for this host`,
    );
  }
  return { status: response.status, body };
}

async function waitFor(
  base: string,
  operationName: string,
): Promise<z.infer<typeof operationSchema>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { body } = await request(`${base}/${operationName}`, {
      method: "GET",
    });
    const op = operationSchema.parse(body);
    if (op.done) return op;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`operation ${operationName} did not finish in 10 minutes`);
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  const project = z.string().min(1).parse(values.project);
  if (process.env.NODE_USE_ENV_PROXY !== "1") {
    process.stderr.write(
      "run with NODE_USE_ENV_PROXY=1; no request was sent.\n",
    );
    process.exit(1);
  }
  const execute = values.execute === true;
  const base = `https://${LOCATION}-aiplatform.googleapis.com/v1beta1`;
  const parent = `projects/${project}/locations/${LOCATION}`;
  log(`mode: ${execute ? "EXECUTE" : "dry run (pass --execute to act)"}`);

  // 1. Deployment mode.
  const config = await request(`${base}/${parent}/ragEngineConfig`, {
    method: "GET",
  });
  const dbConfig =
    engineConfigSchema.parse(config.body).ragManagedDbConfig ?? {};
  const isServerless = "serverless" in dbConfig;
  log(
    `ragEngineConfig: ${JSON.stringify(dbConfig)} → ${isServerless ? "Serverless" : "not Serverless"}`,
  );
  if (!isServerless) {
    log(
      "STOP: mode is not Serverless. This script does not change the mode; switch it first, then re-run.",
    );
    process.exit(2);
  }

  // 2. No duplicate.
  const listed = corporaSchema.parse(
    (
      await request(`${base}/${parent}/ragCorpora?pageSize=100`, {
        method: "GET",
      })
    ).body,
  );
  const existing = (listed.ragCorpora ?? []).filter(
    (c) => c.displayName === DISPLAY_NAME,
  );
  if (existing.length > 0) {
    log(
      `STOP: a corpus named ${DISPLAY_NAME} already exists: ${existing.map((c) => c.name).join(", ")}`,
    );
    process.exit(2);
  }

  // 3. Create.
  const body = {
    displayName: DISPLAY_NAME,
    description:
      "LISA curriculum retrieval corpus (Doc 03D §6.7): one file per video segment, Lyceon-authored " +
      "descriptions. Skill and surface checks run in the BFF after retrieval.",
    vectorDbConfig: {
      ragManagedVertexVectorSearch: {},
      ragEmbeddingModelConfig: {
        vertexPredictionEndpoint: {
          endpoint: `${parent}/publishers/google/models/${EMBEDDING_MODEL}`,
        },
      },
    },
  };
  log(
    `${execute ? "sending" : "would send"}: POST ${base}/${parent}/ragCorpora ${JSON.stringify(body)}`,
  );
  if (!execute) return;

  const created = await request(`${base}/${parent}/ragCorpora`, {
    method: "POST",
    body,
  });
  if (created.status !== 200)
    throw new Error(
      `create → ${created.status} ${JSON.stringify(created.body)}`,
    );
  const done = await waitFor(base, operationSchema.parse(created.body).name);

  // A failed create can still leave corpora behind (RAG Engine retries internally; observed
  // 2026-10-13). Report every corpus carrying the display name, whatever the operation said.
  const after = corporaSchema.parse(
    (
      await request(`${base}/${parent}/ragCorpora?pageSize=100`, {
        method: "GET",
      })
    ).body,
  );
  const named = (after.ragCorpora ?? []).filter(
    (c) => c.displayName === DISPLAY_NAME,
  );
  if (done.error) {
    log(`create failed: ${done.error.message}`);
    log(
      `corpora with this display name now: ${JSON.stringify(named.map((c) => c.name))}`,
    );
    process.exit(1);
  }
  if (named.length !== 1) {
    log(
      `WARNING: ${named.length} corpora named ${DISPLAY_NAME}: ${JSON.stringify(named.map((c) => c.name))}`,
    );
  }
  const name = z.object({ name: z.string() }).parse(done.response).name;
  log("");
  log(`created: ${name}`);
  log(`RAG_CORPUS_RESOURCE_NAME=${name}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
