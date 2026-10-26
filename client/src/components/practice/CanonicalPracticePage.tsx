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
 * The domain and difficulty came back on 2026-10-13 by owner brief (Karl, "Question metadata
 * header" §1) with the skill: `QuestionMetaHeader` above the question, three small neutral pills
 * (ruled on #1225 the same day: the shared `Pill`, difficulty not colour-coded, the skill a
 * focus stop).
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
 * The calculator layout (pixel floor) is unchanged from W4-4/E10b: see the constants and the
 * notes beside each layout below.
 *
 * @updated 2026-10-22 — owner brief "LISA chat dock" (Karl): from 768px up (tablet and desktop)
 * LISA is the chat dock (`ChatDock`), a floating bubble bottom-right that opens a panel in the
 * current question's scope, instead of the 360px panel beside the question. The bubble sits above
 * the Submit / Next footer (the footer reports its height through lib/bottom-chrome.ts), and where
 * the question column would reach under it (below DOCK_COLUMN_CLEAR_PX) the column keeps the
 * bubble's width clear on its right, so it never covers Submit, Next or a choice. The W4-4
 * side-by-side layout (LISA open on every question from 1024px, the three-panel breakpoint, the
 * calculator covering LISA's column) is gone with the panel it laid out. Below 768px (phones)
 * nothing changed: LISA stacks under the question, closed until Show LISA (QA2-D). Review has
 * LISA throughout (`features.tutor`).
 *
 * @updated 2026-10-23 — owner rulings on #1300 (Karl): (2) practice gets the dock POST-SUBMIT
 * only (`features.tutorAfterSubmit`), never in the diagnostic and never on a phone; (5) the bubble
 * never covers the calculator: beside the question, Desmos keeps the bubble's measured footprint
 * (the `dock-bubble` bottom-chrome layer) clear at its bottom.
 */
import React from "react";
import { useLocation } from "wouter";
import { BookOpen, Calculator, Loader2, MessageCircle } from "lucide-react";
import QuestionRenderer from "@/components/question-renderer";
import { QuestionMetaHeader } from "@/components/practice/QuestionMetaHeader";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import { Notice } from "@/components/student-ui";
import {
  ChatDock,
  DOCK_CLEARANCE_PX,
  dockBubbleClearance,
  type ChatDockHandle,
} from "@/components/tutor/ChatDock";
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
  CALC_COLUMN_HEIGHT_PX,
  CALC_DEFAULT_PCT,
  CALC_MIN_PCT,
  CALC_MIN_PX,
  DOCKED_CALC_MIN_PCT,
  DOCKED_LISA_COLUMN_PX,
  DOCKED_LISA_NARROW_COLUMN_PX,
  DOCKED_NARROW_SPLIT_BREAKPOINT,
  DOCKED_QUESTION_MIN_PCT,
  DOCKED_SPLIT_BREAKPOINT,
  QUESTION_DEFAULT_PCT,
  QUESTION_MIN_DOCKED_PX,
  QUESTION_MIN_PCT,
  QUESTION_MIN_PX,
  SPLIT_BREAKPOINT,
} from "@/components/math/calculator-layout";
import MathReferenceSheet from "@/components/math/MathReferenceSheet";
import { ScopedTutorPanel } from "@/components/tutor/ScopedTutorPanel";
import { PHONE_WIDTH_QUERY, useMediaQuery } from "@/hooks/use-mobile";
import {
  useBottomChromeHeight,
  useReportBottomChrome,
  type BottomChromeLayer,
} from "@/lib/bottom-chrome";
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

/**
 * Below 1024px the runner is the stacked (phone) layout: on a phone after Submit the feedback
 * panel is scrolled into view (first-run activation brief, 2026-10-13).
 */
const STACKED_LAYOUT_BELOW_PX = 1024;

/** The question column's width (`max-w-[760px]` below). */
const QUESTION_COLUMN_PX = 760;

/**
 * 2026-10-22 (owner brief "LISA chat dock": the bubble never covers the answer choices): from this
 * width the centred 760px column ends left of the launcher on its own. Below it the runner keeps
 * DOCK_CLEARANCE_PX clear on the right of the scroll area instead. The column's content sits 16px
 * inside its edge (`px-4`), hence the 16 back.
 * @updated 2026-10-23 (owner brief "LISA launcher", option D): the launcher is 132px wide where
 * the bubble was 56px, so the clearance is 156px and this width 1040px (was 888px): from 768px to
 * 1039px the scroll area keeps the launcher's strip clear.
 */
const DOCK_COLUMN_CLEAR_PX = QUESTION_COLUMN_PX + 2 * (DOCK_CLEARANCE_PX - 16); // 1040

/**
 * Owner copy (Karl, 2026-10-23, LISA launcher brief): the contextual entry point under the
 * explanation after a wrong answer.
 */
const ASK_LISA_AFTER_MISS = "Still confused? Ask LISA";

/** The LISA bubble's bottom-chrome layer (lib/bottom-chrome.ts), read by the side calculator. */
const DOCK_BUBBLE_LAYER: readonly BottomChromeLayer[] = ["dock-bubble"];

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

/**
 * QA2-D (2026-10-08): enough of the panel's top that its header (the question chip and Hide
 * LISA, ~48px) can be read.
 */
const TUTOR_HEADER_VISIBLE_PX = 48;

/**
 * QA2-D: is the LISA panel's top (its header) inside the runner's scroll area? The panel's
 * column (`practice-tutor-aside`) starts where the panel does. A missing element reads as not
 * in view, so a tap reveals rather than closes. 1px of slack for the sub-pixel position
 * `scrollIntoView` leaves.
 */
function panelTopInView(
  panel: HTMLElement | null,
  scroller: HTMLElement | null,
): boolean {
  if (panel === null || scroller === null) return false;
  const top = panel.getBoundingClientRect().top;
  const area = scroller.getBoundingClientRect();
  return top >= area.top - 1 && top <= area.bottom - TUTOR_HEADER_VISIBLE_PX;
}

function useSplitEnabled(): boolean {
  return useMinWidth(SPLIT_BREAKPOINT);
}

/**
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22): the bubble "never covers Submit/Next
 *       ... it offsets above them"] | @implemented [2026-10-22]
 * plain English: the runner's footer (Skip, Submit, Next question). It reports its measured
 * height as the `runner-footer` bottom-chrome layer while it is on screen, so the LISA bubble
 * sits above it. Its own component so the report starts when the footer mounts (the footer is
 * drawn only once a question is served).
 */
function RunnerFooter({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const ref = React.useRef<HTMLElement>(null);
  useReportBottomChrome(ref, "runner-footer");
  return (
    <footer
      ref={ref}
      data-testid="runner-footer"
      className="flex shrink-0 flex-col items-end gap-2 border-t border-lyc-rule bg-lyc-paper px-4 py-4 lg:px-8"
    >
      {children}
    </footer>
  );
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
  /** P0 item 3: the session closed; the page shows its summary instead of navigating away. */
  onSessionClosed?: () => void;
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
    noteCalculatorChange,
    commitCalculatorState,
    calculatorFlushRef,
    calculatorSaveFailed,
    submitBlocked,
    setForceTakeover,
    sessionItemId,
  } = useCanonicalPractice(props.section, sessionSpec, props.sessionId, engine);

  const [isCalculatorExpanded, setIsCalculatorExpanded] = React.useState(false);
  const [isReferenceOpen, setIsReferenceOpen] = React.useState(false);
  // QA 2026-10-07 item 8: the item whose LISA toggle the student last pressed. A panel that
  // mounts for it was opened by Show LISA, so on the phone layout (LISA stacked under the
  // question) it opens scrolled into view; LISA shown on load (W4-4) is not.
  const [tutorOpenedForItem, setTutorOpenedForItem] = React.useState<
    string | null
  >(null);
  /**
   * @spec [production QA 2026-10-08 item D (Karl: "Phone: the LISA panel defaults closed;
   *       tapping the icon always brings it into view."); W4-4 (LISA open on every question)
   *       kept where LISA sits beside the question] | @implemented [2026-10-08]
   * plain English: on a phone (below 768px since 2026-10-22, where LISA stacks under the
   * question) LISA starts closed on every question, and is open only for the item the student
   * opened it on. `tutorRevealKey` is bumped when the icon is tapped while LISA is open but
   * scrolled out of view: the panel reveals itself again instead of closing (see the toggle
   * below). From 768px up LISA is the chat dock instead.
   */
  const [tutorShownForItem, setTutorShownForItem] = React.useState<
    string | null
  >(null);
  const [tutorRevealKey, setTutorRevealKey] = React.useState(0);
  const runnerScrollRef = React.useRef<HTMLDivElement | null>(null);
  // The chat dock, opened by "Still confused? Ask LISA" (owner brief 2026-10-23).
  const dockRef = React.useRef<ChatDockHandle | null>(null);
  /**
   * @spec [owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26): "Review runner:
   *       LISA starts OPEN (docked) on entry; minimize persists for the rest of the session
   *       (across questions; per page visit/session state — no new server storage)"; "Practice
   *       unchanged (launcher after submit) ... when opened in a runner it docks as the column"]
   *       | @implemented [2026-10-26]
   * plain English: whether LISA's docked column is open. Review: open on entry, and the
   * student's minimize (or reopen) holds for the rest of the PAGE VISIT, across questions: it is
   * this runner's own state, which already lasts the visit and is reset by nothing but leaving
   * the page (a reload starts open again, as LISA always did in review, W4-4). No storage, no
   * server state. Practice: the column opens only when the student opens it, for the answered
   * item (the dock goes with Next, so the next item starts at the launcher again).
   */
  const [reviewLisaDocked, setReviewLisaDocked] = React.useState(true);
  const [practiceLisaDockedItem, setPracticeLisaDockedItem] = React.useState<
    string | null
  >(null);
  // The column the open panel is portalled into (ChatDock `docked.slot`).
  const [lisaSlot, setLisaSlot] = React.useState<HTMLDivElement | null>(null);
  const tutorAsideRef = React.useRef<HTMLDivElement | null>(null);
  const [localCalculatorState, setLocalCalculatorState] = React.useState<
    unknown | null
  >(null);

  const splitEnabled = useSplitEnabled();
  // 2026-10-26 (owner ruling on #1322): LISA's docked column is 360px from
  // DOCKED_SPLIT_BREAKPOINT (1338) and 300px below it; the calculator opens between the question
  // and LISA from W3 (DOCKED_NARROW_SPLIT_BREAKPOINT, 1278); below W3 the two take turns.
  const lisaColumnWide = useMinWidth(DOCKED_SPLIT_BREAKPOINT);
  const threeColumnsFit = useMinWidth(DOCKED_NARROW_SPLIT_BREAKPOINT);
  /**
   * @spec [owner ruling on #1322 (Karl, 2026-10-26): below W3 "opening the calculator minimizes
   *       LISA to the launcher; reopening LISA closes/minimizes the calculator; the most recently
   *       opened tool wins. Neither state loses data"; "an automatic fallback-minimize should not
   *       count as the student's own minimize"] | @implemented [2026-10-26]
   * plain English: which of the two the student opened last. Below W3, with both wanted, the
   * last one opened is shown: the calculator (LISA then shows as its launcher, the dock told
   * `suppressed`, the student's own open/minimized choice untouched) or LISA (opening it closes
   * the calculator, which keeps its Desmos state as any close does). Closing the calculator, or
   * a wider window, gives LISA back on its own, because the student never minimized it.
   */
  const [lastToolOpened, setLastToolOpened] = React.useState<"calc" | "lisa">(
    "lisa",
  );
  const wideLayout = useMinWidth(STACKED_LAYOUT_BELOW_PX);
  // 2026-10-22: phones keep the stacked panel; tablet and desktop get the chat dock.
  const isPhoneWidth = useMediaQuery(PHONE_WIDTH_QUERY, false);
  const dockClearsColumn = useMinWidth(DOCK_COLUMN_CLEAR_PX);

  /**
   * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: "Phone: after submit,
   *       scroll the explanation into view"] | @implemented [2026-10-13]
   * plain English: on the phone layout (below STACKED_LAYOUT_BELOW_PX, the stacked one) the
   * feedback panel with the explanation appears under the choices, usually below the fold, and
   * nothing moved: the student saw no change after Submit. Once per answered item, when its
   * feedback first shows, the runner scrolls the panel's top into view, instantly (DESIGN.md §1:
   * no motion but LISA's typing dots). Side by side nothing moves.
   */
  const feedbackScrolledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!showResult || wideLayout || !sessionItemId) return;
    if (feedbackScrolledFor.current === sessionItemId) return;
    feedbackScrolledFor.current = sessionItemId;
    const panel = runnerScrollRef.current?.querySelector<HTMLElement>(
      '[data-testid="runner-feedback"]',
    );
    if (!panel || typeof panel.scrollIntoView !== "function") return;
    panel.scrollIntoView({ block: "start", behavior: "auto" });
  }, [showResult, wideLayout, sessionItemId]);
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
  //
  // First-run activation brief (Karl, 2026-10-13) P0 item 3 | @implemented [2026-10-13]: a page
  // that shows the end-of-session summary passes `onSessionClosed` (it re-reads the session's
  // state, which is now completed, and draws the summary in place); then the runner does not
  // leave. Called once per closure (the ref), whatever the caller's function identity.
  const onSessionClosedRef = React.useRef(props.onSessionClosed);
  onSessionClosedRef.current = props.onSessionClosed;
  const closedHandled = React.useRef(false);
  React.useEffect(() => {
    const onClosed = onSessionClosedRef.current;
    if (sessionClosed && onClosed !== undefined) {
      if (!closedHandled.current) {
        closedHandled.current = true;
        onClosed();
      }
      return;
    }
    if (sessionClosed) navigate(completionDest);
  }, [sessionClosed, completionDest, navigate]);

  /**
   * @spec [Coding Standards §12.1, §13; register UI-10] | @implemented [2026-09-29]
   * plain English: a failed calculator-state save is surfaced to the student instead of the
   * console: the calculator keeps working from local state, and a notice says the work was not
   * saved. The next successful save clears it. Nothing is logged.
   *
   * @spec [register G-NEW-14; owner brief 2026-10-12] | @implemented [2026-10-12]
   * plain English: a change only updates the local copy and tells the saver; it is no longer a
   * request. The save moments are the hook's (useCanonicalPractice, calculator-saver.ts), plus
   * the calculator's own `onCommit` (tab switch, close, unmount).
   */
  const onCalculatorStateChange = React.useCallback(
    (nextState: unknown) => {
      setLocalCalculatorState(nextState);
      noteCalculatorChange(nextState);
    },
    [noteCalculatorChange],
  );
  const onCalculatorCommit = React.useCallback(() => {
    void commitCalculatorState();
  }, [commitCalculatorState]);

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

  // W4-1: LISA scoped to the served item, in an engine that has it (review). Practice has no
  // phone panel and no bar entry point (`features.tutor` is off there); since 2026-10-23 it has
  // the dock once the current question is submitted (`dockTutor` below).
  // 2026-10-22: on a phone, the stacked panel (closed until Show LISA, QA2-D); from 768px up,
  // the chat dock, mounted for the whole runner so its open state lasts the visit.
  const tutorSurface = engine.domain === "review" ? "review" : "practice";
  const canAskTutor = engine.features.tutor && !!sessionItemId && !!question;
  // Owner ruling 2 on #1300 (Karl, 2026-10-23): practice gets the dock post-submit only (the
  // bubble appears once the current question is answered or skipped and goes with Next); never
  // in the diagnostic, never on a phone.
  const dockTutor =
    !isPhoneWidth &&
    (engine.features.tutor ||
      (engine.features.tutorAfterSubmit && showResult && !isDiagnostic));
  // 2026-10-26: LISA's docked right column is open (see reviewLisaDocked above).
  const isReviewEngine = engine.domain === "review";
  // The student's own choice (open or minimized), then what is drawn.
  const lisaWanted =
    dockTutor &&
    (isReviewEngine
      ? reviewLisaDocked
      : sessionItemId !== null && practiceLisaDockedItem === sessionItemId);
  const lisaYieldsToCalculator =
    lisaWanted &&
    !threeColumnsFit &&
    showCalculator &&
    isCalculatorExpanded &&
    lastToolOpened === "calc";
  const lisaColumnOpen = lisaWanted && !lisaYieldsToCalculator;
  const lisaColumnPx = lisaColumnWide
    ? DOCKED_LISA_COLUMN_PX
    : DOCKED_LISA_NARROW_COLUMN_PX;
  const useSidePanel =
    showCalculator &&
    isCalculatorExpanded &&
    (lisaColumnOpen ? threeColumnsFit : splitEnabled);
  const tutorVisible =
    canAskTutor &&
    isPhoneWidth &&
    !!sessionItemId &&
    tutorShownForItem === sessionItemId;
  const position =
    typeof totalQuestions === "number"
      ? questionPosition(currentIndex, totalQuestions)
      : null;
  const questionLabel = position ?? `Question ${currentIndex + 1}`;
  const tutorPanel =
    tutorVisible && sessionItemId ? (
      <ScopedTutorPanel
        sourceSurface={tutorSurface}
        sessionItemId={sessionItemId}
        questionLabel={questionLabel}
        onHide={() => setTutorShownForItem(null)}
        revealOnOpen={tutorOpenedForItem === sessionItemId}
        revealKey={tutorRevealKey}
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
          className="hidden min-w-0 max-w-[45%] shrink-0 truncate font-lyc-serif text-[19px] font-semibold text-lyc-ink-strong sm:block"
        >
          {props.title}
        </span>
        <span className="flex-1" aria-hidden="true" />
        {position !== null && typeof totalQuestions === "number" ? (
          <>
            {/* QA 2026-10-07: a 54-question review made the bar 239px wider than a 1440 screen
                and 26px wider than a phone. On a phone the word "Question" is dropped from view
                (screen readers still hear it); the strip's segments shrink to fit, never below
                2px, instead of holding 14px each. */}
            <span
              data-testid="runner-position"
              className="shrink-0 whitespace-nowrap text-lyc-body text-lyc-ink"
            >
              <span className="sr-only sm:not-sr-only">Question </span>
              {position.replace(/^Question /, "")}
            </span>
            <span
              aria-hidden="true"
              data-testid="runner-progress"
              className="hidden min-w-0 shrink gap-1 lg:flex"
            >
              {progressSegments(currentIndex, totalQuestions).map((tone, i) => (
                <span
                  key={i}
                  data-segment={tone}
                  className={cn(
                    "h-1.5 w-3.5 min-w-[2px] shrink rounded-[3px]",
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
              onClick={() => {
                // 2026-10-26: opening it makes the calculator the last tool opened.
                if (!isCalculatorExpanded) setLastToolOpened("calc");
                setIsCalculatorExpanded(!isCalculatorExpanded);
              }}
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
        {canAskTutor && isPhoneWidth && sessionItemId ? (
          <button
            type="button"
            className={BAR_BUTTON}
            onClick={() => {
              // QA2-D, phone layout: the icon always brings LISA into view. Closed: open it,
              // revealed. Open but scrolled away: reveal it again (never close what the student
              // cannot see). Open and in view: close it.
              if (!tutorVisible) {
                setTutorShownForItem(sessionItemId);
                setTutorOpenedForItem(sessionItemId);
              } else if (
                !panelTopInView(tutorAsideRef.current, runnerScrollRef.current)
              ) {
                setTutorRevealKey((k) => k + 1);
              } else {
                setTutorShownForItem(null);
              }
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
      {/* Owner brief 2026-10-13 §1: domain · skill · difficulty on practice, review and the
          diagnostic (all three run in this page); never on the full-length module. */}
      <QuestionMetaHeader
        domain={question.domain}
        skill={question.skill}
        difficulty={question.difficulty}
      />
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
      {/* Owner brief "LISA launcher" (Karl, 2026-10-23): after a WRONG answer, under the
          explanation, one muted text link that opens the dock already scoped to this question.
          Only where the dock is: `dockTutor` already excludes the diagnostic and phones (a
          separate `!isDiagnostic` here could never be observed failing, so it is not repeated);
          never after a correct answer or before submit. `isCorrect` is the server's submit
          response (useCanonicalPractice), never inferred here. */}
      {dockTutor && showResult && isCorrect === false ? (
        <p className="m-0 mt-3">
          <button
            type="button"
            onClick={() => dockRef.current?.open()}
            className={`${LYC_FOCUS} cursor-pointer rounded-sm border-0 bg-transparent p-0 text-lyc-body text-lyc-muted underline underline-offset-2 hover:text-lyc-ink-strong`}
            data-testid="runner-ask-lisa"
          >
            {ASK_LISA_AFTER_MISS}
          </button>
        </p>
      ) : null}
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
    <RunnerFooter>
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
    </RunnerFooter>
  ) : null;

  // Owner ruling 5 on #1300 (Karl, 2026-10-23): the bubble never covers the calculator. Beside the
  // question (from SPLIT_BREAKPOINT) Desmos runs down to the footer, under the bubble, so it keeps
  // the bubble's measured footprint clear at its bottom. Stacked (below it), the calculator is in
  // the question column, which already clears the bubble (DOCK_COLUMN_CLEAR_PX and the gutter).
  const calcBubbleClear = dockBubbleClearance(
    useBottomChromeHeight(DOCK_BUBBLE_LAYER),
  );
  // Beside LISA's column (2026-10-26) the calculator keeps no right padding: its right edge is
  // LISA's left edge, one shared boundary.
  const sidePanelCalculator = (
    <div
      className={
        lisaColumnOpen
          ? "flex h-full flex-col py-4"
          : "flex h-full flex-col py-4 pr-4"
      }
      style={
        calcBubbleClear > 0 ? { paddingBottom: calcBubbleClear } : undefined
      }
      data-testid="side-panel-calculator"
    >
      <DesmosCalculator
        expanded={isCalculatorExpanded}
        initialState={localCalculatorState}
        onStateChange={onCalculatorStateChange}
        onCommit={onCalculatorCommit}
        flushRef={calculatorFlushRef}
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
        onCommit={onCalculatorCommit}
        flushRef={calculatorFlushRef}
        className="w-full"
      />
    </div>
  ) : null;

  // 2026-10-26: beside LISA's docked column the group fills the runner body exactly (no 600px
  // floor, so the body never scrolls and no scrollbar comes between the calculator and LISA),
  // keeps no right padding, sizes from the docked percentages and keeps its own saved layout.
  // The same no-floor body wherever the runner has the dock (2026-10-26, owner ruling on #1322):
  // on a short screen (650px tall) a 600px calculator ran down under the floating launcher,
  // below the fold, where the launcher's clearance at its bottom could not help.
  const standardLayout = useSidePanel ? (
    <div
      ref={panelGroupRef}
      className={lisaColumnOpen ? "h-full pl-4" : "h-full px-4"}
      data-testid="practice-panel-group-container"
    >
      <ResizablePanelGroup
        key={lisaColumnOpen ? "docked" : "alone"}
        direction="horizontal"
        autoSaveId={
          lisaColumnOpen
            ? "lyceon-practice-calc-docked-panel-px"
            : "lyceon-practice-calc-panel-px"
        }
        onLayout={handleGroupLayout}
        className={dockTutor ? "h-full" : "h-full min-h-[600px]"}
      >
        <ResizablePanel
          defaultSize={
            lisaColumnOpen ? 100 - DOCKED_CALC_MIN_PCT : QUESTION_DEFAULT_PCT
          }
          minSize={lisaColumnOpen ? DOCKED_QUESTION_MIN_PCT : questionMinPct}
          style={{
            minWidth: lisaColumnOpen ? QUESTION_MIN_DOCKED_PX : QUESTION_MIN_PX,
          }}
          data-testid="practice-question-panel"
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
          defaultSize={lisaColumnOpen ? DOCKED_CALC_MIN_PCT : CALC_DEFAULT_PCT}
          minSize={lisaColumnOpen ? DOCKED_CALC_MIN_PCT : calcMinPct}
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

  // Phones: review with LISA open stacks question, LISA, then the calculator (QA2-D).
  const calcStacked = showCalculator && isCalculatorExpanded;

  const reviewTutorLayout = (
    <div className="flex flex-col gap-6" data-testid="review-tutor-layout">
      <div className="min-w-0 flex-1">{questionColumn}</div>

      <div
        className="relative w-full px-4 pt-8"
        style={{ height: CALC_COLUMN_HEIGHT_PX }}
        data-testid="review-tutor-column"
      >
        <div
          ref={tutorAsideRef}
          className="h-full"
          data-testid="practice-tutor-aside"
        >
          {tutorPanel}
        </div>
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
      {/* 2026-10-26 (owner brief "restore the pre-#1300 runner layout"): the runner body is a
          row: the question area (and the calculator beside it) on the left, LISA's docked
          column on the right, full height, inset 12px from the top-right corner. Minimized,
          the column is hidden and the question area takes the width back. */}
      <div className="flex min-h-0 flex-1" data-testid="runner-row">
        <div
          ref={runnerScrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          // 2026-10-22: where the question column would reach under the LISA launcher (768px
          // to 1039px since 2026-10-23), the scroll area keeps the launcher's width clear on its
          // right. Not while LISA is docked open: then there is no launcher.
          style={
            dockTutor && !lisaColumnOpen && !dockClearsColumn
              ? { paddingRight: DOCK_CLEARANCE_PX }
              : undefined
          }
          data-testid="runner-scroll"
        >
          {tutorVisible ? reviewTutorLayout : standardLayout}
        </div>
        {dockTutor ? (
          <div
            ref={setLisaSlot}
            className={
              lisaColumnOpen
                ? "flex min-h-0 shrink-0 flex-col pb-3 pr-3 pt-3"
                : "hidden"
            }
            style={{ width: lisaColumnPx }}
            data-testid="runner-lisa-column"
            data-open={lisaColumnOpen ? "true" : "false"}
          />
        ) : null}
      </div>
      {footer}
      {/* Owner brief 2026-10-23: the launcher belongs to the question area (the scroll area
          above Submit/Next), and its opener follows the item's submit state. */}
      {dockTutor ? (
        <ChatDock
          ref={dockRef}
          anchor={runnerScrollRef}
          docked={{
            slot: lisaSlot,
            defaultOpen: isReviewEngine ? reviewLisaDocked : false,
            onOpenChange: (open) => {
              if (isReviewEngine) setReviewLisaDocked(open);
              else setPracticeLisaDockedItem(open ? sessionItemId : null);
              if (!open) return;
              // 2026-10-26: below W3, opening LISA makes it the last tool opened and closes the
              // calculator (its Desmos state kept, as on any close).
              setLastToolOpened("lisa");
              if (!threeColumnsFit && isCalculatorExpanded)
                setIsCalculatorExpanded(false);
            },
            suppressed: lisaYieldsToCalculator,
          }}
          scope={{
            kind: "question",
            sourceSurface: tutorSurface,
            sessionItemId: question ? sessionItemId : null,
            questionLabel,
            submitted: showResult,
          }}
        />
      ) : null}
      {showCalculator ? (
        <MathReferenceSheet
          open={isReferenceOpen}
          onOpenChange={setIsReferenceOpen}
        />
      ) : null}
    </div>
  );
}
