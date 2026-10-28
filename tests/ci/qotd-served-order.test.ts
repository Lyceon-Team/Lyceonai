/**
 * QOTD: one served order everywhere (Karl's rulings 2026-10-28, SCL-258).
 *
 * @spec [owner brief "QOTD: shuffle answer choices once at scheduling + TikTok 'Why' re-land +
 *       subreddit name" (Karl, 2026-10-28) acceptance: "for a shuffled day, the site page,
 *       dashboard, image, Reddit post, alt text, reveal, TikTok slides, archive and email all show
 *       the same order and name the same letter (email shows none)"; rulings 1-3 of the same day]
 *       | @implemented [2026-10-28]
 *
 * plain English: the day is the shared fixture's 2026-10-02 row, which is REAL output of
 * qotd_archive() after qotd_schedule_insert shuffled it: stored order {B,C,A,D}, so the correct
 * canonical key B is shown as A. Every surface is built from that row by its real code and read
 * back as (letter, text) pairs in display order; each must equal the stored order, and every
 * surface that names the answer must name A. Presence first: the stored order is not the authored
 * order and the letter is not the canonical key, so canonical order cannot pass.
 * Also here: the shared function's refusals, the reveal / TikTok refusal on a letter mismatch,
 * the Slack heading's subreddit, and the failure notice.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { QotdSocialCard } from "@/components/qotd/QotdSocialCard";
import { QotdTiktokSlide } from "@/components/qotd/QotdTiktokSlide";
import {
  QotdServedOrderError,
  qotdServedChoices,
  toArchiveResponse,
  type QotdRow,
} from "../../shared/qotd/projection";
import {
  buildSocialCopy,
  socialInputFromArchive,
  socialInputFromToday,
} from "../../shared/qotd/social";
import { buildReveal, buildRedditPost } from "../../shared/qotd/reveal";
import { buildTiktokCarousel } from "../../shared/qotd/tiktok";
import { toTodayResponse } from "../../server/services/qotd/qotd-service";
import { qotdOptionToken } from "../../server/services/qotd/option-tokens";
import {
  resultFor,
  studentQuestion,
} from "../../server/services/qotd/home-qotd-service";
import { qotdEmailQuestionFields } from "../../server/lib/notifications/qotd-daily-send-context";
import { qotdDailyEmail } from "../../server/lib/notifications/templates/qotd-daily";
import {
  slackFailureMessage,
  slackRedditMessage,
} from "../../scripts/qotd-social/post-to-slack";
import { getPrerenderedSite } from "../lib/prerendered-site";
import { qotdArchiveRow } from "../lib/qotd-fixture";
import type { QotdSocialPostManifest } from "../../packages/shared/src/qotd-schema";

// The option tokens are HMAC'd with this secret; any value works for the shape under test.
process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET ??= "qotd-served-order-test-secret";

const DAY = "2026-10-02";
const POSTED = "2026-10-03";
const LETTERS = ["A", "B", "C", "D"];

const row: QotdRow = qotdArchiveRow(DAY);
const textOf = new Map(
  (row.options as { key: string; text: string }[]).map((o) => [o.key, o.text]),
);
/** What every surface must show: the stored order, lettered A-D. */
const EXPECTED = row.option_order.map((key, i) => ({
  letter: LETTERS[i] ?? "?",
  text: textOf.get(key) ?? "",
}));
const SERVED_LETTER = row.correct_display_letter;

type Pair = { letter: string; text: string };

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/** The (letter, text) pairs of a card or slide: `<span class="qs-key">X</span>` then the text. */
function cardPairs(html: string): Pair[] {
  const out: Pair[] = [];
  for (const li of html.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
    const m = /<span class="qs-key">([A-D])<\/span>([\s\S]*)<\/li>/.exec(li);
    if (m) out.push({ letter: m[1] ?? "", text: stripTags(m[2] ?? "") });
  }
  return out;
}

/** "A) text" / "A: text." lines in display order. */
function linePairs(text: string, re: RegExp): Pair[] {
  return [...text.matchAll(re)].map((m) => ({
    letter: m[1] ?? "",
    text: (m[2] ?? "").trim(),
  }));
}

