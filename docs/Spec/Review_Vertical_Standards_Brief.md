# Lyceon — Review Vertical: Standards Brief and Opening Instruction

**Written:** 2026-09-17, at the close of the calendar vertical's spec and database layers.
**Purpose:** carry forward how we work, what the calendar now requires of review, and what must happen before any review code is written.
**How to use:** paste as the first message of the review session, with no files attached. The session's first job is to find things out, not to build.

---

## PART 0 — THE OPENING INSTRUCTION

**No code is written in this vertical until a spec exists, three audits are complete, and a plan is ruled on by the owner.** In that order. The calendar vertical proved the cost of skipping it: a brief written from remembered spec text instead of the merged schema produced five blockers in one review round, and every one of them was caught by an agent that checked rather than complied.

The sequence, mandatory:

1. **Spec audit.** What does the corpus actually say about review? Read every locked doc that touches it — Doc 02B (practice + review runtime), Doc 05A/05B (mastery, which consumes review events), Doc 05F and its formula sheet (the calendar, which launches review), Doc 03 (LISA, which the student talks to during review). Report where they agree, where they contradict each other, and where the spec is silent on something that is live in code or in production. Silence on a live surface is a finding, not an absence.
2. **Repo audit.** What exists today, with `file:line` for every claim. Review currently has routes, a queue builder, a runtime gate and a page; none of it should be assumed correct, and all of it is a rebuild target.
3. **Database audit.** What is in production, verified by query, not by reading migrations. Genesis is the naming reference; it is not proof an object exists, and the two disagree in both directions.
4. **Findings and plan.** A written plan with the boundary the vertical owns, what it consumes from others, what it must provide to others, and the open decisions the owner must rule on. **Then** the owner rules. **Then** briefs are cut.

A brief that is a list of questions is a failed brief — but a brief written before the audits is worse, because it looks finished.

---

## PART 1 — HOW WE WORK

### The operating loop
Owner rules. Claude briefs. CC builds and pushes back. Codex audits. Owner merges.

**The owner** makes product and legal decisions, applies DDL and DML to production, and performs every merge to `main`.
**Claude** writes complete briefs, verifies claims against production read-only, and rules on findings. Claude does not write code.
**CC** builds, and is expected to push back **before** starting. A CC that builds a brief containing a false premise has failed at the job.
**Codex** audits scoped to a layer plus its interfaces, before merge.

### The feature-brief standard
CC is handed a full end-to-end flow, never a problem statement. Every brief carries: exact DB references verified against production; code shapes grounded in researched industry-standard solutions, never invented; the complete UI/UX path; enumerated edge cases each with a stated behaviour; acceptance evidence; and an explicit invitation to push back before building.

### Verification discipline
**Claims are checked, not relayed.** Several times this session a confident claim — from CC, from a reviewer, from Claude — was wrong and only a query caught it. Three examples worth internalising: mastery levels are 0–4 in production while the spec said 1–5; runtime-config history is per-table, not shared; `current_student_id()` and `is_admin()` do not exist at all. Each was asserted in a brief and disproved by one query.

**Production for existence, genesis for names.** **Read gate output by name from the job log, never by check colour.** **A skipped test is not a passing test.**

### The plant rule
A test nobody has watched fail is decoration. Every test asserting new behaviour is planted: break the behaviour, observe that specific test turn red, revert byte-identical. **A plant that fails to fail is a finding, not a pass.** In the calendar DB layer four plants were required and all four fired — the sharpest being that dropping `security_invoker` from a view let one student read another's plan.

**Name the class: an assertion a sibling can satisfy is not an assertion.**

### Gates
Enforce the rule, then a self-test that plants each failure and watches it caught. A gate must be a **ratchet, not a wall** — one that blocks legitimate work gets disabled within a week. A **self-referential check catches only the mistake nobody makes**. An **early exit can hide a later check**.

When a gate fires on legitimate work, teach it the exception narrowly and prove the mask stayed narrow — the calendar's basis-point divisions tripped the hardcoded-constants gate, and the fix taught the gate that `<x>_bp / 10000` is a unit, then proved a bare `10000` in the same function still failed.

