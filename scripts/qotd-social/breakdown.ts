/**
 * The QOTD breakdown pilot: yesterday's Question of the Day as a 30-60 s video in #social, from the
 * script Karl approved for that day, or yesterday's answer slide and "Breakdown skipped: <reason>".
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): each day render
 *       a breakdown of YESTERDAY's QOTD with the worked-example pipeline (Hyperframes, the
 *       video-kit templates, scripts/worked-examples composition / quality / layout check); it
 *       drops into the nightly #social QOTD message; the stored option_order and
 *       correct_display_letter, never the original order; Karl's manual posting is the approval
 *       of the video, nothing auto-publishes; the fallback rule (a)-(d), approved as written; the
 *       fallback never blocks or delays the QOTD post; no posting outside #social; SCL-258,
 *       SCL-262, SCL-265, SCL-266. Karl's rulings on #1398, 2026-11-02: AUTHORED scripts (one per
 *       QOTD date, batch PR into `social`, his merge the approval, read from GitHub's record by
 *       scripts/worked-examples/approval.ts); at render time the merged script for that date; no
 *       approved script = the fallback with `no_approved_script`; am_michael]
 *       Karl's rulings 2026-11-03: the scripts and their voice live in the PRIVATE repo
 *       QOTD_BREAKDOWN_CONTENT_REPO (the public repo holds nothing breakdown-specific that names an
 *       answer), approved by his merge into its `main`; the job reads yesterday's folder only;
 *       the final-mix true-peak limiter (SCL-270, at most -1 dBTP) runs on the breakdown too]
 *       | @implemented [2026-11-02, authored scripts 2026-11-02, private repo + limiter 2026-11-03]
 *
 * Usage (.github/workflows/qotd-social.yml, job `breakdown`, after the QOTD job):
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts window   (prints off|not_started|active|ended|paused)
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts target   (prints yesterday's folder in the private
 *       repo, qotd-breakdowns/<week>/<date>: the one path the job's sparse checkout fetches)
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts build --content <private repo checkout> [--date YYYY-MM-DD]
 *       [--out DIR] [--base-url URL] [--fixture <rows.json> --now ISO] [--dry-run]
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts post --dir DIR --assets qotd-social-out [--dry-run]
 *
 * plain English:
 *   * build: the day is yesterday's QOTD (the day before the 04:00 UTC QOTD day the run is in;
 *     `--date` names a past day by hand). A day that has not passed, today included, is refused
 *     (exit 2) before anything is fetched: its answer is not public yet. Outside the pilot window
 *     (shared/qotd/breakdown.ts QOTD_BREAKDOWN_PILOT, 2026-11-09 to 2026-11-22, or the repository
 *     variable QOTD_BREAKDOWN_PAUSED=true) it writes an `inactive` manifest and does nothing else.
 *     Otherwise it reads the day from the PUBLIC archive (loadYesterday, the generator's own
 *     read), then, stopping at the first failure with its code: the suitability checks (c); the
 *     day's script in the private repo (qotd-breakdowns/<week>/<date>/script.json), refused unless
 *     GitHub's record shows Karl merged it into that repo's `main` (approvalFromRecord, the worked
 *     examples' own, read with the read-only CONTENT_PRIVATE_TOKEN);
 *     THE HARD RULE, the script's option_order and correct_display_letter equal the stored row
 *     the archive serves (order_mismatch); the worked examples' script rules on the day's
 *     question as served, and the captions; the committed voice (voiceProblems: refused when a
 *     line's text changed since it was voiced); the composition (buildScriptComposition) and its
 *     folder (writeCompositionFolder); the 30-60 s bound; `hyperframes check`; the layout check;
 *     the render (into render/); the final-mix true-peak limiter (final-mix.ts limitFinishedMix,
 *     SCL-270); the MP4 check (daily.ts videoFileProblems) and the finished-mix check
 *     (finishedMixProblems, at most -1 dBTP). A pass becomes a `built` manifest.
 *     Fallbacks exit 0: nothing here can fail the QOTD. No Python and no voicing at render time:
 *     the voice was committed with the script and approved with it.
 *     --dry-run (pull requests only) uses a placeholder approval; --fixture serves the archive
 *     from a rows file through the real projection (toArchiveResponse). Pull requests use the
 *     SYNTHETIC fixture (tests/fixtures/qotd-breakdowns-synthetic: a made-up question, order and
 *     script, voiced in am_michael), so no real answer is used and the whole path still runs.
 *   * post: built: the video and the SCL-262 set (videoSetSlackSteps, the worked examples' own
 *     message builder). skipped: yesterday's answer slide (the QOTD run's carousel slide 3), with
 *     "Breakdown skipped: <reason> (<code>)", or the notice alone when there is no slide. No
 *     breakdown.json at all (the build crashed): the notice with build_failed. inactive: nothing.
 *     --dry-run builds every message and sends nothing.
 *   * Logs carry the day, the status and the code only, never question text; the details go to
 *     summary.md (the run page). Every day handled here has passed, so its answer is public.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  qotdBreakdownManifestSchema,
  type QotdBreakdownManifest,
  type QotdBreakdownSkipCode,
} from "../../packages/shared/src/qotd-breakdown-schema";
import {
  previousQotdDate,
  type QotdArchiveResponse,
} from "../../packages/shared/src/qotd-schema";
import {
  QOTD_BREAKDOWN_CONTENT_BRANCH,
  QOTD_BREAKDOWN_CONTENT_REPO,
  QOTD_BREAKDOWN_PILOT,
  QOTD_BREAKDOWN_WINDOW_NOTE,
  breakdownCopy,
  breakdownScriptDir,
  breakdownQuestion,
  breakdownSkipCode,
  breakdownSkipLine,
  pilotWindow,
  scriptOrderProblem,
} from "../../shared/qotd/breakdown";
import {
  hookGoProblem,
  scriptProblems,
} from "../../shared/worked-examples/rules";
import { qotdRowSchema, toArchiveResponse } from "../../shared/qotd/projection";
import {
  escapeMrkdwn,
  postMessage,
  shareFilesConfirmed,
  slackConfig,
} from "../../shared/slack/client";
import {
  approvalFromRecord,
  type ExampleApproval,
} from "../worked-examples/approval";
import { buildScriptComposition } from "../worked-examples/composition";
import { videoFileProblems, type ProbeResult } from "../worked-examples/daily";
import {
  finishedMixProblems,
  limitFinishedMix,
} from "../worked-examples/final-mix";
import { folderCommit, pullForCommit } from "../worked-examples/github";
import { writeCompositionFolder } from "../worked-examples/generate";
import { KIT_DIR, ROOT, loadKit, type Kit } from "../worked-examples/kit";
import { layoutCheck } from "../worked-examples/layout-check";
import {
  nodeFetch,
  postVideoSet,
  videoSetSlackSteps,
  type WorkedExampleSlackStep,
} from "../worked-examples/post-to-slack";
import { hyperframes } from "../worked-examples/voice";
import { voiceLineSchema } from "../../packages/shared/src/worked-example-schema";
import {
  breakdownVoice,
  loadBreakdownScripts,
} from "./check-breakdown-scripts";
import {
  archiveFetch,
  loadYesterday,
  pastDateProblem,
  socialRunToday,
  type ArchiveFetch,
} from "./generate";

export const QOTD_BREAKDOWN_MANIFEST = "breakdown.json";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The QOTD day after `date` (UTC calendar arithmetic, as previousQotdDate). */
export function nextQotdDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The day a run breaks down, or why it may not. Default: the day before the run's QOTD day
 * (04:00 UTC to 04:00 UTC, the generator's rule). Any requested day must have PASSED: today, whose
 * answer is not public yet, and later days are refused (generate.ts pastDateProblem).
 */
export function breakdownDay(
  requested: string | null,
  now: Date,
):
  | { ok: true; date: string; postedOn: string }
  | { ok: false; problem: string } {
  const date = requested ?? previousQotdDate(socialRunToday(now));
  const problem = pastDateProblem(date, now);
  return problem === null
    ? { ok: true, date, postedOn: nextQotdDate(date) }
    : { ok: false, problem };
}

const fixtureFileSchema = z.object({ archive: z.array(qotdRowSchema) });

/**
 * The archive as the server serves it, from a rows.json of real qotd_archive() output: each row
 * through the real projection (toArchiveResponse) in the { data } envelope; a day not in the
 * archive (today, a withheld day) is a 404, as on the server.
 */
export function fixtureArchiveFetch(rowsJson: unknown): ArchiveFetch {
  const rows = fixtureFileSchema.parse(rowsJson).archive;
  return async (url) => {
    const date = /\/api\/public\/qotd\/(\d{4}-\d{2}-\d{2})$/.exec(
      new URL(url).pathname,
    )?.[1];
    const row = rows.find((r) => r.qotd_date === date);
    if (!row) return { status: 404, ok: false, json: async () => ({}) };
    const body = { data: toArchiveResponse(row) };
    return { status: 200, ok: true, json: async () => body };
  };
}

type Built = Extract<QotdBreakdownManifest, { status: "built" }>;

/** The outcome of one build: the manifest and the detail lines for the run page. */
export type BuildOutcome = {
  manifest: QotdBreakdownManifest;
  details: string[];
};

function skipped(
  date: string,
  postedOn: string,
  code: QotdBreakdownSkipCode,
  details: string[] = [],
): BuildOutcome {
  return {
    manifest: { status: "skipped", qotd_date: date, posted_on: postedOn, code },
    details,
  };
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n").slice(0, 6).join(" | ");
  throw e;
}

/**
 * Where the day's script comes from: a checkout of the private repo (in the nightly job, only
 * yesterday's folder), and Karl's merge of that folder into its `main`.
 */
export type ScriptSource = {
  contentRoot: string;
  approve: (
    dir: string,
  ) => Promise<
    { ok: true; approval: ExampleApproval } | { ok: false; reason: string }
  >;
};

/**
 * Everything from yesterday's archive day to a checked MP4, stopping at the first failure with
 * its code. The steps that need no machine (the suitability checks, the script, its approval,
 * the hard rule, the rules and the copy) come first, so a refused day costs nothing.
 */
export async function buildBreakdown(
  day: QotdArchiveResponse | null,
  date: string,
  postedOn: string,
  outDir: string,
  source: ScriptSource,
): Promise<BuildOutcome> {
  if (day === null) return skipped(date, postedOn, "withheld");
  if (day.qotd_date !== date)
    return skipped(date, postedOn, "build_failed", [
      `the archive returned ${day.qotd_date}, not ${date}`,
    ]);
  const unsuitable = breakdownSkipCode(day);
  if (unsuitable) return skipped(date, postedOn, unsuitable);
  const asked = breakdownQuestion(day);
  if (!asked.ok) return skipped(date, postedOn, asked.code);
  const question = asked.question;

  // The day's script, merged by Karl (the worked examples' approval, from GitHub's record).
  const loaded = loadBreakdownScripts(source.contentRoot);
  const entry = loaded.scripts.find((e) => e.script.qotd_date === date);
  if (!entry)
    return skipped(date, postedOn, "no_approved_script", [
      `no script for ${date} under ${breakdownScriptDir(date)} in the private repo`,
      ...loaded.problems.filter((p) => p.includes(date)),
    ]);
  const approved = await source.approve(entry.dir);
  if (!approved.ok)
    return skipped(date, postedOn, "no_approved_script", [
      `${entry.dir}: ${approved.reason}`,
    ]);
  const { script } = entry;

  // THE HARD RULE: the script's order and letter are the stored row the archive serves.
  const order = scriptOrderProblem(script, day, question);
  if (order) return skipped(date, postedOn, "order_mismatch", [order]);

  const kit = loadKit();
  const go = hookGoProblem(script.hook.voice, script.qotd_date);
  const content = [...scriptProblems(script, question), ...(go ? [go] : [])];
  const copy = breakdownCopy(day, postedOn);
  if (content.length > 0 || !copy.ok)
    return skipped(date, postedOn, "content_rules", [
      ...content,
      ...(copy.ok ? [] : copy.problems),
    ]);

  // The committed voice: am_michael, every line voiced from the text it now has, and passing the
  // audio checks (the worked examples' voiceProblems). Nothing is voiced here.
  const voiceDir = join(source.contentRoot, entry.dir, "voice");
  const voice = breakdownVoice(source.contentRoot, entry, kit);
  if (voice.problems.length > 0)
    return skipped(date, postedOn, "voice_check_failed", voice.problems);
  const lines = voice.lines;
  const outro = voiceLineSchema.parse(
    JSON.parse(
      readFileSync(join(ROOT, KIT_DIR, "voice", "outro.json"), "utf8"),
    ),
  );
  const comp = buildScriptComposition({
    script,
    question,
    title: `QOTD breakdown: ${date}`,
    voice: lines,
    outro,
    kit,
  });
  if (comp.duration > kit.voice.max_seconds)
    return skipped(date, postedOn, "script_too_long", [`${comp.duration} s`]);
  if (comp.duration < kit.voice.min_seconds)
    return skipped(date, postedOn, "script_too_short", [`${comp.duration} s`]);

  const compDir = join(outDir, "composition");
  const video = `qotd-${date}-breakdown.mp4`;
  writeCompositionFolder(
    comp,
    compDir,
    `qotd-${date}-breakdown`,
    voiceDir,
    lines,
    outro,
    kit,
  );
  try {
    hyperframes(kit.voice, ["check"], compDir);
  } catch (e: unknown) {
    return skipped(date, postedOn, "hyperframes_check_failed", [message(e)]);
  }
  const layout = await layoutCheck(compDir);
  if (layout.length > 0)
    return skipped(date, postedOn, "layout_check_failed", layout);
  const rendered = join(outDir, "render", video);
  mkdirSync(join(outDir, "render"), { recursive: true });
  try {
    hyperframes(
      kit.voice,
      ["render", "--quality", "delivery", "--output", rendered],
      compDir,
    );
  } catch (e: unknown) {
    return skipped(date, postedOn, "render_failed", [message(e)]);
  }
  const verified = finishVideo(rendered, join(outDir, video), compDir, kit);
  if (!verified.ok)
    return skipped(date, postedOn, "mp4_check_failed", verified.problems);

  const manifest: Built = {
    status: "built",
    qotd_date: date,
    posted_on: postedOn,
    section: day.question.section_code,
    video,
    label: copy.copy.label,
    headline: copy.copy.headline,
    caption: copy.copy.caption,
    instagram_caption: copy.copy.instagram_caption,
    facebook_caption: copy.copy.facebook_caption,
    keywords: copy.copy.keywords,
    warnings: copy.copy.warnings,
    option_order: question.option_order,
    display_letter: question.correct_answer,
    question_id: script.question_id,
    duration_seconds: Math.round(verified.probe.duration * 100) / 100,
    approval: approved.approval,
  };
  return { manifest: qotdBreakdownManifestSchema.parse(manifest), details: [] };
}

/**
 * From the rendered MP4 to the video that is posted. SCL-270 (Karl, 2026-11-03: "include the
 * limiter" in the breakdown): the finished mix, limited to at most -1 dBTP true peak by the one
 * shared limiter (final-mix.ts limitFinishedMix), is the video, and the rendered file is never
 * posted. Then the MP4 check every kit video takes (daily.ts videoFileProblems) and the
 * finished-mix check (finishedMixProblems). `limit` is the limiter (a parameter only so a test can
 * prove the check refuses a mix the limiter did not bring down).
 */
export function finishVideo(
  rendered: string,
  video: string,
  compDir: string,
  kit: Kit,
  limit: (
    input: string,
    output: string,
    kit: Kit,
  ) => unknown = limitFinishedMix,
): { ok: true; probe: ProbeResult } | { ok: false; problems: string[] } {
  try {
    limit(rendered, video, kit);
  } catch (e: unknown) {
    return { ok: false, problems: [message(e)] };
  }
  const { probe, problems } = videoFileProblems(video, compDir);
  problems.push(...finishedMixProblems(video, kit));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, probe };
}

