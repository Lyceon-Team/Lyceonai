/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §2–§5]
 * @implemented 2026-09-23
 *
 * plain English: Standalone LISA chat page with sidebar, 8 UI states
 * (Main, Thinking, FailedTurn, NewSession, Crisis, Safeguarding,
 * EndSession, empty), client_turn_id idempotency (§3), and crisis/
 * safeguarding support cards driven entirely by server response content.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Send,
  Loader2,
  Plus,
  Phone,
  MessageSquareText,
  RefreshCw,
  AlertCircle,
  Menu,
  Heart,
  Shield,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MathRenderer } from "@/components/MathRenderer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useEndConversation,
  useResumeConversation,
  useSendMessage,
  type TutorMessage,
  type SendMessageResponse,
  type TutorConversationSummary,
  type CrisisCategory,
} from "@/hooks/tutor-client";
import { HttpApiError, mapTutorErrorToPremiumReason } from "@/lib/api-error";
import {
  PremiumUpgradePrompt,
  type PremiumPromptReason,
} from "@/components/billing/PremiumUpgradePrompt";

// ---------------------------------------------------------------------------
// TurnState — discriminated union per §3
// ---------------------------------------------------------------------------

type TurnState =
  | { kind: "idle" }
  | { kind: "thinking"; clientTurnId: string }
  | { kind: "failed"; clientTurnId: string; messageText: string }
  | { kind: "paused"; lane: CrisisCategory };

// ---------------------------------------------------------------------------
// Search param helper
// ---------------------------------------------------------------------------

