import { useRoute } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getClientInstanceId } from "@/lib/client-instance";

export default function ResumePracticePage() {
  const [, params] = useRoute("/practice/session/:sessionId");
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  // We fetch the session details first to know the section/mode
  const { data: session, isLoading, error } = useQuery({
    queryKey: [`/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`],
    enabled: !!sessionId,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Initializing session...</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-red-600 mb-4">Session Error</h1>
        <p className="text-muted-foreground mb-6">We couldn't find this practice session.</p>
        <button 
          onClick={() => window.location.assign("/practice")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Practice
        </button>
      </div>
    );
  }

  // Map the section from the session metadata or row
  // Note: session.question.section might not be available yet, so we trust the session metadata if possible
  // In our case, the resume endpoint handles the internal redirecting.
  // But CanonicalPracticePage needs a "section" prop for its hook.
  
  return (
    <CanonicalPracticePage
      title={`Resuming ${session.section || "Practice"} Session`}
      badgeLabel={session.section?.toLowerCase() === "math" ? "Math" : "R&W"}
      section={session.section?.toLowerCase() === "math" ? "math" : "reading_writing"}
      sessionId={sessionId}
    />
  );
}
