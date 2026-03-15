/**
 * MVP Server - Minimal Express server for Bearer auth + Ingest + RAG
 *
 * Replaces the legacy monolithic server (now in server/legacy-server.ts)
 * with a clean MVP focused on:
 *   - Simple Bearer token authentication
 *   - POST /api/ingest (admin token required)
 *   - POST /api/rag (user token required)
 *   - GET /healthz
 */

import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import { PUBLIC_SSR_ROUTES, getPublicPageSeo } from "./seo-content";
import rateLimit from "express-rate-limit";
<<<<<<< HEAD
// SECURITY GUARD: /api/tutor/v2 remains server-owned in server/routes/tutor-v2.ts.
// Canonical RAG route owners are apps/api/src/routes/rag.ts and apps/api/src/routes/rag-v2.ts.
// Auth token resolution and enforcement stay in server/middleware/supabase-auth.ts.
=======
// SECURITY GUARD: apps/api imports are allowed ONLY for shared libraries (e.g., supabase-server, ingestion, embeddings, etc.).
// apps/api MUST NOT be mounted for user-facing routes:
//   - /api/questions/validate
//   - /api/tutor/v2
//   - auth token resolution / requireSupabaseAuth
// ...removed ingest import...
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
import { rag } from "../apps/api/src/routes/rag";
import ragV2Router from "../apps/api/src/routes/rag-v2";
import tutorV2Router from "./routes/tutor-v2";
// ...removed ingest-llm imports...
import { legalRouter } from "./routes/legal-routes.js";
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
<<<<<<< HEAD
} from "./routes/questions-runtime";
import { searchQuestions } from "./routes/search-runtime";
import { startReviewErrorSession, getReviewErrorSessionState, submitReviewSessionAnswer } from "./routes/review-session-routes";
=======
} from "../apps/api/src/routes/questions";
import { validateAnswer } from "./routes/questions-validate";
import {
  getNeedsReview,
  approveQuestion,
  rejectQuestion,
  getParsingStatistics,
} from "./admin-review-routes";
import { analyzeQuestion } from "./routes/student-routes";
import { requireBearer } from "../apps/api/src/middleware/bearer-auth";
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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
import { csrfGuard } from "./middleware/csrf";
<<<<<<< HEAD
import { weaknessRouter } from "./routes/legacy/weakness";
import { masteryRouter } from "./routes/legacy/mastery";
import { diagnosticRouter } from "./routes/legacy/diagnostic";
import { calendarRouter } from "./routes/legacy/calendar";
import { getScoreProjection, getRecencyKpis } from "./routes/legacy/progress";
=======
import { testSupabaseHttpConnection, supabaseServer } from "../apps/api/src/lib/supabase-server";
// ...removed ingestion-v4 imports...
import { weaknessRouter } from "../apps/api/src/routes/weakness";
import { masteryRouter } from "../apps/api/src/routes/mastery";
import { calendarRouter } from "../apps/api/src/routes/calendar";
import { getScoreProjection, getRecencyKpis } from "../apps/api/src/routes/progress";
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
import guardianRoutes from "./routes/guardian-routes";
import billingRoutes from "./routes/billing-routes";
import accountRoutes from "./routes/account-routes";
import healthRoutes from "./routes/health-routes";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import practiceCanonicalRouter from "./routes/practice-canonical";
// ...existing code...
import { WebhookHandlers } from "./lib/webhookHandlers";
import { checkAiChatLimit } from "./middleware/usage-limits";
import { logger } from "./logger";

// CSRF protection middleware - uses shared origin-utils for single source of truth
const csrfProtection = csrfGuard();

// Validate environment variables on startup
validateEnvironment();

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

// ...removed /debug/env/ingest route...

// ...removed ingestLimiter...

const ragLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: "Too many RAG requests" },
});

const studentUploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many upload requests. Please wait a moment before trying again." },
});

// ...removed /api/ingest endpoint...

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

// Tutor v2 endpoint - Lisa tutoring with canonical RAG context
app.use("/api/tutor/v2", ragLimiter, requireSupabaseAuth, requireStudentOrAdmin, checkAiChatLimit({ incrementStrategy: "on_success" }), tutorV2Router);

