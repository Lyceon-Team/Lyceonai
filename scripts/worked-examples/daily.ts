/**
 * The daily worked-example job: pick today's approved example, prove it, record it, hand it to the
 * Slack poster. Run by .github/workflows/worked-example-daily.yml at 17:00 UTC.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "a daily job at
 *       17:00 UTC renders any approved example with post_on = today and posts it to #social as the
 *       labelled set … Karl posts manually", acceptance "the daily job posts only approved,
 *       post_on-today examples, once"; Step 0 ruling 3 (post_on + a daily job)]
 *       | @implemented [2026-10-27]
 *
 * plain English, three subcommands the workflow runs in order:
 *   select  --content <social checkout> --out <dir> [--dry-run --date YYYY-MM-DD]
 *           today = America/Chicago date (17:00 UTC is 11:00 or 12:00 there). Takes the examples
 *           due today and not in posted.json (dueExamples). None: writes nothing, exit 0. More
 *           than one: refuses (one example a day). One: checks Karl's merge from GitHub's record
 *           (approval.ts), runs every content rule, generates the composition into <dir>/composition
 *           and writes <dir>/post.json (label, title, caption with the music credit, approval).
 *           --dry-run (pull requests only) uses the given date and a placeholder approval so the
 *           whole path is proven on the fixture tree; the workflow never claims or posts then.
 *   verify  --out <dir>   the rendered MP4 is 1080×1920, 30-60 s, within 0.25 s of the
 *           composition, with an audio stream (ffprobe).
 *   claim   --content <social checkout> --out <dir> --run <run id>   adds the example to
 *           posted.json (refused if already there). The workflow pushes that commit to `social`
 *           BEFORE posting: a failed push stops the run, so a re-run can never post twice. A post
 *           that fails after the claim is re-posted by hand (runbook).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  workedExampleId,
  workedExamplePostSchema,
  workedExamplePostedLedgerSchema,
  type WorkedExamplePost,
} from "../../packages/shared/src/worked-example-schema";
import { chicagoToday } from "../../shared/sat-test-dates";
import {
  captionProblems,
  titleProblems,
  workedExampleCaption,
  workedExampleLabel,
  workedExampleTitle,
} from "../../shared/worked-examples/rules";
import {
  approvalFromRecord,
  dueExamples,
  recordPosted,
  type ExampleApproval,
  type ExampleOnBranch,
} from "./approval";
import {
  exampleProblems,
  loadExamples,
  loadPosted,
  POSTED_PATH,
} from "./content";
import { folderCommit, pullForCommit } from "./github";
import { maxVolumeFromFfmpeg, musicPeakProblem } from "./audio";
import { generate } from "./generate";
import { ROOT, loadKit } from "./kit";

type Args = {
  cmd: string;
  get: (name: string) => string | undefined;
  has: (name: string) => boolean;
};

function args(argv: readonly string[]): Args {
  return {
    cmd: argv[0] ?? "",
    get: (name) => {
      const k = argv.indexOf(name);
      return k === -1 ? undefined : argv[k + 1];
    },
    has: (name) => argv.includes(name),
  };
}

function need(a: Args, name: string): string {
  const v = a.get(name);
  if (!v) throw new Error(`${a.cmd}: missing ${name}`);
  return v;
}

/** The post for one example: label, title, caption (music credited), approval. Refuses on a rule. */
export function buildPost(
  e: ExampleOnBranch,
  title: string,
  caption: string,
  credit: string,
  approval: ExampleApproval,
): WorkedExamplePost {
  const problems = [
    ...titleProblems(title),
    ...captionProblems(caption, credit),
  ];
  if (problems.length > 0)
    throw new Error(`refused:\n  ${problems.join("\n  ")}`);
  const id = workedExampleId(e.content.question_id);
  return workedExamplePostSchema.parse({
    id,
    post_on: e.content.post_on,
    label: workedExampleLabel(e.content),
    video: `${id}.mp4`,
    title,
    caption,
    approval,
  });
}

async function select(a: Args): Promise<void> {
  const content = resolve(need(a, "--content"));
  const out = resolve(need(a, "--out"));
  const dryRun = a.has("--dry-run");
  const today = dryRun ? need(a, "--date") : chicagoToday();
  const due = dueExamples(loadExamples(content), today, loadPosted(content));
  if (due.length === 0) {
    process.stdout.write(`select: nothing due on ${today}\n`);
    return;
  }
  if (due.length > 1)
    throw new Error(
      `${due.length} examples are due on ${today} (${due.map((e) => e.dir).join(", ")}); one a day: nothing posted`,
    );
  const [e] = due as [ExampleOnBranch];
  let approval: ExampleApproval;
  if (dryRun) {
    approval = {
      pr: 1,
      mergedBy: "dry-run",
      mergeSha: "0".repeat(40),
      mergedAt: `${today}T00:00:00Z`,
    };
  } else {
    const repo = need(
      { ...a, get: (n) => process.env[n] },
      "GITHUB_REPOSITORY",
    );
    const token = need({ ...a, get: (n) => process.env[n] }, "GITHUB_TOKEN");
    const sha = folderCommit(content, e.dir);
    const verdict = approvalFromRecord(
      await pullForCommit(repo, sha, token),
      sha,
      process.env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
    );
    if (!verdict.ok)
      throw new Error(
        `${e.dir} is due today but not approved: ${verdict.reason}; nothing posted`,
      );
    approval = verdict.approval;
  }
  const kit = loadKit();
  const { question } = exampleProblems(content, e, kit);
  if (!question) throw new Error(`${e.dir}: its question cannot be read`);
  generate(content, e.dir, join(out, "composition"));
  const post = buildPost(
    e,
    workedExampleTitle(e.content, question),
    workedExampleCaption(e.content, kit.track.credit),
    kit.track.credit,
    approval,
  );
  writeFileSync(join(out, "post.json"), `${JSON.stringify(post, null, 2)}\n`);
  process.stdout.write(
    `select: ${post.label} (${post.id}) is due on ${today}\n`,
  );
}

