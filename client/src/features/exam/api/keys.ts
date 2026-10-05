/**
 * TanStack Query keys for the exam surface (Coding Standards §11.2).
 * @implemented [2026-09-25]
 */
import type {
  ExamModule,
  ExamSection,
} from "@lyceon/shared/exam-runtime-schema";

export const examKeys = {
  all: ["exam"] as const,
  forms: () => ["exam", "forms"] as const,
  session: (sessionId: string) => ["exam", "session", sessionId] as const,
  items: (sessionId: string, section: ExamSection, module: ExamModule) =>
    ["exam", "session", sessionId, section, module, "items"] as const,
  workspace: (sessionId: string, section: ExamSection, module: ExamModule) =>
    ["exam", "session", sessionId, section, module, "workspace"] as const,
  /** UI-54: `GET /api/tests/sessions?state=scored` (score history, OQ-30). */
  scoredSessions: () => ["exam", "sessions", "scored"] as const,
  report: (sessionId: string) => ["exam", "report", sessionId] as const,
  reportStatus: (sessionId: string) =>
    ["exam", "report", sessionId, "status"] as const,
  guardianTests: (studentId: string) =>
    ["exam", "guardian", studentId, "tests"] as const,
  guardianReport: (studentId: string, sessionId: string) =>
    ["exam", "guardian", studentId, "report", sessionId] as const,
};
