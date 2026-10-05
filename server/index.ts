/**
 * Production Server - Express server for Supabase auth + Practice + Tutor
 *
 * Replaces the legacy monolithic server (now in server/legacy-server.ts)
 * with a clean production-ready server focused on:
 *   - Supabase authentication (httpOnly cookies)
 *   - /api/tutor/* (tutor runtime)
 *   - Practice and tutoring endpoints
 *   - GET /healthz
 */

import express, { Request, Response } from "express";
import path from "path";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
// Canonical mounted owner: server/routes/tutor-* is the production owner.
// Any duplicate tutor route under apps/api/** must remain unmounted.
// Auth token resolution and enforcement stay in server/middleware/supabase-auth.ts.
import tutorRuntimeRouter from "./routes/tutor-runtime";
import { TutorConfig } from "./services/tutor-config";
import { legalRouter } from "./routes/legal-routes.js";
import { getQuestionStats } from "./routes/questions-runtime";
import {
  supabaseAuthMiddleware,
  enforceDeletionLock,
  requireSupabaseAuth,
  requireSupabaseAdmin,
  requireStudentOrAdmin,
  requireStudentOnly,
  requireStudentAccount,
  requireGuardianLinkForUnder13,
  hasSsrSessionCookie,
} from "./middleware/supabase-auth";
import { csrfTokenResponseSchema } from "../packages/shared/src/csrf-token-schema";
import { corsAllowlist } from "../apps/api/src/middleware/cors";
import { env, validateEnvironment } from "../apps/api/src/env";
import {
  evaluateSiteUrl,
  isProductionDeployment,
  reportGcpCredentialStatusAtStartup,
} from "./lib/startup-guards";
import supabaseAuthRoutes from "./routes/supabase-auth-routes";
import oauthCallbackRoutes, {
  nativeOAuthCallbackHandler,
} from "./routes/oauth-callback-routes";
import {
  doubleCsrfProtection,
  generateToken,
} from "./middleware/csrf-double-submit";
import { getScoreEstimate, getRecencyKpis } from "./routes/legacy/progress";
import guardianRoutes from "./routes/guardian-routes";
import studentResourceRoutes from "./routes/student-resources";
import { calendarRouter } from "./routes/calendar-routes";
import { scoreReportRouter } from "./routes/score-report-routes";
import billingRoutes from "./routes/billing-routes";
import accountRoutes from "./routes/account-routes";
import accountDeletionRoutes from "./routes/account-deletion-routes";
import publicPricingRoutes from "./routes/public-pricing-routes";
import publicQotdRoutes from "./routes/public-qotd-routes";
import cookieConsentRoutes from "./routes/cookie-consent-routes";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { apiCacheControlDefault } from "./middleware/api-cache-control";
import practiceCanonicalRouter from "./routes/practice-canonical";
import reviewCanonicalRouter from "./routes/review-canonical";
import examRuntimeRouter from "./routes/exam-runtime-routes";
import examReportRouter from "./routes/exam-report-routes";
import diagnosticRouter from "./routes/diagnostic-routes";
import profileRoutes from "./routes/profile-routes";
import productFeedbackRoutes from "./routes/product-feedback-routes";
import {
  referenceSearchRouter,
  studentBackgroundRouter,
} from "./routes/student-background-routes";
import internalCronRoutes from "./routes/internal-cron-routes";
import internalMemoryRoutes from "./routes/internal-memory-routes";
import internalRetentionRoutes from "./routes/internal-retention-routes";
import {
  getPracticeTopics,
  getPracticeQuestions,
} from "./routes/practice-topics-routes";
// ...existing code...
import { processStripeWebhook } from "./lib/stripe/webhook-handler";
import { STRIPE_WEBHOOK_PATH } from "./lib/stripe/webhook-path";
import { resendWebhookHandler } from "./routes/resend-webhook";
import notificationsRouter from "./routes/notifications";
import {
  NOTIFICATION_API_MOUNT,
  RESEND_WEBHOOK_PATH,
} from "../packages/shared/src/notifications-schema";
import { adminCrisisReviewRouter } from "./routes/admin-crisis-review";
import { logger } from "./logger";
import { finalErrorHandler } from "./middleware/final-error-handler";