// ...removed /api/ingestion-v4 route...

// ...removed all /api/ingest-v2/* deprecated endpoints...

// ...removed requireIngestAdmin middleware...

// ...removed all /api/ingest-llm/* and /api/ingest/jobs endpoints...

// Google OAuth Routes (direct OAuth flow)
app.use("/api/auth/google", googleOAuthRoutes);

// Google OAuth Callback (PUBLIC_SITE_URL/auth/google/callback)
app.get("/auth/google/callback", googleCallbackHandler);

// Supabase Authentication Routes
app.use("/api/auth", supabaseAuthRoutes);

<<<<<<< HEAD
// Profile endpoints - requires authentication
// GET /api/profile - canonical hydration route
// PATCH /api/profile - profile completion/update route
app.use("/api/profile", requireSupabaseAuth, profileRoutes);

=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
// Notifications Routes
app.use("/api/notifications", notificationRoutes);

// Weakness & Mastery Routes (student weakness tracking)
app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter);
app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);

// Score Projection endpoint (College Board weighted algorithm)
app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreProjection);

// Recency KPIs endpoint (last 200 attempts stats)
app.get("/api/progress/kpis", requireSupabaseAuth, requireStudentOrAdmin, getRecencyKpis);
<<<<<<< HEAD
// Minimal guarded admin auth contract for regression invariants.
app.get("/api/admin/db-health", requireSupabaseAuth, requireSupabaseAdmin, async (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    status: "healthy",
    service: "database",
  });
=======

// Admin Stats Routes
app.use("/api/admin", adminStatsRoutes);

// Admin Proof Routes - "No More Lying" layer for verification
// Enforce cookie-admin only for admin-proof routes
app.use(
  "/api/admin/proof",
  requireSupabaseAuth,
  requireSupabaseAdmin,
  adminProofRoutes
);

// ...removed /api/admin/ingest-summary endpoint...

