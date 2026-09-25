/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §2–§5]
 * @implemented 2026-09-23
 *
 * plain English: Standalone LISA chat page with sidebar, 8 UI states
 * (Main, Thinking, FailedTurn, NewSession, Crisis, Safeguarding,
 * EndSession, empty), client_turn_id idempotency (§3), and crisis/
 * safeguarding support cards driven entirely by server response content.
 */

import { useCallback, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Loader2, Plus, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  type TutorConversationSummary,
} from "@/hooks/tutor-client";
import { useTutorTurn } from "@/hooks/useTutorTurn";
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
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";

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
// ChatPage — main component
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const conversationId = useConversationIdFromSearch();

  const { data: conversationDetail, isLoading } =
    useConversation(conversationId);
  const { data: conversationsList } = useConversations();
  const createConversation = useCreateConversation();
  const endConversation = useEndConversation();

  const [draft, setDraft] = useState("");
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dismissedPremium, setDismissedPremium] = useState(false);

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
    send,
    retry: handleRetry,
    resume: handleResume,
    resumePending,
    reset: resetTurn,
  } = useTutorTurn(conversationId, messages, conversation);

  const isPaused = !!conversation?.crisis_paused_at;
  const isEnded = conversation?.status === "ended";
  const hasMessages = messages.length > 0 || optimisticMessage !== null;

  // Scroll management
  const scrollTrigger =
    (messages.length + (optimisticMessage ? 1 : 0)) * 2 +
    (turnState.kind === "thinking" ? 1 : 0);
  useScrollToBottomOnChange(scrollAnchorRef, scrollTrigger);

  // ── Navigation ────────────────────────────────────────────────────────

  const navigateToConversation = useCallback(
    (id: string) => {
      setLocation(`/chat?conversationId=${encodeURIComponent(id)}`);
      resetTurn();
      setDraft("");
      setMobileMenuOpen(false);
    },
    [setLocation, resetTurn],
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
      setDraft("");
      await send(messageText);
    },
    [send],
  );

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
        navigateToConversation("");
        setLocation("/chat");
      },
    });
  }, [conversationId, endConversation, navigateToConversation, setLocation]);

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
            resumePending={resumePending}
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
