export type ExamSectionScoreTable = {
  section: "rw" | "math";
  totalQuestions: number;
  scaledByRawCorrect: number[];
};

const RW_SCALED_BY_RAW_CORRECT = [
  200, 211, 222, 233, 244, 256, 267, 278, 289, 300, 311, 322, 333, 344, 356,
  367, 378, 389, 400, 411, 422, 433, 444, 456, 467, 478, 489, 500, 511, 522,
  533, 544, 556, 567, 578, 589, 600, 611, 622, 633, 644, 656, 667, 678, 689,
  700, 711, 722, 733, 744, 756, 767, 778, 789, 800,
] as const;

const MATH_SCALED_BY_RAW_CORRECT = [
  200, 214, 227, 241, 255, 268, 282, 295, 309, 323, 336, 350, 364, 377, 391,
  405, 418, 432, 445, 459, 473, 486, 500, 514, 527, 541, 555, 568, 582, 595,
  609, 623, 636, 650, 664, 677, 691, 705, 718, 732, 745, 759, 773, 786, 800,
] as const;

export const SECTION_SCORE_TABLES: Record<"rw" | "math", ExamSectionScoreTable> = {
  rw: {
    section: "rw",
    totalQuestions: 54,
    scaledByRawCorrect: [...RW_SCALED_BY_RAW_CORRECT],
  },
  math: {
    section: "math",
    totalQuestions: 44,
    scaledByRawCorrect: [...MATH_SCALED_BY_RAW_CORRECT],
  },
};

export function getModeledScaledScore(
  section: "rw" | "math",
  rawCorrect: number,
  totalQuestions: number
): number {
  const table = SECTION_SCORE_TABLES[section];
  if (!table) {
    throw new Error(`Missing modeled score table for section=${section}`);
  }
  if (table.totalQuestions !== totalQuestions) {
    throw new Error(
      `Missing modeled score table for section=${section}, totalQuestions=${totalQuestions}`
    );
  }
  if (!Number.isFinite(rawCorrect)) {
    return table.scaledByRawCorrect[0];
  }
  const boundedRaw = Math.max(0, Math.min(totalQuestions, Math.floor(rawCorrect)));
  return table.scaledByRawCorrect[boundedRaw];
}
