/**
 * RAG v2 Types
 */

import { z } from "zod";

export type RagMode = "question" | "concept" | "strategy";

export interface Competency {
  code: string;
  raw?: string | null;
}

export interface CompetencyProgress {
  correct?: number;
  incorrect?: number;
  total?: number;
  masteryLevel?: number;
}

export interface RecentQuestion {
  canonicalId: string;
  correct: boolean;
  timestamp?: Date;
}

export interface StudentProfile {
  userId: string;
  overallLevel?: number;
  competencyMap?: Record<string, CompetencyProgress>;
  recentQuestions?: RecentQuestion[];
  primaryStyle?: "step-by-step" | "conceptual" | "example-driven" | "socratic";
  secondaryStyle?: "step-by-step" | "conceptual" | "example-driven" | "socratic";
  explanationLevel?: 1 | 2 | 3;
  personaTags?: string[];
}

export interface QuestionContext {
  canonicalId: string;
  testCode: string;
  sectionCode: "MATH" | "RW";
  sourceType: 0 | 1 | 2 | 3;
  stem: string;
  options: Array<{ key: "A" | "B" | "C" | "D"; text: string }>;
  correctAnswer: "A" | "B" | "C" | "D" | null;
  explanation: string | null;
  competencies: Competency[];
  difficulty: 1 | 2 | 3 | null;
  tags: unknown | null;
}

export interface CompetencyContext {
  studentWeakAreas: string[];
  studentStrongAreas: string[];
  competencyLabels: string[];
}

export interface RagContext {
  primaryQuestion: QuestionContext | null;
  supportingQuestions: QuestionContext[];
  competencyContext: CompetencyContext;
  studentProfile: StudentProfile | null;
}

export interface RagQueryRequest {
  userId: string;
  message: string;
  mode: RagMode;
  canonicalQuestionId?: string;
  testCode?: string;
  sectionCode?: string;
  studentProfile?: StudentProfile;
  topK?: number;
}

export interface RagQueryResponse {
  context: RagContext;
  metadata: {
    canonicalIdsUsed: string[];
    mode: RagMode;
    processingTimeMs?: number;
  };
}

export const RagModeSchema = z.enum(["question", "concept", "strategy"]);

export const RagQueryRequestSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1).max(2000),
  mode: RagModeSchema,
  canonicalQuestionId: z.string().optional(),
  testCode: z.string().optional(),
  sectionCode: z.string().optional(),
  studentProfile: z
    .object({
      userId: z.string(),
      overallLevel: z.number().min(1).max(5).optional(),
      competencyMap: z
        .record(
          z.object({
            correct: z.number(),
            incorrect: z.number(),
            total: z.number(),
            masteryLevel: z.number().optional(),
          }),
        )
        .optional(),
      recentQuestions: z
        .array(
          z.object({
            canonicalId: z.string(),
            correct: z.boolean(),
            timestamp: z.date().optional(),
          }),
        )
        .optional(),
      primaryStyle: z.enum(["step-by-step", "conceptual", "example-driven", "socratic"]).optional(),
      secondaryStyle: z.enum(["step-by-step", "conceptual", "example-driven", "socratic"]).optional(),
      explanationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      personaTags: z.array(z.string()).optional(),
    })
    .optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

export type ValidatedRagQueryRequest = z.infer<typeof RagQueryRequestSchema>;
