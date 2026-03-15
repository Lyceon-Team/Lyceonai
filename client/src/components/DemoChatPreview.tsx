import { motion } from "framer-motion";
import { useState } from "react";

export default function DemoChatPreview() {
  const [showReply, setShowReply] = useState(false);

  return (
    <motion.div 
      className="glass p-6 rounded-2xl shadow-lg max-w-md mx-auto"
      data-testid="demo-chat-preview"
    >
      <h3 className="font-semibold mb-2 text-neutral-700">Lisa Chat Preview</h3>
      <div className="bg-white/70 p-3 rounded-xl mb-2 text-sm" data-testid="student-message">
        Student: "How do I solve 3x + 4 = 19?"
      </div>
      <div className="bg-primary/10 p-3 rounded-xl text-sm" data-testid="tutor-message">
        Lisa: "Let's isolate x. Subtract 4 then divide by 3." ✅
      </div>
      <button
        onClick={() => setShowReply(true)}
        className="mt-3 btn-primary"
        data-testid="button-ask-another"
      >
        Ask Another
      </button>
      {showReply && (
        <p className="text-xs mt-2 text-neutral-500" data-testid="demo-mode-notice">
          Demo mode only — sign in for real tutoring.
        </p>
      )}
    </motion.div>
  );
}