/**
 * Karl's merge of a script folder into the private repo's `main`, from GitHub's record of the pull
 * request that last changed it (the worked examples' approvalFromRecord), read with the read-only
 * CONTENT_PRIVATE_TOKEN (Contents + Pull requests: Read on that repo only, Karl 2026-11-03). The
 * repo is fixed here, never read from the environment. A dry run approves with a placeholder.
 */
export function scriptApproval(
  contentRoot: string,
  dryRun: boolean,
  env: NodeJS.ProcessEnv,
): ScriptSource["approve"] {
  if (dryRun)
    return async () => ({
      ok: true,
      approval: {
        pr: 1,
        mergedBy: "dry-run",
        mergeSha: "0".repeat(40),
        mergedAt: "1970-01-01T00:00:00Z",
      },
    });
  return async (dir) => {
    const token = env.CONTENT_PRIVATE_TOKEN;
    if (!token)
      return { ok: false, reason: "CONTENT_PRIVATE_TOKEN is not set" };
    const sha = folderCommit(contentRoot, dir);
    if (sha === "") return { ok: false, reason: "the folder has no commit" };
    return approvalFromRecord(
      await pullForCommit(QOTD_BREAKDOWN_CONTENT_REPO, sha, token),
      sha,
      env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
      QOTD_BREAKDOWN_CONTENT_BRANCH,
    );
  };
}

