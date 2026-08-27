# Guardian rebuild — design spec

**Status:** DESIGN ONLY. No implementation accompanies this document.
**Audit basis:** SHA `1946405f0d619a001abd759f87f532c310bf9d5e`, accepted in full by owner ruling 2026-08-26.
**Rulings applied:** R1–R7 (owner, 2026-08-26).
**Migrations:** authored for Karl to apply. Never applied by an agent. Never run against prod.

---

## 0. What is being rebuilt, and why nothing is preserved

The audit established that the guardian surface is **unrunnable**, not merely unexercised:
every code path addresses `guardian_links` and `guardian_consent_requests` through columns
that exist in no spec, no genesis schema, and no prod table
(`student_user_id`, `linked_at`, `account_id`, `child_id`, `expires_at`).
`getGuardianLinkForStudent` (`server/lib/account.ts:45-51`) therefore raises PostgREST
`42703`, the guard at `:53` only swallows `PGRST116`, and every gated guardian route
returns 500. `createGuardianLink` fails on its first select, so no link can ever be
created — which is why `guardian_links` holds zero rows.

**This was known.** `supabase/migrations-pending/20260617130000_guardian_linked_emit.sql`
records it verbatim on 2026-06-17: *"The live TS writer `server/lib/account.ts::createGuardianLink`
is on the WRONG schema generation (it writes dead columns `student_user_id` / `account_id` /
`linked_at` and conflicts on a key that does not exist in canonical genesis)."* It registers
the defect as **GAP-AL-06** in the gap registry.

**`GAP-AL-06` does not exist.** `docs/SpecAudit/10-gap-registry/gap-registry.md` contains no
such entry. The one document that recorded the defect pointed at a tracker item that was
never written, so a known, load-bearing defect went untracked for ten weeks. That is a
finding about the registry, not about guardians — see Owner Question 6.

---

## 1. Subject resolver — the chokepoint

### 1.1 Contract

```
resolveSubject(req) -> void | 404 | 402
  principal  = req.user.id                     // authenticated, server-resolved
  studentId  = req.params.studentId            // Zod-parsed uuid

  if principal === studentId                   -> req.subject = { studentId, via: 'self' }
  else                                         -> decision = guardian_view_decision(principal, studentId)
       decision = 'allow'                      -> req.subject = { studentId, via: 'guardian' }
       decision = 'not_linked'                 -> 404
       decision = 'student_unentitled'         -> 402

  audit(principal, studentId, resource, decision, via)
```

`req.subject` is the ONLY thing downstream handlers read. **No handler below this middleware
learns the caller's role.** There is no `via`-dependent branching in any handler — `via` exists
for the audit record, not for behaviour.

### 1.2 Type

```ts
// packages/shared — Zod first, type inferred (Coding Standards §7.2)
export const subjectSchema = z.object({
  studentId: z.string().uuid(),
  via: z.enum(["self", "guardian"]),
});
export type Subject = z.infer<typeof subjectSchema>;
```

`req.subject` is declared via module augmentation on `Express.Request`. **No `any`, no cast.**
The audit found 18 `any` in the guardian surface, three of them precisely this pattern
(`(req as any).guardianAccountId`, `guardian-entitlement.ts:108-112`).

### 1.3 R6 — the resolver CALLS the database gate; it does not reimplement it

`guardian_can_view_student` is already correct, already in prod, and has **zero application
callers**. The obstacle is that it reads `auth.uid()`, which is NULL under the service-role
client the app uses.

**Proposed resolution — one derivation, three entry points.** Migration authored, Karl applies:

```sql
-- THE derivation. Everything else delegates to this.
CREATE OR REPLACE FUNCTION public.guardian_view_decision(
  p_guardian_id uuid,
  p_student_id  uuid
) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.guardian_links gl
      WHERE gl.guardian_profile_id = p_guardian_id
        AND gl.student_profile_id  = p_student_id
        AND gl.status              = 'active'
    ) THEN 'not_linked'
    WHEN NOT public.entitlement_active(p_student_id) THEN 'student_unentitled'
    ELSE 'allow'
  END;
$$;

-- Boolean form for the application, principal passed explicitly (service-role safe).
CREATE OR REPLACE FUNCTION public.guardian_can_view_student_as(
  p_guardian_id uuid, p_student_id uuid
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.guardian_view_decision(p_guardian_id, p_student_id) = 'allow'; $$;

-- The EXISTING RLS-facing signature, body replaced by delegation. Six policies unchanged.
CREATE OR REPLACE FUNCTION public.guardian_can_view_student(p_student_id uuid)
RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.guardian_can_view_student_as(auth.uid(), p_student_id); $$;
```

