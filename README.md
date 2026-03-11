# SAT Learning Copilot

An AI-powered SAT practice application with RAG (Retrieval-Augmented Generation) capabilities, featuring quality practice questions, vector search functionality, and robust production deployment.

## Features

- **Content Operations**: Admin-managed question review and quality controls
- **Vector Search**: Semantic search using embeddings stored in PostgreSQL and Supabase
- **AI Tutoring**: Retrieval-Augmented Generation for personalized assistance
- **Practice Sessions**: Track progress and get instant feedback
- **Admin Dashboard**: Manage questions, review queues, and system health

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Neon) + Supabase (vector search)
- **AI/ML**: Google Gemini + OpenAI embeddings
- **Auth**: Supabase authentication (cookie-based, no Bearer tokens)

## Getting Started

### Prerequisites

- Node.js 18+ or 20+
- **pnpm** (this project uses pnpm, not npm or yarn)
- PostgreSQL database (Neon, Supabase, or self-hosted)
- API keys for Gemini and OpenAI (optional for local development)

**Install pnpm:**
```bash
# Recommended: Standalone installer
curl -fsSL https://get.pnpm.io/install.sh | sh -
# or via npm (if already installed)
npm install -g pnpm
```

### Environment Variables

Required:
```bash
DATABASE_URL=postgresql://...        # PostgreSQL connection string
NODE_ENV=development                 # or production
```

Optional:
```bash
# AI/ML
GEMINI_API_KEY=                      # Google Gemini API key
OPENAI_API_KEY=                      # OpenAI API key for embeddings
EMBEDDINGS_MODEL=text-embedding-3-small  # Embedding model to use

# Vector Search (Supabase)
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...



# Security
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5000  # CORS origins (comma-separated)
```

### Installation

**Important:** This project uses **pnpm** exclusively. Do not use `npm install` or `yarn install`.

```bash
pnpm install
```

### Running the Application

Development mode:
```bash
pnpm run dev
```

Production build:
```bash
pnpm run build
pnpm run preview
```

The app will be available at http://localhost:5000

## Boot & Health Monitoring

### Health Endpoints

The application provides comprehensive health monitoring:

#### `/healthz` - Primary Health Check
Returns system health status and diagnostics. This endpoint works even if the database is unavailable.

**Response:**
```json
{
  "ok": true,
  "version": "1.0.0",
  "nodeEnv": "development",
  "uptime": 123.45,
  "hostname": "server-name",
  "hasDbUrl": true,
  "dbReachable": true,
  "hasSupabase": true,
  "embeddingsModel": "text-embedding-3-small",

}
```

**Fields:**
- `ok`: Overall health status
- `version`: Application version
- `nodeEnv`: Current environment (development/production)
- `uptime`: Server uptime in seconds
- `hostname`: Server hostname
- `hasDbUrl`: Whether DATABASE_URL is configured
- `dbReachable`: Whether database connection is working
- `hasSupabase`: Whether Supabase is configured
- `embeddingsModel`: Active embeddings model


#### `/api/health` - Legacy Health Check
Returns configuration details:

```json
{
  "config": {
    "ocrProvider": "auto",
    "embedProvider": "openai",
    "vectors": false,
    "llmQA": false
  }
}
```

### Graceful Boot

The application uses **lazy database initialization** to ensure it can start even when:
- Database is temporarily unavailable
- `DATABASE_URL` is not configured
- Network issues prevent connection

**Boot sequence:**
1. Initialize Express server
2. Mount `/healthz` endpoint (no DB required)
3. Attempt database connection (non-blocking)
4. Load authentication (local auth always available)
5. Mount API routes
6. Start listening on port 5000

If the database fails to connect:
- Server continues to run
- `/healthz` shows `dbReachable: false`
- DB-dependent features return errors
- Health check remains accessible

### Authentication Modes

The app supports flexible authentication:

**Local Auth (Default)**
- Always available, no extra configuration needed
- Username/password authentication
- Session-based with PostgreSQL storage



### Security Features

**Rate Limiting:**
- Auth endpoints: 5 requests per 15 minutes per IP
- Practice write endpoints: strict per-user rate limits
- Search endpoints: 100 requests per 15 minutes per IP

**Security Headers:**
- Helmet.js for HTTP security headers
- CSP disabled for SPA compatibility
- CORS with configurable origins

**Request Monitoring:**
- Request ID tracking
- Performance monitoring
- Error tracking and logging
- Admin action audit logging

## Database Management

### Schema Updates

Never write SQL migrations manually. Use Drizzle's schema push:

```bash
# Safe schema sync
pnpm run db:push

# Force sync (if data loss warning)
pnpm run db:push --force
```

### Embeddings Backfill

To generate embeddings for questions that don't have them:

```bash
tsx scripts/backfill-embeddings.ts
```

Features:
- Batch processing (100 questions per batch)
- Progress logging
- Rate limit protection
- Automatic retry logic

### Supabase Vector Setup

To enable vector search in Supabase, run:

```sql
-- See database/supabase-vector-setup.sql
-- Creates pgvector extension and question_embeddings table
```

## API Routes

### Public Routes
- `GET /api/questions` - List all questions
- `GET /api/questions/recent` - Get recent questions
- `GET /api/questions/:id` - Get question by ID

