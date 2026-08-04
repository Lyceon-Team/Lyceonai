/**
 * @spec [Doc-02B_v4, §28 Math Tooling: Desmos and Formula Sheet] | @implemented [2026-07-26]
 * Canonical practice page with Bluebook-parity resizable calculator side-panel.
 *
 * Pixel-floor guarantee: the Desmos host is ≥DESMOS_HOST_MIN_PX at every
 * supported viewport, on first render, after resize, and in every fallback.
 *
 * The pixel floor is enforced by THREE cooperating mechanisms:
 *  1. CSS `min-width` on the calculator panel — browser-enforced, immediate.
 *  2. `onResize` callback + imperative Panel API — runtime clamp during drag.
 *  3. Conservative initial `minSize` percentage computed from SPLIT_BREAKPOINT —
 *     guarantees the correct size even before measurement.
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
import { AlertCircle, Calculator, Flag, Loader2 } from "lucide-react";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
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
 * Conservative percentages computed once at the known-minimum container width
 * (SPLIT_BREAKPOINT − APP_HORIZONTAL_PADDING). These guarantee the pixel floor
 * even on the very first render, before any container measurement occurs.
 * The CSS `min-width` on each panel is the TRUE pixel floor; these percentages
 * are a secondary constraint for smooth library-level drag bounding.
 */
const CONTAINER_AT_BREAKPOINT = SPLIT_BREAKPOINT - APP_HORIZONTAL_PADDING; // 1030
const CALC_MIN_PCT = Math.ceil((CALC_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100); // 49
const QUESTION_MIN_PCT = Math.ceil(
  (QUESTION_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100,
); // 49
const CALC_DEFAULT_PCT = CALC_MIN_PCT; // 49
const QUESTION_DEFAULT_PCT = 100 - CALC_DEFAULT_PCT; // 51

function useSplitEnabled(): boolean {
  const [enabled, setEnabled] = React.useState<boolean>(
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width: ${SPLIT_BREAKPOINT}px)`).matches
      : false,
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(min-width: ${SPLIT_BREAKPOINT}px)`);
    const onChange = (): void => setEnabled(mql.matches);
    mql.addEventListener("change", onChange);
    setEnabled(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return enabled;
}

/**
 * Dynamically recompute percentage-based minSize from a measured container.
 * This is a SECONDARY constraint — the CSS `min-width` on the panel is the
 * primary pixel floor. The dynamic percentage prevents the library from even
 * attempting to allocate less than the pixel minimum during drag, giving a
 * smoother UX at wider viewports where the conservative CALC_MIN_PCT would
 * be unnecessarily restrictive.
 */
function useDynamicMinPct(
  groupRef: React.RefObject<HTMLDivElement | null>,
  pixelMin: number,
  initialPct: number,
): number {
  const [minPct, setMinPct] = React.useState(initialPct);

  React.useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const compute = (): void => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) {
        setMinPct(Math.ceil((pixelMin / width) * 100));
      }
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [groupRef, pixelMin]);

  return minPct;
}

export default function CanonicalPracticePage(props: {
  title: string;
  badgeLabel: string;
  section: PracticeSectionParam;
  targetMinutes?: number;
  sessionId?: string | null;
  difficulties?: PracticeDifficulty[];
  domains?: string[];
}) {
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
    }),
    [props.targetMinutes, props.difficulties, props.domains],
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
  } = useCanonicalPractice(props.section, sessionSpec, props.sessionId);

  const [isEndingSession, setIsEndingSession] = React.useState(false);
  const [isCalculatorExpanded, setIsCalculatorExpanded] = React.useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = React.useState(false);
  const [localCalculatorState, setLocalCalculatorState] = React.useState<
    unknown | null
  >(null);

  const splitEnabled = useSplitEnabled();
  const panelGroupRef = React.useRef<HTMLDivElement | null>(null);
  const calcPanelRef = React.useRef<ImperativePanelHandle | null>(null);

  // Dynamic percentage constraints — secondary to CSS min-width pixel floor
  const calcMinPct = useDynamicMinPct(panelGroupRef, CALC_MIN_PX, CALC_MIN_PCT);
  const questionMinPct = useDynamicMinPct(
    panelGroupRef,
    QUESTION_MIN_PX,
    QUESTION_MIN_PCT,
  );

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

  const endSession = React.useCallback(async () => {
    if (isEndingSession) return;
    setIsEndingSession(true);
    try {
      await terminateSession();
      window.location.assign("/practice");
    } finally {
      setIsEndingSession(false);
    }
  }, [isEndingSession, terminateSession]);

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
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              Review tagging is available in full-length exam mode.
            </span>
          </div>
        </div>
      </div>

      {runtimeDisabled ? (
        <RuntimeContractDisabledCard
          domain="practice"
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
              onClick={() => window.location.assign("/practice")}
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
          <Button onClick={() => window.location.assign("/practice")}>
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
                <Button
                  variant="outline"
                  disabled={isSubmitting || isLoading || isEndingSession}
                  onClick={() => submitAnswer({ skipped: true })}
                >
                  Skip
                </Button>

                <Button
                  variant="ghost"
                  disabled={isSubmitting || isLoading || isEndingSession}
                  onClick={endSession}
                >
                  End Session
                </Button>

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

  return (
    <PracticeShell
      title={props.title}
      backLink="/practice"
      backLabel="Back to Practice"
      score={{
        correct: score.correct,
        incorrect: score.incorrect,
        skipped: score.skipped,
        total: score.total,
        streak: score.streak,
      }}
      currentIndex={currentIndex}
      totalQuestions={totalQuestions}
    >
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
                  Responses submit directly to canonical practice endpoints. If
                  you leave and return, Lyceon restores your unresolved state
                  from runtime session truth.
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
      <MathReferenceSheet
        open={isReferenceOpen}
        onOpenChange={setIsReferenceOpen}
      />
    </PracticeShell>
  );
}
