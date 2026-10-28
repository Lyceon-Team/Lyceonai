/**
 * @spec [Doc 10A §7, §11; owner decisions 2026-10-07 on the QOTD social assets (no answer in
 *       the image or caption; no future day generated early or reachable; the caption passes the
 *       guards; socialAssetLeaks with the "answer in caption" plant)] | @implemented [2026-10-07]
 *
 * plain English: every day in the ONE QOTD fixture (tests/lib/qotd-fixture.ts, rows the SQL
 * returned) goes through the real projections (toTodayResponse / toArchiveResponse), the real
 * social input, caption, alt text and card, and is then checked against that day's revealed
 * answer. Presence before absence: each check first proves the output is non-trivial. The
 * plants put the answer into a caption and require socialAssetLeaks to go red, and show that
 * the existing banned-phrase and outcome guards alone would have passed it.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { QotdSocialCard } from "@/components/qotd/QotdSocialCard";
import { QotdTiktokSlide } from "@/components/qotd/QotdTiktokSlide";
import {
  previousQotdDate,
  qotdSocialInputSchema,
  qotdSocialPostManifestSchema,
  QOTD_TIKTOK_TITLE_MAX,
  QOTD_TIKTOK_WHY_MAX,
  type QotdArchiveResponse,
  type QotdRedditPost,
  type QotdReveal,
  type QotdSocialPostManifest,
  type QotdSocialInput,
  type QotdTiktokCarousel,
} from "../../packages/shared/src/qotd-schema";
import {
  buildRedditPost,
  buildReveal,
  qotdArchiveUrl,
  withheldReveal,
} from "../../shared/qotd/reveal";
import {
  QOTD_ALT_TEXT_MAX,
  QOTD_SOCIAL_FORMATS,
  buildSocialCopy,
  socialAssetLeaks,
  socialCopyProblems,
  socialInputFromArchive,
  socialInputFromToday,
  socialInputProblems,
  speakMixedText,
  tiktokCarouselLeaks,
} from "../../shared/qotd/social";
import {
  firstBannedPhrase,
  firstUnapprovedOutcome,
} from "../../shared/seo/banned-phrases";
import {
  toArchiveResponse,
  toTodayResponse,
} from "../../server/services/qotd/qotd-service";
import {
  loadReveal,
  loadYesterday,
  pastDateProblem,
  publishDecision,
  tiktokDecision,
  writePublishManifest,
  type ArchiveFetch,
  type Source,
  type TiktokBuild,
} from "../../scripts/qotd-social/generate";
import {
  QOTD_TIKTOK_CAPTION,
  QOTD_TIKTOK_SAFE,
  QOTD_TIKTOK_SIZE,
  buildTiktokCarousel,
  buildTiktokTitle,
  capTiktokTitle,
  tiktokSafePx,
  tiktokWhy,
  QOTD_TIKTOK_WHY_MORE,
} from "../../shared/qotd/tiktok";
import { QOTD_TIKTOK_CSS } from "@/components/qotd/QotdTiktokSlide";
import { plainMathText } from "../../shared/qotd/plain-math";
import {
  loadPost,
  run,
  slackCopyMessage,
  slackImagesComment,
  slackRedditMessage,
  slackRevealMessage,
  slackTiktokMessage,
  slackTiktokSlidesComment,
  slackPostPlan,
  SLACK_POST_LABELS,
} from "../../scripts/qotd-social/post-to-slack";
import { slackConfig, type FetchLike } from "../../scripts/slack/client";
import { QOTD_RW_MAX_PASSAGE_CHARS } from "../../shared/qotd/readability";
import {
  QOTD_ARCHIVE_ROWS,
  QOTD_FIXTURE_NOW,
  QOTD_FIXTURE_TODAY,
  qotdTodayRow,
} from "../lib/qotd-fixture";

// The option tokens are HMACs under a key derived from this secret (option-tokens.ts).
process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET ??=
  "qotd-social-test-secret-not-real";

const ROOT = resolve(import.meta.dirname, "../..");
const DAYS: QotdArchiveResponse[] = QOTD_ARCHIVE_ROWS.map(toArchiveResponse);
/** Today's row as an archive day: only so the test can know its answer. */
const TODAY_REVEALED = toArchiveResponse(qotdTodayRow());

function cardMarkup(
  input: QotdSocialInput,
  format: "portrait" | "story",
): string {
  return renderToStaticMarkup(
    createElement(QotdSocialCard, { input, format, logoSrc: "logo.png" }),
  );
}

