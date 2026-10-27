/**
 * The LISA chat dock: the "Ask LISA" launcher (a speech-bubble button), bottom-right of the
 * column the student is working in, that grows upward into a chat panel. One component, used by
 * the runners (in the current question's scope) and by Home and Review (in general mode), at
 * tablet and desktop widths. Phones are unchanged.
 *
 * @spec [owner brief "LISA launcher redesign + placement" (Karl, 2026-10-23; option D; supersedes
 *        the round bubble of the brief below): "LISA belongs to the column where the student is
 *        working, never over the rail or the right panel". Home and Review: anchored to the
 *        bottom-right of the MIDDLE column (the shell's `main#main`), in view while it scrolls,
 *        the open panel within it at min(380px, column width - 24px). Runners: the bottom-right of
 *        the question area (the runner's scroll area), above Submit/Next, clear of the calculator
 *        (the offset rules of ruling 5 on #1300 kept). Opening lines (general mode): Home "What do
 *        you want to work on?", Review "Want help with your past mistakes?"; in a runner after
 *        submit "Want to walk through this one? Ask me about any step." (ScopedTutorPanel)]
 * @implemented [2026-10-23]
 *
 * @spec [owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26): in the practice and
 *        review runners the OPEN panel is a docked right column, not floating (`docked`, below);
 *        Home and Review keep the floating launcher and panel] | @implemented [2026-10-26]
 *
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22; revised: "floating bubble, no bar"):
 *        collapsed, a round LISA bubble named "Ask LISA"; expanded, a ~380px panel up to ~70vh with
 *        Minimize and Close; never over Submit/Next or the answer choices; clear of the safe area,
 *        the cookie banner and toasts; non-modal (Esc minimizes, role="dialog",
 *        aria-modal="false", labelled); one conversation thread with the LISA page; never opens by
 *        itself; free students see a lock and get the existing upgrade modal through the rail's
 *        own lock check; phones (<768px) unchanged. UI ONLY: no change to LISA's engine, prompts,
 *        safety, entitlement, usage limits or anti-leak rules]
 *       [DESIGN.md §1 (tokens only, 14px floor, hairlines not shadows, focus ring, motion only for
 *        the typing dots), §2 Free plan (LISA's lock opens the upgrade modal in place, with no
 *        call to the gated endpoint), §3 (Keyboard hook; Typing indicator), §4 LISA, Question
 *        runner; Doc-02B_V4 §21 (question awareness); closure plan W4-4, W4-11]
 * @implemented [2026-10-22]
 *
 * plain English:
 *   - Phones (below 768px, PHONE_WIDTH_QUERY) render nothing: the LISA tab and the runner's
 *     stacked panel stay as they were.
 *   - The launcher (LisaLauncher.tsx, 2026-10-23) replaces the round bubble; the `chat-dock-bubble`
 *     test id is kept for it, so the evidence groups and specs that find "the dock's entry" still do.
 *   - LOCKED (the feature-access map says `tutor_access` is locked, read with the rail's own
 *     `featureLockReason`): the launcher carries the rail's lock and opens the app's upgrade modal
 *     for `tutor_access` with the map's reason (`age` shows the age message). No tutor route is
 *     called: the dock's panel, which holds the hooks that would call them, never mounts.
 *   - Otherwise the launcher opens the panel, focused, named by its header (the sparkle and
 *     "LISA"). Minimize returns to the launcher and keeps the panel's state (the draft, the
 *     thread); Close returns to the launcher and drops it. Esc (the shared keyboard hook)
 *     minimizes. Nothing opens it but the student: a click on the launcher, or (2026-10-23) the
 *     runner's link after a wrong answer, through the `open()` handle. It is collapsed on every
 *     page load, and its state lasts for the page visit (component state, kept by the runner
 *     across questions).
 *   - Question scope: the item's own conversation, exactly as the phone panel finds and creates it
 *     (`ScopedTutorBody`; the client sends only the item id). General mode: the student's most
 *     recent active standalone conversation, the one at the top of the LISA page's history, else
 *     a new general conversation created on the first message, as /chat creates it; "Open in
 *     LISA" opens that same conversation on the LISA page.
 *   - The page stays usable (non-modal, no overlay, no focus trap). The dock sits in its column
 *     (`useDockColumn`), above whatever fixed chrome is at the bottom: the larger of (tab bar +
 *     cookie banner), the runner's Submit/Next footer and the column's own bottom edge, all but the
 *     last measured through lib/bottom-chrome.ts, plus the device's safe area. It is drawn below
 *     the toast layer (z-40 against the toasts' z-[100]), so a toast is never hidden by it, and
 *     below every modal.
 *
 * THE SERVER STILL DECIDES. A map can be stale: every tutor route refuses an unpaid student
 * first, and that refusal swaps the composer for the LISA upgrade card (TutorConversationBody).
 * The `role="dialog"` panel never carries `data-state`, so the cookie banner's "step aside while a
 * dialog is open" rule (index.css) does not hide the banner for a non-modal dock.
 *
 * PRIVACY. Nothing here logs, and the panel is `ph-no-capture` (SCL-204 / R32), as /chat is.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Minus, X } from "lucide-react";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { LOCK_SUFFIX, featureLockReason } from "@/components/layout/app-shell";
import { Pill } from "@/components/student-ui";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import {
  useLatestStandaloneConversation,
  type TutorSourceSurface,
} from "@/hooks/tutor-client";
import { PHONE_WIDTH_QUERY, useMediaQuery } from "@/hooks/use-mobile";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  buildEscapeKeymap,
  useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";
import {
  useBottomChromeHeight,
  useReportBottomChrome,
  type BottomChromeLayer,
} from "@/lib/bottom-chrome";
import { ScopedTutorBody } from "@/components/tutor/ScopedTutorPanel";
import {
  TutorConversationBody,
  existingFromQuery,
  type ExistingConversation,
  type TutorBodyCopy,
} from "@/components/tutor/TutorConversationBody";
import { LISA_COMPOSER_PLACEHOLDER } from "@/components/tutor/TutorThreadParts";
import {
  LISA_LAUNCHER_LABEL,
  LISA_LAUNCHER_WIDTH_PX,
  LisaLauncher,
  LisaSparkle,
} from "@/components/tutor/LisaLauncher";

/** Where a general-mode dock is: its opening line follows the page (owner brief 2026-10-23). */
type ChatDockGeneralSurface = "home" | "review";

