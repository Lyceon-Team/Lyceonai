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
        highlight: colour,
        captionText: colour,
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

export const voiceSettingsSchema = z
  .object({
    engine: z.string().min(1),
    hyperframes: z.string().regex(/^\d+\.\d+\.\d+$/),
    voice: z.string().min(1),
    transcribe_model: z.string().min(1),
    gap_seconds: z.number().min(0).max(2),
    end_hold_seconds: z.number().min(0).max(5),
    outro_text: z.string().min(1),
    outro_caption: z.string().min(1),
    outro_file: z.string().endsWith(".wav"),
    music_track: z.string().min(1),
    music_gain: z.number().gt(0).lte(1),
    music_fade_seconds: z.number().min(0),
    min_voice_over_music_db: z.number().positive(),
    min_seconds: z.number().positive(),
    max_seconds: z.number().positive(),
  })
  .strict();
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
    credit: z.string().startsWith("Music: "),
    peak_dbfs: z.number().max(0),
    duration_seconds: z.number().positive(),
  })
  .strict();
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
