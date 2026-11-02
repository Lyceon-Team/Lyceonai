/**
 * Video pilots: voices a pilot's lines in one engine, through the worked examples' own
 * pronunciation, loudness and quality steps, and writes the manifest the Manim scene plays.
 *
 * @spec [Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267): rule 5 "Voice:
 *       am_michael everywhere"; rule 6 "'Lyceon' is said 'lye-see-on'. Use #1395's
 *       spokenBrandName()"; rule 7 "Loudness: reuse #1395's normalisation step (around −14 LUFS,
 *       true peak ≤ −1 dB). Your Kokoro speech service must run every line through the SAME
 *       function or command #1395 added in voice.ts"; owner brief "Video tools pilot" D3: a
 *       Chatterbox pilot on the same script, "Lyceon" respelled "Lie-see-on" through
 *       spokenBrandName with an engine parameter, raw output "MUST go through the same loudness
 *       step", "render line by line and cache"; the worked examples' quality checks
 *       (scripts/worked-examples/quality.ts: transcription mismatch, clipping, silence)]
 *       | @implemented [2026-11-02]
 *
 * plain English, from the repository root:
 *   pnpm exec tsx scripts/video-pilots/voice-lines.ts --bundle <work>/bundle.json \
 *     --engine kokoro|chatterbox --out <work>/voice-<engine> [--python <chatterbox venv python>]
 *   pnpm exec tsx scripts/video-pilots/voice-lines.ts --say "Lyceon SAT Prep." --engine ... --out ...
 * Every line of the bundle (prepare.ts: hook, setup, steps, trap, answer, call to action) is:
 *   1. given to the engine as spokenBrandName(text, engine) (voice.ts), the one brand table;
 *      * kokoro: `hyperframes tts` with kokoroTtsArgs and voice.json's default profile (am_michael),
 *        the exact call scripts/worked-examples/voice.ts makes; hyperframes runs Kokoro in the
 *        Python named by HYPERFRAMES_PYTHON (render.py sets it);
 *      * chatterbox: chatterbox/speak_lines.py, run once for every line not yet cached, with the
 *        Python of the Chatterbox venv (--python or LYCEON_CHATTERBOX_PYTHON), CPU only;
 *   2. normalised with normaliseLoudness (voice.ts: two-pass loudnorm to voice.json's loudness,
 *      then the limiter), the function the worked examples run on every committed line;
 *   3. transcribed with `hyperframes transcribe` (voice.ts hyperframes, wordsFromTranscribe) and
 *      checked with lineQualityProblems (quality.ts) against the line as authored.
 * The raw engine output is cached under <out>/raw by a hash of the engine, the engine's settings
 * and the spoken text, so a re-run (or a re-render of the scene) re-voices nothing, and editing one
 * line re-voices only that line; Chatterbox on CPU is 12-38x slower than real time, so this
 * matters. Normalising and transcribing run every time (seconds). <out>/voice.json lists every
 * line with its normalised WAV, its words, its length, its quality problems and (Chatterbox) the
 * seconds the engine took. Any quality problem stops the run after the manifest is written, so the
 * scene is never rendered from a line that fails.
 *
 * --say voices one ad-hoc line (the brand check: how each engine's "Lyceon" is heard) and prints
 * what the transcriber heard. It is the only output that prints words; a script line's text and
 * transcript are never printed.
 *
 * edge cases: refuses an --out inside the repository (voiced lines are never committed); a
 * Chatterbox run that produces no WAV for a line, or prints anything but its JSON events, stops.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { voiceWordsSchema } from "../../packages/shared/src/worked-example-schema";
import { readWav } from "../worked-examples/audio";
import { sha256 } from "../worked-examples/content";
import { ROOT, loadKit, type Kit } from "../worked-examples/kit";
import { lineQualityProblems } from "../worked-examples/quality";
import {
  hyperframes,
  kokoroTtsArgs,
  normaliseLoudness,
  spokenBrandName,
  wordsFromTranscribe,
  type BrandEngine,
} from "../worked-examples/voice";

export const PILOT_ENGINES = [
  "kokoro",
  "chatterbox",
] as const satisfies readonly BrandEngine[];
export const pilotEngineSchema = z.enum(PILOT_ENGINES);
export type PilotEngine = z.infer<typeof pilotEngineSchema>;

/** The Chatterbox service and its pinned environment: their bytes are part of its cache key. */
export const CHATTERBOX_DIR = "scripts/video-pilots/chatterbox";
/** The one seed every Chatterbox line is generated with (speak_lines.py --seed). */
export const CHATTERBOX_SEED = 0;

const scriptLineSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  text: z.string().min(1),
});
const bundleLinesSchema = z.object({
  lines: z.array(scriptLineSchema).min(1),
});

