/**
 * The practice and review question runner, inside the Focus shell.
 *
 * @spec [DESIGN.md §4 Question runner (top bar: back, session name, "Question N of M" with a
 *        progress strip, Calculator, Reference; body: stem and lettered choices, then the
 *        feedback panel; footer: Skip and Submit, disabled until a choice, then Next question;
 *        keys ↑/↓, Enter, Enter or →); DESIGN.md §2 Focus shell, §3 Keyboard hook (no keystroke
 *        hint text); design/prototype/Runner.dc.html; student-UI register UI-53, §2, §9 OQ-22
 *        (session named by its criteria), OQ-35 (the shorter-session sentence, no number), OQ-49
 *        (light lock), §8 F-53 (skipping the last question finishes), F-64 (one /next per step);
 *        Doc-02B_v4 §28 (Desmos and the formula sheet)] | @implemented [2026-10-03]
 *
 * plain English: the route renders this inside the Focus shell (route-shells.ts), whose bar
 * already holds the back link to the section. This page portals the rest of the bar into it
 * (`FocusBarContext`): the session name, "Question N of M" with one segment per question, and
 * Calculator / Reference on Math items. The body is the question (QuestionRenderer) in a 760px
 * column; the footer holds Skip and Submit before submitting and "Next question" (or "Done" on
 * the last one) after. Everything is drawn on the student tokens.
 *
 * What the old runner had and this one does not (DESIGN.md draws none of it): the "Academic
 * practice runner" header with its answered/streak chips and progress pill (the PracticeShell),
 * the difficulty and domain badges, the "Session guidance" side card, and "End Session" (the
 * back link leaves with the place saved; Practice and Review end open sessions from their rows).
 *
 * Finishing: "Done" asks `/next` once more. The server answers 409 `session_closed` after the
 * last item (it completes the session if the last answer did not), the hook marks the session
 * completed, and this page goes to the completion destination. Skipping the last item ends the
 * same way (F-53). Nothing here abandons a session, so a shortened session (OQ-35) finishes as
 * completed, never abandoned.
 *
 * Anti-leak: this page holds no correctness before submit. `correctOptionId`, `correctAnswer`,
 * `explanation` and `isCorrect` come from the answer response only (useCanonicalPractice), and
 * LISA (review) is given the served item's id and the "Question N of M" label, nothing else;
 * what LISA may read is decided on the server (tutor-context.ts), choices in displayed order
 * with display letters (Step 0b).
 *
 * The calculator layout (pixel floor, three panels with LISA) is unchanged from W4-4/E10b:
 * see the constants and the notes beside each layout below.
 */
import React from "react";
import { useLocation } from "wouter";
import { BookOpen, Calculator, Loader2, MessageCircle } from "lucide-react";
import QuestionRenderer from "@/components/question-renderer";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import { Notice } from "@/components/student-ui";
import {
  CHECKING_LABEL,
  LOADING_LABEL,
  SKIPPING_LABEL,
} from "@/lib/pending-copy";
import { FocusBarContext } from "@/components/layout/FocusShell";
import {
  useCanonicalPractice,
  type PracticeSectionParam,
} from "@/hooks/useCanonicalPractice";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import {
  APP_HORIZONTAL_PADDING,
  BREAKPOINT_EXTRA,
  CALC_COLUMN_HEIGHT_PX,
  CALC_DEFAULT_PCT,
  CALC_MIN_PCT,
  CALC_MIN_PX,
  DIVIDER_PX,
  QUESTION_DEFAULT_PCT,
  QUESTION_MIN_PCT,
  QUESTION_MIN_PX,
  SPLIT_BREAKPOINT,
} from "@/components/math/calculator-layout";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import { ScopedTutorPanel } from "@/components/tutor/ScopedTutorPanel";
import {
  type EngineConfig,
  type ReviewSessionSpec,
  PRACTICE_ENGINE_CONFIG,
} from "@/lib/engine-config";
import type { PracticeDifficulty } from "@/lib/practice-filters";
import { cn } from "@/lib/utils";
import { isMathSection } from "@shared/section-display";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  buildRunnerKeymap,
  useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";

