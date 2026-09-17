import { notificationEnvSchema } from "../../../packages/shared/src/env";
import { logger } from "../../../server/logger";

// OCR Provider type definitions
type CanonicalOCRProvider = "auto" | "docai" | "nougat" | "tesseract";

// Legacy provider mapping to canonical names
const legacyProviderMapping: Record<string, CanonicalOCRProvider> = {
  documentai: "docai",
  google_docai: "docai",
  default: "auto",
};

// Resolve OCR provider from environment with backward compatibility
function resolveOCRProvider(): CanonicalOCRProvider {
  const envProvider = process.env.OCR_PROVIDER || "auto";
  const canonical =
    legacyProviderMapping[envProvider] || (envProvider as CanonicalOCRProvider);

  // Validate canonical provider
  const validProviders: CanonicalOCRProvider[] = [
    "auto",
    "docai",
    "nougat",
    "tesseract",
  ];
  if (!validProviders.includes(canonical)) {
    console.warn(
      `⚠️ [OCR] Invalid OCR_PROVIDER '${envProvider}', falling back to 'auto'`,
    );
    return "auto";
  }

  console.log(`🔧 [OCR] Provider resolved: ${envProvider} -> ${canonical}`);
  return canonical;
}

export const env = {
  // Server configuration
  API_PORT: parseInt(process.env.API_PORT || "3001", 10),
  NODE_ENV: process.env.NODE_ENV ?? "development",

  // OCR Configuration with backward compatibility
  OCR_PROVIDER: resolveOCRProvider(),

  // Feature flags
  QA_LLM_ENABLED: process.env.QA_LLM_ENABLED === "true",
  VECTORS_ENABLED: process.env.VECTORS_ENABLED === "true",
  EMBED_PROVIDER: "gemini", // Gemini-only

  // Supabase configuration (required for MVP)
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,

  // CSRF (double-submit cookie)
  CSRF_SECRET: process.env.CSRF_SECRET,

  // Gemini configuration (required for embeddings and LLM)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // Document AI configuration with fallback to legacy names
  // NOTE: GOOGLE_APPLICATION_CREDENTIALS_JSON was removed — it was dead code
  // (no Document AI client exists in this codebase). GCP credentials are now
  // loaded via server/lib/gcp-credentials.ts from GCP_SERVICE_ACCOUNT_JSON.
  DOC_AI_PROCESSOR: process.env.DOC_AI_PROCESSOR || process.env.DOCUMENT_AI_PROCESSOR_ID,
  GCP_LOCATION: process.env.GCP_LOCATION || process.env.DOCUMENT_AI_LOCATION || 'us',
  
  // Mathpix (for selective math region patching)
  MATHPIX_API_ID: process.env.MATHPIX_API_ID,
  MATHPIX_API_KEY_ONLY: process.env.MATHPIX_API_KEY_ONLY,

  // RAG configuration
  TOP_K: parseInt(process.env.TOP_K ?? "8"),

  // Product notifications (contracts/notifications.contract.md §12.2)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  NOTIFICATION_FROM_EMAIL: process.env.NOTIFICATION_FROM_EMAIL,
  SUPPRESSION_HMAC_SECRET: process.env.SUPPRESSION_HMAC_SECRET,
};

// OCR Configuration for Option C - SAT-aware OCR pipeline
export const ocrConfig = {
  provider: env.OCR_PROVIDER, // 'auto' | 'docai' | 'nougat' | 'tesseract'

  // DocAI chunking configuration
  docAiMaxPagesPerChunk: Number(process.env.DOC_AI_MAX_PAGES_PER_CHUNK ?? "25"),
  docAiMaxTotalPages: Number(process.env.DOC_AI_MAX_TOTAL_PAGES ?? "240"),

  // Routing flags for SAT-aware behavior
  enableMathRouting: process.env.OCR_ENABLE_MATH_ROUTING === "true", // default false
  enableNougatFallback: process.env.OCR_ENABLE_NOUGAT_FALLBACK !== "false", // default true
  enableMathpixFallback: process.env.OCR_ENABLE_MATHPIX_FALLBACK !== "false", // default true
} as const;

