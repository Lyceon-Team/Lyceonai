/**
 * TikTok carousel layout check: the worst-case questions the scheduler can pick must fit all
 * three slides inside TikTok's safe area at 24px or more.
 *
 * @spec [owner brief "QOTD social: TikTok 3-slide carousel" (Karl, 2026-10-23): "a safe-area
 *       layout test at the passage cap with the longest choices"; grid-in variants of slides 2
 *       and 3; "if a capped passage can't fit at minimum font size, report it rather than adding
 *       a 4th slide"] | @implemented [2026-10-23]
 *
 * Usage:
 *   pnpm exec tsx scripts/qotd-social/tiktok-layout.ts [--out DIR]
 *
 * plain English: renders, through the generator's own renderer (renderTiktok: largest size at
 * which nothing overflows AND every drawn box is inside the safe area), these carousels:
 *   * rw-cap: Reading and Writing at the readability caps (shared/qotd/readability.ts: passage
 *     300 characters, passage + question 400) with four choices as long as the longest choice
 *     on any readable Reading and Writing question in the bank (124 characters, measured
 *     2026-10-23), and a 300-character "Why";
 *   * m-cap: Math at its cap (question 400 characters) with four choices as long as the longest
 *     readable Math choice (212 characters), and a 300-character "Why";
 *   * m-gridin-cap: a Math grid-in at the cap (the readability rule takes MCQ only today, so no
 *     grid-in is scheduled; its slides are checked anyway);
 *   * rw-sample, gridin-sample: the real fixture days 2026-10-03 (Reading and Writing) and
 *     2026-10-04 (Math grid-in), whose PNGs are the ones attached to the pull request.
 * Any slide that does not fit: exit 1, naming it. The PNGs are written to DIR for review.
 * No network, no question bank: synthetic text and the repo's fixture only.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  QOTD_TIKTOK_WHY_MAX,
  qotdTiktokCarouselSchema,
  type QotdTiktokCarousel,
} from "../../packages/shared/src/qotd-schema";
import {
  QOTD_MATH_MAX_CHARS,
  QOTD_RW_MAX_PASSAGE_CHARS,
  QOTD_RW_MAX_TOTAL_CHARS,
} from "../../shared/qotd/readability";
import { QOTD_SECTION_NAME } from "../../shared/qotd/social";
import { buildTiktokCarousel } from "../../shared/qotd/tiktok";
import { toArchiveResponse } from "../../shared/qotd/projection";
import { QOTD_ARCHIVE_ROWS } from "../../tests/lib/qotd-fixture";
import { loadCardModule, renderTiktok } from "./generate";

/** The longest choice on a readable question in the bank, per section (measured 2026-10-23). */
export const LONGEST_CHOICE = { RW: 124, M: 212 } as const;

const WORDS =
  "the researcher noted that results from each trial were consistent with the earlier survey of coastal wetlands and their seasonal bird populations ";

/** Ordinary words, exactly `length` characters (no maths, so the width is honest). */
export function prose(length: number, seed = 0): string {
  let text = "";
  while (text.length < length + seed) text += WORDS;
  const cut = text.slice(seed, seed + length);
  return `${cut
    .slice(0, -1)
    .trimEnd()
    .padEnd(length - 1, "x")}.`;
}

/** A "Why" exactly at the cap, in three whole sentences. */
function why(): string {
  const third = Math.floor(QOTD_TIKTOK_WHY_MAX / 3);
  return [prose(third - 1, 1), prose(third - 1, 7), prose(third - 1, 13)]
    .join(" ")
    .slice(0, QOTD_TIKTOK_WHY_MAX);
}

