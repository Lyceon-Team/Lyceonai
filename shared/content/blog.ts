import {
  CB_MATH,
  CB_READING_WRITING,
  CB_SCORES,
  CB_STRUCTURE,
  CEPEDA_2006,
  type Source,
} from "../seo/sources";

/*
 * F6 (2026-10-03, owner-approved copy, Public Disclosure Doctrine §0): the posts below state
 * only facts the College Board publishes (or, for studying, published research), and each
 * post lists those sources in `sources`, which the post page renders under the article.
 * Statements about scoring the College Board does not publish (score caps, raw-score
 * conversion, which module "matters most") were removed, as were descriptions of how Lyceon
 * selects questions. Dates are unchanged here; they change with the C4 rewrite (owner
 * answer 5). Claim inventory: `docs/compliance/claim-inventory.md`.
 */
export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  tags: string[];
  author: string;
  content: string;
  sources?: readonly Source[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "is-digital-sat-harder",
    title: "Is the Digital SAT Harder Than the Paper SAT?",
    description: "How the Digital SAT differs from the paper SAT, and what the format changes mean for your prep.",
    date: "2024-12-15",
    category: "SAT Basics",
    tags: ["digital-sat", "sat-prep", "test-comparison"],
    author: "Lyceon Team",
    content: `The Digital SAT is a different test from the paper SAT, not simply an easier or harder one.

## Key Differences at a Glance

The Digital SAT takes 2 hours and 14 minutes, adapts at the module level, and uses short passages with one question each.

## What Makes It Feel Different

**Two modules per section.** Each section has two modules. The second module is easier or harder depending on how you did on the first.

**Shorter passages.** Each Reading and Writing passage is 25 to 150 words long and is followed by a single question.

## The Bottom Line

Practise in the digital format so the test feels familiar on the day: work efficiently on short passages and get comfortable with the on-screen tools.

## Next Steps

Start practicing with digital-format questions. Explore our [Digital SAT prep guide](/online-sat-prep) for a complete overview, or jump directly into [SAT Math practice](/sat-practice-questions/math) or [Reading & Writing practice](/sat-practice-questions/reading-and-writing).`,
    sources: [CB_STRUCTURE, CB_READING_WRITING],
  },
  {
    slug: "digital-sat-scoring-explained",
    title: "How Digital SAT Scores Work (Sections and Modules Explained)",
    description: "What the Digital SAT's two modules per section mean, and how the 400–1600 score scale is made up.",
    date: "2024-12-14",
    category: "SAT Basics",
    tags: ["digital-sat", "sat-scoring", "sat-modules"],
    author: "Lyceon Team",
    content: `The Digital SAT has two sections, Reading and Writing, and Math. Here is how the sections, modules and scores fit together.

## Two Modules per Section

Each section is split into two modules of equal length. The second module is easier or harder depending on how you did on the first.

## The Score Scale

Each section is scored from 200 to 800, and your total score is the sum of the two, from 400 to 1600.

## What This Means for Your Prep

1. **Practise both modules' worth of questions.** Build the stamina to stay accurate across a full section.
2. **Don't read too much into how Module 2 feels.** Focus on the question in front of you.
3. **Keep an eye on the clock.** Know how much time each section gives you and pace yourself.

## Practical Tips

- Practise with timed sets to get used to the pace of each section
- Review every mistake so you understand the reasoning
- Use all the time you have; rushing leads to careless errors

Ready to practice? Start with our [Digital SAT overview](/online-sat-prep) or dive into [SAT Math prep](/sat-practice-questions/math).`,
    sources: [CB_STRUCTURE, CB_SCORES],
  },
  {
    slug: "quick-sat-study-routine",
    title: "A Quick SAT Study Routine (15-20 Minutes a Day)",
    description: "Build an SAT prep habit with 15-20 minutes of daily practice. Short, regular practice is easier to keep up than occasional long sessions.",
    date: "2024-12-13",
    category: "Study Tips",
    tags: ["sat-prep", "study-routine", "quick-study"],
    author: "Lyceon Team",
    content: `You don't need 3-hour study sessions to prepare for the SAT. Short, regular practice is easier to keep up than occasional long sessions.

## The 15-Minute Daily Routine

**Minutes 1-10: Focused Practice**
Complete 5-8 questions in one topic area. Don't jump between math and reading—depth beats breadth in short sessions.

**Minutes 11-15: Review Mistakes**
This is the most important part. For every wrong answer, understand why you missed it. What concept did you misunderstand? What will you do differently next time?

## Why Short Sessions Work

1. **Easier to maintain.** You'll actually do it every day instead of skipping "marathon" sessions.
2. **Better retention.** Research on spaced practice finds that spreading study out over time is remembered better than cramming it into one session (Cepeda et al., 2006).
3. **Compounds over time.** 15 minutes daily for 8 weeks = 14 hours of quality practice.

## Weekly Structure

- Monday/Wednesday/Friday: Math (rotate between algebra, advanced math, data analysis)
- Tuesday/Thursday: Reading & Writing (vocabulary, grammar, comprehension)
- Weekend: 30-minute mixed review or a timed mini-section

## Make It Stick

- Same time every day (pick a time that works for you)
- Remove distractions—phone on airplane mode
- Track your streaks to build momentum

Every practice question comes with a worked explanation. Start with our [Digital SAT overview](/online-sat-prep), or focus on [Math](/sat-practice-questions/math) or [Reading & Writing](/sat-practice-questions/reading-and-writing) depending on your needs.`,
    sources: [CEPEDA_2006],
  },
  {
    slug: "sat-question-bank-practice",
    title: "SAT Question Bank: How to Practice Effectively Without Burning Out",
    description: "Learn how to use an SAT question bank strategically without burning out.",
    date: "2024-12-12",
    category: "Study Tips",
    tags: ["sat-practice", "question-bank", "study-tips"],
    author: "Lyceon Team",
    content: `A question bank is only useful if you know how to use it. Here's how to practice effectively without burning out.

## Quality Over Quantity

Doing 100 questions poorly is worse than doing 20 questions well with thorough review. After each practice session, you should be able to explain why every answer (right or wrong) is what it is.

## The 3-Step Practice Method

**Step 1: Attempt (Timed)**
Set a timer. For single questions, use 1-2 minutes. For a mini-section of 10 questions, use 12-15 minutes. This builds test-day pacing.

**Step 2: Review (Untimed)**
Spend at least as much time reviewing as you did answering. For every wrong answer:
- What concept was tested?
- Where did your reasoning go wrong?
- What's the correct approach?

**Step 3: Log Patterns**
Keep a simple error log. After a few weeks, you'll see patterns: "I miss comma splice questions" or "I rush through word problems." Target these weaknesses.

## Signs You're Burning Out

- Rushing through questions just to finish
- Not reviewing wrong answers
- Seeing scores plateau or drop
- Dreading practice sessions

If this happens, take a day off and reduce session length when you return.

## Practise at the Right Level

Mix in harder questions as easier ones start to feel routine.

## Recommended Weekly Volume

A smaller number of questions with careful review beats a large number done in a rush. Build up gradually and prioritize understanding over volume.

Ready to start? Explore our [Digital SAT prep resources](/online-sat-prep), including dedicated guides for [Math](/sat-practice-questions/math) and [Reading & Writing](/sat-practice-questions/reading-and-writing).`
  },
  {
    slug: "common-sat-math-algebra-mistakes",
    title: "Common Digital SAT Algebra Mistakes (And How to Fix Them)",
    description: "Six algebra mistakes that are easy to make, and how to avoid them.",
    date: "2024-12-11",
    category: "SAT Math",
    tags: ["sat-math", "algebra", "common-mistakes"],
    author: "Lyceon Team",
    content: `Algebra is one of the four content areas on the Digital SAT Math section. Here are six mistakes that are easy to make, and how to fix them.

## Mistake #1: Not Answering What's Asked

The question asks for 2x + 1, and you solved for x. You got x = 3, so you pick 3. But the answer is 2(3) + 1 = 7.

**Fix:** Circle or underline what the question asks for. Check it again before selecting your answer.

## Mistake #2: Sign Errors When Distributing

-2(x - 3) becomes -2x - 6 instead of -2x + 6.

**Fix:** Write out the distribution step by step. Don't skip steps when negatives are involved.

## Mistake #3: Forgetting to Check All Solutions

For equations with variables in denominators or under radicals, you might find a solution that doesn't actually work when plugged back in.

**Fix:** Always verify by substituting your answer back into the original equation.

## Mistake #4: Misreading Word Problems

"3 more than twice a number" is 2x + 3, not 2(x + 3).

**Fix:** Translate word problems phrase by phrase. Write down what each phrase means before combining.

## Mistake #5: Confusing Slope Formula

Getting (x₂ - x₁)/(y₂ - y₁) instead of (y₂ - y₁)/(x₂ - x₁).

**Fix:** Remember: slope is "rise over run" = change in y over change in x.

## Mistake #6: Arithmetic Errors Under Pressure

Simple calculation mistakes when rushing: 7 × 8 = 54 instead of 56.

**Fix:** Use the calculator for any arithmetic you're not 100% confident about.

## Practice With Feedback

Checking each answer as you go helps you catch these mistakes. Check out our [SAT Math prep guide](/sat-practice-questions/math) for more tips and practice, or explore the full [Digital SAT overview](/online-sat-prep) to build a complete study plan.`,
    sources: [CB_MATH],
  },
];
