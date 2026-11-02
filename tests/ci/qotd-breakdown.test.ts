/**
 * The QOTD breakdown pilot: the stored order and letter, the anti-leak day, the fallback rule, the
 * captions, the pilot window and the workflow.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): "Add a test that
 *       fails if the letter or order differs from the stored row"; "Add a test that today's QOTD
 *       is refused"; the fallback rule (a)-(d) with stable codes; SCL-258, SCL-262, SCL-266]
 *       | @implemented [2026-11-02]
 *
 * plain English: every QOTD day here is REAL output: tests/fixtures/qotd/rows.json is what
 * qotd_archive() returned (SCL-258 order and letter written by the database's seeded shuffle), and
 * it reaches the breakdown through the real projection (toArchiveResponse) in the archive API's
 * { data } envelope and through the generator's own reader (loadYesterday), the path the nightly
 * job takes. The fixture can disprove the hard rule: on 2026-10-02 and 2026-10-03 the stored
 * order is a real shuffle and the stored letter (A) differs from the canonical key (B, C), so a
 * breakdown that used the authored order or the canonical letter fails here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  QOTD_BREAKDOWN_SKIP_CODES,
  qotdBreakdownManifestSchema,
  qotdBreakdownPilotSchema,
} from "../../packages/shared/src/qotd-breakdown-schema";
import type { QotdArchiveResponse } from "../../packages/shared/src/qotd-schema";
import {
  QOTD_BREAKDOWN_HOOK_VOICE,
  QOTD_BREAKDOWN_PILOT,
  QOTD_BREAKDOWN_SKIP_REASON,
  breakdownContentProblems,
  breakdownCopy,
  breakdownHookLine,
  breakdownQuestion,
  breakdownScript,
  breakdownSkipCode,
  breakdownSkipLine,
  explanationSentences,
  namesALetter,
  pilotWindow,
  type BreakdownQuestion,
} from "../../shared/qotd/breakdown";
import { spokenMathText } from "../../shared/qotd/plain-math";
import {
  socialFacebookCaption,
  socialInstagramCaption,
  socialTiktokCaption,
  nextSatTest,
  qotdHeadline,
} from "../../shared/social/posts";
import { hookPuzzleProblem } from "../../shared/worked-examples/rules";
import {
  QOTD_BREAKDOWN_VOICE_PROFILE,
  breakdownDay,
  breakdownPlan,
  fixtureArchiveFetch,
} from "../../scripts/qotd-social/breakdown";
import { loadYesterday } from "../../scripts/qotd-social/generate";
import { buildScriptComposition } from "../../scripts/worked-examples/composition";
import { loadKit } from "../../scripts/worked-examples/kit";
import type { VoiceLine } from "../../packages/shared/src/worked-example-schema";
import {
  QOTD_ARCHIVE_ROWS,
  QOTD_FIXTURE_TODAY,
  qotdArchiveRow,
} from "../lib/qotd-fixture";

const ROOT = resolve(import.meta.dirname, "../..");
const ROWS_JSON: unknown = JSON.parse(
  readFileSync(resolve(ROOT, "tests/fixtures/qotd/rows.json"), "utf8"),
);
const BASE = "https://lyceon.ai";

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day as the nightly job reads it: the archive API's payload via loadYesterday. */
async function archiveDay(date: string): Promise<QotdArchiveResponse> {
  const { day } = await loadYesterday(
    BASE,
    nextDay(date),
    fixtureArchiveFetch(ROWS_JSON),
  );
  if (day === null) throw new Error(`${date} is not in the fixture archive`);
  return day;
}

function accepted(day: QotdArchiveResponse): BreakdownQuestion {
  const q = breakdownQuestion(day);
  if (!q.ok) throw new Error(`refused: ${q.code}`);
  return q.question;
}

/** Timing-only voice lines (the composition reads key, file, start, duration and words). */
function timedLines(keys: readonly string[]): VoiceLine[] {
  return keys.map((key) => ({
    key,
    text_sha256: "0".repeat(64),
    file: `${key}.wav`,
    duration: 2,
    words: [{ text: "word", start: 0, end: 1.5 }],
  }));
}

const SHUFFLED_DAYS = ["2026-10-02", "2026-10-03"] as const;

