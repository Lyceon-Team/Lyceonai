/**
 * Voices a worked example at batch time and commits the audio with its word timings.
 *
 * @spec [Step 0 ruling 5 (Karl, 2026-10-27): voice audio committed at batch time; owner brief
 *       "Worked examples: production system" (Karl, 2026-10-27): "/brag voice"; OpenVoice addendum
 *       (Karl, 2026-10-27): OpenVoice V2 clone of a reference speaker, generated at batch-writing
 *       time, reference never committed, fallback to the /brag voice for any clone line that fails
 *       the quality checks, the clone the default only after Karl picks it] | @implemented [2026-10-27]
 *
 * plain English: run by the person writing the weekly batch, on their machine, never in CI:
 *   pnpm exec tsx scripts/worked-examples/voice.ts <example folder> [--voice <profile>] [--out <dir>]
 *   pnpm exec tsx scripts/worked-examples/voice.ts --kit [--voice <profile>]   (the end card's line)
 * The profile comes from video-kit/worked-examples/voice.json (default_profile unless --voice):
 *   * kokoro (af_heart, the /brag voice): `hyperframes tts`. Needs HYPERFRAMES_PYTHON pointing at a
 *     Python with kokoro-onnx and soundfile.
 *   * openvoice-v2 (the clone): scripts/worked-examples/openvoice/clone_line.py, run with
 *     WE_OPENVOICE_PYTHON (a local environment built from openvoice/requirements.txt), the reference
 *     recording at WE_VOICE_REFERENCE (a private path OUTSIDE the repository; refused otherwise),
 *     the V2 checkpoints at WE_OPENVOICE_CHECKPOINTS and an embedding cache at WE_OPENVOICE_CACHE
 *     (default ~/.cache/lyceon-openvoice).
 * Every line is transcribed (`hyperframes transcribe`) and checked (quality.ts: says the script, no
 * clipping, no silence). A clone line that fails, or that the clone could not produce, is spoken
 * again in the fallback voice and recorded as such in the manifest (`voice`, `fallback_reasons`).
 * A line in the fallback voice that fails the checks stops the run: nothing is written for it.
 * A line whose text hash, voice and speaking rate already match is left alone, so editing one step
 * re-voices only that step; changing a profile's speaking_rate re-voices the batch. --out writes the voice folder somewhere else (the comparison render uses it).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  voiceWordsSchema,
  voiceManifestSchema,
  workedExampleContentSchema,
  type VoiceLine,
  type VoiceManifest,
} from "../../packages/shared/src/worked-example-schema";
import { readWav } from "./audio";
import { scriptLines, type ScriptLine } from "./composition";
import { sha256 } from "./content";
import {
  KIT_DIR,
  ROOT,
  loadKit,
  type Kit,
  type VoiceProfile,
  type VoiceSettings,
} from "./kit";
import { lineQualityProblems } from "./quality";

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
  return voiceWordsSchema.parse(
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

/**
 * Why a reference recording may not be used, or null. It must be set, exist, and live outside
 * every directory that could be committed (the repository and the content checkout), so it can
 * never be added by accident (OpenVoice addendum: "Never commit the reference audio").
 */
