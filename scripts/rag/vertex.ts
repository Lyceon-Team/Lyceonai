/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 C–F (Gemini for gate, description and tagging;
 *       text-embedding-005 for the stored vector)] | @implemented [2026-10-15]
 *
 * plain English: the two Vertex calls the build-time pipeline makes, over REST.
 *  - `generateJson`: Gemini with a response schema, temperature 0, parsed with Zod. The model
 *    is the tutor worker's default (`gemini-3.5-flash`, global endpoint), overridable with
 *    `--model`.
 *  - `embedTexts`: text-embedding-005 in us-central1, 768 dimensions (closure plan row A).
 *    Stored rows use task type RETRIEVAL_DOCUMENT; Step F's query embedding uses
 *    RETRIEVAL_QUERY.
 *
 * credentials: in a cloud session, attached by the egress proxy (fetch must go through it,
 *  NODE_USE_ENV_PROXY=1). On a workstation, where no HTTPS_PROXY is set, Application Default
 *  Credentials (`gcloud auth application-default login`) through google-auth-library; no key
 *  is read from the environment either way. Before 2026-10-27 the workstation path sent no
 *  credential at all, so every call there failed with 401.
 *
 * edge cases: 429 and 5xx retry with backoff (6 tries, 5 s doubling, jitter); anything else, or a response that
 *  fails its schema, throws with the status and the step name. Response bodies are not
 *  logged: they can echo transcript text, which is never stored or printed.
 */
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

export const PROJECT = "replit-cop";
export const GENERATION_MODEL_DEFAULT = "gemini-3.5-flash";
export const EMBEDDING_MODEL = "text-embedding-005";
export const EMBEDDING_DIMENSIONS = 768;

/** "proxy" in a cloud session (the egress proxy attaches credentials); "adc" on a workstation. */
export function vertexAuthMode(): "proxy" | "adc" {
  return (process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "") === ""
    ? "adc"
    : "proxy";
}

let adcClient: GoogleAuth | null = null;

/** The Authorization header for a Vertex REST call: none behind the proxy, ADC otherwise. */
export async function vertexAuthHeaders(): Promise<Record<string, string>> {
  if (vertexAuthMode() === "proxy") return {};
  adcClient ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await adcClient.getAccessToken();
  if (!token) {
    throw new Error(
      "no Application Default Credentials: run `gcloud auth application-default login`",
    );
  }
  return { authorization: `Bearer ${token}` };
}

export function assertProxied(): void {
  if (vertexAuthMode() === "adc") return;
  if (process.env.NODE_USE_ENV_PROXY !== "1") {
    process.stderr.write(
      "run with NODE_USE_ENV_PROXY=1; no request was sent.\n",
    );
    process.exit(1);
  }
}

async function postJson(
  url: string,
  body: unknown,
  step: string,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await vertexAuthHeaders()),
      },
      body: JSON.stringify(body),
    });
    // A 200 whose body is not JSON ("upstream request failed" from the egress proxy, seen
    // 2026-10-23) is a transport failure like a 5xx, and is retried the same way.
    let parsed: unknown = undefined;
    let jsonOk = false;
    if (response.ok) {
      const text = await response.text();
      try {
        parsed = JSON.parse(text);
        jsonOk = true;
      } catch (err: unknown) {
        if (attempt >= 5)
          throw new Error(
            `${step}: Vertex returned 200 with a non-JSON body after ${attempt + 1} tries`,
            { cause: err },
          );
      }
      if (jsonOk) return parsed;
    }
    const retryable =
      response.ok || response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= 5) {
      // The error body is Vertex's (or the proxy's) status text, never model output.
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(
        `${step}: Vertex returned ${response.status} after ${attempt + 1} tries: ${detail}`,
      );
    }
    if (!response.ok) await response.body?.cancel();
    // 5, 10, 20, 40, 80 s plus jitter: a video-token quota (429) needs longer than a blip.
    await new Promise((r) =>
      setTimeout(r, 5_000 * 2 ** attempt + Math.floor(Math.random() * 1_000)),
    );
  }
}

const generateResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })),
        }),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      cachedContentTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

/** Token usage of one or more Gemini calls, summed. */
export const usageSchema = z
  .object({
    calls: z.number(),
    prompt: z.number(),
    cached: z.number(),
    /** Billed output: visible output plus thinking. */
    output: z.number(),
    /** The thinking part of `output`, reported separately so its share is visible. */
    thoughts: z.number().default(0),
    /** USD at the rate of the model each call ran on (MODEL_PRICES). */
    usd: z.number().optional(),
  })
  // Usage cached before 2026-10-23 has no `thoughts` or `usd`; every such call ran on
  // gemini-3.5-flash, so its cost is recomputed at that rate.
  .transform((u) => ({
    ...u,
    usd:
      u.usd ??
      (Math.max(0, u.prompt - u.cached) * 1.5 +
        u.cached * 0.15 +
        u.output * 9.0) /
        1_000_000,
  }));
export type Usage = z.output<typeof usageSchema>;
export const ZERO_USAGE: Usage = {
  calls: 0,
  prompt: 0,
  cached: 0,
  output: 0,
  thoughts: 0,
  usd: 0,
};
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    calls: a.calls + b.calls,
    prompt: a.prompt + b.prompt,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    thoughts: a.thoughts + b.thoughts,
    usd: a.usd + b.usd,
  };
}

type Price = { input: number; cached: number; output: number };
/**
 * USD per 1M tokens on Vertex, pay-as-you-go; output includes thinking.
 *  - gemini-3.5-flash: $1.50 input (text, audio and video alike), $0.15 cached, $9.00 output.
 *    Third-party aggregator figures read 2026-10-15 (llmreference.com, getmaxim.ai).
 *  - gemini-3.1-flash-lite: $0.25 input, $0.025 cached, $1.50 output. Third-party figures read
 *    2026-10-23 (getmaxim.ai, futureagi.com).
 *  - gemini-3.1-pro-preview (the G0-2 judge): $2.00 input, $0.20 cached, $12.00 output, at
 *    the under-200k-token tier. Third-party figures read 2026-10-27 (getmaxim.ai, requesty.ai).
 * The official Vertex pricing page did not load from this session; the raw token counts are
 * reported alongside, so the cost can be recomputed against the real rate card. A model not
 * listed is costed at the gemini-3.5-flash rate (the higher of the two).
 */
export const MODEL_PRICES: Readonly<Record<string, Price>> = {
  "gemini-3.5-flash": { input: 1.5, cached: 0.15, output: 9.0 },
  "gemini-3.1-flash-lite": { input: 0.25, cached: 0.025, output: 1.5 },
  "gemini-3.1-pro-preview": { input: 2.0, cached: 0.2, output: 12.0 },
};
export const PRICE_PER_MTOK: Price = { input: 1.5, cached: 0.15, output: 9.0 };
export function priceOf(model: string): Price {
  return MODEL_PRICES[model] ?? PRICE_PER_MTOK;
}
export function usageCostUsd(u: Usage): number {
  return u.usd;
}

/**
 * How much the model may think before answering. Omitted = the model's default. MINIMAL is the
 * floor for gemini-3.5-flash (measured 2026-10-23: zero thinking tokens on a transcription).
 */
export type ThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

/** A public YouTube video, clipped to [start, end) seconds, for Gemini to watch. */
export type VideoClip = { videoId: string; start: number; end: number };

