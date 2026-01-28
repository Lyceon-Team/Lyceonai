# Environment Variables - MVP Architecture

## Bearer Token Authentication (New MVP Model)

The MVP uses simple Bearer token authentication instead of the previous Supabase Auth/NextAuth system.

### Required Tokens

```bash
# Admin endpoints (POST /api/ingest)
INGEST_ADMIN_TOKEN=your_secret_admin_token_here

# User endpoints (POST /api/rag)
API_USER_TOKEN=your_secret_user_token_here
```

**Security Notes:**
- If not set, defaults to `"changeme"` for development only
- **Never use default tokens in production**
- Generate strong tokens: `openssl rand -hex 32`
- Rotate tokens regularly

### Usage

```bash
# Ingest requests (admin)
curl -X POST http://localhost:5000/api/ingest \
  -H "Authorization: Bearer $INGEST_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[...]'

# RAG requests (user)
curl -X POST http://localhost:5000/api/rag \
  -H "Authorization: Bearer $API_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"...","topK":5}'
```

## Core Required Variables

The following environment variables are **required** for the MVP. Missing variables will be logged as warnings but use defaults.

### Core Infrastructure

```bash
# Supabase Database & Vector Search
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# PostgreSQL (provided by Github env)
DATABASE_URL=postgresql://...
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

Create `.env.local`:

```bash
# Copy from .env.example
cp .env.example .env.local

# Edit with your credentials
nano .env.local
```

## Production

Set all required variables in your deployment platform (Github Secrets, etc).
