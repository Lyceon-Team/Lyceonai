import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  RefreshCw, CheckCircle, AlertCircle, XCircle, Server, 
  Database, Cloud, CreditCard, Shield, ExternalLink, FileText, Target
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from "@/components/auth/AdminGuard";

interface HealthCheck {
  ok: boolean;
  detail?: string;
}

interface StripeCheck {
  secretKeyConfigured: boolean;
  webhookConfigured: boolean;
}

interface SecurityCheck {
  cookieOnlyAuth: boolean;
  bearerRejected: boolean;
  csrfProduction: boolean;
  canonicalHost: string;
}

interface HealthResponse {
  ok: boolean;
  serverTime: string;
  uptimeSec: number;
  env: string;
  version: {
    sha: string;
  };
  checks: {
    db: HealthCheck;
    supabase: HealthCheck;
    stripe: StripeCheck;
    security: SecurityCheck;
  };
}

export default function AdminDashboard() {
  // Fetch health data from new consolidated endpoint
  const { data: healthData, isLoading, refetch } = useQuery<HealthResponse>({
    queryKey: ['/api/admin/health'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const getStatusIcon = (ok: boolean | undefined) => {
    if (ok === undefined || ok === null) {
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    }
    return ok ? (
      <CheckCircle className="h-5 w-5 text-green-500" />
    ) : (
      <XCircle className="h-5 w-5 text-red-500" />
    );
  };

  const getStatusBadge = (ok: boolean | undefined, trueText = "OK", falseText = "FAIL") => {
    if (ok === undefined || ok === null) {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700">UNKNOWN</Badge>;
    }
    return ok ? (
      <Badge variant="outline" className="bg-green-50 text-green-700">{trueText}</Badge>
    ) : (
      <Badge variant="outline" className="bg-red-50 text-red-700">{falseText}</Badge>
    );
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
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
                  <h1 className="text-3xl font-bold text-foreground" data-testid="text-admin-dashboard">
                    Admin Dashboard
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    Production Health & System Status
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <Button
                    onClick={() => refetch()}
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                    data-testid="button-refresh"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Overall System Status */}
            <div className="mb-8">
              <Card className={healthData?.ok ? "border-green-200" : "border-red-200"}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {getStatusIcon(healthData?.ok)}
                    <span>Overall System Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold" data-testid="text-system-status">
                        {healthData?.ok ? "System Healthy" : healthData ? "System Issues Detected" : "Loading..."}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Environment: <Badge variant="outline">{healthData?.env || "unknown"}</Badge>
                      </p>
                    </div>
                    {getStatusBadge(healthData?.ok, "HEALTHY", "DEGRADED")}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Health Check Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {/* System Health */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    System Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Server Status:</span>
                    {getStatusBadge(true, "RUNNING")}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Uptime:</span>
                    <span className="text-sm" data-testid="text-uptime">
                      {healthData?.uptimeSec ? formatUptime(healthData.uptimeSec) : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Version:</span>
                    <Badge variant="outline" className="text-xs" data-testid="text-version">
                      {healthData?.version.sha || "unknown"}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Server Time:</span>
                    <span className="text-xs text-muted-foreground" data-testid="text-server-time">
                      {healthData?.serverTime ? format(new Date(healthData.serverTime), 'HH:mm:ss') : "N/A"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Database Health */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Database Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">DB Connectivity:</span>
                    {getStatusBadge(healthData?.checks.db.ok)}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <span className="text-sm" data-testid="text-db-detail">
                      {healthData?.checks.db.detail || "not checked"}
                    </span>
                  </div>
                  {!healthData?.checks.db.ok && healthData?.checks.db.detail && (
                    <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-700">
                      {healthData.checks.db.detail}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Supabase Health */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cloud className="h-5 w-5" />
                    Supabase Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Connectivity:</span>
                    {getStatusBadge(healthData?.checks.supabase.ok)}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <span className="text-sm" data-testid="text-supabase-detail">
                      {healthData?.checks.supabase.detail || "not checked"}
                    </span>
                  </div>
                  {!healthData?.checks.supabase.ok && healthData?.checks.supabase.detail && (
                    <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-700">
                      {healthData.checks.supabase.detail}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Stripe Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Stripe Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Secret Key:</span>
                    {getStatusBadge(healthData?.checks.stripe.secretKeyConfigured, "Configured", "Missing")}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Webhook Secret:</span>
                    {getStatusBadge(healthData?.checks.stripe.webhookConfigured, "Configured", "Missing")}
                  </div>
                  {(!healthData?.checks.stripe.secretKeyConfigured || !healthData?.checks.stripe.webhookConfigured) && (
                    <div className="mt-2 p-2 bg-yellow-50 rounded text-xs text-yellow-700">
                      Billing will not work until configured
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Security Posture Snapshot */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Security Posture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Cookie-only Auth:</span>
                    {getStatusBadge(healthData?.checks.security.cookieOnlyAuth, "Yes", "No")}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Bearer Rejected:</span>
                    {getStatusBadge(healthData?.checks.security.bearerRejected, "Yes", "No")}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">CSRF Protection:</span>
                    {getStatusBadge(healthData?.checks.security.csrfProduction, "Enabled", "Disabled")}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Canonical Host:</span>
                    <span className="text-xs text-muted-foreground" data-testid="text-canonical-host">
                      {healthData?.checks.security.canonicalHost || "unknown"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Operational Links */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5" />
                    Operational Links
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link href="/admin-proof-endpoints">
                    <Button variant="outline" size="sm" className="w-full justify-start" data-testid="link-proof-endpoints">
                      <Target className="w-4 h-4 mr-2" />
                      Admin Proof Endpoints
                    </Button>
                  </Link>
                  <Link href="/admin-questions">
                    <Button variant="outline" size="sm" className="w-full justify-start" data-testid="link-questions">
                      <FileText className="w-4 h-4 mr-2" />
                      Question Management
                    </Button>
                  </Link>
                  <Link href="/admin-system-config">
                    <Button variant="outline" size="sm" className="w-full justify-start" data-testid="link-system-config">
                      <Server className="w-4 h-4 mr-2" />
                      System Configuration
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Status Footer */}
            <div className="mt-8 text-center text-sm text-muted-foreground">
              <p>
                Last updated: {healthData?.serverTime ? format(new Date(healthData.serverTime), 'MMM dd, yyyy HH:mm:ss') : 'Never'}
              </p>
              <p className="mt-1 text-xs">
                Dashboard auto-refreshes every 30 seconds
              </p>
            </div>
          </div>
        </div>
      </AdminGuard>
    </SafeBoundary>
  );
}
