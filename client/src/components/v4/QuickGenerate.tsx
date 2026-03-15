import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, CheckCircle, XCircle, Loader } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GenerationJob {
  id: string;
  status: string;
  target_count: number;
  stats: {
    generated: number;
    qa_passed: number;
    qa_failed: number;
  };
}

interface JobsResponse {
  jobs: {
    recent: GenerationJob[];
  };
}

export function QuickGenerateCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dashboardData } = useQuery<JobsResponse>({
    queryKey: ['/api/ingestion-v4/admin/dashboard'],
    refetchInterval: 5000,
  });

  const activeJob = dashboardData?.jobs?.recent?.find(
    (j: GenerationJob) => j.status === 'running' || j.status === 'queued'
  );
  const progress = activeJob 
    ? Math.round((activeJob.stats.generated / activeJob.target_count) * 100)
    : 0;

  const generateMutation = useMutation({
    mutationFn: async (section: 'math' | 'rw') => {
      const res = await fetch('/api/ingestion-v4/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testCode: 'SAT',
          section,
          targetCount: 100
        })
      });
      if (!res.ok) throw new Error('Failed to create job');
      return res.json();
    },
    onSuccess: (data, section) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ingestion-v4/admin/dashboard'] });
      toast({ 
        title: "Generation Started", 
        description: `Generating 100 ${section} questions. Job ID: ${data.job?.id?.slice(0, 8) || 'created'}...`
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Generation Failed", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          Quick Generate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeJob ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">
                <Loader className="w-3 h-3 mr-1 animate-spin" />
                Generating...
              </Badge>
              <span className="text-sm text-muted-foreground">
                {activeJob.stats.generated} / {activeJob.target_count}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-3 h-3" />
                {activeJob.stats.qa_passed} passed
              </span>
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="w-3 h-3" />
                {activeJob.stats.qa_failed} failed
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-24 flex-col gap-2"
              onClick={() => generateMutation.mutate('math')}
              disabled={generateMutation.isPending}
            >
              <span className="text-2xl">+</span>
              <div className="text-center">
                <div className="font-semibold">Generate Math</div>
                <div className="text-xs opacity-80">100 questions</div>
              </div>
            </Button>
            <Button
              size="lg"
              className="h-24 flex-col gap-2"
              variant="secondary"
              onClick={() => generateMutation.mutate('rw')}
              disabled={generateMutation.isPending}
            >
              <span className="text-2xl">+</span>
              <div className="text-center">
                <div className="font-semibold">Generate R/W</div>
                <div className="text-xs opacity-80">100 questions</div>
              </div>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
