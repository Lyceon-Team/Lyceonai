/**
 * The five blog posts, rewritten (SEO Wave 3, plan row C4).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C4, P8; owner decisions on Wave 3, 2026-10-05:
 *       decision 6 ('Blog byline: "Lyceon Team" as JSON-LD Organization, the rewrite date shown,
 *       URLs unchanged'); "Blog rewrites (C4): approved by Karl as drafted, with one addition: end
 *       each of the five posts with the standard 'Start the free diagnostic' CTA"]
 *       | @implemented [2026-10-05]
 *
 * plain English: each post is a content page in the Wave 3 schema (path `/blog/<slug>`), so it is
 * rendered by the same article renderer and passes the same publish gate as every other content
 * page: a source or claim-inventory row on every block, Karl's approval dated on or after the
 * rewrite, meta lengths, links that resolve, one H1. The slugs are the old URLs, unchanged.
 * `published` is each post's original date and `lastModified` the rewrite date, which the post
 * shows ("Updated …") and the sitemap uses.
 *
 * edge cases: the blog routes stay the parameterised `/blog/:slug` (registry content_source
 * `blog`), so these pages are not in CONTENT_PAGES or CONTENT_PAGE_PATHS; the prerender gates
 * them alongside the content pages (BLOG_PAGES). Links here are literal paths, not the constants
 * in ./pages, because ./pages/guides imports this file.
 */
import {
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_CALCULATOR,
  CB_CONTENT_DOMAINS,
  CB_MATH_OVERVIEW,
  CB_PERCENTILES,
  CB_PRACTICE,
  CB_READING_WRITING,
  CB_SCORES,
  CB_STRUCTURE,
  CB_ANNUAL_REPORT_2026,
  CB_UNDERSTANDING_SCORES_PDF,
  CEPEDA_2006,
} from "../seo/sources";
import {
  contentPageSchema,
  type ContentPage,
  type ContentPageInput,
} from "../../packages/shared/src/seo-content-schema";

const APPROVED = { by: "Karl", date: "2026-10-05" } as const;
const REWRITTEN = "2026-10-05";

/** The byline (decision 6): the team, as a JSON-LD Organization. */
export const BLOG_AUTHOR = "Lyceon Team";

type PostSpec = {
  slug: string;
  category: string;
  tags: string[];
  /** The original publish date; the rewrite date is `lastModified`. */
  published: string;
  page: Omit<
    ContentPageInput,
    "path" | "published" | "lastModified" | "approved" | "crumb"
  >;
};

