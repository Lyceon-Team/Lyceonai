/**
 * The weekly worked-example batch: one run produces every video for next week, uploads them to
 * the private social-weekly bucket and posts one "Week <n> ready" message to #social.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2": item 3 (the weekly batch replaces
 *       the daily render job, one run a week); item 5 (stages select → script → voice (cached) →
 *       layout/timing → render → final mix → checks; a voice change re-renders without
 *       re-scripting); item 6 (private bucket social-weekly/<week>/<date>/<id>.mp4 plus a captions
 *       file in the SCL-262/273 copy-paste format; one message "Week <n> ready" with signed links
 *       that expire after 14 days); the step-3 rulings (the existing SUPABASE_URL /
 *       SUPABASE_SERVICE_ROLE_KEY pair, read only on the scheduled run from main); the 2026-11-11
 *       answers (batch voice voiced and cached by this run: Chirp 3 HD Orus, voice A, since Karl's voice
 *       change later the same day, replacing Charon; the daily job kept
 *       until the first weekly batch works)] | @implemented [2026-11-11]
 *
 * plain English, subcommands the workflow runs in order (the render, final mix, layout check and
 * MP4 check run per date between build and upload, with the daily job's own tools):
 *   build    --content <social> --out <dir> [--week YYYY-Www] [--voice batch|committed]
 *            [--dry-run --today YYYY-MM-DD]
 *            select: the examples whose post_on falls in the week (next week by default, from
 *            today in America/Chicago), not retired, not in posted.json; each must be approved by
 *            Karl's merge (GitHub's record) and pass every content rule, or it is refused for the
 *            week (listed, the others still built). voice: --voice batch voices every line in
 *            voice.json's batch_profile through the cache (voice-cache.ts; the TTS call goes
 *            through the existing GCP login, the cache is the private bucket); --voice committed
 *            uses the example's committed audio (the pull-request dry run on the fixture tree).
 *            layout/timing + composition: composeExample. Writes <out>/<date>/composition,
 *            <out>/<date>/post.json and <out>/week.json.
 *   upload   --out <dir> [--dry-run]   each built date's finished <id>.mp4 and captions.md to
 *            social-weekly/<week>/<date>/, then a signed link for each (14 days); <out>/links.json.
 *   claim    --content <social> --out <dir> --run <id>   adds every uploaded example to
 *            posted.json (the workflow pushes it before announcing, so a re-run announces nothing).
 *   announce --out <dir> [--dry-run]   one #social message: "Week <n> ready", a line per date with
 *            the video and captions links, then anything refused.
 *
 * edge cases: a date with no example is listed as such; a refused example is named with its
 * reason (rule text only, never question content); --dry-run never reads a secret, never uploads,
 * claims or posts. The Supabase key is read from the environment only in upload, and the
 * workflow sets it only on the scheduled run from main (tests/ci/social-weekly-secret-guard).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  voiceLineSchema,
  workedExampleId,
  workedExamplePostSchema,
  type WorkedExamplePost,
  type WorkedExamplePostedLedger,
} from "../../packages/shared/src/worked-example-schema";
import { chicagoToday } from "../../shared/sat-test-dates";
import { isoWeekCycle } from "../../shared/content/schedule";
import {
  postMessage,
  slackConfig,
  escapeMrkdwn,
} from "../../shared/slack/client";
import {
  approvalFromRecord,
  recordPosted,
  type ExampleApproval,
  type ExampleOnBranch,
} from "./approval";
import { scriptLines } from "./composition";
import {
  exampleProblems,
  loadExamples,
  loadPosted,
  loadStyle,
  loadVoice,
  POSTED_PATH,
} from "./content";
import { buildPost, workedExampleCopy } from "./daily";
import { composeExample } from "./generate";
import { folderCommit, pullForCommit } from "./github";
import { accessToken, chirpRequest, synthesize } from "./google-tts";
import { KIT_DIR, ROOT, loadKit, type Kit } from "./kit";
import { nodeFetch, videoSetSlackSteps } from "./post-to-slack";
import { bucketStore, voiceBatch, type BucketApi } from "./voice-cache";
import { transcribeAndCheck } from "./voice";

/** The private bucket (supabase/migrations/…_social_weekly_bucket.sql). */
export const SOCIAL_WEEKLY_BUCKET = "social-weekly";
/** Signed links expire after 14 days (Karl's ruling 2026-11-11, item 6). */
export const SIGNED_LINK_SECONDS = 14 * 24 * 60 * 60;

