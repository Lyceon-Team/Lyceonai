import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface Question {
  id: string;
  questionNumber: number;
  section: string;
  stem: string;
  difficulty: string;
  pageNumber?: number;
  documentName: string;
}

interface QuestionCardProps {
  question: Question;
  onClick?: (question: Question) => void;
}

export default function QuestionCard({ question, onClick }: QuestionCardProps) {
  const getSectionColor = (section: string) => {
    switch (section) {
      case 'Math':
        return 'bg-primary/10 text-primary';
      case 'Reading':
        return 'bg-secondary/10 text-secondary';
      case 'Writing':
        return 'bg-accent/10 text-accent';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const handleClick = () => {
    if (onClick) {
      onClick(question);
    }
  };

  return (
    <Card 
      className="hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={handleClick}
      data-testid={`card-question-${question.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <Badge 
            className={`text-xs font-medium ${getSectionColor(question.section)}`}
            data-testid={`badge-section-${question.id}`}
          >
            {question.section}
          </Badge>
          <span 
            className="text-xs text-muted-foreground"
            data-testid={`text-location-${question.id}`}
          >
            Page {question.pageNumber}, Q#{question.questionNumber}
          </span>
        </div>
        
        <p 
          className="text-foreground font-medium mb-2 line-clamp-2"
          data-testid={`text-question-stem-${question.id}`}
        >
          {question.stem}
        </p>
        
        <div className="flex items-center justify-between text-sm">
          <span 
            className="text-muted-foreground"
            data-testid={`text-difficulty-${question.id}`}
          >
            Difficulty: {question.difficulty}
          </span>
          <Button 
            variant="ghost" 
            size="sm"
            data-testid={`button-view-question-${question.id}`}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
