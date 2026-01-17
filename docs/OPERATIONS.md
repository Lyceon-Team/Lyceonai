# Operations Guide

## MVP Endpoints

### Health Check

```bash
# Simple health check
curl http://localhost:5000/healthz
# Response: {"status":"ok"}

# Detailed health check
curl http://localhost:5000/api/health
# Response: {"status":"ok","service":"SAT Copilot API","timestamp":"...","config":{...}}
```

### Ingest Q&A Items

```bash
curl -X POST http://localhost:5000/api/ingest-mvp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d @sample-questions.json
```

### RAG Query

```bash
curl -X POST http://localhost:5000/api/rag \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-token>" \
  -d '{
    "query": "Explain quadratic equations",
    "section": "math",
    "topK": 5
  }'
```

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/ingest-mvp` | 10 req | 1 minute |
| `/api/rag` | 30 req | 1 minute |
| General API | 100 req | 1 minute |
| `/healthz` | Unlimited | - |

## Monitoring

### Performance Targets

- **RAG Query**: <800ms P95 (warm local)
- **Ingest**: <500ms per item
- **Health Check**: <10ms

### Key Metrics

```bash
# Check RAG performance
curl -X POST http://localhost:5000/api/rag \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}' | jq '.metadata'

# Response includes timing breakdown:
{
  "queryTime": 450,
  "embeddingTime": 120,
  "searchTime": 80,
  "llmTime": 250,
  "totalTime": 450
}
```

## Troubleshooting

### Server Won't Start

**Error:** `Configuration not loaded`

**Solution:** Ensure all required env vars are set (see `docs/ENV.md`)

```bash
# Check config
cat .env.local

# Required vars
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
GCP_PROJECT_ID=...
GCS_BUCKET_NAME=...
```

**Error:** `Port 5000 in use`

```bash
# Kill existing process
pkill -f "tsx server/index.ts"

# Or use different port
API_PORT=3002 npm run dev
```

### Rate Limit Issues

**Error:** 429 Too Many Requests

**Solution:** Wait for rate limit window to reset (1 minute) or increase limits:

```bash
# In .env.local
RATE_LIMIT_MAX_REQUESTS=200  # Increase general limit
```

### Vector Search Issues

**Error:** `Could not find table 'question_embeddings'`

**Solution:** Ensure Supabase pgvector extension is enabled and table exists:

```sql
-- In Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS question_embeddings (
  id text PRIMARY KEY,
  question_text text NOT NULL,
  embedding vector(1536),
  section text,
  difficulty text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS question_embeddings_vector_idx 
ON question_embeddings USING ivfflat (embedding vector_cosine_ops);
```

### Embedding Failures

**Error:** `OpenAI embedding failed`

**Solution:** Check OPENAI_API_KEY is valid and has credits:

```bash
# Test OpenAI connection
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

## Database Maintenance

### Check Vector Table Size

```sql
SELECT 
  COUNT(*) as total_embeddings,
  pg_size_pretty(pg_total_relation_size('question_embeddings')) as table_size
FROM question_embeddings;
```

### Clear All Embeddings

```sql
TRUNCATE question_embeddings;
```

### Backup Questions

```bash
# Export to JSON
pg_dump $DATABASE_URL -t questions --data-only --column-inserts > questions-backup.sql
```

## Deployment

### Pre-deployment Checklist

- [ ] All env vars set in production
- [ ] Database migrations applied
- [ ] Vector extension enabled
- [ ] Rate limits configured
- [ ] Health check accessible
- [ ] Smoke tests passing

### Deploy Command

```bash
# Replit deployment
git push origin stabilize-mvp
# Auto-deploys via Replit
```

### Post-deployment Verification

```bash
# 1. Health check
curl https://your-app.replit.app/healthz

# 2. Ingest test item
curl -X POST https://your-app.replit.app/api/ingest-mvp \
  -H "Content-Type: application/json" \
  -d '{"items":[...]}'

# 3. RAG test query
curl -X POST https://your-app.replit.app/api/rag \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
```

## Smoke Test Script

Run comprehensive end-to-end tests:

```bash
./scripts/smoke.sh
```

Validates:
- Health checks
- Ingest pipeline
- RAG queries
- Rate limits
- Error handling
