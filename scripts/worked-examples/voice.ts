/**
 * Voices a worked example at batch time and commits the audio with its word timings.
 *
 * @spec [Step 0 ruling 5 (Karl, 2026-10-27): voice audio committed at batch time; owner brief
 *       "Worked examples: production system" (Karl, 2026-10-27): "/brag voice"]
 *       | @implemented [2026-10-27]
 *
 * plain English: run by the person writing the weekly batch, on their machine, never in CI:
 *   pnpm exec tsx scripts/worked-examples/voice.ts content/worked-examples/<week>/<QUESTION_ID>
 *   pnpm exec tsx scripts/worked-examples/voice.ts --kit      (the end card's line, once)
 * For each spoken line it runs `hyperframes tts` with the kit's voice (Kokoro af_heart, the /brag
 * voice) and `hyperframes transcribe` for the word times, and writes voice/<line>.wav plus
 * voice/manifest.json (each line's text hash, length and words). A line whose text hash already
 * matches is left alone, so editing one step re-voices only that step. `hyperframes tts` needs
 * HYPERFRAMES_PYTHON pointing at a Python with kokoro-onnx and soundfile (runbook).
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  voiceLineSchema,
  voiceManifestSchema,
  workedExampleContentSchema,
  type VoiceLine,
  type VoiceManifest,
} from "../../packages/shared/src/worked-example-schema";
import { readWav } from "./audio";
import { scriptLines, type ScriptLine } from "./composition";
import { sha256 } from "./content";
import { KIT_DIR, ROOT, loadKit, type VoiceSettings } from "./kit";

function hyperframes(v: VoiceSettings, args: string[], cwd: string): string {
  return execFileSync(
    "pnpm",
    ["dlx", `hyperframes@${v.hyperframes}`, ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/**
 * The word times `hyperframes transcribe --json` wrote: its last stdout line names transcriptPath,
 * a JSON array of {text, start, end, id}. (The progress events on stderr carry rougher times.)
 */
export function wordsFromTranscribe(
  stdout: string,
  readFile: (path: string) => string,
): VoiceLine["words"] {
  const last = stdout.trim().split("\n").pop() ?? "";
  const result: unknown = JSON.parse(last);
  if (
    typeof result !== "object" ||
    result === null ||
    !("transcriptPath" in result) ||
    typeof result.transcriptPath !== "string"
  )
    throw new Error("transcribe did not name a transcript");
  const raw: unknown = JSON.parse(readFile(result.transcriptPath));
  if (!Array.isArray(raw))
    throw new Error("the transcript is not a list of words");
  return voiceLineSchema.shape.words.parse(
    raw.map((w: unknown) => {
      const o = typeof w === "object" && w !== null ? w : {};
      return {
        text: "text" in o ? o.text : undefined,
        start: "start" in o ? o.start : undefined,
        end: "end" in o ? o.end : undefined,
      };
    }),
  );
}

function voiceLine(
  v: VoiceSettings,
  line: ScriptLine,
  outDir: string,
): VoiceLine {
  const file = `${line.key}.wav`;
  const work = mkdtempSync(join(tmpdir(), "we-voice-"));
  hyperframes(
    v,
    ["tts", line.text, "-v", v.voice, "-o", join(work, file)],
    work,
  );
  const words = wordsFromTranscribe(
    hyperframes(
      v,
      ["transcribe", join(work, file), "--json", "-m", v.transcribe_model],
      work,
    ),
    (path) => readFileSync(path, "utf8"),
  );
  const audio = readFileSync(join(work, file));
  writeFileSync(join(outDir, file), audio);
  return {
    key: line.key,
    text_sha256: sha256(line.text),
    file,
    duration: Math.round(readWav(audio).durationSeconds * 1000) / 1000,
    words,
  };
}

function main(): void {
  const kit = loadKit();
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: voice.ts <example folder> | --kit");
  if (arg === "--kit") {
    const outDir = join(ROOT, KIT_DIR, "voice");
    const line = voiceLine(
      kit.voice,
      { key: "outro", text: kit.voice.outro_text },
      outDir,
    );
    writeFileSync(
      join(outDir, "outro.json"),
      `${JSON.stringify(line, null, 2)}\n`,
    );
    process.stdout.write(`voiced the end card (${line.duration} s)\n`);
    return;
  }
  const dir = resolve(arg);
  const example = workedExampleContentSchema.parse(
    JSON.parse(readFileSync(join(dir, "example.json"), "utf8")),
  );
  const outDir = join(dir, "voice");
  mkdirSync(outDir, { recursive: true });
  const manifestFile = join(outDir, "manifest.json");
  const previous: VoiceManifest | null = existsSync(manifestFile)
    ? voiceManifestSchema.parse(JSON.parse(readFileSync(manifestFile, "utf8")))
    : null;
  const lines = scriptLines(example, kit.voice.outro_text)
    .filter((s) => s.key !== "outro")
    .map((s) => {
      const kept =
        previous?.voice === kit.voice.voice
          ? previous.lines.find(
              (l) =>
                l.key === s.key &&
                l.text_sha256 === sha256(s.text) &&
                existsSync(join(outDir, l.file)),
            )
          : undefined;
      if (kept) return kept;
      process.stdout.write(`voicing ${s.key}\n`);
      return voiceLine(kit.voice, s, outDir);
    });
  const manifest: VoiceManifest = { voice: kit.voice.voice, lines };
  writeFileSync(
    manifestFile,
    `${JSON.stringify(voiceManifestSchema.parse(manifest), null, 2)}\n`,
  );
  process.stdout.write(`wrote ${manifestFile}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