const app = express();
app.disable("x-powered-by");

// Trust proxy headers (required for Replit infrastructure and rate limiting)
// Set to 1 to trust the first proxy layer (Replit's infrastructure)
app.set("trust proxy", 1);

// Request ID middleware - must be first to track all requests
app.use(requestIdMiddleware);
app.use(securityHeadersMiddleware());
// F-27: every /api response is private, no-store unless its route sets a listed public header.
app.use("/api", apiCacheControlDefault);

// Core middleware
app.use(corsAllowlist());
// codeql[js/missing-token-validation]: false positive. CSRF *is* enforced — via the custom
// double-submit middleware `doubleCsrfProtection` (csrf-csrf + Origin allowlist, see
// ./middleware/csrf-double-submit), which CodeQL's default model does not recognize (it matches
// only app-level `csurf`). Every browser-facing mutating route applies it: app-level POSTs each
// pair with doubleCsrfProtection (grep `doubleCsrfProtection` in this file), every mutating
// router is mounted with it (or applies it per-route, e.g. /api/auth, /api/billing, /api/account),
// and there are zero app-level PUT/PATCH/DELETE handlers. The only CSRF-less mutating route is the
// Stripe webhook (above), which is Stripe-signature-verified (CSRF_EXEMPT_REASON). Default-setup
// CodeQL does not honor inline suppressions — dismiss this alert in the GitHub Security UI.
app.use(cookieParser());

// Stripe webhook route MUST be registered BEFORE express.json()
// Webhook needs raw Buffer, not parsed JSON
// CSRF_EXEMPT_REASON: Webhook uses Stripe signature verification instead of CSRF
app.post(
  STRIPE_WEBHOOK_PATH,
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const rawSignature = req.headers["stripe-signature"];
    const signature = Array.isArray(rawSignature)
      ? rawSignature[0]
      : rawSignature;

    try {
      const outcome = await processStripeWebhook(
        req.body,
        signature,
        requestId,
      );

      if (!outcome.ok) {
        // Signature failure and livemode mismatch are both 400: Stripe should not
        // retry an event this environment will never accept.
        return res.status(400).json({
          error: "Webhook rejected",
          reason: outcome.reason,
          requestId,
        });
      }

      return res.status(200).json({
        received: true,
        eventId: outcome.eventId,
        status: outcome.status,
        requestId,
      });
    } catch (err: unknown) {
      // Handler failure. The idempotency gate has been released, so Stripe's
      // retry can reprocess. 500 asks Stripe to retry; 400 would not.
      logger.error("STRIPE_WEBHOOK", "unhandled", "Webhook processing threw", {
        requestId,
        message: err instanceof Error ? err.message : "unknown",
      });
      return res
        .status(500)
        .json({ error: "Webhook processing failed", requestId });
    }
  },
);

// Resend webhook — raw Buffer, Svix-signature-verified, registered BEFORE express.json()
// (contracts/notifications.contract.md §7.1). Written fresh; not a copy of the Stripe handler.
// CSRF_EXEMPT_REASON: Webhook uses Svix signature verification instead of CSRF
app.post(
  RESEND_WEBHOOK_PATH,
  express.raw({ type: "application/json" }),
  resendWebhookHandler,
);

app.use(express.json({ limit: "1mb" }));
// Body parser error handling: keep parser failures explicit and non-500.
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (
    err?.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && (err as any).status === 400)
  ) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  return next(err);
});

// Global rate limiter to protect downstream authorization and business logic.
// This limits the rate at which requests can reach supabaseAuthMiddleware and other routes.
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(globalRateLimiter);

// CSRF token bootstrap endpoint (stateless double-submit cookie).
// CSRF_EXEMPT_REASON: GET-only endpoint to issue a CSRF token + cookie.
// @spec [SEO plan F8] | @implemented [2026-10-05] | plain English: the response also says whether
// a session cookie came with the request, so a visitor with no session never sends the profile
// read that would answer 401. A hint only: `hasSsrSessionCookie` checks presence, not validity.
app.get("/api/csrf-token", (req: Request, res: Response) => {
  const csrfToken = generateToken(req, res);
  return res.json(
    csrfTokenResponseSchema.parse({
      csrfToken,
      sessionCookiePresent: hasSsrSessionCookie(req),
    }),
  );
});

