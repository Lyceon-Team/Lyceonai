import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Link, Redirect } from "wouter";
import { linkCodeFromSearch } from "@/lib/link-code-prefill";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { csrfFetch } from "@/lib/csrf";
import {
  parseApiErrorFromResponse,
  getPremiumDenialReason,
  isApiError,
  isStudentNoLongerLinkedError,
} from "@/lib/api-error";
import {
  GUARDIAN_STUDENTS_QUERY_KEY,
  useForgetGuardianStudent,
  useGuardianStudents,
  type LinkedStudent,
} from "@/hooks/useGuardianStudents";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  Plus,
  Clock,
  AlertCircle,
  CheckCircle,
  UserMinus,
  CalendarDays,
  ClipboardList,
  RefreshCw,
  AlertTriangle,
  CreditCard,
} from "lucide-react";
import { CheckoutReturnPoller } from "@/components/guardian/CheckoutReturnPoller";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { ManageSubscriptionButton } from "@/components/guardian/ManageSubscriptionButton";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import { GuardianPurchaseCard } from "@/components/guardian/GuardianPurchaseCard";
import { GuardianTemplatePreview } from "@/components/guardian/GuardianTemplatePreview";
import { GuardianMetricTile } from "@/components/guardian/GuardianMetricTile";
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import { studentLabel } from "@/hooks/useGuardianStudents";
import {
  BILLING_STATUS_QUERY_KEY,
  useBillingStatusQuery,
} from "@/hooks/useBillingStatusQuery";
import { fetchMasteryDomains } from "@/lib/masteryApi";
import {
  guardianKpiOverallResponseSchema,
  studentResourceUrl,
} from "@lyceon/shared/student-resources";
import { LevelPill } from "@/components/mastery/LevelPill";

