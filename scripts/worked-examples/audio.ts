/**
 * The audio checks: each voice line's length and peak, read from its committed WAV, and the mix
 * rule that keeps the music well under the voice.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "/brag voice plus
 *       the quiet music track … ducked well under the voice", acceptance "audio mix (voice peak
 *       above music by a set dB margin)"] | @implemented [2026-10-27]
 *
 * plain English: the voice lines are 16-bit PCM WAVs (Kokoro via hyperframes tts), parsed here
 * with no dependency. The music track's peak is measured once with ffmpeg and recorded in
 * music/tracks.json; the render job re-measures it and fails if the record is wrong. The margin is
 * the quietest voice line's peak minus the music's peak after its gain: it must be at least
 * voice.json's min_voice_over_music_db.
 */

export type WavInfo = {
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  /** Highest absolute sample, in dB relative to full scale (0 = clipping). */
  peakDbfs: number;
};

/** Reads a canonical PCM WAV (RIFF/WAVE, fmt + data chunks, 16-bit). Throws on anything else. */
export function readWav(buf: Uint8Array): WavInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number): string =>
    String.fromCharCode(
      buf[at] ?? 0,
      buf[at + 1] ?? 0,
      buf[at + 2] ?? 0,
      buf[at + 3] ?? 0,
    );
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  let at = 12;
  let fmt: {
    format: number;
    channels: number;
    rate: number;
    bits: number;
  } | null = null;
  while (at + 8 <= buf.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data chunk before fmt chunk");
      if (fmt.format !== 1 || fmt.bits !== 16)
        throw new Error(
          `unsupported WAV: format ${fmt.format}, ${fmt.bits}-bit`,
        );
      const end = Math.min(body + size, buf.byteLength);
      let peak = 0;
      for (let i = body; i + 1 < end; i += 2) {
        const s = Math.abs(view.getInt16(i, true));
        if (s > peak) peak = s;
      }
      const frames = (end - body) / 2 / fmt.channels;
      return {
        sampleRate: fmt.rate,
        channels: fmt.channels,
        durationSeconds: frames / fmt.rate,
        peakDbfs: peak === 0 ? -Infinity : 20 * Math.log10(peak / 32768),
      };
    }
    at = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

export function gainDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/** The voice-over-music margin, or why it is too small. */
export function mixProblem(
  voicePeaksDbfs: readonly number[],
  musicPeakDbfs: number,
  musicGain: number,
  minMarginDb: number,
): string | null {
  if (voicePeaksDbfs.length === 0) return "no voice lines";
  const quietest = Math.min(...voicePeaksDbfs);
  const music = musicPeakDbfs + gainDb(musicGain);
  const margin = quietest - music;
  return margin >= minMarginDb
    ? null
    : `voice peak ${quietest.toFixed(1)} dBFS is only ${margin.toFixed(1)} dB above the music (${music.toFixed(1)} dBFS after gain ${musicGain}); at least ${minMarginDb} dB required`;
}

/** The music track's recorded peak against a fresh ffmpeg measurement (0.2 dB tolerance). */
export function musicPeakProblem(
  measuredDbfs: number,
  recordedDbfs: number,
): string | null {
  return Math.abs(measuredDbfs - recordedDbfs) <= 0.2
    ? null
    : `music/tracks.json records a peak of ${recordedDbfs} dBFS but the file measures ${measuredDbfs} dBFS: re-measure it`;
}

/** `max_volume: -1.9 dB` from ffmpeg's volumedetect output. */
export function maxVolumeFromFfmpeg(stderr: string): number {
  const m = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
  if (!m?.[1]) throw new Error("ffmpeg volumedetect printed no max_volume");
  return Number(m[1]);
}