function useConversationIdFromSearch(): string | null {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const raw = params.get("conversationId");
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

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

function TutorMessageContent({ text }: { text: string }) {
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
// Time formatting
// ---------------------------------------------------------------------------

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function subjectFromEntryMode(
  surface: string | null,
  sourceSurface: string,
): string {
  if (surface === "practice") return "Practice";
  if (surface === "review") return "Review";
  if (sourceSurface === "dashboard") return "";
  return sourceSurface.charAt(0).toUpperCase() + sourceSurface.slice(1);
}

// ---------------------------------------------------------------------------
// LISA Avatar
// ---------------------------------------------------------------------------

function LisaAvatar({ size = "sm" }: { size?: "sm" | "lg" }) {
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

function MessageBubble({
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

function ThinkingIndicator() {
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

function FailedTurnNotice({ onRetry }: { onRetry: () => void }) {
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

function CrisisSupportCard({
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

function PausedBar({
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
// EndSessionModal — matches mockup artboard 7
// ---------------------------------------------------------------------------

function EndSessionModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End this session?</DialogTitle>
          <DialogDescription>
            It will close and leave your sessions list. You won&apos;t be able
            to reopen it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            className="min-h-[44px]"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            End session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SessionsSidebar content
// ---------------------------------------------------------------------------

function SessionsListContent({
  conversations,
  activeId,
  onSelect,
  onNewSession,
  newSessionPending,
}: {
  conversations: TutorConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  newSessionPending: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-4 pb-2">
        <LisaAvatar />
        <span className="text-lg font-semibold text-foreground">LISA</span>
      </div>

      <button
        type="button"
        onClick={onNewSession}
        disabled={newSessionPending}
        className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
        aria-label="New session"
      >
        {newSessionPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        New session
      </button>

      <div className="mt-4 px-3">
        <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </p>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {conversations.map((conv) => (
          <button
            key={conv.conversation_id}
            type="button"
            onClick={() => onSelect(conv.conversation_id)}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors min-h-[44px] ${
              conv.conversation_id === activeId
                ? "bg-secondary"
                : "hover:bg-secondary/50"
            }`}
          >
            <p className="text-sm font-medium text-foreground truncate">
              {conv.title ?? "New session"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {subjectFromEntryMode(conv.surface, conv.source_surface)}
              {subjectFromEntryMode(conv.surface, conv.source_surface) && " · "}
              {formatRelativeDate(conv.updated_at)}
            </p>
          </button>
        ))}

        {conversations.length === 0 && (
          <p className="px-1 py-4 text-xs text-muted-foreground text-center">
            No sessions yet
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewSessionView — matches mockup artboard 4
// ---------------------------------------------------------------------------

function NewSessionView({
  onSendMessage,
}: {
  onSendMessage: (message: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LisaAvatar size="lg" />
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-foreground">
          What are we working on?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a section to start, or just ask a question below.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onSendMessage("Math")}
          className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
        >
          Math
        </button>
        <button
          type="button"
          onClick={() => onSendMessage("Reading & Writing")}
          className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors min-h-[44px]"
        >
          Reading & Writing
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
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

function useScrollToBottomOnChange(
  anchorRef: React.RefObject<HTMLDivElement | null>,
  trigger: number,
): void {
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trigger, anchorRef]);
}

// ---------------------------------------------------------------------------
// TIMEOUT — client times out at 35s (server's is 30s per §3)
// ---------------------------------------------------------------------------

const CLIENT_TIMEOUT_MS = 35_000;

// ---------------------------------------------------------------------------
// ChatPage — main component
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const conversationId = useConversationIdFromSearch();

  const { data: conversationDetail, isLoading } =
    useConversation(conversationId);
  const { data: conversationsList } = useConversations();
  const createConversation = useCreateConversation();
  const sendMessageMutation = useSendMessage();
  const endConversation = useEndConversation();
  const resumeConversation = useResumeConversation();

  const [draft, setDraft] = useState("");
  const [turnState, setTurnState] = useState<TurnState>({ kind: "idle" });
  // W2-10: the student's message as sent, shown at once — the thread itself
  // renders from the conversation query, which refetches only after the turn
  // resolves. Keyed by client_turn_id, the key the server persists: a retry
  // reuses the id (same bubble, never a second one), and the bubble yields to
  // the persisted row the moment the refetched thread carries that id. It is
  // never cleared on failure — the text stays on screen above FailedTurn.
  const [optimisticTurn, setOptimisticTurn] = useState<{
    clientTurnId: string;
    text: string;
    sentAt: string;
  } | null>(null);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dismissedPremium, setDismissedPremium] = useState(false);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversations = conversationsList?.conversations ?? [];
  const messages = conversationDetail?.messages ?? [];
  const conversation = conversationDetail?.conversation;

  // Shown until the persisted student row with the same client_turn_id is in
  // the thread — derived, not synced, so there is no frame where neither is.
  const optimisticMessage: TutorMessage | null =
    optimisticTurn !== null &&
    !messages.some(
      (m) =>
        m.role === "student" &&
        m.client_turn_id === optimisticTurn.clientTurnId,
    )
      ? {
          message_id: `optimistic-${optimisticTurn.clientTurnId}`,
          role: "student",
          content_kind: "message",
          message: optimisticTurn.text,
          created_at: optimisticTurn.sentAt,
          client_turn_id: optimisticTurn.clientTurnId,
        }
      : null;

  const isPaused = !!conversation?.crisis_paused_at;
  const isEnded = conversation?.status === "ended";
  const hasMessages = messages.length > 0 || optimisticMessage !== null;

  // Crisis state detection — from the conversation detail or from the last
  // send response. The server sets crisis_paused_at; the client reads it.
  const [crisisLane, setCrisisLane] = useState<CrisisCategory | null>(null);
  const [crisisContent, setCrisisContent] = useState<string>("");

  // Derive crisis content from the last tutor message when paused but
  // crisisContent state is empty (e.g. page reload — React state is lost,
  // but the server's crisis response is the last tutor message).
  const lastTutorMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tutor") return messages[i].message;
    }
    return "";
  }, [messages]);

  const effectiveCrisisContent = crisisContent || lastTutorMessage;

  // Derive crisis state from conversation detail or turn state
  const showCrisisCard = turnState.kind === "paused" || isPaused;

  // Scroll management
  const scrollTrigger =
    (messages.length + (optimisticMessage ? 1 : 0)) * 2 +
    (turnState.kind === "thinking" ? 1 : 0);
  useScrollToBottomOnChange(scrollAnchorRef, scrollTrigger);

  // Premium entitlement check
  const premiumReason: PremiumPromptReason | null = useMemo(() => {
    const sendErr = sendMessageMutation.error;
    return (
      sendErr ? mapTutorErrorToPremiumReason(sendErr) : null
    ) as PremiumPromptReason | null;
  }, [sendMessageMutation.error]);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Sync crisis state when conversation detail loads with crisis_paused_at set
  useEffect(() => {
    if (conversation?.crisis_paused_at && turnState.kind !== "paused") {
      const lane: CrisisCategory = crisisLane ?? "crisis";
      if (!crisisLane) setCrisisLane(lane);
      setTurnState({ kind: "paused", lane });
    }
  }, [conversation?.crisis_paused_at, turnState.kind, crisisLane]);

  // ── Navigation ────────────────────────────────────────────────────────

  const navigateToConversation = useCallback(
    (id: string) => {
      setLocation(`/chat?conversationId=${encodeURIComponent(id)}`);
      setTurnState({ kind: "idle" });
      setOptimisticTurn(null);
      setDraft("");
      setCrisisLane(null);
      setCrisisContent("");
      setMobileMenuOpen(false);
    },
    [setLocation],
  );

  // ── New session ───────────────────────────────────────────────────────

  const handleNewSession = useCallback(async () => {
    try {
      const conv = await createConversation.mutateAsync({
        entry_mode: "general",
        source_surface: "dashboard",
        idempotency_key: crypto.randomUUID(),
      });
      navigateToConversation(conv.conversation_id);
    } catch {
      // Error state handled by createConversation.error
    }
  }, [createConversation, navigateToConversation]);

  // ── Send message ──────────────────────────────────────────────────────

  const handleSendMessage = useCallback(
    async (messageText: string) => {
      if (!conversationId) return;
      const trimmed = messageText.trim();
      if (!trimmed) return;

      const clientTurnId =
        turnState.kind === "failed"
          ? turnState.clientTurnId
          : crypto.randomUUID();

      setTurnState({ kind: "thinking", clientTurnId });
      // Same id on retry → the same bubble, updated in place.
      setOptimisticTurn({
        clientTurnId,
        text: trimmed,
        sentAt: new Date().toISOString(),
      });
      setDraft("");
      sendMessageMutation.reset();

      timeoutRef.current = setTimeout(() => {
        setTurnState({
          kind: "failed",
          clientTurnId,
          messageText: trimmed,
        });
      }, CLIENT_TIMEOUT_MS);

      try {
        const response: SendMessageResponse =
          await sendMessageMutation.mutateAsync({
            conversation_id: conversationId,
            message: trimmed,
            client_turn_id: clientTurnId,
          });

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (response.crisis_paused && response.response.crisis_category) {
          setCrisisLane(response.response.crisis_category);
          setCrisisContent(response.response.content);
          setTurnState({
            kind: "paused",
            lane: response.response.crisis_category,
          });
        } else {
          setTurnState({ kind: "idle" });
        }
      } catch (err: unknown) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (
          err instanceof HttpApiError &&
          err.code === "conversation_crisis_paused"
        ) {
          const lane: CrisisCategory = crisisLane ?? "crisis";
          setTurnState({ kind: "paused", lane });
        } else {
          setTurnState({
            kind: "failed",
            clientTurnId,
            messageText: trimmed,
          });
        }
      }
    },
    [conversationId, turnState, sendMessageMutation],
  );

  // ── Retry ─────────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    if (turnState.kind !== "failed") return;
    handleSendMessage(turnState.messageText);
  }, [turnState, handleSendMessage]);

  // ── Submit from composer ──────────────────────────────────────────────

  const handleComposerSubmit = useCallback(() => {
    if (!draft.trim()) return;
    void handleSendMessage(draft);
  }, [draft, handleSendMessage]);

  // ── End session ───────────────────────────────────────────────────────

  const handleEndSession = useCallback(() => {
    if (!conversationId) return;
    endConversation.mutate(conversationId, {
      onSuccess: () => {
        setEndModalOpen(false);
        setTurnState({ kind: "idle" });
        navigateToConversation("");
        setLocation("/chat");
      },
    });
  }, [conversationId, endConversation, navigateToConversation, setLocation]);

  // ── Resume from crisis ────────────────────────────────────────────────

  const handleResume = useCallback(() => {
    if (!conversationId) return;
    const leavePausedState = (): void => {
      setTurnState({ kind: "idle" });
      setCrisisLane(null);
      setCrisisContent("");
    };
    resumeConversation.mutate(conversationId, {
      onSuccess: leavePausedState,
      // 409 conversation_not_paused is the server saying the conversation is
      // already live (e.g. resumed in another tab). Believe it and leave the
      // paused state — useResumeConversation has already cleared the cached
      // pause, so the sync effect above will not put it back.
      onError: (err) => {
        if (err.code === "conversation_not_paused") leavePausedState();
      },
    });
  }, [conversationId, resumeConversation]);

  // ── Composer state ────────────────────────────────────────────────────

  const isThinking = turnState.kind === "thinking";
  const composerPlaceholder = isThinking
    ? "LISA is responding..."
    : "Message LISA...";
  const composerDisabled = isThinking || isPaused || isEnded || !!premiumReason;

  // Determine if we should show the new session view (no messages yet)
  const showNewSessionView =
    !!conversationId && !isLoading && !hasMessages && !isPaused && !isEnded;

  // ── Sidebar content (shared between desktop and mobile drawer) ──────

  const sidebarContent = (
    <SessionsListContent
      conversations={conversations}
      activeId={conversationId}
      onSelect={navigateToConversation}
      onNewSession={() => void handleNewSession()}
      newSessionPending={createConversation.isPending}
    />
  );

  // ── No conversation selected — show empty state ────────────────────

  if (!conversationId) {
    return (
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-card">
          {sidebarContent}
        </aside>

        {/* Mobile header */}
        <div className="flex flex-1 flex-col md:hidden">
          <header className="flex items-center gap-2 border-b border-border p-4">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open sessions menu"
                  className="min-h-[44px] min-w-[44px]"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                {sidebarContent}
              </SheetContent>
            </Sheet>
            <span className="text-lg font-semibold text-foreground">LISA</span>
          </header>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
            <LisaAvatar size="lg" />
            <div className="text-center">
              <h2 className="text-xl font-semibold text-foreground">
                Welcome to LISA
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Start a new session or pick one from the sidebar.
              </p>
            </div>
            <Button
              onClick={() => void handleNewSession()}
              disabled={createConversation.isPending}
              className="min-h-[44px]"
            >
              {createConversation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              New session
            </Button>
          </div>
        </div>

        {/* Desktop empty */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-6 p-8">
          <LisaAvatar size="lg" />
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">
              Welcome to LISA
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a new session or pick one from the sidebar.
            </p>
          </div>
          <Button
            onClick={() => void handleNewSession()}
            disabled={createConversation.isPending}
            className="min-h-[44px]"
          >
            {createConversation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            New session
          </Button>
        </div>
      </div>
    );
  }

  // ── Chat view ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-card">
        {sidebarContent}
      </aside>

      {/* Chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile menu */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden min-h-[44px] min-w-[44px]"
                  aria-label="Open sessions menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                {sidebarContent}
              </SheetContent>
            </Sheet>

            <div className="min-w-0">
              <h1 className="text-base font-semibold text-foreground truncate">
                {conversation?.title ?? "New session"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {hasMessages && conversation
                  ? `${subjectFromEntryMode(conversation.surface, conversation.source_surface)}${subjectFromEntryMode(conversation.surface, conversation.source_surface) ? " · " : ""}Started ${formatTime(conversation.created_at)}`
                  : "Not started"}
              </p>
            </div>
          </div>

          {/* End session button — not shown on unstarted or ended sessions */}
          {hasMessages && !isEnded && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEndModalOpen(true)}
              disabled={endConversation.isPending}
              className="shrink-0 min-h-[44px]"
              aria-label="End session"
            >
              End session
            </Button>
          )}
        </header>

        {/* Message area */}
        <main
          className="flex-1 overflow-y-auto p-4 space-y-4"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="Conversation with LISA"
        >
          {/* Loading */}
          {isLoading && (
            <div
              className="flex justify-center py-8"
              role="status"
              aria-label="Loading conversation"
            >
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="sr-only">Loading conversation</span>
            </div>
          )}

          {/* Premium gate */}
          {premiumReason && !dismissedPremium && (
            <div className="py-4">
              <PremiumUpgradePrompt
                featureBenefit="the interactive tutor"
                mode="inline"
                onDismiss={() => setDismissedPremium(true)}
              />
            </div>
          )}

          {/* New session view */}
          {showNewSessionView && (
            <NewSessionView
              onSendMessage={(msg) => void handleSendMessage(msg)}
            />
          )}

          {/* Messages */}
          {!isLoading &&
            messages.map((message) => (
              <MessageBubble key={message.message_id} message={message} />
            ))}

          {/* The student's just-sent message, before the thread refetches
              (W2-10). Thinking and FailedTurn render below it. */}
          {!isLoading && optimisticMessage && (
            <MessageBubble
              key={optimisticMessage.message_id}
              message={optimisticMessage}
              pending
            />
          )}

          {/* Thinking indicator */}
          {turnState.kind === "thinking" && <ThinkingIndicator />}

          {/* Failed turn notice */}
          {turnState.kind === "failed" && (
            <FailedTurnNotice onRetry={handleRetry} />
          )}

          {/* Crisis/Safeguarding support card */}
          {showCrisisCard && crisisLane && effectiveCrisisContent && (
            <CrisisSupportCard
              lane={crisisLane}
              content={effectiveCrisisContent}
            />
          )}

          <div ref={scrollAnchorRef} />
        </main>

        {/* Composer or Paused bar */}
        {showCrisisCard || isPaused ? (
          <PausedBar
            onEnd={() => setEndModalOpen(true)}
            onContinue={handleResume}
            endPending={endConversation.isPending}
            resumePending={resumeConversation.isPending}
          />
        ) : isEnded ? null : (
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={handleComposerSubmit}
            disabled={composerDisabled}
            placeholder={composerPlaceholder}
          />
        )}
      </div>

      {/* End session modal */}
      <EndSessionModal
        open={endModalOpen}
        onOpenChange={setEndModalOpen}
        onConfirm={handleEndSession}
        pending={endConversation.isPending}
      />
    </div>
  );
}
