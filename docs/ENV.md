
# Environment Variables - GitHub Native

All secrets and environment variables should be managed via GitHub Actions Secrets (for CI/CD) and a local `.env` file (for development). No Replit or third-party secret connectors are used.

## Required Variables

Set the following in your `.env` file (for local dev) or as GitHub Secrets (for production):

```bash
# Core
DATABASE_URL=postgresql://...
NODE_ENV=development|production
SITE_URL=https://lyceon.ai
PUBLIC_SITE_URL=https://lyceon.ai

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PARENT_MONTHLY=...
STRIPE_PRICE_PARENT_QUARTERLY=...
STRIPE_PRICE_PARENT_YEARLY=...

# Google / Gemini
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GEMINI_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Admin tokens (for internal endpoints only)
INGEST_ADMIN_TOKEN=your_secret_admin_token_here

# All user-facing endpoints use Supabase cookie auth only (no Bearer tokens)
```



### AI Services

```bash
# OpenAI (required for embeddings and LLM)
OPENAI_API_KEY=sk-...

# Gemini (optional, for alternative embedding provider)
GEMINI_API_KEY=your-gemini-key
```

### GCP Infrastructure

```bash
# Google Cloud Project
GCP_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=sat-pdf-uploads
PUBSUB_TOPIC=sat-pdf-finalized
```

### RAG Configuration

```bash
# Embedding provider: openai | gemini
EMBED_PROVIDER=openai

# Number of top results to return
TOP_K=8
```

### Rate Limiting

```bash
# Rate limit window (milliseconds)
RATE_LIMIT_WINDOW_MS=60000

# Max requests per window
RATE_LIMIT_MAX_REQUESTS=100
```

## DocuPipe Integration (Optional)

```bash
# DocuPipe API Configuration
DOCUPIPE_API_KEY=your_docupipe_api_key
DOCUPIPE_API_BASE_URL=https://app.docupipe.ai
DOCUPIPE_SAT_SCHEMA_ID=your_sat_schema_id
DOCUPIPE_WEBHOOK_SECRET=your_webhook_secret
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DOCUPIPE_API_KEY` | Yes* | Secret API key for DocuPipe X-API-Key header |
| `DOCUPIPE_API_BASE_URL` | No | API base URL (default: https://app.docupipe.ai) |
| `DOCUPIPE_SAT_SCHEMA_ID` | Yes* | Schema ID for SAT practice test extraction |
| `DOCUPIPE_WEBHOOK_SECRET` | No | Shared secret for webhook validation |

*Required only if using DocuPipe integration. See [DOCUPIPE.md](./DOCUPIPE.md) for details.

## Optional Variables

```bash
# Environment
NODE_ENV=development|production|test

# API Port
API_PORT=3001
```

## Environment Validation

The `config.ts` file validates all environment variables at boot using Zod schemas:

- **Type Safety**: All vars are type-checked and coerced to correct types
- **Fail Fast**: Missing required vars cause immediate startup failure
- **Clear Errors**: Validation errors show exactly which vars are missing/invalid

Example error output:
```
❌ [CONFIG] Environment validation failed:
  - OPENAI_API_KEY: Required
  - GCP_PROJECT_ID: GCP_PROJECT_ID is required
  - SUPABASE_URL: SUPABASE_URL must be a valid URL
```


## Local Development

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp server/.env.example .env
# Edit .env with your secrets
```

## Production

Set all required variables as GitHub Actions Secrets or in your cloud provider's environment configuration. No Replit or third-party secret connectors are used.

## Production

Set all required variables in your deployment platform (Replit Secrets, etc).
