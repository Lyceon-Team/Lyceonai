/**
 * Production Server - Express server for Supabase auth + RAG + Practice
 *
 * Replaces the legacy monolithic server (now in server/legacy-server.ts)
 * with a clean production-ready server focused on:
 *   - Supabase authentication (httpOnly cookies)
 *   - POST /api/rag (authenticated users)
 *   - Practice and tutoring endpoints
 *   - GET /healthz
 */

import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import { PUBLIC_SSR_ROUTES, getPublicPageSeo } from "./seo-content";
import rateLimit from "express-rate-limit";
// SECURITY GUARD: apps/api imports are allowed ONLY for shared libraries (e.g., supabase-server, embeddings, etc.).
// apps/api MUST NOT be mounted for user-facing routes:
//   - /api/tutor/v2
//   - auth token resolution / requireSupabaseAuth
import { rag } from "./routes/legacy/rag";
import ragV2Router from "./routes/legacy/rag-v2";
import tutorV2Router from "./routes/tutor-v2";
import { legalRouter } from "./routes/legal-routes.js";
import fullLengthExamRouter from "./routes/full-length-exam-routes";
import {
  getQuestions,
  getRandomQuestions,
  getQuestionCount,
  getQuestionStats,
  getQuestionsFeed,
  getRecentQuestions,
  getQuestionById,
  getReviewErrors,
  submitQuestionFeedback,
} from "./routes/legacy/questions";
import { searchQuestions } from "./routes/legacy/search";
import { recordReviewErrorAttempt } from "./routes/review-errors-routes";
import {
  supabaseAuthMiddleware,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  requireRequestUser,
} from "./middleware/supabase-auth";
import { corsAllowlist } from "../apps/api/src/middleware/cors";
import { env, validateEnvironment } from "../apps/api/src/env";
import supabaseAuthRoutes from "./routes/supabase-auth-routes";
import notificationRoutes from "./routes/notification-routes";
import googleOAuthRoutes, { googleCallbackHandler } from "./routes/google-oauth-routes";
import { csrfGuard } from "./middleware/csrf";
import { weaknessRouter } from "./routes/legacy/weakness";
import { masteryRouter } from "./routes/legacy/mastery";
import { diagnosticRouter } from "./routes/legacy/diagnostic";
import { calendarRouter } from "./routes/legacy/calendar";
import { getScoreProjection, getRecencyKpis } from "./routes/legacy/progress";
import guardianRoutes from "./routes/guardian-routes";
import billingRoutes from "./routes/billing-routes";
import accountRoutes from "./routes/account-routes";
import healthRoutes from "./routes/health-routes";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import practiceCanonicalRouter from "./routes/practice-canonical";
import profileRoutes from "./routes/profile-routes";
import { getPracticeTopics, getPracticeQuestions } from "./routes/practice-topics-routes";
// ...existing code...
import { WebhookHandlers } from "./lib/webhookHandlers";
import { checkAiChatLimit } from "./middleware/usage-limits";
import { logger } from "./logger";

// CSRF protection middleware - uses shared origin-utils for single source of truth
const csrfProtection = csrfGuard();

const app = express();
app.disable("x-powered-by");

// Trust proxy headers (required for Replit infrastructure and rate limiting)
// Set to 1 to trust the first proxy layer (Replit's infrastructure)
app.set("trust proxy", 1);

// Request ID middleware - must be first to track all requests
app.use(requestIdMiddleware);
app.use(securityHeadersMiddleware());

// Core middleware
app.use(corsAllowlist());
app.use(cookieParser());

// Stripe webhook route MUST be registered BEFORE express.json()
// Webhook needs raw Buffer, not parsed JSON
// CSRF_EXEMPT_REASON: Webhook uses Stripe signature verification instead of CSRF
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId;
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      console.error("[WEBHOOK] Missing stripe-signature header", { requestId });
      return res.status(400).json({ error: "Missing stripe-signature", requestId });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error("[WEBHOOK] req.body is not a Buffer - check middleware order", { requestId });
        return res.status(500).json({ error: "Webhook body not a Buffer", requestId });
      }

      const result = await WebhookHandlers.processWebhook(req.body as Buffer, sig, requestId);
      res.status(200).json({ received: true, eventId: result.eventId, status: result.status, requestId });
    } catch (error: any) {
      console.error("[WEBHOOK] Processing error:", error.message, { requestId });
      res.status(400).json({
        error: "Webhook processing error",
        message: error.message?.includes("signature") ? "Signature verification failed" : "Processing failed",
        requestId,
      });
    }
  }
);

