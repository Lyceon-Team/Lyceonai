/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §2–§5; closure plan W4-1]
 * @implemented 2026-09-25
 *
 * plain English: the pieces a LISA thread is drawn with — bubbles, the
 * thinking indicator, the FailedTurn notice, the crisis/safeguarding support
 * card, the paused bar and the composer. Moved verbatim out of
 * `pages/chat.tsx` so the standalone chat and the in-review panel draw one
 * thread, not two that drift. Crisis content comes from the server response —
 * never hardcoded.
 *
 * @updated 2026-10-03 — UI-56 (student-UI register UI-56; DESIGN.md §1 tokens only, 14px floor,
 * motion only for the LISA dots and never under `prefers-reduced-motion`; §3 Typing indicator;
 * §4 LISA; prototype Lisa.dc.html): every part draws with the student tokens (`lyc-*`), so it
 * follows the theme on /chat and stays light inside a shell pinned light. A bubble carries a
 * "You" / "LISA" label above it (the prototype's), not an avatar. The typing indicator is a
 * LISA-labelled bubble with the three `.lyc-dot`s (student-tokens.css owns their pulse and its
 * reduced-motion rule) and no "thinking" sentence. The composer is the prototype's: a two-row
 * textarea, a "Send" button that is disabled while LISA is thinking, and the disclaimer
 * "LISA can make mistakes; your practice results are the source of truth." Nothing here logs:
 * a tutor exchange is never written anywhere but the server's own tables.
 */

import { useEffect, useRef } from "react";
import {
  ArrowRight,
  Phone,
  MessageSquareText,
  RefreshCw,
  AlertCircle,
  Heart,
  Shield,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MathRenderer } from "@/components/MathRenderer";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import {
  buildLisaComposerKeymap,
  useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";
import type {
  TutorMessage,
  CrisisCategory,
  TutorSuggestedAction,
} from "@/hooks/tutor-client";

// ---------------------------------------------------------------------------
// Tutor markdown rendering
// ---------------------------------------------------------------------------

const TUTOR_ALLOWED_ELEMENTS = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "br",
  "h3",
  "h4",
  "blockquote",
] as const;

const TUTOR_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: React.ReactNode;
  }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre className="my-2 overflow-x-auto rounded bg-lyc-chip p-2 text-[0.9em]">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-lyc-chip px-1 py-0.5 text-[0.9em]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
} as const;

function hasMathDelimiters(text: string): boolean {
  return /\$.*\$|\\\(.*\\\)|\\\[.*\\\]/s.test(text);
}

