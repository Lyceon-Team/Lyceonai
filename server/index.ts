/**
 * Production Server - Express server for Supabase auth + RAG + Practice
 *
 * Replaces the legacy monolithic server (now in server/legacy-server.ts)
 * with a clean production-ready server focused on:
 *   - Supabase authentication (httpOnly cookies)
 *   - POST /api/rag/v2 (structured retrieval)
 *   - /api/tutor/* (tutor runtime)
 *   - Practice and tutoring endpoints
 *   - GET /healthz
 */

import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import { PUBLIC_SSR_ROUTES, getPublicPageSeo } from "./seo-content";
import { LEGAL_META, PUBLIC_META } from "../shared/seo/public-meta";
import rateLimit from "express-rate-limit";
// Canonical mounted owner: server/routes/tutor-* is the production owner.
// Any duplicate tutor route under apps/api/** must remain unmounted.
// Canonical RAG route owner is apps/api/src/routes/rag-v2.ts.
// Auth token resolution and enforcement stay in server/middleware/supabase-auth.ts.
import ragV2Router from "../apps/api/src/routes/rag-v2";
import tutorRuntimeRouter from "./routes/tutor-runtime";
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
} from "./routes/questions-runtime";
import { startReviewErrorSession, getReviewErrorSessionState, submitReviewSessionAnswer } from "./routes/review-session-routes";
import {
  supabaseAuthMiddleware,
  requireSupabaseAuth,
  requireSupabaseAdmin,
  requireStudentOrAdmin,
} from "./middleware/supabase-auth";
import { corsAllowlist } from "../apps/api/src/middleware/cors";
import { env, validateEnvironment } from "../apps/api/src/env";
import supabaseAuthRoutes from "./routes/supabase-auth-routes";
import notificationRoutes from "./routes/notification-routes";
import googleOAuthRoutes, { googleCallbackHandler } from "./routes/google-oauth-routes";
import { doubleCsrfProtection, generateToken } from "./middleware/csrf-double-submit";
import { weaknessRouter } from "./routes/legacy/weakness";
import { masteryRouter } from "./routes/legacy/mastery";
import { calendarRouter } from "./routes/legacy/calendar";
import { getScoreEstimate, getRecencyKpis } from "./routes/legacy/progress";
import guardianRoutes from "./routes/guardian-routes";
import billingRoutes from "./routes/billing-routes";
import accountRoutes from "./routes/account-routes";
import accountDeletionRoutes from "./routes/account-deletion-routes";
import healthRoutes from "./routes/health-routes";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import practiceCanonicalRouter from "./routes/practice-canonical";
import profileRoutes from "./routes/profile-routes";
import { getPracticeTopics, getPracticeQuestions } from "./routes/practice-topics-routes";
import guardianConsentRoutes from "./routes/guardian-consent-routes";
// ...existing code...
import { WebhookHandlers } from "./lib/webhookHandlers";
import { logger } from "./logger";


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

