/**
 * Worked examples: the hook rules, the TikTok title and caption, the monthly plan's hook rotation,
 * and the checks that tie an example to its question, its week and its committed voice.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): hook library
 *       ("no statistics or claims about students; states or shows the puzzle within the first
 *       line; ends in curiosity, not the answer"; "the monthly plan rotates hook types"), cadence
 *       (the labelled set "Worked example · {skill} · {hook_type}", a TikTok title of at most 90
 *       characters starting "SAT"), music credited in the share copy as /brag does; Karl's ruling
 *       2026-11-02 (SCL-265): "'Most people…' hooks are ALLOWED; this replaces the earlier ban"
 *       (it replaces the brief's "no 'most people/students'" clause for "Most people" only), and
 *       the captions and keywords use the SCL-262 format (it replaces the brief's caption whose
 *       first line was "Follow for daily SAT questions 👆"); Public Disclosure Doctrine §0 rules
 *       1-3, 5 (docs/plans/seo/seo-marketing-vertical.md); SCL-267 (Karl's rulings 2026-11-02, later
 *       the same day, script and voice): "the voice never reads the on-screen text verbatim"]
 *       | @implemented [2026-10-27, H2 and the captions 2026-11-02, S1-S2 2026-11-02]
 *
 * plain English: every function here is pure and returns the problems it finds (empty = pass).
 * scripts/worked-examples/check-content.ts runs them on every pull request into `social` that
 * touches an example, and the daily job runs them again before it renders, so an example that
 * breaks a rule is never posted.
 *
 * The hook rules, one function each so each can be proven separately:
 *   H1 no statistics: no "N% of", "N out of M", "N in M", or words that cite data (survey, study,
 *      research, statistic). A percent that is part of the puzzle ("Up 25%") is fine.
 *   H2 no claims about people: no students, people, kids, teens, test-takers, everyone, nobody,
 *      "most of you". The hook talks about the question, never about who gets it wrong. One
 *      exception, by Karl's ruling of 2026-11-02 (SCL-265): a hook may OPEN with "Most people"
 *      ("Most people think it's $64…?"). Only the opening two words are exempt; the rest of the
 *      hook is checked as before, so "Most people… and everyone…" is still refused, and "most
 *      students", "Kids always…" or "most people" anywhere but the start are refused.
 *   H3 states the puzzle: the hook shares a number or a content word with the question.
 *   H4 ends in curiosity: the hook ends with "?" or "…".
 *   H5 not the answer: the hook never contains the correct choice, a number that only the correct
 *      choice has, or "the answer is".
 *   H6 public-copy phrases: the shared banned list and the pipeline list (no AI, no process).
 * H3 and H4 apply to the on-screen line only, so a spoken hook may be a challenge to the viewer
 * ("Think you can do this one in ten seconds? Go."); H1, H2, H5 and H6 apply to both.
 *
 * The script rule (SCL-267, Karl's ruling 2026-11-02, "the voice never reads the on-screen text
 * verbatim"), one function each:
 *   S1 no spoken line shares a run of VERBATIM_RUN_WORDS (6) consecutive words with any on-screen
 *      text: the hook line, the question's passage, stem and each option as the seed SQL has
 *      them, each step's notepad, the answer notepad and the trap notepad. Both sides are
 *      normalised the same way (verbatimWords: lower case, punctuation stripped, numbers kept as
 *      written, so "$64" is "64" and "sixty-four" is "sixty four"; a spelled-out number never
 *      matches a written one, which is the point: the voice talks about the screen).
 *   S2 the spoken hook is not the on-screen hook line, after the same normalisation.
 */
import {
  WORKED_EXAMPLE_HOOK_TYPES,
  WORKED_EXAMPLE_TITLE_MAX,
  type WorkedExampleContent,
  type WorkedExampleHookType,
  type WorkedExamplePlan,
  type WorkedExampleStyle,
} from "../../packages/shared/src/worked-example-schema";
import { isoWeekCycle } from "../content/schedule";
import { plainMathText } from "../qotd/plain-math";
import { QOTD_SECTION_NAME } from "../qotd/social";
import { capTiktokTitle } from "../qotd/tiktok";
import {
  nextSatTest,
  socialFacebookCaption,
  socialInstagramCaption,
  socialKeywords,
  socialTiktokCaption,
  type SocialSection,
  type SocialTest,
} from "../social/posts";
import { firstBannedPhrase, firstPipelinePhrase } from "../seo/banned-phrases";
import type { SeedQuestion } from "./seed-question";

