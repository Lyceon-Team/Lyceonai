/**
 * The weekly run's voice stage: every line voiced once in the batch voice and cached by
 * hash(text + voice + settings), so a re-render never calls TTS again.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" items 3 and 5: "each line is voiced
 *       once and cached by hash(text + voice + settings); re-renders never re-call TTS"; the
 *       2026-11-11 answers: the weekly run voices with Chirp 3 HD Charon and caches in the private
 *       social-weekly bucket under voice-cache/ (audio/wav + application/json), superseding Step 0
 *       ruling 5's committed audio for the weekly batch] | @implemented [2026-11-11]
 *
 * plain English: voiceCacheKey hashes everything that changes the audio: the engine, the voice,
 * the speaking rate, the brand pronunciation, the sample rate, the loudness target, the cache
 * version and the exact text. voiceBatch looks each line up in a VoiceStore; a hit is written out
 * as is; a miss is synthesised (one TTS call), normalised, transcribed and checked by `finish`
 * (the worked examples' transcribeAndCheck: says the script, no clipping, no silence), and only a
 * line that passes is stored. It returns the manifest the composition reads (lines without the
 * outro), the outro line, and how many TTS calls it made. Two stores: a folder (tests, dry runs)
 * and the private Supabase bucket (the scheduled run only; the service-role key never leaves it).
 *
 * edge cases: a take that fails the checks is voiced again, up to VOICE_TAKES takes (Chirp's audio
 * differs per call); a line that fails on every take stops the example (nothing cached, the
 * example is refused for the week, the run continues with the others); a cached entry whose metadata does
 * not match its key or text is treated as a miss and re-voiced, never trusted.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  voiceLineSchema,
  voiceManifestSchema,
  voiceWordsSchema,
  type VoiceLine,
  type VoiceManifest,
} from "../../packages/shared/src/worked-example-schema";
import { readWav } from "./audio";
import type { ScriptLine } from "./composition";
import { LYCEON_IPA, TTS_SAMPLE_RATE } from "./google-tts";
import type { LoudnessTarget } from "./voice";

/** Bump to invalidate every cached line (a change to how lines are made). */
export const VOICE_CACHE_VERSION = 1;
export const VOICE_CACHE_PREFIX = "voice-cache";

export type ChirpProfile = {
  engine: "chirp3-hd";
  chirp_voice: string;
  speaking_rate: number;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The cache key: hash(text + voice + settings). */
export function voiceCacheKey(
  profile: ChirpProfile,
  loudness: LoudnessTarget,
  text: string,
): string {
  return sha256(
    JSON.stringify({
      v: VOICE_CACHE_VERSION,
      engine: profile.engine,
      voice: profile.chirp_voice,
      speaking_rate: profile.speaking_rate,
      pronunciation: { Lyceon: LYCEON_IPA },
      sample_rate: TTS_SAMPLE_RATE,
      loudness,
      text,
    }),
  );
}

export const cacheMetaSchema = z
  .object({
    key: z.string().regex(/^[0-9a-f]{64}$/),
    text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    voice: z.string().min(1),
    duration: z.number().positive(),
    words: voiceWordsSchema,
  })
  .strict();
export type CacheMeta = z.infer<typeof cacheMetaSchema>;

export type CachedLine = { wav: Uint8Array; meta: CacheMeta };

export type VoiceStore = {
  get(key: string): Promise<CachedLine | null>;
  put(key: string, line: CachedLine): Promise<void>;
};

/** What `finish` returns for one raw line: the normalised audio, the words heard, the problems. */
export type Finished = {
  audio: Uint8Array;
  words: VoiceLine["words"];
  problems: string[];
};

export type VoiceBatchDeps = {
  profileId: string;
  profile: ChirpProfile;
  loudness: LoudnessTarget;
  store: VoiceStore;
  /** One TTS call: the raw WAV for the text. */
  synth: (text: string) => Promise<Uint8Array>;
  /** Normalise, transcribe and check a raw line (transcribeAndCheck in production). */
  finish: (line: ScriptLine, raw: Uint8Array) => Finished;
  /** Takes per line before it is refused (VOICE_TAKES when absent). */
  takes?: number;
};

/**
 * Takes per line. Chirp 3 HD does not return the same audio twice: in the voice-A run of
 * 2026-11-11, 3 of 69 lines came back with a take defect (an extra syllable in the outro, 0.76 s
 * of leading silence, a dropped opening sentence) that the same text does not have on another
 * call. One take per line would refuse about a third of 9-line examples; three keep the same
 * checks and make a refusal mean the line itself, not one take.
 */
export const VOICE_TAKES = 3;

export type VoiceBatch = {
  manifest: VoiceManifest;
  outro: VoiceLine;
  ttsCalls: number;
  cacheHits: number;
};

function usable(hit: CachedLine | null, key: string, text: string): boolean {
  return (
    hit !== null &&
    hit.meta.key === key &&
    hit.meta.text_sha256 === sha256(text)
  );
}

/**
 * Voices `lines` (the script in spoken order, the outro last) into outDir/<key>.wav through the
 * cache; writes outDir/manifest.json (without the outro) and outDir/outro.json.
 */
export async function voiceBatch(
  lines: readonly ScriptLine[],
  outDir: string,
  deps: VoiceBatchDeps,
): Promise<VoiceBatch> {
  mkdirSync(outDir, { recursive: true });
  let ttsCalls = 0;
  let cacheHits = 0;
  const voiced: VoiceLine[] = [];
  for (const line of lines) {
    const key = voiceCacheKey(deps.profile, deps.loudness, line.text);
    let entry = await deps.store.get(key);
    if (usable(entry, key, line.text)) cacheHits++;
    else {
      const takes = deps.takes ?? VOICE_TAKES;
      let done: Finished | null = null;
      const refusals: string[] = [];
      for (let take = 1; take <= takes && done === null; take++) {
        ttsCalls++;
        const tried = deps.finish(line, await deps.synth(line.text));
        if (tried.problems.length === 0) done = tried;
        else refusals.push(`take ${take}: ${tried.problems.join("; ")}`);
      }
      if (done === null)
        throw new Error(
          `${line.key} fails the quality checks in ${deps.profileId} on every take: ${refusals.join(" | ")}`,
        );
      entry = {
        wav: done.audio,
        meta: cacheMetaSchema.parse({
          key,
          text_sha256: sha256(line.text),
          voice: deps.profileId,
          duration:
            Math.round(readWav(done.audio).durationSeconds * 1000) / 1000,
          words: done.words,
        }),
      };
      await deps.store.put(key, entry);
    }
    if (!entry) throw new Error(`${line.key}: no audio`);
    const file = `${line.key}.wav`;
    writeFileSync(join(outDir, file), entry.wav);
    voiced.push(
      voiceLineSchema.parse({
        key: line.key,
        text_sha256: entry.meta.text_sha256,
        file,
        duration: entry.meta.duration,
        words: entry.meta.words,
      }),
    );
  }
  const outro = voiced.find((l) => l.key === "outro");
  if (!outro) throw new Error("the lines must end with the outro");
  const manifest = voiceManifestSchema.parse({
    voice: deps.profileId,
    speaking_rate: deps.profile.speaking_rate,
    lines: voiced.filter((l) => l.key !== "outro"),
  });
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, "outro.json"),
    `${JSON.stringify(outro, null, 2)}\n`,
  );
  return { manifest, outro, ttsCalls, cacheHits };
}

