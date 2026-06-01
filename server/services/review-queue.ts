import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { isValidCanonicalId } from "../../shared/question-bank-contract";

export type ReviewOrigin = "practice" | "full_test";
export type ReviewOutcome = "correct" | "incorrect" | "skipped";
export type ReviewQueueMode = "all_past_mistakes" | "by_practice_session" | "by_full_length_session";

export type ReviewQueueOptions = {
  mode?: ReviewQueueMode;
  practiceSessionId?: string | null;
  fullLengthSessionId?: string | null;
};

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
  questionOptions: unknown;
  questionCorrectAnswer: string | null;
  questionExplanation: string | null;
  questionExam: string | null;
  questionStructureClusterId: string | null;
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

function resolveCanonicalQuestionId(rawCanonicalId: unknown): string | null {
  const canonicalId = typeof rawCanonicalId === "string" ? rawCanonicalId.trim() : "";
  if (isValidCanonicalId(canonicalId)) {
    return canonicalId;
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

export async function buildReviewQueueForStudent(userId: string, options: ReviewQueueOptions = {}): Promise<ReviewQueueBuildResult> {
  const mode: ReviewQueueMode = options.mode ?? "all_past_mistakes";
  const practiceSessionId = options.practiceSessionId ?? null;
  const fullLengthSessionId = options.fullLengthSessionId ?? null;

  if (mode === "by_practice_session" && !practiceSessionId) {
    throw new Error("review_queue_missing_practice_session_id");
  }

  if (mode === "by_full_length_session" && !fullLengthSessionId) {
    throw new Error("review_queue_missing_full_length_session_id");
  }

  const includePractice = mode !== "by_full_length_session";
  const includeFullLength = mode !== "by_practice_session";

  const practicePromise = includePractice
    ? (() => {
      let query = supabaseServer
        .from("practice_session_items")
        .select("id, session_id, question_id, question_canonical_id, question_stem, question_section, question_difficulty, question_domain, question_skill, question_subskill, question_options, question_correct_answer, question_explanation, question_exam, question_structure_cluster_id, outcome, is_correct, answered_at, status")
        .eq("user_id", userId);

      if (mode === "by_practice_session" && practiceSessionId) {
        query = query.eq("session_id", practiceSessionId);
      }

      return query
        .in("status", ["answered", "skipped"])
        .order("answered_at", { ascending: false })
        .limit(2000);
    })()
    : Promise.resolve({ data: [], error: null });

  const fullLengthPromise = includeFullLength
    ? (() => {
      let query = supabaseServer
        .from("full_length_exam_responses")
        .select("id, module_id, question_id, is_correct, answered_at, full_length_exam_sessions!inner(user_id, status)")
        .eq("full_length_exam_sessions.user_id", userId)
        .eq("full_length_exam_sessions.status", "completed");

      if (mode === "by_full_length_session" && fullLengthSessionId) {
        query = query.eq("session_id", fullLengthSessionId);
      }

      return query
        .order("answered_at", { ascending: false })
        .limit(2000);
    })()
    : Promise.resolve({ data: [], error: null });

  const [practiceAttemptsResult, fullLengthResponseResult] = await Promise.all([practicePromise, fullLengthPromise]);

  if (practiceAttemptsResult.error) {
    throw new Error(`review_queue_practice_fetch_failed:${practiceAttemptsResult.error.message}`);
  }

  if (fullLengthResponseResult.error) {
    throw new Error(`review_queue_full_test_fetch_failed:${fullLengthResponseResult.error.message}`);
  }

  const practiceRows = (practiceAttemptsResult.data ?? []) as Array<{
    id: string;
    session_id: string | null;
    question_id: string;
    question_canonical_id: string | null;
    question_stem: string | null;
    question_section: string | null;
    question_difficulty: string | number | null;
    question_domain: string | null;
    question_skill: string | null;
    question_subskill: string | null;
    question_options: unknown;
    question_correct_answer: string | null;
    question_explanation: string | null;
    question_exam: string | null;
    question_structure_cluster_id: string | null;
    is_correct: boolean | null;
    outcome: string | null;
    answered_at: string | null;
    status: string | null;
  }>;
  const fullLengthRows = (fullLengthResponseResult.data ?? []) as Array<{
    id: string;
    module_id: string;
    question_id: string;
    is_correct: boolean | null;
    answered_at: string | null;
  }>;

  const fullLengthModuleIds = Array.from(new Set(fullLengthRows.map((row) => String(row.module_id ?? "")).filter(Boolean)));
  const fullLengthQuestionMap = new Map<string, {
    question_id: string;
    module_id: string;
    canonical_id: string | null;
    stem: string | null;
    section: string | null;
    difficulty: string | number | null;
    domain: string | null;
    skill: string | null;
    subskill: string | null;
    options: unknown;
    correct_answer: string | null;
    explanation: string | null;
    exam: string | null;
    structure_cluster_id: string | null;
  }>();

  if (fullLengthModuleIds.length > 0) {
    const { data: fullLengthQuestions, error: fullLengthQuestionError } = await supabaseServer
      .from("full_length_exam_questions")
      .select("module_id, question_id, question_canonical_id, question_stem, question_section, question_difficulty, question_domain, question_skill, question_subskill, question_options, question_correct_answer, question_explanation, question_exam, question_structure_cluster_id")
      .in("module_id", fullLengthModuleIds);

    if (fullLengthQuestionError) {
      throw new Error(`review_queue_full_test_snapshot_fetch_failed:${fullLengthQuestionError.message}`);
    }

    for (const question of fullLengthQuestions ?? []) {
      const moduleId = String((question as any).module_id ?? "");
      const questionId = String((question as any).question_id ?? "");
      if (!moduleId || !questionId) continue;
      fullLengthQuestionMap.set(`${moduleId}::${questionId}`, {
        module_id: moduleId,
        question_id: questionId,
        canonical_id: resolveCanonicalQuestionId((question as any).question_canonical_id),
        stem: typeof (question as any).question_stem === "string" ? (question as any).question_stem : null,
        section: typeof (question as any).question_section === "string" ? (question as any).question_section : null,
        difficulty: (question as any).question_difficulty ?? null,
        domain: typeof (question as any).question_domain === "string" ? (question as any).question_domain : null,
        skill: typeof (question as any).question_skill === "string" ? (question as any).question_skill : null,
        subskill: typeof (question as any).question_subskill === "string" ? (question as any).question_subskill : null,
        options: (question as any).question_options ?? null,
        correct_answer: typeof (question as any).question_correct_answer === "string" ? (question as any).question_correct_answer : null,
        explanation: typeof (question as any).question_explanation === "string" ? (question as any).question_explanation : null,
        exam: typeof (question as any).question_exam === "string" ? (question as any).question_exam : null,
        structure_cluster_id: typeof (question as any).question_structure_cluster_id === "string" ? (question as any).question_structure_cluster_id : null,
      });
    }
  }

  const combinedSnapshots: ReviewQueueSnapshot[] = [];

  for (const row of practiceRows) {
    const outcome = normalizeOutcome(row as any);
    const questionId = String((row as any).question_id ?? "");

    combinedSnapshots.push({
      attemptId: String((row as any).id),
      questionId,
      questionCanonicalId: resolveCanonicalQuestionId((row as any).question_canonical_id),
      attemptedAt: (row as any).answered_at ?? null,
      isCorrect: outcome === "correct",
      outcome,
      source: "practice",
      questionText: row.question_stem ?? "Question text unavailable",
      section: row.question_section ?? "Unknown",
      difficulty: row.question_difficulty == null ? null : String(row.question_difficulty),
      domain: row.question_domain ?? null,
      skill: row.question_skill ?? null,
      subskill: row.question_subskill ?? null,
      questionOptions: row.question_options ?? null,
      questionCorrectAnswer: row.question_correct_answer ?? null,
      questionExplanation: row.question_explanation ?? null,
      questionExam: row.question_exam ?? null,
      questionStructureClusterId: row.question_structure_cluster_id ?? null,
    });
  }

  for (const row of fullLengthRows) {
    const questionId = String(row.question_id ?? "");
    if (!questionId) continue;

    const question = fullLengthQuestionMap.get(`${String(row.module_id ?? "")}::${questionId}`);
    const isCorrect = Boolean(row.is_correct);
    const outcome: ReviewOutcome = isCorrect ? "correct" : "incorrect";

    combinedSnapshots.push({
      attemptId: "full-test:" + String(row.id),
      questionId,
      questionCanonicalId: question?.canonical_id ?? null,
      attemptedAt: row.answered_at ?? null,
      isCorrect,
      outcome,
      source: "full_test",
      questionText: question?.stem ?? "Question text unavailable",
      section: question?.section ?? "Unknown",
      difficulty: question?.difficulty == null ? null : String(question.difficulty),
      domain: question?.domain ?? null,
      skill: question?.skill ?? null,
      subskill: question?.subskill ?? null,
      questionOptions: question?.options ?? null,
      questionCorrectAnswer: question?.correct_answer ?? null,
      questionExplanation: question?.explanation ?? null,
      questionExam: question?.exam ?? null,
      questionStructureClusterId: question?.structure_cluster_id ?? null,
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
      if (!String(reviewAttemptError.message || "").includes("Could not find the table 'public.review_error_attempts'")) {
        throw new Error(`review_queue_recovery_fetch_failed:${reviewAttemptError.message}`);
      }
    }

    if (reviewAttempts) {
      for (const row of reviewAttempts) {
        const recoveryKey = String((row as any).question_id ?? "");
        if (!recoveryKey || latestRecoveredByKey.has(recoveryKey)) continue;
        latestRecoveredByKey.set(recoveryKey, Boolean((row as any).is_correct));
      }
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