/** What the dock is about: one question in a runner, or LISA in general (Home, Review). */
export type ChatDockScope =
  | { kind: "general"; surface: ChatDockGeneralSurface }
  | {
      kind: "question";
      sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
      /** The served item; null between questions (the panel then shows its loading line). */
      sessionItemId: string | null;
      /** The runner's own "Question N of M" (OQ-54), shown as the header's chip. */
      questionLabel: string;
      /** The runner's `showResult` (the server's submit response): picks the opener's line. */
      submitted: boolean;
    };

/** What a page may ask of the dock: open its panel (the runner's link after a wrong answer). */
export type ChatDockHandle = {
  /** As a click on the launcher: the panel when unlocked, the upgrade modal when locked. */
  open: () => void;
};

/** The launcher's distance from its column's right edge and from the bottom chrome. */
const DOCK_EDGE_PX = 16;

/**
 * How much of its column's right edge the launcher takes, with an 8px gap: a runner whose
 * question column would reach into it keeps this much clear on its right (CanonicalPracticePage).
 */
export const DOCK_CLEARANCE_PX = DOCK_EDGE_PX + LISA_LAUNCHER_WIDTH_PX + 8;

/** The open panel's width cap and its inset from the column's edges (owner brief 2026-10-23). */
const DOCK_PANEL_MAX_PX = 380;
const DOCK_PANEL_COLUMN_INSET_PX = 24;

/**
 * What a box ending at the runner footer's top keeps clear under a drawn bubble of `bubblePx`
 * (the `dock-bubble` layer): the bubble sits DOCK_EDGE_PX above the footer, plus an 8px gap.
 */
export function dockBubbleClearance(bubblePx: number): number {
  return bubblePx > 0 ? bubblePx + DOCK_EDGE_PX + 8 : 0;
}

