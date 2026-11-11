/**
 * Writes one worked example's Hyperframes project, ready for `hyperframes check` and `render`.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "Every video is
 *       rendered from the templates + the approved content file. Nothing is hand-edited.";
 *       acceptance "30-60 s"] | @implemented [2026-10-27]
 *
 * plain English:
 *   pnpm exec tsx scripts/worked-examples/generate.ts --content <checkout of social> \
 *     --dir content/worked-examples/<week>/<QUESTION_ID> --out <folder>
 * runs every content rule (scripts/worked-examples/content.ts) and refuses on any problem, builds
 * the composition from the kit (scripts/worked-examples/composition.ts), refuses a video outside
 * 30-60 s, and writes <folder>/index.html with the fonts, logo, music, GSAP and the committed voice
 * copied beside it, plus meta.json (scenes, writes, voice clips) for the layout check.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  voiceLineSchema,
  workedExampleId,
  type VoiceLine,
  type WorkedExampleContent,
} from "../../packages/shared/src/worked-example-schema";
import type { SeedQuestion } from "../../shared/worked-examples/seed-question";
import { buildComposition, type Composition } from "./composition";
import { exampleProblems, loadExamples, loadVoice } from "./content";
import { KIT_DIR, ROOT, loadKit, type Kit } from "./kit";

/** The 30-60 s rule (voice.json's bounds), or null. */
export function durationProblem(duration: number, kit: Kit): string | null {
  return duration >= kit.voice.min_seconds && duration <= kit.voice.max_seconds
    ? null
    : `the video lasts ${duration} s; it must be ${kit.voice.min_seconds}-${kit.voice.max_seconds} s`;
}

export function generate(
  contentRoot: string,
  dir: string,
  out: string,
): Composition {
  const kit = loadKit();
  const example = loadExamples(contentRoot).find((e) => e.dir === dir);
  if (!example) throw new Error(`no example at ${dir}`);
  const { problems, question } = exampleProblems(contentRoot, example, kit);
  if (problems.length > 0 || !question)
    throw new Error(`refused:\n  ${problems.join("\n  ")}`);
  const manifest = loadVoice(contentRoot, dir);
  const outro = voiceLineSchema.parse(
    JSON.parse(
      readFileSync(join(ROOT, KIT_DIR, "voice", "outro.json"), "utf8"),
    ),
  );
  return composeExample({
    example: example.content,
    question,
    lines: manifest.lines,
    voiceDir: join(contentRoot, dir, "voice"),
    outro,
    outroWav: join(ROOT, kit.voice.outro_file),
    out,
    kit,
  });
}

/**
 * The layout/timing and composition stage for one example, from any voice: the committed voice
 * (the daily job) or the weekly run's cached batch voice (voice-cache.ts), whose lines and outro
 * sit in one folder. Timing derives from the audio's durations only, so a voice change re-renders
 * without re-scripting (Karl's rulings 2026-11-11, item 5).
 */
export function composeExample(input: {
  example: WorkedExampleContent;
  question: SeedQuestion;
  lines: readonly VoiceLine[];
  voiceDir: string;
  outro: VoiceLine;
  outroWav: string;
  out: string;
  kit: Kit;
}): Composition {
  const comp = buildComposition({
    example: input.example,
    question: input.question,
    voice: [...input.lines],
    outro: input.outro,
    kit: input.kit,
  });
  const tooLong = durationProblem(comp.duration, input.kit);
  if (tooLong) throw new Error(`refused: ${tooLong}`);
  writeCompositionFolder(
    comp,
    input.out,
    workedExampleId(input.example.question_id),
    input.voiceDir,
    input.lines,
    input.outro,
    input.kit,
    input.outroWav,
  );
  return comp;
}

/**
 * Writes a built composition's Hyperframes project: index.html with the fonts, logo, music, GSAP
 * and the voice clips copied beside it, and meta.json (scenes, writes, voice clips) for the
 * layout check. The one writer for every video the kit renders (worked examples and the QOTD
 * breakdown, SCL-266).
 */
export function writeCompositionFolder(
  comp: Composition,
  out: string,
  id: string,
  voiceDir: string,
  lines: readonly VoiceLine[],
  outro: VoiceLine,
  kit: Kit,
  outroWav: string = join(ROOT, kit.voice.outro_file),
): void {
  const put = (from: string, to: string): void => {
    mkdirSync(dirname(join(out, to)), { recursive: true });
    copyFileSync(from, join(out, to));
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), comp.html);
  for (const [to, from] of Object.entries(comp.assets.fonts))
    put(join(ROOT, from), to);
  put(join(ROOT, comp.assets.logo), "assets/lyceon-logo.png");
  put(
    join(ROOT, comp.assets.music),
    `assets/music/${comp.assets.music.slice(comp.assets.music.lastIndexOf("/") + 1)}`,
  );
  put(join(ROOT, comp.assets.gsap), "vendor/gsap.min.js");
  for (const l of lines) put(join(voiceDir, l.file), `assets/voice/${l.file}`);
  put(outroWav, `assets/voice/${outro.file}`);
  writeFileSync(
    join(out, "meta.json"),
    `${JSON.stringify({ id, duration: comp.duration, scenes: comp.scenes, writes: comp.writes, voice: comp.voice.map(({ key, start, duration }) => ({ key, start, duration })) }, null, 2)}\n`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (name: string): string => {
    const k = args.indexOf(name);
    const v = k === -1 ? undefined : args[k + 1];
    if (!v)
      throw new Error(
        `usage: generate.ts --content <root> --dir <example dir> --out <folder> (missing ${name})`,
      );
    return v;
  };
  const comp = generate(
    resolve(arg("--content")),
    arg("--dir"),
    resolve(arg("--out")),
  );
  process.stdout.write(
    `generated ${arg("--out")}/index.html (${comp.duration} s)\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (err: unknown) {
    process.stderr.write(
      `generate: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