/** Visible text of the markup, roughly as innerText would give it. */
function visibleText(markup: string): string {
  return markup
    .replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** One TikTok slide's visible text, rendered by the real component. */
function slideText(carousel: QotdTiktokCarousel, slide: 1 | 2 | 3): string {
  return visibleText(
    renderToStaticMarkup(
      createElement(QotdTiktokSlide, { slide, carousel, logoSrc: "logo.png" }),
    ),
  );
}

/**
 * What generate.ts hands publishDecision for the TikTok carousel of a posted day: yesterday's
 * fixture archive day through the real builder and the real slide component, or skipped as
 * withheld when the fixture has no yesterday (Karl, 2026-10-23).
 */
function tiktokFor(source: Source): TiktokBuild {
  const y = previousQotdDate(source.input.qotd_date);
  const day = DAYS.find((d) => d.qotd_date === y);
  if (!day) return { status: "skipped", qotd_date: y, reason: "withheld" };
  const built = buildTiktokCarousel(day, source.input.qotd_date);
  if (!built.ok) {
    return { status: "refused", problem: built.problem };
  }
  return {
    status: "built",
    carouselDay: day,
    carousel: built.carousel,
    slides: ([1, 2, 3] as const).map((slide) => ({
      slide,
      cardText: slideText(built.carousel, slide),
    })),
  };
}

function outputs(input: QotdSocialInput): {
  caption: string;
  alt_text: string;
  card_text: string;
} {
  const copy = buildSocialCopy(input);
  return { ...copy, card_text: visibleText(cardMarkup(input, "portrait")) };
}

describe("the fixture is non-trivial (presence before absence)", () => {
  it("has archive days of both item types and both sections, plus today", () => {
    expect(DAYS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(DAYS.map((d) => d.question.item_type))).toEqual(
      new Set(["mcq", "grid_in"]),
    );
    expect(new Set(DAYS.map((d) => d.question.section_code))).toEqual(
      new Set(["M", "RW"]),
    );
    for (const d of DAYS)
      expect(d.question.explanation.length).toBeGreaterThan(20);
    expect(TODAY_REVEALED.qotd_date).toBe(QOTD_FIXTURE_TODAY);
  });
});

describe("the social input never carries an answer", () => {
  // Built inside each test, not at collection: a throwing projection must fail a NAMED test.
  const base = (): QotdSocialInput => socialInputFromArchive(DAYS[0]!);

  it("rejects a real answer or explanation, and any extra key", () => {
    const b = base();
    expect(qotdSocialInputSchema.safeParse(b).success).toBe(true);
    expect(
      qotdSocialInputSchema.safeParse({ ...b, correct_answer: "B" }).success,
    ).toBe(false);
    expect(
      qotdSocialInputSchema.safeParse({ ...b, explanation: "Subtract 5." })
        .success,
    ).toBe(false);
    expect(
      qotdSocialInputSchema.safeParse({ ...b, correct_option_id: "B" }).success,
    ).toBe(false);
    expect(
      qotdSocialInputSchema.safeParse({
        ...b,
        options: b.options.map((o, i) =>
          i === 0 ? { ...o, correct: true } : o,
        ),
      }).success,
    ).toBe(false);
  });

  it("drops the archive's answer and explanation before anything is built", () => {
    for (const day of DAYS) {
      const json = JSON.stringify(socialInputFromArchive(day));
      expect(json).toContain(day.question.domain);
      expect(json).not.toContain(day.question.explanation);
      expect(json).not.toContain("correct_option_id");
    }
  });

  it("keeps today's options in canonical order, the archive's order (Karl's ruling 2026-10-23)", () => {
    const todayInput = socialInputFromToday(toTodayResponse(qotdTodayRow()));
    expect(todayInput.options).toHaveLength(4);
    // The same order as the archive payload of the same day, request after request.
    for (let k = 0; k < 10; k += 1) {
      expect(
        socialInputFromToday(toTodayResponse(qotdTodayRow())).options,
      ).toEqual(socialInputFromArchive(TODAY_REVEALED).options);
    }
  });

  it("the reveal's letter is the letter the question showed, for every day (today's image and the archive alike)", () => {
    const nextDay = (date: string): string =>
      new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const cases: [QotdSocialInput, QotdArchiveResponse][] = [
      [socialInputFromToday(toTodayResponse(qotdTodayRow())), TODAY_REVEALED],
      ...DAYS.map((d): [QotdSocialInput, QotdArchiveResponse] => [
        socialInputFromArchive(d),
        d,
      ]),
    ];
    let checked = 0;
    for (const [input, day] of cases) {
      if (day.question.item_type !== "mcq") continue;
      const built = buildReveal(day, nextDay(day.qotd_date));
      expect(built.ok).toBe(true);
      if (!built.ok || built.reveal.status !== "revealed") continue;
      if (built.reveal.answer.kind !== "choice") continue;
      const correct = day.question.options.find(
        (o) => o.id === day.question.correct_option_id,
      );
      const shown = input.options.findIndex((o) => o.text === correct?.text);
      expect(shown).toBeGreaterThanOrEqual(0);
      expect("ABCD"[shown]).toBe(built.reveal.answer.letter);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1);
  });

  it("the reveal's letter is the letter the question showed, for every day (today's image and the archive alike)", () => {
    const nextDay = (date: string): string =>
      new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const cases: [QotdSocialInput, QotdArchiveResponse][] = [
      [socialInputFromToday(toTodayResponse(qotdTodayRow())), TODAY_REVEALED],
      ...DAYS.map((d): [QotdSocialInput, QotdArchiveResponse] => [
        socialInputFromArchive(d),
        d,
      ]),
    ];
    let checked = 0;
    for (const [input, day] of cases) {
      if (day.question.item_type !== "mcq") continue;
      const built = buildReveal(day, nextDay(day.qotd_date));
      expect(built.ok).toBe(true);
      if (!built.ok || built.reveal.status !== "revealed") continue;
      if (built.reveal.answer.kind !== "choice") continue;
      const correct = day.question.options.find(
        (o) => o.id === day.question.correct_option_id,
      );
      const shown = input.options.findIndex((o) => o.text === correct?.text);
      expect(shown).toBeGreaterThanOrEqual(0);
      expect("ABCD"[shown]).toBe(built.reveal.answer.letter);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1);
  });
});

describe("no answer in the caption, alt text or image (real fixture days)", () => {
  // The input is built inside each test (a thunk), so a projection that throws fails a named
  // test instead of the file's collection.
  type Case = [string, () => QotdSocialInput, QotdArchiveResponse];
  const cases: Case[] = [
    ...DAYS.map(
      (d): Case => [
        `archive ${d.qotd_date}`,
        () => socialInputFromArchive(d),
        d,
      ],
    ),
    [
      `today ${QOTD_FIXTURE_TODAY}`,
      () => socialInputFromToday(toTodayResponse(qotdTodayRow())),
      TODAY_REVEALED,
    ],
  ];

  it.each(cases)(
    "%s: socialAssetLeaks finds nothing",
    (_name, makeInput, revealed) => {
      const input = makeInput();
      const out = outputs(input);
      expect(out.card_text).toContain(input.domain);
      expect(out.alt_text).toContain("lyceon.ai/sat-question-of-the-day");
      expect(socialAssetLeaks(out, revealed)).toEqual([]);
    },
  );

  it.each(cases)(
    "%s: both card sizes mark no choice and show no answer",
    (_name, makeInput, revealed) => {
      const input = makeInput();
      for (const format of Object.keys(QOTD_SOCIAL_FORMATS) as Array<
        "portrait" | "story"
      >) {
        const markup = cardMarkup(input, format);
        expect(markup).toContain(`data-qotd-social-card="${format}"`);
        expect(markup).toContain("lyceon.ai/sat-question-of-the-day");
        expect(markup).toContain('alt="Lyceon"');
        expect(markup).not.toMatch(
          /correct|aria-checked|aria-selected|data-answer/i,
        );
        const text = visibleText(markup);
        if (input.item_type === "mcq") {
          expect(markup.match(/class="qs-key"/g)).toHaveLength(4);
        } else {
          expect(text).toContain("Enter your answer");
          expect(text).not.toMatch(
            new RegExp(`(^|\\s)${revealed.question.correct_answer}(\\s|$)`),
          );
        }
      }
    },
  );
});

describe("caption and alt text", () => {
  it("is the approved caption for each section (owner decision 2026-10-07)", () => {
    const math = buildSocialCopy(
      socialInputFromArchive(
        DAYS.find((d) => d.question.item_type === "grid_in")!,
      ),
    );
    expect(math.caption).toBe(
      "SAT Question of the Day: Math, Advanced Math.\n\nGive it a try, then answer it free at lyceon.ai/sat-question-of-the-day\n\n#SAT #DigitalSAT #SATPrep #SATMath #QuestionOfTheDay",
    );
    const rw = buildSocialCopy(
      socialInputFromArchive(
        DAYS.find((d) => d.question.section_code === "RW")!,
      ),
    );
    expect(rw.caption).toMatch(
      /^SAT Question of the Day: Reading and Writing, /,
    );
    expect(rw.caption).toMatch(
      /#SAT #DigitalSAT #SATPrep #SATReading #QuestionOfTheDay$/,
    );
  });

  it.each(DAYS.map((d) => [d.qotd_date, d] as const))(
    "%s passes the banned-phrase, outcome and reveal checks",
    (_date, day) => {
      const input = socialInputFromArchive(day);
      const copy = buildSocialCopy(input);
      expect(copy.caption.length).toBeGreaterThan(50);
      expect(socialCopyProblems(copy, input)).toEqual([]);
    },
  );

  it("reads the question out in full, maths in words", () => {
    const gridIn = socialInputFromArchive(
      DAYS.find((d) => d.question.item_type === "grid_in")!,
    );
    const alt = buildSocialCopy(gridIn).alt_text;
    expect(alt).toContain(
      "If x squared = 49 and x > 0, what is the value of x?",
    );
    expect(alt).toContain("Student-produced response.");
    expect(alt).not.toContain("$");
  });

  it("speaks the fixed table, and gives up on anything outside it", () => {
    expect(speakMixedText("on $\\overline{PQ}$")).toBe("on segment PQ");
    expect(speakMixedText("$\\frac{3}{4}$ of $\\sqrt{x}$")).toBe(
      "3 over 4 of the square root of x",
    );
    expect(speakMixedText("$m\\angle A = 30^\\circ$")).toBe(
      "m angle A = 30 degrees",
    );
    expect(speakMixedText("the finding______ these")).toBe(
      "the finding [blank] these",
    );
    expect(speakMixedText("$\\int_0^1 x\\,dx$")).toBeNull();
  });

  it("reads a paired <u>...</u> as an underline, never the tag (2026-10-11)", () => {
    expect(
      speakMixedText(
        "Bees dance. <u>The dance encodes distance.</u> Others follow.",
      ),
    ).toBe(
      "Bees dance. [underlined] The dance encodes distance. [end underlined] Others follow.",
    );
    // Anything else stays the text it is: only the paired, plain tag is markup.
    expect(speakMixedText("a <b>bold</b> claim")).toBe("a <b>bold</b> claim");
  });

  it("falls back to a generic alt text rather than garbled maths or an over-long one", () => {
    const day = socialInputFromArchive(DAYS[0]!);
    const unspeakable = buildSocialCopy({
      ...day,
      stem: "Evaluate $\\int_0^1 x\\,dx$.",
    });
    expect(unspeakable.alt_text).toContain(
      "The image shows the question and its four answer choices.",
    );
    expect(unspeakable.alt_text).not.toContain("int");
    const long = buildSocialCopy({ ...day, passage: "word ".repeat(400) });
    expect(long.alt_text.length).toBeLessThanOrEqual(QOTD_ALT_TEXT_MAX);
    expect(long.alt_text).toContain("The image shows the question");
  });

  it("refuses a day whose stem repeats its passage (the live 2026-10-07 defect)", () => {
    const rw = socialInputFromArchive(DAYS.find((d) => d.question.passage)!);
    expect(socialInputProblems(rw)).toEqual([]);
    expect(socialInputProblems({ ...rw, stem: rw.passage! })).toHaveLength(1);
  });

  // Owner brief "QOTD — readability filter (Karl's option B)", 2026-10-09: the social path
  // refuses exactly what the scheduler refuses, through the same predicate and thresholds.
  it("refuses a day the scheduler would refuse as not quick to read", () => {
    const rw = socialInputFromArchive(DAYS.find((d) => d.question.passage)!);
    expect(socialInputProblems(rw)).toEqual([]);
    expect(
      socialInputProblems({ ...rw, passage: "Text 1: one. Text 2: two." }),
    ).toEqual(["input: not quick to read (paired_passage)"]);
    expect(
      socialInputProblems({
        ...rw,
        passage: "p".repeat(QOTD_RW_MAX_PASSAGE_CHARS + 1),
      }),
    ).toEqual(["input: not quick to read (rw_passage_too_long)"]);
    const grid = socialInputFromArchive(
      DAYS.find((d) => d.question.item_type === "grid_in")!,
    );
    expect(socialInputProblems(grid)).toEqual([
      "input: not quick to read (not_multiple_choice)",
    ]);
  });
});

describe("PLANTS: the answer in a caption turns the guard red", () => {
  const gridIn = DAYS.find((d) => d.question.item_type === "grid_in")!;
  const mcq = DAYS.find((d) => d.question.item_type === "mcq")!;

  function planted(day: QotdArchiveResponse, extra: string) {
    const out = outputs(socialInputFromArchive(day));
    return { ...out, caption: `${out.caption}\n\n${extra}` };
  }

  it("the existing guards alone pass a caption carrying the answer (why this check exists)", () => {
    const caption = planted(
      gridIn,
      `Answer: ${gridIn.question.correct_answer}`,
    ).caption;
    expect(firstBannedPhrase(caption)).toBeNull();
    expect(firstUnapprovedOutcome(caption)).toBeNull();
  });

  it("grid-in: the keyed value in the caption", () => {
    const leaks = socialAssetLeaks(
      planted(gridIn, `It's ${gridIn.question.correct_answer}!`),
      gridIn,
    );
    expect(leaks).toContain(
      `caption: carries the grid-in answer "${gridIn.question.correct_answer}"`,
    );
  });

  it("MCQ: the correct choice's text in the caption", () => {
    const correct = mcq.question.options.find(
      (o) => o.id === mcq.question.correct_option_id,
    )!;
    const leaks = socialAssetLeaks(planted(mcq, `Hint: ${correct.text}`), mcq);
    expect(leaks).toContain(
      `caption: names the correct choice "${correct.text}"`,
    );
  });

  it("the explanation in the caption", () => {
    const leaks = socialAssetLeaks(planted(mcq, mcq.question.explanation), mcq);
    expect(
      leaks.some((l) => l.startsWith("caption: carries the explanation")),
    ).toBe(true);
  });

  it("reveal wording in the caption, caught even without the answer (every day)", () => {
    const input = socialInputFromArchive(mcq);
    const copy = buildSocialCopy(input);
    const red = {
      ...copy,
      caption: `${copy.caption}\nThe correct answer is ${mcq.question.correct_option_id}.`,
    };
    expect(
      socialCopyProblems(red, input).some((p) =>
        p.startsWith("caption: reveal wording"),
      ),
    ).toBe(true);
    expect(
      socialAssetLeaks({ ...red, card_text: "" }, mcq).length,
    ).toBeGreaterThan(0);
  });

  it("a card that singles out one choice", () => {
    const out = outputs(socialInputFromArchive(mcq));
    const correct = mcq.question.options.find(
      (o) => o.id === mcq.question.correct_option_id,
    )!;
    const leaks = socialAssetLeaks(
      { ...out, card_text: `${out.caption} ${correct.text}` },
      mcq,
    );
    expect(
      leaks.some((l) => l.startsWith("card: shows 1 of the 4 choices")),
    ).toBe(true);
  });
});

describe("future days are never generated early or publicly reachable", () => {
  it("a date is buildable only once it has passed in America/Chicago", () => {
    expect(QOTD_FIXTURE_TODAY).toBe("2026-10-05");
    expect(pastDateProblem("2026-10-04", QOTD_FIXTURE_NOW)).toBeNull();
    expect(pastDateProblem("2026-10-05", QOTD_FIXTURE_NOW)).toMatch(
      /has not passed/,
    );
    expect(pastDateProblem("2026-10-06", QOTD_FIXTURE_NOW)).toMatch(
      /has not passed/,
    );
    expect(pastDateProblem("2099-01-01", QOTD_FIXTURE_NOW)).toMatch(
      /has not passed/,
    );
    expect(pastDateProblem("2026-02-30", QOTD_FIXTURE_NOW)).toMatch(
      /not a YYYY-MM-DD/,
    );
    // 04:30 UTC on Oct 6 is still Oct 5 in Chicago: Oct 5 is today there, not yet past.
    expect(
      pastDateProblem("2026-10-05", new Date("2026-10-06T04:30:00Z")),
    ).toMatch(/has not passed/);
  });

  it("the generator reads only the public no-answer endpoint and past archive days", () => {
    const src = readFileSync(
      resolve(ROOT, "scripts/qotd-social/generate.ts"),
      "utf8",
    );
    const urls = [
      ...src.matchAll(/getJson\(`\$\{args\.baseUrl\}([^`]+)`\)/g),
    ].map((m) => m[1]);
    expect(urls).toEqual([
      "/api/public/qotd/today",
      "/api/public/qotd/${args.date}",
      "/api/public/qotd/archive",
    ]);
    // The date path is reachable only behind pastDateProblem.
    expect(src.indexOf("pastDateProblem(args.date)")).toBeGreaterThan(-1);
    expect(src.indexOf("pastDateProblem(args.date)")).toBeLessThan(
      src.indexOf("loadSource(args)"),
    );
  });

  it("the workflow's one secret is the Slack token, read only by the post, after the upload", () => {
    const wf = readFileSync(
      resolve(ROOT, ".github/workflows/qotd-social.yml"),
      "utf8",
    );
    expect(wf).toContain("scripts/qotd-social/generate.ts");
    expect(wf).toContain("actions/upload-artifact@v4");
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/);
    // One secret, the Slack token, referenced by the post and by the failure notice (SCL-258).
    expect(wf.match(/secrets\./g)).toEqual(["secrets.", "secrets."]);
    expect(wf).toContain("${{ secrets.SLACK_BOT_TOKEN }}");

    const steps = workflowSteps();
    const names = steps.map((s) => s.name);
    const upload = names.indexOf("Upload the assets");
    const post = names.indexOf("Post to Slack");
    const dry = names.indexOf("Slack post (dry run)");
    expect(upload).toBeGreaterThan(-1);
    // The post comes after the upload, so a Slack failure never costs the download.
    expect(post).toBeGreaterThan(upload);
    expect(dry).toBeGreaterThan(upload);
    const failure = names.indexOf("Post the failure to Slack");
    expect(failure).toBeGreaterThan(post);
    // The token is in those two steps' env and in no other step.
    for (const [i, step] of steps.entries()) {
      expect(JSON.stringify(step).includes("secrets."), step.name).toBe(
        i === post || i === failure,
      );
    }
    // A failed scheduled or hand-started run posts one failure notice (Karl, 2026-10-28).
    const failureStep = steps[failure]!;
    expect(failureStep.if).toBe(
      "failure() && github.event_name != 'pull_request'",
    );
    expect(failureStep.env).toEqual({
      SLACK_BOT_TOKEN: "${{ secrets.SLACK_BOT_TOKEN }}",
      SLACK_CHANNEL_ID:
        "${{ inputs.slack_channel || vars.SOCIAL_SLACK_CHANNEL_ID }}",
    });
    expect(failureStep.run).toBe(
      "pnpm exec tsx scripts/qotd-social/post-to-slack.ts --dir qotd-social-out --failure",
    );
    const postStep = steps[post]!;
    expect(postStep.if).toBe(
      "success() && github.event_name != 'pull_request'",
    );
    expect(postStep.env).toEqual({
      SLACK_BOT_TOKEN: "${{ secrets.SLACK_BOT_TOKEN }}",
      SLACK_CHANNEL_ID:
        "${{ inputs.slack_channel || vars.SOCIAL_SLACK_CHANNEL_ID }}",
    });
    expect(postStep.run).toBe(
      "pnpm exec tsx scripts/qotd-social/post-to-slack.ts --dir qotd-social-out",
    );
    // Pull requests: the dry run, which sends nothing.
    const dryStep = steps[dry]!;
    expect(dryStep.if).toBe("success() && github.event_name == 'pull_request'");
    expect(dryStep.run).toBe(
      "pnpm exec tsx scripts/qotd-social/post-to-slack.ts --dir qotd-social-out --dry-run",
    );
    expect(dryStep.env).toBeUndefined();
    // The manifest travels with the download.
    expect(steps[upload]!.with?.path).toContain("qotd-social-out/post.json");
  });
});

type WorkflowStep = {
  name: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};

function workflowSteps(): WorkflowStep[] {
  const doc: unknown = parseYaml(
    readFileSync(resolve(ROOT, ".github/workflows/qotd-social.yml"), "utf8"),
  );
  const steps = (doc as { jobs: { assets: { steps: WorkflowStep[] } } }).jobs
    .assets.steps;
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Slack (owner brief 2026-10-10): post only after every check passed, fail loudly, no answer.
// ---------------------------------------------------------------------------------------------

/**
 * Yesterday's reveal for a posted day, as loadReveal builds it: from the fixture's archive day
 * before it, or withheld when the archive has none (owner brief 2026-10-15).
 */
function revealFor(postedDate: string): QotdReveal {
  const day = DAYS.find((d) => d.qotd_date === previousQotdDate(postedDate));
  if (!day) return withheldReveal(postedDate);
  const built = buildReveal(day, postedDate);
  if (!built.ok) throw new Error(built.problem);
  return built.reveal;
}

/**
 * What generate.ts hands publishDecision for a day: the copy, each card's visible text, today's
 * Reddit post and yesterday's reveal (either may be overridden to plant a defect).
 */
function decide(
  source: Source,
  cardText?: string,
  over: {
    reddit?: QotdRedditPost;
    reveal?: QotdReveal;
    tiktok?: TiktokBuild;
  } = {},
) {
  const copy = buildSocialCopy(source.input);
  const rendered = (["portrait", "story"] as const).map((format) => ({
    format,
    cardText: cardText ?? visibleText(cardMarkup(source.input, format)),
  }));
  const reddit = over.reddit ?? buildRedditPost(source.input);
  const reveal = over.reveal ?? revealFor(source.input.qotd_date);
  const tiktok = over.tiktok ?? tiktokFor(source);
  return {
    copy,
    rendered,
    reddit,
    reveal,
    tiktok,
    decision: publishDecision(
      source,
      copy,
      rendered,
      QOTD_FIXTURE_TODAY,
      reddit,
      reveal,
      tiktok,
    ),
  };
}

function pastSource(day: QotdArchiveResponse): Source {
  return { kind: "past", input: socialInputFromArchive(day), revealed: day };
}

function todaySource(): Source {
  return {
    kind: "today",
    input: socialInputFromToday(toTodayResponse(qotdTodayRow())),
  };
}

function manifestFor(source: Source): QotdSocialPostManifest {
  const { decision } = decide(source);
  if (!decision.ok) throw new Error(decision.problems.join("; "));
  return decision.manifest;
}

/**
 * The fixture days the generator would publish (the rest fail a check that is not a leak).
 *
 * A function, not a module constant, so it runs inside a test and never while the file is being
 * collected. As a constant it built every day's social input at import, so a plant that breaks
 * `socialInputFromArchive` (qotd.mutations.sh M12) threw before any test existed: the file went
 * red with "no tests" and the named test that guards that leak never ran.
 */
function publishable(): QotdArchiveResponse[] {
  return DAYS.filter((d) => decide(pastSource(d)).decision.ok);
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("not-a-real-image-but-a-png-signature"),
]);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A build output directory exactly as generate.ts writes it for a passing day. */
function builtDir(manifest: QotdSocialPostManifest | null): string {
  const dir = mkdtempSync(join(tmpdir(), "qotd-slack-"));
  dirs.push(dir);
  const m = manifest ?? manifestFor(pastSource(publishable()[0]!));
  for (const image of m.images) writeFileSync(join(dir, image.file), PNG);
  if (m.tiktok.status === "built") {
    for (const file of m.tiktok.slides) writeFileSync(join(dir, file), PNG);
  }
  writeFileSync(join(dir, "caption.txt"), `${m.caption}\n`);
  writeFileSync(join(dir, "alt-text.txt"), `${m.alt_text}\n`);
  if (manifest) {
    writeFileSync(join(dir, "post.json"), JSON.stringify(manifest, null, 2));
  }
  return dir;
}

type Call = {
  url: string;
  body: string | Uint8Array | undefined;
  auth?: string;
};

/** A Slack that answers every method with ok: true (or with ERROR for one method). */
function fakeSlack(
  opts: {
    error?: [method: string, code: string];
    httpStatus?: number;
    /** files.info answers "not shared yet" this many times per file before it is shared. */
    sharePending?: number;
  } = {},
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  const pending = new Map<string, number>();
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, auth: init.headers?.Authorization });
    const method = url.replace("https://slack.com/api/", "");
    const reply = (status: number, json: unknown) => ({
      ok: status < 400,
      status,
      json: async () => json,
    });
    if (opts.httpStatus) return reply(opts.httpStatus, {});
    if (opts.error && opts.error[0] === method) {
      return reply(200, { ok: false, error: opts.error[1] });
    }
    if (method === "files.getUploadURLExternal") {
      n += 1;
      return reply(200, {
        ok: true,
        upload_url: `https://files.slack.com/upload/v1/test-${n}`,
        file_id: `F000${n}`,
      });
    }
    if (url.startsWith("https://files.slack.com/")) return reply(200, {});
    if (method === "files.completeUploadExternal") {
      const body = JSON.parse(String(init.body)) as { files: { id: string }[] };
      for (const f of body.files) pending.set(f.id, opts.sharePending ?? 0);
      return reply(200, {
        ok: true,
        files: body.files.map((f) => ({ id: f.id })),
      });
    }
    if (method === "files.info") {
      const id = new URLSearchParams(String(init.body)).get("file") ?? "";
      const left = pending.get(id) ?? 0;
      pending.set(id, left - 1);
      return reply(200, {
        ok: true,
        file: {
          id,
          shares:
            left > 0
              ? {}
              : {
                  public: {
                    [ENV.SLACK_CHANNEL_ID]: [{ ts: "1760000000.000001" }],
                  },
                },
        },
      });
    }
    if (method === "chat.postMessage") {
      return reply(200, { ok: true, ts: "1760000000.000100" });
    }
    return reply(404, {});
  };
  return { fetch, calls };
}

const ENV = {
  SLACK_BOT_TOKEN: "xoxb-test-token-not-real",
  SLACK_CHANNEL_ID: "C0TESTCHAN1",
};

/** What reached Slack, in order: each message's text, and each share's comment. */
function posted(calls: Call[]): { kind: "message" | "share"; text: string }[] {
  return calls.flatMap((c) => {
    if (c.url.endsWith("chat.postMessage")) {
      return [
        {
          kind: "message" as const,
          text: (JSON.parse(String(c.body)) as { text: string }).text,
        },
      ];
    }
    if (c.url.endsWith("files.completeUploadExternal")) {
      return [
        {
          kind: "share" as const,
          text: (JSON.parse(String(c.body)) as { initial_comment: string })
            .initial_comment,
        },
      ];
    }
    return [];
  });
}

function logs() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  };
}