function fenced(text: string): string {
  return ["~~~text", text, "~~~"].join("\n");
}

/** The run page: what was built, or why not. Details may quote the question (it is public). */
export function breakdownSummary(o: BuildOutcome): string {
  const m = o.manifest;
  const head = `## QOTD breakdown: ${m.qotd_date} (posts ${m.posted_on})`;
  if (m.status === "inactive")
    return [head, "", QOTD_BREAKDOWN_WINDOW_NOTE[m.window], ""].join("\n");
  if (m.status === "skipped")
    return [
      head,
      "",
      `**${breakdownSkipLine(m.code)}**`,
      "",
      ...o.details.map((d) => `- ${d}`),
      "",
    ].join("\n");
  return [
    head,
    "",
    `${m.video}: ${m.duration_seconds} s. ${m.question_id}, order ${m.option_order.join("")}, answer ${m.display_letter} (stored). Script approved by ${m.approval.mergedBy} in #${m.approval.pr}. Download it from this run's **Artifacts**.`,
    "",
    "### TikTok caption",
    fenced(m.caption),
    "### Keywords",
    fenced(m.keywords.join("\n")),
    "### Instagram caption",
    fenced(m.instagram_caption),
    "### Facebook caption",
    fenced(m.facebook_caption),
    "",
  ].join("\n");
}