export function TutorMessageContent({ text }: { text: string }) {
  if (hasMathDelimiters(text)) {
    return <MathRenderer content={text} />;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={[...TUTOR_ALLOWED_ELEMENTS]}
      unwrapDisallowed
      components={TUTOR_MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// LISA Avatar
// ---------------------------------------------------------------------------

export function LisaAvatar({ size = "sm" }: { size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-lyc-meta";
  return (
    <div
      aria-hidden="true"
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-lyc-primary-bg font-lyc-serif font-semibold text-lyc-primary-ink`}
    >
      L
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

export function MessageBubble({
  message,
  pending = false,
}: {
  message: TutorMessage;
  pending?: boolean;
}) {
  const isStudent = message.role === "student";
  return (
    <div
      className={`flex flex-col gap-1.5 ${isStudent ? "items-end" : "items-start"}`}
      data-testid={isStudent ? "student-bubble" : "tutor-bubble"}
      data-client-turn-id={message.client_turn_id ?? undefined}
      data-pending={pending ? "true" : undefined}
    >
      <span className="text-lyc-meta font-semibold text-lyc-muted">
        {isStudent ? "You" : "LISA"}
      </span>
      <div
        className={`max-w-[min(658px,100%)] break-words rounded-[10px] px-[18px] py-3.5 text-[18px] leading-[1.6] ${
          isStudent
            ? "bg-lyc-primary-bg text-lyc-primary-ink"
            : "border border-lyc-rule bg-lyc-sheet text-lyc-ink"
        }`}
      >
        {isStudent ? (
          <span className="whitespace-pre-wrap">{message.message}</span>
        ) : (
          <TutorMessageContent text={message.message} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingIndicator — DESIGN.md §3 "Typing indicator"; prototype Lisa.dc.html
// ---------------------------------------------------------------------------

/**
 * A LISA-labelled bubble with three pulsing dots. The pulse is `.lyc-dot` in
 * student-tokens.css, the one animation DESIGN.md §1 allows, and its
 * `prefers-reduced-motion: reduce` rule stops it. The status is named for
 * assistive tech ("LISA is thinking"); nothing else is written.
 */
export function ThinkingIndicator() {
  return (
    <div
      className="flex flex-col items-start gap-1.5"
      role="status"
      aria-label="LISA is thinking"
      data-testid="lisa-typing"
    >
      <span className="text-lyc-meta font-semibold text-lyc-muted">LISA</span>
      <span
        aria-hidden="true"
        className="flex items-center gap-1.5 rounded-[10px] border border-lyc-rule bg-lyc-sheet px-[18px] py-4"
      >
        <span className="lyc-dot" />
        <span className="lyc-dot" />
        <span className="lyc-dot" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FailedTurnNotice — matches mockup artboard 3
// ---------------------------------------------------------------------------

export function FailedTurnNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-lyc-meta-lg text-lyc-muted">
      <AlertCircle aria-hidden="true" className="h-4 w-4" />
      <span>LISA couldn&apos;t respond to this message.</span>
      <button
        type="button"
        onClick={onRetry}
        className={`${LYC_FOCUS} inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border border-lyc-ink-strong bg-transparent px-3 py-1.5 text-lyc-meta font-semibold text-lyc-ink-strong hover:bg-lyc-hover`}
        aria-label="Try again"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrisisSupportCard — matches mockup artboard 5 (crisis) and 6 (safeguarding)
// Content comes from server response — never hardcoded.
// ---------------------------------------------------------------------------

export function CrisisSupportCard({
  lane,
  content,
}: {
  lane: CrisisCategory;
  content: string;
}) {
  const isCrisis = lane === "crisis";

  // The two lanes keep their two colours (green for crisis, plum for
  // safeguarding), now from token pairs that have a light and a dark value:
  // the emerald of `--lv4-*` and the plum of `--cat-rw-*`.
  const laneClass = isCrisis
    ? "border-lyc-lv4-bd bg-lyc-lv4-bg text-lyc-lv4-ink"
    : "border-lyc-cat-rw-bd bg-lyc-cat-rw-bg text-lyc-cat-rw-ink";
  const Icon = isCrisis ? Heart : Shield;

  const phoneNumbers = extractPhoneNumbers(content);
  const smsNumbers = extractSmsNumbers(content);

  return (
    <div
      className={`rounded-lg border p-5 ${laneClass}`}
      data-testid="crisis-support-card"
      data-lane={lane}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon aria-hidden="true" className="h-5 w-5" />
        <span className="text-lyc-meta font-semibold uppercase tracking-wide">
          Support
        </span>
      </div>
      <div className="mb-4 whitespace-pre-wrap text-lyc-body leading-relaxed text-lyc-ink">
        {content}
      </div>
      <div className="flex flex-wrap gap-2">
        {phoneNumbers.map((num) => (
          <a
            key={num}
            href={`tel:${num.replace(/[^0-9+]/g, "")}`}
            className={`${LYC_FOCUS} inline-flex min-h-[44px] items-center gap-2 rounded-md bg-lyc-primary-bg px-4 py-2.5 text-lyc-body font-semibold text-lyc-primary-ink no-underline hover:brightness-110`}
          >
            <Phone aria-hidden="true" className="h-4 w-4" />
            Call {num}
          </a>
        ))}
        {smsNumbers.map((num) => (
          <a
            key={`sms-${num}`}
            href={`sms:${num.replace(/[^0-9+]/g, "")}`}
            className={`${LYC_FOCUS} inline-flex min-h-[44px] items-center gap-2 rounded-md border border-lyc-ink-strong bg-transparent px-4 py-2.5 text-lyc-body font-semibold text-lyc-ink-strong no-underline hover:bg-lyc-hover`}
          >
            <MessageSquareText aria-hidden="true" className="h-4 w-4" />
            Text {num}
          </a>
        ))}
      </div>
    </div>
  );
}

function extractPhoneNumbers(text: string): string[] {
  const matches = text.match(
    /(?:call|Call|phone)\s*(?:or\s*text\s*)?(\d[\d\s\-().]+\d)/gi,
  );
  if (!matches) {
    const numMatches = text.match(/\b(\d{3})\b/g);
    if (numMatches) return [...new Set(numMatches)];
    return [];
  }
  return [
    ...new Set(
      matches.map((m) =>
        m.replace(/^(?:call|Call|phone)\s*(?:or\s*text\s*)?/i, "").trim(),
      ),
    ),
  ];
}

function extractSmsNumbers(text: string): string[] {
  const matches = text.match(/(?:text)\s+(\d[\d\s\-().]+\d)/gi);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/^text\s*/i, "").trim()))];
}

// ---------------------------------------------------------------------------
// PausedBar — "Tutoring is paused" replaces the composer
// ---------------------------------------------------------------------------

export function PausedBar({
  onEnd,
  onContinue,
  endPending,
  resumePending,
  inset = "page",
}: {
  onEnd: () => void;
  onContinue: () => void;
  endPending: boolean;
  resumePending: boolean;
  /** See `ThreadInset`. */
  inset?: ThreadInset;
}) {
  return (
    <div
      className={`shrink-0 border-t border-lyc-rule bg-lyc-paper py-4 ${THREAD_INSET_X[inset]}`}
    >
      <div className="mx-auto flex max-w-[760px] flex-wrap items-center justify-between gap-4">
        <div>
          <p className="m-0 text-lyc-body font-semibold text-lyc-ink-strong">
            Tutoring is paused
          </p>
          <p className="m-0 text-lyc-meta text-lyc-muted">
            Take whatever time you need. Pick up again whenever you&apos;re
            ready.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="lyc-outline"
            size="lyc"
            onClick={onEnd}
            disabled={endPending || resumePending}
          >
            End session
          </Button>
          <Button
            type="button"
            variant="lyc-primary"
            size="lyc"
            onClick={onContinue}
            disabled={endPending || resumePending}
          >
            Continue with LISA
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/** DESIGN.md §4 LISA; prototype Lisa.dc.html, word for word. */
export const LISA_DISCLAIMER =
  "LISA can make mistakes; your practice results are the source of truth.";

/**
 * Where a thread's bottom bar (composer, paused bar) sits. "page": the /chat column, 16px sides
 * and 40px from `lg` (Lisa.dc.html). "panel": the review runner's 360px LISA panel (UI-53,
 * OQ-54 (a), ruling 2026-10-05), 16px sides at every width, so the textarea keeps its room.
 */
export type ThreadInset = "page" | "panel";

const THREAD_INSET_X: Readonly<Record<ThreadInset, string>> = {
  page: "px-4 lg:px-10",
  panel: "px-4",
};

/** QA-5: the Send button's label while a message is on its way (the app's "Sending…" idiom). */
export const LISA_SEND_PENDING_LABEL = "Sending…";

/**
 * @spec [student-UI register UI-56, UI-53; QA 2026-10-07 item 5 (Karl: "LISA Send shows an
 *        immediate pressed/pending state (disabled, visible pending) from the first click,
 *        standalone and in the runner panel"); DESIGN.md §1 (no motion but the LISA dots)]
 *        | @implemented [2026-09-25; pending state 2026-10-07]
 *
 * plain English: the composer. `pending` and `disabled` are two different things. `pending`
 * means a message the student sent is on its way (its conversation being created, or LISA's
 * turn in flight): Send is disabled and SAYS so ("Sending…", aria-busy, full strength), in the
 * same render as the click, because every caller sets its pending state synchronously in its
 * submit handler. `disabled` means the thread cannot take a message at all: Send is faded. The
 * button keeps a minimum width that fits both labels, so the textarea does not jump when the
 * label changes. No spinner: DESIGN.md §1 allows no motion but the LISA dots.
 */
export function Composer({
  draft,
  onDraftChange,
  onSubmit,
  disabled,
  pending = false,
  placeholder,
  inset = "page",
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  /** The thread cannot take a message: Send is disabled and faded. */
  disabled: boolean;
  /** A sent message is on its way (its conversation created, or LISA thinking): "Sending…". */
  pending?: boolean;
  placeholder: string;
  /** See `ThreadInset`. */
  inset?: ThreadInset;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const blocked = disabled || pending;

  // @spec [student-UI register §2 Keyboard, UI-45; DESIGN.md §3] | @implemented [2026-10-03]
  // plain English: Enter sends and Shift+Enter adds a new line, through the one shared hook
  // listening on this textarea only. Enter that confirms an IME composition, Ctrl/Cmd/Alt+Enter
  // and a held-down Enter's repeats do not send.
  useKeyboardShortcuts(
    buildLisaComposerKeymap({
      canSend: !blocked && draft.trim().length > 0,
      onSend: onSubmit,
    }),
    { target: textareaRef },
  );

  return (
    <div
      className={`shrink-0 border-t border-lyc-rule bg-lyc-paper pb-[22px] pt-[18px] ${THREAD_INSET_X[inset]}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mx-auto flex max-w-[760px] flex-col gap-2"
        aria-label="Send a message to LISA"
      >
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            disabled={blocked}
            rows={2}
            className="min-h-[44px] min-w-0 flex-1 resize-none rounded-lg border border-lyc-input-bd bg-lyc-sheet px-3.5 py-3 font-lyc-sans text-[17px] leading-normal text-lyc-ink placeholder:text-lyc-muted disabled:cursor-not-allowed"
            aria-label="Message"
            aria-busy={pending || undefined}
          />
          <Button
            type="submit"
            variant="lyc-primary"
            size="lyc"
            disabled={blocked}
            className={`h-[50px] min-w-[118px] shrink-0 px-[22px] text-[17px] ${
              pending
                ? "disabled:cursor-progress disabled:opacity-100"
                : "disabled:cursor-not-allowed disabled:opacity-45"
            }`}
            aria-label="Send message"
            aria-busy={pending || undefined}
            data-pending={pending ? "true" : undefined}
          >
            {pending ? LISA_SEND_PENDING_LABEL : "Send"}
          </Button>
        </div>
        <p className="m-0 text-lyc-meta text-lyc-muted">{LISA_DISCLAIMER}</p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll-to-bottom helper
// ---------------------------------------------------------------------------

/**
 * Scrolls `anchorRef` into view whenever `trigger` changes. `block` is where the anchor lands:
 * "start" (the default) for an anchor at the end of a column that scrolls inside itself; "end"
 * for /chat on the phone layout (QA 2026-10-07 item 15), where the page scrolls and the anchor
 * is the end of the composer, so the last turn and the composer sit at the bottom of the screen.
 */
export function useScrollToBottomOnChange(
  anchorRef: React.RefObject<HTMLDivElement | null>,
  trigger: number | string,
  block: ScrollLogicalPosition = "start",
): void {
  useEffect(() => {
    // "auto", not "smooth": DESIGN.md §1 allows no motion but the LISA dots.
    anchorRef.current?.scrollIntoView({ behavior: "auto", block });
  }, [trigger, anchorRef, block]);
}

// ---------------------------------------------------------------------------
// SuggestedActionLink — LISA's handoff to practice (closure plan W3-2)
// ---------------------------------------------------------------------------

/** Where a practice handoff lands: the practice hub, which owns selection. */
export const PRACTICE_HANDOFF_HREF = "/practice";

/**
 * Renders the action LISA offered on its last turn. Only `start_practice` has
 * a surface today: LISA never writes a question — it hands off to practice,
 * which owns selection, serving, anti-leak, grading and mastery.
 */
export function SuggestedActionLink({
  action,
}: {
  action: TutorSuggestedAction | null;
}) {
  if (action?.type !== "start_practice") return null;
  return (
    <div className="flex justify-start">
      <a
        href={PRACTICE_HANDOFF_HREF}
        className={`${LYC_FOCUS} inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-lyc-ink-strong bg-transparent px-4 py-2 text-lyc-body font-semibold text-lyc-ink-strong no-underline hover:bg-lyc-hover`}
        data-testid="tutor-start-practice"
      >
        {action.label ?? "Start a practice question"}
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </a>
    </div>
  );
}