export function worstCases(): Record<string, QotdTiktokCarousel> {
  const rwStem = prose(QOTD_RW_MAX_TOTAL_CHARS - QOTD_RW_MAX_PASSAGE_CHARS, 3);
  const rwChoice = (i: number): string => prose(LONGEST_CHOICE.RW, i * 5);
  const mChoice = (i: number): string => prose(LONGEST_CHOICE.M, i * 5);
  const base = {
    correct_answer: null,
    explanation: null,
  } as const;
  return {
    "rw-cap": qotdTiktokCarouselSchema.parse({
      question: {
        ...base,
        qotd_date: "2026-10-22",
        section_code: "RW",
        domain: "Information and Ideas",
        item_type: "mcq",
        passage: prose(QOTD_RW_MAX_PASSAGE_CHARS),
        stem: rwStem,
        options: [0, 1, 2, 3].map((i) => ({ text: rwChoice(i) })),
      },
      section: QOTD_SECTION_NAME.RW,
      answer: { kind: "choice", letter: "C", text: rwChoice(2) },
      why: why(),
    }),
    "m-cap": qotdTiktokCarouselSchema.parse({
      question: {
        ...base,
        qotd_date: "2026-10-22",
        section_code: "M",
        domain: "Problem-Solving and Data Analysis",
        item_type: "mcq",
        passage: null,
        stem: prose(QOTD_MATH_MAX_CHARS),
        options: [0, 1, 2, 3].map((i) => ({ text: mChoice(i) })),
      },
      section: QOTD_SECTION_NAME.M,
      answer: { kind: "choice", letter: "D", text: mChoice(3) },
      why: why(),
    }),
    "m-gridin-cap": qotdTiktokCarouselSchema.parse({
      question: {
        ...base,
        qotd_date: "2026-10-22",
        section_code: "M",
        domain: "Problem-Solving and Data Analysis",
        item_type: "grid_in",
        passage: null,
        stem: prose(QOTD_MATH_MAX_CHARS),
        options: [],
      },
      section: QOTD_SECTION_NAME.M,
      answer: { kind: "value", value: "-12.75" },
      why: why(),
    }),
  };
}

/** The fixture days whose slides go in the pull request: a Reading and Writing MCQ, a grid-in. */
export function fixtureSamples(): Record<string, QotdTiktokCarousel> {
  const out: Record<string, QotdTiktokCarousel> = {};
  for (const [name, date, posted] of [
    ["rw-sample", "2026-10-03", "2026-10-04"],
    ["gridin-sample", "2026-10-04", "2026-10-05"],
  ] as const) {
    const row = QOTD_ARCHIVE_ROWS.find((r) => r.qotd_date === date);
    if (!row) throw new Error(`the fixture has no ${date}`);
    const built = buildTiktokCarousel(toArchiveResponse(row), posted);
    if (!built.ok) throw new Error(built.problem);
    out[name] = built.carousel;
  }
  return out;
}

async function main(): Promise<number> {
  const outAt = process.argv.indexOf("--out");
  const out = resolve(
    outAt >= 0 ? (process.argv[outAt + 1] ?? "") : "qotd-tiktok-layout",
  );
  rmSync(out, { recursive: true, force: true });
  const work = join(out, ".render");
  mkdirSync(work, { recursive: true });
  const cases = { ...worstCases(), ...fixtureSamples() };
  const { slides, close } = await loadCardModule();
  const failures: string[] = [];
  try {
    for (const [name, carousel] of Object.entries(cases)) {
      const shot = await renderTiktok(slides, carousel, work);
      for (const r of shot.rendered) {
        copyFileSync(r.file, join(out, `${name}-${r.slide}.png`));
      }
      process.stdout.write(
        `tiktok-layout: ${name}: ${shot.rendered.map((r) => `slide ${r.slide} ${r.fontPx}px`).join(", ")}${
          shot.unfit.length > 0
            ? `; DOES NOT FIT: slide ${shot.unfit.join(", ")}`
            : ""
        }\n`,
      );
      for (const n of shot.unfit) failures.push(`${name} slide ${n}`);
    }
  } finally {
    await close();
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    process.stderr.write(
      `tiktok-layout: does not fit the safe area at 24px: ${failures.join("; ")}\n`,
    );
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(
        `tiktok-layout: failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    },
  );
}
