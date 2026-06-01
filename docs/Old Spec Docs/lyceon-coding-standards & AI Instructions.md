# Lyceon Coding Standards & AI Instructions

> Applies to all code generation, refactors, audits, and reviews in Lyceon.
> Lyceon is **deterministic**, **server-authoritative**, **anti-leak by design**, and **audit-friendly**.
> **No feature bypasses entitlement, role rules, explainability, or anti-leak constraints.**

---

## 1. What We're Building

Lyceon is an SAT-aligned learning system with:

- **Canonical question bank** — immutable IDs + anti-leak retrieval views
- **Practice engine** — resumable sessions + idempotent submissions
- **Full-length exams** — timed, no answer leakage, deterministic scoring
- **Event-driven mastery** — no guessing, no "AI confidence" metrics
- **Student-owned calendar plan** — auto baseline + user overrides
- **Guardian trust model** — view-only, visibility derived from link + student entitlement only

---

## 2. Monorepo Layout (Authoritative)

Use these conventions when adding or moving code:

```
repo/
  apps/
    web/          # React + TS UI (student / guardian / admin)
    api/          # API/BFF layer
    workers/      # ingestion + embeddings (separate process — never in user-facing server)
  server/         # Node/TS server (routes, middleware, logger)
  client/         # React app + route registry
  packages/
    shared/       # Zod validators, types, helpers — single source of truth
    ui/           # Design system
  infra/
    supabase/     # migrations, RLS policies, seeds
    stripe/       # docs + event maps
    cloudflare/   # edge notes
  docs/
    pdp/          # product + system specs (locked)
    runbooks/
```

### Layering Rule (Hard)

- **Routes/controllers:** parse → authz → entitlement check → call pure domain logic
- **Domain logic:** pure functions (no IO) where possible
- **DB access:** centralized utilities only — no ad-hoc SQL scattered across handlers
- **Workers:** OCR/embedding work never runs in the user-facing server process

---

## 3. TypeScript Rules (Strict, No Escape Hatches)

### 3.1 Strict Mode Always On

`tsconfig.json` must include:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 3.2 No `any`, No `@ts-ignore`

Never use `any`. Use `unknown` at boundaries and narrow with Zod parsing or explicit type guards. `@ts-ignore` and `@ts-expect-error` suppressions are not permitted.

### 3.3 Prefer `type` for Data Shapes

Reserve `interface` only for declaration merging (rare).

```ts
// ✅ Correct
type Question = {
  id: string;
  text: string;
  options: string[];
};

// ❌ Avoid for data shapes
interface Question { ... }
```

### 3.4 Explicit Return Types on Non-Trivial Functions

Required for all domain logic and route helpers:

```ts
// ✅ Good
function calculateScore(correct: number, total: number): number {
  return Math.round((correct / total) * 100);
}
```

### 3.5 Discriminated Unions for State

Never use boolean flags to encode multi-state logic:

```ts
// ✅ Good
type SessionState =
  | { status: "idle" }
  | { status: "in-progress"; currentIndex: number }
  | { status: "submitted"; score: number }
  | { status: "error"; message: string };

// ❌ Avoid
type SessionState = {
  isStarted: boolean;
  isSubmitted: boolean;
  hasError: boolean;
  score?: number;
};
```

### 3.6 Result Types for Expected Failures

Use a `Result` type for operations that can fail in expected ways. Reserve `throw` for unrecoverable/programming errors only.

```ts
type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function parseAnswer(input: unknown): Result<number> {
  const parsed = Number(input);
  if (isNaN(parsed)) return { ok: false, error: "Answer must be a number" };
  return { ok: true, value: parsed };
}
```

---

## 4. Determinism Rules (Lyceon-Specific — Non-Negotiable)

### 4.1 No Randomness Once Mastery Exists

Selection must be stable and explainable. Randomness is only permitted for cold-start, and must be deterministic-per-session if used. Never introduce random selection where mastery data exists.

### 4.2 Idempotency Is Required for Mutations

- Practice answer submit → idempotent via `idempotency_key`
- Test answer submit → idempotent via `idempotency_key`
- Stripe webhooks → deduped via event ledger pattern

If a mutation does not have idempotency built in, it is not complete.

### 4.3 Server Is Source of Truth for State and Time

- Timers are enforced server-side — never trust client-reported elapsed time
- Resume-on-refresh must not create duplicate items or sessions
- Do not trust client claims about role, entitlement, or session state

---

## 5. Canonical Content Rules (Anti-Leak — Non-Negotiable)

### 5.1 Canonical IDs Are Opaque and Immutable

The canonical ID format is locked. Do not create alternate ID schemes.

