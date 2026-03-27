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

export async function buildReviewQueueForStudent(userId: string): Promise<ReviewQueueBuildResult> {
  const [practiceAttemptsResult, fullLengthResponseResult] = await Promise.all([
    supabaseServer
      .from("answer_attempts")
      .select("id, session_id, session_item_id, question_id, is_correct, outcome, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabaseServer
      .from("full_length_exam_responses")
      .select("id, module_id, question_id, is_correct, answered_at, full_length_exam_sessions!inner(user_id, status)")
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

  const practiceRows = (practiceAttemptsResult.data ?? []) as Array<{
    id: string;
    session_id: string | null;
    session_item_id: string | null;
    question_id: string;
    is_correct: boolean | null;
    outcome: string | null;
    created_at: string | null;
  }>;
  const fullLengthRows = (fullLengthResponseResult.data ?? []) as Array<{
    id: string;
    module_id: string;
    question_id: string;
    is_correct: boolean | null;
    answered_at: string | null;
  }>;

  const practiceSessionItemIds = Array.from(
    new Set(practiceRows.map((row) => String(row.session_item_id ?? "")).filter(Boolean))
  );
  const practiceSessionIds = Array.from(
    new Set(practiceRows.map((row) => String(row.session_id ?? "")).filter(Boolean))
  );
  const practiceSnapshotByItemId = new Map<string, {
    id: string;
    session_id: string;
    question_id: string;
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
  const practiceSnapshotBySessionQuestion = new Map<string, {
    id: string;
    session_id: string;
    question_id: string;
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

  if (practiceSessionItemIds.length > 0 || practiceSessionIds.length > 0) {
    let practiceSnapshotQuery = supabaseServer
      .from("practice_session_items")
      .select("id, session_id, question_id, question_canonical_id, question_stem, question_section, question_difficulty, question_domain, question_skill, question_subskill, question_options, question_correct_answer, question_explanation, question_exam, question_structure_cluster_id")
      .order("created_at", { ascending: false })
      .limit(4000);

    if (practiceSessionItemIds.length > 0) {
      practiceSnapshotQuery = practiceSnapshotQuery.in("id", practiceSessionItemIds);
    } else {
      practiceSnapshotQuery = practiceSnapshotQuery.in("session_id", practiceSessionIds);
    }

    const { data: practiceSnapshots, error: practiceSnapshotError } = await practiceSnapshotQuery;
    if (practiceSnapshotError) {
      throw new Error(`review_queue_practice_snapshot_fetch_failed:${practiceSnapshotError.message}`);
    }

    for (const row of (practiceSnapshots ?? []) as any[]) {
      const snapshot = {
        id: String(row.id),
        session_id: String(row.session_id),
        question_id: String(row.question_id),
        canonical_id: resolveCanonicalQuestionId(row.question_canonical_id),
        stem: typeof row.question_stem === "string" ? row.question_stem : null,
        section: typeof row.question_section === "string" ? row.question_section : null,
        difficulty: row.question_difficulty ?? null,
        domain: typeof row.question_domain === "string" ? row.question_domain : null,
        skill: typeof row.question_skill === "string" ? row.question_skill : null,
        subskill: typeof row.question_subskill === "string" ? row.question_subskill : null,
        options: row.question_options ?? null,
        correct_answer: typeof row.question_correct_answer === "string" ? row.question_correct_answer : null,
        explanation: typeof row.question_explanation === "string" ? row.question_explanation : null,
        exam: typeof row.question_exam === "string" ? row.question_exam : null,
        structure_cluster_id: typeof row.question_structure_cluster_id === "string" ? row.question_structure_cluster_id : null,
      };
      practiceSnapshotByItemId.set(snapshot.id, snapshot);
      practiceSnapshotBySessionQuestion.set(`${snapshot.session_id}::${snapshot.question_id}`, snapshot);
    }
  }

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
    const byItemId = row.session_item_id ? practiceSnapshotByItemId.get(String(row.session_item_id)) : null;
    const bySessionQuestion = row.session_id
      ? practiceSnapshotBySessionQuestion.get(`${row.session_id}::${String(row.question_id ?? "")}`)
      : null;
    const question = byItemId ?? bySessionQuestion ?? null;
    const outcome = normalizeOutcome(row as any);
    const questionId = String((row as any).question_id ?? "");

    combinedSnapshots.push({
      attemptId: String((row as any).id),
      questionId,
      questionCanonicalId: question?.canonical_id ?? null,
      attemptedAt: (row as any).created_at ?? (row as any).attempted_at ?? null,
      isCorrect: outcome === "correct",
      outcome,
      source: "practice",
      questionText: (question?.stem ?? "Question text unavailable").slice(0, 200),
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
      questionText: (question?.stem ?? "Question text unavailable").slice(0, 200),
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