app.use(express.json({ limit: "1mb" }));
// Body parser error handling: keep parser failures explicit and non-500.
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err?.type === "entity.parse.failed" || (err instanceof SyntaxError && (err as any).status === 400)) {
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
app.get("/api/csrf-token", (req: Request, res: Response) => {
  const csrfToken = generateToken(req, res);
  return res.json({ csrfToken });
});

// Supabase auth middleware - extract JWT from cookies and set req.user
app.use(supabaseAuthMiddleware);

// Legal API (requires Supabase auth)
app.use("/api/legal", requireSupabaseAuth, doubleCsrfProtection, legalRouter);

// ============================================================================
// SEO: Server-side meta injection for legal pages
// ============================================================================

// Legal doc metadata registry (mirrors client/src/lib/legal.ts slugs)
// Canonical source-of-truth is shared/seo/public-meta.ts (LEGAL_META).

// Inject SEO meta tags into HTML template
function injectMeta(
  html: string,
  meta: {
    title: string;
    description: string;
    canonical: string;
    ogImage?: string;
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
  const ogImage = meta.ogImage || "https://lyceon.ai/og-image.jpg";
  const ogTags = `
    <meta property="og:title" content="${meta.title}">
    <meta property="og:description" content="${meta.description}">
    <meta property="og:url" content="${meta.canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Lyceon">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:image:alt" content="${meta.title}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${meta.title}">
    <meta name="twitter:description" content="${meta.description}">
    <meta name="twitter:image" content="${ogImage}">
  `;

  // Remove existing OG/Twitter tags and add new ones
  result = result.replace(
    /<meta\s+property="og:(title|description|url|type|image|image:alt|image:width|image:height|site_name)"\s+content="[^"]*"\s*\/?>/gi,
    ""
  );
  result = result.replace(/<meta\s+name="twitter:(card|title|description|image)"\s+content="[^"]*"\s*\/?>/gi, "");
  result = result.replace("</head>", `${ogTags}</head>`);

  return result;
}

function injectJsonLd(html: string, jsonLd: Record<string, unknown>[] | undefined): string {
  if (!jsonLd || jsonLd.length === 0) {
    let previousHtml: string;
    do {
      previousHtml = html;
      html = html.replace(
        /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi,
        ""
      );
    } while (html !== previousHtml);
    return html;
  }

  let previousHtml: string;
  do {
    previousHtml = html;
    html = html.replace(
      /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi,
      ""
    );
  } while (html !== previousHtml);

  let result = html;
  const jsonLdScripts = jsonLd
    .map((data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`)
    .join("\n");
  result = result.replace("</head>", `${jsonLdScripts}\n</head>`);
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

const googleOAuthCallbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OAuth callback requests" },
});

// RAG v2 endpoint - student-aware retrieval with structured context, cookie-only auth
app.use(
  "/api/rag/v2",
  ragLimiter,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  ragV2Router
);

// Canonical tutor runtime endpoints:
// POST /api/tutor/conversations
// POST /api/tutor/messages
// GET  /api/tutor/conversations/:conversationId
// GET  /api/tutor/conversations
// POST /api/tutor/conversations/:conversationId/close
app.use(
  "/api/tutor",
  ragLimiter,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  tutorRuntimeRouter
);

// Google OAuth Routes (direct OAuth flow)
app.use("/api/auth/google", googleOAuthRoutes);

// Google OAuth Callback (PUBLIC_SITE_URL/auth/google/callback)
app.get("/auth/google/callback", googleOAuthCallbackLimiter, googleCallbackHandler);
// Vercel callback alias when `/auth/google/callback` is rewritten into `/api/*`.
app.get("/api/auth/google/callback", googleOAuthCallbackLimiter, googleCallbackHandler);

// Supabase Authentication Routes
app.use("/api/auth", supabaseAuthRoutes);

// Guardian Consent Routes (Publicly accessible for verification)
app.use("/api/consent", doubleCsrfProtection, guardianConsentRoutes);

// Profile endpoints - requires authentication
// GET /api/profile - canonical hydration route
// PATCH /api/profile - profile completion/update route
app.use("/api/profile", requireSupabaseAuth, doubleCsrfProtection, profileRoutes);

// Notifications Routes
app.use("/api/notifications", requireSupabaseAuth, doubleCsrfProtection, notificationRoutes);

// Weakness & Mastery Routes (student weakness tracking)
app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, weaknessRouter);
// Diagnostic runtime removed: keep the path terminally unavailable (404) before mastery auth mount.
app.use("/api/me/mastery/diagnostic", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, masteryRouter);
app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, calendarRouter);

// Score Projection endpoint (College Board weighted algorithm)
app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreEstimate);

// Recency KPIs endpoint (last 200 attempts stats)
app.get("/api/progress/kpis", requireSupabaseAuth, requireStudentOrAdmin, getRecencyKpis);
// Minimal guarded admin auth contract for regression invariants.
app.get("/api/admin/db-health", requireSupabaseAuth, requireSupabaseAdmin, async (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    status: "healthy",
    service: "database",
  });
});
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

// SECURE: Single question endpoint - never leaks answers
app.get("/api/questions/:id", requireSupabaseAuth, requireStudentOrAdmin, getQuestionById);

// Review errors endpoint - authenticated students can review their failed attempts
app.get(
  "/api/review-errors",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getReviewErrors
);

// Review errors attempt endpoint - records student attempts during error review
app.post(
  "/api/review-errors/sessions",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  startReviewErrorSession
);
app.get(
  "/api/review-errors/sessions/:sessionId/state",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  getReviewErrorSessionState
);
app.post(
  "/api/review-errors/attempt",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  submitReviewSessionAnswer
);

// Answer validation endpoint (questionId passed in request body for flexibility)

// Question feedback endpoint (thumbs up/down)
app.post("/api/questions/feedback", requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, submitQuestionFeedback);

// Guardian Routes (requires Supabase auth + guardian role)
app.use("/api/guardian", requireSupabaseAuth, doubleCsrfProtection, guardianRoutes);

// Billing Routes (for parent subscription payments)
app.use("/api/billing", billingRoutes);

// Account Routes (bootstrap, status, deletion)
app.use("/api/account", accountRoutes);
app.use("/api/account", accountDeletionRoutes);

// Health Routes (schema and credential verification)
app.use("/api/health", healthRoutes);

// Practice reference routes (bootstrap/filtering only; not runtime delivery)
app.get("/api/practice/topics", requireSupabaseAuth, requireStudentOrAdmin, getPracticeTopics);
app.get("/api/practice/reference/questions", requireSupabaseAuth, requireStudentOrAdmin, getPracticeQuestions);

// Practice Canonical Routes (unified practice API)
// CSRF protection is applied at the mount (GET/HEAD/OPTIONS are ignored by middleware).
// Usage limit is applied inside the router: increment only on GET /next, not on answer submission
app.use(
  "/api/practice",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  practiceCanonicalRouter
);

// Full-Length Exam Routes (Bluebook-style SAT exams)
// All routes require Supabase auth and are student-only
app.use(
  "/api/full-length",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  fullLengthExamRouter
);

// Debug route to identify server version and routes in prod
app.get("/api/_whoami", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({
    service: "lyceon-api",
    env: process.env.NODE_ENV || "development",
    version: "1.0.0",
    routes: ["rag/v2", "tutor/conversations", "tutor/messages"],
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
  const publicMeta = PUBLIC_META[routePath];

  let html = getIndexHtml();
  html = injectMeta(html, {
    title: seo.title,
    description: seo.description,
    canonical: seo.canonical,
    ogImage: publicMeta?.ogImage,
  });
  html = injectJsonLd(html, publicMeta?.jsonLd);
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
  const meta = LEGAL_META[slug];
  if (!meta) return next();

  const canonical = meta.canonical;
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
    ogImage: meta.ogImage,
  });
  html = injectJsonLd(html, undefined);
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

  const csrfError =
    err?.code === "EBADCSRFTOKEN" ||
    err?.name === "CSRFError" ||
    (typeof err?.message === "string" && err.message.toLowerCase().includes("csrf"));

  if (csrfError) {
    return res.status(403).json({
      error: {
        code: "csrf_blocked",
        message: "Request blocked by CSRF protection",
      },
      requestId,
    });
  }

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
    "CSRF_SECRET",
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
    console.log(`  POST   /api/rag/v2 (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/conversations (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/messages (requires Supabase auth)`);
    console.log(`  GET    /api/tutor/conversations/:conversationId (requires Supabase auth)`);
    console.log(`  GET    /api/tutor/conversations (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/conversations/:conversationId/close (requires Supabase auth)`);
    console.log(`\n🔐 Supabase Authentication (Google OAuth via Supabase):`);
    console.log(`  POST   /api/auth/signup`);
    console.log(`  POST   /api/auth/signin`);
    console.log(`  POST   /api/auth/signout`);
    console.log(`\n❓ Questions API (requires Supabase auth):`);
    console.log(`  GET    /api/questions`);
    console.log(`  GET    /api/questions/recent`);
    console.log(`  GET    /api/questions/random`);
    console.log(`  POST   /api/questions/feedback`);
    console.log(`\n📚 Practice (requires Supabase auth):`);
    console.log(`  POST   /api/practice/sessions`);
    console.log(`  POST   /api/practice/sessions/:sessionId/terminate`);
    console.log(`  GET    /api/practice/sessions/:sessionId/next`);
    console.log(`  GET    /api/practice/sessions/:sessionId/state`);
    console.log(`  POST   /api/practice/answer`);
    console.log(`  GET    /api/practice/reference/questions`);
    console.log(`\n🔔 Notifications (requires Supabase auth):`);
    console.log(`  GET    /api/notifications`);
    console.log(`  GET    /api/notifications/unread-count`);
    console.log(`  PATCH  /api/notifications/:id/read`);
    console.log(`  PATCH  /api/notifications/mark-all-read`);
    console.log(`\n📝 Full-Length SAT Exam (requires Supabase auth):`);
    console.log(`  POST   /api/full-length/sessions`);
    console.log(`  GET    /api/full-length/sessions`);
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
