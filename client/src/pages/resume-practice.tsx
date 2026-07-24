import { useRoute } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getClientInstanceId } from "@/lib/client-instance";
import {
  isMathSection,
  isRwSection,
  sectionDisplayLabel,
} from "@shared/section-display";

interface SessionState {
  sessionId: string;
  section: string | null;
  state: string;
  currentOrdinal: number;
  answeredCount: number;
  targetQuestionCount: number;
  readOnly: boolean;
}

export default function ResumePracticePage() {
  const [, params] = useRoute("/practice/session/:sessionId");
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  // We fetch the session details first to know the section/mode
  const {
    data: session,
    isLoading,
    error,
  } = useQuery<SessionState>({
    queryKey: [
      `/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`,
    ],
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
        <p className="text-muted-foreground mb-6">
          We couldn't find this practice session.
        </p>
        <button
          onClick={() => window.location.assign("/practice")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Practice
        </button>
      </div>
    );
  }

  const resolvedSection: "math" | "reading_writing" | null = isMathSection(
    session.section,
  )
    ? "math"
    : isRwSection(session.section)
      ? "reading_writing"
      : null;

  if (!resolvedSection) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-red-600 mb-4">
          Unknown Section
        </h1>
        <p className="text-muted-foreground mb-6">
          This session has an unrecognised section and cannot be resumed safely.
        </p>
        <button
          onClick={() => window.location.assign("/practice")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Practice
        </button>
      </div>
    );
  }

  return (
    <CanonicalPracticePage
      title={`Resuming ${sectionDisplayLabel(session.section) ?? "Practice"} Session`}
      badgeLabel={sectionDisplayLabel(session.section) ?? "Practice"}
      section={resolvedSection}
      sessionId={sessionId}
    />
  );
}
