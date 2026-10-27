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
import { LYC_FOCUS } from "@/components/ui/button";
import type { UseQueryResult } from "@tanstack/react-query";
import type { HttpApiError } from "@/lib/api-error";
import {
  useConversation,
  useCreateConversation,
  useEndConversation,
  type CreateConversationInput,
  type TutorMessage,
} from "@/hooks/tutor-client";
import { useSendLock } from "@/hooks/useSendLock";
import {
  REVIEW_INTENT_LABELS,
  isVideoIntent,
  type ReviewIntent,
} from "@lyceon/shared/tutor-guided-choices";
import {
  GuidedChoiceButtons,
  hasGuidedChoices,
  type GuidedChoicesState,
} from "@/components/tutor/GuidedChoices";
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
  /** The guided choice the first message was (its label), or null when it was typed. */
  firstIntent: ReviewIntent | null;
};

export function TutorConversationBody({
  scopeKey,
  lookup,
  createInput,
  copy,
  onStarted,
  onEnded,
  guidedChoices = null,
  autoSend = null,
  onAutoSent,
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
  /**
   * The review panel's guided choices (owner brief 2026-10-27, SCL-253): shown in the empty
   * state and behind "Other ways" after the first message. Null where there are none (practice,
   * general mode).
   */
  guidedChoices?: GuidedChoicesState | null;
  /**
   * A guided choice tapped OUTSIDE the panel (the phone runner's LISA strip, owner ruling on
   * #1349, 2026-10-27): the panel opened for it and sends it once, exactly as a tap inside would:
   * it creates the conversation when there is none, else it is the thread's next turn. `nonce`
   * tells two taps of the same choice apart.
   */
  autoSend?: { nonce: number; intent: ReviewIntent } | null;
  /** The tap was handed to the send path; the caller clears `autoSend`. */
  onAutoSent?: () => void;
}): JSX.Element {
  const createConversation = useCreateConversation();
  // P2 §3.1 (2026-10-26): one first-message create at a time, refused synchronously, so a burst of
  // send events cannot create more than one conversation (useSendLock.ts).
  const createLock = useSendLock();
  const [started, setStarted] = useState<Started | null>(null);
  // The first message while its conversation is being created.
  const [pending, setPending] = useState<{
    scopeKey: string;
    text: string;
    intent: ReviewIntent | null;
  } | null>(null);
  // A tapped choice whose create failed: there is no typed text to give back, so the notice
  // says to try again rather than pointing at the composer.
  const [tapFailed, setTapFailed] = useState(false);
  const [draft, setDraft] = useState("");

  const startedHere = started?.scopeKey === scopeKey ? started : null;
  const conversationId = startedHere?.conversationId ?? lookup.id;
  const pendingHere = pending?.scopeKey === scopeKey ? pending : null;

  const startConversation = (text: string, intent?: ReviewIntent): void => {
    const releaseCreate = createLock.acquire();
    if (releaseCreate === null) return;
    const key = scopeKey;
    setPending({ scopeKey: key, text, intent: intent ?? null });
    setTapFailed(false);
    if (intent === undefined) setDraft("");
    createConversation.mutate(
      { ...createInput, idempotency_key: crypto.randomUUID() },
      {
        onSuccess: (conv) => {
          releaseCreate();
          setStarted({
            scopeKey: key,
            conversationId: conv.conversation_id,
            firstMessage: text,
            firstIntent: intent ?? null,
          });
          setPending(null);
          onStarted?.(conv.conversation_id);
        },
        onError: () => {
          releaseCreate();
          setPending(null);
          // The student's text goes back in the composer, never lost. A tapped choice's label
          // is not the student's text: it is not put in the composer (it would then be sent as
          // free text).
          if (intent === undefined) setDraft(text);
          else setTapFailed(true);
        },
      },
    );
  };

  const createError = createConversation.error;
  // Refused by the server, on load or on the first send. Never inferred here.
  const denied =
    isLisaEntitlementDenial(lookup.error) ||
    isLisaEntitlementDenial(createError);

  // A tap from outside the panel, with no conversation yet: the same create-then-send as a tap
  // on the opener's choices (a server call, so an effect; the ref keeps each tap to one send).
  // With a conversation, the thread sends it (TutorThread below).
  const autoSentHere = useRef<number | null>(null);
  useEffect(() => {
    if (autoSend === null || autoSentHere.current === autoSend.nonce) return;
    if (lookup.isLoading || denied || conversationId !== null) return;
    autoSentHere.current = autoSend.nonce;
    startConversation(REVIEW_INTENT_LABELS[autoSend.intent], autoSend.intent);
    onAutoSent?.();
    // Runs when the tap arrives or the lookup settles; `startConversation` is this render's.
  }, [autoSend, lookup.isLoading, denied, conversationId]);

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
        firstIntent={startedHere?.firstIntent ?? null}
        guidedChoices={guidedChoices}
        // A tap this body already handed over (it created this conversation) is not the
        // thread's to send again.
        autoSend={
          autoSend !== null && autoSentHere.current !== autoSend.nonce
            ? autoSend
            : null
        }
        onAutoSent={onAutoSent}
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
          <>
            <TutorOpener copy={copy.opener} />
            {guidedChoices !== null ? (
              <GuidedChoiceButtons
                choices={guidedChoices}
                disabled={false}
                onChoose={(intent) =>
                  startConversation(REVIEW_INTENT_LABELS[intent], intent)
                }
              />
            ) : null}
          </>
        )}
        {!pendingMessage && createError && (
          <p className="m-0 text-lyc-body text-lyc-muted" role="alert">
            {tapFailed
              ? "LISA isn't available right now. Try again in a moment."
              : "LISA isn't available right now. Your message is still below — try sending it again."}
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
  firstIntent,
  guidedChoices,
  autoSend,
  onAutoSent,
  copy,
  onEnded,
}: {
  conversationId: string;
  /** The student's first message, when this body just created the conversation for it. */
  firstMessage: string | null;
  /** The guided choice that first message was, or null when it was typed. */
  firstIntent: ReviewIntent | null;
  guidedChoices: GuidedChoicesState | null;
  autoSend: { nonce: number; intent: ReviewIntent } | null;
  onAutoSent: (() => void) | undefined;
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
    answeredIntent,
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
    void send(firstMessage, firstIntent ?? undefined);
    // Mount-only: `send` is stable for this conversation's first turn.
  }, []);

  const submit = (): void => {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    setOtherWaysToggled(null);
    void send(text);
  };

  // A tap from outside the panel on a conversation that exists: the thread's next turn, once the
  // thread has loaded, its first message (if it was just created for one) has gone, and no turn
  // is in flight (the send lock would refuse it, and the tap would be lost).
  const autoSentHere = useRef<number | null>(null);
  const turnBusy = turnState.kind === "thinking";
  useEffect(() => {
    if (autoSend === null || autoSentHere.current === autoSend.nonce) return;
    if (isLoading || turnBusy || firstAwaiting) return;
    autoSentHere.current = autoSend.nonce;
    void send(REVIEW_INTENT_LABELS[autoSend.intent], autoSend.intent);
    onAutoSent?.();
    // Runs when the tap arrives, the thread finishes loading, or a turn in flight settles.
  }, [autoSend, isLoading, turnBusy, firstAwaiting]);

  // "Other ways" (owner brief 2026-10-27): the choices stay reachable after the first message,
  // folded behind one quiet control. A video choice that found no video opens them again (the
  // server's reply says so; SCL-254). A tap sends the choice's exact label with its intent
  // through the same send path, under the same send lock.
  // null: the student has not toggled since the last send, so the reply decides.
  const [otherWaysToggled, setOtherWaysToggled] = useState<boolean | null>(
    null,
  );
  const noVideoFound =
    answeredIntent !== null &&
    isVideoIntent(answeredIntent) &&
    suggestedAction === null &&
    turnState.kind === "idle";
  const otherWaysOpen = otherWaysToggled ?? noVideoFound;
  const choose = (intent: ReviewIntent): void => {
    setOtherWaysToggled(null);
    void send(REVIEW_INTENT_LABELS[intent], intent);
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
          <>
            <TutorOpener copy={copy.opener} />
            {guidedChoices !== null ? (
              <GuidedChoiceButtons
                choices={guidedChoices}
                disabled={isThinking}
                onChoose={choose}
              />
            ) : null}
          </>
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

        {!isLoading &&
        !denied &&
        !isPaused &&
        !isEnded &&
        hasMessages &&
        hasGuidedChoices(guidedChoices) &&
        guidedChoices !== null ? (
          <div className="space-y-2">
            <button
              type="button"
              className={`${LYC_FOCUS} cursor-pointer rounded-sm border-0 bg-transparent p-0 text-lyc-body text-lyc-muted underline underline-offset-2 hover:text-lyc-ink-strong`}
              aria-expanded={otherWaysOpen}
              onClick={() => setOtherWaysToggled(!otherWaysOpen)}
              data-testid="tutor-other-ways"
            >
              Other ways LISA can help
            </button>
            {otherWaysOpen ? (
              <GuidedChoiceButtons
                choices={guidedChoices}
                disabled={isThinking}
                onChoose={choose}
              />
            ) : null}
          </div>
        ) : null}

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
