/**
 * The weekly worked-example pipeline: the per-line voice cache, the week's selection, the captions
 * file and the one #social message.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" items 3, 5 and 6; the 2026-11-11
 *       answers (Charon voiced and cached by the weekly run)] | @implemented [2026-11-11]
 *
 * plain English: voiceBatch runs against a folder store and a fake TTS that counts its calls, so
 * "voiced once, re-renders never re-call TTS" is proven by count: a second batch makes zero calls,
 * a changed line re-voices that line only, a changed setting re-voices everything, and a line that
 * fails the checks stores nothing. The week helpers, the captions file and the announcement run on
 * the real fixture example and the real caption builders.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isoWeekCycle } from "../../shared/content/schedule";
import { postMessage, type FetchLike } from "../../shared/slack/client";
import { copyBlockProblems } from "../../shared/social/posts";
import { scriptLines } from "../../scripts/worked-examples/composition";
import {
  loadExamples,
  loadPosted,
  loadStyle,
} from "../../scripts/worked-examples/content";
import {
  buildPost,
  workedExampleCopy,
} from "../../scripts/worked-examples/daily";
import { loadKit } from "../../scripts/worked-examples/kit";
import {
  bucketStore,
  dirStore,
  voiceBatch,
  voiceCacheKey,
  VOICE_TAKES,
  type BucketApi,
  type ChirpProfile,
  type Finished,
} from "../../scripts/worked-examples/voice-cache";
import { voiceLine } from "../../scripts/worked-examples/voice";
import {
  captionsFile,
  captionsMarkdown,
  nextWeek,
  SIGNED_LINK_SECONDS,
  SOCIAL_WEEKLY_BUCKET,
  weekAnnouncement,
  batchVoiceLabel,
  COMMITTED_VOICE_LABEL,
  deliveredExamples,
  dayReply,
  weekThread,
  titleSourceLine,
  weekDates,
  weekExamples,
} from "../../scripts/worked-examples/weekly";
import { seedQuestion } from "../../scripts/worked-examples/content";
import {
  YOUTUBE_SHORTS_FROM,
  youtubeProblems,
} from "../../shared/worked-examples/rules";

import { approvalForCommit } from "../../scripts/worked-examples/approval";
import { checkContent } from "../../scripts/worked-examples/check-content";
import { folderCommitRecord } from "../../scripts/worked-examples/github";
import {
  seedRow,
  seedRowValues,
  type WorkedExampleRow,
} from "../../scripts/worked-examples/seed-sql";
import {
  admitExample,
  checkProblemsFor,
  type AdmitDeps,
} from "../../scripts/worked-examples/weekly-admit";
import { workedExampleApprovalSchema } from "../../packages/shared/src/worked-example-schema";

const ROOT = join(__dirname, "../..");
const CONTENT = join(ROOT, "tests/fixtures/worked-examples/social");
const kit = loadKit();
const fixture = loadExamples(CONTENT).find(
  (e) => e.content.question_id === "SATM2CZS1BE",
);
if (!fixture) throw new Error("no fixture example");

const CHARON: ChirpProfile = {
  engine: "chirp3-hd",
  chirp_voice: "Charon",
  speaking_rate: 1,
};

/** A real 24 kHz mono WAV of `seconds`, so readWav measures it. */
function wav(seconds: number): Uint8Array {
  const rate = 24000;
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), 44 + i * 2);
  return new Uint8Array(b);
}

function store(dir: string) {
  return dirStore(dir, {
    exists: existsSync,
    read: (p) => new Uint8Array(readFileSync(p)),
    write: (p, d) => writeFileSync(p, d),
  });
}

function harness(fail: string | null = null) {
  const calls: string[] = [];
  return {
    calls,
    synth: async (text: string) => {
      calls.push(text);
      return wav(1 + text.length / 100);
    },
    finish: (
      _line: { key: string; text: string },
      raw: Uint8Array,
    ): Finished => ({
      audio: raw,
      words: [{ text: "word", start: 0, end: 0.5 }],
      problems:
        fail !== null && _line.key === fail ? ["says something else"] : [],
    }),
  };
}

const lines = scriptLines(fixture.content, kit.voice.outro_text);

