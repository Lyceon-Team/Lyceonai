/**
 * Vertex Model Availability Probe
 * @spec [Doc-03C_V3 §5.2, §30.1]
 * @implemented 2026-09-16
 *
 * Blocking probe: calls generateContent for every pinned model ID against the
 * configured Vertex endpoint. Reads model IDs and location from the SAME env
 * vars as the runtime (vertex-client.ts and tutor-crisis.ts), so the probe
 * cannot pass on a model the runtime would not reach.
 *
 * HOW TO RUN (requires GCP credentials — Application Default Credentials or
 * GOOGLE_APPLICATION_CREDENTIALS):
 *
 *   VERTEX_PROJECT_ID=replit-cop \
 *   VERTEX_LOCATION=global \
 *   VERTEX_MODEL_PRO_CLASS_ALIAS=gemini-3.5-flash \
 *   VERTEX_MODEL_FLASH_CLASS_ALIAS=gemini-3.5-flash \
 *   VERTEX_CLASSIFIER_CLASS_MODEL=gemini-3.1-flash-lite \
 *     pnpm -s exec tsx scripts/probe/vertex-model-availability-probe.ts
 *
 * Exits 0 when every model responds; exits 1 when any model fails.
 */

/* eslint-disable no-console -- standalone CLI diagnostic */

import { GoogleGenAI } from "@google/genai";

// ── Read from the same env vars as runtime ─────────────────────────────

function resolveLocation(): string {
  const raw = (process.env.VERTEX_LOCATION ?? "").trim();
  return raw.length > 0 ? raw : "global";
}

function resolveProjectId(): string {
  return (
    process.env.VERTEX_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    ""
  ).trim();
}

function resolveProClassModel(): string {
  return (
    (process.env.VERTEX_MODEL_PRO_CLASS_ALIAS ?? "").trim() ||
    "gemini-3.5-flash"
  );
}

function resolveFlashClassModel(): string {
  return (
    (process.env.VERTEX_MODEL_FLASH_CLASS_ALIAS ?? "").trim() ||
    "gemini-3.5-flash"
  );
}

function resolveClassifierModel(): string | null {
  const raw = (process.env.VERTEX_CLASSIFIER_CLASS_MODEL ?? "").trim();
  return raw.length > 0 ? raw : null;
}

// ── Probe logic ────────────────────────────────────────────────────────

type ProbeResult = {
  alias: string;
  model: string;
  location: string;
  ok: boolean;
  detail: string;
};

async function probeModel(
  client: GoogleGenAI,
  alias: string,
  model: string,
): Promise<ProbeResult> {
  const location = resolveLocation();
  try {
    const response = await client.models.generateContent({
      model,
      contents: "Reply with exactly: PROBE_OK",
      config: {
        maxOutputTokens: 16,
        temperature: 0,
      },
    });
    const text = response.text ?? "";
    return {
      alias,
      model,
      location,
      ok: true,
      detail: `200 — response: "${text.slice(0, 60)}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      alias,
      model,
      location,
      ok: false,
      detail: msg.slice(0, 200),
    };
  }
}

async function main(): Promise<void> {
  const project = resolveProjectId();
  const location = resolveLocation();

  if (!project) {
    console.error(
      "FATAL: VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set.",
    );
    process.exit(1);
  }

  console.log(`\n═══ Vertex Model Availability Probe ═══`);
  console.log(`  project:  ${project}`);
  console.log(`  location: ${location}\n`);

  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });

  // Collect unique model IDs with their alias labels
  const probes: Array<{ alias: string; model: string }> = [];
  const seen = new Set<string>();

  const proModel = resolveProClassModel();
  probes.push({ alias: "pro_class", model: proModel });
  seen.add(proModel);

  const flashModel = resolveFlashClassModel();
  if (!seen.has(flashModel)) {
    probes.push({ alias: "flash_class", model: flashModel });
    seen.add(flashModel);
  } else {
    probes.push({
      alias: "flash_class (same as pro_class)",
      model: flashModel,
    });
  }

  const classifierModel = resolveClassifierModel();
  if (classifierModel) {
    probes.push({ alias: "classifier", model: classifierModel });
  } else {
    console.log(
      "  WARN: VERTEX_CLASSIFIER_CLASS_MODEL not set — skipping classifier probe\n",
    );
  }

  const results: ProbeResult[] = [];

  for (const { alias, model } of probes) {
    process.stdout.write(`  probing ${alias} (${model})... `);
    const result = await probeModel(client, alias, model);
    console.log(
      result.ok ? `PASS  ${result.detail}` : `FAIL  ${result.detail}`,
    );
    results.push(result);
  }

  console.log();

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(
      `RESULT: ${failures.length}/${results.length} model(s) FAILED.\n`,
    );
    process.exit(1);
  }

  console.log(
    `RESULT: ${results.length}/${results.length} model(s) reachable.\n`,
  );
}

main().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(1);
});
