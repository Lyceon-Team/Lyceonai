export type PdfStyleRef = {
  bucket: string;
  path: string;
  pageHint?: number | null;
};

export type GeneratedQuestionDraft = {
  draftId: string;
  section: "Math" | "Reading" | "Writing";
  skill: string; // e.g., "Linear equations"
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  inspiration: { questionIds?: string[]; notes?: string } | null;
  assets: {
    type: "diagram" | "table";
    latex?: string;
    svg?: string;
    imagePrompt?: string;
  }[];
};

export type CopyRisk = "low" | "medium" | "high";
export type StyleMatch = "good" | "ok" | "poor";
export type DifficultyMatch = "match" | "mismatch" | "unknown";

export type QaResult = {
  ok: boolean;
  foundCorrectAnswer: "A" | "B" | "C" | "D";
  issues: string[];
  correctedExplanation?: string;
  correctedDifficulty?: "easy" | "medium" | "hard";
  copyRisk: CopyRisk;
  styleMatch: StyleMatch;
  difficultyMatch: DifficultyMatch;
};

export type MathDomain = "Algebra" | "Advanced Math" | "Problem Solving & Data Analysis" | "Geometry & Trigonometry";
export type DifficultyLevel = "easy" | "medium" | "hard" | "unknown";

export type StylePageRef = {
  id: string;
  bucket: string;
  pdfPath: string;
  pageNumber: number;
  imagePath: string;
  domain?: MathDomain | null;
  difficulty?: DifficultyLevel | null;
  tagConfidence?: number | null;
};

export type StylePackProvenance = {
  stylePageIds: string[];
  styleDomainMixScore: number;
  styleTagConfidenceAvg: number | null;
};

export type V4JobRequest = {
  testCode: "SAT";
  targetCount: number;
  styleRefs: PdfStyleRef[];
};

export type V4JobRecord = {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  request: V4JobRequest;
  stats: {
    generated: number;
    qaPassed: number;
    qaFailed: number;
  };
  lastError?: string | null;
};
