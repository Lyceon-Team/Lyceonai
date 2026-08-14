/**
 * @spec [Doc-03B_V2 §3 (Surfaces)]
 * @implemented 2026-08-09
 *
 * plain English: Chat page for the LISA tutor. Renders the conversation UI,
 * handles message input, and displays tutor responses. This is the primary
 * student-facing tutor interaction surface.
 *
 * expected outcome: student can type messages, see tutor responses, and
 * navigate between conversations. Messages are sent via TanStack mutations.
 *
 * trade-offs: no optimistic updates (server must anti-leak scan first).
 * Message history loaded via useConversation hook. Input disabled during
 * message send to prevent double-submit.
 *
 * edge cases: this route (`/chat`) carries no `:conversationId` path param —
 * the conversation is read from the `conversationId` search param via
 * wouter's `useSearch()`. With no conversation selected, the page shows a
 * prompt pointing back to `/tutor` rather than silently creating one
 * (conversation creation is `tutor.tsx`'s responsibility, not this page's).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Send, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useConversation,
  useSendMessage,
  type TutorMessage,
} from "@/hooks/tutor-client";
import {
  isSessionError,
  mapTutorErrorToPremiumReason,
  toUserFacingMessage,
} from "@/lib/api-error";
import {
  PremiumUpgradePrompt,
  type PremiumPromptReason,
} from "@/components/billing/PremiumUpgradePrompt";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import { SessionNotice } from "@/components/feedback/SessionNotice";

function useConversationIdFromSearch(): string | null {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const raw = params.get("conversationId");
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

function MessageBubble({ message }: { message: TutorMessage }) {
  const isStudent = message.role === "student";
  return (
    <div className={`flex ${isStudent ? "justify-end" : "justify-start"}`}>
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

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const conversationId = useConversationIdFromSearch();

  const {
    data: conversation,
    isLoading,
    error,
  } = useConversation(conversationId);
  const sendMessage = useSendMessage();

  const [draft, setDraft] = useState("");
  const [dismissedPremium, setDismissedPremium] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const messages = conversation?.messages ?? [];

  // Premium entitlement check — both the conversation query and the send
  // mutation can surface entitlement denial errors. Derive the premium
  // reason inline (not via useEffect — coding standards §11.4).
  const conversationPremiumReason: PremiumPromptReason | null =
    mapTutorErrorToPremiumReason(error) as PremiumPromptReason | null;
  const sendPremiumReason: PremiumPromptReason | null =
    mapTutorErrorToPremiumReason(
      sendMessage.error,
    ) as PremiumPromptReason | null;
  const activePremiumReason = conversationPremiumReason ?? sendPremiumReason;

  // Classify non-premium errors for the structured notice UX.
  const activeNonPremiumError =
    !conversationPremiumReason && error ? error : null;
  const sendNonPremiumError =
    !sendPremiumReason && sendMessage.error ? sendMessage.error : null;

  // Side effect only: scroll the message list into view when the message
  // count changes. This is imperative DOM behavior, not derived state, so a
  // ref-based effect is the correct tool (never used to compute a value).
  const messageCount = messages.length;
  useScrollToBottomOnChange(scrollAnchorRef, messageCount);

  const canSend =
    !!conversationId &&
    draft.trim().length > 0 &&
    !sendMessage.isPending &&
    !activePremiumReason;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversationId) return;

    const trimmed = draft.trim();
    if (!trimmed) return;

    // Fire-and-forget — mutation errors surface via sendMessage.error
    // and are rendered as RecoveryNotice / SessionNotice below. No toast
    // with destructive variant (feedback-ux contract).
    await sendMessage.mutateAsync({
      conversation_id: conversationId,
      message: trimmed,
      client_turn_id: crypto.randomUUID(),
    });
    setDraft("");
  };

  if (!conversationId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-4">
        <p className="text-muted-foreground text-center">
          No conversation selected.
        </p>
        <Button onClick={() => setLocation("/tutor")}>Go to LISA tutor</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/tutor")}
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">LISA</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading &&
          activeNonPremiumError &&
          (isSessionError(activeNonPremiumError) ? (
            <SessionNotice
              message={toUserFacingMessage(activeNonPremiumError).message}
              onRefreshSession={() => window.location.reload()}
            />
          ) : (
            <RecoveryNotice
              message={toUserFacingMessage(activeNonPremiumError).message}
              onRetry={() => window.location.reload()}
              retryLabel="Retry"
            />
          ))}

        {sendNonPremiumError &&
          (isSessionError(sendNonPremiumError) ? (
            <SessionNotice
              message={toUserFacingMessage(sendNonPremiumError).message}
              onRefreshSession={() => window.location.reload()}
            />
          ) : (
            <RecoveryNotice
              message={toUserFacingMessage(sendNonPremiumError).message}
              onRetry={() => sendMessage.reset()}
              retryLabel="Dismiss"
            />
          ))}

        {activePremiumReason && !dismissedPremium && (
          <div className="py-4">
            <PremiumUpgradePrompt
              reason={activePremiumReason}
              mode="inline"
              onDismiss={() => setDismissedPremium(true)}
            />
          </div>
        )}

        {!isLoading &&
          !error &&
          messages.map((message) => (
            <MessageBubble key={message.message_id} message={message} />
          ))}

        <div ref={scrollAnchorRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border p-4"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask LISA a question..."
          disabled={sendMessage.isPending}
          aria-label="Message"
        />
        <Button type="submit" disabled={!canSend} aria-label="Send message">
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
// Isolated into its own hook (rather than inlined `useEffect` in the
// component body) so the intent is unambiguous: this synchronizes the DOM
// scroll position with the message count, a legitimate imperative side
// effect — it does not compute or derive any rendered value.
function useScrollToBottomOnChange(
  anchorRef: React.RefObject<HTMLDivElement>,
  dependencyValue: number,
): void {
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dependencyValue, anchorRef]);
}
