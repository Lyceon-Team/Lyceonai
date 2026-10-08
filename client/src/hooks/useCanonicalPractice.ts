import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { csrfFetch } from "@/lib/csrf";
import { getClientInstanceId } from "@/lib/client-instance";
import { invalidateSessionReads } from "@/lib/session-reads";
import { isSubmittableAnswer } from "@/lib/practice-submission";
import {
  type EngineConfig,
  type ReviewSessionSpec,
  PRACTICE_ENGINE_CONFIG,
} from "@/lib/engine-config";

const inflightEnsureSession = new Map<string, Promise<string>>();

import type { CanonicalSectionCode } from "@shared/question-bank-contract";

/**
 * @spec [Doc-05B §4.2] | @implemented [2026-09-02]
 * The section a practice session is started for, as the code the database stores.
 * `"random"` is not a section — it is the absence of a section filter — and is the one
 * member here that is not a section value. The former "math" | "reading_writing"
 * spelling existed only between this hook and the route that immediately converted it.
 */
export type PracticeSectionParam = CanonicalSectionCode | "random";

export type PracticeOption = {
  id: string;
  text: string;
};

export type PreSubmitAssetRole = "stimulus" | "option";

export type PracticeAssetSvg = {
  id: string;
  kind: "svg";
  role: PreSubmitAssetRole;
  alt: string;
  option_key?: string | null;
  svg: string;
  caption?: string | null;
};

export type PracticeAssetTable = {
  id: string;
  kind: "table";
  role: PreSubmitAssetRole;
  alt: string;
  option_key?: string | null;
  caption?: string | null;
  headers: string[];
  rows: string[][];
};

export type PracticeAssetItem = PracticeAssetSvg | PracticeAssetTable;

export type PracticeAssets = {
  v: 1;
  items: PracticeAssetItem[];
};

export type PracticeQuestion = {
  sessionItemId?: string;
  questionType?: "multiple_choice" | "grid_in" | null;
  itemType?: "mcq" | "grid_in" | null;
  inputMode?: "choice" | "numeric_entry" | null;
  stem: string;
  passage?: string | null;
  section?: string | null;
  options?: PracticeOption[] | null;
  assets?: PracticeAssets | null;
};

export type PracticeNextResponse = {
  sessionId?: string;
  sessionItemId?: string;
  ordinal?: number;
  calculatorState?: unknown | null;
  question: PracticeQuestion | null;
  totalQuestions?: number;
  currentIndex?: number;
  state?: "created" | "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeAnswerResponse = {
  isCorrect: boolean;
  correctOptionId?: string | null;
  correctAnswer?: string | null;
  mode?: "multiple_choice" | "grid_in" | null;
  explanation?: string | null;
  state?: "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeSkipResponse = {
  skipped: true;
  feedback: "Skipped";
  state?: "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeSessionSpecInput = {
  sections?: string[];
  domains?: string[];
  difficulties?: string[];
  targetMinutes?: number;
  targetQuestionCount?: number;
  mode?: string;
  /**
   * Review only. Practice never sets this; review's create body is built from it by
   * `REVIEW_ENGINE_CONFIG.buildCreateBody` (engine-config.ts). Carried on the same spec
   * object so the loop has one input, not two.
   */
  review?: ReviewSessionSpec;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeStats(
  prev: {
    correct: number;
    incorrect: number;
    skipped: number;
    total: number;
    streak: number;
  },
  next?: PracticeNextResponse["stats"] | PracticeAnswerResponse["stats"],
) {
  if (!next) return prev;
  return {
    correct: typeof next.correct === "number" ? next.correct : prev.correct,
    incorrect:
      typeof next.incorrect === "number" ? next.incorrect : prev.incorrect,
    skipped: typeof next.skipped === "number" ? next.skipped : prev.skipped,
    total: typeof next.total === "number" ? next.total : prev.total,
    streak: typeof next.streak === "number" ? next.streak : prev.streak,
  };
}

function isMultipleChoice(question: PracticeQuestion | null): boolean {
  return !!question && question.questionType === "multiple_choice";
}

function isGridIn(question: PracticeQuestion | null): boolean {
  return (
    !!question &&
    (question.questionType === "grid_in" || question.itemType === "grid_in")
  );
}

function normalizeQuestion(
  raw: PracticeQuestion | null,
): PracticeQuestion | null {
  if (!raw) return null;

  const stem = typeof raw.stem === "string" ? raw.stem : "";
  if (!stem) return null;

  const section = typeof raw.section === "string" ? raw.section : null;

  const rawQType =
    (raw as Record<string, unknown>).questionType ??
    (raw as Record<string, unknown>).itemType ??
    null;
  const isGrid = rawQType === "grid_in";

  const options = Array.isArray(raw.options)
    ? raw.options
        .map((opt) => {
          const id = typeof opt?.id === "string" ? opt.id.trim() : "";
          const text = typeof opt?.text === "string" ? opt.text : "";
          if (!id || !text) return null;
          return { id, text };
        })
        .filter((opt): opt is PracticeOption => !!opt)
    : [];

  if (!isGrid && options.length === 0) return null;

  return {
    sessionItemId:
      typeof raw.sessionItemId === "string" ? raw.sessionItemId : undefined,
    questionType: isGrid ? "grid_in" : "multiple_choice",
    itemType: isGrid ? "grid_in" : null,
    inputMode: isGrid ? "numeric_entry" : null,
    stem,
    passage:
      typeof raw.passage === "string" && raw.passage.trim().length > 0
        ? raw.passage
        : null,
    section,
    options: isGrid ? [] : options,
    assets: normalizeAssets(raw.assets),
  };
}

const VALID_ASSET_KINDS = new Set(["svg", "table"]);
const VALID_PRE_SUBMIT_ROLES: Set<string> = new Set(["stimulus", "option"]);

export function normalizeAssetItem(raw: unknown): PracticeAssetItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.kind !== "string" || !VALID_ASSET_KINDS.has(item.kind))
    return null;
  if (typeof item.role !== "string" || !VALID_PRE_SUBMIT_ROLES.has(item.role))
    return null;
  return raw as PracticeAssetItem;
}

