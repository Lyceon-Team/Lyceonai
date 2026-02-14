import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Settings, Save, RefreshCw, ArrowUp, ArrowDown, GripVertical,
  Clock, Cpu, Brain, Eye, Zap, FileText, Database, Timer,
  BarChart3, AlertTriangle, CheckCircle, Loader
} from "lucide-react";
import { Link } from "wouter";
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from "@/components/auth/AdminGuard";

interface ParsingMethod {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  timeout: number;
  priority: number;
}

interface SystemConfig {
  batchProcessingTimeout: number;
  maxConcurrentJobs: number;
  retryFailedBatches: boolean;
  autoQuestionSeeding: boolean;
  processingQueueSize: number;
}

interface ConfigResponse {
  success: boolean;
  config: {
    parsingHierarchy: ParsingMethod[];
    systemConfig: SystemConfig;
  };
}

export default function AdminSystemConfig() {
  const { toast } = useToast();
  const [hierarchy, setHierarchy] = useState<ParsingMethod[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>({
    batchProcessingTimeout: 300000,
    maxConcurrentJobs: 3,
    retryFailedBatches: true,
    autoQuestionSeeding: true,
    processingQueueSize: 100
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Fetch system configuration
  const { data: configData, isLoading: configLoading, refetch: refetchConfig } = useQuery<ConfigResponse>({
    queryKey: ['/api/admin/system/config'],
  });

  // Update state when data changes (TanStack Query v5 pattern)
  useEffect(() => {
    if (configData?.config) {
      setHierarchy(configData.config.parsingHierarchy);
      setSystemConfig(configData.config.systemConfig);
    }
  }, [configData]);

  // Update hierarchy mutation
  const updateHierarchyMutation = useMutation({
    mutationFn: async (newHierarchy: ParsingMethod[]) => {
      return apiRequest('/api/admin/system/config/hierarchy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hierarchy: newHierarchy })
      });
    },
    onSuccess: () => {
      toast({
        title: "Hierarchy updated",
        description: "Parsing hierarchy has been successfully updated."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/system/config'] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update parsing hierarchy",
        variant: "destructive"
      });
    }
  });

  // Update timeouts mutation
  const updateTimeoutsMutation = useMutation({
    mutationFn: async (timeouts: Record<string, number>) => {
      return apiRequest('/api/admin/system/config/timeouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeouts })
      });
    },
    onSuccess: () => {
      toast({
        title: "Timeouts updated",
        description: "System timeouts have been successfully updated."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update timeouts",
        variant: "destructive"
      });
    }
  });

  // Update general config mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (config: SystemConfig) => {
      return apiRequest('/api/admin/system/config/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
    },
    onSuccess: () => {
      toast({
        title: "Configuration updated",
        description: "System configuration has been successfully updated."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update configuration",
        variant: "destructive"
      });
    }
  });

  const getMethodIcon = (id: string) => {
    switch (id) {
      case 'nougat':
        return <Brain className="w-5 h-5 text-purple-500" />;
      case 'document-ai':
        return <Eye className="w-5 h-5 text-blue-500" />;
      case 'mathpix':
        return <Zap className="w-5 h-5 text-green-500" />;
      case 'pdf-js':
        return <FileText className="w-5 h-5 text-orange-500" />;
      case 'tesseract':
        return <Cpu className="w-5 h-5 text-gray-500" />;
      default:
        return <Database className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const formatTimeout = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const parseTimeout = (timeString: string): number => {
    const match = timeString.match(/(\d+)m?\s*(\d*)s?/);
    if (match) {
      const minutes = match[1] ? parseInt(match[1]) : 0;
      const seconds = match[2] ? parseInt(match[2]) : 0;
      return (minutes * 60 + seconds) * 1000;
    }
    return parseInt(timeString) * 1000; // Assume seconds if no format
  };

  const moveMethod = (fromIndex: number, toIndex: number) => {
    const newHierarchy = [...hierarchy];
    const [movedMethod] = newHierarchy.splice(fromIndex, 1);
    newHierarchy.splice(toIndex, 0, movedMethod);
    
    // Update priorities
    const updatedHierarchy = newHierarchy.map((method, index) => ({
      ...method,
      priority: index + 1
    }));
    
    setHierarchy(updatedHierarchy);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      moveMethod(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
  };

  const handleTimeoutChange = (methodId: string, timeoutString: string) => {
    try {
      const timeoutMs = parseTimeout(timeoutString);
      setHierarchy(prev => prev.map(method => 
        method.id === methodId ? { ...method, timeout: timeoutMs } : method
      ));
    } catch (error) {
      console.error('Invalid timeout format:', timeoutString);
    }
  };

  const saveHierarchy = () => {
    updateHierarchyMutation.mutate(hierarchy);
  };

  const saveTimeouts = () => {
    const timeouts = hierarchy.reduce((acc, method) => {
      acc[method.id] = method.timeout;
      return acc;
    }, {} as Record<string, number>);
    timeouts.batchProcessing = systemConfig.batchProcessingTimeout;
    
    updateTimeoutsMutation.mutate(timeouts);
  };

  const saveSystemConfig = () => {
    updateConfigMutation.mutate(systemConfig);
  };

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground" data-testid="text-system-config">
                System Configuration
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage parsing hierarchy, timeouts, and system settings
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                onClick={() => refetchConfig()}
                variant="outline"
                size="sm"
                disabled={configLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${configLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Link href="/admin-dashboard">
                <Button variant="outline" size="sm" data-testid="link-admin-dashboard">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/admin-pdf-monitor">
                <Button variant="outline" size="sm" data-testid="link-pdf-monitor">
                  <Settings className="w-4 h-4 mr-2" />
                  PDF Monitor
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="hierarchy" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hierarchy" data-testid="tab-hierarchy">Parsing Hierarchy</TabsTrigger>
            <TabsTrigger value="timeouts" data-testid="tab-timeouts">Timeout Settings</TabsTrigger>
            <TabsTrigger value="general" data-testid="tab-general">General Settings</TabsTrigger>
          </TabsList>

          {/* Parsing Hierarchy Tab */}
          <TabsContent value="hierarchy" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GripVertical className="w-5 h-5" />
                  PDF Processing Hierarchy
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Drag and drop to reorder the parsing methods. The system will try methods in order from top to bottom.
                </p>
              </CardHeader>
              <CardContent>
                {configLoading ? (
                  <div className="text-center py-8">
                    <Loader className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p className="text-muted-foreground">Loading configuration...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hierarchy.map((method, index) => (
                      <div
                        key={method.id}
                        className={`flex items-center gap-4 p-4 border rounded-lg cursor-move transition-colors ${
                          draggedIndex === index ? 'bg-muted border-primary' : 'hover:bg-muted/50'
                        }`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                        data-testid={`hierarchy-item-${method.id}`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex items-center gap-2">
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                            <Badge variant="outline">#{method.priority}</Badge>
                          </div>
                          {getMethodIcon(method.id)}
                          <div>
                            <div className="font-medium">{method.name}</div>
                            <div className="text-sm text-muted-foreground">{method.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={method.enabled ? "default" : "secondary"}>
                            {method.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {formatTimeout(method.timeout)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <Separator className="my-6" />
                
                <div className="flex justify-end">
                  <Button
                    onClick={saveHierarchy}
                    disabled={updateHierarchyMutation.isPending}
                    data-testid="button-save-hierarchy"
                  >
                    {updateHierarchyMutation.isPending ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Hierarchy
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Timeout Settings Tab */}
          <TabsContent value="timeouts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="w-5 h-5" />
                  Processing Timeouts
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Configure timeout limits for each parsing method and system operations.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {hierarchy.map((method) => (
                  <div key={method.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`timeout-${method.id}`}>
                    <div className="flex items-center gap-3">
                      {getMethodIcon(method.id)}
                      <div>
                        <div className="font-medium">{method.name}</div>
                        <div className="text-sm text-muted-foreground">Processing timeout limit</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={formatTimeout(method.timeout)}
                        onChange={(e) => handleTimeoutChange(method.id, e.target.value)}
                        className="w-24 text-center"
                        placeholder="15m"
                      />
                    </div>
                  </div>
                ))}
                
                <Separator />
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Batch Processing Timeout</div>
                    <div className="text-sm text-muted-foreground">Timeout for batch operations</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={formatTimeout(systemConfig.batchProcessingTimeout)}
                      onChange={(e) => setSystemConfig(prev => ({
                        ...prev,
                        batchProcessingTimeout: parseTimeout(e.target.value)
                      }))}
                      className="w-24 text-center"
                      placeholder="5m"
                    />
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button
                    onClick={saveTimeouts}
                    disabled={updateTimeoutsMutation.isPending}
                    data-testid="button-save-timeouts"
                  >
                    {updateTimeoutsMutation.isPending ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Timeouts
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* General Settings Tab */}
          <TabsContent value="general" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  General System Settings
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Configure general system behavior and performance parameters.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="maxConcurrentJobs" className="text-base">
                      Maximum Concurrent Jobs
                    </Label>
                    <Input
                      id="maxConcurrentJobs"
                      type="number"
                      value={systemConfig.maxConcurrentJobs}
                      onChange={(e) => setSystemConfig(prev => ({
                        ...prev,
                        maxConcurrentJobs: parseInt(e.target.value) || 3
                      }))}
                      className="w-20 text-center"
                      min="1"
                      max="10"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label htmlFor="processingQueueSize" className="text-base">
                      Processing Queue Size
                    </Label>
                    <Input
                      id="processingQueueSize"
                      type="number"
                      value={systemConfig.processingQueueSize}
                      onChange={(e) => setSystemConfig(prev => ({
                        ...prev,
                        processingQueueSize: parseInt(e.target.value) || 100
                      }))}
                      className="w-20 text-center"
                      min="10"
                      max="1000"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="retryFailedBatches" className="text-base">
                        Retry Failed Batches
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically retry failed processing batches
                      </p>
                    </div>
                    <Switch
                      id="retryFailedBatches"
                      checked={systemConfig.retryFailedBatches}
                      onCheckedChange={(checked) => setSystemConfig(prev => ({
                        ...prev,
                        retryFailedBatches: checked
                      }))}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoQuestionSeeding" className="text-base">
                        Auto Question Seeding
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically process uploaded PDFs
                      </p>
                    </div>
                    <Switch
                      id="autoQuestionSeeding"
                      checked={systemConfig.autoQuestionSeeding}
                      onCheckedChange={(checked) => setSystemConfig(prev => ({
                        ...prev,
                        autoQuestionSeeding: checked
                      }))}
                    />
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button
                    onClick={saveSystemConfig}
                    disabled={updateConfigMutation.isPending}
                    data-testid="button-save-config"
                  >
                    {updateConfigMutation.isPending ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Configuration
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
      </AdminGuard>
    </SafeBoundary>
  );
}