/*
 * W4-4 — review with LISA always open. Three panels share the width:
 *   question (≥ QUESTION_MIN_PX) | Desmos (≥ CALC_MIN_PX, when opened) | LISA.
 * Below THREE_PANEL_BREAKPOINT the calculator can no longer sit beside both,
 * so opening it expands Desmos over LISA's column (owner ruling 2026-09-25);
 * LISA stays mounted underneath, so its thread and turn state survive. Below
 * `lg` everything stacks: question, LISA, calculator.
 */
const TUTOR_PANEL_PX = 360;
const TUTOR_GAP_PX = 24;
const THREE_PANEL_BREAKPOINT =
  QUESTION_MIN_PX +
  DIVIDER_PX +
  CALC_MIN_PX +
  TUTOR_GAP_PX +
  TUTOR_PANEL_PX +
  APP_HORIZONTAL_PADDING +
  BREAKPOINT_EXTRA; // 1446
/** Tailwind's `lg`: below it, the review layout is a single column. */
const TUTOR_SIDE_BY_SIDE_BREAKPOINT = 1024;

/** OQ-35, owner ruling (Karl) 2026-10-02: the sentence, verbatim, with no number. */
const SHORTER_SESSION_NOTE =
  "Fewer questions match these filters, so this session is shorter.";

/** "Question 3 of 10" (DESIGN.md §4). */
function questionPosition(index: number, total: number): string {
  return `Question ${index + 1} of ${total}`;
}

/**
 * The progress strip (Runner.dc.html): one segment per question; answered ones in --ink-strong,
 * the current one in --rule-strong, the rest in --seg-empty.
 */
function progressSegments(
  index: number,
  total: number,
): Array<"done" | "current" | "todo"> {
  return Array.from({ length: total }, (_, i) =>
    i < index ? "done" : i === index ? "current" : "todo",
  );
}

const SEGMENT_TONE: Record<"done" | "current" | "todo", string> = {
  done: "bg-lyc-ink-strong",
  current: "bg-lyc-rule-strong",
  todo: "bg-lyc-seg-empty",
};

/** The bar's tool buttons (Runner.dc.html: 40px, 1px --input-bd, 15px semibold). */
const BAR_BUTTON = cn(
  LYC_FOCUS,
  "flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-md border border-lyc-input-bd bg-transparent px-2.5 text-lyc-meta-lg sm:px-3.5 font-semibold text-lyc-ink-strong hover:bg-lyc-hover",
);

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
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring] | @implemented 2026-08-14
 *
 * title: the session's name in the bar (OQ-22: from its criteria; "Diagnostic Assessment").
 * engine: which engine's endpoints and switches the loop uses (brief R4 §2.1).
 * completionHref: where the runner goes when the session is over. Defaults to the engine's.
 *   The diagnostic passes "/dashboard", where the baseline card is.
 * isDiagnostic: hides Skip. A skipped diagnostic item leaves its domain short of the evidence
 *   gate (the 8×5 guarantee needs all 40 answered).
 * shortened: OQ-35 — the server says the filters matched fewer questions than asked for.
 */
