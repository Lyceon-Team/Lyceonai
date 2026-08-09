/**
 * @spec [Doc-03B_V2 §3 (Entry Points)]
 * @implemented 2026-08-09
 *
 * plain English: Entry page for the LISA tutor. Shows conversation list and
 * allows starting new conversations. Routes to the chat page for active
 * conversations.
 *
 * expected outcome: student sees their conversation history and can start
 * a new conversation. Clicking a conversation navigates to the chat page.
 *
 * edge cases: the chat route (`/chat`) carries no `:conversationId` path
 * segment, so navigation passes the conversation as a `conversationId`
 * search param instead of a route param. "New Conversation" always starts a
 * `general` / `dashboard` conversation from this surface — the server's
 * reuse rule (Doc 03B §5.6) decides whether that resolves to an existing
 * active conversation or creates a new one; this page does not guess.
 */

import { useLocation } from "wouter";
import { MessageSquarePlus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  useConversations,
  useCreateConversation,
  type TutorConversationSummary,
} from "@/hooks/tutor-client";

function conversationTitle(conversation: TutorConversationSummary): string {
  if (conversation.last_message_preview) {
    return conversation.last_message_preview;
  }
  return "New conversation";
}

export default function TutorPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error } = useConversations();
  const createConversation = useCreateConversation();

  const conversations = data?.conversations ?? [];

  const goToConversation = (conversationId: string): void => {
    setLocation(`/chat?conversationId=${encodeURIComponent(conversationId)}`);
  };

  const handleNewConversation = async (): Promise<void> => {
    try {
      const conversation = await createConversation.mutateAsync({
        entry_mode: "general",
        source_surface: "dashboard",
      });
      goToConversation(conversation.conversation_id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to start a new conversation.";
      toast({
        title: "Couldn't start conversation",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col p-4">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-bold text-foreground">LISA Tutor</h1>
        <Button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
        >
          {createConversation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-4 w-4" />
          )}
          New Conversation
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && error && (
          <Card className="p-4 text-sm text-destructive">
            Could not load your conversations. Please try again.
          </Card>
        )}

        {!isLoading && !error && conversations.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Start one to talk with LISA.
          </Card>
        )}

        {!isLoading &&
          !error &&
          conversations.map((conversation) => (
            <Card
              key={conversation.conversation_id}
              className="flex cursor-pointer items-center justify-between p-4 hover:bg-secondary"
              onClick={() => goToConversation(conversation.conversation_id)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {conversationTitle(conversation)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {conversation.message_count} messages ·{" "}
                  {conversation.source_surface}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Card>
          ))}
      </div>
    </div>
  );
}