describe("the voice cache: each line voiced once (Karl, 2026-11-11)", () => {
  it("the kit's batch voice is Chirp 3 HD Orus (voice A); the local tools keep am_michael", () => {
    // Karl's voice change 2026-11-11: voice A, Chirp 3 HD Orus (was C, Charon).
    expect(kit.voice.batch_profile).toBe("orus");
    expect(kit.voice.profiles.orus).toMatchObject({
      engine: "chirp3-hd",
      chirp_voice: "Orus",
    });
    expect(kit.voice.default_profile).toBe("am_michael");
  });

  it("the first batch voices every line; a re-render makes no TTS call", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vc-"));
    const h = harness();
    const deps = {
      profileId: "charon",
      profile: CHARON,
      loudness: kit.voice.loudness,
      store: store(cache),
      ...h,
    };
    const first = await voiceBatch(
      lines,
      mkdtempSync(join(tmpdir(), "v1-")),
      deps,
    );
    expect(first.ttsCalls).toBe(lines.length);
    expect(first.cacheHits).toBe(0);
    expect(first.manifest.voice).toBe("charon");
    expect(first.manifest.lines.map((l) => l.key)).toEqual(
      lines.filter((l) => l.key !== "outro").map((l) => l.key),
    );
    expect(first.outro.key).toBe("outro");
    const out2 = mkdtempSync(join(tmpdir(), "v2-"));
    const again = await voiceBatch(lines, out2, deps);
    expect(again.ttsCalls).toBe(0);
    expect(again.cacheHits).toBe(lines.length);
    expect(h.calls).toHaveLength(lines.length);
    expect(existsSync(join(out2, "hook.wav"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(out2, "manifest.json"), "utf8")),
    ).toEqual(first.manifest);
  });

  it("an edited line re-voices that line only; a changed setting re-voices them all", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vc-"));
    const h = harness();
    const base = {
      profileId: "charon",
      profile: CHARON,
      loudness: kit.voice.loudness,
      store: store(cache),
      ...h,
    };
    await voiceBatch(lines, mkdtempSync(join(tmpdir(), "a-")), base);
    const edited = lines.map((l) =>
      l.key === "hook" ? { ...l, text: `${l.text} Go.` } : l,
    );
    const r1 = await voiceBatch(
      edited,
      mkdtempSync(join(tmpdir(), "b-")),
      base,
    );
    expect(r1.ttsCalls).toBe(1);
    const faster = await voiceBatch(lines, mkdtempSync(join(tmpdir(), "c-")), {
      ...base,
      profile: { ...CHARON, speaking_rate: 1.1 },
    });
    expect(faster.ttsCalls).toBe(lines.length);
  });

  it("the key is hash(text + voice + settings): each one changes it", () => {
    const k = voiceCacheKey(CHARON, kit.voice.loudness, "Go.");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(voiceCacheKey(CHARON, kit.voice.loudness, "Go!")).not.toBe(k);
    expect(
      voiceCacheKey(
        { ...CHARON, chirp_voice: "Orus" },
        kit.voice.loudness,
        "Go.",
      ),
    ).not.toBe(k);
    expect(
      voiceCacheKey(
        CHARON,
        { ...kit.voice.loudness, integrated_lufs: -16 },
        "Go.",
      ),
    ).not.toBe(k);
    expect(voiceCacheKey(CHARON, kit.voice.loudness, "Go.")).toBe(k);
  });

  it("a line that fails the checks stops the example and nothing is cached", async () => {
    const cache = mkdtempSync(join(tmpdir(), "vc-"));
    const h = harness("trap");
    await expect(
      voiceBatch(lines, mkdtempSync(join(tmpdir(), "f-")), {
        profileId: "charon",
        profile: CHARON,
        loudness: kit.voice.loudness,
        store: store(cache),
        ...h,
      }),
    ).rejects.toThrow(
      /trap fails the quality checks in charon on every take: take 1: says something else \| take 2: .* \| take 3: /,
    );
    const trap = lines.find((l) => l.key === "trap");
    if (!trap) throw new Error("no trap");
    expect(h.calls.filter((t) => t === trap.text)).toHaveLength(VOICE_TAKES);
    const key = voiceCacheKey(CHARON, kit.voice.loudness, trap.text);
    expect(existsSync(join(cache, `${key}.wav`))).toBe(false);
  });

  it("a bad take is voiced again: the next good take is used and cached, the bad one never is", async () => {
    // Chirp returns a different take per call (2026-11-11: 3 of 69 voice-A lines had a take
    // defect the same text did not have on another call). Here the outro's first take fails.
    expect(VOICE_TAKES).toBe(3);
    const cache = mkdtempSync(join(tmpdir(), "vc-"));
    const outro = lines.find((l) => l.key === "outro");
    if (!outro) throw new Error("no outro");
    const calls: string[] = [];
    let outroTakes = 0;
    const batch = await voiceBatch(lines, mkdtempSync(join(tmpdir(), "r-")), {
      profileId: "charon",
      profile: CHARON,
      loudness: kit.voice.loudness,
      store: store(cache),
      synth: async (text) => {
        calls.push(text);
        return wav(text === outro.text && outroTakes === 0 ? 3 : 1);
      },
      finish: (line, raw) => {
        const bad = line.key === "outro" && outroTakes++ === 0;
        return {
          audio: raw,
          words: [{ text: "word", start: 0, end: 0.5 }],
          problems: bad ? ["silence: 0.76 s before the first word"] : [],
        };
      },
    });
    expect(calls.filter((t) => t === outro.text)).toHaveLength(2);
    expect(batch.ttsCalls).toBe(lines.length + 1);
    // The cached outro is the good take (1 s), not the bad one (3 s).
    expect(batch.outro.duration).toBe(1);
    const again = await voiceBatch(lines, mkdtempSync(join(tmpdir(), "r2-")), {
      profileId: "charon",
      profile: CHARON,
      loudness: kit.voice.loudness,
      store: store(cache),
      ...harness(),
    });
    expect(again.ttsCalls).toBe(0);
  });

  it("the bucket store: a missing object is a miss, any other error stops the run", async () => {
    const api = (
      error: { message: string; statusCode?: string } | null,
    ): BucketApi => ({
      download: async () => ({ data: null, error }),
      upload: async () => ({ error: null }),
    });
    expect(
      await bucketStore(
        api({ message: "Object not found", statusCode: "404" }),
      ).get("a"),
    ).toBeNull();
    await expect(
      bucketStore(api({ message: "permission denied", statusCode: "403" })).get(
        "a",
      ),
    ).rejects.toThrow(/voice cache read failed: permission denied/);
  });

  it("the local voicing tool refuses the Chirp profile (only the weekly run voices it)", () => {
    expect(() =>
      voiceLine(
        kit.voice,
        "charon",
        { key: "hook", text: "Go." },
        tmpdir(),
        null,
      ),
    ).toThrow(/weekly run voices and caches it/);
  });
});

