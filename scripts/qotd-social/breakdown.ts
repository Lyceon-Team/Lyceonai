/**
 * The QOTD breakdown pilot: yesterday's Question of the Day as a 30-60 s video in #social, or
 * yesterday's answer slide and "Breakdown skipped: <reason>".
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): each day render
 *       a breakdown of YESTERDAY's QOTD with the worked-example pipeline (Hyperframes, the
 *       video-kit templates, scripts/worked-examples composition / voice / quality / layout
 *       check); it drops into the nightly #social QOTD message; the stored option_order and
 *       correct_display_letter, never the original order; Karl's ruling: his manual posting is
 *       the approval, nothing auto-publishes, no per-video GitHub approval; the fallback rule
 *       (a)-(d), approved as written; the fallback never blocks or delays the QOTD post; no
 *       posting outside #social; SCL-258, SCL-262, SCL-265, SCL-266] | @implemented [2026-11-02]
 *
 * Usage (.github/workflows/qotd-social.yml, job `breakdown`, after the QOTD job):
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts window   (prints off|not_started|active|ended|paused)
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts build [--date YYYY-MM-DD] [--out DIR]
 *       [--base-url URL] [--fixture tests/fixtures/qotd/rows.json --now ISO] [--dry-run]
 *   pnpm exec tsx scripts/qotd-social/breakdown.ts post --dir DIR --assets qotd-social-out [--dry-run]
 *
 * plain English:
 *   * build: the day is yesterday's QOTD (the day before the 04:00 UTC QOTD day the run is in;
 *     `--date` names a past day by hand). A day that has not passed, today included, is refused
 *     (exit 2) before anything is fetched: its answer is not public yet. Outside the pilot window
 *     (shared/qotd/breakdown.ts QOTD_BREAKDOWN_PILOT, off by default, or the repository variable
 *     QOTD_BREAKDOWN_PAUSED=true) it writes an `inactive` manifest and does nothing else
 *     ("pilot ended"). Otherwise it reads the day from the PUBLIC archive (loadYesterday, the
 *     generator's own read), then: the fallback checks (b) and (c); the deterministic script and
 *     its content rules; the captions; each line voiced in Kokoro af_heart only (never the clone)
 *     and transcribed and checked (voice.ts voiceLine, quality.ts); the composition
 *     (buildScriptComposition) and its folder (writeCompositionFolder); the 30-60 s bound;
 *     `hyperframes check`; the layout check; the render; the MP4 check (daily.ts
 *     videoFileProblems). The first failure becomes a `skipped` manifest with its stable code; a
 *     pass becomes a `built` manifest. Fallbacks exit 0: nothing here can fail the QOTD.
 *     --fixture (pull requests only) serves the archive from rows.json through the real
 *     projection (toArchiveResponse), so the dry run proves the whole path on real output.
 *   * post: built: the video and the SCL-262 set (videoSetSlackSteps, the worked examples' own
 *     message builder). skipped: yesterday's answer slide (the QOTD run's carousel slide 3), with
 *     "Breakdown skipped: <reason> (<code>)", or the notice alone when there is no slide. No
 *     breakdown.json at all (the build crashed): the notice with build_failed. inactive: nothing.
 *     --dry-run builds every message and sends nothing.
 *   * Logs carry the day, the status and the code only, never question text; the details go to
 *     summary.md (the run page).
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
  QOTD_BREAKDOWN_PILOT,
  QOTD_BREAKDOWN_WINDOW_NOTE,
  breakdownContentProblems,
  breakdownCopy,
  breakdownQuestion,
  breakdownScript,
  breakdownSkipCode,
  breakdownSkipLine,
  pilotWindow,
} from "../../shared/qotd/breakdown";
import { qotdRowSchema, toArchiveResponse } from "../../shared/qotd/projection";
import {
  escapeMrkdwn,
  postMessage,
  shareFilesConfirmed,
  slackConfig,
} from "../../shared/slack/client";
import {
  buildScriptComposition,
  scriptLines,
} from "../worked-examples/composition";
import { videoFileProblems } from "../worked-examples/daily";
import { writeCompositionFolder } from "../worked-examples/generate";
import { KIT_DIR, ROOT, loadKit } from "../worked-examples/kit";
import { layoutCheck } from "../worked-examples/layout-check";
import {
  nodeFetch,
  postVideoSet,
  videoSetSlackSteps,
  type WorkedExampleSlackStep,
} from "../worked-examples/post-to-slack";
import { hyperframes, voiceLine } from "../worked-examples/voice";
import {
  voiceLineSchema,
  type VoiceLine,
} from "../../packages/shared/src/worked-example-schema";
import {
  archiveFetch,
  loadYesterday,
  pastDateProblem,
  socialRunToday,
  type ArchiveFetch,
} from "./generate";

/** The only voice the breakdown speaks in: Kokoro af_heart (the /brag voice), never the clone. */
export const QOTD_BREAKDOWN_VOICE_PROFILE = "af_heart";
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
 * Everything from yesterday's archive day to a checked MP4, stopping at the first failure with
 * its code. The steps that need no machine (the fallback checks, the script, the copy) come
 * first, so a refused day costs nothing.
 */
