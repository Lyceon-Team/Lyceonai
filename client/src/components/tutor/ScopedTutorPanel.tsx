/**
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness),
 *        CR-02B-29; closure plan W4-1 (LISA in review — launch scope, owner
 *        ruling 2026-09-25), W4-4 (LISA always open in review)]
 *       [student-UI register UI-53; OQ-54 (a) and OQ-57 (f), owner ruling
 *        2026-10-05: "Move the review runner's LISA panel onto student tokens
 *        in #1073 now"; DESIGN.md §1 (tokens only, 14px floor)]
 * @implemented 2026-09-25 | @updated 2026-09-25 — W4-4 | @updated 2026-10-05 — student tokens
 *
 * STUDENT TOKENS (2026-10-05). The frame, header, question chip, opener,
 * loading and error lines draw with the `lyc-*` tokens only, as the thread
 * parts shared with /chat already did (UI-56), and the denial card is the
 * /chat locked card's twin (`LisaUpgradeCard`). Nothing here reads the
 * app-wide light tokens any more, which is what let the review runner leave
 * the light lock (`route-shells.ts`). The composer and paused bar take the
 * "panel" inset: 16px sides at every width inside the 360px column.
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
 *
 * W4-11 — AN UNPAID STUDENT NEVER HOLDS A COMPOSER. The on-load lookup is a
 * tutor request like any other, so the server refuses it for an unpaid
 * student before anything is typed. That refusal — and only that, never a
 * client-side guess — swaps the opener and the composer for the LISA upgrade
 * card. The same holds inside a thread: a conversation whose load or next
 * send is refused (entitlement lapsed) loses its composer to the card. The
 * question and Desmos are outside this panel and are untouched. Why the
 * composer must go rather than be disabled on send: the server checks
 * entitlement before crisis detection (Doc 03B §6.5, kept by owner ruling
 * 2026-09-27), so a refused student's message is never read at all.
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
      className="flex gap-3 rounded-lg border border-lyc-rule bg-lyc-paper p-4"
      data-testid="tutor-opener"
    >
      <LisaAvatar />
      <div className="min-w-0">
        <p className="m-0 text-lyc-body font-semibold text-lyc-ink-strong">
          {OPENER_TITLE}
        </p>
        <p className="m-0 mt-1 text-lyc-body text-lyc-muted">{OPENER_BODY}</p>
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
  revealOnOpen = false,
  revealKey = 0,
}: {
  sourceSurface: Extract<TutorSourceSurface, "review" | "practice">;
  sessionItemId: string;
  /** Names the question under review: the runner's own "Question N of M" (OQ-54). */
  questionLabel: string;
  /** Hide LISA for the current question; it returns on the next. */
  onHide: () => void;
  /**
   * QA 2026-10-07 item 8: the student opened LISA (Show LISA) where the panel stacks under the
   * question (the phone layout), so it opens scrolled into view, its header at the top of the
   * runner's scroll area. False when LISA is simply there (every question, W4-4), so a question
   * never loads scrolled away from itself.
   */
  revealOnOpen?: boolean;
  /**
   * QA 2026-10-08 item D (Karl: "tapping the icon always brings it into view"): the runner
   * bumps this when the student taps the LISA icon while the panel is already open but scrolled
   * out of view, so the same reveal runs again without remounting (the thread, the draft and
   * the scroll position inside the panel are kept). Read only with `revealOnOpen`.
   */
  revealKey?: number;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  // On mount (the panel mounts when it is opened, and it is the opening that is revealed) and
  // again on each `revealKey` (QA2-D: a tap on the icon while open but out of view).
  // The runner is still laying out the question above it when LISA mounts (measured at 390: its
  // column grows a frame later, so a single scroll stopped short), so the reveal is repeated
  // each frame until the panel holds still (at most 30 frames, ~0.5s), and stops at once if
  // the student scrolls, touches or types. "auto", not "smooth": DESIGN.md §1 allows no motion
  // but the LISA dots.
  useEffect(() => {
    const el = sectionRef.current;
    if (!revealOnOpen || !el) return;
    let frame = 0;
    let frames = 0;
    let stopped = false;
    let lastTop = Number.NaN;
    const reveal = (): void => {
      if (stopped) return;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      const top = el.getBoundingClientRect().top;
      const settled = top === lastTop;
      lastTop = top;
      frames += 1;
      // At least 10 frames (~160ms: the late growth was within two), then until it holds still.
      if (frames < 30 && (frames < 10 || !settled))
        frame = requestAnimationFrame(reveal);
    };
    const stop = (): void => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
    const inputs = ["wheel", "touchstart", "keydown"] as const;
    for (const type of inputs)
      window.addEventListener(type, stop, { passive: true, once: true });
    reveal();
    return () => {
      stop();
      for (const type of inputs) window.removeEventListener(type, stop);
    };
  }, [revealKey]);
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
  // Refused by the server, on load or on the first send. Never inferred here.
  const denied =
    isLisaEntitlementDenial(existing.error) ||
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

  return (
    // SCL-204 / R32: `ph-no-capture` — the LISA conversation is never recorded (Coding Standards §12).
    <section
      ref={sectionRef}
      className="ph-no-capture flex h-full min-h-[480px] flex-col overflow-hidden rounded-lg border border-lyc-rule bg-lyc-sheet"
      aria-label="LISA"
      data-testid="scoped-tutor-panel"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-lyc-rule bg-lyc-paper px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <LisaAvatar />
          <span className="font-lyc-serif text-lyc-body font-semibold text-lyc-ink-strong">
            LISA
          </span>
          <span
            className="truncate rounded-full border border-lyc-rule bg-lyc-chip px-2.5 py-0.5 text-lyc-meta font-semibold text-lyc-ink"
            data-testid="tutor-question-chip"
          >
            {questionLabel}
          </span>
        </div>
        <Button
          type="button"
          variant="lyc-quiet"
          size="lyc-icon"
          onClick={onHide}
          aria-label="Hide LISA"
          className="shrink-0 text-lyc-body"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>

      {conversationId ? (
        <ScopedThread
          key={conversationId}
          conversationId={conversationId}
          firstMessage={startedHere?.firstMessage ?? null}
          onEnded={onHide}
        />
      ) : denied ? (
        <LisaUpgradeCard />
      ) : existing.isLoading ? (
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
              <p className="m-0 text-lyc-body text-lyc-muted" role="alert">
                LISA isn&apos;t available right now. Your message is still below
                — try sending it again.
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
              pendingMessage ? "LISA is responding..." : COMPOSER_PLACEHOLDER
            }
            inset="panel"
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
        aria-label="Conversation with LISA about this question"
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
          <TutorOpener />
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
              : COMPOSER_PLACEHOLDER
          }
          inset="panel"
        />
      )}
    </>
  );
}
