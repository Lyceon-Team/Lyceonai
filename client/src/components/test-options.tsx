import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, BookOpen, Target, Play, ChevronRight, Zap, Flame, MessageCircle, Calculator } from "lucide-react";
import { Link } from "wouter";

export default function TestOptions() {
  return (
    <div className="space-y-8">
      {/* Featured: FlowCards Hero */}
      <Card className="relative overflow-hidden border-2 border-foreground bg-secondary group cursor-pointer" data-testid="card-flowcards-hero">
        <CardContent className="relative p-8">
          <div className="flex flex-col lg:flex-row items-center gap-8">
            {/* Left: Content */}
            <div className="flex-1 text-center lg:text-left">
              <div className="flex items-center justify-center lg:justify-start gap-2 mb-4">
                <div className="p-2 bg-background rounded-full border border-border">
                  <Zap className="h-6 w-6 text-foreground" />
                </div>
                <span className="text-sm font-medium text-foreground/80 uppercase tracking-wide">Featured</span>
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                FlowCards
              </h2>
              <p className="text-lg text-muted-foreground mb-6 max-w-md">
                Quick SAT practice. Swipe through questions, build streaks, and master the SAT one card at a time.
              </p>
              <div className="flex flex-wrap justify-center lg:justify-start gap-4 mb-6">
                <div className="flex items-center gap-2 bg-background px-4 py-2 rounded-full border border-border">
                  <Flame className="h-4 w-4 text-foreground" />
                  <span className="text-sm text-foreground">Streak Tracking</span>
                </div>
                <div className="flex items-center gap-2 bg-background px-4 py-2 rounded-full border border-border">
                  <Zap className="h-4 w-4 text-foreground" />
                  <span className="text-sm text-foreground">Instant Feedback</span>
                </div>
                <div className="flex items-center gap-2 bg-background px-4 py-2 rounded-full border border-border">
                  <MessageCircle className="h-4 w-4 text-foreground" />
                  <span className="text-sm text-foreground">AI Explanations</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-center lg:justify-start gap-3">
                <Button 
                  size="lg" 
                  data-testid="button-start-flowcards"
                  asChild
                >
                  <Link href="/flow-cards">
                    <Play className="h-5 w-5 mr-2" />
                    Start FlowCards
                  </Link>
                </Button>
                <Button 
                  size="lg" 
                  variant="outline" 
                  data-testid="button-flowcards-math"
                  asChild
                >
                  <Link href="/flow-cards?section=math">
                    <Calculator className="h-5 w-5 mr-2" />
                    Math Only
                  </Link>
                </Button>
              </div>
            </div>
            
            {/* Right: Preview Cards Stack */}
            <div className="hidden lg:block relative w-64 h-80">
              <div className="absolute top-4 left-4 w-full h-full bg-secondary/50 rounded-3xl transform rotate-6 border border-border"></div>
              <div className="absolute top-2 left-2 w-full h-full bg-secondary rounded-3xl transform rotate-3 border border-border"></div>
              <div className="absolute inset-0 w-full h-full bg-background rounded-3xl shadow-lg p-6 flex flex-col justify-between border border-border">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="px-2 py-1 bg-secondary rounded-full text-xs font-medium text-foreground">Math</div>
                    <div className="px-2 py-1 bg-secondary rounded-full text-xs font-medium text-foreground">Medium</div>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed">
                    If 3x + 7 = 22, what is the value of x?
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="p-3 bg-secondary rounded-xl text-sm text-foreground hover:bg-secondary/80 transition-colors cursor-pointer">A) 3</div>
                  <div className="p-3 bg-secondary rounded-xl text-sm text-foreground font-medium border-2 border-foreground">B) 5</div>
                  <div className="p-3 bg-secondary rounded-xl text-sm text-foreground">C) 7</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Other Test Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Full Length Test */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer group" data-testid="card-full-length-test">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-secondary rounded-lg">
                <Clock className="h-6 w-6 text-foreground" />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Take Full Length Test
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Complete 3+ hour SAT practice test with all sections and timed conditions.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Clock className="h-4 w-4" />
              <span>3 hours 15 minutes</span>
            </div>
            <Button className="w-full" data-testid="button-start-full-test" asChild>
              <Link href="/full-test">
                <Play className="h-4 w-4 mr-2" />
                Start Test
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Practice Questions */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer group" data-testid="card-practice-questions">
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
              Work through individual questions by topic, difficulty, or section.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <BookOpen className="h-4 w-4" />
              <span>Customizable sessions</span>
            </div>
            <Button variant="outline" className="w-full" data-testid="button-start-practice" asChild>
              <Link href="/practice">
                <BookOpen className="h-4 w-4 mr-2" />
                Practice Now
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Lisa */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer group" data-testid="card-ai-tutor">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-secondary rounded-lg">
                <MessageCircle className="h-6 w-6 text-foreground" />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Lisa
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get personalized help from Lisa, your SAT tutor. Ask questions, get explanations.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Target className="h-4 w-4" />
              <span>24/7 available</span>
            </div>
            <Button variant="outline" className="w-full" data-testid="button-start-chat" asChild>
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