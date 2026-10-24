/**
 * The LISA chat dock: a floating round LISA bubble, bottom-right, that grows upward into a chat
 * panel. One component, used by the review runner (in the current question's scope) and by Home
 * and Review (in general mode), at tablet and desktop widths. Phones are unchanged.
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
 *   - LOCKED (the feature-access map says `tutor_access` is locked, read with the rail's own
 *     `featureLockReason`): the bubble carries the rail's lock and opens the app's upgrade modal
 *     for `tutor_access` with the map's reason (`age` shows the age message). No tutor route is
 *     called: the dock's panel, which holds the hooks that would call them, never mounts.
 *   - Otherwise the bubble opens the panel, focused, named by its header. Minimize returns to the
 *     bubble and keeps the panel's state (the draft, the thread); Close returns to the bubble and
 *     drops it. Esc (the shared keyboard hook) minimizes. Nothing opens it but a click: it is
 *     collapsed on every page load, and its state lasts for the page visit (component state, kept
 *     by the runner across questions).
 *   - Question scope: the item's own conversation, exactly as the phone panel finds and creates it
 *     (`ScopedTutorBody`; the client sends only the item id). General mode: the student's most
 *     recent active standalone conversation, the one at the top of the LISA page's history, else
 *     a new general conversation created on the first message, as /chat creates it; "Open in
 *     LISA" opens that same conversation on the LISA page.
 *   - The page stays usable (non-modal, no overlay, no focus trap). The dock sits above whatever
 *     fixed chrome is at the bottom: the larger of (tab bar + cookie banner) and the runner's
 *     Submit/Next footer, all measured through lib/bottom-chrome.ts, plus the device's safe
 *     area. It is drawn below the toast layer (z-40 against the toasts' z-[100]), so a toast is
 *     never hidden by it, and below every modal.
 *
 * THE SERVER STILL DECIDES. A map can be stale: every tutor route refuses an unpaid student
 * first, and that refusal swaps the composer for the LISA upgrade card (TutorConversationBody).
 * The `role="dialog"` panel never carries `data-state`, so the cookie banner's "step aside while a
 * dialog is open" rule (index.css) does not hide the banner for a non-modal dock.
 *
 * PRIVACY. Nothing here logs, and the panel is `ph-no-capture` (SCL-204 / R32), as /chat is.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Link } from "wouter";
import { Lock, Minus, X } from "lucide-react";
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
  type BottomChromeLayer,
} from "@/lib/bottom-chrome";
import { ScopedTutorBody } from "@/components/tutor/ScopedTutorPanel";
import {
  TutorConversationBody,
  existingFromQuery,
  type ExistingConversation,
  type TutorBodyCopy,
} from "@/components/tutor/TutorConversationBody";
import {
  LISA_COMPOSER_PLACEHOLDER,
  LISA_EMPTY_PROMPT,
  LisaAvatar,
} from "@/components/tutor/TutorThreadParts";

/** What the dock is about: one question in a runner, or LISA in general (Home, Review). */
export type ChatDockScope =
  | { kind: "general" }
  | {
      kind: "question";
      sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
      /** The served item; null between questions (the panel then shows its loading line). */
      sessionItemId: string | null;
      /** The runner's own "Question N of M" (OQ-54), shown as the header's chip. */
      questionLabel: string;
    };

/** The bubble's accessible name (owner brief). */
const DOCK_BUBBLE_NAME = "Ask LISA";

/** The bubble's diameter and its distance from the screen's right and bottom chrome. */
const DOCK_BUBBLE_PX = 56;
const DOCK_EDGE_PX = 16;

/**
 * How much of the screen's right edge the bubble takes, with an 8px gap: a runner whose question
 * column would reach into it keeps this much clear on its right (CanonicalPracticePage).
 */
export const DOCK_CLEARANCE_PX = DOCK_EDGE_PX + DOCK_BUBBLE_PX + 8;

/** Fixed chrome that stacks (the cookie banner sits on top of the phone tab bar). */
const STACKED_CHROME: readonly BottomChromeLayer[] = ["tab-bar", "consent"];
/** The runner's footer, which the cookie banner (when shown) covers rather than sits on. */
const RUNNER_FOOTER: readonly BottomChromeLayer[] = ["runner-footer"];