// Supabase auth middleware - extract JWT from cookies and set req.user
app.use(supabaseAuthMiddleware);

// @spec [Doc-01_V8 §40.3] Account-deletion lock — the ONE structural enforcement point. Mounted here
// (after req.user is set, before every API router) so deleted/pending-deletion users are default-denied
// across requireSupabaseAuth AND requireRequestUser routes alike. Flag-gated => dormant pass-through
// until activation.
app.use(enforceDeletionLock);

// Legal API (requires Supabase auth)
app.use("/api/legal", requireSupabaseAuth, doubleCsrfProtection, legalRouter);

// Health checks
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" })); // Legacy alias

const tutorLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: "Too many tutor requests" },
});

const googleOAuthCallbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OAuth callback requests" },
});

// @spec [Doc-03A_V3.0 §18.7; owner ruling 2026-09-24 (W4-3)] | @implemented [2026-09-24]
// Tutor runtime config is read from tutor_context_runtime_config ONCE per
// process, starting at module load — on Vercel the app module is the boot
// (app.listen below never runs there). Until this was wired, every key served
// its hardcoded default on every request. The two routers that read config
// wait for the load to settle (bounded at 3s) so a cold-start request cannot
// race it. A failed load logs ERROR boot_load_failed and serves defaults.
const TUTOR_CONFIG_BOOT_WAIT_MS = 3_000;
void TutorConfig.bootLoad();
const awaitTutorConfig: express.RequestHandler = (_req, _res, next) => {
  TutorConfig.whenBooted(TUTOR_CONFIG_BOOT_WAIT_MS).then(() => next(), next);
};

// Canonical tutor runtime endpoints:
// POST /api/tutor/conversations
// POST /api/tutor/messages
// GET  /api/tutor/conversations/:conversationId
// GET  /api/tutor/conversations
// POST /api/tutor/conversations/:conversationId/close
// @spec [Doc-03B_V2 §3.1; Karl ruling 2026-08-05 #1] student-only gate for LISA.
app.use(
  "/api/tutor",
  tutorLimiter,
  requireSupabaseAuth,
  requireStudentOnly,
  doubleCsrfProtection,
  awaitTutorConfig,
  tutorRuntimeRouter,
);

// Native Supabase OAuth landing route (PKCE).
// Supabase owns the Google OAuth callback at <ref>.supabase.co/auth/v1/callback; the browser is
// redirected back to PUBLIC_SITE_URL/auth/callback, where we exchange the PKCE code for a session.
app.use("/auth", googleOAuthCallbackLimiter, oauthCallbackRoutes);
// Vercel alias when `/auth/callback` is rewritten into `/api/*`.
app.get(
  "/api/auth/callback",
  googleOAuthCallbackLimiter,
  nativeOAuthCallbackHandler,
);

// Supabase Authentication Routes
app.use("/api/auth", supabaseAuthRoutes);

// Internal cron-only endpoints (CRON_SECRET-gated; e.g. scheduled legal-acceptance outbox drain).
app.use("/api/internal", internalCronRoutes);
// Internal memory routes (OIDC-gated; Cloud Tasks compaction writeback per Doc 03C §8.3).
app.use("/api/internal", awaitTutorConfig, internalMemoryRoutes);
// Internal retention sweep (OIDC-gated; Cloud Scheduler per-tier jobs per Doc 03 §14.2).
app.use("/api/internal", internalRetentionRoutes);

// Guardian Consent Routes (Publicly accessible for verification)

// SCL-195 / Brief 8 ruling 1. Settings → Profile background. Mounted BEFORE /api/profile so the
// more specific path is matched here. Student-only (`requireStudentAccount`: guardians and admins
// refused, then the live under-13 link gate) and deliberately NO entitlement check — this is the
// student's own optional profile, not a paid feature. Settings and the calendar's dream-school
// picker share this one write path.
app.use(
  "/api/profile/background",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentAccount,
  studentBackgroundRouter,
);

