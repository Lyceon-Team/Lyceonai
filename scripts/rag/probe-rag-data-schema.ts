/**
 * @spec [LISA_Video_RAG_Plan.md Step C; closure plan R-1 — resolved as a test, owner 2026-10-13]
 *       | @implemented [2026-10-13]
 *
 * plain English: a throwaway test of whether RAG Engine's metadata schema (`RagDataSchema`,
 * v1beta1, Preview) works in this project's deployment mode. It creates a temporary corpus,
 * tries to create the four locked metadata keys, lists what was created, and deletes the
 * corpus whatever happened. It prints a JSON report of each call's status and the API's own
 * error message.
 *
 * Two key spellings are tried, because the v1beta1 discovery document says a key "can be up
 * to 63 characters, and valid characters are /a-z-/". Underscores are not in that set:
 *   1. the locked names exactly: skill_codes, provenance, surface_gate, content_type
 *   2. the same names hyphenated: skill-codes, provenance, surface-gate, content-type
 * The result says which, if either, RAG Engine accepts.
 *
 * credentials: attached by the egress proxy to `*.googleapis.com`; nothing is read from the
 * environment. Run with NODE_USE_ENV_PROXY=1.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/probe-rag-data-schema.ts \
 *          --project replit-cop --location us-central1
 */
import { parseArgs } from "node:util";
import { z } from "zod";

const operationSchema = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  response: z.record(z.unknown()).optional(),
});

type Call = { step: string; status: number; ms: number; body: unknown };

const LOCKED_KEYS = [
  "skill_codes",
  "provenance",
  "surface_gate",
  "content_type",
] as const;

function keySchemas(spelling: (key: string) => string): unknown[] {
  return LOCKED_KEYS.map((key) => ({
    ragDataSchema: {
      key: spelling(key),
      schemaDetails:
        key === "skill_codes"
          ? {
              type: "LIST",
              listConfig: { valueSchema: { type: "STRING" } },
              granularity: "GRANULARITY_FILE_LEVEL",
              searchStrategy: { searchStrategyType: "EXACT_SEARCH" },
            }
          : {
              type: "STRING",
              granularity: "GRANULARITY_FILE_LEVEL",
              searchStrategy: { searchStrategyType: "EXACT_SEARCH" },
            },
    },
  }));
}

async function call(
  calls: Call[],
  step: string,
  url: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<{ status: number; body: unknown }> {
  const started = Date.now();
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
    // A non-JSON body (e.g. the proxy's own error text) is kept verbatim.
    body = {
      non_json_body: text,
      parse_error: err instanceof Error ? err.message : "unknown",
    };
  }
  calls.push({ step, status: response.status, ms: Date.now() - started, body });
  return { status: response.status, body };
}

async function waitForOperation(
  calls: Call[],
  base: string,
  operationName: string,
  step: string,
): Promise<z.infer<typeof operationSchema>> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { body } = await call(
      calls,
      `${step} (poll ${attempt})`,
      `${base}/${operationName}`,
    );
    const op = operationSchema.parse(body);
    if (op.done) return op;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(
    `${step}: operation ${operationName} did not finish in 5 minutes`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { project: { type: "string" }, location: { type: "string" } },
  });
  const project = z.string().min(1).parse(values.project);
  const location = z.string().min(1).parse(values.location);
  if (process.env.NODE_USE_ENV_PROXY !== "1") {
    process.stderr.write(
      "run with NODE_USE_ENV_PROXY=1; no request was sent.\n",
    );
    process.exit(1);
  }

  const base = `https://${location}-aiplatform.googleapis.com/v1beta1`;
  const parent = `projects/${project}/locations/${location}`;
  const calls: Call[] = [];
  const outcome: Record<string, unknown> = {};
  let corpusName: string | null = null;
  const displayName = `lyceon-r1-probe-${Date.now()}`;

  try {
    const created = await call(
      calls,
      "create corpus",
      `${base}/${parent}/ragCorpora`,
      {
        method: "POST",
        body: {
          displayName,
          description:
            "Throwaway R-1 probe (RagDataSchema). Deleted by the probe.",
          ragEmbeddingModelConfig: {
            vertexPredictionEndpoint: {
              endpoint: `${parent}/publishers/google/models/text-embedding-005`,
            },
          },
        },
      },
    );
    const createOp = operationSchema.parse(created.body);
    const done = await waitForOperation(
      calls,
      base,
      createOp.name,
      "create corpus",
    );
    if (done.error)
      throw new Error(`create corpus failed: ${done.error.message}`);
    corpusName = z.object({ name: z.string() }).parse(done.response).name;
    outcome.corpus = corpusName;

    for (const [label, spelling] of [
      ["locked names (underscores)", (k: string) => k],
      ["hyphenated names", (k: string) => k.replace(/_/g, "-")],
    ] as const) {
      const result = await call(
        calls,
        `batchCreate: ${label}`,
        `${base}/${corpusName}/ragDataSchemas:batchCreate`,
        { method: "POST", body: { requests: keySchemas(spelling) } },
      );
      const op = operationSchema.safeParse(result.body);
      if (result.status === 200 && op.success && !op.data.done) {
        const finished = await waitForOperation(
          calls,
          base,
          op.data.name,
          `batchCreate: ${label}`,
        );
        outcome[label] = finished.error ?? "ok";
      } else {
        outcome[label] = { status: result.status, body: result.body };
      }
    }

    const listed = await call(
      calls,
      "list schemas",
      `${base}/${corpusName}/ragDataSchemas`,
    );
    outcome.schemas_listed = listed.body;
  } finally {
    // A create that reports an error can still leave corpora behind: RAG Engine retries
    // internally (observed 2026-10-13 in us-east5, four corpora from one failed create).
    // So cleanup deletes every corpus carrying this run's display name, not only the one
    // the create returned.
    const listing = await call(
      calls,
      "list corpora for cleanup",
      `${base}/${parent}/ragCorpora?pageSize=100`,
    );
    const leftovers = z
      .object({
        ragCorpora: z
          .array(z.object({ name: z.string(), displayName: z.string() }))
          .optional(),
      })
      .safeParse(listing.body);
    const toDelete = new Set<string>(corpusName === null ? [] : [corpusName]);
    for (const corpus of leftovers.success
      ? (leftovers.data.ragCorpora ?? [])
      : []) {
      if (corpus.displayName === displayName) toDelete.add(corpus.name);
    }
    const deletions: Record<string, number> = {};
    for (const name of toDelete) {
      const deleted = await call(
        calls,
        "delete corpus",
        `${base}/${name}?force=true`,
        {
          method: "DELETE",
        },
      );
      deletions[name] = deleted.status;
    }
    outcome.corpora_deleted = deletions;
    process.stdout.write(`${JSON.stringify({ outcome, calls }, null, 2)}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