const GENERAL_COPY: TutorBodyCopy = {
  opener: { title: null, body: LISA_EMPTY_PROMPT },
  placeholder: LISA_COMPOSER_PLACEHOLDER,
  logLabel: "Conversation with LISA",
};

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

/** How far above the bottom of the screen the dock sits, in px (before the safe area). */
function useDockLift(): number {
  const stacked = useBottomChromeHeight(STACKED_CHROME);
  const footer = useBottomChromeHeight(RUNNER_FOOTER);
  return Math.max(stacked, footer) + DOCK_EDGE_PX;
}

export function ChatDock({
  scope,
}: {
  scope: ChatDockScope;
}): JSX.Element | null {
  const isPhone = useMediaQuery(PHONE_WIDTH_QUERY, false);
  const access = useFeatureAccess();
  // The rail's own reading of the OQ-29 map: the same lock, never re-derived.
  const lockReason = featureLockReason("tutor_access", access);
  const upgrade = useUpgradeModal();
  const lift = useDockLift();

  /** "collapsed": the bubble. "open": the panel. "minimized": the bubble, panel kept. */
  const [view, setView] = useState<"collapsed" | "open" | "minimized">(
    "collapsed",
  );
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Where focus goes after the view changes: into the panel on open, back to the bubble after.
  const focusTarget = useRef<"panel" | "bubble" | null>(null);

  const isOpen = view === "open";
  // Opening and closing are the student's clicks (and Esc); focus follows them, once each.
  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "panel") panelRef.current?.focus();
    if (target === "bubble") bubbleRef.current?.focus();
  }, [view]);

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
    ? `${DOCK_BUBBLE_NAME}, ${LOCK_SUFFIX[lockReason]}`
    : DOCK_BUBBLE_NAME;

  return (
    <div
      className="pointer-events-none fixed z-40 flex flex-col items-end"
      style={{
        bottom,
        right: `calc(${DOCK_EDGE_PX}px + env(safe-area-inset-right, 0px))`,
      }}
      data-testid="chat-dock"
      data-scope={scope.kind}
      data-view={view}
    >
      {/* The panel stays mounted once opened (minimized keeps the draft and the thread) and
          unmounts on Close. Locked: it never mounts, so no tutor route is called. */}
      {!locked && view !== "collapsed" ? (
        <DockPanel
          panelRef={panelRef}
          titleId={titleId}
          scope={scope}
          hidden={!isOpen}
          lift={lift}
          onMinimize={minimize}
          onClose={close}
        />
      ) : null}
      {isOpen ? null : (
        <button
          ref={bubbleRef}
          type="button"
          aria-label={bubbleLabel}
          aria-haspopup={locked ? "dialog" : undefined}
          aria-expanded={locked ? undefined : false}
          data-testid="chat-dock-bubble"
          data-locked={locked ? "true" : undefined}
          className={`${LYC_FOCUS} pointer-events-auto relative cursor-pointer rounded-full border-0 bg-transparent p-0`}
          style={{ width: DOCK_BUBBLE_PX, height: DOCK_BUBBLE_PX }}
          onClick={() => {
            if (lockReason !== null) {
              upgrade.open("tutor_access", lockReason);
              return;
            }
            focusTarget.current = "panel";
            setView("open");
          }}
        >
          <LisaAvatar size="bubble" />
          {locked ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-lyc-rule bg-lyc-paper"
            >
              <Lock
                data-testid="chat-dock-lock"
                className="h-3.5 w-3.5 text-lyc-lock"
                strokeWidth={2.25}
              />
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
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
  onMinimize,
  onClose,
}: {
  panelRef: MutableRefObject<HTMLElement | null>;
  titleId: string;
  scope: ChatDockScope;
  hidden: boolean;
  lift: number;
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
      className={`ph-no-capture pointer-events-auto ${hidden ? "hidden" : "flex"} w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-lyc-rule-strong bg-lyc-sheet text-lyc-ink ${LYC_FOCUS}`}
      style={{
        height: `min(70vh, calc(100dvh - ${lift}px - ${DOCK_EDGE_PX * 2}px))`,
      }}
      data-testid="chat-dock-panel"
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
        <GeneralDockBody />
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
        <LisaAvatar />
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
 */
function GeneralDockBody(): JSX.Element {
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
        copy={GENERAL_COPY}
        onStarted={() => setFreshAfterEnd(false)}
        onEnded={() => setFreshAfterEnd(true)}
      />
    </>
  );
}
