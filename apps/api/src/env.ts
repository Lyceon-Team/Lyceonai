// OCR Provider type definitions
type CanonicalOCRProvider = 'auto' | 'docai' | 'nougat' | 'tesseract';

// Legacy provider mapping to canonical names
const legacyProviderMapping: Record<string, CanonicalOCRProvider> = {
  'documentai': 'docai',
  'google_docai': 'docai', 
  'default': 'auto'
};

// Resolve OCR provider from environment with backward compatibility
function resolveOCRProvider(): CanonicalOCRProvider {
  const envProvider = process.env.OCR_PROVIDER || 'auto';
  const canonical = legacyProviderMapping[envProvider] || envProvider as CanonicalOCRProvider;
  
  // Validate canonical provider
  const validProviders: CanonicalOCRProvider[] = ['auto', 'docai', 'nougat', 'tesseract'];
  if (!validProviders.includes(canonical)) {
    console.warn(`⚠️ [OCR] Invalid OCR_PROVIDER '${envProvider}', falling back to 'auto'`);
    return 'auto';
  }
  
  console.log(`🔧 [OCR] Provider resolved: ${envProvider} -> ${canonical}`);
  return canonical;
}

export const env = {
  // Server configuration
  API_PORT: parseInt(process.env.API_PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  
  // OCR Configuration with backward compatibility
  OCR_PROVIDER: resolveOCRProvider(),
  
  // Feature flags
  QA_LLM_ENABLED: process.env.QA_LLM_ENABLED === 'true',
  VECTORS_ENABLED: process.env.VECTORS_ENABLED === 'true',
  EMBED_PROVIDER: 'gemini', // Gemini-only
  
  // Supabase configuration (required for MVP)
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  
  // Gemini configuration (required for embeddings and LLM)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  
  // Document AI configuration with fallback to legacy names
  DOC_AI_PROCESSOR: process.env.DOC_AI_PROCESSOR || process.env.DOCUMENT_AI_PROCESSOR_ID,
  GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.DOCUMENT_AI_APIJSON,
  GCP_LOCATION: process.env.GCP_LOCATION || process.env.DOCUMENT_AI_LOCATION || 'us',
  
  // Mathpix (for selective math region patching)
  MATHPIX_API_ID: process.env.MATHPIX_API_ID,
  MATHPIX_API_KEY_ONLY: process.env.MATHPIX_API_KEY_ONLY,
  
  // Auth tokens (required for secure endpoints)
  INGEST_ADMIN_TOKEN: process.env.INGEST_ADMIN_TOKEN,
  API_USER_TOKEN: process.env.API_USER_TOKEN,
  
  // RAG configuration
  TOP_K: parseInt(process.env.TOP_K ?? '8'),
};

// OCR Configuration for Option C - SAT-aware OCR pipeline
export const ocrConfig = {
  provider: env.OCR_PROVIDER, // 'auto' | 'docai' | 'nougat' | 'tesseract'
  
  // DocAI chunking configuration
  docAiMaxPagesPerChunk: Number(process.env.DOC_AI_MAX_PAGES_PER_CHUNK ?? '25'),
  docAiMaxTotalPages: Number(process.env.DOC_AI_MAX_TOTAL_PAGES ?? '240'),
  
  // Routing flags for SAT-aware behavior
  enableMathRouting: process.env.OCR_ENABLE_MATH_ROUTING === 'true', // default false
  enableNougatFallback: process.env.OCR_ENABLE_NOUGAT_FALLBACK !== 'false', // default true
  enableMathpixFallback: process.env.OCR_ENABLE_MATHPIX_FALLBACK !== 'false', // default true
} as const;

// Startup validation - warn about missing optional keys
export function validateEnvironment() {
  console.log(`🔧 [ENV] Environment validation starting...`);
  
  // Always available - these have defaults
  console.log(`✅ [ENV] Core: NODE_ENV=${env.NODE_ENV}, API_PORT=${env.API_PORT}`);
  console.log(`✅ [ENV] OCR: OCR_PROVIDER=${env.OCR_PROVIDER}`);
  console.log(`✅ [ENV] OCR Config: DocAI chunks=${ocrConfig.docAiMaxPagesPerChunk}, max=${ocrConfig.docAiMaxTotalPages}, mathRouting=${ocrConfig.enableMathRouting}, nougatFallback=${ocrConfig.enableNougatFallback}`);
  console.log(`✅ [ENV] Embed: EMBED_PROVIDER=${env.EMBED_PROVIDER}, TOP_K=${env.TOP_K}`);
  
  // Critical MVP secrets validation
  const criticalSecrets = {
    'SUPABASE_URL': env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_ANON_KEY': env.SUPABASE_ANON_KEY,
    'GEMINI_API_KEY': env.GEMINI_API_KEY,
    'INGEST_ADMIN_TOKEN': env.INGEST_ADMIN_TOKEN,
    'API_USER_TOKEN': env.API_USER_TOKEN,
  };
  
  let missingCritical = false;
  for (const [name, value] of Object.entries(criticalSecrets)) {
    if (!value) {
      console.error(`❌ [ENV] CRITICAL: Missing ${name}`);
      missingCritical = true;
    } else if (value === 'changeme') {
      console.warn(`⚠️ [ENV] WARNING: ${name} is set to insecure placeholder "changeme"`);
    } else {
      console.log(`✅ [ENV] ${name} configured`);
    }
  }
  
  if (missingCritical && env.NODE_ENV === 'production') {
    throw new Error('❌ FATAL: Critical environment variables missing in production. Server cannot start.');
  }
  
  // Feature-dependent validation
  if (env.VECTORS_ENABLED) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(`⚠️ [ENV] VECTORS_ENABLED=true but missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
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
  
  // OCR provider validation with fallback reporting
  if (env.OCR_PROVIDER === 'docai') {
    const docAiConfigured = env.DOC_AI_PROCESSOR && env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (docAiConfigured) {
      const usingFallback = !process.env.DOC_AI_PROCESSOR || !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (usingFallback) {
        console.log(`✅ [ENV] Document AI configured via fallback (DOCUMENT_AI_PROCESSOR_ID, DOCUMENT_AI_APIJSON)`);
      } else {
        console.log(`✅ [ENV] Document AI configured`);
      }
    } else {
      console.warn(`⚠️ [ENV] OCR_PROVIDER=docai but missing DOC_AI_PROCESSOR or GOOGLE_APPLICATION_CREDENTIALS_JSON`);
    }
  }
  
  // Mathpix validation
  if (env.MATHPIX_API_ID && env.MATHPIX_API_KEY_ONLY) {
    console.log(`✅ [ENV] Mathpix configured for selective math patching`);
  }
  
  console.log(`✅ [ENV] Environment validation complete`);
}
