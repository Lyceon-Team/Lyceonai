import { Component, ReactNode, Suspense, lazy } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { UIProvider } from "@/components/providers/ui-provider";
import { Analytics } from "@vercel/analytics/react";

import { analyticsBeforeSend } from "./lib/analytics-surface";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import { GUARDIAN_ROUTES } from "@/features/guardian/routes";

// @spec [Coding Standards §11; student-ui register UI-11] | @implemented [2026-09-29] |
// plain English: only `/` (HomePage), `/login` (Login) and the catch-all (NotFound) stay
// eager, because they are the landing surfaces whose first paint should not wait on a second
// chunk request. Every other page, including these two, is lazy and loads under the Router's
// Suspense fallback.
// @spec [SEO plan F8; Coding Standards §11] | @implemented [2026-10-05] | plain English: the
// role guard (with its re-consent modal) and the pending-deletion screen are signed-in surfaces,
// so they load on demand instead of in the entry bundle every public page downloads. The guard
// renders inside the router's Suspense boundary, as the pages it wraps do. `/login` stays eager:
// it is a landing page (student-ui register UI-11).
const RequireRole = lazy(() =>
  import("@/components/auth/RequireRole").then((m) => ({ default: m.RequireRole })),
);
const PendingDeletionScreen = lazy(() =>
  import("@/components/account-deletion/PendingDeletionScreen").then((m) => ({
    default: m.PendingDeletionScreen,
  })),
);
const UpdatePassword = lazy(() => import("@/pages/update-password"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));

const AccountRecover = lazy(() => import("@/pages/account-recover"));

const LyceonDashboard = lazy(() => import("@/pages/lyceon-dashboard"));
const Chat = lazy(() => import("@/pages/chat"));
const Practice = lazy(() => import("@/pages/practice"));
// Full-length exam shell (E7b). Wrappers are module-scope components, not inline
// arrows, so a re-render of the Switch never remounts a running module.
const TestsHomePage = lazy(() => import("@/features/exam/pages/TestsHomePage"));
const ExamSessionPage = lazy(() => import("@/features/exam/pages/ExamSessionPage"));
const ExamModulePage = lazy(() => import("@/features/exam/pages/ExamModulePage"));
const ExamReportPage = lazy(() => import("@/features/exam/pages/ExamReportPage"));
function TestsHomeRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <TestsHomePage />
    </RequireRole>
  );
}
function ExamSessionRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <ExamSessionPage />
    </RequireRole>
  );
}
function ExamModuleRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <ExamModulePage />
    </RequireRole>
  );
}
function ExamReportRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <ExamReportPage />
    </RequireRole>
  );
}
// Doc 05F §17.1. Lazy like every other authenticated page: the calendar pulls in @dnd-kit
// and its own stylesheet, and a student who never opens it should not download either.
const Calendar = lazy(() => import("@/pages/calendar"));
// Guardian pages (the student calendar and exam results included) are routed by
// GUARDIAN_ROUTES (`features/guardian/routes.tsx`), which lazy-loads them itself.
const ScoreReport = lazy(() => import("@/pages/score-report"));
const BrowseTopics = lazy(() => import("@/pages/browse-topics"));
const ResumePractice = lazy(() => import("@/pages/resume-practice"));
const Review = lazy(() => import("@/pages/review"));
const ResumeReview = lazy(() => import("@/pages/resume-review"));
const UserProfile = lazy(() => import("@/pages/UserProfile"));
const ProfileComplete = lazy(() => import("@/pages/profile-complete"));
const GuardianRequired = lazy(() => import("@/pages/guardian-required"));

