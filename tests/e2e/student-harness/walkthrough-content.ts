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
        "To solve for $x$, undo the operations on it in reverse order. The equation says that 5 more than twice $x$ equals 17, so first subtract 5 from both sides, which gives $2x = 12$. Then divide both sides by 2 to get $x = 6$. Check by substituting: $2(6) + 5 = 12 + 5 = 17$, which matches the right side. A value of 12 comes from stopping before the division, and 11 comes from adding 5 to both sides instead of subtracting it. Neither one makes the original equation true.",
    },
    {
      stem: "Which ordered pair $(x, y)$ satisfies both $x + y = 10$ and $x - y = 2$?",
      options: ["$(6, 4)$", "$(4, 6)$", "$(8, 2)$", "$(5, 5)$"],
      explanation:
        "Because the $y$-terms have opposite signs, adding the two equations eliminates $y$. The sum is $2x = 12$, so $x = 6$. Substitute $x = 6$ into $x + y = 10$ to get $y = 4$, giving the pair $(6, 4)$. Check it in the second equation: $6 - 4 = 2$, which is true. The pair $(4, 6)$ switches the coordinates, so it satisfies the first equation but gives $-2$ in the second. The pairs $(8, 2)$ and $(5, 5)$ each satisfy only the first equation.",
    },
    {
      stem: "What is the slope of the line $y = 4x - 9$?",
      options: ["4", "-9", "9", "-4"],
      explanation:
        "This equation is already in slope-intercept form, $y = mx + b$, where $m$ is the slope and $b$ is the $y$-intercept. Matching the parts, $m = 4$ and $b = -9$, so the slope is 4. The slope tells you that each time $x$ increases by 1, $y$ increases by 4. A common mistake is to pick $-9$, which is the $y$-intercept: the point where the line crosses the $y$-axis. The values 9 and $-4$ change a sign and do not match either part of the equation.",
    },
  ],
  "Advanced Math": [
    {
      stem: "If $f(x) = x^2 + 1$, what is the value of $f(3)$?",
      options: ["10", "7", "9", "16"],
      explanation:
        "The notation $f(3)$ means the output of the function when the input is 3. Replace every $x$ in the rule with 3: $f(3) = 3^2 + 1$. Following the order of operations, square first, so $3^2 = 9$, and then add 1 to get 10. A result of 7 comes from computing $3 \\cdot 2 + 1$, which treats the exponent as multiplication by 2. A result of 9 forgets to add the 1, and 16 comes from squaring after adding, that is, $(3 + 1)^2$.",
    },
    {
      stem: "Which expression is equivalent to $(x + 3)(x - 3)$?",
      options: ["$x^2 - 9$", "$x^2 + 9$", "$x^2 - 6x - 9$", "$x^2 + 6x - 9$"],
      explanation:
        "Multiply each term of the first factor by each term of the second: $x \\cdot x = x^2$, $x \\cdot (-3) = -3x$, $3 \\cdot x = 3x$, and $3 \\cdot (-3) = -9$. The middle terms, $-3x$ and $3x$, add to zero, leaving $x^2 - 9$. This is the difference of squares pattern, $(a + b)(a - b) = a^2 - b^2$, with $a = x$ and $b = 3$. $x^2 + 9$ has the wrong sign on the constant, and the two expressions with a $6x$ term come from adding the middle terms instead of letting them cancel.",
    },
  ],
  "Problem Solving and Data Analysis": [
    {
      stem: "A store sells pencils at 3 for 75 cents. At this rate, how many cents do 12 pencils cost?",
      options: ["300", "225", "250", "900"],
      explanation:
        "Start by finding the cost of one pencil. If 3 pencils cost 75 cents, one pencil costs $75 \\div 3 = 25$ cents. Then 12 pencils cost $12 \\times 25 = 300$ cents. You can also see it as a ratio: 12 pencils is 4 groups of 3, so the cost is $4 \\times 75 = 300$ cents. A total of 900 comes from multiplying 75 by 12, which treats 75 cents as the price of one pencil. The values 225 and 250 do not follow from the given rate.",
    },
    {
      stem: "A class of 25 students took a survey, and 40% of them chose soccer as their favorite sport. How many students chose soccer?",
      options: ["10", "15", "40", "4"],
      explanation:
        "To find a percent of a number, write the percent as a decimal and multiply. Forty percent is $0.40$, so the number of students is $0.40 \\times 25 = 10$. Another way: 10% of 25 is 2.5, and 40% is four times that, or 10. Check that the answer makes sense: 10 out of 25 is $\\frac{10}{25} = \\frac{2}{5}$, which is 40%. The value 40 repeats the percent instead of applying it, 4 divides 40 by 10, and 15 is the number of students who did not choose soccer.",
    },
  ],
  "Geometry and Trigonometry": [
    {
      stem: "A rectangle has a length of 9 and a width of 4. What is the area of the rectangle?",
      options: ["36", "26", "13", "18"],
      explanation:
        "The area of a rectangle is the number of unit squares that fit inside it, found by multiplying length by width. Here the area is $9 \\times 4 = 36$ square units. You can picture it as 4 rows of 9 squares each. The value 26 is the perimeter, $2(9 + 4)$, which measures the distance around the rectangle rather than the space inside it. The value 13 is just the sum of the length and width, and 18 is half the area, which would come from using the formula for a triangle instead.",
    },
    {
      stem: "In a right triangle, the two legs have lengths 6 and 8. What is the length of the hypotenuse?",
      options: ["10", "14", "48", "7"],
      explanation:
        "In a right triangle, the Pythagorean theorem relates the legs $a$ and $b$ to the hypotenuse $c$: $a^2 + b^2 = c^2$. Substituting the legs gives $6^2 + 8^2 = 36 + 64 = 100$, so $c^2 = 100$ and $c = 10$. This is a multiple of the familiar 3-4-5 right triangle, with every side doubled. The value 14 adds the legs without squaring them, 48 is their product, and 7 is their average. The hypotenuse must also be longer than either leg, which rules out 7.",
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
        "The text describes a pattern beekeepers noticed and then a study that tested it. In the study, bees trained to visit a feeder at 10 a.m. kept arriving at that hour even on days when the feeder was empty. Because food was not there to attract them, the text concludes that the bees were keeping track of the time of day. The best statement of the main idea is therefore that honeybees appear to keep track of time when visiting food sources. The claim that bees visit only when food is present contradicts the study's result. Training bees to avoid flowers and disagreement among researchers are never mentioned, so neither can be the main idea.",
    },
  ],
  "Craft and Structure": [
    {
      passage:
        "The town's new library was designed to be flexible. Its shelves sit on wheels, its walls fold away, and its reading rooms can become a lecture hall in an afternoon.",
      stem: "As used in the text, what does the word “flexible” most nearly mean?",
      options: ["adaptable", "fragile", "temporary", "expensive"],
      explanation:
        "To find a word's meaning in context, look at how the rest of the text develops it. The first sentence says the library was designed to be flexible, and the second sentence explains what that means with three examples: shelves that sit on wheels, walls that fold away, and reading rooms that can become a lecture hall in an afternoon. Each example shows the building changing to serve a different purpose, so “flexible” most nearly means adaptable. Nothing in the text suggests the building breaks easily, so fragile does not fit. Temporary and expensive describe how long something lasts and what it costs, ideas the text never raises.",
    },
  ],
  "Standard English Conventions": [
    {
      passage:
        "Each summer, volunteers count the monarch butterflies that pass through the valley. Last year, the volunteers ______ more than four thousand of them in a single week.",
      stem: "Which choice completes the text so that it conforms to the conventions of Standard English?",
      options: ["counted", "counts", "will count", "are counting"],
      explanation:
        "The blank needs a verb whose tense fits the time the sentence describes. The phrase “last year” places the action firmly in the past, and the sentence reports something that was completed: volunteers counting more than four thousand butterflies in a single week. A simple past tense verb, “counted,” is the only form that matches that time frame. “Counts” is present tense and describes something that happens regularly now. “Will count” points to the future, and “are counting” describes an action still in progress. Each of those would clash with “last year” and leave the sentence inconsistent in time, so only the past tense works here.",
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
        "To choose a transition, decide how the second sentence relates to the first. The first sentence says solar panels produce the most power on clear days. The second says that on cloudy days they still generate electricity, just less of it. That is a contrast: the second sentence qualifies the first by pointing out what happens under less favorable conditions. “However” is the transition that signals contrast, so it is the most logical choice. “Therefore” would present the second sentence as a result of the first, “similarly” would suggest the two ideas are alike, and “for example” would introduce an illustration of the first claim. None of these fit.",
    },
  ],
};

