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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QotdSocialCard } from "@/components/qotd/QotdSocialCard";
import {
  qotdSocialInputSchema,
  type QotdArchiveResponse,
  type QotdSocialInput,
} from "../../packages/shared/src/qotd-schema";
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
} from "../../shared/qotd/social";
import {
  firstBannedPhrase,
  firstUnapprovedOutcome,
} from "../../shared/seo/banned-phrases";
import {
  toArchiveResponse,
  toTodayResponse,
} from "../../server/services/qotd/qotd-service";
import { pastDateProblem } from "../../scripts/qotd-social/generate";
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

  it("puts today's shuffled options in one fixed order for the day", () => {
    const first = socialInputFromToday(toTodayResponse(qotdTodayRow()));
    expect(first.options).toHaveLength(4);
    for (let k = 0; k < 20; k += 1) {
      expect(
        socialInputFromToday(toTodayResponse(qotdTodayRow())).options,
      ).toEqual(first.options);
    }
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

  it("the workflow holds no secret and publishes only the run's own downloads", () => {
    const wf = readFileSync(
      resolve(ROOT, ".github/workflows/qotd-social.yml"),
      "utf8",
    );
    expect(wf).toContain("scripts/qotd-social/generate.ts");
    expect(wf).toContain("actions/upload-artifact@v4");
    expect(wf).not.toMatch(/secrets\./);
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/);
  });
});