// Brief 8 ruling 3. College and high-school search for the background pickers, rate-limited per
// profile through the ledger's `reference_search` bucket. The ruling says "authenticated"; it is
// mounted for STUDENT accounts (`requireStudentAccount`, which ends in the live under-13 link
// gate) because the pickers exist only on student surfaces and the G1-11 guardian sweep admits a
// guardian-reachable prefix only as a deliberate statement that guardians belong on it — none do
// here. Recorded in register row UI-S3.
app.use(
  "/api/reference",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentAccount,
  referenceSearchRouter,
);

// Profile endpoints - requires authentication
// GET /api/profile - canonical hydration route
// PATCH /api/profile - profile completion/update route
app.use(
  "/api/profile",
  requireSupabaseAuth,
  doubleCsrfProtection,
  profileRoutes,
);

// SEO Wave 2, plan Q6 (R28-R30). The review prompt, in-app reviews and private feedback, for
// students and guardians alike (each route reads the caller's role and age from their profile).
// G2-04: not in the owner-approved allowed set, so an under-13 student with no active guardian
// link is refused here like on every other student surface; guardians and 13+ pass.
app.use(
  "/api/feedback",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireGuardianLinkForUnder13,
  productFeedbackRoutes,
);

// Notifications feed (contracts/notifications.contract.md §3, §9.4). Recipient = session
// principal; every read/write is a recipient-scoped SQL function.
app.use(
  NOTIFICATION_API_MOUNT,
  requireSupabaseAuth,
  doubleCsrfProtection,
  notificationsRouter,
);

// Subject-scoped resources (Doc 05B §10.3 / Doc 05C §10.2). ONE route per resource, served
// to the student and to a linked guardian by the same handler; `resolveSubject` inside the
// router turns the principal into the subject and is the only role-aware branch in the
// stack. Deliberately NOT behind `requireStudentOrAdmin`: a guardian is a legitimate caller
// here, and the resolver — not a role gate — decides whether this caller may see this
// student.
app.use(
  "/api/students",
  requireSupabaseAuth,
  doubleCsrfProtection,
  studentResourceRoutes,
);

// Doc 05F §15. The student's own calendar surface. `requireStudentOrAdmin` because every
// route here is the student acting on their OWN plan — a guardian is view-only (§16) and
// reads through /api/students/:studentId/calendar, which is role-blind by construction.
// The calendar_access entitlement check is inside the handlers, applied to the subject, so
// a 402 carries the shared CTA payload rather than a bare middleware denial.
app.use(
  "/api/calendar",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentOrAdmin,
  calendarRouter,
);

// Doc 05F §15's standalone streak route is retired (SCL-212, owner ruling 2026-10-05, OQ-61 (a)):
// no client called it. The streak reaches its surfaces inside the calendar payloads and
// `kpi/overall`, each read through `server/services/activity-streak.ts`.

// SCL-191. The post-exam score report and retake answer. `requireStudentOrAdmin` because every
// route is the student answering about their OWN sitting and their OWN subscription; a paying
// guardian has no write route here and acts in the Customer Portal instead (Doc 01 §928). There
// is deliberately NO entitlement middleware: the authorisation is the prompt we sent, checked in
// the service, so a caller cannot answer an occasion we never raised — see the router's header.
app.use(
  "/api/score-report",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentOrAdmin,
  scoreReportRouter,
);
// Score Projection endpoint (College Board weighted algorithm)
app.get(
  "/api/progress/projection",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getScoreEstimate,
);

// Recency KPIs endpoint (last 200 attempts stats)
app.get(
  "/api/progress/kpis",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getRecencyKpis,
);
// Minimal guarded admin auth contract for regression invariants.
app.get(
  "/api/admin/db-health",
  requireSupabaseAuth,
  requireSupabaseAdmin,
  async (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      status: "healthy",
      service: "database",
    });
  },
);
// Admin crisis review surface — SEPARATE from /api/tutor/* per SCL-025.
// §3.1 stands unchanged (student-only on /api/tutor/*). This is a different
// authorization axis per SCL-025: scoped to crisis_flagged conversations, every
// read audit-logged. NOT read-only: POST /cases/:id/claim and
// POST /cases/:id/disposition change case state, so the router is mounted with
// doubleCsrfProtection like every other browser-facing mutating router (see the
// CSRF note at the top of this file). GETs are ignored by the middleware. The
// admin pages already send the token (apiRequest → csrfFetch).
// @spec [Doc-03_V3 §21.3, SCL-025; closure plan W2-9] | @implemented [2026-09-24]
app.use(
  "/api/admin/crisis-review",
  doubleCsrfProtection,
  adminCrisisReviewRouter,
);