/** Fixed chrome that stacks (the cookie banner sits on top of the phone tab bar). */
const STACKED_CHROME: readonly BottomChromeLayer[] = ["tab-bar", "consent"];
/** The runner's footer, which the cookie banner (when shown) covers rather than sits on. */
const RUNNER_FOOTER: readonly BottomChromeLayer[] = ["runner-footer"];

/** Owner copy (Karl, 2026-10-23, LISA launcher brief): the general-mode opening line per page. */
const DOCK_OPENER: Readonly<Record<ChatDockGeneralSurface, string>> = {
  home: "What do you want to work on?",
  review: "Want help with your past mistakes?",
};

function generalCopy(surface: ChatDockGeneralSurface): TutorBodyCopy {
  return {
    opener: { title: null, body: DOCK_OPENER[surface] },
    placeholder: LISA_COMPOSER_PLACEHOLDER,
    logLabel: "Conversation with LISA",
  };
}

const NO_CONVERSATION: ExistingConversation = {
  id: null,
  isLoading: false,
  error: null,
};

function chatHref(conversationId: string | null): string {
  return conversationId === null
    ? "/chat"
    : `/chat?conversationId=${encodeURIComponent(conversationId)}`;
}

/** The fixed chrome at the bottom of the screen, in px: what the dock always stays above. */
function useBottomChrome(): number {
  const stacked = useBottomChromeHeight(STACKED_CHROME);
  const footer = useBottomChromeHeight(RUNNER_FOOTER);
  return Math.max(stacked, footer);
}

/**
 * The dock's column, measured: its right edge's distance from the screen's right (the scrollbar
 * excluded), its bottom edge's distance from the screen's bottom (0 while it runs below the
 * screen), and its inner width. Null before it is laid out, or with no column (a test's bare
 * render): the dock then sits at the screen's own bottom-right, as before.
 */
type DockColumn = { right: number; bottom: number; width: number };

function measureColumn(el: HTMLElement): DockColumn | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return null;
  return {
    right: Math.max(0, window.innerWidth - (rect.left + el.clientWidth)),
    bottom: Math.max(0, window.innerHeight - rect.bottom),
    width: el.clientWidth,
  };
}

function sameColumn(a: DockColumn | null, b: DockColumn | null): boolean {
  if (a === null || b === null) return a === b;
  return a.right === b.right && a.bottom === b.bottom && a.width === b.width;
}

/**
 * @spec [owner brief "LISA launcher redesign + placement" (Karl, 2026-10-23): "anchored to the
 *       bottom-right of the MIDDLE column. Stays in view while the middle column scrolls; never
 *       overlaps the rail or the right panel"] | @implemented [2026-10-23]
 * plain English: follows the column `anchor` names (a runner's scroll area), else the App shell's
 * middle column (`main#main`, the one landmark every app-shell page has). Re-measured when the
 * column resizes, the window resizes, or anything scrolls (below lg the page itself scrolls and
 * the right panel stacks under the column, so the column's bottom edge rises into view; the dock
 * rides up with it rather than over the panel). A measurement that has not changed sets no state.
 */
function useDockColumn(
  anchor: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
): DockColumn | null {
  const [column, setColumn] = useState<DockColumn | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const el = anchor?.current ?? document.getElementById("main");
    if (el === null) return undefined;
    // Measured at once (a browser fires scroll and resize at most once a frame).
    const update = (): void => {
      const next = measureColumn(el);
      setColumn((prev) => (sameColumn(prev, next) ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true });
      observer?.disconnect();
    };
  }, [anchor, enabled]);
  return column;
}

/**
 * @spec [owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26): "LISA is a docked
 *       right column, full height of the runner body, not a floating panel ... Minimizing LISA
 *       collapses its column to the Ask LISA launcher ... Reopening restores the column"; "Home
 *       and Review keep the floating launcher"] | @implemented [2026-10-26]
 * plain English: a runner's dock. The OPEN panel is drawn into the runner's own right column
 * (`slot`, portalled) instead of floating; minimized or closed, the dock is the same floating
 * launcher as everywhere else, and the runner hides the column so the question and the
 * calculator take the space back. One panel implementation for both placements (DockPanel).
 */
