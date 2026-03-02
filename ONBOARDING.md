# Lyceonai Onboarding Guide

Welcome to the **Lyceonai** codebase! This document will help you get up to speed with the project's architecture, tools, and workflows.

---

## 🎯 Project Vision
**Lyceonai** (also known as SAT Learning Copilot) is an AI-powered platform designed to provide personalized SAT practice. It features:
- **RAG (Retrieval-Augmented Generation)**: AI tutoring trained on actual SAT materials.
- **Document Processing**: Automated extraction of questions and answers from SAT PDFs.
- **Practice & Mastery**: Structured practice sessions with domain-weighted score projections.

---

## 🛠 Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript.
- **Build Tool**: Vite.
- **Styling**: Tailwind CSS + [shadcn/ui](https://ui.shadcn.com/).
- **State Management**: TanStack React Query (Server state).
- **Routing**: [Wouter](https://github.com/molecula-js/wouter) (Lightweight SPA routing).

### Backend
- **Framework**: Node.js + Express.js + TypeScript.
- **Database**: PostgreSQL (hosted on Supabase) with [Drizzle ORM](https://orm.drizzle.team/).
- **Authentication**: Supabase Auth (Cookie-based, JWT-session).
- **AI/ML**:
    - **Google Gemini**: Text generation and tutor logic.
    - **OpenAI**: Embeddings for semantic search (Vector similarity).

---

## 📂 Directory Structure

| Directory | Purpose |
| :--- | :--- |
| [`server/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/server) | Express server entry point, middleware, and core routes. |
| [`apps/api/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/apps/api) | Business logic, ingestion pipelines, and database clients. |
| [`client/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/client) | React frontend application. |
| [`shared/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/shared) | Shared TypeScript types and Zod schemas (used by both client and server). |
| [`scripts/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/scripts) | Backfill, maintenance, and utility scripts. |
| [`database/`](file:///Users/harveyforchu/Desktop/code/Lyceonai/database) | Database initialization SQL and migration configs. |

---

## 🚀 Getting Started

### 1. Environment Setup
Copy `.env.example` to `.env` and fill in the required keys:
- `SUPABASE_URL` & `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for admin/server-side operations)
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

### 2. Install & Run
```bash
npm install
npm run dev
```

### 3. Database Updates
If you change the schema in `shared/schema.ts`, push the changes:
```bash
npm run db:push
```

---

## 🔍 Key Components & Logic

### Ingestion Pipeline
Located in [`apps/api/src/routes/ingestion-v4.ts`](file:///Users/harveyforchu/Desktop/code/Lyceonai/apps/api/src/routes/ingestion-v4.ts). It handles PDF parsing, OCR (via Google Document AI or Nougat), and deduplication.

### AI Tutoring (RAG)
The core logic resides in [`apps/api/src/lib/rag-service.ts`](file:///Users/harveyforchu/Desktop/code/Lyceonai/apps/api/src/lib/rag-service.ts). It retrieves relevant questions from the vector store to ground the tutor's answers.

### Mastery Modeling
Score projections use a College Board-weighted algorithm found in [`apps/api/src/routes/progress.ts`](file:///Users/harveyforchu/Desktop/code/Lyceonai/apps/api/src/routes/progress.ts).

---

## 🩹 Troubleshooting Guide

### 1. Server won't start?
- Check the [`/healthz`](http://localhost:5000/healthz) endpoint. It provides system diagnostics and DB reachability status.
- Ensure `SUPABASE_DB_URL` is correct in your `.env`.

### 2. RAG/Tutor providing poor results?
- Verify that questions have embeddings. Run the backfill script:
  `tsx scripts/backfill-embeddings.ts`
- Check Gemini API quota/limits.

### 3. Client UI not reflecting changes?
- Ensure `vite` is running and and that you haven't missed a `shared/schema.ts` update.

### 4. Authentication issues?
- The app uses cookies. Clear your browser cookies or check the `SupabaseAuthProvider` in [`client/src/contexts/SupabaseAuthContext.tsx`](file:///Users/harveyforchu/Desktop/code/Lyceonai/client/src/contexts/SupabaseAuthContext.tsx).

---

## 📈 Monitoring
Logs are structured and categories can be tracked in [`server/logger.ts`](file:///Users/harveyforchu/Desktop/code/Lyceonai/server/logger.ts). Look for `[HTTP]`, `[AUTH]`, or `[SEC]` prefixes in the console.