/** A folder store: <dir>/<key>.wav + <key>.json (tests and dry runs). */
export function dirStore(
  dir: string,
  fs: {
    exists: (p: string) => boolean;
    read: (p: string) => Uint8Array;
    write: (p: string, data: Uint8Array | string) => void;
  },
): VoiceStore {
  return {
    async get(key) {
      const wav = join(dir, `${key}.wav`);
      const meta = join(dir, `${key}.json`);
      if (!fs.exists(wav) || !fs.exists(meta)) return null;
      const parsed = cacheMetaSchema.safeParse(
        JSON.parse(Buffer.from(fs.read(meta)).toString("utf8")),
      );
      return parsed.success ? { wav: fs.read(wav), meta: parsed.data } : null;
    },
    async put(key, line) {
      mkdirSync(dir, { recursive: true });
      fs.write(join(dir, `${key}.wav`), line.wav);
      fs.write(join(dir, `${key}.json`), JSON.stringify(line.meta));
    },
  };
}

/** The slice of supabase-js Storage the cache uses (one bucket). */
export type BucketApi = {
  download(path: string): Promise<{
    data: Blob | null;
    error: { message: string; statusCode?: string } | null;
  }>;
  upload(
    path: string,
    body: Uint8Array | string,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: { message: string } | null }>;
};

function notFound(error: { message: string; statusCode?: string }): boolean {
  return error.statusCode === "404" || /not.?found/i.test(error.message);
}

/** The private bucket store: voice-cache/<key>.wav + <key>.json. */
export function bucketStore(bucket: BucketApi): VoiceStore {
  const path = (key: string, ext: "wav" | "json"): string =>
    `${VOICE_CACHE_PREFIX}/${key}.${ext}`;
  return {
    async get(key) {
      const wav = await bucket.download(path(key, "wav"));
      if (wav.error) {
        if (notFound(wav.error)) return null;
        throw new Error(`voice cache read failed: ${wav.error.message}`);
      }
      const meta = await bucket.download(path(key, "json"));
      if (meta.error) {
        if (notFound(meta.error)) return null;
        throw new Error(`voice cache read failed: ${meta.error.message}`);
      }
      if (!wav.data || !meta.data) return null;
      const parsed = cacheMetaSchema.safeParse(
        JSON.parse(await meta.data.text()),
      );
      if (!parsed.success) return null;
      return {
        wav: new Uint8Array(await wav.data.arrayBuffer()),
        meta: parsed.data,
      };
    },
    async put(key, line) {
      const a = await bucket.upload(path(key, "wav"), line.wav, {
        contentType: "audio/wav",
        upsert: true,
      });
      if (a.error)
        throw new Error(`voice cache write failed: ${a.error.message}`);
      const b = await bucket.upload(
        path(key, "json"),
        JSON.stringify(line.meta),
        { contentType: "application/json", upsert: true },
      );
      if (b.error)
        throw new Error(`voice cache write failed: ${b.error.message}`);
    },
  };
}