/** Grid-in items; the fixture accepts exactly "1". */
export const WALKTHROUGH_GRID_IN: readonly WalkthroughGridIn[] = [
  {
    stem: "If $5x - 4 = 1$, what is the value of $x$?",
    explanation:
      "Isolate $x$ by undoing the operations on it in reverse order. The equation says that 4 less than five times $x$ equals 1. First add 4 to both sides, which gives $5x = 5$. Then divide both sides by 5 to get $x = 1$. Check by substituting: $5(1) - 4 = 5 - 4 = 1$, which matches the right side. A common slip is to subtract 4 instead of adding it, which gives $5x = -3$ and a value that does not satisfy the original equation.",
  },
  {
    stem: "A line in the $xy$-plane passes through $(0, -3)$ and $(2, -1)$. What is the slope of the line?",
    explanation:
      "Slope measures how much $y$ changes for each unit change in $x$, so divide the change in $y$ by the change in $x$. Using the two points, the change in $y$ is $-1 - (-3) = 2$, and the change in $x$ is $2 - 0 = 2$. The slope is $\\frac{2}{2} = 1$. Notice that subtracting a negative number turns into addition, which is where sign errors usually happen. You can check by starting at $(0, -3)$: moving 2 units right and 2 units up lands on $(2, -1)$.",
  },
];