### 5.2 Pre-Submit Responses Must Never Reveal Answers

Any endpoint serving questions before submission **must** return:

```ts
{
  correct_answer: null,
  explanation: null
}
```

This is not optional. Any deviation is a leak.

### 5.3 Post-Submit Reveal Rules

- **Practice:** reveal correct answer + explanation after submit
- **Full test:** never reveal during the test; reveal only in the review phase after completion

---

## 6. Auth, Roles, and Entitlements (Server-Only — Non-Negotiable)

### 6.1 Server-Authoritative Auth

- Identity provider: Supabase Auth
- Session validation: server-side only
- Never trust client claims about role or entitlement

### 6.2 Guardian Trust Model

Guardian visibility is derived **only if both conditions are true:**

1. Guardian link is active
2. Student entitlement is active

Guardians are view-only. Guardians have no write access to student learning state under any circumstance.

### 6.3 Payment ≠ Permissions

Payment does not grant access by itself. Entitlements are student-scoped and must be explicitly set.

---

## 7. Validation & Schemas (Zod at Every Boundary)

### 7.1 Parse at Every Boundary

All external inputs must be `safeParse`'d before entering business logic:

- Request JSON/body
- Query params
- Environment variables
- Third-party payloads (Stripe, etc.)

```ts
const parsed = answerSubmitSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({
    error: { message: "Invalid input", details: parsed.error.flatten() }
  });
}
// parsed.data is fully typed from here — no further checks needed
```

### 7.2 Single Source of Truth Lives in `packages/shared`

Define Zod schema first. Infer TypeScript types from it. Never define a type and a schema separately for the same concept.

```ts
// ✅ In packages/shared
export const quizSubmissionSchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(z.number().int().min(0)),
  idempotency_key: z.string().uuid(),
});
export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;

// ❌ Never do this — diverges silently
type QuizSubmission = { quizId: string; answers: number[] };
const quizSubmissionSchema = z.object({ ... });
```

### 7.3 Validate Environment Variables at Startup

```ts
// packages/shared/env.ts
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]),
});
export const env = envSchema.parse(process.env);
```

---

## 8. API Route Handler Standards

### 8.1 Thin Handlers — Fixed Order

Every route handler does exactly this, in this order:

1. Auth + role enforcement
2. Entitlement enforcement (student-scoped)
3. Zod parse of input
4. Call domain function (pure logic, no IO)
5. Serialize and return output

No business logic lives in the handler. No auth logic lives in domain functions.

### 8.2 Consistent Response Shape

```ts
// Success
{ data: T }

// Error
{ error: { message: string; code?: string; details?: unknown } }
```

### 8.3 Status Codes

| Situation | Code |
|---|---|
| Success with data | 200 |
| Resource created | 201 |
| Validation error | 400 |
| Unauthenticated | 401 |
| Unauthorized | 403 |
| Not found | 404 |
| Conflict (multi-tab / state conflict) | 409 |
| Rate limited | 429 |
| Unexpected server error | 500 |

---

## 9. Practice Engine Contracts (Must Match Locked Spec)

These endpoint behaviors are locked. Do not change their shape or semantics:

| Endpoint | Behavior |
|---|---|
| `POST /api/practice/sessions` | Start session; records `client_instance_id` |
| `GET /api/practice/sessions/{session_id}/next` | Serve next item; **no answer or explanation** |
| `POST /api/practice/answer` | Idempotent via `idempotency_key`; returns correctness + explanation post-submit |
| `GET /api/practice/sessions/{session_id}/state` | Resume-safe; no duplicate items |

**Invariants that must not be broken:**

- No answer leakage pre-submit
- No duplicate items on refresh or resume
- Selection is deterministic

---

## 10. Mastery Engine Contracts (No Guessing)

- Mastery is earned from **observed events only** — never inferred or estimated
- Tutor interaction alone does not change mastery
- Only verified retry counts and scored events affect mastery
- Do not introduce "predicted score," "confidence," or vanity metrics

Mastery updates must follow the locked event taxonomy and stabilization rules in the spec.

---

## 11. Frontend Standards

### 11.1 Business Logic Stays Out of Components

- **Components** render UI
- **Hooks** fetch and mutate via the query layer
- **Domain logic** lives in `packages/shared` or `lib/` — imported, not inlined

### 11.2 Server State via Query Layer

Use TanStack Query (`useQuery`, `useMutation`) for all server/async state. Do not write ad-hoc `fetch` calls inside components.

| Data Type | Tool |
|---|---|
| Server / API data | TanStack Query |
| Local UI state | `useState` |
| Complex local state | `useReducer` |

