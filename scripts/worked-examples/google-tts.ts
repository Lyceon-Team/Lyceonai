/**
 * Cloud Text-to-Speech for the worked examples: Chirp 3 HD voices and Gemini-TTS, through the
 * GCP identity the repository already uses from GitHub Actions.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" items 3-4 and the step-1 rulings:
 *       project replit-cop, lyceon-ci-eval through the existing Workload Identity Federation login
 *       (the path LISA's Vertex jobs use), no new auth flow or service; Chirp 3 HD with
 *       custom_pronunciations for "Lyceon" (/ˈlaɪsiɑn/); Gemini 2.5 Flash TTS with a style prompt]
 *       | @implemented [2026-11-11]
 *
 * plain English: builds the `text:synthesize` request for one line (pure, tested), sends it with
 * an access token from google-auth-library (already a root dependency; on GitHub Actions it reads
 * the credentials google-github-actions/auth writes), and returns the WAV Google sends back
 * (LINEAR16 carries a WAV header). The response is parsed with Zod at the boundary.
 *
 * Cost (Google's pricing page, read 2026-11-11): Chirp 3 HD, the first 1 million characters a
 * month free, then US$30 per million; Gemini 2.5 Flash TTS, no free tier, US$1.00 per million text
 * tokens in and US$12.00 per million audio tokens out (25 audio tokens a second). `billedChars`
 * and `geminiCost` report what a run used.
 *
 * edge cases: "Lyceon" is given to Chirp as an IPA custom pronunciation, never respelled; Gemini-TTS
 * takes the same field when the API accepts it, and the caller records which path was used. No
 * credential is read or logged here beyond asking the library for a token.
 */
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { spokenBrandName } from "./voice";

/** The brand as Karl rules it is said: "lye-see-on". */
export const LYCEON_IPA = "ˈlaɪsiɑn";

export const CHIRP_VOICE_PREFIX = "en-US-Chirp3-HD-";
export const GEMINI_TTS_MODEL = "gemini-2.5-flash-tts";
/** One sample rate for every engine in the comparison (Chirp 3 HD and Gemini-TTS serve 24 kHz). */
export const TTS_SAMPLE_RATE = 24000;

const TTS_HOST = "https://texttospeech.googleapis.com";
export type TtsApiVersion = "v1" | "v1beta1";

export type CustomPronunciation = {
  phrase: string;
  phoneticEncoding: "PHONETIC_ENCODING_IPA";
  pronunciation: string;
};

export type SynthesizeRequest = {
  input: {
    text: string;
    prompt?: string;
    customPronunciations?: { pronunciations: CustomPronunciation[] };
  };
  voice: { languageCode: "en-US"; name: string; modelName?: string };
  audioConfig: {
    audioEncoding: "LINEAR16";
    sampleRateHertz: number;
    speakingRate?: number;
  };
};

/** The IPA pronunciation of "Lyceon", when the line says it; otherwise none. */
export function brandPronunciations(
  text: string,
): { pronunciations: CustomPronunciation[] } | undefined {
  return /\bLyceon\b/i.test(text)
    ? {
        pronunciations: [
          {
            phrase: "Lyceon",
            phoneticEncoding: "PHONETIC_ENCODING_IPA",
            pronunciation: LYCEON_IPA,
          },
        ],
      }
    : undefined;
}

const AUDIO = {
  audioEncoding: "LINEAR16",
  sampleRateHertz: TTS_SAMPLE_RATE,
} as const;

/**
 * One Chirp 3 HD line, e.g. chirpRequest("Orus", "…"); a rate other than 1 is sent as speakingRate.
 * "Lyceon" is respelled (BRAND_RESPELLINGS["chirp3-hd"], "Lye-see-ahn", Karl's pick 2026-11-11)
 * with no IPA: the production path. `brand: "ipa"` sends the plain spelling with the IPA custom
 * pronunciation instead, as the 2026-11-11 bake-off did (voice-bakeoff.ts keeps that record).
 */
export function chirpRequest(
  voice: string,
  text: string,
  speakingRate = 1,
  brand: "respell" | "ipa" = "respell",
): SynthesizeRequest {
  const custom = brand === "ipa" ? brandPronunciations(text) : undefined;
  const spoken = brand === "ipa" ? text : spokenBrandName(text, "chirp3-hd");
  return {
    input: {
      text: spoken,
      ...(custom ? { customPronunciations: custom } : {}),
    },
    voice: { languageCode: "en-US", name: `${CHIRP_VOICE_PREFIX}${voice}` },
    audioConfig: {
      ...AUDIO,
      ...(speakingRate === 1 ? {} : { speakingRate }),
    },
  };
}

/** One Gemini-TTS line with a style prompt; `pronounce` adds the IPA custom pronunciation. */
export function geminiRequest(
  voice: string,
  text: string,
  prompt: string,
  pronounce: boolean,
): SynthesizeRequest {
  const custom = pronounce ? brandPronunciations(text) : undefined;
  return {
    input: {
      prompt,
      text,
      ...(custom ? { customPronunciations: custom } : {}),
    },
    voice: { languageCode: "en-US", name: voice, modelName: GEMINI_TTS_MODEL },
    audioConfig: { ...AUDIO },
  };
}

/** The characters Cloud TTS bills for a request: the input text (Google: every character). */
export function billedChars(req: SynthesizeRequest): number {
  return req.input.text.length + (req.input.prompt?.length ?? 0);
}

/** Gemini 2.5 Flash TTS: US$1.00 / M text tokens in, US$12.00 / M audio tokens out (25 per second). */
export function geminiCost(textTokens: number, audioSeconds: number): number {
  return (textTokens * 1.0 + audioSeconds * 25 * 12.0) / 1_000_000;
}

/** Chirp 3 HD: 1 M characters a month free, then US$30 per million. */
export function chirpCost(monthChars: number): number {
  return (Math.max(0, monthChars - 1_000_000) * 30) / 1_000_000;
}

const synthesizeResponseSchema = z.object({ audioContent: z.string().min(1) });

export class TtsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`text:synthesize returned ${status}: ${body.slice(0, 400)}`);
    this.name = "TtsHttpError";
  }
}

export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The access token for the identity the environment provides (ADC; WIF on GitHub Actions). */
export async function accessToken(): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("no GCP access token (is the WIF login set up?)");
  return token;
}

/** Sends one request; returns the WAV bytes. Throws TtsHttpError on a non-2xx answer. */
export async function synthesize(
  req: SynthesizeRequest,
  token: string,
  version: TtsApiVersion,
  fetchImpl: FetchLike,
): Promise<Uint8Array> {
  const res = await fetchImpl(`${TTS_HOST}/${version}/text:synthesize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(req),
  });
  const body = await res.text();
  if (!res.ok) throw new TtsHttpError(res.status, body);
  const parsed = synthesizeResponseSchema.parse(JSON.parse(body));
  return Uint8Array.from(Buffer.from(parsed.audioContent, "base64"));
}