type Flags = {
  get: (n: string) => string | undefined;
  has: (n: string) => boolean;
};

function flags(argv: readonly string[]): Flags {
  return {
    get: (n) => {
      const k = argv.indexOf(n);
      return k === -1 ? undefined : argv[k + 1];
    },
    has: (n) => argv.includes(n),
  };
}

async function build(f: Flags): Promise<number> {
  const outDir = resolve(f.get("--out") ?? join(ROOT, "qotd-breakdown-out"));
  const fixture = f.get("--fixture");
  const nowFlag = f.get("--now");
  if (nowFlag !== undefined && fixture === undefined)
    throw new Error("--now is for --fixture runs only");
  const content = f.get("--content");
  if (content === undefined)
    throw new Error("--content <checkout of the private repo> is required");
  const contentRoot = resolve(content);
  const now = nowFlag ? new Date(nowFlag) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--now is not a time");
  const dryRun = f.has("--dry-run");
  if (fixture !== undefined && !dryRun)
    throw new Error("--fixture is for --dry-run only");
  const day = breakdownDay(f.get("--date") ?? null, now);
  if (!day.ok) {
    process.stderr.write(`qotd-breakdown: refused: ${day.problem}\n`);
    return 2;
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const window = pilotWindow(
    QOTD_BREAKDOWN_PILOT,
    day.postedOn,
    process.env.QOTD_BREAKDOWN_PAUSED === "true",
  );
  let outcome: BuildOutcome;
  if (window !== "active" && !dryRun) {
    outcome = {
      manifest: {
        status: "inactive",
        qotd_date: day.date,
        posted_on: day.postedOn,
        window,
      },
      details: [],
    };
  } else {
    if (window !== "active")
      out(`qotd-breakdown: dry run (${QOTD_BREAKDOWN_WINDOW_NOTE[window]})`);
    const fetchImpl =
      fixture === undefined
        ? archiveFetch
        : fixtureArchiveFetch(
            JSON.parse(readFileSync(resolve(fixture), "utf8")),
          );
    const baseUrl = (f.get("--base-url") ?? "https://lyceon.ai").replace(
      /\/$/,
      "",
    );
    const yesterday = await loadYesterday(baseUrl, day.postedOn, fetchImpl);
    outcome = await buildBreakdown(
      yesterday.day,
      day.date,
      day.postedOn,
      outDir,
      {
        contentRoot,
        approve: scriptApproval(contentRoot, dryRun, process.env),
      },
    );
  }
  const manifest = qotdBreakdownManifestSchema.parse(outcome.manifest);
  writeFileSync(
    join(outDir, QOTD_BREAKDOWN_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(join(outDir, "summary.md"), breakdownSummary(outcome));
  out(
    `qotd-breakdown: ${manifest.qotd_date}: ${manifest.status}${
      manifest.status === "skipped"
        ? ` (${manifest.code})`
        : manifest.status === "inactive"
          ? ` (${QOTD_BREAKDOWN_WINDOW_NOTE[manifest.window]})`
          : ` (${manifest.duration_seconds} s)`
    }`,
  );
  return 0;
}

/** Yesterday's answer slide, as the QOTD run wrote it: the carousel's slide 3. */
export function answerSlideFile(date: string): string {
  return `qotd-${date}-tiktok-3.png`;
}

/** What the post step sends. */
export type BreakdownPlan =
  | { kind: "nothing"; note: string }
  | { kind: "video"; file: string; steps: WorkedExampleSlackStep[] }
  | { kind: "fallback"; slide: string | null; text: string };

/**
 * The post for a manifest (or none: the build crashed). `slideExists` says whether the QOTD run
 * left yesterday's answer slide in the assets folder.
 */
export function breakdownPlan(
  manifest: QotdBreakdownManifest | null,
  slideExists: (file: string) => boolean,
): BreakdownPlan {
  if (manifest === null)
    return {
      kind: "fallback",
      slide: null,
      text: `*QOTD breakdown*\n${escapeMrkdwn(breakdownSkipLine("build_failed"))}`,
    };
  if (manifest.status === "inactive")
    return {
      kind: "nothing",
      note: QOTD_BREAKDOWN_WINDOW_NOTE[manifest.window],
    };
  if (manifest.status === "built")
    return {
      kind: "video",
      file: manifest.video,
      steps: videoSetSlackSteps(manifest),
    };
  const slide = answerSlideFile(manifest.qotd_date);
  const has = slideExists(slide);
  return {
    kind: "fallback",
    slide: has ? slide : null,
    text: [
      `*QOTD breakdown* · ${manifest.qotd_date}`,
      escapeMrkdwn(breakdownSkipLine(manifest.code)),
      has
        ? "Yesterday's answer slide instead (the carousel's slide 3)."
        : "No answer slide to post: the QOTD run built no carousel for that day.",
    ].join("\n"),
  };
}

async function post(f: Flags): Promise<number> {
  const dir = resolve(f.get("--dir") ?? join(ROOT, "qotd-breakdown-out"));
  const assets = resolve(f.get("--assets") ?? join(ROOT, "qotd-social-out"));
  const file = join(dir, QOTD_BREAKDOWN_MANIFEST);
  const manifest = existsSync(file)
    ? qotdBreakdownManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    : null;
  const plan = breakdownPlan(manifest, (name) =>
    existsSync(join(assets, name)),
  );
  const dryRun = f.has("--dry-run");
  if (plan.kind === "nothing") {
    out(`qotd-breakdown: ${plan.note}: nothing posted`);
    return 0;
  }
  if (dryRun) {
    if (plan.kind === "video") {
      const bytes = readFileSync(join(dir, plan.file)).byteLength;
      for (const step of plan.steps)
        out(
          step.kind === "video"
            ? `[dry run] video ${plan.file} (${bytes} bytes): ${step.comment}`
            : `[dry run] message: ${step.text}`,
        );
    } else
      out(
        `[dry run] ${plan.slide ? `file ${plan.slide} with comment` : "message"}: ${plan.text}`,
      );
    return 0;
  }
  const config = slackConfig(process.env);
  if (!config.ok) throw new Error(config.error);
  if (plan.kind === "video") {
    const video = readFileSync(join(dir, plan.file));
    if (video.byteLength === 0) throw new Error(`${plan.file} is empty`);
    await postVideoSet(config.value, plan.steps, plan.file, video, nodeFetch);
  } else if (plan.slide) {
    await shareFilesConfirmed(
      config.value,
      [{ filename: plan.slide, bytes: readFileSync(join(assets, plan.slide)) }],
      plan.text,
      nodeFetch,
    );
  } else await postMessage(config.value, plan.text, nodeFetch);
  out(`qotd-breakdown: posted (${plan.kind})`);
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  if (cmd === "window") {
    // One word for the workflow: whether tonight's run is in the pilot window.
    const day = breakdownDay(null, new Date());
    if (!day.ok) throw new Error(day.problem);
    out(
      pilotWindow(
        QOTD_BREAKDOWN_PILOT,
        day.postedOn,
        process.env.QOTD_BREAKDOWN_PAUSED === "true",
      ),
    );
    return 0;
  }
  if (cmd === "target") {
    // The one folder the job's sparse checkout fetches: yesterday's (its answer is public).
    const day = breakdownDay(null, new Date());
    if (!day.ok) throw new Error(day.problem);
    out(breakdownScriptDir(day.date));
    return 0;
  }
  if (cmd === "build") return build(f);
  if (cmd === "post") return post(f);
  throw new Error("usage: breakdown.ts window|target|build|post …");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(
        `qotd-breakdown: failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    },
  );
}
