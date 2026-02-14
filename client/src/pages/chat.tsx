import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Sparkles, FileText, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

interface ChatMessage {
  id: string;
  type: 'user' | 'tutor';
  content: string;
  timestamp: Date;
  provider?: 'gemini' | 'chatgpt';
  sources?: Array<{
    questionId: string;
    documentName: string;
    pageNumber: number;
    questionNumber: number;
  }>;
}

export default function Chat() {
  const { user } = useSupabaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'tutor',
      content: "Hi! I'm your SAT AI Tutor. I can help you understand questions, explain concepts, and provide personalized study guidance. What would you like to work on today?",
      timestamp: new Date(),
      provider: 'gemini'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: messageContent,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await apiRequest('/api/tutor/v2', {
        method: 'POST',
        body: JSON.stringify({
          userId: user?.id || 'anonymous',
          message: messageContent,
          mode: 'concept',
          testCode: 'SAT'
        })
      });
      
      const result = await response.json();

      const tutorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'tutor',
        content: result.answer,
        timestamp: new Date(),
        provider: 'gemini',
        sources: result.ragContext?.primaryQuestion ? [{
          questionId: result.ragContext.primaryQuestion.canonicalId || '',
          documentName: `SAT ${result.ragContext.primaryQuestion.sectionCode || 'Question'}`,
          pageNumber: 0,
          questionNumber: 0
        }] : undefined
      };

      setMessages(prev => [...prev, tutorMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setInputValue(messageContent);
      toast({
        title: "Error",
        description: "Failed to get response from AI tutor. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
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
              <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
                AI Tutor Chat
              </h1>
              <p className="text-muted-foreground">
                Ask questions and get personalized SAT help powered by AI
              </p>
            </div>
            
            {/* AI Provider Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-border">
              <Sparkles className="h-4 w-4 text-foreground" />
              <span className="text-sm font-medium text-foreground">Gemini AI</span>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-6 p-4 rounded-lg bg-secondary border border-border">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-medium mb-1">How to get the best help:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Share the specific question or concept you're struggling with</li>
                <li>Ask for step-by-step explanations</li>
                <li>Request practice problems on specific topics</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Chat Container */}
        <div className="rounded-lg border bg-card shadow-sm">
          {/* Messages Area */}
          <div 
            className="h-[500px] overflow-y-auto p-6 space-y-6"
            data-testid="chat-messages-container"
          >
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