export type ChatDockDocked = {
  /** The runner's LISA column; the open (and the minimized, hidden) panel is portalled into it. */
  slot: HTMLElement | null;
  /** Open on mount: the review runner starts with LISA docked open (Karl, 2026-10-26). */
  defaultOpen: boolean;
  /** Told on every open, minimize and close, so the runner lays its column out. */
  onOpenChange: (open: boolean) => void;
  /**
   * @spec [owner ruling on #1322 (Karl, 2026-10-26): below W3 "the calculator and the docked
   *       LISA column are mutually exclusive ... the most recently opened tool wins"; "an
   *       automatic fallback-minimize should not count as the student's own minimize"]
   *       | @implemented [2026-10-26]
   * plain English: the runner has given LISA's place to the calculator. The dock SHOWS as
   * minimized (the launcher, the panel hidden with its draft and thread) without changing its
   * own open state, so the student's own choice is untouched; the launcher (or the runner's
   * link) then opens it as usual, which tells the runner LISA is wanted again.
   */
  suppressed?: boolean;
};

type ChatDockProps = {
  scope: ChatDockScope;
  /**
   * The column the dock belongs to (owner brief 2026-10-23): a runner passes its question area's
   * scroll element. Omitted on Home and Review: the App shell's middle column (`main#main`).
   */
  anchor?: RefObject<HTMLElement | null>;
  /** A runner's docked column (2026-10-26); omitted on Home and Review (the floating panel). */
  docked?: ChatDockDocked;
};

export const ChatDock = forwardRef<ChatDockHandle, ChatDockProps>(
  function ChatDock({ scope, anchor, docked }, handle): JSX.Element | null {
    const isPhone = useMediaQuery(PHONE_WIDTH_QUERY, false);
    const access = useFeatureAccess();
    // The rail's own reading of the OQ-29 map: the same lock, never re-derived.
    const lockReason = featureLockReason("tutor_access", access);
    const upgrade = useUpgradeModal();
    const chrome = useBottomChrome();
    const column = useDockColumn(anchor, !isPhone);
    // Above the bottom chrome, and never below the column's own bottom edge.
    const lift = Math.max(chrome, column?.bottom ?? 0) + DOCK_EDGE_PX;

    /** "collapsed": the bubble. "open": the panel. "minimized": the bubble, panel kept. */
    const [view, setViewState] = useState<"collapsed" | "open" | "minimized">(
      docked?.defaultOpen === true ? "open" : "collapsed",
    );
    // Docked (a runner): the runner lays its column out from this, so every change is told.
    const setView = (next: "collapsed" | "open" | "minimized"): void => {
      setViewState(next);
      docked?.onOpenChange(next === "open");
    };
    const bubbleRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    // Where focus goes after the view changes: into the panel on open, back to the bubble after.
    const focusTarget = useRef<"panel" | "bubble" | null>(null);

    // What is drawn: a docked dock the runner has suppressed shows as minimized (2026-10-26).
    const suppressed = docked?.suppressed === true;
    const shownView = suppressed && view === "open" ? "minimized" : view;
    const isOpen = shownView === "open";
    // Opening and closing are the student's clicks (and Esc); focus follows them, once each.
    useEffect(() => {
      const target = focusTarget.current;
      focusTarget.current = null;
      if (target === "panel") panelRef.current?.focus();
      if (target === "bubble") bubbleRef.current?.focus();
    }, [shownView]);

    const openFromLauncher = (): void => {
      if (lockReason !== null) {
        upgrade.open("tutor_access", lockReason);
        return;
      }
      focusTarget.current = "panel";
      setView("open");
    };
    useImperativeHandle(handle, () => ({ open: openFromLauncher }));

    const minimize = (): void => {
      focusTarget.current = "bubble";
      setView("minimized");
    };
    const close = (): void => {
      focusTarget.current = "bubble";
      setView("collapsed");
    };
    if (isPhone) return null;

    const bottom = `calc(${lift}px + env(safe-area-inset-bottom, 0px))`;
    const locked = lockReason !== null;
    const bubbleLabel = locked
      ? `${LISA_LAUNCHER_LABEL}, ${LOCK_SUFFIX[lockReason]}`
      : LISA_LAUNCHER_LABEL;
    // In its column (16px in from the column's right edge); else the screen's bottom-right.
    const right =
      column === null
        ? `calc(${DOCK_EDGE_PX}px + env(safe-area-inset-right, 0px))`
        : `${column.right + DOCK_EDGE_PX}px`;
    const panelWidth =
      column === null
        ? `min(${DOCK_PANEL_MAX_PX}px, calc(100vw - ${DOCK_EDGE_PX * 2}px))`
        : `${Math.max(0, Math.min(DOCK_PANEL_MAX_PX, column.width - DOCK_PANEL_COLUMN_INSET_PX))}px`;

    // The panel stays mounted once opened (minimized keeps the draft and the thread) and
    // unmounts on Close. Locked: it never mounts, so no tutor route is called.
    const panel =
      !locked && view !== "collapsed" ? (
        <DockPanel
          panelRef={panelRef}
          titleId={titleId}
          scope={scope}
          hidden={!isOpen}
          lift={lift}
          width={panelWidth}
          docked={docked !== undefined}
          onMinimize={minimize}
          onClose={close}
        />
      ) : null;

    return (
      <div
        className="pointer-events-none fixed z-40 flex flex-col items-end"
        style={{ bottom, right }}
        data-testid="chat-dock"
        data-scope={scope.kind}
        data-view={shownView}
        data-placement={docked === undefined ? "floating" : "docked"}
      >
        {docked === undefined
          ? panel
          : panel !== null && docked.slot !== null
            ? createPortal(panel, docked.slot)
            : null}
        {isOpen ? null : (
          <DockBubbleReport bubbleRef={bubbleRef}>
            <LisaLauncher
              ref={bubbleRef}
              label={bubbleLabel}
              locked={locked}
              onClick={openFromLauncher}
            />
          </DockBubbleReport>
        )}
      </div>
    );
  },
);