const STATISTICS: readonly RegExp[] = [
  /\b\d+(\.\d+)?\s*(%|percent)\s+of\b/i,
  /\b\d+\s+out\s+of\s+\d+\b/i,
  /\b\d+\s+in\s+\d+\b/i,
  /\b(statistics?|surveys?|stud(y|ies)|research|data (shows?|says))\b/i,
];

const PEOPLE: readonly RegExp[] = [
  /\b(students?|people|kids|teens?|teenagers?|test[- ]?takers?|everyone|everybody|nobody|no one|scorers?)\b/i,
  /\bmost of (you|us|them)\b/i,
];

/** H1: no statistics. */
export function hookStatisticProblem(text: string): string | null {
  const hit = STATISTICS.find((re) => re.test(text));
  return hit ? `H1 statistics: "${text}" cites a figure or data` : null;
}

/** The one opening H2 allows (Karl's ruling 2026-11-02): "Most people" at the very start. */
const MOST_PEOPLE_OPENING = /^\s*most people\b/i;

/** H2: no claims about students or people, except a hook that opens "Most people". */
export function hookPeopleProblem(text: string): string | null {
  const rest = text.replace(MOST_PEOPLE_OPENING, "");
  const hit = PEOPLE.find((re) => re.test(rest));
  return hit ? `H2 claim about people: "${text}"` : null;
}

const STOPWORDS = new Set(
  "about above after again also another because been before being both could does doing each from have having here into just more most much only other over same should some such than that then them there these they this those through under until very what when where which while will with would your".split(
    " ",
  ),
);

/** Numbers (as written, without separators) and content words of four or more letters. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/\d+(?:[.,]\d+)*|[a-z]{4,}/g)) {
    const t = m[0].replace(/,/g, "");
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function questionText(q: SeedQuestion): string {
  return [q.passage ?? "", q.stem, ...q.options.map((o) => o.text)]
    .map(plainMathText)
    .join(" ");
}

/** H3: the hook states or shows the puzzle (shares a number or a content word with it). */
export function hookPuzzleProblem(
  hookLine: string,
  q: SeedQuestion,
): string | null {
  const question = tokens(questionText(q));
  for (const t of tokens(hookLine)) if (question.has(t)) return null;
  return `H3 not the puzzle: "${hookLine}" shares no number or content word with ${q.id}`;
}

