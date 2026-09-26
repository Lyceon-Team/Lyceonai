/**
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness),
 *        CR-02B-29; closure plan W4-1 (LISA in review — launch scope, owner
 *        ruling 2026-09-25), W4-4 (LISA always open in review)]
 * @implemented 2026-09-25 | @updated 2026-09-25 — W4-4
 *
 * plain English: LISA beside the question under review. The panel names the
 * question it is about (a chip), can be hidden for the current question, and
 * holds a composer scoped to that one item.
 *
 * W4-4 — ALWAYS OPEN, SO NOTHING IS CREATED ON LOAD. The panel is on screen
 * for every review question, so it must not open a conversation by being
 * there: on load it only LOOKS (a GET filtered to this item) for the item's
 * existing conversation. With none, it shows the opener — an invitation drawn
 * by the panel, not a message: it is never persisted, never in the thread,
 * and gone the moment the student sends anything. The conversation is created
 * on the student's FIRST real message, and that message is then sent through
 * the unchanged turn machine. The server still reuses the item's open
 * conversation, so there is one conversation per review item.
 *
 * What LISA may see is decided on the server, never here: the client sends
 * only the item id. Before the student submits, the envelope carries stem,
 * passage and options — no answer, no explanation (the gate reads
 * `review_session_items.status`); after, both.
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
  useItemConversation,
  type TutorMessage,
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
  SuggestedActionLink,
  ThinkingIndicator,
  useScrollToBottomOnChange,
} from "@/components/tutor/TutorThreadParts";

/** Owner copy (W4-4 brief). The second line is true: the pre-submit gate enforces it. */
export const OPENER_TITLE = "Need help with this question?";
export const OPENER_BODY =
  "I can walk you through it. I won't give you the answer before you submit.";

const COMPOSER_PLACEHOLDER = "Ask about this question...";

/**
 * The invitation shown on an item with no conversation yet. Presentation
 * only: not a message, not in the thread, never sent or stored.
 */
function TutorOpener() {
  return (
    <div
      className="flex gap-3 rounded-2xl border border-border bg-secondary/40 p-4"
      data-testid="tutor-opener"
    >
      <LisaAvatar />
      <div className="text-sm leading-relaxed">
        <p className="font-semibold text-foreground">{OPENER_TITLE}</p>
        <p className="mt-1 text-muted-foreground">{OPENER_BODY}</p>
      </div>
    </div>
  );
}

/** A conversation this panel created for an item, with the message that created it. */
type Started = { itemId: string; conversationId: string; firstMessage: string };

export function ScopedTutorPanel({
  sourceSurface,
  sessionItemId,
  questionLabel,
  onHide,
}: {
  sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
  sessionItemId: string;
  /** Names the question under review, e.g. "Question 3 / 10". */
  questionLabel: string;
  /** Hide LISA for the current question; it returns on the next. */
  onHide: () => void;
}) {
  // Looking is a GET. Nothing here creates a conversation on load.
  const existing = useItemConversation(sourceSurface, sessionItemId);
  const createConversation = useCreateConversation();
  const [started, setStarted] = useState<Started | null>(null);
  // The first message while its conversation is being created.
  const [pending, setPending] = useState<{
    itemId: string;
    text: string;
  } | null>(null);
  const [draft, setDraft] = useState("");

  const startedHere = started?.itemId === sessionItemId ? started : null;
  const conversationId = startedHere?.conversationId ?? existing.data ?? null;
  const pendingHere = pending?.itemId === sessionItemId ? pending : null;

  const startConversation = (text: string): void => {
    const itemId = sessionItemId;
    setPending({ itemId, text });
    setDraft("");
    createConversation.mutate(
      {
        entry_mode: "scoped_question",
        source_surface: sourceSurface,
        source_session_item_id: itemId,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: (conv) => {
          setStarted({
            itemId,
            conversationId: conv.conversation_id,
            firstMessage: text,
          });
          setPending(null);
        },
        onError: () => {
          // The student's text goes back in the composer, never lost.
          setPending(null);
          setDraft(text);
        },
      },
    );
  };

  const createError = createConversation.error;
  const createPremiumReason: PremiumPromptReason | null = createError
    ? (mapTutorErrorToPremiumReason(createError) as PremiumPromptReason | null)
    : null;

  const pendingMessage: TutorMessage | null = pendingHere
    ? {
        message_id: "pending-first-message",
        role: "student",
        content_kind: "message",
        message: pendingHere.text,
        created_at: new Date(0).toISOString(),
        client_turn_id: null,
      }
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
          onClick={onHide}
          aria-label="Hide LISA"
          className="min-h-[44px] min-w-[44px] shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {conversationId ? (
        <ScopedThread
          key={conversationId}
          conversationId={conversationId}
          firstMessage={startedHere?.firstMessage ?? null}
          onEnded={onHide}
        />
      ) : existing.isLoading ? (
        <div
          className="flex flex-1 items-center justify-center p-6"
          role="status"
          aria-label="Opening LISA"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div
            className="flex-1 space-y-4 overflow-y-auto p-4"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-label="Conversation with LISA about this question"
          >
            {pendingMessage ? (
              <>
                <MessageBubble message={pendingMessage} pending />
                <ThinkingIndicator />
              </>
            ) : (
              <TutorOpener />
            )}
            {!pendingMessage && createError && (
              <p
                className="text-center text-sm text-muted-foreground"
                role="alert"
              >
                LISA isn&apos;t available right now. Your message is still below
                — try sending it again.
              </p>
            )}
            {!pendingMessage && createPremiumReason && (
              <PremiumUpgradePrompt
                featureBenefit="the interactive tutor"
                mode="inline"
              />
            )}
          </div>
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={() => {
              if (draft.trim()) startConversation(draft.trim());
            }}
            disabled={!!pendingMessage || !!createPremiumReason}
            placeholder={
              pendingMessage ? "LISA is responding..." : COMPOSER_PLACEHOLDER
            }
          />
        </>
      )}
    </section>
  );
}

function ScopedThread({
  conversationId,
  firstMessage,
  onEnded,
}: {
  conversationId: string;
  /** The student's first message, when this panel just created the conversation for it. */
  firstMessage: string | null;
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
    suggestedAction,
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

  // The message that created this conversation is sent once, through the
  // same turn machine as every other — a server call, so an effect; the ref
  // keeps it to one send.
  const firstSent = useRef(false);
  useEffect(() => {
    if (firstMessage === null || firstSent.current) return;
    firstSent.current = true;
    void send(firstMessage);
    // Mount-only: `send` is stable for this conversation's first turn.
  }, []);

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

        {/* A conversation with no messages yet (e.g. one opened before
            W4-4) still shows the invitation, not an empty thread. */}
        {!isLoading && !hasMessages && firstMessage === null && <TutorOpener />}

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

        {turnState.kind === "idle" && (
          <SuggestedActionLink action={suggestedAction} />
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
            isThinking ? "LISA is responding..." : COMPOSER_PLACEHOLDER
          }
        />
      )}
    </>
  );
}
