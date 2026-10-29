/**
 * Speech quality checks for a voiced line: does it say the script, is it clipped, is it silent.
 *
 * @spec [OpenVoice addendum (Karl, 2026-10-27): "Fallback: the current /brag voice if a clone line
 *       fails the quality checks (transcription mismatch against the script, clipping, silence)"]
 *       | @implemented [2026-10-27]
 *
 * plain English: pure functions over a line's script text, its committed transcription (the words
 * `hyperframes transcribe` heard) and its 16-bit PCM audio.
 *   * Transcription mismatch: both texts are normalised the same way (lower case, numbers and
 *     symbols spelled out, "25%" → "twenty five percent", "$64" → "sixty four dollar", plural "s"
 *     dropped, punctuation and spaces removed) and compared character by character. The character
 *     error rate (edits over the script's length) must not exceed the kit's limit.
 *     Known mishearings of names (Whisper hears "Lyceon" as "Lycian") are listed in voice.json.
 *   * Clipping: no sample at full scale (peak above the kit's max_peak_dbfs).
 *   * Silence: the line must actually speak (peak above the silence threshold), start within
 *     max_lead_silence_seconds, end within max_tail_silence_seconds, and never pause longer than
 *     max_gap_seconds.
 * The same checks run on every committed line in CI (content.ts voiceProblems) and, at batch time,
 * decide whether a clone line is kept or replaced by the fallback voice (voice.ts).
 */
import type { VoiceLine } from "../../packages/shared/src/worked-example-schema";
import { readWavSamples } from "./audio";

export type QualityLimits = {
  max_character_error_rate: number;
  max_peak_dbfs: number;
  silence_threshold_dbfs: number;
  max_lead_silence_seconds: number;
  max_tail_silence_seconds: number;
  max_gap_seconds: number;
};

const ONES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(
  " ",
);

/** 0..999999 in words ("sixty four", "one hundred twenty five"). */
export function integerWords(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)] ?? "";
    return n % 10 === 0 ? t : `${t} ${ONES[n % 10] ?? ""}`;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)] ?? ""} hundred${rest ? ` ${integerWords(rest)}` : ""}`;
  }
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${integerWords(Math.floor(n / 1000))} thousand${rest ? ` ${integerWords(rest)}` : ""}`;
  }
  return String(n);
}

/** "1.25" → "one point two five"; "12" → "twelve". */
function numberWords(token: string): string {
  const [whole, frac] = token.replace(/,/g, "").split(".");
  const head = integerWords(Number(whole ?? "0"));
  return frac
    ? `${head} point ${[...frac].map((d) => ONES[Number(d)] ?? d).join(" ")}`
    : head;
}

/** Text as a list of comparable spoken words. */
export function speechWords(
  text: string,
  aliases: Readonly<Record<string, string>> = {},
): string[] {
  let t = text.toLowerCase();
  for (const [heard, meant] of Object.entries(aliases))
    t = t.split(heard.toLowerCase()).join(` ${meant} `);
  t = t
    .replace(/\$(\d[\d,]*(?:\.\d+)?)/g, " $1 dollar ")
    .replace(/(\d)\s*%/g, "$1 percent ")
    .replace(/×/g, " times ")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1 over $2")
    .replace(/[−–—-]/g, " ")
    .replace(/\d[\d,]*(?:\.\d+)?/g, (m) => ` ${numberWords(m)} `)
    .replace(/[^a-z\s']/g, " ")
    .replace(/'/g, "");
  return t
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) =>
      w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w,
    );
}

/** Edit distance over the reference length (any sequence: words or characters). */
export function errorRate(
  reference: ArrayLike<string>,
  heard: ArrayLike<string>,
): number {
  if (reference.length === 0) return heard.length === 0 ? 0 : 1;
  let prev = Array.from({ length: heard.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i++) {
    const cur = [i];
    for (let j = 1; j <= heard.length; j++) {
      const same = reference[i - 1] === heard[j - 1] ? 0 : 1;
      cur.push(
        Math.min(
          (prev[j] ?? 0) + 1,
          (cur[j - 1] ?? 0) + 1,
          (prev[j - 1] ?? 0) + same,
        ),
      );
    }
    prev = cur;
  }
  return (prev[heard.length] ?? 0) / reference.length;
}

/** Transcription mismatch, or null. */
export function transcriptProblem(
  script: string,
  words: VoiceLine["words"],
  limits: QualityLimits,
  aliases: Readonly<Record<string, string>>,
): string | null {
  // Characters, not words: Whisper writes the letters "J K" as "JK" and "J is" as "jis", which
  // are right audio but wrong word boundaries. Spaces are removed before comparing.
  const said = speechWords(script, aliases).join("");
  const heard = speechWords(words.map((w) => w.text).join(" "), aliases).join(
    "",
  );
  const cer = errorRate(said, heard);
  return cer <= limits.max_character_error_rate
    ? null
    : `transcription mismatch: character error rate ${cer.toFixed(2)} against the script (at most ${limits.max_character_error_rate})`;
}

/** Clipping and silence, from the audio itself. */
export function audioProblems(
  wav: Uint8Array,
  limits: QualityLimits,
): string[] {
  const { samples, sampleRate, peakDbfs } = readWavSamples(wav);
  const out: string[] = [];
  if (peakDbfs > limits.max_peak_dbfs)
    out.push(
      `clipping: peak ${peakDbfs.toFixed(2)} dBFS (at most ${limits.max_peak_dbfs})`,
    );
  const threshold = 10 ** (limits.silence_threshold_dbfs / 20);
  if (!(peakDbfs > limits.silence_threshold_dbfs))
    return [...out, "silence: the line is silent"];
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const loud: boolean[] = [];
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(samples.length, i + frame);
    for (let k = i; k < end; k++) sum += (samples[k] ?? 0) ** 2;
    loud.push(Math.sqrt(sum / (end - i)) > threshold);
  }
  const seconds = (frames: number): number => (frames * frame) / sampleRate;
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (seconds(first) > limits.max_lead_silence_seconds)
    out.push(
      `silence: ${seconds(first).toFixed(2)} s before the first word (at most ${limits.max_lead_silence_seconds})`,
    );
  if (seconds(loud.length - 1 - last) > limits.max_tail_silence_seconds)
    out.push(
      `silence: ${seconds(loud.length - 1 - last).toFixed(2)} s after the last word (at most ${limits.max_tail_silence_seconds})`,
    );
  let gap = 0;
  let longest = 0;
  for (let k = first; k <= last; k++) {
    gap = loud[k] ? 0 : gap + 1;
    longest = Math.max(longest, gap);
  }
  if (seconds(longest) > limits.max_gap_seconds)
    out.push(
      `silence: a ${seconds(longest).toFixed(2)} s pause inside the line (at most ${limits.max_gap_seconds})`,
    );
  return out;
}

/** Every quality problem with one voiced line. Empty means it may be committed. */
export function lineQualityProblems(
  script: string,
  words: VoiceLine["words"],
  wav: Uint8Array,
  limits: QualityLimits,
  aliases: Readonly<Record<string, string>>,
): string[] {
  const t = transcriptProblem(script, words, limits, aliases);
  return [...(t ? [t] : []), ...audioProblems(wav, limits)];
}
