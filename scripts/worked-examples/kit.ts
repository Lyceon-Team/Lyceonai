/**
 * The worked-example asset kit (video-kit/worked-examples/): its manifests, read and checked.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "Asset kit,
 *       committed under one folder: blank paper, Caveat + OFL, Lyceon fonts and colours, templates
 *       (hook card, question card, step reveal, answer reveal, trap callout, end card), voice
 *       settings, music + licence files. Every video is rendered from the templates + the approved
 *       content file. Nothing is hand-edited."; Karl's pick (2026-10-27): Hyperframes, music
 *       happy-beats-business-moves-vol-12, credited in the share copy as /brag does]
 *       | @implemented [2026-10-27]
 *
 * plain English: brand.json (colours and the font files, the Poppins and Inter ones shared with
 * the site from client/public/fonts), voice.json (Kokoro voice, gap between lines, the end card's
 * line, the music gain and the minimum voice-over-music margin, the 30-60 s bounds),
 * music/tracks.json (each track's file, credit, licence file and measured peak) and the
 * templates/*.html fragments. loadKit parses all of it; a malformed kit fails the run.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const KIT_DIR = "video-kit/worked-examples";

export const KIT_TEMPLATES = [
  "frame",
  "hook-card",
  "question-card",
  "step-reveal",
  "answer-reveal",
  "trap-callout",
  "end-card",
] as const;
export type KitTemplate = (typeof KIT_TEMPLATES)[number];

const colour = z.string().regex(/^(#[0-9A-Fa-f]{6}|rgba\([\d.,\s]+\))$/);

export const brandSchema = z
  .object({
    colours: z
      .object({
        paper: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        ink: colour,
        inkSoft: colour,
        border: colour,
        red: colour,
      })
      .strict(),
    fonts: z.record(
      z.string().regex(/^(Caveat|Poppins|Inter)(-\d{3})?$/),
      z
        .object({
          file: z.string().endsWith(".woff2"),
          weight: z.string().min(1),
          licence: z.string().min(1),
        })
        .strict(),
    ),
    logo: z.string().endsWith(".png"),
    gsap: z.string().endsWith(".js"),
  })
  .strict();
export type Brand = z.infer<typeof brandSchema>;

/**
 * A voice the batch tooling can speak with. kokoro is the /brag voice (hyperframes tts); openvoice-v2
 * is a clone of a reference speaker (OpenVoice addendum, Karl, 2026-10-27): a MeloTTS base speaker
 * whose tone colour is converted to the reference's, run on the batch writer's machine only.
 * speaking_rate (Karl, 2026-10-27, after finding the stand-in clone slow) multiplies the engine's
 * natural pace: 1.0 is natural, 1.1 about 10% faster. kokoro takes it as `hyperframes tts -s`,
 * the clone as MeloTTS's `speed`; the tone-colour conversion keeps the timing it is given.
 */
const speakingRate = z.number().min(0.5).max(2);