/** Slack mrkdwn back to plain text. */
function unescapeMrkdwn(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("Slack: posts only after the leak check passes", () => {
  it("every fixture day that passes yields a manifest; a past day records its leak check", () => {
    // Presence first: publishable past days, and with today both sections are covered.
    expect(publishable().length).toBeGreaterThanOrEqual(2);
    expect(
      new Set([
        ...publishable().map((d) => manifestFor(pastSource(d)).section),
        manifestFor(todaySource()).section,
      ]),
    ).toEqual(new Set(["Math", "Reading and Writing"]));
    // A day that fails any check gets no manifest (here, a grid-in: not quick to read).
    const refused = DAYS.filter((d) => !publishable().includes(d));
    for (const day of refused) {
      const { decision } = decide(pastSource(day));
      expect(decision.ok).toBe(false);
    }
    for (const day of publishable()) {
      const m = manifestFor(pastSource(day));
      expect(m.checks).toEqual({
        input: "passed",
        copy: "passed",
        reveal_wording: "passed",
        leaks: "passed",
      });
      expect(m.images.map((i) => i.format)).toEqual(["portrait", "story"]);
    }
    // Today's source has no answer to check: recorded as such, never as a pass.
    expect(manifestFor(todaySource()).checks.leaks).toBe("no-answer-in-source");
  });

  it("the manifest schema refuses a leak check that did not pass or did not run", () => {
    const m = manifestFor(pastSource(publishable()[0]!));
    for (const leaks of ["failed", "no-answer-in-source", undefined]) {
      expect(
        qotdSocialPostManifestSchema.safeParse({
          ...m,
          checks: { ...m.checks, leaks },
        }).success,
        String(leaks),
      ).toBe(false);
    }
    const today = manifestFor(todaySource());
    expect(
      qotdSocialPostManifestSchema.safeParse({
        ...today,
        checks: { ...today.checks, leaks: "passed" },
      }).success,
    ).toBe(false);
  });

  it("no post.json, no post: run exits 1 and never calls Slack", async () => {
    const dir = builtDir(null);
    const slack = fakeSlack();
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(1);
    expect(slack.calls).toEqual([]);
    expect(l.err.join("\n")).toMatch(/refused: no post\.json/);
  });

  it("a passing day is posted: the five numbered items in order, uploads confirmed before the next", async () => {
    const manifest = manifestFor(pastSource(publishable()[0]!));
    const dir = builtDir(manifest);
    const slack = fakeSlack();
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(0);
    // This day's yesterday is not in the archive: no carousel, items 2 and 3 say so.
    expect(manifest.tiktok.status).toBe("skipped");
    expect(slack.calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/chat.postMessage", // 1/5 reveal
      "https://slack.com/api/chat.postMessage", // 2/5 no TikTok title or caption
      "https://slack.com/api/chat.postMessage", // 3/5 no carousel
      "https://slack.com/api/chat.postMessage", // 4/5 Reddit post
      "https://slack.com/api/files.getUploadURLExternal", // 5/5 images
      "https://files.slack.com/upload/v1/test-1",
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/test-2",
      "https://slack.com/api/files.completeUploadExternal",
      "https://slack.com/api/files.info",
      "https://slack.com/api/files.info",
      "https://slack.com/api/chat.postMessage", // 5/5 caption and alt text
    ]);
    // The token goes to Slack's API only, never to the upload URL.
    for (const c of slack.calls) {
      expect(c.auth).toBe(
        c.url.startsWith("https://files.slack.com/")
          ? undefined
          : `Bearer ${ENV.SLACK_BOT_TOKEN}`,
      );
    }
    const upload = slack.calls.find((c) =>
      c.url.endsWith("files.getUploadURLExternal"),
    )!;
    const first = new URLSearchParams(String(upload.body));
    expect(first.get("filename")).toBe(manifest.images[0]!.file);
    expect(first.get("length")).toBe(String(PNG.length));
    expect(first.get("alt_txt")).toBe(manifest.alt_text);
    const share = JSON.parse(
      String(
        slack.calls.find((c) => c.url.endsWith("files.completeUploadExternal"))!
          .body,
      ),
    ) as {
      files: { id: string }[];
      channel_id: string;
      initial_comment: string;
    };
    expect(share.files.map((f) => f.id)).toEqual(["F0001", "F0002"]);
    expect(share.channel_id).toBe(ENV.SLACK_CHANNEL_ID);
    expect(share.initial_comment).toContain(manifest.section);
    // The content of each message is unchanged; only the label line is new.
    expect(posted(slack.calls)).toEqual([
      {
        kind: "message",
        text: `*1/5 · Reddit: comment on yesterday's post*\n${slackRevealMessage(manifest)}`,
      },
      {
        kind: "message",
        text: "*2/5 · TikTok: no title or caption today* (yesterday's question (Thursday, October 1, 2026) is withheld or missing on the archive)",
      },
      {
        kind: "message",
        text: "*3/5 · TikTok: no carousel today* (yesterday's question (Thursday, October 1, 2026) is withheld or missing on the archive)",
      },
      {
        kind: "message",
        text: `*4/5 · Reddit: today's post*\n${slackRedditMessage(manifest)}`,
      },
      {
        kind: "share",
        text: `*5/5 · Today's question images*\n${slackImagesComment(manifest)}`,
      },
      {
        kind: "message",
        text: `*5/5 · Today's question images*\n${slackCopyMessage(manifest)}`,
      },
    ]);
    // The log names the day and the items; never the token or the question.
    const all = [...l.out, ...l.err].join("\n");
    expect(all).toContain(manifest.qotd_date);
    expect(all).not.toContain(ENV.SLACK_BOT_TOKEN);
    expect(all).not.toContain(manifest.caption.slice(0, 40));
  });

  it("a hand-edited caption.txt, a wrong-day image or a non-PNG is refused", () => {
    const manifest = manifestFor(pastSource(publishable()[0]!));
    const edited = builtDir(manifest);
    writeFileSync(join(edited, "caption.txt"), "something else\n");
    expect(loadPost(edited)).toEqual({
      ok: false,
      error: "caption.txt does not match post.json",
    });

    const notPng = builtDir(manifest);
    writeFileSync(join(notPng, manifest.images[0]!.file), "<svg/>");
    expect(loadPost(notPng)).toMatchObject({ ok: false });

    const other = DAYS.find((d) => d.qotd_date !== manifest.qotd_date)!;
    const wrongDay = builtDir({
      ...manifest,
      images: [
        { format: "portrait", file: `qotd-${other.qotd_date}-portrait.png` },
      ],
    });
    expect(loadPost(wrongDay)).toMatchObject({ ok: false });

    expect(loadPost(builtDir(manifest))).toMatchObject({ ok: true });
  });

  it("a dry run checks everything and sends nothing, with no token", async () => {
    const dir = builtDir(manifestFor(pastSource(publishable()[0]!)));
    const slack = fakeSlack();
    const l = logs();
    expect(await run(["--dir", dir, "--dry-run"], {}, slack.fetch, l.log)).toBe(
      0,
    );
    expect(slack.calls).toEqual([]);
    expect(l.out.join("\n")).toMatch(/dry run: .* nothing sent/);
    // ... and still refuses a day with no manifest.
    expect(
      await run(["--dir", builtDir(null), "--dry-run"], {}, slack.fetch, l.log),
    ).toBe(1);
  });
});

