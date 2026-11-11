/**
 * The GCP voice bake-off: one worked-example script voiced by four Chirp 3 HD male voices and by
 * Gemini 2.5 Flash TTS with a style prompt, every line loudness-normalised and limited exactly as
 * the worked examples' committed lines are. Run once, on its own pull request.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 4 and the step-1 rulings: the
 *       W46 Nov 11 script; Chirp 3 HD (Charon, Fenrir, Puck, Orus) with custom_pronunciations for
 *       "Lyceon" (/ˈlaɪsiɑn/); Gemini 2.5 Flash TTS, prompt "energetic, friendly SAT tutor";
 *       am_michael the baseline; loudness and limiter on all; report the monthly cost (target $0);
 *       a single run as a job on its own PR through lyceon-ci-eval (option b)] | @implemented [2026-11-11]
 *
 * plain English:
 *   pnpm exec tsx scripts/worked-examples/voice-bakeoff.ts --example <content root>/<example dir> --out <dir>
 * For each GCP voice and each line (the script in spoken order, the end card's line, and one
 * test line that says "Lyceon"): text:synthesize, then normaliseLoudness (scripts/worked-examples/
 * voice.ts: two-pass loudnorm to the kit's target, true peak at most -1 dBTP, the limiter). Writes
 * <out>/<voice>/<line>.wav and <out>/report.json: per voice the API version used, how "Lyceon" was
 * handled, characters sent, seconds of audio, and the cost of the run and of a month at the
 * weekly volume. The am_michael baseline is the script's committed audio; the blind A-F file is
 * assembled from this output and that audio after the run.
 *
 * edge cases: the output folder may not be inside a checkout (nothing voiced is committed). A
 * Chirp request the v1 API refuses for its custom pronunciation is sent once to v1beta1; a Gemini
 * request refused for it is sent once with the brand respelled instead, and the report says so.
 * Any other HTTP error stops the run with Google's message (an auth or role error included).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { workedExampleContentSchema } from "../../packages/shared/src/worked-example-schema";
import { readWav } from "./audio";
import { scriptLines, type ScriptLine } from "./composition";
import {
  accessToken,
  billedChars,
  chirpCost,
  chirpRequest,
  geminiCost,
  geminiRequest,
  synthesize,
  TtsHttpError,
  type FetchLike,
  type SynthesizeRequest,
  type TtsApiVersion,
} from "./google-tts";
import { loadKit } from "./kit";
import { BRAND_RESPELLINGS, checkoutRoot, normaliseLoudness } from "./voice";

export const BAKEOFF_CHIRP_VOICES = [
  "Charon",
  "Fenrir",
  "Puck",
  "Orus",
] as const;
export const BAKEOFF_GEMINI_VOICE = "Iapetus";
export const BAKEOFF_GEMINI_PROMPT =
  "Read this as an energetic, friendly SAT tutor talking to a high-school student: upbeat, clear and conversational.";
/** The line that lets Karl hear "Lyceon"; the Nov 11 script never says it. Test only. */
export const BRAND_TEST_LINE: ScriptLine = {
  key: "brand-test",
  text: "Lyceon SAT Prep.",
};
/** The weekly volume Karl ruled (7 worked examples) over an average month. */
export const VIDEOS_PER_MONTH = (7 * 365.25) / 12 / 7;

export type BakeoffVoice =
  | { id: string; engine: "chirp3-hd"; voice: string }
  | { id: string; engine: "gemini-tts"; voice: string };

export function bakeoffVoices(): BakeoffVoice[] {
  return [
    ...BAKEOFF_CHIRP_VOICES.map(
      (v): BakeoffVoice => ({
        id: `chirp3-hd-${v.toLowerCase()}`,
        engine: "chirp3-hd",
        voice: v,
      }),
    ),
    {
      id: `gemini-2.5-flash-tts-${BAKEOFF_GEMINI_VOICE.toLowerCase()}`,
      engine: "gemini-tts",
      voice: BAKEOFF_GEMINI_VOICE,
    },
  ];
}

/** The lines every voice reads: the script in spoken order (end card included), then the brand test. */
export function bakeoffLines(
  example: Parameters<typeof scriptLines>[0],
  outroText: string,
): ScriptLine[] {
  return [...scriptLines(example, outroText), BRAND_TEST_LINE];
}

function isPronunciationRefusal(e: unknown): boolean {
  return (
    e instanceof TtsHttpError &&
    e.status === 400 &&
    /pronunciation/i.test(e.body)
  );
}

type Sent = {
  audio: Uint8Array;
  version: TtsApiVersion;
  brand: "ipa" | "respelled" | "none";
  chars: number;
};

