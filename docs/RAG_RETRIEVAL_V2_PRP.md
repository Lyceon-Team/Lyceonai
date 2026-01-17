# PRP — RAG Retrieval v2 (Question + Student-Aware Retrieval Engine)

**Lyceon Learning Copilot — Internal Architecture Document**

*For SAT → ACT → AP → MCAT → LSAT Expansion*

## 1. Purpose

This PRP defines the full Retrieval-Augmented Generation (RAG) system that powers the AI Tutor.

It controls:
- How question content is retrieved from vector DB.
- How student profile + history influence retrieval and ranking.
- How context is packaged for the LLM.
- How the system maintains factual correctness and personalization.
- How style preferences and explanation levels evolve from prior interactions.

RAG v2 ensures the tutor is:
- Grounded in canonical question data.
- Personalized to the student's learning style.
- Contextually aware of student history, misconceptions, strengths, and weaknesses.
- Scalable for future exams.

## 2. RAG Responsibilities

The RAG service is responsible for:
- Finding relevant question/context for any tutor call.
- Selecting the right amount of context (not too little, not too much).
- Merging question data + student data into a single, structured context block.
- Feeding the LLM exactly what it needs to respond effectively.
- Returning metadata to help update:
  - Student persona
  - Primary/secondary style preferences
  - Explanation levels
  - Weakness maps

**Zero hallucination tolerance:**
All question stems, options, answers, competencies must come from Supabase/vector DB, not the LLM's imagination.

## 3. Data Sources Used by RAG

### 3.1 Question Records (Supabase)

- `canonicalId`
- `testCode`
- `sectionCode`
- `sourceType` (1 PDF, 2 generated)
- `stem`, `options`, `answer`
- `explanation`
- `competencies` (normalized + raw)
- `difficulty`
- `tags`

### 3.2 Vector Store (Pinecone or Supabase Vector)

Metadata embedded:
```json
{
  "canonicalId": "...",
  "testCode": "...",
  "sectionCode": "...",
  "competencies": [],
  "difficulty": "...",
  "sourceType": 1,
  "version": 1
}
```

### 3.3 Student Profile (Supabase)

Structured as:
```json
{
  "overallLevel": "emerging" | "developing" | "proficient" | "advanced",
  "competencyMap": {
    "M.LIN.1": { "correct": 8, "incorrect": 15 }
  },
  "recentQuestions": [
    { "canonicalId": "...", "correct": false }
  ],
  "primaryStyle": "short" | "medium" | "deep" | "analogy" | "step-by-step",
  "secondaryStyle": "analogy" | "visual" | "example-heavy",
  "explanationLevel": 1 | 2 | 3
}
```

### 3.4 Session Context

- Last few messages
- The question being worked on
- Whether the student is stuck or improving

## 4. RAG Modes

RAG v2 supports three retrieval modes:

### 4.1 QUESTION MODE (most common)

Student is working on a known question (canonicalId).

RAG retrieves:
- The main question doc.
- 1–2 similar questions with the same competency.
- Example explanations for that skill category.
- Student-specific difficulty-scaled hints if available.

**Purpose:** Enable the tutor to give guided help on this exact question.

### 4.2 CONCEPT MODE

Student asks about a topic ("I don't get linear equations", "How do I approach evidence questions?").

RAG retrieves:
- Representative questions for the competency cluster.
- Easy → medium → hard examples.
- Explanations for those examples.
- Student's past attempts on this competency.

**Purpose:** Enable concept teaching, not just question answering.

### 4.3 STRATEGY MODE

Meta-level questions ("How should I pace the reading section?").

RAG optionally retrieves:
- Strategy snippets
- High-level conceptual exemplars
- No question-specific data unless useful

**Purpose:** Make the tutor feel knowledgeable about test-taking strategies.

## 5. Retrieval Pipeline (Step-by-Step)

Below is the official pipeline definition that every RAG call follows.

### Step 1 — Input Assembly

The backend collects:
- User message
- Tutor mode (question / concept / strategy)
- canonicalQuestionId (if available)
- Student profile
- Session history
- Filters (testCode, sectionCode)

Then calls the RAG service.

### Step 2 — Query Construction

**If in QUESTION MODE:**

Primary retrieval key = canonicalQuestionId.

RAG does:
1. Fetch question doc directly from Supabase.
2. Extract competencies + difficulty.
3. Embed question stem for similarity lookup.
4. Query vector DB:

```
topK = 5
filters = {
  testCode,
  sectionCode,
  competencies: { overlap: true },
  difficulty: around(thisQuestion.difficulty)
}
```

**If in CONCEPT MODE:**

Embed the user's message, using filters:
```
topK = 8
filters = {
  testCode,
  sectionCode,
  competencies: derivedFrom(message) OR studentWeakAreas
}
```

**If in STRATEGY MODE:**

Retrieve from a special "strategy" bucket in vector DB (no strict question fields).

### Step 3 — Ranking Model

RAG ranking score combines:
- Semantic similarity (40%)
- Competency match (30%)
- Difficulty alignment (10%)
- Recency relevance (10%)
- Student weakness weight (10%)

