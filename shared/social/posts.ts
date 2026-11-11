/**
 * What Karl pastes into each social post: the caption, the hashtags and TikTok's keywords, from
 * the post's date, section and domain.
 *
 * @spec [owner brief "Simplify the daily #social messages + add keywords" and Karl's Step 0
 *       rulings (2026-11-02): one caption block per post, TikTok keywords only, the test-month
 *       keyword and hashtag from the next SAT, the always/section/domain keyword sets, an unknown
 *       domain fails loudly, the per-platform caption formats, at most five hashtags, no promo or
 *       link line on TikTok or Facebook; Karl's answer the same day: the SAT dates are
 *       SAT_TEST_DATES, no second list; Public Disclosure Doctrine 1 (industry-standard wording)]
 *       | @implemented [2026-11-02]
 *
 * plain English: the "test month" is the month of the next confirmed SAT on or after the post's
 * date (America/Chicago day), from SAT_TEST_DATES (shared/sat-test-dates.ts, College Board's
 * dates): "November SAT questions" through Nov 7, then "December SAT questions". It leads the
 * headline, the keywords and one hashtag. With no confirmed date left it is left out everywhere
 * and the run carries a warning ("SAT date list needs updating"): never a guessed month.
 *
 * Keywords are the test month, then SOCIAL_ALWAYS_KEYWORDS, the section's, then the domain's, with
 * no duplicates. The domain map is keyed on the canonical domain strings
 * (shared/canonical-domains.ts) and must name exactly those; a domain that is not one of its
 * section's canonical domains is an error, never a quiet drop.
 *
 * The wording lives in the exported constants, so it can change without touching the logic.
 *
 * The caption builders take the headline (socialTiktokCaption, socialInstagramCaption,
 * socialFacebookCaption): the QOTD passes qotdHeadline, and the worked examples pass their title
 * (SCL-265, Karl's ruling 2026-11-02: worked-example captions and keywords use this format). One
 * builder, no second copy. Nothing is appended: since Karl's ruling of 2026-11-04 the music
 * credit is on the video's end card, not in any caption (copyBlockProblems guards every block).
 */
import { CANONICAL_DOMAINS_BY_SECTION } from "../canonical-domains";
import { SAT_TEST_DATES } from "../sat-test-dates";

/** A section as the social copy names it. */
export type SocialSection = "Math" | "Reading and Writing";

const SECTION_CODE: Record<SocialSection, "M" | "RW"> = {
  Math: "M",
  "Reading and Writing": "RW",
};

/** On every TikTok post, after the test month. */
export const SOCIAL_ALWAYS_KEYWORDS: readonly string[] = [
  "SAT",
  "SAT prep",
  "Digital SAT",
  "College admissions",
];

export const SOCIAL_SECTION_KEYWORDS: Readonly<
  Record<SocialSection, readonly string[]>
> = {
  Math: ["SAT math"],
  "Reading and Writing": ["SAT english", "SAT reading"],
};

/** Keyed on the canonical domain strings (no hyphen in "Problem Solving and Data Analysis"). */
export const SOCIAL_DOMAIN_KEYWORDS: Readonly<
  Record<string, readonly string[]>
> = {
  Algebra: ["Algebra"],
  "Advanced Math": ["Advanced math", "Algebra 2"],
  "Problem Solving and Data Analysis": ["Data analysis", "Statistics"],
  "Geometry and Trigonometry": ["Geometry", "Trig"],
  "Information and Ideas": ["Reading comprehension"],
  "Craft and Structure": ["Vocabulary"],
  "Expression of Ideas": ["SAT writing"],
  "Standard English Conventions": ["SAT grammar", "Grammar"],
};

/** The section hashtag, last of the five. */
export const SOCIAL_SECTION_HASHTAG: Readonly<Record<SocialSection, string>> = {
  Math: "#SATMath",
  "Reading and Writing": "#SATEnglish",
};

/** The first hashtags of every post, before the test month's. */
export const SOCIAL_BASE_HASHTAGS: readonly string[] = [
  "#SAT",
  "#SATprep",
  "#digitalSAT",
];

/** The Slack-visible warning when SAT_TEST_DATES has no confirmed date left. */
export const SAT_DATE_LIST_WARNING = "SAT date list needs updating";

/** The next SAT a post points to. */
export type SocialTest = {
  /** YYYY-MM-DD. */
  date: string;
  /** "November". */
  month: string;
  /** "Nov 7". */
  label: string;
};

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * The next confirmed SAT on or after `postDate` (YYYY-MM-DD, the Chicago day the post goes out),
 * or null when SAT_TEST_DATES has none left. On test day itself it is that day's test.
 */
