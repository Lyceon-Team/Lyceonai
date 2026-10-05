/**
 * P2: the SAT practice-question hub, its two section pages and the eight domain pages.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C2 (P2), R20a (the dated archive is the one
 *       public exposure of bank content); owner decisions on Wave 3 Step 0, 2026-10-05: decision 1
 *       ("No skill pages. Domain pages only … Don't list or anchor individual skills … Each domain
 *       page shows up to 2 archived QOTD questions from that domain and links to the archive"),
 *       decision 3 (the /digital-sat* 301s; the section pages carry their copy), "Copy: approved
 *       as drafted"] | @implemented [2026-10-05]
 *
 * plain English: the hub copy is the approved draft. The section pages carry the approved FAQs,
 * tips and grammar notes that lived on /digital-sat/math and /digital-sat/reading-writing (F6,
 * 2026-10-03), which now 301 here. Each domain page states what the College Board says the domain
 * covers (CB_CONTENT_DOMAINS; for Math, the question count from CB_MATH_OVERVIEW) and shows up to
 * two past Questions of the Day from it. Nothing names a skill or describes how questions are
 * chosen (Doctrine rule 2).
 *
 * trade-off: a domain page with no past question yet still builds. It says what the domain
 * covers, links to the archive and the other domains, and fills in as the archive grows; the
 * owner ruled domain pages in without a question minimum.
 */
import {
  CB_CALCULATOR,
  CB_CONTENT_DOMAINS,
  CB_KHAN,
  CB_MATH,
  CB_MATH_OVERVIEW,
  CB_PRACTICE,
  CB_READING_WRITING,
  CB_SCORES,
  CB_STRUCTURE,
} from "../../seo/sources";
import type { ContentPageInput } from "../../../packages/shared/src/seo-content-schema";
import { CANONICAL_DOMAINS_BY_SECTION } from "../../canonical-domains";

const APPROVED = { by: "Karl", date: "2026-10-05" } as const;
const DATES = { published: "2026-10-05", lastModified: "2026-10-05" } as const;

export const PRACTICE_HUB_PATH = "/sat-practice-questions";
export const MATH_PATH = `${PRACTICE_HUB_PATH}/math`;
export const READING_WRITING_PATH = `${PRACTICE_HUB_PATH}/reading-and-writing`;
const QOTD_HUB = "/sat-question-of-the-day";

type DomainSpec = {
  section: "M" | "RW";
  /** The canonical domain string (shared/canonical-domains.ts): what QOTD rows carry. */
  canonical: string;
  /** The College Board's public spelling. */
  name: string;
  slug: string;
  /** The College Board's description of the domain, as it publishes it (CB_CONTENT_DOMAINS). */
  measures: string;
  /** Math only: the College Board's question count for the domain (CB_MATH_OVERVIEW). */
  questions?: string;
};

