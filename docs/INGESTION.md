# SAT Question Ingestion

## MVP Ingest Endpoint

### POST /api/ingest-mvp

Accepts an array of Q&A items, validates with Zod, upserts idempotently, and generates embeddings.

**Acceptance Criteria:**
- ✅ Accepts array of Q&A items (zod-validated to agreed shape)
- ✅ Upserts idempotently to database
- ✅ Writes vectors to Supabase pgvector
- ✅ Rate limited (10 requests/minute)
- ✅ Admin-only access

### Request Schema

```typescript
{
  items: Array<{
    id: string;              // UUID
    stem: string;            // Question text
    section: 'math' | 'reading' | 'writing';
    type: 'mc' | 'fib' | 'grid-in';  // default: 'mc'
    difficultyLevel: 'easy' | 'medium' | 'hard';  // default: 'medium'
    correctAnswer: string;
    choices?: Array<{        // Required for MC questions
      letter: 'A' | 'B' | 'C' | 'D';
      text: string;
    }>;
    explanation?: string;
    unitTag?: string;
    tags?: string[];
  }>
}
```

### Response

```typescript
{
  success: true,
  ingested: number,
  metadata: {
    upsertTime: number,    // ms
    embedTime: number,      // ms
    totalTime: number       // ms
  }
}
```

### Example

```bash
curl -X POST http://localhost:5000/api/ingest-mvp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "items": [{
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "stem": "What is 2 + 2?",
      "section": "math",
      "type": "mc",
      "difficultyLevel": "easy",
      "correctAnswer": "B",
      "choices": [
        {"letter": "A", "text": "3"},
        {"letter": "B", "text": "4"},
        {"letter": "C", "text": "5"},
        {"letter": "D", "text": "6"}
      ],
      "explanation": "2 + 2 = 4"
    }]
  }'
```

## Validation Rules

- **ID**: Must be valid UUID format
- **Stem**: Cannot be empty
- **Section**: Must be one of: math, reading, writing
- **Type**: Must be one of: mc, fib, grid-in
- **Difficulty**: Must be one of: easy, medium, hard
- **Choices**: 2-4 items for MC questions
- **Array Size**: 1-100 items per request

## Idempotency

The endpoint uses `ON CONFLICT DO UPDATE` to ensure:
- Same UUID = update existing question
- No duplicate entries
- Safe for retries
- Co-located options + explanations preserved

## Embedding Generation

For each question:
1. Concatenate stem + choice texts
2. Generate OpenAI embedding (text-embedding-3-small, 1536D)
3. Upsert to `question_embeddings` table
4. Store metadata (type, unitTag, tags)

## Performance

Target: <500ms per item (including embedding generation)

Parallel processing used for batch embeddings.

## Error Handling

- 400: Validation failed (returns details)
- 429: Rate limit exceeded
- 401: Unauthorized (missing/invalid admin token)
- 500: Server error (check logs)
