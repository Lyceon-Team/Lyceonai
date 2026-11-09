/**
 * The QOTD breakdown scripts in the private repo (Lyceon-Team/lyceon-content-private, Karl's ruling
 * 2026-11-03): load them, and check every one against its question,
 * its stored order and letter, the worked examples' script rules and its committed voice.
 *
 * @spec [SCL-266 as ruled by Karl 2026-11-02 on #1398: "Each week, CC writes conversational
 *       breakdown scripts for the next 7 scheduled QOTD dates, using each date's stored order and
 *       letter, as a batch PR into `social` on the same review path as worked examples. Karl's
 *       merge is the approval"; the content rules of the worked examples (H1-H6, S1, S2, the trap
 *       opener), reused; the owner-run schedule export, never committed, posted or logged.
 *       Karl's rulings 2026-11-03: the scripts and their voice move to the private repo, approved
 *       by his merge into its `main`; nothing breakdown-specific that names an answer in the
 *       public repo] | @implemented [2026-11-02, private repo 2026-11-03]
 *
 * plain English:
 *   pnpm exec tsx scripts/qotd-social/check-breakdown-scripts.ts --content <root>
 *       [--schedule <export.json, a path OUTSIDE every checkout>]
 * reads qotd-breakdowns/<YYYY-Www>/<qotd_date>/ under <root> (a checkout of the private repo):
 * script.json and voice/ (manifest.json + one .wav per line), nothing else. For each script:
 *   * the folder is its date's, in its date's ISO week;
 *   * the question is read from the seed SQL by id (the worked examples' seedQuestion), and the
 *     day is built as the archive will serve it from the script's own order and letter
 *     (shared/qotd/breakdown.ts scheduledDay: the real projection), which refuses a letter that
 *     is not where the question's key lands under that order;
 *   * the script rules (shared/worked-examples/rules.ts scriptProblems) on that question;
 *   * the committed voice, in am_michael (Karl's ruling 2026-11-02), through the worked examples'
 *     voiceProblems: a line whose text changed since it was voiced is refused, as is a line that
 *     fails the audio checks;
 *   * with --schedule, Karl's export: the script's question_id, option_order and
 *     correct_display_letter equal the export's row for its date, and the section is the seed's.
 * Run by the private repo's own pull-request check (its .github/workflows/check.yml, which checks
 * out this public code without a token; template in docs/runbooks/qotd-slack.md §6; no export
 * there: the order and letter are then checked against the seed question only) and by the
 * authoring session with --schedule before it opens the PR. The code stays public; only the
 * content is private.
 *
 * Anti-leak: the export holds FUTURE answers. It is read from a path outside the repository and
 * the content checkout (refused otherwise), and no message here prints a value from it: a
 * mismatch names the date and the field only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  qotdBreakdownScheduleSchema,
  qotdBreakdownScriptSchema,
  type QotdBreakdownSchedule,
  type QotdBreakdownScript,
} from "../../packages/shared/src/qotd-breakdown-schema";
import {
  QOTD_BREAKDOWN_CONTENT_DIR,
  QOTD_BREAKDOWN_VOICE_PROFILE,
  breakdownQuestion,
  breakdownScriptDir,
  scheduledDay,
} from "../../shared/qotd/breakdown";
import {
  hardOnlyProblem,
  scriptProblems,
} from "../../shared/worked-examples/rules";
import type { SeedQuestion } from "../../shared/worked-examples/seed-question";
import type { VoiceLine } from "../../packages/shared/src/worked-example-schema";
import {
  loadVoice,
  seedQuestion,
  voiceProblems,
} from "../worked-examples/content";
import { ROOT, loadKit, type Kit } from "../worked-examples/kit";
import { checkoutRoot, containingRoot } from "../worked-examples/voice";

export type BreakdownOnBranch = {
  /** qotd-breakdowns/<YYYY-Www>/<qotd_date> */
  dir: string;
  script: QotdBreakdownScript;
};