export const DOMAINS: readonly DomainSpec[] = [
  {
    section: "M",
    canonical: "Algebra",
    name: "Algebra",
    slug: "algebra",
    measures:
      "the ability to analyze, fluently solve, and create linear equations and inequalities, as well as analyze and fluently solve equations and systems of equations using multiple techniques",
    questions: "13 to 15",
  },
  {
    section: "M",
    canonical: "Advanced Math",
    name: "Advanced Math",
    slug: "advanced-math",
    measures:
      "skills and knowledge central for progression to more advanced math courses, including demonstrating an understanding of absolute value, quadratic, exponential, polynomial, rational, radical, and other nonlinear equations",
    questions: "13 to 15",
  },
  {
    section: "M",
    canonical: "Problem Solving and Data Analysis",
    name: "Problem-Solving and Data Analysis",
    slug: "problem-solving-and-data-analysis",
    measures:
      "the ability to apply quantitative reasoning about ratios, rates, and proportional relationships; understand and apply unit rate; and analyze and interpret one- and two-variable data",
    questions: "5 to 7",
  },
  {
    section: "M",
    canonical: "Geometry and Trigonometry",
    name: "Geometry and Trigonometry",
    slug: "geometry-and-trigonometry",
    measures:
      "the ability to solve problems that focus on area and volume formulas; lines, angles, and triangles; right triangles and trigonometry; and circles",
    questions: "5 to 7",
  },
  {
    section: "RW",
    canonical: "Information and Ideas",
    name: "Information and Ideas",
    slug: "information-and-ideas",
    measures:
      "comprehension, analysis, and reasoning skills and knowledge, as well as the ability to locate, interpret, evaluate, and integrate information and ideas from texts and informational graphics (tables, bar graphs, and line graphs)",
  },
  {
    section: "RW",
    canonical: "Craft and Structure",
    name: "Craft and Structure",
    slug: "craft-and-structure",
    measures:
      "the comprehension, vocabulary, analysis, synthesis, and reasoning skills and knowledge needed to understand and use high-utility words and phrases in context, evaluate texts rhetorically, and make connections between topically related texts",
  },
  {
    section: "RW",
    canonical: "Expression of Ideas",
    name: "Expression of Ideas",
    slug: "expression-of-ideas",
    measures:
      "the ability to revise texts to improve the effectiveness of written expression and to meet specific rhetorical goals",
  },
  {
    section: "RW",
    canonical: "Standard English Conventions",
    name: "Standard English Conventions",
    slug: "standard-english-conventions",
    measures:
      "the ability to edit text to conform to core conventions of Standard English sentence structure, usage, and punctuation",
  },
];

// Fail at import, not on a live page, if the domain list ever drifts from the canonical pairing.
for (const section of ["M", "RW"] as const) {
  const here = DOMAINS.filter((d) => d.section === section)
    .map((d) => d.canonical)
    .sort();
  const canonical = [...CANONICAL_DOMAINS_BY_SECTION[section]].sort();
  if (here.join("|") !== canonical.join("|")) {
    throw new Error(
      `practice-questions: ${section} domains ${here.join(", ")} are not the canonical ${canonical.join(", ")}`,
    );
  }
}

export function domainPath(domain: DomainSpec): string {
  return `${domain.section === "M" ? MATH_PATH : READING_WRITING_PATH}/${domain.slug}`;
}

const SECTION_LABEL = { M: "Math", RW: "Reading and Writing" } as const;
const SECTION_PATH = { M: MATH_PATH, RW: READING_WRITING_PATH } as const;

/** "SAT Algebra Practice Questions | Lyceon", shortened only where the domain name is too long for 60. */
function domainTitle(name: string): string {
  const full = `SAT ${name} Practice Questions | Lyceon`;
  return full.length <= 60 ? full : `SAT ${name} Practice | Lyceon`;
}