describe("the hard rule: the stored option_order and correct_display_letter", () => {
  it("the fixture can disprove it: stored order shuffled and the stored letter is not the canonical key", () => {
    for (const date of SHUFFLED_DAYS) {
      const row = qotdArchiveRow(date);
      expect(row.option_order.length).toBe(4);
      expect(row.option_order.join("")).not.toBe("ABCD");
      expect(row.correct_display_letter).not.toBeNull();
      expect(row.correct_display_letter).not.toBe(row.correct_answer);
    }
  });

  it("letters the choices by the stored order and keys the answer on the stored letter, for every shuffled day", async () => {
    for (const date of SHUFFLED_DAYS) {
      const row = qotdArchiveRow(date);
      const day = await archiveDay(date);
      const q = accepted(day);
      const canonicalText = new Map(
        (row.options as { key: string; text: string }[]).map((o) => [
          o.key,
          o.text,
        ]),
      );
      // Order: the choice shown under A..D is the stored order's key, never the authored one.
      expect(q.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
      expect(q.options.map((o) => o.text)).toEqual(
        row.option_order.map((k) => canonicalText.get(k)),
      );
      expect(q.option_order).toEqual(row.option_order);
      // Letter: the stored correct_display_letter, never the canonical key.
      expect(q.correct_answer).toBe(row.correct_display_letter);
      const script = breakdownScript(day, q);
      const correctText = canonicalText.get(row.correct_answer ?? "");
      expect(
        script.answer.voice.startsWith(
          `The answer is ${row.correct_display_letter}: `,
        ),
      ).toBe(true);
      expect(
        script.answer.notepad.startsWith(`${row.correct_display_letter})`),
      ).toBe(true);
      expect(
        q.options.find((o) => o.key === row.correct_display_letter)?.text,
      ).toBe(correctText);
      // The question read names each choice under its stored letter, in the stored order.
      let at = -1;
      for (const [k, key] of row.option_order.entries()) {
        const letter = "ABCD"[k];
        const spoken = `${letter}: ${spokenMathText(canonicalText.get(key) ?? "")}`;
        const next = script.question_voice.indexOf(spoken);
        expect(next, `${date} ${spoken}`).toBeGreaterThan(at);
        at = next;
      }
    }
  });

  it("the card on screen shows the stored order under A-D", async () => {
    const day = await archiveDay("2026-10-03");
    const row = qotdArchiveRow("2026-10-03");
    const q = accepted(day);
    const script = breakdownScript(day, q);
    const kit = loadKit();
    const comp = buildScriptComposition({
      script,
      question: q,
      title: "QOTD breakdown: 2026-10-03",
      voice: timedLines([
        "hook",
        "question",
        ...script.steps.map((_, k) => `step-${k + 1}`),
        "answer",
      ]),
      outro: timedLines(["outro"])[0] as VoiceLine,
      kit,
    });
    const shown = [
      ...comp.html.matchAll(/<li><b>([A-D])\)<\/b> ([^<]*)<\/li>/g),
    ];
    const canonicalText = new Map(
      (row.options as { key: string; text: string }[]).map((o) => [
        o.key,
        o.text,
      ]),
    );
    expect(shown.map((m) => m[1])).toEqual(["A", "B", "C", "D"]);
    expect(shown.map((m) => m[2])).toEqual(
      row.option_order.map((k) => canonicalText.get(k)),
    );
    // No trap in a breakdown: no trap scene, no "The trap:" heading.
    expect(comp.scenes.map((s) => s.key)).toEqual(["open", "work", "endcard"]);
    expect(comp.html).not.toContain("The trap:");
  });

  it("refuses a day whose stored letter is not where the correct choice is shown (no canonical fallback)", async () => {
    const day = await archiveDay("2026-10-02");
    const moved: QotdArchiveResponse = {
      ...day,
      question: { ...day.question, correct_letter: "B" },
    };
    expect(breakdownQuestion(moved)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    const missing: QotdArchiveResponse = {
      ...day,
      question: { ...day.question, correct_letter: null },
    };
    expect(breakdownQuestion(missing)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
  });
});

describe("anti-leak: only a day whose answer is public", () => {
  it("today's QOTD is refused; tonight's run breaks down yesterday", () => {
    // 04:05 UTC on 2026-10-04: the QOTD day is 2026-10-04 (04:00 UTC to 04:00 UTC).
    const now = new Date("2026-10-04T04:05:00Z");
    const today = breakdownDay("2026-10-04", now);
    expect(today.ok).toBe(false);
    if (!today.ok) expect(today.problem).toContain("has not passed yet");
    expect(breakdownDay("2026-10-05", now).ok).toBe(false);
    expect(breakdownDay(null, now)).toEqual({
      ok: true,
      date: "2026-10-03",
      postedOn: "2026-10-04",
    });
    // At 03:59 UTC the 2026-10-03 QOTD is still today: refused.
    expect(
      breakdownDay("2026-10-03", new Date("2026-10-04T03:59:00Z")).ok,
    ).toBe(false);
  });

  it("the archive serves no answer for today: the fixture's today is a 404 there (withheld)", async () => {
    const { day } = await loadYesterday(
      BASE,
      nextDay(QOTD_FIXTURE_TODAY),
      fixtureArchiveFetch(ROWS_JSON),
    );
    expect(day).toBeNull();
  });

  it("a manifest is always of the day before it posts", () => {
    expect(
      qotdBreakdownManifestSchema.safeParse({
        status: "skipped",
        qotd_date: "2026-10-04",
        posted_on: "2026-10-04",
        code: "withheld",
      }).success,
    ).toBe(false);
  });
});

describe("the fallback rule: (b) a letter named, (c) unsuitable", () => {
  it("names a letter", () => {
    for (const text of [
      "Choice B is incorrect because it is plural.",
      "choices A and C use the wrong tense.",
      "The answer is D.",
      "Answer: C",
      "Option A misreads the graph.",
      "Only (C) works.",
      "B) is wrong.",
      "The correct letter is A.",
    ])
      expect(namesALetter(text), text).toBe(true);
    for (const text of [
      "The answer is a number greater than 5.",
      "Since $f(A) = 3$, the value is 3.",
      "Dr. Smith wrote the passage.",
      "Attracted is the only choice that supplies one.",
      "A student is writing a report.",
    ])
      expect(namesALetter(text), text).toBe(false);
  });

  it("a stored explanation or choice that names a letter skips the day (letter_named)", async () => {
    const day = await archiveDay("2026-10-03");
    expect(breakdownSkipCode(day)).toBeNull();
    expect(
      breakdownSkipCode({
        ...day,
        question: {
          ...day.question,
          explanation: `${day.question.explanation} Choice B is wrong.`,
        },
      }),
    ).toBe("letter_named");
    expect(
      breakdownSkipCode({
        ...day,
        question: {
          ...day.question,
          options: day.question.options.map((o, k) =>
            k === 1 ? { ...o, text: "Both (A) and (C)" } : o,
          ),
        },
      }),
    ).toBe("letter_named");
  });

  it("a grid-in, a long passage, a paired passage, no explanation, too many steps", async () => {
    expect(breakdownSkipCode(await archiveDay("2026-10-04"))).toBe("grid_in");
    const day = await archiveDay("2026-10-03");
    const q = day.question;
    expect(
      breakdownSkipCode({
        ...day,
        question: { ...q, passage: "word ".repeat(80) },
      }),
    ).toBe("too_long_to_read");
    expect(
      breakdownSkipCode({
        ...day,
        question: {
          ...q,
          passage: "Text 1 says one thing. Text 2 says another.",
        },
      }),
    ).toBe("paired_passage");
    expect(
      breakdownSkipCode({ ...day, question: { ...q, explanation: "" } }),
    ).toBe("no_explanation");
    expect(
      breakdownSkipCode({
        ...day,
        question: {
          ...q,
          explanation: "One. Two. Three. Four. Five. Six. Seven.",
        },
      }),
    ).toBe("too_many_steps");
  });

  it("every code has a fixed reason, and the notice reads 'Breakdown skipped: <reason> (<code>)'", () => {
    for (const code of QOTD_BREAKDOWN_SKIP_CODES) {
      expect(QOTD_BREAKDOWN_SKIP_REASON[code].length).toBeGreaterThan(0);
      expect(breakdownSkipLine(code)).toBe(
        `Breakdown skipped: ${QOTD_BREAKDOWN_SKIP_REASON[code]} (${code})`,
      );
    }
  });
});

describe("the script: deterministic, by template", () => {
  it("sentences split outside maths only", () => {
    expect(
      explanationSentences(
        "Subtract 5 from both sides to get $3.5x = 15$. Then divide. Done!",
      ),
    ).toEqual([
      "Subtract 5 from both sides to get $3.5x = 15$.",
      "Then divide.",
      "Done!",
    ]);
  });

  it("spoken maths: operators in words, as the voice says them", () => {
    expect(spokenMathText("If $3x + 5 = 20$, what is $x$?")).toBe(
      "If 3x plus 5 equals 20, what is x?",
    );
    expect(spokenMathText("$x^2 - 4 = 0$")).toBe("x squared minus 4 equals 0");
    expect(spokenMathText("$\\frac{a}{b} \\le 3$")).toBe(
      "a over b is less than or equal to 3",
    );
    expect(spokenMathText("Both 7 and $-7$.")).toBe("Both 7 and negative 7.");
    expect(spokenMathText("The exhibit ______ visitors.")).toBe(
      "The exhibit blank visitors.",
    );
  });

  it("the same day always gives the same script, and it passes H1-H6 and the content rules", async () => {
    for (const date of SHUFFLED_DAYS) {
      const day = await archiveDay(date);
      const q = accepted(day);
      const a = breakdownScript(day, q);
      expect(breakdownScript(await archiveDay(date), accepted(day))).toEqual(a);
      expect(a.hook.voice).toBe(QOTD_BREAKDOWN_HOOK_VOICE);
      expect(a.hook.line.length).toBeLessThanOrEqual(90);
      expect(a.trap).toBeNull();
      expect(a.steps.length).toBe(
        explanationSentences(day.question.explanation).length,
      );
      expect(breakdownContentProblems(a, q)).toEqual([]);
    }
  });

  it("the brief's fixed hook alone fails H3, which is why the on-screen line carries the question", async () => {
    const q = accepted(await archiveDay("2026-10-02"));
    expect(hookPuzzleProblem(QOTD_BREAKDOWN_HOOK_VOICE, q)).toMatch(/^H3/);
    expect(hookPuzzleProblem(breakdownHookLine(q.stem), q)).toBeNull();
    expect(breakdownHookLine(q.stem)).toBe(
      "Yesterday's SAT question: If 3x + 5 = 20, what is the value of x?",
    );
  });
});

describe("captions and keywords: SCL-262 through the canonical builders, music credited", () => {
  it("each caption is the canonical builder's output with the credit last", async () => {
    const kit = loadKit();
    const day = await archiveDay("2026-10-03");
    const copy = breakdownCopy(day, "2026-10-04", kit.track.credit);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const test = nextSatTest("2026-10-04");
    const headline = qotdHeadline(test, "Reading and Writing");
    expect(copy.copy.headline).toBe(headline);
    expect(copy.copy.caption).toBe(
      socialTiktokCaption(headline, test, "Reading and Writing", [
        kit.track.credit,
      ]),
    );
    expect(copy.copy.instagram_caption).toBe(
      socialInstagramCaption(headline, test, "Reading and Writing", [
        kit.track.credit,
      ]),
    );
    expect(copy.copy.facebook_caption).toBe(
      socialFacebookCaption(headline, test, "Reading and Writing", [
        kit.track.credit,
      ]),
    );
    for (const c of [
      copy.copy.caption,
      copy.copy.instagram_caption,
      copy.copy.facebook_caption,
    ])
      expect(c.split("\n").at(-1)).toBe(kit.track.credit);
    expect(copy.copy.keywords).toContain("SAT grammar");
  });

  it("no caption names the answer", async () => {
    const kit = loadKit();
    for (const date of SHUFFLED_DAYS) {
      const day = await archiveDay(date);
      const copy = breakdownCopy(day, nextDay(date), kit.track.credit);
      if (!copy.ok) throw new Error(copy.problems.join("; "));
      const correct = day.question.options.find(
        (o) => o.id === day.question.correct_option_id,
      );
      for (const c of [
        copy.copy.caption,
        copy.copy.instagram_caption,
        copy.copy.facebook_caption,
      ]) {
        expect(c.length).toBeGreaterThan(0);
        expect(namesALetter(c)).toBe(false);
        expect(c.toLowerCase()).not.toContain(
          ` ${correct?.text.toLowerCase()} `,
        );
      }
    }
  });
});

describe("the pilot window: 14 days, off by default", () => {
  it("is off until Karl sets the dates", () => {
    expect(QOTD_BREAKDOWN_PILOT).toEqual({ start: null, end: null });
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-10", false)).toBe("off");
  });

  it("runs from start to end inclusive, then notes 'pilot ended'; paused stops it", () => {
    const pilot = qotdBreakdownPilotSchema.parse({
      start: "2026-11-05",
      end: "2026-11-18",
    });
    expect(pilotWindow(pilot, "2026-11-04", false)).toBe("not_started");
    expect(pilotWindow(pilot, "2026-11-05", false)).toBe("active");
    expect(pilotWindow(pilot, "2026-11-18", false)).toBe("active");
    expect(pilotWindow(pilot, "2026-11-19", false)).toBe("ended");
    expect(pilotWindow(pilot, "2026-11-10", true)).toBe("paused");
  });

  it("refuses one date alone, an end before the start, or more than 14 days", () => {
    for (const bad of [
      { start: "2026-11-05", end: null },
      { start: "2026-11-05", end: "2026-11-04" },
      { start: "2026-11-05", end: "2026-11-19" },
    ])
      expect(
        qotdBreakdownPilotSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
  });
});

describe("the post: the video, or the answer slide and the notice; nothing outside the window", () => {
  const built = qotdBreakdownManifestSchema.parse({
    status: "built",
    qotd_date: "2026-10-03",
    posted_on: "2026-10-04",
    section: "Reading and Writing",
    video: "qotd-2026-10-03-breakdown.mp4",
    label: "QOTD breakdown · 2026-10-03 · Reading and Writing",
    headline: "H",
    caption: "H\n\nx",
    instagram_caption: "H\n\ny",
    facebook_caption: "H\n\nz",
    keywords: ["SAT"],
    warnings: [],
    option_order: ["C", "B", "D", "A"],
    display_letter: "A",
    duration_seconds: 39,
  });

  it("built: the video first, then the SCL-262 copy blocks; Karl posts by hand", () => {
    const plan = breakdownPlan(built, () => false);
    expect(plan.kind).toBe("video");
    if (plan.kind !== "video") return;
    expect(plan.steps.map((s) => s.kind)).toEqual([
      "video",
      "message",
      "message",
      "message",
    ]);
    const first = plan.steps[0];
    expect(first?.kind === "video" && first.comment).toContain(
      "Karl posts by hand",
    );
  });

  it("skipped: yesterday's answer slide with 'Breakdown skipped: <reason>', or the notice alone", () => {
    const skipped = qotdBreakdownManifestSchema.parse({
      status: "skipped",
      qotd_date: "2026-10-03",
      posted_on: "2026-10-04",
      code: "letter_named",
    });
    const withSlide = breakdownPlan(
      skipped,
      (f) => f === "qotd-2026-10-03-tiktok-3.png",
    );
    expect(withSlide.kind === "fallback" && withSlide.slide).toBe(
      "qotd-2026-10-03-tiktok-3.png",
    );
    expect(withSlide.kind === "fallback" && withSlide.text).toContain(
      breakdownSkipLine("letter_named"),
    );
    const without = breakdownPlan(skipped, () => false);
    expect(without.kind === "fallback" && without.slide).toBeNull();
    const crashed = breakdownPlan(null, () => true);
    expect(crashed.kind === "fallback" && crashed.text).toContain(
      "(build_failed)",
    );
  });

  it("inactive: nothing is posted", () => {
    const inactive = qotdBreakdownManifestSchema.parse({
      status: "inactive",
      qotd_date: "2026-11-19",
      posted_on: "2026-11-20",
      window: "ended",
    });
    expect(breakdownPlan(inactive, () => true)).toEqual({
      kind: "nothing",
      note: "pilot ended",
    });
  });
});

type Step = {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  "continue-on-error"?: boolean;
};
type Job = {
  needs?: string;
  if?: string;
  steps: Step[];
  outputs?: Record<string, string>;
};

describe("the workflow: after the QOTD, never blocking it; Kokoro af_heart only", () => {
  const wf = readFileSync(
    resolve(ROOT, ".github/workflows/qotd-social.yml"),
    "utf8",
  );
  const doc = parseYaml(wf) as { jobs: { assets: Job; breakdown: Job } };
  const job = doc.jobs.breakdown;
  const names = job.steps.map((s) => s.name);

  it("runs after the QOTD job, whatever its result, as its own job", () => {
    expect(job.needs).toBe("assets");
    expect(job.if).toBe("always()");
    expect(doc.jobs.assets.outputs?.date).toBe("${{ steps.day.outputs.date }}");
    // Nothing of the breakdown is in the QOTD job.
    expect(JSON.stringify(doc.jobs.assets)).not.toContain("breakdown");
  });

  it("the token is read only by the breakdown's post, which posts only inside the window", () => {
    const post = job.steps.find((s) => s.name === "Breakdown Slack post");
    expect(post?.if).toBe(
      "always() && github.event_name != 'pull_request' && steps.window.outputs.window == 'active'",
    );
    expect(post?.env).toEqual({
      SLACK_BOT_TOKEN: "${{ secrets.SLACK_BOT_TOKEN }}",
      SLACK_CHANNEL_ID:
        "${{ inputs.slack_channel || vars.SOCIAL_SLACK_CHANNEL_ID }}",
    });
    for (const step of job.steps)
      expect(JSON.stringify(step).includes("secrets."), step.name).toBe(
        step === post,
      );
  });

  it("pull requests: a dry run on the real fixture rows, the MP4 uploaded, nothing sent", () => {
    const build = job.steps.find((s) => s.name === "Build the breakdown");
    expect(build?.run).toMatch(
      /--fixture tests\/fixtures\/qotd\/rows\.json \\\s+--date 2026-10-03 --now 2026-10-04T04:05:00Z --dry-run/,
    );
    const dry = job.steps.find(
      (s) => s.name === "Breakdown Slack post (dry run)",
    );
    expect(dry?.if).toBe("always() && github.event_name == 'pull_request'");
    expect(dry?.run).toContain("--dry-run");
    expect(dry?.env).toBeUndefined();
    const upload = job.steps.find(
      (s) => s.name === "Upload the breakdown video",
    );
    expect(upload?.uses).toBe("actions/upload-artifact@v4");
    expect(upload?.with?.path).toContain("*.mp4");
    expect(names.indexOf("Upload the breakdown video")).toBeLessThan(
      names.indexOf("Breakdown Slack post"),
    );
  });

  it("Python: every package pinned, from the one requirements file; the voice data cached", () => {
    const reqs = readFileSync(
      resolve(ROOT, "scripts/qotd-social/breakdown-requirements.txt"),
      "utf8",
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(reqs.length).toBeGreaterThanOrEqual(2);
    for (const line of reqs)
      expect(line).toMatch(/^[A-Za-z0-9_.-]+==\d[\w.]*$/);
    expect(reqs.some((l) => l.startsWith("kokoro-onnx=="))).toBe(true);
    expect(reqs.some((l) => l.startsWith("soundfile=="))).toBe(true);
    const pips = job.steps.filter((s) => /pip3? install/.test(s.run ?? ""));
    expect(pips.map((s) => s.run?.trim().split("\n")[0])).toEqual([
      "python -m pip install -r scripts/qotd-social/breakdown-requirements.txt",
    ]);
    const cache = job.steps.find((s) => s.uses === "actions/cache@v4");
    expect(cache?.with?.path).toBe("~/.cache/hyperframes");
    expect(wf).not.toMatch(/openvoice|clone_line|WE_VOICE_REFERENCE/i);
  });

  it("the voice is Kokoro af_heart, never the clone", () => {
    expect(QOTD_BREAKDOWN_VOICE_PROFILE).toBe("af_heart");
    expect(loadKit().voice.profiles[QOTD_BREAKDOWN_VOICE_PROFILE]?.engine).toBe(
      "kokoro",
    );
  });
});

describe("the fixture is real output", () => {
  it("every archive row reaches the breakdown through the real projection", async () => {
    expect(QOTD_ARCHIVE_ROWS.length).toBeGreaterThanOrEqual(3);
    for (const row of QOTD_ARCHIVE_ROWS) {
      const day = await archiveDay(row.qotd_date);
      expect(day.qotd_date).toBe(row.qotd_date);
      if (row.item_type === "mcq")
        expect(day.question.correct_letter).toBe(row.correct_display_letter);
    }
  });
});