const DigitalSAT = lazy(() => import("@/pages/digital-sat"));
const DigitalSATMath = lazy(() => import("@/pages/digital-sat-math"));
const DigitalSATReadingWriting = lazy(
  () => import("@/pages/digital-sat-reading-writing"),
);
const Blog = lazy(() => import("@/pages/blog"));
const BlogPost = lazy(() => import("@/pages/blog-post"));
const SatQuestionOfTheDay = lazy(() => import("@/pages/sat-question-of-the-day"));
const SatQuestionOfTheDayArchive = lazy(
  () => import("@/pages/sat-question-of-the-day-day"),
);
const LegalHub = lazy(() => import("@/pages/legal"));
const LegalDoc = lazy(() => import("@/pages/legal-doc"));
const TrustHub = lazy(() => import("@/pages/trust"));
const MasteryPage = lazy(() => import("@/pages/mastery"));
const UpgradePage = lazy(() => import("@/pages/upgrade"));
const CrisisReviewList = lazy(() => import("@/pages/admin/CrisisReviewList"));
const CrisisReviewDetail = lazy(
  () => import("@/pages/admin/CrisisReviewDetail"),
);

function PageLoader() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      data-testid="page-loader"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground text-base">Loading...</p>
      </div>
    </div>
  );
}

