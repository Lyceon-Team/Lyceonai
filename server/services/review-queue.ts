import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { isValidCanonicalId } from "../../shared/question-bank-contract";

export type ReviewOrigin = "practice" | "full_test";
export type ReviewOutcome = "correct" | "incorrect" | "skipped";

export type ReviewQueueSnapshot = {
  attemptId: string;
  questionId: string;
  questionCanonicalId: string | null;
  attemptedAt: string | null;
  isCorrect: boolean;
  outcome: ReviewOutcome;
  source: ReviewOrigin;
  questionText: string;
  section: string;
  difficulty: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
};

export type ReviewQueueBuildResult = {
  latestSnapshots: ReviewQueueSnapshot[];
  unresolvedQueue: ReviewQueueSnapshot[];
  latestAttemptAt: string | null;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
};

function normalizeOutcome(attempt: { outcome?: string | null; is_correct?: boolean | null }): ReviewOutcome {
  const rawOutcome = String(attempt.outcome ?? "").toLowerCase();
  if (rawOutcome === "skipped") return "skipped";
  if (rawOutcome === "incorrect") return "incorrect";
  if (rawOutcome === "correct") return "correct";
  return attempt.is_correct ? "correct" : "incorrect";
}

function toEpoch(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareReviewSnapshots(a: ReviewQueueSnapshot, b: ReviewQueueSnapshot): number {
  const timeDiff = toEpoch(b.attemptedAt) - toEpoch(a.attemptedAt);
  if (timeDiff !== 0) return timeDiff;

  if (a.source !== b.source) {
    return a.source === "full_test" ? -1 : 1;
  }

  if (a.questionId !== b.questionId) {
    return a.questionId.localeCompare(b.questionId);
  }

  return a.attemptId.localeCompare(b.attemptId);
}

function resolveCanonicalQuestionId(rawCanonicalId: unknown, rawQuestionId: unknown): string | null {
  const canonicalId = typeof rawCanonicalId === "string" ? rawCanonicalId.trim() : "";
  if (isValidCanonicalId(canonicalId)) {
    return canonicalId;
  }

  const questionId = typeof rawQuestionId === "string" ? rawQuestionId.trim() : "";
  if (isValidCanonicalId(questionId)) {
    return questionId;
  }

  return null;
}

function snapshotRecoveryKeys(snapshot: ReviewQueueSnapshot): string[] {
  const keys: string[] = [];
  if (snapshot.questionId) keys.push(snapshot.questionId);
  if (snapshot.questionCanonicalId && snapshot.questionCanonicalId !== snapshot.questionId) {
    keys.push(snapshot.questionCanonicalId);
  }
  return keys;
}

export async function buildReviewQueueForStudent(userId: string): Promise<ReviewQueueBuildResult> {
  const [practiceAttemptsResult, fullLengthResponseResult] = await Promise.all([
    supabaseServer
      .from("answer_attempts")
      .select("id, question_id, is_correct, outcome, attempted_at, questions(id, canonical_id, stem, section, difficulty, domain, skill, subskill)")
      .eq("user_id", userId)
      .order("attempted_at", { ascending: false })
      .limit(2000),
    supabaseServer
      .from("full_length_exam_responses")
      .select("id, question_id, is_correct, answered_at, full_length_exam_sessions!inner(user_id, status)")
      .eq("full_length_exam_sessions.user_id", userId)
      .eq("full_length_exam_sessions.status", "completed")
      .order("answered_at", { ascending: false })
      .limit(2000),
  ]);

  if (practiceAttemptsResult.error) {
    throw new Error(`review_queue_practice_fetch_failed:${practiceAttemptsResult.error.message}`);
  }

  if (fullLengthResponseResult.error) {
    throw new Error(`review_queue_full_test_fetch_failed:${fullLengthResponseResult.error.message}`);
  }

  const practiceRows = practiceAttemptsResult.data ?? [];
  const fullLengthRows = (fullLengthResponseResult.data ?? []) as Array<{
    id: string;
    question_id: string;
    is_correct: boolean | null;
    answered_at: string | null;
  }>;

  const fullLengthQuestionIds = Array.from(new Set(fullLengthRows.map((row) => String(row.question_id ?? "")).filter(Boolean)));
  const fullLengthQuestionMap = new Map<string, {
    id: string;
    canonical_id: string | null;
    stem: string | null;
    section: string | null;
    difficulty: string | null;
    domain: string | null;
    skill: string | null;
    subskill: string | null;
  }>();

  if (fullLengthQuestionIds.length > 0) {
    const { data: fullLengthQuestions, error: fullLengthQuestionError } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, stem, section, difficulty, domain, skill, subskill")
      .in("id", fullLengthQuestionIds);

    if (fullLengthQuestionError) {
      throw new Error(`review_queue_full_test_question_fetch_failed:${fullLengthQuestionError.message}`);
    }

    for (const question of fullLengthQuestions ?? []) {
      fullLengthQuestionMap.set(String((question as any).id), {
        id: String((question as any).id),
        canonical_id: typeof (question as any).canonical_id === "string" ? (question as any).canonical_id : null,
        stem: typeof (question as any).stem === "string" ? (question as any).stem : null,
        section: typeof (question as any).section === "string" ? (question as any).section : null,
        difficulty: typeof (question as any).difficulty === "string" ? (question as any).difficulty : null,
        domain: typeof (question as any).domain === "string" ? (question as any).domain : null,
        skill: typeof (question as any).skill === "string" ? (question as any).skill : null,
        subskill: typeof (question as any).subskill === "string" ? (question as any).subskill : null,
      });
    }
  }

  const combinedSnapshots: ReviewQueueSnapshot[] = [];

  for (const row of practiceRows) {
    const question = (row as any).questions as {
      id?: string | null;
      canonical_id?: string | null;
      stem?: string | null;
      section?: string | null;
      difficulty?: string | null;
      domain?: string | null;
      skill?: string | null;
      subskill?: string | null;
    } | null;
    const outcome = normalizeOutcome(row as any);
    const questionId = String((row as any).question_id ?? "");

    combinedSnapshots.push({
      attemptId: String((row as any).id),
      questionId,
      questionCanonicalId: resolveCanonicalQuestionId(question?.canonical_id, questionId),
      attemptedAt: (row as any).attempted_at ?? null,
      isCorrect: outcome === "correct",
      outcome,
      source: "practice",
      questionText: (question?.stem ?? "Question text unavailable").slice(0, 200),
      section: question?.section ?? "Unknown",
      difficulty: question?.difficulty ?? null,
      domain: question?.domain ?? null,
      skill: question?.skill ?? null,
      subskill: question?.subskill ?? null,
    });
  }

  for (const row of fullLengthRows) {
    const questionId = String(row.question_id ?? "");
    if (!questionId) continue;

    const question = fullLengthQuestionMap.get(questionId);
    const isCorrect = Boolean(row.is_correct);
    const outcome: ReviewOutcome = isCorrect ? "correct" : "incorrect";

    combinedSnapshots.push({
      attemptId: "full-test:" + String(row.id),
      questionId,
      questionCanonicalId: resolveCanonicalQuestionId(question?.canonical_id, questionId),
      attemptedAt: row.answered_at ?? null,
      isCorrect,
      outcome,
      source: "full_test",
      questionText: (question?.stem ?? "Question text unavailable").slice(0, 200),
      section: question?.section ?? "Unknown",
      difficulty: question?.difficulty ?? null,
      domain: question?.domain ?? null,
      skill: question?.skill ?? null,
      subskill: question?.subskill ?? null,
    });
  }

  if (combinedSnapshots.length === 0) {
    return {
      latestSnapshots: [],
      unresolvedQueue: [],
      latestAttemptAt: null,
      correctCount: 0,
      incorrectCount: 0,
      skippedCount: 0,
    };
  }

  const latestByQuestion = new Map<string, ReviewQueueSnapshot>();
  for (const snapshot of combinedSnapshots) {
    const dedupeKey = snapshot.questionCanonicalId ?? snapshot.questionId;
    if (!dedupeKey) continue;
    const existing = latestByQuestion.get(dedupeKey);
    if (!existing) {
      latestByQuestion.set(dedupeKey, snapshot);
      continue;
    }
    if (compareReviewSnapshots(snapshot, existing) < 0) {
      latestByQuestion.set(dedupeKey, snapshot);
    }
  }

  const latestSnapshots = Array.from(latestByQuestion.values());
  const unresolvedCandidates = latestSnapshots.filter((snapshot) => snapshot.outcome !== "correct");
  const unresolvedRecoveryKeys = Array.from(
    new Set(
      unresolvedCandidates.flatMap(snapshotRecoveryKeys).filter((value) => typeof value === "string" && value.length > 0)
    )
  );

  const latestRecoveredByKey = new Map<string, boolean>();
  if (unresolvedRecoveryKeys.length > 0) {
    const { data: reviewAttempts, error: reviewAttemptError } = await supabaseServer
      .from("review_error_attempts")
      .select("question_id, is_correct, created_at")
      .eq("student_id", userId)
      .in("question_id", unresolvedRecoveryKeys)
      .order("created_at", { ascending: false });

    if (reviewAttemptError) {
      throw new Error(`review_queue_recovery_fetch_failed:${reviewAttemptError.message}`);
    }

    for (const row of reviewAttempts ?? []) {
      const recoveryKey = String((row as any).question_id ?? "");
      if (!recoveryKey || latestRecoveredByKey.has(recoveryKey)) continue;
      latestRecoveredByKey.set(recoveryKey, Boolean((row as any).is_correct));
    }
  }

  const unresolvedQueue = unresolvedCandidates
    .filter((snapshot) => {
      const keys = snapshotRecoveryKeys(snapshot);
      return !keys.some((key) => latestRecoveredByKey.get(key) === true);
    })
    .sort(compareReviewSnapshots);

  const sortedLatestSnapshots = [...latestSnapshots].sort(compareReviewSnapshots);
  const latestAttemptAt = sortedLatestSnapshots.length > 0 ? sortedLatestSnapshots[0].attemptedAt : null;
  const correctCount = latestSnapshots.filter((snapshot) => snapshot.outcome === "correct").length;
  const incorrectCount = latestSnapshots.filter((snapshot) => snapshot.outcome === "incorrect").length;
  const skippedCount = latestSnapshots.filter((snapshot) => snapshot.outcome === "skipped").length;

  return {
    latestSnapshots,
    unresolvedQueue,
    latestAttemptAt,
    correctCount,
    incorrectCount,
    skippedCount,
  };
}
