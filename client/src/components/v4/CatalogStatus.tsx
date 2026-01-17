import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, AlertCircle, Loader, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CatalogStatus {
  totalPages: number;
  clusteredPages: number;
  unclusteredPages: number;
  totalClusters: number;
  clusteringPercent: number;
  readyForGeneration: boolean;
  queuePending: number;
}

export function CatalogStatusCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<CatalogStatus>({
    queryKey: ['/api/ingestion-v4/catalog/status'],
    queryFn: async () => {
      const res = await fetch('/api/ingestion-v4/admin/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      const dashboard = await res.json();
      
      const totalPages = dashboard.clusters?.stylePages || 0;
      const unclusteredPages = dashboard.clusters?.unclustered || 0;
      const clusteredPages = totalPages - unclusteredPages;
      const clusteringPercent = totalPages > 0 
        ? Math.round((clusteredPages / totalPages) * 100)
        : 0;
      
      return {
        totalPages,
        clusteredPages,
        unclusteredPages,
        totalClusters: dashboard.clusters?.total || 0,
        clusteringPercent,
        readyForGeneration: unclusteredPages === 0 && totalPages > 0,
        queuePending: dashboard.queue?.pending || 0
      };
    },
    refetchInterval: 5000,
  });

  const triggerRenderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ingestion-v4/admin/fanout-pdfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'math', overwrite: false })
      });
      if (!res.ok) throw new Error('Failed to trigger render');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ingestion-v4/catalog/status'] });
      toast({ title: "Rendering Started", description: "PDFs are being rendered to PNGs." });
    }
  });

  const triggerClusterMutation = useMutation({
    mutationFn: async (section: 'math' | 'rw') => {
      const res = await fetch('/api/ingestion-v4/style-bank/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, limitPages: 50 })
      });
      if (!res.ok) throw new Error('Failed to trigger clustering');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ingestion-v4/catalog/status'] });
      toast({ title: "Clustering Started", description: "Pages are being analyzed and clustered." });
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center">
            <Loader className="w-6 h-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center text-red-500">
            <AlertCircle className="w-6 h-6 mr-2" />
            <span>Failed to load catalog status</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const clusterProgress = data?.clusteringPercent || 0;
  const isReady = data?.readyForGeneration || false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            Style Catalog Status
          </span>
          {isReady ? (
            <Badge variant="default" className="bg-green-500">
              <CheckCircle className="w-4 h-4 mr-1" />
              Ready
            </Badge>
          ) : data?.totalPages === 0 ? (
            <Badge variant="outline">
              <AlertCircle className="w-4 h-4 mr-1" />
              Empty
            </Badge>
          ) : (
            <Badge variant="secondary">
              <AlertCircle className="w-4 h-4 mr-1" />
              Building
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{data?.totalPages || 0}</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">Total Pages</p>
          </div>
          <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{data?.totalClusters || 0}</p>
            <p className="text-xs text-green-600 dark:text-green-400">Clusters</p>
          </div>
          <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{data?.unclusteredPages || 0}</p>
            <p className="text-xs text-orange-600 dark:text-orange-400">Unclustered</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Clustering Progress</span>
            <span className="text-sm text-muted-foreground">
              {data?.clusteredPages || 0} / {data?.totalPages || 0} pages clustered
            </span>
          </div>
          <Progress value={clusterProgress} className="h-2" />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground">
              {clusterProgress}% complete
            </span>
            {data && data.unclusteredPages > 0 && (
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => triggerClusterMutation.mutate('math')}
                  disabled={triggerClusterMutation.isPending}
                >
                  Cluster Math
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => triggerClusterMutation.mutate('rw')}
                  disabled={triggerClusterMutation.isPending}
                >
                  Cluster RW
                </Button>
              </div>
            )}
          </div>
        </div>

        {data?.totalPages === 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-900 dark:text-yellow-100">
                  No Style Pages
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Upload and render PDFs to populate the style bank.
                </p>
                <Button 
                  size="sm" 
                  variant="outline"
                  className="mt-2"
                  onClick={() => triggerRenderMutation.mutate()}
                  disabled={triggerRenderMutation.isPending}
                >
                  <Play className="w-3 h-3 mr-1" />
                  Trigger Render
                </Button>
              </div>
            </div>
          </div>
        )}

        {isReady && (
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium text-green-900 dark:text-green-100">
                  Catalog Complete!
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {data?.totalPages} pages across {data?.totalClusters} clusters. 
                  Ready to generate questions.
                </p>
              </div>
            </div>
          </div>
        )}

        {(data?.queuePending ?? 0) > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            {data?.queuePending} items pending in queue
          </div>
        )}
      </CardContent>
    </Card>
  );
}
