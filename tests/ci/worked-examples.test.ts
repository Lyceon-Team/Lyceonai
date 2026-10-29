/**
 * Worked examples: every acceptance rule of the production brief, on real output.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27), acceptance: "hook
 *       rules; 30-60 s and the safe area; blank-paper template; audio mix (voice peak above music
 *       by a set dB margin); a licence file for each track used; the daily job posts only
 *       approved, post_on-today examples, once; title and caption rules"; the metrics table schema
 *       and RLS are proven by scripts/ci/worked-examples-schema-gates.sql] | @implemented [2026-10-27]
 *
 * plain English: fixtures are derived from real output, never typed shapes: the example is the
 * fixture tree's real content file (tests/fixtures/worked-examples/social, the same tree the
 * workflow's pull-request run renders), its question is read from the real seed SQL, its voice is
 * the committed Kokoro audio, and the composition is the real generator's output from the real
 * kit. scripts/ci/worked-examples.mutations.sh plants one defect per rule and requires these tests
 * to go red on the named assertion.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  workedExamplePostSchema,
  voiceLineSchema,
  type WorkedExampleContent,
} from "../../packages/shared/src/worked-example-schema";
import {
  captionProblems,
  hookAnswerProblem,
  hookCuriosityProblem,
  hookPeopleProblem,
  hookPuzzleProblem,
  hookStatisticProblem,
  planProblems,
  titleProblems,
  workedExampleCaption,
  workedExampleLabel,
  workedExampleTitle,
} from "../../shared/worked-examples/rules";
import type { SeedQuestion } from "../../shared/worked-examples/seed-question";
import {
  approvalFromRecord,
  dueExamples,
  recordPosted,
} from "../../scripts/worked-examples/approval";
import { mixProblem, readWav } from "../../scripts/worked-examples/audio";
import {
  sameDayProblems,
  checkContent,
} from "../../scripts/worked-examples/check-content";
import {
  buildComposition,
  safeArea,
  type Composition,
} from "../../scripts/worked-examples/composition";
import {
  exampleProblems,
  loadExamples,
  loadPosted,
  loadVoice,
  seedQuestion,
  voiceProblems,
} from "../../scripts/worked-examples/content";
import { buildPost, renderProblems } from "../../scripts/worked-examples/daily";
import { durationProblem } from "../../scripts/worked-examples/generate";
import { KIT_DIR, ROOT, loadKit } from "../../scripts/worked-examples/kit";
import {
  boxProblems,
  nonPaperPixels,
} from "../../scripts/worked-examples/layout-check";
import { postWorkedExample } from "../../scripts/worked-examples/post-to-slack";
import { seedRow } from "../../scripts/worked-examples/seed-sql";
import type { FetchLike } from "../../shared/slack/client";

const CONTENT = join(ROOT, "tests/fixtures/worked-examples/social");
const kit = loadKit();
const [fixture] = loadExamples(CONTENT);
if (!fixture) throw new Error("the fixture tree has no example");
const seeded = seedQuestion(fixture.content.question_id);
if (!seeded.ok) throw new Error(seeded.problem);
const question: SeedQuestion = seeded.question;
const voice = loadVoice(CONTENT, fixture.dir);
const outro = voiceLineSchema.parse(
  JSON.parse(readFileSync(join(ROOT, KIT_DIR, "voice/outro.json"), "utf8")),
);
const comp: Composition = buildComposition({
  example: fixture.content,
  question,
  voice: voice.lines,
  outro,
  kit,
});
const wav = (file: string): Uint8Array =>
  readFileSync(join(CONTENT, fixture.dir, "voice", file));

function withHook(
  line: string,
  voiceLine = line,
): WorkedExampleContent["hook"] {
  return { type: "puzzle", line, voice: voiceLine };
}

describe("the fixture is real and passes every rule", () => {
  it("the question comes from the seed SQL: SATM2CZS1BE, key B, four choices", () => {
    expect(question.id).toBe("SATM2CZS1BE");
    expect(question.correct_answer).toBe("B");
    expect(question.options.map((o) => o.text)).toEqual([
      "\\$56",
      "\\$60",
      "\\$64",
      "\\$68",
    ]);
  });

  it("check-content passes the fixture tree", () => {
    expect(checkContent(CONTENT)).toEqual([]);
    expect(exampleProblems(CONTENT, fixture, kit).problems).toEqual([]);
  });
});

describe("hook rules", () => {
  it("H1 refuses statistics, not a percent that is part of the puzzle", () => {
    expect(
      hookStatisticProblem("Up 25%, then down 25%. Back to $64?"),
    ).toBeNull();
    expect(hookStatisticProblem("90% of test-takers miss this?")).toMatch(
      /^H1/,
    );
    expect(hookStatisticProblem("Only 1 in 5 get this right?")).toMatch(/^H1/);
    expect(hookStatisticProblem("A study says this one is hard?")).toMatch(
      /^H1/,
    );
  });

  it("H2 refuses claims about students or people", () => {
    expect(hookPeopleProblem("Most students miss this one?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Most people get this wrong?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Everyone picks C here?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Up 25%, then down 25%. Back to $64?")).toBeNull();
  });

  it("H3 requires the hook to state the puzzle", () => {
    expect(
      hookPuzzleProblem("Up 25%, then down 25%. Back to $64?", question),
    ).toBeNull();
    expect(hookPuzzleProblem("Can you solve this one?", question)).toMatch(
      /^H3/,
    );
  });

  it("H4 requires the hook to end in curiosity", () => {
    expect(hookCuriosityProblem("Back to $64?")).toBeNull();
    expect(hookCuriosityProblem("Up 25%, then down 25%…")).toBeNull();
    expect(hookCuriosityProblem("Up 25%, then down 25%.")).toMatch(/^H4/);
  });

  it("H5 refuses a hook that gives the answer away", () => {
    expect(
      hookAnswerProblem("Up 25%, then down 25%. Back to $64?", question),
    ).toBeNull();
    expect(hookAnswerProblem("Up 25%, down 25%: is it $60?", question)).toMatch(
      /^H5/,
    );
    expect(hookAnswerProblem("Why is 60 right here?", question)).toMatch(/^H5/);
    expect(hookAnswerProblem("The answer is not $64?", question)).toMatch(
      /^H5/,
    );
  });

  it("every hook rule runs on the spoken hook as well as the line", () => {
    const bad = {
      ...fixture.content,
      hook: withHook(
        "Up 25%, then down 25%. Back to $64?",
        "Most students say sixty-four dollars.",
      ),
    };
    expect(
      exampleProblems(CONTENT, { ...fixture, content: bad }, kit).problems.join(
        "\n",
      ),
    ).toMatch(/H2 claim about people/);
  });
});

describe("the monthly plan rotates hook types", () => {
  const plan = JSON.parse(
    readFileSync(
      join(CONTENT, "content/worked-examples/2026-11-plan/plan.json"),
      "utf8",
    ),
  ) as Parameters<typeof planProblems>[0];

  it("the fixture plan rotates", () => {
    expect(planProblems(plan)).toEqual([]);
  });

  it("two consecutive slots with one hook type are refused", () => {
    const repeated = {
      ...plan,
      slots: plan.slots.map((s, k) =>
        k === 1 ? { ...s, hook_type: plan.slots[0]?.hook_type ?? "puzzle" } : s,
      ),
    };
    expect(planProblems(repeated).join("\n")).toMatch(/hook types rotate/);
  });

  it("a month of five slots that never uses one type is refused", () => {
    const types = ["puzzle", "speed", "puzzle", "speed", "challenge"] as const;
    const narrow = {
      ...plan,
      slots: plan.slots.map((s, k) => ({
        ...s,
        hook_type: types[k] ?? "puzzle",
      })),
    };
    expect(planProblems(narrow).join("\n")).toMatch(/never uses/);
  });
});

describe("30-60 s, order and the safe area", () => {
  it("the fixture lasts 30-60 s and the limits refuse 29 s and 61 s", () => {
    expect(comp.duration).toBeGreaterThanOrEqual(30);
    expect(comp.duration).toBeLessThanOrEqual(60);
    expect(durationProblem(comp.duration, kit)).toBeNull();
    expect(durationProblem(29, kit)).toMatch(/must be 30-60 s/);
    expect(durationProblem(61, kit)).toMatch(/must be 30-60 s/);
  });

  it("voice starts at 0:00; hook and question are on screen from frame 0", () => {
    expect(comp.voice[0]?.key).toBe("hook");
    expect(comp.voice[0]?.start).toBe(0);
    expect(comp.scenes[0]).toMatchObject({ key: "open", start: 0 });
    const open =
      /<section id="open"[^>]*>([\s\S]*?)<\/section>/.exec(comp.html)?.[1] ??
      "";
    expect(open).toContain('id="hook-line"');
    expect(open).toContain('id="question-card"');
    // Nothing animates them in: they are drawn, not revealed.
    expect(comp.html).not.toMatch(/"#(hook-line|question-card)"/);
  });

  it("the order is hook → question → steps → answer → trap → end card", () => {
    expect(comp.voice.map((v) => v.key)).toEqual([
      "hook",
      "question",
      "step-1",
      "step-2",
      "step-3",
      "step-4",
      "answer",
      "trap",
      "outro",
    ]);
    expect(comp.scenes.map((s) => s.key)).toEqual([
      "open",
      "work",
      "trap",
      "endcard",
    ]);
    const answer = comp.writes.find((w) => w.key === "answer");
    expect(answer && answer.start / comp.duration).toBeGreaterThan(0.5);
    expect(comp.html).toContain(">The trap:<");
    expect(comp.html).toContain("Follow for daily SAT questions");
    expect(comp.html).toContain("lyceon.ai");
  });

  it("the safe area is x 71..912, y 154..1555 and a box outside it is refused", () => {
    expect(safeArea()).toEqual({
      left: 71,
      right: 912,
      top: 154,
      bottom: 1555,
    });
    const inside = { what: "ok", x: 71, y: 154, right: 912, bottom: 1555 };
    expect(boxProblems([inside], safeArea())).toEqual([]);
    expect(boxProblems([{ ...inside, right: 950 }], safeArea()).join()).toMatch(
      /leaves the safe area/,
    );
    expect(boxProblems([{ ...inside, x: 31 }], safeArea()).join()).toMatch(
      /leaves the safe area/,
    );
    expect(
      boxProblems([{ ...inside, bottom: 1600 }], safeArea()).join(),
    ).toMatch(/leaves the safe area/);
    expect(boxProblems([{ ...inside, y: 100 }], safeArea()).join()).toMatch(
      /leaves the safe area/,
    );
    expect(boxProblems([], safeArea())).toEqual(["nothing was measured"]);
  });

  it("captions show the script, never the transcription, at most five words a chunk", () => {
    expect(comp.html).not.toMatch(/lycian/i);
    const chunks = [
      ...comp.html.matchAll(/<div class="cap-box">([\s\S]*?)<\/div>/g),
    ].map((m) => (m[1] ?? "").split("</span>").length - 1);
    expect(chunks.length).toBeGreaterThan(10);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(5);
    expect(comp.html).toMatch(
      /tl\.set\("#w-hook-0", \{ backgroundColor: "#F4C542"/,
    );
  });
});

describe("blank paper", () => {
  it("the paper is one flat colour: no gradient, image, line or margin rule in the kit or the page", () => {
    const css = readFileSync(join(ROOT, KIT_DIR, "templates/kit.css"), "utf8");
    for (const text of [css, comp.html]) {
      expect(text).not.toMatch(
        /gradient\(|background-image|url\([^)]*\.(png|jpg|svg)\)|border-(left|right|top|bottom)\s*:/i,
      );
      expect(text).not.toMatch(/<hr|class="(rule|margin|lines?)"/);
    }
    expect(comp.html).toContain(`background: ${kit.brand.colours.paper};`);
  });

  it("nonPaperPixels counts every pixel off the paper colour", () => {
    const paper = [0xff, 0xfd, 0xf6, 255];
    const flat = new Uint8Array([...paper, ...paper, ...paper]);
    expect(nonPaperPixels(flat, "#FFFDF6")).toBe(0);
    const ruled = new Uint8Array([...paper, 0xc8, 0xd8, 0xe8, 255, ...paper]);
    expect(nonPaperPixels(ruled, "#FFFDF6")).toBe(1);
  });
});

describe("audio mix and licences", () => {
  it("the committed voice is 16-bit PCM and every line clears the music by the kit's margin", () => {
    const peaks = voice.lines.map((l) => readWav(wav(l.file)).peakDbfs);
    expect(peaks.length).toBe(8);
    expect(
      mixProblem(
        peaks,
        kit.track.peak_dbfs,
        kit.voice.music_gain,
        kit.voice.min_voice_over_music_db,
      ),
    ).toBeNull();
    expect(voiceProblems(fixture.content, voice, kit, wav)).toEqual([]);
  });

  it("music too loud for the voice is refused", () => {
    expect(mixProblem([-6], -1.9, 0.5, 15)).toMatch(
      /only .* dB above the music/,
    );
    expect(mixProblem([-6, -30], -1.9, 0.07, 15)).toMatch(
      /only .* dB above the music/,
    );
  });

  it("re-scripting a line without re-voicing it is refused", () => {
    const edited = {
      ...fixture.content,
      answer: { ...fixture.content.answer, voice: "So it's B, sixty dollars." },
    };
    expect(voiceProblems(edited, voice, kit, wav).join()).toMatch(
      /voiced from different text/,
    );
  });

  it("every track used has its licence file, naming the licence, its link, the source and the credit", () => {
    const tracks = JSON.parse(
      readFileSync(join(ROOT, KIT_DIR, "music/tracks.json"), "utf8"),
    ) as Record<string, typeof kit.track>;
    expect(Object.keys(tracks)).toContain(kit.voice.music_track);
    for (const t of Object.values(tracks)) {
      expect(existsSync(join(ROOT, t.file))).toBe(true);
      const licence = readFileSync(join(ROOT, t.licence_file), "utf8");
      expect(licence).toContain(t.licence);
      expect(licence).toContain(t.licence_url);
      expect(licence).toContain(t.source);
      expect(licence).toContain(t.credit);
    }
    expect(
      statSync(join(ROOT, KIT_DIR, "fonts/caveat-latin.woff2")).size,
    ).toBeGreaterThan(0);
    expect(
      readFileSync(join(ROOT, KIT_DIR, "fonts/OFL-Caveat.md"), "utf8"),
    ).toMatch(
      /^Copyright 2014 The Caveat Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/,
    );
  });
});

describe("title and caption", () => {
  const credit = kit.track.credit;
  const title = workedExampleTitle(fixture.content, question);
  const caption = workedExampleCaption(fixture.content, credit);

  it("the real title and caption pass, with the music credited", () => {
    expect(title).toBe("SAT Math worked example · Percentages");
    expect(titleProblems(title)).toEqual([]);
    expect(caption.split("\n")[0]).toBe("Follow for daily SAT questions 👆");
    expect(caption).toContain(
      'Music: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.',
    );
    expect(captionProblems(caption, credit)).toEqual([]);
    expect(workedExampleLabel(fixture.content)).toBe(
      "Worked example · Percentages · obvious_answer_trap",
    );
  });

  it("a title over 90 characters or not starting with SAT is refused", () => {
    expect(
      titleProblems("x".repeat(91).replace(/^x{3}/, "SAT")).join(),
    ).toMatch(/at most 90/);
    expect(titleProblems("Worked example · Percentages").join()).toMatch(
      /must start "SAT"/,
    );
  });

  it("a caption without the follow line first, or without the credit, is refused", () => {
    expect(
      captionProblems(
        caption.replace("Follow for daily SAT questions 👆\n\n", ""),
        credit,
      ).join(),
    ).toMatch(/first line must be/);
    expect(captionProblems(caption.replace(credit, ""), credit).join()).toMatch(
      /does not credit the music/,
    );
  });
});

describe("the daily job: approved, post_on today, once", () => {
  const today = fixture.content.post_on;
  const other = {
    ...fixture,
    content: {
      ...fixture.content,
      question_id: "SATM2AAAAAA",
      post_on: "2026-11-04",
    },
  };
  const retired = {
    ...fixture,
    content: {
      ...fixture.content,
      question_id: "SATM2BBBBBB",
      retired: true as const,
    },
  };

  it("selects only examples due today, not retired, not already posted", () => {
    expect(dueExamples([fixture, other, retired], today, {})).toEqual([
      fixture,
    ]);
    expect(dueExamples([fixture, other], "2026-11-03", {})).toEqual([]);
    expect(
      dueExamples([fixture], today, {
        "we-satm2czs1be": { date: today, run: "1" },
      }),
    ).toEqual([]);
    expect(loadPosted(CONTENT)).toEqual({});
  });

  it("posts once: a second claim for the same example is refused", () => {
    const first = recordPosted({}, "we-satm2czs1be", today, "100");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = recordPosted(first.ledger, "we-satm2czs1be", today, "101");
    expect(second).toEqual({
      ok: false,
      reason: `we-satm2czs1be was already posted on ${today}`,
    });
  });

  it("two live examples on one day are refused", () => {
    expect(
      sameDayProblems([
        fixture,
        { ...other, content: { ...other.content, post_on: today } },
      ]).join(),
    ).toMatch(/one a day/);
  });

  const sha = "a".repeat(40);
  const pull = {
    number: 1300,
    merged_at: "2026-10-28T15:00:00Z",
    merge_commit_sha: sha,
    merged_by: { login: "kingk237" },
    base: { ref: "social" },
  };

  it("approved only when GitHub's record shows the approver merged the commit into social", () => {
    expect(approvalFromRecord(pull, sha, "kingk237")).toEqual({
      ok: true,
      approval: {
        pr: 1300,
        mergedBy: "kingk237",
        mergeSha: sha,
        mergedAt: "2026-10-28T15:00:00Z",
      },
    });
    expect(
      approvalFromRecord(
        { ...pull, merged_by: { login: "someone" } },
        sha,
        "kingk237",
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not the approver/),
    });
    expect(
      approvalFromRecord({ ...pull, base: { ref: "seo" } }, sha, "kingk237"),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/not social/) });
    expect(approvalFromRecord(pull, "b".repeat(40), "kingk237")).toMatchObject({
      ok: false,
    });
    expect(
      approvalFromRecord(
        { ...pull, merged_at: null, merged_by: null },
        sha,
        "kingk237",
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/not merged/) });
    expect(approvalFromRecord(null, sha, "kingk237")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/direct push/),
    });
    expect(approvalFromRecord(pull, sha, undefined)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/CONTENT_APPROVER_LOGIN/),
    });
  });

  it("the post is built from the real title and caption and checked again", () => {
    const approval = {
      pr: 1300,
      mergedBy: "kingk237",
      mergeSha: sha,
      mergedAt: "2026-10-28T15:00:00Z",
    };
    const post = buildPost(
      fixture,
      workedExampleTitle(fixture.content, question),
      workedExampleCaption(fixture.content, kit.track.credit),
      kit.track.credit,
      approval,
    );
    expect(workedExamplePostSchema.parse(post).video).toBe(
      "we-satm2czs1be.mp4",
    );
    expect(() =>
      buildPost(fixture, "Percentages", "x", kit.track.credit, approval),
    ).toThrow(/must start "SAT"/);
  });

  it("the rendered MP4 must be 1080×1920, 30-60 s, match the composition and carry audio", () => {
    const good = {
      width: 1080,
      height: 1920,
      duration: comp.duration,
      audio: true,
    };
    expect(renderProblems(good, comp.duration, kit)).toEqual([]);
    expect(
      renderProblems(
        { ...good, width: 1920, height: 1080 },
        comp.duration,
        kit,
      ).join(),
    ).toMatch(/not 1080×1920/);
    expect(
      renderProblems({ ...good, audio: false }, comp.duration, kit).join(),
    ).toMatch(/no audio/);
    expect(
      renderProblems(
        { ...good, duration: comp.duration + 2 },
        comp.duration,
        kit,
      ).join(),
    ).toMatch(/the composition/);
  });
});

describe("the Slack set", () => {
  it("posts the video first (confirmed in the channel), then the title, then the caption", async () => {
    const calls: string[] = [];
    let n = 0;
    const fetch: FetchLike = async (url, init) => {
      const method = url.replace("https://slack.com/api/", "");
      calls.push(
        method.startsWith("https://files.slack.com/") ? "upload" : method,
      );
      const reply = (json: unknown) => ({
        ok: true,
        status: 200,
        json: async () => json,
      });
      if (method === "files.getUploadURLExternal")
        return reply({
          ok: true,
          upload_url: `https://files.slack.com/u/${++n}`,
          file_id: `F${n}`,
        });
      if (url.startsWith("https://files.slack.com/")) return reply({});
      if (method === "files.completeUploadExternal")
        return reply({ ok: true, files: [{ id: "F1" }] });
      if (method === "files.info")
        return reply({
          ok: true,
          file: { id: "F1", shares: { public: { C0TEST: [{ ts: "1.1" }] } } },
        });
      if (method === "chat.postMessage") {
        calls.push(
          `text:${String(JSON.parse(String(init.body)).text).split("\n")[0]}`,
        );
        return reply({ ok: true, ts: "1.2" });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const post = buildPost(
      fixture,
      workedExampleTitle(fixture.content, question),
      workedExampleCaption(fixture.content, kit.track.credit),
      kit.track.credit,
      { pr: 1, mergedBy: "kingk237", mergeSha: "a".repeat(40), mergedAt: "x" },
    );
    await postWorkedExample(
      { token: "xoxb-test", channel: "C0TEST" },
      post,
      new Uint8Array([1, 2, 3]),
      fetch,
      { timeoutMs: 1000, intervalMs: 0, sleep: async () => undefined },
    );
    expect(calls.filter((c) => c !== "upload")).toEqual([
      "files.getUploadURLExternal",
      "files.completeUploadExternal",
      "files.info",
      "chat.postMessage",
      "text:*Worked example · Percentages · obvious_answer_trap · TikTok title*",
      "chat.postMessage",
      "text:*Worked example · Percentages · obvious_answer_trap · TikTok caption*",
    ]);
  });
});

describe("seed SQL", () => {
  it("an approved row carries Karl's merge; a retired row is retired; the text is dollar-quoted", () => {
    const approval = {
      pr: 1300,
      mergedBy: "kingk237",
      mergeSha: "a".repeat(40),
      mergedAt: "2026-10-28T15:00:00Z",
    };
    const row = seedRow(fixture.content, approval, kit.voice.outro_text);
    expect(row).toContain("$we$approved$we$");
    expect(row).toContain("$we$Karl$we$");
    expect(row).toContain("$we$2026-10-28T15:00:00Z$we$::timestamptz");
    expect(row).toContain("$we$we-satm2czs1be$we$");
    expect(
      seedRow(
        { ...fixture.content, retired: true },
        approval,
        kit.voice.outro_text,
      ),
    ).toContain("$we$retired$we$");
    expect(seedRow(fixture.content, null, kit.voice.outro_text)).toContain(
      "$we$draft$we$",
    );
  });
});
