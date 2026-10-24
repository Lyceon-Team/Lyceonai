/**
 * Blog post: SAT math formulas (batch 2026-W44, Wednesday 2026-10-28).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-21]
 *
 * plain English: what Bluebook's Math reference sheet lists (read from College Board's Bluebook
 * directions), and the formulas it leaves out that the Math section's published skill list
 * calls for, 10 days before the Nov 7 test. Every SAT fact is College Board's; the formulas
 * themselves are standard mathematics. No Lyceon claim.
 */
import {
  CB_ASSESSMENT_FRAMEWORK,
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_BLUEBOOK_TEST_DIRECTIONS,
  CB_BLUEBOOK_TOOLS,
  CB_CALCULATOR,
  CB_SAT_DATES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-math-formulas",
  category: "Math",
  tags: ["sat-math", "formulas"],
  batch: "2026-W44",
  publishAt: "2026-10-28T07:00",
  targetKeyword: "sat math formulas",
  page: {
    title: "SAT Math Formulas: What You Get and What to Know | Lyceon",
    description:
      "Bluebook gives you a reference sheet on every Math question, but it covers geometry only. See what's on it and which formulas you should know yourself.",
    h1: "SAT Math Formulas: What You Get and What to Know",
    intro: [
      {
        type: "p",
        text: "The SAT is on Saturday, November 7, ten days away. On the Math section, Bluebook gives you a reference sheet of common formulas. It helps to see what's on it before test day.",
        sources: [CB_SAT_DATES, CB_BLUEBOOK_TOOLS],
      },
    ],
    sections: [
      {
        heading: "The reference sheet",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board's Bluebook directions say you can open the reference sheet, the calculator and the directions at any point in the Math section. The sheet lists:",
            sources: [CB_BLUEBOOK_TEST_DIRECTIONS],
          },
          {
            type: "ul",
            items: [
              "Circle: area A = πr² and circumference C = 2πr.",
              "Rectangle: area is length times width.",
              "Triangle: area A = ½bh, and the Pythagorean theorem c² = a² + b².",
              "Special right triangles: the sides of a 30-60-90 triangle are x, x√3 and 2x, and the sides of a 45-45-90 triangle are s, s and s√2.",
              "Volume: a rectangular prism is length times width times height. A cylinder is πr²h, a sphere is (4/3)πr³, a cone is (1/3)πr²h, and a rectangular pyramid is one third of length times width times height.",
              "Angles: a circle has 360 degrees of arc, which is 2π radians. The angles of a triangle add up to 180 degrees.",
            ],
            sources: [CB_BLUEBOOK_TEST_DIRECTIONS],
          },
          {
            type: "p",
            text: "The whole sheet covers geometry. You don't have to memorize it, but it helps to look it over before test day so you know what's on it and what isn't.",
            sources: [CB_BLUEBOOK_TEST_DIRECTIONS],
          },
        ],
      },
      {
        heading: "Formulas the sheet leaves out",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board's published skill list for the Math section includes linear equations, quadratic and exponential equations, right triangle and unit circle trigonometry, and writing the equation of a circle. The reference sheet has no formula for any of them. These are the ones to know by heart:",
            sources: [CB_ASSESSMENT_FRAMEWORK, CB_BLUEBOOK_TEST_DIRECTIONS],
          },
          {
            type: "ul",
            items: [
              "Slope between two points: m = (y₂ − y₁) / (x₂ − x₁).",
              "Slope-intercept form of a line: y = m·x + b, where m is the slope and b is the y-intercept.",
              "Quadratic formula: for ax² + bx + c = 0, x = (−b ± √(b² − 4ac)) / 2a.",
              "Vertex form of a quadratic: y = a(x − h)² + k, with its vertex at (h, k).",
              "Sine in a right triangle: opposite over hypotenuse.",
              "Cosine: adjacent over hypotenuse.",
              "Tangent: opposite over adjacent.",
              "Equation of a circle with center (h, k) and radius r: (x − h)² + (y − k)² = r².",
              "Mean: the sum of the values divided by how many there are.",
            ],
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
        ],
      },
      {
        heading: "Use the calculator too",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The built-in Desmos calculator is available for the whole Math section, and you can switch between scientific and graphing. Graphing an equation can show you its intercepts and vertex, which is a way to check a formula you are unsure about.",
            sources: [CB_ASSESSMENT_FRAMEWORK, CB_CALCULATOR],
          },
        ],
      },
      {
        heading: "How to use these ten days",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Open a Bluebook practice test and find the reference sheet before you start, so it isn't new on test day. Then, for each Math question you miss, ask whether a formula was the problem. If it was, add that formula to a short list and review the list each day.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_BLUEBOOK_TOOLS],
          },
          {
            type: "links",
            items: [
              {
                label: "SAT Math practice questions",
                href: "/sat-practice-questions/math",
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
    faq: [
      {
        question: "Does the digital SAT give you a formula sheet?",
        answer:
          "Yes. Bluebook has a reference sheet of common formulas that you can open at any point in the Math section. It lists geometry formulas and a few facts about circles and triangles.",
        sources: [CB_BLUEBOOK_TOOLS, CB_BLUEBOOK_TEST_DIRECTIONS],
      },
      {
        question: "Which formulas should I memorize for the SAT?",
        answer:
          "Start with the ones the reference sheet doesn't list: slope, the equation of a line, the quadratic formula, vertex form, right-triangle ratios and the equation of a circle.",
        sources: [CB_ASSESSMENT_FRAMEWORK, CB_BLUEBOOK_TEST_DIRECTIONS],
      },
    ],
  },
};

export default post;