export const voiceProfileSchema = z.discriminatedUnion("engine", [
  z
    .object({
      engine: z.literal("kokoro"),
      kokoro_voice: z.string().min(1),
      label: z.string().min(1),
      speaking_rate: speakingRate,
    })
    .strict(),
  /**
   * Chirp 3 HD on Cloud Text-to-Speech (Karl's pick from the 2026-11-11 blind bake-off: voice C,
   * Charon). Voiced only by the weekly run through lyceon-ci-eval and cached per line
   * (voice-cache.ts); never on an authoring machine.
   */
  z
    .object({
      engine: z.literal("chirp3-hd"),
      chirp_voice: z.string().regex(/^[A-Z][a-z]+$/),
      label: z.string().min(1),
      speaking_rate: speakingRate,
    })
    .strict(),
  z
    .object({
      engine: z.literal("openvoice-v2"),
      label: z.string().min(1),
      base_language: z.string().min(1),
      base_speaker: z.string().min(1),
      tau: z.number().gt(0).lte(1),
      speaking_rate: speakingRate,
    })
    .strict(),
]);
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const voiceSettingsSchema = z
  .object({
    hyperframes: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** The voice a batch is spoken in unless --voice says otherwise. */
    default_profile: z.string().min(1),
    /** The voice a line falls back to when a clone line fails the quality checks. */
    fallback_profile: z.string().min(1),
    /**
     * The voice the weekly batch is spoken in (Karl's rulings 2026-11-11, weekly video pipeline
     * v2: Chirp 3 HD Charon, voiced and cached by the weekly run). default_profile stays the
     * voice of the local tools (the pilots, the breakdown scripts, compare-voices).
     */
    batch_profile: z.string().min(1),
    profiles: z.record(z.string().regex(/^[a-z0-9_-]+$/), voiceProfileSchema),
    quality: z
      .object({
        max_character_error_rate: z.number().gt(0).lt(1),
        max_peak_dbfs: z.number().max(0),
        silence_threshold_dbfs: z.number().lt(0),
        max_lead_silence_seconds: z.number().positive(),
        max_tail_silence_seconds: z.number().positive(),
        max_gap_seconds: z.number().positive(),
      })
      .strict(),
    /**
     * Loudness normalisation applied to every voiced line before it is transcribed and checked
     * (SCL-267, Karl's ruling 2026-11-02: "no line clips"): ffmpeg loudnorm to integrated_lufs
     * with true peak at most true_peak_dbtp, then alimiter 0.5 dB under it as a backstop.
     */
    loudness: z
      .object({
        integrated_lufs: z.number().min(-30).max(-5),
        true_peak_dbtp: z.number().min(-9).max(-0.5),
        loudness_range_lu: z.number().min(1).max(20),
      })
      .strict(),
    /**
     * The finished mix (voice and music bed, as rendered) is limited to at most
     * max_true_peak_dbtp before any check or post (Karl's ruling 2026-11-02, SCL-270: "a
     * true-peak limiter (≤ −1 dBTP) on the finished mix in every pipeline"); final-mix.ts
     * re-encodes the audio as AAC at aac_bitrate_kbps.
     */
    final_mix: z
      .object({
        max_true_peak_dbtp: z.number().min(-9).max(-1),
        aac_bitrate_kbps: z.number().int().min(128).max(320),
      })
      .strict(),
    /** Known mishearings of names by the transcriber, mapped to what was said. */
    transcript_aliases: z.record(z.string().min(1), z.string().min(1)),
    transcribe_model: z.string().min(1),
    gap_seconds: z.number().min(0).max(2),
    end_hold_seconds: z.number().min(0).max(5),
    /** The call to action the end card speaks (SCL-267: no "lyceon.ai" spoken). */
    outro_text: z.string().min(1),
    /**
     * The same call to action as written, for reviewers and the runbook. Nothing renders it since
     * the burned-in captions were removed (SCL-267, Karl's ruling 2026-11-02).
     */
    outro_caption: z.string().min(1),
    outro_file: z.string().endsWith(".wav"),
    music_track: z.string().min(1),
    music_gain: z.number().gt(0).lte(1),
    music_fade_seconds: z.number().min(0),
    min_voice_over_music_db: z.number().positive(),
    min_seconds: z.number().positive(),
    max_seconds: z.number().positive(),
  })
  .strict()
  .refine(
    (v) =>
      v.profiles[v.default_profile] !== undefined &&
      v.profiles[v.default_profile]?.engine !== "chirp3-hd" &&
      v.profiles[v.fallback_profile]?.engine === "kokoro" &&
      v.profiles[v.batch_profile]?.engine === "chirp3-hd",
    {
      message:
        "default_profile must be a local profile (not chirp3-hd), fallback_profile a kokoro profile, and batch_profile a chirp3-hd profile",
    },
  );
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const trackSchema = z
  .object({
    file: z.string().endsWith(".mp3"),
    title: z.string().min(1),
    artist: z.string().min(1),
    source: z.string().url(),
    licence: z.string().min(1),
    licence_url: z.string().url(),
    licence_file: z.string().min(1),
    /**
     * Whether the licence requires a credit (CC BY does; CC0 does not). Karl's ruling
     * 2026-11-04: the credit is on the video's end card, never in a caption and never spoken.
     */
    attribution_required: z.boolean(),
    /** The end card's credit line, or null for a track that needs none (then none is shown). */
    on_screen_credit: z.string().startsWith("Music: ").nullable(),
    peak_dbfs: z.number().max(0),
    duration_seconds: z.number().positive(),
  })
  .strict()
  .refine((t) => t.attribution_required === (t.on_screen_credit !== null), {
    message:
      "on_screen_credit is set exactly when the licence requires attribution",
  })
  .refine((t) => !/^CC BY\b/.test(t.licence) || t.attribution_required, {
    message: "a CC BY licence requires attribution",
  });
export type Track = z.infer<typeof trackSchema>;
export const tracksSchema = z.record(z.string().min(1), trackSchema);

export type Kit = {
  brand: Brand;
  voice: VoiceSettings;
  track: Track;
  css: string;
  templates: Record<KitTemplate, string>;
};

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

export function loadKit(): Kit {
  const brand = brandSchema.parse(JSON.parse(read(`${KIT_DIR}/brand.json`)));
  const voice = voiceSettingsSchema.parse(
    JSON.parse(read(`${KIT_DIR}/voice.json`)),
  );
  const tracks = tracksSchema.parse(
    JSON.parse(read(`${KIT_DIR}/music/tracks.json`)),
  );
  const track = tracks[voice.music_track];
  if (!track)
    throw new Error(
      `voice.json names music track ${voice.music_track}, which tracks.json lacks`,
    );
  const templates = Object.fromEntries(
    KIT_TEMPLATES.map((t) => [t, read(`${KIT_DIR}/templates/${t}.html`)]),
  ) as Record<KitTemplate, string>;
  return {
    brand,
    voice,
    track,
    css: read(`${KIT_DIR}/templates/kit.css`),
    templates,
  };
}

/** Fills {{name}} slots. Every slot must be given and every value used: no silent blanks. */
export function fill(template: string, values: Record<string, string>): string {
  const used = new Set<string>();
  const out = template.replace(/\{\{([A-Za-z]+)\}\}/g, (_, name: string) => {
    const v = values[name];
    if (v === undefined)
      throw new Error(`template slot {{${name}}} has no value`);
    used.add(name);
    return v;
  });
  const unused = Object.keys(values).filter((k) => !used.has(k));
  if (unused.length > 0)
    throw new Error(`template has no slot for ${unused.join(", ")}`);
  return out;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