export function nextSatTest(postDate: string): SocialTest | null {
  const next = SAT_TEST_DATES.filter(
    (d) => d.status === "confirmed" && d.date >= postDate,
  )
    .map((d) => d.date)
    .sort()[0];
  if (next === undefined) return null;
  const at = utc(next);
  return {
    date: next,
    month: at.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }),
    label: at.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }),
  };
}

/** The run's warnings for `postDate`: the SAT date list running out, or none. */
export function socialDateWarnings(postDate: string): string[] {
  return nextSatTest(postDate) === null
    ? [
        `${SAT_DATE_LIST_WARNING}: SAT_TEST_DATES has no confirmed SAT on or after ${postDate}, so the test month is left out`,
      ]
    : [];
}

/** At most five: #SAT #SATprep #digitalSAT #<Month>SAT and the section's. */
export function socialHashtags(
  test: SocialTest | null,
  section: SocialSection,
): string {
  return [
    ...SOCIAL_BASE_HASHTAGS,
    ...(test ? [`#${test.month}SAT`] : []),
    SOCIAL_SECTION_HASHTAG[section],
  ].join(" ");
}

/**
 * TikTok's keywords for one post: test month, always-set, section, domain, no duplicates. An
 * unknown domain, or one that is not its section's, is an error.
 */
export function socialKeywords(
  postDate: string,
  section: SocialSection,
  domain: string,
): { ok: true; keywords: string[] } | { ok: false; error: string } {
  const domainKeywords = Object.prototype.hasOwnProperty.call(
    SOCIAL_DOMAIN_KEYWORDS,
    domain,
  )
    ? SOCIAL_DOMAIN_KEYWORDS[domain]
    : undefined;
  if (
    domainKeywords === undefined ||
    !CANONICAL_DOMAINS_BY_SECTION[SECTION_CODE[section]].includes(domain)
  ) {
    return {
      ok: false,
      error: `keywords: "${domain}" is not a ${section} domain in SOCIAL_DOMAIN_KEYWORDS`,
    };
  }
  const test = nextSatTest(postDate);
  const keywords = [
    ...(test ? [`${test.month} SAT questions`] : []),
    ...SOCIAL_ALWAYS_KEYWORDS,
    ...SOCIAL_SECTION_KEYWORDS[section],
    ...domainKeywords,
  ];
  return { ok: true, keywords: [...new Set(keywords)] };
}

/** "November SAT question of the day · Math" (no month when no SAT is left). */
export function qotdHeadline(
  test: SocialTest | null,
  section: SocialSection,
): string {
  return `${test ? `${test.month} ` : ""}SAT question of the day · ${section}`;
}

export const SOCIAL_FOLLOW_AND_COMMENT_LINE =
  "Follow for daily SAT questions 👆 Comment your answer 👇";
export const SOCIAL_COMMENT_LINE = "Comment your answer 👇";
export const SOCIAL_INSTAGRAM_COMMENT_SAT =
  "Comment SAT and I'll send you the link";
/** Facebook: no link and no "comment a word" ask (Meta demotes both). */
export const SOCIAL_FACEBOOK_PROMPT_LINE =
  "How would you solve it? Share your approach below 👇";

/** "Taking the SAT Nov 7? Comment SAT and I'll send you the link", or the ask alone. */
export function instagramCommentSatLine(test: SocialTest | null): string {
  return test
    ? `Taking the SAT ${test.label}? ${SOCIAL_INSTAGRAM_COMMENT_SAT}`
    : SOCIAL_INSTAGRAM_COMMENT_SAT;
}

/**
 * TikTok: headline / follow and comment / hashtags.
 *
 * @spec [SCL-262 item 2 (Karl's rulings 2026-11-02); SCL-265 (Karl's ruling 2026-11-02: the
 *       worked-example captions use the SCL-262 format)] | @implemented [2026-11-02]
 *
 * plain English: the one TikTok caption builder. The QOTD passes its headline
 * (qotdTiktokCaption); a worked example passes its title (shared/worked-examples/rules.ts).
 * Nothing may be appended: no promo or link line on TikTok, and no music credit (Karl,
 * 2026-11-04: it is on the video's end card).
 */
export function socialTiktokCaption(
  headline: string,
  test: SocialTest | null,
  section: SocialSection,
): string {
  return [
    headline,
    SOCIAL_FOLLOW_AND_COMMENT_LINE,
    socialHashtags(test, section),
  ].join("\n\n");
}

/** Instagram: headline / comment / the comment-SAT ask (the only call to action) / hashtags. */
export function socialInstagramCaption(
  headline: string,
  test: SocialTest | null,
  section: SocialSection,
): string {
  return [
    headline,
    SOCIAL_COMMENT_LINE,
    instagramCommentSatLine(test),
    socialHashtags(test, section),
  ].join("\n\n");
}

