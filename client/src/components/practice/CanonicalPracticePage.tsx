/**
 * @spec [Doc-02B_v4, §28 Math Tooling: Desmos and Formula Sheet] | @implemented [2026-07-26]
 * Canonical practice page with Bluebook-parity resizable calculator side-panel.
 *
 * Pixel-floor guarantee: the Desmos host is ≥DESMOS_HOST_MIN_PX at every
 * supported viewport, on first render, after resize, and in every fallback.
 *
 * Pixel floor enforced by CSS `min-width` (browser-continuous); the library's
 * `minSize` percentage is a soft initial constraint that bounds drag at the
 * breakpoint-minimum container width. No JS observer needed — CSS `min-width`
 * is the single source of truth for the pixel floor.
 *
 *  1. CSS `min-width` on the calculator panel — browser-enforced, continuous,
 *     cannot be violated by any drag, keyboard resize, or window resize.
 *  2. `onResize` callback + imperative Panel API — defence-in-depth runtime
 *     clamp during drag (snaps back if library somehow violates the floor).
 *  3. Static `minSize` percentage computed from SPLIT_BREAKPOINT — guarantees
 *     the correct library-level bound at the smallest supported container.
 *
 * Below the SPLIT_BREAKPOINT the calculator renders full-width (stacked layout)
 * instead of in a narrow sidebar column, avoiding any sub-minimum host width.
 */
import React from "react";
import { PracticeShell } from "@/components/layout/PracticeShell";
import QuestionRenderer from "@/components/question-renderer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useCanonicalPractice,
  PracticeSectionParam,
} from "@/hooks/useCanonicalPractice";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Calculator, Loader2, MessageCircle } from "lucide-react";
import { ScopedTutorPanel } from "@/components/tutor/ScopedTutorPanel";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
import {
  type EngineConfig,
  type ReviewSessionSpec,
  PRACTICE_ENGINE_CONFIG,
} from "@/lib/engine-config";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import type { PracticeDifficulty } from "@/lib/practice-filters";
import { isMathSection } from "@shared/section-display";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";

const DIFFICULTY_LABELS: Record<PracticeDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const DIFFICULTY_COLORS: Record<PracticeDifficulty, string> = {
  easy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  hard: "bg-red-50 text-red-700 border-red-200",
};

/* ── Layout pixel constraints (exported for test assertions) ── */
export const DESMOS_HOST_MIN_PX = 480;
export const CALC_PANEL_PAD_PX = 16;
export const CALC_MIN_PX = DESMOS_HOST_MIN_PX + CALC_PANEL_PAD_PX; // 496
export const QUESTION_MIN_PX = 500;
const DIVIDER_PX = 14; // conservative; actual CSS is w-px, but grip + hit area widen
const APP_HORIZONTAL_PADDING = 32;
const BREAKPOINT_EXTRA = 20;
export const SPLIT_BREAKPOINT =
  CALC_MIN_PX +
  QUESTION_MIN_PX +
  DIVIDER_PX +
  APP_HORIZONTAL_PADDING +
  BREAKPOINT_EXTRA; // 1062

/**
 * Static percentages computed once at the known-minimum container width
 * (SPLIT_BREAKPOINT − APP_HORIZONTAL_PADDING). These give the library a soft
 * bound that prevents it from allocating less than the pixel minimum during
 * drag at the breakpoint container width. The CSS `min-width` on each panel
 * is the TRUE pixel floor (browser-enforced, continuous); these percentages
 * are a secondary initial constraint only.
 */