export const pilotVoiceLineSchema = z.object({
  key: z.string().min(1),
  /** The line as authored (what the quality check compares the transcription with). */
  text: z.string().min(1),
  /** What the engine was given: the text with "Lyceon" respelled for that engine. */
  spoken: z.string().min(1),
  raw: z.string().endsWith(".wav"),
  wav: z.string().endsWith(".wav"),
  duration: z.number().positive(),
  words: voiceWordsSchema,
  problems: z.array(z.string()),
  /** Chatterbox: the seconds it took to generate this line on CPU, when it was generated. */
  engine_seconds: z.number().positive().optional(),
});
export type PilotVoiceLine = z.infer<typeof pilotVoiceLineSchema>;

export const pilotVoiceSchema = z.object({
  engine: pilotEngineSchema,
  /** am_michael (kokoro), or the Chatterbox built-in voice. */
  voice: z.string().min(1),
  /** Chatterbox: seconds to load the model in this run (0 when every line was cached). */
  load_seconds: z.number().min(0),
  lines: z.array(pilotVoiceLineSchema).min(1),
});
export type PilotVoice = z.infer<typeof pilotVoiceSchema>;

/** What speak_lines.py prints, one JSON object per stdout line. */
export const chatterboxEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("loaded"), seconds: z.number().min(0) }),
  z.object({
    event: z.literal("line"),
    index: z.number().int().min(0),
    wall_seconds: z.number().positive(),
    audio_seconds: z.number().positive(),
    raw_peak: z.number().min(0),
    scaled_to_full_scale: z.boolean(),
  }),
]);
export type ChatterboxEvent = z.infer<typeof chatterboxEventSchema>;

/** Parses speak_lines.py's stdout; anything that is not one of its events is an error. */
export function parseChatterboxEvents(stdout: string): ChatterboxEvent[] {
  return stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => chatterboxEventSchema.parse(JSON.parse(l)));
}

/**
 * What a raw line's audio depends on, besides its text: for kokoro the hyperframes version, the
 * voice and its rate; for chatterbox the seed and the bytes of the service and its requirements.
 */
export function engineFingerprint(kit: Kit, engine: PilotEngine): string {
  if (engine === "kokoro") {
    const p = kit.voice.profiles[kit.voice.default_profile];
    if (p?.engine !== "kokoro")
      throw new Error("voice.json's default profile is not a kokoro voice");
    return `kokoro ${kit.voice.hyperframes} ${p.kokoro_voice} ${p.speaking_rate}`;
  }
  const files = ["speak_lines.py", "requirements.txt"].map((f) =>
    sha256(readFileSync(join(ROOT, CHATTERBOX_DIR, f), "utf8")),
  );
  return `chatterbox seed ${CHATTERBOX_SEED} ${files.join(" ")}`;
}

/** The raw WAV's cache name: the line's key and a hash of engine, fingerprint and spoken text. */
export function rawCacheName(
  key: string,
  fingerprint: string,
  spoken: string,
): string {
  return `${key}-${sha256(JSON.stringify([fingerprint, spoken])).slice(0, 16)}.wav`;
}

/** Whether `path` is inside the repository checkout (renders and voice never are). */
export function insideRepo(path: string): boolean {
  const root = realpathSync(ROOT);
  const target = existsSync(path) ? realpathSync(path) : resolve(path);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

type Job = { key: string; text: string; spoken: string; raw: string };

function voiceKokoro(kit: Kit, jobs: readonly Job[], work: string): void {
  const profile = kit.voice.profiles[kit.voice.default_profile];
  if (profile?.engine !== "kokoro")
    throw new Error("voice.json's default profile is not a kokoro voice");
  for (const job of jobs) {
    process.stdout.write(
      `kokoro ${profile.kokoro_voice}: voicing ${job.key}\n`,
    );
    // kokoroTtsArgs applies spokenBrandName(text) itself: the call voice.ts makes, unchanged.
    hyperframes(kit.voice, kokoroTtsArgs(profile, job.text, job.raw), work);
    if (!existsSync(job.raw))
      throw new Error(`hyperframes tts wrote no audio for ${job.key}`);
  }
}

function voiceChatterbox(
  jobs: readonly Job[],
  work: string,
  python: string,
): { load: number; seconds: Map<string, number> } {
  const jobsFile = join(work, "chatterbox-jobs.json");
  writeFileSync(
    jobsFile,
    JSON.stringify(jobs.map((j) => ({ text: j.spoken, out: j.raw }))),
  );
  process.stdout.write(
    `chatterbox (CPU): voicing ${jobs.map((j) => j.key).join(", ")}\n`,
  );
  const run = spawnSync(
    python,
    [
      join(ROOT, CHATTERBOX_DIR, "speak_lines.py"),
      "--jobs",
      jobsFile,
      "--seed",
      String(CHATTERBOX_SEED),
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: "1" },
    },
  );
  if (run.status !== 0)
    throw new Error(`speak_lines.py exited ${run.status ?? "on a signal"}`);
  let load = 0;
  const seconds = new Map<string, number>();
  for (const e of parseChatterboxEvents(run.stdout)) {
    if (e.event === "loaded") load = e.seconds;
    else {
      const job = jobs[e.index];
      if (!job) throw new Error(`speak_lines.py reported line ${e.index}`);
      seconds.set(job.key, e.wall_seconds);
      writeFileSync(`${job.raw}.timing.json`, JSON.stringify(e));
    }
  }
  for (const job of jobs)
    if (!existsSync(job.raw))
      throw new Error(`speak_lines.py wrote no audio for ${job.key}`);
  return { load, seconds };
}