### Failure modes we keep hitting
**Built and not wired** — server correct, control unreachable. A feature that does not work on the UI is irrelevant to the user.
**One fact, two sources** — a gate that re-derives what another gate established is a defect, not defence in depth.
**A decision rendered as an error** — a policy denial is a decision; it settles at 200 or 402 with a structured log, never a 500.
**A dangling citation** — code citing a document that exists nowhere.
**A stale comment outran the code.**
**The runtime that can't reach the file** — fix the class, not the instance.
**Any lookup that can fail a request** — not knowing something is never a reason to refuse a student anything.

### Deployment and governance
Production runs `main`. **Closed means deployed, not merged.** Every DDL change lands in three places: a migration file, production, and `genesis.sql`. **SCL = a spec amendment** (`PROPOSED` · `RULING` · `APPLIED`); numbers are never allocated by an agent. Split parallel work **by layer, never by phase**. **A subagent returns conclusions, not work** — the parent verifies load-bearing claims itself.

### Documentation rules
A spec doc stays **V1** until launch or an approved preview version. The version appears **only in the header** — never in body text. **No review register in a V1 doc**: apply review changes directly to the text. When a doc's body and a newer working artefact disagree, the doc gets a change record listing every reconciling edit, numbered, each naming the section it touches.

---

## PART 2 — WHAT THE CALENDAR NOW REQUIRES OF REVIEW

The calendar is spec-locked (Doc 05F), its formula is locked and stress-tested, and its database layer is **applied in production**: ten tables, two views, fifteen functions, twenty-one config rows, both generators in PL/pgSQL behind a parity gate on PostgreSQL 17.

The calendar treats review as a **rebuild vertical**. Its review adapter ships as a fail-open stub, and `calendar_runtime_config.enabled_block_types` is `["practice"]` at launch. The flag gains `"review"` — gate **G-08-03** — when the rebuilt engine passes the calendar's contract test. **Review does not have to adopt the calendar's design. It has to satisfy a contract, and the review vertical's own audit must verify that it does and report any place it cannot.**

### The launch contract (Doc 05F §12, the adapter contract)
Five items. `tests/ci/calendar.launch-contract.review.test.ts` ships against the stub and must pass unchanged against the rebuild.

1. **A create route** accepting a scope and a size, plus `client_instance_id` and a **caller-supplied idempotency key**. The calendar supplies `calendar:block:<block_id>:<launch_sequence>`; the engine returns the existing session for a repeated key. `CalendarLaunchService` owns the key format — the engine treats it as opaque and never constructs one.
2. **Two launch modes**, which the calendar stores as the block's `scope`:
   - `{"mode":"queue"}` — the standard spaced-repetition queue.
   - `{"mode":"session","source_engine":"practice"|"full_length","source_session_id":<uuid>}` — review of one past session's mistakes. This is how exam review works: the calendar places a review block on the **next study day after every full-length**, sized to that exam's missed count, and it may take the whole day's budget.
3. **An item-level activity surface** the calendar can count: one row per answered item carrying `question_section`, `question_domain`, and an answered timestamp. The calendar's allocator reads it; the calendar never asks review for a session terminal state and never invents one.
4. **Queryability** by student + local date, so the allocator can count a day's units.
5. **Open-by-id in the UI**, so a launched session can be resumed — the calendar navigates there after launch.

### Contracts the calendar has already fixed, which review must match
- **`ActivityUnit.occurred_at` is `answered_at`** — the moment of retrieval. The calendar's midnight-split rule is defined on it. `served_at` is not used.
- **Identity is `(engine, unit_id)`** and each unit is consumed by at most one block. Review's item rows must have a stable per-item id.
- **Domains are the eight full College Board names**; sections are `M` / `RW`. No codes, no alternate vocabulary.
- **Mastery levels are 0–4 or NULL** (`public.mastery_levels`: L0 Foundations … L4 Strong, unmeasured). Anything review writes or reads about mastery uses that domain.
- **Local dates are the student's**, from `student_study_profile.timezone`. Platform quota reset stays `America/Chicago` — different fact, different owner.
- **Review timing:** `calendar_runtime_config.review_estimated_seconds_per_item` (120) is **calendar-owned until review claims it** — SCL-08-F. If the rebuild owns a review timing constant, that SCL lands and the calendar reads it from review instead.

