/**
 * A LISA conversation that is created on the first message: the body shared by the runner's
 * stacked LISA panel (`ScopedTutorPanel`, phones) and the chat dock (`ChatDock`, tablet and
 * desktop), in question scope and in general mode.
 *
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness), CR-02B-29; closure plan
 *        W4-1, W4-4 (nothing is created on load), W4-11 (an unpaid student never holds a
 *        composer); CC Brief "PR B: Standalone LISA Chat UI" §2–§5 (client_turn_id, crisis and
 *        safeguarding cards from the server's response); QA 2026-10-07 item 5 (Send pending)]
 *       [owner brief "LISA chat dock" (Karl, 2026-10-22): one shared ChatDock, UI only, no change
 *        to LISA's engine, prompts, safety, entitlement, usage limits or anti-leak rules]
 * @implemented [2026-09-25 as ScopedTutorPanel's body; lifted here 2026-10-22]
 *
 * plain English: moved, not rewritten, out of `ScopedTutorPanel.tsx` so the panel and the dock
 * draw one conversation the same way instead of two that drift. What the caller supplies is only
 * WHICH conversation: a lookup (a GET that finds the existing one, or null) and the body of the
 * create call the first message makes. Everything else is the panel's behaviour, unchanged:
 *   - on load it only LOOKS; with none, an opener (presentation only, never sent or stored) and
 *     a composer;
 *   - the first message creates the conversation and is then sent once through the unchanged
 *     turn machine (`useTutorTurn`): optimistic send, retry on the same client_turn_id, the
 *     crisis card and the pause (flag → pause → Continue) behave as on /chat;
 *   - a server refusal of the lookup, the create, the thread or a send swaps the composer for the
 *     LISA upgrade card (never a client-side guess).
 *
 * What LISA may see is decided on the server: the scoped create sends only the item id, and the
 * pre-submit envelope carries no answer and no explanation (the gate reads the item's status).
 * Nothing here logs; a tutor exchange is held in the query cache for display and nowhere else.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { HttpApiError } from "@/lib/api-error";
import {
  useConversation,
  useCreateConversation,
  useEndConversation,
  type CreateConversationInput,
  type TutorMessage,
} from "@/hooks/tutor-client";
import { useTutorTurn } from "@/hooks/useTutorTurn";
import {
  LisaUpgradeCard,
  isLisaEntitlementDenial,
} from "@/components/tutor/LisaUpgradeCard";
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

/** The invitation an empty conversation shows. Presentation only. */
export type TutorOpenerCopy = { title: string | null; body: string };

/** What the body says where: the opener, the composer's placeholder, the log's name. */
export type TutorBodyCopy = {
  opener: TutorOpenerCopy;
  placeholder: string;
  logLabel: string;
};

/**
 * The invitation shown with no conversation yet. Presentation only: not a message, not in the
 * thread, never sent or stored.
 */
function TutorOpener({ copy }: { copy: TutorOpenerCopy }): JSX.Element {
  return (
    <div
      className="flex gap-3 rounded-lg border border-lyc-rule bg-lyc-paper p-4"
      data-testid="tutor-opener"
    >
      <LisaAvatar />
      <div className="min-w-0">
        {copy.title !== null ? (
          <p className="m-0 text-lyc-body font-semibold text-lyc-ink-strong">
            {copy.title}
          </p>
        ) : null}
        <p
          className={`m-0 text-lyc-body text-lyc-muted ${copy.title !== null ? "mt-1" : ""}`}
        >
          {copy.body}
        </p>
      </div>
    </div>
  );
}

/** What a scope's lookup found: the existing conversation's id (or null), as it loads. */
export type ExistingConversation = {
  id: string | null;
  isLoading: boolean;
  error: HttpApiError | null;
};

