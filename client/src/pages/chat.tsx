/**
 * @spec [Doc-03B_V2 §3 (Surfaces), §11 (Client Error Handling), §21.4 (Typing Indicator)]
 * @implemented 2026-08-28
 *
 * plain English: Chat page for the LISA tutor. Renders the conversation UI,
 * handles message input, displays tutor responses, and maps every error code
 * to a specific recovery notice. Renders suggested_action and ui_hints from
 * the server. Shows a "LISA is thinking…" indicator during generation.
 *
 * expected outcome: student can type messages, see tutor responses with
 * actionable chips, and get clear feedback when errors occur — not a
 * generic "refresh session" for every failure.
 *
 * trade-offs: no optimistic updates (server must anti-leak scan first).
 * No streaming (V1 is synchronous per Doc 03B §21.1). Typing indicator
 * is the V1 mitigation per §21.4.
 *
 * edge cases: retry-in-place for 503 uses retry_after_ms from the server
 * response. Unknown error codes fall through to a generic recovery notice.
 * Crisis responses render as normal tutor messages (Karl ruling 2026-08-27:
 * crisis presentation deferred, no special styling).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Send, Loader2, ArrowLeft, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useConversation,
  useCloseConversation,
  useSendMessage,
  type TutorMessage,
  type SendMessageResponse,
  type TutorSuggestedAction,
  type TutorUiHints,
} from "@/hooks/tutor-client";
import { mapTutorErrorToPremiumReason } from "@/lib/api-error";
import {
  classifyTutorError,
  type TutorErrorNotice,
} from "@/lib/tutor-error-classifier";
import {
  PremiumUpgradePrompt,
  type PremiumPromptReason,
} from "@/components/billing/PremiumUpgradePrompt";
import { AppNotice } from "@/components/feedback/AppNotice";

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
// MessageBubble — accessible, per-message authorship labels (Tier 3)
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: TutorMessage }) {
  const isStudent = message.role === "student";
  const authorLabel = isStudent ? "You said:" : "LISA said:";
  return (
    <div
      className={`flex ${isStudent ? "justify-end" : "justify-start"}`}
      aria-label={authorLabel}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
          isStudent
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-foreground"
        }`}
      >
        {message.message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuggestedActionChip — renders server-provided pedagogical actions (Tier 2)
// ---------------------------------------------------------------------------

function SuggestedActionChip({
  action,
  onAccept,
}: {
  action: TutorSuggestedAction;
  onAccept: (label: string) => void;
}) {
  if (action.type === "none" || !action.label) return null;

  return (
    <div className="flex justify-start">
      <button
        type="button"
        className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => onAccept(action.label as string)}
      >
        {action.label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UiHintChips — renders suggested_chip from ui_hints (Tier 2)
// ---------------------------------------------------------------------------

function UiHintChips({
  hints,
  onChipClick,
}: {
  hints: TutorUiHints;
  onChipClick: (text: string) => void;
}) {
  if (!hints.suggested_chip) return null;

  return (
    <div className="flex justify-start">
      <button
        type="button"
        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => onChipClick(hints.suggested_chip as string)}
      >
        {hints.suggested_chip}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingIndicator — "LISA is thinking…" per Doc 03B §21.4 (Tier 2)
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
  return (
    <div
      className="flex justify-start"
      role="status"
      aria-label="LISA is thinking"
    >
      <div className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
        <span className="sr-only">LISA is thinking</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — what LISA can do, replacing "No conversation selected" (Tier 2)
// ---------------------------------------------------------------------------

function EmptyState({
  onStartConversation,
}: {
  onStartConversation: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <MessageSquare className="h-8 w-8 text-primary" />
      </div>
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold text-foreground">Meet LISA</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your SAT tutor. Ask about any question, get step-by-step explanations,
          or work through practice problems together.
        </p>
      </div>
      <Button onClick={onStartConversation}>Start a conversation</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TutorErrorDisplay — code-dispatched error renderer (Tier 1)
// ---------------------------------------------------------------------------

function TutorErrorDisplay({
  notice,
  onRetry,
  onNavigateTutor,
  onReload,
}: {
  notice: TutorErrorNotice;
  onRetry: () => void;
  onNavigateTutor: () => void;
  onReload: () => void;
}) {
  const variant =
    notice.action === "informational"
      ? ("warning" as const)
      : notice.action === "upgrade"
        ? ("premium" as const)
        : ("neutral" as const);

  const actionLabel =
    notice.action === "retry_send" || notice.action === "retry_delayed"
      ? "Try again"
      : notice.action === "navigate_tutor"
        ? "Start new conversation"
        : notice.action === "reload"
          ? "Refresh page"
          : notice.action === "upgrade"
            ? "View plans"
            : undefined;

  const onAction =
    notice.action === "retry_send" || notice.action === "retry_delayed"
      ? onRetry
      : notice.action === "navigate_tutor"
        ? onNavigateTutor
        : notice.action === "reload"
          ? onReload
          : notice.action === "upgrade"
            ? onNavigateTutor // Will be overridden by PremiumUpgradePrompt when it applies
            : undefined;

  // For upgrade actions, render the PremiumUpgradePrompt instead
  if (notice.action === "upgrade") {
    return <PremiumUpgradePrompt reason="premium_required" mode="inline" />;
  }

  return (
    <AppNotice
      variant={variant}
      title={notice.title}
      message={notice.message}
      actionLabel={actionLabel}
      onAction={onAction}
      mode="inline"
    />
  );
}

// ---------------------------------------------------------------------------
// ChatPage — main component
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const conversationId = useConversationIdFromSearch();

  const {
    data: conversation,
    isLoading,
    error,
  } = useConversation(conversationId);
  const sendMessage = useSendMessage();
  const closeConversation = useCloseConversation();

  const [draft, setDraft] = useState("");
  const [dismissedPremium, setDismissedPremium] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // Track the last response for suggested_action and ui_hints (Tier 2)
  const [lastResponse, setLastResponse] = useState<SendMessageResponse | null>(
    null,
  );

  const messages = conversation?.messages ?? [];

  // ── Premium entitlement check ───────────────────────────────────────
  const conversationPremiumReason: PremiumPromptReason | null =
    mapTutorErrorToPremiumReason(error) as PremiumPromptReason | null;
  const sendPremiumReason: PremiumPromptReason | null =
    mapTutorErrorToPremiumReason(
      sendMessage.error,
    ) as PremiumPromptReason | null;
  const activePremiumReason = conversationPremiumReason ?? sendPremiumReason;

  // ── Code-dispatched error classification (Tier 1) ───────────────────
  const conversationErrorNotice: TutorErrorNotice | null =
    !conversationPremiumReason && error ? classifyTutorError(error) : null;
  const sendErrorNotice: TutorErrorNotice | null =
    !sendPremiumReason && sendMessage.error
      ? classifyTutorError(sendMessage.error)
      : null;

  // ── Fallback for unrecognized errors ────────────────────────────────
  const hasUnclassifiedConversationError =
    !conversationPremiumReason && error && !conversationErrorNotice;
  const hasUnclassifiedSendError =
    !sendPremiumReason && sendMessage.error && !sendErrorNotice;

  // ── Scroll management ──────────────────────────────────────────────
  // Trigger scrolls when message count changes or when the thinking
  // indicator toggles. Encoding both into a single numeric trigger avoids
  // spreading an unknown-length deps array.
  const scrollTrigger = messages.length * 2 + (sendMessage.isPending ? 1 : 0);
  useScrollToBottomOnChange(scrollAnchorRef, scrollTrigger);

  // ── Retry-in-place for 503 (Tier 1, item 3) ────────────────────────
  const lastSendInputRef = useRef<{
    conversation_id: string;
    message: string;
    client_turn_id: string;
  } | null>(null);

  const handleRetry = useCallback((): void => {
    const notice = sendErrorNotice;
    sendMessage.reset();

    if (notice?.action === "retry_delayed" && lastSendInputRef.current) {
      const delayMs = notice.retryAfterMs ?? 2000;
      const input = lastSendInputRef.current;
      setTimeout(() => {
        sendMessage.mutate({
          ...input,
          client_turn_id: crypto.randomUUID(),
        });
      }, delayMs);
    }
  }, [sendErrorNotice, sendMessage]);

  const canSend =
    !!conversationId &&
    draft.trim().length > 0 &&
    !sendMessage.isPending &&
    !activePremiumReason;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!conversationId) return;

    const trimmed = draft.trim();
    if (!trimmed) return;

    const input = {
      conversation_id: conversationId,
      message: trimmed,
      client_turn_id: crypto.randomUUID(),
    };
    lastSendInputRef.current = input;

    try {
      const response = await sendMessage.mutateAsync(input);
      setLastResponse(response);
      setDraft("");
    } catch {
      // Errors surface via sendMessage.error and are rendered by the
      // code-dispatched error handler below. No toast (feedback-ux contract).
    }
  };

  const handleSuggestedAction = (label: string): void => {
    setDraft(label);
  };

  const navigateToTutor = (): void => {
    setLocation("/tutor");
  };

  // ── Close conversation handler (Tier 4) ─────────────────────────────
  const handleCloseConversation = (): void => {
    if (!conversationId) return;
    closeConversation.mutate(conversationId, {
      onSuccess: () => setLocation("/tutor"),
    });
  };

  // ── Empty state (Tier 2) ────────────────────────────────────────────
  if (!conversationId) {
    return (
      <main className="flex h-screen flex-col">
        <EmptyState onStartConversation={navigateToTutor} />
      </main>
    );
  }

  // Derive suggested action and ui hints from last response
  const suggestedAction = lastResponse?.response?.suggested_action ?? null;
  const uiHints = lastResponse?.response?.ui_hints ?? null;
  // Clear suggested action after the student types something new
  const showSuggestions =
    !sendMessage.isPending &&
    !draft.trim() &&
    suggestedAction &&
    suggestedAction.type !== "none";
  const showChips =
    !sendMessage.isPending && !draft.trim() && uiHints?.suggested_chip;

  return (
    <div className="flex h-screen flex-col">
      {/* ── Header (Tier 3: landmark regions) ─────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-border p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={navigateToTutor}
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 text-lg font-semibold text-foreground">LISA</h1>
        {conversation?.conversation.status === "active" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCloseConversation}
            disabled={closeConversation.isPending}
            aria-label="End this conversation"
          >
            {closeConversation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            <span className="ml-1 text-xs">End</span>
          </Button>
        )}
      </header>

      {/* ── Message list (Tier 3: role="log", aria-live) ──────────────── */}
      <main
        className="flex-1 overflow-y-auto p-4 space-y-3"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Conversation with LISA"
      >
        {/* Loading state (Tier 3: announced) */}
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

        {/* ── Conversation-level errors ──────────────────────────────── */}
        {!isLoading && conversationErrorNotice && (
          <TutorErrorDisplay
            notice={conversationErrorNotice}
            onRetry={() => window.location.reload()}
            onNavigateTutor={navigateToTutor}
            onReload={() => window.location.reload()}
          />
        )}

        {!isLoading && hasUnclassifiedConversationError && (
          <AppNotice
            variant="neutral"
            title="Couldn't load this right now"
            message="Try again. If this keeps happening, refresh the page."
            actionLabel="Retry"
            onAction={() => window.location.reload()}
          />
        )}

        {/* ── Send-level errors ──────────────────────────────────────── */}
        {sendErrorNotice && (
          <TutorErrorDisplay
            notice={sendErrorNotice}
            onRetry={handleRetry}
            onNavigateTutor={navigateToTutor}
            onReload={() => window.location.reload()}
          />
        )}

        {hasUnclassifiedSendError && (
          <AppNotice
            variant="neutral"
            title="Couldn't send your message"
            message="Something went wrong. Try sending again."
            actionLabel="Dismiss"
            onAction={() => sendMessage.reset()}
          />
        )}

        {/* ── Premium gate ───────────────────────────────────────────── */}
        {activePremiumReason && !dismissedPremium && (
          <div className="py-4">
            <PremiumUpgradePrompt
              reason={activePremiumReason}
              mode="inline"
              onDismiss={() => setDismissedPremium(true)}
            />
          </div>
        )}

        {/* ── Messages ───────────────────────────────────────────────── */}
        {!isLoading &&
          !error &&
          messages.map((message) => (
            <MessageBubble key={message.message_id} message={message} />
          ))}

        {/* ── Thinking indicator (Tier 2) ────────────────────────────── */}
        {sendMessage.isPending && <ThinkingIndicator />}

        {/* ── Suggested actions + chips (Tier 2) ─────────────────────── */}
        {showSuggestions && suggestedAction && (
          <SuggestedActionChip
            action={suggestedAction}
            onAccept={handleSuggestedAction}
          />
        )}
        {showChips && uiHints && (
          <UiHintChips hints={uiHints} onChipClick={handleSuggestedAction} />
        )}

        <div ref={scrollAnchorRef} />
      </main>

      {/* ── Input area ───────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex items-center gap-2 border-t border-border p-4"
        aria-label="Send a message to LISA"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask LISA a question..."
          disabled={sendMessage.isPending}
          aria-label="Message"
          aria-busy={sendMessage.isPending}
        />
        <Button
          type="submit"
          disabled={!canSend}
          size="icon"
          aria-label="Send message"
        >
          {sendMessage.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll-to-bottom helper
// ---------------------------------------------------------------------------
//
// Scrolls when messages arrive or when the thinking indicator appears.
// Isolated into its own hook so the intent is unambiguous: imperative DOM
// behavior, not derived state. The `trigger` value is a counter or similar
// primitive that changes when a scroll should happen — avoids spreading an
// unknown-length deps array which violates the exhaustive-deps rule.
function useScrollToBottomOnChange(
  anchorRef: React.RefObject<HTMLDivElement | null>,
  trigger: number,
): void {
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trigger, anchorRef]);
}