app.use(express.json({ limit: "50mb" }));

// Supabase auth middleware - extract JWT from cookies and set req.user
app.use(supabaseAuthMiddleware);

// Legal API (requires Supabase auth)
app.use("/api/legal", requireSupabaseAuth, legalRouter);

// ============================================================================
// SEO: Server-side meta injection for legal pages
// ============================================================================

// Legal doc metadata registry (mirrors client/src/lib/legal.ts slugs)
const legalSeoMeta: Record<string, { title: string; description: string }> = {
  "privacy-policy": {
    title: "Privacy Policy",
    description: "How Lyceon collects, uses, stores, shares, and protects your information.",
  },
  "student-terms": {
    title: "Student Terms of Use",
    description: "The terms that govern your access to and use of the Lyceon platform.",
  },
  "honor-code": {
    title: "Honor Code",
    description: "Our commitment to honest learning and academic integrity at Lyceon.",
  },
  "community-guidelines": {
    title: "Community Guidelines",
    description: "How users are expected to behave when using Lyceon.",
  },
  "parent-guardian-terms": {
    title: "Parent / Guardian Terms",
    description: "Terms for parents and guardians whose children use Lyceon.",
  },
  "trust-and-safety": {
    title: "Trust & Safety",
    description: "How Lyceon approaches trust, safety, and responsible technology in learning.",
  },
};

// Inject SEO meta tags into HTML template
function injectMeta(
  html: string,
  meta: {
    title: string;
    description: string;
    canonical: string;
  }
): string {
  let result = html;

  // Replace <title>...</title>
  result = result.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);

  // Replace or insert meta description
  if (result.includes('name="description"')) {
    result = result.replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${meta.description}">`
    );
  } else {
    result = result.replace("</head>", `<meta name="description" content="${meta.description}">\n</head>`);
  }

  // Insert canonical link
  if (result.includes('rel="canonical"')) {
    result = result.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${meta.canonical}">`
    );
  } else {
    result = result.replace("</head>", `<link rel="canonical" href="${meta.canonical}">\n</head>`);
  }

  // Insert/replace OpenGraph tags
  const ogTags = `
    <meta property="og:title" content="${meta.title}">
    <meta property="og:description" content="${meta.description}">
    <meta property="og:url" content="${meta.canonical}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${meta.title}">
    <meta name="twitter:description" content="${meta.description}">
  `;

  // Remove existing OG/Twitter tags and add new ones
  result = result.replace(/<meta\s+property="og:(title|description|url|type)"\s+content="[^"]*"\s*\/?>/gi, "");
  result = result.replace(/<meta\s+name="twitter:(card|title|description)"\s+content="[^"]*"\s*\/?>/gi, "");
  result = result.replace("</head>", `${ogTags}</head>`);

  return result;
}

// Inject visible body content into the root div for SSR/SEO
function injectBodyContent(html: string, content: string): string {
  // Replace empty <div id="root"></div> with content inside
  // Content will be replaced by React hydration
  return html.replace(/<div\s+id="root">\s*<\/div>/i, `<div id="root">${content}</div>`);
}

// SEO 301 redirects for legacy URLs (GET + HEAD)
app.all("/privacy", (_req, res) => res.redirect(301, "/legal/privacy-policy"));
app.all("/terms", (_req, res) => res.redirect(301, "/legal/student-terms"));

// Health checks
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" })); // Legacy alias

const ragLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: "Too many RAG requests" },
});

// RAG endpoint - accepts EITHER Bearer token OR Supabase auth
// CSRF protection applied for cookie-based auth (Bearer tokens are self-contained)
// RAG endpoint - cookie-only auth, no Bearer allowed
app.post(
  "/api/rag",
  ragLimiter,
  csrfProtection,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  rag
);

// RAG v2 endpoint - student-aware retrieval with structured context, cookie-only auth
app.use(
  "/api/rag/v2",
  ragLimiter,
  csrfProtection,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  ragV2Router
);

// Tutor v2 endpoint - AI tutoring with RAG v2 + student profiles
app.use("/api/tutor/v2", ragLimiter, requireSupabaseAuth, requireStudentOrAdmin, checkAiChatLimit({ incrementStrategy: "on_success" }), tutorV2Router);

// Google OAuth Routes (direct OAuth flow)
app.use("/api/auth/google", googleOAuthRoutes);

// Google OAuth Callback (PUBLIC_SITE_URL/auth/google/callback)
app.get("/auth/google/callback", googleCallbackHandler);

// Supabase Authentication Routes
app.use("/api/auth", supabaseAuthRoutes);

