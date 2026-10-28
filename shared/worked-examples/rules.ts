/**
 * Worked examples: the hook rules, the TikTok title and caption, the monthly plan's hook rotation,
 * and the checks that tie an example to its question, its week and its committed voice.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): hook library
 *       ("no statistics or claims about students; no 'most people/students'; states or shows the
 *       puzzle within the first line; ends in curiosity, not the answer"; "the monthly plan
 *       rotates hook types"), cadence (the labelled set "Worked example · {skill} · {hook_type}",
 *       a TikTok title of at most 90 characters starting "SAT", a caption whose first line is
 *       "Follow for daily SAT questions 👆"), music credited in the share copy as /brag does;
 *       Public Disclosure Doctrine §0 rules 1-3, 5 (docs/plans/seo/seo-marketing-vertical.md)]
 *       | @implemented [2026-10-27]
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
 *      "most of you". The hook talks about the question, never about who gets it wrong.
 *   H3 states the puzzle: the hook shares a number or a content word with the question.
 *   H4 ends in curiosity: the hook ends with "?" or "…".
 *   H5 not the answer: the hook never contains the correct choice, a number that only the correct
 *      choice has, or "the answer is".
 *   H6 public-copy phrases: the shared banned list and the pipeline list (no AI, no process).
 */
import {
  WORKED_EXAMPLE_CAPTION_FIRST_LINE,
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

/** H2: no claims about students or people. */
export function hookPeopleProblem(text: string): string | null {
  const hit = PEOPLE.find((re) => re.test(text));
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

/** The fixed heading of the trap callout; the spoken trap starts with it. */
export const TRAP_HEADING = "The trap:";

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
  if (!/^the trap\b/i.test(example.trap.voice))
    out.push(`trap.voice must start "The trap": "${example.trap.voice}"`);
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

/** The caption: the follow line first, the hook, where to practise, tags, the music credit. */
export function workedExampleCaption(
  example: WorkedExampleContent,
  musicCredit: string,
): string {
  return [
    WORKED_EXAMPLE_CAPTION_FIRST_LINE,
    example.hook.line,
    "More SAT questions on lyceon.ai.",
    "#SAT #SATprep #digitalSAT #SATmath #studytok",
    musicCredit,
  ].join("\n\n");
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

export function captionProblems(
  caption: string,
  musicCredit: string,
): string[] {
  const out: string[] = [];
  const [first] = caption.split("\n");
  if (first !== WORKED_EXAMPLE_CAPTION_FIRST_LINE)
    out.push(
      `caption's first line must be "${WORKED_EXAMPLE_CAPTION_FIRST_LINE}", got "${first ?? ""}"`,
    );
  if (!caption.split("\n").includes(musicCredit))
    out.push("caption does not credit the music track");
  const p =
    hookPeopleProblem(caption) ??
    hookStatisticProblem(caption) ??
    publicPhraseProblem(caption);
  if (p) out.push(p.replace(/^H\d /, ""));
  return out;
}