describe("the week (Karl, 2026-11-11)", () => {
  it("ISO weeks: Monday to Sunday; the Thursday run builds next week", () => {
    expect(weekDates("2026-W48")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(nextWeek("2026-11-19")).toBe("2026-W48");
    expect(weekDates("2027-W01")[0]).toBe("2027-01-04");
    expect(() => weekDates("2026-W60")).toThrow();
  });

  it("selects the week's examples not yet posted; a claimed one is not built again", () => {
    const dates = weekDates("2026-W45");
    expect(
      weekExamples(loadExamples(CONTENT), dates, {}).map(
        (e) => e.content.question_id,
      ),
    ).toEqual(["SATM2CZS1BE", "SATM2C6PXLX"]);
    expect(
      weekExamples(loadExamples(CONTENT), dates, {
        "we-satm2czs1be": { date: "2026-11-02", run: "1" },
      }).map((e) => e.content.question_id),
    ).toEqual(["SATM2C6PXLX"]);
    expect(loadPosted(CONTENT)).toBeDefined();
  });

  it("the captions file is the SCL-262/273 set: platform headers outside, only pasteable copy inside", () => {
    const q = seedQuestion(fixture.content.question_id);
    if (!q.ok) throw new Error(q.problem);
    const post = buildPost(
      fixture,
      workedExampleCopy(fixture, q.question, loadStyle(CONTENT)),
      {
        pr: 1,
        mergedBy: "x",
        mergeSha: "0".repeat(40),
        mergedAt: "2026-11-01T00:00:00Z",
      },
    );
    const md = captionsMarkdown(post);
    const parts = md.split("```");
    const blocks = parts.filter((_, k) => k % 2 === 1).map((b) => b.trim());
    const outside = parts
      .filter((_, k) => k % 2 === 0)
      .map((b) => b.trim())
      .filter(Boolean);
    expect(blocks).toHaveLength(4);
    for (const b of blocks) expect(copyBlockProblems(b)).toEqual([]);
    expect(blocks[0]).toBe(post.caption);
    expect(blocks[2]).toBe(post.instagram_caption);
    expect(outside).toEqual([
      ...post.warnings,
      "*TikTok*",
      "*Instagram*",
      "*Facebook*",
    ]);
  });

  it("one header: Week <n> ready, every date, then anything refused", () => {
    const plan = {
      week: "2026-W48",
      dates: weekDates("2026-W48"),
      voice: batchVoiceLabel(loadKit()),
      built: [
        {
          date: "2026-11-23",
          id: "we-a",
          title: "SAT Math worked example · Percentages",
          title_source: "display_name" as const,
        },
      ],
      refused: [
        {
          date: "2026-11-25",
          dir: "content/worked-examples/2026-W48/X",
          reason: "not approved",
        },
      ],
    };
    const text = weekAnnouncement(plan, [
      {
        date: "2026-11-23",
        id: "we-a",
        title: "SAT Math worked example · Percentages",
        video_url: "https://x.supabase.co/v",
        captions_url: "https://x.supabase.co/c",
      },
    ]);
    expect(text.split("\n")[0]).toBe(
      "*Week 48 ready* (2026-11-23 to 2026-11-29). Links expire in 14 days.",
    );
    // The header names each day; the links and captions are in the day's threaded reply.
    expect(text).toContain(
      "• Mon 2026-11-23: SAT Math worked example · Percentages",
    );
    expect(text).not.toContain("https://x.supabase.co");
    expect(text).toContain(
      "One reply per day in this thread: the video link and the captions to paste.",
    );
    expect(text).toContain("• Tue 2026-11-24: nothing scheduled");
    expect(text).toContain(
      "• 2026-11-25 content/worked-examples/2026-W48/X: not approved",
    );
    expect(SIGNED_LINK_SECONDS).toBe(1_209_600);
    expect(SOCIAL_WEEKLY_BUCKET).toBe("social-weekly");
  });

  it("the Week ready message shows the voice and where the titles came from, at the top (Karl, 2026-11-14)", () => {
    const built = (source: "display_name" | "skill_name", k: number) => ({
      date: weekDates("2026-W48")[k] ?? "",
      id: `we-${k}`,
      title: `SAT Math worked example · T${k}`,
      title_source: source,
    });
    const base = {
      week: "2026-W48",
      dates: weekDates("2026-W48"),
      voice: batchVoiceLabel(loadKit()),
      refused: [],
    };
    const all = weekAnnouncement(
      { ...base, built: [built("display_name", 0), built("display_name", 1)] },
      [],
    ).split("\n");
    expect(all[0]).toMatch(/^\*Week 48 ready\*/);
    // From the kit, not typed here: the batch profile is Orus, Lyceon respelled Lye-see-ahn.
    expect(all[1]).toBe(
      'Voice: Chirp 3 HD Orus (orus); "Lyceon" said "Lye-see-ahn"',
    );
    expect(all[2]).toBe("Titles: STYLE display names (2 of 2)");
    const mixed = weekAnnouncement(
      { ...base, built: [built("display_name", 0), built("skill_name", 1)] },
      [],
    ).split("\n");
    expect(mixed[2]).toBe(
      "Titles: 1 STYLE display name, 1 shortened skill name (no display_name in STYLE)",
    );
    expect(titleSourceLine([])).toBe("Titles: nothing built");
    // The pull-request dry run says so instead of naming a voice it did not use.
    expect(
      weekAnnouncement(
        { ...base, voice: COMMITTED_VOICE_LABEL, built: [] },
        [],
      ).split("\n")[1],
    ).toBe(`Voice: ${COMMITTED_VOICE_LABEL}`);
  });
});

describe("recaption: a delivered week re-delivered with rebuilt captions (Karl, 2026-11-14)", () => {
  it("only the week's delivered examples are recaptioned; an undelivered one is left alone", () => {
    const dates = weekDates("2026-W45");
    const examples = loadExamples(CONTENT);
    expect(weekExamples(examples, dates, {})).toHaveLength(2);
    expect(deliveredExamples(examples, dates, {})).toEqual([]);
    expect(
      deliveredExamples(examples, dates, {
        "we-satm2c6pxlx": { date: "2026-11-04", run: "1" },
      }).map((e) => e.content.question_id),
    ).toEqual(["SATM2C6PXLX"]);
    expect(
      deliveredExamples(examples, weekDates("2026-W46"), {
        "we-satm2c6pxlx": { date: "2026-11-04", run: "1" },
      }),
    ).toEqual([]);
  });

  it("one reply per day in the header's thread: date, video link, the captions inline (Karl, 2026-11-14)", () => {
    const q = seedQuestion(fixture.content.question_id);
    if (!q.ok) throw new Error(q.problem);
    const post = buildPost(
      fixture,
      workedExampleCopy(fixture, q.question, loadStyle(CONTENT)),
      {
        pr: 1,
        mergedBy: "x",
        mergeSha: "0".repeat(40),
        mergedAt: "2026-11-01T00:00:00Z",
      },
    );
    const week = isoWeekCycle(post.post_on);
    const dates = weekDates(week);
    const link = {
      date: post.post_on,
      id: post.id,
      title: post.title,
      video_url: "https://x.supabase.co/v",
      captions_url: "https://x.supabase.co/c",
    };
    const plan = {
      week,
      dates,
      voice: batchVoiceLabel(loadKit()),
      built: [
        {
          date: post.post_on,
          id: post.id,
          title: post.title,
          title_source: "display_name" as const,
        },
      ],
      refused: [],
    };
    const thread = weekThread(
      plan,
      [link],
      new Map([[post.post_on, post]]),
      true,
    );
    expect(thread.header.split("\n")[0]).toMatch(
      new RegExp(`^\\*Week ${Number(week.slice(-2))} ready \\(updated\\)\\*`),
    );
    expect(thread.replies).toHaveLength(1);
    const reply = thread.replies[0] ?? "";
    expect(reply).toBe(dayReply(link, dates, post));
    const lines = reply.split("\n");
    expect(lines[0]).toMatch(new RegExp(`^\\*\\w{3} ${post.post_on}\\* · `));
    expect(lines[1]).toBe(
      "<https://x.supabase.co/v|Video> · <https://x.supabase.co/c|captions.md (record)>",
    );
    // Every copy-paste block is in the reply itself: Karl never opens captions.md.
    for (const block of [
      post.caption,
      post.keywords.join("\n"),
      post.instagram_caption,
      post.facebook_caption,
    ])
      expect(reply).toContain(`\`\`\`\n${block}\n\`\`\``);
    expect(reply).toContain("*TikTok*");
    expect(reply).toContain("*Instagram*");
    expect(reply).toContain("*Facebook*");
    // A day with no post cannot be threaded.
    expect(() => weekThread(plan, [link], new Map())).toThrow(/no post/);
  });

  it("a reply goes into the header's thread: postMessage sends thread_ts only when given", async () => {
    const bodies: unknown[] = [];
    const fake: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, ts: "111.222" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const config = { token: "xoxb-test", channel: "C1" };
    expect(await postMessage(config, "header", fake)).toBe("111.222");
    await postMessage(config, "reply", fake, "111.222");
    expect(bodies[0]).not.toHaveProperty("thread_ts");
    expect(bodies[1]).toMatchObject({ text: "reply", thread_ts: "111.222" });
  });
});

describe("YouTube Shorts block from W48 (Karl, 2026-11-14)", () => {
  const q = seedQuestion(fixture.content.question_id);
  if (!q.ok) throw new Error(q.problem);
  const question = q.question;
  const style = loadStyle(CONTENT);
  const approval = {
    pr: 1,
    mergedBy: "x",
    mergeSha: "0".repeat(40),
    mergedAt: "2026-11-20T00:00:00Z",
  };
  const on = (post_on: string) => ({
    ...fixture,
    content: { ...fixture.content, post_on },
  });
  // Built inside each test, so a planted defect fails the test that guards it.
  const postOn = (date: string) =>
    buildPost(on(date), workedExampleCopy(on(date), question, style), approval);
  const LINK =
    "https://lyceon.ai/start?utm_source=youtube&utm_medium=shorts&utm_campaign=worked_example";

  it("Y1 from Monday of W48 every post carries it; W47 and earlier carry none", () => {
    expect(YOUTUBE_SHORTS_FROM).toBe(weekDates("2026-W48")[0]);
    const w48 = postOn("2026-11-23");
    expect(w48.youtube_title).toBeDefined();
    expect(w48.youtube_description).toBeDefined();
    const w47 = postOn("2026-11-22");
    expect(w47.youtube_title).toBeUndefined();
    expect(w47.youtube_description).toBeUndefined();
  });

  it("Y2 the title is the headline plus #Shorts; the description is headline, prompt, the tagged link, hashtags", () => {
    const post = postOn("2026-11-24");
    expect(post.youtube_title).toBe(`${post.title} #Shorts`);
    expect((post.youtube_title ?? "").length).toBeLessThanOrEqual(100);
    const lines = (post.youtube_description ?? "").split("\n\n");
    expect(lines).toEqual([
      post.title,
      "Comment your answer 👇",
      `Taking the SAT Dec 5? Free SAT practice: ${LINK}`,
      expect.stringMatching(/^#SAT /),
    ]);
    // The same hashtags as the other captions.
    expect(lines[3]).toBe(post.facebook_caption.split("\n\n").at(-1));
    // After the cohort's test day the plain lead, the same link.
    expect(postOn("2026-12-07").youtube_description?.split("\n\n")[2]).toBe(
      `Free SAT practice: ${LINK}`,
    );
  });

  it("Y3 no answer and no other link: the block is refused when it carries either", () => {
    const post = postOn("2026-11-24");
    const block = {
      title: post.youtube_title ?? "",
      description: post.youtube_description ?? "",
    };
    expect(youtubeProblems(block, post.title, question)).toEqual([]);
    const correct = question.options.find(
      (o) => o.key === question.correct_answer,
    );
    if (!correct) throw new Error("no correct option");
    const leaked = youtubeProblems(
      {
        ...block,
        description: block.description.replace(
          "Comment your answer 👇",
          "The answer is " + correct.text,
        ),
      },
      post.title,
      question,
    );
    expect(leaked.some((p) => p.includes("gives the answer"))).toBe(true);
    expect(
      youtubeProblems(
        {
          ...block,
          description: `${block.description}\n\nMore: https://example.com/x`,
        },
        post.title,
        question,
      ).some((p) => p.includes("URL") || p.includes("another link")),
    ).toBe(true);
    expect(
      youtubeProblems(
        {
          ...block,
          description: block.description.replace(
            LINK,
            "https://lyceon.ai/start",
          ),
        },
        post.title,
        question,
      ),
    ).toContain(
      `youtube description must carry the tagged Shorts link once (${LINK}), found 0`,
    );
  });

  it("Y4 each day's reply carries it as two copy blocks; captions.md copies the link as written", () => {
    const post = postOn("2026-11-24");
    const reply = captionsMarkdown(post);
    const parts = reply.split("```");
    const outside = parts
      .filter((_, k) => k % 2 === 0)
      .map((b) => b.trim())
      .filter(Boolean);
    expect(outside).toEqual([
      ...post.warnings,
      "*TikTok*",
      "*Instagram*",
      "*Facebook*",
      "*YouTube Shorts*",
    ]);
    const blocks = parts.filter((_, k) => k % 2 === 1).map((b) => b.trim());
    expect(blocks).toHaveLength(6);
    expect(blocks[4]).toBe(post.youtube_title);
    // Slack shows "&amp;" as "&"; the record file holds the link itself.
    expect(blocks[5]).toBe(
      (post.youtube_description ?? "").replace(/&/g, "&amp;"),
    );
    const file = captionsFile(post);
    expect(file).toContain(LINK);
    expect(file).not.toContain("&amp;");
    // A W47 post's reply is unchanged: four blocks, no YouTube.
    expect(captionsMarkdown(postOn("2026-11-16"))).not.toContain("YouTube");
  });
});

/** Every temp folder the SCL-288 tests make, removed after them (a mutation run repeats them ~80 times). */
const scratch: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/**
 * The merge gate dropped (Karl, 2026-11-24, SCL-288): the scheduled task's trailer approves; the
 * weekly job runs every pull-request check and writes the approved row before building.
 */
describe("approval by the scheduled task's trailer (Karl, 2026-11-24, SCL-288)", () => {
  /** A real git commit in a fresh repo: the trailer is read by git, not by a regex of ours. */
  function commitWith(message: string): { root: string; sha: string } {
    const root = tempDir("we-trailer-");
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.test",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.test",
          GIT_COMMITTER_DATE: "2026-11-26T14:07:00+00:00",
        },
      }).trim();
    git("init", "-q");
    writeFileSync(join(root, "example.json"), "{}\n");
    git("add", "example.json");
    git("commit", "-q", "-m", message);
    return { root, sha: git("rev-parse", "HEAD") };
  }
  const noPull = async (): Promise<unknown> => null;

  it("AP1 a commit carrying Authored-By: worked-examples-task is approved, by the task, with its sha and date", async () => {
    const { root, sha } = commitWith(
      "Worked examples W50\n\nAuthored-By: worked-examples-task\n",
    );
    const record = folderCommitRecord(root, sha);
    expect(record.authoredBy).toEqual(["worked-examples-task"]);
    let asked = false;
    const verdict = await approvalForCommit(
      record,
      async () => {
        asked = true;
        return null;
      },
      "kingk237",
    );
    expect(verdict).toEqual({
      ok: true,
      approval: {
        by: "worked-examples-task",
        sha,
        at: "2026-11-26T14:07:00+00:00",
      },
    });
    // The trailer alone decides: GitHub is not asked.
    expect(asked).toBe(false);
    // And the approval is one a post may carry.
    expect(
      workedExampleApprovalSchema.safeParse(verdict.ok && verdict.approval)
        .success,
    ).toBe(true);
  });

  it("AP2 a commit with neither the trailer nor Karl's merge is refused", async () => {
    for (const message of [
      "Worked examples W50\n",
      "Worked examples W50\n\nAuthored-By: someone-else\n",
      // In the body but not a trailer (not in the final paragraph): git does not read it as one.
      "Authored-By: worked-examples-task\n\nWorked examples W50\n",
    ]) {
      const { root, sha } = commitWith(message);
      const verdict = await approvalForCommit(
        folderCommitRecord(root, sha),
        noPull,
        "kingk237",
      );
      expect(verdict.ok, message).toBe(false);
      expect(verdict.ok ? "" : verdict.reason, message).toMatch(
        /carries no "Authored-By: worked-examples-task" trailer, and .*direct push approves nothing/,
      );
    }
    // A merge by someone other than Karl is no approval either.
    const { root, sha } = commitWith("Merge pull request #9\n");
    const verdict = await approvalForCommit(
      folderCommitRecord(root, sha),
      async () => ({
        number: 9,
        merged: true,
        merged_at: "2026-11-26T14:07:00Z",
        merged_by: { login: "someone" },
        merge_commit_sha: sha,
        base: { ref: "social" },
      }),
      "kingk237",
    );
    expect(verdict).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not the approver/),
    });
  });

  it("AP3 Karl's merge still approves", async () => {
    const { root, sha } = commitWith("Merge pull request #9\n");
    const verdict = await approvalForCommit(
      folderCommitRecord(root, sha),
      async () => ({
        number: 9,
        merged: true,
        merged_at: "2026-11-26T14:07:00Z",
        merged_by: { login: "kingk237" },
        merge_commit_sha: sha,
        base: { ref: "social" },
      }),
      "kingk237",
    );
    expect(verdict).toEqual({
      ok: true,
      approval: {
        pr: 9,
        mergedBy: "kingk237",
        mergeSha: sha,
        mergedAt: "2026-11-26T14:07:00Z",
      },
    });
  });

  it("AP4 the row records the task as the approver, at the commit's date; Karl's merge stays \"Karl\"", () => {
    const sha = "c".repeat(40);
    const task = seedRowValues(
      fixture.content,
      { by: "worked-examples-task", sha, at: "2026-11-26T14:07:00+00:00" },
      kit.voice.outro_text,
    );
    expect(task).toMatchObject({
      status: "approved",
      approved_by: "worked-examples-task",
      approved_at: "2026-11-26T14:07:00+00:00",
    });
    expect(
      seedRow(
        fixture.content,
        { by: "worked-examples-task", sha, at: "2026-11-26T14:07:00+00:00" },
        kit.voice.outro_text,
      ),
    ).toContain("$we$worked-examples-task$we$");
    const merge = seedRowValues(
      fixture.content,
      {
        pr: 9,
        mergedBy: "kingk237",
        mergeSha: sha,
        mergedAt: "2026-11-26T15:00:00Z",
      },
      kit.voice.outro_text,
    );
    expect(merge).toMatchObject({
      approved_by: "Karl",
      approved_at: "2026-11-26T15:00:00Z",
    });
  });
});