describe("the fixture day is shuffled (presence first)", () => {
  it("its stored order is not the authored order and its letter is not the canonical key", () => {
    expect(row.item_type).toBe("mcq");
    expect(row.option_order).toEqual(["B", "C", "A", "D"]);
    expect(row.option_order).not.toEqual(
      (row.options as { key: string }[]).map((o) => o.key),
    );
    expect(row.correct_answer).toBe("B");
    expect(SERVED_LETTER).toBe("A");
    expect(EXPECTED.map((p) => p.text)).toEqual(["5", "15", "3", "25"]);
  });
});

describe("every surface shows the stored order and names the served letter (SCL-258)", () => {
  it("the shared function", () => {
    const choices = qotdServedChoices(row);
    expect(
      choices.options.map((o, i) => ({ letter: LETTERS[i], text: o.text })),
    ).toEqual(EXPECTED);
    expect(choices.correctLetter).toBe(SERVED_LETTER);
  });

  it("the archive response: the same order, and correct_letter is the served letter", () => {
    const archive = toArchiveResponse(row);
    expect(
      archive.question.options.map((o, i) => ({
        letter: LETTERS[i],
        text: o.text,
      })),
    ).toEqual(EXPECTED);
    expect(archive.question.correct_letter).toBe(SERVED_LETTER);
    // The highlighted option (by canonical id) sits at the served letter.
    const at = archive.question.options.findIndex(
      (o) => o.id === archive.question.correct_option_id,
    );
    expect(LETTERS[at]).toBe(SERVED_LETTER);
  });

  it("the site: the public /today payload, by token, and the prerendered archive page", async () => {
    const today = toTodayResponse(row);
    expect(today.question.options.map((o) => o.text)).toEqual(
      EXPECTED.map((p) => p.text),
    );
    expect(today.question.options.map((o) => o.id)).toEqual(
      row.option_order.map((k) => qotdOptionToken(DAY, k)),
    );
    // Today's payload names no letter and no answer.
    expect(today.question.correct_answer).toBeNull();
    expect(today.question.explanation).toBeNull();

    const site = await getPrerenderedSite();
    const page = site.pages.find(
      (p) => p.path === `/sat-question-of-the-day/${DAY}`,
    );
    expect(page).toBeDefined();
    const items =
      (page?.html ?? "").match(/<li class="flex items-start[\s\S]*?<\/li>/g) ??
      [];
    const pairs = items.map((li) => {
      const m =
        /<span class="font-semibold">([A-D])(?:<!-- -->)?\.<\/span>([\s\S]*)<\/li>/.exec(
          li,
        );
      return {
        letter: m?.[1] ?? "?",
        text: stripTags(m?.[2] ?? "")
          .replace(/Correct answer$/, "")
          .trim(),
        correct: li.includes("Correct answer"),
      };
    });
    expect(pairs.map(({ letter, text }) => ({ letter, text }))).toEqual(
      EXPECTED,
    );
    expect(pairs.filter((p) => p.correct).map((p) => p.letter)).toEqual([
      SERVED_LETTER,
    ]);
  }, 60_000);

  it("the dashboard: the card's options by token, and its result names the served letter", () => {
    const q = studentQuestion(row);
    expect(q.options.map((o) => o.text)).toEqual(EXPECTED.map((p) => p.text));
    expect(q.options.map((o) => o.id)).toEqual(
      row.option_order.map((k) => qotdOptionToken(DAY, k)),
    );
    const result = resultFor(row, "C", false);
    expect(result.correct_display_letter).toBe(SERVED_LETTER);
  });

  it("the image (both formats), the Reddit post and the alt text", () => {
    const fromToday = socialInputFromToday(toTodayResponse(row));
    const fromArchive = socialInputFromArchive(toArchiveResponse(row));
    for (const input of [fromToday, fromArchive]) {
      for (const format of ["portrait", "story"] as const) {
        const html = renderToStaticMarkup(
          createElement(QotdSocialCard, { input, format, logoSrc: "logo.png" }),
        );
        expect(cardPairs(html), format).toEqual(EXPECTED);
      }
      const reddit = buildRedditPost(input);
      expect(linePairs(reddit.body, /^([A-D])\) (.*)$/gm)).toEqual(EXPECTED);
      const alt = buildSocialCopy(input).alt_text;
      expect(linePairs(alt, /\b([A-D]): ([^.]*)\./g)).toEqual(EXPECTED);
    }
  });

  it("yesterday's reveal names the served letter", () => {
    const built = buildReveal(toArchiveResponse(row), POSTED);
    expect(built.ok).toBe(true);
    if (!built.ok || built.reveal.status !== "revealed") return;
    expect(built.reveal.answer).toEqual({
      kind: "choice",
      letter: SERVED_LETTER,
      text: "5",
    });
  });

  it("the TikTok slides: slide 1 in the stored order, slide 3 the served letter", () => {
    const built = buildTiktokCarousel(toArchiveResponse(row), POSTED);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const carousel = built.carousel;
    expect(carousel.answer).toEqual({
      kind: "choice",
      letter: SERVED_LETTER,
      text: "5",
    });
    const slide1 = renderToStaticMarkup(
      createElement(QotdTiktokSlide, {
        slide: 1,
        carousel,
        logoSrc: "logo.png",
      }),
    );
    expect(cardPairs(slide1)).toEqual(EXPECTED);
    const slide3 = renderToStaticMarkup(
      createElement(QotdTiktokSlide, {
        slide: 3,
        carousel,
        logoSrc: "logo.png",
      }),
    );
    const m =
      /<div class="tt-answer"><span class="qs-key">([A-D])<\/span>/.exec(
        slide3,
      );
    expect(m?.[1]).toBe(SERVED_LETTER);
  });

  it("the email names no choice and no letter", () => {
    const fields = qotdEmailQuestionFields(row);
    const email = qotdDailyEmail({
      currentStreak: 3,
      stem: fields.stem ?? "",
      meta: fields.meta ?? {
        section: "Math",
        domain: "Algebra",
        difficulty: 1,
      },
      siteUrl: "https://lyceon.ai",
      unsubscribeUrl: null,
    });
    // Presence first: the email carries the question's first line.
    expect(email.text).toContain("value of");
    for (const body of [email.text, email.html, email.subject, email.preview]) {
      for (const { letter, text } of EXPECTED) {
        expect(body).not.toMatch(new RegExp(`(^|[^A-Za-z])${letter}[).:]\\s`));
        // Option texts that are not also in the stem ("3x + 5 = 20" contains 3 and 5).
        if (!/^(3|5)$/.test(text)) expect(body).not.toContain(` ${text} `);
      }
      expect(body).not.toMatch(/\bchoice [A-D]\b|\banswer is\b/i);
    }
  });
});

