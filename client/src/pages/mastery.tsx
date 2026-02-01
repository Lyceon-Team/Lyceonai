import { AppShell } from "@/components/layout/app-shell";
import { SkillHeatmap } from "@/components/mastery/SkillHeatmap";
import { Button } from "@/components/ui/button";
import { Brain, ArrowLeft } from "lucide-react";

export default function MasteryPage() {
  const handleBack = () => {
    window.history.back();
  };

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Button variant="ghost" size="sm" onClick={handleBack} className="mr-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Brain className="h-8 w-8 text-foreground" />
            <h1 className="text-3xl font-bold text-foreground">Skill Mastery</h1>
          </div>
          <p className="text-muted-foreground">
            Track your progress across all SAT skills. Click on weak areas to add them to your study plan.
          </p>
        </div>

        <SkillHeatmap />
      </div>
    </AppShell>
  );
}