describe("the weekly job admits an example: checks, approval, approved row (Karl, 2026-11-24, SCL-288)", () => {
  const TASK = {
    by: "worked-examples-task",
    sha: "d".repeat(40),
    at: "2026-11-26T14:07:00Z",
  } as const;
  function deps(over: Partial<AdmitDeps> = {}) {
    const calls = { approve: 0, rows: [] as WorkedExampleRow[] };
    const d: AdmitDeps = {
      checkProblems: [],
      approve: async () => {
        calls.approve += 1;
        return { ok: true, approval: TASK };
      },
      writeRow: async (row) => {
        calls.rows.push(row);
        return { ok: true };
      },
      outroText: kit.voice.outro_text,
      ...over,
    };
    return { d, calls };
  }

  it("AD0 the fixture passes every pull-request check, so the job admits it and writes its approved row", async () => {
    const { d, calls } = deps({ checkProblems: checkContent(CONTENT) });
    expect(checkContent(CONTENT)).toEqual([]);
    expect(await admitExample(fixture, d)).toEqual({
      ok: true,
      approval: TASK,
    });
    expect(calls.rows).toEqual([
      seedRowValues(fixture.content, TASK, kit.voice.outro_text),
    ]);
    expect(calls.rows[0]?.status).toBe("approved");
  });

  it("AD1 a failing check refuses the example: nothing is approved and no row is written", async () => {
    // The check's real output on a broken copy of the fixture: a hook that gives the answer away.
    const broken = tempDir("we-check-");
    cpSync(CONTENT, broken, { recursive: true });
    const file = join(broken, fixture.dir, "example.json");
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      hook: { line: string };
    };
    json.hook.line = "The answer is right there. Can you see it?";
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    const problems = checkContent(broken);
    expect(problems.length).toBeGreaterThan(0);
    const { d, calls } = deps({ checkProblems: problems });
    const admitted = await admitExample(fixture, d);
    expect(admitted).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^check failed: .*H5 gives the answer/),
    });
    expect(calls.approve).toBe(0);
    expect(calls.rows).toEqual([]);
  });

  it("AD2 a database refusal refuses the example", async () => {
    const { d, calls } = deps({
      writeRow: async (row) => {
        calls.rows.push(row);
        return {
          ok: false,
          reason: `worked_example_leak: ${row.question_id} is in a full-length test form`,
        };
      },
    });
    const admitted = await admitExample(fixture, d);
    expect(admitted).toEqual({
      ok: false,
      reason: `the database refused the approved row: worked_example_leak: ${fixture.content.question_id} is in a full-length test form`,
    });
    expect(calls.rows).toHaveLength(1);
  });

  it("AD3 an unapproved example is refused before any row is written", async () => {
    const { d, calls } = deps({
      approve: async () => ({ ok: false, reason: "no trailer, no merge" }),
    });
    expect(await admitExample(fixture, d)).toEqual({
      ok: false,
      reason: "not approved: no trailer, no merge",
    });
    expect(calls.rows).toEqual([]);
  });

  it("AD5 the weekly build refuses a failing example and records why (dry run on the fixture)", () => {
    const broken = tempDir("we-build-");
    cpSync(CONTENT, broken, { recursive: true });
    const file = join(broken, fixture.dir, "example.json");
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      hook: { line: string };
    };
    json.hook.line = "The answer is right there. Can you see it?";
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    const out = tempDir("we-build-out-");
    execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/worked-examples/weekly.ts",
        "build",
        "--content",
        broken,
        "--out",
        out,
        "--dry-run",
        "--today",
        "2026-10-29",
        "--voice",
        "committed",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const week = JSON.parse(readFileSync(join(out, "week.json"), "utf8")) as {
      built: { date: string }[];
      refused: { dir: string; reason: string }[];
    };
    // The week's other example still builds; only the failing one is refused.
    expect(week.built.map((b) => b.date)).not.toContain(
      fixture.content.post_on,
    );
    expect(week.built.length).toBeGreaterThan(0);
    expect(week.refused).toEqual([
      expect.objectContaining({
        dir: fixture.dir,
        reason: expect.stringMatching(/^check failed: .*H5 gives the answer/),
      }),
    ]);
    expect(existsSync(join(out, fixture.content.post_on, "post.json"))).toBe(
      false,
    );
  }, 120_000);

  it("AD4 another example's problem does not refuse this one; its day, its month's plan and an unreadable tree do", () => {
    const other =
      "content/worked-examples/2026-W45/SATM2ZZZZZZ: H4 does not end in curiosity";
    expect(checkProblemsFor([other], fixture)).toEqual([]);
    const own = [
      `${fixture.dir}: H4 does not end in curiosity`,
      `2 examples post on ${fixture.content.post_on} (${fixture.dir}, content/worked-examples/2026-W45/SATM2ZZZZZZ): one a day`,
      `content/worked-examples/${fixture.content.post_on.slice(0, 7)}-plan: slots are not in date order, one per day`,
      "content/worked-examples/2026-W45/x/example.json: Unexpected token",
    ];
    expect(checkProblemsFor([other, ...own], fixture)).toEqual(own.slice(0, 3));
    expect(
      checkProblemsFor(["2026-W45 is not an ISO week folder"], fixture),
    ).toEqual(["2026-W45 is not an ISO week folder"]);
  });
});
