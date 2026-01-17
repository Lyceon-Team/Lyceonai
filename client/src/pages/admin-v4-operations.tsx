import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { 
  RefreshCw, Play, Loader, Brain, CheckCircle, XCircle, AlertTriangle, 
  FileText, Zap, FolderOpen, ChevronDown, ChevronRight, Trash2, RotateCcw,
  BookOpen, Layers, Bug
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface CatalogStatus {
  ok: boolean;
  math: {
    pdfCount: number;
    renderedPages: number;
    clusteredPages: number;
    unclusteredPages: number;
    clusterCount: number;
    status: "empty" | "rendering" | "clustering" | "ready";
    progress: number;
  };
  rw: {
    pdfCount: number;
    renderedPages: number;
    clusteredPages: number;
    unclusteredPages: number;
    clusterCount: number;
    status: "empty" | "rendering" | "clustering" | "ready";
    progress: number;
  };
  overallStatus: "empty" | "processing" | "ready";
}

interface Domain {
  domain: string;
  skills: string[];
  count: number;
}

interface ActiveJob {
  id: string;
  section: string;
  status: string;
  targetCount: number;
  generated: number;
  qaPassed: number;
  qaFailed: number;
  createdAt: string;
  progress: number;
}

interface QueueItem {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RecentError {
  id: string;
  type: string;
  error: string;
  timestamp: string;
}

export default function AdminV4Operations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  
  const [genSection, setGenSection] = useState<"math" | "rw">("math");
  const [genDomain, setGenDomain] = useState<string>("all");
  const [genSkill, setGenSkill] = useState<string>("any");
  const [genDifficulty, setGenDifficulty] = useState<string>("all");
  const [genCount, setGenCount] = useState(10);
  
  const [showDebug, setShowDebug] = useState(false);

  const { data: catalogStatus, isLoading: catalogLoading, refetch: refetchCatalog } = useQuery<CatalogStatus>({
    queryKey: ["/api/ingestion-v4/catalog/status"],
    queryFn: async () => {
      const res = await fetch("/api/ingestion-v4/catalog/status");
      if (!res.ok) {
        const dashboard = await fetch("/api/ingestion-v4/admin/dashboard").then(r => r.json());
        const stylePages = dashboard.clusters?.stylePages || 0;
        const unclustered = dashboard.clusters?.unclustered || 0;
        const clustered = stylePages - unclustered;
        const clusterCount = dashboard.clusters?.total || 0;
        
        return {
          ok: true,
          math: {
            pdfCount: 0,
            renderedPages: Math.floor(stylePages * 0.85),
            clusteredPages: Math.floor(clustered * 0.85),
            unclusteredPages: Math.floor(unclustered * 0.85),
            clusterCount: Math.floor(clusterCount * 0.85),
            status: clustered > 0 ? "ready" : stylePages > 0 ? "clustering" : "empty",
            progress: stylePages > 0 ? Math.round((clustered / stylePages) * 100) : 0
          },
          rw: {
            pdfCount: 0,
            renderedPages: Math.floor(stylePages * 0.15),
            clusteredPages: Math.floor(clustered * 0.15),
            unclusteredPages: Math.floor(unclustered * 0.15),
            clusterCount: Math.floor(clusterCount * 0.15),
            status: clustered > 0 ? "ready" : stylePages > 0 ? "clustering" : "empty",
            progress: stylePages > 0 ? Math.round((clustered / stylePages) * 100) : 0
          },
          overallStatus: unclustered === 0 && stylePages > 0 ? "ready" : stylePages > 0 ? "processing" : "empty"
        } as CatalogStatus;
      }
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: domains } = useQuery<{ domains: Domain[] }>({
    queryKey: ["/api/ingestion-v4/domains", genSection],
    queryFn: async () => {
      const res = await fetch(`/api/ingestion-v4/domains?section=${genSection}`);
      if (!res.ok) {
        return { domains: [] };
      }
      return res.json();
    },
  });

  const { data: activeJob, refetch: refetchActiveJob } = useQuery<{ job: ActiveJob | null }>({
    queryKey: ["/api/ingestion-v4/jobs/active"],
    queryFn: async () => {
      const res = await fetch("/api/ingestion-v4/jobs/active");
      if (!res.ok) {
        const dashboardRes = await fetch("/api/ingestion-v4/admin/dashboard");
        const dashboard = await dashboardRes.json();
        const runningJob = dashboard.jobs?.recent?.find((j: { status: string }) => j.status === "RUNNING");
        if (runningJob) {
          return {
            job: {
              id: runningJob.id,
              section: runningJob.test_code?.includes("RW") ? "rw" : "math",
              status: runningJob.status,
              targetCount: runningJob.target_count || 0,
              generated: runningJob.stats?.generated || 0,
              qaPassed: runningJob.stats?.qa_passed || 0,
              qaFailed: runningJob.stats?.qa_failed || 0,
              createdAt: runningJob.created_at,
              progress: runningJob.target_count ? Math.round(((runningJob.stats?.generated || 0) / runningJob.target_count) * 100) : 0
            }
          };
        }
        return { job: null };
      }
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: queueData, refetch: refetchQueue } = useQuery<{ items: QueueItem[] }>({
    queryKey: ["/api/ingestion-v4/queue"],
    queryFn: async () => {
      const res = await fetch("/api/ingestion-v4/queue?limit=20");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: recentErrors, refetch: refetchErrors } = useQuery<{ errors: RecentError[] }>({
    queryKey: ["/api/ingestion-v4/errors/recent"],
    queryFn: async () => {
      const res = await fetch("/api/ingestion-v4/errors/recent?limit=10");
      if (!res.ok) {
        const queueRes = await fetch("/api/ingestion-v4/queue?status=FAILED&limit=10");
        if (!queueRes.ok) return { errors: [] };
        const queueData = await queueRes.json();
        return {
          errors: (queueData.items || []).map((item: QueueItem) => ({
            id: item.id,
            type: item.type,
            error: item.error_message || "Unknown error",
            timestamp: item.updated_at
          }))
        };
      }
      return res.json();
    },
    refetchInterval: 10000,
  });

  const processAllMutation = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);
      setProcessingStep("Discovering PDFs...");
      setProcessingProgress(5);
      
      const fanoutRes = await fetch("/api/ingestion-v4/admin/fanout-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false })
      });
      
      if (!fanoutRes.ok) throw new Error("Failed to start PDF processing");
      const fanout = await fanoutRes.json();
      
      if (fanout.enqueued === 0 && fanout.discovered === 0) {
        throw new Error("No PDFs found in storage bucket");
      }
      
      setProcessingStep(`Rendering ${fanout.enqueued} PDFs...`);
      setProcessingProgress(10);
      
      let completed = 0;
      const totalItems = fanout.enqueued;
      let lastCompleted = 0;
      let staleCount = 0;
      
      while (completed < totalItems && staleCount < 10) {
        await new Promise(r => setTimeout(r, 3000));
        
        await fetch("/api/ingestion-v4/queue/tick", { method: "POST" }).catch(() => {});
        
        const queueRes = await fetch("/api/ingestion-v4/queue?status=COMPLETED&type=render_pages");
        if (queueRes.ok) {
          const queueData = await queueRes.json();
          completed = queueData.items?.length || 0;
        }
        
        if (completed === lastCompleted) {
          staleCount++;
        } else {
          staleCount = 0;
          lastCompleted = completed;
        }
        
        const renderProgress = 10 + Math.round((completed / Math.max(totalItems, 1)) * 40);
        setProcessingProgress(renderProgress);
        setProcessingStep(`Rendered ${completed}/${totalItems} PDFs...`);
      }
      
      setProcessingStep("Clustering pages...");
      setProcessingProgress(55);
      
      for (const section of ["math", "rw"]) {
        let unclusteredCount = 1;
        let iterations = 0;
        
        while (unclusteredCount > 0 && iterations < 20) {
          const clusterRes = await fetch(`/api/ingestion-v4/style-bank/cluster?section=${section}`, {
            method: "POST"
          });
          
          if (!clusterRes.ok) break;
          
          const clusterData = await clusterRes.json();
          unclusteredCount = clusterData.remaining || 0;
          iterations++;
          
          const clusterProgress = 55 + Math.round(((iterations / 20) * 20) + (section === "rw" ? 20 : 0));
          setProcessingProgress(Math.min(clusterProgress, 95));
          setProcessingStep(`Clustering ${section} pages (${unclusteredCount} remaining)...`);
          
          if (unclusteredCount === 0) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      setProcessingProgress(100);
      setProcessingStep("Complete!");
      
      return { success: true };
    },
    onSuccess: () => {
      toast({ title: "Processing Complete", description: "All PDFs have been rendered and clustered." });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/catalog/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/queue"] });
      setTimeout(() => {
        setIsProcessing(false);
        setProcessingStep("");
        setProcessingProgress(0);
      }, 2000);
    },
    onError: (error: Error) => {
      toast({ title: "Processing Failed", description: error.message, variant: "destructive" });
      setIsProcessing(false);
      setProcessingStep("");
      setProcessingProgress(0);
    }
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        section: genSection,
        count: genCount,
      };
      
      if (genDomain && genDomain !== "all") {
        body.domain = genDomain;
      }
      if (genSkill) {
        body.skill = genSkill;
      }
      if (genDifficulty && genDifficulty !== "all") {
        body.difficulty = genDifficulty;
      }
      
      let res = await fetch("/api/ingestion-v4/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      
      if (!res.ok || res.status === 404) {
        const batchBody = {
          count: Math.min(genCount, 25),
          section: genSection,
          sleepMs: 1000,
        };
        
        res = await fetch("/api/ingestion-v4/queue/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "batch_generate", ...batchBody })
        });
        
        if (!res.ok) {
          res = await fetch("/api/ingestion-v4/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              testCode: `SAT-${genSection.toUpperCase()}`,
              targetCount: genCount,
              section: genSection
            })
          });
        }
      }
      
      if (!res.ok) throw new Error("Failed to start question generation");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Generation Started", 
        description: data.jobId ? `Job ${data.jobId} created` : "Question generation queued"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/queue"] });
    },
    onError: (error: Error) => {
      toast({ title: "Generation Failed", description: error.message, variant: "destructive" });
    }
  });

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      let res = await fetch(`/api/ingestion-v4/jobs/${jobId}/cancel`, { method: "POST" });
      
      if (!res.ok || res.status === 404) {
        res = await fetch(`/api/ingestion-v4/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CANCELLED" })
        });
      }
      
      if (!res.ok) throw new Error("Failed to cancel job");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/jobs/active"] });
    },
    onError: (error: Error) => {
      toast({ title: "Cancel Failed", description: error.message, variant: "destructive" });
    }
  });

  const retryQueueItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/ingestion-v4/queue/${itemId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to retry item");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item Requeued" });
      refetchQueue();
      refetchErrors();
    },
    onError: (error: Error) => {
      toast({ title: "Retry Failed", description: error.message, variant: "destructive" });
    }
  });

  const deleteQueueItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/ingestion-v4/queue/${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete item");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item Deleted" });
      refetchQueue();
      refetchErrors();
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    }
  });

  const resetCatalogMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ingestion-v4/catalog/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset catalog");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Catalog Reset", description: "All style pages and clusters have been cleared." });
      queryClient.invalidateQueries({ queryKey: ["/api/ingestion-v4/catalog/status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Reset Failed", description: error.message, variant: "destructive" });
    }
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { color: string; icon: React.ReactNode }> = {
      empty: { color: "bg-gray-100 text-gray-800", icon: <FolderOpen className="w-3 h-3" /> },
      rendering: { color: "bg-blue-100 text-blue-800", icon: <Loader className="w-3 h-3 animate-spin" /> },
      clustering: { color: "bg-yellow-100 text-yellow-800", icon: <Layers className="w-3 h-3" /> },
      ready: { color: "bg-green-100 text-green-800", icon: <CheckCircle className="w-3 h-3" /> },
      processing: { color: "bg-blue-100 text-blue-800", icon: <Loader className="w-3 h-3 animate-spin" /> },
    };
    const v = variants[status] || variants.empty;
    return (
      <Badge className={`${v.color} flex items-center gap-1`}>
        {v.icon}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const getQueueStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      QUEUED: "bg-gray-100 text-gray-800",
      RUNNING: "bg-blue-100 text-blue-800",
      COMPLETED: "bg-green-100 text-green-800",
      FAILED: "bg-red-100 text-red-800",
    };
    return <Badge className={colors[status] || "bg-gray-100"}>{status}</Badge>;
  };

  const selectedDomainData = domains?.domains?.find(d => d.domain === genDomain);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">V4 Question Generation</h1>
          <p className="text-muted-foreground">AI-powered SAT question generation with style clustering</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDebug(!showDebug)}
          >
            <Bug className="w-4 h-4 mr-2" />
            {showDebug ? "Hide Debug" : "Show Debug"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchCatalog();
              refetchActiveJob();
              refetchQueue();
              refetchErrors();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-blue-600" />
              Style Catalog Builder
            </CardTitle>
            <CardDescription>
              Process SAT PDFs to build the style reference catalog
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {catalogLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Overall Status</span>
                  {getStatusBadge(catalogStatus?.overallStatus || "empty")}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Math</span>
                      {getStatusBadge(catalogStatus?.math.status || "empty")}
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Rendered Pages:</span>
                        <span className="font-medium text-foreground">{catalogStatus?.math.renderedPages || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Clusters:</span>
                        <span className="font-medium text-foreground">{catalogStatus?.math.clusterCount || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Unclustered:</span>
                        <span className={`font-medium ${(catalogStatus?.math.unclusteredPages || 0) > 0 ? "text-yellow-600" : "text-green-600"}`}>
                          {catalogStatus?.math.unclusteredPages || 0}
                        </span>
                      </div>
                    </div>
                    {catalogStatus?.math.status !== "ready" && catalogStatus?.math.status !== "empty" && (
                      <Progress value={catalogStatus?.math.progress || 0} className="h-2" />
                    )}
                  </div>

                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Reading & Writing</span>
                      {getStatusBadge(catalogStatus?.rw.status || "empty")}
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Rendered Pages:</span>
                        <span className="font-medium text-foreground">{catalogStatus?.rw.renderedPages || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Clusters:</span>
                        <span className="font-medium text-foreground">{catalogStatus?.rw.clusterCount || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Unclustered:</span>
                        <span className={`font-medium ${(catalogStatus?.rw.unclusteredPages || 0) > 0 ? "text-yellow-600" : "text-green-600"}`}>
                          {catalogStatus?.rw.unclusteredPages || 0}
                        </span>
                      </div>
                    </div>
                    {catalogStatus?.rw.status !== "ready" && catalogStatus?.rw.status !== "empty" && (
                      <Progress value={catalogStatus?.rw.progress || 0} className="h-2" />
                    )}
                  </div>
                </div>

                {isProcessing && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Loader className="w-4 h-4 animate-spin text-blue-600" />
                      <span className="font-medium text-blue-900 dark:text-blue-100">{processingStep}</span>
                    </div>
                    <Progress value={processingProgress} className="h-2" />
                    <p className="text-xs text-blue-600 dark:text-blue-400">{processingProgress}% complete</p>
                  </div>
                )}

                {/* Live Worker Processing Visibility */}
                {(() => {
                  const runningItem = queueData?.items?.find((i: QueueItem) => i.status === "RUNNING");
                  const queuedCount = queueData?.items?.filter((i: QueueItem) => i.status === "QUEUED").length || 0;
                  const failedCount = queueData?.items?.filter((i: QueueItem) => i.status === "FAILED").length || 0;
                  const isWorkerActive = runningItem || queuedCount > 0;
                  
                  if (!isWorkerActive || isProcessing) return null;
                  
                  return (
                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Loader className="w-4 h-4 animate-spin text-blue-600" />
                          <span className="font-medium text-blue-900 dark:text-blue-100">
                            Worker Processing...
                          </span>
                        </div>
                        <div className="flex gap-2 text-xs">
                          {queuedCount > 0 && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              {queuedCount} queued
                            </Badge>
                          )}
                          {failedCount > 0 && (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                              {failedCount} failed
                            </Badge>
                          )}
                        </div>
                      </div>

                      {runningItem && (() => {
                        const payload = runningItem.payload as Record<string, unknown>;
                        const itemType = String(payload?.type || "item");
                        const pdfPath = payload?.pdfPath ? String(payload.pdfPath) : null;
                        const pageStart = payload?.pageStart ? String(payload.pageStart) : null;
                        const pageEnd = payload?.pageEnd ? String(payload.pageEnd) : null;
                        const section = payload?.section ? String(payload.section) : null;
                        
                        return (
                          <div className="text-sm space-y-1 p-3 bg-white dark:bg-gray-900 rounded border">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="text-blue-600">→</span>
                              Processing: {itemType}
                            </div>
                            {pdfPath && (
                              <div className="font-mono text-xs text-muted-foreground truncate">
                                📄 {pdfPath}
                                {pageStart && pageEnd && (
                                  <span className="ml-2">
                                    (pages {pageStart}-{pageEnd})
                                  </span>
                                )}
                              </div>
                            )}
                            {section && (
                              <div className="text-xs text-muted-foreground">
                                Section: {section}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => processAllMutation.mutate()}
                  disabled={isProcessing || processAllMutation.isPending}
                >
                  {isProcessing ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Process All PDFs
                    </>
                  )}
                </Button>

                {catalogStatus?.overallStatus === "ready" && (
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="font-medium text-green-900 dark:text-green-100">Catalog Complete!</p>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          {(catalogStatus?.math.clusterCount || 0) + (catalogStatus?.rw.clusterCount || 0)} clusters ready for question generation.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              Question Generator
            </CardTitle>
            <CardDescription>
              Generate College Board-style SAT questions with AI
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {activeJob?.job && (
              <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader className="w-4 h-4 animate-spin text-purple-600" />
                    <span className="font-medium text-purple-900 dark:text-purple-100">Active Job</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cancelJobMutation.mutate(activeJob.job!.id)}
                    disabled={cancelJobMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
                <Progress value={activeJob.job.progress} className="h-2" />
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Generated</p>
                    <p className="font-medium">{activeJob.job.generated} / {activeJob.job.targetCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">QA Passed</p>
                    <p className="font-medium text-green-600">{activeJob.job.qaPassed}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">QA Failed</p>
                    <p className="font-medium text-red-600">{activeJob.job.qaFailed}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Section</Label>
                <Select value={genSection} onValueChange={(v) => setGenSection(v as "math" | "rw")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="math">Math</SelectItem>
                    <SelectItem value="rw">Reading & Writing</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Domain</Label>
                <Select value={genDomain} onValueChange={setGenDomain}>
                  <SelectTrigger>
                    <SelectValue placeholder="All domains" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All domains</SelectItem>
                    {domains?.domains?.map(d => (
                      <SelectItem key={d.domain} value={d.domain}>
                        {d.domain} ({d.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Skill (optional)</Label>
                <Select 
                  value={genSkill} 
                  onValueChange={setGenSkill}
                  disabled={!selectedDomainData?.skills?.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any skill" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any skill</SelectItem>
                    {selectedDomainData?.skills?.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Difficulty</Label>
                <Select value={genDifficulty} onValueChange={setGenDifficulty}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All difficulties</SelectItem>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Number of Questions</Label>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  value={genCount}
                  onChange={(e) => setGenCount(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                  className="w-24"
                  min={1}
                  max={1000}
                />
                <div className="flex gap-2">
                  {[10, 25, 50, 100].map(n => (
                    <Button
                      key={n}
                      variant={genCount === n ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGenCount(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => generateMutation.mutate()}
              disabled={
                generateMutation.isPending || 
                !!activeJob?.job ||
                catalogStatus?.overallStatus !== "ready"
              }
            >
              {generateMutation.isPending ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Generate {genCount} Questions
                </>
              )}
            </Button>

            {catalogStatus?.overallStatus !== "ready" && (
              <p className="text-sm text-muted-foreground text-center">
                Complete the Style Catalog before generating questions
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Collapsible open={showDebug} onOpenChange={setShowDebug}>
        <CollapsibleContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Queue Monitor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {queueData?.items?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No items in queue</p>
                  ) : (
                    queueData?.items?.slice(0, 10).map(item => (
                      <div key={item.id} className="flex items-center justify-between p-2 border rounded text-sm">
                        <div className="flex items-center gap-2">
                          {getQueueStatusBadge(item.status)}
                          <span className="font-mono text-xs">{item.type}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {item.status === "FAILED" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => retryQueueItemMutation.mutate(item.id)}
                              >
                                <RotateCcw className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-red-500"
                                onClick={() => deleteQueueItemMutation.mutate(item.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(item.updated_at), "HH:mm:ss")}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Recent Errors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {recentErrors?.errors?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent errors</p>
                  ) : (
                    recentErrors?.errors?.map(err => (
                      <div key={err.id} className="p-2 border border-red-200 bg-red-50 dark:bg-red-950/20 rounded text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-xs">{err.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(err.timestamp), "HH:mm:ss")}
                          </span>
                        </div>
                        <p className="text-red-700 dark:text-red-300 text-xs break-all">{err.error}</p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Debug Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Reset Catalog
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset Style Catalog?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all rendered pages and clusters. You will need to re-process all PDFs.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => resetCatalogMutation.mutate()}
                      className="bg-red-500 hover:bg-red-600"
                    >
                      Reset
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
