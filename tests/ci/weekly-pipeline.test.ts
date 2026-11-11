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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyBlockProblems } from "../../shared/social/posts";
import { scriptLines } from "../../scripts/worked-examples/composition";
import {
  loadExamples,
  loadPosted,
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
  type BucketApi,
  type ChirpProfile,
  type Finished,
} from "../../scripts/worked-examples/voice-cache";
import { voiceLine } from "../../scripts/worked-examples/voice";
import {
  captionsMarkdown,
  nextWeek,
  SIGNED_LINK_SECONDS,
  SOCIAL_WEEKLY_BUCKET,
  weekAnnouncement,
  weekDates,
  weekExamples,
} from "../../scripts/worked-examples/weekly";
import { seedQuestion } from "../../scripts/worked-examples/content";

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
  it("the kit's batch voice is Chirp 3 HD Charon; the local tools keep am_michael", () => {
    expect(kit.voice.batch_profile).toBe("charon");
    expect(kit.voice.profiles.charon).toMatchObject({
      engine: "chirp3-hd",
      chirp_voice: "Charon",
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
      /trap fails the quality checks in charon: says something else/,
    );
    const trap = lines.find((l) => l.key === "trap");
    if (!trap) throw new Error("no trap");
    const key = voiceCacheKey(CHARON, kit.voice.loudness, trap.text);
    expect(existsSync(join(cache, `${key}.wav`))).toBe(false);
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
    const post = buildPost(fixture, workedExampleCopy(fixture, q.question), {
      pr: 1,
      mergedBy: "x",
      mergeSha: "0".repeat(40),
      mergedAt: "2026-11-01T00:00:00Z",
    });
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

  it("one message: Week <n> ready, every date, the links, then anything refused", () => {
    const plan = {
      week: "2026-W48",
      dates: weekDates("2026-W48"),
      built: [
        {
          date: "2026-11-23",
          id: "we-a",
          title: "SAT Math worked example · Percentages",
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
    expect(text).toContain(
      "• Mon 2026-11-23: SAT Math worked example · Percentages: <https://x.supabase.co/v|video> · <https://x.supabase.co/c|captions>",
    );
    expect(text).toContain("• Tue 2026-11-24: nothing scheduled");
    expect(text).toContain(
      "• 2026-11-25 content/worked-examples/2026-W48/X: not approved",
    );
    expect(SIGNED_LINK_SECONDS).toBe(1_209_600);
    expect(SOCIAL_WEEKLY_BUCKET).toBe("social-weekly");
  });
});