### 11.3 No Client-Side Privilege Assumptions

UI may show or hide based on role, but the **server always enforces**. Never gate access based on client-held role state alone.

### 11.4 Components Should Be Pure When Possible

No side effects in the render body. Never use `useEffect` to compute derived state:

```tsx
// ✅ Good — derived inline
function ScoreBadge({ correct, total }: { correct: number; total: number }) {
  const pct = Math.round((correct / total) * 100);
  return <span>{pct}%</span>;
}

// ❌ Bad — useEffect for derivable value
function ScoreBadge({ correct, total }: { correct: number; total: number }) {
  const [pct, setPct] = useState(0);
  useEffect(() => setPct(Math.round((correct / total) * 100)), [correct, total]);
  return <span>{pct}%</span>;
}
```

### 11.5 Never Mutate State Directly

```ts
// ✅ Good
setAnswers((prev) => [...prev, newAnswer]);

// ❌ Bad
answers.push(newAnswer);
setAnswers(answers);
```

---

## 12. Logging, Privacy, and Safety (Non-Negotiable)

### 12.1 Never Log Sensitive Content

The following must **never** appear in logs under any circumstances:

- Cookies, auth headers, or tokens
- Request bodies for sensitive endpoints
- Student answers
- Tutor prompts or responses

All logging must be structured and redact by default. When adding a log statement, explicitly verify what fields it emits.

### 12.2 Safety Posture — Minors

- Minimize data collection on all student surfaces
- No invasive analytics on student-facing pages
- Tutor conversations are ephemeral — do not store raw exchanges verbatim

---

## 13. Error Handling

- **Expected failures** (validation, not found, business rule violations): Use `Result` types or structured error responses. Do not throw.
- **Unexpected failures** (infra errors, unhandled exceptions): Re-throw after logging with context. Never swallow.
- **No empty catch blocks.**

```ts
// ✅ Good
try {
  const result = await db.query(...);
  return { ok: true, value: result };
} catch (err) {
  logger.error("DB query failed", { err, context: "scoreQuiz" });
  throw err;
}

// ❌ Bad — silent failure
try {
  return await db.query(...);
} catch {
  return null;
}
```

---

## 14. Testing Requirements

- Use `pnpm` for all scripts and CI commands — not `npm`
- Tests are required when changing:
  - Anti-leak behavior → add/extend route tests
  - Idempotency → add replay tests
  - Auth / roles / entitlements → add denial tests
  - Logging redaction → add explicit redaction tests

---

## 15. Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Variables & functions | `camelCase` | `getUserProgress` |
| Types | `PascalCase` | `SessionState`, `QuizResult` |
| React components | `PascalCase` | `QuestionCard`, `ProgressBar` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_ATTEMPTS` |
| Component files | `PascalCase.tsx` | `QuestionCard.tsx` |
| Utility / hook files | `camelCase.ts` | `useSessionState.ts` |
| Zod schemas | `camelCase` + `Schema` suffix | `answerSubmitSchema` |
| Directories | `kebab-case` | `practice-engine/` |

---

## 16. Code Style

- **Formatter:** Prettier (default config)
- **Linter:** ESLint + `@typescript-eslint`
- **Package manager:** `pnpm` only
- **Imports:** External → internal (`@/...` aliases) → relative. No default exports except where Next.js requires them.
- **Prefer `const` over `let`.** Never use `var`.
- **Top-level functions:** named declarations. Callbacks and inline: arrow functions.
- **No `console.log` in production code** — use the structured logger utility.

---

## 17. What NOT to Generate (Hard Stops)

Do not introduce any of the following under any circumstances:

- `any`, `@ts-ignore`, or silent `catch` blocks
- Randomness in question selection when mastery data exists
- Endpoints that return `correct_answer` or `explanation` pre-submit
- Client-trusted role or entitlement checks
- Guardian write access to student learning state
- Logging of secrets, cookies, student answers, or tutor payloads
- "Predicted score," "AI confidence," or vanity metrics
- Duplicate TypeScript types that shadow an existing Zod schema
- Ad-hoc SQL outside of centralized DB utilities
- `useEffect` for derived state

---

## 18. Default Pattern When Adding a Feature

Follow this order every time:

1. **Spec alignment** — confirm behavior matches the relevant locked PDF/PDP section
2. **Schema** — add Zod schema in `packages/shared`; infer types from it
3. **Domain logic** — implement as pure functions (deterministic, idempotent where required)
4. **Route handler** — thin handler: auth → entitlement → parse → domain → serialize
5. **Tests** — anti-leak, idempotency, and denial tests for the new behavior
6. **Observability** — add structured, redacted logs (no content leakage)
