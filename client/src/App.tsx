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
import { Analytics } from "@vercel/analytics/react";
import "@/styles/tokens.css";
import "@/styles/accessibility.css";

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import { RequireRole } from "@/components/auth/RequireRole";
import UpdatePassword from "@/pages/update-password";

const AccountRecover = lazy(() => import("@/pages/account-recover"));

const LyceonDashboard = lazy(() => import("@/pages/lyceon-dashboard"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const Chat = lazy(() => import("@/pages/chat"));
const FullTest = lazy(() => import("@/pages/full-test"));
const Practice = lazy(() => import("@/pages/practice"));
const BrowseTopics = lazy(() => import("@/pages/browse-topics"));
const ReviewErrors = lazy(() => import("@/pages/review-errors"));
const ResumePractice = lazy(() => import("@/pages/resume-practice"));
const UserProfile = lazy(() => import("@/pages/UserProfile"));
const ProfileComplete = lazy(() => import("@/pages/profile-complete"));

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
const TutorPage = lazy(() => import("@/pages/tutor"));
const MasteryPage = lazy(() => import("@/pages/mastery"));
const UpgradePage = lazy(() => import("@/pages/upgrade"));
const GuardianDashboard = lazy(() => import("@/pages/guardian-dashboard"));
const GuardianCalendar = lazy(() => import("@/pages/guardian-calendar"));
const GuardianConsentVerify = lazy(
  () => import("@/pages/guardian-consent-verify"),
);

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    </div>
  );
}

function Router() {
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

        {/* Trust & Legal pages - public */}
        <Route path="/trust" component={TrustHub} />
        <Route path="/trust/evidence" component={TrustEvidence} />
        <Route path="/tutor" component={TutorPage} />
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
          path="/calendar"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <CalendarPage />
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
          path="/full-test"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <FullTest />
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
        <Route
          path="/review-errors"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <ReviewErrors />
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
        <Route path="/reset-password" component={UpdatePassword} />
        {/* §40.4 deletion recovery — public (token-gated, no session needed) */}
        <Route path="/account/recover" component={AccountRecover} />

        {/* Guardian routes - require guardian or admin role */}
        <Route
          path="/guardian/verify-consent"
          component={GuardianConsentVerify}
        />
        <Route
          path="/guardian"
          component={() => (
            <RequireRole allow={["guardian", "admin"]}>
              <GuardianDashboard />
            </RequireRole>
          )}
        />
        <Route
          path="/guardian/students/:studentId/calendar"
          component={() => (
            <RequireRole allow={["guardian", "admin"]}>
              <GuardianCalendar />
            </RequireRole>
          )}
        />

        {/* 404 */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("App Error:", error, errorInfo);
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
              {this.state.error?.message || "An unexpected error occurred"}
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
    return <PendingDeletionScreen />;
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
      <Analytics />
    </ErrorBoundary>
  );
}

export default App;
