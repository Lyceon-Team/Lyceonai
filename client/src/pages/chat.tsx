import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Sparkles, Info, MessageSquare, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { PremiumUpgradePrompt, type PremiumPromptReason } from "@/components/billing/PremiumUpgradePrompt";
import {
  appendTutorMessage,
  fetchTutorConversation,
  startTutorConversation,
  TutorClientRequestError,
  type TutorFetchConversationResponse,
} from "@/lib/tutor-client";
import { TutorSuggestedActionSchema, TutorUiHintsSchema } from "@shared/tutor-contract";

type TutorSuggestedAction = {
  type: "none" | "offer_similar_question" | "offer_broader_coaching" | "offer_stay_focused";
  label: string | null;
};

type TutorUiHints = {
  show_accept_decline: boolean;
  allow_freeform_reply: boolean;
  suggested_chip: string | null;
};

type MessageType = "user" | "tutor";

interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  pending?: boolean;
  suggestedAction?: TutorSuggestedAction | null;
  uiHints?: TutorUiHints | null;
}

interface PendingTurnState {
  clientTurnId: string;
  message: string;
  userMessageId: string;
  tutorPlaceholderId: string;
  retryable: boolean;
}

function makeClientTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function extractTutorMetadata(contentJson: unknown): {
  suggestedAction?: TutorSuggestedAction | null;
  uiHints?: TutorUiHints | null;
} {
  if (!contentJson || typeof contentJson !== "object") {
    return {};
  }
  const record = contentJson as Record<string, unknown>;
  const suggestedActionParsed = TutorSuggestedActionSchema.safeParse(record.suggested_action);
  const uiHintsParsed = TutorUiHintsSchema.safeParse(record.ui_hints);

  return {
    suggestedAction: suggestedActionParsed.success ? suggestedActionParsed.data : undefined,
    uiHints: uiHintsParsed.success ? uiHintsParsed.data : undefined,
  };
}

function toUiMessages(
  messages: TutorFetchConversationResponse["data"]["messages"],
): ChatMessage[] {
  return messages.map((message) => {
    const role = message.role === "student" ? "user" : "tutor";
    const tutorMetadata = role === "tutor" ? extractTutorMetadata(message.content_json) : {};
    return {
      id: message.id,
      type: role,
      content: message.message,
      timestamp: toDate(message.created_at),
      ...tutorMetadata,
    };
  });
}

function replaceMessage(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    return updater(message);
  });
}

function mapTutorErrorToPremiumReason(error: unknown): PremiumPromptReason | null {
  if (!(error instanceof TutorClientRequestError)) return null;
  const normalized = error.code.trim().toUpperCase();
  if (normalized === "PAYMENT_REQUIRED") return "payment_required";
  if (normalized === "PREMIUM_REQUIRED") return "premium_required";
  return null;
}