// Profile endpoints - requires authentication
// GET /api/profile - Get current user profile
// PATCH /api/profile - Complete/update user profile
app.get("/api/profile", requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    // Return complete user profile with all fields needed by frontend
    // This matches the structure of /api/auth/user for compatibility
    const fallbackUsername = user.email ? user.email.split('@')[0] : null;
    const normalizedName = user.display_name || fallbackUsername || 'Student';

    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        name: normalizedName,
        username: fallbackUsername,
        role: user.role,
        isAdmin: user.isAdmin,
        isGuardian: user.isGuardian,
        is_under_13: user.is_under_13,
        guardian_consent: user.guardian_consent,
        studentLinkCode: user.student_link_code,
        profileCompletedAt: (user as any).profile_completed_at || null,
      }
    });
  } catch (error) {
    console.error('[PROFILE] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.use("/api/profile", requireSupabaseAuth, profileRoutes);

// Notifications Routes
app.use("/api/notifications", notificationRoutes);

// Weakness & Mastery Routes (student weakness tracking)
app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter);
app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
app.use("/api/me/mastery/diagnostic", requireSupabaseAuth, requireStudentOrAdmin, diagnosticRouter);
app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);

// Score Projection endpoint (College Board weighted algorithm)
app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreProjection);

// Recency KPIs endpoint (last 200 attempts stats)
app.get("/api/progress/kpis", requireSupabaseAuth, requireStudentOrAdmin, getRecencyKpis);
// Questions API Routes (Supabase-authenticated, student/admin only)
// Wrap getQuestions to match frontend format expectations
app.get("/api/questions", requireSupabaseAuth, requireStudentOrAdmin, async (req, res) => {
  const originalJson = res.json.bind(res);
  res.json = function (data: any) {
    if (Array.isArray(data)) {
      return originalJson.call(res, { questions: data, meta: { total: data.length } });
    }
    return originalJson.call(res, data);
  };
  return getQuestions(req, res);
});

app.get("/api/questions/recent", async (req, res) => {
  // Allow anonymous access to recent questions for public preview
  const originalJson = res.json.bind(res);
  res.json = function (data: any) {
    if (Array.isArray(data)) {
      return originalJson.call(res, { questions: data, meta: { total: data.length } });
    }
    return originalJson.call(res, data);
  };
  return getRecentQuestions(req, res);
});

app.get("/api/questions/random", requireSupabaseAuth, requireStudentOrAdmin, async (req, res) => {
  const originalJson = res.json.bind(res);
  res.json = function (data: any) {
    if (Array.isArray(data)) {
      return originalJson.call(res, { questions: data, meta: { total: data.length } });
    }
    return originalJson.call(res, data);
  };
  return getRandomQuestions(req, res);
});

app.get("/api/questions/count", requireSupabaseAuth, requireStudentOrAdmin, getQuestionCount);
app.get("/api/questions/stats", requireSupabaseAuth, requireStudentOrAdmin, getQuestionStats);
app.get("/api/questions/feed", requireSupabaseAuth, requireStudentOrAdmin, getQuestionsFeed);

// Search endpoint - allow anonymous access for public search
app.get("/api/questions/search", searchQuestions);

// SECURE: Single question endpoint - never leaks answers
app.get("/api/questions/:id", requireSupabaseAuth, requireStudentOrAdmin, getQuestionById);

// Review errors endpoint - authenticated students can review their failed attempts
app.get("/api/review-errors", requireSupabaseAuth, requireStudentOrAdmin, getReviewErrors);

// Review errors attempt endpoint - records student attempts during error review
app.post("/api/review-errors/attempt", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, recordReviewErrorAttempt);

// Answer validation endpoint (questionId passed in request body for flexibility)

// Question feedback endpoint (thumbs up/down)
app.post("/api/questions/feedback", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, submitQuestionFeedback);

// Guardian Routes (requires Supabase auth + guardian role)
app.use("/api/guardian", guardianRoutes);

// Billing Routes (for parent subscription payments)
app.use("/api/billing", billingRoutes);

// Account Routes (bootstrap, status)
app.use("/api/account", accountRoutes);

// Health Routes (schema and credential verification)
app.use("/api/health", healthRoutes);

// Practice Topics Routes (for browsing and filtering)
app.get("/api/practice/topics", requireSupabaseAuth, requireStudentOrAdmin, getPracticeTopics);
app.get("/api/practice/questions", requireSupabaseAuth, requireStudentOrAdmin, getPracticeQuestions);