// Questions API: only the stats route survives. The list, recent, random, count, feed, :id
// and feedback routes were deleted as unused (student-ui register UI-05, 2026-09-29).
app.get(
  "/api/questions/stats",
  requireSupabaseAuth,
  requireSupabaseAdmin,
  getQuestionStats,
);

// Guardian Routes (requires Supabase auth + guardian role)
app.use(
  "/api/guardian",
  requireSupabaseAuth,
  doubleCsrfProtection,
  guardianRoutes,
);

// Public Pricing Route (UNAUTHENTICATED BY DESIGN — the first /api/public/* mount)
//
// @spec [Doc 09 §1.4, §5.1 Stripe canonical for pricing at runtime]
// @implemented [2026-09-03]
//
// The homepage is served to logged-out visitors and quotes a price, so it needs
// one it did not invent. `/api/billing/plans` stays behind `requireSupabaseAuth`
// (billing-routes.ts:973-974) rather than being exempted for a marketing page;
// this route returns the monthly amount, currency and interval and nothing that
// describes the billing configuration. Mounted with NO auth and NO CSRF: it is
// a GET that reads no session and writes nothing. `globalRateLimiter` above
// still applies (1000/IP/15min), but that bounds one caller, not distributed
// load; the module's 15-minute memo is what bounds calls to Stripe itself.
app.use("/api/public", publicPricingRoutes);

// Public Question of the Day (UNAUTHENTICATED BY DESIGN — SEO Wave 2, plan R16-R19, Q2).
// No auth and no CSRF: nothing reads `req.user` and no ambient credential is used; the one write
// (POST /today/answer) is gated by Cloudflare Turnstile and the SCL-202 hashed-IP ledger, and
// the reads are hashed-IP limited too. See server/routes/public-qotd-routes.ts.
// CSRF_EXEMPT_REASON: no ambient credential is read; the submit is Turnstile-gated (owner Step 0 decision, 2026-10-05).
app.use("/api/public/qotd", publicQotdRoutes);

// Cookie consent log (UNAUTHENTICATED BY DESIGN — SEO F11, Doc 10 §9.11). Records each banner or
// Settings choice: random consent id, analytics yes/no, banner version, source. No auth and no
// CSRF: it reads no cookie or session; the SCL-202 hashed-IP ledger bounds it.
// CSRF_EXEMPT_REASON: no ambient credential is read; rate-limited on the anonymous ledger (owner Step 0 decision, 2026-10-05).
app.use("/api/public/cookie-consent", cookieConsentRoutes);

// Billing Routes (for parent subscription payments)
app.use("/api/billing", billingRoutes);

// Account Routes (bootstrap, status, deletion)
app.use("/api/account", accountRoutes);
app.use("/api/account", accountDeletionRoutes);

// Practice reference routes (bootstrap/filtering only; not runtime delivery)
app.get(
  "/api/practice/topics",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getPracticeTopics,
);
app.get(
  "/api/practice/reference/questions",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getPracticeQuestions,
);

// Diagnostic Routes (Vertical B — 40-question initial diagnostic)
// Mounted at /api/practice/diagnostic BEFORE the practice canonical router so Express
// matches the more-specific path first. Same auth + CSRF middleware stack as practice.
app.use(
  "/api/practice/diagnostic",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  diagnosticRouter,
);

// Practice Canonical Routes (unified practice API)
// CSRF protection is applied at the mount (GET/HEAD/OPTIONS are ignored by middleware).
// Usage limit is applied inside the router: increment only on GET /next, not on answer submission
app.use(
  "/api/practice",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  practiceCanonicalRouter,
);

// Full-length exam runtime (Doc 04A §16 student surface only — no admin routes)
// @spec [Doc-04A_V2.2 §16, §16.1; E6] | @implemented [2026-09-24]
// Practice's middleware stack: auth, student-or-admin, then CSRF (the middleware
// ignores GET/HEAD/OPTIONS). Entitlement (exam_full_length) is step 2 of every
// handler, inside the router, after auth.
app.use(
  "/api/tests",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  examRuntimeRouter,
);