// Admin DB Health Check (requires Supabase admin)
app.get("/api/admin/db-health", requireSupabaseAdmin, async (_req, res) => {
  try {
    const ok = await testSupabaseHttpConnection();

    if (ok) return res.json({ ok: true });

    return res.status(500).json({
      ok: false,
      error: "DB health check failed",
    });
  } catch (err: any) {
    console.error("[DB-HEALTH] Supabase HTTP connection error:", err);

    return res.status(500).json({
      ok: false,
      error: "DB health check failed",
      detail: err?.message ?? "Unknown error",
    });
  }
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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

app.get("/api/questions/recent", requireSupabaseAuth, requireStudentOrAdmin, async (req, res) => {
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
app.get("/api/review-errors", requireSupabaseAuth, requireStudentOrAdmin, getReviewErrors);

<<<<<<< HEAD
// Review errors attempt endpoint - records student attempts during error review
app.post("/api/review-errors/sessions", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, startReviewErrorSession);
app.get("/api/review-errors/sessions/:sessionId/state", requireSupabaseAuth, requireStudentOrAdmin, getReviewErrorSessionState);
app.post("/api/review-errors/attempt", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, submitReviewSessionAnswer);
=======
// Review errors attempt stub endpoint (prevents 404 from frontend POST calls)
app.post("/api/review-errors/attempt", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, (_req, res) => {
  res.json({ ok: true });
});
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

// Answer validation endpoint (questionId passed in request body for flexibility)

// Question feedback endpoint (thumbs up/down)
app.post("/api/questions/feedback", csrfProtection, requireSupabaseAuth, requireStudentOrAdmin, submitQuestionFeedback);

<<<<<<< HEAD
=======
// Admin Review Routes (with CSRF protection for state-changing operations)
app.get("/api/admin/questions/needs-review", requireSupabaseAdmin, getNeedsReview);
app.get("/api/admin/questions/statistics", requireSupabaseAdmin, getParsingStatistics);
app.post("/api/admin/questions/:id/approve", csrfProtection, requireSupabaseAdmin, approveQuestion);
app.post("/api/admin/questions/:id/reject", csrfProtection, requireSupabaseAdmin, rejectQuestion);

// Task B: Admin-only Supabase debug endpoint to verify ingestion target
app.get("/api/admin/supabase-debug", requireSupabaseAdmin, async (_req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const url = supabaseUrl ? new URL(supabaseUrl) : null;

    const { count, error: countErr } = await supabaseServer.from("questions").select("id", { count: "exact", head: true });

    if (countErr) {
      console.error("[ADMIN] supabase-debug count error:", countErr.message);
      return res.status(500).json({ error: "Failed to count questions", detail: countErr.message });
    }

    const { data: latest, error: latestErr } = await supabaseServer.from("questions").select("created_at").order("created_at", { ascending: false }).limit(1);

    if (latestErr) {
      console.error("[ADMIN] supabase-debug latest error:", latestErr.message);
    }

    res.json({
      supabaseUrlHost: url?.hostname || "unknown",
      projectRef: url?.hostname?.split(".")[0] || "unknown",
      questionsCount: count ?? 0,
      latestQuestionCreatedAt: (latest as any)?.[0]?.created_at ?? null,
    });
  } catch (error: any) {
    console.error("[ADMIN] supabase-debug exception:", error.message);
    res.status(500).json({ error: "Internal error", detail: error.message });
  }
});

// Student Routes (requires Supabase auth + CSRF protection)
app.post(
  "/api/student/analyze-question",
  csrfProtection,
  studentUploadLimiter,
  requireSupabaseAuth,
  requireStudentOrAdmin,
  ...(analyzeQuestion as any)
);

>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
// Guardian Routes (requires Supabase auth + guardian role)
app.use("/api/guardian", guardianRoutes);

// Billing Routes (for parent subscription payments)
app.use("/api/billing", billingRoutes);

// Account Routes (bootstrap, status)
app.use("/api/account", accountRoutes);

// Health Routes (schema and credential verification)
app.use("/api/health", healthRoutes);

// Practice Canonical Routes (unified practice API)
// CSRF protection is applied inside the router for POST routes only (GET /next doesn't need CSRF)
// Usage limit is applied inside the router: increment only on GET /next, not on answer submission
app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, practiceCanonicalRouter);

// Debug route to identify server version and routes in prod
app.get("/api/_whoami", (_req, res) => {
  res.json({
    service: "lyceon-api",
    env: process.env.NODE_ENV || "development",
    version: "1.0.0",
<<<<<<< HEAD
    routes: ["rag/v2", "tutor/v2"],
=======
    routes: ["rag/v2", "tutor/v2", "ingest", "ingest-v2/upload", "ingest-v2/jobs", "ingest-v2/status/:jobId", "admin/ingest-summary", "admin/db-health"],
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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
    "INGEST_ADMIN_TOKEN",
    "API_USER_TOKEN",
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

<<<<<<< HEAD
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
=======
// Global error handlers to prevent crashes before port binding
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", (err as any)?.message);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

// Initialize Stripe schema and sync data
async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[STRIPE] No DATABASE_URL - skipping Stripe initialization");
    return;
  }

  try {
    console.log("[STRIPE] Initializing schema...");
    await runMigrations({ databaseUrl });
    console.log("[STRIPE] Schema ready");

    const stripeSync = await getStripeSync();

    console.log("[STRIPE] Setting up managed webhook...");
    const domains = process.env.REPLIT_DOMAINS?.split(",");
    if (domains && domains.length > 0 && domains[0]) {
      const webhookBaseUrl = `https://${domains[0]}`;
      try {
        const result = await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/billing/webhook`);
        if ((result as any)?.webhook?.url) {
          console.log(`[STRIPE] Webhook configured: ${(result as any).webhook.url}`);
        } else {
          console.log("[STRIPE] Webhook setup returned no URL, will rely on Stripe dashboard config");
        }
      } catch (webhookErr: any) {
        console.warn("[STRIPE] Managed webhook setup failed (optional):", webhookErr.message);
      }
    } else {
      console.log("[STRIPE] No REPLIT_DOMAINS found, skipping managed webhook setup");
    }

    console.log("[STRIPE] Syncing data in background...");
    stripeSync
      .syncBackfill()
      .then(() => console.log("[STRIPE] Data sync complete"))
      .catch((err: any) => console.error("[STRIPE] Sync error:", err.message));
  } catch (error: any) {
    console.error("[STRIPE] Initialization failed:", error.message);
  }
}

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

// Start server if run directly or as bundled entry
if (isMainModule) {
  validateSiteUrl();

  console.log(`[API] Starting Lyceon API server...`);
  console.log(`[API] NODE_ENV: ${process.env.NODE_ENV || "development"}`);
  console.log(`[API] Binding to 0.0.0.0:${PORT}`);

  // Initialize Stripe before starting server (non-blocking)
  initStripe().catch((err) => console.error("[STRIPE] Init error:", err.message));

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
    console.log(`\n📋 Core API endpoints:`);
    console.log(`  GET    /healthz`);
<<<<<<< HEAD
    console.log(`  POST   /api/rag (requires Supabase auth)`);
    console.log(`  POST   /api/tutor/v2 (Lisa tutoring with canonical RAG)`);
=======
    console.log(`  POST   /api/ingest (requires INGEST_ADMIN_TOKEN)`);
    console.log(`  POST   /api/rag (requires API_USER_TOKEN)`);
    console.log(`  POST   /api/tutor/v2 (AI tutoring with RAG v2)`);
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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
    console.log(`  GET    /api/practice/sessions/:sessionId/next`);
    console.log(`  GET    /api/practice/sessions/:sessionId/state`);
    console.log(`  GET    /api/practice/next (legacy compatibility)`);
    console.log(`  POST   /api/practice/answer`);
<<<<<<< HEAD
=======
    console.log(`  POST   /api/practice/end-session`);
    console.log(`\n👨‍💼 Admin Routes (requires Supabase admin):`);
    console.log(`  GET    /api/admin/questions/needs-review`);
    console.log(`  GET    /api/admin/questions/statistics`);
    console.log(`  POST   /api/admin/questions/:id/approve`);
    console.log(`  POST   /api/admin/questions/:id/reject`);
    console.log(`\n📷 Student Routes (requires Supabase auth):`);
    console.log(`  POST   /api/student/analyze-question`);
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    console.log(`\n🔔 Notifications (requires Supabase auth):`);
    console.log(`  GET    /api/notifications`);
    console.log(`  GET    /api/notifications/unread-count`);
    console.log(`  PATCH  /api/notifications/:id/read`);
    console.log(`  PATCH  /api/notifications/mark-all-read`);
<<<<<<< HEAD
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
=======
    console.log(`\n📤 Ingestion v2 Pipeline (requires INGEST_ADMIN_TOKEN):`);
    console.log(`  POST   /api/ingest/pdf (v3 canonical upload)`);
    console.log(`  POST   /api/ingest-llm (v3 upload)`);
    console.log(`  POST   /api/ingest-llm/test (v3 test mode)`);
    console.log(`  GET    /api/ingest-llm/status/:jobId`);
    console.log(`  GET    /api/ingest-llm/jobs`);
    console.log(`  GET    /api/ingest/jobs (alias)`);
    console.log(`  POST   /api/ingest-llm/retry/:jobId`);
    console.log(`  * /api/ingest-v2/* endpoints deprecated (410 Gone)`);
    console.log(`\n📄 DocuPipe Integration (requires INGEST_ADMIN_TOKEN):`);
    console.log(`  POST   /api/docupipe/ingest-poc`);
  });

  // Ingestion worker controls (if enabled)
  try {
    if (isWorkerEnabled()) {
      startWorker();
    }
  } catch (e: any) {
    console.warn("[WORKER] Worker not started:", e?.message ?? "unknown");
  }

  // Optional worker control endpoints (admin-only)
  app.get("/api/admin/worker/status", requireSupabaseAdmin, (_req, res) => {
    const workerStatus = getWorkerStatus();
    res.json(workerStatus);
  });

  app.post("/api/admin/worker/stop", requireSupabaseAdmin, (_req, res) => {
    stopWorker();
    res.json({ ok: true });
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
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