/** The route switch — exported so the guardian route walk (G4-01) renders the real table. */
export function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path="/" component={HomePage} />
        <Route path="/login" component={Login} />

        {/* Signup redirects to login page (signup happens via modal/form on login page) */}
        <Route path="/signup">{() => <Redirect to="/login" replace />}</Route>

        {/* SEO Content Pages */}
        <Route path="/digital-sat" component={DigitalSAT} />
        <Route path="/digital-sat/math" component={DigitalSATMath} />
        <Route
          path="/digital-sat/reading-writing"
          component={DigitalSATReadingWriting}
        />
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route
          path="/sat-question-of-the-day"
          component={SatQuestionOfTheDay}
        />
        <Route
          path="/sat-question-of-the-day/:date"
          component={SatQuestionOfTheDayArchive}
        />

        {/* Trust & Legal pages - public */}
        <Route path="/trust" component={TrustHub} />
        {/* @spec [owner ruling 2026-09-29, UI-04] | @implemented [2026-09-29] |
            plain English: the old tutor page is retired; /tutor now sends
            everyone to /chat, whose guard handles sign-in (next=/chat). */}
        <Route path="/tutor">{() => <Redirect to="/chat" replace />}</Route>
        <Route path="/legal" component={LegalHub} />
        <Route path="/legal/:slug" component={LegalDoc} />

        {/* Legacy legal redirects */}
        <Route path="/privacy">
          {() => <Redirect to="/legal/privacy-policy" replace />}
        </Route>
        <Route path="/terms">
          {() => <Redirect to="/legal/student-terms" replace />}
        </Route>

        {/* Student-only routes - require student or admin role */}
        <Route
          path="/dashboard"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <LyceonDashboard />
            </RequireRole>
          )}
        />
        <Route
          path="/chat"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <Chat />
            </RequireRole>
          )}
        />
        <Route
          path="/practice"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <Practice />
            </RequireRole>
          )}
        />
        <Route
          path="/practice/topics"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <BrowseTopics />
            </RequireRole>
          )}
        />
        <Route path="/practice/math">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/practice/reading-writing">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/practice/random">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route
          path="/practice/session/:sessionId"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <ResumePractice />
            </RequireRole>
          )}
        />
        {/* Full-length exams (Doc 04A §16, Doc 04C §16.1) — E7b. */}
        <Route path="/tests" component={TestsHomeRoute} />
        <Route path="/tests/:sessionId/report" component={ExamReportRoute} />
        <Route path="/tests/:sessionId/:section/:module" component={ExamModuleRoute} />
        <Route path="/tests/:sessionId" component={ExamSessionRoute} />
        {/*
          SCL-191 — the post-exam score report and retake answer. Student-only, and the path has
          no id in it on purpose: the occasion comes from the prompt the server sent, so there is
          nothing here a caller could point at somebody else's sitting.
        */}
        <Route
          path="/score-report"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <ScoreReport />
            </RequireRole>
          )}
        />
        {/* Doc 05F §17.1 — the student's own calendar. */}
        <Route
          path="/calendar"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <Calendar />
            </RequireRole>
          )}
        />
        <Route path="/math-practice">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/reading-writing-practice">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route
          path="/mastery"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <MasteryPage />
            </RequireRole>
          )}
        />
        <Route
          path="/upgrade"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <UpgradePage />
            </RequireRole>
          )}
        />
        {/* Review vertical — the mistake queue. Same gate as practice. */}
        <Route
          path="/review"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <Review />
            </RequireRole>
          )}
        />
        <Route
          path="/review/session/:sessionId"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <ResumeReview />
            </RequireRole>
          )}
        />
        {/* Profile routes - allow all authenticated roles */}
        <Route
          path="/profile"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <UserProfile />
            </RequireRole>
          )}
        />
        {/* G2-04: an under-13 student with no active guardian link lands here. */}
        <Route
          path="/guardian-required"
          component={() => (
            <RequireRole allow={["student"]}>
              <GuardianRequired />
            </RequireRole>
          )}
        />
        <Route
          path="/profile/complete"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <ProfileComplete />
            </RequireRole>
          )}
        />
        <Route
          path="/update-password"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <UpdatePassword />
            </RequireRole>
          )}
        />
        {/* §40.4 deletion recovery — public (token-gated, no session needed) */}
        <Route path="/account/recover" component={AccountRecover} />
        <Route
          path="/notifications"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <NotificationsPage />
            </RequireRole>
          )}
        />

        {/* Admin routes — require admin role */}
        <Route
          path="/admin/crisis-review/:id"
          component={() => (
            <RequireRole allow={["admin"]}>
              <CrisisReviewDetail />
            </RequireRole>
          )}
        />
        <Route
          path="/admin/crisis-review"
          component={() => (
            <RequireRole allow={["admin"]}>
              <CrisisReviewList />
            </RequireRole>
          )}
        />

        {/* Guardian routes (G4-01) — one table, guardian role only (G2-01; the server refuses
            admins too). */}
        {GUARDIAN_ROUTES.map(({ path, Page }) => (
          <Route
            key={path}
            path={path}
            component={() => (
              <RequireRole allow={["guardian"]}>
                <Page />
              </RequireRole>
            )}
          />
        ))}

        {/* 404 */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

/**
 * @spec [Coding Standards §12, §16; student UI vertical UI-10] | @implemented [2026-09-29]
 * plain English: the app-wide render boundary. On a render error it shows fixed copy and a
 * reload button. It never shows the raw `error.message` (which can carry server or
 * developer text) and never writes to the console: the client has no structured logger,
 * and the fallback screen itself is the surfaced failure, so nothing is swallowed.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#EAF0FF] to-white p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
            <h1 className="text-2xl font-semibold text-neutral-800 mb-4">
              Something went wrong
            </h1>
            <p className="text-neutral-600 mb-6">
              An unexpected error occurred. Reloading the page usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#3C6DF0] text-white rounded-lg hover:brightness-110 transition-all"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * @spec [Doc-01_V8 §40.3 soft-delete state behaviour] | @implemented 2026-06-21
 * plain English: routes a grace-window (soft-locked) user to the restricted pending-deletion screen —
 * except the recovery page, which must stay reachable. Unauthenticated + non-pending users pass
 * straight through. The server is authoritative (pendingDeletion comes from /api/profile via the auth
 * context + the global deletion lock); this only mirrors that state in the UI.
 */
function DeletionGate({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const [location] = useLocation();
  if (user?.pendingDeletion && location !== "/account/recover") {
    return (
      <Suspense fallback={<PageLoader />}>
        <PendingDeletionScreen />
      </Suspense>
    );
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SupabaseAuthProvider>
            <UIProvider>
              <DeletionGate>
                <Router />
              </DeletionGate>
            </UIProvider>
          </SupabaseAuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
      {/*
        Doc 06A §5.3 / Coding Standards §12.2: page views are reported from the
        public marketing and legal surface ONLY. `analyticsBeforeSend` denies
        by default, so every signed-in student page — and every route added
        later — is silent unless someone deliberately makes it public. See
        `client/src/lib/analytics-surface.ts` for why this is a predicate and
        not a conditional mount.
      */}
      <Analytics beforeSend={analyticsBeforeSend} />
    </ErrorBoundary>
  );
}

export default App;
