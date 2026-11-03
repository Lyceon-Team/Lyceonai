/**
 * Voices one QOTD breakdown script at authoring time and commits the audio with its word timings,
 * as a worked example's batch is voiced.
 *
 * @spec [SCL-266 as ruled by Karl 2026-11-02 on #1398: authored scripts voiced in am_michael;
 *       Step 0 ruling 5 of the worked examples (Karl, 2026-10-27): voice audio committed at batch
 *       time] | @implemented [2026-11-02]
 *
 * plain English: run by the authoring session on its machine:
 *   pnpm exec tsx scripts/qotd-social/voice-breakdown.ts <social checkout>/content/qotd-breakdowns/<week>/<date>
 * reads script.json and writes voice/<line>.wav + voice/manifest.json through the worked examples'
 * voiceScript (hyperframes tts, the "Lyceon" respelling, loudness normalisation, transcription and
 * the quality checks), always in am_michael. A line whose text and voice already match is kept, so
 * editing one step re-voices only that step. Needs HYPERFRAMES_PYTHON (kokoro-onnx, soundfile).
 * The render never voices: it refuses a script whose committed voice no longer matches its text.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { qotdBreakdownScriptSchema } from "../../packages/shared/src/qotd-breakdown-schema";
import { QOTD_BREAKDOWN_VOICE_PROFILE } from "../../shared/qotd/breakdown";
import { loadKit } from "../worked-examples/kit";
import { voiceScript } from "../worked-examples/voice";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write("usage: voice-breakdown.ts <script folder>\n");
    process.exit(2);
  }
  const dir = resolve(target);
  const script = qotdBreakdownScriptSchema.parse(
    JSON.parse(readFileSync(join(dir, "script.json"), "utf8")),
  );
  const manifest = voiceScript(
    loadKit(),
    script,
    QOTD_BREAKDOWN_VOICE_PROFILE,
    join(dir, "voice"),
    [dir],
  );
  const seconds = manifest.lines.reduce((n, l) => n + l.duration, 0);
  process.stdout.write(
    `voiced ${script.qotd_date}: ${manifest.lines.length} lines, ${seconds.toFixed(1)} s of speech\n`,
  );
}