function domainPage(domain: DomainSpec): ContentPageInput {
  const section = SECTION_LABEL[domain.section];
  const siblings = DOMAINS.filter(
    (d) => d.section === domain.section && d.slug !== domain.slug,
  );
  return {
    path: domainPath(domain),
    title: domainTitle(domain.name),
    description: `What SAT ${domain.name} questions cover, in the College Board's words, with recent free practice questions from the ${section} section.`,
    h1: `SAT ${domain.name} practice questions`,
    crumb: domain.name,
    parent: SECTION_PATH[domain.section],
    intro: [
      {
        type: "p",
        text: `${domain.name} is one of the four content areas in SAT ${section}.`,
        sources: [domain.section === "M" ? CB_MATH : CB_READING_WRITING],
        claims: ["W19"],
      },
    ],
    sections: [
      {
        heading: `What ${domain.name} covers`,
        level: 2,
        blocks: [
          {
            type: "p",
            text: `The College Board says ${domain.name} measures ${domain.measures}.`,
            sources: [CB_CONTENT_DOMAINS],
            claims: ["W19"],
          },
          domain.questions
            ? {
                type: "p",
                text: `The Math section has ${domain.questions} ${domain.name} questions out of 44, and questions from all four Math content areas appear in each module.`,
                sources: [CB_MATH_OVERVIEW, CB_STRUCTURE],
                claims: ["W19"],
              }
            : {
                type: "p",
                text: "Each Reading and Writing module has questions from all four content areas. Questions that test similar skills are grouped together and run from easiest to hardest.",
                sources: [CB_READING_WRITING],
                claims: ["W19"],
              },
        ],
      },
      {
        heading: "Recent Questions of the Day",
        level: 2,
        blocks: [
          {
            type: "p",
            text: `Past SAT Questions of the Day from ${domain.name}. Each one links to its answer and worked explanation.`,
            claims: ["W5", "W19"],
          },
          { type: "qotd", filter: { domain: domain.canonical }, limit: 2 },
          {
            type: "links",
            items: [
              { label: "All past SAT Questions of the Day", href: QOTD_HUB },
            ],
          },
        ],
      },
      {
        heading: `More SAT ${section} practice`,
        level: 2,
        blocks: [
          {
            type: "links",
            items: [
              ...siblings.map((d) => ({
                label: `SAT ${d.name} practice questions`,
                href: domainPath(d),
              })),
              {
                label: `All SAT ${section} practice questions`,
                href: SECTION_PATH[domain.section],
              },
            ],
          },
          { type: "cta" },
        ],
      },
    ],
    ...DATES,
    approved: APPROVED,
  };
}

function domainTableRows(section: "M" | "RW"): string[][] {
  return DOMAINS.filter((d) => d.section === section).map((d) => [
    `[${d.name}](${domainPath(d)})`,
    ...(section === "M" ? [d.questions ?? ""] : []),
    `Measures ${d.measures}.`,
  ]);
}

