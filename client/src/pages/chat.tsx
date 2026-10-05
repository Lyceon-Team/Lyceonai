/**
 * LISA (`/chat`): the conversation in a 760px reading column, the composer, and the right
 * panel's New session and history.
 *
 * @spec [student-UI register UI-56; §2 Free versus paid (LISA is paid; the entitlement denial
 *        contract, SCL-185: tutor denials stay 403 nested with `tutor_access`; LISA keeps its
 *        own predicate), OQ-29 (the feature-access map, reason plan | age; an under-13 student
 *        gets the age message, not the upgrade modal), OQ-39 (f) history includes ended
 *        sessions, (g) no subject under the header, OQ-44 (LISA's headline is the shipped
 *        `LISA_UPGRADE_PITCH.title`; no new wording), OQ-49 (this route comes off the light
 *        lock: route-shells.ts), UI-16 (history pages on the server's cursor); DESIGN.md §1
 *        (tokens only, 14px floor, motion only for the typing dots), §2 (App shell, LISA's right
 *        panel 320px, no slim footer), §3 (Typing indicator; Keyboard hook, no hint text),
 *        §4 LISA; prototype Lisa.dc.html (paid and free); evidence/wiring-table.md §10]
 *       [CC Brief "PR B: Standalone LISA Chat UI" §2–§5 (client_turn_id idempotency, the crisis
 *        and safeguarding cards drawn from the server's response); closure plan W4-11]
 * @implemented [2026-09-23; UI-56 2026-10-03]
 *
 * plain English: one page, three states, decided by the feature-access map on
 * `GET /api/profile` before any tutor request is made:
 *   - locked, reason `plan`: the prototype's free card (LISA's shipped headline, the prototype
 *     body) and "Unlock LISA", which opens the app's upgrade modal for `tutor_access`. No tutor
 *     route is called: the hooks that would call them are not mounted.
 *   - locked, reason `age` (under 13): the same headline with the server's own age message and
 *     no button. Never the upgrade pitch.
 *   - otherwise (granted, or no map): the conversation. The header names it (its title, else
 *     "New session") with End session; the column lists the turns, each labelled "You" or
 *     "LISA", the typing indicator while LISA thinks; the composer sends on Enter, adds a line
 *     on Shift+Enter (the shared keyboard hook), and Send is disabled while LISA thinks. With no
 *     conversation open the composer still takes a first message: the conversation is created
 *     then, and that message is sent through the same turn machine. The right panel holds
 *     New session (creates one and opens its empty column) and "Your sessions", newest first,
 *     with "Show older" while the server reports another page.
 *
 * THE SERVER STILL DECIDES. A map can be stale. Every tutor route refuses an unpaid student
 * first (Doc 03B §6.5), and any `entitlement_required` refusal (on the list, a conversation,
 * New session or a send) swaps the page for the locked card; the app's denial listener opens
 * the modal on the same refusal (UI-44). No client claim opens a composer.
 *
 * PRIVACY. Nothing on this page logs. A tutor exchange is held in the query cache for display
 * and nowhere else (Coding Standards §12.1; Doc 03B: exchanges are ephemeral).
 *
 * Replaces the pre-redesign page: its own full-height left sidebar with the LISA avatar and
 * "Sessions", the mobile sessions drawer, the "Welcome to LISA" empty state, the "What are we
 * working on?" subject shortcuts, the header's subject and start time, and "Load more sessions".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { FeatureLockReason } from "@lyceon/shared/feature-access";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { AppShellPanel } from "@/components/layout/app-shell";
import { Modal, ModalClose } from "@/components/student-ui";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useEndConversation,
  type TutorConversationSummary,
  type TutorMessage,
} from "@/hooks/tutor-client";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { useTutorTurn } from "@/hooks/useTutorTurn";
import {
  Composer,
  CrisisSupportCard,
  FailedTurnNotice,
  MessageBubble,
  PausedBar,
  SuggestedActionLink,
  ThinkingIndicator,
  useScrollToBottomOnChange,
} from "@/components/tutor/TutorThreadParts";
import {
  LISA_UPGRADE_PITCH,
  isLisaEntitlementDenial,
} from "@/components/tutor/LisaUpgradeCard";
import { dayMonth } from "@/features/exam/lib/tests-home-model";

/** Prototype Lisa.dc.html composer placeholder. */
export const LISA_COMPOSER_PLACEHOLDER = "Ask LISA about a question or a skill";

/** Shipped title of a conversation with none yet (the server titles it on the first turn). */
const UNTITLED = "New session";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function useConversationIdFromSearch(): string | null {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const raw = params.get("conversationId");
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/** The history row's date line, as the prototype writes it: "Today", else "24 September". */
export function historyWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? "Today" : dayMonth(iso);
}