Backend computes a score:
```
score = 0.4*sim
      + 0.3*competencyMatch
      + 0.1*difficultyMatch
      + 0.1*recentness
      + 0.1*weaknessBoost
```

Rank descending.

### Step 4 — Trim & Normalize Context

Take the top N (typically 1–3).

Then create a normalized context object:
```json
{
  "primaryQuestion": { ... },
  "supportingQuestions": [ ... ],
  "competencyContext": {
    "studentWeakAreas": [...],
    "studentStrongAreas": [...],
    "competencyLabels": [...]
  },
  "studentProfile": {
    "primaryStyle": "...",
    "secondaryStyle": "...",
    "explanationLevel": 1,
    "personaTags": [...]
  }
}
```

This is passed to the LLM as a hidden system context.

## 6. LLM Context Packaging Rules

The final prompt includes:
1. System Rules (tutor persona, safety, style policies)
2. RAG Context Block
3. User's Actual Message

The LLM must:
- Treat question and answer fields as ground truth.
- Rephrase explanations to match style preferences.
- Escalate explanation level if needed.
- Suggest updated style preferences & persona tags.

## 7. Updating Student Metadata (Primary/Secondary Style)

### 7.1 LLM Responsibility

At the end of each tutor reply, the LLM must output metadata:
```json
{
  "newSecondaryStyle": "example-heavy",
  "suggestedPrimaryStyle": "step-by-step",
  "newExplanationLevel": 2
}
```

Rules:
- Tutor never tells student directly "I'm changing your learning style."
- Backend updates:
  - `secondaryStyle` automatically
  - `primaryStyle` only if user changes it in settings
  - `explanationLevel` can be updated automatically (1→2→3)

### 7.2 Style Hierarchy

Student state always begins with:
1. Primary style (user-controlled)
2. Secondary style (model-controlled)

The tutor always tries:
1. Use primary style
2. If confusion persists → try secondary
3. If still no success → escalate to a simpler explanation level

## 8. Style Preference Inference Engine (LLM + Backend)

LLM heuristics:
- If student asks "Can you simplify this?" → `secondaryStyle = "step-by-step"`
- If student likes examples ("oh that example helped") → `"example-heavy"`
- If student rejects detail ("that's too long") → `"short"`
- If student expresses anxiety → `"gentle"` tone and Explanation Level ↑

Backend should allow storing:
```
stylePreferenceHistory[]
```

This can be aggregated into persona tags like:
- "pattern-driven thinker"
- "example-first learner"
- "prefers analogies"
- "overwhelmed by long text"

These never appear in chat; they just influence the tutor.

## 9. Context Safety & Reliability Rules

### 9.1 Hard constraints

The LLM must not:
- Modify question stem
- Modify choices
- Invent a different correct answer
- Change competency codes
- Hallucinate question numbers

### 9.2 If RAG context is empty

Tutor responds:
> I'm not seeing enough info to fully answer that. Can you share the question text?

Backend logs this as a retrieval failure.

## 10. API Contract

### POST /rag/query

**Request:**
```json
{
  "userId": "uuid",
  "message": "I don't get why the answer is B",
  "mode": "question",
  "canonicalQuestionId": "SATM1A8B91Q",
  "studentProfile": { ... },
  "sessionHistory": [ ... ],
  "filters": {
    "testCode": "SAT",
    "sectionCode": "M"
  }
}
```

**Response:**
```json
{
  "context": {
    "primaryQuestion": { ... },
    "supportingQuestions": [ ... ],
    "competencyContext": { ... },
    "studentProfile": { ... }
  },
  "metadata": {
    "canonicalIdsUsed": ["SATM1A8B91Q","SATM1Z89PQ3"],
    "recencyBias": true
  }
}
```

Backend then forwards context into the AI Tutor prompt.

## 11. Observability & Logging

Log:
- Query type (question / concept / strategy)
- canonicalIds retrieved
- embedding latency
- metadata score per question
- whether primary/secondary style performed well
- whether explanation level was escalated
- whether question-resolution success improved
- retrieval failures / fallback triggers

This information is needed for:
- Student dashboards
- Teacher/admin dashboards
- Adaptive curriculum
- Improving search quality

## 12. Failure Modes & Resilience

Automatic fallback paths:

1. **Similar questions retrieved but primary failed →**
   Fine, tutor can still teach concept.

2. **No vector hits but Supabase has the question →**
   Tutor uses canonical question alone.

3. **No context at all →**
   Tutor asks for the question text.

4. **LLM returns malformed metadata →**
   Backend repairs or defaults to:
   - No change to style
   - ExplanationLevel stays same

## 13. Multi-Exam Compatibility

The entire RAG pipeline is exam-agnostic as long as:
- `testCode` is set (SAT, ACT, AP, MCAT, etc.)
- `competencies` follow ingestion schema
- `sectionCode` filters apply

No redesign needed when new test families are added.

## 14. Enforcement Summary

To implement RAG v2:

1. Strictly use canonical question data from Supabase.
2. Combine retrieval + student profile into one structured context.
3. Use student primary/secondary style preferences to shape explanations.
4. Allow LLM to update secondary style + explanation level.
5. Maintain strict boundaries around factual correctness.
