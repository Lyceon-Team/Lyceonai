# Guardian/student route topology — migration plan and blast radius

**Status:** PLAN ONLY. No code in this document has been written. Owner ruling 2026-08-26:
*"Plan, do not implement yet. Report the blast radius before writing code."*

**Base:** `claude/guardian-parity-step2` @ the commit that carries this file. Read against
`origin/cleanup`.

---

## 1. Why this is not cleanup

Three privilege divergences have now been found, each by a separate collapse of two
independently-written paths:

| # | Divergence | Found by | Closed in |
|---|---|---|---|
| 1 | Guardian route hardcoded `includeHistoricalTrends = true`, so a guardian saw a premium surface the student's own entitlement denied | collapsing the KPI gate onto one resolver | #644 |
| 2 | Guardian exam list computed `reportAvailable` with no entitlement term at all | collapsing the exam-session map onto one projection | #645 |
| 3 | Guardian KPI metric allowlist stripped an entitlement-granted metric back out, so the guardian of a paying student saw LESS than the student | collapsing the metric list onto the builder | this PR |

Three for three. Every collapse of a duplicated path has produced an instance. The class is
structural, not incidental: while two code paths serve one resource, a third instance is not
a risk, it is a schedule. The topology change is the only thing that removes the class,
because it removes the second path.

---

## 2. Target — relationship-based authorization, principal/subject separation

Standard delegated access (Zanzibar-style ReBAC), and what the corpus already specifies.

```
resolveSubject(req):
  principal = req.user.id
  studentId = req.params.studentId
  if principal == studentId            -> subject, via='self'
  else if guardian_link active
       AND student entitlement active  -> subject, via='guardian', linkId
  else                                 -> 404
  req.subject = { studentId, via, linkId }
  audit(principal, studentId, resource, decision)
```