const DAY_MS = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The seven dates (Monday first) of an ISO week "YYYY-Www". */
export function weekDates(week: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m?.[1] || !m[2]) throw new Error(`not an ISO week: ${week}`);
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  const monday = jan4 - jan4Dow * DAY_MS + (n - 1) * 7 * DAY_MS;
  const dates = Array.from({ length: 7 }, (_, k) =>
    isoDate(monday + k * DAY_MS),
  );
  if (isoWeekCycle(dates[0] ?? "") !== week)
    throw new Error(`no such week: ${week}`);
  return dates;
}

/** The ISO week after the one `today` is in (the run on Thursday builds next Monday-Sunday). */
export function nextWeek(today: string): string {
  return isoWeekCycle(isoDate(Date.parse(`${today}T12:00:00Z`) + 7 * DAY_MS));
}

/** The examples to build for the week: post_on in it, not retired, not posted; by date then id. */
export function weekExamples(
  examples: readonly ExampleOnBranch[],
  dates: readonly string[],
  posted: Readonly<WorkedExamplePostedLedger>,
): ExampleOnBranch[] {
  return examples
    .filter(
      (e) =>
        dates.includes(e.content.post_on) &&
        e.content.retired !== true &&
        posted[workedExampleId(e.content.question_id)] === undefined,
    )
    .sort(
      (a, b) =>
        a.content.post_on.localeCompare(b.content.post_on) ||
        a.content.question_id.localeCompare(b.content.question_id),
    );
}

/** The captions file for one video: the SCL-262/273 copy-paste set, warnings first. */
export function captionsMarkdown(post: WorkedExamplePost): string {
  const parts: string[] = [];
  for (const w of post.warnings) parts.push(w);
  for (const step of videoSetSlackSteps(post))
    parts.push(step.kind === "video" ? step.comment : step.text);
  return `${parts.join("\n\n")}\n`;
}

export const weekPlanSchema = z
  .object({
    week: z.string().regex(/^\d{4}-W\d{2}$/),
    dates: z.array(z.string()).length(7),
    built: z.array(
      z
        .object({ date: z.string(), id: z.string(), title: z.string() })
        .strict(),
    ),
    refused: z.array(
      z
        .object({ date: z.string(), dir: z.string(), reason: z.string() })
        .strict(),
    ),
  })
  .strict();
export type WeekPlan = z.infer<typeof weekPlanSchema>;

export const weekLinksSchema = z.array(
  z
    .object({
      date: z.string(),
      id: z.string(),
      title: z.string(),
      video_url: z.string().url(),
      captions_url: z.string().url(),
    })
    .strict(),
);
export type WeekLinks = z.infer<typeof weekLinksSchema>;

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The one #social message: "Week <n> ready", a line per date, then anything refused. */
export function weekAnnouncement(plan: WeekPlan, links: WeekLinks): string {
  const n = Number(plan.week.slice(-2));
  const lines = [
    `*Week ${n} ready* (${plan.dates[0]} to ${plan.dates[6]}). Links expire in 14 days.`,
  ];
  plan.dates.forEach((date, k) => {
    const day = `${WEEKDAY[k]} ${date}`;
    const l = links.filter((x) => x.date === date);
    if (l.length === 0) lines.push(`• ${day}: nothing scheduled`);
    for (const x of l)
      lines.push(
        `• ${day}: ${escapeMrkdwn(x.title)}: <${x.video_url}|video> · <${x.captions_url}|captions>`,
      );
  });
  if (plan.refused.length > 0) {
    lines.push("", "*Not built this week:*");
    for (const r of plan.refused)
      lines.push(`• ${r.date} ${r.dir}: ${escapeMrkdwn(r.reason)}`);
  }
  return lines.join("\n");
}

type Flags = {
  get(name: string): string | undefined;
  has(name: string): boolean;
};

function flags(argv: readonly string[]): Flags {
  return {
    get: (name) => {
      const i = argv.indexOf(name);
      return i === -1 ? undefined : argv[i + 1];
    },
    has: (name) => argv.includes(name),
  };
}

