/**
 * @spec [Doc-03_V3 §21.3, SCL-025]
 * @implemented [2026-09-17]
 *
 * plain English: Admin detail page for a single crisis review case. Reached
 * from the Slack alert link (/admin/crisis-review/:id) or the list page.
 * Shows case metadata, detection info, SLA status, review actions (claim,
 * resolve with disposition + notes), and the durable audit trail.
 *
 * §4.1 finding: the review case record does NOT hold student message content.
 * This page displays what the record holds and surfaces an honest gap notice.
 * A future endpoint is needed to join tutor_messages for the full picture.
 *
 * §4.3: no case content, student identifiers, or PII in console output,
 * error boundary, or analytics calls.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";

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
  review_notes: string | null;
  reviewed_at: string | null;
  model_confidence: number | null;
  signature_id: string | null;
};

type AuditEntry = {
  id: string;
  case_id: string | null;
  reviewer_id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  ip: string;
};

type DetailResponse = {
  data: {
    case: CrisisCase;
    audit_log: AuditEntry[];
  };
};

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function slaDisplay(deadline: string, status: CaseStatus): string {
  if (status === "resolved") return "Resolved";
  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const remainingMs = deadlineMs - now;
  if (remainingMs <= 0) {
    const overH = Math.floor(Math.abs(remainingMs) / 3_600_000);
    return `BREACHED — ${overH}h overdue`;
  }
  const remainH = Math.floor(remainingMs / 3_600_000);
  const remainM = Math.floor((remainingMs % 3_600_000) / 60_000);
  return remainH > 0
    ? `${remainH}h ${remainM}m remaining`
    : `${remainM}m remaining`;
}

function CategoryBadge({ category }: { category: string }) {
  if (category === "crisis") {
    return (
      <Badge variant="destructive" data-testid="badge-category">
        Crisis
      </Badge>
    );
  }
  if (category === "safeguarding") {
    return (
      <Badge variant="secondary" data-testid="badge-category">
        Safeguarding
      </Badge>
    );
  }
  return (
    <Badge variant="outline" data-testid="badge-category">
      {category}
    </Badge>
  );
}

export default function CrisisReviewDetail() {
  const [, params] = useRoute("/admin/crisis-review/:id");
  const caseId = params?.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [disposition, setDisposition] = useState<string>("");
  const [notes, setNotes] = useState("");

  const caseQueryKey = [`/api/admin/crisis-review/cases/${caseId}`];

  const { data, isLoading, isError, refetch } = useQuery<DetailResponse>({
    queryKey: caseQueryKey,
    enabled: !!caseId,
    refetchInterval: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/admin/crisis-review/cases/${caseId}/claim`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: caseQueryKey });
    },
  });

  const dispositionMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/admin/crisis-review/cases/${caseId}/disposition`, {
        method: "POST",
        body: JSON.stringify({
          disposition,
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: caseQueryKey });
      setDisposition("");
      setNotes("");
    },
  });

  const reviewCase = data?.data?.case;
  const auditLog = data?.data?.audit_log ?? [];
  const isBreached =
    reviewCase && reviewCase.status !== "resolved"
      ? new Date(reviewCase.sla_deadline).getTime() < Date.now()
      : false;

  return (
    <AppShell>
      <div
        className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-4xl"
        data-testid="crisis-review-detail"
      >
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate("/admin/crisis-review")}
          data-testid="button-back"
        >
          &larr; Back to queue
        </Button>

        {isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="loading">
            Loading case...
          </p>
        ) : isError || !reviewCase ? (
          <Card data-testid="error">
            <CardContent className="py-8 text-center">
              <p className="font-medium">Case not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This case may not exist or you may not have access.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Case Header */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <CategoryBadge category={reviewCase.category} />
                  <Badge
                    variant={
                      reviewCase.status === "open"
                        ? "default"
                        : reviewCase.status === "in_review"
                          ? "outline"
                          : "success"
                    }
                  >
                    {reviewCase.status.replace("_", " ")}
                  </Badge>
                  {isBreached && (
                    <Badge
                      variant="destructive"
                      data-testid="badge-sla-breached"
                    >
                      SLA Breached
                    </Badge>
                  )}
                </div>
                <CardDescription className="font-mono text-xs mt-2">
                  Case {reviewCase.id}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="font-mono" data-testid="case-source">
                      {reviewCase.source}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Category</dt>
                    <dd data-testid="case-category">{reviewCase.category}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd data-testid="case-created">
                      {formatAbsoluteTime(reviewCase.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">SLA Deadline</dt>
                    <dd
                      className={
                        isBreached ? "font-semibold text-destructive" : ""
                      }
                      data-testid="case-sla"
                    >
                      {slaDisplay(reviewCase.sla_deadline, reviewCase.status)}
                    </dd>
                  </div>
                  {reviewCase.model_confidence !== null && (
                    <div>
                      <dt className="text-muted-foreground">
                        Model Confidence
                      </dt>
                      <dd data-testid="case-confidence">
                        {(reviewCase.model_confidence * 100).toFixed(1)}%
                      </dd>
                    </div>
                  )}
                  {reviewCase.signature_id && (
                    <div>
                      <dt className="text-muted-foreground">Signature ID</dt>
                      <dd
                        className="font-mono text-xs"
                        data-testid="case-signature"
                      >
                        {reviewCase.signature_id}
                      </dd>
                    </div>
                  )}
                  {reviewCase.disposition && (
                    <div>
                      <dt className="text-muted-foreground">Disposition</dt>
                      <dd data-testid="case-disposition">
                        {reviewCase.disposition.replace("_", " ")}
                      </dd>
                    </div>
                  )}
                  {reviewCase.reviewed_at && (
                    <div>
                      <dt className="text-muted-foreground">Resolved At</dt>
                      <dd data-testid="case-resolved-at">
                        {formatAbsoluteTime(reviewCase.reviewed_at)}
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            {/* §4.1 — Message content gap notice */}
            <Card className="border-dashed">
              <CardContent className="py-4">
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="message-content-gap"
                >
                  <strong>Note:</strong> The review case record stores detection
                  metadata only (source, category, confidence, signature). The
                  student message that triggered detection lives in
                  tutor_messages and is not yet joined by this endpoint. A
                  dedicated read endpoint is needed before reviewers can assess
                  the conversation in context.
                </p>
              </CardContent>
            </Card>

            {/* Actions */}
            {reviewCase.status === "open" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Claim for Review</CardTitle>
                  <CardDescription>
                    Claiming assigns this case to you and transitions it to
                    &ldquo;in review.&rdquo;
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => claimMutation.mutate()}
                    disabled={claimMutation.isPending}
                    data-testid="button-claim"
                  >
                    {claimMutation.isPending ? "Claiming..." : "Claim Case"}
                  </Button>
                  {claimMutation.isError && (
                    <p className="mt-2 text-sm text-destructive">
                      Failed to claim case. It may already be claimed.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {reviewCase.status === "in_review" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resolve Case</CardTitle>
                  <CardDescription>
                    Set the disposition and resolve this case.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="disposition-select"
                      className="text-sm font-medium"
                    >
                      Disposition
                    </label>
                    <Select value={disposition} onValueChange={setDisposition}>
                      <SelectTrigger
                        id="disposition-select"
                        data-testid="select-disposition"
                      >
                        <SelectValue placeholder="Select disposition..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true_positive">
                          True Positive
                        </SelectItem>
                        <SelectItem value="false_positive">
                          False Positive
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="notes-input"
                      className="text-sm font-medium"
                    >
                      Notes (optional)
                    </label>
                    <Textarea
                      id="notes-input"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add review notes..."
                      maxLength={5000}
                      data-testid="input-notes"
                    />
                  </div>
                  <Button
                    onClick={() => dispositionMutation.mutate()}
                    disabled={!disposition || dispositionMutation.isPending}
                    data-testid="button-resolve"
                  >
                    {dispositionMutation.isPending
                      ? "Resolving..."
                      : "Resolve Case"}
                  </Button>
                  {dispositionMutation.isError && (
                    <p className="mt-2 text-sm text-destructive">
                      Failed to resolve case.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Audit Trail */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit Trail</CardTitle>
                <CardDescription>
                  Every access to this case is recorded per SCL-025.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {auditLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No audit entries.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Reviewer</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLog.map((entry) => (
                        <TableRow
                          key={entry.id}
                          data-testid={`audit-row-${entry.id}`}
                        >
                          <TableCell className="font-mono text-xs">
                            {entry.action}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {entry.reviewer_id.slice(0, 8)}...
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatAbsoluteTime(entry.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Separator />

            <p className="text-xs text-muted-foreground text-center">
              All access to this case is durably audit-logged per SCL-025.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