- Resource-oriented paths: `/api/students/{studentId}/...`
- ONE middleware resolves PRINCIPAL (caller) -> SUBJECT (whose data).
- Self and guardian are two branches of ONE resolver, not two routes.
- **404, not 403**, for unrelated callers — non-enumerable (Doc 05B §10.3 step 2, verbatim:
  *"Unrelated authenticated users get 404, not 403 — this avoids leaking whether the
  `student_id` exists"*).
- **200 with `[]`, not 403**, for denied-by-absence, e.g. skill grain (§10.4).
- Below the middleware **no handler learns the caller's role**.
- One audit record per access: `(principal, subject, resource, decision, via)`.

### Spec anchors, verbatim

- **Doc 05B §10.3** names the six routes: `/api/students/{student_id}/mastery/domains`,
  `/mastery/skills`, `/kpi/sections`, `/kpi/domains`, `/kpi/skills`, `/kpi/overall`.
  RB-05B-V1-05: *"route handlers MUST NOT branch into different SQL predicates or
  projections by caller role. A single path-layer authorization check that accepts either
  student-self or active linked guardian is REQUIRED — that check inherently inspects the
  caller-to-student relationship and is the only permitted role-aware branch."*
- **Doc 05C §10.2** names three more on the same shape: `/api/students/{student_id}/projection/sections`,
  `/projection/total`, `/projection/history`.
- **Doc 04C invariant #7** — guardian payloads are a strict subset derived via a projection
  function rather than independently constructed.

### SCOPE CORRECTION — 04C is NOT part of the route collapse

Doc 04C specifies a **separate guardian route** and always did:
`GET /api/guardian/students/:student_id/tests/:session_id/report`, alongside the student's
`GET /api/tests/sessions/:session_id/report`. Its invariant #7 is about the PAYLOAD being a
projected subset — which #645 already delivered — not about route unification.

So the collapse is **05B + 05C resources only**. The exam surfaces stay two-route with one
projection, because that is what their owning document specifies. Folding them into
`/api/students/{id}/...` would be an agent overruling 04C, which is the thing this whole
workstream exists to stop.

**Consequence for the guardian exam routes:** they stay. They are not in the deletion list
below.

---

## 3. Blast radius — measured, not estimated

### 3.1 Routes that move or die

| Live route | Fate | Spec-named replacement |
|---|---|---|
| `GET /api/me/mastery/domains` | DELETE | `GET /api/students/{id}/mastery/domains` (05B §10.3) |
| `GET /api/me/mastery/domains/:section/:domain/skills` | DELETE | `GET /api/students/{id}/mastery/skills` (05B §10.3) — note the spec route is FLAT, not nested per-domain; see Open question 1 |
| `GET /api/me/mastery/weakest` | DELETE or move | not named in §10.3; see Open question 2 |
| `GET /api/guardian/weaknesses/:studentId` | DELETE | `GET /api/students/{id}/mastery/domains` — the same resource, reached by a guardian |
| `GET /api/guardian/students/:studentId/summary` | DELETE | `GET /api/students/{id}/kpi/overall` (05B §10.3) |
| `GET /api/progress/kpis` | DELETE | `GET /api/students/{id}/kpi/overall` — same resource, student caller |
| `GET /api/progress/projection` | DELETE | `GET /api/students/{id}/projection/total` (05C §10.2) |
| `GET /api/guardian/students` | KEEP | roster, not a per-student resource; no student equivalent exists |
| `POST /api/guardian/link`, `DELETE /api/guardian/link/:studentId` | KEEP | link management, guardian-only by nature |
| `GET /api/guardian/students/:id/exams/full-length/sessions` | KEEP | 04C topology (see scope correction); SCL-044 still owed |
| `GET /api/guardian/students/:id/exams/full-length/:sessionId/report` | KEEP | 04C §895 — but the live PATH does not match the spec's `/tests/:session_id/report`; see Open question 3 |
| `GET /api/guardian/students/:id/calendar/month` | KEEP, UNTOUCHED | owner ruling 2026-08-26; SCL-045 PROPOSED |

### 3.2 Client call sites — 9 files, 12 call sites

| File:line | Call |
|---|---|
| `client/src/lib/masteryApi.ts:65` | `/api/me/mastery/domains` |
| `client/src/lib/masteryApi.ts:81` | `/api/guardian/weaknesses/${studentId}` |
| `client/src/lib/masteryApi.ts:93` | `/api/me/mastery/domains/${section}/${domain}/skills` |
| `client/src/pages/mastery.tsx:62,156` | queryKeys for both of the above |
| `client/src/pages/guardian-dashboard.tsx:139` | `/api/guardian/students` (KEEP) |
| `client/src/pages/guardian-dashboard.tsx:157` | `/api/guardian/students/${id}/summary` |
| `client/src/pages/guardian-dashboard.tsx:216,247` | exam sessions + report (KEEP) |
| `client/src/pages/guardian-calendar.tsx:106` | calendar month (KEEP, untouched) |
| `client/src/pages/guardian-calendar.tsx:137` | `/api/guardian/students/${id}/summary` |
| `client/src/pages/lyceon-dashboard.tsx:150,160` | `/api/progress/kpis`, `/api/progress/projection` |
| `client/src/pages/practice.tsx:165,189` | `/api/progress/kpis`, `/api/progress/projection` |
| `client/src/components/progress/ScoreProjectionCard.tsx:29` | `/api/progress/projection` |
| `client/src/lib/projectionApi.ts:122` | `/api/progress/projection` |

### 3.3 How self and guardian clients call the SAME endpoint

The client needs a `studentId` where today the student path needs none. One helper, one
rule:

```
subjectId(auth, selected)  = selected?.studentId ?? auth.user.id
```

- The student surface passes its own id. `/api/students/{me}/kpi/overall` is the student's
  own read; `via='self'` in the resolver.
- The guardian dashboard passes the selected student's id; `via='guardian'`.
- **The query hook, the DTO, and the render component are then identical.** That is the
  point: today `guardian-dashboard.tsx` and `lyceon-dashboard.tsx` render the same KPI facts
  through two different fetches and two different shapes, which is the client-side mirror of
  the same defect class.

### 3.4 Tests in the radius — 26 files

```
server/__tests__/guardian-routes.integration.test.ts
tests/ci/answered-question-count.contract.test.ts
tests/ci/calendar.guardian-parity.contract.test.ts
tests/ci/diagnostic-baseline-pending.contract.test.ts
tests/ci/forbidden-routes.ci.test.ts
tests/ci/guardian-entitlement.admin-audit.contract.test.ts
tests/ci/guardian-full-length-report.contract.test.ts
tests/ci/guardian-kpi-parity.contract.test.ts
tests/ci/guardian-linking.contract.test.ts
tests/ci/guardian-reporting.contract.test.ts
tests/ci/guardian-student-path-parity.contract.test.ts
tests/ci/guardian.anti-leak.ci.test.ts
tests/ci/kpi.gating.contract.test.ts
tests/ci/mastery.anti-leak.ci.test.ts
tests/ci/mastery.read.contract.test.ts
tests/ci/mutation-ownership.contract.test.ts
tests/ci/runtime-law-lockdown.ci.test.ts
tests/ci/surface-ownership.contract.test.ts
client/src/pages/guardian-dashboard.history.test.tsx
+ 7 non-test client files listed in 3.2
```

Note what happens to several of them: **`guardian-kpi-parity.contract.test.ts` and
`guardian-student-path-parity.contract.test.ts` cease to have a subject.** A test that drives
two routes off one mock and compares the bodies is meaningless when there is one route. They
are deleted, not ported — and their deletion is the clearest single measure that the class is
gone.

---

## 4. The chokepoint gate

Any "all routes must X" property is a chokepoint: enforce it once, never per route.

**New gate:** `scripts/ci/subject-resolver-chokepoint-gate.mjs`, blocking step in the `ci` job.

Asserts, over every handler mounted under `/api/students/:studentId`:
1. No reference to `req.user.role`, `isGuardian`, `role === "guardian"`, or `role === "student"`.
2. No import of, or reference to, the guardian link tables/helpers (`guardian_links`,
   `isGuardianLinkedToStudent`, `getAllGuardianStudentLinks`).
3. Every such route is mounted behind the `resolveSubject` middleware — a route present in
   the router but absent from the middleware's mount is a failure, so a new route cannot be
   added unprotected.
4. Zero scanned files is a FAILURE, not a pass (CR-STD-01 — the ceiling-of-zero defect this
   repo has already been bitten by).

| Mutation | Must go red |
|---|---|
| Add `if (req.user.role === "guardian")` inside any such handler | rule 1 |
| Import `isGuardianLinkedToStudent` into a subject-scoped handler | rule 2 |
| Mount a new `/api/students/:studentId/...` route without the resolver | rule 3 |
| Point the gate at an empty pathspec | rule 4 |

The gate is written and proved red BEFORE the first route moves. It is the thing that makes
the topology hold after the migration, and if it lands last it never gets written.

---

## 5. Cutover order

Each step is atomic, ships green, and names the mutation that must red it.

| Step | Change | Proving mechanism | Mutation |
|---|---|---|---|
| 0 | `resolveSubject` middleware + `req.subject` type, mounted on NOTHING | unit test: self, linked+entitled guardian, linked+unentitled guardian, unlinked caller, nonexistent student | unlinked caller returns 403 instead of 404 -> red; unentitled guardian resolves -> red |
| 1 | The chokepoint gate, asserted against the (still empty) mount | gate self-test | empty pathspec passes -> red |
| 2 | `GET /api/students/:id/kpi/overall`, both callers, OLD ROUTES STILL LIVE | parity: new route driven by self and by guardian returns the same body | guardian body differs from self body -> red |
| 3 | Client: `subjectId()` helper; `lyceon-dashboard`, `practice`, `guardian-dashboard`, `guardian-calendar` all move to the new route | render tests on both surfaces | one surface still calling `/api/progress/kpis` -> retired-endpoint gate red |
| 4 | DELETE `/api/progress/kpis` and `/api/guardian/students/:id/summary`; add both to the retired-endpoints gate | retired-endpoints gate | reintroduce either path anywhere in the tree -> red |
| 5 | Same 2-3-4 cycle for `mastery/domains` + `mastery/skills` (retires `/api/me/mastery/*` and `/api/guardian/weaknesses/*`) | mastery anti-leak + render tests | `/api/me/mastery` string reappears -> red |
| 6 | Same cycle for `projection/*` (retires `/api/progress/projection`) | projection contract test | as above |
| 7 | DELETE `guardian-kpi-parity` and `guardian-student-path-parity` test files | — | their deletion IS the evidence; nothing to mutate |

**Old and new run side by side from step 2 until step 4.** No step both adds a route and
deletes its predecessor: a cutover that does is not revertible in one commit.

**No SQL.** Nothing in this plan requires a migration. RLS policies and GRANTs named in
05B §10.1/§10.3 are assumed already applied; step 0's tests will prove whether they are,
and if they are not, that becomes a separate migration authored for Karl to apply — never
applied by me.

---

## 6. Open questions this plan cannot resolve

1. **05B §10.3 names `/mastery/skills` FLAT** — one route for all skills of a student. The
   live surface is nested per-domain (`/domains/:section/:domain/skills`) because the UI is a
   drill-down. Does the drill-down become a client-side filter over the flat route, or does
   the flat route gain query params (`?section=&domain=`)? A nested path is not what §10.3
   specifies, and I will not invent one.
2. **`/api/me/mastery/weakest` is not named in §10.3 at all.** It is either a
   client-side sort over `/mastery/domains` (my reading — it is a presentation of the same
   rows) or an unspecified surface owing an SCL. Ruling needed before step 5.
3. **The live guardian report path does not match 04C.** Doc 04C §895 specifies
   `GET /api/guardian/students/:student_id/tests/:session_id/report`; the live route is
   `/api/guardian/students/:studentId/exams/full-length/:sessionId/report`. Same resource,
   different path. Rename to match the spec, or SCL the divergence?
4. **`via` in the audit record.** Doc 05B does not specify an audit shape for these reads.
   The live guardian routes emit `guardian_report_viewed` / `guardian_dashboard_viewed`
   system events. Under one route serving both callers, does a STUDENT reading their own data
   also emit an access record, or only `via='guardian'` reads? Emitting for both is the
   defensible default (a uniform record is auditable; a conditional one has a hole), but it
   changes event volume materially and no document rules on it.
