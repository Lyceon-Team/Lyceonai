import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface ReviewModule {
  id: string;
  section: string;
  moduleIndex: number;
  status: string;
  difficultyBucket: string | null;
  startedAt: string | null;
  submittedAt: string | null;
}

interface ReviewQuestion {
  id: string;
  stem: string;
  section: string;
  options: Array<{ key: string; text: string }>;
  correct_answer?: "A" | "B" | "C" | "D" | null;
  answer_text?: string | null;
  explanation?: string | null;
}

interface ReviewResponse {
  questionId: string;
  moduleId: string;
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  answeredAt: string | null;
}

export interface FullLengthReviewData {
  session: {
    id: string;
    status: string;
    currentSection: string | null;
    currentModule: number | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  };
  modules: ReviewModule[];
  questions: ReviewQuestion[];
  responses: ReviewResponse[];
}

function sectionLabel(section: string): string {
  const normalized = section.trim().toLowerCase();
  if (normalized === "rw") return "Reading & Writing";
  if (normalized === "math") return "Math";
  return section;
}

export default function FullLengthReviewView({ data }: { data: FullLengthReviewData }) {
  const questionById = useMemo(
    () => new Map(data.questions.map((question) => [question.id, question])),
    [data.questions],
  );
  const responsesByModule = useMemo(() => {
    const grouped = new Map<string, ReviewResponse[]>();
    for (const response of data.responses) {
      const list = grouped.get(response.moduleId) ?? [];
      list.push(response);
      grouped.set(response.moduleId, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        const at = a.answeredAt ?? "";
        const bt = b.answeredAt ?? "";
        if (at && bt && at !== bt) return at.localeCompare(bt);
        return a.questionId.localeCompare(b.questionId);
      });
    }
    return grouped;
  }, [data.responses]);

  const totalAnswered = data.responses.length;
  const totalCorrect = data.responses.filter((response) => response.isCorrect === true).length;

  return (
    <Card className="bg-card/90 border-border/60">
      <CardHeader>
        <CardTitle className="text-2xl tracking-tight">Exam Review</CardTitle>
        <CardDescription>
          Runtime-backed review from `/api/full-length/sessions/:sessionId/review`. No inferred answers are generated client-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session</p>
            <p className="text-sm font-medium mt-2 break-all">{data.session.id}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Answered</p>
            <p className="text-2xl font-semibold mt-2">{totalAnswered}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Correct</p>
            <p className="text-2xl font-semibold mt-2">{totalCorrect}</p>
          </div>
        </div>

        <Accordion type="multiple" className="space-y-3">
          {data.modules.map((module) => {
            const moduleResponses = responsesByModule.get(module.id) ?? [];
            const moduleCorrect = moduleResponses.filter((response) => response.isCorrect === true).length;
            const title = `${sectionLabel(module.section)} Module ${module.moduleIndex}`;
            return (
              <AccordionItem
                key={module.id}
                value={module.id}
                className="rounded-lg border border-border/60 bg-card/80 px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex-1 text-left">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-sm font-semibold">{moduleCorrect}/{moduleResponses.length || 0}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{module.status}</Badge>
                      {module.difficultyBucket && <Badge variant="outline">Adaptive: {module.difficultyBucket}</Badge>}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {moduleResponses.length === 0 ? (
                    <div className="rounded-md bg-secondary/35 p-3 text-sm text-muted-foreground">
                      No response rows available for this module.
                    </div>
                  ) : (
                    <div className="space-y-3 pb-2">
                      {moduleResponses.map((response, index) => {
                        const question = questionById.get(response.questionId);
                        return (
                          <div key={`${module.id}-${response.questionId}-${index}`} className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                              Question {index + 1}
                            </p>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap mb-3">
                              {question?.stem || "Question text unavailable in review payload."}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                              <Badge variant="outline">Your answer: {response.selectedAnswer ?? "No response"}</Badge>
                              <Badge variant="outline">Correct: {question?.correct_answer ?? "Unavailable"}</Badge>
                              {response.isCorrect !== null && (
                                <Badge variant={response.isCorrect ? "default" : "secondary"}>
                                  {response.isCorrect ? "Correct" : "Incorrect"}
                                </Badge>
                              )}
                            </div>
                            {question?.answer_text && (
                              <p className="text-xs text-muted-foreground mb-1">Answer text: {question.answer_text}</p>
                            )}
                            {question?.explanation && (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{question.explanation}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
