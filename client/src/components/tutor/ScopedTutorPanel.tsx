/**
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness),
 *        CR-02B-29; closure plan W4-1 (LISA in review — launch scope, owner
 *        ruling 2026-09-25)]
 * @implemented 2026-09-25
 *
 * plain English: LISA beside the question under review. The panel names the
 * question it is about (a chip), closes, and holds a composer scoped to that
 * one item. It opens a `scoped_question` conversation for the item; the
 * server reuses the item's open conversation, so there is one conversation
 * per review item however many times the panel is opened.
 *
 * What LISA may see is decided on the server, never here: the client sends
 * only the item id. Before the student submits, the envelope carries stem,
 * passage and options — no answer, no explanation (the gate reads
 * `review_session_items.status`); after, both. Moving to the next item opens
 * that item's conversation and drops the previous thread's turn state.
 *
 * The thread is drawn with the same parts and turn machine as the standalone
 * chat (`TutorThreadParts`, `useTutorTurn`): optimistic send, retry on the
 * same client_turn_id, crisis card and pause all behave identically.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useConversation,
  useCreateConversation,
  useEndConversation,
  type TutorSourceSurface,
} from "@/hooks/tutor-client";
import { useTutorTurn } from "@/hooks/useTutorTurn";
import { mapTutorErrorToPremiumReason } from "@/lib/api-error";
import {
  PremiumUpgradePrompt,
  type PremiumPromptReason,
} from "@/components/billing/PremiumUpgradePrompt";
import {
  Composer,
  CrisisSupportCard,
  FailedTurnNotice,
  LisaAvatar,
  MessageBubble,
  PausedBar,
  ThinkingIndicator,
  useScrollToBottomOnChange,
} from "@/components/tutor/TutorThreadParts";

type OpenedConversation = { itemId: string; conversationId: string };

export function ScopedTutorPanel({
  sourceSurface,
  sessionItemId,
  questionLabel,
  onClose,
}: {
  sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
  sessionItemId: string;
  /** Names the question under review, e.g. "Question 3 / 10". */
  questionLabel: string;
  onClose: () => void;
}) {
  const createConversation = useCreateConversation();
  const [opened, setOpened] = useState<OpenedConversation | null>(null);
  // The item a create is in flight for — one request per item, not per render.
  const requestedFor = useRef<string | null>(null);

  const conversationId =
    opened?.itemId === sessionItemId ? opened.conversationId : null;

  const openForItem = (itemId: string): void => {
    requestedFor.current = itemId;
    createConversation.mutate(
      {
        entry_mode: "scoped_question",
        source_surface: sourceSurface,
        source_session_item_id: itemId,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: (conv) => {
          // A late answer for an item the student has already left is dropped.
          if (requestedFor.current === itemId) {
            setOpened({ itemId, conversationId: conv.conversation_id });
          }
        },
      },
    );
  };

  // Opening the panel, or moving to another item while it is open, opens
  // that item's conversation. An effect, not render: it is a server call.
  useEffect(() => {
    if (requestedFor.current === sessionItemId) return;
    openForItem(sessionItemId);
    // openForItem closes over the mutation; the item id is the trigger.
  }, [sessionItemId]);

  const createError = createConversation.error;
  const createPremiumReason: PremiumPromptReason | null = createError
    ? (mapTutorErrorToPremiumReason(createError) as PremiumPromptReason | null)
    : null;

  return (
    <section
      className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card"
      aria-label="LISA"
      data-testid="scoped-tutor-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <LisaAvatar />
          <span className="text-sm font-semibold text-foreground">LISA</span>
          <span
            className="truncate rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground"
            data-testid="tutor-question-chip"
          >
            {questionLabel}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close LISA"
          className="min-h-[44px] min-w-[44px] shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {conversationId ? (
        <ScopedThread
          key={conversationId}
          conversationId={conversationId}
          onEnded={onClose}
        />
      ) : createError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {createPremiumReason ? (
            <PremiumUpgradePrompt
              featureBenefit="the interactive tutor"
              mode="inline"
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                LISA isn&apos;t available right now.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openForItem(sessionItemId)}
                className="min-h-[44px]"
              >
                Try again
              </Button>
            </>
          )}
        </div>
      ) : (
        <div
          className="flex flex-1 items-center justify-center p-6"
          role="status"
          aria-label="Opening LISA"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </section>
  );
}

function ScopedThread({
  conversationId,
  onEnded,
}: {
  conversationId: string;
  onEnded: () => void;
}) {
  const { data: detail, isLoading } = useConversation(conversationId);
  const endConversation = useEndConversation();
  const [draft, setDraft] = useState("");
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const messages = detail?.messages ?? [];
  const conversation = detail?.conversation;
  const {
    turnState,
    optimisticMessage,
    crisisLane,
    effectiveCrisisContent,
    showCrisisCard,
    premiumReason,
    send,
    retry,
    resume,
    resumePending,
  } = useTutorTurn(conversationId, messages, conversation);

  const isPaused = !!conversation?.crisis_paused_at;
  const isEnded = conversation?.status === "ended";
  const isThinking = turnState.kind === "thinking";
  const hasMessages = messages.length > 0 || optimisticMessage !== null;

  useScrollToBottomOnChange(
    scrollAnchorRef,
    (messages.length + (optimisticMessage ? 1 : 0)) * 2 + (isThinking ? 1 : 0),
  );

  const submit = (): void => {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    void send(text);
  };

  const end = (): void => {
    endConversation.mutate(conversationId, { onSuccess: onEnded });
  };

  return (
    <>
      <div
        className="flex-1 space-y-4 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Conversation with LISA about this question"
      >
        {isLoading && (
          <div
            className="flex justify-center py-8"
            role="status"
            aria-label="Loading conversation"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !hasMessages && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ask LISA about this question.
          </p>
        )}

        {premiumReason && (
          <PremiumUpgradePrompt
            featureBenefit="the interactive tutor"
            mode="inline"
          />
        )}

        {!isLoading &&
          messages.map((message) => (
            <MessageBubble key={message.message_id} message={message} />
          ))}

        {!isLoading && optimisticMessage && (
          <MessageBubble
            key={optimisticMessage.message_id}
            message={optimisticMessage}
            pending
          />
        )}

        {isThinking && <ThinkingIndicator />}

        {turnState.kind === "failed" && <FailedTurnNotice onRetry={retry} />}

        {showCrisisCard && crisisLane && effectiveCrisisContent && (
          <CrisisSupportCard
            lane={crisisLane}
            content={effectiveCrisisContent}
          />
        )}

        <div ref={scrollAnchorRef} />
      </div>

      {showCrisisCard || isPaused ? (
        <PausedBar
          onEnd={end}
          onContinue={resume}
          endPending={endConversation.isPending}
          resumePending={resumePending}
        />
      ) : isEnded ? null : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          disabled={isThinking || isPaused || isEnded || !!premiumReason}
          placeholder={
            isThinking ? "LISA is responding..." : "Ask about this question..."
          }
        />
      )}
    </>
  );
}
