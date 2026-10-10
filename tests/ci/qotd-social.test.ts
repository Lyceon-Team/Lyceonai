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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { QotdSocialCard } from "@/components/qotd/QotdSocialCard";
import {
  qotdSocialInputSchema,
  qotdSocialPostManifestSchema,
  type QotdArchiveResponse,
  type QotdSocialPostManifest,
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
import {
  pastDateProblem,
  publishDecision,
  type Source,
} from "../../scripts/qotd-social/generate";
import {
  loadPost,
  run,
  slackConfig,
  slackCopyMessage,
  slackImagesComment,
  type FetchLike,
} from "../../scripts/qotd-social/post-to-slack";
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
    // One secret reference in the whole file, the Slack token.
    expect(wf.match(/secrets\./g)).toEqual(["secrets."]);
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
    // The token is in that step's env and in no other step.
    for (const [i, step] of steps.entries()) {
      expect(JSON.stringify(step).includes("secrets."), step.name).toBe(
        i === post,
      );
    }
    const postStep = steps[post]!;
    expect(postStep.if).toBe(
      "success() && github.event_name != 'pull_request'",
    );
    expect(postStep.env).toEqual({
      SLACK_BOT_TOKEN: "${{ secrets.SLACK_BOT_TOKEN }}",
      SLACK_CHANNEL_ID:
        "${{ inputs.slack_channel || vars.QOTD_SLACK_CHANNEL_ID }}",
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

/** What generate.ts hands publishDecision for a day: the copy and each card's visible text. */
function decide(source: Source, cardText?: string) {
  const copy = buildSocialCopy(source.input);
  const rendered = (["portrait", "story"] as const).map((format) => ({
    format,
    cardText: cardText ?? visibleText(cardMarkup(source.input, format)),
  }));
  return { copy, rendered, decision: publishDecision(source, copy, rendered) };
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

/** The fixture days the generator would publish (the rest fail a check that is not a leak). */
const PUBLISHABLE = DAYS.filter((d) => decide(pastSource(d)).decision.ok);

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
  const m = manifest ?? manifestFor(pastSource(PUBLISHABLE[0]!));
  for (const image of m.images) writeFileSync(join(dir, image.file), PNG);
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
  opts: { error?: [method: string, code: string]; httpStatus?: number } = {},
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
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
      return reply(200, {
        ok: true,
        files: [{ id: "F0001" }, { id: "F0002" }],
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
    expect(PUBLISHABLE.length).toBeGreaterThanOrEqual(2);
    expect(
      new Set([
        ...PUBLISHABLE.map((d) => manifestFor(pastSource(d)).section),
        manifestFor(todaySource()).section,
      ]),
    ).toEqual(new Set(["Math", "Reading and Writing"]));
    // A day that fails any check gets no manifest (here, a grid-in: not quick to read).
    const refused = DAYS.filter((d) => !PUBLISHABLE.includes(d));
    for (const day of refused) {
      const { decision } = decide(pastSource(day));
      expect(decision.ok).toBe(false);
    }
    for (const day of PUBLISHABLE) {
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
    const m = manifestFor(pastSource(PUBLISHABLE[0]!));
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

  it("a passing day is posted: two uploads, one share with the date and section, then the copy", async () => {
    const manifest = manifestFor(pastSource(PUBLISHABLE[0]!));
    const dir = builtDir(manifest);
    const slack = fakeSlack();
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(0);
    expect(slack.calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/test-1",
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/test-2",
      "https://slack.com/api/files.completeUploadExternal",
      "https://slack.com/api/chat.postMessage",
    ]);
    // The token goes to Slack's API only, never to the upload URL.
    expect(slack.calls.map((c) => c.auth)).toEqual([
      `Bearer ${ENV.SLACK_BOT_TOKEN}`,
      undefined,
      `Bearer ${ENV.SLACK_BOT_TOKEN}`,
      undefined,
      `Bearer ${ENV.SLACK_BOT_TOKEN}`,
      `Bearer ${ENV.SLACK_BOT_TOKEN}`,
    ]);
    const first = new URLSearchParams(String(slack.calls[0]!.body));
    expect(first.get("filename")).toBe(manifest.images[0]!.file);
    expect(first.get("length")).toBe(String(PNG.length));
    expect(first.get("alt_txt")).toBe(manifest.alt_text);
    expect(Buffer.from(slack.calls[1]!.body as Uint8Array)).toEqual(PNG);
    const share = JSON.parse(String(slack.calls[4]!.body)) as {
      files: { id: string }[];
      channel_id: string;
      initial_comment: string;
    };
    expect(share.files.map((f) => f.id)).toEqual(["F0001", "F0002"]);
    expect(share.channel_id).toBe(ENV.SLACK_CHANNEL_ID);
    expect(share.initial_comment).toContain(manifest.section);
    expect(share.initial_comment).toMatch(/\d{4}/);
    const message = JSON.parse(String(slack.calls[5]!.body)) as {
      channel: string;
      text: string;
    };
    expect(message.channel).toBe(ENV.SLACK_CHANNEL_ID);
    expect(message.text).toBe(slackCopyMessage(manifest));
    // The log names the day and Slack's message id; never the token or the question.
    const all = [...l.out, ...l.err].join("\n");
    expect(all).toContain(manifest.qotd_date);
    expect(all).not.toContain(ENV.SLACK_BOT_TOKEN);
    expect(all).not.toContain(manifest.caption.slice(0, 40));
  });

  it("a hand-edited caption.txt, a wrong-day image or a non-PNG is refused", () => {
    const manifest = manifestFor(pastSource(PUBLISHABLE[0]!));
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
    const dir = builtDir(manifestFor(pastSource(PUBLISHABLE[0]!)));
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
    const dir = builtDir(manifestFor(pastSource(PUBLISHABLE[0]!)));
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
      { ok: false, error: "SLACK_BOT_TOKEN is not a bot token (xoxb-…)" },
    );
    for (const channel of [undefined, "", "#social", "social", "U0123456789"]) {
      const r = slackConfig({ ...ENV, SLACK_CHANNEL_ID: channel });
      expect(r.ok, String(channel)).toBe(false);
      if (!r.ok) expect(r.error).toContain("QOTD_SLACK_CHANNEL_ID");
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
    const dir = builtDir(manifestFor(pastSource(PUBLISHABLE[0]!)));
    const slack = fakeSlack({ error: [method, code] });
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(1);
    expect(l.err).toEqual([`qotd-slack: NOT POSTED: ${method}: ${code}`]);
    expect(l.out).toEqual([]);
  });

  it("Slack down (HTTP 503) fails the run", async () => {
    const dir = builtDir(manifestFor(pastSource(PUBLISHABLE[0]!)));
    const slack = fakeSlack({ httpStatus: 503 });
    const l = logs();
    expect(await run(["--dir", dir], ENV, slack.fetch, l.log)).toBe(1);
    expect(l.err).toEqual([
      "qotd-slack: NOT POSTED: files.getUploadURLExternal: HTTP 503",
    ]);
  });
});

describe("Slack: the message carries the caption and no answer (real fixture days)", () => {
  type SlackCase = [string, () => Source, QotdArchiveResponse];
  const cases: SlackCase[] = [
    ...PUBLISHABLE.map(
      (d): SlackCase => [`archive ${d.qotd_date}`, () => pastSource(d), d],
    ),
    [`today ${QOTD_FIXTURE_TODAY}`, todaySource, TODAY_REVEALED],
  ];

  it.each(cases)("%s", (_name, makeSource, revealed) => {
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
    ).toEqual([]);
  });

  it("escapes Slack's control characters, so a caption cannot ping or link", () => {
    const m = manifestFor(pastSource(PUBLISHABLE[0]!));
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
  const mcq = PUBLISHABLE.find((d) => d.question.item_type === "mcq")!;
  const correct = mcq.question.options.find(
    (o) => o.id === mcq.question.correct_option_id,
  )!;

  it("the day publishes untouched (presence before absence)", () => {
    expect(decide(pastSource(mcq)).decision.ok).toBe(true);
  });

  function plantedDecision(
    day: QotdArchiveResponse,
    extra: string,
  ): ReturnType<typeof publishDecision> {
    const source = pastSource(day);
    const { copy, rendered } = decide(source);
    return publishDecision(
      source,
      { ...copy, caption: `${copy.caption}\n\n${extra}` },
      rendered,
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
    const { copy } = decide(source);
    const card = `${visibleText(cardMarkup(source.input, "portrait"))} ${mcq.question.explanation ?? ""}`;
    const d = publishDecision(source, copy, [
      { format: "portrait", cardText: card },
    ]);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.problems.some((p) => p.startsWith("portrait: card"))).toBe(true);
    }
  });

  it("end to end: a blocked day has no manifest, so the poster sends nothing", async () => {
    const d = plantedDecision(mcq, `Hint: ${correct.text}`);
    expect(d.ok).toBe(false);
    // generate.ts writes post.json only from an ok decision; without it the poster refuses.
    const dir = builtDir(d.ok ? d.manifest : null);
    const slack = fakeSlack();
    expect(await run(["--dir", dir], ENV, slack.fetch, logs().log)).toBe(1);
    expect(slack.calls).toEqual([]);
  });
});
