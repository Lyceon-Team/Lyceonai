import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Sparkles, FileText, Info, MessageSquare, RefreshCw, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

interface ChatMessage {
  id: string;
  type: 'user' | 'tutor';
  content: string;
  timestamp: Date;
  sources?: Array<{
    questionId: string;
    documentName: string;
    pageNumber: number;
    questionNumber: number;
  }>;
}

interface RagQuestionContext {
  canonicalId?: string;
  sectionCode?: string;
  stem?: string;
}

interface RagQueryV2Response {
  context?: {
    primaryQuestion?: RagQuestionContext | null;
    supportingQuestions?: RagQuestionContext[];
    competencyContext?: {
      studentWeakAreas?: string[];
      studentStrongAreas?: string[];
    };
  };
  metadata?: {
    processingTimeMs?: number;
  };
}

function formatRagContextMessage(payload: RagQueryV2Response): string {
  const context = payload.context;
  const primaryQuestion = context?.primaryQuestion;
  const supportingQuestions = context?.supportingQuestions ?? [];
  const weakAreas = context?.competencyContext?.studentWeakAreas ?? [];
  const strongAreas = context?.competencyContext?.studentStrongAreas ?? [];

  const lines: string[] = [];
  if (primaryQuestion?.stem) {
    const stem = primaryQuestion.stem.length > 220 ? `${primaryQuestion.stem.slice(0, 220)}...` : primaryQuestion.stem;
    lines.push(`Primary context: ${stem}`);
  }
  if (supportingQuestions.length > 0) {
    lines.push(`Retrieved ${supportingQuestions.length} related SAT question contexts.`);
  }
  if (weakAreas.length > 0) {
    lines.push(`Likely weak areas: ${weakAreas.slice(0, 4).join(", ")}.`);
  }
  if (strongAreas.length > 0) {
    lines.push(`Likely strong areas: ${strongAreas.slice(0, 3).join(", ")}.`);
  }
  if (payload.metadata?.processingTimeMs != null) {
    lines.push(`Runtime latency: ${payload.metadata.processingTimeMs}ms.`);
  }
  if (lines.length === 0) {
    return "No matching SAT context was retrieved. Try adding a section or a more specific question.";
  }
  return lines.join("\n");
}

export default function Chat() {
  const { user } = useSupabaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim() || isLoading) return;

    setRequestError(null);
    setInputValue("");
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: messageContent,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await apiRequest('/api/rag/v2', {
        method: 'POST',
        body: JSON.stringify({
          message: messageContent,
          mode: 'concept',
          testCode: 'SAT',
        })
      });
      
      const result = (await response.json()) as RagQueryV2Response;
      const supportingQuestions = result.context?.supportingQuestions ?? [];
      const primaryQuestion = result.context?.primaryQuestion;
      const sourceRows = [primaryQuestion, ...supportingQuestions]
        .filter((question): question is RagQuestionContext => Boolean(question?.canonicalId))
        .slice(0, 4)
        .map((question, index) => ({
          questionId: question.canonicalId as string,
          documentName: question.sectionCode ? `SAT ${question.sectionCode}` : "SAT Context",
          pageNumber: 0,
          questionNumber: index + 1,
        }));

      const tutorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'tutor',
        content: formatRagContextMessage(result),
        timestamp: new Date(),
        sources: sourceRows.length > 0 ? sourceRows : undefined,
      };

      setMessages(prev => [...prev, tutorMessage]);
      setLastFailedMessage(null);
    } catch (error) {
      console.error('Chat error:', error);
      setInputValue(messageContent);
      setLastFailedMessage(messageContent);
      setRequestError("RAG context request failed. You can retry this message.");
      toast({
        title: "Error",
        description: "Failed to retrieve SAT context. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async () => {
    const messageContent = inputValue.trim();
    if (!messageContent || isLoading) return;
    await sendMessage(messageContent);
  };

  const handleRetryLastMessage = async () => {
    if (!lastFailedMessage || isLoading) return;
    await sendMessage(lastFailedMessage);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">AI Context</p>
              <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
                SAT Context Chat
              </h1>
              <p className="text-muted-foreground">
                Ask questions against the live SAT retrieval runtime.
              </p>
            </div>
             
            {/* AI Provider Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/70 border border-border/60">
              <Sparkles className="h-4 w-4 text-foreground" />
              <span className="text-sm font-medium text-foreground">RAG Context · /api/rag/v2</span>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-6 p-4 rounded-lg bg-secondary/60 border border-border/60">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-medium mb-1">How to get the best context:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Share the exact SAT concept or question type you need help with</li>
                <li>Include Math or Reading & Writing when possible</li>
                <li>Use the retrieved context to guide your next practice set</li>
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
                onClick={handleRetryLastMessage}
                disabled={!lastFailedMessage || isLoading}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Chat Container */}
        <div className="rounded-xl border border-border/60 bg-card/90 shadow-sm">
          {/* Messages Area */}
          <div 
            className="h-[500px] overflow-y-auto p-6 space-y-6"
            data-testid="chat-messages-container"
          >
            {messages.length === 0 && !isLoading ? (
              // Empty state when no messages
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Start a conversation
                </h3>
                <p className="text-muted-foreground max-w-md">
                  Ask a SAT question or concept and I will pull real runtime context, related questions, and skill-area signals.
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
              <div 
                key={message.id}
                className={`flex gap-3 ${message.type === 'user' ? 'flex-row-reverse' : ''}`}
                data-testid={`message-${message.id}`}
              >
                {/* Avatar */}
                {message.type === 'tutor' && (
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary">
                      <Sparkles className="h-5 w-5 text-primary-foreground" />
                    </div>
                  </div>
                )}
                
                {/* Message Bubble */}
                <div className={`flex-1 max-w-[85%] ${message.type === 'user' ? 'flex justify-end' : ''}`}>
                  <div>
                    <div 
                      className={`rounded-2xl p-4 ${
                        message.type === 'user' 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-muted'
                      }`}
                    >
                      <p 
                        className="text-sm whitespace-pre-wrap leading-relaxed"
                        data-testid={`text-message-content-${message.id}`}
                      >
                        {message.content}
                      </p>
                      
                      {/* Citation Sources */}
                      {message.sources && message.sources.length > 0 && (
                        <div className="border-t border-border/50 pt-3 mt-3">
                          <p className="text-xs opacity-80 mb-2">Referenced sources:</p>
                          <div className="flex flex-wrap gap-2">
                            {message.sources.map((source, index) => (
                              <Badge
                                key={index}
                                variant="secondary"
                                className="text-xs"
                                data-testid={`badge-source-${message.id}-${index}`}
                              >
                                <FileText className="h-3 w-3 mr-1" />
                                {source.documentName}{source.pageNumber > 0 ? ` - Page ${source.pageNumber}` : ''}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <p 
                      className={`text-xs text-muted-foreground mt-2 ${
                        message.type === 'user' ? 'text-right' : ''
                      }`}
                      data-testid={`text-message-time-${message.id}`}
                    >
                      {formatTime(message.timestamp)}
                    </p>
                  </div>
                </div>

                {/* User Avatar Placeholder */}
                {message.type === 'user' && (
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center">
                      <span className="text-sm font-semibold text-foreground">
                        {user?.email?.charAt(0).toUpperCase() || 'U'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {/* Loading Indicator */}
            {isLoading && (
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
                      <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
            </>
            )}
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Type your question here..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button 
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
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
