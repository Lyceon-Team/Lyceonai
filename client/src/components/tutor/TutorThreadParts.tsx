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
 */

import { useEffect, useRef } from "react";
import {
  ArrowRight,
  Send,
  Loader2,
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
        <pre className="my-2 overflow-x-auto rounded bg-black/10 p-2 text-xs dark:bg-white/10">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
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
  const dim = size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-sm";
  return (
    <div
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold`}
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
      className={`flex gap-3 ${isStudent ? "justify-end" : "justify-start"}`}
      data-testid={isStudent ? "student-bubble" : "tutor-bubble"}
      data-client-turn-id={message.client_turn_id ?? undefined}
      data-pending={pending ? "true" : undefined}
    >
      {!isStudent && <LisaAvatar />}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isStudent
            ? "bg-primary text-primary-foreground"
            : "bg-card border border-border text-foreground"
        }`}
        aria-label={isStudent ? "You said:" : "LISA said:"}
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
// ThinkingIndicator — matches mockup artboard 2
// ---------------------------------------------------------------------------

export function ThinkingIndicator() {
  return (
    <div
      className="flex gap-3 justify-start"
      role="status"
      aria-label="LISA is thinking"
    >
      <LisaAvatar />
      <div className="flex items-center gap-2 rounded-2xl bg-card border border-border px-4 py-3">
        <span className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
        </span>
        <span className="text-sm text-muted-foreground">
          LISA is thinking...
        </span>
        <span className="sr-only">LISA is thinking</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FailedTurnNotice — matches mockup artboard 3
// ---------------------------------------------------------------------------

export function FailedTurnNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4" />
      <span>LISA couldn&apos;t respond to this message.</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px] min-w-[44px] justify-center"
        aria-label="Try again"
      >
        <RefreshCw className="h-3.5 w-3.5" />
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

  const bgClass = isCrisis
    ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
    : "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800";

  const iconClass = isCrisis ? "text-emerald-600" : "text-purple-600";
  const Icon = isCrisis ? Heart : Shield;

  const phoneNumbers = extractPhoneNumbers(content);
  const smsNumbers = extractSmsNumbers(content);

  return (
    <div className={`rounded-2xl border p-5 ${bgClass}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`h-5 w-5 ${iconClass}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          Support
        </span>
      </div>
      <div className="text-sm leading-relaxed text-foreground mb-4 whitespace-pre-wrap">
        {content}
      </div>
      <div className="flex flex-wrap gap-2">
        {phoneNumbers.map((num) => (
          <a
            key={num}
            href={`tel:${num.replace(/[^0-9+]/g, "")}`}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium min-h-[44px] transition-colors ${
              isCrisis
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            <Phone className="h-4 w-4" />
            Call {num}
          </a>
        ))}
        {smsNumbers.map((num) => (
          <a
            key={`sms-${num}`}
            href={`sms:${num.replace(/[^0-9+]/g, "")}`}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary min-h-[44px] transition-colors"
          >
            <MessageSquareText className="h-4 w-4" />
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
}: {
  onEnd: () => void;
  onContinue: () => void;
  endPending: boolean;
  resumePending: boolean;
}) {
  return (
    <div className="border-t border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Tutoring is paused
          </p>
          <p className="text-xs text-muted-foreground">
            Take whatever time you need. Pick up again whenever you&apos;re
            ready.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onEnd}
            disabled={endPending || resumePending}
            className="min-h-[44px] min-w-[44px]"
          >
            {endPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            End session
          </Button>
          <Button
            size="sm"
            onClick={onContinue}
            disabled={endPending || resumePending}
            className="min-h-[44px] min-w-[44px]"
          >
            {resumePending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
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

export function Composer({
  draft,
  onDraftChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && draft.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="border-t border-border bg-background p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="relative"
        aria-label="Send a message to LISA"
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="resize-none pr-12 min-h-[44px] rounded-xl"
          aria-label="Message"
          aria-busy={disabled}
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || !draft.trim()}
          className="absolute right-2 bottom-2 rounded-full h-9 w-9 min-h-[44px] min-w-[44px]"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        LISA can make mistakes. Your practice results are the source of truth.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll-to-bottom helper
// ---------------------------------------------------------------------------

export function useScrollToBottomOnChange(
  anchorRef: React.RefObject<HTMLDivElement | null>,
  trigger: number,
): void {
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trigger, anchorRef]);
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
    <div className="flex justify-start pl-11">
      <a
        href={PRACTICE_HANDOFF_HREF}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
        data-testid="tutor-start-practice"
      >
        {action.label ?? "Start a practice question"}
        <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
}
