/**
 * Renders one worked example in two voices side by side, for Karl to compare.
 *
 * @spec [OpenVoice addendum (Karl, 2026-10-27): "Comparison first: render the Percentages example
 *       twice (the clone and the current voice) for Karl to compare. The clone only becomes the
 *       default after Karl picks it."] | @implemented [2026-10-27]
 *
 * plain English, on the batch writer's machine:
 *   pnpm exec tsx scripts/worked-examples/compare-voices.ts --content <checkout of social> \
 *     --dir content/worked-examples/2026-W45/SATM2CZS1BE --out <folder> [--voices af_heart,clone]
 * For each voice it builds a private copy of the content tree (style table, the month's plan and
 * this example), voices the example in that profile (scripts/worked-examples/voice.ts: the clone
 * falls back line by line where it fails the checks), generates the composition from the kit,
 * runs `hyperframes check` and renders <folder>/<id>-<voice>.mp4. It writes <folder>/comparison.md:
 * each video's length and which lines, if any, fell back. Nothing is committed and nothing in the
 * content checkout changes; the reference recording stays where WE_VOICE_REFERENCE points.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workedExampleId } from "../../packages/shared/src/worked-example-schema";
import { CONTENT_DIR, loadExamples } from "./content";
import { generate } from "./generate";
import { loadKit } from "./kit";
import { voiceExample } from "./voice";

/** The lines of a comparison report, one row per voice. */
export function comparisonReport(
  id: string,
  rows: readonly {
    voice: string;
    video: string;
    seconds: number;
    fellBack: readonly string[];
  }[],
): string {
  return [
    `# Voice comparison: ${id}`,
    "",
    "| Voice | Video | Length | Lines in the fallback voice |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.voice} | ${r.video} | ${r.seconds.toFixed(1)} s | ${r.fellBack.length ? r.fellBack.join(", ") : "none"} |`,
    ),
    "",
    "The clone becomes the default only after Karl picks it (voice.json default_profile).",
    "",
  ].join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback?: string): string => {
    const k = args.indexOf(name);
    const v = k === -1 ? fallback : args[k + 1];
    if (!v)
      throw new Error(
        `usage: compare-voices.ts --content <root> --dir <example dir> --out <folder> [--voices a,b] (missing ${name})`,
      );
    return v;
  };
  const kit = loadKit();
  const content = resolve(arg("--content"));
  const dir = arg("--dir");
  const out = resolve(arg("--out"));
  const voices = arg("--voices", `${kit.voice.fallback_profile},clone`).split(
    ",",
  );
  const example = loadExamples(content).find((e) => e.dir === dir);
  if (!example) throw new Error(`no example at ${dir}`);
  const id = workedExampleId(example.content.question_id);
  const rows: {
    voice: string;
    video: string;
    seconds: number;
    fellBack: string[];
  }[] = [];
  for (const voice of voices) {
    const tree = join(out, `tree-${voice}`);
    const month = `${example.content.post_on.slice(0, 7)}-plan`;
    for (const rel of [
      `${CONTENT_DIR}/STYLE.json`,
      `${CONTENT_DIR}/${month}`,
      `${dir}/example.json`,
      `${dir}/voice`,
    ]) {
      if (existsSync(join(content, rel))) {
        mkdirSync(join(tree, rel, ".."), { recursive: true });
        cpSync(join(content, rel), join(tree, rel), { recursive: true });
      }
    }
    const manifest = voiceExample(kit, join(tree, dir), voice);
    const comp = generate(tree, dir, join(out, `composition-${voice}`));
    const video = `${id}-${voice}.mp4`;
    const hf = ["dlx", `hyperframes@${kit.voice.hyperframes}`];
    const env = {
      ...process.env,
      HYPERFRAMES_NO_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
    };
    execFileSync("pnpm", [...hf, "check"], {
      cwd: join(out, `composition-${voice}`),
      stdio: "inherit",
      env,
    });
    execFileSync(
      "pnpm",
      [...hf, "render", "--quality", "delivery", "--output", join(out, video)],
      {
        cwd: join(out, `composition-${voice}`),
        stdio: "inherit",
        env,
      },
    );
    rows.push({
      voice,
      video,
      seconds: comp.duration,
      fellBack: manifest.lines
        .filter((l) => l.voice !== undefined)
        .map((l) => l.key),
    });
  }
  writeFileSync(join(out, "comparison.md"), comparisonReport(id, rows));
  process.stdout.write(comparisonReport(id, rows));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
