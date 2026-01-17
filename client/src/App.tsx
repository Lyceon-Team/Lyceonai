import { Component, ReactNode, Suspense, lazy } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { SupabaseAuthProvider } from "@/contexts/SupabaseAuthContext";
import { UIProvider } from "@/components/providers/ui-provider";
import "@/styles/tokens.css";
import "@/styles/accessibility.css";

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import { RequireRole } from "@/components/auth/RequireRole";
import { RoleRedirect } from "@/components/auth/RoleRedirect";

const LyceonDashboard = lazy(() => import("@/pages/lyceon-dashboard"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const Chat = lazy(() => import("@/pages/chat"));
const FullTest = lazy(() => import("@/pages/full-test"));
const Practice = lazy(() => import("@/pages/practice"));
const MathPractice = lazy(() => import("@/pages/math-practice"));
const ReadingWritingPractice = lazy(() => import("@/pages/reading-writing-practice"));
const RandomPractice = lazy(() => import("@/pages/random-practice"));
const FlowCards = lazy(() => import("@/pages/flow-cards"));
const StructuredPractice = lazy(() => import("@/pages/structured-practice"));
const ReviewErrors = lazy(() => import("@/pages/review-errors"));
const AdminPortal = lazy(() => import("@/pages/AdminPortal").then(m => ({ default: m.AdminPortal })));
const UserProfile = lazy(() => import("@/pages/UserProfile"));
const ProfileComplete = lazy(() => import("@/pages/profile-complete"));

const DigitalSAT = lazy(() => import("@/pages/digital-sat"));
const DigitalSATMath = lazy(() => import("@/pages/digital-sat-math"));
const DigitalSATReadingWriting = lazy(() => import("@/pages/digital-sat-reading-writing"));
const Blog = lazy(() => import("@/pages/blog"));
const BlogPost = lazy(() => import("@/pages/blog-post"));
const LegalHub = lazy(() => import("@/pages/legal"));
const LegalDoc = lazy(() => import("@/pages/legal-doc"));
const MasteryPage = lazy(() => import("@/pages/mastery"));
const GuardianDashboard = lazy(() => import("@/pages/guardian-dashboard"));
const GuardianCalendar = lazy(() => import("@/pages/guardian-calendar"));

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

function AuthenticatedRedirect() {
  return <RoleRedirect />;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path="/" component={HomePage} />
        <Route path="/login" component={Login} />
                
        {/* SEO Content Pages */}
        <Route path="/digital-sat" component={DigitalSAT} />
        <Route path="/digital-sat/math" component={DigitalSATMath} />
        <Route path="/digital-sat/reading-writing" component={DigitalSATReadingWriting} />
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />
        
        {/* Legal pages - public */}
        <Route path="/legal" component={LegalHub} />
        <Route path="/legal/:slug" component={LegalDoc} />
        
        {/* Legacy legal redirects */}
        <Route path="/privacy">{() => <Redirect to="/legal/privacy-policy" replace />}</Route>
        <Route path="/terms">{() => <Redirect to="/legal/student-terms" replace />}</Route>
        
        {/* Student-only routes - require student or admin role */}
        <Route path="/dashboard" component={() => <RequireRole allow={['student', 'admin']}><LyceonDashboard /></RequireRole>} />
        <Route path="/calendar" component={() => <RequireRole allow={['student', 'admin']}><CalendarPage /></RequireRole>} />
        <Route path="/chat" component={() => <RequireRole allow={['student', 'admin']}><Chat /></RequireRole>} />
        <Route path="/full-test" component={() => <RequireRole allow={['student', 'admin']}><FullTest /></RequireRole>} />
        <Route path="/practice" component={() => <RequireRole allow={['student', 'admin']}><Practice /></RequireRole>} />
        <Route path="/practice/math" component={() => <RequireRole allow={['student', 'admin']}><MathPractice /></RequireRole>} />
        <Route path="/practice/reading-writing" component={() => <RequireRole allow={['student', 'admin']}><ReadingWritingPractice /></RequireRole>} />
        <Route path="/practice/random" component={() => <RequireRole allow={['student', 'admin']}><RandomPractice /></RequireRole>} />
        <Route path="/math-practice" component={() => <RequireRole allow={['student', 'admin']}><MathPractice /></RequireRole>} />
        <Route path="/reading-writing-practice" component={() => <RequireRole allow={['student', 'admin']}><ReadingWritingPractice /></RequireRole>} />
        <Route path="/mastery" component={() => <RequireRole allow={['student', 'admin']}><MasteryPage /></RequireRole>} />
        <Route path="/review-errors" component={() => <RequireRole allow={['student', 'admin']}><ReviewErrors /></RequireRole>} />
        <Route path="/flow-cards" component={() => <RequireRole allow={['student', 'admin']}><FlowCards /></RequireRole>} />
        <Route path="/structured-practice" component={() => <RequireRole allow={['student', 'admin']}><StructuredPractice /></RequireRole>} />
        
        {/* Profile routes - allow all authenticated roles */}
        <Route path="/profile" component={() => <RequireRole allow={['student', 'guardian', 'admin']}><UserProfile /></RequireRole>} />
        <Route path="/profile/complete" component={() => <RequireRole allow={['student', 'guardian', 'admin']}><ProfileComplete /></RequireRole>} />
        
        {/* Guardian routes - require guardian or admin role */}
        <Route path="/guardian" component={() => <RequireRole allow={['guardian', 'admin']}><GuardianDashboard /></RequireRole>} />
        <Route path="/guardian/students/:studentId/calendar" component={() => <RequireRole allow={['guardian', 'admin']}><GuardianCalendar /></RequireRole>} />
        
        {/* Consolidated Admin route - AdminPortal already has AdminGuard internally */}
        <Route path="/admin" component={AdminPortal} />
        
        {/* Legacy admin routes - redirect to canonical /admin */}
        <Route path="/admin-dashboard">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-pdf-monitor">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-system-config">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-questions">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-review">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-ingest-jobs">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-portal">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-ingest">{() => <Redirect to="/admin" replace />}</Route>
        <Route path="/admin-review-v2">{() => <Redirect to="/admin" replace />}</Route>
        
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
              {this.state.error?.message || 'An unexpected error occurred'}
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

function App() {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SupabaseAuthProvider>
            <UIProvider>
              <Router />
            </UIProvider>
          </SupabaseAuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
