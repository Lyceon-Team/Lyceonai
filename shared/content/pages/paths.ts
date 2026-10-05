/**
 * The URL of every content page, and nothing else.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C1] | @implemented [2026-10-05]
 *
 * plain English: the router mounts a route for each path here (client/src/App.tsx), and the
 * page's own chunk loads its content. Kept apart from the content so the app's main bundle,
 * which carries the router, does not also carry every page's copy. `./index.ts` throws at import
 * if this list and the pages' own `path` fields ever differ, in either direction, so the two
 * cannot drift; tests/ci/content-publish-gate.test.ts asserts the same.
 */
export const CONTENT_PAGE_PATHS = [
  "/sat-practice-questions",
  "/sat-practice-questions/math",
  "/sat-practice-questions/reading-and-writing",
  "/sat-practice-questions/math/algebra",
  "/sat-practice-questions/math/advanced-math",
  "/sat-practice-questions/math/problem-solving-and-data-analysis",
  "/sat-practice-questions/math/geometry-and-trigonometry",
  "/sat-practice-questions/reading-and-writing/information-and-ideas",
  "/sat-practice-questions/reading-and-writing/craft-and-structure",
  "/sat-practice-questions/reading-and-writing/expression-of-ideas",
  "/sat-practice-questions/reading-and-writing/standard-english-conventions",
  "/what-is-a-good-sat-score",
  "/what-is-a-good-sat-score/1100",
  "/what-is-a-good-sat-score/1200",
  "/what-is-a-good-sat-score/1300",
  "/what-is-a-good-sat-score/1400",
  "/what-is-a-good-sat-score/1500",
  "/free-sat-practice-test",
  "/online-sat-prep",
  "/how-to-study-for-the-sat",
  "/sat-tutor-cost",
  "/lyceon-vs-sat-tutor",
  "/is-sat-tutoring-worth-it",
] as const;