**Why this shape and not the alternatives:**

| Option | Verdict |
|---|---|
| `set_config('request.jwt.claims', …)` on the service-role connection so `auth.uid()` resolves | **REJECTED.** PostgREST pools connections; a GUC set outside a transaction can survive into another request. A leaked GUC on *this* predicate is a cross-student read. Not a risk worth taking to avoid one migration. |
| Move guardian reads onto an `authenticated` client so RLS enforces directly | **DEFERRED, not rejected.** This is Doc 01 §14 Layer 2 (TARGET STATE); §14 marks Layer 1 application filtering LAUNCH CANONICAL. The shape above is forward-compatible: the six RLS policies keep calling the 1-arg form, so when Layer 2 lands nothing changes but the client. |
| Reimplement the two-term gate in TypeScript | **REJECTED — this is what produced the current defect.** |

**The provenance test, at the SQL layer:** change the body of `guardian_view_decision` and the
application gate *and* all six RLS policies move together. That is the mutation which proves
there is one derivation rather than two that happen to agree.

**Two properties to note, not to change:**
- `entitlement_active` admits `active`, `past_due`, and `trialing` (`genesis-schema.expected.sql:1588`)
  — grace-inclusive per SCL-029. The guardian gate therefore grants during `past_due`, which is
  the platform predicate winning over a literal `status='active'`. Intended.
- `SECURITY DEFINER` + pinned `search_path` matches the existing function exactly.

### 1.4 R3 — 404 globally, and the one place it is 402