/** Voices `lines` in `engine` into `out` and returns (and writes) the manifest. */
export function voiceLines(
  kit: Kit,
  lines: readonly { key: string; text: string }[],
  engine: PilotEngine,
  out: string,
  python: string | undefined,
): PilotVoice {
  if (insideRepo(out))
    throw new Error(
      `${out} is inside the repository; voiced lines are never committed`,
    );
  const rawDir = join(out, "raw");
  mkdirSync(rawDir, { recursive: true });
  const fingerprint = engineFingerprint(kit, engine);
  const jobs: Job[] = lines.map((l) => {
    const spoken = spokenBrandName(l.text, engine);
    return {
      key: l.key,
      text: l.text,
      spoken,
      raw: join(rawDir, rawCacheName(l.key, fingerprint, spoken)),
    };
  });
  const missing = jobs.filter((j) => !existsSync(j.raw));
  let load = 0;
  if (missing.length > 0) {
    if (engine === "kokoro") voiceKokoro(kit, missing, out);
    else {
      if (!python)
        throw new Error(
          "chatterbox needs --python or LYCEON_CHATTERBOX_PYTHON (the venv from chatterbox/requirements.txt)",
        );
      load = voiceChatterbox(missing, out, python).load;
    }
  }
  const voiced = jobs.map((job): PilotVoiceLine => {
    const wav = join(out, `${job.key}.wav`);
    normaliseLoudness(job.raw, wav, kit.voice.loudness);
    const words = wordsFromTranscribe(
      hyperframes(
        kit.voice,
        ["transcribe", wav, "--json", "-m", kit.voice.transcribe_model],
        out,
      ),
      (path) => readFileSync(path, "utf8"),
    );
    const audio = readFileSync(wav);
    const timing = `${job.raw}.timing.json`;
    const seconds = existsSync(timing)
      ? chatterboxEventSchema.parse(JSON.parse(readFileSync(timing, "utf8")))
      : null;
    return {
      key: job.key,
      text: job.text,
      spoken: job.spoken,
      raw: job.raw,
      wav,
      duration: Math.round(readWav(audio).durationSeconds * 1000) / 1000,
      words,
      problems: lineQualityProblems(
        job.text,
        words,
        audio,
        kit.voice.quality,
        kit.voice.transcript_aliases,
      ),
      ...(seconds?.event === "line"
        ? { engine_seconds: seconds.wall_seconds }
        : {}),
    };
  });
  const manifest = pilotVoiceSchema.parse({
    engine,
    voice:
      engine === "kokoro"
        ? kit.voice.default_profile
        : "chatterbox built-in voice",
    load_seconds: load,
    lines: voiced,
  });
  writeFileSync(
    join(out, "voice.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function main(): void {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const k = args.indexOf(name);
    return k === -1 ? undefined : args[k + 1];
  };
  const engine = pilotEngineSchema.parse(opt("--engine"));
  const outArg = opt("--out");
  if (!outArg)
    throw new Error(
      "usage: voice-lines.ts (--bundle <bundle.json> | --say <text>) --engine kokoro|chatterbox --out <folder>",
    );
  const out = resolve(outArg);
  const say = opt("--say");
  const bundle = opt("--bundle");
  const lines = say
    ? [{ key: "say", text: say }]
    : bundleLinesSchema.parse(
        JSON.parse(readFileSync(resolve(bundle ?? ""), "utf8")),
      ).lines;
  const python = opt("--python") ?? process.env.LYCEON_CHATTERBOX_PYTHON;
  const manifest = voiceLines(loadKit(), lines, engine, out, python);
  for (const l of manifest.lines)
    process.stdout.write(
      `${l.key}: ${l.duration.toFixed(2)} s${l.engine_seconds ? `, generated in ${l.engine_seconds.toFixed(1)} s` : ""}${l.problems.length ? `; FAILS: ${l.problems.join("; ")}` : "; passes the quality checks"}\n`,
    );
  if (say)
    process.stdout.write(
      `engine was given: "${manifest.lines[0]?.spoken ?? ""}"\nheard: "${(manifest.lines[0]?.words ?? []).map((w) => w.text).join(" ")}"\n`,
    );
  process.stdout.write(`wrote ${join(out, "voice.json")}\n`);
  if (manifest.lines.some((l) => l.problems.length > 0)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