// Full-length exam score report (Doc 04C §16.1 student reads only) and, since OQ-30
// (owner ruling 2026-10-02), the student's scored-sessions list (§16.3,
// GET /api/tests/sessions?state=scored; entitlement-first, as the runtime).
// @spec [Doc-04C_V1.0 §16.1, §16.3, §16.5; E7a; OQ-30] | @implemented [2026-09-25; 2026-10-03]
// Same stack as the runtime. Ownership is decided before entitlement inside the
// router (04C §16.5): a lapsed entitlement on an OWNED session is a 200
// `unavailable` payload, a missing or foreign session a bare 403.
app.use(
  "/api/tests",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  examReportRouter,
);

// Review Canonical Routes (the mistake queue — practice's loop, a different pool)
// @spec [Doc-02B_V4 §16; ruled plan §2; brief R3 §2.2] | @implemented [2026-09-21]
// The middleware stack is practice's, identically: auth, student-or-admin, then CSRF
// (the middleware ignores GET/HEAD/OPTIONS, so it covers exactly the writes). There is
// deliberately NO entitlement gate and NO usage-limit call — review is free and
// unlimited (ruled plan ruling 10). The concurrent-session cap inside the router is a
// resource guard, not a quota.
app.use(
  "/api/review",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  reviewCanonicalRouter,
);

// Serve static frontend files in production
const staticPath = path.join(process.cwd(), "dist", "public");

app.use(express.static(staticPath));

// @spec [Coding Standards §8.2, §8.3; student-ui register F-42, owner ruling 2026-10-01] |
// @implemented [2026-10-01] | plain English: any `/api` request that no route answered gets the
// API's JSON 404, whatever the method. It used to be answered only for GET (inside the SPA
// fallback below); a POST, PUT, PATCH or DELETE fell through to Express's default HTML
// `Cannot POST …` page, so a client parsing JSON got HTML (seen in production 2026-10-01). The
// body is unchanged from the GET one, which tests and callers already read.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F4] | @implemented [2026-10-03] |
// plain English: the public pages are static files now — prerendered at build into dist/public
// (scripts/build/prerender.mjs) and served by express.static above, as Vercel's filesystem
// handler serves them in production. The Express "SSR" path that used to inject meta here never
// ran on Vercel (vercel.json sends only /api and /auth/callback to this function) and is gone.
// Every other route gets the SPA shell, app.html, which carries noindex.
app.get("*", (_req, res) => {
  res.sendFile(path.join(staticPath, "app.html"));
});

// Final error boundary for uncaught route errors (G-NEW-12: extracted, and its CSRF 403 now logs
// its code before it answers; see server/middleware/final-error-handler.ts).
app.use(finalErrorHandler);
// Production environment validation (warn but don't crash)
const PORT = parseInt(process.env.PORT || "5000", 10);
if (process.env.NODE_ENV === "production") {
  const criticalEnvVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "GEMINI_API_KEY",
    "CSRF_SECRET",
  ];

  const missingVars = criticalEnvVars.filter((k) => !(env as any)[k]);
  if (missingVars.length > 0) {
    console.error(
      `[WARN] Missing env vars: ${missingVars.join(", ")} - some features may not work`,
    );
  }
}

// Check if this module is the main entry point
// Works with both tsx (dev) and esbuild bundled output (prod)
const isMainModule = (() => {
  try {
    // For ESM: check import.meta.url against process.argv[1]
    const fileUrl = new URL(import.meta.url);
    const argvUrl = new URL(`file://${process.argv[1]}`);
    // Compare pathnames to handle both .ts and .js extensions
    const filePath = fileUrl.pathname.replace(/\.(ts|js)$/, "");
    const argvPath = argvUrl.pathname.replace(/\.(ts|js)$/, "");
    return (
      filePath === argvPath ||
      (filePath.endsWith("/index") && argvPath.endsWith("/index")) ||
      fileUrl.pathname.includes("dist/index")
    );
  } catch {
    return true; // Default to starting if URL parsing fails
  }
})();

