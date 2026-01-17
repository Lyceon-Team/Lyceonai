/**
 * Stub QA Validator for this environment.
 *
 * The original implementation depended on @shared/schema and legacy
 * ingestion v2 wiring. For the current setup and Ingestion v3, we only
 * need a minimal implementation that satisfies imports and does not
 * crash the server.
 */

export interface ValidationIssueRecord {
  id: string;
  questionId: string;
  issueType: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: any;
}

export interface QAResult {
  questionId: string;
  status: 'skipped' | 'passed' | 'failed';
  issues: ValidationIssueRecord[];
}

export type LLMEngine = 'default' | 'vision-math';

export class QAValidator {
  constructor(config?: any) {
    console.log(
      '[QAValidator] Stub implementation loaded. QA validation is disabled in this environment.'
    );
  }

  /**
   * Stubbed validation method.
   * Returns a "skipped" result so callers can safely proceed.
   */
  async validateQuestion(question: any): Promise<QAResult> {
    return {
      questionId: question?.id ?? 'unknown',
      status: 'skipped',
      issues: [],
    };
  }

  /**
   * Optional batch validation method stub.
   */
  async validateQuestions(questions: any[]): Promise<QAResult[]> {
    return questions.map((q) => ({
      questionId: q?.id ?? 'unknown',
      status: 'skipped' as const,
      issues: [],
    }));
  }

  /**
   * Batch validation with job ID and pipeline.
   */
  async validateBatch(questions: any[], _jobId: string, _pipeline: 'default' | 'vision-math' = 'default'): Promise<{ questionId: string; status: string; issues: ValidationIssueRecord[] }[]> {
    return questions.map((q: any) => ({
      questionId: q?.id ?? 'unknown',
      status: 'APPROVED',
      issues: [],
    }));
  }
}
