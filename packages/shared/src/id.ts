export const canonicalId = (docSlug: string, page: number, index: number) =>
  `${docSlug}_p${page}_q${index}`;

// Helper to create document slug from filename
export const createDocSlug = (filename: string): string => {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .toLowerCase()
    .substring(0, 50); // Limit length
};

// Helper to extract page and question index from processing context
export const extractQuestionIndex = (
  questions: any[], 
  currentQuestion: any
): number => {
  return questions.findIndex(q => 
    q.questionId === currentQuestion.questionId || 
    q.rawId === currentQuestion.rawId
  ) + 1; // 1-based indexing
};