### What the calendar needs from review that does not exist yet
- **An SM-2 writer to `review_schedule`.** The table exists in production with **zero rows** and no writer. Until it is written, the calendar's snapshot reports an empty review queue and generates no ordinary review blocks. This is the single largest dependency.
- **A due-by-date read**, so the calendar can bucket what is due across a 14-day horizon rather than a single total.
- **A missed-count per completed full-length**, for exam-review sizing. That one is the exam vertical's, not review's, but review is the consumer.

### What review must NOT do
- Do not write mastery directly. Review emits canonical events; Doc 05A/05B own mastery. LISA never writes mastery either (Doc 03 INV-03-01).
- Do not depend on a calendar block or launch existing. The calendar is advisory: **INV-08-19 — no engine, mastery writer, KPI, entitlement decision or learning-event path depends on a calendar block or launch.** A student reviewing outside the calendar is normal and must work identically.
- Do not read or write calendar tables. The calendar reads review's canonical tables; review never reads the calendar's.

---

## PART 3 — WHAT THE AUDITS MUST ANSWER

### Spec audit
- Which document owns the review engine? Doc 02B §16 is the current answer; confirm it, and confirm whether review deserves its own doc the way the calendar got Doc 05F.
- What does the locked corpus say about: the SM-2 algorithm and its parameters; what enters the review queue and when it leaves; what a review session is; whether review is entitlement-gated and at what tier; what LISA's role is during review (the owner's stated intent: **the student is encouraged to talk to the agent and actually learn**, which is why review is budgeted at 120s per item, not 90s).
- Where does the spec contradict production? Report every instance with the doc line and the query result.
- Where is the spec silent on something live? Silence on a live, routed, entitlement-gated surface is the same finding class that started the calendar vertical.

### Repo audit
Read-only, `file:line` for every claim, "none" stated explicitly rather than implied. Cover: every file touching `review_sessions`, `review_session_items`, `review_error_attempts`, `review_schedule`, `review_runtime_config`; the create/state/submit routes and their auth, role and entitlement order; the queue builder and what it reads; the review UI and how a session is opened; what writes `review_schedule` (expected: nothing); what other verticals import from review; the runtime gate and what it does when tables are missing.

### Database audit
Verified by query against production, never inferred from migrations. Cover: every review table's columns, constraints, RLS state and policies; row counts; which columns are actually populated; the `review_runtime_config` keys and their values; whether `review_session_items` has a stable per-item id and a populated `answered_at`; what `source_origin` means and what its CHECK allows; the `student_domain_mastery` seam; and whether anything in production disagrees with genesis.

### The plan
One document: the boundary review owns; what it consumes and from whom; what it provides and to whom (calendar contract items 1–5 explicitly, each marked **satisfied / needs work / needs a ruling**); the layer sequence; the deploy gates; the SCLs other documents need; and the open decisions the owner must rule on, stated as numbered questions with options and a lean.

---

## PART 4 — STANDARDS THE BUILD WILL BE HELD TO

These are the calendar's, and they carried: **integer arithmetic only** where determinism matters, ratios in basis points; **no `COALESCE` defaults for essential inputs** — a missing essential input means nothing is produced and the prior state stands, never an invented value; **append-only where history matters**, with no UPDATE or DELETE path; **`SECURITY DEFINER SET search_path = public, pg_temp`** on every write RPC, and no client EXECUTE on any of them; **`security_invoker = true`** on every view; **RLS as defence in depth, the route as the authority**; **every plan-shaping number in a `*_runtime_config` table**, never a literal; **a parity gate with an independent oracle** when an algorithm is duplicated across languages; **idempotency on every mutation**, with the lock taken before the ledger is read — that ordering was a real defect the concurrency gate caught.

And the delivery bar: `pnpm` only; no dependency changes without approval; build and tests green with nothing skipped; every claim in a PR body backed by printed runtime artifacts, never descriptions.

---

## PART 5 — FIRST MESSAGE FOR THE REVIEW SESSION

> "Starting the review vertical. Read this brief in full. Do not write code, do not write a migration, and do not propose a design yet. Run the three audits in Part 3 — spec, repo, database — and report findings with file:line and query output. Verify Part 2's claims about what the calendar requires rather than accepting them; if the calendar's contract cannot be satisfied as written, say so and say why. Then produce the plan in Part 3 with numbered open decisions for me to rule on."

*End of brief.*