const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every script under `contentRoot`, in folder order, and every layout problem: an unexpected
 * file or folder, a script that does not parse, a folder that is not its script's date or week.
 */
export function loadBreakdownScripts(contentRoot: string): {
  scripts: BreakdownOnBranch[];
  problems: string[];
} {
  const base = join(contentRoot, QOTD_BREAKDOWN_CONTENT_DIR);
  const scripts: BreakdownOnBranch[] = [];
  const problems: string[] = [];
  if (!existsSync(base)) return { scripts, problems };
  for (const week of readdirSync(base).sort()) {
    const weekDir = `${QOTD_BREAKDOWN_CONTENT_DIR}/${week}`;
    if (
      !WEEK.test(week) ||
      !statSync(join(contentRoot, weekDir)).isDirectory()
    ) {
      problems.push(`${weekDir}: not a week folder (YYYY-Www)`);
      continue;
    }
    for (const date of readdirSync(join(contentRoot, weekDir)).sort()) {
      const dir = `${weekDir}/${date}`;
      if (!DATE.test(date) || !statSync(join(contentRoot, dir)).isDirectory()) {
        problems.push(`${dir}: not a date folder (YYYY-MM-DD)`);
        continue;
      }
      for (const name of readdirSync(join(contentRoot, dir)))
        if (name !== "script.json" && name !== "voice")
          problems.push(
            `${dir}/${name}: only script.json and voice/ belong here`,
          );
      const file = join(contentRoot, dir, "script.json");
      if (!existsSync(file)) {
        problems.push(`${dir}: no script.json`);
        continue;
      }
      // One malformed file must not stop every other day's breakdown: it is recorded as a
      // problem, so its own day falls back with no_approved_script (spec audit F4, 2026-11-02).
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (e: unknown) {
        if (!(e instanceof SyntaxError)) throw e;
        problems.push(`${dir}/script.json: not valid JSON (${e.message})`);
        continue;
      }
      const parsed = qotdBreakdownScriptSchema.safeParse(raw);
      if (!parsed.success) {
        problems.push(
          `${dir}/script.json: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
        continue;
      }
      if (breakdownScriptDir(parsed.data.qotd_date) !== dir) {
        problems.push(
          `${dir}/script.json is for ${parsed.data.qotd_date}, whose folder is ${breakdownScriptDir(parsed.data.qotd_date)}`,
        );
        continue;
      }
      scripts.push({ dir, script: parsed.data });
    }
  }
  return { scripts, problems };
}

/** The question a script names, as its seed SQL inserts it (or why it cannot be read). */
export type SeedLookup = (
  id: string,
) => { ok: true; question: SeedQuestion } | { ok: false; problem: string };

/**
 * Every rule for one script. `schedule` is Karl's export, when the authoring session has it.
 * Empty means it may be rendered (once Karl has merged it).
 */
export function breakdownScriptProblems(
  contentRoot: string,
  entry: BreakdownOnBranch,
  kit: Kit,
  seedFor: SeedLookup,
  schedule: QotdBreakdownSchedule | null,
): string[] {
  const { script, dir } = entry;
  const out: string[] = [];
  const seed = seedFor(script.question_id);
  if (!seed.ok) return [`${dir}: ${seed.problem}`];
  // Karl's ruling 2026-11-05: authored breakdown scripts use Hard questions only.
  const hard = hardOnlyProblem(seed.question);
  if (hard) out.push(hard);
  if (schedule !== null) {
    const row = schedule.find((r) => r.qotd_date === script.qotd_date);
    if (!row)
      out.push(`the schedule export has no row for ${script.qotd_date}`);
    else {
      if (row.question_id !== script.question_id)
        out.push("question_id differs from the schedule export");
      if (row.option_order.join(",") !== script.option_order.join(","))
        out.push("option_order differs from the schedule export");
      if (row.correct_display_letter !== script.correct_display_letter)
        out.push("correct_display_letter differs from the schedule export");
      if (row.section !== seed.question.section)
        out.push("the schedule export's section is not the question's");
    }
  }
  const day = scheduledDay(
    seed.question,
    script.qotd_date,
    script.option_order,
    script.correct_display_letter,
  );
  if (!day.ok) return [...out, day.problem].map((p) => `${dir}: ${p}`);
  const asked = breakdownQuestion(day.day);
  if (!asked.ok)
    return [...out, "the stored order does not letter the question"].map(
      (p) => `${dir}: ${p}`,
    );
  out.push(...scriptProblems(script, asked.question));
  out.push(...breakdownVoice(contentRoot, entry, kit).problems);
  return out.map((p) => `${dir}: ${p}`);
}

/**
 * The committed voice of one script, and what is wrong with it: voiced in am_michael, and every
 * line through the worked examples' voiceProblems (voiced from the text it has now, passing the
 * audio checks, loud enough over the music). The authoring check and the render both read it.
 */
export function breakdownVoice(
  contentRoot: string,
  entry: BreakdownOnBranch,
  kit: Kit,
): { lines: VoiceLine[]; problems: string[] } {
  try {
    const manifest = loadVoice(contentRoot, entry.dir);
    const problems: string[] = [];
    if (manifest.voice !== QOTD_BREAKDOWN_VOICE_PROFILE)
      problems.push(
        `voiced in ${manifest.voice}, not ${QOTD_BREAKDOWN_VOICE_PROFILE}`,
      );
    problems.push(
      ...voiceProblems(entry.script, manifest, kit, (file) =>
        readFileSync(join(contentRoot, entry.dir, "voice", file)),
      ),
    );
    return { lines: manifest.lines, problems };
  } catch (err: unknown) {
    if (!(err instanceof Error)) throw err;
    return { lines: [], problems: [`voice: ${err.message}`] };
  }
}

/** Every problem on the branch. */
export function checkBreakdownScripts(
  contentRoot: string,
  schedule: QotdBreakdownSchedule | null,
  seedFor: SeedLookup = seedQuestion,
  kit: Kit = loadKit(),
): string[] {
  const { scripts, problems } = loadBreakdownScripts(contentRoot);
  for (const e of scripts)
    problems.push(
      ...breakdownScriptProblems(contentRoot, e, kit, seedFor, schedule),
    );
  return problems;
}

/**
 * Karl's export, read from `path`: refused inside the repository or the content checkout (it
 * holds future answers and must never be committed), and parsed strictly.
 */
export function readScheduleExport(
  path: string,
  contentRoot: string,
): QotdBreakdownSchedule {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error("the schedule export does not exist");
  const guarded = [ROOT, contentRoot];
  const content = checkoutRoot(contentRoot);
  if (content) guarded.push(content);
  const inside = containingRoot(abs, guarded);
  if (inside !== null)
    throw new Error(
      `the schedule export is inside ${inside}; keep it outside every checkout (it holds future answers)`,
    );
  return qotdBreakdownScheduleSchema.parse(
    JSON.parse(readFileSync(abs, "utf8")),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const k = argv.indexOf(name);
    return k === -1 ? undefined : argv[k + 1];
  };
  const root = resolve(opt("--content") ?? ".");
  const schedulePath = opt("--schedule");
  const schedule =
    schedulePath === undefined ? null : readScheduleExport(schedulePath, root);
  const problems = checkBreakdownScripts(root, schedule);
  if (problems.length > 0) {
    process.stderr.write(
      `check-breakdown-scripts: ${problems.length} problem(s)\n  ${problems.join("\n  ")}\n`,
    );
    process.exit(1);
  }
  const n = loadBreakdownScripts(root).scripts.length;
  process.stdout.write(
    `check-breakdown-scripts: ${n} script(s) pass every rule${schedule ? " and match the schedule export" : ""}\n`,
  );
}