// Start server if run directly or as bundled entry
if (isMainModule) {
  // Global error handlers to prevent crashes before port binding
  // NOTE: These are only set up when running as main module, not during tests
  process.on("uncaughtException", (err) => {
    logger.error("PROCESS", "uncaught_exception", "Uncaught exception", err, {
      fatal: true,
    });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(
      "PROCESS",
      "unhandled_rejection",
      "Unhandled promise rejection",
      reason,
      { fatal: false },
    );
  });

  // Validate environment variables on startup
  validateEnvironment();

  // Report GCP credential availability. Does NOT gate boot.
  //
  // This used to `process.exit(1)` when GCP_SERVICE_ACCOUNT_JSON was absent
  // under NODE_ENV=production. Vercel sets NODE_ENV=production for previews
  // too, so the process died before any route mounted and EVERY api route on
  // EVERY preview deployment returned 500 FUNCTION_INVOCATION_FAILED.
  //
  // The credential is subsystem-scoped — LISA's crisis classifier and the
  // BigQuery retention archive, nothing else — so its absence is reported and
  // the two call sites fail at use. See server/lib/startup-guards.ts for the
  // build-mode vs deployment-target distinction that both guards turned on.
  reportGcpCredentialStatusAtStartup();

  // Validate PUBLIC_SITE_URL at startup (critical for OAuth).
  //
  // STILL FATAL, BUT ONLY WHERE THE REQUIREMENT IS REAL. OAuth genuinely
  // cannot build a callback without this, so unlike the GCP credential above
  // it is whole-app and the guard stays. What changed is the question it
  // asks: `isProductionDeployment()` reads VERCEL_ENV (the deployment target)
  // rather than NODE_ENV (the build mode), so a Vercel preview — which never
  // carries a production site URL and has no business being held to one —
  // warns instead of dying. The decision lives in `evaluateSiteUrl`; the
  // `process.exit` stays here, at the composition root.
  const siteUrlVerdict = evaluateSiteUrl({
    publicSiteUrl: process.env.PUBLIC_SITE_URL,
    isProductionDeployment: isProductionDeployment(),
  });
  if (siteUrlVerdict.kind === "fatal") {
    for (const line of siteUrlVerdict.lines) console.error(line);
    process.exit(1);
  }
  // Warning lines keep their stream: the previous inline version emitted them
  // via console.warn, and a startup warning demoted to stdout is a startup
  // warning nobody greps for.
  for (const line of siteUrlVerdict.lines) {
    if (line.startsWith("⚠️")) console.warn(line);
    else console.log(line);
  }

  console.log(`[API] Starting Lyceon API server...`);
  console.log(`[API] NODE_ENV: ${process.env.NODE_ENV || "development"}`);
  console.log(`[API] Binding to 0.0.0.0:${PORT}`);

  // Initialize Stripe before starting server (non-blocking)
  // TODO: Restore when initStripe is implemented
  // initStripe().catch((err) => console.error("[STRIPE] Init error:", err.message));

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
    console.log(`\n📋 Core API endpoints:`);
    console.log(`  GET    /healthz`);
    console.log(`  POST   /api/tutor/conversations (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/messages (requires Supabase auth)`);
    console.log(
      `  GET    /api/tutor/conversations/:conversationId (requires Supabase auth)`,
    );
    console.log(`  GET    /api/tutor/conversations (requires Supabase auth)`);
    console.log(
      `  POST   /api/tutor/conversations/:conversationId/close (requires Supabase auth)`,
    );
    console.log(`\n🔐 Supabase Authentication (Google OAuth via Supabase):`);
    console.log(`  POST   /api/auth/signup`);
    console.log(`  POST   /api/auth/signin`);
    console.log(`  POST   /api/auth/signout`);
    console.log(`\n📚 Practice (requires Supabase auth):`);
    console.log(`  POST   /api/practice/sessions`);
    console.log(`  POST   /api/practice/sessions/:sessionId/terminate`);
    console.log(`  GET    /api/practice/sessions/:sessionId/next`);
    console.log(`  GET    /api/practice/sessions/:sessionId/state`);
    console.log(`  POST   /api/practice/answer`);
    console.log(`  GET    /api/practice/reference/questions`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[API] SIGTERM received. Shutting down.");
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("[API] SIGINT received. Shutting down.");
    server.close(() => process.exit(0));
  });
}

export default app;
