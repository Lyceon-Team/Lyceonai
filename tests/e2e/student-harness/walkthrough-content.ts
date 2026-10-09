/**
 * Questions written for the homepage walkthrough video, put into the harness bank on request.
 *
 * @spec [Lyceon_Doc_10A_V1 §6 (homepage "see how it works" walkthrough), §8.4 (faceless video); owner
 *       decisions 2026-10-09 on the walkthrough video, item 8 ("original, written-for-the-video
 *       SAT-style questions with real explanations, never bank items")] | @implemented [2026-10-09]
 *
 * plain English: with `STUDENT_HARNESS_WALKTHROUGH=1`, db.ts rewrites every question in the
 * throwaway harness database (the CI form fixture's synthetic rows, whose explanations read
 * "exg fixture") with the items below, chosen by the row's own domain so a domain label on screen
 * matches its question. Every item here was written for this video; none is taken from the
 * question bank (`content/canonical/`) or any seed. The fixture keys every multiple-choice row
 * to "A" and every grid-in to "1", so each item's correct option is listed first (the runner
 * shows options in its own stored order) and each grid-in's answer is 1. Explanations never
 * name a choice letter, because the order on screen differs from the stored one.
 */
export type WalkthroughMcq = {
  passage?: string;
  stem: string;
  /** Four options; the FIRST is correct (stored as key A). */
  options: readonly [string, string, string, string];
  explanation: string;
};

export type WalkthroughGridIn = { stem: string; explanation: string };

export const WALKTHROUGH_MCQ: Readonly<
  Record<string, readonly WalkthroughMcq[]>
> = {
  Algebra: [
    {
      stem: "If $2x + 5 = 17$, what is the value of $x$?",
      options: ["6", "11", "7", "12"],
      explanation:
        "Subtract 5 from both sides to get $2x = 12$. Then divide both sides by 2: $x = 6$.",
    },
    {
      stem: "Which ordered pair $(x, y)$ satisfies both $x + y = 10$ and $x - y = 2$?",
      options: ["$(6, 4)$", "$(4, 6)$", "$(8, 2)$", "$(5, 5)$"],
      explanation:
        "Adding the two equations gives $2x = 12$, so $x = 6$. Substituting $x = 6$ into $x + y = 10$ gives $y = 4$.",
    },
    {
      stem: "What is the slope of the line $y = 4x - 9$?",
      options: ["4", "-9", "9", "-4"],
      explanation:
        "In slope-intercept form, $y = mx + b$, the slope is $m$. Here $m = 4$, so the slope is 4.",
    },
  ],
  "Advanced Math": [
    {
      stem: "If $f(x) = x^2 + 1$, what is the value of $f(3)$?",
      options: ["10", "7", "9", "16"],
      explanation: "Substitute 3 for $x$: $f(3) = 3^2 + 1 = 9 + 1 = 10$.",
    },
    {
      stem: "Which expression is equivalent to $(x + 3)(x - 3)$?",
      options: ["$x^2 - 9$", "$x^2 + 9$", "$x^2 - 6x - 9$", "$x^2 + 6x - 9$"],
      explanation:
        "Multiply each term: $x \\cdot x - 3x + 3x - 9 = x^2 - 9$. The middle terms cancel.",
    },
  ],
  "Problem Solving and Data Analysis": [
    {
      stem: "A store sells pencils at 3 for 75 cents. At this rate, how many cents do 12 pencils cost?",
      options: ["300", "225", "250", "900"],
      explanation:
        "One pencil costs $75 \\div 3 = 25$ cents, so 12 pencils cost $12 \\times 25 = 300$ cents.",
    },
    {
      stem: "A class of 25 students took a survey, and 40% of them chose soccer as their favorite sport. How many students chose soccer?",
      options: ["10", "15", "40", "4"],
      explanation:
        "40% of 25 is $0.40 \\times 25 = 10$, so 10 students chose soccer.",
    },
  ],
  "Geometry and Trigonometry": [
    {
      stem: "A rectangle has a length of 9 and a width of 4. What is the area of the rectangle?",
      options: ["36", "26", "13", "18"],
      explanation:
        "The area of a rectangle is length times width: $9 \\times 4 = 36$.",
    },
    {
      stem: "In a right triangle, the two legs have lengths 6 and 8. What is the length of the hypotenuse?",
      options: ["10", "14", "48", "7"],
      explanation:
        "By the Pythagorean theorem, $c^2 = 6^2 + 8^2 = 36 + 64 = 100$, so $c = 10$.",
    },
  ],
  "Information and Ideas": [
    {
      passage:
        "Beekeepers have long noticed that honeybees return to the same flowers at about the same time each day. In one study, bees trained to visit a feeder at 10 a.m. kept arriving at that hour even on days when the feeder was empty, which suggests that the insects keep track of the time of day rather than simply responding to the presence of food.",
      stem: "Which choice best states the main idea of the text?",
      options: [
        "Honeybees appear to keep track of time when visiting food sources.",
        "Honeybees visit a feeder only on days when it contains food.",
        "Beekeepers can train bees to avoid certain flowers.",
        "Researchers disagree about how honeybees find food.",
      ],
      explanation:
        "The study found that bees arrived at the usual hour even when the feeder was empty, so the text's main point is that bees seem to track the time of day. The other options either contradict the study or describe things the text never mentions.",
    },
  ],
  "Craft and Structure": [
    {
      passage:
        "The town's new library was designed to be flexible. Its shelves sit on wheels, its walls fold away, and its reading rooms can become a lecture hall in an afternoon.",
      stem: "As used in the text, what does the word “flexible” most nearly mean?",
      options: ["adaptable", "fragile", "temporary", "expensive"],
      explanation:
        "The details that follow (movable shelves, folding walls, rooms that change use) describe a building that can be changed to suit different needs, so “flexible” means adaptable.",
    },
  ],
  "Standard English Conventions": [
    {
      passage:
        "Each summer, volunteers count the monarch butterflies that pass through the valley. Last year, the volunteers ______ more than four thousand of them in a single week.",
      stem: "Which choice completes the text so that it conforms to the conventions of Standard English?",
      options: ["counted", "counts", "will count", "are counting"],
      explanation:
        "The sentence describes something that happened “last year,” so it needs a past-tense verb: “counted.”",
    },
  ],
  "Expression of Ideas": [
    {
      passage:
        "Solar panels produce the most power on clear days. ______ cloudy days, they still generate electricity, just less of it.",
      stem: "Which choice completes the text with the most logical transition?",
      options: [
        "However, on",
        "Therefore, on",
        "Similarly, on",
        "For example, on",
      ],
      explanation:
        "The second sentence contrasts with the first: the panels do best on clear days, yet they still produce some power on cloudy ones. \u201cHowever\u201d signals that contrast; the other transitions signal a result, a similarity or an example.",
    },
  ],
};

/** Grid-in items; the fixture accepts exactly "1". */
export const WALKTHROUGH_GRID_IN: readonly WalkthroughGridIn[] = [
  {
    stem: "If $5x - 4 = 1$, what is the value of $x$?",
    explanation:
      "Add 4 to both sides to get $5x = 5$, then divide both sides by 5: $x = 1$.",
  },
  {
    stem: "A line in the $xy$-plane passes through $(0, -3)$ and $(2, -1)$. What is the slope of the line?",
    explanation:
      "Slope is the change in $y$ over the change in $x$: $\\frac{-1 - (-3)}{2 - 0} = \\frac{2}{2} = 1$.",
  },
];
