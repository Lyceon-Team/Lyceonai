import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Calculator, BookOpen, Plus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface SkillNode {
  id: string;
  label: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface DomainNode {
  id: string;
  label: string;
  skills: SkillNode[];
  avgMastery: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface SectionNode {
  id: string;
  label: string;
  domains: DomainNode[];
  avgMastery: number;
}

interface SkillsResponse {
  sections: SectionNode[];
}

const statusColors = {
  not_started: "bg-muted text-muted-foreground border-border",
  weak: "bg-red-100 text-red-800 border-red-300 hover:bg-red-200",
  improving: "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200",
  proficient: "bg-green-100 text-green-800 border-green-300 hover:bg-green-200",
};

const statusLabels = {
  not_started: "Not Started",
  weak: "Needs Work",
  improving: "Improving",
  proficient: "Proficient",
};

function SkillCell({
  skill,
  sectionId,
  domainId,
  onAddToPlan,
  isAdding,
}: {
  skill: SkillNode;
  sectionId: string;
  domainId: string;
  onAddToPlan: (section: string, domain: string, skill: string) => void;
  isAdding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const showAddButton = skill.status === "weak" || skill.status === "improving";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full p-2 rounded-md text-left text-xs font-medium border transition-colors",
            statusColors[skill.status]
          )}
        >
          <div className="truncate">{skill.label}</div>
          {skill.attempts > 0 && (
            <div className="text-[10px] opacity-75 mt-0.5">
              {skill.mastery_score}% • {skill.attempts} attempts
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-2">
          <div className="font-medium text-sm">{skill.label}</div>
          <div className="text-xs text-muted-foreground">
            Status: <span className="font-medium">{statusLabels[skill.status]}</span>
          </div>
          {skill.attempts > 0 ? (
            <>
              <div className="text-xs text-muted-foreground">
                Mastery: <span className="font-medium">{skill.mastery_score}%</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Accuracy: <span className="font-medium">{skill.accuracy}%</span> ({skill.correct}/{skill.attempts})
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              No practice attempts yet
            </div>
          )}
          {showAddButton && (
            <Button
              size="sm"
              className="w-full mt-2"
              onClick={() => {
                onAddToPlan(sectionId, domainId, skill.id);
                setOpen(false);
              }}
              disabled={isAdding}
            >
              {isAdding ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Add to Tomorrow's Plan
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DomainCard({
  domain,
  sectionId,
  onAddToPlan,
  addingSkill,
}: {
  domain: DomainNode;
  sectionId: string;
  onAddToPlan: (section: string, domain: string, skill: string) => void;
  addingSkill: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{domain.label}</h4>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full",
            domain.status === "proficient" && "bg-green-100 text-green-700",
            domain.status === "improving" && "bg-yellow-100 text-yellow-700",
            domain.status === "weak" && "bg-red-100 text-red-700",
            domain.status === "not_started" && "bg-muted text-muted-foreground"
          )}
        >
          {domain.avgMastery}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {domain.skills.map((skill) => (
          <SkillCell
            key={skill.id}
            skill={skill}
            sectionId={sectionId}
            domainId={domain.id}
            onAddToPlan={onAddToPlan}
            isAdding={addingSkill === `${sectionId}:${domain.id}:${skill.id}`}
          />
        ))}
      </div>
    </div>
  );
}

export function SkillHeatmap() {
  const queryClient = useQueryClient();
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  const [addedSkill, setAddedSkill] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<SkillsResponse>({
    queryKey: ["/api/mastery/skills"],
    queryFn: async () => {
      const response = await apiRequest("/api/mastery/skills");
      return response.json();
    },
  });

  const addToPlanMutation = useMutation({
    mutationFn: async ({ section, domain, skill }: { section: string; domain: string; skill: string }) => {
      const response = await apiRequest("/api/mastery/add-to-plan", {
        method: "POST",
        body: JSON.stringify({ section, domain, skill }),
      });
      return response.json();
    },
    onSuccess: (_, variables) => {
      setAddedSkill(`${variables.section}:${variables.domain}:${variables.skill}`);
      setTimeout(() => setAddedSkill(null), 3000);
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    },
    onSettled: () => {
      setAddingSkill(null);
    },
  });

  const handleAddToPlan = (section: string, domain: string, skill: string) => {
    const key = `${section}:${domain}:${skill}`;
    setAddingSkill(key);
    addToPlanMutation.mutate({ section, domain, skill });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Skill Mastery</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Skill Mastery</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unable to load mastery data. Start practicing to see your progress!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {addedSkill && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <Check className="h-4 w-4" />
          Skill added to tomorrow's study plan!
        </div>
      )}

      {data.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              {section.id === "math" ? (
                <Calculator className="h-5 w-5 text-blue-600" />
              ) : (
                <BookOpen className="h-5 w-5 text-purple-600" />
              )}
              <CardTitle className="text-lg">{section.label}</CardTitle>
              <span className="ml-auto text-sm text-muted-foreground">
                Avg: {section.avgMastery}%
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.domains.map((domain) => (
              <DomainCard
                key={domain.id}
                domain={domain}
                sectionId={section.id}
                onAddToPlan={handleAddToPlan}
                addingSkill={addingSkill}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center gap-4 text-xs text-muted-foreground px-2">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-200 border border-red-300" />
          <span>Needs Work (&lt;40%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-300" />
          <span>Improving (40-70%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-200 border border-green-300" />
          <span>Proficient (&gt;70%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-muted border border-border" />
          <span>Not Started</span>
        </div>
      </div>
    </div>
  );
}
