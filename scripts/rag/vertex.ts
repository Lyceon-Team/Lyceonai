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
 * credentials: attached by the session's egress proxy (or ADC on a workstation); nothing is
 *  read from the environment, and fetch must go through the proxy (NODE_USE_ENV_PROXY=1).
 *
 * edge cases: 429 and 5xx retry with backoff (6 tries, 5 s doubling, jitter); anything else, or a response that
 *  fails its schema, throws with the status and the step name. Response bodies are not
 *  logged: they can echo transcript text, which is never stored or printed.
 */
import { z } from "zod";

export const PROJECT = "replit-cop";
export const GENERATION_MODEL_DEFAULT = "gemini-3.5-flash";
export const EMBEDDING_MODEL = "text-embedding-005";
export const EMBEDDING_DIMENSIONS = 768;

export function assertProxied(): void {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= 5) {
      // The error body is Vertex's (or the proxy's) status text, never model output.
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(
        `${step}: Vertex returned ${response.status} after ${attempt + 1} tries: ${detail}`,
      );
    }
    await response.body?.cancel();
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
export const usageSchema = z.object({
  calls: z.number(),
  prompt: z.number(),
  cached: z.number(),
  output: z.number(),
});
export type Usage = z.infer<typeof usageSchema>;
export const ZERO_USAGE: Usage = { calls: 0, prompt: 0, cached: 0, output: 0 };
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    calls: a.calls + b.calls,
    prompt: a.prompt + b.prompt,
    cached: a.cached + b.cached,
    output: a.output + b.output,
  };
}

/**
 * USD per 1M tokens for gemini-3.5-flash on Vertex, pay-as-you-go: $1.50 input (text, audio
 * and video alike), $0.15 cached input, $9.00 output including thinking. Third-party
 * aggregator figures read 2026-10-15 (llmreference.com, getmaxim.ai); the official Vertex
 * pricing page did not load from this session. The raw token counts are reported alongside,
 * so the cost can be recomputed against the real rate card.
 */
export const PRICE_PER_MTOK = {
  input: 1.5,
  cached: 0.15,
  output: 9.0,
} as const;
export function usageCostUsd(u: Usage): number {
  const uncached = Math.max(0, u.prompt - u.cached);
  return (
    (uncached * PRICE_PER_MTOK.input +
      u.cached * PRICE_PER_MTOK.cached +
      u.output * PRICE_PER_MTOK.output) /
    1_000_000
  );
}

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
      },
    },
    opts.step,
  );
  const parsed = generateResponseSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`${opts.step}: unexpected response shape`);
  const m = parsed.data.usageMetadata;
  opts.onUsage?.({
    calls: 1,
    prompt: m?.promptTokenCount ?? 0,
    cached: m?.cachedContentTokenCount ?? 0,
    output: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0),
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