describe("Slack: fails loudly, never silently", () => {
  it("a missing token fails the run, names the secret, and calls nothing", async () => {
    const dir = builtDir(manifestFor(pastSource(publishable()[0]!)));
    for (const env of [
      { SLACK_CHANNEL_ID: ENV.SLACK_CHANNEL_ID },
      { ...ENV, SLACK_BOT_TOKEN: "" },
      { ...ENV, SLACK_BOT_TOKEN: "   " },
    ]) {
      const slack = fakeSlack();
      const l = logs();
      expect(await run(["--dir", dir], env, slack.fetch, l.log)).toBe(1);
      expect(slack.calls).toEqual([]);
      expect(l.err.join("\n")).toContain("SLACK_BOT_TOKEN is not set");
    }
  });

  it("a user token, or a missing or malformed channel, fails the same way", () => {
    expect(slackConfig({ ...ENV, SLACK_BOT_TOKEN: "xoxp-user-token" })).toEqual(
      {
        ok: false,
        error: "SLACK_BOT_TOKEN is not a bot token (xoxb-…)",
        reason: "token_not_bot",
      },
    );
    for (const channel of [undefined, "", "#social", "social", "U0123456789"]) {
      const r = slackConfig({ ...ENV, SLACK_CHANNEL_ID: channel });
      expect(r.ok, String(channel)).toBe(false);
      if (!r.ok) expect(r.error).toContain("SOCIAL_SLACK_CHANNEL_ID");
    }
    expect(slackConfig(ENV)).toEqual({
      ok: true,
      value: { token: ENV.SLACK_BOT_TOKEN, channel: ENV.SLACK_CHANNEL_ID },
    });
  });

  it.each([
    ["files.getUploadURLExternal", "invalid_auth"],
    ["files.completeUploadExternal", "not_in_channel"],
    ["chat.postMessage", "missing_scope"],
  ])("Slack's %s error %s fails the run and is named", async (method, code) => {
    const dir = builtDir(manifestFor(pastSource(publishable()[0]!)));
    const slack = fakeSlack({ error: [method, code] });
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(1);
    expect(l.err).toEqual([`qotd-slack: NOT POSTED: ${method}: ${code}`]);
    expect(l.out).toEqual([]);
  });

  it("Slack down (HTTP 503) fails the run", async () => {
    const dir = builtDir(manifestFor(pastSource(publishable()[0]!)));
    const slack = fakeSlack({ httpStatus: 503 });
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(1);
    // Item 1 is the first call now (Karl, 2026-10-26), so it is the one that fails.
    expect(l.err).toEqual([
      "qotd-slack: NOT POSTED: chat.postMessage: HTTP 503",
    ]);
  });
});

describe("Slack: the message carries the caption and no answer (real fixture days)", () => {
  type SlackCase = [string, () => Source, QotdArchiveResponse];
  // Built inside the test (see publishable()); each case's name rides on its leak assertion.
  function cases(): SlackCase[] {
    return [
      ...publishable().map(
        (d): SlackCase => [`archive ${d.qotd_date}`, () => pastSource(d), d],
      ),
      [`today ${QOTD_FIXTURE_TODAY}`, todaySource, TODAY_REVEALED],
    ];
  }

  it("every publishable archive day, and today", () => {
    const all = cases();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const [name, makeSource, revealed] of all) {
      const m = manifestFor(makeSource());
      const text = slackCopyMessage(m);
      const comment = slackImagesComment(m);
      // Presence first: the caption, the alt text, the date and the section.
      expect(unescapeMrkdwn(text)).toContain(m.caption);
      expect(unescapeMrkdwn(text)).toContain(m.alt_text);
      expect(m.caption.length).toBeGreaterThan(40);
      expect(comment).toContain(m.section);
      expect(comment).toContain(String(Number(m.qotd_date.slice(8))));
      expect(comment).toContain(m.qotd_date.slice(0, 4));
      // Then absence: each part of what Slack receives is checked against the day's revealed
      // answer and explanation in the role it plays: the caption block and the message's own
      // words as a caption, the alt-text block as alt text (it reads every option, as the card
      // shows them), the image comment as card text.
      const blocks = [
        ...unescapeMrkdwn(text).matchAll(/```\n([\s\S]*?)\n```/g),
      ].map((b) => b[1] ?? "");
      expect(blocks).toEqual([m.caption, m.alt_text]);
      const outside = unescapeMrkdwn(text).replace(/```\n[\s\S]*?\n```/g, " ");
      expect(
        socialAssetLeaks(
          {
            caption: `${outside}\n${blocks[0]}`,
            alt_text: blocks[1] ?? "",
            card_text: comment,
          },
          revealed,
        ),
        name,
      ).toEqual([]);
    }
  });

  it("escapes Slack's control characters, so a caption cannot ping or link", () => {
    const m = manifestFor(pastSource(publishable()[0]!));
    const text = slackCopyMessage({
      ...m,
      caption: "a < b & c > d <!channel> <https://x.example|y>",
    });
    expect(text).toContain(
      "a &lt; b &amp; c &gt; d &lt;!channel&gt; &lt;https://x.example|y&gt;",
    );
    expect(text).not.toMatch(/<!channel>|<https:/);
  });
});