export async function buildBreakdown(
  day: QotdArchiveResponse | null,
  date: string,
  postedOn: string,
  outDir: string,
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
  const script = breakdownScript(day, question);
  const kit = loadKit();
  const content = breakdownContentProblems(script, question);
  const copy = breakdownCopy(day, postedOn, kit.track.credit);
  if (content.length > 0 || !copy.ok)
    return skipped(date, postedOn, "content_rules", [
      ...content,
      ...(copy.ok ? [] : copy.problems),
    ]);

  // Voice: Kokoro af_heart only, each line transcribed and checked (quality.ts).
  const profile = kit.voice.profiles[QOTD_BREAKDOWN_VOICE_PROFILE];
  if (profile?.engine !== "kokoro")
    throw new Error(`${QOTD_BREAKDOWN_VOICE_PROFILE} is not a kokoro profile`);
  const voiceDir = join(outDir, "voice");
  mkdirSync(voiceDir, { recursive: true });
  const lines: VoiceLine[] = [];
  for (const line of scriptLines(script, kit.voice.outro_text).filter(
    (l) => l.key !== "outro",
  )) {
    try {
      lines.push(
        voiceLine(
          kit.voice,
          QOTD_BREAKDOWN_VOICE_PROFILE,
          line,
          voiceDir,
          null,
        ),
      );
    } catch (e: unknown) {
      return skipped(date, postedOn, "voice_check_failed", [
        `${line.key}: ${message(e)}`,
      ]);
    }
  }
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
  try {
    hyperframes(
      kit.voice,
      ["render", "--quality", "delivery", "--output", join(outDir, video)],
      compDir,
    );
  } catch (e: unknown) {
    return skipped(date, postedOn, "render_failed", [message(e)]);
  }
  const verified = videoFileProblems(join(outDir, video), compDir);
  if (verified.problems.length > 0)
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
    duration_seconds: Math.round(verified.probe.duration * 100) / 100,
  };
  return { manifest: qotdBreakdownManifestSchema.parse(manifest), details: [] };
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
    `${m.video}: ${m.duration_seconds} s. Order ${m.option_order.join("")}, answer ${m.display_letter} (stored). Download it from this run's **Artifacts**.`,
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

/** The review line under the label (Karl's ruling: his manual posting is the approval). */
export function breakdownReviewLine(m: Built): string {
  return `For review: yesterday's QOTD (${m.qotd_date}) broken down. Karl posts by hand; nothing is published automatically.`;
}

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
      steps: videoSetSlackSteps({
        ...manifest,
        review: breakdownReviewLine(manifest),
      }),
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
  if (cmd === "build") return build(f);
  if (cmd === "post") return post(f);
  throw new Error("usage: breakdown.ts build|post …");
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