// Practice Canonical Routes (unified practice API)
// CSRF protection is applied inside the router for POST routes only (GET /next doesn't need CSRF)
// Usage limit is applied inside the router: increment only on GET /next, not on answer submission
app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, practiceCanonicalRouter);

// Full-Length Exam Routes (Bluebook-style SAT exams)
// All routes require Supabase auth and are student-only
app.use("/api/full-length", requireSupabaseAuth, requireStudentOrAdmin, fullLengthExamRouter);

// Debug route to identify server version and routes in prod
app.get("/api/_whoami", (_req, res) => {
  res.json({
    service: "lyceon-api",
    env: process.env.NODE_ENV || "development",
    version: "1.0.0",
    routes: ["rag/v2", "tutor/v2"],
    timestamp: new Date().toISOString(),
  });
});

// Serve static frontend files in production
const staticPath = path.join(process.cwd(), "dist", "public");

// Cache the index.html template for SEO injection
let indexHtmlCache = "";
function getIndexHtml(): string {
  // In development, always read fresh (for hot reload support)
  // In production, cache for performance
  if (!indexHtmlCache || process.env.NODE_ENV !== "production") {
    try {
      const filePath = path.join(staticPath, "index.html");
      if (fs.existsSync(filePath)) {
        indexHtmlCache = fs.readFileSync(filePath, "utf-8");
      } else {
        // Fallback for development before build
        indexHtmlCache = '<!DOCTYPE html><html lang="en"><head><title>Lyceon</title></head><body><div id="root"></div></body></html>';
      }
    } catch {
      indexHtmlCache = '<!DOCTYPE html><html lang="en"><head><title>Lyceon</title></head><body><div id="root"></div></body></html>';
    }
  }
  return indexHtmlCache;
}

// SSR: Unified handler for all public pages (SEO-crawlable content)
// Injects both meta tags and body content for public routes
function servePublicSsr(routePath: string, res: Response): boolean {
  const seo = getPublicPageSeo(routePath);
  if (!seo) return false;

  let html = getIndexHtml();
  html = injectMeta(html, {
    title: seo.title,
    description: seo.description,
    canonical: seo.canonical,
  });
  html = injectBodyContent(html, seo.bodyHtml);
  res.type("html").send(html);
  return true;
}

// Register all public SSR routes before static middleware
for (const routePath of Object.keys(PUBLIC_SSR_ROUTES)) {
  app.get(routePath, (_req, res) => {
    servePublicSsr(routePath, res);
  });
}


// SSR metadata fallback for public legal docs not explicitly listed in PUBLIC_SSR_ROUTES.
// Keeps sitemap legal slugs indexable with canonical title/description metadata.
app.get("/legal/:slug", (req, res, next) => {
  const slug = String(req.params.slug || "");
  const meta = legalSeoMeta[slug];
  if (!meta) return next();

  const canonical = `https://lyceon.ai/legal/${slug}`;
  const bodyHtml = `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 1.5rem;">
      <nav style="margin-bottom: 0.75rem;"><a href="/legal" style="color: #0F2E48;">← Back to Legal</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 0.5rem; color: #0F2E48;">${meta.title}</h1>
      <p style="color: #555; line-height: 1.6;">${meta.description}</p>
    </header>
    <section style="line-height: 1.8; color: #333;">
      <p>This page is publicly available at <code>/legal/${slug}</code>.</p>
      <p>Use the legal hub for complete policy navigation and PDF links.</p>
      <p><a href="/legal" style="color: #0F2E48;">Open Legal Hub</a></p>
    </section>
  </article>
</main>`;

  let html = getIndexHtml();
  html = injectMeta(html, {
    title: `${meta.title} | Lyceon`,
    description: meta.description,
    canonical,
  });
  html = injectBodyContent(html, bodyHtml);
  res.type("html").send(html);
});
app.use(express.static(staticPath));

// SPA fallback - serve index.html for all non-API routes
// Private routes (dashboard, practice, etc.) get plain SPA shell
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(staticPath, "index.html"));
});