/** A lookup query's answer, read as the body reads it. */
export function existingFromQuery(
  query: UseQueryResult<string | null, HttpApiError>,
): ExistingConversation {
  return {
    id: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** A conversation this body created, with the message that created it. */
type Started = {
  scopeKey: string;
  conversationId: string;
  firstMessage: string;
};

export function TutorConversationBody({
  scopeKey,
  lookup,
  createInput,
  copy,
  onStarted,
  onEnded,
}: {
  /**
   * What the conversation is about (the session item's id; "general"). State created for one
   * scope is never shown for another: the runner keeps this body mounted across questions.
   */
  scopeKey: string;
  /**
   * The existing conversation for this scope, found with a GET (`existingFromQuery`); `id` null
   * when there is none.
   */
  lookup: ExistingConversation;
  /** The create call's body for this scope, less the idempotency key (minted per create). */
  createInput: Omit<CreateConversationInput, "idempotency_key">;
  copy: TutorBodyCopy;
  /** The first message created this scope's conversation (the dock's general mode reads it). */
  onStarted?: (conversationId: string) => void;
  /** The student ended the conversation (the paused bar's End). */
  onEnded: () => void;
}): JSX.Element {
  const createConversation = useCreateConversation();
  const [started, setStarted] = useState<Started | null>(null);
  // The first message while its conversation is being created.
  const [pending, setPending] = useState<{
    scopeKey: string;
    text: string;
  } | null>(null);
  const [draft, setDraft] = useState("");

  const startedHere = started?.scopeKey === scopeKey ? started : null;
  const conversationId = startedHere?.conversationId ?? lookup.id;
  const pendingHere = pending?.scopeKey === scopeKey ? pending : null;

  const startConversation = (text: string): void => {
    const key = scopeKey;
    setPending({ scopeKey: key, text });
    setDraft("");
    createConversation.mutate(
      { ...createInput, idempotency_key: crypto.randomUUID() },
      {
        onSuccess: (conv) => {
          setStarted({
            scopeKey: key,
            conversationId: conv.conversation_id,
            firstMessage: text,
          });
          setPending(null);
          onStarted?.(conv.conversation_id);
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
  // Refused by the server, on load or on the first send. Never inferred here.
  const denied =
    isLisaEntitlementDenial(lookup.error) ||
    isLisaEntitlementDenial(createError);

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

  if (conversationId) {
    return (
      <TutorThread
        key={conversationId}
        conversationId={conversationId}
        firstMessage={startedHere?.firstMessage ?? null}
        copy={copy}
        onEnded={() => {
          // An ended conversation is never shown again here: the next message starts a new one.
          setStarted(null);
          onEnded();
        }}
      />
    );
  }
  if (denied) return <LisaUpgradeCard />;
  if (lookup.isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6"
        role="status"
        aria-label="Opening LISA"
      >
        <Loader2
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-lyc-muted"
        />
      </div>
    );
  }
  return (
    <>
      <div
        className="flex-1 space-y-4 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label={copy.logLabel}
      >
        {pendingMessage ? (
          <>
            <MessageBubble message={pendingMessage} pending />
            <ThinkingIndicator />
          </>
        ) : (
          <TutorOpener copy={copy.opener} />
        )}
        {!pendingMessage && createError && (
          <p className="m-0 text-lyc-body text-lyc-muted" role="alert">
            LISA isn&apos;t available right now. Your message is still below —
            try sending it again.
          </p>
        )}
      </div>
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={() => {
          if (draft.trim()) startConversation(draft.trim());
        }}
        disabled={false}
        pending={!!pendingMessage}
        placeholder={
          pendingMessage ? "LISA is responding..." : copy.placeholder
        }
        inset="panel"
      />
    </>
  );
}

function TutorThread({
  conversationId,
  firstMessage,
  copy,
  onEnded,
}: {
  conversationId: string;
  /** The student's first message, when this body just created the conversation for it. */
  firstMessage: string | null;
  copy: TutorBodyCopy;
  onEnded: () => void;
}): JSX.Element {
  const {
    data: detail,
    isLoading,
    error: detailError,
  } = useConversation(conversationId);
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
    showPausedBar,
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
  // Entitlement lapsed: the thread would not load, or the last send was refused.
  const denied = isLisaEntitlementDenial(detailError) || premiumReason !== null;

  useScrollToBottomOnChange(
    scrollAnchorRef,
    (messages.length + (optimisticMessage ? 1 : 0)) * 2 + (isThinking ? 1 : 0),
  );

  // The message that created this conversation is sent once, through the
  // same turn machine as every other — a server call, so an effect; the ref
  // keeps it to one send.
  const firstSent = useRef(false);
  // QA-5: between this thread mounting and that effect sending the first message, the message
  // is still on its way: Send stays pending (it was pending in the opener), with no enabled
  // frame in between. Read during render on purpose; the send it guards re-renders the thread.
  const firstAwaiting = firstMessage !== null && !firstSent.current;
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
        aria-label={copy.logLabel}
      >
        {isLoading && (
          <div
            className="flex justify-center py-8"
            role="status"
            aria-label="Loading conversation"
          >
            <Loader2
              aria-hidden="true"
              className="h-6 w-6 animate-spin text-lyc-muted"
            />
          </div>
        )}

        {/* A conversation with no messages yet (e.g. one opened before
            W4-4) still shows the invitation, not an empty thread. */}
        {!isLoading && !denied && !hasMessages && firstMessage === null && (
          <TutorOpener copy={copy.opener} />
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

      {showPausedBar || isPaused ? (
        <PausedBar
          onEnd={end}
          onContinue={resume}
          endPending={endConversation.isPending}
          resumePending={resumePending}
          inset="panel"
        />
      ) : isEnded ? null : denied ? (
        <LisaUpgradeCard />
      ) : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          disabled={isPaused || isEnded}
          pending={isThinking || firstAwaiting}
          placeholder={
            isThinking || firstAwaiting
              ? "LISA is responding..."
              : copy.placeholder
          }
          inset="panel"
        />
      )}
    </>
  );
}