export function normalizeAssets(raw: unknown): PracticeAssets | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== 1 || !Array.isArray(candidate.items)) return null;
  const validated = candidate.items
    .map(normalizeAssetItem)
    .filter((item): item is PracticeAssetItem => item !== null);
  if (validated.length === 0) return null;
  return { v: 1, items: validated };
}

export function useCanonicalPractice(
  section: PracticeSectionParam,
  sessionSpec?: PracticeSessionSpecInput,
  initialSessionId?: string | null,
  engine: EngineConfig = PRACTICE_ENGINE_CONFIG,
) {
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  const [sessionItemId, setSessionItemId] = useState<string | null>(null);
  const [clientInstanceId] = useState(() => getClientInstanceId());
  const [clientAttemptId, setClientAttemptId] = useState(() =>
    crypto.randomUUID(),
  );
  const [forceTakeover, setForceTakeover] = useState(false);

  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * QA item 5 (2026-10-07) | @implemented [2026-10-07]: which submit is in flight, so the
   * runner's footer labels the pressed control ("Skipping…" or "Checking…"). A skip stays
   * "skip" until the next question has loaded, because `submitAnswer` awaits it.
   */
  const [submitKind, setSubmitKind] = useState<"answer" | "skip" | null>(null);

  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<
    "created" | "active" | "completed" | "abandoned"
  >("created");
  const [calculatorState, setCalculatorState] = useState<unknown | null>(null);
  /**
   * True once `/next` has answered 409 `session_closed` (F-53, UI-53): the session is over and
   * there is no next item. Separate from `sessionState`, which the answer response also sets to
   * "completed" on the last answer, while the student is still reading that answer's feedback.
   */
  const [sessionClosed, setSessionClosed] = useState(false);

  const [score, setScore] = useState({
    correct: 0,
    incorrect: 0,
    skipped: 0,
    total: 0,
    streak: 0,
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState<number | undefined>(
    undefined,
  );

  const currentAnswer = useMemo(
    () =>
      isMultipleChoice(question) ? selectedAnswer : freeResponseAnswer.trim(),
    [question, selectedAnswer, freeResponseAnswer],
  );

  const canSubmit = useMemo(
    () => isSubmittableAnswer(question, currentAnswer),
    [question, currentAnswer],
  );

  const [submitBlocked, setSubmitBlocked] = useState<string | null>(null);

  const resetPerQuestionState = useCallback(() => {
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowResult(false);
    setIsCorrect(null);
    setCorrectOptionId(null);
    setCorrectAnswer(null);
    setExplanation(null);
    setSubmitBlocked(null);
    setClientAttemptId(crypto.randomUUID());
  }, []);

  const ensureSession = useCallback(async () => {
    if (sessionId && !forceTakeover) return sessionId;

    // Deduplicate strict-mode or concurrent calls for the same session setup
    const lockKey = initialSessionId
      ? `resume-${engine.domain}-${initialSessionId}`
      : `start-${engine.domain}-${section}-${sessionSpec?.mode ?? "balanced"}`;

    if (inflightEnsureSession.has(lockKey)) {
      const id = await inflightEnsureSession.get(lockKey)!;
      setSessionId(id);
      return id;
    }

    const promise = (async () => {
      // If we have an initialSessionId, we use the resume endpoint
      if (sessionId) {
        const resumeRes = await csrfFetch(engine.endpoints.resume(sessionId), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_instance_id: clientInstanceId,
            force_takeover: forceTakeover,
          }),
        });

        const resumeBody = await resumeRes.json().catch(() => null);
        if (resumeRes.status === 409) {
          throw {
            code: "CLIENT_INSTANCE_CONFLICT",
            message: resumeBody.message,
            boundId: resumeBody.client_instance_id,
          };
        }

        if (!resumeRes.ok) {
          throw new Error(
            resumeBody?.message ||
              `Failed to resume session (${resumeRes.status})`,
          );
        }

        setSessionId(resumeBody.sessionId);
        setSessionItemId(resumeBody.sessionItemId);
        if (
          Object.prototype.hasOwnProperty.call(resumeBody, "calculatorState")
        ) {
          setCalculatorState(resumeBody.calculatorState ?? null);
        }
        return resumeBody.sessionId;
      }

      const startPayload = engine.buildCreateBody({
        section,
        clientInstanceId,
        spec: sessionSpec ?? {},
      });

      const startRes = await csrfFetch(engine.endpoints.create(), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(startPayload),
      });

      const startPayloadBody = await startRes.json().catch(() => null);

      if (
        startRes.status === 403 &&
        startPayloadBody?.code === "SESSION_LIMIT_EXCEEDED"
      ) {
        throw {
          code: "SESSION_LIMIT_EXCEEDED",
          message: startPayloadBody.message,
        };
      }

      if (!startRes.ok) {
        throw new Error(
          startPayloadBody?.message ||
            `${engine.labels.startFailure} (${startRes.status})`,
        );
      }

      const started = (startPayloadBody ?? {}) as {
        sessionId?: string;
        calculatorState?: unknown | null;
      };
      if (!started.sessionId) {
        throw new Error("Server did not return a sessionId");
      }

      setSessionId(started.sessionId);
      if (Object.prototype.hasOwnProperty.call(started, "calculatorState")) {
        setCalculatorState(started.calculatorState ?? null);
      }
      return started.sessionId;
    })();

    inflightEnsureSession.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      // Small delay before clearing to ensure strict-mode double renders hit the cache
      setTimeout(() => inflightEnsureSession.delete(lockKey), 100);
    }
  }, [
    clientInstanceId,
    engine,
    forceTakeover,
    initialSessionId,
    section,
    sessionId,
    sessionSpec,
    sessionSpec?.difficulties,
    sessionSpec?.domains,
    sessionSpec?.mode,
    sessionSpec?.review,
    sessionSpec?.sections,
    sessionSpec?.targetMinutes,
    sessionSpec?.targetQuestionCount,
  ]);

  /**
   * @spec [student-UI register §8 F-64, UI-53] | @implemented [2026-10-03]
   * plain English: one `/next` per step. While a `/next` is in flight, a second call (React
   * StrictMode's double mount effect in development, a double click on Next, the keyboard and
   * the button together) gets the SAME promise instead of a second request. A ref, not state,
   * because StrictMode keeps refs across its simulated unmount and remount, and because the
   * guard must hold within one render. The server answers a concurrent pair safely as well
   * (F-64); this keeps the runner from asking twice in the first place.
   */
  const nextInFlight = useRef<Promise<PracticeNextResponse | null> | null>(
    null,
  );

  const loadNextQuestion =
    useCallback(async (): Promise<PracticeNextResponse | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const effectiveSessionId = await ensureSession();
        const nextRes = await csrfFetch(
          engine.endpoints.next(effectiveSessionId, clientInstanceId),
          {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );

        const nextPayloadBody = await nextRes.json().catch(() => null);

        // F-53 (register §8): after the last item, the server completes the session and `/next`
        // answers 409 `session_closed`. That is the end of the session, not an error: the page
        // sees `sessionState === "completed"` and goes to the completion destination.
        if (
          nextRes.status === 409 &&
          isObjectRecord(nextPayloadBody) &&
          nextPayloadBody.error === "session_closed"
        ) {
          setSessionState("completed");
          setSessionClosed(true);
          setQuestion(null);
          setSessionItemId(null);
          return null;
        }

        if (!nextRes.ok) {
          throw new Error(`Failed to load next question (${nextRes.status})`);
        }

        const data = (nextPayloadBody ?? {}) as PracticeNextResponse;

        if (data.sessionId) setSessionId(data.sessionId);
        setSessionItemId(data.sessionItemId ?? null);
        setQuestion(normalizeQuestion(data.question ?? null));
        if (data.state) setSessionState(data.state);
        if (Object.prototype.hasOwnProperty.call(data, "calculatorState")) {
          setCalculatorState(data.calculatorState ?? null);
        }

        if (typeof data.totalQuestions === "number")
          setTotalQuestions(data.totalQuestions);
        if (typeof data.currentIndex === "number")
          setCurrentIndex(data.currentIndex);
        if (typeof data.ordinal === "number")
          setCurrentIndex(Math.max(0, data.ordinal - 1));

        if (data.stats) {
          setScore((prev) => mergeStats(prev, data.stats));
        }

        resetPerQuestionState();
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load question";
        setError(message);
        setQuestion(null);
        setSessionItemId(null);
        return null;
      } finally {
        setIsLoading(false);
      }
    }, [clientInstanceId, engine, ensureSession, resetPerQuestionState]);

  const fetchNextQuestion =
    useCallback((): Promise<PracticeNextResponse | null> => {
      const pending = nextInFlight.current;
      if (pending) return pending;
      const request = loadNextQuestion().finally(() => {
        nextInFlight.current = null;
      });
      nextInFlight.current = request;
      return request;
    }, [loadNextQuestion]);

  const submitAnswer = useCallback(
    async (opts: { skipped: boolean }) => {
      if (!question) return;

      if (!opts.skipped && !isSubmittableAnswer(question, currentAnswer)) {
        setSubmitBlocked(
          isGridIn(question)
            ? "Enter a valid number, decimal, or fraction."
            : "Select an answer option.",
        );
        return;
      }

      setSubmitBlocked(null);

      setIsSubmitting(true);
      setSubmitKind(opts.skipped ? "skip" : "answer");
      setError(null);

      try {
        const effectiveSessionId = await ensureSession();
        const effectiveSessionItemId = sessionItemId;

        if (!effectiveSessionItemId) {
          throw new Error(
            "No active session item. Please load the next question.",
          );
        }

        const endpoint = opts.skipped
          ? engine.endpoints.skip(effectiveSessionId)
          : engine.endpoints.answer(effectiveSessionId);

        const gridIn = isGridIn(question);
        const payload = opts.skipped
          ? {
              sessionItemId: effectiveSessionItemId,
              clientAttemptId,
              client_instance_id: clientInstanceId,
            }
          : {
              sessionId: effectiveSessionId,
              sessionItemId: effectiveSessionItemId,
              clientAttemptId,
              ...(gridIn
                ? { selectedAnswer: freeResponseAnswer.trim() }
                : { selectedOptionId: selectedAnswer }),
            };

        const res = await csrfFetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const payloadBody = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(`Failed to submit answer (${res.status})`);
        }

        const data = (payloadBody ?? {}) as
          | PracticeAnswerResponse
          | PracticeSkipResponse;
        // QA item 6 (2026-10-07): an answer or a skip changes the session lists, the
        // "N of M answered" counts, the review pool and today's plan; mark them stale.
        invalidateSessionReads(queryClient, {
          engine: engine.domain,
          sessionId: effectiveSessionId,
        });
        if (data.state) setSessionState(data.state);

        if (data.stats) {
          setScore((prev) => mergeStats(prev, data.stats));
        } else {
          setScore((prev) => {
            const next = { ...prev };
            next.total = prev.total + 1;

            if (opts.skipped) {
              next.skipped = (prev.skipped ?? 0) + 1;
              next.streak = 0;
              return next;
            }

            if (!opts.skipped && "isCorrect" in data && data.isCorrect) {
              next.correct = prev.correct + 1;
              next.streak = prev.streak + 1;
            } else {
              next.incorrect = (prev.incorrect ?? 0) + 1;
              next.streak = 0;
            }
            return next;
          });
        }

        if (opts.skipped) {
          await fetchNextQuestion();
          return;
        }

        const answerData = data as PracticeAnswerResponse;
        setIsCorrect(!!answerData.isCorrect);
        setCorrectOptionId(answerData.correctOptionId ?? null);
        setCorrectAnswer(answerData.correctAnswer ?? null);
        setExplanation(answerData.explanation ?? null);
        setShowResult(true);
        return answerData;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit answer";
        setError(message);
        return null;
      } finally {
        setIsSubmitting(false);
        setSubmitKind(null);
      }
    },
    [
      clientInstanceId,
      clientAttemptId,
      currentAnswer,
      engine,
      ensureSession,
      fetchNextQuestion,
      question,
      sessionItemId,
    ],
  );

  const nextQuestion = useCallback(async () => {
    await fetchNextQuestion();
  }, [fetchNextQuestion]);

  const handleMissingMcChoices = useCallback(async () => {
    if (!question) return;
    if (isGridIn(question)) return;
    if (!isMultipleChoice(question)) return;
    await submitAnswer({ skipped: true });
  }, [question, submitAnswer]);

  const persistCalculatorState = useCallback(
    async (nextCalculatorState: unknown | null) => {
      if (!sessionId) return null;
      if (sessionState === "completed" || sessionState === "abandoned")
        return null;

      const res = await csrfFetch(engine.endpoints.calculatorState(sessionId), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_instance_id: clientInstanceId,
          calculator_state: nextCalculatorState,
        }),
      });

      const payloadBody = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(`Failed to persist calculator state (${res.status})`);
      }

      const data = (payloadBody ?? {}) as { calculatorState?: unknown | null };
      const value = Object.prototype.hasOwnProperty.call(
        data,
        "calculatorState",
      )
        ? (data.calculatorState ?? null)
        : nextCalculatorState;

      setCalculatorState(value ?? null);
      return value ?? null;
    },
    [clientInstanceId, engine, sessionId, sessionState],
  );

  useEffect(() => {
    fetchNextQuestion();
    // Mount-only by design: the first question loads once; later loads are driven
    // by the student's actions, not by `fetchNextQuestion`'s identity changing.
  }, []);

  /**
   * QA item 6 (owner QA list, Karl, 2026-10-07) | @implemented [2026-10-07]: leaving the runner
   * (the back arrow, a completion redirect, any navigation) marks the session reads stale, so the
   * page the student lands on reads them afresh. A ref, so the cleanup sees the session id the
   * runner ended on, not the one it mounted with.
   */
  const leaveSession = useRef<string | null>(null);
  leaveSession.current = sessionId;
  useEffect(
    () => () => {
      const id = leaveSession.current;
      invalidateSessionReads(
        queryClient,
        id === null ? undefined : { engine: engine.domain, sessionId: id },
      );
    },
    // Unmount only: `engine` is fixed for a mounted runner.
    [],
  );

  return {
    question,
    isLoading,
    error,

    selectedAnswer,
    setSelectedAnswer,
    freeResponseAnswer,
    setFreeResponseAnswer,

    isSubmitting,
    submitKind,

    showResult,
    isCorrect,
    correctOptionId,
    correctAnswer,
    explanation,

    score,
    currentIndex,
    totalQuestions,
    /** True once the server has closed the session and there is no next item (F-53). */
    sessionClosed,

    canSubmit,

    fetchNextQuestion,
    submitAnswer,
    nextQuestion,
    handleMissingMcChoices,
    calculatorState,
    persistCalculatorState,
    submitBlocked,
    setForceTakeover,
    /** The served item's id — what a scoped LISA conversation anchors to (W4-1). */
    sessionItemId,
  };
}