describe("PLANTS: an answer in the caption blocks the Slack post", () => {
  // A day that publishes untouched, so the plant is the only thing that can block it.
  // Chosen in beforeAll, not while the file is collected (see publishable()).
  let mcq: QotdArchiveResponse;
  let correct: QotdArchiveResponse["question"]["options"][number];
  beforeAll(() => {
    const day = publishable().find((d) => d.question.item_type === "mcq");
    if (!day) throw new Error("no publishable multiple-choice fixture day");
    const option = day.question.options.find(
      (o) => o.id === day.question.correct_option_id,
    );
    if (!option) throw new Error("fixture day has no correct option");
    mcq = day;
    correct = option;
  });

  it("the day publishes untouched (presence before absence)", () => {
    expect(decide(pastSource(mcq)).decision.ok).toBe(true);
  });

  function plantedDecision(
    day: QotdArchiveResponse,
    extra: string,
  ): ReturnType<typeof publishDecision> {
    const source = pastSource(day);
    const { copy, rendered, reddit, reveal } = decide(source);
    return publishDecision(
      source,
      { ...copy, caption: `${copy.caption}\n\n${extra}` },
      rendered,
      QOTD_FIXTURE_TODAY,
      reddit,
      reveal,
      tiktokFor(source),
    );
  }

  it("the correct choice's text in the caption", () => {
    const d = plantedDecision(mcq, `Hint: ${correct.text}`);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems).toContain(
        `portrait: caption: names the correct choice "${correct.text}"`,
      );
    }
  });

  it("the explanation in the caption", () => {
    const d = plantedDecision(mcq, mcq.question.explanation ?? "");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(
        d.problems.some((p) =>
          p.startsWith("portrait: caption: carries the explanation"),
        ),
      ).toBe(true);
    }
  });

  it("the explanation on the card alone (the caption untouched) also blocks", () => {
    const source = pastSource(mcq);
    const { copy, reddit, reveal } = decide(source);
    const card = `${visibleText(cardMarkup(source.input, "portrait"))} ${mcq.question.explanation ?? ""}`;
    const d = publishDecision(
      source,
      copy,
      [{ format: "portrait", cardText: card }],
      QOTD_FIXTURE_TODAY,
      reddit,
      reveal,
      tiktokFor(source),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems.some((p) => p.startsWith("portrait: card"))).toBe(true);
    }
  });

  it("end to end: a blocked day gets no post.json (a stale one is removed), so nothing is sent", async () => {
    // The passing day first: the writer writes it and the poster would post it.
    const passing = builtDir(null);
    expect(
      writePublishManifest(passing, decide(pastSource(mcq)).decision, []),
    ).toBe(true);
    expect(loadPost(passing)).toMatchObject({ ok: true });
    // Now the planted day over the same directory: the old post.json must not survive.
    const d = plantedDecision(mcq, `Hint: ${correct.text}`);
    expect(d.ok).toBe(false);
    expect(writePublishManifest(passing, d, [])).toBe(false);
    const slack = fakeSlack();
    expect(await run(["--dir", passing], ENV, slack.fetch, logs().log)).toBe(1);
    expect(slack.calls).toEqual([]);
  });

  it("a passing day missing an image size gets no post.json either", () => {
    const dir = builtDir(null);
    expect(
      writePublishManifest(dir, decide(pastSource(mcq)).decision, ["story"]),
    ).toBe(false);
    expect(loadPost(dir)).toMatchObject({ ok: false });
  });
});

describe("Slack: the edges the audit named", () => {
  it("a today payload dated any other day is refused (its answer is already public)", () => {
    const source = todaySource();
    const { copy, rendered, reddit, reveal } = decide(source);
    const stale = publishDecision(
      source,
      copy,
      rendered,
      "2099-01-01",
      reddit,
      reveal,
      tiktokFor(source),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.problems).toEqual([
        `source: the today payload is dated ${source.input.qotd_date}, not today (2099-01-01)`,
      ]);
    }
    expect(
      publishDecision(
        source,
        copy,
        rendered,
        source.input.qotd_date,
        reddit,
        reveal,
        tiktokFor(source),
      ).ok,
    ).toBe(true);
  });

  it("a malformed post.json is refused without quoting it", () => {
    const m = manifestFor(pastSource(publishable()[0]!));
    const dir = builtDir(m);
    writeFileSync(join(dir, "post.json"), `{"caption": "${m.caption}`);
    const r = loadPost(dir);
    expect(r).toEqual({
      ok: false,
      error: "post.json is not valid JSON (SyntaxError)",
    });
  });

  it("backticks cannot close the code block", () => {
    const m = manifestFor(pastSource(publishable()[0]!));
    const text = slackCopyMessage({ ...m, caption: "a ``` b ```` c" });
    // Exactly the four fences the message is built with, and the caption's text kept.
    expect(text.match(/```/g)).toHaveLength(4);
    expect(text.replace(/\u200b/g, "")).toContain("a ``` b ```` c");
  });

  it("image bytes go only to a Slack https host", async () => {
    const dir = builtDir(manifestFor(pastSource(publishable()[0]!)));
    for (const bad of [
      "http://files.slack.com/upload/v1/x",
      "https://files.slack.com.evil.example/upload",
      "https://example.com/upload",
    ]) {
      const calls: string[] = [];
      const fetch: FetchLike = async (url) => {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () =>
            url.endsWith("chat.postMessage")
              ? { ok: true, ts: "1760000000.000100" }
              : { ok: true, upload_url: bad, file_id: "F1" },
        };
      };
      const l = logs();
      expect(await run(["--dir", dir], ENV, fetch, l.log)).toBe(1);
      // Items 1 to 4 are messages on this day (no carousel); the first upload is refused.
      expect(calls).toEqual([
        "https://slack.com/api/chat.postMessage",
        "https://slack.com/api/chat.postMessage",
        "https://slack.com/api/chat.postMessage",
        "https://slack.com/api/chat.postMessage",
        "https://slack.com/api/files.getUploadURLExternal",
      ]);
      expect(l.err).toEqual([
        "qotd-slack: NOT POSTED: files.getUploadURLExternal: upload_url is not a Slack https URL",
      ]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Yesterday's reveal and today's Reddit post (owner brief "QOTD Slack post — add yesterday's
// reveal (for r/satquestion)", Karl, 2026-10-15). Real fixture days: today is 2026-10-05 (a
// Math MCQ) and yesterday 2026-10-04 (a Math grid-in).
// ---------------------------------------------------------------------------------------------

const YESTERDAY = previousQotdDate(QOTD_FIXTURE_TODAY);

function yesterdayDay(): QotdArchiveResponse {
  const day = DAYS.find((d) => d.qotd_date === YESTERDAY);
  if (!day) throw new Error(`the fixture has no archive day ${YESTERDAY}`);
  return day;
}

/** The public archive as the server answers: past days only (today and later are 404). */
function fakeArchive(opts: { serveToday?: boolean; status?: number } = {}): {
  fetch: ArchiveFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetch: ArchiveFetch = async (url) => {
    urls.push(url);
    const date = url.split("/").pop() ?? "";
    const reply = (status: number, json: unknown) => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => json,
    });
    if (opts.status !== undefined) return reply(opts.status, {});
    if (opts.serveToday) return reply(200, { data: TODAY_REVEALED });
    const day = DAYS.find((d) => d.qotd_date === date);
    return day ? reply(200, { data: day }) : reply(404, {});
  };
  return { fetch, urls };
}

/** Every answer and explanation text the fixture knows, for absence checks. */
function answerTexts(day: QotdArchiveResponse): string[] {
  const q = day.question;
  const correct = q.options.find((o) => o.id === q.correct_option_id);
  return [
    q.explanation,
    ...(q.correct_answer !== null && q.item_type === "grid_in"
      ? [q.correct_answer]
      : []),
    ...(correct ? [correct.text] : []),
  ];
}

describe("Yesterday's reveal: always yesterday, never today (owner brief 2026-10-15)", () => {
  it("is built from yesterday's archive day: date, section and domain, answer, plain-text explanation, archive link", () => {
    const day = yesterdayDay();
    const built = buildReveal(day, QOTD_FIXTURE_TODAY);
    expect(built.ok).toBe(true);
    if (!built.ok || built.reveal.status !== "revealed") return;
    const r = built.reveal;
    expect(r.qotd_date).toBe("2026-10-04");
    expect(r.section).toBe("Math");
    expect(r.domain).toBe(day.question.domain);
    // A grid-in's answer is the keyed value.
    expect(r.answer).toEqual({ kind: "value", value: "7" });
    // Plain text, maths readable: no $ delimiters, no LaTeX commands.
    expect(r.explanation).toBe(
      "Both 7 and -7 square to 49. Since x > 0, x = 7.",
    );
    expect(r.archive_url).toBe(
      "https://lyceon.ai/sat-question-of-the-day/2026-10-04",
    );
    expect(r.archive_url).toBe(qotdArchiveUrl("2026-10-04"));
  });

  it("an MCQ day's answer is its letter and text", () => {
    // 2026-10-03 is yesterday for a day posted 2026-10-04.
    const day = DAYS.find((d) => d.qotd_date === "2026-10-03")!;
    const built = buildReveal(day, "2026-10-04");
    expect(built.ok).toBe(true);
    if (built.ok && built.reveal.status === "revealed") {
      // The SERVED letter (SCL-258): the day's stored order is {C,B,D,A}, so canonical C was
      // shown as A, and the reveal says A.
      expect(built.reveal.answer).toEqual({
        kind: "choice",
        letter: "A",
        text: "attracted",
      });
    }
  });

  it("today's answer is never a reveal: the builder refuses any day but yesterday", () => {
    // Presence first: yesterday builds.
    expect(buildReveal(yesterdayDay(), QOTD_FIXTURE_TODAY).ok).toBe(true);
    for (const day of [
      TODAY_REVEALED,
      ...DAYS.filter((d) => d !== yesterdayDay()),
    ]) {
      const built = buildReveal(day, QOTD_FIXTURE_TODAY);
      expect(built.ok, day.qotd_date).toBe(false);
      if (!built.ok) {
        expect(built.problem).toBe(
          `reveal: the archive day is ${day.qotd_date}, not yesterday (${YESTERDAY})`,
        );
      }
    }
  });

  it("loadReveal asks the public archive for yesterday only, and refuses today's day served in its place", async () => {
    const archive = fakeArchive();
    const reveal = await loadReveal(
      "https://lyceon.ai",
      QOTD_FIXTURE_TODAY,
      archive.fetch,
    );
    expect(archive.urls).toEqual([
      `https://lyceon.ai/api/public/qotd/${YESTERDAY}`,
    ]);
    expect(reveal).toMatchObject({ status: "revealed", qotd_date: YESTERDAY });
    // A server that answered with today's day would be caught, not posted.
    await expect(
      loadReveal(
        "https://lyceon.ai",
        QOTD_FIXTURE_TODAY,
        fakeArchive({ serveToday: true }).fetch,
      ),
    ).rejects.toThrow(`not yesterday (${YESTERDAY})`);
  });

  it("a manifest whose reveal is not yesterday's is never written, and the schema refuses it", () => {
    const source = todaySource();
    // Today's archive day passed off as the reveal: the shape is valid, the day is not.
    const wrong: QotdReveal = {
      ...(revealFor(QOTD_FIXTURE_TODAY) as Extract<
        QotdReveal,
        { status: "revealed" }
      >),
      qotd_date: QOTD_FIXTURE_TODAY,
      archive_url: qotdArchiveUrl(QOTD_FIXTURE_TODAY),
    };
    const d = decide(source, undefined, { reveal: wrong }).decision;
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems).toContain(
        `reveal: is for ${QOTD_FIXTURE_TODAY}, not yesterday (${YESTERDAY})`,
      );
    }
    const m = manifestFor(source);
    expect(m.reveal.qotd_date).toBe(YESTERDAY);
    expect(
      qotdSocialPostManifestSchema.safeParse({ ...m, reveal: wrong }).success,
    ).toBe(false);
  });

  it("the Slack reveal carries yesterday's answer and explanation and none of today's", () => {
    const m = manifestFor(todaySource());
    const text = unescapeMrkdwn(slackRevealMessage(m));
    // Presence first: yesterday's date, section, domain, answer, explanation and link.
    const y = yesterdayDay();
    expect(text).toContain("Yesterday's reveal");
    expect(text).toContain("October 4, 2026");
    expect(text).toContain("Math");
    expect(text).toContain(y.question.domain);
    expect(text).toContain("```\n7\n```");
    expect(text).toContain("Since x > 0, x = 7.");
    expect(text).toContain(
      "https://lyceon.ai/sat-question-of-the-day/2026-10-04",
    );
    // Absence: today's explanation and correct choice.
    expect(text).not.toContain("length times width");
    const todayCorrect = TODAY_REVEALED.question.options.find(
      (o) => o.id === TODAY_REVEALED.question.correct_option_id,
    )!;
    expect(text).not.toMatch(new RegExp(`\\b${todayCorrect.text}\\b`));
  });
});

describe("Today's Reddit post (owner brief 2026-10-15)", () => {
  it("is the suggested title and today's question as plain text", () => {
    const m = manifestFor(todaySource());
    expect(m.reddit.title).toBe(
      `SAT Question of the Day: Monday, October 5, 2026 (Math · ${TODAY_REVEALED.question.domain})`,
    );
    expect(m.reddit.body).toContain(
      "A rectangle has a length of 8 and a width of 3. What is its area?",
    );
    // All four choices, lettered, and the call to action; no $ or LaTeX.
    expect(m.reddit.body.match(/^[A-D]\) /gm)).toHaveLength(4);
    expect(m.reddit.body).toContain(
      "Answer it free at lyceon.ai/sat-question-of-the-day",
    );
    expect(m.reddit.body).not.toMatch(/\$|\\[a-z]/);
    const text = unescapeMrkdwn(slackRedditMessage(m));
    expect(text).toContain(m.reddit.title);
    expect(text).toContain(m.reddit.body);
  });
});

describe("The leak check still blocks today's answer anywhere in today's messages (2026-10-15)", () => {
  const mcq = (): QotdArchiveResponse =>
    publishable().find((d) => d.question.item_type === "mcq")!;
  const correctOf = (day: QotdArchiveResponse) =>
    day.question.options.find((o) => o.id === day.question.correct_option_id)!;

  it("the day publishes untouched (presence before absence)", () => {
    const { decision, reddit } = decide(pastSource(mcq()));
    expect(decision.ok).toBe(true);
    expect(reddit.body.length).toBeGreaterThan(40);
  });

  it("the explanation in the Reddit body", () => {
    const day = mcq();
    const base = buildRedditPost(pastSource(day).input);
    const d = decide(pastSource(day), undefined, {
      reddit: { ...base, body: `${base.body}\n\n${day.question.explanation}` },
    }).decision;
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(
        d.problems.some((p) =>
          p.startsWith("portrait: reddit_body: carries the explanation"),
        ),
      ).toBe(true);
    }
  });

  it("the correct choice named in the Reddit title", () => {
    const day = mcq();
    const base = buildRedditPost(pastSource(day).input);
    const d = decide(pastSource(day), undefined, {
      reddit: { ...base, title: `${base.title} ${correctOf(day).text}` },
    }).decision;
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems).toContain(
        `portrait: reddit_title: names the correct choice "${correctOf(day).text}"`,
      );
    }
  });

  it("a Reddit body that singles out one choice", () => {
    const day = mcq();
    const input = pastSource(day).input;
    const base = buildRedditPost(input);
    const body = `${input.stem}\n\n${correctOf(day).text}`;
    const d = decide(pastSource(day), undefined, {
      reddit: { ...base, body },
    }).decision;
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems).toContain(
        "portrait: reddit_body: shows 1 of the 4 choices",
      );
    }
  });

  it("today's Slack messages (images, caption, Reddit) carry none of the posted day's answer", () => {
    for (const day of publishable()) {
      const m = manifestFor(pastSource(day));
      const today = [
        slackImagesComment(m),
        slackCopyMessage(m),
        slackRedditMessage(m),
      ].map(unescapeMrkdwn);
      // Presence: each message is non-trivial.
      for (const t of today) expect(t.length).toBeGreaterThan(30);
      expect(
        socialAssetLeaks(
          {
            caption: m.caption,
            alt_text: m.alt_text,
            card_text: today[0] ?? "",
            reddit_title: m.reddit.title,
            reddit_body: m.reddit.body,
          },
          day,
        ),
        day.qotd_date,
      ).toEqual([]);
    }
  });
});

