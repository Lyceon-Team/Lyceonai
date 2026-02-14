import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageCircle, X } from "lucide-react";
import { Link } from "wouter";
import ChatInterface from "@/components/chat-interface";

export default function FloatingActions() {
  const [showChat, setShowChat] = useState(false);

  return (
    <>
      {/* Floating Action Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-40">
        {/* Chat Button */}
        <Button
          size="lg"
          className="rounded-full w-14 h-14 shadow-lg hover:shadow-xl transition-all"
          onClick={() => setShowChat(true)}
          data-testid="button-floating-chat"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      </div>

      {/* Chat Dialog */}
      <Dialog open={showChat} onOpenChange={setShowChat}>
        <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col" aria-describedby="chat-dialog-description">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>AI Tutor Chat</DialogTitle>
              <p id="chat-dialog-description" className="sr-only">
                Interactive chat with your AI SAT tutor for personalized help and guidance
              </p>
              <div className="flex items-center gap-2">
                <Link href="/chat">
                  <Button variant="outline" size="sm" data-testid="button-fullscreen-chat">
                    Full Screen
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowChat(false)}
                  data-testid="button-close-chat"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <ChatInterface />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}