export default function CanonicalPracticePage(props: {
  title: string;
  section: PracticeSectionParam;
  targetMinutes?: number;
  sessionId?: string | null;
  difficulties?: PracticeDifficulty[];
  domains?: string[];
  completionHref?: string;
  isDiagnostic?: boolean;
  shortened?: boolean;
  engine?: EngineConfig;
  review?: ReviewSessionSpec;
}): JSX.Element {
  const engine = props.engine ?? PRACTICE_ENGINE_CONFIG;
  const [, navigate] = useLocation();
  /**
   * The diagnostic prop is honoured only by an engine that HAS a diagnostic mode.
   * Review's modes are `queue | session | filter`, so a stray `isDiagnostic` from a
   * review caller must not hide Skip on a review session.
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
    submitKind,
    showResult,
    isCorrect,
    correctOptionId,
    correctAnswer,
    explanation,
    currentIndex,
    totalQuestions,
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
    sessionItemId,
  } = useCanonicalPractice(props.section, sessionSpec, props.sessionId, engine);

  const [isCalculatorExpanded, setIsCalculatorExpanded] = React.useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = React.useState(false);
  // W4-4: LISA is open on every question; "Hide LISA" hides it for the
  // current one only. Derived per item, so it returns on the next.
  const [tutorHiddenForItem, setTutorHiddenForItem] = React.useState<
    string | null
  >(null);
  // QA 2026-10-07 item 8: the item whose LISA toggle the student last pressed. A panel that
  // mounts for it was opened by Show LISA, so on the phone layout (LISA stacked under the
  // question) it opens scrolled into view; LISA shown on load (W4-4) is not.
  const [tutorOpenedForItem, setTutorOpenedForItem] = React.useState<
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
  // breakpoint-minimum container width. CSS min-width is the true pixel floor.
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
   * ARIA controlled value = question panel width (separator position from left):
   *   aria-valuenow  = current question panel width in px
   *   aria-valuemin  = QUESTION_MIN_PX
   *   aria-valuemax  = groupWidth − CALC_MIN_PX
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

  // F-53: `/next` found no next item and the server closed the session (after "Done" on the
  // last question, or a skip of it), so the runner leaves for the completion destination,
  // client-side. Not on the last ANSWER: its feedback stays on screen until "Done".
  React.useEffect(() => {
    if (sessionClosed) navigate(completionDest);
  }, [sessionClosed, completionDest, navigate]);

  /**
   * @spec [Coding Standards §12.1, §13; register UI-10] | @implemented [2026-09-29]
   * plain English: a failed calculator-state save is surfaced to the student instead of the
   * console: the calculator keeps working from local state, and a notice says the work was not
   * saved. The next successful save clears it. Nothing is logged.
   */
  const [calculatorSaveFailed, setCalculatorSaveFailed] = React.useState(false);

  const onCalculatorStateChange = React.useCallback(
    (nextState: unknown) => {
      setLocalCalculatorState(nextState);
      persistCalculatorState(nextState).then(
        () => setCalculatorSaveFailed(false),
        () => setCalculatorSaveFailed(true),
      );
    },
    [persistCalculatorState],
  );

  const isLastQuestion =
    typeof totalQuestions === "number" && currentIndex + 1 === totalQuestions;
  const goNext = (): void => {
    void nextQuestion();
  };
  const runnerBusy = isSubmitting || isLoading;

  /**
   * @spec [student-UI register §2 Keyboard, UI-45; DESIGN.md §3, §4 Question runner keys]
   * | @implemented [2026-10-03]
   * plain English: the runner's keys through the one shared hook — ↑/↓ choose, Enter submits
   * (the selected option, or the typed grid-in answer from its box), and after feedback Enter
   * or → does exactly what the Next/Done button does. Every key is gated the way its button
   * is (busy, canSubmit), so the keyboard can never do what the buttons cannot.
   */
  useKeyboardShortcuts(
    buildRunnerKeymap({
      phase: showResult ? "feedback" : "answering",
      busy: runnerBusy,
      optionIds: (question?.options ?? []).map((o) => o.id),
      selectedOptionId: selectedAnswer,
      canSubmit,
      onSelectOption: setSelectedAnswer,
      onSubmit: () => void submitAnswer({ skipped: false }),
      onNext: goNext,
    }),
    { enabled: question !== null },
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
      void fetchNextQuestion();
    }, 10);
  }, [fetchNextQuestion, setForceTakeover]);

  const showCalculator = isMathSection(question?.section);
  const useSidePanel = showCalculator && isCalculatorExpanded && splitEnabled;

  // W4-1 / W4-4: LISA beside the question, scoped to the served item, open
  // on every question in an engine that has it (review). Practice has no
  // LISA and no entry point: `features.tutor` is off there.
  const canAskTutor = engine.features.tutor && !!sessionItemId && !!question;
  const tutorVisible =
    canAskTutor && !!sessionItemId && tutorHiddenForItem !== sessionItemId;
  const position =
    typeof totalQuestions === "number"
      ? questionPosition(currentIndex, totalQuestions)
      : null;
  const tutorPanel =
    tutorVisible && sessionItemId ? (
      <ScopedTutorPanel
        sourceSurface={engine.domain === "review" ? "review" : "practice"}
        sessionItemId={sessionItemId}
        questionLabel={position ?? `Question ${currentIndex + 1}`}
        onHide={() => setTutorHiddenForItem(sessionItemId)}
        revealOnOpen={!tutorSideBySide && tutorOpenedForItem === sessionItemId}
      />
    ) : null;

  // One wrapper in the shell's context slot, so the bar's spacing can tighten on a phone
  // (gap 12px below `sm`, 20px above, as Runner.dc.html's 20px).
  const bar = (
    <FocusBarContext>
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
        <span
          aria-hidden="true"
          className="hidden h-7 w-px shrink-0 bg-lyc-rule sm:block"
        />
        <span
          data-testid="runner-session-name"
          className="hidden min-w-0 truncate font-lyc-serif text-[19px] font-semibold text-lyc-ink-strong sm:block"
        >
          {props.title}
        </span>
        <span className="flex-1" aria-hidden="true" />
        {position !== null && typeof totalQuestions === "number" ? (
          <>
            <span
              data-testid="runner-position"
              className="shrink-0 whitespace-nowrap text-lyc-body text-lyc-ink"
            >
              {position}
            </span>
            <span
              aria-hidden="true"
              data-testid="runner-progress"
              className="hidden shrink-0 gap-1 lg:flex"
            >
              {progressSegments(currentIndex, totalQuestions).map((tone, i) => (
                <span
                  key={i}
                  data-segment={tone}
                  className={cn(
                    "h-1.5 w-3.5 rounded-[3px]",
                    SEGMENT_TONE[tone],
                  )}
                />
              ))}
            </span>
          </>
        ) : null}
        {showCalculator ? (
          <>
            <button
              type="button"
              className={BAR_BUTTON}
              onClick={() => setIsCalculatorExpanded((prev) => !prev)}
              aria-expanded={isCalculatorExpanded}
              aria-label="Calculator"
              data-testid="practice-calculator-toggle"
            >
              <Calculator aria-hidden="true" className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Calculator</span>
            </button>
            <button
              type="button"
              className={BAR_BUTTON}
              onClick={() => setIsReferenceOpen(true)}
              aria-label="Reference"
              data-testid="practice-reference-toggle"
            >
              <BookOpen aria-hidden="true" className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Reference</span>
            </button>
          </>
        ) : null}
        {canAskTutor && sessionItemId ? (
          <button
            type="button"
            className={BAR_BUTTON}
            onClick={() => {
              setTutorHiddenForItem(tutorVisible ? sessionItemId : null);
              // Read only while LISA is visible, so a hide may set it too.
              setTutorOpenedForItem(sessionItemId);
            }}
            aria-expanded={tutorVisible}
            data-testid="practice-tutor-toggle"
          >
            <MessageCircle aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">
              {tutorVisible ? "Hide LISA" : "Show LISA"}
            </span>
          </button>
        ) : null}
      </div>
    </FocusBarContext>
  );

  const stateBody =
    isLoading && !question ? (
      <div
        role="status"
        className="flex flex-col items-center justify-center py-14 text-lyc-muted"
      >
        <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin" />
        <p className="mt-3 text-lyc-body">{engine.labels.loading}</p>
      </div>
    ) : isConflict ? (
      <Notice
        tone="warning"
        title="Session Conflict"
        message="This session is currently active in another browser tab or device. Resuming here will disconnect the other instance."
        actionLabel="Resume Here"
        onAction={handleForceTakeover}
        secondaryActionLabel="Go Back"
        onSecondaryAction={() => navigate(engine.backHref)}
      />
    ) : isLimit ? (
      <Notice
        tone="danger"
        title="Session Limit Exceeded"
        message={
          typeof typedError?.message === "string" ? typedError.message : ""
        }
        actionLabel="Manage Sessions"
        onAction={() => navigate(engine.backHref)}
      />
    ) : error && !question ? (
      <Notice
        tone="danger"
        title="Unable to load session."
        message={String(error)}
        actionLabel="Retry"
        onAction={() => void fetchNextQuestion()}
      />
    ) : !question ? (
      sessionClosed ? null : (
        <Notice
          tone="neutral"
          title="No questions available right now."
          message="Try again in a moment or switch sections."
          actionLabel="Check Again"
          onAction={() => void fetchNextQuestion()}
        />
      )
    ) : null;

  const questionBody = question ? (
    <div className="flex flex-col gap-6">
      {props.shortened === true && currentIndex === 0 ? (
        <Notice
          tone="info"
          title={SHORTER_SESSION_NOTE}
          data-testid="runner-shorter-note"
        />
      ) : null}
      {error ? <Notice tone="danger" title={String(error)} /> : null}
      {calculatorSaveFailed ? (
        <Notice
          tone="warning"
          title="Your calculator work could not be saved."
          message="You can keep using it, but it may not be there if you reload this page."
          data-testid="practice-calculator-save-failed"
        />
      ) : null}
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
        missNote={engine.features.missNote}
        disabled={isSubmitting || isLoading}
        onMissingMcChoices={handleMissingMcChoices}
      />
    </div>
  ) : (
    stateBody
  );

  const questionColumn = (
    <div
      className="mx-auto w-full max-w-[760px] px-4 pb-8 pt-8 lg:pt-12"
      data-testid="runner-body"
    >
      {questionBody}
    </div>
  );

  const footer = question ? (
    <footer
      data-testid="runner-footer"
      className="flex shrink-0 flex-col items-end gap-2 border-t border-lyc-rule bg-lyc-paper px-4 py-4 lg:px-8"
    >
      {!showResult && submitBlocked ? (
        <p
          className="m-0 text-lyc-meta-lg text-lyc-danger"
          role="alert"
          aria-live="assertive"
        >
          {submitBlocked}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {!showResult ? (
          <>
            {/* Diagnostic: no Skip. A skipped item leaves its domain short of the 8×5 evidence
                the baseline needs; the diagnostic is finishable, not skippable. */}
            {!isDiagnostic ? (
              <Button
                variant="lyc-link"
                size="lyc"
                className="h-12 px-[18px]"
                disabled={runnerBusy}
                pending={submitKind === "skip"}
                onClick={() => void submitAnswer({ skipped: true })}
                data-testid="runner-skip"
              >
                {submitKind === "skip" ? SKIPPING_LABEL : "Skip"}
              </Button>
            ) : null}
            <Button
              variant="lyc-primary"
              size="lyc"
              className="h-12 px-[26px] text-[17px] disabled:opacity-45"
              disabled={runnerBusy || !canSubmit}
              pending={submitKind === "answer"}
              onClick={() => void submitAnswer({ skipped: false })}
              data-testid="runner-submit"
            >
              {submitKind === "answer" ? CHECKING_LABEL : "Submit"}
            </Button>
          </>
        ) : (
          <Button
            variant="lyc-primary"
            size="lyc"
            className="h-12 px-[26px] text-[17px]"
            disabled={runnerBusy}
            pending={isLoading}
            onClick={goNext}
            data-testid="runner-next"
          >
            {isLoading
              ? LOADING_LABEL
              : isLastQuestion
                ? "Done"
                : "Next question"}
          </Button>
        )}
      </div>
    </footer>
  ) : null;

  const sidePanelCalculator = (
    <div className="flex h-full flex-col py-4 pr-4">
      <DesmosCalculator
        expanded={isCalculatorExpanded}
        initialState={localCalculatorState}
        onStateChange={onCalculatorStateChange}
        fillHeight
      />
    </div>
  );

  // Mounted whenever the item is Math, expanded or not: DesmosCalculator collapses to zero
  // height when closed and keeps its instance and state.
  const stackedCalculator = showCalculator ? (
    <div
      className={
        isCalculatorExpanded
          ? "rounded-md border border-lyc-rule bg-lyc-sheet p-4"
          : undefined
      }
    >
      <DesmosCalculator
        expanded={isCalculatorExpanded}
        initialState={localCalculatorState}
        onStateChange={onCalculatorStateChange}
        className="w-full"
      />
    </div>
  ) : null;

  const standardLayout = useSidePanel ? (
    <div
      ref={panelGroupRef}
      className="h-full px-4"
      data-testid="practice-panel-group-container"
    >
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="lyceon-practice-calc-panel-px"
        onLayout={handleGroupLayout}
        className="h-full min-h-[600px]"
      >
        <ResizablePanel
          defaultSize={QUESTION_DEFAULT_PCT}
          minSize={questionMinPct}
          style={{ minWidth: QUESTION_MIN_PX }}
        >
          <div className="h-full overflow-y-auto">{questionColumn}</div>
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
      {questionColumn}
      {/* Below-breakpoint calculator: full width under the question, so the Desmos host keeps
          its DESMOS_HOST_MIN_PX floor. */}
      {showCalculator ? (
        <div
          className="mx-auto w-full max-w-[760px] px-4 pb-8"
          data-testid="stacked-calculator-container"
        >
          {stackedCalculator}
        </div>
      ) : null}
    </>
  );

  // W4-4: review with LISA. Question and LISA side by side from `lg`; the
  // calculator sits between them from THREE_PANEL_BREAKPOINT, and below it
  // expands over LISA's column (LISA stays mounted underneath).
  const calcOpen = showCalculator && isCalculatorExpanded;
  const calcBesideQuestion = calcOpen && threePanelEnabled;
  const calcOverTutor = calcOpen && tutorSideBySide && !threePanelEnabled;
  const calcStacked = calcOpen && !tutorSideBySide;

  const reviewTutorLayout = (
    <div
      className="flex flex-col gap-6 lg:flex-row lg:items-start lg:px-4"
      data-testid="review-tutor-layout"
    >
      <div className="min-w-0 flex-1">
        {calcBesideQuestion ? (
          <div ref={panelGroupRef} data-testid="practice-panel-group-container">
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="lyceon-review-calc-panel-px"
              onLayout={handleGroupLayout}
              className="min-h-[600px]"
            >
              <ResizablePanel
                defaultSize={QUESTION_DEFAULT_PCT}
                minSize={questionMinPct}
                style={{ minWidth: QUESTION_MIN_PX }}
              >
                <div className="h-full overflow-y-auto">{questionColumn}</div>
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
          questionColumn
        )}
      </div>

      <div
        className="relative w-full px-4 pt-8 lg:sticky lg:top-0 lg:shrink-0 lg:px-0"
        style={
          tutorSideBySide
            ? {
                height: CALC_COLUMN_HEIGHT_PX,
                width: calcOverTutor ? CALC_MIN_PX : TUTOR_PANEL_PX,
              }
            : { height: CALC_COLUMN_HEIGHT_PX }
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
        {calcOverTutor ? (
          <div
            className="absolute inset-0 z-10"
            data-testid="review-calc-over-tutor"
          >
            {sidePanelCalculator}
          </div>
        ) : null}
      </div>

      {calcStacked ? (
        <div className="pb-8" data-testid="stacked-calculator-container">
          {stackedCalculator}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="flex h-full flex-col bg-lyc-paper text-lyc-ink"
      data-testid="canonical-practice-runner"
    >
      {bar}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tutorVisible ? reviewTutorLayout : standardLayout}
      </div>
      {footer}
      {showCalculator ? (
        <MathReferenceSheet
          open={isReferenceOpen}
          onOpenChange={setIsReferenceOpen}
        />
      ) : null}
    </div>
  );
}
