import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { useLocation } from 'wouter';

export default function ChatDock() {
  const [, navigate] = useLocation();

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.5 }}
      className="fixed bottom-6 right-6 z-40"
      data-testid="chat-dock"
    >
      <button
        onClick={() => navigate('/chat')}
        className="p-4 rounded-full bg-lyceon-primary text-white shadow-lg hover:scale-105 transition-transform"
        aria-label="Open Lisa chat"
        data-testid="chat-dock-button"
      >
        <MessageCircle size={24} />
      </button>
    </motion.div>
  );
}