/** Facebook: headline / the approach prompt / hashtags. No link, no "comment a word" ask. */
export function socialFacebookCaption(
  headline: string,
  test: SocialTest | null,
  section: SocialSection,
): string {
  return [
    headline,
    SOCIAL_FACEBOOK_PROMPT_LINE,
    socialHashtags(test, section),
  ].join("\n\n");
}

/** TikTok, QOTD carousel: the QOTD headline through socialTiktokCaption. */
export function qotdTiktokCaption(
  postDate: string,
  section: SocialSection,
): string {
  const test = nextSatTest(postDate);
  return socialTiktokCaption(qotdHeadline(test, section), test, section);
}

/** Instagram, QOTD: the QOTD headline through socialInstagramCaption. */
export function qotdInstagramCaption(
  postDate: string,
  section: SocialSection,
): string {
  const test = nextSatTest(postDate);
  return socialInstagramCaption(qotdHeadline(test, section), test, section);
}

/** Facebook, QOTD: the QOTD headline through socialFacebookCaption. */
export function qotdFacebookCaption(
  postDate: string,
  section: SocialSection,
): string {
  const test = nextSatTest(postDate);
  return socialFacebookCaption(qotdHeadline(test, section), test, section);
}

/**
 * Every fixed line these captions can carry, for every confirmed SAT and none. The leak checks
 * leave them out: "Taking the SAT Nov 7?" would otherwise read as naming a choice "7".
 */
export function socialFixedLines(): string[] {
  const tests: (SocialTest | null)[] = [
    null,
    ...SAT_TEST_DATES.filter((d) => d.status === "confirmed").map((d) =>
      nextSatTest(d.date),
    ),
  ];
  return [
    SOCIAL_FOLLOW_AND_COMMENT_LINE,
    SOCIAL_COMMENT_LINE,
    SOCIAL_FACEBOOK_PROMPT_LINE,
    ...tests.map((t) => instagramCommentSatLine(t)),
  ];
}

/**
 * The text with its fixed caption lines taken out, for the leak checks. Only whole lines that
 * equal a fixed line exactly are removed; anything else on the line is still checked.
 */
export function withoutSocialFixedLines(text: string): string {
  const fixed = new Set(socialFixedLines());
  return text
    .split("\n")
    .filter((line) => !fixed.has(line.trim()))
    .join("\n");
}

/**
 * What a #social copy block may never hold: only the text Karl pastes goes inside one.
 *
 * @spec [Karl's ruling 2026-11-04, "Copy-paste cleanup for all #social outputs": "Caption blocks
 *       contain only what Karl pastes. No music credit, labels, IDs, hook or trap type, 'For
 *       review: posts on...', file names or review notes inside any copy block"; tests: "No caption
 *       block contains 'Music:', 'CC BY', a URL, or a field label"] | @implemented [2026-11-04]
 *
 * plain English: one problem per kind found, naming the kind only (never echoing the block).
 * Every #social copy block (QOTD, worked example, breakdown, any manual re-render) passes through
 * this before it is posted: captions, keywords, alt text. "Comment SAT and I'll send you the
 * link" is the approved Instagram call to action (SCL-262) and is not a URL.
 */
const COPY_BLOCK_FORBIDDEN: readonly { what: string; re: RegExp }[] = [
  { what: "a music credit", re: /\bmusic\s*:/i },
  {
    what: "a licence",
    re: /\bCC[\s-]?BY\b|\bCC0\b|creative\s+commons|\blicen[cs]e\b/i,
  },
  {
    what: "a URL",
    re: /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:app|ai|com|org|net|io|co)\b/i,
  },
  {
    what: "a field label",
    re: /^\s*(?:label|title|caption|keywords?|alt(?:\s+text)?|hook|trap|type|id|file|video|review|for review|posts? on|source|link|url|credit|section|date|platform)\s*:/im,
  },
  {
    what: "a review note",
    re: /\bfor review\b|\bposts on \d{4}-\d{2}-\d{2}\b|\bposts by hand\b|\bsame video as\b/i,
  },
  {
    what: "an internal label or id",
    re: /^Worked example\s+·|\b[a-z]+(?:_[a-z]+)+\b|\bwe-[a-z0-9]{6,}\b|\bSAT(?:M|RW)[12][A-Z0-9]{6}\b/m,
  },
  {
    what: "a file name",
    re: /\b[\w-]+\.(?:mp4|mov|png|jpe?g|wav|mp3|json|txt)\b/i,
  },
];

export function copyBlockProblems(text: string): string[] {
  return COPY_BLOCK_FORBIDDEN.filter((f) => f.re.test(text)).map(
    (f) => `copy block carries ${f.what}`,
  );
}