/** H4: the hook ends in curiosity. */
export function hookCuriosityProblem(hookLine: string): string | null {
  return /(\?|…|\.\.\.)["”’)]*$/.test(hookLine.trim())
    ? null
    : `H4 does not end in curiosity: "${hookLine}" must end with ? or …`;
}

/** H5: the hook never gives the answer away. */
export function hookAnswerProblem(
  text: string,
  q: SeedQuestion,
): string | null {
  if (/\b(the )?answer('s| is)\b/i.test(text))
    return `H5 gives the answer: "${text}" says what the answer is`;
  const correct = q.options.find((o) => o.key === q.correct_answer);
  if (!correct) return `H5 ${q.id} has no option ${q.correct_answer}`;
  const correctPlain = plainMathText(correct.text).trim().toLowerCase();
  if (correctPlain.length >= 2 && text.toLowerCase().includes(correctPlain))
    return `H5 gives the answer: "${text}" contains the correct choice "${correctPlain}"`;
  const elsewhere = tokens(
    [
      q.passage ?? "",
      q.stem,
      ...q.options.filter((o) => o.key !== q.correct_answer).map((o) => o.text),
    ]
      .map(plainMathText)
      .join(" "),
  );
  const own = [...tokens(correctPlain)].filter(
    (t) => /^\d/.test(t) && !elsewhere.has(t),
  );
  const hookTokens = tokens(text);
  const leaked = own.find((t) => hookTokens.has(t));
  return leaked === undefined
    ? null
    : `H5 gives the answer: "${text}" contains ${leaked}, which only the correct choice has`;
}

/** H6: the shared public-copy lists (claims, mechanisms, AI and process). */
export function publicPhraseProblem(text: string): string | null {
  const hit = firstBannedPhrase(text) ?? firstPipelinePhrase(text);
  return hit ? `H6 public-copy phrase in "${text}": ${hit.why}` : null;
}

/** Every hook rule, on the on-screen line and on the spoken hook. */
export function hookProblems(
  hook: WorkedExampleContent["hook"],
  q: SeedQuestion,
): string[] {
  const out: (string | null)[] = [
    hookPuzzleProblem(hook.line, q),
    hookCuriosityProblem(hook.line),
  ];
  for (const text of [hook.line, hook.voice]) {
    out.push(
      hookStatisticProblem(text),
      hookPeopleProblem(text),
      hookAnswerProblem(text, q),
      publicPhraseProblem(text),
    );
  }
  return [...new Set(out.filter((p): p is string => p !== null))];
}

/** S1: the shortest run of consecutive words that counts as reading the screen aloud. */
export const VERBATIM_RUN_WORDS = 6;

/**
 * Text as the verbatim rule compares it: lower case, apostrophes dropped ("what's" → "whats"),
 * every other punctuation mark a word break, numbers as written ("1.25" stays "1.25", "1,000" is
 * "1000"). LaTeX in seed text is read as plain text first (plainMathText) by the caller.
 */
export function verbatimWords(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase().replace(/['’‘]/g, "");
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*|[\p{L}\p{N}]+/gu))
    out.push(m[0].replace(/,/g, ""));
  return out;
}

/** The first run of `n` consecutive words `spoken` shares with `screen`, or null. */
export function sharedRun(
  spoken: string,
  screen: string,
  n: number = VERBATIM_RUN_WORDS,
): string | null {
  const a = verbatimWords(spoken);
  const b = verbatimWords(screen);
  if (a.length < n || b.length < n) return null;
  const runs = new Set<string>();
  for (let k = 0; k + n <= b.length; k++) runs.add(b.slice(k, k + n).join(" "));
  for (let k = 0; k + n <= a.length; k++) {
    const run = a.slice(k, k + n).join(" ");
    if (runs.has(run)) return run;
  }
  return null;
}

/** Everything the viewer reads on screen while the voice plays, named for the problem text. */
export function onScreenTexts(
  example: WorkedExampleContent,
  q: SeedQuestion,
): { where: string; text: string }[] {
  return [
    { where: "the hook line", text: example.hook.line },
    ...(q.passage && q.passage.trim() !== ""
      ? [{ where: "the passage", text: plainMathText(q.passage) }]
      : []),
    { where: "the question stem", text: plainMathText(q.stem) },
    ...q.options.map((o) => ({
      where: `option ${o.key}`,
      text: plainMathText(o.text),
    })),
    ...example.steps.map((s, k) => ({
      where: `step ${k + 1}'s notepad`,
      text: s.notepad,
    })),
    { where: "the answer notepad", text: example.answer.notepad },
    ...example.trap.notepad.map((text, k) => ({
      where: `trap notepad line ${k + 1}`,
      text,
    })),
  ];
}

/** Every line the example's voice speaks, keyed as the voice manifest keys them. */
export function spokenTexts(
  example: WorkedExampleContent,
): { key: string; text: string }[] {
  return [
    { key: "hook", text: example.hook.voice },
    { key: "question", text: example.question_voice },
    ...example.steps.map((s, k) => ({ key: `step-${k + 1}`, text: s.voice })),
    { key: "trap", text: example.trap.voice },
    { key: "answer", text: example.answer.voice },
  ];
}

/** S1: no spoken line reads VERBATIM_RUN_WORDS or more consecutive on-screen words aloud. */
export function verbatimProblems(
  example: WorkedExampleContent,
  q: SeedQuestion,
): string[] {
  const screen = onScreenTexts(example, q);
  const out: string[] = [];
  for (const s of spokenTexts(example))
    for (const on of screen) {
      const run = sharedRun(s.text, on.text);
      if (run !== null)
        out.push(
          `S1 reads the screen: spoken ${s.key} repeats "${run}" from ${on.where}; talk about it, don't read it`,
        );
    }
  return out;
}

/** S2: the spoken hook is not the on-screen hook line read aloud. */
export function spokenHookEchoProblem(
  hook: WorkedExampleContent["hook"],
): string | null {
  return verbatimWords(hook.voice).join(" ") ===
    verbatimWords(hook.line).join(" ")
    ? `S2 the spoken hook reads the on-screen hook line: "${hook.voice}"`
    : null;
}

/** The fixed heading of the on-screen trap callout. */
export const TRAP_HEADING = "The trap:";

/**
 * How the spoken trap opens: "The trap…", or Karl's flow wording "Here's where people slip…"
 * (optionally after "Now"), from his 2026-11-02 script rules (SCL-267: "the trap ('here's where
 * people slip')"; the Nov 11 reference script opens it "Now here's where people slip").
 */
export const TRAP_VOICE_OPENING =
  /^(?:the trap\b|(?:now,?\s+)?here[’']?s where (?:people|you) slip\b)/i;

/** The example against its question, its week, its style row and the public-copy lists. */
export function contentProblems(
  example: WorkedExampleContent,
  q: SeedQuestion,
  cycle: string,
  style: WorkedExampleStyle,
): string[] {
  const out: string[] = [];
  if (example.question_id !== q.id)
    out.push(`question_id ${example.question_id} is not ${q.id}`);
  if (!q.skill_codes.includes(example.skill_code))
    out.push(
      `skill_code "${example.skill_code}" is not one of ${q.id}'s skills (${q.skill_codes.join(", ")})`,
    );
  if (example.answer.letter !== q.correct_answer)
    out.push(
      `answer.letter ${example.answer.letter} is not ${q.id}'s key ${q.correct_answer}`,
    );
  if (!example.answer.notepad.includes(`${q.correct_answer})`))
    out.push(
      `answer.notepad "${example.answer.notepad}" does not name choice ${q.correct_answer})`,
    );
  if (!TRAP_VOICE_OPENING.test(example.trap.voice))
    out.push(
      `trap.voice must open "The trap" or "Here's where people slip": "${example.trap.voice}"`,
    );
  if (isoWeekCycle(example.post_on) !== cycle)
    out.push(
      `post_on ${example.post_on} is in ${isoWeekCycle(example.post_on)}, not in its batch ${cycle}`,
    );
  const row = style[example.skill_code];
  if (!row) out.push(`no style row for "${example.skill_code}" in STYLE.json`);
  else if (row.signature_move !== example.signature_move)
    out.push(
      `signature_move differs from the style table's for "${example.skill_code}"`,
    );
  out.push(...hookProblems(example.hook, q));
  out.push(...verbatimProblems(example, q));
  const echo = spokenHookEchoProblem(example.hook);
  if (echo) out.push(echo);
  const spoken = [
    example.question_voice,
    ...example.steps.flatMap((s) => [s.notepad, s.voice]),
    example.answer.voice,
    example.trap.summary,
    ...example.trap.notepad,
    example.trap.voice,
    example.check,
    example.takeaway,
    example.signature_move,
  ];
  for (const text of spoken) {
    const p =
      hookPeopleProblem(text) ??
      hookStatisticProblem(text) ??
      publicPhraseProblem(text);
    if (p) out.push(p.replace(/^H\d /, ""));
  }
  return out;
}

/**
 * The monthly plan rotates hook types: no two consecutive slots share one, and a month of five or
 * more slots uses all five. Slots are in date order, one per day, all in the plan's month.
 */
export function planProblems(plan: WorkedExamplePlan): string[] {
  const out: string[] = [];
  const dates = plan.slots.map((s) => s.post_on);
  if (dates.some((d, k) => k > 0 && d <= (dates[k - 1] ?? "")))
    out.push("slots are not in date order, one per day");
  for (const d of dates)
    if (!d.startsWith(`${plan.month}-`))
      out.push(`slot ${d} is outside ${plan.month}`);
  plan.slots.forEach((s, k) => {
    const prev = plan.slots[k - 1];
    if (prev && prev.hook_type === s.hook_type)
      out.push(
        `${prev.post_on} and ${s.post_on} both use ${s.hook_type}: hook types rotate`,
      );
  });
  if (plan.slots.length >= WORKED_EXAMPLE_HOOK_TYPES.length) {
    const used = new Set<WorkedExampleHookType>(
      plan.slots.map((s) => s.hook_type),
    );
    const missing = WORKED_EXAMPLE_HOOK_TYPES.filter((t) => !used.has(t));
    if (missing.length > 0)
      out.push(`the month never uses ${missing.join(", ")}`);
  }
  return out;
}

/** An example must sit in its month's plan slot: same day, skill and hook type. */
export function planSlotProblem(
  example: WorkedExampleContent,
  plan: WorkedExamplePlan | null,
): string | null {
  if (!plan) return `no plan for ${example.post_on.slice(0, 7)}`;
  const slot = plan.slots.find((s) => s.post_on === example.post_on);
  if (!slot)
    return `${example.post_on} is not a slot in the ${plan.month} plan`;
  if (
    slot.skill_code !== example.skill_code ||
    slot.hook_type !== example.hook.type
  )
    return `${example.post_on} is planned as ${slot.skill_code} · ${slot.hook_type}, not ${example.skill_code} · ${example.hook.type}`;
  return null;
}

/** "Worked example · Percentages · obvious_answer_trap" (the brief's label, verbatim). */
export function workedExampleLabel(example: WorkedExampleContent): string {
  return `Worked example · ${example.skill_code} · ${example.hook.type}`;
}

/** "SAT Math worked example · Percentages": section and skill, at most 90 characters. */
export function workedExampleTitle(
  example: WorkedExampleContent,
  q: SeedQuestion,
): string {
  return capTiktokTitle(
    `SAT ${QOTD_SECTION_NAME[q.section]} worked example · ${example.skill_code}`,
  );
}

/**
 * The worked example's three captions and TikTok keywords, in the SCL-262 format.
 *
 * @spec [SCL-265: Karl's ruling 2026-11-02 "captions and keywords for worked examples use the
 *       SCL-262 format"; SCL-262 items 2-5 (the caption lines, at most five hashtags, keywords
 *       from the test month, the always-set, the section and the canonical domain); the CC BY 4.0
 *       licence of the music (video-kit/worked-examples/music/tracks.json), credited in every
 *       caption] | @implemented [2026-11-02]
 *
 * plain English: the headline is the example's title ("SAT Math worked example · Percentages",
 * at most 90 characters, starting "SAT"). The captions come from the one caption builder
 * (shared/social/posts.ts); the only line a worked example adds is the music credit, last, on all
 * three, because the track's licence requires attribution. Replaces (2026-11-02) the 2026-10-28
 * captions that opened "Follow for daily SAT questions 👆", carried the hook, and carried the
 * link-in-bio line (TikTok) or the comment-SAT line without the SCL-262 headline (Instagram).
 * The hook is no longer in the captions: it is on screen and spoken in the video.
 */
function captionContext(
  example: WorkedExampleContent,
  q: SeedQuestion,
): { headline: string; test: SocialTest | null; section: SocialSection } {
  return {
    headline: workedExampleTitle(example, q),
    test: nextSatTest(example.post_on),
    section: QOTD_SECTION_NAME[q.section],
  };
}

/** TikTok: headline / follow and comment / hashtags / the music credit. No promo or link line. */
export function workedExampleCaption(
  example: WorkedExampleContent,
  q: SeedQuestion,
  musicCredit: string,
): string {
  const c = captionContext(example, q);
  return socialTiktokCaption(c.headline, c.test, c.section, [musicCredit]);
}

/** Instagram: headline / comment / "Taking the SAT <date>? Comment SAT…" / hashtags / credit. */
export function workedExampleInstagramCaption(
  example: WorkedExampleContent,
  q: SeedQuestion,
  musicCredit: string,
): string {
  const c = captionContext(example, q);
  return socialInstagramCaption(c.headline, c.test, c.section, [musicCredit]);
}

/** Facebook: headline / the approach prompt / hashtags / credit. No link, no comment word. */
export function workedExampleFacebookCaption(
  example: WorkedExampleContent,
  q: SeedQuestion,
  musicCredit: string,
): string {
  const c = captionContext(example, q);
  return socialFacebookCaption(c.headline, c.test, c.section, [musicCredit]);
}

/** TikTok's keywords, keyed on the question's canonical domain (SCL-262 item 4). */
export function workedExampleKeywords(
  example: WorkedExampleContent,
  q: SeedQuestion,
): ReturnType<typeof socialKeywords> {
  return socialKeywords(
    example.post_on,
    QOTD_SECTION_NAME[q.section],
    q.domain,
  );
}

export function titleProblems(title: string): string[] {
  const out: string[] = [];
  if (title.length > WORKED_EXAMPLE_TITLE_MAX)
    out.push(
      `title is ${title.length} characters (at most ${WORKED_EXAMPLE_TITLE_MAX})`,
    );
  if (!title.startsWith("SAT")) out.push(`title must start "SAT": "${title}"`);
  const p = publicPhraseProblem(title);
  if (p) out.push(p);
  return out;
}

/** A link or a bio line: no caption carries one (SCL-262 item 1). "ende.app" is the artist. */
const CAPTION_LINK =
  /https?:\/\/|\bwww\.|lyceon\.ai|\blink in bio\b|\bbio link\b/i;

/**
 * One caption against its headline: the headline first, the music credit present, no link, and
 * the hook rules that apply to any public line (no claims about people, no statistics, no
 * banned public-copy phrase).
 */
export function captionProblems(
  caption: string,
  musicCredit: string,
  headline: string,
): string[] {
  const out: string[] = [];
  const [first] = caption.split("\n");
  if (first !== headline)
    out.push(
      `caption's first line must be the headline "${headline}", got "${first ?? ""}"`,
    );
  if (!caption.split("\n").includes(musicCredit))
    out.push("caption does not credit the music track");
  const link = CAPTION_LINK.exec(caption);
  if (link) out.push(`caption carries a link or bio line ("${link[0]}")`);
  const p =
    hookPeopleProblem(caption) ??
    hookStatisticProblem(caption) ??
    publicPhraseProblem(caption);
  if (p) out.push(p.replace(/^H\d /, ""));
  return out;
}
