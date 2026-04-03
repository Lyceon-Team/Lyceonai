# Operations Guide

## Health Checks

```bash
curl http://localhost:5000/healthz
curl http://localhost:5000/api/health
```

## Runtime API Smoke Checks

### RAG Query

```bash
curl -X POST http://localhost:5000/api/rag \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Explain quadratic equations",
    "section": "math",
    "topK": 5
  }'
```

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/rag` | 30 req | 1 minute |
| General API | 100 req | 1 minute |
| `/healthz` | Unlimited | - |

## Monitoring

### Performance Targets

- **RAG Query**: <800ms P95 (warm local)
- **Health Check**: <10ms

## Troubleshooting

### Server Won't Start

Ensure required environment variables are set (see `docs/ENV.md`).

### Vector Search Issues

Ensure `question_embeddings` exists and Supabase credentials are configured.

## Deployment Verification

```bash
curl https://your-app.replit.app/healthz
curl -X POST https://your-app.replit.app/api/rag \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
```

## Smoke Script

```bash
./scripts/smoke.sh
```

The smoke script verifies:
- health endpoints
- RAG endpoint reachability
