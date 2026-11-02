/**
 * Video pilot (Manim): checks a pilot worked example against its bank question and the worked-
 * example rules, then writes the bundle the Manim scene renders from.
 *
 * @spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 3: "one geometry or
 *       graph worked example, 1080×1920, voiced in the current voice"; the question from the seed
 *       SQL with its stored A-D order and key; the worked-example script shape and rules (hook
 *       H1-H6, steps, answer, trap); brand colours and fonts; safe area x 71..912, y 154..1555;
 *       the same outro line and music. Owner brief "Worked examples: production system" (Karl,
 *       2026-10-27); Public Disclosure Doctrine §0 rules 1-3 (docs/plans/seo/seo-marketing-vertical.md)]
 *       | @implemented [2026-11-02]
 *
 * plain English:
 *   pnpm exec tsx scripts/video-pilots/manim/prepare.ts \
 *     --example video-kit/pilots/manim/SATM2BVZSMV/example.json --out <folder outside the repo>
 * reads the pilot's example.json (the same schema as a weekly batch's), reads its question from
 * the seed SQL that created it (scripts/worked-examples/content.ts seedQuestion, which refuses a
 * question a seed patch changes), and runs the worked-example content checks on it
 * (shared/worked-examples/rules.ts contentProblems: hook H1-H6, the key, "The trap", the public-copy
 * lists on every spoken line). Any problem stops the run. It then writes <out>/bundle.json: the
 * question as plain text in the bank's A-D order with its key, every spoken line in screen order
 * (scriptLines, the end card's line from voice.json), and the kit's colours, fonts, logo, music,
 * line gap, end hold and safe area, so the Python scene never re-reads or re-states any of them.
 *
 * trade-offs: the pilot is not in a monthly plan and Circles has no row in the social branch's
 * STYLE.json, so the style-row check is run against the pilot's own signature move (it cannot
 * fail) and the plan-slot check is not run. post_on is a placeholder the schema requires; the
 * pilot is not scheduled. Nothing here touches a database.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workedExampleContentSchema } from "../../../packages/shared/src/worked-example-schema";
import { plainMathText } from "../../../shared/qotd/plain-math";
import { isoWeekCycle } from "../../../shared/content/schedule";
import {
  TRAP_HEADING,
  contentProblems,
} from "../../../shared/worked-examples/rules";
import {
  CAPTION_MAX_WORDS,
  safeArea,
  scriptLines,
} from "../../worked-examples/composition";
import { seedQuestion } from "../../worked-examples/content";
import { KIT_DIR, ROOT, loadKit } from "../../worked-examples/kit";

/** The worked examples already in use (W45/W46); a pilot must use another question. */
export const PILOT_EXCLUDED_IDS: readonly string[] = [
  "SATM2CZS1BE",
  "SATM22FTOBG",
  "SATM21O38CM",
  "SATM2B7W3IM",
  "SATM26X8W2L",
  "SATM2PRBTJX",
];

function main(): void {
  const args = process.argv.slice(2);
  const opt = (name: string): string => {
    const k = args.indexOf(name);
    const v = k === -1 ? undefined : args[k + 1];
    if (!v)
      throw new Error(
        `usage: prepare.ts --example <example.json> --out <folder> (missing ${name})`,
      );
    return v;
  };
  const examplePath = resolve(opt("--example"));
  const out = resolve(opt("--out"));
  const example = workedExampleContentSchema.parse(
    JSON.parse(readFileSync(examplePath, "utf8")),
  );
  if (PILOT_EXCLUDED_IDS.includes(example.question_id))
    throw new Error(
      `${example.question_id} is a W45/W46 worked example; the pilot uses another question`,
    );
  const found = seedQuestion(example.question_id);
  if (!found.ok) throw new Error(found.problem);
  const q = found.question;
  if (q.section !== "M") throw new Error(`${q.id} is not a Math question`);
  const kit = loadKit();
  const problems = contentProblems(example, q, isoWeekCycle(example.post_on), {
    [example.skill_code]: {
      signature_move: example.signature_move,
      check: example.check,
      trap: example.trap.summary,
    },
  });
  if (problems.length > 0)
    throw new Error(
      `the pilot example breaks the rules:\n  ${problems.join("\n  ")}`,
    );
  const abs = (rel: string): string => join(ROOT, rel);
  const fontFile = (name: string): string => {
    const f = kit.brand.fonts[name];
    if (!f) throw new Error(`brand.json has no font ${name}`);
    return abs(f.file);
  };
  const bundle = {
    question: {
      id: q.id,
      skill_code: example.skill_code,
      stem: plainMathText(q.stem),
      passage: q.passage === null ? null : plainMathText(q.passage),
      options: q.options.map((o) => ({
        key: o.key,
        text: plainMathText(o.text),
      })),
      correct_answer: q.correct_answer,
    },
    hook_line: example.hook.line,
    steps: example.steps.map((s) => s.notepad),
    answer: { letter: example.answer.letter, notepad: example.answer.notepad },
    trap: { heading: TRAP_HEADING, notepad: example.trap.notepad },
    lines: scriptLines(example, kit.voice.outro_text),
    outro_caption: kit.voice.outro_caption,
    colours: kit.brand.colours,
    fonts: ["Caveat", "Poppins-700", "Inter"].map(fontFile),
    logo: abs(kit.brand.logo),
    music: {
      file: abs(kit.track.file),
      credit: kit.track.credit,
      gain: kit.voice.music_gain,
      fade_seconds: kit.voice.music_fade_seconds,
    },
    gap_seconds: kit.voice.gap_seconds,
    end_hold_seconds: kit.voice.end_hold_seconds,
    min_seconds: kit.voice.min_seconds,
    max_seconds: kit.voice.max_seconds,
    caption_max_words: CAPTION_MAX_WORDS,
    safe_area: safeArea(),
    hyperframes: kit.voice.hyperframes,
    transcribe_model: kit.voice.transcribe_model,
    kit_dir: abs(KIT_DIR),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "bundle.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
  );
  process.stdout.write(
    `${q.id}: rules pass; key ${q.correct_answer}; wrote ${join(out, "bundle.json")}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