### Protected Routes (Admin Only)
- `GET /api/admin/questions/needs-review` - Review queue
- `GET /api/admin/questions/duplicates` - Duplicate detection view
- `GET /api/admin/questions/statistics` - Question quality metrics

### Auth Routes
- `POST /auth/login` - Local login
- `POST /auth/register` - Register new user
- `POST /auth/logout` - Logout
- `GET /auth/user` - Get current user
- `POST /api/auth/*` - NextAuth.js routes (if enabled)

## Logging

The application uses structured logging with multiple channels:

- **HTTP**: Request/response logging
- **AUTH**: Authentication events
- **ADMIN**: Admin actions audit trail
- **PERFORMANCE**: Slow operation detection
- **SECURITY**: Security events
- **HEALTH**: System health metrics

## Production Deployment

### Prerequisites
1. PostgreSQL database with pgvector extension
2. Supabase project for vector search
3. API keys for Gemini and OpenAI
4. Environment variables configured

### Deployment Steps
1. Set `NODE_ENV=production`
2. Configure all required environment variables
3. Run database migrations: `pnpm run db:push`
4. Run Supabase vector setup script
5. Build and start: `pnpm run build && pnpm run preview`
6. Monitor `/healthz` endpoint for health status

### Container Deployment
The server binds to `0.0.0.0:5000` for container compatibility.

Health check command:
```bash
curl -f http://localhost:5000/healthz || exit 1
```

## Development

### Project Structure
```
├── apps/api/          # Backend API
│   └── src/
│       ├── routes/    # API route handlers
│       ├── lib/       # Utilities (embeddings, etc.)
│       ├── db/        # Database client
│       └── middleware/# Express middlewares
├── client/            # React frontend
│   └── src/
│       ├── pages/     # Page components
│       ├── components/# Reusable components
│       └── lib/       # Frontend utilities
├── shared/            # Shared types and schemas
├── server/            # Express server bootstrap
├── scripts/           # Utility scripts
└── database/          # Database schemas
```

### Adding Features
1. Update schema in `shared/schema.ts`
2. Add API routes in `apps/api/src/routes/`
3. Create frontend components in `client/src/`
4. Test with playwright: `pnpm run test:e2e`

## Troubleshooting

### Server won't start
- Check `/healthz` endpoint - it should work even with DB issues
- Review logs for database connection errors
- Verify `DATABASE_URL` is set correctly

### Authentication not working
- Ensure `NEXTAUTH_ENABLED` matches your setup
- Check session configuration
- Verify database session store is working

### Embeddings failing
- Verify `OPENAI_API_KEY` or `GEMINI_API_KEY` is set
- Check `EMBEDDINGS_MODEL` configuration
- Review rate limits on API provider

### Vector search not working
- Run Supabase vector setup script
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Check if questions have embeddings (run backfill script)

## Security

See the full runbook here: [docs/SECURITY_RUNBOOK.md](docs/SECURITY_RUNBOOK.md)

## Security Regression Tests

To run the security regression tests locally (PowerShell):

```powershell
# From the project root
pnpm install
pnpm run test:security
```

- These tests are deterministic and do not require Codespaces.
- Ensure your `.env` contains valid SUPABASE_URL and GEMINI_API_KEY for full test coverage.
- Only the security regression tests are run in CI (see .github/workflows/ci.yml).

## Score Projection Engine

The Score Projection Engine calculates estimated SAT scores using College Board domain weights and student mastery data.

### Scoring Constants (College Board Weights)

```typescript
const SCORING_MODEL = {
  baseScore: 400, // 200 per section minimum
  rangePerSection: 600, // 800 max - 200 min
  
  weights: {
    math: {
      'algebra': 0.35,
      'advanced_math': 0.35,
      'problem_solving': 0.15,
      'geometry': 0.15
    },
    rw: {
      'craft_structure': 0.28,
      'information_ideas': 0.26,
      'standard_english': 0.26,
      'expression_ideas': 0.20
    }
  }
};
```

### Projection Algorithm

1. **Group Mastery**: Aggregate user's mastery_score by domain from skill_mastery table
2. **Apply Weights**: `Section_Mastery = Sum(Domain_Mastery * Domain_Weight)`
3. **Calculate Raw Score**: `Projected_Section = 200 + (600 * Section_Mastery)`
4. **Apply Cube Root Variance**:
   - `Variance = 100 / Math.cbrt(totalQuestions)`
   - `Range_Low = Score - Variance`
   - `Range_High = Score + Variance`

### Recency Decay

Before calculation, mastery data is decayed based on inactivity:

```
Decay_Factor = 0.95 ^ Weeks_Inactive
```

This ensures students who neglect a domain see their projected score drop, incentivizing regular practice.

### API Endpoint

```
GET /api/progress/projection
```

Returns:
- `projection.composite`: Total projected score (400-1600)
- `projection.math`: Math section score (200-800)
- `projection.rw`: Reading & Writing section score (200-800)
- `projection.range.low/high`: Confidence interval
- `projection.breakdown`: Per-domain contribution details

## License

MIT

- `projection.math`: Math section score (200-800)