describe("the shared function refuses a stored order that does not fit (SCL-258, fail loudly)", () => {
  const refused = (r: QotdRow): QotdServedOrderError => {
    try {
      qotdServedChoices(r);
    } catch (e: unknown) {
      if (e instanceof QotdServedOrderError) return e;
      throw e;
    }
    throw new Error("not refused");
  };

  it("a letter that disagrees with the order", () => {
    const e = refused({ ...row, correct_display_letter: "B" });
    expect(e.code).toBe("qotd_served_order_mismatch");
    expect(e.reason).toBe("stored letter disagrees with the order");
    // The message names the day and the reason, never a letter.
    expect(e.message).not.toMatch(/\b[A-D]\b/);
  });

  it("an order that is not a permutation of the options", () => {
    for (const order of [
      [],
      ["B", "C", "A"],
      ["B", "C", "A", "A"],
      ["B", "C", "A", "E"],
    ]) {
      expect(refused({ ...row, option_order: order }).reason).toBe(
        "order is not a permutation of the options",
      );
    }
  });

  it("a grid-in that carries an order or a letter", () => {
    const grid: QotdRow = qotdArchiveRow("2026-10-04");
    expect(grid.item_type).toBe("grid_in");
    expect(qotdServedChoices(grid)).toEqual({
      options: [],
      correctLetter: null,
    });
    expect(refused({ ...grid, option_order: ["A"] }).reason).toBe(
      "grid-in carries an order",
    );
    expect(refused({ ...grid, correct_display_letter: "A" }).reason).toBe(
      "grid-in carries an order",
    );
  });
});