const hub: ContentPageInput = {
  path: PRACTICE_HUB_PATH,
  title: "SAT Practice Questions by Section and Topic | Lyceon",
  description:
    "Free SAT practice questions for Math and Reading and Writing, sorted by the topics the College Board tests, with a new Question of the Day every day.",
  h1: "SAT practice questions",
  crumb: "SAT practice questions",
  intro: [
    {
      type: "p",
      text: "The SAT has two sections, Reading and Writing, and Math. Each one tests four content areas the College Board names in its test specifications. Practice is easier to plan when you can see those areas and pick the one you need.",
      sources: [CB_STRUCTURE, CB_CONTENT_DOMAINS],
      claims: ["W16"],
    },
  ],
  sections: [
    {
      heading: "How the test is laid out",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "You get 64 minutes for Reading and Writing (54 questions) and 70 minutes for Math (44 questions), 2 hours and 14 minutes in all. Each section is split into two modules. Your score runs from 400 to 1600, with each section scored 200 to 800.",
          sources: [CB_STRUCTURE, CB_SCORES],
        },
      ],
    },
    {
      heading: "Math",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.",
          sources: [CB_MATH],
        },
        {
          type: "links",
          items: [{ label: "SAT Math practice questions", href: MATH_PATH }],
        },
      ],
    },
    {
      heading: "Reading and Writing",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Information and Ideas, Craft and Structure, Expression of Ideas, and Standard English Conventions.",
          sources: [CB_READING_WRITING],
        },
        {
          type: "links",
          items: [
            {
              label: "SAT Reading and Writing practice questions",
              href: READING_WRITING_PATH,
            },
          ],
        },
      ],
    },
    {
      heading: "A new question every day",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Each day we post one free SAT-style question with a full explanation. Past questions stay up in the archive, sorted by date.",
          claims: ["W5"],
        },
        {
          type: "links",
          items: [{ label: "Today's SAT Question of the Day", href: QOTD_HUB }],
        },
        { type: "cta" },
      ],
    },
  ],
  faq: [
    {
      question: "Where can I get official SAT practice questions?",
      answer:
        "The College Board publishes free full-length practice tests in its Bluebook app and sample questions in the test preview. Khan Academy offers free practice built with the College Board.",
      sources: [CB_PRACTICE, CB_KHAN],
    },
    {
      question: "Are Lyceon's questions from real SATs?",
      answer:
        "No. They are written in the style of the digital SAT and sorted by the same content areas. Real test questions are not published for practice.",
      claims: ["W6"],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

const math: ContentPageInput = {
  path: MATH_PATH,
  title: "SAT Math Practice Questions by Topic | Lyceon",
  description:
    "SAT Math practice by content area: what Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry cover, with free questions.",
  h1: "SAT Math practice questions",
  crumb: "Math",
  parent: PRACTICE_HUB_PATH,
  intro: [
    {
      type: "p",
      text: "The SAT Math section has 44 questions in two equal-length modules, with 70 minutes in total. You can use a calculator at any point in the section, and a Desmos calculator is built into Bluebook, the College Board's testing app.",
      sources: [CB_STRUCTURE, CB_CALCULATOR],
    },
  ],
  sections: [
    {
      heading: "The four Math content areas",
      level: 2,
      blocks: [
        {
          type: "table",
          caption: "SAT Math content areas",
          head: ["Content area", "Questions on the test", "What it covers"],
          rows: domainTableRows("M"),
          sources: [CB_MATH_OVERVIEW, CB_CONTENT_DOMAINS],
        },
      ],
    },
    {
      heading: "Common SAT Math mistakes",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Most lost points come from a few habits, not from math you don't know.",
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Not reading the full question",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "It's easy to solve for x when the question asks for a transformed expression. Re-check the prompt before choosing.",
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Sign errors in algebra",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Distributing negatives incorrectly is a common point drop. Slow down through sign-sensitive steps.",
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Rushing through word problems",
      level: 3,
      blocks: [
        {
          type: "p",
          text: "Translate text into equations deliberately. Define knowns and unknowns before solving. For more, read [Common Digital SAT Algebra Mistakes](/blog/common-sat-math-algebra-mistakes).",
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "How to practice",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "Review every miss and identify the exact reasoning step that failed.",
            "Use the calculator intentionally: for graphing, checking, and reducing arithmetic slips.",
            "Time selected sets to build pacing for the module limits.",
          ],
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Recent Math Questions of the Day",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Past SAT Questions of the Day from the Math section. Each one links to its answer and worked explanation.",
          claims: ["W5"],
        },
        { type: "qotd", filter: { section: "M" }, limit: 2 },
        {
          type: "links",
          items: [
            { label: "All past SAT Questions of the Day", href: QOTD_HUB },
            {
              label: "SAT Reading and Writing practice questions",
              href: READING_WRITING_PATH,
            },
          ],
        },
        { type: "cta" },
      ],
    },
  ],
  faq: [
    {
      question: "What math topics are on the Digital SAT?",
      answer:
        "The Digital SAT Math section covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.",
      sources: [CB_MATH],
    },
    {
      question: "Can I use a calculator on SAT Math?",
      answer:
        "Yes. You can use a calculator at any point in the Math section, and a Desmos calculator is built into Bluebook, the College Board's testing app.\n\nLyceon practice includes a built-in Desmos calculator on every Math question.",
      sources: [CB_CALCULATOR],
      claims: ["W13"],
    },
    {
      question: "How many math questions are on the Digital SAT?",
      answer:
        "The Math section has 44 questions in two equal-length modules, with 70 minutes in total.",
      sources: [CB_STRUCTURE],
    },
    {
      question: "What are common SAT Math mistakes?",
      answer:
        "Common slips include solving for the wrong expression, sign errors, rushing word-problem setup, and skipping answer checks.",
      claims: ["W13"],
    },
    {
      question: "How does Lyceon support math review?",
      answer:
        "Every practice question comes with a worked explanation. On paid plans, the AI tutor can walk through a problem step by step.",
      claims: ["W13"],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

const readingWriting: ContentPageInput = {
  path: READING_WRITING_PATH,
  title: "SAT Reading and Writing Practice Questions | Lyceon",
  description:
    "SAT Reading and Writing practice by content area, with strategies for short passages, the grammar rules that come up most, and free practice questions.",
  h1: "SAT Reading and Writing practice questions",
  crumb: "Reading and Writing",
  parent: PRACTICE_HUB_PATH,
  intro: [
    {
      type: "p",
      text: "The Reading and Writing section has 54 questions in two equal-length modules, with 64 minutes in total. Each question has its own short passage of 25 to 150 words.",
      sources: [CB_STRUCTURE, CB_READING_WRITING],
    },
  ],
  sections: [
    {
      heading: "The four Reading and Writing content areas",
      level: 2,
      blocks: [
        {
          type: "table",
          caption: "SAT Reading and Writing content areas",
          head: ["Content area", "What it covers"],
          rows: domainTableRows("RW"),
          sources: [CB_CONTENT_DOMAINS],
        },
      ],
    },
    {
      heading: "Strategies for short passages",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "Read the passage first, then the question. Short passages are fast enough to scan for intent before you weigh the options.",
            "Anchor in evidence. Every correct answer should map to explicit wording or logic in the passage.",
            "Use transitions as clues. Contrast and cause-effect language often points to the strongest option.",
            "Eliminate aggressively. Remove unsupported, extreme, or partly correct answers first.",
          ],
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Grammar rules that come up often",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "Subject-verb agreement: singular subjects take singular verbs, even when phrases separate them.",
            "Pronoun clarity: a pronoun must point clearly to one noun.",
            "Comma usage: know the required commas and leave out unnecessary ones.",
            "Verb tense consistency: keep tenses consistent unless the context calls for a deliberate shift.",
            "Modifier placement: put a modifier next to what it describes.",
            "Parallel structure: lists and comparisons follow the same grammatical form.",
          ],
          claims: ["W13"],
        },
      ],
    },
    {
      heading: "Recent Reading and Writing Questions of the Day",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Past SAT Questions of the Day from the Reading and Writing section. Each one links to its answer and worked explanation.",
          claims: ["W5"],
        },
        { type: "qotd", filter: { section: "RW" }, limit: 2 },
        {
          type: "links",
          items: [
            { label: "All past SAT Questions of the Day", href: QOTD_HUB },
            { label: "SAT Math practice questions", href: MATH_PATH },
          ],
        },
        { type: "cta" },
      ],
    },
  ],
  faq: [
    {
      question: "What is tested on SAT Reading and Writing?",
      answer:
        "The section covers Craft and Structure, Information and Ideas, Standard English Conventions, and Expression of Ideas.",
      sources: [CB_READING_WRITING],
    },
    {
      question: "How is Digital SAT Reading different from the paper test?",
      answer:
        "Each Reading and Writing question has its own short passage of 25 to 150 words.",
      sources: [CB_READING_WRITING],
    },
    {
      question: "How many Reading and Writing questions are on the Digital SAT?",
      answer:
        "The Reading and Writing section has 54 questions in two equal-length modules, with 64 minutes in total.",
      sources: [CB_STRUCTURE],
    },
    {
      question: "What vocabulary should I study for the SAT?",
      answer:
        "Focus on academic vocabulary in context and how meaning changes with passage usage.",
      claims: ["W13"],
    },
    {
      question: "How can I improve SAT Reading speed?",
      answer:
        "Practice evidence-based elimination, transition-word awareness, and short-passage pacing drills.",
      claims: ["W13"],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

export const PRACTICE_QUESTION_PAGES: readonly ContentPageInput[] = [
  hub,
  math,
  readingWriting,
  ...DOMAINS.map(domainPage),
];
