import { Component, ReactNode, Suspense, lazy } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { PendingDeletionScreen } from "@/components/account-deletion/PendingDeletionScreen";
import { UIProvider } from "@/components/providers/ui-provider";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { Analytics } from "@vercel/analytics/react";

import { analyticsBeforeSend } from "./lib/analytics-surface";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import { RequireRole } from "@/components/auth/RequireRole";
import { FullPageLoader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { BareCard } from "@/components/layout/BareCardShell";
import { StudentRouteFrame } from "@/components/layout/StudentRouteFrame";
import { ActiveThemeLockProvider } from "@/components/layout/theme-lock";
import { GUARDIAN_ROUTES } from "@/features/guardian/routes";
import { useInAppHistoryTracking } from "@/lib/in-app-history";

// @spec [Coding Standards §11; student-ui register UI-11] | @implemented [2026-09-29] |
// plain English: only `/` (HomePage), `/login` (Login) and the catch-all (NotFound) stay
// eager, because they are the landing surfaces whose first paint should not wait on a second
// chunk request. Every other page, including these two, is lazy and loads under the Router's
// Suspense fallback.
const UpdatePassword = lazy(() => import("@/pages/update-password"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));

const AccountRecover = lazy(() => import("@/pages/account-recover"));

const LyceonDashboard = lazy(() => import("@/pages/lyceon-dashboard"));
const Chat = lazy(() => import("@/pages/chat"));
const Practice = lazy(() => import("@/pages/practice"));
// Full-length exam shell (E7b). Wrappers are module-scope components, not inline
// arrows, so a re-render of the Switch never remounts a running module.
const TestsHomePage = lazy(() => import("@/features/exam/pages/TestsHomePage"));
const ExamSessionPage = lazy(
  () => import("@/features/exam/pages/ExamSessionPage"),
);
const ExamModulePage = lazy(
  () => import("@/features/exam/pages/ExamModulePage"),
);
const ExamReportPage = lazy(
  () => import("@/features/exam/pages/ExamReportPage"),
);
function TestsHomeRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests">
        <TestsHomePage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamSessionRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId">
        <ExamSessionPage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamModuleRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId/:section/:module">
        <ExamModulePage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamReportRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId/report">
        <ExamReportPage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
// UI-41: the three unguarded student routes, wrapped in their shell at module scope (an inline
// arrow would remount the page on every Switch render).
function LoginRoute() {
  return (
    <StudentRouteFrame route="/login">
      <Login />
    </StudentRouteFrame>
  );
}
function AccountRecoverRoute() {
  return (
    <StudentRouteFrame route="/account/recover">
      <AccountRecover />
    </StudentRouteFrame>
  );
}
function NotFoundRoute() {
  return (
    <StudentRouteFrame route="*">
      <NotFound />
    </StudentRouteFrame>
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
const SettingsPage = lazy(() => import("@/pages/settings"));
const HelpPage = lazy(() => import("@/pages/help"));

/**
 * @spec [student-UI register UI-58; Guardian_Closure_Plan G4-08] | @implemented [2026-10-03]
 * plain English: `/profile` is two pages behind one URL. A student (or admin) gets Settings in
 * the App shell (UI-58); a guardian keeps the guardian profile in the guardian shell (G4-08),
 * which `StudentRouteFrame` leaves unwrapped for a guardian. Chosen by role for presentation
 * only; every read and write on both pages is authorised by the server.
 */
function ProfileRoute(): JSX.Element {
  const { user } = useSupabaseAuth();
  return user?.role === "guardian" ? <UserProfile /> : <SettingsPage />;
}
const ProfileComplete = lazy(() => import("@/pages/profile-complete"));
const GuardianRequired = lazy(() => import("@/pages/guardian-required"));

const DigitalSAT = lazy(() => import("@/pages/digital-sat"));
const DigitalSATMath = lazy(() => import("@/pages/digital-sat-math"));
const DigitalSATReadingWriting = lazy(
  () => import("@/pages/digital-sat-reading-writing"),
);
const Blog = lazy(() => import("@/pages/blog"));
const BlogPost = lazy(() => import("@/pages/blog-post"));
const LegalHub = lazy(() => import("@/pages/legal"));
const LegalDoc = lazy(() => import("@/pages/legal-doc"));
const TrustHub = lazy(() => import("@/pages/trust"));
const TrustEvidence = lazy(() => import("@/pages/trust-evidence"));
const MasteryPage = lazy(() => import("@/pages/mastery"));
const UpgradePage = lazy(() => import("@/pages/upgrade"));
const CrisisReviewList = lazy(() => import("@/pages/admin/CrisisReviewList"));
const CrisisReviewDetail = lazy(
  () => import("@/pages/admin/CrisisReviewDetail"),
);

/**
 * @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"] | @implemented [2026-10-03]
 * plain English: the route Suspense fallback is the shared FullPageLoader. It serves every
 * audience (student, guardian, admin, marketing), none of which is themed yet, so it pins the
 * light token set. The `page-loader` test id and the "Loading..." text are kept: the guardian
 * e2e (tests/e2e/guardian-surfaces.spec.ts) waits on both.
 */
const ROUTE_FALLBACK = (
  <FullPageLoader themeLock="light" data-testid="page-loader" />
);

/** The route switch — exported so the guardian route walk (G4-01) renders the real table. */
export function Router() {
  // UI-41: the Focus shell's back arrow asks whether the entry behind is an in-app page.
  useInAppHistoryTracking();
  return (
    <Suspense fallback={ROUTE_FALLBACK}>
      <Switch>
        {/* Public routes */}
        <Route path="/" component={HomePage} />
        <Route path="/login" component={LoginRoute} />

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

        {/* Trust & Legal pages - public */}
        <Route path="/trust" component={TrustHub} />
        <Route path="/trust/evidence" component={TrustEvidence} />
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
              <StudentRouteFrame route="/dashboard">
                <LyceonDashboard />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/chat"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/chat">
                <Chat />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/practice"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/practice">
                <Practice />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/practice/topics"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/practice/topics">
                <BrowseTopics />
              </StudentRouteFrame>
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
              <StudentRouteFrame route="/practice/session/:sessionId">
                <ResumePractice />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Full-length exams (Doc 04A §16, Doc 04C §16.1) — E7b. */}
        <Route path="/tests" component={TestsHomeRoute} />
        <Route path="/tests/:sessionId/report" component={ExamReportRoute} />
        <Route
          path="/tests/:sessionId/:section/:module"
          component={ExamModuleRoute}
        />
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
              <StudentRouteFrame route="/score-report">
                <ScoreReport />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Doc 05F §17.1 — the student's own calendar. */}
        <Route
          path="/calendar"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/calendar">
                <Calendar />
              </StudentRouteFrame>
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
              <StudentRouteFrame route="/mastery">
                <MasteryPage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/upgrade"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/upgrade">
                <UpgradePage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Review vertical — the mistake queue. Same gate as practice. */}
        <Route
          path="/review"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/review">
                <Review />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/review/session/:sessionId"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/review/session/:sessionId">
                <ResumeReview />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Profile routes - allow all authenticated roles */}
        <Route
          path="/profile"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/profile">
                <ProfileRoute />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* UI-58 (OQ-46): the Help page; the rail, the avatar menu and the footer land here. */}
        <Route
          path="/help"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/help">
                <HelpPage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* G2-04: an under-13 student with no active guardian link lands here. */}
        <Route
          path="/guardian-required"
          component={() => (
            <RequireRole allow={["student"]}>
              <StudentRouteFrame route="/guardian-required">
                <GuardianRequired />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/profile/complete"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/profile/complete">
                <ProfileComplete />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/update-password"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/update-password">
                <UpdatePassword />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* §40.4 deletion recovery — public (token-gated, no session needed) */}
        <Route path="/account/recover" component={AccountRecoverRoute} />
        <Route
          path="/notifications"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/notifications">
                <NotificationsPage />
              </StudentRouteFrame>
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
        <Route component={NotFoundRoute} />
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
      // UI-41: the error screen is a Bare card (DESIGN.md §2). BareCard reads no context, so it
      // renders here, above every provider. Light-locked like every un-migrated surface.
      return (
        <BareCard themeLock="light">
          <div className="text-center">
            <h1 className="mb-4 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong">
              Something went wrong
            </h1>
            <p className="mb-6 text-lyc-body text-lyc-muted">
              An unexpected error occurred. Reloading the page usually fixes it.
            </p>
            <Button
              type="button"
              variant="lyc-primary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </div>
        </BareCard>
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
    // UI-41: the pending-deletion screen is a Bare card (DESIGN.md §2).
    return (
      <BareCard themeLock="light">
        <PendingDeletionScreen />
      </BareCard>
    );
  }
  return <>{children}</>;
}

/**
 * @spec [student-UI register UI-44; §2 Free versus paid; SCL-185; OQ-29; OQ-39(e); DESIGN.md §3]
 * | @implemented [2026-10-03]
 * plain English: the one upgrade modal, mounted once inside the query client so its denial
 * listener sees every query and mutation. It auto-opens on `entitlement_required` for a student
 * only: a guardian's per-student reads answer the same body, and this is the student's modal. A
 * display choice; the server decides every request.
 */
function StudentUpgradeModal({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  return (
    <UpgradeModalProvider autoOpenOnDenial={user?.role === "student"}>
      {children}
    </UpgradeModalProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SupabaseAuthProvider>
            <UIProvider>
              {/* F-65: the shell on screen publishes its theme lock here, above the upgrade
                  modal, so the modal's portal matches the page under it. */}
              <ActiveThemeLockProvider>
                <StudentUpgradeModal>
                  <DeletionGate>
                    <Router />
                  </DeletionGate>
                </StudentUpgradeModal>
              </ActiveThemeLockProvider>
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