function chatHref(conversationId: string): string {
  return `/chat?conversationId=${encodeURIComponent(conversationId)}`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default function ChatPage(): JSX.Element {
  // OQ-29: the map decides before any tutor request; nothing is asked while the profile loads.
  const profile = useProfileQuery();
  const access = useFeatureAccess();
  const tutor = access?.tutor_access ?? null;

  if (profile.isPending) {
    return (
      <div
        className="flex flex-1 flex-col gap-4 px-4 py-6 lg:px-10 lg:py-8"
        role="status"
        aria-label="Loading LISA"
      >
        <Skeleton variant="lyc" className="h-10 w-2/3 max-w-[480px]" />
        <Skeleton variant="lyc" className="h-24 w-full max-w-[760px]" />
      </div>
    );
  }
  if (tutor?.access === "locked") return <LisaLocked reason={tutor.reason} />;
  return <LisaConversation />;
}

// ---------------------------------------------------------------------------
// Locked: free plan, or under 13
// ---------------------------------------------------------------------------

/**
 * Prototype Lisa.dc.html, plan = free: the card in the content column, nothing in the right
 * panel. Copy: the approved LISA modal copy (OQ-44): the shipped headline and the prototype
 * body; under 13, the same headline and the server's age message with no button (OQ-29).
 */
function LisaLocked({ reason }: { reason: FeatureLockReason }): JSX.Element {
  const upgrade = useUpgradeModal();
  const copy = UPGRADE_MODAL_COPY.tutor_access[reason];
  return (
    <div
      className="flex-1 px-4 py-6 lg:overflow-y-auto lg:px-[72px] lg:py-14"
      data-testid="lisa-locked"
      data-reason={reason}
    >
      <section
        aria-labelledby="lisa-locked-h"
        className="flex max-w-[762px] flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-8 sm:px-10 sm:py-9"
      >
        <h1
          id="lisa-locked-h"
          className="m-0 font-lyc-serif text-[28px] font-semibold leading-tight text-lyc-ink-strong sm:text-[32px]"
        >
          {copy.title}
        </h1>
        <p className="m-0 text-[18px] leading-relaxed text-lyc-ink">
          {copy.body}
        </p>
        {reason === "plan" ? (
          <Button
            type="button"
            variant="lyc-primary"
            size="lyc-lg"
            className="self-start"
            data-testid="lisa-unlock"
            onClick={() => upgrade.open("tutor_access", "plan")}
          >
            {LISA_UPGRADE_PITCH.actionLabel}
          </Button>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The conversation (paid, or no map: the server decides)
// ---------------------------------------------------------------------------

function LisaConversation(): JSX.Element {
  const [, setLocation] = useLocation();
  const conversationId = useConversationIdFromSearch();

  const {
    data: conversationDetail,
    isLoading,
    error: conversationError,
  } = useConversation(conversationId);
  const {
    data: conversationsList,
    error: conversationsError,
    isPending: conversationsPending,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useConversations();
  const createConversation = useCreateConversation();
  const endConversation = useEndConversation();

  const [draft, setDraft] = useState("");
  const [endModalOpen, setEndModalOpen] = useState(false);
  /** A first message typed with no conversation open, while its conversation is created. */
  const [firstMessage, setFirstMessage] = useState<string | null>(null);
  /** That message, once its conversation exists, waiting for the page to open it. */
  const [queued, setQueued] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const conversations = conversationsList?.conversations ?? [];
  const messages = conversationDetail?.messages ?? [];
  const conversation = conversationDetail?.conversation;

  const {
    turnState,
    optimisticMessage,
    crisisLane,
    effectiveCrisisContent,
    showCrisisCard,
    premiumReason,
    suggestedAction,
    send,
    retry: handleRetry,
    resume: handleResume,
    resumePending,
    reset: resetTurn,
  } = useTutorTurn(conversationId, messages, conversation);

  const isPaused = !!conversation?.crisis_paused_at;
  const isEnded = conversation?.status === "ended";
  const hasMessages = messages.length > 0 || optimisticMessage !== null;

  // W4-11: the server refused this student LISA — on the session list, the conversation,
  // "New session" or a send. Only a server refusal counts.
  const denied =
    isLisaEntitlementDenial(conversationsError) ||
    isLisaEntitlementDenial(conversationError) ||
    isLisaEntitlementDenial(createConversation.error) ||
    premiumReason !== null;
  const createFailed =
    createConversation.error !== null &&
    !isLisaEntitlementDenial(createConversation.error);

  const isThinking = turnState.kind === "thinking";
  const scrollTrigger =
    (messages.length + (optimisticMessage ? 1 : 0)) * 2 +
    (isThinking || firstMessage !== null ? 1 : 0);
  useScrollToBottomOnChange(scrollAnchorRef, scrollTrigger);

  // ── Navigation ────────────────────────────────────────────────────────

  const navigateToConversation = useCallback(
    (id: string) => {
      setLocation(id ? chatHref(id) : "/chat");
      resetTurn();
      setDraft("");
    },
    [setLocation, resetTurn],
  );

  // ── New session ───────────────────────────────────────────────────────

  // `mutate`, never `mutateAsync` in an empty catch: the failure stays on
  // `createConversation.error`, which the page reads (W4-11).
  const createThen = useCallback(
    (onCreated: (conversationId: string) => void, onFailed?: () => void) => {
      createConversation.mutate(
        {
          entry_mode: "general",
          source_surface: "dashboard",
          idempotency_key: crypto.randomUUID(),
        },
        {
          onSuccess: (conv) => onCreated(conv.conversation_id),
          ...(onFailed ? { onError: onFailed } : {}),
        },
      );
    },
    [createConversation],
  );

  const handleNewSession = useCallback(() => {
    createThen((id) => navigateToConversation(id));
  }, [createThen, navigateToConversation]);

  // ── Send ──────────────────────────────────────────────────────────────

  const handleComposerSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (conversationId) {
      void send(text);
      return;
    }
    // No conversation open: create one for this message, then send it there.
    setFirstMessage(text);
    createThen(
      (id) => {
        setQueued({ conversationId: id, text });
        navigateToConversation(id);
      },
      () => {
        // The student's words go back in the composer, never lost.
        setFirstMessage(null);
        setDraft(text);
      },
    );
  }, [draft, conversationId, send, createThen, navigateToConversation]);

  // Once the page has opened the conversation created for a first message, that message is
  // sent through the turn machine, once: a server call, so an effect.
  useEffect(() => {
    if (queued === null || queued.conversationId !== conversationId) return;
    setQueued(null);
    setFirstMessage(null);
    void send(queued.text);
  }, [queued, conversationId, send]);

  // ── End session ───────────────────────────────────────────────────────

  const handleEndSession = useCallback(() => {
    if (!conversationId) return;
    endConversation.mutate(conversationId, {
      onSuccess: () => {
        setEndModalOpen(false);
        navigateToConversation("");
      },
    });
  }, [conversationId, endConversation, navigateToConversation]);

  // ── Locked by the server ──────────────────────────────────────────────

  if (denied) return <LisaLocked reason="plan" />;

  const firstMessageBubble: TutorMessage | null =
    firstMessage !== null
      ? {
          message_id: "pending-first-message",
          role: "student",
          content_kind: "message",
          message: firstMessage,
          created_at: new Date(0).toISOString(),
          client_turn_id: null,
        }
      : null;

  const composerDisabled =
    isThinking || isPaused || isEnded || firstMessage !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="lisa-page">
      <header className="flex min-h-[73px] shrink-0 items-center justify-between gap-4 border-b border-lyc-rule px-4 py-4 lg:px-10 lg:min-h-[81px] lg:py-5">
        <h1
          className="m-0 min-w-0 truncate font-lyc-serif text-[22px] font-semibold text-lyc-ink-strong lg:text-[24px]"
          data-testid="lisa-title"
        >
          {conversation?.title ?? UNTITLED}
        </h1>
        {conversationId && hasMessages && !isEnded ? (
          <Button
            type="button"
            variant="lyc-outline"
            size="lyc"
            className="h-10 shrink-0 border-lyc-input-bd px-4 text-[15px]"
            onClick={() => setEndModalOpen(true)}
            disabled={endConversation.isPending}
          >
            End session
          </Button>
        ) : null}
      </header>

      <div
        className="min-h-0 flex-1 px-4 py-6 lg:overflow-y-auto lg:px-10 lg:py-8"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Conversation with LISA"
      >
        <ol
          aria-label="Conversation"
          className="m-0 mx-auto flex max-w-[760px] list-none flex-col gap-[22px] p-0"
        >
          {isLoading ? (
            <li role="status" aria-label="Loading conversation">
              <Skeleton variant="lyc" className="h-24 w-full" />
            </li>
          ) : null}

          {!isLoading &&
            messages.map((message) => (
              <li key={message.message_id}>
                <MessageBubble message={message} />
              </li>
            ))}

          {/* The student's just-sent message, before the thread refetches (W2-10). */}
          {!isLoading && optimisticMessage ? (
            <li key={optimisticMessage.message_id}>
              <MessageBubble message={optimisticMessage} pending />
            </li>
          ) : null}

          {firstMessageBubble ? (
            <li>
              <MessageBubble message={firstMessageBubble} pending />
            </li>
          ) : null}

          {turnState.kind === "idle" &&
          suggestedAction?.type === "start_practice" ? (
            <li>
              <SuggestedActionLink action={suggestedAction} />
            </li>
          ) : null}

          {isThinking || firstMessage !== null ? (
            <li>
              <ThinkingIndicator />
            </li>
          ) : null}

          {turnState.kind === "failed" ? (
            <li>
              <FailedTurnNotice onRetry={handleRetry} />
            </li>
          ) : null}

          {showCrisisCard && crisisLane && effectiveCrisisContent ? (
            <li>
              <CrisisSupportCard
                lane={crisisLane}
                content={effectiveCrisisContent}
              />
            </li>
          ) : null}

          {createFailed ? (
            <li>
              <p className="m-0 text-lyc-body text-lyc-muted" role="alert">
                Couldn&apos;t start a session. Try again.
              </p>
            </li>
          ) : null}
        </ol>
        <div ref={scrollAnchorRef} />
      </div>

      {showCrisisCard || isPaused ? (
        <PausedBar
          onEnd={() => setEndModalOpen(true)}
          onContinue={handleResume}
          endPending={endConversation.isPending}
          resumePending={resumePending}
        />
      ) : isEnded ? null : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={handleComposerSubmit}
          disabled={composerDisabled}
          placeholder={LISA_COMPOSER_PLACEHOLDER}
        />
      )}

      <AppShellPanel>
        <HistoryPanel
          conversations={conversations}
          loading={conversationsPending}
          activeId={conversationId}
          onSelect={navigateToConversation}
          onNewSession={handleNewSession}
          newSessionPending={createConversation.isPending}
          hasMore={!!hasNextPage}
          onShowOlder={() => void fetchNextPage()}
          loadingOlder={isFetchingNextPage}
        />
      </AppShellPanel>

      <EndSessionModal
        open={endModalOpen}
        onOpenChange={setEndModalOpen}
        onConfirm={handleEndSession}
        pending={endConversation.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel: New session, Your sessions, Show older (UI-16 cursor)
// ---------------------------------------------------------------------------

function HistoryPanel({
  conversations,
  loading,
  activeId,
  onSelect,
  onNewSession,
  newSessionPending,
  hasMore,
  onShowOlder,
  loadingOlder,
}: {
  conversations: TutorConversationSummary[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  newSessionPending: boolean;
  /** The server said another page exists (`pagination.has_more`, Doc 03B §8.5). */
  hasMore: boolean;
  onShowOlder: () => void;
  loadingOlder: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3.5" data-testid="lisa-history">
      <Button
        type="button"
        variant="lyc-outline"
        size="lyc"
        className="w-full"
        onClick={onNewSession}
        disabled={newSessionPending}
        data-testid="lisa-new-session"
      >
        New session
      </Button>
      <h2 className="m-0 mt-2 font-lyc-serif text-[19px] font-semibold text-lyc-ink-strong">
        Your sessions
      </h2>
      {loading ? (
        <Skeleton variant="lyc" className="h-32 w-full" />
      ) : conversations.length === 0 ? (
        <p className="m-0 text-lyc-meta-lg text-lyc-muted">No sessions yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {conversations.map((conv) => {
            const current = conv.conversation_id === activeId;
            return (
              <li key={conv.conversation_id}>
                <a
                  href={chatHref(conv.conversation_id)}
                  aria-current={current ? "page" : undefined}
                  data-testid="lisa-history-item"
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(conv.conversation_id);
                  }}
                  className={`${LYC_FOCUS} flex flex-col gap-0.5 rounded-md px-3 py-2.5 no-underline hover:bg-lyc-hover ${
                    current ? "bg-lyc-chip text-lyc-ink-strong" : "text-lyc-ink"
                  }`}
                >
                  <span className="break-words text-lyc-body font-semibold">
                    {conv.title ?? UNTITLED}
                  </span>
                  <span className="text-lyc-meta text-lyc-muted">
                    {historyWhen(conv.updated_at)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <Button
          type="button"
          variant="lyc-link"
          className="self-start px-3 py-1.5 text-[15px]"
          onClick={onShowOlder}
          disabled={loadingOlder}
          data-testid="lisa-show-older"
        >
          Show older
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// End session
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
}): JSX.Element {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      data-testid="lisa-end-modal"
      title="End this session?"
      // Shipped copy, less its first sentence ("It will close and leave your sessions list"):
      // OQ-39 (f) keeps ended sessions in the history.
      description="You won't be able to reopen it."
      footer={
        <>
          <Button
            type="button"
            variant="lyc-primary"
            size="lyc"
            onClick={onConfirm}
            disabled={pending}
          >
            End session
          </Button>
          <ModalClose asChild>
            <Button
              type="button"
              variant="lyc-quiet"
              size="lyc"
              disabled={pending}
            >
              Cancel
            </Button>
          </ModalClose>
        </>
      }
    />
  );
}
