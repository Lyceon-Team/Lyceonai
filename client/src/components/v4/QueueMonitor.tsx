import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, CheckCircle, XCircle, Loader, RotateCcw, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface QueueItem {
  id: string;
  status: string;
  type: string;
  payload: {
    type?: string;
    pdfPath?: string;
    section?: string;
    targetCount?: number;
  };
  last_error?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export function QueueMonitorCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data } = useQuery<{ items: QueueItem[] }>({
    queryKey: ['/api/ingestion-v4/queue'],
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (queueId: string) => {
      const res = await fetch(`/api/ingestion-v4/queue/${queueId}/cancel`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to cancel');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ingestion-v4/queue'] });
      toast({ title: "Item Cancelled" });
    }
  });

  const retryMutation = useMutation({
    mutationFn: async (queueId: string) => {
      const res = await fetch(`/api/ingestion-v4/queue/${queueId}/retry`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to retry');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ingestion-v4/queue'] });
      toast({ title: "Item Requeued" });
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return <Badge variant="secondary"><Loader className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case 'QUEUED':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Queued</Badge>;
      case 'COMPLETED':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Complete</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const items = data?.items || [];
  const hasItems = items.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Queue Monitor
          </span>
          <Badge variant="outline">{items.length} items</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasItems ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No queue items
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {items.map(item => {
              const errorMsg = item.last_error || item.error_message;
              return (
                <div 
                  key={item.id} 
                  className={`p-3 rounded-lg border ${
                    item.status === 'FAILED' ? 'border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800' :
                    item.status === 'RUNNING' ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800' :
                    item.status === 'COMPLETED' ? 'border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800' :
                    'border-gray-200 bg-gray-50 dark:bg-gray-800/30 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusBadge(item.status)}
                        <span className="text-xs font-mono text-muted-foreground">
                          {item.id.slice(0, 8)}...
                        </span>
                      </div>
                      
                      <div className="text-sm">
                        <span className="font-medium">{item.type || item.payload.type}</span>
                        {item.payload.pdfPath && (
                          <span className="text-muted-foreground ml-2">
                            {item.payload.pdfPath.split('/').pop()}
                          </span>
                        )}
                        {item.payload.targetCount && (
                          <span className="text-muted-foreground ml-2">
                            ({item.payload.targetCount} questions)
                          </span>
                        )}
                      </div>
                      
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </div>
                      
                      {errorMsg && (
                        <div className="text-xs text-red-600 mt-2 p-2 bg-red-100 dark:bg-red-900/50 rounded">
                          {errorMsg}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex gap-1">
                      {item.status === 'FAILED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryMutation.mutate(item.id)}
                          disabled={retryMutation.isPending}
                        >
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                      {(item.status === 'QUEUED' || item.status === 'RUNNING') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelMutation.mutate(item.id)}
                          disabled={cancelMutation.isPending}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