/** One Gemini call returning JSON that must satisfy `schema`. */
export async function generateJson<T>(opts: {
  step: string;
  model: string;
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
  schema: z.ZodType<T>;
  /** Gemini watches this clip before reading the text (R-14, Karl 2026-10-15). */
  video?: VideoClip;
  /** An image Gemini reads before the text (book OCR, scripts/rag/ocr-book.ts). */
  image?: { mimeType: "image/png" | "image/jpeg"; data: Buffer };
  /** The thinking level; omitted = the model's default. */
  thinking?: ThinkingLevel;
  /** Receives the call's token usage. */
  onUsage?: (u: Usage) => void;
}): Promise<T> {
  const videoParts =
    opts.video === undefined
      ? []
      : [
          {
            fileData: {
              fileUri: `https://www.youtube.com/watch?v=${opts.video.videoId}`,
              mimeType: "video/*",
            },
            videoMetadata: {
              startOffset: `${Math.floor(opts.video.start)}s`,
              endOffset: `${Math.ceil(opts.video.end)}s`,
            },
          },
        ];
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${opts.model}:generateContent`;
  // A response with no usable candidate (no content parts) is retried twice before it fails;
  // the failure names the finishReason, so a blocked answer is told apart from a blip.
  let parsed:
    | z.SafeParseReturnType<unknown, z.infer<typeof generateResponseSchema>>
    | undefined;
  for (let attempt = 0; ; attempt += 1) {
    const raw = await postJson(
      url,
      {
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...videoParts,
              ...(opts.image === undefined
                ? []
                : [
                    {
                      inlineData: {
                        mimeType: opts.image.mimeType,
                        data: opts.image.data.toString("base64"),
                      },
                    },
                  ]),
              { text: opts.user },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema,
          ...(opts.thinking === undefined
            ? {}
            : { thinkingConfig: { thinkingLevel: opts.thinking } }),
        },
      },
      opts.step,
    );
    parsed = generateResponseSchema.safeParse(raw);
    if (parsed.success) break;
    if (attempt >= 2) {
      const reason = z
        .object({
          candidates: z
            .array(z.object({ finishReason: z.string().optional() }))
            .optional(),
        })
        .safeParse(raw);
      throw new Error(
        `${opts.step}: unexpected response shape after ${attempt + 1} tries (finishReason ${reason.success ? (reason.data.candidates?.[0]?.finishReason ?? "none") : "unreadable"})`,
      );
    }
  }
  if (!parsed?.success)
    throw new Error(`${opts.step}: unexpected response shape`);
  const m = parsed.data.usageMetadata;
  const prompt = m?.promptTokenCount ?? 0;
  const cachedTokens = m?.cachedContentTokenCount ?? 0;
  const thoughts = m?.thoughtsTokenCount ?? 0;
  const output = (m?.candidatesTokenCount ?? 0) + thoughts;
  const price = priceOf(opts.model);
  opts.onUsage?.({
    calls: 1,
    prompt,
    cached: cachedTokens,
    output,
    thoughts,
    usd:
      (Math.max(0, prompt - cachedTokens) * price.input +
        cachedTokens * price.cached +
        output * price.output) /
      1_000_000,
  });
  const candidate = parsed.data.candidates[0];
  const text = (candidate?.content.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(
      `${opts.step}: model returned non-JSON (finishReason ${candidate?.finishReason ?? "?"})`,
      { cause: err },
    );
  }
  const result = opts.schema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `${opts.step}: model output failed its schema: ${result.error.issues[0]?.message ?? ""}`,
    );
  }
  return result.data;
}

const embedResponseSchema = z.object({
  predictions: z.array(
    z.object({ embeddings: z.object({ values: z.array(z.number()) }) }),
  ),
});

/** text-embedding-005 vectors, in input order, 768 dimensions each. */
export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const batch = texts.slice(i, i + 20);
    const raw = await postJson(
      url,
      { instances: batch.map((content) => ({ content, task_type: taskType })) },
      "embed",
    );
    const parsed = embedResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.predictions.length !== batch.length) {
      throw new Error("embed: unexpected response shape");
    }
    for (const p of parsed.data.predictions) {
      if (p.embeddings.values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `embed: ${p.embeddings.values.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      out.push(p.embeddings.values);
    }
  }
  return out;
}