export type ProbeResult = {
  width: number;
  height: number;
  duration: number;
  audio: boolean;
};

/** The rendered MP4 against the composition: size, length, audio. */
export function renderProblems(
  probe: ProbeResult,
  expected: number,
  kit: ReturnType<typeof loadKit>,
): string[] {
  const out: string[] = [];
  if (probe.width !== 1080 || probe.height !== 1920)
    out.push(`the video is ${probe.width}×${probe.height}, not 1080×1920`);
  if (
    probe.duration < kit.voice.min_seconds ||
    probe.duration > kit.voice.max_seconds
  )
    out.push(
      `the video lasts ${probe.duration} s; it must be ${kit.voice.min_seconds}-${kit.voice.max_seconds} s`,
    );
  if (Math.abs(probe.duration - expected) > 0.25)
    out.push(
      `the video lasts ${probe.duration} s, the composition ${expected} s`,
    );
  if (!probe.audio) out.push("the video has no audio stream");
  return out;
}

function verify(a: Args): void {
  const out = resolve(need(a, "--out"));
  const post = workedExamplePostSchema.parse(
    JSON.parse(readFileSync(join(out, "post.json"), "utf8")),
  );
  const meta: unknown = JSON.parse(
    readFileSync(join(out, "composition", "meta.json"), "utf8"),
  );
  const expected =
    typeof meta === "object" &&
    meta !== null &&
    "duration" in meta &&
    typeof meta.duration === "number"
      ? meta.duration
      : NaN;
  const raw: unknown = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height:format=duration",
        "-of",
        "json",
        join(out, post.video),
      ],
      { encoding: "utf8" },
    ),
  );
  const streams =
    typeof raw === "object" &&
    raw !== null &&
    "streams" in raw &&
    Array.isArray(raw.streams)
      ? (raw.streams as unknown[])
      : [];
  const video = streams.find(
    (s): s is { width: number; height: number } =>
      typeof s === "object" &&
      s !== null &&
      "codec_type" in s &&
      s.codec_type === "video" &&
      "width" in s &&
      "height" in s,
  );
  const format =
    typeof raw === "object" &&
    raw !== null &&
    "format" in raw &&
    typeof raw.format === "object" &&
    raw.format !== null &&
    "duration" in raw.format
      ? Number(raw.format.duration)
      : NaN;
  const kit = loadKit();
  const detect = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      join(ROOT, kit.track.file),
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const music = musicPeakProblem(
    maxVolumeFromFfmpeg(detect.stderr),
    kit.track.peak_dbfs,
  );
  const problems = renderProblems(
    {
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      duration: format,
      audio: streams.some(
        (s) =>
          typeof s === "object" &&
          s !== null &&
          "codec_type" in s &&
          s.codec_type === "audio",
      ),
    },
    expected,
    kit,
  );
  if (music) problems.push(music);
  if (problems.length > 0)
    throw new Error(`refused:\n  ${problems.join("\n  ")}`);
  process.stdout.write(`verify: ${post.video} OK (${format} s)\n`);
}

function claim(a: Args): void {
  const content = resolve(need(a, "--content"));
  const out = resolve(need(a, "--out"));
  const post = workedExamplePostSchema.parse(
    JSON.parse(readFileSync(join(out, "post.json"), "utf8")),
  );
  const result = recordPosted(
    loadPosted(content),
    post.id,
    post.post_on,
    need(a, "--run"),
  );
  if (!result.ok) throw new Error(`${result.reason}: not posting again`);
  const file = join(content, POSTED_PATH);
  writeFileSync(
    file,
    `${JSON.stringify(workedExamplePostedLedgerSchema.parse(result.ledger), null, 2)}\n`,
  );
  process.stdout.write(
    `claim: ${post.id} recorded in ${POSTED_PATH}${existsSync(file) ? "" : " (new file)"}\n`,
  );
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  if (a.cmd === "select") await select(a);
  else if (a.cmd === "verify") verify(a);
  else if (a.cmd === "claim") claim(a);
  else throw new Error("usage: daily.ts select|verify|claim …");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `daily: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