/**
 * @spec [owner ruling 5 on #1300 (Karl, 2026-10-23): "the bubble must never cover the
 *       calculator ... reuse the existing bottom-chrome/layer mechanism"] | @implemented [2026-10-23]
 * plain English: while the bubble is drawn, its measured height is the `dock-bubble` layer of
 * lib/bottom-chrome.ts; the runner's side-panel calculator keeps that much (plus the bubble's
 * distance from the footer) clear at its bottom. Its own component so the report starts and stops
 * with the bubble (the open panel replaces it, and then nothing is reported).
 */
function DockBubbleReport({
  bubbleRef,
  children,
}: {
  bubbleRef: MutableRefObject<HTMLButtonElement | null>;
  children: ReactNode;
}): JSX.Element {
  useReportBottomChrome(bubbleRef, "dock-bubble");
  return <>{children}</>;
}

/**
 * The expanded dock. Mounted with the panel (the first open), so the Esc binding attaches to it:
 * the shared keyboard hook reads its target once, on mount. Esc minimizes and goes no further
 * (`stopPropagation`), so the runner's own keys never see it.
 */
function DockPanel({
  panelRef,
  titleId,
  scope,
  hidden,
  lift,
  width,
  docked,
  onMinimize,
  onClose,
}: {
  panelRef: MutableRefObject<HTMLElement | null>;
  titleId: string;
  scope: ChatDockScope;
  hidden: boolean;
  lift: number;
  /** min(380px, the column's width - 24px) (owner brief 2026-10-23). */
  width: string;
  /** In a runner's column (2026-10-26): it fills the column instead of sizing itself. */
  docked: boolean;
  onMinimize: () => void;
  onClose: () => void;
}): JSX.Element {
  useKeyboardShortcuts(
    buildEscapeKeymap(onMinimize, { stopPropagation: true }),
    { target: panelRef, enabled: !hidden },
  );
  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      hidden={hidden}
      // SCL-204 / R32: `ph-no-capture` — the LISA conversation is never recorded.
      // `hidden` as a class too: the `flex` display would otherwise override the attribute and
      // leave a minimized panel on screen (found by tests/e2e/lisa-dock.spec.ts).
      className={`ph-no-capture pointer-events-auto ${hidden ? "hidden" : "flex"} flex-col overflow-hidden rounded-lg border border-lyc-rule-strong bg-lyc-sheet text-lyc-ink ${LYC_FOCUS}`}
      style={
        docked
          ? { width: "100%", height: "100%" }
          : {
              width,
              height: `min(70vh, calc(100dvh - ${lift}px - ${DOCK_EDGE_PX * 2}px))`,
            }
      }
      data-testid="chat-dock-panel"
      data-placement={docked ? "docked" : "floating"}
    >
      <DockHeader
        titleId={titleId}
        scope={scope}
        onMinimize={onMinimize}
        onClose={onClose}
      />
      {scope.kind === "question" ? (
        scope.sessionItemId !== null ? (
          <ScopedTutorBody
            sourceSurface={scope.sourceSurface}
            sessionItemId={scope.sessionItemId}
            submitted={scope.submitted}
            onEnded={() => undefined}
          />
        ) : (
          <p
            className="m-0 flex-1 p-4 text-lyc-body text-lyc-muted"
            role="status"
          >
            Loading the next question…
          </p>
        )
      ) : (
        <GeneralDockBody surface={scope.surface} />
      )}
    </section>
  );
}

