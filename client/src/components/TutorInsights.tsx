import { Button } from "@/components/ui/button";
import { MessageCircle, TrendingUp, Brain } from "lucide-react";

interface TutorInsightsProps {
  confidence?: number;
  focusTopic?: string;
  nextTopic?: string;
  onAskTutor?: () => void;
}

export default function TutorInsights({
  confidence = 85,
  focusTopic = "Linear Equations",
  nextTopic = "Quadratic Functions",
  onAskTutor
}: TutorInsightsProps) {
  return (
    <aside className="space-y-6" data-testid="tutor-insights-panel">
      <div className="p-4 bg-white/70 rounded-2xl shadow-md backdrop-blur-sm" data-testid="insights-card">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-5 w-5 text-lyceon-primary" />
          <h3 className="font-semibold text-neutral-800">Tutor Insights</h3>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-600">Confidence</p>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-lyceon-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-lyceon-primary transition-all duration-300"
                  style={{ width: `${confidence}%` }}
                  data-testid="confidence-bar"
                />
              </div>
              <span className="text-sm font-medium text-lyceon-primary" data-testid="confidence-value">
                {confidence}%
              </span>
            </div>
          </div>
          <p className="text-sm text-neutral-600">
            <span className="font-medium">Focus:</span> {focusTopic}
          </p>
        </div>
      </div>

      <div className="p-4 bg-white/70 rounded-2xl shadow-md backdrop-blur-sm" data-testid="next-topic-card">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-5 w-5 text-lyceon-primary" />
          <h3 className="font-semibold text-neutral-800">Next Topic</h3>
        </div>
        <p className="text-sm text-neutral-600" data-testid="next-topic">
          {nextTopic}
        </p>
      </div>

      <Button
        onClick={onAskTutor}
        variant="outline"
        className="w-full py-2 rounded-xl border-lyceon-primary text-lyceon-primary hover:bg-lyceon-primary hover:text-white transition-all"
        data-testid="ask-lyceon-button"
      >
        <MessageCircle className="h-4 w-4 mr-2" />
        Ask Lyceon
      </Button>
    </aside>
  );
}