/** One line in one voice, with the documented fallbacks for the custom pronunciation. */
export async function voiceOneLine(
  v: BakeoffVoice,
  text: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<Sent> {
  const says = /\bLyceon\b/i.test(text);
  const send = async (
    req: SynthesizeRequest,
    version: TtsApiVersion,
    brand: Sent["brand"],
  ): Promise<Sent> => ({
    audio: await synthesize(req, token, version, fetchImpl),
    version,
    brand,
    chars: billedChars(req),
  });
  if (v.engine === "chirp3-hd") {
    const req = chirpRequest(v.voice, text, 1, "ipa");
    try {
      return await send(req, "v1", says ? "ipa" : "none");
    } catch (e: unknown) {
      if (!says || !isPronunciationRefusal(e)) throw e;
      return send(req, "v1beta1", "ipa");
    }
  }
  try {
    return await send(
      geminiRequest(v.voice, text, BAKEOFF_GEMINI_PROMPT, says),
      "v1",
      says ? "ipa" : "none",
    );
  } catch (e: unknown) {
    if (!says || !isPronunciationRefusal(e)) throw e;
    const respelled = text.replace(
      /\bLyceon\b/gi,
      BRAND_RESPELLINGS.chatterbox,
    );
    return send(
      geminiRequest(v.voice, respelled, BAKEOFF_GEMINI_PROMPT, false),
      "v1",
      "respelled",
    );
  }
}

type VoiceReport = {
  id: string;
  engine: BakeoffVoice["engine"];
  voice: string;
  api_versions: TtsApiVersion[];
  brand: Sent["brand"];
  chars: number;
  seconds: number;
  run_cost_usd: number;
  month_chars: number;
  month_cost_usd: number;
  lines: { key: string; file: string; seconds: number }[];
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string => {
    const i = args.indexOf(name);
    const value = i === -1 ? undefined : args[i + 1];
    if (!value) throw new Error(`missing ${name}`);
    return value;
  };
  const exampleDir = resolve(flag("--example"));
  const out = resolve(flag("--out"));
  mkdirSync(out, { recursive: true });
  if (checkoutRoot(out) !== null)
    throw new Error(
      `--out ${out} is inside a checkout; nothing voiced is committed`,
    );
  const kit = loadKit();
  const example = workedExampleContentSchema.parse(
    JSON.parse(readFileSync(join(exampleDir, "example.json"), "utf8")),
  );
  const lines = bakeoffLines(example, kit.voice.outro_text);
  const token = await accessToken();
  const fetchImpl: FetchLike = (url, init) => fetch(url, init);
  const reports: VoiceReport[] = [];
  for (const v of bakeoffVoices()) {
    const dir = join(out, v.id);
    mkdirSync(join(dir, "raw"), { recursive: true });
    const versions = new Set<TtsApiVersion>();
    let brand: Sent["brand"] = "none";
    let chars = 0;
    const done: VoiceReport["lines"] = [];
    for (const line of lines) {
      process.stdout.write(`voicing ${line.key} (${v.id})\n`);
      const sent = await voiceOneLine(v, line.text, token, fetchImpl);
      versions.add(sent.version);
      if (sent.brand !== "none") brand = sent.brand;
      chars += sent.chars;
      const raw = join(dir, "raw", `${line.key}.wav`);
      writeFileSync(raw, sent.audio);
      const file = `${line.key}.wav`;
      normaliseLoudness(raw, join(dir, file), kit.voice.loudness);
      const seconds = readWav(readFileSync(join(dir, file))).durationSeconds;
      done.push({ key: line.key, file, seconds });
    }
    const seconds = done.reduce((s, l) => s + l.seconds, 0);
    const monthChars = Math.round(chars * VIDEOS_PER_MONTH);
    const monthSeconds = seconds * VIDEOS_PER_MONTH;
    const textTokens = Math.ceil(chars / 4);
    reports.push({
      id: v.id,
      engine: v.engine,
      voice: v.voice,
      api_versions: [...versions],
      brand,
      chars,
      seconds: Math.round(seconds * 100) / 100,
      run_cost_usd:
        v.engine === "gemini-tts" ? geminiCost(textTokens, seconds) : 0,
      month_chars: monthChars,
      month_cost_usd:
        v.engine === "gemini-tts"
          ? geminiCost(Math.ceil(textTokens * VIDEOS_PER_MONTH), monthSeconds)
          : chirpCost(monthChars),
      lines: done,
    });
  }
  const report = {
    example: example.question_id,
    post_on: example.post_on,
    lines: lines.map((l) => ({ key: l.key, text: l.text })),
    loudness: kit.voice.loudness,
    videos_per_month: Math.round(VIDEOS_PER_MONTH * 100) / 100,
    voices: reports,
  };
  writeFileSync(
    join(out, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ ...report, lines: undefined }, null, 2)}\n`,
  );
}

if (process.argv[1]?.endsWith("voice-bakeoff.ts")) {
  main().catch((e: unknown) => {
    process.stderr.write(
      `voice-bakeoff: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  });
}