// Startup validation - warn about missing optional keys
export function validateEnvironment() {
  console.log(`🔧 [ENV] Environment validation starting...`);

  // Always available - these have defaults
  console.log(
    `✅ [ENV] Core: NODE_ENV=${env.NODE_ENV}, API_PORT=${env.API_PORT}`,
  );
  console.log(`✅ [ENV] OCR: OCR_PROVIDER=${env.OCR_PROVIDER}`);
  console.log(
    `✅ [ENV] OCR Config: DocAI chunks=${ocrConfig.docAiMaxPagesPerChunk}, max=${ocrConfig.docAiMaxTotalPages}, mathRouting=${ocrConfig.enableMathRouting}, nougatFallback=${ocrConfig.enableNougatFallback}`,
  );
  console.log(
    `✅ [ENV] Embed: EMBED_PROVIDER=${env.EMBED_PROVIDER}, TOP_K=${env.TOP_K}`,
  );

  // Critical MVP secrets validation
  const criticalSecrets = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    CSRF_SECRET: env.CSRF_SECRET,
  };

  let missingCritical = false;
  for (const [name, value] of Object.entries(criticalSecrets)) {
    if (!value) {
      console.error(`❌ [ENV] CRITICAL: Missing ${name}`);
      missingCritical = true;
    } else if (value === "changeme") {
      console.warn(
        `⚠️ [ENV] WARNING: ${name} is set to insecure placeholder "changeme"`,
      );
    } else {
      console.log(`✅ [ENV] ${name} configured`);
    }
  }

  if (missingCritical && env.NODE_ENV === "production") {
    throw new Error(
      "❌ FATAL: Critical environment variables missing in production. Server cannot start.",
    );
  }

  // Product notifications — contracts/notifications.contract.md §12.2. The three Resend
  // variables are required in production (the transport and the webhook receiver fail closed
  // without them); in other environments a missing value is reported, not fatal. NOTIFICATION_FROM_EMAIL must parse as
  // an address so a typo cannot reach Resend as the sender. Reported through the structured
  // logger — variable NAMES only, never values.
  const notificationEnv = notificationEnvSchema.safeParse(process.env);
  if (!notificationEnv.success) {
    const invalid = notificationEnv.error.issues.map((i) => i.path.join("."));
    logger.error(
      "ENV",
      "notification_env_invalid",
      "Notification environment variables are invalid",
      undefined,
      { invalid },
    );
    if (env.NODE_ENV === "production") {
      throw new Error(
        "❌ FATAL: Notification environment invalid in production. Server cannot start.",
      );
    }
  } else {
    const missing = (
      [
        "RESEND_API_KEY",
        "RESEND_WEBHOOK_SECRET",
        "NOTIFICATION_FROM_EMAIL",
      ] as const
    ).filter((k) => !notificationEnv.data[k]);

    // @spec [owner brief 2026-09-17 §2.1 ("validated at startup, alongside the three
    // notification variables"); contracts/notifications.contract.md §11A.3]
    // | @implemented [2026-09-17]
    //
    // REPORTED AT STARTUP, ENFORCED AT USE — deliberately NOT fatal, and this is a departure
    // from the brief's wording that the boot probe forced into the open.
    //
    // Making it fatal adds a tenth entry to scripts/ci/boot-env.manifest.json, which is a
    // promise that Vercel production already carries it. It does not yet. A merge that lands
    // before somebody sets the variable would stop the bundle finishing module load, which
    // takes down `/auth/callback` and every `/api/*` route — practice, checkout, auth, all of
    // it — for a secret that gates nothing but outgoing product mail. That is exactly the
    // 2026-08-27 outage shape, and the owner has already ruled on this class once: the GCP
    // credential was removed from the boot manifest for the same reason and now fails at USE
    // with a startup report (server/lib/startup-guards.ts `credentials_absent`).
    //
    // So the enforcement lives where the harm is: `getSuppressionStatus` returns `unknown`
    // without the secret and the dispatcher DEFERS every message rather than risk mailing
    // somebody who asked never to be contacted again. Nothing is sent and nothing is lost.
    // This line is the alertable signal that the state exists.
    if (!notificationEnv.data.SUPPRESSION_HMAC_SECRET) {
      logger.error(
        "ENV",
        "suppression_secret_absent",
        "SUPPRESSION_HMAC_SECRET is not set: the do-not-contact list cannot be checked, so the dispatcher will defer every product message rather than send one",
        undefined,
        { enforcement: "deferred_at_use", fatal: false },
      );
    }
    if (missing.length === 0) {
      logger.info(
        "ENV",
        "notification_env_ok",
        "Notification environment variables configured",
      );
    } else {
      logger.error(
        "ENV",
        "notification_env_missing",
        "Notification environment variables missing",
        undefined,
        { missing },
      );
      if (env.NODE_ENV === "production") {
        throw new Error(
          "❌ FATAL: Notification environment variables missing in production. Server cannot start.",
        );
      }
    }
  }

  // Feature-dependent validation
  if (env.VECTORS_ENABLED) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        `⚠️ [ENV] VECTORS_ENABLED=true but missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`,
      );
    }
    if (!env.GEMINI_API_KEY) {
      console.warn(`⚠️ [ENV] VECTORS_ENABLED=true but missing GEMINI_API_KEY`);
    }
  }

  if (env.QA_LLM_ENABLED) {
    if (!env.GEMINI_API_KEY) {
      console.warn(`⚠️ [ENV] QA_LLM_ENABLED=true but missing GEMINI_API_KEY`);
    }
  }
  
  // OCR provider validation
  if (env.OCR_PROVIDER === 'docai') {
    if (env.DOC_AI_PROCESSOR) {
      console.log(`✅ [ENV] Document AI processor configured`);
    } else {
      console.warn(`⚠️ [ENV] OCR_PROVIDER=docai but missing DOC_AI_PROCESSOR`);
    }
  }

  // Mathpix validation
  if (env.MATHPIX_API_ID && env.MATHPIX_API_KEY_ONLY) {
    console.log(`✅ [ENV] Mathpix configured for selective math patching`);
  }

  console.log(`✅ [ENV] Environment validation complete`);
}
