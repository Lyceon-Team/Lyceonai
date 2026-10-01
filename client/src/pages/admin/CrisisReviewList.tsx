/**
 * @spec [Doc-03_V3 §21.3, SCL-025]
 * @implemented [2026-09-17]
 *
 * plain English: Admin list page for crisis review cases. Matches the path
 * Slack alerts already link to (/admin/crisis-review). Shows open, in_review,
 * and resolved cases sorted by SLA urgency. Category (crisis vs safeguarding)
 * is visible in the list so the reviewer knows what they are opening.
 *
 * §4.1 finding: the review case record does NOT hold student message content.
 * It stores metadata only. A future endpoint is needed to join tutor_messages.
 *
 * §4.3: no case content, student identifiers, or PII in console output,
 * error boundary, or analytics calls.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CaseStatus = "open" | "in_review" | "resolved";

type CrisisCase = {
  id: string;
  conversation_id: string;
  student_id: string;
  source: string;
  category: string;
  status: CaseStatus;
  sla_deadline: string;
  created_at: string;
  reviewer_id: string | null;
  disposition: string | null;
  reviewed_at: string | null;
};

type ListCasesResponse = {
  data: {
    cases: CrisisCase[];
    total: number;
    limit: number;
    offset: number;
  };
};

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function slaStatus(deadline: string): {
  label: string;
  breached: boolean;
  urgencyMs: number;
} {
  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const remainingMs = deadlineMs - now;

  if (remainingMs <= 0) {
    const overMs = Math.abs(remainingMs);
    const overH = Math.floor(overMs / 3_600_000);
    return {
      label: `Breached ${overH}h ago`,
      breached: true,
      urgencyMs: remainingMs,
    };
  }

  const remainH = Math.floor(remainingMs / 3_600_000);
  const remainM = Math.floor((remainingMs % 3_600_000) / 60_000);
  return {
    label: remainH > 0 ? `${remainH}h ${remainM}m left` : `${remainM}m left`,
    breached: false,
    urgencyMs: remainingMs,
  };
}

function CategoryBadge({ category }: { category: string }) {
  if (category === "crisis") {
    return (
      <Badge variant="destructive" data-testid="badge-category-crisis">
        Crisis
      </Badge>
    );
  }
  if (category === "safeguarding") {
    return (
      <Badge variant="secondary" data-testid="badge-category-safeguarding">
        Safeguarding
      </Badge>
    );
  }
  return (
    <Badge variant="outline" data-testid="badge-category-unknown">
      {category}
    </Badge>
  );
}

function StatusBadge({ status }: { status: CaseStatus }) {
  if (status === "open") {
    return <Badge variant="default">Open</Badge>;
  }
  if (status === "in_review") {
    return <Badge variant="outline">In Review</Badge>;
  }
  return <Badge variant="success">Resolved</Badge>;
}

export default function CrisisReviewList() {
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "all">("all");
  const [, navigate] = useLocation();

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") {
    queryParams.set("status", statusFilter);
  }
  queryParams.set("limit", "50");
  const queryString = queryParams.toString();

  const { data, isLoading, isError, refetch } = useQuery<ListCasesResponse>({
    queryKey: [`/api/admin/crisis-review/cases?${queryString}`],
    refetchInterval: 30_000,
  });

  const cases = data?.data?.cases ?? [];
  const total = data?.data?.total ?? 0;

  const sortedCases = [...cases].sort((a, b) => {
    if (a.status === "resolved" && b.status !== "resolved") return 1;
    if (a.status !== "resolved" && b.status === "resolved") return -1;
    const aUrgency = slaStatus(a.sla_deadline).urgencyMs;
    const bUrgency = slaStatus(b.sla_deadline).urgencyMs;
    return aUrgency - bUrgency;
  });

  return (
    <AppShell>
      <div
        className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl"
        data-testid="crisis-review-list"
      >
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle>Crisis Review Queue</CardTitle>
                <CardDescription>
                  {total} case{total !== 1 ? "s" : ""} total
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                data-testid="button-refresh"
              >
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as CaseStatus | "all")}
              className="mb-4"
            >
              <TabsList aria-label="Filter by status">
                <TabsTrigger value="all" data-testid="tab-all">
                  All
                </TabsTrigger>
                <TabsTrigger value="open" data-testid="tab-open">
                  Open
                </TabsTrigger>
                <TabsTrigger value="in_review" data-testid="tab-in-review">
                  In Review
                </TabsTrigger>
                <TabsTrigger value="resolved" data-testid="tab-resolved">
                  Resolved
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {isLoading ? (
              <p
                className="text-sm text-muted-foreground py-8 text-center"
                data-testid="loading"
              >
                Loading cases...
              </p>
            ) : isError ? (
              <div className="space-y-2 py-8 text-center" data-testid="error">
                <p className="text-sm text-muted-foreground">
                  Failed to load crisis review cases.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : sortedCases.length === 0 ? (
              <div
                className="rounded-lg border border-dashed p-8 text-center"
                data-testid="empty"
              >
                <p className="font-medium">No cases</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter === "all"
                    ? "No crisis review cases have been created."
                    : `No ${statusFilter.replace("_", " ")} cases.`}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Claimed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCases.map((c) => {
                    const sla = slaStatus(c.sla_deadline);
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        data-testid={`case-row-${c.id}`}
                        onClick={() => navigate(`/admin/crisis-review/${c.id}`)}
                      >
                        <TableCell>
                          <CategoryBadge category={c.category} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.source}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground"
                          title={new Date(c.created_at).toISOString()}
                        >
                          {formatRelativeTime(c.created_at)}
                        </TableCell>
                        <TableCell>
                          {c.status === "resolved" ? (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <span
                              className={
                                sla.breached
                                  ? "text-sm font-semibold text-destructive"
                                  : "text-sm text-muted-foreground"
                              }
                              data-testid={
                                sla.breached
                                  ? `sla-breached-${c.id}`
                                  : `sla-ok-${c.id}`
                              }
                            >
                              {sla.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.reviewer_id ? "Yes" : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