**404** for an unrelated authenticated caller, on every guardian-reachable surface, not only the
05B six (Doc 05B §10.3 step 2: *"Unrelated authenticated users get 404, not 403 — this avoids
leaking whether the `student_id` exists"*). The current `403 NO_LINKED_STUDENT`
(`guardian-entitlement.ts:71-76`) is an enumeration oracle and is deleted.

**402** when the caller *is* linked but the student's entitlement is inactive. This is not a leak:
learning "you are linked to this student and they are not entitled" requires already being linked,
which the caller already knows. It is also load-bearing — `SubscriptionPaywall.tsx` exists to sell
that upgrade, and collapsing it into 404 would silently delete the paywall path.

This is why the derivation returns a **decision**, not a boolean: a two-term gate that returns one
`false` cannot distinguish the two, and inventing the distinction in TypeScript would be a second
derivation. See Owner Question 1.

**Role-scoped collection endpoints** (the roster) return 404 for non-guardians as well — one
convention, no second rule to diverge from.

### 1.5 R5 — no admin bypass, and the non-goal that keeps it deleted

The admin bypass (`guardian-entitlement.ts:48-55`, citing "Doc 01 **V6** §543", a superseded
version) is **deleted and not rebuilt**. No operator reads a student's mastery, KPI, or
projections through a guardian-gated route.

**Recorded as a NON-GOAL so it is not reinvented under pressure:** if support later needs
per-student visibility, it is a **student-or-guardian-initiated, time-boxed, audited grant** —
a row with an expiry that the subject can revoke — never a role bypass. A bypass is
unrevocable, unlimited in scope, and invisible to the family it concerns.

**Admin aggregate KPIs are a post-launch surface, built separately, and MUST NOT read the
per-student endpoints.** Reading them would recreate the parallel-path class at the operator
layer, which is the class this whole rebuild exists to remove.

Admin *writes* to the link lifecycle are a separate question — Doc 01 §16 grants Admin ✓ on
"Guardian linking" and §36.3 names admin revocation via support escalation. See Owner Question 2.

### 1.6 The chokepoint CI gate

`scripts/ci/subject-resolver-chokepoint-gate.mjs`, blocking step in the `ci` job, built on the
existing `scripts/ci/lib/git-tracked-files.mjs` primitive.

Over every handler mounted under `/api/students/:studentId`:

| # | Rule | Mutation that must turn it red |
|---|---|---|
| 1 | No reference to `req.user.role`, `isGuardian`, `role === "guardian"`, `role === "student"` | add a role branch inside any such handler |
| 2 | No reference to `guardian_links`, `guardian_consent_requests`, `isGuardianLinkedToStudent`, `getAllGuardianStudentLinks` | import a link helper into a subject-scoped handler |
| 3 | Every such route is mounted behind `resolveSubject` | mount a new route without the resolver |
| 4 | Zero scanned files is a FAILURE | point the gate at an empty pathspec |

Rule 4 is not defensive padding: this repo has already shipped a gate whose scope silently
collapsed, and a green gate over zero files reads as "covered" when it is not.

**The gate is written and proved red BEFORE the first route moves.** A gate that lands last
never lands.

---

## 2. Route topology

| Route | Citation | Fate |
|---|---|---|
| `GET /api/students/{id}/mastery/domains` | Doc 05B §10.3 | NEW — replaces `/api/me/mastery/domains` and `/api/guardian/weaknesses/:studentId` |
| `GET /api/students/{id}/mastery/skills` | Doc 05B §10.3 | NEW — **200 `[]`** for guardians per §10.4, never 403 |
| `GET /api/students/{id}/kpi/sections` | Doc 05B §10.3 | NEW |
| `GET /api/students/{id}/kpi/domains` | Doc 05B §10.3 | NEW |
| `GET /api/students/{id}/kpi/skills` | Doc 05B §10.3 | NEW — 200 `[]` for guardians |
| `GET /api/students/{id}/kpi/overall` | Doc 05B §10.3 | NEW — replaces `/api/progress/kpis` and `/api/guardian/students/:id/summary` |
| `GET /api/students/{id}/projection/sections` | Doc 05C §10.2 | NEW (G7) |
| `GET /api/students/{id}/projection/total` | Doc 05C §10.2 | NEW — replaces `/api/progress/projection` |
| `GET /api/students/{id}/projection/history` | Doc 05C §10.2 | NEW (G8) |
| `GET /api/guardian/students/{id}/tests/{sessionId}/report` | Doc 04C §895 | RENAMED from `…/exams/full-length/:sessionId/report`. **Stays a separate guardian route** — 04C specifies two routes and invariant #7 is payload subsetting, already delivered in #645 |
| `GET /api/guardian/students` | none | KEPT, guardian-only. Roster has no student analogue |
| `POST /api/guardian/links`, `POST …/accept`, `DELETE …` | Doc 01 §36 | REBUILT — §3 |
| `GET /api/guardian/students/{id}/exams/full-length/sessions` | none | HOLD pending SCL-044 |
| `GET /api/guardian/students/{id}/calendar/month` | none | **HOLD per SCL-045. Invest nothing.** |
| `/api/consent/*` (3 routes) | — | **DELETE (R1)** |

**Skills grain, unresolved:** §10.3 names `/mastery/skills` **flat**; the live drill-down is
nested per-domain. See Owner Question 3.

**Note on 200-`[]` for skills.** §10.4's empty-list semantics are only safe because the resolver
has already run: an unrelated caller is 404'd before any SELECT. An empty list must therefore
never be produced by a *failed* read — see §6.4.

---

## 3. Link lifecycle — the whole of §36

### 3.1 State machine

```
                    guardian initiates                student initiates
                           |                                 |
                           v                                 v
              pending_student_accept              pending_guardian_accept
                     |         |                       |          |
       student accepts|        |student declines        |guardian  |guardian
                     |         |                 accepts|          |declines
                     v         v                       v          v
                  ACTIVE <-------------------------- ACTIVE     revoked
                     |
      either party revokes (or admin, §36.3)
                     v
                  revoked  --(re-invite)--> pending_*_accept
```

**Terminal-state note:** `unique_active_link` is `UNIQUE NULLS NOT DISTINCT (guardian_profile_id,
student_profile_id, status) DEFERRABLE INITIALLY DEFERRED` (`genesis-schema.expected.sql:6203`) —
one row per pair *per status*. The design keeps **exactly one row per pair**, moving its `status`,
so the constraint is satisfied trivially and `guardian_links` is unambiguously a **current-state
table, not a log**. It structurally cannot hold repeated revocations. That is precisely why link
history goes to `audit_logs` (R7) rather than to a second table.

### 3.2 Transitions, columns, and side effects

| Transition | Writes | Side effects |
|---|---|---|
| initiate (guardian) | `status='pending_student_accept'`, `initiated_by='guardian'`, `initiated_at=now()` | email to student; `audit_logs` row; rate-limit consume |
| initiate (student) | `status='pending_guardian_accept'`, `initiated_by='student'`, `initiated_at=now()` | email to guardian; `audit_logs` row; rate-limit consume |
| accept | `status='active'`, `accepted_at=now()`, `accepted_by_profile_id=<accepting principal>` | **`PERFORM public.emit_guardian_linked(v_link_id)` IN THE SAME TRANSACTION**; NOTIFY `entitlement_invalidate` for guardian and student (§36.5); `audit_logs` row |
| revoke | `status='revoked'`, `revoked_at=now()`, `revoked_by_profile_id`, `revocation_reason` | NOTIFY `entitlement_invalidate` both; `audit_logs` row; §36.4 billing prompt |
| re-invite | back to the relevant `pending_*` state, acceptance/revocation columns cleared | as per initiate |

**Column vocabulary is the canonical one and only that:** `guardian_profile_id`,
`student_profile_id`, `status`, `initiated_by`, `initiated_at`, `accepted_at`,
`accepted_by_profile_id`, `revoked_at`, `revoked_by_profile_id`, `revocation_reason`,
`created_at`. The 43 sites using `student_user_id` / `linked_at` / `account_id` are deleted
with the code that holds them.

### 3.3 Activation is an RPC, because the emit must be transactional

`supabase/migrations-pending/20260617130000_guardian_linked_emit.sql` already ships the
genesis-correct, insert-once `emit_guardian_linked(uuid)` — deterministic `event_id`, keyed to
the canonical shape, and explicitly designed to compose with either an immediate-active create or
a `pending_* -> active` accept transition. Its own header states the requirement:

> A standalone client `.rpc('emit_guardian_linked', …)` call is NOT atomic with a separate
> client-side update — emit MUST be composed into the activation transaction (SQL-side).

**Therefore acceptance is a SQL RPC, not a TypeScript update.** `accept_guardian_link(p_link_id,
p_accepting_profile_id)` performs the status write, the `PERFORM emit_guardian_linked(...)`, and
the `audit_logs` insert in ONE transaction. This is also the managed-service-first answer: the
outbox primitive already exists and is wired in one line rather than redesigned.

**Migrations Karl must apply, in order:**
1. `git mv supabase/migrations-pending/20260617130000_guardian_linked_emit.sql supabase/migrations/` (activation of the existing pending emit)
2. `guardian_view_decision` + the two delegating boolean forms (§1.3)
3. `accept_guardian_link`, `initiate_guardian_link`, `revoke_guardian_link` RPCs
4. NOTIFY `entitlement_invalidate` emission on `guardian_links` status change (§36.5 — the channel does not exist anywhere today)

Read-only pre-check before any of them: `to_regclass`/`pg_proc` confirmation that
`guardian_view_decision`, `accept_guardian_link`, `initiate_guardian_link`, and
`revoke_guardian_link` do not already exist; and capture the current
`guardian_can_view_student` body so the delegation can be diffed against what was replaced.

### 3.4 R2 — one guardian, many students

Doc 01 §35 ("one or more students") and §31.3 (any one active premium student grants derivation)
govern. `createGuardianLink`'s `GUARDIAN_ALREADY_LINKED` and `STUDENT_ALREADY_LINKED` throws
(`account.ts:62-72`, `:88-98`) are drift and are deleted **in both directions**, along with the
tests that assert them.

Guardian entitlement derivation becomes: **any** active-premium linked student grants premium
(§31.2). `getPrimaryGuardianLink` — a single-link read — is deleted.

### 3.5 R7 — auditing folds into `audit_logs`

`guardian_link_audit` does not exist on prod and is not in the genesis schema, yet
`guardian-routes.ts:131` and `durable-rate-limiter.ts:20,60` write and read it. No table is added.

`audit_logs` (`genesis-schema.expected.sql:3511-3521`) carries `actor_profile_id`,
`target_profile_id`, `action`, `changes jsonb`, `context jsonb`, `ip_address`, `user_agent`,
`created_at` — sufficient for both the lifecycle record and the §36.2 rate-limit counter
(`action='guardian_link_initiated'`, counted over `created_at`).

**Privacy constraint on every such row:** access-metadata only. No student answers, no content,
no tokens (Coding Standards §12.1). `changes` carries the status transition; `context` carries
the resource and decision.

---

## 4. Deletion inventory

### 4.1 Routes and services

| Path | Reason |
|---|---|
| `server/routes/guardian-consent-routes.ts` (3 routes, whole file) | R1 + R4 |
| `server/middleware/guardian-entitlement.ts` | replaced by the resolver; 403-not-404; admin bypass (R5) |
| `server/middleware/guardian-role.ts` | folded into the resolver |
| `account.ts`: `getGuardianLinkForStudent`, `isGuardianLinkedToStudent`, `createGuardianLink`, `revokeGuardianLink`, `getPrimaryGuardianLink`, `getAllGuardianStudentLinks`, `getLinkedGuardianForStudent`, `resolveLinkedPairPremiumAccessForGuardian` | dead columns; replaced by the RPCs and the resolver |
| `GET /api/me/mastery/*`, `GET /api/progress/kpis`, `GET /api/progress/projection`, `GET /api/guardian/weaknesses/:studentId`, `GET /api/guardian/students/:id/summary` | superseded by §2; each added to the retired-endpoints gate |

### 4.2 Client

`guardian-consent-verify.tsx` (R1, whole page + its route in `App.tsx:228-230`).
The **11 hand-written interfaces** — `guardian-dashboard.tsx:54,61,83,89,101,106`;
`guardian-calendar.tsx:10,20,28`; `guardian-consent-verify.tsx:19`;
`SubscriptionPaywall.tsx:20` — are deleted and replaced by types **inferred from the shared Zod
response schemas**. This family produced the `GuardianWeaknessResponse` crash; it does not come back.
`interface` for data shapes also violates Coding Standards §3.3.

### 4.3 Hygiene, enumerated

- **18 `any`**: `account.ts` 6, `guardian-consent-routes.ts` 4, `guardian-entitlement.ts` 3,
  `durable-rate-limiter.ts` 3, `guardian-routes.ts` 2, plus `SubscriptionPaywall.tsx:53` `details?: any`.
- **8 `console.*`** in `account.ts` (§16 — structured logger only).
- **Asserted defaults**, all deleted: `guardian-routes.ts:198,200` (`students || []` — self-contradicting,
  `links.length > 0` is already established); **`guardian-routes.ts:457`** (`const { data }` does not
  destructure `error` at all, then returns `ok: true` — a failed profile read renders as an empty roster
  with a success flag); `account.ts:225,458,554,591,597,615`; `durable-rate-limiter.ts:41` (`count || 0`
  — a failed count reads as under quota).
- **Six orphaned scripts**, referenced by nothing in `.github/`, `package.json`, or `scripts/ci/`:
  `guardian-smoke-test.ts`, `smoke-guardian-flow.ts`, `get-guardian-token.mjs`,
  `rls-guardian-proof.mjs`, `rls-guardian-kpi-proof.mjs`, `rls-guardian-parent-dashboard-proof.mjs`.

### 4.4 Tests that assert a defect as correct — named, and deleted

| Test | What it pins |
|---|---|
| `tests/ci/guardian-consent.id11.contract.test.ts` | `child_id` (×2), `expires_at` (×3) — column names that exist nowhere. Deleted entire under R1 |
| `server/__tests__/guardian-payment-access.test.ts` | `student_user_id` |
| `tests/ci/guardian-kpi-parity.contract.test.ts` | ceases to have a subject under one route — deleted, not ported |
| `tests/ci/guardian-student-path-parity.contract.test.ts` | same |

The last two are worth stating plainly: a test that drives two routes from one mock and compares
the bodies is meaningless when there is one route. **Their deletion is the clearest single measure
that the divergence class is gone.**

---

## 5. Schema deltas

**No new tables.** Additive functions only:

| Object | Kind | Note |
|---|---|---|
| `guardian_view_decision(uuid, uuid) -> text` | NEW function | THE derivation |
| `guardian_can_view_student_as(uuid, uuid) -> boolean` | NEW function | delegates |
| `guardian_can_view_student(uuid) -> boolean` | REPLACED body | delegates; six RLS policies untouched |
| `initiate_guardian_link`, `accept_guardian_link`, `revoke_guardian_link` | NEW functions | transactional; accept composes `emit_guardian_linked` |
| `emit_guardian_linked(uuid)` | ACTIVATED | already authored, currently in `migrations-pending/` |
| NOTIFY `entitlement_invalidate` on status change | NEW trigger | §36.5; channel does not exist today |

`guardian_consent_requests` — the table is **left in place, unused**. Under R1 nothing reads or
writes it. Dropping a table holding zero rows is still a destructive migration for no benefit, and
if R1 is ever revisited the table is the spec-correct shape. Recorded as deliberate.

---

## 6. Test plan — every gate observed failing

**Standing rule for this rebuild: no gate is complete until its red mutation has been RUN, not asserted.**

### 6.1 The resolver

| Case | Mutation that must turn it red |
|---|---|
| self reads own data → 200, `via='self'` | resolver requires a link for self |
| linked + entitled guardian → 200, `via='guardian'` | drop the link term |
| linked + **unentitled** student → **402** | fold 402 into 404 |
| unlinked caller → **404** | return 403 (the current behaviour) |
| nonexistent studentId → **404**, identical body to unlinked | make the two responses distinguishable |
| revoked link → 404 | treat `revoked` as active |
| pending link → 404 | treat `pending_*` as active |

### 6.2 Provenance at the SQL layer

Change the body of `guardian_view_decision`; **the application gate test and the six RLS policy
tests must all go red together, with no TypeScript touched.** If the application test stays green,
there are still two derivations.

### 6.3 The link lifecycle — against real rows, not mocks

The existing suite mocks the link layer away entirely (7, 9, 6, and 5 `vi.mock` calls in the four
largest guardian tests), which is exactly why unrunnable code passed for ten weeks. The lifecycle
tests run against **real `guardian_links` rows** in the CI database that `genesis-fresh-apply`
provisions.

**Fixtures mirror production's shape, not merely its schema:** a fresh student with no entitlement,
a student mid-`past_due`, a guardian linked to two students of differing entitlement, a re-invited
pair after revocation. Production has zero links; a fixture asserting only the happy path would
recreate the blind spot.

| Case | Mutation |
|---|---|
| initiate → `pending_student_accept`, no access yet | grant access on pending |
| accept → `active` **and exactly one `notification_outbox` row** | move the emit out of the transaction → two writes, and a rollback leaves a notification for a link that does not exist |
| accept twice (replay) → still exactly one outbox row | remove the deterministic `event_id` |
| revoke → access gone on the next request | cache the decision |
| re-invite after revoke → succeeds | violates `unique_active_link` if a second row is inserted |
| guardian with 2 students, 1 premium → premium derivation | restore the single-link read (R2) |
| linking a second student → succeeds | restore `GUARDIAN_ALREADY_LINKED` |
| §36.2 rate limit at 11th attempt/day | count from a table that does not exist → the limiter fails open |

### 6.4 Empty vs failed, everywhere

Every list surface asserts an error-path case distinct from an empty-result case. Specifically the
§10.4 `200 []` for guardian skills: **a failed read must never render as the same `[]`.** The
mutation is a forced query error — the test must fail, not receive an empty array.

### 6.5 Anti-leak

The existing `guardian.anti-leak.ci.test.ts` recursive walk is retained and re-pointed at the new
routes. This is the one area the audit found clean, and the rebuild must not regress it. Mocks stay
**upstream of the sanitizer** — the #644 lesson: mocking downstream of the chokepoint produced two
cases that passed vacuously.

---

## 7. SCL drafts owed

**SCL-046 (PROPOSED) — Doc 01 §37 under-13 consent flow is superseded at launch by Doc 10 §2.4 + Doc 07E §10.1.**
WAS: Doc 01 §37.1-37.2 specifies an under-13 guardian-consent flow whose step 7 is *"Student receives
notification that they can now access features"* — consent UNLOCKS the account.
IS: Doc 10 §2.4 operational rules: *"Under-13 detection → hard-delete-everywhere. This applies
regardless of jurisdiction, because Lyceon's V1 posture is no under-13 paid accounts globally."*
Doc 07E §10.1 trigger 2 makes the consent flow itself a DETECTION path: *"if a user enters parental-consent
flow and the parent provides age information indicating the student is under 13, the account is marked"*
→ §10.2 immediate hard-delete, no soft-delete envelope. Under Doc 01 the flow grants access; under
Doc 10 + 07E the same act destroys the account.
Rationale: owner ruling 2026-08-26 — Doc 10 governs at launch. `guardian_consent_requests` and the
entire consent flow are out of V1.
Owner action: amend Doc 01 §37 to record that the under-13 consent flow is post-launch, and that at
launch under-13 detection routes to Doc 07E §10.2.
Build artifact: deletion of `/api/consent/*`, `guardian-consent-verify.tsx`, and
`guardian-consent.id11.contract.test.ts`.

**SCL-047 (PROPOSED) — the $0.50 Stripe identity-verification charge has no spec basis.**
WAS: `guardian-consent-routes.ts` creates a Stripe Checkout Session for a $0.50 identity
verification as part of consent, citing "GAP-ID-11", a gap-registry item.
IS: Doc 01 §37.2 step 3 specifies *"no auth required; token is the auth"* and steps 4-5 specify
account creation plus explicit consent. No payment appears anywhere in §37.
Rationale: owner ruling 2026-08-26 R4 — a gap-registry item is not a spec section or a recorded
ruling. Drift. Moot under R1 in any case, but recorded so the mechanism is not reintroduced with
the consent flow post-launch.
Owner action: confirm REJECTED-as-drift, or name the ruling that authorised it.

**Numbering.** `cleanup` holds **044**; `lisa` holds **042**; **SCL-045 exists only on
`claude/guardian-parity-step2`** (appended in `1946405`, unmerged). So the next free id is **046**
*only if #645 merges first* — if these SCLs land before it, 045 collides. Verify against `cleanup`
at the moment of appending, and if #645 is still open, append 046/047 and leave 045 to #645.
This is the second cycle in which the numbering premise needed checking rather than assuming.

---

## 8. Owner questions

**1. 402 vs 404 on linked-but-unentitled.** R3 says 404 globally. A strict reading collapses
"linked but the student's subscription lapsed" into 404 and silently deletes the paywall path
(`SubscriptionPaywall.tsx`). §1.4 proposes 404 for not-linked and 402 for linked-but-unentitled,
on the grounds that the 402 tells the caller nothing they do not already know. Confirm, or rule
404-for-everything and accept that guardians lose the upgrade prompt.

**2. Admin writes to the link lifecycle.** R5 removes the admin bypass on guardian-gated *reads*,
and §1.5 deletes it. But Doc 01 §16 grants Admin ✓ on "Guardian linking", §36.1 admits
`initiated_by='admin'`, §36.3 names admin revocation via support escalation, and the genesis CHECK
constraint permits `'admin'`. Does R5 extend to those writes — in which case the CHECK constraint's
`'admin'` value becomes unreachable and §16/§36 owe an SCL — or do admin link/revoke survive as
§44 support-mediated, audited operations?

**3. `/mastery/skills` grain.** §10.3 names it **flat**, one route for all of a student's skills.
The live surface is nested per-domain because the UI is a drill-down. Client-side filter over the
flat route, or query params (`?section=&domain=`)? I will not invent a nested path §10.3 does not
specify. Blocks the mastery routes.

**4. `/api/me/mastery/weakest` has no home.** Not named in §10.3. My reading is that it is a
client-side sort over `/mastery/domains` — the same rows, differently presented — and so the route
is deleted rather than moved. Confirm, or it owes an SCL.

**5. Audit record on self-reads.** Under one route serving both callers, does a student reading
their own data emit an access record, or only `via='guardian'` reads? Uniform emission is the
defensible default — a conditional audit has a hole by construction — but it changes event volume
materially and no document rules on it.

**6. `GAP-AL-06` does not exist.** The pending migration registers the dead-column defect there;
`docs/SpecAudit/10-gap-registry/gap-registry.md` has no such entry. A known, load-bearing defect
went untracked for ten weeks because the tracker item was cited but never written. Should the gap
registry gain a CI gate asserting that every `GAP-*` id cited anywhere in the tree resolves to a
registry entry? That is a one-file gate and it would have caught this.
