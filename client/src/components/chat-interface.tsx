import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, GraduationCap, FileText, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'tutor',
      content: "Hi! I'm Lisa, your SAT tutor. Feel free to ask me about any questions you're working on, or let me know if you'd like to practice specific topics! 😊",
      timestamp: new Date()
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

    // Store the message content before clearing input
    const messageContent = inputValue.trim();
    
    // Clear input immediately after validation
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
      // Restore input value if there was an error
      setInputValue(messageContent);
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
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
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <Card data-testid="card-chat-interface">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-card-foreground">
            Chat with Lisa
          </h3>
          <Badge variant="secondary" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Lisa
          </Badge>
        </div>
        
        {/* Chat Messages */}
        <div 
          className="space-y-4 max-h-96 overflow-y-auto mb-4"
          data-testid="chat-messages-container"
        >
          {messages.map((message) => (
            <div 
              key={message.id}
              className={`flex items-start space-x-3 ${
                message.type === 'user' ? 'justify-end' : ''
              }`}
              data-testid={`message-${message.id}`}
            >
              {message.type === 'tutor' && (
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-primary">
                    <Sparkles className="h-4 w-4 text-primary-foreground" />
                  </div>
                </div>
              )}
              
              <div className={`flex-1 ${message.type === 'user' ? 'text-right' : ''}`}>
                <div 
                  className={`rounded-xl p-4 inline-block max-w-[80%] ${
                    message.type === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-secondary text-foreground border border-border'
                  }`}
                >
                  <p 
                    className="text-sm whitespace-pre-wrap"
                    data-testid={`text-message-content-${message.id}`}
                  >
                    {message.content}
                  </p>
                  
                  {/* Citation Sources */}
                  {message.sources && message.sources.length > 0 && (
                    <div className="border-t border-border pt-3 mt-3">
                      <p className="text-xs text-muted-foreground mb-2">Based on:</p>
                      <div className="flex flex-wrap gap-2">
                        {message.sources.map((source, index) => (
                          <Badge
                            key={index}
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-accent/20 transition-colors"
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
                  className="text-xs text-muted-foreground mt-1"
                  data-testid={`text-message-time-${message.id}`}
                >
                  {formatTime(message.timestamp)}
                </p>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex items-start space-x-3" data-testid="loading-indicator">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-primary">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </div>
              </div>
              <div className="flex-1">
                <div className="bg-secondary border border-border rounded-xl p-4">
                  <div className="flex space-x-1.5">
                    <div className="w-2 h-2 bg-warm-gray-600 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-warm-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-warm-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div className="flex space-x-2">
          <Input
            type="text"
            placeholder="Ask a question or describe what you're struggling with..."
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
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