export function referenceProblem(
  path: string | undefined,
  guarded: readonly string[],
): string | null {
  if (!path)
    return "WE_VOICE_REFERENCE is not set (the private path of the reference recording)";
  if (!isAbsolute(path)) return "WE_VOICE_REFERENCE must be an absolute path";
  if (!existsSync(path)) return `WE_VOICE_REFERENCE does not exist: ${path}`;
  const real = realpathSync(path);
  for (const dir of guarded) {
    const root = existsSync(dir) ? realpathSync(dir) : resolve(dir);
    const rel = relative(root, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
      return `the reference recording is inside ${root}; keep it outside every repository checkout`;
  }
  return null;
}

/** A clone attempt's outcome. */
export type CloneOutcome =
  | { ok: true; problems: string[] }
  | { ok: false; error: string };

/** Keep the clone line only when it was produced and passed every check. */
export function decideLine(
  outcome: CloneOutcome,
): { use: "clone" } | { use: "fallback"; reasons: string[] } {
  if (!outcome.ok)
    return {
      use: "fallback",
      reasons: [`the clone did not produce the line: ${outcome.error}`],
    };
  return outcome.problems.length === 0
    ? { use: "clone" }
    : { use: "fallback", reasons: outcome.problems };
}

type Spoken = {
  audio: Uint8Array;
  words: VoiceLine["words"];
  problems: string[];
};

function transcribeAndCheck(
  v: VoiceSettings,
  line: ScriptLine,
  wavPath: string,
  work: string,
): Spoken {
  const words = wordsFromTranscribe(
    hyperframes(
      v,
      ["transcribe", wavPath, "--json", "-m", v.transcribe_model],
      work,
    ),
    (path) => readFileSync(path, "utf8"),
  );
  const audio = readFileSync(wavPath);
  return {
    audio,
    words,
    problems: lineQualityProblems(
      line.text,
      words,
      audio,
      v.quality,
      v.transcript_aliases,
    ),
  };
}

/** The `hyperframes tts` arguments for one kokoro line, at the profile's speaking rate. */
export function kokoroTtsArgs(
  profile: VoiceProfile & { engine: "kokoro" },
  text: string,
  wav: string,
): string[] {
  return [
    "tts",
    text,
    "-v",
    profile.kokoro_voice,
    "-s",
    String(profile.speaking_rate),
    "-o",
    wav,
  ];
}

/**
 * Whether an earlier manifest's lines can be kept: same profile and same speaking rate (a manifest
 * from before the setting existed was spoken at 1.0). A rate change re-voices every line.
 */
export function keepsEarlierVoicing(
  previous: VoiceManifest | null,
  profileId: string,
  speakingRate: number,
): boolean {
  return (
    previous !== null &&
    previous.voice === profileId &&
    (previous.speaking_rate ?? 1) === speakingRate
  );
}

function speakKokoro(
  v: VoiceSettings,
  profile: VoiceProfile & { engine: "kokoro" },
  line: ScriptLine,
): Spoken {
  const work = mkdtempSync(join(tmpdir(), "we-voice-"));
  const wav = join(work, `${line.key}.wav`);
  hyperframes(v, kokoroTtsArgs(profile, line.text, wav), work);
  return transcribeAndCheck(v, line, wav, work);
}

function speakClone(
  v: VoiceSettings,
  profile: VoiceProfile & { engine: "openvoice-v2" },
  line: ScriptLine,
  reference: string,
): { ok: true; spoken: Spoken } | { ok: false; error: string } {
  const python = process.env.WE_OPENVOICE_PYTHON;
  const checkpoints = process.env.WE_OPENVOICE_CHECKPOINTS;
  if (!python || !checkpoints)
    throw new Error(
      "the clone needs WE_OPENVOICE_PYTHON and WE_OPENVOICE_CHECKPOINTS (runbook)",
    );
  const work = mkdtempSync(join(tmpdir(), "we-clone-"));
  const wav = join(work, `${line.key}.wav`);
  const run = spawnSync(
    python,
    [
      join(ROOT, "scripts/worked-examples/openvoice/clone_line.py"),
      "--text",
      line.text,
      "--out",
      wav,
      "--reference",
      reference,
      "--checkpoints",
      checkpoints,
      "--cache",
      process.env.WE_OPENVOICE_CACHE ??
        join(homedir(), ".cache", "lyceon-openvoice"),
      "--language",
      profile.base_language,
      "--speaker",
      profile.base_speaker,
      "--tau",
      String(profile.tau),
      "--speed",
      String(profile.speaking_rate),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const last = (run.stdout ?? "").trim().split("\n").pop() ?? "";
  if (run.status !== 0 || !existsSync(wav))
    return {
      ok: false,
      error: last.includes("error")
        ? last
        : `clone_line.py exited ${run.status}`,
    };
  return { ok: true, spoken: transcribeAndCheck(v, line, wav, work) };
}

/** One line in the requested profile, falling back per line when the clone fails its checks. */
function voiceLine(
  v: VoiceSettings,
  profileId: string,
  line: ScriptLine,
  outDir: string,
  reference: string | null,
): VoiceLine {
  const profile = v.profiles[profileId];
  const fallback = v.profiles[v.fallback_profile];
  if (!profile) throw new Error(`no voice profile ${profileId} in voice.json`);
  if (!fallback || fallback.engine !== "kokoro")
    throw new Error("the fallback voice must be a kokoro profile");
  let spoken: Spoken;
  let fellBack: string[] | null = null;
  if (profile.engine === "openvoice-v2") {
    if (!reference) throw new Error("the clone needs a reference recording");
    const attempt = speakClone(v, profile, line, reference);
    const decision = decideLine(
      attempt.ok ? { ok: true, problems: attempt.spoken.problems } : attempt,
    );
    if (decision.use === "clone" && attempt.ok) spoken = attempt.spoken;
    else {
      fellBack = decision.use === "fallback" ? decision.reasons : ["unknown"];
      process.stdout.write(
        `  ${line.key}: clone failed (${fellBack.join("; ")}); using ${v.fallback_profile}\n`,
      );
      spoken = speakKokoro(v, fallback, line);
    }
  } else spoken = speakKokoro(v, profile, line);
  if (spoken.problems.length > 0)
    throw new Error(
      `${line.key} fails the quality checks in ${fellBack ? v.fallback_profile : profileId}: ${spoken.problems.join("; ")}`,
    );
  const file = `${line.key}.wav`;
  writeFileSync(join(outDir, file), spoken.audio);
  return {
    key: line.key,
    text_sha256: sha256(line.text),
    file,
    duration: Math.round(readWav(spoken.audio).durationSeconds * 1000) / 1000,
    words: spoken.words,
    ...(fellBack
      ? { voice: v.fallback_profile, fallback_reasons: fellBack }
      : {}),
  };
}

/** The git checkout a path belongs to (the content checkout of `social`, say), or null. */
function checkoutRoot(path: string): string | null {
  const run = spawnSync(
    "git",
    [
      "-C",
      existsSync(path) ? path : resolve(path, ".."),
      "rev-parse",
      "--show-toplevel",
    ],
    {
      encoding: "utf8",
    },
  );
  return run.status === 0 ? run.stdout.trim() : null;
}

/** The reference recording to clone from, or null for a kokoro profile. Throws on a guarded path. */
export function referenceFor(
  kit: Kit,
  profileId: string,
  guarded: readonly string[],
): string | null {
  const profile = kit.voice.profiles[profileId];
  if (!profile) throw new Error(`no voice profile ${profileId} in voice.json`);
  if (profile.engine !== "openvoice-v2") return null;
  const roots = [
    ROOT,
    ...guarded,
    ...guarded.map(checkoutRoot).filter((r): r is string => r !== null),
  ];
  const problem = referenceProblem(process.env.WE_VOICE_REFERENCE, roots);
  if (problem) throw new Error(problem);
  return process.env.WE_VOICE_REFERENCE ?? null;
}

/** Voices one example folder in a profile into outDir (default <dir>/voice); returns the manifest. */
export function voiceExample(
  kit: Kit,
  dir: string,
  profileId: string,
  outDir: string = join(dir, "voice"),
): VoiceManifest {
  const reference = referenceFor(kit, profileId, [dir, outDir]);
  const example = workedExampleContentSchema.parse(
    JSON.parse(readFileSync(join(dir, "example.json"), "utf8")),
  );
  mkdirSync(outDir, { recursive: true });
  const manifestFile = join(outDir, "manifest.json");
  const previous: VoiceManifest | null = existsSync(manifestFile)
    ? voiceManifestSchema.parse(JSON.parse(readFileSync(manifestFile, "utf8")))
    : null;
  const profile = kit.voice.profiles[profileId];
  if (!profile) throw new Error(`no voice profile ${profileId} in voice.json`);
  const keep = keepsEarlierVoicing(previous, profileId, profile.speaking_rate);
  const lines = scriptLines(example, kit.voice.outro_text)
    .filter((s) => s.key !== "outro")
    .map((s) => {
      const kept =
        keep && previous
          ? previous.lines.find(
              (l) =>
                l.key === s.key &&
                l.text_sha256 === sha256(s.text) &&
                existsSync(join(outDir, l.file)),
            )
          : undefined;
      if (kept) return kept;
      process.stdout.write(`voicing ${s.key} (${profileId})\n`);
      return voiceLine(kit.voice, profileId, s, outDir, reference);
    });
  const manifest = voiceManifestSchema.parse({
    voice: profileId,
    speaking_rate: profile.speaking_rate,
    lines,
  });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main(): void {
  const kit = loadKit();
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const k = args.indexOf(name);
    return k === -1 ? undefined : args[k + 1];
  };
  const target = args[0];
  if (!target)
    throw new Error(
      "usage: voice.ts <example folder> | --kit  [--voice <profile>] [--out <dir>]",
    );
  const profileId = opt("--voice") ?? kit.voice.default_profile;
  if (target === "--kit") {
    const reference = referenceFor(kit, profileId, []);
    const outDir = join(ROOT, KIT_DIR, "voice");
    const line = voiceLine(
      kit.voice,
      profileId,
      { key: "outro", text: kit.voice.outro_text },
      outDir,
      reference,
    );
    writeFileSync(
      join(outDir, "outro.json"),
      `${JSON.stringify(line, null, 2)}\n`,
    );
    process.stdout.write(`voiced the end card (${line.duration} s)\n`);
    return;
  }
  const dir = resolve(target);
  const outDir = resolve(opt("--out") ?? join(dir, "voice"));
  const manifest = voiceExample(kit, dir, profileId, outDir);
  const fell = manifest.lines
    .filter((l) => l.voice !== undefined)
    .map((l) => l.key);
  process.stdout.write(
    `wrote ${join(outDir, "manifest.json")}${fell.length ? ` (fell back: ${fell.join(", ")})` : ""}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