export default function Chat() {
  const { user } = useSupabaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingTurn, setPendingTurn] = useState<PendingTurnState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [premiumPromptReason, setPremiumPromptReason] = useState<PremiumPromptReason | null>(null);
  const [premiumPromptDismissed, setPremiumPromptDismissed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const bootstrapPromiseRef = useRef<Promise<string | null> | null>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const bootstrapConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (bootstrapPromiseRef.current) return bootstrapPromiseRef.current;

    const bootstrapPromise = (async () => {
      setIsBootstrapping(true);
      try {
        const startResponse = await startTutorConversation({
          entry_mode: "general",
          source_surface: "dashboard",
          source_session_id: null,
          source_session_item_id: null,
          source_question_row_id: null,
          source_question_canonical_id: null,
        });
        const activeConversationId = startResponse.data.conversation_id;
        setConversationId(activeConversationId);

        const conversationResponse = await fetchTutorConversation(activeConversationId);
        setMessages(toUiMessages(conversationResponse.data.messages));
        setRequestError(null);
        setPremiumPromptReason(null);
        setPremiumPromptDismissed(false);
        return activeConversationId;
      } catch (error) {
        const premiumReason = mapTutorErrorToPremiumReason(error);
        if (premiumReason) {
          setPremiumPromptReason(premiumReason);
          setPremiumPromptDismissed(false);
          setRequestError(null);
          return null;
        }
        const message =
          error instanceof TutorClientRequestError
            ? error.message
            : "Unable to initialize tutor conversation.";
        setRequestError(message);
        return null;
      } finally {
        setIsBootstrapping(false);
      }
    })().finally(() => {
      bootstrapPromiseRef.current = null;
    });

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }, [conversationId]);

  useEffect(() => {
    void bootstrapConversation();
  }, [bootstrapConversation]);

  const submitTurn = useCallback(
    async (args: { activeConversationId: string; turn: PendingTurnState }) => {
      setIsSubmitting(true);
      setRequestError(null);

      try {
        const response = await appendTutorMessage({
          conversation_id: args.activeConversationId,
          message: args.turn.message,
          content_kind: "message",
          client_turn_id: args.turn.clientTurnId,
        });

        setMessages((currentMessages) =>
          replaceMessage(currentMessages, args.turn.tutorPlaceholderId, (message) => ({
            ...message,
            pending: false,
            content: response.data.response.content,
            suggestedAction: response.data.response.suggested_action ?? null,
            uiHints: response.data.response.ui_hints ?? null,
          })),
        );
        setPendingTurn((currentPendingTurn) =>
          currentPendingTurn?.clientTurnId === args.turn.clientTurnId ? null : currentPendingTurn,
        );
        setPremiumPromptReason(null);
      } catch (error) {
        const premiumReason = mapTutorErrorToPremiumReason(error);
        if (premiumReason) {
          setPremiumPromptReason(premiumReason);
          setPremiumPromptDismissed(false);
          setRequestError(null);
          setMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== args.turn.tutorPlaceholderId),
          );
          setPendingTurn((currentPendingTurn) =>
            currentPendingTurn?.clientTurnId === args.turn.clientTurnId ? null : currentPendingTurn,
          );
          return;
        }

        if (error instanceof TutorClientRequestError && error.code === "TUTOR_RECOVERABLE_RETRY_REQUIRED") {
          setPendingTurn((currentPendingTurn) => {
            if (!currentPendingTurn || currentPendingTurn.clientTurnId !== args.turn.clientTurnId) {
              return currentPendingTurn;
            }
            return {
              ...currentPendingTurn,
              retryable: true,
            };
          });
          setRequestError(error.message);
          return;
        }

        setMessages((currentMessages) =>
          currentMessages.filter((message) => message.id !== args.turn.tutorPlaceholderId),
        );
        setPendingTurn((currentPendingTurn) =>
          currentPendingTurn?.clientTurnId === args.turn.clientTurnId ? null : currentPendingTurn,
        );

        const message =
          error instanceof TutorClientRequestError
            ? error.message
            : "Failed to send message. Please try again.";
        setRequestError(message);
        toast({
          title: "Tutor request failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [toast],
  );

  const handleSendMessage = async () => {
    const messageContent = inputValue.trim();
    if (!messageContent || isSubmitting || pendingTurn) return;

    const activeConversationId = conversationId ?? (await bootstrapConversation());
    if (!activeConversationId) {
      if (premiumPromptReason) {
        return;
      }
      toast({
        title: "Tutor unavailable",
        description: "Unable to initialize tutor conversation.",
        variant: "destructive",
      });
      return;
    }

    const clientTurnId = makeClientTurnId();
    const userMessageId = `user-${clientTurnId}`;
    const tutorPlaceholderId = `pending-${clientTurnId}`;
    const turn: PendingTurnState = {
      clientTurnId,
      message: messageContent,
      userMessageId,
      tutorPlaceholderId,
      retryable: false,
    };

    setInputValue("");
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: userMessageId,
        type: "user",
        content: messageContent,
        timestamp: new Date(),
      },
      {
        id: tutorPlaceholderId,
        type: "tutor",
        content: "Lisa is thinking...",
        timestamp: new Date(),
        pending: true,
      },
    ]);
    setPendingTurn(turn);
    await submitTurn({ activeConversationId, turn });
  };

  const handleRetryLastMessage = async () => {
    if (!pendingTurn || !pendingTurn.retryable || isSubmitting) return;

    const activeConversationId = conversationId ?? (await bootstrapConversation());
    if (!activeConversationId) return;

    const retryTurn = {
      ...pendingTurn,
      retryable: false,
    };
    setPendingTurn(retryTurn);
    setRequestError(null);
    await submitTurn({ activeConversationId, turn: retryTurn });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString();
  };

  const inputDisabled = isSubmitting || isBootstrapping || Boolean(pendingTurn);

  return (
    <AppShell>
      {premiumPromptReason && !premiumPromptDismissed && (
        <PremiumUpgradePrompt
          reason={premiumPromptReason}
          mode="floating"
          onDismiss={() => setPremiumPromptDismissed(true)}
        />
      )}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        <div className="mb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">AI Tutor</p>
              <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
                Lisa Tutor Chat
              </h1>
              <p className="text-muted-foreground">
                Ask SAT questions and get canonical tutor guidance from the secured runtime.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/70 border border-border/60 self-start">
              <Sparkles className="h-4 w-4 text-foreground" />
              <span className="text-sm font-medium text-foreground">Tutor Runtime · /api/tutor/messages</span>
            </div>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-lg bg-secondary/60 border border-border/60">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-medium mb-1">How this tutor works:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Conversation and message flow is server-authoritative.</li>
                <li>Hints and suggested actions come from backend policy/runtime responses.</li>
                <li>When safe completion fails, retry reuses the same logical turn.</li>
              </ul>
            </div>
          </div>
        </div>

        {requestError && (
          <div className="mb-6 p-4 rounded-lg border border-red-200 bg-red-50/70">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                <span>{requestError}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRetryLastMessage()}
                disabled={!pendingTurn?.retryable || isSubmitting}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border/60 bg-card/90 shadow-sm">
          <div
            className="h-[500px] overflow-y-auto p-6 space-y-6"
            data-testid="chat-messages-container"
          >
            {messages.length === 0 && !isSubmitting && !isBootstrapping ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Start a conversation</h3>
                <p className="text-muted-foreground max-w-md">
                  Ask a SAT question and Lisa will respond using the canonical tutor runtime.
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.type === "user" ? "flex-row-reverse" : ""}`}
                    data-testid={`message-${message.id}`}
                  >
                    {message.type === "tutor" && (
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary">
                          <Sparkles className="h-5 w-5 text-primary-foreground" />
                        </div>
                      </div>
                    )}

                    <div className={`flex-1 max-w-[85%] ${message.type === "user" ? "flex justify-end" : ""}`}>
                      <div>
                        <div
                          className={`rounded-2xl p-4 ${
                            message.type === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p
                            className="text-sm whitespace-pre-wrap leading-relaxed"
                            data-testid={`text-message-content-${message.id}`}
                          >
                            {message.content}
                          </p>

                          {message.pending && (
                            <p className="text-xs text-muted-foreground mt-3" data-testid={`text-message-pending-${message.id}`}>
                              Waiting for canonical tutor response...
                            </p>
                          )}

                          {message.type === "tutor" && !message.pending && (message.suggestedAction || message.uiHints) && (
                            <div className="border-t border-border/50 pt-3 mt-3">
                              <div className="flex flex-wrap gap-2">
                                {message.suggestedAction && message.suggestedAction.type !== "none" && (
                                  <Badge
                                    variant="secondary"
                                    data-testid={`badge-suggested-action-${message.id}`}
                                  >
                                    {message.suggestedAction.label ?? message.suggestedAction.type}
                                  </Badge>
                                )}
                                {message.uiHints?.suggested_chip && (
                                  <Badge
                                    variant="secondary"
                                    data-testid={`badge-suggested-chip-${message.id}`}
                                  >
                                    {message.uiHints.suggested_chip}
                                  </Badge>
                                )}
                              </div>
                              {message.uiHints && (
                                <p
                                  className="text-xs text-muted-foreground mt-2"
                                  data-testid={`text-ui-hints-${message.id}`}
                                >
                                  UI hints: accept/decline {message.uiHints.show_accept_decline ? "on" : "off"} · freeform {message.uiHints.allow_freeform_reply ? "on" : "off"}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <p
                          className={`text-xs text-muted-foreground mt-2 ${
                            message.type === "user" ? "text-right" : ""
                          }`}
                          data-testid={`text-message-time-${message.id}`}
                        >
                          {formatTime(message.timestamp)}
                        </p>
                      </div>
                    </div>

                    {message.type === "user" && (
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center">
                          <span className="text-sm font-semibold text-foreground">
                            {user?.email?.charAt(0).toUpperCase() || "U"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {(isSubmitting || isBootstrapping) && (
                  <div className="flex gap-3" data-testid="loading-indicator">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary">
                        <Sparkles className="h-5 w-5 text-primary-foreground" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="bg-muted rounded-2xl p-4">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Type your question here..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={inputDisabled}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button
                onClick={() => void handleSendMessage()}
                disabled={inputDisabled || !inputValue.trim()}
                size="lg"
                data-testid="button-send-message"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