describe("the reveal and the TikTok carousel refuse a served letter the options contradict", () => {
  let archive: ReturnType<typeof toArchiveResponse>;
  beforeAll(() => {
    archive = toArchiveResponse(row);
  });

  it("presence first: the real day builds both", () => {
    expect(buildReveal(archive, POSTED).ok).toBe(true);
    expect(buildTiktokCarousel(archive, POSTED).ok).toBe(true);
  });

  it("a correct_letter that is not where the correct option is shown is refused, never posted", () => {
    const wrong = {
      ...archive,
      question: { ...archive.question, correct_letter: "B" as const },
    };
    const reveal = buildReveal(wrong, POSTED);
    expect(reveal.ok).toBe(false);
    if (!reveal.ok) {
      expect(reveal.problem).toBe(
        "reveal: the shown letter does not match the served letter (stored order refused)",
      );
    }
    const tiktok = buildTiktokCarousel(wrong, POSTED);
    expect(tiktok.ok).toBe(false);
    if (!tiktok.ok) {
      expect(tiktok.problem).toBe(
        "tiktok: the correct choice is shown in position A, not at the served letter B",
      );
    }
  });
});

describe("a server that predates SCL-258 (no correct_letter): letters by served position", () => {
  it("the reveal and the carousel name the letter the options were shown under", () => {
    // What the production API answered before this deploy: canonical order, no correct_letter.
    // (The social run reads production, so it meets this during the deploy window.)
    const archive = toArchiveResponse(row);
    const { correct_letter: _omitted, ...question } = archive.question;
    const canonical = (row.options as { key: string; text: string }[]).map(
      (o) => ({ id: o.key as "A" | "B" | "C" | "D", text: o.text }),
    );
    const legacy = {
      ...archive,
      question: { ...question, options: canonical },
    };
    expect("correct_letter" in legacy.question).toBe(false);
    const reveal = buildReveal(legacy, POSTED);
    expect(reveal.ok).toBe(true);
    if (reveal.ok && reveal.reveal.status === "revealed") {
      // B was shown as B on that server.
      expect(reveal.reveal.answer).toEqual({
        kind: "choice",
        letter: "B",
        text: "5",
      });
    }
    const tiktok = buildTiktokCarousel(legacy, POSTED);
    expect(tiktok.ok).toBe(true);
    if (tiktok.ok) {
      expect(tiktok.carousel.answer).toEqual({
        kind: "choice",
        letter: "B",
        text: "5",
      });
    }
  });
});

describe("Slack: the subreddit and the failure notice", () => {
  it("the Reddit heading names r/satquestion (singular), the whole token", () => {
    const manifest = {
      qotd_date: "2026-10-05",
      reddit: { title: "t", body: "b" },
    } as unknown as QotdSocialPostManifest;
    const heading = slackRedditMessage(manifest).split("\n")[0] ?? "";
    expect(heading).toMatch(/\(r\/satquestion\)/);
    expect(heading).not.toContain("r/satquestions");
  });

  it("a failed run posts one notice with the reason (the API's error code) and the run link", () => {
    const text = slackFailureMessage(
      [
        "qotd-social: failed: GET /api/public/qotd/today -> 503 (qotd_order_invalid)",
      ],
      "https://github.com/o/r/actions/runs/1",
    );
    expect(text.split("\n")[0]).toBe(
      "*QOTD social run FAILED* (today's posts are missing or incomplete)",
    );
    expect(text).toContain("503 (qotd_order_invalid)");
    expect(text).toContain("Run: https://github.com/o/r/actions/runs/1");
    // No reason recorded: still a notice, never silence.
    expect(slackFailureMessage([], null)).toContain("No reason was recorded");
  });
});