// Final error boundary for uncaught route errors
app.use((err: any, req: Request, res: Response, next: any) => {
  const requestId = (req as any).requestId || logger.generateRequestId();

  logger.error(
    'HTTP',
    'unhandled_error',
    `Unhandled error in ${req.method} ${req.path}`,
    err,
    {
      method: req.method,
      path: req.path,
      statusCode: err?.status || 500,
      hasBody: req.body !== undefined && req.body !== null,
      hasCookieHeader: !!req.headers.cookie,
      hasAuthorizationHeader: !!req.headers.authorization,
    },
    {
      requestId,
      userId: req.user?.id,
      ip: req.ip,
    }
  );

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err?.status || 500).json({
    error: 'Internal server error',
    requestId,
  });
});
// Production environment validation (warn but don't crash)
const PORT = parseInt(process.env.PORT || "5000", 10);
if (process.env.NODE_ENV === "production") {
  const criticalEnvVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "GEMINI_API_KEY",
  ];

  const missingVars = criticalEnvVars.filter((k) => !(env as any)[k]);
  if (missingVars.length > 0) {
    console.error(`[WARN] Missing env vars: ${missingVars.join(", ")} - some features may not work`);
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
    logger.error("PROCESS", "uncaught_exception", "Uncaught exception", err, { fatal: true });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("PROCESS", "unhandled_rejection", "Unhandled promise rejection", reason, { fatal: false });
  });

  // Validate environment variables on startup
  validateEnvironment();

  // Validate PUBLIC_SITE_URL at startup (critical for OAuth)
  function validateSiteUrl(): void {
    const publicSiteUrl = process.env.PUBLIC_SITE_URL;
    const isProduction = process.env.NODE_ENV === "production";

    if (!publicSiteUrl) {
      if (isProduction) {
        console.error("❌ [FATAL] PUBLIC_SITE_URL is not set. OAuth will fail in production.");
        console.error("   Set PUBLIC_SITE_URL=https://lyceon.ai in your environment.");
        process.exit(1);
      } else {
        console.warn("⚠️ [WARN] PUBLIC_SITE_URL is not set. OAuth may fail.");
        console.warn("   For development, set PUBLIC_SITE_URL or use REPLIT_DEV_DOMAIN fallback.");
      }
      return;
    }

    if (publicSiteUrl.endsWith("/")) {
      console.warn("⚠️ [WARN] PUBLIC_SITE_URL has trailing slash, this may cause redirect issues.");
    }

    if (!publicSiteUrl.startsWith("https://") && isProduction) {
      console.error("❌ [FATAL] PUBLIC_SITE_URL must use HTTPS in production.");
      process.exit(1);
    }

    const normalizedUrl = publicSiteUrl.replace(/\/$/, "").toLowerCase();
    if (isProduction && !normalizedUrl.includes("lyceon.ai")) {
      console.warn("⚠️ [WARN] PUBLIC_SITE_URL does not contain lyceon.ai - verify this is intentional.");
    }

    console.log(`✅ [AUTH] PUBLIC_SITE_URL: ${publicSiteUrl}`);
    console.log(`✅ [AUTH] OAuth callback: ${publicSiteUrl.replace(/\/$/, "")}/auth/google/callback`);
  }

  validateSiteUrl();

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
    console.log(`  POST   /api/rag (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/v2 (AI tutoring with RAG v2)`);
    console.log(`\n🔐 Supabase Authentication (Google OAuth via Supabase):`);
    console.log(`  POST   /api/auth/signup`);
    console.log(`  POST   /api/auth/signin`);
    console.log(`  POST   /api/auth/signout`);
    console.log(`  GET    /api/auth/user`);
    console.log(`\n❓ Questions API (requires Supabase auth):`);
    console.log(`  GET    /api/questions`);
    console.log(`  GET    /api/questions/recent`);
    console.log(`  GET    /api/questions/random`);
    console.log(`  POST   /api/questions/feedback`);
    console.log(`\n📚 Practice (requires Supabase auth):`);
    console.log(`  GET    /api/practice/next`);
    console.log(`  POST   /api/practice/answer`);
    console.log(`\n🔔 Notifications (requires Supabase auth):`);
    console.log(`  GET    /api/notifications`);
    console.log(`  GET    /api/notifications/unread-count`);
    console.log(`  PATCH  /api/notifications/:id/read`);
    console.log(`  PATCH  /api/notifications/mark-all-read`);
    console.log(`\n📝 Full-Length SAT Exam (requires Supabase auth):`);
    console.log(`  POST   /api/full-length/sessions`);
    console.log(`  GET    /api/full-length/sessions/current`);
    console.log(`  POST   /api/full-length/sessions/:sessionId/start`);
    console.log(`  POST   /api/full-length/sessions/:sessionId/answer`);
    console.log(`  POST   /api/full-length/sessions/:sessionId/module/submit`);
    console.log(`  POST   /api/full-length/sessions/:sessionId/break/continue`);
    console.log(`  POST   /api/full-length/sessions/:sessionId/complete`);
    console.log(`  GET    /api/full-length/sessions/:sessionId/report`);
    console.log(`  GET    /api/full-length/sessions/:sessionId/review`);
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

