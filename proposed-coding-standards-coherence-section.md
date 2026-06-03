# Proposed Coding Standards Addition — Cross-Agent & Cross-Session Coherence

> Draft for your spec process (Claude drafts → ChatGPT reviews → lock). Not written into `docs/Spec` directly. Slots naturally after §7.2 ("Single Source of Truth Lives in `packages/shared`") and reinforces §18. Renumber to fit.

---

## §X. Unified Code Across Agents & Sessions

Lyceon is built by multiple AI agents — subagents within a session, and parallel sessions across git worktrees. They must converge on **one coherent codebase**, not several plausible-but-divergent ones. The failure mode is not two agents editing the same line; it is two agents independently inventing the same helper, schema, validator, or pattern in slightly different ways, leaving the repo internally inconsistent. That divergence is a defect even when every test passes.

### §X.1 Consume the canonical primitive; never fork it

Before creating a helper, type, Zod schema, constant, DB utility, or pattern, **search for an existing canonical version and use it**. If one exists, import and extend it. If one does not and it will be shared, add it to the canonical location (below) — do not define a local second copy.

```ts
// ❌ a parallel session reinvents what packages/shared already owns
function parseAnswerInput(x: unknown) { /* local copy */ }

// ✅ consume the single source of truth
import { answerSubmitSchema } from "@/shared/schemas";
```

### §X.2 Canonical homes (single source of truth)

| Concern | Canonical home |
|---|---|
| Validators & data types | `packages/shared` (Zod schema first; infer types) |
| Env validation | `packages/shared/env.ts` |
| Structured logger / redaction | the shared logger utility |
| DB access | centralized DB utilities (no ad-hoc SQL) |
| Identity / RLS helpers | as defined by Doc 01 (e.g. `current_student_id()`, `is_admin()`) |
| Design system / UI primitives | `packages/ui` |

A second definition of anything above is a coherence violation, not a convenience.

### §X.3 Foundations land first

Shared primitives are built and merged **before** the work that depends on them. Parallel domain work consumes them; it does not race them. When a domain pass needs a new shared primitive, it adds it to the canonical home (and flags it) rather than carrying a local copy "for now."

### §X.4 Follow the established pattern

Where a pattern already exists (handler order, Result types, idempotency-key shape, event-ledger dedup, error envelope), new code matches it. A different-but-equivalent approach to a solved problem is divergence — prefer the existing one, or change it everywhere through one deliberate refactor, never in one corner.

### §X.5 Integration / coherence review

When parallel work merges, review it not only for correctness but for **reuse and consistency**: does it import the canonical primitives, follow the established patterns, and avoid duplicating a sibling's solution? A divergence or duplicate is a blocking finding to resolve before merge.

### §X.6 Enforcement

- `CLAUDE.md` carries the operational rule so every agent applies it each turn.
- `/spec-align-plan` assigns canonical ownership of shared surfaces to Wave 0 (built first, serially) so parallel passes consume rather than fork.
- The `spec-auditor` / `/grill-me` checklist includes: "did this reinvent or diverge from an existing canonical primitive or pattern?"