describe("A withheld yesterday posts no reveal (owner brief 2026-10-15)", () => {
  it("a 404 from the archive (a repaired question) is withheld: the notice and nothing else", async () => {
    // 2026-10-01 is not in the archive: the server answers 404, as for a withheld day.
    const archive = fakeArchive();
    const reveal = await loadReveal(
      "https://lyceon.ai",
      "2026-10-02",
      archive.fetch,
    );
    expect(archive.urls).toEqual([
      "https://lyceon.ai/api/public/qotd/2026-10-01",
    ]);
    expect(reveal).toEqual({ status: "withheld", qotd_date: "2026-10-01" });
    // The posted day 2026-10-02 carries that withheld reveal in its manifest.
    const m = manifestFor(
      pastSource(DAYS.find((d) => d.qotd_date === "2026-10-02")!),
    );
    expect(m.reveal).toEqual(reveal);
    const text = unescapeMrkdwn(slackRevealMessage(m));
    expect(text).toContain("Yesterday's reveal");
    expect(text).toContain("Withheld");
    // Nothing else: no answer, explanation or link block, and no fixture day's answer text.
    expect(text).not.toMatch(/Answer|Explanation|Archive page|```/);
    for (const day of [...DAYS, TODAY_REVEALED]) {
      for (const t of answerTexts(day)) {
        if (t.length > 3) expect(text, day.qotd_date).not.toContain(t);
      }
    }
  });

  it("the withheld notice is what Slack receives as the reveal", async () => {
    const m = manifestFor(
      pastSource(DAYS.find((d) => d.qotd_date === "2026-10-02")!),
    );
    const slack = fakeSlack();
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, logs().log),
    ).toBe(0);
    // Item 1 is the reveal (here the withheld notice); item 3 says there is no carousel either.
    const texts = posted(slack.calls).map((p) => p.text);
    expect(texts[0]).toBe(
      `*1/5 · Reddit: comment on yesterday's post*\n${slackRevealMessage(m)}`,
    );
    expect(texts[0]).toContain("Withheld");
    expect(texts[2]).toMatch(/^\*3\/5 · TikTok: no carousel today\*/);
  });

  it("any other archive failure fails the run loudly (never a silent missing reveal)", async () => {
    await expect(
      loadReveal(
        "https://lyceon.ai",
        QOTD_FIXTURE_TODAY,
        fakeArchive({ status: 503 }).fetch,
      ),
    ).rejects.toThrow(`GET /api/public/qotd/${YESTERDAY} -> 503`);
  });
});

// ---------------------------------------------------------------------------------------------
// TikTok carousel (owner brief "QOTD social: TikTok 3-slide carousel + fixed answer order +
// CTA-first caption + short title", Karl, 2026-10-23). Real fixture days: today 2026-10-05 (a
// Math MCQ) gets yesterday 2026-10-04 (a Math grid-in); a 2026-10-04 post would get 2026-10-03
// (a Reading and Writing MCQ).
// ---------------------------------------------------------------------------------------------

function archiveDay(date: string): QotdArchiveResponse {
  const day = DAYS.find((d) => d.qotd_date === date);
  if (!day) throw new Error(`the fixture has no archive day ${date}`);
  return day;
}

function carouselOf(date: string, posted: string): QotdTiktokCarousel {
  const built = buildTiktokCarousel(archiveDay(date), posted);
  if (!built.ok) throw new Error(built.problem);
  return built.carousel;
}

/** Today's correct choice text (the fixture knows it; the today payload never does). */
function todayCorrectText(): string {
  const q = TODAY_REVEALED.question;
  const correct = q.options.find((o) => o.id === q.correct_option_id);
  if (!correct) throw new Error("today has no correct choice");
  return correct.text;
}