export default function GuardianDashboard() {
  const { isGuardian, isAuthenticated, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();
  // @spec [SCL-080; supersedes Doc-01_V8 §36.1 Initiation step 1] | @implemented [2026-09-01]
  // plain English: the guardian identifies the student by a 6-character CODE the student
  // displays and shares, not by email. The comment that stood here said the opposite and
  // said the code mechanism "appears nowhere in the locked spec corpus" — true when it was
  // written, and superseded by SCL-080, which is why the state below is already `linkCode`.
  // Guardian invite by email (2026-09-15): the emailed deep link is `/guardian?code=XXXXXX`.
  // Prefill only — the guardian still has to be signed in to reach this page (RequireRole)
  // and still has to submit, so the link changes how the code travels, never what redeeming
  // requires. Read once at mount; never re-derived in an effect.
  const [acceptedParentTerms, setAcceptedParentTerms] = useState(false);
  const [linkCode, setLinkCode] = useState(() =>
    typeof window === "undefined"
      ? ""
      : linkCodeFromSearch(window.location.search),
  );
  const [linkError, setLinkError] = useState<string | null>(null);
  // G1-02: a guardian created before R10 has no date of birth; redeem asks for it once.
  const [needsDateOfBirth, setNeedsDateOfBirth] = useState(false);
  const [guardianDateOfBirth, setGuardianDateOfBirth] = useState("");
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [unlinkStudentId, setUnlinkStudentId] = useState<string | null>(null);
  const [unlinkStudentName, setUnlinkStudentName] = useState<string>("");
  /** G3-04: who stopped being linked while selected — the notice's subject. */
  const [noLongerLinkedName, setNoLongerLinkedName] = useState<string | null>(
    null,
  );
  const forgetStudent = useForgetGuardianStudent();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [paymentNoticeDismissed, setPaymentNoticeDismissed] = useState(false);

  const {
    data: studentsData,
    isLoading: studentsLoading,
    error: studentsError,
    refetch: refetchStudents,
  } = useGuardianStudents({ enabled: isGuardian && isAuthenticated });

  const {
    data: summaryData,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["guardian-student-summary", selectedStudentId],
    queryFn: async () => {
      // ONE route per resource (Doc 05B §10.3). This is the SAME endpoint the student
      // dashboard calls; the only difference is whose id is in the path. The guardian-only
      // `/api/guardian/students/:id/summary` it replaced was the second path that produced
      // privilege divergences #1 and #3.
      const res = await csrfFetch(
        studentResourceUrl(selectedStudentId ?? "", "kpiOverall"),
        { credentials: "include" },
      );
      if (!res.ok) {
        /**
         * A REAL `HttpApiError`, so the denial is classifiable.
         *
         * This threw `new Error(data.error)` — a bare Error carrying no status
         * and no code. Selecting an unentitled linked student makes this route
         * answer `402 PAYMENT_REQUIRED` (`server/middleware/subject-resolver.ts`),
         * and with the status discarded the dashboard rendered "We couldn't
         * load progress data. Try again." — a retry button on an entitlement
         * denial, which no amount of retrying resolves.
         */
        throw await parseApiErrorFromResponse(res, "Failed to fetch summary");
      }
      // G3-01 (SCL-188): parsed, never cast. The schema is `.strict()`, so a counter that
      // reappears on the guardian branch fails here rather than rendering.
      return guardianKpiOverallResponseSchema.parse(await res.json());
    },
    enabled: !!selectedStudentId,
  });

  /**
   * @spec [owner standing rule 2026-08-21 — one derivation, one DTO, one shape; the
   *   guardian surface is the student read plus a gate] | @implemented [2026-08-21]
   *
   * The response type is `MasteryDomainsResponse` — the SAME type the student mastery grid
   * consumes — and the fetcher lives in `@/lib/masteryApi` beside the student one, because
   * the server produces both bodies from one function. The hand-written
   * `GuardianWeaknessResponse` that used to sit here declared `skills` with
   * attempts/correct/accuracyPercent against a route that returns `domains`; it read `.map`
   * off `undefined` and crashed the dashboard for every guardian whose student had rows.
   */
  const {
    data: weaknessData,
    isLoading: weaknessLoading,
    error: weaknessError,
    refetch: refetchWeakness,
  } = useQuery({
    queryKey: [studentResourceUrl(selectedStudentId ?? "", "masteryDomains")],
    queryFn: () => fetchMasteryDomains(selectedStudentId ?? ""),
    enabled: !!selectedStudentId,
  });

  /**
   * A SUCCESSFUL response whose `domains` is not an array is a contract violation, not an
   * empty result — so it renders as a recoverable error rather than as "this student has
   * no mastery yet". This is the same distinction the server makes (a failed read throws
   * and answers 500; a genuinely empty catalog answers 200 with an explicit flag), carried
   * through to the last surface that could blur it. The previous code read
   * `weaknessData.skills.map(...)` off a key the route never sends, which threw and took
   * the whole dashboard down.
   */
  const weaknessDomains = Array.isArray(weaknessData?.domains)
    ? weaknessData.domains
    : null;

  // @spec [student-ui register UI-14; Doc 01 V8 §31.3] | @implemented [2026-09-29] | plain
  // English: the shared billing-status query. `["guardian-billing-status"]` was the same GET
  // answered by the same route for the same session (the route branches on the session's role),
  // so it folded into the one key the checkout poller below already reads — one request, not two.
  // `needsPaymentUpdate` is a banner, never a gate (owner ruling 2026-09-03).
  const { data: billingStatus } = useBillingStatusQuery({
    enabled: isGuardian && isAuthenticated,
  });
  /**
   * SCL-080: the guardian REDEEMS a code the student shared. This replaced an email
   * invitation that created a `pending_student_accept` row and waited for an acceptance
   * screen that existed on no branch — which is why `guardian_links` held zero rows.
   */
  const linkMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await csrfFetch("/api/guardian/link/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // The version is deliberately NOT sent. The server resolves the
        // current Parent / Guardian Terms from legal/ at write time; a client
        // that named a version would be asserting what it was shown.
        body: JSON.stringify({ code, acceptParentGuardianTerms: true }),
      });
      // G1-02: keep the status AND the code. A bare Error dropped the code, so a refusal the
      // server had already explained (no date of birth, under 18) could not be acted on.
      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Could not use that code");
      }
      return res.json();
    },
    onSuccess: () => {
      // The link is LIVE on this response — there is nothing to wait for, so the copy
      // must not imply there is.
      setLinkSuccess("Linked. Their progress is available now.");
      setLinkCode("");
      setAcceptedParentTerms(false);
      setLinkError(null);
      setIsRateLimited(false);
      setLastUpdated(new Date());
      queryClient.invalidateQueries({ queryKey: GUARDIAN_STUDENTS_QUERY_KEY });
      // A link changes `hasActiveLink` and the derived access (§31.3).
      queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    },
    onError: (err: Error) => {
      if (isApiError(err) && err.code === "GUARDIAN_DATE_OF_BIRTH_REQUIRED") {
        setNeedsDateOfBirth(true);
      }
      if (
        err.message.includes("Too many") ||
        err.message.includes("rate limit")
      ) {
        setIsRateLimited(true);
        setLinkError(
          "Too many attempts. Please wait 15 minutes before trying again.",
        );
      } else {
        setLinkError(err.message);
      }
      setLinkSuccess(null);
    },
  });

  /**
   * G1-02: the one-time date-of-birth fill, then the same redeem again. The server decides
   * the age rule; this only carries the date and shows the server's own message.
   */
  const dateOfBirthMutation = useMutation({
    mutationFn: async (dateOfBirth: string) => {
      const res = await csrfFetch("/api/profile/date-of-birth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dateOfBirth }),
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(
          res,
          "Could not save your date of birth",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      setNeedsDateOfBirth(false);
      setLinkError(null);
      const code = linkCode.trim();
      if (code.length > 0) linkMutation.mutate(code);
    },
    onError: (err: Error) => {
      setLinkError(err.message);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const res = await csrfFetch(`/api/guardian/link/${studentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unlink student");
      return data;
    },
    // G3-04: the unlinked id comes from the mutation's own VARIABLES, not from dialog state.
    // Closing the dialog clears `unlinkStudentId` while the request is in flight, so the old
    // `selectedStudentId === unlinkStudentId` compared against null and left the unlinked
    // student's panels on screen. Their cached reads are dropped too, so nothing redraws them.
    onSuccess: (_data, studentId) => {
      setUnlinkStudentId(null);
      setUnlinkStudentName("");
      setSelectedStudentId((current) => (current === studentId ? null : current));
      forgetStudent(studentId);
      // A link changes `hasActiveLink` and the derived access (§31.3).
      queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    },
    onError: (err: Error) => {
      setLinkError(err.message);
      setUnlinkStudentId(null);
    },
  });

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    setLinkSuccess(null);
    const normalised = linkCode.replace(/\s+/g, "").toUpperCase();
    if (normalised.length === 0) {
      setLinkError("Enter the code your student gave you");
      return;
    }
    if (!acceptedParentTerms) {
      setLinkError(
        "Please agree to the Parent / Guardian Terms to link a student",
      );
      return;
    }
    // Normalised here AND on the server. The server's parse is the one that decides; this
    // only spares the round trip for whitespace and case.
    linkMutation.mutate(normalised);
  };

  /**
   * @spec [Guardian_Closure_Plan G3-04; owner ruling R7; audit G-AUD-06/19]
   *   | @implemented [2026-09-30]
   *
   * plain English: the selected student is no longer linked — a per-student read answered 404
   * (the resolver's answer for "not yours", Doc 05B §10.3), or a roster refetch no longer lists
   * them (unlinked elsewhere). The dashboard says so in words, clears the selection so their
   * panels go, drops their cached reads and refetches the roster. A 404 is never offered a
   * "Try again": the link does not come back by retrying.
   *
   * An effect, not derived state: it CHANGES things (selection, cache, a refetch). The
   * condition it acts on is derived in the render body from fetched data.
   */
  const rosterIds = Array.isArray(studentsData?.students)
    ? studentsData.students.map((student) => student.id)
    : null;
  const selectedNoLongerLinked =
    selectedStudentId !== null &&
    (isStudentNoLongerLinkedError(summaryError) ||
      isStudentNoLongerLinkedError(weaknessError) ||
      (rosterIds !== null && !rosterIds.includes(selectedStudentId)));
  useEffect(() => {
    if (!selectedNoLongerLinked || selectedStudentId === null) return;
    const gone = Array.isArray(studentsData?.students)
      ? studentsData.students.find((student) => student.id === selectedStudentId)
      : undefined;
    setNoLongerLinkedName(gone ? studentLabel(gone) : "This student");
    setSelectedStudentId(null);
    forgetStudent(selectedStudentId);
  }, [selectedNoLongerLinked, selectedStudentId, studentsData, forgetStudent]);

  const handleUnlinkClick = (student: LinkedStudent) => {
    setUnlinkStudentId(student.id);
    setUnlinkStudentName(student.display_name || student.email.split("@")[0]);
  };

  const confirmUnlink = () => {
    if (unlinkStudentId) {
      unlinkMutation.mutate(unlinkStudentId);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center">
        <div className="text-[#0F2E48]">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (!isGuardian) {
    return <Redirect to="/dashboard" />;
  }

  /**
   * A SUCCESSFUL response whose `students` is not an array is a contract violation, not an
   * empty roster. `|| []` rendered it as "Connection Required" — which reads to a parent as
   * a fact about their account ("you have no linked student") when the truth is that we
   * could not establish the roster at all. Same distinction as `weaknessDomains` above, and
   * the same class as the `?? 0` that told a parent their child had answered nothing.
   */
  const students = Array.isArray(studentsData?.students)
    ? studentsData.students
    : null;
  const studentsMalformed = studentsData !== undefined && students === null;

  const selectedStudent =
    students?.find((student) => student.id === selectedStudentId) ?? null;

  const showPaidUnlinkedCta =
    billingStatus?.hasActiveLink === false && !!billingStatus?.isPaid;
  const showUnlinkedLinkFirstHint =
    billingStatus?.hasActiveLink === false && !billingStatus?.isPaid;

  /**
   * THE GUARDIAN'S REAL PAID BOUNDARY.
   *
   * @spec [owner ruling 2026-09-03 §2 third and fourth CTA states]
   *
   * Five of the seven paid surfaces this app has are `RequireRole
   * allow={["student","admin"]}` (see `App.tsx`), so a guardian never reaches
   * them. Their boundary is HERE: selecting a linked student whose entitlement
   * is inactive makes `/api/students/:id/kpi/overall` and `/mastery/domains`
   * answer `402 PAYMENT_REQUIRED`. Until now that rendered as "We couldn't load
   * progress data. Try again." — a retry button on a denial.
   *
   * Derived in the render body from data already fetched: a pure function of
   * fetched state never belongs in a `useEffect` (Coding Standards §11.4).
   */
  const selectedStudentDenied =
    getPremiumDenialReason(summaryError) !== null ||
    getPremiumDenialReason(weaknessError) !== null;

  return (
    <CheckoutReturnPoller>
      <GuardianShell>
        <div className="bg-background p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
              <div className="flex items-center gap-3 min-w-0">
                <Users className="h-8 w-8 text-[#0F2E48]" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0F2E48]/60 mb-1">
                    Guardian Portal
                  </p>
                  <h1 className="text-3xl font-bold text-[#0F2E48] tracking-tight">
                    Student Performance Data
                  </h1>
                  <p className="text-[#0F2E48]/60 text-sm">
                    Read-only reporting from linked student runtime records.
                  </p>
                </div>
              </div>
              {/*
              Shown only when there is a subscription to manage. It used to
              render unconditionally, which is how an unpaid guardian reached a
              Stripe portal reporting "No payment method / No invoice history".
            */}
              <ManageSubscriptionButton
                effectiveAccess={billingStatus?.effectiveAccess}
                isPaid={billingStatus?.isPaid}
                lapsed={billingStatus?.lapsed}
              />
            </div>

            {/*
            THE BANNER THAT REPLACES THE INTERSTITIAL.

            `needsPaymentUpdate` used to make the component now called
            `CheckoutReturnPoller` render a
            full-screen "Payment Update Required" card INSTEAD of this whole
            dashboard. It is true for `past_due`, and SCL-029 rules `past_due`
            ENTITLED — so a guardian with full access lost the link panel, the
            purchase card and every progress view at once, and the only control
            left could fail silently. A notice belongs above the page, never in
            front of it. Dismissible, because a parent who has seen it and is
            dealing with it should not be told twice on every navigation.
          */}
            {billingStatus?.needsPaymentUpdate && !paymentNoticeDismissed && (
              <Alert
                className="border-amber-200 bg-amber-50"
                data-testid="guardian-payment-health-banner"
              >
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        A subscription payment needs attention.
                      </div>
                      <div className="text-sm">
                        Your linked student keeps their access while the payment
                        retries. Updating the card now avoids losing it.
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ManageSubscriptionButton
                        effectiveAccess={billingStatus?.effectiveAccess}
                        isPaid={billingStatus?.isPaid}
                        lapsed={billingStatus?.lapsed}
                        label="Update payment method"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPaymentNoticeDismissed(true)}
                        data-testid="dismiss-payment-health-banner"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {showPaidUnlinkedCta && (
              <Alert className="border-[#0F2E48]/20 bg-[#0F2E48]/5">
                <CreditCard className="h-4 w-4 text-[#0F2E48]" />
                <AlertDescription className="text-[#0F2E48]">
                  <div className="font-medium">
                    Your subscription is active.
                  </div>
                  <div className="text-sm text-[#0F2E48]/80">
                    Link your student to unlock guardian progress, KPI, and
                    calendar views.
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {showUnlinkedLinkFirstHint && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">
                  Link your student first, then choose a subscription to unlock
                  premium guardian views.
                </AlertDescription>
              </Alert>
            )}

            {studentsMalformed && (
              <div className="py-2">
                <RecoveryNotice
                  title="We couldn't load your linked students."
                  message="Try again. If this keeps happening, refresh the page."
                  onRetry={() => void refetchStudents()}
                />
              </div>
            )}

            <Card className="bg-card border-border/60">
              <CardHeader>
                <CardTitle className="text-[#0F2E48] flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Link a Student
                </CardTitle>
                <CardDescription>
                  Ask your student for their link code, from their account
                  settings. Entering it links you straight away.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleLink}
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <div className="flex-1">
                    <Label htmlFor="linkCode" className="sr-only">
                      Student link code
                    </Label>
                    <Input
                      id="linkCode"
                      data-testid="guardian-link-code-input"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="Enter your student's code"
                      value={linkCode}
                      onChange={(e) => setLinkCode(e.target.value)}
                      maxLength={12}
                      className="font-mono tracking-[0.2em] uppercase"
                    />
                  </div>
                  <Button
                    type="submit"
                    data-testid="guardian-link-code-submit"
                    disabled={
                      linkMutation.isPending ||
                      linkCode.trim().length === 0 ||
                      !acceptedParentTerms
                    }
                    className="bg-[#0F2E48] hover:bg-[#0F2E48]/90 sm:w-auto w-full"
                  >
                    {linkMutation.isPending ? "Linking..." : "Link student"}
                  </Button>
                </form>
                {/*
                  Linking gives a guardian visibility of a minor's learning
                  data, so the Parent / Guardian Terms are accepted here rather
                  than assumed from signup. The label LINKS to the document and
                  reproduces none of it: the title comes from the manifest by
                  way of the page it opens, and a summary here would be a second
                  copy of a contract.
                */}
                <label className="mt-4 flex items-start gap-2 text-sm text-[#0F2E48]/80">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={acceptedParentTerms}
                    onChange={(e) => setAcceptedParentTerms(e.target.checked)}
                    data-testid="guardian-accept-parent-terms"
                  />
                  <span>
                    I agree to the{" "}
                    <a
                      href="/legal/parent-guardian-terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      LYCEON Parent / Guardian Terms
                    </a>
                    .
                  </span>
                </label>
                {needsDateOfBirth && (
                  <form
                    className="mt-4 flex flex-col sm:flex-row gap-3 items-end"
                    data-testid="guardian-dob-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (guardianDateOfBirth) {
                        dateOfBirthMutation.mutate(guardianDateOfBirth);
                      }
                    }}
                  >
                    <div className="flex-1">
                      <Label htmlFor="guardian-date-of-birth">
                        Your date of birth
                      </Label>
                      <Input
                        id="guardian-date-of-birth"
                        data-testid="guardian-dob-input"
                        type="date"
                        value={guardianDateOfBirth}
                        onChange={(e) => setGuardianDateOfBirth(e.target.value)}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      data-testid="guardian-dob-submit"
                      disabled={
                        dateOfBirthMutation.isPending || !guardianDateOfBirth
                      }
                      className="bg-[#0F2E48] hover:bg-[#0F2E48]/90 sm:w-auto w-full"
                    >
                      {dateOfBirthMutation.isPending
                        ? "Saving..."
                        : "Save and link"}
                    </Button>
                  </form>
                )}
                {linkError && (
                  <Alert
                    className={`mt-4 ${isRateLimited ? "bg-amber-50 border-amber-200" : "border-border/70 bg-card/70"}`}
                  >
                    {isRateLimited ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-[#0F2E48]/70" />
                    )}
                    <AlertDescription
                      className={
                        isRateLimited ? "text-amber-800" : "text-[#0F2E48]/80"
                      }
                    >
                      {linkError}
                    </AlertDescription>
                  </Alert>
                )}
                {linkSuccess && (
                  <Alert className="mt-4 bg-green-50 border-green-200">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      {linkSuccess}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/*
            THE PURCHASE SURFACE, DELIBERATELY OUTSIDE THE PAYWALL.
            It renders on the guardian's own dashboard, keyed on whether any
            LINKED STUDENT lacks entitlement — never on whether this guardian
            has access. Those are opposites: §31.3's fold grants the guardian
            access as soon as ANY one student is premium, which is exactly when
            a second, unpaid student still needs buying for. `students` is the
            list this page already fetched, so the card costs no extra request.
          */}
            {students !== null && (
              <GuardianPurchaseCard
                students={students}
                // The student the guardian just hit a boundary on arrives
                // preselected, so "Subscribe for X" lands on a form already
                // answering "which student?".
                preselectStudentId={
                  selectedStudentDenied ? selectedStudentId : null
                }
              />
            )}

            {/*
            THE TEMPLATE PREVIEW — the no-linked-student state only.
            Once a link exists the dashboard has real panels and a real name to
            show, and this would be a downgrade. Structural, never sample: see
            the component header for why numbers are refused outright.
          */}
            {students !== null && students.length === 0 && (
              <GuardianTemplatePreview />
            )}

            <Card className="bg-card border-border/60">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[#0F2E48]">
                    Linked Students
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {lastUpdated && (
                      <span className="text-xs text-[#0F2E48]/50">
                        Updated {lastUpdated.toLocaleTimeString()}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        refetchStudents();
                        setLastUpdated(new Date());
                      }}
                      className="text-[#0F2E48]/60 hover:text-[#0F2E48]"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  {students === null
                    ? "Linked students unavailable."
                    : students.length === 0
                      ? "No students linked yet. Use the form above to link a student."
                      : `${students.length} student${students.length !== 1 ? "s" : ""} linked`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {studentsLoading ? (
                  <div className="text-center py-8 text-[#0F2E48]/60">
                    Loading students...
                  </div>
                ) : studentsError || students === null ? (
                  /* `students === null` is a SUCCESSFUL response whose `students` was not an
                   array. It renders here, beside the failed fetch, because both mean the
                   same thing to a parent: we could not establish the roster. What it must
                   NOT do is fall through to "No students linked yet" — that is a claim
                   about their account, made from a value we never read. */
                  <div className="py-6">
                    <RecoveryNotice
                      title="We couldn't load students."
                      message="Try again. If this keeps happening, refresh the page."
                      onRetry={() => void refetchStudents()}
                    />
                  </div>
                ) : students.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Users className="h-12 w-12 text-[#0F2E48]/30 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-[#0F2E48] mb-2">
                      No students linked yet
                    </h3>
                    <p className="text-[#0F2E48]/60 max-w-sm mx-auto">
                      Ask your student for the code in their account settings,
                      then enter it above. They are linked as soon as you do.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {students.map((student) => (
                      <div
                        key={student.id}
                        className={`p-4 rounded-lg border transition-colors ${
                          selectedStudentId === student.id
                            ? "bg-[#0F2E48] text-white border-[#0F2E48]"
                            : "bg-secondary/50 border-[#0F2E48]/20 hover:border-[#0F2E48]/40"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => {
                              setNoLongerLinkedName(null);
                              setSelectedStudentId(student.id);
                            }}
                            className="flex-1 text-left"
                          >
                            <div className="font-medium">
                              {student.display_name ||
                                student.email.split("@")[0]}
                            </div>
                            <div
                              className={`text-sm ${selectedStudentId === student.id ? "text-white/70" : "text-[#0F2E48]/60"}`}
                            >
                              {student.email}
                            </div>
                            {/*
                            WHICH student is unpaid, on the list itself.
                            `has_active_entitlement` has been on the wire since
                            2026-09-02 and was read only by the purchase card's
                            filter, so a guardian with two linked students could
                            not tell from this page which one still needed
                            paying for — while being asked to pay for one.
                          */}
                            {!student.has_active_entitlement && (
                              <div
                                className={`mt-1 text-xs font-medium ${selectedStudentId === student.id ? "text-amber-200" : "text-amber-700"}`}
                                data-testid="student-unfunded-badge"
                              >
                                {student.entitlement_lapsed
                                  ? "Subscription ended"
                                  : "No subscription yet"}
                              </div>
                            )}
                          </button>
                          {/*
                            @spec [Doc_05F_Study_Calendar, §16 guardian view,
                                   formula sheet item 14 — the guardian read]
                            | @implemented [2026-09-22]

                            The guardian's way in to THIS student's calendar.
                            Per student, not one global link, because the route
                            is scoped to a student id and a guardian may have
                            several.

                            Always rendered, never gated on
                            `has_active_entitlement`. The route derives
                            visibility server-side from link AND the STUDENT's
                            entitlement (§16), and answers 402 itself when that
                            fails. Hiding the link on a hunch about entitlement
                            would be the client deciding access, which §7.12
                            forbids — and it would leave a guardian whose
                            student just paid with no way to reach the page
                            until this component happened to refetch.
                          */}
                          <Link href={`/students/${student.id}/calendar`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                              className={`ml-1 ${selectedStudentId === student.id ? "text-white/70 hover:text-white hover:bg-white/10" : "text-[#0F2E48]/60 hover:text-[#0F2E48]"}`}
                              title={`View ${student.display_name || student.email.split("@")[0]}'s calendar`}
                              data-testid={`guardian-calendar-link-${student.id}`}
                            >
                              <CalendarDays className="h-4 w-4" />
                            </Button>
                          </Link>
                          {/*
                            G1 (SCL-181) — the student's practice test results.
                            Always rendered, for the calendar link's reason above:
                            the route answers 402/404 itself.
                          */}
                          <Link href={`/students/${student.id}/tests`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                              className={`ml-1 ${selectedStudentId === student.id ? "text-white/70 hover:text-white hover:bg-white/10" : "text-[#0F2E48]/60 hover:text-[#0F2E48]"}`}
                              title={`View ${student.display_name || student.email.split("@")[0]}'s practice test results`}
                              data-testid={`guardian-tests-link-${student.id}`}
                            >
                              <ClipboardList className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlinkClick(student);
                            }}
                            className={`ml-1 ${selectedStudentId === student.id ? "text-white/70 hover:text-white hover:bg-white/10" : "text-[#0F2E48]/60 hover:text-red-600"}`}
                            title="Unlink Student"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {noLongerLinkedName !== null && (
              <Alert data-testid="guardian-student-no-longer-linked">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>
                    {noLongerLinkedName} is no longer linked to your account.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNoLongerLinkedName(null)}
                  >
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {selectedStudentId && (
              <>
                {/*
                ONE CARD, ONE CONDITION, both panels. A 402 on either the KPI or
                the mastery read means the same thing about the same student, so
                it is answered once, above them, rather than twice inside them
                as two different recoverable errors.
              */}
                {selectedStudentDenied && selectedStudent && (
                  <PremiumUpgradePrompt
                    featureBenefit={`${studentLabel(selectedStudent)}'s progress, KPIs and domain mastery`}
                    state={
                      selectedStudent.entitlement_lapsed
                        ? {
                            kind: "guardian_student_lapsed",
                            studentName: studentLabel(selectedStudent),
                          }
                        : {
                            kind: "guardian_student_unfunded",
                            studentName: studentLabel(selectedStudent),
                          }
                    }
                  />
                )}
                <Card className="bg-card border-border/60">
                  <CardHeader>
                    <CardTitle className="text-[#0F2E48]">
                      Student Progress
                    </CardTitle>
                    <CardDescription>
                      {selectedStudent?.display_name ||
                        selectedStudent?.email?.split("@")[0] ||
                        "Student"}
                      's study streak
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {summaryLoading ? (
                      <div className="text-center py-8 text-[#0F2E48]/60">
                        Loading progress...
                      </div>
                    ) : selectedStudentDenied ? (
                      // The CTA above owns this state. Offering "Try again" for a
                      // 402 is advice that cannot work.
                      <div className="rounded-lg bg-[#FFFAEF] p-4 text-sm text-[#0F2E48]/70">
                        Progress unlocks once this student has an active
                        subscription.
                      </div>
                    ) : summaryError ? (
                      <div className="py-6">
                        <RecoveryNotice
                          title="We couldn't load progress data."
                          message="Try again. If this keeps happening, refresh the page."
                          onRetry={() => void refetchSummary()}
                        />
                      </div>
                    ) : summaryData ? (
                      <div className="space-y-6">
                        {/*
                        THE SAME COMPONENT the template preview renders in its
                        `locked` variant. One tile, two states — so the preview
                        cannot drift into a lookalike of a card it no longer
                        resembles. G3-01 (R3): the streak is the one tile; the
                        7-day questions and accuracy tiles are gone, and the
                        server no longer sends their counters to a guardian.
                      */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <GuardianMetricTile
                            label="Day Streak"
                            icon={<Clock className="h-5 w-5" />}
                            value={summaryData.currentStreakDays}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 px-4">
                        <AlertCircle className="h-12 w-12 text-[#0F2E48]/30 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-[#0F2E48] mb-2">
                          No Progress Data Available
                        </h3>
                        <p className="text-[#0F2E48]/60 max-w-sm mx-auto">
                          Unable to load progress data for this student. This
                          may be because the student hasn't started any practice
                          sessions yet.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card border-border/60">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-[#0F2E48]">
                          Domain Mastery
                        </CardTitle>
                        <CardDescription>
                          Where this student&apos;s answers place them in each
                          domain. Guardian surfaces are domain-level only.
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchWeakness()}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {weaknessLoading ? (
                      <div className="text-center py-8 text-[#0F2E48]/60">
                        Loading domain mastery...
                      </div>
                    ) : selectedStudentDenied ? (
                      <div className="rounded-lg bg-[#FFFAEF] p-4 text-sm text-[#0F2E48]/70">
                        Domain mastery unlocks once this student has an active
                        subscription.
                      </div>
                    ) : weaknessError || (weaknessData && !weaknessDomains) ? (
                      <div className="py-6">
                        <RecoveryNotice
                          title="We couldn't load weakness data."
                          message="Try again. If this keeps happening, refresh the page."
                          onRetry={() => void refetchWeakness()}
                        />
                      </div>
                    ) : !weaknessDomains || weaknessDomains.length === 0 ? (
                      <div className="rounded-lg bg-[#FFFAEF] p-4 text-sm text-[#0F2E48]/70">
                        No domain mastery is available for this student yet.
                      </div>
                    ) : (
                      /*
                       * Owner ruling 2026-08-21 Q7: these cards are NOT clickable — not
                       * disabled, not clickable-and-denied. A card that looks interactive and
                       * then refuses is worse than one that never invites the click, so this
                       * is a plain <div> list with no button, no link, no cursor affordance
                       * and no drill-down target. There is no guardian skill endpoint to open
                       * (RULE 7), so an affordance here could only ever lead to a refusal.
                       */
                      <div
                        className="space-y-3"
                        data-testid="guardian-domain-list"
                      >
                        {weaknessDomains.map((node) => (
                          <div
                            key={`${node.section}-${node.domain}`}
                            className="rounded-lg border border-border/60 bg-secondary/35 p-3"
                            data-testid="guardian-domain-row"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-[#0F2E48]">
                                {node.domain}
                              </p>
                              <LevelPill
                                levelKey={node.levelKey}
                                displayName={node.displayName}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <AlertDialog
            open={!!unlinkStudentId}
            onOpenChange={() => setUnlinkStudentId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unlink Student</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to unlink {unlinkStudentName}? You will
                  no longer be able to view their progress. You can re-link them
                  later using their code.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={unlinkMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmUnlink}
                  disabled={unlinkMutation.isPending}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {unlinkMutation.isPending ? "Unlinking..." : "Unlink"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </GuardianShell>
    </CheckoutReturnPoller>
  );
}
