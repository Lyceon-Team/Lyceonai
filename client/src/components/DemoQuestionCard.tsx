import { useState } from "react";
import { motion } from "framer-motion";

export default function DemoQuestionCard() {
  const [selected, setSelected] = useState<string | null>(null);
  const [showExp, setShowExp] = useState(false);
  
  const question = {
    id: "demo-q1",
    stem: "If 3x + 4 = 19, what is the value of x?",
    options: ["A. 3", "B. 4", "C. 5", "D. 6"],
    answer: "C",
    explanation: "Subtract 4 → 3x = 15; divide by 3 → x = 5."
  };

  const isCorrect = selected?.charAt(0) === question.answer;

  return (
    <motion.section 
      layout 
      className="glass p-6 w-full max-w-md mx-auto rounded-2xl shadow-lg"
      data-testid="demo-question-card"
    >
      <h3 className="font-semibold text-neutral-700 mb-2">Try a sample question</h3>
      <p className="mb-4" data-testid="question-stem">{question.stem}</p>
      {question.options.map(opt => (
        <button
          key={opt}
          onClick={() => { setSelected(opt); setShowExp(true); }}
          className={`w-full text-left px-4 py-2 mb-2 rounded-xl border transition-all ${
            selected === opt 
              ? isCorrect 
                ? "border-green-500 bg-green-50" 
                : "border-amber-500 bg-amber-50"
              : "border-neutral-300 hover:border-primary"
          }`}
          data-testid={`option-${opt.charAt(0)}`}
        >
          {opt}
        </button>
      ))}
      {showExp && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-3 p-3 rounded-xl text-sm ${
            isCorrect 
              ? "bg-green-50 border border-green-200" 
              : "bg-amber-50 border border-amber-200"
          }`}
          data-testid="question-explanation"
        >
          {isCorrect ? (
            <>
              <span className="font-semibold text-green-700">✅ Correct!</span>{" "}
              <span className="text-neutral-700">{question.explanation}</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-amber-700">❌ Incorrect.</span>{" "}
              <span className="text-neutral-700">The correct answer is {question.answer}. {question.explanation}</span>
            </>
          )}
        </motion.div>
      )}
    </motion.section>
  );
}