describe("TikTok carousel: yesterday's question only (Karl, 2026-10-23)", () => {
  it("the carousel is yesterday's: built from the day before the posted day, never the posted day", () => {
    const built = buildTiktokCarousel(yesterdayDay(), QOTD_FIXTURE_TODAY);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.carousel.question.qotd_date).toBe(YESTERDAY);
    const todays = buildTiktokCarousel(TODAY_REVEALED, QOTD_FIXTURE_TODAY);
    expect(todays.ok).toBe(false);
    if (!todays.ok) {
      expect(todays.problem).toBe(
        `tiktok: the archive day is ${QOTD_FIXTURE_TODAY}, not yesterday (${YESTERDAY})`,
      );
    }
  });

  it("today's manifest carries yesterday's three slides, title and caption", () => {
    const m = manifestFor(todaySource());
    expect(m.tiktok).toEqual({
      status: "built",
      qotd_date: YESTERDAY,
      title: buildTiktokTitle(YESTERDAY, "M"),
      caption: QOTD_TIKTOK_CAPTION,
      slides: [1, 2, 3].map((n) => `qotd-${YESTERDAY}-tiktok-${n}.png`),
    });
  });

  it("a carousel that is not yesterday's is refused by the decision and by the manifest schema", () => {
    const source = todaySource();
    // A carousel built for a post one day later: its question is today's.
    const todays = buildTiktokCarousel(TODAY_REVEALED, "2026-10-06");
    if (!todays.ok) throw new Error(todays.problem);
    const d = tiktokDecision(source, {
      status: "built",
      carouselDay: TODAY_REVEALED,
      carousel: todays.carousel,
      slides: ([1, 2, 3] as const).map((slide) => ({
        slide,
        cardText: slideText(todays.carousel, slide),
      })),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems).toContain(
        `tiktok: is for ${QOTD_FIXTURE_TODAY}, not yesterday (${YESTERDAY})`,
      );
    }
    const m = manifestFor(source);
    expect(
      qotdSocialPostManifestSchema.safeParse({
        ...m,
        tiktok: {
          ...m.tiktok,
          qotd_date: QOTD_FIXTURE_TODAY,
          slides: [1, 2, 3].map(
            (n) => `qotd-${QOTD_FIXTURE_TODAY}-tiktok-${n}.png`,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it("refuses a day whose correct letter is not the letter slide 1 shows for it", () => {
    const day = archiveDay("2026-10-03");
    const rotated: QotdArchiveResponse = {
      ...day,
      question: {
        ...day.question,
        options: [...day.question.options.slice(1), day.question.options[0]!],
      },
    };
    const built = buildTiktokCarousel(rotated, "2026-10-04");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problem).toMatch(/is shown in position/);
  });
});

describe("TikTok carousel: never today's answer (leak checks over all three slides, the caption and the title)", () => {
  const source = (): Source => ({
    kind: "past",
    input: socialInputFromArchive(TODAY_REVEALED),
    revealed: TODAY_REVEALED,
  });
  const real = () => {
    const carousel = carouselOf(YESTERDAY, QOTD_FIXTURE_TODAY);
    return {
      carousel,
      slides: ([1, 2, 3] as const).map((n) => slideText(carousel, n)),
    };
  };
  const leaksOf = (
    slides: string[],
    caption = QOTD_TIKTOK_CAPTION,
    title = buildTiktokTitle(YESTERDAY, "M"),
    revealed: QotdArchiveResponse | null = TODAY_REVEALED,
  ) =>
    tiktokCarouselLeaks({ slides, caption, title }, yesterdayDay(), {
      input: source().input,
      revealed,
    });

  it("the real slides show yesterday's question and answer and nothing of today's (presence before absence)", () => {
    const { slides } = real();
    expect(slides[0]).toContain(formatSocialDateLong(YESTERDAY));
    expect(slides[2]).toContain("Why:");
    expect(slides[2]).toContain(String(yesterdayDay().question.correct_answer));
    expect(leaksOf(slides)).toEqual([]);
    for (const text of answerTexts(TODAY_REVEALED)) {
      for (const slide of slides) expect(slide).not.toContain(text);
    }
  });

  it.each([0, 1, 2])("today's explanation on slide %i+1 is a leak", (index) => {
    const { slides } = real();
    slides[index] = `${slides[index]} ${TODAY_REVEALED.question.explanation}`;
    expect(
      leaksOf(slides).some((l) =>
        l.startsWith(`tiktok slide ${index + 1}: carries today's explanation`),
      ),
    ).toBe(true);
  });

  it.each([0, 1, 2])(
    "today's correct choice on slide %i+1 is a leak",
    (index) => {
      const { slides } = real();
      slides[index] = `${slides[index]} ${plainMathText(todayCorrectText())}`;
      expect(leaksOf(slides)).toContain(
        `tiktok slide ${index + 1}: names today's correct choice "${todayCorrectText()}"`,
      );
    },
  );

  it("today's question on a slide is a leak even when today's answer is unknown (a today build)", () => {
    const { slides } = real();
    slides[0] = `${slides[0]} ${plainMathText(TODAY_REVEALED.question.stem)}`;
    expect(leaksOf(slides, undefined, undefined, null)).toContain(
      "tiktok slide 1: carries today's question",
    );
  });

  it("today's explanation in the caption or the title is a leak", () => {
    const { slides } = real();
    const extra = TODAY_REVEALED.question.explanation;
    expect(
      leaksOf(slides, `${QOTD_TIKTOK_CAPTION}\n\n${extra}`).some((l) =>
        l.startsWith("tiktok caption: carries today's explanation"),
      ),
    ).toBe(true);
    expect(
      leaksOf(
        slides,
        undefined,
        `${buildTiktokTitle(YESTERDAY, "M")} ${extra}`,
      ).some((l) => l.startsWith("tiktok title: carries today's explanation")),
    ).toBe(true);
  });

  it("the generator hands every slide to the leak check: a planted slide blocks the whole post", () => {
    const { carousel, slides } = real();
    slides[2] = `${slides[2]} ${TODAY_REVEALED.question.explanation}`;
    const tiktok: TiktokBuild = {
      status: "built",
      carouselDay: yesterdayDay(),
      carousel,
      slides: ([1, 2, 3] as const).map((slide, i) => ({
        slide,
        cardText: slides[i]!,
      })),
    };
    const d = decide(source(), undefined, { tiktok }).decision;
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(
        d.problems.some((p) =>
          p.startsWith("tiktok slide 3: carries today's explanation"),
        ),
      ).toBe(true);
    }
  });
});

function formatSocialDateLong(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

describe("TikTok carousel: withheld or missing yesterday (Karl, 2026-10-23)", () => {
  it("a 404 for yesterday gives no archive day, and the manifest records no carousel", async () => {
    // 2026-10-02's yesterday (2026-10-01) is not in the archive.
    const y = await loadYesterday(
      "https://lyceon.ai",
      "2026-10-02",
      fakeArchive().fetch,
    );
    expect(y.day).toBeNull();
    expect(y.reveal.status).toBe("withheld");
    const m = manifestFor(pastSource(archiveDay("2026-10-02")));
    expect(m.tiktok).toEqual({
      status: "skipped",
      qotd_date: "2026-10-01",
      reason: "withheld",
    });
  });

  it("no carousel: no slide is uploaded, and the one-line note is posted", async () => {
    const m = manifestFor(pastSource(archiveDay("2026-10-02")));
    const slack = fakeSlack();
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, logs().log),
    ).toBe(0);
    const uploads = slack.calls.filter((c) =>
      c.url.endsWith("files.getUploadURLExternal"),
    );
    expect(uploads).toHaveLength(m.images.length);
    // The skipped carousel keeps its number (Karl, 2026-10-26).
    const note = posted(slack.calls)[2]!;
    expect(note).toEqual({
      kind: "message",
      text: "*3/5 · TikTok: no carousel today* (yesterday's question (Thursday, October 1, 2026) is withheld or missing on the archive)",
    });
  });
});

describe("TikTok carousel: posted to Slack after the reveal (Karl, 2026-10-23)", () => {
  it("three slides shared together with their comment, then the title and caption", async () => {
    const m = manifestFor(todaySource());
    expect(m.tiktok.status).toBe("built");
    const dir = builtDir(m);
    const slack = fakeSlack();
    expect(await run(["--dir", dir], ENV, slack.fetch, logs().log)).toBe(0);
    const uploads = slack.calls.filter((c) =>
      c.url.endsWith("files.getUploadURLExternal"),
    );
    // Slides (item 3) before the question images (item 5), each set in its own order.
    expect(
      uploads.map((c) => new URLSearchParams(String(c.body)).get("filename")),
    ).toEqual([
      ...(m.tiktok.status === "built" ? m.tiktok.slides : []),
      ...m.images.map((i) => i.file),
    ]);
    const shares = slack.calls
      .filter((c) => c.url.endsWith("files.completeUploadExternal"))
      .map(
        (c) =>
          JSON.parse(String(c.body)) as {
            initial_comment: string;
            files: unknown[];
          },
      );
    expect(shares).toHaveLength(2);
    expect(shares[0]!.files).toHaveLength(3);
    expect(shares[0]!.initial_comment).toBe(
      `*3/5 · TikTok: carousel*\n${slackTiktokSlidesComment(m)}`,
    );
    const titleAndCaption = posted(slack.calls)[1]!;
    expect(titleAndCaption.text).toBe(
      `*2/5 · TikTok: title and caption*\n${slackTiktokMessage(m)}`,
    );
    expect(titleAndCaption.text).toContain("Follow for daily SAT questions 👆");
  });

  it("a missing or non-PNG slide is refused before anything is sent", async () => {
    const m = manifestFor(todaySource());
    if (m.tiktok.status !== "built") throw new Error("expected a carousel");
    const missing = builtDir(m);
    rmSync(join(missing, m.tiktok.slides[2]!));
    expect(loadPost(missing)).toEqual({
      ok: false,
      error: `${m.tiktok.slides[2]} is missing`,
    });
    const notPng = builtDir(m);
    writeFileSync(join(notPng, m.tiktok.slides[0]!), "GIF89a");
    expect(loadPost(notPng)).toEqual({
      ok: false,
      error: `${m.tiktok.slides[0]} is not a PNG`,
    });
  });
});

describe("TikTok slides: the MCQ and grid-in variants of slides 2 and 3", () => {
  it("MCQ: slide 2 shows A B C D and asks for a letter; slide 3 circles the correct letter with its text", () => {
    const c = carouselOf("2026-10-03", "2026-10-04");
    const two = slideText(c, 2);
    expect(two).toContain("Lock in");
    expect(two).toContain("your answer");
    expect(two).toMatch(/\bA\s+B\s+C\s+D\b/);
    expect(two).toContain("Comment your letter first");
    expect(two).toContain("Swipe for the answer →");
    expect(two).not.toContain("Your answer");
    const markup = renderToStaticMarkup(
      createElement(QotdTiktokSlide, {
        slide: 3,
        carousel: c,
        logoSrc: "logo.png",
      }),
    );
    expect(c.answer.kind).toBe("choice");
    if (c.answer.kind === "choice") {
      expect(markup).toContain(
        `<span class="qs-key">${c.answer.letter}</span>`,
      );
    }
    const three = slideText(c, 3);
    expect(three).toContain("The answer");
    expect(three).toContain("Why:");
    expect(three).toContain("Today's question is live");
    expect(three).toContain("lyceon.ai/sat-question-of-the-day");
    expect(three).toContain("Follow for a new SAT question every day");
  });

  it("grid-in: slide 2 shows one 'Your answer' box and asks for an answer; slide 3 shows the value", () => {
    const c = carouselOf(YESTERDAY, QOTD_FIXTURE_TODAY);
    expect(c.question.item_type).toBe("grid_in");
    const two = slideText(c, 2);
    expect(two).toContain("Your answer");
    expect(two).toContain("Comment your answer first");
    expect(two).not.toContain("Comment your letter first");
    expect(two).not.toMatch(/\bA\s+B\s+C\s+D\b/);
    const markup = renderToStaticMarkup(
      createElement(QotdTiktokSlide, {
        slide: 3,
        carousel: c,
        logoSrc: "logo.png",
      }),
    );
    expect(markup).not.toContain("qs-key");
    expect(markup).toContain(
      `<span class="tt-value">${String(yesterdayDay().question.correct_answer)}</span>`,
    );
  });

  it("slide 1 has no link and no 'Answer it free'; it says swipe for the answer", () => {
    const one = slideText(carouselOf("2026-10-03", "2026-10-04"), 1);
    expect(one).toContain("Swipe for the answer »");
    expect(one).not.toContain("lyceon.ai");
    expect(one).not.toContain("Answer it free");
  });
});

describe("TikTok slides: TikTok's safe area", () => {
  it("the content column sits inside the clear band and away from the right-hand controls", () => {
    expect(QOTD_TIKTOK_SIZE).toEqual({ width: 1080, height: 1920 });
    expect(QOTD_TIKTOK_SAFE).toEqual({
      top: 0.08,
      bottom: 0.19,
      right: 0.14,
      columnLeft: 0.065,
      columnRight: 0.155,
    });
    const px = tiktokSafePx();
    expect(px).toEqual({ top: 154, bottom: 365, left: 71, right: 168 });
    // The column clears the right-hand controls (14%).
    expect(px.right).toBeGreaterThanOrEqual(
      Math.ceil(1080 * QOTD_TIKTOK_SAFE.right),
    );
    expect(QOTD_TIKTOK_CSS).toContain(
      `.tt-col{position:absolute;top:${px.top}px;bottom:${px.bottom}px;left:${px.left}px;right:${px.right}px;`,
    );
  });
});

describe("TikTok copy: the Why line, the caption and the title (Karl, 2026-10-23)", () => {
  /** Every explanation in the question bank (content/canonical), for the Why property. */
  function bankExplanations(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ndjson")) {
          for (const line of readFileSync(path, "utf8").split("\n")) {
            if (!line.trim()) continue;
            const parsed = z
              .object({ explanation: z.string() })
              .safeParse(JSON.parse(line));
            if (parsed.success) out.push(parsed.data.explanation);
          }
        }
      }
    };
    walk(join(ROOT, "content/canonical"));
    return out;
  }

  it("the Why line is at most 300 characters, whole sentences only (at most three), for every bank explanation", () => {
    const all = bankExplanations();
    expect(all.length).toBeGreaterThan(1000);
    let whole = 0;
    let cut = 0;
    for (const explanation of all) {
      const why = tiktokWhy(explanation);
      // Every explanation gets a Why (Karl, 2026-10-26): no day is skipped for its length.
      expect(why).not.toBeNull();
      if (why === null) continue;
      const plain = plainMathText(explanation).replace(/\s+/g, " ").trim();
      expect(why.length).toBeLessThanOrEqual(QOTD_TIKTOK_WHY_MAX);
      if (why.endsWith(QOTD_TIKTOK_WHY_MORE)) {
        // A first sentence over 300 characters, cut at a word boundary.
        cut += 1;
        const head = why.slice(0, -QOTD_TIKTOK_WHY_MORE.length);
        expect(plain.startsWith(head)).toBe(true);
        expect(plain[head.length]).toMatch(/[\s,;:—–-]/);
        continue;
      }
      // Whole sentences: terminal punctuation, and the plain text continues (if at all) with a
      // space after exactly this prefix.
      whole += 1;
      expect(why).toMatch(/[.!?]["”’)]*$/);
      expect(plain.startsWith(why.replace(/\.$/, "")) || plain === why).toBe(
        true,
      );
      const rest = plain.slice(why.length);
      expect(rest === "" || rest.startsWith(" ") || `${plain}.` === why).toBe(
        true,
      );
    }
    // Presence before absence: both kinds occur in the real bank.
    expect(whole).toBeGreaterThan(all.length * 0.9);
    expect(cut).toBeGreaterThan(0);
  });

  it("the Why line never splits a decimal and stops at three sentences", () => {
    expect(
      tiktokWhy("The mean is 3.5 here. So $x = 2$. Done! A fourth one."),
    ).toBe("The mean is 3.5 here. So x = 2. Done!");
    const two = tiktokWhy(`First one. ${"long ".repeat(70)}tail. Third.`);
    expect(two).toBe("First one.");
  });

  it("a first sentence over 300 characters is cut at the last word boundary that fits, then '…' and 'Full explanation on lyceon.ai'", () => {
    const long = `${"abcdefghijk ".repeat(40)}end. Short.`;
    const why = tiktokWhy(long);
    expect(QOTD_TIKTOK_WHY_MORE).toBe("… Full explanation on lyceon.ai");
    expect(why).not.toBeNull();
    if (why === null) return;
    expect(why.length).toBeLessThanOrEqual(QOTD_TIKTOK_WHY_MAX);
    expect(why.endsWith("… Full explanation on lyceon.ai")).toBe(true);
    const head = why.slice(0, -QOTD_TIKTOK_WHY_MORE.length);
    // Whole words only, and the most that fit: one more word would overflow.
    expect(head).toMatch(/^(abcdefghijk )*abcdefghijk$/);
    expect(
      head.length + " abcdefghijk".length + QOTD_TIKTOK_WHY_MORE.length,
    ).toBeGreaterThan(QOTD_TIKTOK_WHY_MAX);
    // A trailing comma is not left before the ellipsis.
    const commas = tiktokWhy(`${"abcdefgh, ".repeat(40)}end.`);
    expect(commas).not.toContain(",…");
  });

  it("a day whose explanation's first sentence is over 300 characters still gets a carousel, with the cut Why on slide 3", () => {
    const day = archiveDay("2026-10-03");
    const long: QotdArchiveResponse = {
      ...day,
      question: {
        ...day.question,
        explanation: `${"The verb must agree with its singular subject and describe a completed event ".repeat(5)}so attracted is right. Second sentence.`,
      },
    };
    const built = buildTiktokCarousel(long, "2026-10-04");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.carousel.why.endsWith(QOTD_TIKTOK_WHY_MORE)).toBe(true);
    expect(slideText(built.carousel, 3)).toContain(
      "Full explanation on lyceon.ai",
    );
  });

  it("the caption starts with the follow line, then the swipe line, then the hashtags", () => {
    expect(QOTD_TIKTOK_CAPTION.split("\n")[0]).toBe(
      "Follow for daily SAT questions 👆",
    );
    expect(QOTD_TIKTOK_CAPTION).toBe(
      "Follow for daily SAT questions 👆\n\nLock in your answer, then swipe. Today's question is live on lyceon.ai.\n\n#SAT #SATprep #digitalSAT #studytok",
    );
    expect(firstBannedPhrase(QOTD_TIKTOK_CAPTION)).toBeNull();
    expect(firstUnapprovedOutcome(QOTD_TIKTOK_CAPTION)).toBeNull();
  });

  it("the title is at most 90 characters for every section and every date (the longest included)", () => {
    let longest = "";
    for (
      let t = Date.parse("2026-01-01");
      t < Date.parse("2028-01-01");
      t += 86_400_000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      for (const section of ["M", "RW"] as const) {
        const title = buildTiktokTitle(date, section);
        expect(title.length).toBeLessThanOrEqual(QOTD_TIKTOK_TITLE_MAX);
        expect(title).toMatch(
          /^SAT Question of the Day · [A-Z][a-z]{2} \d{1,2} · (Math|Reading and Writing)$/,
        );
        if (title.length > longest.length) longest = title;
      }
    }
    expect(longest).toBe(
      "SAT Question of the Day · Jan 10 · Reading and Writing",
    );
    expect(buildTiktokTitle("2026-10-22", "RW")).toBe(
      "SAT Question of the Day · Oct 22 · Reading and Writing",
    );
  });

  it("the cap cuts anything longer at a whole word, never past 90 characters", () => {
    const long = `SAT Question of the Day · Oct 22 · ${"Reading and Writing ".repeat(5)}`;
    const capped = capTiktokTitle(long);
    expect(capped.length).toBeLessThanOrEqual(QOTD_TIKTOK_TITLE_MAX);
    expect(long.startsWith(capped)).toBe(true);
    expect(long[capped.length]).toBe(" ");
  });

  it("the title never carries question text", () => {
    const m = manifestFor(todaySource());
    if (m.tiktok.status !== "built") throw new Error("expected a carousel");
    const q = yesterdayDay().question;
    expect(m.tiktok.title).not.toContain(q.stem.slice(0, 12));
    expect(m.tiktok.title).not.toContain(q.domain);
  });
});

// ---------------------------------------------------------------------------------------------
// #social order and labels (owner brief "QOTD #social posts: fixed order, numbered labels",
// Karl, 2026-10-26).
// ---------------------------------------------------------------------------------------------

/** No real waiting in tests: the poll loop still runs, the clock does not. */
const NO_WAIT = { timeoutMs: 5_000, intervalMs: 1_000, sleep: async () => {} };

describe("#social: five numbered items, always in this order (Karl, 2026-10-26)", () => {
  it("a day with a carousel posts 1/5 to 5/5 in order, each opening with its label", async () => {
    const m = manifestFor(todaySource());
    expect(m.tiktok.status).toBe("built");
    const slack = fakeSlack();
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, logs().log, NO_WAIT),
    ).toBe(0);
    const items = posted(slack.calls);
    expect(items.map((p) => [p.kind, p.text.split("\n")[0]])).toEqual([
      ["message", "*1/5 · Reddit: comment on yesterday's post*"],
      ["message", "*2/5 · TikTok: title and caption*"],
      ["share", "*3/5 · TikTok: carousel*"],
      ["message", "*4/5 · Reddit: today's post*"],
      ["share", "*5/5 · Today's question images*"],
      ["message", "*5/5 · Today's question images*"],
    ]);
    // The labels are the brief's, word for word.
    expect([...SLACK_POST_LABELS]).toEqual([
      "1/5 · Reddit: comment on yesterday's post",
      "2/5 · TikTok: title and caption",
      "3/5 · TikTok: carousel",
      "4/5 · Reddit: today's post",
      "5/5 · Today's question images",
    ]);
    // The carousel's three slides go up in slide order.
    const slideUploads = slack.calls
      .filter((c) => c.url.endsWith("files.getUploadURLExternal"))
      .slice(0, 3)
      .map((c) => new URLSearchParams(String(c.body)).get("filename"));
    expect(slideUploads).toEqual(
      m.tiktok.status === "built" ? m.tiktok.slides : [],
    );
  });

  it("each upload is confirmed shared before the next step starts (no parallel posting)", async () => {
    const m = manifestFor(todaySource());
    // Slack takes two looks per file before it reports the share.
    const slack = fakeSlack({ sharePending: 2 });
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, logs().log, NO_WAIT),
    ).toBe(0);
    const urls = slack.calls.map((c) =>
      c.url.replace("https://slack.com/api/", ""),
    );
    const completes = urls.flatMap((u, i) =>
      u === "files.completeUploadExternal" ? [i] : [],
    );
    expect(completes).toHaveLength(2);
    for (const at of completes) {
      // Between this share and the next step: only files.info, until every file is shared
      // (3 looks per file: 2 pending, 1 shared).
      const after = urls.slice(at + 1);
      const next = after.findIndex((u) => u !== "files.info");
      const files = (
        JSON.parse(String(slack.calls[at]!.body)) as { files: unknown[] }
      ).files.length;
      expect(next === -1 ? after.length : next).toBe(files * 3);
    }
    // And nothing at all is sent while an upload is in flight.
    for (let i = 0; i < urls.length - 1; i += 1) {
      if (urls[i] === "files.getUploadURLExternal") {
        expect(slack.calls[i + 1]!.url).toMatch(
          /^https:\/\/files\.slack\.com\//,
        );
      }
    }
  });

  it("a share Slack never confirms fails the run loudly and posts nothing after it", async () => {
    const m = manifestFor(todaySource());
    const slack = fakeSlack({ sharePending: 1_000 });
    const l = logs();
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, l.log, NO_WAIT),
    ).toBe(1);
    expect(l.err.join("\n")).toContain("not shared in the channel");
    // Items 1 and 2 went out, item 3's share never confirmed: item 4 is never posted.
    expect(posted(slack.calls).map((p) => p.text.split("\n")[0])).toEqual([
      "*1/5 · Reddit: comment on yesterday's post*",
      "*2/5 · TikTok: title and caption*",
      "*3/5 · TikTok: carousel*",
    ]);
  });

  it("without the files:read scope the run fails loudly instead of posting out of order", async () => {
    const m = manifestFor(todaySource());
    const slack = fakeSlack({ error: ["files.info", "missing_scope"] });
    const l = logs();
    expect(
      await run(["--dir", builtDir(m)], ENV, slack.fetch, l.log, NO_WAIT),
    ).toBe(1);
    expect(l.err).toEqual([
      "qotd-slack: NOT POSTED: files.info: missing_scope",
    ]);
    expect(posted(slack.calls).at(-1)!.text.split("\n")[0]).toBe(
      "*3/5 · TikTok: carousel*",
    );
  });

  it("a skipped carousel still yields a 2/5 and a 3/5 message, so the numbering never shifts", () => {
    const m = manifestFor(pastSource(archiveDay("2026-10-02")));
    expect(m.tiktok.status).toBe("skipped");
    const dir = builtDir(m);
    const loaded = loadPost(dir);
    if (!loaded.ok) throw new Error(loaded.error);
    const plan = slackPostPlan(loaded.value);
    expect(plan.map((s) => [s.item, s.kind])).toEqual([
      [1, "message"],
      [2, "message"],
      [3, "message"],
      [4, "message"],
      [5, "files"],
      [5, "message"],
    ]);
    const three = plan[2]!;
    expect(three.kind === "message" && three.text).toBe(
      "*3/5 · TikTok: no carousel today* (yesterday's question (Thursday, October 1, 2026) is withheld or missing on the archive)",
    );
  });

  it("the dry run prints the sequence, in order, and sends nothing", async () => {
    const m = manifestFor(todaySource());
    const slack = fakeSlack();
    const l = logs();
    expect(
      await run(["--dir", builtDir(m), "--dry-run"], {}, slack.fetch, l.log),
    ).toBe(0);
    expect(slack.calls).toEqual([]);
    expect(l.out.slice(0, 6)).toEqual([
      "qotd-slack: dry run: 1/5 · Reddit: comment on yesterday's post: *1/5 · Reddit: comment on yesterday's post*",
      "qotd-slack: dry run: 2/5 · TikTok: title and caption: *2/5 · TikTok: title and caption*",
      "qotd-slack: dry run: 3/5 · TikTok: carousel: 3 file(s), then wait until shared",
      "qotd-slack: dry run: 4/5 · Reddit: today's post: *4/5 · Reddit: today's post*",
      `qotd-slack: dry run: 5/5 · Today's question images: ${m.images.length} file(s), then wait until shared`,
      "qotd-slack: dry run: 5/5 · Today's question images: *5/5 · Today's question images*",
    ]);
  });
});