const POSTS: readonly PostSpec[] = [
  {
    slug: "is-digital-sat-harder",
    category: "SAT Basics",
    tags: ["digital-sat", "sat-prep", "test-comparison"],
    published: "2024-12-15",
    page: {
      title: "Is the Digital SAT Harder Than the Paper SAT? | Lyceon",
      description:
        "How the digital SAT differs from the paper test: length, modules, passages and the calculator, and what those changes mean for how you practice.",
      h1: "Is the Digital SAT Harder Than the Paper SAT?",
      intro: [
        {
          type: "p",
          text: "It isn't harder or easier. It's a different test, and it helps to practice for the one you'll take.",
          claims: ["W20"],
        },
      ],
      sections: [
        {
          heading: "What's different",
          level: 2,
          blocks: [
            {
              type: "ul",
              items: [
                "It's shorter. The test takes 2 hours and 14 minutes: 64 minutes for Reading and Writing and 70 for Math.",
                "Each section has two modules. The second module is easier or harder depending on how you did on the first.",
                "Passages are short. Each Reading and Writing question has its own passage of 25 to 150 words.",
                "The calculator is allowed throughout Math. A Desmos graphing calculator is built into Bluebook, the testing app.",
              ],
              sources: [CB_STRUCTURE, CB_READING_WRITING, CB_CALCULATOR],
            },
          ],
        },
        {
          heading: "What it means for your prep",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Take at least one full-length practice test in Bluebook. The College Board's practice tests are free, timed like the real test and scored, so test day won't be the first time you see the format.",
              sources: [CB_PRACTICE, CB_BLUEBOOK_PRACTICE_TESTS],
              claims: ["W20"],
            },
            {
              type: "p",
              text: "Don't try to read your second module. Whether it feels easy or hard, the job is the same: answer the question in front of you.",
              claims: ["W20"],
            },
            {
              type: "p",
              text: "Get comfortable with the built-in calculator before test day, not during it.",
              claims: ["W20"],
            },
          ],
        },
        {
          heading: "Next steps",
          level: 2,
          blocks: [
            {
              type: "links",
              items: [
                {
                  label: "Free SAT practice tests",
                  href: "/free-sat-practice-test",
                },
                {
                  label: "SAT practice questions",
                  href: "/sat-practice-questions",
                },
                {
                  label: "How to study for the SAT",
                  href: "/how-to-study-for-the-sat",
                },
              ],
            },
            { type: "cta" },
          ],
        },
      ],
    },
  },
  {
    slug: "digital-sat-scoring-explained",
    category: "SAT Basics",
    tags: ["digital-sat", "sat-scoring", "sat-modules"],
    published: "2024-12-14",
    page: {
      title: "How Digital SAT Scores Work | Lyceon",
      description:
        "How the digital SAT is scored: the 400 to 1600 scale, the two section scores, what a percentile means, and the College Board's benchmarks.",
      h1: "How Digital SAT Scores Work",
      intro: [
        {
          type: "p",
          text: "Your SAT score report gives you three numbers that matter: a total score and two section scores. Here's what each one means.",
          sources: [CB_SCORES],
        },
      ],
      sections: [
        {
          heading: "The scale",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Each section, Reading and Writing and Math, is scored from 200 to 800. Your total is the sum of the two, from 400 to 1600.",
              sources: [CB_SCORES],
            },
          ],
        },
        {
          heading: "Two modules per section",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Each section is split into two modules of equal length. The second module is easier or harder depending on how you did on the first. The College Board doesn't publish how raw answers convert to a score, so be wary of anyone who claims to know the formula.",
              sources: [CB_STRUCTURE],
              claims: ["W21"],
            },
          ],
        },
        {
          heading: "Percentiles",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "A percentile is the share of students who scored at or below you. On the College Board's table, a total of 1200 is at the 75th user percentile, and 1400 is at the 93rd.",
              sources: [CB_PERCENTILES],
            },
          ],
        },
        {
          heading: "The average and the benchmarks",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "The mean total score for the class of 2026 was 1045. The College Board's benchmarks are 480 for Reading and Writing and 530 for Math. Students who meet them have a 75% likelihood of a C or better in a related first-semester college course.",
              sources: [CB_ANNUAL_REPORT_2026, CB_UNDERSTANDING_SCORES_PDF],
            },
            {
              type: "links",
              items: [
                {
                  label: "What is a good SAT score?",
                  href: "/what-is-a-good-sat-score",
                },
                {
                  label: "Free SAT practice tests",
                  href: "/free-sat-practice-test",
                },
              ],
            },
            { type: "cta" },
          ],
        },
      ],
    },
  },
  {
    slug: "quick-sat-study-routine",
    category: "Study Tips",
    tags: ["sat-prep", "study-routine", "quick-study"],
    published: "2024-12-13",
    page: {
      title: "A Quick SAT Study Routine (15 Minutes a Day) | Lyceon",
      description:
        "A 15-minute daily SAT routine: focused practice, then review. Why short regular sessions work, and a simple week that covers both sections.",
      h1: "A Quick SAT Study Routine (15 Minutes a Day)",
      intro: [
        {
          type: "p",
          text: "You don't need three-hour sessions to prepare for the SAT. A short routine you keep beats a long one you skip.",
          claims: ["W22"],
        },
      ],
      sections: [
        {
          heading: "The 15-minute routine",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Minutes 1 to 10: practice. Do 5 to 8 questions from one content area. Stay in one area so you go deeper, not wider.",
              claims: ["W22"],
            },
            {
              type: "p",
              text: "Minutes 11 to 15: review. This is the part that matters. For every miss, find the step that went wrong and what you'll do differently next time.",
              claims: ["W22"],
            },
          ],
        },
        {
          heading: "Why short sessions work",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Research on learning finds that practice spread out over time is remembered better than the same practice crammed into one sitting. And 15 minutes a day for 8 weeks adds up to 14 hours.",
              sources: [CEPEDA_2006],
              claims: ["W22"],
            },
          ],
        },
        {
          heading: "A simple week",
          level: 2,
          blocks: [
            {
              type: "ul",
              items: [
                "Monday, Wednesday, Friday: Math, rotating through the four content areas",
                "Tuesday, Thursday: Reading and Writing",
                "Weekend: a longer mixed review, or a timed set",
              ],
              sources: [CB_CONTENT_DOMAINS],
              claims: ["W22"],
            },
          ],
        },
        {
          heading: "Start with a baseline",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Before you start, take a free full-length practice test in Bluebook. Your score report shows which content areas to start with.",
              sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_CONTENT_DOMAINS],
              claims: ["W22"],
            },
            {
              type: "links",
              items: [
                {
                  label: "How to study for the SAT",
                  href: "/how-to-study-for-the-sat",
                },
                {
                  label: "SAT practice questions",
                  href: "/sat-practice-questions",
                },
              ],
            },
            { type: "cta" },
          ],
        },
      ],
    },
  },
  {
    slug: "sat-question-bank-practice",
    category: "Study Tips",
    tags: ["sat-practice", "question-bank", "study-tips"],
    published: "2024-12-12",
    page: {
      title: "How to Use an SAT Question Bank Without Burning Out | Lyceon",
      description:
        "How to practice from an SAT question bank: attempt, review, log your patterns, and spot burnout early. Quality of review beats question count.",
      h1: "How to Use an SAT Question Bank Without Burning Out",
      intro: [
        {
          type: "p",
          text: "A question bank only helps if you use it well. Twenty questions with careful review beat a hundred done in a rush.",
          claims: ["W23"],
        },
      ],
      sections: [
        {
          heading: "Attempt, review, log",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Attempt, timed. Give yourself about a minute or two per question so you practice the pace of the test.",
              claims: ["W23"],
            },
            {
              type: "p",
              text: "Review, untimed. Spend at least as long reviewing as answering. For every miss: what was tested, where your reasoning went wrong, and what the right approach is.",
              claims: ["W23"],
            },
            {
              type: "p",
              text: "Log patterns. Keep a short error log. After a few weeks you'll see the same few mistakes come up. Practice those.",
              claims: ["W23"],
            },
          ],
        },
        {
          heading: "Signs you're burning out",
          level: 2,
          blocks: [
            {
              type: "ul",
              items: [
                "Rushing to finish",
                "Skipping review",
                "Dreading the next session",
              ],
              claims: ["W23"],
            },
            {
              type: "p",
              text: "If that's you, take a day off and come back with shorter sessions.",
              claims: ["W23"],
            },
          ],
        },
        {
          heading: "Free question banks",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "The College Board offers free practice through Bluebook and its Student Question Bank. Lyceon posts a free SAT Question of the Day, and keeps every past one with its explanation.",
              sources: [CB_PRACTICE],
              claims: ["W5", "W23"],
            },
            {
              type: "links",
              items: [
                {
                  label: "SAT practice questions",
                  href: "/sat-practice-questions",
                },
                {
                  label: "SAT Question of the Day",
                  href: "/sat-question-of-the-day",
                },
              ],
            },
            { type: "cta" },
          ],
        },
      ],
    },
  },
  {
    slug: "common-sat-math-algebra-mistakes",
    category: "SAT Math",
    tags: ["sat-math", "algebra", "common-mistakes"],
    published: "2024-12-11",
    page: {
      title: "Common SAT Algebra Mistakes (And How to Fix Them) | Lyceon",
      description:
        "Six algebra mistakes that are easy to make on the SAT, from answering the wrong question to sign errors, and a simple fix for each one.",
      h1: "Common SAT Algebra Mistakes (And How to Fix Them)",
      intro: [
        {
          type: "p",
          text: "Algebra is one of the four content areas in SAT Math, with 13 to 15 of the section's 44 questions. These six mistakes are easy to make and easy to fix.",
          sources: [CB_MATH_OVERVIEW, CB_STRUCTURE],
          claims: ["W24"],
        },
      ],
      sections: [
        {
          heading: "1. Answering a different question",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "The question asks for 2x + 1 and you stop at x = 3. The answer is 7. Fix: underline what the question asks for, and check it before you choose.",
              claims: ["W24"],
            },
          ],
        },
        {
          heading: "2. Sign errors when distributing",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "−2(x − 3) is −2x + 6, not −2x − 6. Fix: write the step out whenever a negative is involved.",
              claims: ["W24"],
            },
          ],
        },
        {
          heading: "3. Not checking solutions",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "With a variable in a denominator or under a root, a solution can fail when you plug it back in. Fix: substitute it into the original equation.",
              claims: ["W24"],
            },
          ],
        },
        {
          heading: "4. Misreading word problems",
          level: 2,
          blocks: [
            {
              type: "p",
              text: '"3 more than twice a number" is 2x + 3, not 2(x + 3). Fix: translate one phrase at a time.',
              claims: ["W24"],
            },
          ],
        },
        {
          heading: "5. Flipping the slope formula",
          level: 2,
          blocks: [
            {
              type: "p",
              text: 'Slope is the change in y over the change in x. Fix: say "rise over run" as you write it.',
              claims: ["W24"],
            },
          ],
        },
        {
          heading: "6. Arithmetic slips under pressure",
          level: 2,
          blocks: [
            {
              type: "p",
              text: "Fix: use the calculator. It's allowed for the whole Math section, and Desmos is built into Bluebook.",
              sources: [CB_CALCULATOR],
              claims: ["W24"],
            },
            {
              type: "links",
              items: [
                {
                  label: "SAT Algebra practice questions",
                  href: "/sat-practice-questions/math/algebra",
                },
                {
                  label: "SAT Math practice questions",
                  href: "/sat-practice-questions/math",
                },
              ],
            },
            { type: "cta" },
          ],
        },
      ],
    },
  },
];

