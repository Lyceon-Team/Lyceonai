/**
 * The GCP voice bake-off's request builders, pronunciation fallbacks and cost maths.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 4 and the step-1 rulings]
 *       | @implemented [2026-11-11]
 *
 * plain English: no request leaves the machine here. The builders are pure; voiceOneLine runs
 * against a fake fetch that records what it was sent, so the fallbacks (Chirp v1 → v1beta1 for
 * the custom pronunciation, Gemini → the brand respelled) are proven on the exact bodies sent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workedExampleContentSchema } from "../../packages/shared/src/worked-example-schema";
import {
  billedChars,
  chirpCost,
  chirpRequest,
  geminiCost,
  geminiRequest,
  GEMINI_TTS_MODEL,
  LYCEON_IPA,
  type FetchLike,
} from "../../scripts/worked-examples/google-tts";
import {
  BAKEOFF_GEMINI_PROMPT,
  bakeoffLines,
  bakeoffVoices,
  BRAND_TEST_LINE,
  voiceOneLine,
} from "../../scripts/worked-examples/voice-bakeoff";
import { loadKit } from "../../scripts/worked-examples/kit";

const ROOT = join(__dirname, "../..");
const fixture = workedExampleContentSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        ROOT,
        "tests/fixtures/worked-examples/social/content/worked-examples/2026-W45/SATM2CZS1BE/example.json",
      ),
      "utf8",
    ),
  ),
);

type Call = { url: string; body: Record<string, unknown> };

function fakeFetch(answer: (call: Call) => { status: number; body: string }): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
    };
    calls.push(call);
    const { status, body } = answer(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
  return { fetchImpl, calls };
}

const WAV = Buffer.from("RIFFxxxxWAVE").toString("base64");
const OK = { status: 200, body: JSON.stringify({ audioContent: WAV }) };

describe("the bake-off's voices and lines (Karl, 2026-11-11)", () => {
  it("four Chirp 3 HD male voices and one Gemini 2.5 Flash TTS voice, each id once", () => {
    const voices = bakeoffVoices();
    expect(voices.map((v) => v.id)).toEqual([
      "chirp3-hd-charon",
      "chirp3-hd-fenrir",
      "chirp3-hd-puck",
      "chirp3-hd-orus",
      "gemini-2.5-flash-tts-iapetus",
    ]);
    expect(new Set(voices.map((v) => v.id)).size).toBe(voices.length);
  });

  it("every voice reads the script in spoken order, the end card's line, then a line that says Lyceon", () => {
    const kit = loadKit();
    const lines = bakeoffLines(fixture, kit.voice.outro_text);
    expect(lines.map((l) => l.key)).toEqual([
      "hook",
      "question",
      ...fixture.steps.map((_, k) => `step-${k + 1}`),
      "trap",
      "answer",
      "outro",
      "brand-test",
    ]);
    expect(lines.at(-1)).toEqual(BRAND_TEST_LINE);
    expect(BRAND_TEST_LINE.text).toMatch(/\bLyceon\b/);
  });
});

describe("the requests (Cloud Text-to-Speech text:synthesize)", () => {
  it("Chirp 3 HD: the full voice name, LINEAR16 at 24 kHz, and Lyceon as IPA /ˈlaɪsiɑn/", () => {
    const req = chirpRequest("Charon", "Lyceon SAT Prep.");
    expect(req.voice).toEqual({
      languageCode: "en-US",
      name: "en-US-Chirp3-HD-Charon",
    });
    expect(req.audioConfig).toEqual({
      audioEncoding: "LINEAR16",
      sampleRateHertz: 24000,
    });
    expect(LYCEON_IPA).toBe("ˈlaɪsiɑn");
    expect(req.input.customPronunciations).toEqual({
      pronunciations: [
        {
          phrase: "Lyceon",
          phoneticEncoding: "PHONETIC_ENCODING_IPA",
          pronunciation: "ˈlaɪsiɑn",
        },
      ],
    });
    // The text itself is never respelled for Chirp.
    expect(req.input.text).toBe("Lyceon SAT Prep.");
  });

  it("a line that does not say Lyceon carries no custom pronunciation", () => {
    expect(chirpRequest("Orus", "Ten seconds. Ready? Go.").input).toEqual({
      text: "Ten seconds. Ready? Go.",
    });
  });

  it("Gemini-TTS: the model, the voice and the style prompt", () => {
    const req = geminiRequest("Iapetus", "Go.", BAKEOFF_GEMINI_PROMPT, true);
    expect(req.voice).toEqual({
      languageCode: "en-US",
      name: "Iapetus",
      modelName: GEMINI_TTS_MODEL,
    });
    expect(GEMINI_TTS_MODEL).toBe("gemini-2.5-flash-tts");
    expect(req.input.prompt).toMatch(/energetic, friendly SAT tutor/);
    expect(billedChars(req)).toBe("Go.".length + BAKEOFF_GEMINI_PROMPT.length);
  });
});

describe("the pronunciation fallbacks", () => {
  const chirp = bakeoffVoices()[0];
  const gemini = bakeoffVoices()[4];
  if (!chirp || !gemini) throw new Error("no voices");

  it("Chirp: v1 first; refused for the custom pronunciation, the same body goes once to v1beta1", async () => {
    const { fetchImpl, calls } = fakeFetch((c) =>
      c.url.includes("/v1/")
        ? { status: 400, body: "Invalid customPronunciations field" }
        : OK,
    );
    const sent = await voiceOneLine(chirp, "Lyceon SAT Prep.", "t", fetchImpl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      "https://texttospeech.googleapis.com/v1beta1/text:synthesize",
    ]);
    expect(calls[0]?.body).toEqual(calls[1]?.body);
    expect(sent).toMatchObject({ version: "v1beta1", brand: "ipa" });
  });

  it("Gemini: refused for the custom pronunciation, sent once with the brand respelled and no IPA", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      calls.length === 1
        ? { status: 400, body: "custom pronunciations are not supported" }
        : OK,
    );
    const sent = await voiceOneLine(gemini, "Lyceon SAT Prep.", "t", fetchImpl);
    expect(calls).toHaveLength(2);
    const second = calls[1]?.body as {
      input: { text: string; customPronunciations?: unknown };
    };
    expect(second.input.text).toBe("Lie-see-on SAT Prep.");
    expect(second.input.customPronunciations).toBeUndefined();
    expect(sent.brand).toBe("respelled");
  });

  it("any other error stops the run with Google's message (an auth or role error is not retried)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 403,
      body: "Permission 'serviceusage.services.use' denied",
    }));
    await expect(
      voiceOneLine(chirp, "Lyceon SAT Prep.", "t", fetchImpl),
    ).rejects.toThrow(/403: Permission 'serviceusage.services.use' denied/);
    expect(calls).toHaveLength(1);
  });

  it("a response with no audio is refused at the boundary", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: "{}" }));
    await expect(voiceOneLine(chirp, "Go.", "t", fetchImpl)).rejects.toThrow();
  });
});

describe("the cost maths (Google's pricing page, read 2026-11-11)", () => {
  it("Chirp 3 HD: free up to 1 M characters a month, then US$30 per million", () => {
    expect(chirpCost(20_000)).toBe(0);
    expect(chirpCost(1_000_000)).toBe(0);
    expect(chirpCost(1_500_000)).toBe(15);
  });

  it("Gemini 2.5 Flash TTS: US$1 / M text tokens, US$12 / M audio tokens at 25 a second", () => {
    expect(geminiCost(1_000_000, 0)).toBe(1);
    expect(geminiCost(0, 40_000)).toBe(12);
  });
});