const CONTAINER_AT_BREAKPOINT = SPLIT_BREAKPOINT - APP_HORIZONTAL_PADDING; // 1030
const CALC_MIN_PCT = Math.ceil((CALC_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100); // 49
const QUESTION_MIN_PCT = Math.ceil(
  (QUESTION_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100,
); // 49
const CALC_DEFAULT_PCT = CALC_MIN_PCT; // 49
const QUESTION_DEFAULT_PCT = 100 - CALC_DEFAULT_PCT; // 51

/*
 * W4-4 — review with LISA always open. Three panels share the width:
 *   question (≥ QUESTION_MIN_PX) | Desmos (≥ CALC_MIN_PX, when opened) | LISA.
 * Below THREE_PANEL_BREAKPOINT the calculator can no longer sit beside both,
 * so opening it expands Desmos over LISA's column (owner ruling 2026-09-25);
 * LISA stays mounted underneath, so its thread and turn state survive. Below
 * `lg` everything stacks: question, LISA, calculator.
 */
export const TUTOR_PANEL_PX = 360;
const TUTOR_GAP_PX = 24;
export const THREE_PANEL_BREAKPOINT =
  QUESTION_MIN_PX +
  DIVIDER_PX +
  CALC_MIN_PX +
  TUTOR_GAP_PX +
  TUTOR_PANEL_PX +
  APP_HORIZONTAL_PADDING +
  BREAKPOINT_EXTRA; // 1446
/** Tailwind's `lg`: below it, the review layout is a single column. */
export const TUTOR_SIDE_BY_SIDE_BREAKPOINT = 1024;

function useMinWidth(px: number): boolean {
  const [matches, setMatches] = React.useState<boolean>(
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${px}px)`).matches
      : false,
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = (): void => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [px]);

  return matches;
}

function useSplitEnabled(): boolean {
  return useMinWidth(SPLIT_BREAKPOINT);
}

/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring]
 * @implemented 2026-08-14
 *
 * engine: which engine's endpoints, labels and feature switches the loop uses
 *   (brief R4 §2.1). Defaults to practice, so every existing call site is unchanged.
 * completionHref: where to navigate after session completion. Defaults to the engine's
 *   own completion route ("/practice" for practice, "/review" for review).
 *   For diagnostic sessions, pass "/dashboard" so the student lands on the baseline card.
 * isDiagnostic: when true, hides "Skip" and "End Session" buttons. A skipped diagnostic
 *   item means that domain gets <5 mastery events → evidence gate may not clear →
 *   NULL projection → no baseline. The 8×5 guarantee requires all 40 items to land.
 *   Abandoning (End Session) sets status to abandoned → no baseline capture.
 */
export default function CanonicalPracticePage(props: {
  title: string;
  badgeLabel: string;
  section: PracticeSectionParam;
  targetMinutes?: number;
  sessionId?: string | null;
  difficulties?: PracticeDifficulty[];
  domains?: string[];
  completionHref?: string;
  isDiagnostic?: boolean;
  engine?: EngineConfig;
  review?: ReviewSessionSpec;
}) {
  const engine = props.engine ?? PRACTICE_ENGINE_CONFIG;
  /**
   * The diagnostic prop is honoured only by an engine that HAS a diagnostic mode.
   * Review's modes are `queue | session | filter`, so a stray `isDiagnostic` from a
   * review caller must not hide Skip and End Session on a review session.
   */
  const isDiagnostic =
    engine.features.diagnostic && props.isDiagnostic === true;
  const sessionSpec = React.useMemo(
    () => ({
      ...(typeof props.targetMinutes === "number"
        ? { targetMinutes: props.targetMinutes }
        : {}),
      ...(props.difficulties && props.difficulties.length > 0
        ? { difficulties: props.difficulties }
        : {}),
      ...(props.domains && props.domains.length > 0
        ? { domains: props.domains }
        : {}),
      ...(props.review ? { review: props.review } : {}),
    }),
    [props.targetMinutes, props.difficulties, props.domains, props.review],
  );

  const {
    question,
    isLoading,
    error,
    selectedAnswer,
    setSelectedAnswer,
    freeResponseAnswer,
    setFreeResponseAnswer,
    isSubmitting,
    showResult,
    isCorrect,
    correctOptionId,
    correctAnswer,
    explanation,
    score,
    currentIndex,
    totalQuestions,
    canSubmit,
    fetchNextQuestion,
    submitAnswer,
    nextQuestion,
    handleMissingMcChoices,
    terminateSession,
    calculatorState,
    persistCalculatorState,
    submitBlocked,
    runtimeDisabled,
    setForceTakeover,
    sessionItemId,
  } = useCanonicalPractice(props.section, sessionSpec, props.sessionId, engine);

  const [isEndingSession, setIsEndingSession] = React.useState(false);
  const [isCalculatorExpanded, setIsCalculatorExpanded] = React.useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = React.useState(false);
  // W4-4: LISA is open on every question; "Hide LISA" hides it for the
  // current one only. Derived per item, so it returns on the next.
  const [tutorHiddenForItem, setTutorHiddenForItem] = React.useState<
    string | null
  >(null);
  const [localCalculatorState, setLocalCalculatorState] = React.useState<
    unknown | null
  >(null);

  const splitEnabled = useSplitEnabled();
  const threePanelEnabled = useMinWidth(THREE_PANEL_BREAKPOINT);
  const tutorSideBySide = useMinWidth(TUTOR_SIDE_BY_SIDE_BREAKPOINT);
  const panelGroupRef = React.useRef<HTMLDivElement | null>(null);
  const calcPanelRef = React.useRef<ImperativePanelHandle | null>(null);

  // Static percentage constraints — soft library-level bound computed from the
  // breakpoint-minimum container width. CSS min-width is the true pixel floor
  // (browser-enforced, continuous); these percentages are a secondary initial
  // constraint that bounds the library's drag allocation at the smallest
  // supported container width. No dynamic observer needed.
  const calcMinPct = CALC_MIN_PCT;
  const questionMinPct = QUESTION_MIN_PCT;

  /**
   * Runtime pixel-floor enforcement via imperative API.
   * If the library allocates fewer pixels than CALC_MIN_PX (should not happen
   * with CSS min-width + correct minSize, but defence-in-depth), snap back.
   */
  const handleCalcPanelResize = React.useCallback((size: number): void => {
    const groupEl = panelGroupRef.current;
    if (!groupEl) return;
    const groupWidth = groupEl.getBoundingClientRect().width;
    if (groupWidth <= 0) return;
    const panelPx = (size / 100) * groupWidth;
    if (panelPx < CALC_MIN_PX && calcPanelRef.current) {
      const targetPct = Math.ceil((CALC_MIN_PX / groupWidth) * 100);
      calcPanelRef.current.resize(targetPct);
    }
  }, []);

  /**
   * Override the library's percentage-based ARIA values with real pixel values.
   * The library sets aria-value* in its layout effect; setTimeout(0) ensures
   * our pixel override runs after the library's DOM mutations complete.
   *
   * ARIA controlled value = question panel width (separator position from left).
   * This is the standard model for a left-to-right separator:
   *   aria-valuenow  = current question panel width in px
   *   aria-valuemin  = QUESTION_MIN_PX (smallest the question panel can be)
   *   aria-valuemax  = groupWidth − CALC_MIN_PX (largest the question panel can
   *                    be before the calculator violates its pixel floor)
   * The calculator pixel floor is provably enforced: when aria-valuenow equals
   * aria-valuemax, calculator width = groupWidth − (groupWidth − CALC_MIN_PX)
   * = CALC_MIN_PX = 496px → host = 480px ≥ 450px.
   */
  const handleGroupLayout = React.useCallback((sizes: number[]): void => {
    const groupEl = panelGroupRef.current;
    if (!groupEl || sizes.length < 2) return;
    const groupWidth = groupEl.getBoundingClientRect().width;
    if (groupWidth <= 0) return;

    const questionPx = Math.round(((sizes[0] ?? 0) / 100) * groupWidth);
    window.setTimeout(() => {
      const handleEl = groupEl.querySelector(
        '[data-testid="practice-resize-handle"]',
      );
      if (!handleEl) return;
      handleEl.setAttribute("aria-valuenow", String(questionPx));
      handleEl.setAttribute("aria-valuemin", String(QUESTION_MIN_PX));
      handleEl.setAttribute(
        "aria-valuemax",
        String(Math.round(groupWidth - CALC_MIN_PX)),
      );
    }, 0);
  }, []);

  React.useEffect(() => {
    setLocalCalculatorState(calculatorState ?? null);
  }, [calculatorState]);

  const completionDest = props.completionHref ?? engine.completionHref;

  const endSession = React.useCallback(async () => {
    if (isEndingSession) return;
    setIsEndingSession(true);
    try {
      // Diagnostic sessions: do NOT call terminateSession (which sets status
      // to 'abandoned', preventing baseline capture). Navigate directly to
      // the completion destination — the session remains resumable.
      if (isDiagnostic) {
        window.location.assign(completionDest);
        return;
      }
      await terminateSession();
      window.location.assign(completionDest);
    } finally {
      setIsEndingSession(false);
    }
  }, [isEndingSession, terminateSession, completionDest, isDiagnostic]);

  const onCalculatorStateChange = React.useCallback(
    (nextState: unknown) => {
      setLocalCalculatorState(nextState);
      void persistCalculatorState(nextState).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Practice] calculator state persist failed", err);
      });
    },
    [persistCalculatorState],
  );

  const typedError = error as Record<string, unknown> | null;
  const isConflict =
    typedError !== null &&
    typeof typedError === "object" &&
    typedError.code === "CLIENT_INSTANCE_CONFLICT";
  const isLimit =
    typedError !== null &&
    typeof typedError === "object" &&
    typedError.code === "SESSION_LIMIT_EXCEEDED";

  const handleForceTakeover = React.useCallback(() => {
    setForceTakeover(true);
    setTimeout(() => {
      fetchNextQuestion();
    }, 10);
  }, [fetchNextQuestion, setForceTakeover]);

  const showCalculator = isMathSection(question?.section);
  const useSidePanel = showCalculator && isCalculatorExpanded && splitEnabled;

  const calculatorToggle = showCalculator ? (
    <div className="flex gap-2">
      <Button
        variant="outline"
        type="button"
        size="sm"
        onClick={() => setIsReferenceOpen(true)}
      >
        Reference Sheet
      </Button>
      <Button
        variant="outline"
        type="button"
        size="sm"
        onClick={() => setIsCalculatorExpanded((prev) => !prev)}
        aria-expanded={isCalculatorExpanded}
        data-testid="practice-calculator-toggle"
      >
        <Calculator className="h-3.5 w-3.5 mr-1" />
        {isCalculatorExpanded ? "Hide" : "Calculator"}
      </Button>
    </div>
  ) : null;

  // W4-1 / W4-4: LISA beside the question, scoped to the served item, open
  // on every question in an engine that has it (review). Practice has no
  // LISA and no entry point: `features.tutor` is off there.
  const canAskTutor =
    engine.features.tutor && !!sessionItemId && !!question && !runtimeDisabled;
  const tutorVisible =
    canAskTutor && !!sessionItemId && tutorHiddenForItem !== sessionItemId;
  const questionLabel = `Question ${currentIndex + 1}${
    typeof totalQuestions === "number" ? ` / ${totalQuestions}` : ""
  }`;
  const tutorPanel =
    tutorVisible && sessionItemId ? (
      <ScopedTutorPanel
        sourceSurface={engine.domain === "review" ? "review" : "practice"}
        sessionItemId={sessionItemId}
        questionLabel={questionLabel}
        onHide={() => setTutorHiddenForItem(sessionItemId)}
      />
    ) : null;

  const questionContent = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center flex-wrap gap-2">
          <Badge
            variant="outline"
            className="uppercase tracking-wider text-[10px] font-semibold"
          >
            Question {currentIndex + 1}
            {typeof totalQuestions === "number" ? ` / ${totalQuestions}` : ""}
          </Badge>
          <Badge
            variant="outline"
            className="uppercase tracking-wider text-[10px] font-semibold"
          >
            {props.badgeLabel}
          </Badge>
          {props.difficulties &&
            props.difficulties.length > 0 &&
            props.difficulties.map((d) => (
              <Badge
                key={d}
                className={`text-[10px] border ${DIFFICULTY_COLORS[d]}`}
              >
                {DIFFICULTY_LABELS[d]}
              </Badge>
            ))}
          {props.domains &&
            props.domains.length > 0 &&
            props.domains.map((domain) => (
              <Badge
                key={domain}
                variant="secondary"
                className="text-[10px] max-w-[120px] truncate"
              >
                {domain}
              </Badge>
            ))}
        </div>
        <div className="flex items-center gap-3">
          {calculatorToggle}
          {canAskTutor && sessionItemId && (
            <Button
              variant="outline"
              type="button"
              size="sm"
              onClick={() =>
                setTutorHiddenForItem(tutorVisible ? sessionItemId : null)
              }
              aria-expanded={tutorVisible}
              data-testid="practice-tutor-toggle"
            >
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              {tutorVisible ? "Hide LISA" : "Show LISA"}
            </Button>
          )}
        </div>
      </div>

      {runtimeDisabled ? (
        <RuntimeContractDisabledCard
          domain={engine.domain}
          code={runtimeDisabled.code}
        />
      ) : isLoading && !question ? (
        <div className="flex flex-col items-center justify-center py-14 text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="mt-3 text-sm">Loading your practice session...</p>
        </div>
      ) : isConflict ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertCircle className="h-10 w-10 text-amber-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-amber-900 mb-2">
            Session Conflict
          </h3>
          <p className="text-sm text-amber-700 mb-6">
            This session is currently active in another browser tab or device.
            Resuming here will disconnect the other instance.
          </p>
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => window.location.assign(engine.backHref)}
            >
              Go Back
            </Button>
            <Button onClick={handleForceTakeover}>Resume Here</Button>
          </div>
        </div>
      ) : isLimit ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="h-10 w-10 text-red-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-900 mb-2">
            Session Limit Exceeded
          </h3>
          <p className="text-sm text-red-700 mb-6">
            {typedError?.message as string}
          </p>
          <Button onClick={() => window.location.assign(engine.backHref)}>
            Manage Sessions
          </Button>
        </div>
      ) : error && !question ? (
        <RecoveryNotice
          title="Unable to load session."
          message={String(error)}
          onRetry={() => void fetchNextQuestion()}
          retryLabel="Retry"
        />
      ) : !question ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-medium">No questions available right now.</p>
          <p className="mt-1">Try again in a moment or switch sections.</p>
          <Button
            className="mt-4"
            onClick={fetchNextQuestion}
            disabled={isLoading}
          >
            Check Again
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              {error}
            </div>
          )}

          <QuestionRenderer
            question={question}
            selectedAnswer={selectedAnswer}
            onSelectAnswer={setSelectedAnswer}
            freeResponseAnswer={freeResponseAnswer}
            onFreeResponseAnswerChange={setFreeResponseAnswer}
            showResult={showResult}
            isCorrect={isCorrect}
            correctOptionId={correctOptionId}
            correctAnswer={correctAnswer}
            explanation={explanation}
            disabled={isSubmitting || isLoading}
            onMissingMcChoices={handleMissingMcChoices}
          />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {!showResult ? (
              <>
                {/* Diagnostic mode: hide Skip (a skipped item breaks the 8×5
                    guarantee — that domain gets <5 mastery events → NULL
                    projection → no baseline) and End Session (abandon prevents
                    baseline capture). The diagnostic is finishable, not
                    discardable. */}
                {!isDiagnostic && (
                  <Button
                    variant="outline"
                    disabled={isSubmitting || isLoading || isEndingSession}
                    onClick={() => submitAnswer({ skipped: true })}
                  >
                    Skip
                  </Button>
                )}

                {!isDiagnostic && (
                  <Button
                    variant="ghost"
                    disabled={isSubmitting || isLoading || isEndingSession}
                    onClick={endSession}
                  >
                    End Session
                  </Button>
                )}

                <Button
                  disabled={
                    isSubmitting || isLoading || !canSubmit || isEndingSession
                  }
                  onClick={() => submitAnswer({ skipped: false })}
                >
                  Check Answer
                </Button>
              </>
            ) : null}

            {!showResult && submitBlocked && (
              <p
                className="w-full text-sm text-rose-600 mt-1"
                role="alert"
                aria-live="assertive"
              >
                {submitBlocked}
              </p>
            )}

            {showResult ? (
              <Button
                className="w-full"
                disabled={isSubmitting || isLoading || isEndingSession}
                onClick={() => {
                  if (currentIndex + 1 === totalQuestions) {
                    endSession();
                  } else {
                    nextQuestion();
                  }
                }}
              >
                {currentIndex + 1 === totalQuestions ? "Done" : "Next Question"}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </>
  );

  const sidePanelCalculator = (
    <div className="flex flex-col h-full py-4 pr-4">
      <DesmosCalculator
        expanded={isCalculatorExpanded}
        initialState={localCalculatorState}
        onStateChange={onCalculatorStateChange}
        fillHeight
      />
    </div>
  );

  const stackedCalculator = showCalculator ? (
    <Card className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Math Tools
        </p>
      </div>
      <DesmosCalculator
        expanded={isCalculatorExpanded}
        initialState={localCalculatorState}
        onStateChange={onCalculatorStateChange}
        className="w-full"
      />
    </Card>
  ) : null;

  const standardLayout = (
    <>
      {useSidePanel ? (
        <div ref={panelGroupRef} data-testid="practice-panel-group-container">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="lyceon-practice-calc-panel-px"
            onLayout={handleGroupLayout}
            className="min-h-[600px] rounded-2xl border border-border/60 bg-card"
          >
            <ResizablePanel
              defaultSize={QUESTION_DEFAULT_PCT}
              minSize={questionMinPct}
              style={{ minWidth: QUESTION_MIN_PX }}
            >
              <div className="p-6 h-full overflow-y-auto">
                {questionContent}
              </div>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="Resize question and calculator panels"
              aria-orientation="vertical"
              data-testid="practice-resize-handle"
            />
            <ResizablePanel
              ref={calcPanelRef}
              defaultSize={CALC_DEFAULT_PCT}
              minSize={calcMinPct}
              style={{ minWidth: CALC_MIN_PX }}
              onResize={handleCalcPanelResize}
              data-testid="practice-calc-panel"
            >
              {sidePanelCalculator}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <Card className="lg:col-span-8 rounded-2xl border border-border/60 bg-card p-6">
              {questionContent}
            </Card>

            <div className="lg:col-span-4 space-y-4">
              <Card className="rounded-2xl border border-border/60 bg-card p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
                  Session Guidance
                </p>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  {engine.labels.sessionGuidance}
                </p>
              </Card>
            </div>
          </div>

          {/* Below-breakpoint calculator: render full-width to guarantee
          Desmos host ≥ DESMOS_HOST_MIN_PX. Never in the narrow col-span-4
          sidebar — that yields ~330px at 1024px viewport. */}
          {showCalculator && !useSidePanel && (
            <div className="mt-6" data-testid="stacked-calculator-container">
              {stackedCalculator}
            </div>
          )}
        </>
      )}
    </>
  );

  // W4-4: review with LISA. Question and LISA side by side from `lg`; the
  // calculator sits between them from THREE_PANEL_BREAKPOINT, and below it
  // expands over LISA's column (LISA stays mounted underneath).
  const calcOpen = showCalculator && isCalculatorExpanded;
  const calcBesideQuestion = calcOpen && threePanelEnabled;
  const calcOverTutor = calcOpen && tutorSideBySide && !threePanelEnabled;
  const calcStacked = calcOpen && !tutorSideBySide;

  const guidanceCard = (
    <Card className="rounded-2xl border border-border/60 bg-card p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
        Session Guidance
      </p>
      <p className="text-sm text-foreground/90 leading-relaxed">
        {engine.labels.sessionGuidance}
      </p>
    </Card>
  );

  const reviewTutorLayout = (
    <div
      className="flex flex-col gap-6 lg:flex-row lg:items-start"
      data-testid="review-tutor-layout"
    >
      <div className="min-w-0 flex-1 space-y-6">
        {calcBesideQuestion ? (
          <div ref={panelGroupRef} data-testid="practice-panel-group-container">
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="lyceon-review-calc-panel-px"
              onLayout={handleGroupLayout}
              className="min-h-[600px] rounded-2xl border border-border/60 bg-card"
            >
              <ResizablePanel
                defaultSize={QUESTION_DEFAULT_PCT}
                minSize={questionMinPct}
                style={{ minWidth: QUESTION_MIN_PX }}
              >
                <div className="p-6 h-full overflow-y-auto">
                  {questionContent}
                </div>
              </ResizablePanel>
              <ResizableHandle
                withHandle
                aria-label="Resize question and calculator panels"
                aria-orientation="vertical"
                data-testid="practice-resize-handle"
              />
              <ResizablePanel
                ref={calcPanelRef}
                defaultSize={CALC_DEFAULT_PCT}
                minSize={calcMinPct}
                style={{ minWidth: CALC_MIN_PX }}
                onResize={handleCalcPanelResize}
                data-testid="practice-calc-panel"
              >
                {sidePanelCalculator}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <Card className="rounded-2xl border border-border/60 bg-card p-6">
            {questionContent}
          </Card>
        )}
        {guidanceCard}
      </div>

      <div
        className="relative h-[640px] w-full lg:sticky lg:top-24 lg:shrink-0"
        style={
          tutorSideBySide
            ? { width: calcOverTutor ? CALC_MIN_PX : TUTOR_PANEL_PX }
            : undefined
        }
        data-testid="review-tutor-column"
      >
        {/* LISA is never unmounted by the calculator: covered, not closed. */}
        <div
          className={calcOverTutor ? "invisible h-full" : "h-full"}
          aria-hidden={calcOverTutor || undefined}
          data-testid="practice-tutor-aside"
        >
          {tutorPanel}
        </div>
        {calcOverTutor && (
          <div
            className="absolute inset-0 z-10"
            data-testid="review-calc-over-tutor"
          >
            {sidePanelCalculator}
          </div>
        )}
      </div>

      {calcStacked && (
        <div data-testid="stacked-calculator-container">
          {stackedCalculator}
        </div>
      )}
    </div>
  );

  return (
    <PracticeShell
      title={props.title}
      eyebrow={engine.labels.shellEyebrow}
      backLink={engine.backHref}
      backLabel={engine.backLabel}
      score={{
        correct: score.correct,
        incorrect: score.incorrect,
        skipped: score.skipped,
        total: score.total,
        streak: score.streak,
      }}
      currentIndex={currentIndex}
      totalQuestions={totalQuestions}
      wide={tutorVisible}
    >
      {tutorVisible ? reviewTutorLayout : standardLayout}
      <MathReferenceSheet
        open={isReferenceOpen}
        onOpenChange={setIsReferenceOpen}
      />
    </PracticeShell>
  );
}