function DockHeader({
  titleId,
  scope,
  onMinimize,
  onClose,
}: {
  titleId: string;
  scope: ChatDockScope;
  onMinimize: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-lyc-rule bg-lyc-paper px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* Owner brief 2026-10-23: the panel's header shows the sparkle and "LISA". */}
        <span className="flex shrink-0 text-lyc-ink-strong">
          <LisaSparkle />
        </span>
        <h2
          id={titleId}
          className="m-0 font-lyc-serif text-lyc-body font-semibold text-lyc-ink-strong"
        >
          LISA
        </h2>
        {scope.kind === "question" ? (
          <Pill className="truncate" data-testid="tutor-question-chip">
            {scope.questionLabel}
          </Pill>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="lyc-quiet"
          size="lyc-icon"
          onClick={onMinimize}
          aria-label="Minimize LISA"
          data-testid="chat-dock-minimize"
          className="text-lyc-body"
        >
          <Minus aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="lyc-quiet"
          size="lyc-icon"
          onClick={onClose}
          aria-label="Close LISA"
          data-testid="chat-dock-close"
          className="text-lyc-body"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

/**
 * General mode: the LISA page's thread. The most recent active standalone conversation (the top
 * of the page's history), else a general conversation created on the first message, the way
 * /chat creates one. After the student ends it here, the dock starts a fresh one on the next
 * message (as /chat's End leaves an empty column), instead of falling back to an older thread.
 *
 * "Open in LISA": approved wording (Karl, 2026-10-23, ruling 3 on #1300).
 */
function GeneralDockBody({
  surface,
}: {
  surface: ChatDockGeneralSurface;
}): JSX.Element {
  const [freshAfterEnd, setFreshAfterEnd] = useState(false);
  const latest = useLatestStandaloneConversation(!freshAfterEnd);
  const existing = freshAfterEnd ? NO_CONVERSATION : existingFromQuery(latest);
  return (
    <>
      <p className="m-0 shrink-0 border-b border-lyc-rule px-4 py-2 text-lyc-meta">
        <Link
          href={chatHref(existing.id)}
          className={`${LYC_FOCUS} rounded-sm font-semibold text-lyc-ink-strong underline underline-offset-2`}
          data-testid="chat-dock-open-page"
        >
          Open in LISA
        </Link>
      </p>
      <TutorConversationBody
        scopeKey="general"
        lookup={existing}
        createInput={{ entry_mode: "general", source_surface: "dashboard" }}
        copy={generalCopy(surface)}
        onStarted={() => setFreshAfterEnd(false)}
        onEnded={() => setFreshAfterEnd(true)}
      />
    </>
  );
}