function need(f: Flags, name: string): string {
  const v = f.get(name);
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function approvalFor(
  content: string,
  e: ExampleOnBranch,
): Promise<ExampleApproval> {
  const sha = folderCommit(content, e.dir);
  const verdict = approvalFromRecord(
    await pullForCommit(env("GITHUB_REPOSITORY"), sha, env("GITHUB_TOKEN")),
    sha,
    process.env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
  );
  if (!verdict.ok) throw new Error(`not approved: ${verdict.reason}`);
  return verdict.approval;
}

/** The private bucket through supabase-js, from the scheduled run's environment only. */
function bucket(): ReturnType<
  ReturnType<typeof createClient>["storage"]["from"]
> {
  const client = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return client.storage.from(SOCIAL_WEEKLY_BUCKET);
}

/** Voices one example's lines in the batch voice through the cache (the scheduled run). */
async function batchVoice(
  kit: Kit,
  e: ExampleOnBranch,
  dir: string,
  store: BucketApi,
) {
  const profileId = kit.voice.batch_profile;
  const profile = kit.voice.profiles[profileId];
  if (!profile || profile.engine !== "chirp3-hd")
    throw new Error(`batch_profile ${profileId} is not a Chirp 3 HD profile`);
  const token = await accessToken();
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  const batch = await voiceBatch(
    scriptLines(e.content, kit.voice.outro_text),
    join(dir, "voice"),
    {
      profileId,
      profile,
      loudness: kit.voice.loudness,
      store: bucketStore(store),
      synth: (text) =>
        synthesize(
          chirpRequest(profile.chirp_voice, text, profile.speaking_rate),
          token,
          "v1",
          (url, init) => fetch(url, init),
        ),
      finish: (line, raw) => {
        const rawPath = join(work, `${line.key}.raw.wav`);
        writeFileSync(rawPath, raw);
        return transcribeAndCheck(kit.voice, line, rawPath, work);
      },
    },
  );
  process.stdout.write(
    `  ${e.content.question_id}: ${batch.cacheHits} cached, ${batch.ttsCalls} voiced\n`,
  );
  return {
    lines: batch.manifest.lines,
    outro: batch.outro,
    voiceDir: join(dir, "voice"),
    outroWav: join(dir, "voice", batch.outro.file),
  };
}

async function build(f: Flags): Promise<void> {
  const content = resolve(need(f, "--content"));
  const out = resolve(need(f, "--out"));
  const dryRun = f.has("--dry-run");
  const voiceMode = f.get("--voice") ?? "batch";
  if (voiceMode !== "batch" && voiceMode !== "committed")
    throw new Error("--voice is batch or committed");
  const today = dryRun ? need(f, "--today") : chicagoToday();
  const week = f.get("--week") ?? nextWeek(today);
  const dates = weekDates(week);
  const kit = loadKit();
  const due = weekExamples(loadExamples(content), dates, loadPosted(content));
  const store = voiceMode === "batch" && !dryRun ? bucket() : null;
  const plan: WeekPlan = { week, dates, built: [], refused: [] };
  for (const e of due) {
    const date = e.content.post_on;
    const dir = join(out, date);
    try {
      const approval: ExampleApproval = dryRun
        ? {
            pr: 1,
            mergedBy: "dry-run",
            mergeSha: "0".repeat(40),
            mergedAt: `${today}T00:00:00Z`,
          }
        : await approvalFor(content, e);
      const { problems, question } = exampleProblems(content, e, kit);
      if (problems.length > 0 || !question)
        throw new Error(problems.join("; "));
      mkdirSync(dir, { recursive: true });
      let voice;
      if (voiceMode === "committed") {
        const manifest = loadVoice(content, e.dir);
        voice = {
          lines: manifest.lines,
          outro: voiceLineSchema.parse(
            JSON.parse(
              readFileSync(join(ROOT, KIT_DIR, "voice", "outro.json"), "utf8"),
            ),
          ),
          voiceDir: join(content, e.dir, "voice"),
          outroWav: join(ROOT, kit.voice.outro_file),
        };
      } else {
        if (!store)
          throw new Error(
            "--voice batch needs the scheduled run (no --dry-run)",
          );
        voice = await batchVoice(kit, e, dir, store);
      }
      composeExample({
        example: e.content,
        question,
        ...voice,
        out: join(dir, "composition"),
        kit,
      });
      const post = buildPost(
        e,
        workedExampleCopy(e, question, loadStyle(content)),
        approval,
      );
      writeFileSync(
        join(dir, "post.json"),
        `${JSON.stringify(post, null, 2)}\n`,
      );
      plan.built.push({ date, id: post.id, title: post.title });
      process.stdout.write(`build: ${date} ${post.id} built\n`);
    } catch (err: unknown) {
      if (!(err instanceof Error)) throw err;
      plan.refused.push({
        date,
        dir: e.dir,
        reason: err.message.split("\n")[0] ?? "refused",
      });
      process.stdout.write(`build: ${date} ${e.dir} refused: ${err.message}\n`);
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "week.json"),
    `${JSON.stringify(weekPlanSchema.parse(plan), null, 2)}\n`,
  );
  process.stdout.write(
    `build: ${week}: ${plan.built.length} built, ${plan.refused.length} refused\n`,
  );
}

function readPlan(out: string): WeekPlan {
  return weekPlanSchema.parse(
    JSON.parse(readFileSync(join(out, "week.json"), "utf8")),
  );
}

function readPost(dir: string): WorkedExamplePost {
  return workedExamplePostSchema.parse(
    JSON.parse(readFileSync(join(dir, "post.json"), "utf8")),
  );
}

async function upload(f: Flags): Promise<void> {
  const out = resolve(need(f, "--out"));
  const dryRun = f.has("--dry-run");
  const plan = readPlan(out);
  const store = dryRun ? null : bucket();
  const links: WeekLinks = [];
  for (const b of plan.built) {
    const dir = join(out, b.date);
    const post = readPost(dir);
    const video = join(dir, post.video);
    if (!existsSync(video))
      throw new Error(`${b.date}: ${post.video} was not rendered`);
    const captions = captionsMarkdown(post);
    writeFileSync(join(dir, "captions.md"), captions);
    const base = `${plan.week}/${b.date}`;
    if (!store) {
      links.push({
        date: b.date,
        id: b.id,
        title: b.title,
        video_url: `https://dry-run.invalid/${base}/${post.video}`,
        captions_url: `https://dry-run.invalid/${base}/captions.md`,
      });
      continue;
    }
    const put = async (
      path: string,
      body: Uint8Array | string,
      contentType: string,
    ) => {
      const { error } = await store.upload(path, body, {
        contentType,
        upsert: true,
      });
      if (error) throw new Error(`upload ${path} failed: ${error.message}`);
      const signed = await store.createSignedUrl(path, SIGNED_LINK_SECONDS);
      if (signed.error || !signed.data)
        throw new Error(`signing ${path} failed`);
      return signed.data.signedUrl;
    };
    links.push({
      date: b.date,
      id: b.id,
      title: b.title,
      video_url: await put(
        `${base}/${post.video}`,
        readFileSync(video),
        "video/mp4",
      ),
      captions_url: await put(`${base}/captions.md`, captions, "text/markdown"),
    });
  }
  writeFileSync(
    join(out, "links.json"),
    `${JSON.stringify(weekLinksSchema.parse(links), null, 2)}\n`,
  );
  process.stdout.write(
    `upload: ${links.length} uploaded${dryRun ? " (dry run)" : ""}\n`,
  );
}

function claim(f: Flags): void {
  const content = resolve(need(f, "--content"));
  const out = resolve(need(f, "--out"));
  const run = need(f, "--run");
  const links = weekLinksSchema.parse(
    JSON.parse(readFileSync(join(out, "links.json"), "utf8")),
  );
  let ledger = loadPosted(content);
  const today = chicagoToday();
  for (const l of links) {
    const next = recordPosted(ledger, l.id, today, run);
    if (!next.ok) throw new Error(next.reason);
    ledger = next.ledger;
  }
  writeFileSync(
    join(content, POSTED_PATH),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  process.stdout.write(`claim: ${links.length} claimed\n`);
}

async function announce(f: Flags): Promise<void> {
  const out = resolve(need(f, "--out"));
  const plan = readPlan(out);
  const links = weekLinksSchema.parse(
    JSON.parse(readFileSync(join(out, "links.json"), "utf8")),
  );
  const text = weekAnnouncement(plan, links);
  if (f.has("--dry-run")) {
    process.stdout.write(`[dry run] message:\n${text}\n`);
    return;
  }
  const config = slackConfig(process.env);
  if (!config.ok) throw new Error(config.error);
  await postMessage(config.value, text, nodeFetch);
  process.stdout.write(`announce: Week ${plan.week} posted to Slack\n`);
}

/** The dates built this week, for the workflow's render loop. */
function dates(f: Flags): void {
  const out = resolve(need(f, "--out"));
  const plan = readPlan(out);
  process.stdout.write(`${plan.built.map((b) => b.date).join(" ")}\n`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  if (cmd === "build") return build(f);
  if (cmd === "upload") return upload(f);
  if (cmd === "claim") return claim(f);
  if (cmd === "announce") return announce(f);
  if (cmd === "dates") return dates(f);
  throw new Error("usage: weekly.ts build|upload|claim|announce|dates …");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `weekly: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