export type BlogPost = {
  slug: string;
  /** The post's own title (its H1), without the site suffix. */
  title: string;
  description: string;
  /** The date the post shows and the sitemap uses: the rewrite date. */
  date: string;
  category: string;
  tags: string[];
  author: string;
  /** The post as a content page (`/blog/<slug>`), gated like every other content page. */
  page: ContentPage;
};

function toPost(spec: PostSpec): BlogPost {
  const parsed = contentPageSchema.safeParse({
    ...spec.page,
    path: `/blog/${spec.slug}`,
    crumb: spec.page.h1,
    parent: "/blog",
    published: spec.published,
    lastModified: REWRITTEN,
    approved: APPROVED,
  });
  if (!parsed.success) {
    throw new Error(
      `blog post ${spec.slug} does not fit the content schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const page = parsed.data;
  return {
    slug: spec.slug,
    title: page.h1,
    description: page.description,
    date: page.lastModified,
    category: spec.category,
    tags: spec.tags,
    author: BLOG_AUTHOR,
    page,
  };
}

export const BLOG_POSTS: readonly BlogPost[] = POSTS.map(toPost);

/** The posts as content pages, for the publish gate. */
export const BLOG_PAGES: readonly ContentPage[] = BLOG_POSTS.map((p) => p.page);
