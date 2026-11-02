/**
 * Worked examples: every acceptance rule of the production brief, on real output.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27), acceptance: "hook
 *       rules; 30-60 s and the safe area; blank-paper template; audio mix (voice peak above music
 *       by a set dB margin); a licence file for each track used; the daily job posts only
 *       approved, post_on-today examples, once; title and caption rules"; the metrics table schema
 *       and RLS are proven by scripts/ci/worked-examples-schema-gates.sql; SCL-267 (Karl's rulings
 *       2026-11-02, later the same day): no burned-in captions, the voice never reads the screen
 *       (S1, S2), spoken order hook → setup → steps → trap → answer → call to action, the end card
 *       "Lyceon SAT Prep"] | @implemented [2026-10-27, SCL-267 2026-11-02]
 *
 * plain English: fixtures are derived from real output, never typed shapes: the example is the
 * fixture tree's real content file (tests/fixtures/worked-examples/social, the same tree the
 * workflow's pull-request run renders), its question is read from the real seed SQL, its voice is
 * the committed Kokoro audio (am_michael since SCL-267), and the composition is the real generator's output from the real
 * kit. scripts/ci/worked-examples.mutations.sh plants one defect per rule and requires these tests
 * to go red on the named assertion.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKED_EXAMPLE_VOICE_LINES,
  workedExamplePostSchema,
  voiceLineSchema,
  type WorkedExampleContent,
  type WorkedExamplePost,
} from "../../packages/shared/src/worked-example-schema";
import {
  captionProblems,
  hookAnswerProblem,
  hookCuriosityProblem,
  hookPeopleProblem,
  hookProblems,
  hookPuzzleProblem,
  hookStatisticProblem,
  planProblems,
  sharedRun,
  spokenHookEchoProblem,
  TRAP_VOICE_OPENING,
  titleProblems,
  verbatimProblems,
  verbatimWords,
  workedExampleCaption,
  workedExampleFacebookCaption,
  workedExampleInstagramCaption,
  workedExampleKeywords,
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
  scriptLines,
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
import {
  buildPost,
  renderProblems,
  workedExampleCopy,
} from "../../scripts/worked-examples/daily";
import { durationProblem } from "../../scripts/worked-examples/generate";
import { KIT_DIR, ROOT, loadKit } from "../../scripts/worked-examples/kit";
import {
  boxProblems,
  nonPaperPixels,
} from "../../scripts/worked-examples/layout-check";
import {
  postWorkedExample,
  workedExampleSlackSteps,
} from "../../scripts/worked-examples/post-to-slack";
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
    expect(hookPeopleProblem("Everyone picks C here?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Up 25%, then down 25%. Back to $64?")).toBeNull();
  });

  // Karl's ruling 2026-11-02 (SCL-265): "'Most people…' hooks are ALLOWED; this replaces the
  // earlier ban." Only the opening is exempt.
  it("H2 allows a hook that opens with Most people", () => {
    expect(hookPeopleProblem("Most people think it's $64?")).toBeNull();
    expect(hookPeopleProblem("most people get this wrong…")).toBeNull();
    expect(
      hookPeopleProblem("Most people say $64. Up 25%, then down 25%?"),
    ).toBeNull();
  });

  it("H2 still refuses every other claim about people, including after a Most people opening", () => {
    expect(hookPeopleProblem("most students think it's $64?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Most kids pick $64 here?")).toMatch(/^H2/);
    expect(
      hookPeopleProblem("Most people think $64, and everyone is wrong?"),
    ).toMatch(/^H2/);
    expect(
      hookPeopleProblem("Most people miss it, and most students too?"),
    ).toMatch(/^H2/);
    expect(hookPeopleProblem("Kids always pick $64 here?")).toMatch(/^H2/);
    expect(hookPeopleProblem("Why do most people pick $64?")).toMatch(/^H2/);
  });

  it("a Most people hook passes every hook rule on the real question", () => {
    const hook = withHook(
      "Most people think it's back to $64. Is it?",
      "Most people think it's back to sixty-four dollars. Is it?",
    );
    expect(hookProblems(hook, question)).toEqual([]);
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

describe("the spoken trap opens with the trap (Karl's flow wording allowed, SCL-267)", () => {
  const withTrapVoice = (voice: string): typeof fixture => ({
    ...fixture,
    content: { ...fixture.content, trap: { ...fixture.content.trap, voice } },
  });
  it("accepts the trap opening and the people-slip opening", () => {
    for (const voice of [
      "The trap: adding the percents.",
      "Here's where people slip. They add the percents.",
      "Now here's where people slip: you're dividing by a negative.",
      "Now, here\u2019s where you slip.",
    ]) {
      expect(TRAP_VOICE_OPENING.test(voice), voice).toBe(true);
      expect(
        exampleProblems(CONTENT, withTrapVoice(voice), kit).problems.join("\n"),
      ).not.toMatch(/trap\.voice must open/);
    }
  });
  it("refuses a trap line that opens any other way", () => {
    for (const voice of [
      "So the answer is wrong if you add.",
      "People slip here.",
    ]) {
      expect(TRAP_VOICE_OPENING.test(voice), voice).toBe(false);
      expect(
        exampleProblems(CONTENT, withTrapVoice(voice), kit).problems.join("\n"),
      ).toMatch(
        /trap\.voice must open "The trap" or "Here's where people slip"/,
      );
    }
  });
});

// SCL-267 (Karl's ruling 2026-11-02, later the same day): "Tone: contractions, short sentences,
// 'you/we', natural beats … just don't add any rule that would forbid it." H3 and H4 apply to the
// on-screen line only.
describe("a spoken hook may be a challenge to the viewer", () => {
  it('"Think you can do this one in ten seconds? Go." passes H1-H6 and the script rule', () => {
    const hook = withHook(
      fixture.content.hook.line,
      "Think you can do this one in ten seconds? Go.",
    );
    expect(hookProblems(hook, question)).toEqual([]);
    expect(spokenHookEchoProblem(hook)).toBeNull();
    const content = { ...fixture.content, hook };
    expect(verbatimProblems(content, question)).toEqual([]);
  });
});

// SCL-267 (Karl's ruling 2026-11-02): "The voice never reads the on-screen text verbatim."
describe("the voice never reads the screen (S1, S2)", () => {
  it("normalises case, punctuation and apostrophes, and keeps numbers as written", () => {
    expect(verbatimWords("What's the FINAL price, after $64 × 1.25?")).toEqual([
      "whats",
      "the",
      "final",
      "price",
      "after",
      "64",
      "1.25",
    ]);
    expect(verbatimWords("Sixty-four, 1,000")).toEqual([
      "sixty",
      "four",
      "1000",
    ]);
  });

  it("S1 finds a run of six shared words, and not five", () => {
    const stem =
      "If the original price of the item was $64, what is the final price after both changes?";
    expect(sharedRun("So, what is the final price after that?", stem)).toBe(
      "what is the final price after",
    );
    expect(sharedRun("Okay: what is the final price?", stem)).toBeNull();
    expect(sharedRun("If the original price was sixty-four", stem)).toBeNull();
  });

  it("the fixture's setup and lines pass; a setup that reads the question stem is refused", () => {
    expect(verbatimProblems(fixture.content, question)).toEqual([]);
    const reads = {
      ...fixture.content,
      question_voice:
        "A store increases the price of an item by twenty-five percent.",
    };
    expect(verbatimProblems(reads, question).join("\n")).toMatch(
      /^S1 reads the screen: spoken question repeats "a store increases the price of" from the question stem/,
    );
    expect(
      exampleProblems(
        CONTENT,
        { ...fixture, content: reads },
        kit,
      ).problems.join("\n"),
    ).toMatch(/S1 reads the screen/);
  });

  it("S1 checks every spoken line against every on-screen text: notepads and the stem", () => {
    const trap = {
      ...fixture.content,
      trap: {
        ...fixture.content.trap,
        notepad: ["the discount comes off the bigger price"],
      },
    };
    expect(verbatimProblems(trap, question).join("\n")).toMatch(
      /spoken trap repeats "the discount comes off the bigger" from trap notepad line 1/,
    );
    const withNotepad = (notepad: string): WorkedExampleContent => ({
      ...fixture.content,
      steps: fixture.content.steps.map((s, k) =>
        k === 0 ? { ...s, notepad } : s,
      ),
    });
    // Five shared words are talk; six are reading.
    expect(
      verbatimProblems(withNotepad("make each percent a multiplier"), question),
    ).toEqual([]);
    expect(
      verbatimProblems(
        withNotepad("up twenty-five means times one"),
        question,
      ).join("\n"),
    ).toMatch(
      /spoken step-1 repeats "up twenty five means times one" from step 1's notepad/,
    );
    const answer = {
      ...fixture.content,
      answer: {
        ...fixture.content.answer,
        voice: "B. $60 is the final price after both changes.",
      },
    };
    expect(verbatimProblems(answer, question).join("\n")).toMatch(
      /spoken answer repeats "is the final price after both" from the question stem/,
    );
  });

  it("S2 refuses a spoken hook that is the on-screen hook line read aloud", () => {
    expect(spokenHookEchoProblem(fixture.content.hook)).toBeNull();
    const echo = withHook(
      "Up 25%, then down 25%. Back to $64?",
      "Up 25% then down 25%... back to $64?",
    );
    expect(spokenHookEchoProblem(echo)).toMatch(/^S2 the spoken hook reads/);
    expect(
      exampleProblems(
        CONTENT,
        { ...fixture, content: { ...fixture.content, hook: echo } },
        kit,
      ).problems.join("\n"),
    ).toMatch(/S2 the spoken hook reads the on-screen hook line/);
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

  it("voice starts at 0:00; hook and question are on screen from frame 0 while the setup is spoken", () => {
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
    const setup = comp.voice.find((v) => v.key === "question");
    expect(setup && setup.start + setup.duration).toBeLessThanOrEqual(
      comp.scenes[0]?.end ?? 0,
    );
  });

  // SCL-267 (Karl's ruling 2026-11-02): hook, setup, the key move, the trap, the answer and a
  // quick check, the call to action.
  it("the spoken order is hook → setup → steps → trap → answer → call to action", () => {
    expect(WORKED_EXAMPLE_VOICE_LINES).toEqual([
      "hook",
      "question",
      "steps",
      "trap",
      "answer",
    ]);
    expect(comp.voice.map((v) => v.key)).toEqual([
      "hook",
      "question",
      "step-1",
      "step-2",
      "step-3",
      "step-4",
      "trap",
      "answer",
      "outro",
    ]);
    expect(comp.scenes.map((s) => s.key)).toEqual([
      "open",
      "work",
      "trap",
      "answer",
      "endcard",
    ]);
    const at = (key: string): number =>
      comp.voice.find((v) => v.key === key)?.start ?? -1;
    expect(comp.scenes.find((x) => x.key === "trap")).toEqual({
      key: "trap",
      start: at("trap"),
      end: at("answer"),
    });
    expect(comp.scenes.find((x) => x.key === "answer")).toEqual({
      key: "answer",
      start: at("answer"),
      end: at("outro"),
    });
    const trapHead = comp.writes.find((w) => w.key === "trap-head");
    const answer = comp.writes.find((w) => w.key === "answer");
    expect(trapHead && answer && trapHead.start < answer.start).toBe(true);
    expect(answer && answer.start).toBeGreaterThan(at("answer"));
    expect(answer && answer.start / comp.duration).toBeGreaterThan(0.5);
    expect(comp.html).toContain(">The trap:<");
  });

  it("a manifest voiced before the ruling (answer before trap) places every line in the new order", () => {
    const oldOrder = [
      ...voice.lines.filter((l) => l.key !== "answer" && l.key !== "trap"),
      ...voice.lines.filter((l) => l.key === "answer"),
      ...voice.lines.filter((l) => l.key === "trap"),
    ];
    expect(oldOrder.map((l) => l.key).slice(-2)).toEqual(["answer", "trap"]);
    expect(
      voiceProblems(fixture.content, { ...voice, lines: oldOrder }, kit, wav),
    ).toEqual([]);
    const rebuilt = buildComposition({
      example: fixture.content,
      question,
      voice: oldOrder,
      outro,
      kit,
    });
    expect(rebuilt.html).toBe(comp.html);
    expect(() =>
      buildComposition({
        example: fixture.content,
        question,
        voice: oldOrder.slice(1),
        outro,
        kit,
      }),
    ).toThrow(/do not match the script/);
  });

  // SCL-267 (Karl's ruling 2026-11-02): "no 'lyceon.ai' spoken or shown"; the CTA "Follow,
  // there's one of these every day."; the end card reads "Lyceon SAT Prep".
  it("the end card reads Lyceon SAT Prep and the call to action never says lyceon.ai", () => {
    const end =
      /<section id="endcard"[^>]*>([\s\S]*?)<\/section>/.exec(comp.html)?.[1] ??
      "";
    expect(end).toContain('<div class="brand-name">Lyceon SAT Prep</div>');
    expect(end).toContain("Follow for daily SAT questions");
    expect(comp.html).not.toMatch(/lyceon\.ai|lyceon dot/i);
    expect(kit.voice.outro_text).toBe(
      "Follow, there's one of these every day.",
    );
    expect(kit.voice.outro_caption).toBe(kit.voice.outro_text);
    expect(outro.words.map((w) => w.text).join(" ")).not.toMatch(
      /lyceon|lycian|\bai\b/i,
    );
    expect(scriptLines(fixture.content, kit.voice.outro_text).at(-1)).toEqual({
      key: "outro",
      text: "Follow, there's one of these every day.",
    });
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

  // SCL-267 (Karl's ruling 2026-11-02): "No burned-in word-by-word captions … give the freed
  // space back to the notepad."
  it("no caption track: no caption clip, word span or highlight, and the notepad uses the freed space", () => {
    expect(comp.html).not.toMatch(
      /class="clip cap"|class="cap-|class="wd"|id="w-|backgroundColor/,
    );
    const css = readFileSync(join(ROOT, KIT_DIR, "templates/kit.css"), "utf8");
    expect(css).not.toMatch(/\.cap|\.wd\b/);
    const lowest = [...comp.html.matchAll(/class="hand" style="top:(\d+)px/g)]
      .map((m) => Number(m[1]))
      .reduce((x, y) => Math.max(x, y), 0);
    expect(lowest).toBeGreaterThan(1200);
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
  // SCL-265 (Karl's ruling 2026-11-02): the worked-example captions use the SCL-262 format, with
  // the music credit (CC BY 4.0) on every one. Every expectation is on the real builders' output.
  const credit = kit.track.credit;
  const title = workedExampleTitle(fixture.content, question);
  const caption = workedExampleCaption(fixture.content, question, credit);
  const instagram = workedExampleInstagramCaption(
    fixture.content,
    question,
    credit,
  );
  const facebook = workedExampleFacebookCaption(
    fixture.content,
    question,
    credit,
  );
  const captions = { tiktok: caption, instagram, facebook };

  it("the real title and caption pass, with the music credited", () => {
    expect(title).toBe("SAT Math worked example · Percentages");
    expect(titleProblems(title)).toEqual([]);
    for (const [platform, text] of Object.entries(captions)) {
      expect(text.split("\n")[0], platform).toBe(title);
      expect(text.split("\n\n").at(-1), platform).toBe(
        'Music: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.',
      );
      expect(captionProblems(text, credit, title), platform).toEqual([]);
    }
    expect(workedExampleLabel(fixture.content)).toBe(
      "Worked example · Percentages · obvious_answer_trap",
    );
  });

  it("the TikTok, Instagram and Facebook captions are the SCL-262 lines, then the credit", () => {
    // The fixture posts on 2026-11-02: the next confirmed SAT is Nov 7.
    expect(fixture.content.post_on).toBe("2026-11-02");
    const tags = "#SAT #SATprep #digitalSAT #NovemberSAT #SATMath";
    expect(caption.split("\n\n")).toEqual([
      title,
      "Follow for daily SAT questions 👆 Comment your answer 👇",
      tags,
      credit,
    ]);
    expect(instagram.split("\n\n")).toEqual([
      title,
      "Comment your answer 👇",
      "Taking the SAT Nov 7? Comment SAT and I'll send you the link",
      tags,
      credit,
    ]);
    expect(facebook.split("\n\n")).toEqual([
      title,
      "How would you solve it? Share your approach below 👇",
      tags,
      credit,
    ]);
    for (const text of Object.values(captions))
      expect(text.match(/#\w+/g)?.length).toBeLessThanOrEqual(5);
  });

  it("no link, bio line or promo in any caption; Facebook asks for no comment word", () => {
    for (const [platform, text] of Object.entries(captions)) {
      expect(text, platform).not.toMatch(
        /https?:\/\/|www\.|lyceon\.ai|link in bio|bio link|Free SAT practice/i,
      );
      expect(text, platform).not.toMatch(/#fyp|#studytok/i);
    }
    expect(facebook).not.toMatch(/\bComment\b/);
    expect(
      captionProblems(
        caption.replace(credit, `lyceon.ai/start\n\n${credit}`),
        credit,
        title,
      ).join(),
    ).toMatch(/carries a link or bio line/);
  });

  it("TikTok's keywords: test month, always-set, Math, the canonical domain", () => {
    expect(question.domain).toBe("Problem Solving and Data Analysis");
    expect(workedExampleKeywords(fixture.content, question)).toEqual({
      ok: true,
      keywords: [
        "November SAT questions",
        "SAT",
        "SAT prep",
        "Digital SAT",
        "College admissions",
        "SAT math",
        "Data analysis",
        "Statistics",
      ],
    });
    expect(
      workedExampleKeywords(fixture.content, {
        ...question,
        domain: "Problem-Solving and Data Analysis",
      }),
    ).toMatchObject({ ok: false });
  });

  it("a title over 90 characters or not starting with SAT is refused", () => {
    expect(
      titleProblems("x".repeat(91).replace(/^x{3}/, "SAT")).join(),
    ).toMatch(/at most 90/);
    expect(titleProblems("Worked example · Percentages").join()).toMatch(
      /must start "SAT"/,
    );
  });

  it("a caption without the headline first, or without the credit, is refused", () => {
    expect(
      captionProblems(
        caption.replace(`${title}\n\n`, ""),
        credit,
        title,
      ).join(),
    ).toMatch(/first line must be the headline/);
    for (const text of Object.values(captions))
      expect(
        captionProblems(text.replace(credit, ""), credit, title).join(),
      ).toMatch(/does not credit the music/);
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

  it("no caption, keyword or message gives away the answer or the explanation (anti-leak)", () => {
    const copy = workedExampleCopy(fixture, question, kit.track.credit);
    const post = buildPost(fixture, copy, kit.track.credit, {
      pr: 1300,
      mergedBy: "kingk237",
      mergeSha: sha,
      mergedAt: "2026-10-28T15:00:00Z",
    });
    const copyTexts = [
      post.caption,
      post.instagram_caption,
      post.facebook_caption,
      ...post.keywords,
    ];
    const messages = workedExampleSlackSteps(post).map((s) =>
      s.kind === "video" ? s.comment : s.text,
    );
    // Presence first: the copy is real and non-trivial (an empty set would pass the absence check).
    expect(post.keywords.length).toBeGreaterThan(0);
    for (const t of [
      post.caption,
      post.instagram_caption,
      post.facebook_caption,
    ])
      expect(t.startsWith(post.title)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    const correct = question.options.find(
      (o) => o.key === question.correct_answer,
    );
    expect(correct).toBeDefined();
    const secrets = [
      correct?.text ?? "",
      fixture.content.answer.notepad,
      fixture.content.answer.voice,
      fixture.content.trap.summary,
      fixture.content.check,
      fixture.content.takeaway,
      ...fixture.content.steps.map((s) => s.notepad),
    ];
    for (const secret of secrets) {
      expect(secret.trim().length).toBeGreaterThan(0);
      for (const text of [...copyTexts, ...messages])
        expect(text).not.toContain(secret);
    }
  });

  it("the post is built from the real title and caption and checked again", () => {
    const approval = {
      pr: 1300,
      mergedBy: "kingk237",
      mergeSha: sha,
      mergedAt: "2026-10-28T15:00:00Z",
    };
    const copy = workedExampleCopy(fixture, question, kit.track.credit);
    const post = buildPost(fixture, copy, kit.track.credit, approval);
    const parsed = workedExamplePostSchema.parse(post);
    expect(parsed.video).toBe("we-satm2czs1be.mp4");
    expect(parsed.title).toBe(copy.title);
    expect(parsed.caption).toBe(copy.caption);
    expect(parsed.instagram_caption).toBe(copy.instagram_caption);
    expect(parsed.facebook_caption).toBe(copy.facebook_caption);
    expect(copy.keywords).toEqual({ ok: true, keywords: parsed.keywords });
    expect(parsed.warnings).toEqual([]);
    // Kept in post.json for the run's download, as the QOTD's (SCL-262); never posted.
    expect(parsed.links).toEqual({
      reddit: "lyceon.ai/start?utm_source=reddit&utm_campaign=worked_example",
      tiktok: "lyceon.ai/start?utm_source=tiktok&utm_campaign=worked_example",
      instagram:
        "lyceon.ai/start?utm_source=instagram&utm_campaign=worked_example",
    });
    expect(() =>
      buildPost(
        fixture,
        { ...copy, title: "Percentages" },
        kit.track.credit,
        approval,
      ),
    ).toThrow(/must start "SAT"/);
    expect(() =>
      buildPost(
        fixture,
        { ...copy, instagram_caption: "no headline" },
        kit.track.credit,
        approval,
      ),
    ).toThrow(/instagram caption's first line must be the headline/);
    expect(() =>
      buildPost(
        fixture,
        {
          ...copy,
          facebook_caption: copy.facebook_caption.replace(kit.track.credit, ""),
        },
        kit.track.credit,
        approval,
      ),
    ).toThrow(/facebook caption does not credit the music/);
    expect(() =>
      buildPost(
        fixture,
        {
          ...copy,
          keywords: workedExampleKeywords(fixture.content, {
            ...question,
            domain: "Craft and Structure",
          }),
        },
        kit.track.credit,
        approval,
      ),
    ).toThrow(/tiktok keywords: "Craft and Structure" is not a Math domain/);
  });

  it("with no confirmed SAT left the post carries the warning and no month", () => {
    const late = {
      ...fixture,
      content: { ...fixture.content, post_on: "2099-01-01" },
    };
    const copy = workedExampleCopy(late, question, kit.track.credit);
    const post = buildPost(late, copy, kit.track.credit, {
      pr: 1,
      mergedBy: "kingk237",
      mergeSha: sha,
      mergedAt: "x",
    });
    expect(post.warnings.join()).toMatch(/SAT date list needs updating/);
    expect(
      [post.caption, post.instagram_caption, post.facebook_caption].join(),
    ).not.toMatch(/January|Taking the SAT/);
    expect(post.keywords[0]).toBe("SAT");
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
  // SCL-265: the QOTD's SCL-262 structure. Built from the real builders, posted through the real
  // client against a recorded Slack.
  const approval = {
    pr: 1,
    mergedBy: "kingk237",
    mergeSha: "a".repeat(40),
    mergedAt: "x",
  };
  // Built inside each test, so a planted defect in a builder fails that test, not the file.
  const realPost = (): WorkedExamplePost =>
    buildPost(
      fixture,
      workedExampleCopy(fixture, question, kit.track.credit),
      kit.track.credit,
      approval,
    );
  const fence = (text: string): string => ["```", text, "```"].join("\n");

  async function sent(
    p: WorkedExamplePost,
  ): Promise<{ calls: string[]; texts: string[]; comment: string }> {
    const calls: string[] = [];
    const texts: string[] = [];
    let comment = "";
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
      if (method === "files.completeUploadExternal") {
        comment = String(JSON.parse(String(init.body)).initial_comment);
        return reply({ ok: true, files: [{ id: "F1" }] });
      }
      if (method === "files.info")
        return reply({
          ok: true,
          file: { id: "F1", shares: { public: { C0TEST: [{ ts: "1.1" }] } } },
        });
      if (method === "chat.postMessage") {
        texts.push(String(JSON.parse(String(init.body)).text));
        return reply({ ok: true, ts: "1.2" });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await postWorkedExample(
      { token: "xoxb-test", channel: "C0TEST" },
      p,
      new Uint8Array([1, 2, 3]),
      fetch,
      { timeoutMs: 1000, intervalMs: 0, sleep: async () => undefined },
    );
    return { calls, texts, comment };
  }

  it("posts the video first (confirmed in the channel), then TikTok's caption and keywords, Instagram, Facebook", async () => {
    const post = realPost();
    const { calls, texts, comment } = await sent(post);
    expect(calls.filter((c) => c !== "upload")).toEqual([
      "files.getUploadURLExternal",
      "files.completeUploadExternal",
      "files.info",
      "chat.postMessage",
      "chat.postMessage",
      "chat.postMessage",
    ]);
    // The label and the review line stay outside the copy blocks, on the video.
    expect(comment).toBe(
      [
        "*TikTok*",
        "Worked example · Percentages · obvious_answer_trap",
        "For review: posts on 2026-11-02. Karl posts by hand.",
      ].join("\n"),
    );
    expect(texts).toEqual([
      [fence(post.caption), fence(post.keywords.join("\n"))].join("\n"),
      [
        "*Instagram* (the same video as TikTok, above)",
        fence(post.instagram_caption),
      ].join("\n"),
      [
        "*Facebook* (the same video as TikTok, above)",
        fence(post.facebook_caption),
      ].join("\n"),
    ]);
    expect(post.keywords).toContain("Data analysis");
  });

  it("no link, bio line, title or label block in any message; the music credited in every caption block", async () => {
    const { texts, comment } = await sent(realPost());
    expect(texts.length).toBe(3);
    for (const text of [...texts, comment]) {
      expect(text).not.toMatch(/lyceon\.ai|https?:\/\/|Bio link|Link to send/i);
      expect(text).not.toMatch(/TikTok title|· TikTok caption/);
    }
    for (const text of texts.slice(0, 3))
      expect(text).toContain(
        'Music: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.',
      );
  });

  it("a warning (SAT date list needs updating) is posted first, outside the copy blocks", async () => {
    const warned = {
      ...realPost(),
      warnings: ["SAT date list needs updating: none left"],
    };
    const { texts } = await sent(warned);
    expect(texts[0]).toBe(":warning: SAT date list needs updating: none left");
    expect(texts[0]).not.toContain("```");
    expect(texts.length).toBe(4);
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
