// Mount shim only: runtime question/review queue ownership lives in apps/api/src/routes/questions.ts.
export {
  getQuestions,
  getRandomQuestions,
  getQuestionCount,
  getQuestionStats,
  getQuestionsFeed,
  getRecentQuestions,
  getQuestionById,
  getReviewErrors,
  submitQuestionFeedback,
} from "../../../apps/api/src/routes/questions";
