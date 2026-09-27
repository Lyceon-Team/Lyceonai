import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Target,
  ChevronRight,
  MessageCircle,
} from "lucide-react";
import { Link } from "wouter";

export default function TestOptions() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Practice Questions */}
        <Card
          className="hover:shadow-lg transition-shadow cursor-pointer group"
          data-testid="card-practice-questions"
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-secondary rounded-lg">
                <BookOpen className="h-6 w-6 text-foreground" />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Practice Questions
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Work through individual questions by topic, difficulty, or
              section.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <BookOpen className="h-4 w-4" />
              <span>Customizable sessions</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              data-testid="button-start-practice"
              asChild
            >
              <Link href="/practice">
                <BookOpen className="h-4 w-4 mr-2" />
                Practice Now
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Lisa */}
        <Card
          className="hover:shadow-lg transition-shadow cursor-pointer group"
          data-testid="card-ai-tutor"
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-secondary rounded-lg">
                <MessageCircle className="h-6 w-6 text-foreground" />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Lisa</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get personalized help from Lisa, your SAT tutor. Ask questions,
              get explanations.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Target className="h-4 w-4" />
              <span>24/7 available</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              data-testid="button-start-chat"
              asChild
            >
              <Link href="/chat">
                <MessageCircle className="h-4 w-4 mr-2" />
                Chat Now
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
