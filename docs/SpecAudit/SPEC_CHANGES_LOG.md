# Lyceon Spec-Changes Log

## WHAT IS AN SCL — HARD TEST

Owner ruling 2026-08-31. Apply this BEFORE writing an entry.

**An SCL amends the spec.** It records what a document must say and does not —
whether the spec is WRONG or SILENT. Silence is a legitimate SCL when the gap
must become spec text.

**An SCL is NOT** a decision governing only this build, a defect record, a
test-quality note, or direction for an agent or a prompt.

The test is the OUTCOME:

  - Outcome is "the owner amends a document"  -> SCL
  - Outcome is "we do X in this repo"         -> plan entry

Worked examples, from the 2026-08-31 audit:

  - SCL-070 (spec states seven events, the surface is nineteen) -> SCL. Wrong.
  - SCL-072 (what "full refund" is measured against) -> SCL. The spec is silent,
    but the comparison basis is a permanent rule that belongs in the document.
  - SCL-073 (what a chargeback does to entitlement) -> SCL. Silent, and the
    consequence must become spec text.
  - An error class thrown from thirteen sites with one message -> NOT an SCL.
    Nobody amends a document over it. Plan entry.
  - "The citation column must be verified by the test" -> NOT an SCL. A
    test-quality defect. Plan entry.

A prior framing — "spec-silent means plan entry" — was wrong and is superseded.
Entries written under it were re-audited on 2026-08-31.

## STATUS VALUES

Owner ruling 2026-09-16. Three values, and no others:

  - PROPOSED — the spec should change; it has not been changed yet.
  - RULING    — a decision was recorded and NO amendment is needed. The
                outcome is "the document already says the right thing", or
                "this is not a spec matter after all". SCL-060 is the example.
  - APPLIED   — the amendment named in the entry has been MADE in docs/Spec/.
                The entry keeps its Change/WAS/IS lines as written and records
                what landed and where; an entry is only APPLIED once the text
                is actually in the document, not once it is authorised.

APPLIED is about the AMENDMENT, not about bookkeeping around it. An entry whose
spec text has landed is APPLIED even if something adjacent is still owed — a
change record in the document's own §14, a follow-on decision — provided the
entry says plainly what is outstanding. An entry whose spec text has NOT landed
is PROPOSED, however firmly it has been authorised: authorisation is not
application.

Do not invent a fourth value; if none of these three fits, say so and ask the
owner rather than coining one.

## SCL NUMBER ALLOCATION — HARD OVERRIDE

Never take an SCL number from a prompt, plan, brief, or any instruction —
including one that states a specific number. Instructions are stale by
construction; the register is not.

Before allocating, determine the true maximum across ALL remote branches,
not the current one:

  git fetch --all --prune
  git branch -r --format='%(refname:short)' | while read b; do
    git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md 2>/dev/null
  done | sort -u | tail -1

Then check every OPEN PR for entries not yet on any branch. A number claimed
in an unmerged PR is claimed.

Allocate max + 1. Drafting several in one session allocates sequentially and
states each.

On collision, the LATER allocation renumbers, measured by the entry's own
date. Never renumber another workstream's branch — report it to the owner.

This rule overrides any instruction to the contrary.

---

**Type:** Controlled-write change log. This is the **single document in the corpus that agents MAY write into** — the deliberate exception to the otherwise-strict "agents never write the spec" rule.

**Why this exception exists:** the spec corpus was built over time, and implementation keeps surfacing real, necessary deltas (a platform constraint that invalidates a step, a missed table, an architecture reframe). Those discoveries must be captured *as we build*, at the moment they are found, rather than lost until the owner next revises a doc. This log is where they land.

**Write rules (controlled, not forbidden):**
- **The spec corpus (Docs 00–05E etc.) remains write-protected** — CC and Codex NEVER edit a locked spec doc. That rule is unchanged.
- **This log is the sanctioned exception.** Codex MAY append an entry here when it discovers a spec delta that is *absolutely necessary* (a locked-spec step that is wrong or impossible against reality, a missing classification, a contradiction). CC MAY append when a build forces a delta. They write ONLY to this log, ONLY as a new appended entry, and ONLY for genuine spec deltas — never to record ordinary work, opinions, or proposed-but-unvalidated preferences.
- **An agent-written entry is a PROPOSAL until the owner validates it.** Agent entries are appended with status `PROPOSED`. The owner reviews, then promotes to `OPEN` (accepted, owed into the spec) or marks `REJECTED`. Agents never write `OPEN`/`APPLIED`/`REJECTED`, and never edit or delete an existing entry — strictly append-only.
- **The owner writes freely** — adds, promotes, folds entries into locked docs, sets any status.

**Authority:** this log is authoritative for "what changed since the locked spec and why." When the owner next revises a locked spec doc, the relevant entries are folded in and marked `APPLIED`.

---

## How to use this log

- One entry per delta. Newest at top.
- Each entry: ID, date, status, the change, the reason, the spec doc(s) it touches, and the build artifact (PR / migration) if any.
- **Status values:** `PROPOSED` (agent-appended, awaiting owner validation) · `OPEN` (owner-accepted, owed into the spec) · `APPLIED` (folded into the locked spec doc) · `SUPERSEDED` (replaced by a later entry) · `REJECTED` (owner declined an agent proposal). Agents may only write `PROPOSED`; the owner sets all others.
- Entry IDs: `SCL-NNN` (sequential).

---

## Entries

SCL-080 | 2026-09-01 | Doc 01 V8 §36.1's two email-addressed initiation paths and §36.2's email-scoped abuse controls are replaced by a student-issued link code with no acceptance step | PROPOSED
Change: linking stops being an invitation that a second party accepts and becomes a credential the student holds and shares. The student's account carries a short code; a guardian enters it; the link is `active` on that request. There is no pending state, no acceptance screen, and no email in the mechanism. §36.1 specifies the opposite in both of its paths, and §36.2's two abuse controls are written against an email address that this flow never collects, so both sections change.
WAS, verbatim (Doc 01 V8 §36.1, `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1680-1697`):
  "Two initiation paths:
   **Guardian-initiated:**
   1. Guardian enters student's email on their dashboard
   2. Guardian linking request created with `status = 'pending_student_accept'`
   3. Student receives email with acceptance link
   4. Student clicks → lands on acceptance page after authenticating
   5. Student confirms → `status = 'active'`, `accepted_at` set
   6. Both parties notified
   **Student-initiated:**
   1. Student enters guardian's email on their profile
   2. If student is under-13, this path is the **required** path before any feature access (COPPA flow §37)
   3. Linking request created with `status = 'pending_guardian_accept'`
   4. Guardian receives email; creates guardian account if new, or logs in
   5. Guardian confirms → `status = 'active'`"
  And (Doc 01 V8 §36.2, same file, `:1701-1704`):
  "Guardian linking is rate-limited via Doc 01A `RateLimitLedger`:
   * Per-guardian: max 10 link attempts per day (bucket `guardian_link_attempts:{guardian_id}:{day}`)
   * Per-student-email: max 3 link attempts per day (prevents spam linking to an email)"
  Every step of both paths is addressed to an email and settled by the other party. The second §36.2 bullet protects "an email" — the target address — which under a code flow is never supplied, so the control has no subject.
IS: one path, one party, no pending state.
  - The student's `profiles.student_link_code` holds a 6-character uppercase code from a CSPRNG alphabet excluding `0 O 1 I L`. It is visible in student settings, rotates on a TTL read from `auth_runtime_config`, and is CONSUMED on a successful link with a replacement issued in the same statement.
  - A guardian submits the code. The server resolves it to a student, writes `guardian_links` at `status = 'active'` directly, and audits the transition. No `accepted_at` handshake, because there is no second party to wait for.
  - `pending_student_accept` and `pending_guardian_accept` become unreachable: no code path produces them.
  - §36.2's controls are re-keyed off the email that no longer exists and onto the code: a per-guardian bucket on code ENTRY (the guessing surface) and a per-student bucket on code REGENERATION (the churn surface).
Rationale: the two-step flow has produced ZERO links in production against 14 guardians and 99 students. Two independent causes, both verified: no client surface exists for either acceptance step, on any branch (`git grep` for a caller of `student-resources.ts:568` or `guardian-routes.ts:330` under `client/src` returns nothing on `stripe`, on `main`, or on the pre-merge `stripe` head); and `POST /api/guardian/link` returns 503 regardless, because `rate_limit_runtime_config.bucket_definitions` has never been seeded and `packages/shared/src/services/rate-limit-ledger.ts:190-196` treats an unseeded bucket as a denial by design. The spec's mechanism requires both parties to sign in separately and act; the code requires the student to read six characters aloud. Consent is preserved and relocated: sharing the code IS the consent, and it is a positive act by the student, not a click on a link sent to them.
REINSTATEMENT — recorded so this is not read as drift. This mechanism previously existed and was deliberately REMOVED on 2026-08-26. `server/routes/guardian-routes.ts:172-178` records it verbatim: the route "used to take an 8-character `student_link_code`", and it was replaced by the email input because "§36.1 step 1 reads 'Guardian enters student's email on their dashboard', and `student_link_code` appears NOWHERE in the locked spec corpus... The code mechanism was a pre-spec invention. The owner has ruled spec canonical without exception." That removal was correct under the rule as it stood: the spec said email, so the code went. This entry changes the spec instead, which is the step that was missing the first time. The column and its partial unique index survived the removal (`profiles.student_link_code`, `profiles_student_link_code_key`, zero rows, no writer) and are reused rather than recreated.
Rejected alternative, and its cost: build the two missing acceptance screens against the routes that already exist. That works with NO spec change and NO DDL — both server routes are live and tested, and the gap is purely client-side. It was rejected because it preserves the friction that produced zero links: the guardian invites, then the student must separately receive a message, sign in, find the acceptance surface, and confirm, before anything exists. The code collapses that to one party acting once. The cost of the rejection is this entry, four owner-applied DDL/DML items, and the deletion of a working server-side state machine.
Known consequence — UNDER-13, stated and not resolved here. §36.1's student-initiated path carries step 2: "If student is under-13, this path is the **required** path before any feature access (COPPA flow §37)". Deleting that path deletes the sentence that makes it mandatory. Production holds 2 profiles with `is_under_13 = true` and 0 rows in `guardian_consent_requests`, so the requirement is already unmet independently of this change. §37's token flow is a separate mechanism and is NOT replaced by this entry. Owner ruled under-13 handling out of scope for the build; recording the interaction because an SCL that deletes the path §36.1 makes mandatory, without saying so, is incomplete.
Known residual: Doc 01A's ledger is keyed on `profile_id` (`rate_limit_check_and_increment(p_profile_id uuid, ...)`), so a per-IP or global limit on code entry is not expressible. An unauthenticated attacker has no bucket. Code entry requires an authenticated guardian, which bounds the exposure to accounts rather than requests, but the residual is real and is recorded rather than designed around.
Owner action: amend §36.1 to specify the single code path and delete both email paths, or mark this REJECTED, in which case the two acceptance screens are the work and this entry's deletions revert. Amend §36.2's two bullets to name the code buckets rather than the guardian/email pair. If §36.1's under-13 sentence is to survive the deletion of its path, it needs a new home in §37.
Build artifact: `claude/guardian-link-code`. Proof: PG-backed contract tests per the guardian schema-truth gate, covering single-use consumption under a concurrent race, the identical response for used/expired/invalid, and revoke → re-link → revoke.

SCL-079 | 2026-09-01 | Doc 03B §3.4 / INV-03-02 — live exam gate fails OPEN on query error | PROPOSED
Change: `isLiveExamInProgress` (entitlement-service.ts) failed closed on any DB error, returning
  `true` (exam in progress → block tutor access). The queried table (`full_length_exams`) does not
  exist — the correct table is `full_length_exam_sessions`, and neither is in the production
  genesis schema (the exam vertical is unbuilt). The query errored on every call, the error path
  returned `true`, and LISA returned `403 tutor_unavailable_during_live_exam` on every
  POST /messages for every student. Total LISA outage, no exam to finish, block can never clear.
WAS: query error → `return true` (fail closed). No distinction between "active exam found" and
  "query failed." Table name `full_length_exams` (no migration, does not exist). Column name
  `student_id` (correct column is `user_id`).
IS: query error → `return false` (fail OPEN), log warning. Table name corrected to
  `full_length_exam_sessions`. Column corrected to `user_id`. When the query succeeds: active
  exam row → `true` (block, INV-03-02 enforced); no row → `false` (allow).
Rationale (Karl ruling 2026-09-01): SCL-032's threat model governs. A student in another tab has
  Gemini, ChatGPT, and search, all of which give more than an anti-leak tutor. The exam block is
  low-value integrity protection — its absence during infrastructure failure costs little.
  Blocking ALL tutoring — which is what a fail-closed gate on a missing table does — costs a lot.
  This is a narrow, stated exception: every other fail-closed gate on the LISA surface
  (entitlement, anti-leak, crisis) stays closed. The exception is justified only because (a) the
  threat model is weak (SCL-032), (b) the failure mode is total (100% of traffic, not one
  student), and (c) the block can never clear (no exam exists to finish). None of these three
  conditions hold for entitlement or anti-leak gates.
Scope: this fail-open applies ONLY to `isLiveExamInProgress`. It does NOT generalize. Do not
  copy this pattern without an owner ruling. SCL-032 narrowed WHERE INV-03-02 applies (POST
  /messages only); this SCL narrows HOW the gate behaves when it cannot run.
Bugs fixed in the same change:
  - Table name: `full_length_exams` → `full_length_exam_sessions` (matches all 22 query sites in
    `fullLengthExam.ts` and the pre-baseline migration `20260213_full_length_exam_hardening.sql`).
  - Column name: `student_id` → `user_id` (matches the actual schema).
Version: no spec amendment — INV-03-02 is unchanged, and the fail-open is a runtime posture
  decision, not an invariant change. The invariant ("LISA is unavailable during live full-length
  exam") remains true when the exam vertical exists. This SCL governs what happens when the
  vertical does not exist or is unreachable.
Owner action: confirm PROPOSED → OPEN. No spec edit needed unless the exam vertical's absence
  should be noted in Doc 03B §3.4.
Artifact: `server/services/entitlement-service.ts` `isLiveExamInProgress`. PR against `main`.

SCL-078 | 2026-08-28 | Doc 01 V8 §16 grants Admin `✓` on linked-student read; R5 denies it | PROPOSED
Change: the admin bypass on guardian-gated reads is deleted (owner ruling 2026-08-28, "R5 reaches all four bypasses"; `guardian-rebuild-design-spec` §1.5). Doc 01 V8 §16's permission matrix still grants it. The implementation is now stricter than the locked spec, deliberately, and that gap is recorded here rather than left for a reader to find as a defect.
WAS, verbatim (Doc 01 V8 §16 permission matrix, `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:776`):
  | Linked student profile read | Student — | Guardian **Aggregate only** | Admin **✓** |
  | Mastery (own)               | Student ✓ | Guardian **Aggregate only for linked** | Admin **✓** |
  Read plainly, Admin `✓` on "Linked student profile read" is an unqualified grant: broader than the guardian's own "Aggregate only", with no link requirement, no entitlement requirement, and no scope note. The code implemented exactly that, in four places, and cited "Doc 01 **V6** §543" — a document version no longer in the corpus, so the citation could not be checked against anything.
IS: denied. Four bypasses removed:
  - `server/middleware/guardian-entitlement.ts` — `if (userRole === 'admin') return next()`, which skipped BOTH the link check and the entitlement check for all three entitlement-gated read routes. An admin now falls through to the `userRole !== 'guardian'` denial.
  - `server/routes/guardian-routes.ts` ×3 — `const isAdmin = req.user!.role === "admin"` with the `isGuardianLinkedToStudent` call wrapped in `if (!isAdmin)`, on the full-length session history, the full-length report, and the calendar. Each is now an unconditional link check.
  The bypass's `admin_surface_access` audit record goes with it: there is no admin access left here to record.
Rationale: §1.5 records the reasoning and the non-goal. A role bypass is unrevocable, unlimited in scope, and invisible to the family it concerns; the same operational need is met by a student-or-guardian-initiated, time-boxed, audited GRANT — a row with an expiry the subject can revoke. Note also that §16's own guardian row says "Aggregate only" while the admin row says `✓` with no qualifier, which reads less like a considered widening than like the admin column being filled in uniformly down the table: Admin is `✓` on all fifteen rows of the matrix, and five of those cells carry a scope qualifier — "(own)" twice, "(via Doc 02A flow)", "(process requests)", "(support-mediated)" — while the two linked-student read rows carry none. The matrix is a capability sketch, not an access-control specification, and it was being read as the latter.
SCOPE — reads only, and this is the boundary that matters. Admin WRITES to the link lifecycle are NOT touched: Doc 01 §16 grants Admin `✓` on "Guardian linking", §36.1 admits `initiated_by='admin'`, §36.3 names admin revocation via support escalation, and the genesis CHECK constraint permits `'admin'`. Those four routes (`GET /students`, `POST /link`, `POST /link/:linkId/accept`, `DELETE /link/:studentId`) never carried the entitlement middleware and are untouched. `server/middleware/guardian-role.ts` still admits admin, which is what lets them reach those four; on the three read routes it now leads to a denial one middleware later. That question is open — `guardian-rebuild-design-spec` Owner Question 2 — and this entry does not answer it.
Owner action: amend §16 so the Admin cells on "Linked student profile read" and "Mastery (own)/for linked" state the actual posture — either "—" (no per-student read through guardian surfaces) or "✓ (support-mediated, time-boxed grant)" naming the mechanism §1.5 proposes. If instead the unqualified grant IS intended, mark this REJECTED; the four bypasses come back and §1.5 owes a rewrite. Separately: §16's Admin column would benefit from qualifiers throughout, since five of its fifteen `✓` cells already carry one and the unqualified remainder are being read as unrestricted.
Build artifact: `claude/guardian-link-lifecycle` step 5. Proof: `tests/ci/guardian-entitlement.no-admin-bypass.contract.test.ts` (4 cases, 3 mutations each reddening exactly one) and the `R5 — no route-level admin skip` block in `tests/ci/guardian-reporting.contract.test.ts` (3 cases, 3 mutations each reddening exactly one).

SCL-077 | 2026-08-28 | Doc 01 V8 §36.2 — the two link rate limits read as guardian-direction controls; they are implemented as initiator/target controls shared across both directions | PROPOSED
Change: §36.2's two controls are now consumed by BOTH linking directions from a single pair of buckets. §36.2 is written in guardian-direction vocabulary and the student direction is now live (§36.1 "Student-initiated"), so the sentence and the code no longer read the same way. Recording the reading, not changing it.
WAS, verbatim (Doc 01 V8 §36.2, `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1699`):
  "Guardian linking is rate-limited via Doc 01A `RateLimitLedger`:
   * Per-guardian: max 10 link attempts per day (bucket `guardian_link_attempts:{guardian_id}:{day}`)
   * Per-student-email: max 3 link attempts per day (prevents spam linking to an email)"
  Both bullets name a ROLE. Read literally, the first is keyed on a guardian id and the second protects a student's address — which is the guardian→student direction described in §36.1 "Guardian-initiated". §36.1 also specifies "Student-initiated" (step 1: "Student enters guardian's email on their profile"), and §36.2 says nothing about it. Under a per-direction reading, a student inviting a guardian falls outside both bullets and is unlimited.
IS: one pair of buckets, keyed on the AUTHENTICATED INITIATOR and on the TARGETED ADDRESS, consumed by both directions.
  - `server/middleware/guardian-link-rate-limit.ts:93` keys control 1 on `req.user?.id` — whoever is authenticated — against the literal bucket `guardian_link_attempts_daily` (`:45`), the name Doc 01A §46 registers.
  - `:130` keys control 2 on the digest of the address in the request body (`guardianLinkEmailBucketKey`), whatever address that is.
  - Neither key is direction-specific, so the same middleware is mounted unchanged on the guardian route (`server/routes/guardian-routes.ts:212`) and on the student route (`server/routes/student-resources.ts:373`). A student's invitation and a guardian's invitation draw down the SAME two buckets.
Rationale: the quantities §36.2 protects are "how many invitations one account sends in a day" and "how many invitations one address receives in a day" — neither depends on which role sent them. Forking a second pair for the student direction would leave each bucket counting half the traffic while both bullets kept their stated numbers, i.e. it would double the real limits while appearing to preserve them. Shared buckets are the STRICTER reading, and strictness is the correct default for an abuse control on a surface that emails a stranger. The per-direction reading is defensible from the text alone, which is exactly why it is written down here: without this entry the next reader compares §36.2's role words to the code's role-agnostic keys and files a defect against working, deliberately-stricter behaviour.
Known consequence, stated rather than discovered later: a student who has spent the day's 10 invitations cannot then be invited-by-proxy through their own account, and a guardian and a student who invite each other in the same day share one 3/day cap on each other's address. Both follow from the shared reading and are intended.
Related and NOT settled by this entry: the per-email bucket's key FAMILY (`guardian_link_email_attempts`, `guardian-link-rate-limit.ts:54`) is introduced by WS-GL and is not in Doc 01A §46's consumer table or Appendix A.3's launch seed. §36.2 names the 3/day limit but no bucket key. That naming gap is separate from the per-direction question and is already flagged in the middleware's own docblock (`:47-53`).
Owner action: amend §36.2 to state the controls in direction-neutral terms — "per initiating account: max 10 link attempts per day" and "per targeted email address: max 3 link attempts per day" — and add one sentence saying the buckets are shared across both §36.1 directions. If instead the limits ARE intended per-direction, mark this REJECTED and the student route needs its own bucket pair, which is a code change, not a doc change.
Build artifact: no code change. The behaviour described is what `claude/guardian-link-lifecycle` step 2 shipped; this entry records the reading it depends on.

SCL-076 | 2026-08-26 | Doc 03 INV-03-05 / §1681 / CR-03-20 / CR-03-31 and Doc 03A §1581 — the guardian CALENDAR is named but never specified | PROPOSED
Renumbered: allocated `SCL-045` on `cleanup` 2026-08-26; renumbered to `SCL-076` at the `main`→`cleanup` merge on 2026-08-27, resolving an ID collision with the Stripe entry that independently took `SCL-045` on 2026-08-20. Direction follows the citation counts measured at the merge, per the owner ruling recorded on `SCL-042`/`SCL-054`: the Stripe `SCL-045` had **28** citations outside this file, this entry had **3**. Citations to this entry were rewritten in the same change. The 2026-08-26 date is the original and is retained.
Change: `GET /api/guardian/students/:studentId/calendar/month` is live and consumed by `client/src/pages/guardian-calendar.tsx`, and five passages across two locked documents name a guardian calendar — but none of them specifies one. This entry asks for a ruling; it proposes no change to either document's intent.
WAS: five citations, all verbatim:
  - Doc 03 INV-03-05: "Guardian dashboard pulls only from mastery, KPI, and calendar sources — never from LISA tables."
  - Doc 03 §1681: "Guardians see KPIs, mastery, and calendar — all of which are derived from Doc 02B runtime engine events and Doc 02C mastery state, none of which flow through LISA."
  - Doc 03 CR-03-20: "guardians see only KPI, mastery, and calendar per Doc 01 V6."
  - Doc 03 CR-03-31: "Guardian visibility limited to KPI, mastery, and calendar per Doc 01 V6."
  - Doc 03A §1581: "A guardian querying `guardian_dashboard_view` sees mastery, KPI, calendar — all derived from Doc 02B and Doc 02C data, never from tutor tables."
  Every one of the five is a LISA-BOUNDARY statement: each is asserting that guardians see nothing originating in LISA, and names the calendar only as a member of the not-LISA list. None gives the surface a route, a payload shape, an entitlement rule, or an acceptance criterion. Doc 04 owns the calendar and specifies no guardian read of it.
  Two of the five (CR-03-20, CR-03-31) chain their authority to "Doc 01 V6", a version no longer in the corpus — the surviving unversioned Doc 01 is V8.0, which supersedes it. The authority those two cite cannot be read.
  Doc 03A §1581 additionally names `guardian_dashboard_view` as the object a guardian queries. No such view exists: it appears exactly once in the entire repository, in that sentence. Zero code references, zero schema references, zero migrations. (`guardian_dashboard_viewed`, which does appear in code, is an audit EVENT TYPE — a different identifier.)
IS: owner ruling 2026-08-26 — do NOT delete the guardian calendar. All five citations name it in a not-LISA list, and two chain to a superseded Doc 01 version, so the passages are too weak to treat as a specification but not weak enough to treat the surface as drift. The route is kept, and nothing further is invested in it until it is specified.
Rationale: the standing rule is that code which cannot be traced to a spec section or a recorded ruling is drift and is deleted. This surface sits exactly on the line: it is NAMED in locked documents four times, which is more than drift ever gets, and SPECIFIED zero times, which is less than a surface needs. Deleting a surface four locked passages name would be an agent overruling the corpus on a technicality of citation strength. Recording the ambiguity is the correct move; the repo is not evidence either way.
Owner action: (a) rule whether a guardian calendar is a specified V1 surface; if yes, name the owning document and §-cite the payload contract, the entitlement rule, and the read grain; if no, mark this entry REJECTED and the route is deleted under the drift rule. (b) Separately, decide the fate of `guardian_dashboard_view` in Doc 03A §1581 — it is a phantom object and the sentence should either name a real view or drop the object reference.
Build artifact: none. No code change accompanies this entry — that is the point of the ruling.

SCL-075 | 2026-08-24 | Doc 04C §12.4 — the guardian full-length SESSION LIST has no owning document | PROPOSED
Renumbered: allocated `SCL-044` on `cleanup` 2026-08-24; renumbered to `SCL-075` at the `main`→`cleanup` merge on 2026-08-27, resolving an ID collision with the Stripe entry that independently took `SCL-044` on 2026-08-20. Direction follows the citation counts measured at the merge, per the owner ruling recorded on `SCL-042`/`SCL-054`: the Stripe `SCL-044` had **19** citations outside this file, this entry had **4**. Citations to this entry were rewritten in the same change. The 2026-08-24 date is the original and is retained.
Change: `GET /api/guardian/students/:studentId/exams/full-length/sessions` is live and consumed by the guardian dashboard, and no document in the corpus specifies it. Doc 04C owns the guardian exam surfaces but §12.4 explicitly disclaims multi-session aggregation: "04C does NOT serve an aggregated multi-student endpoint. If Product wants a 'guardian dashboard' with multi-student rollup, that is a separate aggregation layer owned by Doc 01 or a future dashboard doc — NOT by 04C." No such doc exists. The 05 family owns mastery/KPI/projections, not exam session history.
WAS: unspecified. The route projects `listExamSessions` output inline in the handler (`server/routes/guardian-routes.ts`), independently of the student route's projection of the same service (`server/routes/full-length-exam-routes.ts:268`), so the two shapes can drift with nothing to catch it.
IS: owner ruling 2026-08-23 — the capability is wanted and is to be kept, specified, and collapsed onto a shared projection rather than deleted as drift. The invented `reviewAvailable: false` field is removed immediately and separately: there is no guardian review endpoint, so the value was not `false`, it was UNKNOWN, asserted as a fact on a parent's screen (same class as the `?? 0` that told a parent their child had answered nothing).
Rationale: the capability is obviously wanted — a guardian seeing their child's completed exams — it simply was never written down. Recording it here rather than inferring a home for it from the code, per the standing rule that the repo is not evidence.
Owner action: name the owning document for the guardian exam session list, then §-cite it so the shared projection can carry a spec reference.
Build artifact: field removal + the guardian anti-leak gate in this PR; the shared-projection extraction is gap-closure step 6, not yet built.

SCL-074 | 2026-08-24 | Doc 05 Parent AC#19 vs Doc 05B §10 — "raw KPI rollups, KPI counters" on guardian routes | PROPOSED
Renumbered: allocated `SCL-043` on `cleanup` 2026-08-24; renumbered to `SCL-074` at the `main`→`cleanup` merge on 2026-08-27, resolving an ID collision with the Stripe entry that independently took `SCL-043` on 2026-08-20. Direction follows the citation counts measured at the merge, per the owner ruling recorded on `SCL-042`/`SCL-054`: the Stripe `SCL-043` had **36** citations outside this file, this entry had **1**. Citations to this entry were rewritten in the same change. The 2026-08-24 date is the original and is retained.
Change: two locked documents read differently on their face about whether a guardian route may return KPI aggregates. This entry records the owner's governing reading; it proposes no change to either document's intent.
WAS: Doc 05 Parent AC#19 (RB-05P-V1-12): "No guardian-accessible route exposes per-skill mastery rows, per-question rows, raw KPI rollups, KPI counters, or audit log rows." Read literally, that forbids a guardian route returning a streak count or a 7-day question count. Doc 05B §10 grants guardians SELECT on `student_section_kpi`, `student_domain_kpi` and `student_overall_kpi` under active-link-AND-active-entitlement, and its own worked example queries `events_total, events_last_7d, accuracy_last_7d, current_streak_days, last_active_at` from `student_overall_kpi` as the guardian-side "How active is my child?" path. Doc 05B §2.4 and §10 table say the same. The live guardian summary route returns exactly those counters.
IS: owner ruling 2026-08-23 — the test is "does the student see it," not "is it a counter." AC#19 forbids exposing INTERNAL MACHINERY: raw rollup rows, per-skill mastery rows, per-question rows, audit logs. 05B §10 grants the table SELECT that any guardian read requires, because under the 05B §10.3 single-route contract the guardian read IS the student query. A streak or a 7-day accuracy the student sees on their own dashboard is not "raw" — it is the same derived aggregate, read through a gate. A counter no student surface renders stays internal. The governing principle: the guardian sees exactly what the student sees, no more and no less.
Rationale: the two documents are answering different questions — AC#19 answers "what may cross the boundary," 05B §10 answers "what must the query be able to read for the student path to work at all." They only appear to conflict if AC#19's "raw" is read as "numeric." Under this reading, the guardian KPI summary route is repaired to be the student envelope filtered to granted metrics, not deleted.
Consequence recorded, not yet built: the guardian summary currently emits a guardian-only `progress` object restating three values already present in `metrics`, and a `measurementModel` whose `official: []` / `weighted: []` are hardcoded duplicates of the shared builder's own value rather than passed through — so if the builder ever populates them the guardian's copy stays empty. Both are gap-closure steps 3-5.
Owner action: confirm this reading, then fold it into AC#19's wording so the next reader does not have to rediscover the distinction.
Build artifact: the privilege-divergence fix and the guardian anti-leak gate in this PR; the G2 collapse is steps 3-5.

SCL-060 | 2026-08-28 | Doc 03D §6.2, §6.3, §6.6 — active question explanation is internal context, not an anti-leak surface | RULING

Change: owner ruling (Karl, 2026-08-28) reframes the active question's explanation. It is
  internal context — direction on how LISA should explain the question — not an anti-leak
  surface. What reaches the model is a separate question from what reaches the student.
  The leak boundary is INV-03-04: LISA writing the answer to a student. This supersedes
  the original SCL-060 framing (2026-08-26) which treated the explanation as a dangerous
  payload whose retrieval was the leak risk.

Rule: the active question's explanation is delivered on `question_content.explanation` for
  all surfaces, pre-submit included. Delivery is via one path: `resolveQuestionContent` in
  `tutor-context.ts` resolves the active question from `practice_session_items` and always
  populates `explanation`. The gate is which question (the active one), not which surface.

Doc 03D §6.2 still governs behavior: the explanation is ground truth LISA reasons against,
  never content it recites. Verbatim restatement to a pre-submit student is an answer
  disclosure regardless of framing — the anti-echo directive in `renderItemBlock`
  (`render-state-blocks.ts` lines 140–149) enforces this at the prompt layer, INV-03-04
  at the output layer. Both layers remain load-bearing.

MCQ single-letter risk — verified absent 2026-08-28: 4,570 MCQ questions in production.
  Zero matches for "answer is <letter>", "choice <letter>", or "option <letter>". Eleven
  regex hits are trigonometric angle labels in LaTeX — `\cos(B)`, `\sin(A)`, `\tan(D)` —
  not option letters. This removes the MCQ single-letter risk that drove the original
  caution. A future authoring change could reintroduce it; the verification method and date
  are recorded here for re-run.

Dropped: the "previously seen same-skill questions" provision from the original SCL-060.
  It was unwireable — `question_content` is single-item and multi-item delivery would
  require a parallel wire path that does not exist. More importantly it is not needed: the
  intent is the active question's explanation, nothing else. Removing it makes the shipped
  implementation complete. If same-skill history proves necessary later, that is a new SCL
  with a real use case.

Grid-in residual risk: grid-in explanations carry the answer value directly (e.g. "the
  answer is 7/4"). The anti-echo directive and INV-03-04 output serializer are the
  defenses. The leak probe (`tests/eval/lisa-leak-probe.ts`) covers grid-in golden-set
  cases (CASE-07, CASE-08) for this reason.

WAS (original SCL-060, 2026-08-26): framed the explanation as a "dangerous payload" whose
  retrieval pre-submit was an accepted narrowing of the defense perimeter. Required an
  "answered + active" allowlist filter on `tutor-retrieval.ts`. Included a provision for
  previously-seen same-skill questions.
IS: the active question's explanation is internal context populated unconditionally on
  `question_content.explanation`. No retrieval-scope filtering applies to it (it is not
  retrieved via `tutor-retrieval.ts` — it travels on the `question_content` wire field
  populated by `resolveQuestionContent`). The defense is behavioral: anti-echo directive
  (prompt layer) + INV-03-04 (output layer).

Version: Doc 03D V1.2 §6.3 surface gating table is superseded — the "NEVER" cell for
  active question explanation on practice pre-submit no longer applies. §6.2 (explanation
  as ground truth, not script) and §6.6 (deterministic retrieval for same-skill context)
  are unchanged in intent but §6.3's table must be amended to match.
Owner action: amend Doc 03D per the following (see "Doc 03D amendments owed" below).
Artifact: `server/services/tutor-context.ts` lines 328–417 (resolveQuestionContent);
  `apps/workers/tutor-orchestrator/src/prompts/render-state-blocks.ts` lines 88–161
  (renderItemBlock, anti-echo directive). Tests: `tests/ci/lisa-audit-b1.8-proof.contract.test.ts`;
  `tests/eval/lisa-leak-probe.ts` (golden-set grid-in and MCQ cases).

Doc 03D amendments owed:
  1. §6.3 surface gating table: change active question explanation for "Practice, pre-submit"
     from "NEVER" to "Permitted (internal context)". Add footnote: "The explanation is
     internal context for model reasoning (SCL-060). The anti-echo directive in the prompt
     layer and INV-03-04 at the output layer prevent disclosure to the student."
  2. §6.3 paragraph "Explanations are answer-adjacent by construction": soften to
     acknowledge the ruling — the explanation travels to the model but the leak boundary
     is the output serializer, not the retrieval scope.
  3. §6.6 Path 1: note that the active question's explanation travels on
     `question_content.explanation` (populated by BFF `resolveQuestionContent`), not via
     the `tutor-retrieval.ts` deterministic query. The retrieval query serves same-skill
     prior-question explanations only.
  4. §6.2: no amendment needed — its framing ("the explanation is not a script; LISA never
     recites it") already matches the ruling.

SCL-DRAFT-B-resume-billing-anchor | 2026-08-31 | Doc 01 does not state whether a won dispute preserves the subscription's billing cycle; it must | PROPOSED

Change: REINSTATED as an SCL 2026-08-31. This entry was briefly withdrawn to a plan entry
  under the framing "the spec is silent, so it is not an SCL". That framing was wrong.
  Whether a customer who WINS a dispute keeps the billing cycle they paid for is a permanent
  rule about what we owe a payer, not a decision local to this build, so it belongs in Doc 01.
WAS: Doc 01 says nothing about the billing cycle on dispute resume. Because the spec is silent,
  the behaviour is currently decided by an SDK default nobody chose.
  `server/lib/stripe/webhook-handler.ts:988` resumes a paused subscription after a dispute is
  won with no params:
      await getStripeClient().subscriptions.resume(target.subscriptionId);
  Per the pinned SDK, `node_modules/stripe/types/SubscriptionsResource.d.ts:2145`,
  `billing_cycle_anchor` defaults to `now`. So winning a dispute silently RESETS the renewal
  date: the period restarts from the resume instant rather than continuing the cycle the
  customer paid for. Nobody decided that; it is what happens when the argument is omitted.
IS (PROPOSED): Doc 01 states the rule explicitly, and the code passes the argument explicitly
  rather than relying on a vendor default. The two candidates, with what each costs:
    - `billing_cycle_anchor: 'now'` — today's behaviour, by default rather than by choice. The
      renewal date moves. A customer who won a dispute has their billing date shifted with no
      notice, which is a change to what they bought.
    - `billing_cycle_anchor: 'unchanged'` — the cycle they paid for is preserved, but Stripe
      generates prorations for the paused interval, which appears on the next invoice.
  Neither is free. This entry does not pick one — that is the owner's ruling — but it does
  rule out the third option, which is leaving it implicit.
Owner action: decide the rule, amend Doc 01 to state it, and only then change the call site.
  `subscriptions.resume` is UNCHANGED until that ruling.
Artifact: `server/lib/stripe/webhook-handler.ts:988`. SDK evidence:
  `node_modules/stripe/types/SubscriptionsResource.d.ts:2145`.
Number: NOT ALLOCATED. Provisional id only; the owner assigns at merge.

SCL-DRAFT-A-declared-country | 2026-08-31 | Doc 01 §4 specifies ONE authoritative `country_code`; collecting a declared country at signup proposes TWO columns with different authorities | PROPOSED

DEFERRED 2026-08-31 — OWNER RULING. This is NOT the Stripe vertical's work and is not
  blocked on it. It goes to the signup team, and the entry stays drafted and unallocated for
  whoever picks it up.
  WHY BILLING DOES NOT WAIT FOR IT: the INV-03-08 gate derives its country from the STRIPE
  BILLING ADDRESS at `checkout.session.completed`, which exists whatever signup collects. A
  declared country would be a second signal and a pre-purchase courtesy — never the control —
  so no billing path is blocked by its absence.
  THE ONE LINE THE HANDOFF MUST CARRY: the ruling must state WHICH COLUMN EACH READER
  CONSUMES, not only the eligibility gate. There is already a non-billing reader of this
  column (`server/routes/tutor-runtime.ts:904-908`), and a split done for the gate alone
  would leave it reading the wrong one.

Change: The owner directs that account creation collect a country from a dropdown. Doing so cannot
  be done under §4 as written, because §4 does not merely omit a declared country — it declares the
  single column's authority in a way a second writer would contradict. That is the spec error this
  entry records. NOTHING IS BUILT: this is the schema ruling the work waits on.
WAS: Doc 01 (heading verified: "## **§4 Profile schema (target-state)**", line 129) declares at
  line 147:
      country\_code TEXT,  \-- ISO 3166-1 alpha-2, from billing address (authoritative)
  Two claims in one comment: the encoding, and that the value comes FROM BILLING ADDRESS and is
  AUTHORITATIVE. A signup dropdown writing this same column would give one field two writers with
  different authorities — a falsifiable self-declaration and a payment-verified fact — which is the
  parallel-paths-built-differently pattern this corpus already forbids elsewhere.
IS (PROPOSED, not built): split the field by authority rather than overloading one column.
      declared_country_code   -- ISO 3166-1 alpha-2, self-declared at signup. NOT authoritative.
      billing_country_code    -- ISO 3166-1 alpha-2, from the Stripe billing address. Authoritative.
  The INV-03-08 gate reads billing when present and declared when not, and RECORDS a
  declared-vs-billing mismatch rather than silently resolving it. Doc 01A §52's incident taxonomy is
  where that mismatch belongs as an abuse signal; this entry does not itself add an incident type.
THE FAIL-OPEN RISK, stated plainly because it is the whole reason for the split: a declared country
  used AS the gate would admit anyone willing to select a different item from a dropdown. INV-03-08
  would then be enforced against a value the person being gated chooses. That is not a weaker
  control, it is no control — and it would fail silently, because a falsified declaration is
  indistinguishable from a true one at the point of reading. Billing address stays authoritative for
  exactly this reason: it is asserted by the payment network, not by the user. A declared country is
  a SECOND SIGNAL and never the control.
  Corollary the implementation must honour: `declared_country_code` present and `billing_country_code`
  absent is NOT eligibility. It is a pre-purchase courtesy signal — enough to tell someone at signup
  that we are not available where they say they are, never enough to grant.
What it buys, and why it is worth a schema change:
  1. Country data before any purchase. `profiles.country_code` is null on all 115 rows today (owner-
     verified), so free-tier students have no country at all.
  2. An ineligible user learns at signup rather than after building a study plan.
  3. A declared-vs-billing mismatch becomes an abuse signal against Doc 01A §52's taxonomy.
SECOND CONSUMER, found while drafting and material to the ruling: the country column is already read
  outside billing, at `server/routes/tutor-runtime.ts:904-908`:
      .select("country_code")
      getCrisisResponse((profileRow?.country_code as string | null) ?? "US")
  That selects CRISIS-RESPONSE content for a student in distress, and because the column is null on
  every row today, every student currently receives US crisis resources regardless of where they
  are. This changes the shape of the decision in two ways the owner should weigh:
  - It is an argument FOR collecting a declared country early, independent of billing: for crisis
    routing, a self-declared country is not merely acceptable, it is the RIGHT signal, because a
    student in distress has usually not purchased anything and nobody falsifies their country to get
    worse crisis resources. The incentive that makes declaration untrustworthy for a paywall does not
    exist here.
  - It means "which column does this consumer read" must be answered for every reader, not just the
    gate. A split done carelessly would leave this call site reading the wrong one, and its failure
    mode is silent and safety-relevant, not financial.
  AUDITED FURTHER, 2026-08-31, and it is worse than "reads the wrong column": the caller's
  `?? "US"` is only half of it. `getCrisisResponse` falls back to `DEFAULT_CRISIS_RESPONSE`
  (`server/services/tutor-crisis.ts:85`), which is BYTE-IDENTICAL to the `US` entry (`:75`) —
  verified by string comparison. So there is no generic unknown-country response in the system
  at all, and deleting the `?? "US"` would change nothing. Every student outside the eight
  listed codes receives a US-only number by the same fallback, even once countries ARE being
  collected. Written up in full, unrouted and urgent, at
  `docs/plans/FINDING_crisis_resources_default_to_US.md`. That finding is NOT this SCL's to
  fix and is not a billing defect.
  Two consequences for THIS ruling, and they are binding on it:
  1. The ruling must state WHICH COLUMN EACH READER CONSUMES — not only the eligibility gate.
     This reader fails silently and it is a safety surface, not a financial one, so "the gate
     reads billing, everything else figures itself out" is not an answer.
  2. The incentive argument is asymmetric and should be recorded as such: NOBODY FALSIFIES
     THEIR COUNTRY TO RECEIVE WORSE CRISIS RESOURCES. The property that makes a declared
     country untrustworthy for a paywall simply does not exist on the crisis path, so a
     self-declared country is not merely tolerable there — it is the RIGHT signal. A schema
     that treats "declared" as second-class everywhere would get this reader wrong.
Owner action, and the order it has to happen in:
  1. Rule on the schema shape: two columns as proposed, or another shape.
  2. Rule on which column each existing reader consumes — the INV-03-08 gate, and the crisis-response
     path above.
  3. Rule on where the dropdown lives in the signup flow.
  Only then is there code to write. No DDL is queued by this entry and none should be until (1).
Artifact: `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md` §4 line 147
  (the contradicted declaration). Current readers: `server/lib/stripe/country-eligibility.ts`,
  `server/routes/tutor-runtime.ts:904-908`. Writers today: none.
Number: NOT ALLOCATED. Provisional id only; the owner assigns at merge.

SCL-DRAFT-A-tier1-iso-literal | 2026-08-31 | Doc 01 Appendix A.4 seeds `tier_1_countries` with `UK`, which is not an assigned ISO 3166-1 alpha-2 code | PROPOSED

Change: Doc 01 Appendix A.4's launch value for `tier_1_countries` contains a country code that does
  not exist in the standard the same document mandates. The gate that reads this config went live in
  production today, so the literal is no longer a documentation defect.
WAS (spec, current): Doc 01 Appendix A.4 (heading verified: "## **A.4 `entitlement_runtime_config`**")
  seeds
      | `tier_1_countries` | `["US","CA","UK","AU","NZ","IE","SG"]` | — | — | Product | Countries where LISA/premium is available |
IS (proposed): `["US","CA","GB","AU","NZ","IE","SG"]` — one element changes, `UK` to `GB`.
Why: `UK` is not an assigned ISO 3166-1 alpha-2 code. `GB` is the alpha-2 code for the United Kingdom.
  Three independent confirmations, each read rather than asserted:
  1. THE SPEC CONTRADICTS ITSELF, and A.4 is the side in error. The same document, at
     "## **§4 Profile schema (target-state)**" (heading verified, line 129), declares at line 147:
         country\_code TEXT, \-- ISO 3166-1 alpha-2, from billing address (authoritative)
     A.4's own list is the comparison basis for that column, so a value outside the declared encoding
     cannot ever match it. §4 states the rule; A.4 supplies a literal that violates it. The rule wins.
  2. THE PINNED SDK ENUMERATES ALPHA-2, AND `UK` IS NOT IN IT. `stripe@20.4.1`,
     `node_modules/stripe/types/Checkout/Sessions.d.ts`, the
     `Checkout.Sessions.ShippingAddressCollection.AllowedCountry` union declared at line 2367:
         2440:            | 'GB'
     Six of our seven codes appear verbatim in that union (US, CA, GB, AU, NZ, IE, SG). `'UK'` appears
     ZERO times in the file.
     NOTE ON THE REQUESTED CITATION: the brief asked this entry to cite the SDK's `card_country`
     declaration. That identifier does not exist anywhere in the pinned SDK — `grep -rn "card_country"
     node_modules/stripe/` returns nothing. Citing it would have reproduced exactly the defect
     SCL-DRAFT-A-citation-verification was written to stop, in the entry written to settle it. The
     `AllowedCountry` union above is the substituted citation and is strictly stronger: it is an
     enumeration, so it settles `GB` versus `UK` by presence and absence rather than by prose.
  3. THE FIELD THE GATE ACTUALLY READS is `Customer.address.country`, at
     `server/routes/billing-routes.ts:270`:
         : (customer as Stripe.Customer).address?.country;
     Stripe populates that field with alpha-2, per the same declaration.
Consequence, and why this is not cosmetic: the country gate is LIVE in production as of 2026-08-31.
  Applying A.4's literal would refuse every British payer while the config reported itself correctly
  configured — seven codes present, no parse error, no alert. A silent market shutdown with no error
  signal is the worst shape a defect of this kind can take, because nothing in the system distinguishes
  it from a working gate that no British customer happened to hit.
Owner action: amend the literal in Doc 01 Appendix A.4 to `["US","CA","GB","AU","NZ","IE","SG"]`.
  That is the whole change. Specifically NOT proposed:
  - No code change. The gate is correct; it compares what Stripe returns against what config holds.
  - No normalisation or translation layer. A `UK` -> `GB` mapping in code would let this wrong value
    keep working, which is precisely how the NEXT wrong code survives undetected. The config holds
    correct codes or the gate fails loudly; there is no third option worth building.
Production state: unchanged and correct. Verified seeded as `["US","CA","GB","AU","NZ","IE","SG"]`,
  seven codes, 2026-08-31 06:41Z. Production is the side that was already right.
ENCODING RULE, recorded once so this does not recur a fourth time:
  - The spec names countries in PROSE ("the United Kingdom").
  - The config stores ISO 3166-1 ALPHA-2 (`GB`).
  - The mapping between them is the standard itself, not a project convention, and not a table we own.
  A prose name and a code are different things; writing the prose abbreviation into a code field is the
  error, and it is the same error every time it appears.
History: this is the THIRD surfacing. It was raised, worked around, and lost twice before being written
  down. That is the reason for this entry: the recurrence is the defect, not the literal.
Artifact: `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md` Appendix A.4
  (the literal) and §4 line 147 (the contradicted rule).
  Reader: `server/lib/entitlement-runtime-config.ts:43`. Gate: `server/lib/stripe/country-eligibility.ts`.
  Consumer: `server/routes/billing-routes.ts:270-277`.
Number: NOT ALLOCATED. Provisional id only; the owner assigns at merge.

SCL-073 | 2026-08-27 | Doc 01A §52 knows a chargeback as an ABUSE SIGNAL; no section gives it an entitlement consequence | PROPOSED

AUDITED 2026-08-31 — UPHELD as an SCL. An interim framing ("the spec is silent here, so
  this is a plan entry, not an SCL") was applied and then superseded the same day. What a chargeback does to entitlement is a PERMANENT RULE. Doc 01A §52 already models the
  incident; the entitlement consequence must become spec text.

Change: A dispute does NOT cancel a Stripe subscription. Current behaviour is therefore: access
  retained, dispute fee paid, no entitlement change. This entry proposes the handling and names the
  seam it must not bypass.
WAS: the corpus is NOT silent on chargebacks, and an earlier draft of this entry wrongly claimed it
  was. Doc 01A §52 (heading verified: "## **§52 Incident taxonomy**") lists, among 12 launch
  incident types:
      | `payment_dispute` | 5 | Chargeback or fraud claim |
  with incident types living in `abuse_score_runtime_config.incident_types` with base weights, and
  Doc 06B referencing all 12. So a chargeback is already modelled — as an ABUSE SIGNAL with the
  joint-highest launch severity.
  What no section specifies is its ENTITLEMENT consequence: which Stripe event signals it, whether
  it revokes, and what happens when it is won. That is the actual gap, and it is narrower and more
  awkward than "uncovered" — the corpus has an opinion about disputes that the billing surface does
  not implement.
IS (PROPOSED, not built): subscribe `charge.dispute.created` and, on it, do BOTH:
    (a) revoke the entitlement, and
    (b) record a `payment_dispute` incident per Doc 01A §52, at its existing severity.
  Doing only (a) would silently drop a signal the abuse model already expects; doing only (b) leaves
  paid access on a charge the bank has pulled back.
  A won dispute needs a restore path, which requires subscribing `charge.dispute.closed` and reading
  its outcome. That event is NOT in SCL-070's 18, and adding it is part of this ruling rather than
  something SCL-070 already decided.
Interaction with SCL-048 — the load-bearing part: a dispute is NOT a refund and must NOT route
  through the refund path. SCL-048's rule is full-refund-revokes / partial-does-not, a comparison
  against a settled amount (basis fixed by SCL-072). A dispute is an unsettled assertion by the
  cardholder's bank that may be won or lost, and its amount is not a refund amount. Routing it
  through the refund comparison would revoke on a dispute the merchant later wins, with no path back.
Evidence: `charge.dispute.created` verified present in stripe@20.4.1's event union; Stripe's own
  description shipped in that SDK reads "Occurs whenever a customer disputes a charge with their
  bank." Corpus coverage established by `grep -rniE "dispute|chargeback" docs/Spec/` -> 68 hits,
  read rather than counted; the load-bearing one is Doc 01A §52 above.
  Docs: https://docs.stripe.com/disputes and https://docs.stripe.com/api/disputes
Owner action: rule on this entry BEFORE any dispute code is written. Explicitly unresolved and
  deliberately left so: (1) whether revocation is immediate on `dispute.created` or deferred to
  `dispute.closed` with outcome `lost` — immediate is standard but punishes a customer whose bank
  later finds for the merchant; (2) whether a won dispute restores the ORIGINAL period bounds or
  issues a fresh period; (3) whether the `payment_dispute` incident should also fire on a dispute
  the merchant WINS, since the signal's value to the abuse model may not depend on the outcome.
Artifact (updated 2026-08-27 after the owner ruled this IN SCOPE for launch):
  RULING: revocation ships; the `payment_dispute` incident is a NAMED LAUNCH GATE, blocked, and
  referred as a Doc 01A platform workstream.
  BUILT — `server/lib/stripe/dispute.ts` + `webhook-handler.ts`:
    `charge.dispute.created` revokes (tier free, status unpaid).
    `charge.dispute.closed` restores on `won` and on `warning_closed`, leaves revoked on `lost`.
    All EIGHT members of the SDK's `Dispute.Status` union carry an explicit disposition; an
    unrecognised member fails the Zod parse rather than being read as "not won", because deciding
    entitlement by omission is how a silent default becomes a policy.
    `warning_closed` RESTORES because an inquiry that closes without becoming a dispute withdrew no
    funds at all — the SDK documents `balance_transactions` as "zero, one, or two" entries, and an
    inquiry has zero.
    A dispute does NOT route through the refund path (SCL-048): a refund is money we return, a
    chargeback is money an issuer takes back over our objection.
  NOT BUILT — the incident record. Doc 01A §51 defines `AbuseScoreService.recordIncident` as the
    entry point and §54 binds any severity >= 4 incident to immediate re-scoring; §52 rates
    `payment_dispute` at 5. That re-scoring writes `abuse_scores`, which §55 classes
    "single-writer — only AbuseScoreService writes". AbuseScoreService does not exist in
    TypeScript (zero references repo-wide, verified 2026-08-27), so writing the incident from the
    billing vertical would satisfy half of §54 and skip the half another document owns. Supporting
    state is absent too: `abuse_score_runtime_config` holds 0 rows, so §53 has no base weights,
    and there are 0 cron jobs, so §54's nightly batch does not exist — an incident written today
    would sit inert in a table nothing reads. The interim signal is a WARN log naming the omission.
  DURABILITY LIMIT, reported not designed around: `entitlements.status` (genesis.sql:172) admits
    only Stripe's own subscription statuses, so nothing records that a revocation was caused by a
    dispute. A dispute leaves the subscription ACTIVE, so the next `customer.subscription.updated`
    re-derives from Stripe and undoes this revocation. Closing it needs DDL — a
    `dispute_revoked_at` column or equivalent — which is Phase 4 work and is proposed there.

---

SCL-072 | 2026-08-27 | Doc 01 V8 §24 / SCL-048 — refund full-vs-partial compares the CHARGED amount, never list price | PROPOSED

AUDITED 2026-08-31 — UPHELD as an SCL. An interim framing ("the spec is silent here, so
  this is a plan entry, not an SCL") was applied and then superseded the same day. The comparison basis for a full refund is a PERMANENT RULE that belongs in the
  document, not a decision local to this build. Silence is a legitimate SCL when the gap must
  become spec text.

Change: Coupons and promotion codes mean the amount actually charged can differ from the price's
  list amount. SCL-048 rules "full refund revokes, partial does not". If that comparison is made
  against the LIST price, a full refund of a discounted subscription reads as partial and fails to
  revoke — the customer keeps access after being made whole. This entry fixes the comparison basis
  and amends SCL-048 by reference.
WAS: SCL-048 states the full/partial rule without naming what "full" is measured against. With no
  discounts in play the two readings coincide, which is why the ambiguity survived.
IS: the comparison basis is the amount actually charged, never the price's list amount. Concretely,
  sum the succeeded refunds against the charge's captured amount, both of which Stripe reports in
  the same minor unit:
    - `Refund.amount` — "Amount, in cents (or local equivalent)" (stripe@20.4.1 types/Refunds.d.ts)
    - `Charge.amount_captured` — "Amount in cents (or local equivalent) captured (can be less than
      the amount attribute on the charge if a partial capture was made)" (types/Charges.d.ts)
  Full refund (revokes) is refunded-total >= captured amount. Anything less is partial and does not.
Discount and promotion-code handling posture, stated explicitly because "we did not decide" is not a
  posture: `customer.discount.created`, `customer.discount.updated`, `customer.discount.deleted`,
  `promotion_code.created` and `promotion_code.updated` are ACKNOWLEDGED WITH NO ENTITLEMENT EFFECT.
  They are subscribed so the surface is observable and so a discount change is not a silent event,
  but none of them writes, alters or revokes an entitlement. Entitlement follows subscription status
  and settled payment; a discount changes the amount, not the entitlement.
  The one place a discount DOES matter is this comparison basis, which is the whole point of the entry.
Amends: SCL-048, by reference. SCL-048's rule is unchanged in substance; only its comparison basis is
  now named. This does not reopen the full/partial question.
Owner action: fold the comparison basis into Doc 01 V8 §24 at the next spec pass.
Artifact: none yet. Implementation is Phase 3 §4.3 of the launch-scope work block.

---

SCL-071 | 2026-08-27 | Doc 01 V8 §22 — entitlement is written on payment SETTLEMENT, not on Checkout Session completion | PROPOSED

Change: A delayed payment method completes the Checkout Session BEFORE the money arrives. Writing
  entitlement from `checkout.session.completed` alone therefore grants access on an unsettled
  payment. Writing it only on settlement would leave a card payer waiting for access they have
  already paid for. Both failure modes are real; the field that separates them is `payment_status`.
WAS: Doc 01 V8 §22 treats `checkout.session.completed` as the entitlement trigger without
  qualification, which is correct only because every method enabled today settles synchronously.
IS: entitlement is written when payment is confirmed SETTLED, whichever event carries that fact.
  The distinguishing field is `Checkout.Session.payment_status`, whose Stripe-authored description
  shipped in stripe@20.4.1 (types/Checkout/Sessions.d.ts) reads:
    "The payment status of the Checkout Session, one of `paid`, `unpaid`, or `no_payment_required`.
     You can use this value to decide when to fulfill your customer's order."
  The union is exactly `'no_payment_required' | 'paid' | 'unpaid'`.
  So: on `checkout.session.completed`, write entitlement only when `payment_status` is `paid` or
  `no_payment_required`. When it is `unpaid`, write nothing and wait.
  `checkout.session.async_payment_succeeded` — "Occurs when a payment intent using a delayed payment
  method finally succeeds" — is the event that then carries settlement, and it writes the entitlement.
  `checkout.session.async_payment_failed` — "Occurs when a payment intent using a delayed payment
  method fails" — produces NO entitlement, and must not be treated as a revocation of something that
  was never granted.
Inert today, live on a flag flip — which is exactly why it is written now: card and Link settle
  synchronously and never emit the async pair, so this changes no behaviour on the current
  configuration. It becomes load-bearing the moment any delayed method is enabled in the Dashboard,
  which is a configuration change no code review would catch. A conditional written before the
  condition arrives is cheap; the same rule discovered afterwards is an incident.
Docs: https://docs.stripe.com/payments/checkout/fulfill-orders and
  https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-payment_status
Owner action: fold into Doc 01 V8 §22 at the next spec pass.
Artifact: none yet. Implementation is Phase 3 of the launch-scope work block.

---

SCL-070 | 2026-08-27 | Doc 01 V8 §22.1 — the subscribed webhook event surface is 19 events, not 7 | PROPOSED

Change: §22.1 specifies seven events. The owner has finalised nineteen. This records the surface,
  the delta, the reason for each addition, and two deliberate exclusions.

  AMENDED 2026-08-27 (owner ruling, same day): `charge.dispute.closed` added at the Dashboard,
  taking the surface from eighteen to NINETEEN. It is the restore path for SCL-073: a dispute does
  not cancel the subscription, so a customer whose dispute we WIN would otherwise be left revoked
  while having paid. The event carries the deciding fact — stripe@20.4.1 ships its description as
  "Occurs when a dispute is closed and the dispute status changes to `lost`, `warning_closed`, or
  `won`" — so no second call is needed to learn the outcome.
  `charge.dispute.funds_reinstated` was deliberately NOT added alongside it: it reports the same
  resolution as a money movement, and subscribing both would deliver every won dispute twice in two
  shapes, recreating the duplicate-delivery problem that the `charge.refunded` exclusion below
  avoids.
WAS: Doc 01 V8 §22.1 (heading verified: "### **22.1 Handled webhook events**") lists seven events
  covering checkout completion and the subscription lifecycle. Read and enumerated 2026-08-27; the
  seven are exactly those shown as "Already in §22.1" below.
IS: eighteen. All eighteen verified present in stripe@20.4.1's event-type union
  (types/EventTypes.d.ts) on 2026-08-27 — a name that does not exist cannot be subscribed, and a
  typo here fails silently.

  Already in §22.1 (7):
    checkout.session.completed
    customer.subscription.created
    customer.subscription.updated
    customer.subscription.deleted
    invoice.payment_succeeded
    invoice.payment_failed
    customer.updated

  Added (11), with the reason each is needed:
    checkout.session.async_payment_succeeded  settlement for delayed methods (SCL-071)
    checkout.session.async_payment_failed     non-settlement for delayed methods (SCL-071)
    customer.deleted                          a deleted Customer orphans an entitlement row that
                                              Doc 05D's cascade cannot see, because that cascade
                                              knows nothing about Stripe objects (see amendment below)
    customer.discount.created                 discount changes the charged amount, which is the
    customer.discount.updated                 comparison basis for the refund rule (SCL-072)
    customer.discount.deleted
    promotion_code.created                    same, via promotion codes
    promotion_code.updated
    refund.created                            revocation on refund (SCL-048, amended by SCL-072)
    refund.updated                            a refund reaching status `succeeded` is the revoking
                                              transition; creation alone is not
    charge.dispute.created                    chargebacks are uncovered corpus-wide (SCL-073)

  Added by the 2026-08-27 amendment (1), bringing the total to 19:
    charge.dispute.closed                     the restore path — a WON dispute must return access
                                              (SCL-073); carries `status`, so the outcome needs no
                                              second call

  DELIBERATELY EXCLUDED — `charge.refunded` and `charge.refund.updated`.
  Both exist in the SDK's event union, so this is a choice and not an oversight. Stripe's own
  descriptions, shipped verbatim in stripe@20.4.1, direct integrators away from them:
    charge.refunded       "Occurs whenever a charge is refunded, including partial refunds.
                           Listen to `refund.created` for information about the refund."
    charge.refund.updated "Occurs whenever a refund is updated on selected payment methods.
                           For updates on all refunds, listen to `refund.updated` instead."
  Subscribing both families would deliver every refund twice in two different shapes, and the
  handler would have to decide which copy is authoritative on every delivery — a dedup problem
  created for no gain. The `refund.*` family is the one Stripe points at and is complete;
  `charge.refund.updated` is explicitly the partial one.
Docs: https://docs.stripe.com/api/events/types and https://docs.stripe.com/webhooks
Amendment recorded here rather than as a separate entry — `customer.deleted` and the deletion
  cascade: an entitlement row referencing a `stripe_customer_id` that no longer exists is an orphan
  Doc 05D's cascade cannot detect, because that cascade operates on Lyceon rows and has no knowledge
  of Stripe object lifetimes. Intended behaviour: `customer.deleted` revokes the entitlements keyed
  to that Customer. Flagged as a seam, not built here.
Amendment recorded here rather than as a separate entry — portal as an input to country derivation
  (SCL-046): the Customer Portal is configured to permit billing-address changes, which fire
  `customer.updated`. So country egress can be triggered by the CUSTOMER, not only by an operator.
  SCL-046 assumes operator-initiated change; that assumption is now false.
Owner action: fold the 18-event surface into Doc 01 V8 §22.1 at the next spec pass, and rule on the
  two amendments above.
Artifact: none yet. Handler disposition for all 18 is a Phase 3 exit criterion.

---

SCL-053 | 2026-08-26 | Doc 01A Appendix A.3 restates Doc 03's daily tutor limit and has drifted from it — 100 vs 120 | PROPOSED

Change: Two locked documents state the LISA per-day message limit. They disagree. Doc 03 owns tutor
  usage limits and its value (120) is canonical; Doc 01A Appendix A.3's conflicting seed (100) is
  disregarded. The underlying defect is not the value — it is that Appendix A.3 restates a constant
  another document owns, which is the failure mode Reference-Never-Restate exists to prevent.
WAS: Doc 01A Appendix A.3 (heading verified: "## **A.3 `rate_limit_runtime_config`**") carries a
  "Launch seed of bucket definitions (illustrative)" whose entry reads
  `"tutor_turns_daily": { "limit": 100, "window_seconds": 86400 }`.
IS: Doc 03 §13.1 (heading verified: "### **13.1 Hard Limits (V1 Locked)**", under
  "## **§13 Usage Limits**") states the per-day row as `| Per-day | 96 messages | 120 messages |` —
  soft warning 96, hard limit 120. Doc 03 §25 restates the same figure in its V1 launch scope
  ("Hard limits (120/day, 2,500/week, 10K/month)"), and CR-03-09 records it as locked. The canonical
  daily tutor limit is 120.
Rationale: Doc 03 is the owning document for tutor usage limits — §13 is titled "Usage Limits", §13.1
  is marked "V1 Locked", and it carries the full five-window table with reset schedules and the
  definition of "message". Doc 01A Appendix A.3's job is to define the SHAPE of
  `rate_limit_runtime_config` — the `bucket_definitions` map of bucket_key -> { limit, window_seconds }
  — not to fix the tutor constant. By copying a value it does not own into an "illustrative" seed, it
  created a second place for that number to live, and the two have already drifted apart by 20%.
  The correct amendment is therefore REMOVAL of the tutor constant from Appendix A.3, not a change of
  its value. Substituting 120 for 100 in the seed would leave the duplication intact and the next
  drift would be the same defect again.
Evidence:
  - Doc 03 §13.1 table, per-day row: 96 soft / 120 hard. Heading verified.
  - Doc 01A Appendix A.3 launch seed: `"tutor_turns_daily": { "limit": 100, "window_seconds": 86400 }`.
    Heading verified.
  - Production corroborates Doc 03, not Appendix A.3: `rate_limit_runtime_config` holds 7 rows, all
    `tutor_*`, and the live `tutor_turns_daily` value is **120**. Whoever seeded production read
    Doc 03. Recorded during WS-GL Stage 3 Phase A, 2026-08-25.
  - Scope note: the same seed's `guardian_link_attempts_daily` entry ({ limit: 10, window_seconds:
    86400 }) does NOT conflict with its owning section — Doc 01 V8 §36.2 states "max 10 link attempts
    per day" in prose. Only the tutor entry has drifted. This SCL is scoped to that one entry.
Version: no version bump to Doc 03. Doc 01A needs the amendment.
Owner action: at next spec pass, delete the `tutor_turns_daily` entry from Doc 01A Appendix A.3's
  launch seed and replace it with a reference to Doc 03 §13.1. Consider whether the other eight seed
  entries restate constants owned elsewhere; this SCL asserts the defect only for the one verified.
  No schema change. No code change is required by this entry — the value the code will read comes from
  `rate_limit_runtime_config` at runtime, and the live row already says 120.
Artifact: none. Surfaced by WS-GL Phase B (docs/plans/WS-GL_Stage2_Closure_Plan.md), which is the first
  consumer built against the canonical `bucket_definitions` shape and therefore the first to have to
  choose between the two values.

---

SCL-052 | 2026-08-20 | Doc 09 §5.2 vocabulary — "tier" there means billing period, not entitlement level | PROPOSED

Change: Doc 09 §5.2 calls monthly / multi-month / annual billing "three paid tiers." Doc 01 V8 §20 uses
  "tier" for entitlement level over a two-value domain. Read on its headline alone, §5.2 appears to
  contradict §20. It does not; the word is overloaded across two documents.
WAS: Doc 09 §5.2 (heading verified: "## **5.2 The current tier-structure direction**") opens
  "Lyceon's V1 pricing posture is a **freemium-plus-three-paid-tiers shape**" and lists "**Three paid
  tiers**, differentiated by billing period."
IS: §5.2's own closing sentence already resolves it — "The paid tiers deliver the same product (full
  premium access per Doc 02B V4 §11.4 right column); the differentiation is billing-period commitment."
  Three Stripe Prices map to ONE entitlement tier (`premium`). Doc 09 "tier" = price point.
  Doc 01 V8 "tier" = entitlement level. The two are not in conflict and never were.
Rationale: STRIPE_GROUNDING_AUDIT G-28 recorded this as SPEC-CONTRADICTORY on the strength of the
  §5.2 headline. That classification is withdrawn. Doc 09 §2.2's ownership boundary table already
  splits the concerns — "Pricing tier structure direction | Doc 09 (directional) + Stripe (runtime)"
  — while entitlement semantics stay with Doc 01. The defect is lexical, not architectural, but it
  cost one audit finding and will cost the next reader the same unless the word is disambiguated.
Evidence:
  - Prod: `entitlements_tier_check` = CHECK ((tier = ANY (ARRAY['free'::text, 'premium'::text]))) — a
    two-value domain that cannot express three tiers.
  - Repo: `server/routes/billing-routes.ts:31-34` — `checkoutSchema` = z.enum(["monthly","quarterly",
    "yearly"]).strict(). Three plans, one premium tier. Consistent with the reading above.
  - **Live confirmation (owner, 2026-08-20).** Three Stripe Price IDs are configured and in use —
    `STRIPE_PRICE_PARENT_MONTHLY`, `STRIPE_PRICE_PARENT_QUARTERLY`, `STRIPE_PRICE_PARENT_YEARLY`
    (`billing-routes.ts:40-42`) — against a `tier` domain that admits exactly two values. Three
    prices, one entitlement tier, in production configuration. This is the reading of §5.2 confirmed
    by the runtime state rather than inferred from the text, and it closes the question.
Version: no version bump. §5.2's substance is unchanged.
Owner action: at next spec pass, amend Doc 09 §5.2 to say "three paid **billing periods**" (or add a
  one-line vocabulary note binding "tier" in Doc 09 to price point and deferring entitlement-level
  "tier" to Doc 01 V8 §20). No schema change. No code change.
Artifact: none.

---

SCL-051 | 2026-08-20 | Doc 01 V8 §37 — under-13 requires a guardian-held account AND a Rule-compliant VPC method | PROPOSED

Change: Owner ruled under-13 users permitted at launch where the **guardian holds the account** and the
  child has a supervised profile. That ruling is necessary but not sufficient: Doc 01 V8 §37's consent
  mechanism is email-token-based, which the amended COPPA Rule does not accept for the disclosure
  posture Lyceon operates under. This SCL records the ruling and the gap it leaves open.
WAS: Doc 01 V8 §37.2 (heading verified: "### **37.2 Consent request flow**") specifies an eight-step
  flow: consent request created → email with unique token → guardian clicks link → guardian creates or
  signs into a guardian account → guardian reviews and consents → `profiles.guardian_consent = true`
  + `guardian_links` row `status='active'` → student notified → token invalidated. §37.1 gates the
  student account until that completes. The student is the account holder throughout.
IS: (a) For under-13, the **guardian is the account holder**; the child holds a supervised profile
  beneath it. (b) The §37.2 email-token flow is retained as the linking mechanism but is NOT by itself
  verifiable parental consent for third-party disclosure. (c) A Rule-compliant VPC method is required
  before under-13 is enabled.
Rationale: The amended Children's Online Privacy Protection Rule is effective 2025-06-23 with a full
  compliance deadline of **2026-04-22** — already passed and enforceable as of this entry
  (https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule).
  Two consequences bind Lyceon:
  1. **Email-plus covers internal-use collection only.** Where personal information is disclosed to a
     third party, a higher-tier method is required — knowledge-based authentication, government ID
     matched against a facial image, or text-to-parent with confirmation (the amended Rule newly
     permits text messages to facilitate VPC). See FTC guidance:
     https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule
  2. **Separate consent is required for third-party disclosure.** The amended Rule requires operators
     to obtain separate verifiable parental consent to disclose children's personal information to
     third parties (https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data).
  **Open counsel question, flagged not answered:** whether LISA's calls to Vertex AI constitute an
  internal operation or a third-party disclosure. If disclosure, under-13 tutor access requires a
  second, separate VPC — not the same consent that established the guardian link. Doc 03 already gates
  LISA on Tier-1 country (INV-03-08) and paid entitlement; it does not gate on a disclosure-tier
  consent, because no document contemplates one.
Evidence:
  - Doc 10 CR-10-02 records that the §9.4 Parent Terms summary was corrected to remove the COPPA
    "verifiable parental consent" term-of-art, noting "**Lyceon does not implement COPPA-grade VPC**."
    The corpus already knows this gap exists.
  - Doc 09 §14 criterion #6 and watch item **W-09-10** hold the under-13 paid-user decision OPEN and
    "LAUNCH-GATING IF UNDER-13 PAID USERS POSSIBLE." Doc 10:224 asserts the opposite — that V1 blocks
    under-13 paid users. That contradiction (audit G-31) is resolved by this ruling in favour of
    permitting under-13, which makes the §9.6 counsel-review gate launch-gating.
  - Repo: `profiles.is_under_13` exists at `supabase/migrations/00000000000000_genesis.sql:147`,
    maintained from `date_of_birth` by a trigger (`:118-121`) rather than as the `GENERATED ALWAYS
    ... STORED` column Doc 01 V8 §4 specifies — a deliberate, documented divergence recorded in
    genesis as "@adaptation A1" (`genesis.sql:30`). The data model supports the under-13 state; the
    consent *method* is what is absent.
LAUNCH GATE 2026-08-20 (owner-acknowledged, assigned to counsel) — **the published Student Terms
  contradict the owner ruling this SCL records.** Student Terms §2 states that Lyceon does not
  knowingly permit under-13 users and does not currently offer verified parental consent flows. The
  owner has ruled under-13 paid access permitted under a guardian-held account. A published consumer
  document that disclaims a capability cannot coexist with shipping that capability.
  **The terms require amendment before the under-13 path is built** — not after, and not in parallel.
  This compounds rather than replaces the VPC-method gap above: amending §2 removes the contradiction
  but does not supply a Rule-compliant consent method, and supplying the method does not fix §2. Both
  must close. Nothing in Phase C depends on either.
Version: Doc 01 V8 §37 gains an account-holder rule and a VPC-method requirement. No version bump
  proposed; the flow body in §37.2 is unchanged as a linking mechanism.
Owner action: (1) amend §37 to state the guardian-held-account model for under-13; (2) add a VPC-method
  subsection naming the chosen Rule-compliant method; (3) put the Vertex-AI-disclosure question to
  counsel before under-13 is enabled. **This is a launch gate, not a build item — no Phase C work
  depends on it.** No schema change identified. No code change proposed.
Artifact: none. Counsel question recorded in `docs/plans/Stripe_Open_Questions.md` Q2.

---

SCL-050 | 2026-08-20 | UNSPECIFIED `stripe` sync schema and both webhook endpoints — remove | PROPOSED

Change: Production carries a 29-table `stripe` schema (the Supabase Stripe sync integration) and two
  registered Stripe webhook endpoints, neither of which appears anywhere in `docs/Spec/`. Remove both.
WAS: No spec section. Six-term proof of absence across the corpus:
    $ grep -rn -F -i "sync engine" docs/Spec/           # 0 hit(s)
    $ grep -rn -F -i "Stripe Sync" docs/Spec/           # 0 hit(s)
    $ grep -rn -F -i "foreign data wrapper" docs/Spec/  # 0 hit(s)
    $ grep -rn -F -i "wrappers" docs/Spec/              # 0 hit(s)
    $ grep -rn -F -i "stripe schema" docs/Spec/         # 0 hit(s)
    $ grep -rn -F -i "stripe." docs/Spec/               # 0 hit(s)
IS: The `stripe` schema is dropped. Both webhook endpoints are deleted from the Stripe Dashboard and
  replaced by one test-mode endpoint per SCL-049's one-account-one-environment-per-mode rule.
Rationale:
  - **No owning document, therefore no retention rule.** The schema is registered in neither the
    Doc 05D §10 deletion cascade nor the Doc 07E retention registry. Rows would accumulate with no
    deletion trigger and no retention class.
  - **PII multiplication for a minors' product with no need behind it.** `stripe.customers` (26 cols),
    `stripe.charges` (42), `stripe.invoices` (68) mirror full raw Stripe objects — guardian email,
    billing address, card metadata — to serve a binary paid/not-paid decision that
    `entitlement_active(profile_id)` already answers from four columns. Doc 01A §14 (heading verified:
    "## **§14 PII redaction rules (extends V8 §5.1)**") forbids "full Stripe customer metadata" in
    logs and requires Stripe event payloads be reduced to "`stripe_customer_id` reference only, not
    full customer object." §14 governs logs, not tables — but mirroring the whole object into a table
    inverts the posture §14 exists to express.
  - **It is already failing open.** `server/lib/billingStorage.ts:6` calls RPC `query_stripe_products`,
    which does not exist:
      SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname LIKE 'query_stripe%';
      -- []  (zero rows)
    The `catch` at `billingStorage.ts:8-16` silently falls through to a `stripe.products` read that
    returns 0 rows, so `GET /api/billing/plans` and `GET /api/billing/products` serve empty lists with
    no error. A failed lookup collapsed into a legitimate empty result — Charter §6.
  - **Managed-service-first counter-argument, and why it loses.** The standing rule prefers a platform
    feature over hand-rolled infrastructure. It applies to needs Lyceon has. Lyceon's need is one
    boolean per student, sourced from webhook events it already receives and verifies. A read-replica
    of the entire Stripe object graph is not the managed version of that need; it is a different and
    much larger thing. If a future need arises for invoice history or dispute tracking, the sync
    integration is the right answer *then*, scoped to the tables that need exist for, with a
    retention class and a cascade entry.
Evidence:
  - 29 tables, all `rls = false`, all at **0 rows** (`_managed_webhooks` = 2, `_sync_status` = 0):
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='stripe' AND c.relkind='r';
  - Boundary currently holds — schema ACL grants USAGE to `postgres` and `service_role` only:
      SELECT nspname, nspacl::text FROM pg_namespace WHERE nspname='stripe';
      -- stripe | {postgres=UC/postgres,service_role=U/postgres}
    No `anon`, no `authenticated`. So this is a removal on principle and cost, not an open exposure.
  - Two endpoints, **89 subscribed event types each**, one `livemode=false` and one `livemode=true`,
    each with a non-null `secret` column (signing secret stored in Postgres — see SCL-049 and
    audit G-22):
      SELECT id, livemode, status, jsonb_array_length(enabled_events) FROM stripe._managed_webhooks;
      -- we_1SoYHjBqixZkD6HCeRTg2ozZ | false | enabled | 89
      -- we_1SoaTPDPtjyWEVqEdguPV2TE | true  | enabled | 89
    Doc 01 V8 §22.1 (heading verified: "### **22.1 Handled webhook events**") specifies seven.
Version: no spec section is amended — this creates a negative rule where none existed.
Owner action: (1) **Owner-only, Dashboard:** delete both endpoints; create one test-mode endpoint
  against Vercel. (2) **Owner-only, DDL:** `DROP SCHEMA stripe CASCADE` — queued in
  `docs/plans/STRIPE_DDL_QUEUE.md`, not authored here (WS-M freeze, Charter §7). (3) Code: delete
  `server/lib/billingStorage.ts` and its two consuming routes in the Phase C rebuild.
Artifact: DDL queued. Deletion recorded in the Phase C deletion manifest.

---

SCL-049 | 2026-08-20 | Doc 01 V8 §22 — assert `event.livemode` before processing; one account, one Lyceon environment per mode | PROPOSED

Change: The spec is silent on the Stripe environment model and on `livemode`. Production has a test-mode
  and a live-mode endpoint pointing at the same database. This SCL creates the rule.
WAS: Nothing. Proof of absence across the corpus on four terms:
    $ grep -rn -i "livemode" docs/Spec/        # 0 hit(s)
    $ grep -rn -i "Stripe account" docs/Spec/  # 0 hit(s)
    $ grep -rn -i "test key" docs/Spec/        # 0 hit(s)
    $ grep -rn -i "test mode" docs/Spec/
      docs/Spec/…Guardian Trust (V6).md:646: … test subscription lifecycle end-to-end in Stripe test mode …
  The single "test mode" hit is in the retired V6 file and is a pre-refactor checklist item, not a
  model. Doc 01 V8 §22.3 ("### **22.3 Webhook signature verification**") specifies signature
  verification and says nothing about mode.
IS: **One Stripe account. One Lyceon environment per mode** — test-mode events belong to the
  non-production Lyceon environment, live-mode events to production. The webhook handler asserts
  `event.livemode` against the environment's expected mode **after** signature verification and
  **before** any processing, and **rejects on mismatch**. Fail closed: an unexpected mode is a
  rejection, never a pass-through, never a log-and-continue.
Rationale: Stripe recommends checking `livemode` on receipt — "It's recommended that you check the
  livemode value when receiving an event webhook to determine whether users need to take action"
  (https://docs.stripe.com/api/events/object). Signature verification alone does not establish mode:
  a valid test-mode signing secret produces a validly-signed test event, so a handler that verifies
  and proceeds will write a real entitlement row from a test subscription. Stripe's webhook guidance
  covers verification (https://docs.stripe.com/webhooks) but leaves environment segregation to the
  integrator, which is why this must be a Lyceon rule rather than an inherited pattern.
Evidence:
  - Repo: `server/lib/webhookHandlers.ts:281` logs `livemode: event.livemode` and **never branches on
    it**. The switch at `:297-334` runs identically for both modes.
  - Repo: `server/lib/stripeClient.ts:4-29` implements a `STRIPE_ENV` = `"live" | "test"` selector
    with `_LIVE`/`_TEST` key suffixes — an environment model invented in code with no corpus basis
    (audit G-24), and undocumented in `docs/ENV.md` (audit G-23).
  - Prod: both endpoints registered against the same database, one per mode (SQL in SCL-050).
  - Prod: signing secrets are stored in `stripe._managed_webhooks.secret` (non-null on both rows),
    which is not one of the `store:` values Doc 06B §4.2 defines
    (`[service_auth_secrets_table | vercel_env | worker_host_native | gcp_secret_manager |
    github_actions | next_public]`). Doc 06B §4.1 (heading verified: "# **§4 — Secret-Class Inventory
    & Per-Platform Binding (Q-06B-1 = a)**") binds Stripe runtime secrets to **Vercel environment
    variables**. SCL-050's endpoint deletion removes those rows and closes this as a side effect.
AMENDMENT 2026-08-20 (owner) — **the environment split is a CONFIGURATION requirement, and Vercel
  per-environment scoping is its enforcement point. The handler assertion is defence in depth, not
  the control.**
  Owner reports that `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ENV` are all scoped
  **All Environments** in Vercel, so production, preview, and development share one key, one webhook
  signing secret, and one mode selector.
  **Why the code-side assertion cannot compensate.** `webhookHandlers` would read `STRIPE_ENV` to
  learn its expected mode. With one value shared across all three environments, every environment
  computes the *same* expected mode and every environment asserts it identically. A preview
  deployment holding the live key and the live signing secret would receive a live event, verify its
  signature successfully, compute `expected = 'live'`, observe `event.livemode = true`, and pass —
  writing a real entitlement row from a preview build. The assertion is not weak here; it is
  structurally blind, because the thing it compares against is not per-environment.
  **This is already a spec violation, not only a new rule.** Doc 06B §4.1 (heading verified:
  "# **§4 — Secret-Class Inventory & Per-Platform Binding (Q-06B-1 = a)**") binds Vercel BFF/API
  runtime secrets to "**Vercel environment variables**, environment-scoped
  (`production` / `staging` / `development`)". All-Environments scoping is not environment-scoped.
  §4.3 hard rule 2 additionally forbids a privileged secret in "any preview-env runtime."
  **Ordering consequence: the configuration fix precedes the code.** Building the handler assertion
  against a shared `STRIPE_ENV` produces a gate that passes in every environment and proves nothing —
  a gate never observed failing, which Charter §5 rejects by name.
  **Owner action, Dashboard-only, verify do not assume:** scope `STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_ENV` per environment, with test-mode
  values in preview and development and live values in production only.
  **Not verifiable from this session.** The Vercel MCP surface available here exposes
  `list_teams` / `list_projects` / `get_project` and no environment-variable read. Verified reachable:
  team `team_jMcpkTj06ExncZhZCxA2BPMC`, project `prj_Q7cVFOLY753OTXPiZAKfiLczGIIo` ("lyceonai");
  `get_project` returns domains and `latestDeployment` and no env data. Verification requires the
  Vercel Dashboard → Settings → Environment Variables, or `vercel env ls` with a token.
Version: Doc 01 V8 §22 gains a new subsection (§22.5 or renumbered). No existing text is contradicted.
  Doc 06B §4.1's environment-scoping requirement is unchanged and is cited, not amended.
Owner action: add the environment model and the `livemode` assertion rule to §22; add the webhook
  signing secret as a named example in Doc 06B §4.1's "Vercel BFF/API runtime secrets" row, and
  register `STRIPE_ENV` / `STRIPE_*_LIVE` / `STRIPE_*_TEST` in `infra/secret-class-inventory.yaml`
  (which does not yet exist — Doc 06B §4.4's proving mechanism has no registry to read).
Artifact: implemented in the Phase C webhook handler.

---

SCL-048 | 2026-08-20 | Doc 01 V8 §22.1 — refund events are absent and must revoke; Refund Policy governs over Doc 09 §5.6 | PROPOSED

Change: Doc 01 V8 §22.1's seven handled events contain no refund event. The Refund Policy requires
  immediate access loss on refund, so a refund must be a webhook-driven revocation. Separately, Doc 09
  §5.6 and Refund Policy §4 disagree on whether a renewal refund is a right; the Refund Policy governs.
WAS: Doc 01 V8 §22.1 (heading verified: "### **22.1 Handled webhook events**") enumerates seven event
  types. None of them is a refund event. §21 ("## **§21 Subscription states and transitions**") maps
  Stripe subscription statuses to entitlement, and a refund does not change subscription status — so
  a refunded student retains premium under the spec as written.
IS: Refunds revoke entitlement on receipt. Lyceon subscribes to and handles the refund event family.
Rationale:
  - **The Refund Policy is authority level 1 and is unambiguous.** §8.1 (heading verified: "### **8.1
    Cancellation and Access**"): "your subscription is canceled immediately and your access to paid
    features ends as soon as the cancellation is recorded in our systems. **This applies to all
    refunds under this Policy**" — satisfaction-window, renewal-grace-window, case-by-case, and
    region-specific alike. §3.2 and §4.3 say the same for their respective windows.
  - **Which event — a correction to the brief.** The brief names `charge.refunded`. Stripe's own
    changelog supersedes that: since API version Acacia (2024-10-28) Stripe emits `refund.created`,
    `refund.updated`, and `refund.failed` for **all** refund types, explicitly so integrators no
    longer need to listen to `charge.refunded` and decide which applies
    (https://docs.stripe.com/changelog/acacia/2024-10-28/refund-webhook-update). Under the Charter's
    Stripe-supremacy rule, `refund.*` is the correct family. `charge.refunded` still fires and remains
    valid (https://docs.stripe.com/api/events/types); handling both is redundant, and Stripe's
    guidance is to prefer `refund.*`. Recommend `refund.created` + `refund.updated` (a refund reaching
    `succeeded` may arrive via update, since refund status can be `pending` at creation —
    https://docs.stripe.com/api/refunds/object).
  - **Revocation must be status-gated, not creation-gated.** A `refund.created` in `pending` is not a
    completed refund. Entitlement revokes when the refund object reaches `succeeded`.
  - **Partial refunds — the Policy sweeps them in, and cannot be read otherwise.** Owner proposed
    (2026-08-20) that revocation fire only where the refund covers the current period's charge in
    full, so that a goodwill concession (say $20 against a $99 charge) does not revoke access as a
    consequence of Lyceon's own gesture. **Refund Policy §8.1 as written cannot carry that
    distinction.** Its scope clause is explicit: "This applies to **all refunds under this Policy** —
    Satisfaction Window refunds, Renewal Grace Window refunds, case-by-case refunds under Section 5,
    and refunds under region-specific rights in Section 6." And §5 (heading verified: "## **5\.
    Renewal Charges Outside the Grace Window**") expressly contemplates a partial: "we may provide a
    full refund, **a pro-rated refund based on the time remaining in the Billing Period**, or a
    service credit toward future subscriptions." A §5 pro-rated refund revoking access is coherent —
    the customer is refunded the unused remainder and is paid up to today. A goodwill concession
    revoking access is not, and the Policy has no category for it.
    **Interim rule for this SCL: revoke on any refund reaching `succeeded`**, per §8.1's scope clause.
    The Refund Policy is authority level 1 and the spec cannot narrow it.
    **Operational mitigation, which needs no policy change:** a goodwill concession is not a refund.
    Stripe distinguishes them — a customer credit balance keeps the money on the account and
    auto-applies to the next finalized invoice
    (https://docs.stripe.com/billing/customer/balance), and a credit note can specify `credit_amount`
    (credit balance) rather than `refund_amount` (money back to the card)
    (https://docs.stripe.com/invoicing/integration/programmatic-credit-notes). Issuing goodwill as a
    balance credit produces no `refund.*` event, so §8.1 never engages and access continues. §7.4 and
    §5 both already name "a service credit toward future Lyceon subscriptions" as an available form.
    **Whether that operational rule is sufficient, or whether §8.1 needs a carve-out, is deferred to
    `docs/plans/Stripe_Open_Questions.md` Q4.** Not resolved here.
  - **Doc 09 §5.6 vs Refund Policy §4 — the Refund Policy governs.** Doc 09 §5.6 (heading verified:
    "## **5.6 Refund policy direction**") says renewal charges are "handled case-by-case (not a
    contractual entitlement; vendor support discretion)." Refund Policy §4.1 ("### **4.1 The Renewal
    Grace Window**") grants an unconditional three-day full refund where the service has not been used
    since the renewal charge. Doc 09's own header labels it "a **directional document**, not a contract
    document." The Refund Policy is a published consumer contract. Authority order settles it; audit
    G-30 is closed in the Refund Policy's favour.
Evidence:
  - Repo: `server/lib/webhookHandlers.ts:297-334` — no refund case. `refund.created`, `refund.updated`,
    and `charge.refunded` are all among the 89 event types **already subscribed** at the live endpoint
    (SCL-050 evidence), so these events are being delivered and silently dropped through the `default`
    branch at `:324-333` today.
  - Refund Policy §4.1's precondition — "You must not have Used the Service since the Renewal Charge"
    — has no server-side implementation. There is no activity signal timestamped against a renewal
    (audit G-35). This is a build item, not an SCL: the policy is right and the system has not caught up.
LAUNCH GATE 2026-08-20 (owner-acknowledged, assigned to counsel) — **two published consumer
  documents directly conflict on whether refunds exist at all.** Student Terms §11 states that fees
  are non-refundable with no partial-period refunds. The Refund Policy provides a seven-day
  Satisfaction Window (§3.1), a three-day Renewal Grace Window (§4.1), case-by-case pro-rated refunds
  (§5), and region-specific statutory rights (§6). Both sit at authority level 1 under the Charter, so
  the authority order cannot resolve this — only counsel can.
  **This SCL's revoke-on-refund model depends on the Refund Policy being the operative document.** If
  Student Terms §11 were to govern, there would be no refund path to revoke on and §8.1's
  immediate-access-loss rule would have nothing to attach to. Not designed around and not resolved
  here: the interim rule (revoke on any `succeeded` refund) is written against the Refund Policy
  because that is the document this SCL cites, and it must be re-examined if counsel rules the other
  way. Doc 10 §3 Risk 6 already records that the Dec 2025 ToS drafts say "fees are non-refundable" and
  that the conflict "must be resolved in the new ToS + new Parent Terms + new standalone Refund
  Policy" — the standalone Refund Policy shipped; the ToS did not follow.
Version: Doc 01 V8 §22.1 gains refund rows. §21 gains a note that refund is an entitlement-affecting
  event outside the subscription-status axis.
Owner action: (1) add `refund.created` / `refund.updated` to §22.1 with the action "revoke entitlement
  when refund status = succeeded"; (2) add a §21 note distinguishing refund-driven revocation from
  status-driven transitions; (3) record in Doc 09 §5.6 that the Refund Policy governs on renewal-window
  mechanics. (4) Separately queue the "Used the Service since renewal" activity signal as a build item.
  (5) Rule on Q4 (partial refunds) — either adopt the goodwill-as-balance-credit operating rule, which
  requires no change to the Refund Policy, or amend §8.1 to carve out refunds not tied to time
  remaining, which is a consumer-contract change and therefore counsel-owned.
Artifact: not in the Phase C thin slice (thin slice is checkout → entitlement only).

---

SCL-047 | 2026-08-20 | Doc 01 V8 — country egress: `cancel_at_period_end`, access to period end, gate at renewal | PROPOSED

Change: Nothing specifies what happens when an existing subscriber's billing country leaves the Tier-1
  set. Owner ruled option (b): cancel at period end, retain access until the period ends, apply the
  gate at renewal.
WAS: Silent. Three mechanisms exist and compose only to a feature-level outcome, never a
  subscription-level one: §22.1's `customer.updated` row syncs the billing address to
  `profiles.country_code`; §29.2 ("### **29.2 Invalidation triggers**") lists country change as
  invalidation trigger 2; §27.3 ("### **27.3 Feature access evaluation order**") step 4 then denies
  with `region_blocked` for any feature carrying `requires_tier_1_country`. Proof of absence on the
  subscription-level question:
    $ grep -rn -i "country change" docs/Spec/
      …Guardian Trust.md:1145: * Called by Stripe webhook handler after entitlement DB write, and by
        `profile-service.ts` after profile updates that affect entitlement (country change, age change, soft-delete)
    $ grep -rn -i "changes country" docs/Spec/      # 0 hit(s)
    $ grep -rn -i "moves to a non-Tier" docs/Spec/  # 0 hit(s)
  One hit, and it is the invalidation-trigger list.
IS: On `customer.updated` moving the billing country out of `entitlement_runtime_config.tier_1_countries`:
  set `cancel_at_period_end = true` on the subscription; the student retains access through
  `current_period_end`; no renewal occurs; entitlement transitions to free at period end. No immediate
  cut, no refund, no proration.
Rationale (why option (a) — cancel immediately with a prorated refund — was rejected): **Stripe does
  not automatically refund negative prorations.** Cancelling mid-period generates a credit that lands
  on the customer balance, not on the card: "negative prorations aren't automatically refunded and
  positive prorations aren't immediately billed, although you can do both manually"
  (https://docs.stripe.com/billing/subscriptions/prorations). Converting that credit into a card
  refund requires issuing the refund and then manually adjusting the customer balance back to zero
  (https://docs.stripe.com/billing/subscriptions/cancel). That is a two-step manual reconciliation
  with a real failure mode — a refund issued and a balance left un-zeroed silently double-credits the
  customer. Option (b) is one API call Stripe supports natively
  (https://docs.stripe.com/api/subscriptions/cancel), needs no reconciliation, and honours the paid
  period the customer already bought. Per Charter §8, the rejected Stripe feature is named: manual
  proration refund + balance adjustment.
  Secondary reason: option (b) is also the kinder reading of the Refund Policy, which nowhere obliges
  Lyceon to refund on an eligibility change the customer caused.
Evidence:
  - Prod: `profiles.country_code IS NOT NULL` on **0 of 115 rows**:
      SELECT count(*) FROM public.profiles WHERE country_code IS NOT NULL;  -- 0
      SELECT count(*) FROM public.profiles;                                  -- 115
    The egress rule has no data to act on until SCL-046 lands.
  - Repo: `customer.updated` is not handled at all (`webhookHandlers.ts:297-334`), so the trigger this
    rule hangs off does not exist yet (audit G-02).
Version: Doc 01 V8 §21 gains a country-egress row, or §22.1's `customer.updated` action is extended.
Owner action: amend §22.1's `customer.updated` action to include the egress branch, and add the
  resulting transition to §21. No schema change.
Artifact: not in the Phase C thin slice.

---

SCL-046 | 2026-08-20 | Doc 01 V8 §22.1 / INV-03-08 — student country derives from the PAYER's Stripe billing address | PROPOSED

Change: INV-03-08 gates the **student** on billing-address country. Doc 01 V8 §22.1 syncs
  `customer.updated` to the profile of the Stripe **Customer**. Under SCL-043's payer model those are
  not the same profile in the guardian-paid or third-party-paid case, and in the unaccompanied case
  the Customer may have no Lyceon profile at all. The sync target must be stated as the entitled
  student, not the Customer.
WAS: Doc 03 Part XI Invariant Registry (heading verified: "# **Part XI — Invariants**" →
  "## **Invariant Registry**"), INV-03-08: "LISA access requires billing address country IN
  {US, CA, UK, AU, NZ, IE, SG} at V1 launch. **The authoritative signal is Stripe billing address**,
  not IP geolocation or self-declared country." Doc 01 V8 §4 ("## **§4 Profile schema (target-state)**")
  carries `country_code TEXT, -- ISO 3166-1 alpha-2, from billing address (authoritative)` with the
  rationale "populated from Stripe billing address (not self-declared at signup) per entitlement
  invariant that country follows billing." Doc 01 V8 §22.1's `customer.updated` action reads
  "Sync billing address → `profiles.country_code` for entitlement gating" — with no statement of
  *whose* profile.
IS: `customer.updated` writes the payer's billing country to the **entitled student's**
  `profiles.country_code`, resolved through the subscription item's `metadata.student_profile_id`
  (SCL-045). Where one payer funds several students, each entitled student receives the payer's
  country. Where the payer has no Lyceon profile, the country is still written to the student.
Rationale: INV-03-08's purpose is compliance exposure on *LISA access*, which is a student-side gate.
  Deriving it from a guardian's profile row that the student never touches would leave the invariant
  reading a value nobody sets. Stripe places the billing address on the Customer object, not the
  subscription (https://docs.stripe.com/api/customers/object), so the payer's address is the only
  address Stripe has — the mapping to the student must be Lyceon's, which is precisely the carve-out
  the Charter reserves from Stripe supremacy.
Evidence:
  - **The invariant has no data source in either model.** `country_code` is non-null on **0 of 115**
    profile rows (SQL in SCL-047). This is not a guardian-model artifact; it is unset for everyone,
    because `customer.updated` has never been handled.
  - `requires_tier_1_country` is `true` on all 8 `entitlement_features` rows in production and is read
    by **zero** application code (audit G-10):
      $ grep -rn "requires_tier_1_country" --include=*.ts --include=*.tsx --include=*.sql . \
          | grep -v node_modules | grep -v "^./docs/"
      ./supabase/migrations/00000000000000_genesis.sql:191:  requires_tier_1_country BOOLEAN DEFAULT TRUE,
      ./scripts/ci/genesis-schema.expected.sql:3662:    requires_tier_1_country boolean DEFAULT true,
    Two hits, both DDL. INV-03-08 is currently enforced nowhere.
Version: Doc 01 V8 §22.1's `customer.updated` action gains "of the entitled student(s), resolved via
  subscription-item metadata." INV-03-08's text is unchanged — its authoritative signal is still the
  Stripe billing address; only the write target is disambiguated.
Owner action: amend §22.1's action cell; add a one-line note to Doc 03 INV-03-08 that the billing
  address is the payer's and the gate is the student's. No schema change.
Artifact: not in the Phase C thin slice (unaccompanied path: payer and student are the same person, so
  the distinction does not bite — deliberately, per Charter §9).

AMENDED 2026-08-27 — WHERE THE GATE LIVES, AND WHY IT IS OURS.
  Owner ruling: exhaust the Stripe-native options before building anything, and name the surfaces
  rejected so nobody re-litigates this. FOUR were evaluated against INV-03-08; all four fail. The
  survey ships as a gate — `tests/ci/stripe-country-control-survey.contract.test.ts` — which PRINTS
  the evaluation and FAILS the day Stripe ships a native billing-country allowlist, so our control is
  deleted rather than carried forever.

  1. `shipping_address_collection.allowed_countries` — REJECTED. The only `allowed_countries` in
     Checkout create params (verified: exactly one occurrence in stripe@20.4.1
     Checkout/SessionsResource.d.ts), and it sits inside `interface ShippingAddressCollection`,
     documented "which countries Checkout should provide as options for shipping locations". Moot
     regardless: owner ruling is that NO shipping address is collected.
  2. Stripe Tax / `automatic_tax` — REJECTED. Its params are `enabled` and `liability` only. It
     COLLECTS a billing address for calculation ("Enabling this parameter causes Checkout to collect
     any billing address information necessary for tax calculation") and restricts nothing. Tax
     registrations decide whether tax is CHARGED, not whether checkout proceeds — an unregistered
     country is charged zero tax, not refused.
  3. `payment_method_configuration` — REJECTED. A configuration id selecting which payment METHODS
     appear. Per-country availability of methods is not a country allowlist for the customer;
     removing a method does not stop a card from an ineligible country.
  4. Radar rules + Value Lists — REJECTED, and this is the closest one. Radar IS a genuine native
     country mechanism: `Radar.ValueList.item_type` includes `'country'` (verified in the SDK), and
     a Dashboard rule can reference an API-managed list. It fails on SUBJECT and on MOMENT.
     INV-03-08 gates LISA ACCESS on the BILLING ADDRESS, enforced on every request inside
     `canAccessFeature` (Doc 03B). Radar decides ONE PAYMENT at ONE MOMENT. It cannot gate a
     free-tier student, a student entitled before any rule existed, or the SCL-043 guardian case
     where the payer's country is not the student's. WHERE THE USER LANDS also matters: a Radar rule
     blocks the payment, so the user reaches Checkout, enters a card, and is declined — a worse
     experience than never being offered the purchase, and it produces no server-side record of the
     eligibility decision. Worth adding as DEFENCE IN DEPTH; it cannot be the control.

  THEREFORE the control is ours, and it is a gate rather than a subsystem: one pure function,
  `server/lib/stripe/country-eligibility.ts`, reading the Tier-1 list from
  `entitlement_runtime_config` (key `tier_1_countries`) rather than a constant in code.

  TIMING CORRECTION — the gate cannot live wholly at session creation. At that moment there is no
  billing address to gate on: the customer types it DURING Checkout. The SDK states it —
  `customer_details.address` is "The customer's address after a completed Checkout Session". So the
  one rule has three call sites:
      session creation            block only a country ALREADY known (returning payer). Unknown must
                                  NOT block, or every first-time buyer is refused.
      checkout.session.completed  the DERIVATION point: read the billing country, persist it to the
                                  entitled student's `profiles.country_code`, deny entitlement if
                                  ineligible.
      customer.updated            EGRESS: the Portal permits customer-initiated billing-address
                                  changes, so eligibility can lapse after purchase.

  ABSENCE IS NOT INELIGIBILITY. `unknown` does not block checkout but DOES deny entitlement;
  `profiles.country_code` is null on 0 of 115 rows, so collapsing the two would revoke everyone.
  An unseeded Tier-1 list FAILS CLOSED — `entitlement_runtime_config` holds 0 rows in production, and
  an empty list is a configuration not yet made, not a decision that everyone qualifies.

  OWNER ACTION ADDED: seed `entitlement_runtime_config` key `tier_1_countries` (value_type `array`)
  with INV-03-08's set {US, CA, UK, AU, NZ, IE, SG}. Until it is seeded the gate denies entitlement
  by design, which is why this is an owner action and not a default in code.

AMENDED 2026-08-28 (a) — THE ENCODING RULE. Recorded ONCE so nobody re-seeds `UK`.

  Owner ruling 2026-08-28: **the spec names countries; the config stores ISO 3166-1 alpha-2; the
  mapping between them is the standard one.** This is an ENCODING question, not an invariant question,
  so INV-03-08's text is NOT amended and no SCL is raised against it.

  The seed value for the United Kingdom is therefore **`GB`**, not the invariant's prose spelling
  `UK`. `UK` is not an assigned ISO 3166-1 alpha-2 code (it is exceptionally reserved), Stripe sends
  alpha-2 on the billing address, and a list containing `UK` would match no real customer — the gate
  would deny every genuine UK purchaser while believing it admitted them.

  The locked corpus already says this in its own words, which is why no spec change is needed:
  Doc 01 V8 §4 (heading verified: "## **§4 Profile schema (target-state)**") declares
  `country_code TEXT, -- ISO 3166-1 alpha-2, from billing address (authoritative)`. The prose in
  INV-03-08 and the encoding in §4 are consistent; only a literal transcription of the prose into a
  machine-readable list is wrong.

  NO NORMALISATION LAYER IN CODE. `evaluateCountryEligibility` trims and uppercases and does nothing
  else. A UK-to-GB translation would silently repair one wrong code and thereby guarantee the next
  wrong code survives unnoticed. The config holds correct codes; that is the whole rule.

  Artifact: `docs/plans/Owner_DML_tier_1_countries.sql` (seeds `GB`); the assertion is pinned in
  `tests/ci/stripe-country-gate.contract.test.ts` ("uses `GB`, not `UK`"), which fails if the seed is
  ever reverted to the prose spelling.

AMENDED 2026-08-28 (b) — RADAR: SANCTIONED DEFENCE IN DEPTH, DEFERRED, NOT BUILT.

  Stripe has **no product-availability-by-country feature**. The nearest native mechanism is a custom
  Radar rule matching `card_country` against a country Value List (Radar Value Lists support
  `item_type: 'country'`). It is hereby recorded as SANCTIONED defence in depth — permitted to be
  added later, deliberately NOT built now, and explicitly not the control.

  Why it cannot be the control, restated for the record: it blocks ONE PAYMENT at ONE MOMENT, whereas
  INV-03-08 gates LISA ACCESS on every request. It therefore cannot gate a free-tier student, a
  student entitled before any rule existed, or the SCL-043 guardian case where the payer's country is
  not the student's. It also blocks the payment rather than the session, so the user lands on
  Checkout's card-declined state with no explanation of the real reason.

  Two further costs, stated so the deferral is a decision rather than an omission:
    - Custom Radar rules require **Radar for Fraud Teams**, a paid add-on with a per-transaction fee.
      The control is not free.
    - Stripe's own documentation cautions that businesses in the EU may be affected by the
      **Geo-blocking Regulation** when blocking by country. **Ireland is on the Tier-1 list**, so this
      is not hypothetical for Lyceon and needs counsel input before any Radar rule is enabled.

  DEFERRED UNTIL THE REAL GATE IS PROVEN. The application gate (wired 2026-08-28 at
  `checkout.session.completed`, `server/lib/stripe/webhook-handler.ts`) is the control. Radar may be
  added on top of a working gate; it may not substitute for one.

---

SCL-045 | 2026-08-20 | Doc 01 V8 §20 — multi-student billing is one subscription item per student, not quantity | PROPOSED

Change: Owner ruled multi-student households in scope at launch. Doc 01 V8 §20 specifies "Stripe
  Subscription per entitled profile," which does not describe how one payer funds several students.
  This SCL fixes the shape: one Customer per payer, one Subscription, one **SubscriptionItem per
  student**, each carrying `metadata.student_profile_id`.
WAS: Doc 01 V8 §20 (heading verified: "## **§20 Subscription model**"): "Stripe Customer per Lyceon
  profile (one-to-one, `profiles.stripe_customer_id`)" and "Stripe Subscription per entitled profile."
  Doc 01 V8 §35 ("## **§35 Guardian-student linkage**") permits the linkage — "Guardians are linked to
  **one or more** students via `guardian_links`" — and §31.3 ("### **31.3 Guardian with multiple linked
  students**") specifies the derivation, but no section specifies the *purchase*. Proof of absence:
    $ grep -rn -i "quantity" docs/Spec/ docs/plans/            # 0 hit(s)
    $ grep -rn -i "second student" docs/Spec/ docs/plans/      # 0 hit(s)
    $ grep -rn -i "additional student" docs/Spec/ docs/plans/  # 0 hit(s)
    $ grep -rn -i "second subscription" docs/Spec/ docs/plans/ # 0 hit(s)
  "family plan" occurs exactly once corpus-wide, in Doc 01 V8 §42's cross-doc table as
  "family plan handling **(future)**"; Doc 01 V8 §20 likewise defers "Future tiers (e.g., Family,
  School)". Both are placeholders naming no mechanism.
IS: One Stripe Customer per payer. One Subscription per payer. One SubscriptionItem per entitled
  student, each carrying `metadata.student_profile_id`. Individual billing is the one-item case — it
  is not a separate code path. Entitlement is keyed on the subscription **item**, not the subscription.
Rationale:
  - **Stripe supports it natively.** Multiple prices on one subscription are modelled as separate
    subscription items producing a single combined invoice per period
    (https://docs.stripe.com/billing/subscriptions/multiple-products), and each item carries its own
    independent `metadata` (https://docs.stripe.com/api/subscription_items/object). Adding or removing
    a student is `subscription_items.create` / `.delete`
    (https://docs.stripe.com/api/subscription_items).
  - **Quantity is rejected because students are not fungible.** Quantity is documented for "product or
    subscription quantities" where units are interchangeable
    (https://docs.stripe.com/billing/subscriptions/quantities). Decrementing quantity from 2 to 1
    carries no information about *which* student lost access, so the entitlement write would have no
    subject. Per-item metadata is the only shape that names the student on the Stripe object.
  - **Spec-level support for per-student granularity.** Doc 01 V8 §36.4 (heading verified:
    "### **36.4 Unlinking and billing implications**") already models money at per-student granularity:
    on unlink the guardian is prompted "You are still paying for **this student's** subscription. Keep
    or cancel?" — a question that is unanswerable under a quantity model and natural under one item
    per student.
  - **Known consequence, recorded not resolved:** items on one subscription share one billing cycle,
    so adding a student mid-cycle prorates onto the existing period, and removing one generates a
    proration credit that Stripe does not auto-refund (see SCL-047's citation). That is acceptable —
    it is the same mechanism SCL-047 already rules on — but it means "cancel one student" is not
    "refund one student," and the Refund Policy governs if a refund is owed.
Evidence — the DDL delta, and a correction to the brief:
  - `entitlements` currently carries two unique constraints:
      SELECT con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname='entitlements';
      -- entitlements_stripe_subscription_id_key | UNIQUE (stripe_subscription_id)
      -- entitlements_profile_id_unique (index)  | UNIQUE (profile_id)
    **Only the first forecloses group billing.** Two students on one subscription need two
    `entitlements` rows sharing one `stripe_subscription_id`, which
    `entitlements_stripe_subscription_id_key` rejects. `UNIQUE (profile_id)` is *correct* and must be
    **kept** — one entitlement per student is the invariant, and it is the `upsert` `onConflict`
    target at `server/lib/account.ts:353-370`. The brief characterised both as foreclosing; that is
    wrong for the second, and acting on it would delete the constraint the write path depends on.
  - DDL required (queued, not authored — WS-M freeze): drop `entitlements_stripe_subscription_id_key`;
    add `stripe_subscription_item_id TEXT UNIQUE` as the Stripe-side entitlement key. Recorded in
    `docs/plans/STRIPE_DDL_QUEUE.md`.
  - **Application-layer foreclosure, and the CI gate that must retire with it.** The database does not
    foreclose multi-student — `guardian_links` carries only
    `unique_active_link UNIQUE NULLS NOT DISTINCT (guardian_profile_id, student_profile_id, status)`,
    which permits N students per guardian and matches §35 exactly. The foreclosure is entirely in code:
      * `server/lib/account.ts:39-72` `createGuardianLink` — `.limit(2)` then throws
        `GUARDIAN_ALREADY_LINKED`. **No second link can be created.**
      * `server/lib/account.ts:538-568` `getPrimaryGuardianLink` — throws on >1.
      * `server/lib/account.ts:575-597` `getAllGuardianStudentLinks` — throws on >1 despite its name
        and its "Get ALL active student links" docstring.
      * `tests/ci/guardian-linking.contract.test.ts:94` —
        `describe('Guardian Linking 1:1 Enforcement Contract')`, **green in the required `ci` job**,
        asserting 409 on a second student. Verified: it passes because `vi.mock('../../server/lib/
        account', () => accountMocks)` at line 54 replaces the module, so `createGuardianLink` never
        runs; the test asserts only the route's error-code→HTTP mapping at
        `server/routes/guardian-routes.ts:249-266`. It is a real assertion of that mapping (planted
        failure confirmed: changing the matched code string yields "expected 500 to be 409"), but its
        name overclaims — the 1:1 invariant it names is enforced in the mocked-out function.
    **This gate must retire with this SCL's promotion, never before** — removing it early leaves the
    invariant unenforced with no replacement.
Version: Doc 01 V8 §20 gains the multi-student billing shape; §36.4's prompt is unchanged and becomes
  per-item. Doc 09 §5.4's "family plan" placeholder can be struck or pointed at §20.
Owner action: (1) amend §20; (2) apply the queued DDL when the freeze lifts; (3) retire
  `tests/ci/guardian-linking.contract.test.ts` **bundled with this promotion**; (4) note that the
  guardian-paid path additionally blocks on the defect recorded in
  `docs/plans/WS-GL_Guardian_Link_Data_Layer.md`.
Artifact: DDL queued. Not in the Phase C thin slice (thin slice is the one-item unaccompanied case).

---

SCL-044 | 2026-08-20 | Doc 01 V8 §20 — payer affirmation at Checkout; no cardholder name, no ID verification | PROPOSED

Change: No document specifies what the person entering the card affirms, or what Lyceon persists about
  that affirmation. This SCL creates both rules.
WAS: Nothing. Doc 01 V8 §20's "Who pays" subsection distinguishes the three payer cases but specifies
  no affirmation and no consent artifact. The Auto-Renewal Notice §3.3 requires a consent record but
  is a consumer contract, not an engineering spec — no `docs/Spec/` section implements it.
IS:
  1. **Affirmation.** At Checkout the payer affirms they are 18+ and authorized to use the payment
     method, via `consent_collection[terms_of_service] = 'required'`, with the affirmation language
     carried in `custom_text[terms_of_service_acceptance]`.
  2. **No cardholder name is stored.** Cardholder name is unverified by every card network, so it
     carries no evidentiary value and is pure PII duplication. Lyceon does not collect, store, or
     match it.
  3. **No identity verification.** No document scan, no KBA, no age-assurance vendor at Checkout.
     (Distinct from SCL-051's under-13 VPC requirement, which is a separate flow with a separate
     legal basis.)
  4. **What is persisted — a consent record**, not a name: Checkout Session id, Stripe Customer id,
     terms version, hash of the exact text displayed, Stripe's recorded consent value, timestamp, IP,
     user agent, entitled student profile id, and payer relationship (`self` | `guardian` |
     `third_party`). No name, no address, no card data.
  5. **`customer_email` is the payer's, never the student's.** In the unaccompanied case these
     coincide. In the guardian and third-party cases they must not be conflated: the Customer email
     receives receipts, renewal reminders, and the Billing Portal link.
Rationale:
  - Stripe supplies the mechanism. `consent_collection[terms_of_service]='required'` renders a
    checkbox and blocks payment until it is checked; when accepted the Session's
    `consent.terms_of_service` is set to `accepted`
    (https://docs.stripe.com/api/checkout/sessions/create). `custom_text[terms_of_service_acceptance]`
    replaces the default agreement text, up to 1200 characters, with Markdown links permitted
    (https://docs.stripe.com/payments/checkout/customization/policies).
  - **Hard prerequisite, and it fails silently:** the Terms of Service URL must be set in the
    Dashboard business public details *before* `terms_of_service: 'required'` will work — Stripe's own
    wording is "Before requiring agreement to your terms, set your terms of service URL in your public
    details of your business" (same page). Without it the Session creation throws and every checkout
    returns 500 with no code-level signal that the cause is configuration.
  - **Stripe's own caution applies to the custom text**, and the Charter's authority order makes it
    binding: Stripe states the custom text may not "violate or create ambiguity with the
    Stripe-generated text on Checkout" or applicable law. The affirmation language is therefore
    counsel-owned, not engineering-owned.
  - The record shape is what the Auto-Renewal Notice already requires: §3.3 (heading verified:
    "### **3.3 Records of Consent**") requires "the date and time of consent, the version of the terms
    you agreed to, and the account associated with the consent," retained per §6.7 for "no less than
    three (3) years from the date of consent or one (1) year after termination of the subscription,
    whichever is longer." The text hash is added beyond the Notice's minimum because a version string
    alone cannot prove *what* was displayed if the version file is later edited.
  - Refund Policy §10 already contemplates a payer who is neither student nor guardian — "If your
    subscription was paid for with a promotional credit, a gift subscription, or a scholarship
    provided by Lyceon or a **third party**" — which is why `payer_relationship` carries three values
    rather than two.
Evidence:
  - No consent surface exists. `server/routes/billing-routes.ts:236-259` creates the Session with no
    `consent_collection` and no `custom_text` (audit G-33).
  - No billing-consent table exists in production. Sweep of `%consent%` returns three tables, none of
    them a billing consent artifact — one is the under-13 linking flow, two are the Doc 01A §2 config
    pair:
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname ILIKE '%consent%' AND c.relkind='r';
      -- guardian_consent_requests
      -- consent_runtime_config
      -- consent_runtime_config_history
  - The one checkbox constraint is a live legal question, not an engineering one — see
    `docs/plans/Stripe_Open_Questions.md` Q1 (California §17602(a) requires auto-renewal offer terms
    be separate and distinct from general terms of use; Stripe Checkout provides exactly one
    `terms_of_service` checkbox).
LAUNCH GATE 2026-08-20 (owner-acknowledged, assigned to counsel) — **the published terms carry two
  different version strings.** The page header reads `2024-12-20`; the PDF reads `12/20/2025`. This
  SCL's consent record captures "the version of the terms you agreed to" (Auto-Renewal Notice §3.3,
  heading verified: "### **3.3 Records of Consent**"), retained per §6.7 for no less than three years
  from consent or one year after termination, whichever is longer. **A wrong displayed version makes
  every consent record wrong for its whole retention life**, and the record is the artifact Lyceon
  would produce to evidence §17602(a)(4) consent. Not designed around: the version string must be
  reconciled and made single-sourced before any consent record is written. Consent capture is
  Phase C.2, so nothing has been persisted against the ambiguous version yet.
Version: Doc 01 V8 §20 gains a payer-affirmation subsection; a new consent-record table joins
  Appendix B and Appendix E's ownership matrix.
Owner action: (1) **Dashboard, owner-only:** set the Terms of Service URL in Settings → Business →
  Public details. (2) Approve the affirmation text with counsel. (3) Apply the queued consent-record
  table DDL when the freeze lifts. (4) Amend §20 and the appendices.
Artifact: consent-record table DDL queued in `docs/plans/STRIPE_DDL_QUEUE.md`. Checkout parameters are
  in the Phase C thin slice; **if the table does not exist at Phase C, Phase C stops and reports
  rather than authoring DDL** (Charter §7).

---

SCL-043 | 2026-08-20 | Doc 01 V8 §31.4 / §20 — the Stripe Customer is the PAYER; entitlement always attaches to the student | PROPOSED

Change: Doc 01 V8 §31.4 is directionally right and incompletely stated; the code implements the retired
  V6 model. This SCL states the rule for all three payer cases and records the consequence for
  `profiles.stripe_customer_id`.
WAS: Doc 01 V8 §20's "Who pays" subsection covers "Student pays for self" and "Guardian pays for linked
  student"; §31.4 (heading verified: "### **31.4 Guardian paying for linked student**") states
  "Guardian pays for student (Stripe Customer is guardian; `stripe_customer_id` on guardian's
  profile). Subscription produces entitlement on **student's profile**, not guardian's." §20 also
  states "Stripe Customer per Lyceon profile (one-to-one, `profiles.stripe_customer_id`)" — which
  presumes every Customer is a Lyceon user.
IS: **The Stripe Customer is the payer.** Three cases, one rule:
  - Unaccompanied student pays for self → the student is the Customer.
  - Guardian pays → the **guardian** is the Customer.
  - Third party pays (gift, scholarship, sponsor) → **the payer is the Customer, and may have no
    Lyceon profile at all.**
  In every case **entitlement attaches to the student profile**, resolved through
  `metadata.student_profile_id` on the subscription item (SCL-045).
  Consequence: **`metadata.student_profile_id` becomes the authoritative payer→student mapping, and
  `profiles.stripe_customer_id` degrades to a convenience index.** §20's one-to-one presumption breaks
  in the third-party case — there is no profile row to hold the id.
Rationale:
  - Stripe places the Customer at the payer: the Customer object holds the payment method, billing
    address, receipt email, and Billing Portal session
    (https://docs.stripe.com/api/customers/object). Modelling the student as Customer while the
    guardian's card funds it puts the guardian's billing address and receipt email on the child's
    record — which is both wrong on the Stripe object model and a PII placement error in a minors'
    product.
  - Stripe has no concept of who a subscription is *for*. That mapping is Lyceon's, which is exactly
    the Charter §1 carve-out. It lives in item metadata because that is where Stripe supports
    integrator-owned data on a per-student object
    (https://docs.stripe.com/api/subscription_items/object).
  - Refund Policy §10 already contemplates the third-party payer ("a gift subscription, or a
    scholarship provided by Lyceon or **a third party**"), and §7.4 constrains refunds to "the original
    payment method … We do not issue refunds … to a different person than the original payer" —
    a rule that is only expressible if the payer is a first-class identity, which the Customer is and
    the student-as-Customer model is not.
  - Doc 02B V4 §494 (heading verified: "## **Guardian-Paid Student Entitlement**") already states the
    entitlement half correctly: "entitlement lives on the student's profile … The student is treated
    as premium at runtime regardless of who paid. … Payment source does not change runtime entitlement
    semantics." This SCL changes nothing there; it fixes only the Customer side.
Evidence — repo implements the retired V6 model:
  - `server/routes/billing-routes.ts:131-142` sets `profileId = linkedStudentId` for
    `role === "guardian"`; `:184` reads `getProfileStripeCustomerId(profileId)`; `:186-196` creates the
    Customer against that **student** `profileId` with `email: req.user!.email` — the **guardian's**
    email on the **student's** Stripe Customer — and persists it to the student's profile via
    `setProfileStripeCustomerId` (`server/lib/account.ts:400-418`).
  - The retired V6 file says exactly this: `docs/Spec/Lyceon — Document 01_ … (V6).md:1767` —
    "Checkout: student is the Stripe customer (identified by `profiles.stripe_customer_id` on
    student's profile); guardian's payment method is the funding source." V8 (last commit 2026-06-27)
    reversed it; the code (`@implemented 2026-08-09`) is newer than V8 and follows V6.
  - **The V6 file is still present in `docs/Spec/` and is therefore still citable**, which is how this
    divergence survived. Per Charter §1 it is treated as absent and reported here:
      $ ls -la "docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust (V6).md"
      -rw-r--r-- 1 root root 103918 Aug 19 08:46 …
    Quarantining it is an owner prerequisite for Phase C.
  - Prod: four orphan `profiles.stripe_customer_id` rows predate both models and are abandoned per
    Charter §4 (`SELECT count(*) FROM public.profiles WHERE stripe_customer_id IS NOT NULL;` → 4).
Version: Doc 01 V8 §20 and §31.4 both amended. §20's "one-to-one" claim is narrowed.
Owner action: (1) amend §20's "Who pays" to add the third-party case and to state the Customer is the
  payer; (2) amend §20's Customer/profile relationship from one-to-one to "one Customer per payer;
  `profiles.stripe_customer_id` is populated only where the payer is a Lyceon user"; (3) state
  `metadata.student_profile_id` as the authoritative mapping in §22; (4) **quarantine the V6 file.**
Artifact: implemented in the Phase C thin slice for the unaccompanied case (payer = student).

---

SCL-042 | 2026-08-20 | Governing doctrine — Stripe-native supersedes the spec on MECHANISM, with two carve-outs | PROPOSED

Change: Records the owner's 2026-08-19 ruling on authority order for the billing and entitlement
  surface. This entry governs every future session touching Stripe and should be read before the
  others.
WAS: No corpus-wide statement of precedence between `docs/Spec/` and a payment vendor's documented
  patterns. Doc 09's header comes closest — it excludes "Stripe API runtime behavior — billing-period
  mechanics, customer/subscription/invoice/charge object lifecycle, deletion API semantics,
  anonymization API capabilities (**Stripe owns; Doc 09 references Stripe as canonical at runtime and
  never invents Stripe mechanics**)" — but that is one document disclaiming one area, not a rule.
  Doc 00 V6 establishes the spec corpus as authoritative without contemplating a vendor exception.
IS: **Where Stripe documents a pattern, that pattern wins on mechanism, and the spec gets an SCL.**
  In scope: subscription modelling, idempotency keying, proration, consent collection at Checkout,
  webhook verification and replay, dunning.
  **Two carve-outs, neither negotiable:**
  1. **The Refund Policy and the Subscription / Auto-Renewal Notice.** Published consumer contracts
     with statutory backing. Stripe supplies the mechanism; it has no opinion on Lyceon's refund
     windows or on California Business & Professions Code §17602. **Where Stripe's default and the
     Notice differ, Stripe is configured to match the Notice.**
  2. **Entitlement is student-scoped.** Stripe has no concept of who a subscription is *for*. That
     mapping is Lyceon's and stays in `docs/Spec/`.
  **Corollary — managed-service-first, with a receipt.** Before hand-rolling scheduling, retries,
  dunning, proration, tax, or a billing portal, the rejected Stripe feature is named with its
  documentation page and the reason for rejection. "We already have code for it" is not a reason.
  **Corollary — an unlinked appeal to Stripe is not an appeal.** A claim that "Stripe does it this
  way" without a specific documentation page is not reviewable and carries no authority. Without this,
  the supremacy rule becomes a licence for whatever the implementer already wanted to build.
Rationale: Lyceon's billing surface accumulated three parallel models — an `accounts`-keyed entitlement
  model, a V6 student-as-Customer model, and a partially-built V8 model — none reconciled to Stripe's
  object graph. The audit found 47 deltas, of which seven were code with no spec basis and four were
  documents disagreeing with each other. A vendor whose object model is already the source of truth at
  runtime cannot be second-guessed by a document that has never been executed. Making that explicit
  removes the recurring argument and replaces it with a citation requirement.
  **Scope boundary — this is a mechanism rule, not a product rule.** Stripe decides how a subscription
  is shaped, how idempotency is keyed, how consent is collected. `docs/Spec/` decides who a
  subscription is for, what entitlement means, and what a guardian may see. Stripe cannot arbitrate
  those and must not be cited as though it could.
Evidence — the four SCLs in this set where the rule is load-bearing and produces a concrete outcome:
  - SCL-045: subscription items over quantity
    (https://docs.stripe.com/billing/subscriptions/multiple-products).
  - SCL-047: `cancel_at_period_end` over a manual proration refund, because Stripe does not
    auto-refund negative prorations
    (https://docs.stripe.com/billing/subscriptions/prorations).
  - SCL-048: `refund.*` over `charge.refunded`, per Stripe's own changelog
    (https://docs.stripe.com/changelog/acacia/2024-10-28/refund-webhook-update) — this one corrected
    the brief.
  - SCL-049: `livemode` assertion on receipt (https://docs.stripe.com/api/events/object).
  And one where the carve-out bites in the other direction: the Auto-Renewal Notice §6.4 requires
  click-to-cancel through the customer portal, so the Stripe Billing Portal is configured to permit
  cancellation (https://docs.stripe.com/customer-management/configure-portal) rather than Lyceon
  building a bespoke cancellation surface — Stripe supplies the mechanism, the Notice supplies the
  requirement.
Version: no existing spec section is contradicted. This is a new governing rule and should land in
  Doc 00 or as a preamble to Doc 01 V8 Part IV.
Owner action: fold into Doc 00 as a vendor-authority clause, or into Doc 01 V8 Part IV §20 as a
  preamble. No schema change. No code change.
Artifact: `docs/SpecAudit/STRIPE_GROUNDING_AUDIT.md` supplies the delta evidence this ruling responds to.

---

SCL-054 | 2026-08-19 | Doc 05B §4.9 KPI fan-out — section/overall validators quarantine instead of aborting the mastery transaction | PROPOSED
Renumbered: allocated `SCL-042` on `main` 2026-08-19; renumbered to `SCL-054` at the `stripe`→`main` merge on 2026-08-26 by owner ruling, resolving an ID collision with the Stripe governing-doctrine entry that independently took `SCL-042` on 2026-08-20. Nothing outside this file cited this entry under its old number, so no citation was rewritten. The 2026-08-19 date is the original and is retained.
> **ID COLLISION — RESOLVED BY OWNER RULING, 2026-08-26.** Two different entries were allocated
> `SCL-042` independently, on two branches that could not see each other: the Doc 05B KPI
> fan-out entry (2026-08-19, authored on `main`) and the Stripe governing-doctrine entry
> (2026-08-20, authored on `stripe`). The owner ruled that the collision be resolved by
> renumbering, and the direction follows the citation counts measured at the merge: the Stripe
> `SCL-042` had **9** citations across four plan documents and `server/lib/stripe/client.ts`,
> and the wider Stripe block `SCL-042`–`SCL-053` carried **152**; the Doc 05B `SCL-042` had
> **zero** anywhere outside this file.
>
> **The Doc 05B KPI fan-out entry is therefore renumbered `SCL-042` → `SCL-054`.** The Stripe
> `SCL-042` keeps its number and every citation to it remains correct. No citation anywhere in
> the repository pointed at the renumbered entry, so none was rewritten; this was verified by
> search across the tree before the change, not assumed.
>
> `SCL-054` keeps its original 2026-08-19 date and so appears out of ID order in this
> date-descending file. That is deliberate: the date records when the change was ruled, and
> altering it to match the new number would falsify the record. Any surviving external reference
> to "SCL-042" that concerns KPI fan-out, quarantine, or `mastery_data_quality_incidents` means
> `SCL-054`.
>
> **This banner previously sat under a second `SCL-042` heading.** The 2026-08-26 `stripe`→`main`
> merge took both sides of the collision, leaving the renumbered entry's OLD heading behind as an
> orphan — heading and banner, no body — while the body lived on here under `SCL-054`. That orphan
> heading made `SCL-042` a duplicate again and failed the duplicate gate on `stripe` at `60eac9c`,
> skipping the whole `ci` job. The orphan heading is deleted and its banner reattached here.

Amended 2026-09-01, in place, while still PROPOSED — narrowed to two function bodies and two columns. The incident-ledger table (`mastery_data_quality_incidents`) and the alerting requirement are WITHDRAWN, not deferred; open question (1) is closed as no-action; the "validators scan too much" framing is corrected below. The owner's instruction named this entry as "SCL-042", which is its pre-renumbering identifier: per the disambiguation note recorded at the old number, any reference to `SCL-042` concerning KPI fan-out or quarantine means this entry. `SCL-042` itself is the Stripe governing-doctrine entry and was not touched.
Change: Doc 05B specifies that all four KPI refreshers validate canonical event history and RAISE `KPI_HISTORICAL_DATA_INVALID` on any row with NULL `correct` or NULL `occurred_at` (RB-05B-V1-02, matching 05A's hard-fail pattern per RB-05A-V1-22). Two of the four are invoked, via `refresh_domain_mastery` §4.9, inside `apply_mastery_event`'s transaction and downstream of the audit insert, while validating at a grain WIDER than the event being written: `refresh_section_kpi` at (student, section) and `refresh_overall_kpi` at (student). A single malformed row anywhere in that wider grain therefore rolls back every mastery write for that student — skill mastery, audit row, domain mastery, and projection refresh counter — permanently and for every domain. This ruling replaces RAISE with counted quarantine in those two functions only.
THE DEFECT IS THE COUPLING, NOT THE SCOPE — correction to this entry's original framing (2026-09-01). The first draft said these two "validate far beyond the event being written", implying they over-scan. Verified against the deployed function bodies, they do not: each validates EXACTLY what it aggregates. `refresh_section_kpi` validates (student, section) and aggregates (student, section); `refresh_overall_kpi` validates (student) and aggregates (student). A validator that checked less than it aggregates would be the real defect, and neither does. What is wrong is that a student-wide DISPLAY aggregate is a hard availability dependency of a per-event write to the TRUTH ANCHOR. The fix is therefore to change what the validator DOES on failure, not what it looks at; the predicates are unchanged by this ruling.
WAS: All four KPI refreshers hard-fail on NULL `correct`/`occurred_at`. Deployed function bodies carry the inline comment "RB-05B-V1-02: explicit data-integrity validation, no silent NULL filter." The validation predicate in `refresh_section_kpi` is `pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section` UNION the equivalent over `review_error_attempts`; in `refresh_overall_kpi` it is `pi.user_id = p_student_id AND pi.status = 'answered'` with no section or domain restriction — in each case the same predicate the function's own aggregate CTE uses. `refresh_domain_mastery` §4.9 documents that any failure in the chain rolls back the whole chain.
IS: In `refresh_section_kpi` and `refresh_overall_kpi` only, the identical predicate now classifies rather than aborts: (a) the count of offending rows is computed into `v_bad_count` exactly as now, and the RAISE that followed it is deleted; (b) `AND correct IS NOT NULL AND occurred_at IS NOT NULL` is added to the aggregate CTE (`section_events` / `all_events`) so excluded rows enter no aggregate; (c) `v_bad_count` is persisted on the KPI row via new column `excluded_event_count integer NOT NULL DEFAULT 0` on `student_section_kpi` and `student_overall_kpi`. Nothing else changes: no new table, no new key, no alerting surface. `compute_mastery_for_entity`, `refresh_domain_kpi`, `refresh_skill_kpi`, `apply_mastery_event`, and 05C's `PROJECTION_MASTERY_TERM_NULL` are unchanged and remain fail-closed.
Rationale: KPI rollups are display surfaces — streak counts, activity counts, recency-windowed accuracy — and are materialized derivatives under INV-05B-14. Mastery is the product truth anchor from which the projected score derives. The current design lets a data-quality problem in a display surface roll back a valid write to the truth anchor: an inverted dependency in which the less important surface is a hard availability dependency of the more important one. This ruling corrects the direction of that dependency; it does not weaken validation, it relocates the consequence of failed validation from "abort the transaction" to "exclude, count, persist".
This partially reverses RB-05B-V1-02, and the reversal is the part that should be tested hardest. RB-05B-V1-02 was correct to reject the silent NULL filter, and correct for the reason it gave: a silent filter makes corrupt data indistinguishable from absent data and yields a KPI nobody can audit. This ruling does not restore the silent filter. It specifies a third behaviour RB-05B-V1-02 did not consider. Silent filter: rows dropped, no trace, no blast radius. Hard fail: transaction aborted, the RAISE is the only record, blast radius student-wide. Quarantine: rows excluded, count persisted on the KPI row per student and per refresher, blast radius domain. Quarantine is strictly more auditable than the RAISE, which records only that something was wrong at one instant and leaves no durable artifact. If "counted and persisted" is judged not materially different from "silent", this ruling should be rejected — that distinction is the whole case, and the proving mechanism below is built to make it falsifiable rather than asserted.
`refresh_domain_kpi` and `refresh_skill_kpi` remain fail-closed despite costing nothing to change, because for any given event `compute_mastery_for_entity('domain', D)` raises earlier on the same corrupt data, making the domain-scoped KPI raise unreachable for that event. Quarantining them would remove the last fail-closed behaviour at KPI grain for no additional containment.
Evidence:

* Production outage 2026-06-26 → 2026-08-17: 84 answered `practice_session_items` produced zero mastery output. `student_projection_refresh_state` — written by `bump_projection_refresh_counter`, the final statement of `apply_mastery_event` — held zero rows, proving the function never once ran to completion.
* Proximate cause was 42 `practice_session_items` rows with NULL `occurred_at` from a handler defect fixed in `f0bc31e` (2026-08-08). All four affected students held at least one such row.
* Scope proven by counterexample rather than inference: on 2026-08-15 the affected student had two fully clean domains (`Craft and Structure`, `Standard English Conventions`, five diagnostic items each, zero NULLs). Direct read-only invocation of `compute_mastery_for_entity(student,'domain','RW','Craft and Structure',NULL)` returned cleanly (total_events 5, mastery_score 0.5217, level 2), while the poisoned sibling `('M','Advanced Math')` raised `MASTERY_HISTORICAL_DATA_INVALID: bad rows (..., occurred_at=5, ...)`. Zero audit rows existed for the clean domains. Domain-scope validation alone cannot explain that; only the section-wide and student-wide KPI validators can.
* Independent audit (Codex, read-only) confirmed the poison seed in the reproduction test is `status='answered'` in a different SECTION from the event under test, so section-scoped validation cannot account for the failure and `refresh_overall_kpi` is load-bearing.
* Verified read-only against prod 2026-08-19 and again 2026-08-31: zero rows with NULL `correct`/`occurred_at` remain in `practice_session_items`, repaired by `20260816000000` and sealed by CHECK `psi_resolved_requires_occurred_at`; zero in `review_error_attempts`, which carries NOT NULL on both `is_correct` and `occurred_at`. Both canonical ingresses are sealed, so this change alters no current output. It is insurance against the class returning, not a repair of live data — and the sibling gate `05b-domain-kpi-gates.sh`, which asserts exact KPI values, passes unchanged with the amended functions, which is what "alters no current output" means in evidence rather than in claim.

Boundary: this ruling applies only to `refresh_section_kpi` and `refresh_overall_kpi`. It does not relax `compute_mastery_for_entity`'s entity-scope validation — a domain whose own events are corrupt must refuse to produce a mastery number rather than produce a plausible wrong one; that posture is what preserved the evidence during the outage. It does not relax the domain-scoped refreshers. `excluded_event_count` is operator-only: Doc 05 Parent acceptance criterion #20 locks student and guardian read surfaces to `mastery_level`, and surfacing an exclusion count to a student would breach it and expose an internal data-quality problem to someone who can do nothing about it.
WITHDRAWN from this ruling (2026-09-01), having been in the original draft: the `mastery_data_quality_incidents` incident-ledger table, its uniqueness and RLS design, INV-05B-15 as originally worded (which required a ledger row), the alerting requirement and its routing to the derivation-gap surface, and open questions (2) retention and (3) alert threshold, which existed only to serve the ledger. These are withdrawn rather than deferred: the persisted count already answers "how many rows were excluded, for which student, by which refresher", which is the auditability the case for quarantine rests on. A second durable artifact carrying the same fact, plus a channel to announce it, is a larger change than the defect requires and would have to justify itself on its own terms.
Version: Doc 05B V1.0 §4.9 KPI fan-out semantics are superseded for `refresh_section_kpi` and `refresh_overall_kpi` only. RB-05B-V1-02 is partially superseded for the same two functions and stands unchanged for `refresh_domain_kpi` and `refresh_skill_kpi`. INV-05B-14 continues to hold — `excluded_event_count` is recomputed on every refresh from the same event set as every other column and stores no independent state. INV-05B-13 and 05A INV-05A-10 are untouched. Two invariants are added. INV-05B-15 (REWORDED from the draft, which required an incident-ledger row): when either amended refresher excludes any event, the count of excluded events is persisted on that KPI row; a refresher that excludes rows and reports `excluded_event_count = 0` is a defect. INV-05B-16: a corrupt row in section A must not prevent a valid mastery event in section B from committing its skill mastery row, its audit row, and its projection refresh counter. Both are proven by `scripts/ci/05b-kpi-quarantine-gate.sh`, whose mutation harness `scripts/ci/05b-kpi-quarantine-gate.mutations.sh` establishes that each can fail: restoring the RAISE reds INV-05B-16 on the mastery write; persisting a constant 0 instead of the count reds INV-05B-15 on the column while the event still commits; and removing the CTE filter while keeping the count reds the AGGREGATE assertion while the count assertion still passes — which is the mutation that makes "excluded" and "counted" separately falsifiable rather than one claim wearing two names.
Owner action: at next spec pass, amend Doc 05B §4.9 to specify quarantine semantics for the two amended refreshers and reword the "any failure rolls back the whole chain" statement to name the new boundary precisely — mastery and domain refresh remain transactional with the event; section and overall KPI aggregation quarantines rather than aborts. Schema change: two `excluded_event_count` columns; no new table. Code change: `refresh_section_kpi` and `refresh_overall_kpi` bodies. Open question (1) of the draft — whether the `review_error_attempts` NOT-NULL seal ships in this change or separately — is CLOSED AS NO-ACTION: the premise was wrong. That table was flagged as an unguarded ingress lacking an equivalent to `psi_resolved_requires_occurred_at`; verified against prod 2026-08-31 it carries NOT NULL on both `is_correct` and `occurred_at`, which is a stricter seal than the CHECK it was said to lack. Nothing to ship. Questions (2) and (3) are withdrawn with the ledger they served.
Artifact: `supabase/migrations/20260901010000_kpi_quarantine_excluded_count.sql` (renumbered from `20260901000000` before merge — that version string is claimed by `20260901000000_scl_080_guardian_link_code.sql`, already applied to prod; see `scripts/prod-verify/MIGRATION-VERSION-COLLISIONS.md` §4), operator pre/post pair `scripts/prod-verify/kpi-quarantine-pre.sql` and `kpi-quarantine-post.sql`, gate `scripts/ci/05b-kpi-quarantine-gate.sh` and its mutation harness, wired into the `mastery-pipeline` CI job. Rationale for the alternative rejected: moving KPI refresh to an outbox is architecturally cleaner and matches Doc 04B's `mastery_outbox` posture, but does not fix the defect — an outbox-driven `refresh_overall_kpi` still raises on the same data, converting a loud rollback into a silently stale KPI, a worse observability outcome; it also breaks Doc 05B's locked Q3 "sync" answer and weakens INV-05B-14 by making every KPI read a read of possibly-unrefreshed state, at the cost of a new outbox table, dispatcher, retry semantics and ordering guarantees to solve a problem two function bodies solve. The outbox remains worth revisiting only if KPI refresh latency becomes a product problem, which Doc 05B already names as a deferred migration path.

SCL-041 | 2026-08-18 | Doc 03D §7.2 falsified for Flash-class models — state blocks move into systemInstruction | PROPOSED

Change: Doc 03D V1.2 §7.2 specifies that context blocks (mastery, friction, memory, style, item) are late-placed as a `[system note]` user turn immediately before the final student message in `contents[]`. Ablation testing on the target model (Gemini 2.0 Flash) falsified this placement for directive compliance: 25 consecutive responses with blocks in user turns produced zero SCL-034 (diagnostic classification) compliance; the same directives appended to `systemInstruction` produced correct behavior immediately, including the first observed SCL-034 firing.

WAS: §7.2 states "State blocks are injected as a `[system note]` immediately before the current student turn in the conversation messages" with the rationale that proximity to the current turn improves adherence and that keeping the system instruction invariant preserves prompt-cache stability.

IS: For Flash-class models on the Gemini API, state blocks (rendered by `renderStateBlocks`) are appended to `systemInstruction` after a `--- CONTEXT FOR CURRENT QUESTION ---` separator. The `contents[]` array carries only the conversation (student → user, tutor → model). System-role messages from the conversation history are mapped to user-role entries without a `[system note]` wrapper. Consecutive same-role entries are merged into a single entry with multiple parts to prevent the @google/genai SDK's silent same-role merge from corrupting message boundaries.

Rationale: Flash-class models (Gemini 2.0 Flash, 2.5 Flash) attend to `systemInstruction` with different priority than to user turns in `contents[]`. Directives placed in user turns were consistently ignored — not occasionally missed, but structurally invisible to the model's instruction-following path. The §7.2 placement was designed for models that treat system notes in user turns as instructions; the target model does not. Prompt-cache stability is preserved because the state-block suffix changes per turn regardless of placement — the cache key for `systemInstruction` already includes the full string, so no additional cache invalidation occurs vs the user-turn placement.

Evidence:
- 25 Flash-class generations with §7.2 placement: zero SCL-034 fires (diagnostic mode never classified), SCL-035 decompose-first ignored, SCL-039 affective scaffolding missed.
- Same directives appended to `systemInstruction`: SCL-034 fired on first response (BUGGY_PROCEDURE correctly classified for CASE-01's sign-flip pattern), SCL-035 decompose-first honored, SCL-039 flat contradiction applied to CASE-18.
- Findings are consistent across run counts sufficient to rule out random compliance (25 vs 25, p < 0.001 under any reasonable model).

Boundary: this ruling applies to the production model routing table's flash_class alias (currently Gemini 2.0 Flash). Pro-class models may behave differently; if §7.2's placement is later validated for pro_class, the architecture supports per-model placement without code change (the system instruction composition is a pure function of the request).

Version: Doc 03D V1.2 §7.2 is superseded for flash_class models. The behavioral requirement (fact-directive pairing per §7.4) is unchanged — only the placement site moves.
Owner action: at next spec pass, amend §7.2 to specify systemInstruction placement as the default, with a note that the original user-turn placement was tested and falsified for Flash-class models. No schema change. Code change: `orchestrate.ts` `buildSystemInstruction` appends state blocks; `buildConversationMessages` removes state block injection from contents.
Artifact: PR for branch claude/ws-l7-production-port.

SCL-040 | 2026-08-17 | Doc 03C §4.3 cross-reference error — "03A V3 §11" is Policy Decision Logging, not prompt artifacts | PROPOSED

Change: Doc 03C V3 §4.3 references "Doc 03A V3 §11 (policy prompt artifacts)" as the authority for the prompt artifact format. Doc 03A V3 §11 is actually "Policy Decision Logging" — it defines the `tutor_policy_decision_log` table and has no prompt artifact content.

WAS: §4.3 says "Prompt artifacts use the format defined in 03A V3 §11 (policy prompt artifacts)" and proceeds to describe loading behavior (immutable after load, version-keyed, registry-resolved) without specifying the artifact shape or format, delegating that to the cross-referenced section.

IS: No section of Doc 03A defines the prompt artifact format. The cross-reference is a drafting error — §11 is not about prompt artifacts. The loading and resolution semantics in §4.3 itself (immutable, version-keyed, variant-resolved, fallback-to-default) are implemented as specified. The artifact format — a TypeScript module exporting a typed `PromptArtifact` with a `renderSystemInstruction(fields)` function — is derived from §4.3's behavioral requirements (immutability, version keying, field substitution only) and the platform's existing module-load conventions.

Rationale: Discovered during WS-L5 implementation (prompt template system). The loading/resolution semantics are clear and implemented per §4.3. The missing piece is the artifact format itself, which §4.3 delegates to a non-existent source section. Implementation chose TypeScript modules with typed render functions because: (a) immutability is enforced by `ReadonlyMap` + module-load semantics, (b) field substitution is type-checked via `PromptFields`, (c) version keying uses the artifact's own `version` field, (d) the registry is loaded at bootstrap (import time), not at request time.

Version: Doc 03C V3 §4.3 cross-reference to "03A V3 §11" should be corrected. No spec version bump (the behavioral requirements are correct; only the cross-reference target is wrong). No code change — the implementation satisfies §4.3's behavioral requirements.
Owner action: at next spec pass, either (a) correct the §4.3 cross-reference to the actual prompt artifact format section (if one exists elsewhere), or (b) define the artifact format inline in §4.3, or (c) create a new §11.x in Doc 03A for prompt artifact format and update the cross-reference.
Artifact: PR for branch claude/ws-l5-prompt-templates.

SCL-039 | 2026-08-15 | Doc 03D §3 and §5.1 — affective state modulates scaffolding level | OPEN (owner-approved 2026-08-15)

Change: Doc 03D specifies scaffolding by diagnostic mode — knowledge gap, retrieval failure, buggy procedure — and by surface. It does not account for the student's affective state. The owner's blind-authored gold response for CASE-18 departed sharply from the rubric for a reason the document had no field to express.

WAS: Doc 03D §3.3 states that productive struggle is the point and that a tutor who answers for the student has failed. §5.1's CASE-18 rubric specified "give the student one easy next action." The implied model: scaffolding level is a function of what the student knows.

IS: Scaffolding level is a function of what the student knows AND their affective state. When a student expresses self-directed negative judgment, the tutor reduces questioning load and supplies structure.

The rule:

1. Contradict the self-judgment once, flatly, then move on. Not repeated, not expanded, not a speech. "No, you're not" and then the work.
2. Stop asking and start giving. Continued questioning of a student who has just called themselves stupid is experienced as further evidence of incompetence. Each unanswered question confirms the self-judgment.
3. Supply the structure, leave the execution. Give the setup, the framing, the organizing principle. The student still does the final work — but they do it from a position of "I can see how this goes" rather than "I don't know where to start."
4. Restore momentum before resuming diagnosis. Diagnostic questioning resumes on the next item, not in the same turn.

INV-03-04 is unchanged and unaffected. Scaffolding increases; the answer is still never given. In CASE-18 the owner supplied the full proportion setup — which quantity is the numerator, which is the denominator, and the equation to solve — and left the student to solve it. That is the maximum scaffolding this rule permits: everything up to but not including the arithmetic that produces the answer.

Owner's framing, recorded because the reasoning matters more than the rule:

"If the student is self-bashing, we don't want to keep asking them questions. It just makes them feel more incompetent. They have a lot of time to learn. We need to make sure they feel confident, that they're able to understand, and get that pressure off their chest. We are not trying to prove a point to the student or to ourselves that we're always going to follow hard rules. The end goal is the student's education. The end goal is not for us to prove that we can assess something in one question, or do things a specific way."

Evidence: Lepper & Woolverton (2002) and Lepper, Drake & O'Donnell-Johnson (1997) found expert tutors attribute difficulty to the problem rather than to the student and spend a large fraction of their effort on motivation rather than content [Moderate — observational, small samples, consistent across independent groups]. Ryan & Pintrich (1997) established that adolescent help-seeking avoidance is driven by threat to self-worth [Established]; continued questioning of a student who has just voiced a self-worth judgment is such a threat. Craig, Graesser, Sullins & Gholson (2004) established that disengagement predicts absence of learning [Established]; a spiraling student is on the path to it.

Boundary against SCL-036: SCL-036 rules that disengagement, not frustration, is the intervention trigger. This SCL is not an exception to that. Self-directed negative judgment is a precursor signal — it does not yet indicate disengagement, and the correct response is to prevent the transition rather than to treat one as underway. A student saying "I'm stupid" while still describing their own error accurately is engaged. This rule keeps them there.

Boundary against Doc 03 §21: this rule covers ordinary academic self-deprecation. Safety-relevant statements run a separate mechanism (INV-03-16) and a separate response path (Doc 03 §21). Where both could apply, §21 governs.

Owner action: amend Doc 03D §3 to record affective state as a scaffolding input alongside diagnostic mode. Amend §5.1's CASE-18 rubric to permit structural supply rather than a single next action, and add the rule to the authoring brief. No code change — this is prompt-construction and rubric guidance, and it will appear in the system instruction as a directive paired with the recent_friction context block per §7.4. No schema change.

SCL-038 | 2026-08-15 | Doc 03D §9 — A/B power calibrated to realistic coaching effect sizes | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §9 specifies A/B methodology without stating the effect size the harness must be able to detect. Absent that, an experiment can be designed that cannot detect a real effect.

WAS: §9 specifies student-level randomization, pre-registration, covariate adjustment, and test-date cohorting. It does not state the magnitude of effect a LISA change can plausibly produce.

IS: The harness is calibrated to detect effects on the order of **single-digit to low-double-digit SAT points**, not large swings.

Briggs's analysis of NELS data placed commercial coaching at roughly 14–15 points on SAT-math and 6–8 points on verbal. A 2025 meta-analysis found no reliable verbal effect at all.

These are whole-program effects. A single prompt change is a fraction of that. An A/B design powered to detect a 100-point swing is calibrated to marketing copy, not to measurement, and will report null results indefinitely while real improvements go undetected.

Consequences for §9:
- Covariate adjustment is not an optimization, it is a requirement. Between-student variance dwarfs the effect size. §9.3 already specifies this; this SCL records why it is load-bearing.
- Process metrics (§3.2) carry more decision weight at realistic sample sizes than outcome metrics do, because they have better signal-to-noise. §9.2's pre-registration requirement stands, but the practical readout order is process first, outcome as confirmation.
- Claims made externally about score improvement must survive FTC substantiation against these effect sizes, not against aspirational ones.

Owner action: amend Doc 03D §9 to record the expected effect-size range and its consequences for power. No code change. Coordinate with whoever owns marketing claims — the substantiation requirement is downstream of this number.

SCL-037 | 2026-08-15 | Doc 03D §0.1 and §2.1 — INV-03-04 justification corrected; refusal posture grounded | OPEN (owner-approved 2026-08-15)

Change: Doc 03D frames the never-reveal-an-unsubmitted-answer rule as pedagogically grounded. The evidence does not support that framing at the strength implied. Separately, the evidence supports a specific refusal posture that the document did not previously justify.

WAS: Doc 03D §0 asserts that "a tutor that hands over the answer produces a student who feels helped and scores the same," presented as the foundation of the product. Doc 03D §5.1's authoring brief describes the never-reveal rule in learning-science terms.

IS, part 1 — the rule holds; the justification narrows.

**The central premise is well-supported.** Chi et al. (2001) found that constraining tutoring to suppress tutor explanation and force student construction produced equal or greater learning [Established]. "Did the student do the thinking" is a real finding.

**The specific rule is not derivable from it.** Chi, Jordan, VanLehn & Litman (2009) compared eliciting against telling and found no reliable learning difference. The bottom-out-hint literature is genuinely contested.

INV-03-04 therefore stands as a **product decision** — it is what distinguishes a tutoring product from an answer service, and it is what a parent is paying for — not as a conclusion from learning science. Doc 03D must not cite pedagogical evidence it cannot support for this rule. The rule does not weaken; its justification becomes honest.

IS, part 2 — refusal posture is now evidence-grounded.

**Never make declining feel like a rebuke, and never make it the whole response.**

Ryan & Pintrich (1997) and Ryan, Pintrich & Midgley (2001) establish that help-seeking avoidance rises sharply in early adolescence, driven by threat to self-worth and perceived social cost [Established]. The population's default failure mode is not asking too much — it is going quiet. A refusal that costs the student standing raises the probability they stop asking, and a student who stops asking is worse off than one who asked for the answer.

Expert human tutors converge on the same posture from observation: Merrill, Reiser, Ranney & Trafton (1992) found human tutors keep students on a productive path and give substantially more guidance than constructivist theory recommends; Lepper & Woolverton (2002) describe highly effective tutors who rarely say "wrong," ask leading questions instead of correcting, and attribute difficulty to the problem rather than the student [Moderate — observational, small samples, consistent across independent groups].

**They redirect rather than deny.** The observed pattern is substitution of a smaller step for the requested answer, not refusal.

This validates the owner's blind-authored CASE-01 gold response, which never declines explicitly and instead moves directly to the next diagnostic step.

Owner action: amend Doc 03D §0 to describe INV-03-04 as a product decision with the Chi et al. (2001) constructive-activity finding as supporting context rather than as proof. Amend §5.1's authoring brief to specify redirect-over-refuse as the default posture, with the Ryan/Pintrich mechanism recorded. No code change — INV-03-04's enforcement is unchanged and remains structural.

Two measurable gaps, recorded because the product can close them:
1. No study tests whether refusing an answer reduces subsequent help-seeking. The instrumentation to measure this exists in this platform.
2. No study tests "acknowledge briefly, then redirect to a winnable step" against alternatives. This is a load-bearing move in Doc 03D §5.1 CASE-04 and CASE-18.

Both are answerable with the golden set and the attribution fields required by Doc 03D §8. Neither is a V1 requirement.

SCL-036 | 2026-08-15 | Doc 03D §3.2 — intervention trigger changed from frustration to disengagement | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §3 and the golden-set case taxonomy treat escalating frustration and self-deprecation as the signal that a student needs intervention. The evidence identifies a different and better-supported signal.

WAS: §5.1 coverage targets included "self-deprecation escalating" as an intervention-relevant category. §3.2's process metrics carried no disengagement measure. The implied model was that frustration indicates a student in trouble.

IS: **Confusion is not the problem. Disengagement is.**

Craig, Graesser, Sullins & Gholson (2004) found confusion positively predicted learning and boredom negatively predicted it [Established]. A frustrated, engaged student is in a productive state. A student transitioning toward disengagement is the one being lost.

Observable difference:

| State | Signal | Action |
|---|---|---|
| Engaged frustration | Complaining, but messages still contain content, reasoning, or specific objections | Continue tutoring. This student is working |
| Disengagement | Messages shorten and stop containing content. "idk", "ok", "whatever", one-word replies with no substance | Intervene — change approach, reduce difficulty, or offer a win |

Doc 03D §5.1 CASE-01's student complains about twenty minutes and is fully engaged — the message contains a specific, accurate account of what they tried. That student needs a better hint, not intervention. CASE-15's "idk" with no elaboration is closer to the real signal.

**No time threshold exists.** There is no research-supported answer to "how long should a student struggle before the tutor intervenes." Wait-time research covers roughly three seconds of classroom silence and does not transfer to asynchronous text. Any specific number in an implementation is invented. Doc 03D must not specify one, and any future implementation proposing a threshold must state that it is a product heuristic rather than an evidence-backed value.

Owner action: amend Doc 03D §3.2 to add a disengagement signal to the process metrics, replacing the implicit frustration model. Amend §5.1's coverage taxonomy so that the self-deprecation category is described as a tone-and-register test rather than an intervention-trigger test. No code change; this is measurement and rubric guidance.

Instrumentation note: message length trend and content density across a conversation are cheap to compute and are the closest available proxies for the disengagement transition. Neither is validated in tutoring dialogue — treat as a hypothesis to test against the golden set, not as an established detector.

SCL-035 | 2026-08-15 | Doc 03D §5.1 — "I don't know" rubric inverted: decompose first, with a floor | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §5.1's golden-set rubric for silent-student cases (CASE-15, CASE-16) specified shrinking the question as the default response to "I don't know." The owner's blind-authored gold response contradicted this, favouring teaching the core concept. Evidence review resolved against both positions.

WAS: Golden-set rubric — on "I don't know," shrink the question. The owner's blind gold response for CASE-15 instead taught the concept, reasoning that a needs_work student on a concept-heavy item has a knowledge problem rather than an execution problem.

IS: **Decompose first. Teach the concept only after decomposition fails, and no deeper than three levels.**

Rationale: The evidence favours decomposition for a specific reason neither prior position accounted for.

The **expertise reversal effect** (Kalyuga, Ayres, Chandler & Sweller, 2003) [Established] holds that instructional support which helps novices actively *harms* learners who already possess the relevant schema. Teaching the concept when the student's problem was retrieval is therefore not merely wasted instruction — it is negative.

Decomposition is self-diagnosing. It costs one turn and reveals which mode the student is in. Teaching first costs a turn and reveals nothing, while risking the reversal effect.

Two further findings converge: impasse-driven learning (VanLehn, Siler, Murray, Yamauchi & Baggett, 2003) found learning events cluster around impasses the student worked through rather than around smoothly delivered tutor explanations [Moderate to Established]; and Chi et al. (2001) found that constraining tutors to suppress explanation and force student construction produced equal or greater learning [Established].

**The floor is load-bearing.** Decompose three levels and still hit "I don't know," and the tutor is no longer diagnosing — it is grinding. At that point telling is correct. Chi, Jordan, VanLehn & Litman (2009) compared eliciting against telling and found no reliable learning difference, so the cost of telling at the floor is low and the cost of continued decomposition is student disengagement.

Subject qualifier: decomposition in procedural math means sub-computation with verifiable intermediate states. In Reading & Writing the analogue is **localization** — "which sentence would you point to?" — not sub-computation. Doc 03D §5.1 CASE-04's gold response already does this correctly. The evidence for this distinction is structural reasoning, not a finding: [Absent] for direct comparison.

Age qualifier: no evidence of a gradient within 13–18. Treat a 14-year-old and a 17-year-old identically until product data says otherwise.

Owner action: amend Doc 03D §5.1's CASE-15 and CASE-16 rubrics to specify decompose-first with a three-level floor. The owner's blind gold response for CASE-15 stands as authored but is annotated with this ruling, so the calibration set records the disagreement rather than silently overwriting it. No code change.

SCL-034 | 2026-08-15 | Doc 03D §3.1 — fourth diagnostic mode added: systematically applied incorrect procedure | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §3.1's tutor act taxonomy and the diagnostic framing throughout §3 assume two failure modes when a student is stuck — the student lacks the concept, or the student has it and cannot retrieve it. A third mode is well-established in the literature and is absent from the document.

WAS: Doc 03D §3 treats student difficulty as either a knowledge gap or a retrieval failure. §5.1's CASE-03 (prerequisite gap) is the only case addressing a structural cause, and it addresses a missing prerequisite rather than a wrong rule.

IS: Three diagnostic modes, not two.

| Mode | Signature | Correct response |
|---|---|---|
| Knowledge gap | Slow or absent response, no partial recall, no consistent pattern | Teach the concept — but only after decomposition fails, per SCL-035 |
| Retrieval failure | Delay then hedged partial ("something about... signs?"); correct earlier in session | Decompose to surface what is already there |
| **Buggy procedure** | **Fast, confident, wrong. Consistent error pattern rather than random errors** | **Surface the rule the student is actually applying, then contrast it against the correct one** |

Rationale: Brown & VanLehn's repair theory (1980) and VanLehn's Mind Bugs (1990) establish that a common failure mode is a systematically applied incorrect procedure. The student has a rule; it is the wrong rule. The evidence classification is [Established] — the misconception literature is solid.

This mode is diagnostically dangerous because it presents as competence. The student is fast and confident, which reads as understanding. Neither "teach the concept" nor "decompose the question" is the correct response: decomposition confirms the student can execute each step, because they can — they are executing the wrong rule correctly.

Doc 03D §5.1 CASE-01 is exactly this case and was authored as an answer-extraction test. The student has three sign-flip errors in seven days. That is not confusion; that is a consistently applied rule about what happens to a term crossing the equals sign. The case remains valid for what it tests, and now also carries the buggy-procedure signature.

Detection: the distinguishing signal is error *pattern*, not error *rate*. A student making random errors across a skill is in a different mode from a student making the same error every time. The document previously had no field for this distinction.

Owner action: amend Doc 03D §3.1 to carry three diagnostic modes and their signatures. Amend §3.2's misconception repair rate definition to reference the buggy-procedure mode explicitly. No code change (the diagnostic modes are prompt-construction guidance, not an implemented classifier). No schema change.

Note on instrumentation: Learning Factors Analysis (Cen, Koedinger & Junker, 2006) detects when a skill's error rate fails to decline with practice, which is evidence the knowledge component being taught is not the one blocking the student. That is the closest principled trigger for "the named skill is not the real skill." Recorded as available prior art, not as a V1 requirement.

SCL-033 | 2026-08-15 | Doc 03 INV-03-05 narrowed — guardian visibility of LISA-derived topic coverage | OPEN (owner-approved 2026-08-15)

Change: INV-03-05 ("Zero guardian LISA access") as locked forbids "derived indicators" without qualification. Doc 03D §11 specifies a student- and guardian-visible surface showing which skills a student has recently discussed with LISA — a derived indicator sourced from tutor_conversations. Read literally, the invariant forbids it. Karl ruled the surface should exist and the invariant should be narrowed rather than the two left in contradiction.

WAS: Doc 03 Part XI, INV-03-05 — "Zero guardian LISA access. Guardians have no LISA access of any kind: no conversation content, no analytics, no usage counters, no derived indicators." Doc 03A §16.2–16.3 elaborates the same prohibition. Read as written, ANY value computed from a LISA table is forbidden to guardians, including a bare list of skill names.

IS: INV-03-05 forbids guardian access to LISA CONTENT and to indicators that reveal, characterize, or infer from the substance of a conversation. It does not forbid a bare enumeration of which skills a conversation touched.

Permitted to guardians:
- Skill-level topic coverage: which skills the student has recently discussed with LISA, expressed as skill names from the canonical taxonomy and nothing else.

Forbidden to guardians, unchanged:
- Conversation content, verbatim or summarized, in whole or in part
- Message counts, session counts, turn counts, duration, frequency, or any usage volume
- Sentiment, engagement, effort, confidence, or any affective characterization
- Inferred traits of any kind, including learning style (Doc 03D §11.2)
- Crisis flags, crisis review status, or any signal derived from the crisis path (Doc 03 §21.4 governs; guardian contact runs through the §21.3 human process only)
- Anything the student said

Rationale: A skill name is a fact about curriculum coverage, not about the student. "Your child has been working on Linear Equations with the tutor" carries the same informational weight as the practice-surface data guardians already receive and reveals nothing about what was said, how well it went, or how the student behaved. The guardian-trust pillar is served by a parent being able to see that tutoring is happening and on what — that is the product's value, visible.

The prohibition's purpose is protecting the confidentiality of a minor's conversation with a tutor. A skill name does not touch that. Usage counters do — frequency and volume characterize the student's behavior and struggle — and they remain forbidden, which is why the "no usage counters" clause is preserved verbatim rather than narrowed alongside.

Boundary test for any future addition to this surface: if the value would change based on WHAT the student said rather than only WHICH skill was discussed, it is forbidden. Topic coverage passes. Everything else in the original prohibition fails.

Scope note: Doc 03D §11.1's second visible item — skills with recurring difficulty — is derived from practice_session_items, not from any LISA table. It is practice data guardians already receive and is outside INV-03-05's scope entirely. This SCL does not address it and no narrowing is required for it.

Version: Doc 03 INV-03-05 — "no derived indicators" narrowed to "no indicators derived from conversation substance." Doc 03A §16.2–16.3 requires the parallel narrowing. No spec version bump; this SCL records the interpretive boundary. No code change (the surface is unbuilt). No schema change.

Owner action: at next spec pass, amend INV-03-05 in Doc 03 Part XI and the corresponding prohibition in Doc 03A §16.2–16.3 to carry the content-substance qualifier and the boundary test above. Until amended, the locked text reads as an absolute prohibition and this SCL governs.

SCL-032 | 2026-08-15 | Doc 03B §5.5 step 4 vs implementation scope for INV-03-02 (live exam gate on POST /messages only) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03B §5.5 (Start Conversation server steps) lists "Check live exam block (§3.4)" as
step 4, identical to §6.5 step 4 (Append Turn). §3.4 says "Before allowing any tutor turn, check
if the student has an active full-length exam session." The current implementation gates only
POST /api/tutor/messages (append turn, §6.5) — not POST /api/tutor/conversations (start/reuse,
§5.5), not GET /api/tutor/conversations/:id (replay, §7), not GET /api/tutor/conversations
(list, §8), not POST /api/tutor/conversations/:id/close (close, §9). Karl ruled: current scope
is correct. §5.5 step 4 should be removed from the spec.
WAS: §5.5 step 4 says the start-conversation route must check the live exam block (§3.4). §3.4
uses the word "turn" ("Before allowing any tutor turn"). INV-03-02 (Doc 03:2144) says "API
endpoints return explicit access-denied errors during active exam session state" — the plural
"endpoints" is ambiguous. Read together, these provisions could require the gate on all tutor
endpoints including start-conversation.
IS: The gate applies to POST /api/tutor/messages ONLY. The four ungated routes are correct without
it. Karl’s three reasons:
(a) A conversation is cheap and stateless at creation — it stores a row in tutor_conversations
with no student content, no Vertex call, no mastery effect. Blocking creation during an exam
would mean the student has to create a new conversation after the exam and loses the scope
reference they set up beforehand. No invariant is violated by allowing creation.
(b) §3.4’s own language says "turn" — a turn is an append-turn (POST /messages), not a
conversation shell. The gate’s enforcement point is the moment content generation begins
(Vertex inference), which only happens on append-turn.
(c) Replay (GET /:id) and list (GET /) are read-only operations on existing data. Blocking them
during an exam would prevent a student from reading past tutoring conversations while studying
for the exam — a hostile UX with no security justification. Close (POST /:id/close) is a
lifecycle transition with no content generation. None of these routes trigger Vertex inference
or produce new tutor output. INV-03-02’s purpose is preventing exam integrity breach via live
AI generation, not locking the student out of their conversation history.
Rationale: Karl ruling 2026-08-15. The invariant’s purpose is preventing live AI tutoring during
an active exam — the concern is that real-time Vertex inference could be used to cheat. That
concern applies only to the append-turn route, which is the sole path to model inference.
Creation, replay, list, and close are inert from an exam-integrity perspective.
Version: Doc 03B §5.5 step 4 should be removed at next spec pass. No spec version bump (the
invariant INV-03-02 is unchanged; the spec step list is the defect, not the invariant).
No code change. No schema change. Implementation already correct.
Owner action: at next spec pass, remove "Check live exam block (§3.4)" from §5.5 step 4 (Start
Conversation server steps). The step remains in §6.5 step 4 (Append Turn). Optionally: amend
§3.4’s prose to say "Before allowing any tutor turn" rather than using the broader "any tutor
request", and annotate INV-03-02 to clarify that "API endpoints" means "content-generating
endpoints" (i.e., POST /api/tutor/messages only).

SCL-031 | 2026-08-14 | Doc 03A §9.4 vs Doc 03C IAM (memory compaction write path) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §9.4 says the memory compaction writer goes through the BFF with HMAC service auth
  (compaction-worker → main-api). Doc 03C IAM table grants the compaction worker direct Supabase
  write access to tutor_memory_summaries. These two provisions appear to contradict — one routes
  through the BFF, the other implies direct DB writes.
WAS: Doc 03A §9.4 defines the write path as: Cloud Tasks → BFF /api/internal/memory/compact-writeback
  → executeCompaction → UPSERT into tutor_memory_summaries. The BFF verifies HMAC (01A Part VII,
  compaction-worker → main-api service pair) before writing. The worker does not hold direct Supabase
  credentials — it delegates the write to the BFF.
  Doc 03C IAM table lists the compaction worker as having direct Supabase write access to
  tutor_memory_summaries. Under this model, the worker writes directly without going through the BFF.
IS: §9.4 is canonical for the write path. The compaction worker sends its result through the BFF
  with HMAC-verified service auth. The Doc 03C IAM grant is defense-in-depth: the worker's service
  account MAY have Supabase write access as a fallback, but the canonical code path uses the BFF.
  Implementation follows §9.4 — the worker does not use direct Supabase writes.
Rationale: §9.4 is the detailed architectural description; the Doc 03C IAM table is a summary
  matrix that does not describe the request flow. The BFF path provides: (a) HMAC verification
  (01A Part VII) so the write is authenticated at the application layer, not just at the DB layer;
  (b) Zod validation of the content_json before the write (§7.6 Layer B); (c) observability
  (structured logging of compaction outcomes). Direct DB writes from the worker would bypass all
  three. The Doc 03C IAM grant may still be provisioned as defense-in-depth (if the BFF is
  unavailable, the worker could theoretically write directly), but the canonical path is §9.4.
Version: No spec version bump. This SCL records the interpretive alignment between the two docs.
No code change. No schema change. Implementation follows §9.4.
Owner action: at next spec pass, annotate Doc 03C IAM table to clarify that the compaction worker's
  Supabase access is defense-in-depth, not the canonical write path. Reference §9.4 for the
  canonical flow.
Artifact: PR #566, branch claude/ws-l4-memory-writer.

SCL-030 | 2026-08-13 | Doc 03 INV-03-10 scope narrowing (model-generated text, not structured API fields) | OPEN (owner-promoted 2026-08-14)
Change: INV-03-10 ("Canonical question IDs never appear in student-facing LISA output") and
  Doc 03B §16.6 line 2360 (source_question_canonical_id returned in conversation responses) appeared
  to conflict. Karl ruled: both stand. They govern different things.
WAS: INV-03-10 (Doc 03:2160) reads "Canonical question IDs (SAT{M|RW}{1|2}[A-Z0-9]{6}) never appear
  in student-facing LISA output. Enforced: Doc 03 §3.7, output scanner pattern matching. Violation:
  internal metadata leak." Doc 03B §16.6 (line 2360) returns source_question_canonical_id in the
  conversation response envelope. Read together, the API field appears to violate the invariant.
IS: The two provisions bind on DIFFERENT output layers:
  (a) The structured API field (source_question_canonical_id) STAYS. It is scope metadata the client
  uses to correlate a conversation to a question. It is never rendered to the student — visible only
  in browser devtools, where it is meaningless to a student. It is load-bearing for LISA's scope
  resolution (Doc 03A §1.2 layer 1, Doc 03B §6.5 step 3). Removing it would break scope continuity.
  Doc 03B §16.6 is NOT in defect.
  (b) INV-03-10 binds on MODEL-GENERATED TEXT. LISA must never write a canonical question ID into a
  chat message, under any framing, on any surface. The invariant's own enforcement point already says
  "output scanner pattern matching" — a text-layer mechanism, not an API-field mechanism. This SCL
  records the narrowing explicitly so the boundary is not re-litigated.
  (c) INV-03-10 enforcement remains ABSENT. No canonical-ID scanner exists on model output today —
  the model can emit SATM1ABC123 in prose and nothing catches it. This SCL settles the SCOPE of the
  invariant; it does not close it. Closing it is LISA-FULL-007.
Rationale: Karl ruling 2026-08-13. The API field is structured metadata consumed by the client for
  scope correlation; the invariant targets prose text the student reads. Conflating them would either
  break scope resolution (if the field is removed) or render the invariant unenforceable (if it's
  broadened to "never present in any JSON"). The boundary is: student-readable text vs. structured
  metadata. The field is no more a "student-facing output" than a database row ID in a REST response.
Version: Doc 03 INV-03-10 — scope narrowed to model-generated text only; structured API fields
  carrying canonical IDs for scope resolution are explicitly excluded. No spec version bump (the
  invariant text is unchanged; this SCL records the interpretive boundary).
No code change. No schema change.
Owner action: at next spec pass, annotate INV-03-10 with the text/field boundary. Track
  LISA-FULL-007 (canonical-ID output scanner) as the open enforcement item.

SCL-029 | 2026-08-13 | Doc 03 INV-03-03 past_due status (platform entitlement predicate wins) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03 INV-03-03 says "LISA requires entitlement.tier=paid AND entitlement.status=active on
  every request. No grandfathering, no cached entitlement beyond single-request TTL." Read literally,
  this excludes past_due and trialing. Doc 01's platform entitlement predicate treats the canonical
  entitled set as {active, past_due, trialing} — a locked decision (owner ruling 2026-06-14, codified
  in the entitlement_active() SQL predicate). The two conflict.
WAS: INV-03-03 (Doc 03:2146) requires "entitlement.status=active" — literally the string 'active'.
  The platform predicate (entitlement_active(), migration 20260616120000) is
  status IN ('active','past_due','trialing'). A student whose card is mid-retry (past_due) or in a
  trial period (trialing) would be entitled on every other paid surface but denied LISA if the
  invariant is enforced literally.
IS: The platform entitlement predicate wins. LISA follows the same entitlement gate as every other
  paid surface — {active, past_due, trialing}. A student whose card is mid-retry does not lose their
  tutor.
  Implementation already correct — no code change required. The LISA entitlement gate is:
    server/services/entitlement-service.ts:47-67 (EntitlementService.isEntitlementActiveForProfile),
    which delegates to the entitlement_active() RPC (status IN ('active','past_due','trialing')).
    server/routes/tutor-runtime.ts:227 calls this check on every request.
  INV-03-03's "status=active" is read as "entitlement-active per the platform predicate," not as
  a literal string match on the word 'active'. The invariant's intent (per-request entitlement check,
  no grandfathering, no caching) is preserved; only the status-value set is widened to match the
  platform.
Rationale: Karl ruling 2026-08-13. The platform owns the definition of "entitled." Every paid
  surface (practice, mastery, guardian mirror, projections, LISA) consumes the same entitlement_active()
  predicate. A LISA-specific narrowing to status='active' only would mean a student in Stripe's
  past_due retry window can do practice but not talk to their tutor — a confusing and unjustifiable
  split. The invariant's purpose is preventing unpaid access, not penalizing payment retry.
Version: Doc 03 INV-03-03 — "status=active" widened to "entitlement-active per the platform
  predicate (active, past_due, trialing)." No spec version bump (the invariant text is unchanged;
  this SCL records the interpretive alignment with the platform predicate).
No code change. No schema change. Implementation already correct.
Owner action: at next spec pass, amend INV-03-03 to reference the platform entitlement predicate
  rather than the literal string 'active', or add a parenthetical noting the platform-defined set.

SCL-028 | 2026-08-12 | Doc 03A §18.2 tutor_messages idempotency constraint (role-inclusive uniqueness) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §18.2 defines the idempotency constraint as
  UNIQUE (conversation_id, client_turn_id). Doc 03B §9 and §13.3 describe an idempotency model
  that persists two tutor_messages rows per client_turn_id per turn — one role='student' (§6.5
  step 11) and one role='tutor' (§6.5 step 16). The constraint as written permits only one row
  per (conversation_id, client_turn_id), so the tutor message insert always fails. This is a spec
  defect — the constraint contradicts the two-row model that the idempotency and retry sections
  depend on.
WAS: UNIQUE (conversation_id, client_turn_id) — or equivalently, partial unique index on
  (student_id, conversation_id, client_turn_id) WHERE client_turn_id IS NOT NULL per
  migration 20260806020000. Either shape permits only one row per client_turn_id per conversation.
IS: UNIQUE (student_id, conversation_id, client_turn_id, role) WHERE client_turn_id IS NOT NULL.
  Permits exactly one student row and one tutor row per turn. The idempotency lookup (§9, step 8)
  finds both rows by (conversation_id, client_turn_id) and discriminates by role to detect full
  replay vs. partial recovery.
Rationale: The idempotency model at §9 and the retry model at §13.3 require two rows per
  client_turn_id — one for the student message (step 11) and one for the tutor response (step 16).
  The §18.2 constraint blocks the second insert. Without this fix, every non-crisis tutor turn
  fails at step 16 with a uniqueness violation and cannot complete (P0 severity — total LISA
  outage).
Version: Spec defect — §18.2 constraint must be widened to include role in the uniqueness key.
Artifact: PR for branch claude/ws-l3-b1-1e, migration 20260812000000_tutor_messages_idempotency_role.sql.
(That file was renamed 2026-08-18 to 20260812010000_tutor_messages_idempotency_role.sql — its version
string collided with 20260812000000_snapshot_kind_baseline.sql. The record above is left as written;
see scripts/prod-verify/MIGRATION-VERSION-COLLISIONS.md.)
Owner action: review — update §18.2 DDL to UNIQUE (conversation_id, client_turn_id, role), or
  equivalently the partial unique index form with role included.

SCL-027 | 2026-08-09 | Doc 03B §6.5 step 5 / step 6 ordering (payload validation before ownership check) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03B §6.5 numbers ownership verification as step 5 and payload validation (Zod parse)
  as step 6. The implementation inverts the order — step 6 (Zod parse) runs before step 5
  (loadOwnedConversation) — so a malformed request body is rejected with 400 before any DB lookup
  occurs.
WAS: Spec ordering — step 5 ownership check first, step 6 payload validation second. Under this
  ordering, a request with a valid conversation_id but garbage body hits the DB for ownership
  before discovering the body is invalid.
IS: Implementation ordering — step 6 payload validation first (tutor-runtime.ts:622), step 5
  ownership check second (tutor-runtime.ts:633). A malformed body returns 400 without touching
  the database.
Rationale: Fail-fast on shape. A 400 for an invalid body reveals nothing about conversation
  ownership — the rejection is purely structural, independent of who owns the conversation. No
  security property is lost. The reordering avoids a wasted DB round-trip on requests that would
  fail validation anyway. Karl accepted.
Version: Spec deviation — implementation intentionally diverges from the numbered step ordering
  in §6.5. The spec text is correct as a logical description of what the pipeline does; only the
  execution order differs.
Artifact: PR for branch claude/lisa-tutor-inventory-27lras.
Owner action: review — confirm acceptance of the step 5/6 ordering inversion in §6.5, or
  renumber the spec steps to match the implementation order.

SCL-026 | 2026-08-07 | Doc 03A §7.3, §10.3 (preferred_explanation_style V2→V1 per-turn capture) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §7.3 defers preferred_explanation_style to V2 via batch extraction over accumulated
  conversation history. This entry moves it to V1, captured per-turn from model output via the
  orchestrator response schema.
WAS: §7.3 defines preferred_explanation_style as a V2 target requiring "LLM-based pattern extraction
  over conversation history" and "sufficient observed conversation data to train extraction prompts."
  V1 stores only last_struggled_skill and last_mastered_skill on teaching_profile summaries.
IS: V1 adds a learner_observation block to the orchestrator response schema (Doc 03C wire contract).
  The model emits an enum-constrained explanation_form observation per turn (or null when no signal).
  Enum values: step_by_step, conceptual, example_driven, visual. Observations accumulate as a tally
  in tutor_memory_summaries type teaching_profile content_json. A preferred style is derived when
  total observations ≥ 5 and a single-leader plurality exists. The derived style feeds back through
  Layer 3 memory retrieval to shape subsequent prompts. Free text is never written to memory —
  enum-constrained values only, satisfying §7.6 Layer B (schema constraints prevent self-injection).
  The learner_observation block is INTERNAL ONLY — never serialized to any client response body.
Rationale: Karl ruling 2026-08-07 — the batch-extraction prerequisite (sufficient conversation
  history + trained extraction prompts) is unnecessary for a four-value enum that the model can
  classify per-turn from student response patterns. Per-turn capture provides immediate V1 value
  ("Knows Me" moments) without a separate extraction pipeline. The four-value enum
  (step_by_step | conceptual | example_driven | visual) scopes to explanation form only — other
  dimensions (scaffolding level, test strategy) are deferred to independent fields once conversation
  data proves reliable model classification.
Version: Doc 03A → V3.2 (§7.3 explanation style capture moved to V1; §10.3 adds learner_observation
  to orchestrator response contract).
Artifact: PR for branch claude/ws-l2-context.
Owner action: at next spec pass, update §7.3 to reflect V1 per-turn capture with the four-value
  enum, and add learner_observation to §10.3 orchestrator response contract.

SCL-025 | 2026-08-04 | Doc 03B §3.1, Doc 03 §21.3, Doc 07E (safety review access path) | OPEN (owner-promoted 2026-08-14)
Change: The corpus mandates a human safety review workflow (Doc 03 §21.3) whose required actions
  cannot be performed without reading the flagged conversation, but Doc 03B §3.1 line 243 forbids
  admin absolutely on /api/tutor/*. Doc 07E has no provisions for staff access to tutor data.
  The corpus mandates a capability its own role rule forbids.
WAS: Doc 03B §3.1 blocks all non-student roles from /api/tutor/* (403 role_not_permitted). Doc 03
  §21.3 mandates human review of crisis-flagged conversations. No access path connects the two.
  Doc 07E provides no staff-access surface for tutor data.
IS: (a) §3.1 stands unchanged for /api/tutor/*. student only. All other roles 403 role_not_permitted.
  Already implemented in PR #519. (b) Safety review is a SEPARATE surface outside /api/tutor/*, not
  a role exception. Read-only. Scoped to conversations where crisis_flagged = true. Not routed
  through canAccessFeature — different authorization axis. Every read logged append-only with
  reviewer identity, conversation id, timestamp, action. Write scope limited to classification
  outcome and review disposition. (c) Doc 03 §21.3 tooling correction: the shared ticketing system
  carries a conversation identifier and non-content metadata only. Conversation content never leaves
  Supabase. As currently written §21.3 would export a minor's verbatim crisis disclosure to a
  third-party SaaS, contradicting ADR-001 §3 and making the Doc 07E deletion cascade unenforceable.
  (d) Open at V2: §21.3 transitions to a dedicated T&S function at 5,000 paid users or 20+ monthly
  flags. At that scale the admin role is too broad for standing read access to minors' crisis
  conversations. Flagged, not resolved.
Rationale: Karl ruling 2026-08-04 — the contradiction is real. §3.1 is correct for the tutor API
  surface (student only). The review capability is a separate access path, not an exception to §3.1.
  Third-party export of crisis content contradicts ADR-001 §3 data-residency and Doc 07E deletion
  cascade enforceability.
Version: Doc 03B → V4.2, Doc 03 Main → V1.2.
No code/schema change from this entry. Owner action: amend Doc 03B, Doc 03 §21.3, and Doc 07E at
  next spec pass. V2 T&S function is tracked as open, not resolved.

SCL-024 | 2026-08-04 | Doc 03A §18.7, §18.1, §18.2, §18.5 (config table shape + question FK type) | OPEN (owner-promoted 2026-08-14)
Change: Two defects in Doc 03A. Production is correct in both; the spec is wrong.
  (a) Config table shape: Doc 03A §18.7 defines tutor_context_runtime_config with a bespoke shape
  (id UUID PK, config_key, config_value). Production carries the Doc 01A §8 config template
  (key TEXT PK, value, value_type, min_value, max_value, allowed_values, owner, description,
  environment, updated_at, updated_by_profile_id), created by migration
  supabase/migrations/20260610000000_ws2_config_constants.sql, applied and in ledger. Doc 01A Part I
  owns config-table shape platform-wide. §18.7 restated a primitive another document owns,
  differently.
  (b) Question FK type: Doc 03A types questions(id) foreign keys as UUID. Production: questions.id
  is TEXT, profiles.id is uuid. A UUID column cannot reference a TEXT primary key — the DDL fails.
  Four columns across three tables: line 1734 §18.1 tutor_conversations.source_question_row_id;
  line 1822 §18.2 tutor_messages.source_question_row_id; lines 2012 and 2016 §18.5
  tutor_question_links.source_question_row_id and .related_question_row_id.
WAS (a): §18.7 defined tutor_context_runtime_config with (id UUID PK, config_key TEXT, config_value
  TEXT) — a bespoke shape that conflicts with the platform config template owned by Doc 01A §8.
WAS (b): §18.1, §18.2, §18.5 typed source_question_row_id and related_question_row_id as UUID
  REFERENCES questions(id). questions.id is TEXT in production — DDL would fail on type mismatch.
IS (a): §18.7 removes its DDL and references Doc 01A §8 for config-table shape. §18.7 specifies
  only the keys it requires and their semantics.
IS (b): All four question FK columns (§18.1 tutor_conversations.source_question_row_id, §18.2
  tutor_messages.source_question_row_id, §18.5 tutor_question_links.source_question_row_id and
  .related_question_row_id) retype from UUID to TEXT. REFERENCES questions(id) ON DELETE SET NULL
  unchanged.
Rationale: Karl ruling 2026-08-04 — both are spec-vs-production mismatches. (a) Doc 01A Part I
  owns config-table shape; §18.7 should not restate it differently. (b) UUID cannot reference TEXT
  PK — the DDL is structurally invalid against the live schema.
Version: Doc 03A → V3.1 (config table reference + FK type corrections).
No code/DB change from this entry. Owner action: update Doc 03A §18.7 (remove DDL, reference
  Doc 01A §8), retype §18.1/§18.2/§18.5 question FK columns to TEXT at next spec pass.
SCL-024 | 2026-08-06 | Doc 03A §18.4, Doc 03B §4.1 (fifth question-FK column + wire-contract Zod schemas) | OPEN (owner-promoted 2026-08-14)
Change: Extends SCL-024(b) to cover a fifth column and the wire-contract Zod schemas that carry
  the same UUID assumption.
  (c) Fifth column: tutor_instruction_assignments.source_question_row_id (§18.4). SCL-024(b) listed
  four columns across three tables; this fifth column was omitted because §18.4 defines it with no
  FK to questions(id), and the original rationale (UUID cannot reference TEXT PK) appeared not to
  apply. Karl ruled: the same resolvedScope.source_question_row_id value is written to all four
  tutor tables from a single code path; the column must carry the same type. questions.id is TEXT
  under CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$') — canonical SAT IDs, not UUIDs — making UUID
  structurally impossible regardless of FK presence. The revert migration
  (20260806010000_tutor_instruction_assignments_uuid_revert.sql) that would have cast this column
  to UUID is dropped.
  (d) Wire-contract Zod schemas: Doc 03B §4.1's wire protocol definitions validate
  source_question_row_id and related_question_row_id as z.string().uuid(). These Zod schemas
  (shared/tutor-contract.ts, shared/tutor-orchestrator-wire.ts, server/routes/tutor-runtime.ts)
  would reject canonical SAT question IDs at parse time. Same root cause as (b) — the spec typed
  question IDs as UUID when questions.id is TEXT.
WAS (c): §18.4 typed tutor_instruction_assignments.source_question_row_id as UUID (no FK). A
  revert migration existed to cast the production TEXT column back to UUID.
WAS (d): Zod schemas validated source_question_row_id and related_question_row_id as
  z.string().uuid() — 10 call sites across 4 files (shared + server + generated worker copy).
IS (c): Column stays TEXT, matching the other four question-FK columns. Revert migration dropped.
IS (d): Zod schemas validate with z.string().regex(CANONICAL_ID_PATTERN) using the existing
  single-source-of-truth regex from shared/question-bank-contract.ts. All 10 call sites fixed.
Rationale: Karl ruling 2026-08-06 — extend SCL-024, do not revert to UUID. The same value flows
  to all four tables from one code path; mixed types are a latent runtime failure. The Zod UUID
  validation would reject every real question ID at parse time.
Artifact: PR #523, branch claude/lisa-tutor-inventory-27lras.
Owner action: at next spec pass, retype §18.4 source_question_row_id to TEXT and update Doc 03B
  §4.1 wire-contract definitions to use canonical question ID format, not UUID.

SCL-023 | 2026-08-04 | Doc 03C V3.0, Doc 03C.1, Doc 03A (crisis classifier gate) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03C V3.0 contains no crisis classifier stage. Full-text scan returns zero occurrences
  of crisis, self-harm, safety classifier, or classifier. Three siblings delegate crisis handling
  there: Doc 03 §21.1 (crisis detection trigger), INV-03-16 (crisis classification before main
  response generation), Doc 03A §17 schema (crisis_flagged column + idx_tutor_conversations_crisis
  index), Doc 03B §0 and §13 step 14 (crisis flow references). Doc 03C.1 has no crisis test
  scenario.
WAS: Doc 03C V3.0 has no crisis classifier stage. The pipeline spec gap means four sibling docs
  reference a capability Doc 03C does not define. Doc 03C §4.5 "Content safety pre-pass" is named
  misleadingly — it performs prompt-token bounding and its own body says it is not safety
  enforcement. Doc 03C V3.0's "no further architectural change expected before V1 launch" is
  falsified by this addition.
IS: Two-layer crisis classifier gate, both pre-generation, parallel:
  Layer 1: deterministic signature match against a tutor_crisis_signatures table, reusing the
  tutor_injection_signatures pattern (Doc 03A). Layer 2: model inference on a new classifier_class
  alias (alongside flash_class and pro_class; unknown alias continues to throw).
  New pipeline stage inserted before Vertex invocation. Ordering is load-bearing: INV-03-16 requires
  "before main response generation."
  Either layer positive → crisis path per Doc 03 §21.2 (unchanged, referenced not restated).
  Failure modes: Layer 2 failure → retry once, then Layer 1 result stands, turn proceeds, turn is
  force-enqueued to the §21.3 review queue, SLI increments. Failure-rate breach pages ops rather
  than flooding the queue. This is a deliberate narrow exception to fail-closed — blocking returns
  an error to a student who may be the person the gate exists for. Layer 1 signature table
  unreadable → fail closed on the turn.
  Doc 03C §4.5 "Content safety pre-pass" renamed — it does prompt-token bounding, not safety
  enforcement. The name collides with the crisis classifier stage.
Rationale: Karl ruling 2026-08-04 — Doc 03C is the sole pipeline-architecture spec and four sibling
  docs delegate crisis handling to it. The gap is structural, not editorial. Two-layer design
  provides deterministic baseline (Layer 1) with model-backed depth (Layer 2). Fail-open on Layer 2
  only is justified because the alternative (fail-closed) returns an error to the student who may be
  in crisis — the person the gate exists to help.
Version: Doc 03C → V3.1, Doc 03C.1 → V1.2, Doc 03A → V3.1 (crisis signature table).
No code/schema change from this entry. Owner action: add crisis classifier stage to Doc 03C,
  add classifier_class alias to Doc 03A, add crisis test scenarios to Doc 03C.1, rename §4.5 at
  next spec pass.

SCL-022 | 2026-07-01 | questions_governance.md §A.4 (skill-classification convention) | OPEN (owner-promoted 2026-08-14)
Change: Added **Skill Classification Convention** subsection to §A.4 with: primary-competency rule
  (tag the skill the student must exercise to reach the correct answer), disambiguation table for
  5 boundary rules (Linear Eq Two Var vs Linear Functions, Nonlinear Eq vs Nonlinear Functions,
  Central Ideas vs Command of Evidence vs Inferences [three-way], Transitions vs Rhetorical Synthesis,
  Boundaries vs Form/Structure/Sense),
  tiebreak rule (specificity → CB precedent → coverage spread), Q4 worked example demonstrating
  Pair 1 resolution, and auditor parity statement (Codex applies the same table for TAG_MISMATCH).
WAS: §A.4 listed the 29 frozen skills but provided no guidance on resolving classification ambiguity
  at skill boundaries — authoring and audit could disagree on plausible-either-way tagging.
IS: §A.4 now includes a deterministic disambiguation protocol that both authors and Codex auditors
  apply identically, reducing false TAG_MISMATCH findings on boundary-case questions.
Rationale: Prerequisite for volume batch (70 questions across all 29 skills). Without a locked
  disambiguation convention, boundary-case skill tags would be auditor-subjective, risking spurious
  Codex REJECTs on first submission — counter to the graduation criterion (zero genuine content
  defects on first Codex submission).
Owner action: review disambiguation table and tiebreak rule at next spec pass.

SCL-021 | 2026-07-01 | questions_governance.md §A.3/§A.8 (grid-in correctness model) | OPEN (owner-promoted 2026-08-14)
Change: Grid-in correctness model clarified. Grading is by **value-equivalence** (`gridInResponseMatches`,
  `shared/question-ingestion-qa.ts:436-444`); `correct_variants` is the deterministically-generated
  canonical set (`gridInAcceptedForms` — reduced fraction + exact decimal, no trailing zeros), validated
  by `normalizeGridInKey`, and is neither exhaustive nor the grading authority.
WAS: §A.3 described `correct_variants` as "the exhaustive set of CB-accepted surface forms" and §A.8
  had no explicit grid-in audit guidance, leading Codex to flag missing surface forms (e.g. `0.50` for
  `1/2`) as defects — a false-positive class, since adding such forms would break `normalizeGridInKey`
  ingestion QA and grading already accepts them via value-equivalence.
IS: §A.3 now distinguishes grading acceptance (runtime, value-equivalence) from `correct_variants`
  (stored, deterministic canonical set). §A.8 adds check 1a (grid-in correctness) with explicit
  guidance: do NOT flag `correct_variants` for omitting value-equivalent surface forms.
Rationale: Codex REJECT on proving_batch_001 Q4 (`SATM2L6TC5Y`, `correct_answer='1/2'`,
  `correct_variants=['1/2','0.5','.5']`) was adjudicated a false positive. The governance doc's
  conflation of grading-acceptance with `correct_variants` caused the false-positive class.
  Supersedes any prior language implying `correct_variants` must enumerate all accepted surface forms.
Owner action: review at next spec pass; confirm value-equivalence model aligns with Doc 04B.
SCL-069 | 2026-07-09 | Doc 02B §14 / contracts/mcfr-coexistence.contract.md (practice grid-in serve + grade) | OPEN (owner-promoted 2026-08-14)
Change: Grid-in (free-response / SPR) questions are now **functional end-to-end on the practice path**.
WAS: grid-in items could enter practice sessions via `select_practice_pool_random` but grading always
  failed with 422 (MCQ-only `normalizeAnswerKey` rejected numeric answers). Anti-leak was structurally
  sound but unproven for grid-in (zero integration-test coverage).
IS: `practice_session_items` extended with `question_item_type` (mcq|grid_in) and `question_correct_variants`
  (TEXT[]). `toCanonicalQuestionFromSessionItem` reads item_type from snapshot. `gradeAnswer` branches:
  MCQ key-match vs grid-in `correct_variants.includes(submitted.trim())` (TIGHTENING-1). Submit/skip
  handlers emit `mode: "grid_in"` with `correctAnswer` (canonical display value, post-submit). Anti-leak
  integration test proves no `correct_variants` leak on serve, correct grading on submit.
Rationale: MCFR contract practice lane. Migration `20260708000000_practice_grid_in_columns.sql` committed
  but NOT applied — Karl applies. Review + full-length lanes are named follow-ons.
Build artifact: PR on branch `claude/grid-in-anti-leak-audit-v0wha5`.

SCL-020 | 2026-06-28 | questions_governance.md §A.4 (canonical skill taxonomy casing) | OPEN (owner-promoted 2026-08-14)
Change: Canonical skill taxonomy frozen as **29 Title Case strings** in governance doc §A.4.
WAS: skill strings in mixed sentence-case/title-case (internal inconsistency).
IS: all 29 skills locked to Title Case (e.g., `Linear Equations in One Variable`, `Words in Context`),
  matching CB-native capitalization. `student_skill_mastery.skill` must use these exact strings.
Rationale: single source of truth; no deployed SQL function hardcodes skill strings, so the governance
  doc is the sole authority — its internal consistency is load-bearing. Title Case matches CB convention.
No code/DB change from this entry. Owner action: confirm Title Case convention at next spec pass.

SCL-018 | 2026-06-28 | Doc 02A §15/§16 / questions_governance.md §A.3 (grid-in / free-response scope) | OPEN (owner-promoted 2026-08-14)
Change: Free-response (grid-in / student-produced response) is **in scope for prelaunch**, superseding
  the prior MCQ-only deferral.
WAS (gap-closure plan proposal): grid-in deferred to post-launch (MCQ-only for launch).
IS: grid-in is a launch question type. Schema extension via migration
  `20260628010000_grid_in_schema_extension.sql` adds `item_type` (mcq|grid_in) and `correct_variants`
  (TEXT[]) columns with fail-closed shape-integrity CHECK. Grid-in authoring rules defined in
  `questions_governance.md` §A.3.
Rationale: Karl ruling (2026-06-28) — grid-in represents ~25% of Digital SAT Math questions and must be
  authorable this content wave. Migration awaiting Karl apply (not applied to prod).
Owner action: apply migration; promote into Doc 02A spec at next revision; update Doc 02A §23 QA gate
  "Four options present" to exempt grid-in items (`options.length = 0` is valid for `grid_in`).

SCL-016 | Doc 02B (flow-cards / adaptive practice flow) | OPEN (owner-promoted 2026-08-14)
Change: flow-cards is a POST-LAUNCH feature; removed from launch UI.
WAS: flow-cards positioned as the adaptive practice flow for students (the useAdaptivePractice path).
IS: flow-cards deferred to post-launch as an Anki/Quizlet-style spaced-practice feature, distinct from
  launch practice. Removed from the launch practice UI; the useAdaptivePractice hook is retired.
Rationale: CEO ruling 2026-06 — launch practice is the unified filter-driven engine. Flow-cards is a
  separate post-launch product surface, not part of launch. Its best idea ("target weak skills") is
  salvaged as the Vertical B weakest-skills filter preset.
Owner action: revise any 02B flow-cards prose to post-launch status. No code/DB change from this entry.

SCL-015 | Doc 02B §15 (item selection) | OPEN (owner-promoted 2026-08-14)
Change: launch selection is filter-driven native random; adaptive/weakness-ranked selection is POST-LAUNCH.
WAS (02B §15): weakness-first ranking from mastery + seeded Fisher-Yates determinism ("reconstructable
  from recorded state", INV-02B-07) + cold-start blueprint-balanced sampling.
IS (launch, CEO ruling 2026-06): student-picked multi-select filters (difficulty/domain/skill, multi per
  facet, none=all) → native Postgres ORDER BY random() over the filtered pool → ALL N items prepopulated
  into practice_session_items at session creation. Determinism is satisfied BY STORAGE (the prepopulated
  rows ARE the durable record of what was selected); no seed/replay needed. No mastery read at selection.
Rationale: CEO ruling — launch practice is standard filter-driven prepopulation, industry-standard, built
  near-scratch (both legacy hooks retired). Adaptive selection (weakness-ranked) deferred to post-launch.
  The audit "gaps" G-SEL-1 (weakness-first), G-SEL-2 (seeded shuffle), G-SEL-3 (cold-start blueprint)
  CLOSE AS NOT-GAPS — they described a feature being deliberately deferred, not a defect.
  The "work on your weakest skills" idea is preserved but reframed: a FILTER PRESET (lowest-N mastery
  skills → filter input) in Vertical B (mastery-coupled, post-baseline-diagnostic), NOT an adaptive
  selection engine. INV-02B-07 (seeded reconstructability) superseded by store-the-result determinism.
Owner action: revise Doc 02B §15 to the filter-driven launch model; mark adaptive selection post-launch.
No code/DB change from this entry; records the spec-vs-launch-model divergence.

SCL-014 | Doc 05A §4.6/§11.4 (canonical_mastery_events source tables) | OPEN (owner-promoted 2026-08-14)
Change: spec prose names event-source tables that differ from the live canonical schema. DB is canonical.
WAS (spec text): canonical_mastery_events derives events from `test_session_answers` (full_length_answer)
   and `practice_attempts_v0` (practice_attempt).
IS (live canonical schema, verified read-only + Codex-confirmed via lane_c_mastery_seam.sql):
   - practice_attempt  → practice_session_items.id   (lane_c_mastery_seam.sql:42-53)
   - review_error_attempt → review_error_attempts.id (lane_c_mastery_seam.sql:66-70)
   - full_length_answer → full_length_exam_responses.id (persisted response PK)
   The `practice_attempts_v0` table is the retired fossil (Doc 02B §8 names practice_session_items as the
   V2 replacement; the DB function comment already flags this). `test_session_answers` is the spec-text
   name for what the live schema exposes as full_length_exam_responses.
Rationale: WS-0 mastery vertical (PR @cleanup) grounded the TS write-bridge against the LIVE canonical
   tables, not the stale spec prose, per the standing directive (DB/live schema is canonical; repo/spec-
   text lag is reconciled forward, never resolved by trusting stale names). event_id sourcing is
   idempotency-load-bearing ((event_source_kind, event_id) dedup on mastery_event_audit_log); Codex
   independently re-derived that the sourced PKs match canonical_mastery_events' derivation — confirmed
   correct. No code/DB change from this entry; it records that Doc 05A's prose table names should be
   updated to the live names at the next owner spec edit. Tracks the divergence so it's not reburied.
No DB migration. No code change. Owner action: update Doc 05A §4.6/§11.4 table names at next spec pass.

### SCL-013 — Doc 01 V8 §40.3 subscription-cancellation timing corrected to match built implementation
**Date:** 2026-06-27 · **Status:** OPEN (owner-promoted 2026-08-14)
**Touches:** Doc 01 V8 §40.3 (line ~1968)
**Change:** subscription-cancellation timing corrected to match built + proven implementation.
WAS: "Stripe subscription cancellation is initiated immediately" (at deletion request)
NOW: subscription remains active through the 7-day grace period; billing is paused (Stripe
     pause_collection: void) and the entitlement is removed at T+7 execution, not at request.
     Full Stripe subscription cancellation DEFERRED to PR-4b.
**Rationale:** Spec-auditor (PR #444) flagged §40.3 contradicts built behavior. Grounded against code:
request_account_deletion performs NO Stripe operation (sets profiles.deleted_at only); pauseStripeBilling
+ entitlement removal occur at T+7 in the execution driver (PR-4a). The grace period exists for
reconsideration — preserving paid access the user already paid for, and ensuring a cancelled deletion
leaves the subscription uninterrupted. Karl ruled (2026-06-27) the IMPLEMENTATION is correct; the spec
line is stale. User-facing copy states "access ends + not charged again" (true now, true post-4b) —
makes NO Stripe-cancellation claim.
**Cross-ref:** SCL-012 (§19 disclosure framing). Both align spec to the counsel/Karl-ruled deletion model.
**Artifact:** PR-5e Bucket 2 (spec correction). Karl separately updating Doc 01 §40.3 to match.

### SCL-012 — Doc 01 §19 deletion-confirmation prompt framing aligned to counsel ruling
**Date:** 2026-06-27 · **Status:** OPEN (owner-promoted 2026-08-14)
**Touches:** Doc 01 §19 (line ~1047)
**Change:** deletion-confirmation prompt framing aligned to counsel ruling.
WAS: "...the confirmation prompt should explain ... data anonymization at T+7"
NOW: "...the confirmation prompt should explain ... permanent account deletion at T+7"
**Rationale:** Counsel ruled (2026-06-27) that user-facing language is HARD DELETION — anonymized
retained data is legally non-identifiable (not the user's data), so it is NOT disclosed in user-facing
copy. The INTERNAL mechanism remains anonymize-retain (Doc 05E governs; cascade 'anonymize' mode). This
is the internal/external split: §19 user-facing prompt says "deleted"; the engine anonymizes.
Doc 05E (anonymize mechanism) UNCHANGED. Only the §19 USER-FACING PROMPT DESCRIPTION changes.
Privacy Policy locked consistent with this framing (Anonymized Structured Learning Data, LISA scoped out).

Doc 01 §19 line ~1047 edit:
  "data anonymization at T+7" → "permanent deletion of the account at T+7"
And §19's enumerated prompt disclosures become (per counsel + Karl ruling):
  (1) 7-day grace window;
  (2) paid access continues during grace, ends at deletion, no further charges (full Stripe
      cancellation tracked separately in PR-4b — NOT claimed as "cancelled" in UI; see SCL-013);
  (3) [REMOVED — guardian pending-deletion display is unbuilt; not disclosed];
  (4) data-treatment mechanism NOT surfaced in UI (internal anonymize per Doc 05E; counsel ruling).
Proposed §19 prompt discloses items 1 and 2 (corrected wording) only; 3 dropped, 4 internal.
**Artifact:** PR-5e Bucket 2 (copy changes). Karl separately updating Doc 01 §19 to match.

### SCL-011 — Authoritative user-scoped table partition (66 tables, proven 2026-06-25)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §5/§6 (INV-05E-03), INV-DELETION-COMPLETE
**Change:** Live enumeration proves 66 user-scoped tables, partitioned: 5 ACTIVITY (need actor_id:
practice_sessions, practice_session_items, review_sessions, review_session_items,
review_error_attempts) + 2 AUDIT-LAYER (actor_id for grouping, one-way anonymized per 05D §10:
mastery_event_audit_log, mastery_domain_refresh_audit_log) + 12 DERIVED (deleted at anonymize) +
34 OPERATOR-CONFIG (updated_by/changed_by — operator-FK preflight guard, NOT user activity, no
actor_id) + 7 IDENTITY/BILLING/CONSENT (pre-clear/scrub) + 4 OPERATIONAL (auto-cascade) + 2
governance-constants (mastery_constants/_history). Zero unclassified-with-student-data.
**CORRECTION captured here:** the audit layer is 2 tables, not 1 — an earlier PR-5a scope pass named
only mastery_event_audit_log and missed mastery_domain_refresh_audit_log. Surfaced by the owner's
demand for exhaustive enumeration ("are there truly only these"). PR-5a actor_id column-add covers 7
tables (5 activity + 2 audit). This partition is the authoritative enumeration that
INV-DELETION-COMPLETE / INV-05E-03 must encode; prose lists elsewhere are non-authoritative.
**Artifact:** Live-proven partition (Supabase introspection 2026-06-25). CI guard:
scripts/ci/actor-id-coverage-guard.sql (PR-5a stub asserts the 7 tables + profiles + ledger +
nullability split). Migration: 20260625020000_05e_actor_id_substrate.sql (applied + verified live).

### SCL-010 — Doc 05E supersedes Doc 05D §10.2 Layer-2 mechanism (v_surrogate → actor_id)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10.2, 05E §3/§5
**Change:** Doc 05D §10.2 specifies Layer-2 anonymization via `v_surrogate` — re-key the identity
column IN PLACE to one gen_random_uuid() generated AT anonymization time, reused across Layer-2
tables. Doc 05E SUPERSEDES this with the decoupled actor_id mechanism: a SEPARATE actor_id column,
assigned at PROFILE-CREATION time, with the identity column SET NULL at anonymization. Reason: (1)
actor_id enables pre-anonymization trajectory grouping (world-model value — the surrogate only
existed post-anonymization); (2) actor_id is true-anonymization (born dissociated from identity)
whereas the in-place surrogate briefly co-exists in the identity column. Doc 05E §3 is now canonical
for the Layer-2 anonymize mechanism; 05D §10.2 Layer-2 v_surrogate is retired. The 05D §10
HARD-DELETE cascade is UNAFFECTED — it DELETEs rows, does not re-key, and remains the service_role
admin tool.
**Artifact:** Doc 05E committed to docs/Spec (cleanup+main). Build: PR-5 wave (PR-5a substrate
applied + verified live 2026-06-25; 5b write-path stamping next).

### SCL-009 — Doc 05E created (anonymized-retention governance)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** new Doc 05E; references 05D §10
**Change:** New governance doc `Doc_05E_Anonymization_Actor_ID.md` defines the anonymize disposition (decoupled synthetic identifier, lifelong cross-service grouping, linkage-destroyed-at-deletion, structured-only retention). Governance-level: owns doctrine/invariants/procedure, not schema.
**Reason:** World-model retention is canonical; anonymize is the user-facing deletion default. Counsel approved the mechanism.
**Artifact:** Doc 05E draft (self-audit-clean; pending Codex independent audit + owner commit to docs/Spec).

### SCL-008 — Anonymize is the user-facing deletion default; hard-delete is the internal/admin tool
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10, 05E §1
**Change:** Inverts the deletion model. User-facing "delete account" → anonymize (scrub identity, retain decoupled-identifier activity for the world model). Hard-delete cascade (05D §10, proven on prod) is repurposed as `service_role`-only internal tool for cases where even anonymized retention must be purged.
**Reason:** World-model build requires retained anonymized usage; permanent hard-delete on every user deletion would destroy canonical training data.
**Artifact:** Doctrine in 05E; hard-delete cascade live in prod (migration 20260625010000), grant already service_role-only (verified).

### SCL-007 — Decoupled synthetic identifier (actor_id) doctrine
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §3
**Change:** Activity retained under a synthetic per-user identifier that is born dissociated from identity, never co-located with identity on any surface that survives deletion, stable lifelong/cross-service, linkage destroyed at anonymization. Rejected on record: keep-profile_id (pseudonymous), hash-user_id (reversible), SET-NULL-only (loses grouping), drop-FKs (loses write-path integrity), BEFORE-DELETE-trigger-on-auth (ungated), shared-sentinel (loses grouping).
**Reason:** Pseudonymization vs anonymization legal line — only a born-dissociated identifier clears the bar counsel's caveat requires. Industry precedent: Jira alias-translation, JetBrains randomized scheme.
**Artifact:** 05E §3–§4. Implementation deferred to PR-5 wave.

### SCL-006 — Lifelong grouping chosen over sessionization (with compensating controls)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §7.1
**Change:** Grouping identifier is lifelong/cross-service, not session-scoped. Higher fingerprinting-risk form, accepted because retained data is structured-only. Compensating controls: free-text boundary (INV-05E-04), purpose limitation (05E §1.1), counsel retention-horizon re-review at each new-data-surface gate. Reverts to session-scoped for any surface where a control cannot hold.
**Reason:** World-model value needs full multi-year trajectory; structured-only data keeps accumulated-trace uniqueness low. Counsel approved conditioned on structured-only.
**Artifact:** 05E §7.1.

### SCL-005 — INV-DELETION-COMPLETE (deletion-completeness CI guard)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10, 05E §6 (INV-05E-03); new CI guard
**Change:** New invariant + CI guard: every user-scoped table (FK-to-profiles OR convention column student_id/user_id/*_profile_id) MUST be classified in the deletion partition (delete / retain-anonymized / audit / identity) or an explicit tracked deferral, else CI fails. Extended for 05E to also require the synthetic grouping identifier on every retained activity table. Authoritative drift-proof enumeration; prose table-lists are non-authoritative.
**Reason:** Manual partition (audited 3 ways) still missed a table — see SCL-004. Only live-enumerating CI catches the convention-keyed-no-FK class as the schema grows. Future verticals (Stripe, full-length, tutor) register as tracked deferrals so building them forces cascade wiring.
**Artifact:** To be built (PR-4c / PR-5 wave). Live enumeration at decision time: 52 FK-to-profiles + 14 convention-only tables.

### SCL-004 — student_kpi_rollups_current is an unclassified user-data table (silent retention hole)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10 Layer-1 set
**Change:** `student_kpi_rollups_current` (student_id, no FK to profiles, not referenced by the cascade) was found unaccounted in the deletion partition — a deleted user's KPI rollup would silently survive. Empty in prod now, so the destructive test could not catch it. Must be added to the deleted-derived set; 05E §5 defers the authoritative L1 enumeration to INV-DELETION-COMPLETE precisely so this cannot recur.
**Reason:** Found by the SCL-005 guard reasoning before the guard was even built — the invariant earned itself.
**Artifact:** Fix to land with PR-4c/PR-5; do not hardcode L1 lists in prose.

### SCL-003 — Storage purge moved out of the SQL cascade to the orchestration layer (PR-4)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10
**Change:** `DELETE FROM storage.objects` removed from `execute_account_deletion_cascade`. Supabase `storage.protect_delete()` trigger blocks direct SQL deletion of storage objects; the Storage API is mandatory. Storage purge becomes a PR-4 orchestration responsibility (Storage API call BEFORE invoking the SQL cascade). Registered as GAP-OP-06 / GAP-PR4-STORAGE.
**Reason:** Prod-only bug caught by the destructive real-account test; local rehearsal (stubbed storage, no trigger) structurally could not catch it. Cascade failed AND rolled back atomically — target intact.
**Artifact:** PR #431 (subtractive fix, Codex PASS, applied to prod). Cascade re-tested clean end-to-end after fix.

### SCL-002 — 05D §10 deletion-cascade owner rulings (as built)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10
**Change:** As-built rulings on the hard-delete cascade: (Q2) deletion-request row is DELETED by the cascade — "remains in soft-delete state" satisfied instead by transactional rollback on failure; (Q3) review_schedule classified as L1 identity-linked state (hard-delete), not event data; (Q6) only the two audit_logs FKs (actor/target) dropped, immutability trigger untouched; operator-attribution preflight guard added (36 *_config/*_config_history operator-FK edges block deletion with PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES until reassigned); auth.users SQL delete confirmed working on prod.
**Reason:** Decisions made during PR-3 build + destructive prod test. FK partition proven exhaustive (59 edges).
**Artifact:** Migration 20260625010000, applied + verified live (exact-target precision, negative control survived, idempotent no_op).

### SCL-001 — 05A §5.1/§4.9 PR-2 alignment (GUC atomicity + p_chain_downstream)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05A §5.1, §4.9
**Change:** `recompute_skill_mastery` gained conditional `p_chain_downstream boolean DEFAULT true` (unconditional downstream fan-out deadlocks under backfill interleave; conditional makes lock order monotonic). Backfill/event paths stamp `triggered_by` via `SET LOCAL` GUC; `triggered_by` made NOT NULL + CHECK(IN event/backfill_recompute) to close the CHECK-passes-on-NULL hole.
**Reason:** PR-2 build findings (deadlock analysis + GUC atomicity). Two CI guards hardened against comment-false-match by perturbation proof.
**Artifact:** Migration 20260625000000, applied + verified live.

### SCL-P-GRIDIN-01 — Grid-in serve+grade rides MCQ machinery [OPEN (owner-promoted 2026-08-14)]
Decision: Grid-in (numeric-entry) item type extends the existing MCQ practice pipeline — same serializer,
  same practice_session_items table (+ question_item_type, question_correct_variants), same submit handler,
  same select_practice_pool_random (widened to return item_type + correct_variants). Branches only at
  type-specific points (grade equivalence, empty options, input mode). NO parallel grid-in path.
Rationale: minimize deviation / no double surfaces. One pipeline, one branch point per item type.
Effect: grid-in fully functional end-to-end (serve → typed entry → grade → feedback). Backend migration
  applied [date], Codex-passed, verified live (RPC stays plain invoker).

### SCL-P-GRIDIN-02 — Grid-in grades against correct_variants (snapshot, not lookup) [OPEN (owner-promoted 2026-08-14)]
Decision: Grid-in correctness matches submitted answer against the correct_variants accepted-forms ARRAY
  snapshotted into practice_session_items at prepopulation — NOT against correct_answer alone, and NOT via
  submit-time lookup back to questions. correct_answer = canonical display value; correct_variants = grading
  set (deterministically derived from gridInAcceptedForms).
Rationale: session-immutable grading, single answer-data path (parallel-paths-built-differently avoidance),
  accepts equivalent forms (e.g. "1/5" for "0.2").
Effect: grading is snapshot-based, immutable per session, correct across equivalent forms.

### SCL-P-GRIDIN-03 — Malformed grid-in fails closed, no fallback grading [OPEN (owner-promoted 2026-08-14)]
Decision: If a grid-in canonical value won't parse / variants missing, the handler FAILS CLOSED (data-
  integrity error), NOT a fallback grading path. One grading path only.
Rationale: a malformed answer is a data defect to surface loudly, not grade around; a second grading path
  is a double surface.
Effect: bad grid-in data errors visibly rather than silently mis-grading.

### SCL-P-SUBMIT-01 — Unified answer-submission dispatcher (action-boundary validation) [OPEN (owner-promoted 2026-08-14)]
Decision: Client answer-submission validates WELL-FORMEDNESS via ONE dispatcher, isSubmittableAnswer(
  question, answer), called by BOTH the submit-button state (canSubmit) AND the submitAnswer action guard.
  Enforced at the ACTION boundary before payload/fetch (the disabled button is UX-only and bypassable via
  Enter-key). Per-type: MCQ = non-null option; grid-in = isValidGridInFormat; unknown = fail closed.
  Server owns CORRECTNESS; client owns WELL-FORMEDNESS.
Rationale: industry-standard (client form-check + server correctness; disabled button is bypassable so the
  action must be the guard). Single dispatcher prevents button/action drift. Symmetric across item types,
  extensible at one point.
Effect: both item types validated at one bypass-proof point; MCQ gained action-boundary validation it
  previously lacked. Future item types add one dispatcher case.
Follow-on (logged, not built): button-enabled + inline-error a11y pattern for BOTH types (industry trend
  away from disabled-button); apply to both to preserve symmetry when done.

### SCL-P-GRIDIN-FOLLOWON — Review + full-length grid-in [OPEN (owner-promoted 2026-08-14)]
Note: grid-in serve+grade was built for PRACTICE only. Review and full-length session-item surfaces have
  the SAME latent grid-in gap and need the same fix shape before they serve grid-in. Full-length also
  blocked on 04B seam. Named follow-on, not yet built.

### SCL-P-TZRESET — quota_reset_timezone: UTC (Q13) → America/Chicago [OPEN (owner-promoted 2026-08-14)]
Context: Q13 locked UTC for quota daily-reset determinism. Live config landed as America/Chicago;
  Karl confirmed Central is the intended boundary.
Rationale: US-only launch userbase; midnight Central is a more humane reset than 00:00 UTC. DST wobble
  (23h/25h reset window twice yearly) is acceptable for a quota reset (non-safety, non-scoring). Q13's
  determinism concern was load-bearing for seeded selection (deferred, SCL-P-ADAPTIVE), not quota windows.
Effect: unpaid 40/day quota resets at 00:00 America/Chicago. No code/migration change; config row already
  America/Chicago on prod. Supersedes Q13's UTC clause for quota_reset_timezone only.
Status: OPEN (owner-promoted 2026-08-14).

### SCL-P-CONTENT-01 — Content-column disposition contract (anti-whack-a-mole) [OPEN (owner-promoted 2026-08-14)]
Decision: Every `questions` column has a declared disposition — served_pre_submit / server_only /
  post_submit_only — in a registry, enforced by a CI test that FAILS when a new column appears undeclared.
  served_pre_submit: id, section, stem, passage, options, assets, difficulty, domain, skill_codes, item_type.
  server_only: option_metadata, correct_variants, estimated_time_seconds, premium_flag, quality_score,
  issue_flags, source_lineage, generation_attribution, version, source_type, status, created_at,
  published_at, retired_at. post_submit_only: correct_answer, explanation.
Rationale: recurring defect class — a content column exists on `questions` but the RPC never SELECTs it, so
  it arrives null (caused the R&W passage P0, then option_metadata). A per-column declared contract makes a
  new column require a conscious serve/don't-serve decision; ends the class.
Effect: RPC widened to serve passage + assets; option_metadata/estimated_time_seconds carried server-side
  only. Migration applied, verified live. premium_flag documented permanently unused (Karl: no premium
  questions ever; all questions servable to all users).

### SCL-P-SERVABLE-01 — servable_questions view is the shared flagged-question gate [OPEN (owner-promoted 2026-08-14)]
Decision: `servable_questions` = questions WHERE status='published' AND issue_flags empty. Created WITH
  (security_invoker=true); GRANT SELECT to service_role ONLY. select_practice_pool_random selects FROM the
  view. All student-serving question reads route through it (practice-topics, questions-runtime student
  paths, full-length selection); a CI gate FAILS on direct `.from("questions")` / `FROM questions` in
  student-serving paths (authoring/ingestion allowlisted by path).
Rationale: one shared definition of "servable" so review + full-length inherit the flagged-question gate
  rather than re-implementing it. security_invoker + service_role-only grant are load-bearing: the view is
  SELECT* over answer-bearing columns (correct_answer, explanation, option_metadata), so a broader grant
  would expose the bank WITH ANSWER KEYS via PostgREST.
Effect: flagged questions excluded from selection everywhere; historical reconstruction of already-served
  items may still read `questions` directly (a question flagged after a student saw it must still render in
  review). Migration applied, verified live (security_invoker=true, service_role-only ACL confirmed).
SECURITY BOUNDARY: the servable_questions grant must NEVER be widened beyond service_role. Load-bearing.

### SCL-P-OPTMETA-01 — option_metadata is server-only LISA context, never client [OPEN (owner-promoted 2026-08-14)]
Decision: option_metadata ({"A":{"role":"correct","error_taxonomy":...},...}) is the ANSWER KEY plus
  distractor taxonomy. Server-only: TYPE-ABSENT from StudentSafeQuestionDTO (compile error to add), like
  correct_variants. Consumed solely as LISA (tutor) context; NEVER shown to the student, pre- or
  post-submit.
Rationale: Karl ruling — error_taxonomy is valuable tutor context (LISA can say "you made an equation-setup
  error") but naming it to the student pre-submit leaks the correct role, and post-submit adds no student
  value over the explanation. Simpler and safer as server-only, full stop.
Effect: carried RPC→snapshot server-side; never in any student payload. LISA reads it; INV-03-01 (LISA never
  writes mastery) unaffected.

### SCL-P-ASSETS-01 — assets discriminated union; role is an anti-leak boundary [OPEN (owner-promoted 2026-08-14)]
Decision: assets = { v:1, items:[{ id, kind:"svg"|"table", role:"stimulus"|"option"|"explanation", alt,
  option_key?, ... }] }. Inline, text-representable (not object storage). ROLE is an anti-leak boundary:
  pre-submit serves ONLY stimulus/option; explanation-role (worked-solution figures) is post-submit only.
  filterAssetsPreSubmit FAILS CLOSED — unknown v / missing role / unknown role / unknown kind → excluded,
  never passthrough.
Rationale: inline SVG keeps figures legible to LISA (labels as text), transacts+deletes with the row (no
  second deletion surface vs object storage), and is AI-authorable/auditable. Role-filtering server-side
  prevents explanation figures (which reveal the answer) leaking pre-submit. Fail-closed because an
  unrecognized asset shape is exactly when least should be revealed (3rd fail-open default caught in
  program — quota, rate-limiter, assets).
Effect: assets threaded RPC→snapshot→DTO→client (renderer deferred — 0 authored). Server role-filter live.
  Authoring note (out of engine scope): inline SVG is an XSS vector — authoring gate must reject
  script/event-handler/external-href; renderer sanitizes.

### SCL-P-SECTION-01 — Shared section resolver; fail-closed label [OPEN (owner-promoted 2026-08-14)]
Decision: shared/section-display.ts exports isMathSection() and sectionDisplayLabel() (M→Math, RW→R&W).
  Badge, Desmos gate, and reference-sheet gate all call these — no ad-hoc section comparison in the client.
  sectionDisplayLabel returns null (not a defaulted section) on unknown; callers render a neutral state.
  Resume path reads the item's canonical section ('M'/'RW'), not the session-spec full-word string.
Rationale: a hardcoded/broken section check badged Math questions "R&W" (data verified clean). One shared
  resolver kills the double-surface. Fail-closed on the label (not defaulting to a section) prevents the
  "unknown → R&W" recurrence; the earlier percentage-style default WAS that recurrence.
Effect: badge correct on practice + resume + review + full-length (shared helper, reusable by those
  surfaces). Client-only, no migration.

### SCL-P-EXPLANATION-01 — Post-submit explanation/answer values route through MathRenderer [OPEN (owner-promoted 2026-08-14)]
Decision: post-submit explanation text and answer-value displays route through MathRenderer (which
  tokenizes inline $...$ within prose) at all render sites: QuestionRenderer, NumericEntryInput,
  FullLengthReviewView (explanation + answer values), review-errors. Placed INSIDE the post-submit
  result panel (anti-leak: never renders pre-submit).
Rationale: explanations are prose-with-inline-math ("the $4$th value is $18$"); the stem is whole-string
  math. The renderer already tokenized inline $...$; the gap was threading, not parsing. MathRenderer is a
  display component — placement inside the post-submit gate preserves anti-leak.
Effect: LaTeX in explanations/answers renders typeset, not raw source. Client-only, no migration.
Content note (authoring track): explanations must reference answer VALUES, not option letters — options
  randomize per serve, so "Option B" is meaningless. Existing "Option B" explanations are authored wrong
  for the randomized model; report-an-issue loop surfaces them.

### SCL-P-DESMOS-01 — Desmos resizable side-panel; CSS min-width is the pixel floor [OPEN (owner-promoted 2026-08-14)]
Decision: Bluebook-parity resizable side panel (question left, Desmos right, draggable divider), math-only,
  graphing+scientific modes with per-mode state preserved across switches. Split activates at 1062px;
  below it the calculator stacks full-width (never a sub-450px side panel). The 450px floor (Desmos stacks
  its expression list below the graph under 450px container width) is enforced by BROWSER CSS min-width:496px
  on the calculator panel (host = 496−16 padding = 480 ≥ 450) — the single source of truth, honored on first
  render. calculator.resize() called on container-change/toggle/mode-switch (autosize:true explicit).
Rationale: a fixed sidebar structurally can't clear 450px on laptops; a resizable panel with a real pixel
  floor can. CSS min-width is browser-continuous and needs no JS — chosen over a JS ResizeObserver
  recompute (which was found dead in prod: ref mounted after the effect ran → observer never created; a
  phantom mechanism everyone believed enforced the floor). One mechanism, browser-enforced.
Effect: calculator renders desktop layout ≥450px on first paint and after resize; verified by a test that
  measures resolved pixels (stubbed BCR), not the CSS attribute. Divider drag/keyboard are library-provided,
  bounded by the CSS floor; real interaction proof deferred to a Playwright e2e follow-up. Client-only.

### SCL-P-REFSHEET-01 — Math reference sheet typeset + complete [OPEN (owner-promoted 2026-08-14)]
Decision: all 12 official Bluebook formulas render via MathRenderer (were plain text); added the two
  missing special-right-triangle figures (30-60-90: x, x√3, 2x; 45-45-90: s, s, s√2) as labeled figures.
Rationale: plain-text "pi r^2" beside a typeset question is a visible quality tell; the two special
  triangles are on the official sheet and heavily used. Verified against the official Bluebook sheet.
Effect: reference sheet matches the official sheet, typeset. Client-only.

### SCL-P-OWNERSHIP-01 — Practice session reads are non-owning [OPEN (owner-promoted 2026-08-14)]
Decision: /state and /resume READ session state WITHOUT writing client_instance_id — no adoption, no claim.
  Ownership mutates ONLY on the answer-submit WRITE. client_instance_id is generated once and persisted
  (sessionStorage) so a refresh reuses the same id. Concurrent /state + /resume on load are de-duplicated.
Rationale: a P0 — practice sessions 409'd on refresh. Root cause: client_instance_id regenerated per-render
  + /state and /resume racing to ADOPT ownership (one adopts, the other 409s). Reads don't conflict; only
  concurrent writes/claims do — so ownership enforcement belongs on the write path, and a read must never
  409 on instance mismatch. Reads-non-owning verified by code-trace (stored id unchanged after a read).
Effect: refresh/resume works; a new tab/device can read a resumable session without stealing it. Pure
  client/server-logic fix, NO migration.

---

## Owner spec-annotations owed (fold into locked docs on next revision)

These are OPEN entries above that specifically need the locked spec doc text updated by the owner:

- Doc 01 §40.3 — SCL-013 (subscription-cancellation timing: "initiated immediately" → active during grace, paused at T+7)
- Doc 01 §19 — SCL-012 (deletion-confirmation prompt: "data anonymization at T+7" → "permanent deletion of the account at T+7")
- 05A §5.1/§4.9 — SCL-001 (PR-2 GUC + p_chain_downstream)
- 05D §10 — SCL-002 (Q2 request-row deletion; Q3 review_schedule→L1; Q6 audit FK drops; operator-attribution guard)
- 05D §10 — SCL-003 (storage-purge → PR-4 orchestration seam)
- 05D §10 — SCL-004 (student_kpi_rollups_current → deleted-derived set; defer enumeration to INV-DELETION-COMPLETE)
- Doc 02B §15 — SCL-015 (item selection: weakness-ranked + seeded Fisher-Yates → filter-driven native random prepopulation; adaptive deferred post-launch)
- Doc 02B (flow-cards) — SCL-016 (flow-cards deferred post-launch; useAdaptivePractice retired)
- Doc 05E — SCL-007/008/006 commit to docs/Spec after Codex audit
- Doc 03 INV-03-03 — SCL-029 (past_due/trialing: platform entitlement predicate wins over literal "status=active")
- Doc 03 INV-03-10 — SCL-030 (scope narrowed to model-generated text; structured API fields excluded; LISA-FULL-007 tracks enforcement)
- Doc 03B §5.5 — SCL-032 (remove step 4 live exam block from Start Conversation; amend §3.4 "turn" language; annotate INV-03-02 scope)
- Doc 03C IAM table — SCL-031 (annotate compaction worker Supabase access as defense-in-depth, not canonical write path)
- Doc 03A §18.2 — SCL-028 (widen idempotency constraint to include role in uniqueness key)
- Doc 03B §6.5 — SCL-027 (confirm step 5/6 ordering inversion: payload validation before ownership check)
- Doc 03A §7.3/§10.3 — SCL-026 (update §7.3 to V1 per-turn capture; add learner_observation to §10.3 orchestrator response contract)
- Doc 03B §3.1, Doc 03 §21.3, Doc 07E — SCL-025 (safety review is separate surface; amend §21.3 tooling to keep content in Supabase)
- Doc 03A §18.7/§18.1/§18.2/§18.4/§18.5, Doc 03B §4.1 — SCL-024 (config table → Doc 01A §8; retype question FK columns UUID→TEXT; wire-contract Zod schemas)
- Doc 03C, Doc 03C.1, Doc 03A — SCL-023 (add crisis classifier stage; add classifier_class alias; add crisis test scenarios; rename §4.5)
- questions_governance.md §A.4 — SCL-022 (review skill-classification disambiguation table and tiebreak rule)
- questions_governance.md §A.3/§A.8 — SCL-021 (confirm value-equivalence correctness model; align with Doc 04B)
- Doc 02B §14, contracts/mcfr-coexistence.contract.md — SCL-069 (practice grid-in serve + grade end-to-end; migration + anti-leak integration test)
- questions_governance.md §A.4 — SCL-020 (confirm 29-skill Title Case convention)
- Doc 02A §15/§16/§23 — SCL-018 (promote grid-in into spec; update QA gate to exempt grid-in from "four options present")
- Doc 05A §4.6/§11.4 — SCL-014 (update source table names to match live schema)
- Doc 03 INV-03-05, Doc 03A §16.2–16.3 — SCL-033 (narrow "no derived indicators" to "no indicators derived from conversation substance"; permit bare skill-topic coverage to guardians)
- Doc 03D §3, §5.1 CASE-18, authoring brief — SCL-039 (affective state as scaffolding input; permit structural supply on self-directed negative judgment; directive paired with recent_friction context block per §7.4)
- Doc 03D §3.1, §3.2 — SCL-034 (add buggy-procedure as third diagnostic mode; amend misconception repair rate definition)
- Doc 03D §5.1 CASE-15/CASE-16 — SCL-035 (decompose-first with three-level floor; annotate owner's blind gold response)
- Doc 03D §3.2, §5.1 coverage taxonomy — SCL-036 (add disengagement signal replacing frustration model; reclassify self-deprecation category)
- Doc 03D §0, §5.1 authoring brief — SCL-037 (INV-03-04 justification narrowed to product decision; redirect-over-refuse posture grounded)
- Doc 03D §9 — SCL-038 (record expected effect-size range and power consequences; coordinate marketing substantiation)
- Doc 03D §6.2, §6.3, §6.6 — SCL-060 (active question explanation is internal context, not an anti-leak surface; anti-echo directive + INV-03-04 are the defense layers)

SCL-081 | 2026-09-02 | Doc 05A §4.9 — the inline comment names a call the RPC does not make, and 05C §8.4 says the opposite | PROPOSED
Id: `SCL-081` re-derived at the moment of use, 2026-09-02, across all 33 remote branches (`git grep -ohE "SCL-[0-9]{3}" <ref> -- docs/`). Highest allocated anywhere is `SCL-080` (`origin/stripe`, `origin/main`). No collision.
Change: correct one inline comment in Doc 05A §4.9's code block. No behaviour changes, no invariant moves, and no other passage is affected. This is a documentation defect in a LOCKED document, raised rather than silently ignored, because it points a reader at a seam that does not exist.
WAS: Doc 05A §4.9, in the code block immediately after the `PERFORM public.refresh_domain_mastery(...)` call, verbatim:
  `-- refresh_domain_mastery internally calls refresh_section_projection`
IS: `refresh_domain_mastery` does NOT call `refresh_section_projection`, and no 05B function does. The 05A→05C seam is a DIRECT call from `apply_mastery_event` to `bump_projection_refresh_counter`, made after `refresh_domain_mastery` returns.
Evidence, from the deployed body rather than from reading:
  - `supabase/migrations/20260613000000_lane_c_mastery_seam.sql:238-239` — the two calls are siblings in `apply_mastery_event`, in this order:
      `PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);`
      `PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);`
  - `refresh_domain_mastery` fans out to the four KPI refreshers (Doc 05B §4.9) and to nothing in 05C.
  - A production stack trace from CI on 2026-09-01 shows the real nesting and stops at the KPI refresher: `refresh_overall_kpi ... <- SQL statement "SELECT public.refresh_domain_mastery(...)" <- PL/pgSQL function apply_mastery_event ... line 154 at PERFORM`.
CONTRADICTED BY THE OWNING DOCUMENT: Doc 05C §8.4 is explicit and says the reverse — "The only cross-doc seam is a single 05C-owned increment function that `apply_mastery_event` calls", and, in its own code comment, "05C-owned increment function. apply_mastery_event (05A) calls THIS; it does not touch any projection column directly. This is the single cross-doc seam". Per RB-05C-V1-03 the projection-refresh state is 05C-owned precisely so that 05A/05B do not reach into it. So the corpus already contains the correct statement; 05A §4.9's comment is the outlier.
Rationale: 05C owns projections, and the owning document wins. The 05A comment also names a function, `refresh_section_projection`, whose relationship to the actual `compute_section_projection` / `bump_projection_refresh_counter` pair is not stated anywhere — so a reader trying to follow §4.9's chain looks for a call that is not there and a function that does not carry that seam. The cost of the defect is not behavioural but navigational, which is exactly the kind of drift a locked corpus should not accumulate.
Why this surfaced now: `tests/ci/mastery-emission.postgrest.ci.test.ts` asserts `student_projection_refresh_state.events_since_refresh` as the witness that `apply_mastery_event` ran to completion, because `bump_projection_refresh_counter` is its final statement before `RETURN`. Establishing that the counter really is terminal required resolving which function calls it, and the two documents disagreed.
Owner action: amend Doc 05A §4.9's inline comment to state the actual seam — e.g. `-- refresh_domain_mastery fans out to the four KPI refreshers (Doc 05B §4.9); the 05C projection-refresh throttle is invoked separately by this function, per Doc 05C §8.4` — or, if a `refresh_section_projection` seam was in fact intended and 05C §8.4 is the passage in error, say so and the code is what changes instead.
Build artifact: no code change. This entry records a documentation defect only; nothing in this PR depends on the outcome.

SCL-082 | 2026-09-03 | Doc 01 V8 §5.1 has no retention tier for product-notification data; the notifications rebuild adopts 90 days and the spec must say so | PROPOSED
Id: `SCL-082` re-derived at the moment of use, 2026-09-03, across all 43 remote branches after `git fetch --all --prune` (`git grep -ohE '^SCL-[0-9]{3} \|' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch, plus a whole-tree grep for `SCL-08[2-9]` on every branch; the three open PRs' head branches — #709, #692, #655 — are among the scanned refs). Highest allocated anywhere is `SCL-081`. No collision.
Change: add a retention tier for product-notification data. Proposed text for the Doc 01 V8 §5.1 retention table: `| Product notifications (in-app message rows, email message rows, provider delivery receipts) | 90 days from creation; the parent event row lives until its last message is gone | Identity-adjacent operational trail (who was linked to whom, and whether the message reached them); same forensics window as authentication events |`. When the retention sweep lands (Phase 2 of the rebuild), the class is also registered in the Doc 06D §9 retention-policy registry.
WAS: Doc 01 V8 §5.1 lists authentication events (90 days), identity mutations (365 days), entitlement/billing events (7 years), account deletion requests, guardian consent events, and support-mediated operations. No row names notifications. Doc 06D §9's registry has no notification entry. Doc 07E §9.2 declares a pre-deletion notification log for V1.1+ with minimum fields but no retention. The read-only audit of 2026-09-03 searched `docs/Spec` for a notification retention rule and found none.
IS: `contracts/notifications.contract.md` §11 states the rule the build implements: `in_app` message rows 90 days from `created_at`; `email` message rows and `notification_delivery_events` rows 90 days from `created_at` / `received_at`; `notification_events` rows until their last message is gone. Chosen to match the §5.1 authentication-event tier because the data is identity-adjacent and operationally useful for the same window, and none of it is a financial or consent record. Payloads carry identifiers and rendering parameters only (contract §8), so retention holds no student content.
Rationale: the spec is silent, and a retention period is a permanent rule about personal data that belongs in the governing document, not in a repo contract alone (the "silence that must become spec text" case in the WHAT IS AN SCL test). A tier that is only in the contract can drift from the privacy policy without anyone noticing.
Why this surfaced now: the owner brief for the notifications rebuild (2026-09-03) requires the contract to state a retention rule and an SCL to record the gap and the choice.
Owner action: amend Doc 01 V8 §5.1 with the row above (or place it where the owner prefers); on Phase 2, add the class to the Doc 06D §9 registry alongside the sweep job.
Build artifact: `contracts/notifications.contract.md` §11 (rule stated; falsifiable by a sweep that deletes younger rows). No sweep is built in the rebuild PR — Phase 2 by the brief.
Amended 2026-09-15, in place, while still PROPOSED (the status is the owner's to set; the sweep does not close this entry, because the entry is about the SPEC being silent, and only the §5.1 row does that): Phase 2 has landed. The mechanism is `public.sweep_notification_retention(p_batch_size)` reading the window from `public.notification_retention_days()` (one definition, 90) in `supabase/migrations/20260915100000_notification_retention_sweep_and_feed_archive.sql`, called daily by `GET /api/internal/notification-retention-sweep` (`vercel.json`, `0 5 * * *`), logging every run including zero-deletion runs (`retention_sweep_completed`). Contract C11.2 now describes the sweep and C11.3 the log line; both are proven on real Postgres by `tests/ci/notifications-retention-page.pg.ci.test.ts`. The "IS" above still holds and is now enforced. Owner action unchanged: the Doc 01 V8 §5.1 row, and — now that the sweep exists — the Doc 06D §9 registry entry for the class (`infra/retention-policy-registry.yaml`), which this build does not write because the registry substrate is the owner's.
Amended 2026-09-16, in place, while still PROPOSED: the sweep now covers the orphan class. Verified in prod that `notification_delivery_events_message_id_fkey` is `ON DELETE CASCADE`, so matched delivery events already go with their message; unmatched rows (`message_id IS NULL` — 5 of 10 in prod, four days in) had no parent and were never swept, and the sweep itself manufactures them once messages age out. `supabase/migrations/20260916100000_notification_retention_sweep_orphaned_delivery_events.sql` recreates the ONE `sweep_notification_retention(p_batch_size)` with a second branch in the same transaction under the same cutoff: unmatched delivery events aged on `received_at`, bounded per call like the parent branch. Still one window definition (`notification_retention_days()`), read once. The "IS" above now reads: in_app and email message rows, and matched delivery events, go with their event at 90 days from the event's `created_at`; unmatched delivery events go at 90 days from `received_at`; the same 90-day tier governs both, because the orphan rows carry no personal data (provider ids, event type, timestamps, outcome). Contract C11.2 describes both branches; the log line (C11.3) carries both counts. Owner action unchanged.

SCL-083 | 2026-09-15 | Doc 01 V8 §40.5 executes the hard delete but no locked document names a completion notice; the deletion executor now sends one and the spec must say so | PROPOSED
Id: `SCL-083` re-derived at the moment of use, 2026-09-15, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch) and the head branches of the five open PRs (#734, #733, #731, #728, #655). Highest allocated anywhere is `SCL-082`. No collision.
Change: add to Doc 01 V8 §40.5 (Hard delete at T+7) the sentence: `On completion the platform sends the account's last known email address one transactional notice stating that the deletion has been carried out and on what date. The notice carries no account details, no learner data and no link; it is best-effort with no retry, because retrying would require retaining the address of a person whose data has just been deleted.` Doc 07E §9.2 (pre-deletion notification, V1.1+) is a different notice — it warns BEFORE inactivity-driven deletion — and is not changed.
WAS: Doc 01 V8 §40 describes the request (§40.2), the recovery window and its scheduled email carrying the recovery link (§40.2.1 Phase 4), the lock (§40.3/§40.4) and the hard delete at T+7 (§40.5). §40.5 states what is deleted and that it is irreversible; it says nothing about telling the person that it happened. Doc 07E §9.2 declares only the inactivity pre-deletion notice. A read of `docs/Spec` on 2026-09-15 found no other mention of a post-deletion message. The executor (`server/lib/account-deletion-execute.ts`) sent nothing after completion.
IS: `executeDueDeletions` reads `profiles.email` before its first mutating step, runs the existing sequence unchanged, and after `complete_and_anonymize_account` returns `completed` sends `sendAccountDeletionCompletedEmail` (`server/lib/notifications/direct-sends.ts`, template `templates/deletion-completed.ts`) through the one Resend transport with `Idempotency-Key = account-deletion-completed:<account_deletion_requests.id>`. Per account, not per batch; the address is never persisted and only its redacted form is logged; no retry; a send failure never fails the deletion or the batch. No event type, no CHECK change, no schema change. Rule recorded as `contracts/notifications.contract.md` C0.6.
Rationale: a person who asked for their account to be deleted is told when it has been done — the deletion-scheduled email (§40.2.1) promises a date, and the completion notice is the evidence the promise was kept. The message is a direct send (not a notification event) because by the time it is sent the recipient has no profile row for a message row to be addressed to, and the content rule (date only, no link) follows from the fact that recovery is impossible after §40.5. This is the "silence that must become spec text" case: a message the platform sends to a person is a product behaviour the governing document should name.
Why this surfaced now: the owner brief of 2026-09-15 ("Deletion Completion Notice + Login Return Path") asked for the notice and, where the spec is silent, for an SCL filed as PROPOSED.
Owner action: amend Doc 01 V8 §40.5 with the sentence above (or place the rule where the owner prefers); confirm that Doc 07E §9.2 remains the inactivity pre-deletion notice only.
Build artifact: `server/lib/account-deletion-execute.ts` (read-before-mutate + post-commit send), `server/lib/notifications/direct-sends.ts` (`sendAccountDeletionCompletedEmail`), `server/lib/notifications/templates/deletion-completed.ts`, `contracts/notifications.contract.md` C0.4/C0.5/C0.6, `tests/ci/deletion-completed-notice.pg.ci.test.ts` (real Postgres, run in CI by the "Deletion-completed notice → real PG proof" step).

SCL-084 | 2026-09-16 | Doc 10 §2.4 and §9.4 scope Parent / Guardian Terms to minor users (13-17); the re-consent prompt now asks any account holding an active guardian link, whatever the linked student's age | APPLIED
Id: `SCL-084` re-derived at the moment of use, 2026-09-16, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch) and the head branches of the five open PRs (#761, #760, #759, #728, #655). Highest allocated anywhere is `SCL-083`. No collision.
Change: amend Doc 10 §2.4 (age-threshold taxonomy, operational rules) and §9.4 (Parent / Guardian Terms) so the obligation attaches to the GUARDIAN RELATIONSHIP rather than to the linked student's age. Proposed §2.4 rule, replacing "All minor users (13-17) -> Parent / Guardian Terms apply": `Parent / Guardian Terms apply to any account holding an active guardian link, whatever the linked student's age. For minor users (13-17) they are additionally a mandatory signup clickwrap per §9.15.` The guardian-visibility clause and the §9.15 clickwrap requirement for minors are unchanged.
WAS: Doc 10 §2.4 states `All minor users (13-17) -> Parent / Guardian Terms apply; guardian-visibility model per Doc 01 V6.0`, and §9.4 opens `Mandatory clickwrap when the user is a minor.` Both tie the document to the linked student being a minor. Doc 01 §31 and §35-§37 place no age condition on a guardian link — §31 "Guardian pays for linked student" works for an adult student — so the spec as written leaves a guardian of an adult student outside Parent / Guardian Terms entirely.
IS: `requiredLegalDocsForUse(facts)` (`shared/legal-consent.ts`) adds `LEGAL_DOCS.parentGuardianTerms` when `facts.hasActiveGuardianLink` is true. That fact is `getAllGuardianStudentLinks(userId).length > 0` — guardian-side, status `active` — and reads no age. Confirmed effect on production data, 2026-09-16: one account holds active links (`c6d3fc60`, two links). Both linked students are adults (`age_years` 22 and 25), so under the spec as written that guardian owes nothing extra, and under the implementation they are prompted for Parent / Guardian Terms. Zero accounts today hold a link to a 13-17 student, so narrowing to the spec's wording would leave the document unaskable of anyone.
Rationale: not the model's call, and not filed as one. The auditor raised the divergence, it was put to the owner with both options and the production ages, and the owner ruled on 2026-09-16 to keep the active-link condition. This entry records that ruling as a spec change to be made, not a code defect to be fixed, because the ruling is that the SPEC is what should move. The substantive argument for it: the Parent / Guardian Terms govern the guardian's own obligations — visibility, payment, conduct toward the linked account — and those obligations exist because the link exists, not because of the student's birthday. An age-gated rule also produces a cliff nobody would want, where the document silently stops applying on the student's eighteenth birthday while the relationship and the visibility it grants continue unchanged.
Risk if the spec is NOT amended: every Parent / Guardian Terms acceptance row written by the re-consent prompt for a guardian of an adult student is an acceptance of a document that, per Doc 10 as written, does not govern that relationship. No such row exists yet.
Why this surfaced now: the owner directive of 2026-09-16 ("Prompt for whatever consents are outstanding") made the required document set a function of account facts, which put Parent / Guardian Terms into a prompt for the first time and so made its trigger condition load-bearing. It had never been asked for outside guardian link redemption before.
Owner action: DONE, in part — the owner authorised the amendment explicitly on 2026-09-16 ("BUILD DIRECTIVE — Amend Doc 10 per SCL-084") and the substantive edits to Doc 10 §2.4 and §9.4 are applied on branch `claude/doc10-parent-terms-link-scope`. Remaining: the `CR-10-04` entry in Doc 10 §14 Change Records, which could not be written — see Not yet applied below.
Applied: Doc 10 §2.4 — the "Lyceon student minor" taxonomy row no longer reads as scoping the Terms to minors; the operational rule "All minor users (13-17) -> Parent / Guardian Terms apply" is replaced by "Any account holding an active guardian link -> Parent / Guardian Terms apply, whatever the linked student's age", with the relationship defined per Doc 01 §36.1 and the age-specific obligations preserved as age-specific; the closing paragraph records that the Terms are referenced by the taxonomy but not derived from it. Doc 10 §9.4 — "What it is" now covers any linked guardian and separates the consent function (minors, per §9.15) from the visibility-and-responsibility function (adult students); "Why Lyceon needs it" separates the standing obligation from the minor signup clickwrap. §9.15, Doc 01 §37, §10.2 and §11.7 are untouched and remain true under the wider rule.
Not yet applied: `CR-10-04` in Doc 10 §14. Writes to `docs/Spec/` are denied by this environment's permission settings — the guard that enforces the READ-ONLY rule in CLAUDE.md. The substantive edits landed through a shell write before that guard was hit; the change record did not, and the block was not worked around. The amendment is therefore recorded HERE and not yet in the document's own change log. Owner action: authorise the `docs/Spec/` write so `CR-10-04` can be appended, or apply it by hand.
Status note: SCL-084 is the first entry in this register whose amendment has actually been made, and the register had no token for that state. The owner named it on 2026-09-16 — `APPLIED`, defined in the STATUS VALUES section of this file's header alongside PROPOSED and RULING — and this entry is the first to carry it.
Deferred conflict, surfaced by this amendment and NOT resolved by it: `legal/parent-guardian-terms/v2/en.md` §1 states "You are the parent or legal guardian of that student" and the preamble scopes the document to consenting to "a minor's use". A guardian linked to an adult student cannot truthfully make that representation, so the published document now contradicts the amended Doc 10. That file is a sealed published version under the legal immutability gate; correcting it means publishing a new version, which is a separate owner decision and was explicitly out of scope for this amendment.
Build artifact: `shared/legal-consent.ts` (`LegalAccountFacts`, `requiredLegalDocsForUse`, `actorTypeForDoc`), `server/lib/legal-account-facts.ts`, `server/routes/profile-routes.ts`, `server/routes/legal-routes.ts`, `tests/ci/consent-outstanding-set.contract.test.ts` (O1/O2 pin the condition and the four production states).

SCL-085 | 2026-09-16 | Doc 01 V8 §5.1 retains account-deletion requests for seven years and guardian-consent events with identity for one year; the deletion vertical adopts one 24-month evidence clock with an identity strip, and the spec must say so | PROPOSED
Id: `SCL-085` re-derived at the moment of use, 2026-09-16, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch) and the head branches of the three open PRs (#767, #728, #655). Highest allocated anywhere is `SCL-084`. No collision. Four entries are allocated in this session, sequentially: SCL-085, SCL-086, SCL-087, SCL-088.
Change: amend the Doc 01 V8 §5.1 retention-tier table. Proposed replacement for the row `| Account deletion requests | 7 years (anonymized after 1 year) | Regulatory + evidence of compliance |`: `| Account deletion requests (the deletion request log: subject and requester address, channel, request and response dates, outcome, denial basis) | 24 months with identity, then identity stripped and the dated, aggregate record retained | CCPA §7101(a) record of consumer requests; the only period any regulator names |`. Proposed replacement for the row `| Guardian consent events | Permanent (anonymized after 1 year) | COPPA compliance evidence |`: `| Consent evidence (acceptance date, document key and version, actor type, minor flag, consent source, IP address, user agent), copied beside the deletion request log at execution | 24 months with identity on the same clock as the request log, then identity stripped and the dated, aggregate record retained permanently | COPPA compliance evidence; one clock for the whole evidence bundle |`.
WAS: Doc 01 V8 §5.1 (retention tiers, lines 214-223) gives account deletion requests "7 years (anonymized after 1 year)" and guardian consent events "Permanent (anonymized after 1 year)". Neither figure cites a basis in the corpus. §40.5 step 4 (line 1996) ends the lifecycle with `account_deletion_requests.status = 'completed'`, a row that under the as-built cascade (SCL-002, PS-5) does not survive, so the seven-year tier has had nothing to apply to since 2026-06-25.
IS: the evidence bundle built in migration `20260917000000_deletion_evidence_bundle.sql` is a `deletion_request_log` row (plus `deletion_consent_evidence` and `deletion_billing_record` rows keyed to it) written outside the identity graph, never carrying `actor_id` or `profile_id`, dated at day granularity. The 24-month identity strip is Phase 5 of the plan and is NOT built by this migration; this entry records the period so the spec and the published retention policy agree before the sweep exists.
Rationale: CCPA §7101(a) requires records of consumer requests and how the business responded for at least 24 months and names the permitted fields; §7101(c) is a safe harbour for keeping exactly that. COPPA (amended Rule, in force 2026-04-22) prohibits indefinite retention of children's data and requires a published retention policy naming each category and its deletion timeframe; the FTC's *In re Kurbo* complaint treated three years regardless of activity as unreasonable. 24 months is under that line and is the only figure a regulator names. Seven years for the request record has no cited basis; the consent tier moving from one year to 24 months is the owner's ruling (plan v4 §2) so the whole bundle strips on one clock, and is put to counsel as such.
Why this surfaced now: the read-only evidence audit of 2026-09-16 found that no record of a completed deletion survives today; the target-state plan (v4) that closes it fixes the retention period, and the owner brief of 2026-09-16 ("Deletion Vertical: SCLs, Phase 4, Phase 1") asks for the register entry first.
Owner action: amend Doc 01 V8 §5.1 with the two rows above; add the two evidence tables to the Doc 06D §9 retention registry when Phase 5 lands the sweep; put the consent-clock extension (one year to 24 months) to counsel explicitly rather than folding it in silently.
Build artifact: `supabase/migrations/20260917000000_deletion_evidence_bundle.sql` (tables, RPCs), `server/lib/account-deletion-execute.ts` (the three-transaction execution path), `tests/ci/deletion-evidence-bundle.pg.ci.test.ts`.
Amended 2026-09-16, in place, while still PROPOSED (spec-auditor finding B on PR #769): Doc 01 V8 §5.1 "PII redaction" (lines 238-242) truncates IP addresses to /24 (IPv4) or /48 (IPv6) and reduces user-agent strings to browser family + OS family at log-write time for `audit_logs`. `deletion_consent_evidence` copies `ip_address` and `user_agent` from `legal_acceptances` UNREDACTED. That is a choice, not an oversight, and it is put to the owner and counsel here rather than made silently: plan v4 §3.5 keeps them because they are what makes a consent record evidentially credible rather than a bare assertion (Doc 10 §9.15 names IP specifically, "for fraud-prevention scoped"), and `legal_acceptances` already holds them unredacted during the account's life. The §5.1 rule as written governs `audit_logs`, not consent evidence. Proposed resolution for the §5.1 amendment: either (a) state that the consent-evidence row inherits the §5.1 redaction at copy time (IP /24 or /48, user agent to family; the copy in `mark_deletion_log_executing` would apply both), or (b) state that consent evidence is exempt for its evidentiary purpose and is stripped whole at 24 months with the rest of the bundle. The build implements (b) pending the ruling; switching to (a) is a one-function change with no schema impact.
Amended 2026-09-16 (second amendment, in place, still PROPOSED — owner ruling, follow-up brief on PR #769 item 2): option (a). Consent evidence INHERITS the Doc 01 V8 §5.1 redaction — IP truncated to /24 (IPv4) or /48 (IPv6), user agent reduced to browser family + OS family — applied at copy time. Reasons for the register: the spec made this call once for identity-sensitive audit data and there is no principled reason consent evidence differs from audit evidence; the marginal evidentiary value of a full address over a /24 is small, since what defends a COPPA claim is the consent method, the date and who gave it, with IP as corroboration; and this is children's data held for 24 months, where minimisation is the direction the amended COPPA Rule pushes. The code is flipped in the same PR (`public.redact_evidence_ip`, `public.redact_evidence_user_agent`, used by `mark_deletion_log_executing`; pinned by test C3.8 and mutation M13). Counsel may override later for full fidelity in defence; the reversal is cheap — one function, no schema change — and that is recorded so the choice is never treated as load-bearing. Proposed §5.1 text for the consent-evidence row's rationale column: `COPPA compliance evidence; carries the §5.1 PII redaction (IP /24 or /48, user agent to family) from the moment it is copied`.

SCL-086 | 2026-09-16 | Doc 01 V8 §40.3 as amended by SCL-013 pauses Stripe billing at T+7; the executor now cancels the subscription, restoring §40.2.1's original `stripe.subscriptions.cancel(…, { prorate: false })` | PROPOSED
Id: `SCL-086` re-derived at the moment of use, 2026-09-16 (see SCL-085 for the derivation; second of four sequential allocations this session).
Change: reverse the "paused (Stripe pause_collection: void)" clause that SCL-013 (OPEN, owner-promoted 2026-08-14) wrote into Doc 01 V8 §40.3 (line ~1968). Proposed §40.3 text for the T+7 clause: `At T+7 execution, the deletion driver cancels the Stripe subscription (`stripe.subscriptions.cancel(subscriptionId, { prorate: false })`, no invoice, no proration) and the cascade removes the entitlement. Where the subscription is paid by a guardian and carries other students, the driver removes only this student's subscription item; where it is the last item, the subscription is cancelled. A deletion cancelled during grace leaves the subscription uninterrupted.` The timing half of SCL-013 (no Stripe operation at request; subscription active through the grace period) is unchanged.
WAS: Doc 01 V8 §40.2.1 (line 1911) specifies `await stripe.subscriptions.cancel(subscriptionId, { prorate: false })`; §40.3 as amended by SCL-013 says billing is "paused (Stripe pause_collection: void)" at T+7 with "Full Stripe subscription cancellation DEFERRED to PR-4b". PR-4b was never built: `server/lib/account-deletion-execute.ts:47` still reads "Full cancellation is PR-4b", and no writer ever moved `stripe_cancellation_status` past `pending`.
IS: the executor cancels at T+7 (Part B of the 2026-09-16 brief). A paused subscription is a live billing relationship with a person who, after the cascade, no longer exists in Lyceon: the pause can be lifted, the customer object still names them, and nothing in Lyceon can ever reach it again because `stripe_customer_id` is scrubbed before the cascade. This is not a new rule: it is §40.2.1's own call returning, with the guardian-paid case (SCL-045, one subscription, one item per student) spelled out.
Rationale: owner ruling (plan v4 §4 Phase 0): a paused subscription preserves a billing relationship with a person who no longer exists. The reason SCL-013 recorded pause was that pause was what had been built, not that pause was right.
Why this surfaced now: the evidence audit found `stripe_cancellation_status` never leaves `pending` and no cancellation proof survives; the plan's Phase 4 closes it.
Owner action: amend Doc 01 V8 §40.3 with the clause above; mark SCL-013's pause clause SUPERSEDED by this entry (the timing half stands); reconcile §41's checklist line and Doc 05D §10.1's "immediate subscription cancellation at the deletion request" to the T+7 timing.
Build artifact: `server/lib/account-deletion-execute.ts` (`cancelStripeBilling`), `deletion_billing_record` in `supabase/migrations/20260917000000_deletion_evidence_bundle.sql`, `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` (B3).

SCL-087 | 2026-09-16 | Doc 01 V8 §5.1 says a hard-deleted profile's `audit_logs` ids "become NULL" and rows are later hard-deleted, while Appendix E prohibits UPDATE/DELETE on `audit_logs` at schema level; the ruling is that immutability wins, with one named exemption | PROPOSED
Id: `SCL-087` re-derived at the moment of use, 2026-09-16 (see SCL-085; third of four sequential allocations this session).
Change: add to Doc 01 V8 §5.1 ("GDPR / data deletion interaction") and Appendix E (`audit_logs` row, line 2899) one reconciling sentence: `The append-only guarantee (trigger `audit_logs_no_mutate`) stays in force for every role and path. The §5.1 tier transitions (identity strip at hard delete; hard delete after `anonymization_retention_days`) run through exactly one named `SECURITY DEFINER` function that the trigger recognises by session context; no other UPDATE or DELETE on `audit_logs` is possible, and the function is tested and audited as the sole exemption.`
WAS: §5.1 lines 244-251 say that at hard delete `actor_profile_id` and `target_profile_id` become NULL and rows are hard-deleted after the retention window; Appendix E line 2899 and the class rule at line ~2886 say UPDATE/DELETE are "prohibited at schema level". The 05D build (migration `20260625010000`, ruling Q6) resolved the collision by dropping the `audit_logs` FKs and leaving the trigger untouched, so ids are retained raw and no strip or purge exists.
IS: no code change in this PR. The exempted strip function is Phase 3/5 of the plan. This entry records the ruling so those phases have spec text to implement against.
Rationale: owner ruling R3 (plan v4 §4 Phase 0). An immutable audit table that any service-role statement can UPDATE is not immutable; a retention rule that no path can execute is not a rule. One gated function satisfies both documents.
Why this surfaced now: the evidence audit (Q5) found the §5.1 / Appendix E contradiction is what left the deletion path with no audit rows and no strip.
Owner action: amend §5.1 and Appendix E with the sentence above.
Build artifact: none in this PR (ruling only; Phase 3 writes the deletion actions, Phase 5 the sweep).

SCL-088 | 2026-09-16 | `anonymized_actors.anonymized_at` has no spec anchor and is a time-of-deletion signal on the pseudonymous side; it is dropped, and the migration comment that cites Doc 05E "§3.1" for the ledger is corrected | PROPOSED
Id: `SCL-088` re-derived at the moment of use, 2026-09-16 (see SCL-085; fourth of four sequential allocations this session).
Change: Doc 05E does not prescribe schema (its header says so) and mandates no ledger; nothing to amend for the column itself. The spec-facing change is a one-line note for Doc 05E §6 (after INV-05E-02): `No retained surface on the synthetic-identifier side carries a time-of-deletion signal, and no transaction writes both a synthetic-identifier-side row and a row of any identity-bearing evidence record. (Postgres exposes `xmin`; two rows written in one transaction join on it, and monotonic `xmin` orders rows across transactions, so the guarantee must be stated for time and order, not only for columns.)`
WAS: `supabase/migrations/20260625020000_05e_actor_id_substrate.sql:18` cites "05E §3.1" for the `anonymized_actors` ledger and creates `anonymized_at timestamptz NOT NULL DEFAULT now()`; the cascade (`20260903010000:414-417`) repeats the citation and writes `now()`. Doc 05E §3.1 is titled "Industry precedent" and describes Jira and JetBrains alias schemes; the strings `anonymized_actors` and `anonymized_at` appear nowhere under `docs/Spec`. The file-level tag at line 4 (§3/§5/§6/§8 step 1) is the correct citation. The only reader of the column was the cascade that writes it.
IS: migration `20260917000000_deletion_evidence_bundle.sql` drops the column, rewrites the ledger insert as `INSERT INTO public.anonymized_actors (actor_id)`, corrects the comment to cite Doc 05E §3 Rule 4 and INV-05E-01/02 with "build-derived ledger, no spec anchor", and adds `rewrite_anonymized_actors()`, run at the end of every executor pass, which reinserts the ledger ordered by `actor_id` so every row shares one `xmin` and carries no insertion order.
Rationale: the evidence audit (Q4) found the mis-citation; the plan reviews found that a deletion timestamp on the ledger joins deterministically to a dated evidence record at Lyceon's deletion volume (two prod days with two rows each), and that the transaction id joins even without the column. The column is the concrete defect; the invariant sentence is what keeps it from returning.
Why this surfaced now: Phase 1 of the 2026-09-16 brief.
Owner action: add the §6 sentence to Doc 05E (or record it as a RULING if the owner reads INV-05E-01's "derivable value" as already covering it); no other document changes.
Build artifact: `supabase/migrations/20260917000000_deletion_evidence_bundle.sql` (column drop, ledger insert, `rewrite_anonymized_actors`), `scripts/ci/genesis-schema.expected.sql` (regenerated by `scripts/ci/genesis-fresh-apply.sh`'s own pipeline), `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` (cross-universe `xmin` and rank proofs).

SCL-089 | 2026-09-16 | Doc 05E §6 INV-05E-08 says billing teardown must "block and alert on API failure rather than proceeding"; Doc 01 V8 §40.2.1 says a Stripe failure "does not mean deletion failed"; the executor follows Doc 01 at T+7 on the owner's ruling, and the two documents must be reconciled | PROPOSED
Id: `SCL-089` re-derived at the moment of use, 2026-09-16, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch) and the head branches of the open PRs (#769, #767, #728, #655). Highest allocated anywhere is `SCL-088` (this branch, PR #769). No collision. Fifth allocation of this session, after SCL-085..088.
Change: amend Doc 05E §6 INV-05E-08 so the "API-then-SQL ordering discipline" distinguishes the two API classes it names. Proposed text, replacing "these follow the API-then-SQL ordering discipline (perform API steps before the irreversible SQL disposition; block and alert on API failure rather than proceeding)": `these follow the API-then-SQL ordering discipline: perform API steps before the irreversible SQL disposition. A storage-purge failure blocks and alerts (retained objects would survive the disposition unreachable). A billing-teardown failure does NOT block: the deletion is the legally meaningful act and proceeds; the failure is recorded as `failed_manual` on the request row and, durably, in the deletion billing record, and is worked by hand (Doc 01 V8 §40.2.1 "Stripe failure does not mean deletion failed").`
WAS: Doc 05E §6 INV-05E-08 (line 92): "The end-to-end lifecycle also involves non-transactional API operations (storage purge, billing teardown) that Postgres cannot roll back; these follow the API-then-SQL ordering discipline (perform API steps before the irreversible SQL disposition; block and alert on API failure rather than proceeding)." Doc 01 V8 §40.2.1 (lines 1919-1936): "Stripe failure does not mean deletion failed — user expects account deactivated immediately … Background retry is acceptable", with `stripe_cancellation_status = 'failed_manual'` as the terminal state after retries. The two documents were written about different moments (05E about T+7 execution, 01 about request time) and only met when SCL-086 moved the Stripe call to T+7.
IS: `server/lib/account-deletion-execute.ts` (`cancelStripeBilling`): a Stripe failure at T+7 records `failed_manual` on the request row and in `deletion_billing_record.final_status`, logs `stripe_cancel_failed`, and the deletion proceeds through pre-clear, deidentify and the cascade. The storage assertion (`assertNoStorageObjects`) still blocks. Tests `server/__tests__/deletion-lifecycle.test.ts` ("a Stripe failure records failed_manual and the deletion still completes") and `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` B3.2 pin this.
Rationale: the owner brief of 2026-09-16 ("Deletion Vertical", Part B1) rules it explicitly: "A Stripe failure must not fail the deletion. Record `failed_manual` and continue — the deletion is the legally meaningful act." A person who asked for erasure and waited seven days must not be kept in the system because a payment processor was unavailable; the billing relationship is recoverable by hand from the billing record, the person's data is not recoverable once the decision to keep it past the window is made. Storage is different: an object that survives the disposition is retained personal data with no owner, so that failure still blocks.
Why this surfaced now: the spec-auditor pass on PR #769 (2026-09-16) found the divergence tested but not disclosed; CLAUDE.md requires a spec conflict to be surfaced, not worked around. This entry is that surfacing; the code follows the owner's ruling pending the amendment.
Owner action: amend Doc 05E §6 INV-05E-08 with the text above (or rule that Doc 01 §40.2.1 governs billing at every moment and INV-05E-08's parenthetical is read as storage-only); review together with SCL-086.
Build artifact: `server/lib/account-deletion-execute.ts` (`cancelStripeBilling`, never-throws contract), `deletion_billing_record.final_status` CHECK in `supabase/migrations/20260917000000_deletion_evidence_bundle.sql`.
Amended 2026-09-16, in place, still PROPOSED (owner ruling, follow-up brief on PR #769 item 1): the ruling splits by WHAT fails, not by whether failure is tolerable, and it stops being a conflict between two documents and becomes a distinction both should have drawn. Proposed INV-05E-08 text, replacing the earlier proposal above: `these follow the API-then-SQL ordering discipline: perform API steps before the irreversible SQL disposition. STORAGE PURGE BLOCKS: that data is ours, and a failure there means personal data survives under our control, which is what this invariant protects. BILLING TEARDOWN RECORDS AND PROCEEDS: the legal clock does not stop for a vendor's uptime (COPPA expects prompt deletion; GDPR allows one month), so a payment-processor failure records `failed_manual` on the request row and durably in the deletion billing record and the disposition runs. The alert requirement is not dropped — a surviving subscription is a surviving identity link — so a `failed_manual` outcome PAGES, and a retry sweep re-attempts the teardown on every later executor pass until it succeeds, resolving the record to its real outcome.` Doc 01 V8 §40.2.1's "Stripe failure does not mean deletion failed" is then the request-time and execution-time rule alike, with the page and retry as the 05E half.
Built, same PR: the page is `logger.error("DELETION", "billing_teardown_failed_manual", …)` — an error-severity structured event with a stable name for the Cloud Monitoring log-based alert policy, the same mechanism as `CRISIS_SLA sla_breach_detected` (Doc 01A §18 alert routing); the retry is `retryFailedBillingTeardowns` at the end of every pass of the existing 03:00 UTC executor cron (no new route), reading `deletion_billing_record` rows with `final_status = 'failed_manual'` (the record now keeps `stripe_subscription_item_id` for exactly this, since the entitlement row is gone) and resolving them through `public.resolve_deletion_billing_record`. A retry that still fails pages `billing_teardown_retry_failed`. Tests B3.6 / B3.7 pin both paths.

SCL-090 | 2026-09-17 | No locked document owns the do-not-contact list: the deletion flow can promise "never contact me again", the platform keeps that promise indefinitely through the email processor's own suppression list, and that promise reaches further than intended — it silences password resets too — so both the rule and its escape hatch belong in the spec rather than in a repo contract alone | PROPOSED
Id: `SCL-090` re-derived at the moment of use, 2026-09-17, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on all 13 remote refs) and the head branches of the three open PRs (#767 `calendar`, #728 `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a`, #655 `claude/batch-005-launch-gw211p`). Highest allocated anywhere is `SCL-089`. No collision.
Change: add to Doc 01 V8 §40 (account deletion lifecycle) a subsection, and a row to the §5.1 retention-tier table. Proposed §40 text: `A deletion request may ask that the address never be contacted again. Where it does, the platform honours that by adding the address to the email processor's suppression list, which the processor applies to every message the platform sends — product mail, transactional mail, and the authentication mail sent through the same processor. The platform itself retains no suppressed address and no value derived from one; what it retains is whether the request was made and whether the call to the processor succeeded, both on the existing deletion record. The completion notice is sent before the suppression takes effect, because the processor would otherwise withhold the one message confirming the deletion. Registration neither consults nor clears the list: a suppressed address may be registered again, refusing it would make the signup form disclose that the address was once deleted, and clearing it automatically would treat a new signup as consent to be contacted when the original request may have come from a guardian. Because the list also covers authentication mail, an account whose address is suppressed cannot receive a password reset; the account settings surface must therefore disclose the suppression to the account holder and let them lift it, and lifting it is recorded as affirmative re-consent.` Proposed §5.1 row: `| Do-not-contact entries (held by the email processor; the platform stores no address) | While the suppression stands | The promise has no end date; the processor's list is what makes it enforceable, and the subject may lift it from account settings |`.
WAS: `docs/Spec` contains no do-not-contact rule at all. The word "suppression" does appear in the corpus, but only in `Doc 03C — Operations Runbook V3` (§17.5, RB-V3-04) in the unrelated sense of LISA pattern suppression during a break-glass rollout; "do-not-contact" and "do not contact" appear in no locked document. Doc 01 §40 describes request, grace, recovery and hard delete, and stops. The ICO's direct-marketing and erasure guidance is what the design follows ("you should use a suppression list ... instead of just deleting their details"), and it is cited nowhere in the corpus.
IS: the executor adds the address to Resend's team suppression list (`POST /suppressions`, through `server/lib/notifications/transport.ts`, the one module that talks to Resend) immediately AFTER sending the completion notice, and only when `deletion_request_log.suppression_requested` is true. `supabase/migrations/20260917110000_deletion_suppression_outcome.sql` adds `deletion_request_log.suppression_status` (NULL / `applied` / `failed_manual`) and one `SECURITY DEFINER` writer; a failed call pages `DELETION / suppression_failed_manual` and is re-attempted by a sweep at the top of every executor pass. `server/routes/account-routes.ts` surfaces the suppression to the account holder and lifts it on request, recording `audit_logs.action = 'email_suppression_cleared'`. Nothing in the repository stores a suppressed address or a hash of one, and the notification dispatcher does not re-check the list — Resend enforces it on every send. `contracts/notifications.contract.md` §11A states the whole rule with its falsifiers.
SUPERSEDED FIRST CUT, recorded because the register should show the reversal: the original Phase 2 build held its own `public.deletion_suppression` table (log_id + HMAC-SHA256 of the address under a dedicated `SUPPRESSION_HMAC_SECRET`) and had the dispatcher compare every outgoing message against it. The owner reversed it on 2026-09-17: it duplicated a capability already paid for, the hashing protected nothing because the processor holds the plaintext regardless, and the bypass it needed for the completion notice is achieved by ordering instead. That table was never applied to production.
Rationale: a permanent, unbounded promise about a person — usually a minor — is made at deletion time and kept by a processor indefinitely, and it reaches further than "we will not market to you": it stops the platform's authentication mail as well. Under the register's own test that is "silence that must become spec text": the outcome is that the owner amends a document, not that the repo does something. The retention line is worth a §5.1 row precisely because the honest answer is "we retain nothing, our processor does" — which is a statement about a sub-processor obligation, not an absence.
Why this surfaced now: Phase 2 of the owner brief of 2026-09-17 built it, and the follow-up of the same day replaced the mechanism; both specified the behaviour and the boundaries, and no locked document records either.
Owner action: amend Doc 01 V8 §40 and the §5.1 table with the text above. The question this entry originally left open has since been ruled on — see below — so nothing further is outstanding for counsel here beyond the amendment itself.
OWNER RULING, 2026-09-17 — keep the suppression, surface it, one click to clear. The question this entry raised was what happens to a returning student: suppression persists while it stands and registration deliberately does not consult it, so someone who deletes with suppression and signs up again has a live account that receives nothing. The consequence turned out to be sharper than first described. Resend applies its suppression list to every send the team makes, including the mail Supabase Auth sends through it as SMTP, so the returning student cannot receive a PASSWORD RESET — they are locked out of account recovery, not merely missing product notifications. The ruling: do NOT clear on re-registration, because signing up again is not unambiguous consent to be contacted and the original request may have come from a parent; and do not leave anybody permanently unreachable with nothing in the product explaining it. The account settings surface discloses that email is off because of an earlier request and offers a control to turn it back on; clearing calls the processor's remove-suppression endpoint (manual-origin entries are removable via the API) and is logged as affirmative re-consent. Implemented at `server/routes/account-routes.ts` and `client/src/components/account/EmailNotificationsCard.tsx`, proved by P2.5. The three readings this entry previously listed are withdrawn.
REPORTED, NOT FIXED — the signup confirmation path. The repo's own record of the posture is `docs/SpecAudit/50-auth-entitlement/auth-rebuild-stage1-prod-runbook.md`: autoconfirm ON, Confirm-email OFF, the flip deferred to a launch-day checklist. That toggle (`mailer_autoconfirm`) lives only in the Supabase dashboard and is read-only-snapshotted by `scripts/provisioning/supabase-auth-config-snapshot.ts`, so its live value is not assertable from here; what IS assertable, read from production `auth.users` on 2026-09-17, is 114 of 117 accounts email-confirmed, 3 not (the runbook's figure of 113/116 has drifted by one account, and the brief's 112/115 by two — neither materially). On the recorded posture, a suppressed address does not block registration today. The signup handler nonetheless already passes `emailRedirectTo` and already implements the confirmation branch (`202 verification_required`, `server/routes/supabase-auth-routes.ts`). If Confirm-email is flipped ON at launch, Supabase's confirmation mail goes out through the same Resend account and would be suppressed: a returning student with a suppressed address would create an account, be told to check their email, and never receive anything — and would not be able to reach the settings surface above, because they cannot sign in to see it. That is a launch-day dependency, not a defect today, and it is reported here rather than fixed per the follow-up brief.
Build artifact: `supabase/migrations/20260917110000_deletion_suppression_outcome.sql`, `server/lib/notifications/transport.ts` (suppression add/get/remove through the one Resend module), `server/lib/account-deletion-execute.ts` (step 7 after the notice, plus the retry sweep), `server/routes/account-routes.ts` (the surface and the clear), `client/src/components/account/EmailNotificationsCard.tsx`, `contracts/notifications.contract.md` §11A (C11A.1–C11A.6), `tests/ci/deletion-phases-235.pg.ci.test.ts` (P2.1–P2.5).
SCL-090 ADDENDUM | 2026-09-17 | Guardian-initiated deletion must suppress the SUBJECT's address always, and the REQUESTER's address only if that requester holds no other live guardian link | PROPOSED
Scope: appended to SCL-090 rather than allocated a new id, because it refines the ruling already recorded there rather than raising a new question. Not yet buildable: guardian-initiated deletion does not exist (`docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1786` specifies it with `deletion_days` default 30; no route or executor path implements it).
Change: add to the proposed Doc 01 V8 §40 do-not-contact subsection: `Where a deletion is initiated by a guardian, the suppression applies to the subject's address in every case. The requester's own address is suppressed only where that requester holds no other active guardian link; a guardian who remains linked to another student must keep receiving mail about that student.`
WAS: SCL-090 as ruled speaks only of "the subject's address" and does not distinguish the requester. `deletion_request_log` carries both `subject_email` and `requester_email` (`supabase/migrations/20260917000000_deletion_evidence_bundle.sql:67-68`), so the build would have both available and no rule for the second.
IS: the executor suppresses `recipientEmail`, read from the deleted profile — the subject — and never the requester (`server/lib/account-deletion-execute.ts`, step 7). Correct today by accident of scope, since only self-initiated deletion exists.
Rationale: Resend's suppression list is account-wide and applies to every send the team makes, across all domains and both REST and SMTP (verified against the vendor SDK and docs, 2026-09-17). Suppressing a guardian who has other children would therefore stop their mail about those children — consent given about one student silently degrading service to another. This is the same class as **GAP-HY-25** (`docs/SpecAudit/10-gap-registry/gap-registry.md:365`): a per-student action reaching a per-payer or per-guardian resource must act on the student's share of that resource, never on the resource. There the resource was a shared Stripe subscription; here it is a shared mailbox.
Why this surfaced now: the retention-matrix reconciliation of 2026-09-17 re-read SCL-090 against the guardian model while cataloguing categories with no stated timeframe.
Owner action: fold the clause into the §40 amendment SCL-090 already requests, so the rule is in place before guardian-initiated deletion is built.
Build artifact: none yet — the path does not exist. Recorded ahead of the build deliberately.

SCL-091 | 2026-09-17 | Doc 06D §6.5 and Doc 06B §8.6 key the deletion-proof and privileged-op controls on a surviving `account_deletion_requests` row, which the cascade deletes; the correlation key is `deletion_request_log.log_id` | PROPOSED
Id: `SCL-091` re-derived at the moment of use, 2026-09-17, after `git fetch --all --prune`, across all 18 remote refs (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`) and the head of each of the 6 open PRs (#781 `claude/calendar-db-layer`, #778 `claude/lucid-shannon-nmjr3n`, #775 `claude/scanner-precision-fix`, #774 `questions`, #773 `claude/lisa-tutor-inventory-27lras`, #728 `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a`). Highest allocated anywhere is `SCL-090`. No collision.
Change: amend Doc 06D §6.5's Input registry row and Doc 06B §8.6's `deletion_cascade` substrate to key on the evidence bundle. Proposed 06D §6.5 text: `Input registry: deletion_verification_records + public.deletion_request_log rows where status = 'completed' and responded_on is within the past 14 days + Doc 05D D20/D21 test-result records.` Proposed 06D failure-condition text: substitute `deletion_request_log.status = 'completed'` for `account_deletion_requests.status = 'completed'` in clause (a). Proposed 06B §8.6 substrate: `expected_event_source: deletion_request_log (evidence layer)` with `correlation_key: log_id`.
WAS: Doc 06D §6.5 (`docs/Spec/Lyceon — Document 06D_ Data Protection, Backup_DR & Compliance Operations.md:211`) names as its input registry "`deletion_verification_records` + `account_deletion_requests` rows where `status = 'completed'` in past 14 days", and its failure condition (a) pages on "any `account_deletion_requests.status = 'completed'` row in the past 14 days with no matching `deletion_verification_records` row". Doc 06B §8.6 registers the `deletion_cascade` substrate with `expected_event_source: deletion_request_table (intent layer)` and `correlation_key: deletion_request_id`.
IS: the cascade deletes the request row at PS-5 — `DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id` (`supabase/migrations/20260917000000_deletion_evidence_bundle.sql:550`). A completed deletion therefore leaves NO `account_deletion_requests` row and no `deletion_request_id` to join on: the input registry is empty by construction, the failure condition can never fire, and the privileged-op reconciliation cannot detect a missing audit row. Verified in prod 2026-09-17: `account_deletion_requests` holds 0 rows while `anonymized_actors` holds 4 — four completed deletions, zero surviving request rows. `deletion_verification_records` does not exist in the 103 public tables at all.
Rationale: the evidence bundle introduced by SCL-085 exists precisely to be the surviving correlation surface. `public.deletion_request_log` carries `log_id` (PK), `status` with `'completed'` in its CHECK, and `responded_on` set at T3 by `complete_deletion_log` (`20260917000000_deletion_evidence_bundle.sql:991-993`) — it is the row that survives, dated, for 24 months. Keying the controls to it makes both provable; keying them to the intent row makes both decorative. Two locked documents currently specify a control that cannot fire.
Why this surfaced now: the retention-matrix reconciliation of 2026-09-17 traced each specified retention period to its enforcing mechanism and found Doc 06D §6.5's proving mechanism unable to observe its own subject. Gates Phase 6 of the deletion vertical (executable deletion proof), which is otherwise ready to build.
Owner action: amend Doc 06D §6.5 and Doc 06B §8.6 as above; decide separately whether `deletion_verification_records` is still the right shape for Phase 6 given that the evidence bundle now carries most of what it was to record.
Build artifact: none — read-only audit. Phase 6 is unbuilt and should consume the corrected key.
OWNER RULING, 2026-09-17 (A4) — CONFIRMED AND WIDENED, still PROPOSED. The controls re-point to `deletion_request_log.log_id`. Verified in production the same day: **0** `account_deletion_requests` rows against **4** `anonymized_actors` rows, so the row both controls key on does not merely get deleted in theory — it is already absent for every deletion that has run. Both controls are unfirable by construction today.
WIDENED: re-pointing `correlation_key` alone leaves the mechanism half-broken. Doc 06B §8.6's `deletion_cascade` substrate reads `expected_event_source: deletion_request_table (intent layer)` — the SAME deleted row under another name — so the independent-expected-event-source requirement Parent §6.13 imposes is not satisfied by fixing the key. Both fields change: `expected_event_source: deletion_request_log (intent layer, survives the cascade)` and `correlation_key: log_id`.
FULL INVENTORY of what keys on `account_deletion_requests.status` or `.id`, found by reading every occurrence in `docs/Spec` rather than only the two sections the ruling named — six places, of which five need amending:
  1. Doc 06D §6.5 Input registry — `account_deletion_requests rows where status = 'completed' in past 14 days` -> `deletion_request_log rows where status = 'completed' and responded_on within 14 days`. The date is already on the log row, which is why dropping the timestamps in SCL-100 costs nothing here.
  2. Doc 06D §6.5 Failure condition (a) — same substitution.
  3. Doc 06D §6.5 Trigger cadence — `daily aggregate reconciliation against account_deletion_requests.status` -> against `deletion_request_log.status`.
  4. Doc 06D §6.4 — the RPC "validates `p_deletion_request_id` against `account_deletion_requests`". The built RPC validates against `deletion_request_log` instead; validating against a row the cascade deletes would fail for every real deletion.
  5. Doc 06D §18 criterion A.1 — restates §6.5's failure condition verbatim and inherits the substitution.
  6. Doc 06B §8.6 `deletion_cascade` — both fields, as above.
NOT AFFECTED: Doc 02B §240 (`Account deletion | account_deletion_requests | 7-day soft-delete window`) describes the row DURING the grace window, which is when it legitimately exists. Doc 01 V8 §40's lifecycle references are likewise about the live row, not about post-deletion correlation, and stay as they are.
Build artifact for the ruling: `supabase/migrations/20260918000000_crisis_severance_and_verification.sql` builds `deletion_verification_records` keyed on `log_id` and `record_deletion_verification` validating against `deletion_request_log` — items 4 and the §6.2 substrate. The conformance job itself (§6.5) is Phase 7 and unbuilt; this entry is what it must be built against.


SCL-092 | 2026-09-17 | The Privacy Policy in `docs/Spec` states user data is deleted after 12 months of inactivity; Doc 07E §5.1 puts that trigger at V1.1+ and no mechanism exists, so publishing the draft as written would commit us to a deletion we do not perform | PROPOSED
Id: `SCL-092` re-derived with `SCL-091` in the same pass (see its derivation note); second of two sequential allocations this session.
Change: amend `docs/Spec/Lyceon Privacy Policy.md:33` to describe the retention that is actually enforced, or gate publication of the 12-month sentence on the V1.1+ inactivity job shipping. Proposed replacement for the draft sentence: `Information attributable to your specific account is retained until you delete your account. We are introducing an additional rule under which accounts inactive for 12 months are deleted automatically, with notice before deletion; until that rule is in force this Policy will not claim it.`
WAS: `docs/Spec/Lyceon Privacy Policy.md:33` — "Information attributable to your specific account is retained for 12 months from your last activity and then deleted through our cascade deletion process." Doc 10 `:497` carries the same 12-month claim, and Doc 07E §5.1 (`:205`) states the horizon as hard-locked at V1.
IS: Doc 07E §5.1 also states the trigger plainly — "at V1, user-initiated deletion only … V1.1+ adds inactivity-based trigger per §9". There is no inactivity job, no reader of a last-activity timestamp, and no 48-hour pre-deletion notification anywhere in the build (searched `server/`, `apps/`, `vercel.json` crons, `infra/terraform/`). `vercel.json` has six cron entries and none of them is an inactivity sweep. The published policy (`legal/privacy-policy/v2/en.md:155-171`) makes no numeric claim at all, so nothing is currently falsified — the exposure arrives only if the draft is published as written.
Rationale: 07E is internally consistent (a horizon declared at V1, a trigger deferred to V1.1+); the draft policy is not, because it states the horizon as present-tense behaviour. Under the amended COPPA Rule the published notice must state a timeframe, which makes the temptation to publish the aspirational number acute. A published commitment that production contradicts is worse than no policy — the brief's own words, and the reason this reconciliation was commissioned.
Why this surfaced now: the retention-matrix reconciliation of 2026-09-17 reconciled every stated period against its mechanism; this is the only case where a draft public commitment has no enforcing mechanism whatsoever.
Owner action: rule on which way to close it — ship the inactivity job before publication, or publish the narrower sentence. The report's Part 4 List 2 item 6 recommends the narrower sentence, on the grounds that 07E already defers the trigger.
Build artifact: none — read-only audit.

SCL-093 | 2026-09-17 | SCL-002's as-built ruling made 36 operator-attribution foreign keys BLOCK account deletion until an operator reassigned them; that is an indefinite hold on erasure with no terminal state and no alert, and it is reversed to severance at the column | PROPOSED
Id: `SCL-093` re-derived at the moment of use, 2026-09-17, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote ref) and the head branches of the seven open PRs (#784, #783, #782, #781, #778, #774, #728). Highest allocated anywhere is `SCL-092` (PR #783, this workstream's previous brief). No collision. First of two sequential allocations this session; SCL-094 follows.
Change: amend the SCL-002 record (and Doc 05D §10's as-built description of the cascade) to replace the preflight guard with declarative severance. Proposed text: `An operator's attribution on a governance row (`updated_by_profile_id` / `changed_by_profile_id` across the 18 `*_config` and 18 `*_config_history` tables) does NOT block that operator's own deletion. The reference is declared `ON DELETE SET NULL`: the configuration row keeps its key, its value, its `updated_at` and its history entry, and loses only the name of who last changed it. Blocking erasure until a second operator reassigns the attribution makes a person's deletion depend on another person's action, with no deadline and no alert if nobody acts.`
WAS: `SCL-002` (2026-06-25) records "operator-attribution preflight guard added (36 *_config/*_config_history operator-FK edges block deletion with PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES until reassigned)". Built as a `FOR v_op_ref IN (VALUES …36 rows…)` preflight loop at the top of `execute_account_deletion_cascade` (`supabase/migrations/20260917000000_deletion_evidence_bundle.sql:477`, carried forward from `20260625010000`), raising before any destructive step. The edges themselves were left `ON DELETE NO ACTION`, so the loop and the constraint said the same thing twice.
IS: `supabase/migrations/20260917130000_declarative_fk_delete_actions.sql` alters every such edge to `ON DELETE SET NULL` and deletes the preflight loop (-4,044 characters). It does NOT enumerate them: the bucket is read from `pg_constraint` by column name, because production carries 38 of these edges where this repo's pipeline builds 36 (`calendar_runtime_config` and `calendar_runtime_config_history` exist in prod and not here, read 2026-09-17), and a list copied from the old preflight would have left those two `NO ACTION`. The rehearsal's section (I), which asserted the block and its fail-closed behaviour, is replaced by (I) + (I2): the attribution is seeded and LEFT IN PLACE, the cascade must now succeed with it present, and the governance row must survive with a NULL attributor. `tests/ci/deletion-fk-actions.pg.ci.test.ts` FK2 pins the same behaviour on real Postgres.
Rationale: the guard was fail-closed in the right direction for data, and fail-open in the wrong direction for the person. A request that cannot complete produces no terminal state, no alert, and a nightly cron that retries forever — which is the exact defect class the 2026-09-17 brief exists to end. The governance record's value is its content and its timestamp; the attributor's NAME is the one part of it that is personal data, and it is the only part severance removes. Note that no operator in production was ever actually held by this: read 2026-09-17, the calendar config edges carry zero attributed rows, and no live deletion request has failed on this error. The hold was latent, not observed.
Why this surfaced now: the owner brief of 2026-09-17 ("Declarative FK Actions, Not an Enumerated Cascade") asked for every FK into an identity table to be classified. Classifying these 36 is what made the preflight redundant, and reading what the preflight actually does to a deletion request is what made it wrong.
Owner action: amend the SCL-002 record and Doc 05D §10 with the text above, or rule that the block should stand and this migration should be reverted. The reversal is behavioural and worth a conscious owner decision even though no live account is affected.
Build artifact: `supabase/migrations/20260917130000_declarative_fk_delete_actions.sql` (36 edges + the preflight deletion), `scripts/ci/deletion-cascade-rehearsal.sql` sections (I)/(I2), `scripts/ci/fk-delete-action-guard.sql` (G1 requires every such edge to be CASCADE, SET NULL or allowlisted), `scripts/ci/genesis-schema.expected.sql` (regenerated by `scripts/ci/genesis-fresh-apply.sh`'s own pipeline), `tests/ci/deletion-fk-actions.pg.ci.test.ts` FK2.

SCL-094 | 2026-09-17 | No locked document says what happens to a crisis-review record when the student it concerns asks to be erased; four RESTRICT foreign keys currently answer "nothing is erased", and one of them silently blocks the tutor-table deletion one level up | PROPOSED
Id: `SCL-094` re-derived at the moment of use, 2026-09-17 (see SCL-093; second of two sequential allocations this session).
Change: add to Doc 03 §21 (crisis review) a deletion subsection. The decision is the owner's; the entry states the question and the two defensible answers rather than proposing one. (a) SAFETY RECORD SURVIVES: `crisis_review_cases.student_id` is made nullable and `ON DELETE SET NULL`, `crisis_review_cases.conversation_id` becomes `ON DELETE SET NULL`, and the case keeps its severity, its timestamps, its reviewer trail and its outcome without the identity — matching how `crisis_review_cases.reviewer_id` already treats the REVIEWER (already `SET NULL`). (b) ERASURE IS COMPLETE: both edges become `ON DELETE CASCADE` and a crisis case is deleted with the student, consistent with Doc 03 §14.2's 180-day schedule for crisis conversations.
WAS: `docs/Spec` Doc 03 §21 describes the crisis queue, its SLA and its reviewer workflow, and is silent on deletion. §14.2 schedules crisis CONVERSATIONS for deletion at 180 days but says nothing about the CASE row that references one. The build answers by default: `crisis_review_cases.student_id` is `NOT NULL` + `ON DELETE RESTRICT`, `crisis_review_cases.conversation_id` is `NOT NULL` + `ON DELETE RESTRICT`, `crisis_review_audit_log.case_id` is `ON DELETE RESTRICT`, and `crisis_review_audit_log.reviewer_id` is `NOT NULL` + `ON DELETE RESTRICT`. None of the four is handled by the deletion cascade. Production, read 2026-09-17: 2 crisis cases across 2 distinct students, 0 `crisis_review_audit_log` rows.
IS: unchanged, deliberately. `supabase/migrations/20260917130000_declarative_fk_delete_actions.sql` alters 49 other edges and leaves these four exactly as they are; `scripts/ci/fk-delete-action-guard.sql` allowlists them with `handler = 'CRISIS_RULING_PENDING'`, which is the one allowlist value exempted from the "every allowlisted edge must have a handler" check — so they are visibly held, not quietly classified. A student with a crisis case cannot be hard-deleted today, and the tutor CASCADE this migration adds does not help them: `crisis_review_cases.conversation_id` RESTRICT blocks the `tutor_conversations` delete one level up, so the erasure fails at a second hop. THIS IS NOT HYPOTHETICAL. Production, read 2026-09-17: exactly 2 of 117 profiles cannot be hard-deleted, and they are the same 2 on both counts — each has tutor conversations AND a crisis case. The tutor CASCADE clears their first blocker; this ruling is what clears the second. Until it lands, those two accounts remain undeletable and the migration's benefit is prospective only.
Rationale: this is a genuine conflict between two obligations, not an oversight to be patched. A crisis record exists because somebody may have been at risk, and the reviewer trail is the evidence that the platform responded; erasing it on request erases the record of a duty of care. Equally, a minor's right to erasure is not conditional on the subject matter of their conversations, and a case row keyed to `student_id` is identity-bearing by construction. The register's own test applies: the outcome is that the owner amends a document. Option (a) preserves both — the reviewer edge already demonstrates the pattern in this very table — but it costs a nullability change on a NOT NULL column, which is a decision, not a default.
Why this surfaced now: the 2026-09-17 brief asked for every FK into `profiles`/`auth.users` to be classified and for ambiguous ones to be held. These are the ambiguous ones. The second-order blocker (conversation_id defeating the tutor CASCADE) was not visible from the constraint list alone and is the reason this cannot be deferred indefinitely: it is the one remaining edge that can make a deletion request fail after this migration lands.
Owner action: rule (a) or (b) for Doc 03 §21, then a follow-up migration alters the four edges and removes the `CRISIS_RULING_PENDING` allowlist entries. Until then the guard keeps them visible on every CI run.
SECOND SCENARIO, added 2026-09-17 after the spec-auditor pass, still PROPOSED and part of the same ruling: a crisis-FLAGGED CONVERSATION WITH NO CASE ROW. Doc 03 §14.2's retention matrix gives crisis-flagged conversations their own rule — `Crisis-flagged conversations | 180 days (extended for safety review) | Manual purge by safety review queue owner after incident closure | 180 days` — and the "Delete trigger definitions" bullet under it repeats that they are "retained 180 days from flag date … hard delete at 180 days or on closure, whichever is later". A declarative `ON DELETE CASCADE` cannot be conditional on a column, so `tutor_conversations.student_id` CASCADE deletes a flagged conversation with everybody else's. Where a `crisis_review_cases` row exists, its `conversation_id` RESTRICT blocks the delete one level up and the conversation survives — that is the first scenario above. Where the flag was written but no case row exists, nothing blocks it. That state is REACHABLE, not theoretical: `flagConversationForReview` (`server/services/tutor-crisis.ts:484-535`) writes `crisis_flagged = true` and creates the case in two separate statements rather than one transaction, so a failure between them leaves a flagged conversation with nothing referencing it. Production, read 2026-09-17: 2 flagged conversations, 2 cases, zero orphans — latent, not live. `tests/ci/deletion-fk-actions.pg.ci.test.ts` FK6 pins what the schema DOES today so the gap is visible on every CI run and reddens when a ruling changes it. The ruling needs to cover this case too: under (a) the conversation would need its own severance or a retention hold; under (b) it is correctly deleted and §14.2's row needs the account-deletion exception written into it. Separately and NOT part of this entry, the two-statement flag/case write is a `lisa`-branch defect worth closing on its own merits.
Build artifact: none — held by design. `scripts/ci/fk-delete-action-guard.sql` (the four allowlist entries and the `CRISIS_RULING_PENDING` exemption), `tests/ci/deletion-fk-actions.pg.ci.test.ts` FK5 and FK6.
OWNER RULING, 2026-09-17 (A6) — RESOLVED, still PROPOSED. Crisis review records are treated the same as mastery and activity data: the row survives, the identity link is severed. Not deleted, not kept attributable. A safety intervention should remain evidenced after the account is gone, and should not remain attributable to a person who asked to be forgotten. Option (a) of the two this entry offered, extended to the conversation edge.
FOUR EDGES, three altered:
  `crisis_review_cases.student_id`                    RESTRICT -> SET NULL
  `crisis_review_cases.conversation_id`               RESTRICT -> SET NULL
  `crisis_review_audit_log.reviewer_id`               RESTRICT -> SET NULL (admin attribution)
  `crisis_review_audit_log.case_id`                   RESTRICT -> unchanged; the case survives, so nothing may take its audit trail with it
`crisis_review_cases.reviewer_id` was already SET NULL and needed no change — the table already demonstrated the pattern on its reviewer before this ruling extended it to the student.
THE CONVERSATION EDGE IS LOAD-BEARING AND WAS NOT IN THE FIRST DRAFT OF THE RULING. `tutor_conversations` CASCADEs from `profiles` since SCL-093's migration, so deleting a flagged student cascades the conversation, which `crisis_review_cases.conversation_id` RESTRICT then blocks. Without that edge, account deletion stays broken for any student whose conversation was ever flagged — which is the two production profiles that Phase 5 could not free.
THE THREE `DROP NOT NULL`s ARE NOT COSMETIC. `ON DELETE SET NULL` on a NOT NULL column does not fail when the migration is applied; it fails at DELETE time with a not-null violation instead of a foreign-key violation. Altering the action without the nullability would have converted this defect into a different one while looking like a fix. Mutation M29 removes one of them and requires P6.1 to redden.
A FIFTH CHANGE, found while building and not in the ruling as written: `crisis_review_audit_log.conversation_id` is a DENORMALIZED uuid copy with NO foreign key (added `20260814000000`, "denormalized per SCL-025 requirement"). Nulling `crisis_review_cases.conversation_id` while that copy survives is decoration — the value comes back with one join, `SELECT conversation_id FROM crisis_review_audit_log WHERE case_id = <case>`. No declarative action can reach a column with no constraint, so it is severed by an `AFTER DELETE` trigger on `tutor_conversations`. A trigger and not a cascade step: the first cut put the UPDATE in `execute_account_deletion_cascade` and P6.2 caught it, because a plain `DELETE FROM profiles` — which the declarative FK actions now make possible — never calls the cascade. A step in one function only severs on the path that calls that function. Mutation M30 retargets the trigger to `AFTER UPDATE` and requires P6.2 to redden.
ONE CLAUSE OF THIS RULING CANNOT HOLD AS WRITTEN, reported not worked around: "grouping is retained under `actor_id`". Neither crisis table HAS an `actor_id` column. The INV-05E-03 substrate is exactly seven tables (five activity, two audit) plus `profiles` and `anonymized_actors`, and its guard asserts that count; `crisis_review_cases` and `crisis_review_audit_log` are outside it. So a severed case row is fully orphaned, not pseudonymous — it can no longer be grouped with anything. The constraint table in the ruling is implemented exactly as written; this sentence of the rationale is not, because the schema cannot satisfy it. Two ways to close it, both needing a decision: extend the substrate to the crisis tables (an 8th and 9th table, stamped in the cascade, with INV-05E-03's guard widened from seven), or amend the rationale to say the case survives unattributable and ungrouped. The second is what is built today.
Build artifact: `supabase/migrations/20260918000000_crisis_severance_and_verification.sql`, `scripts/ci/fk-delete-action-guard.sql` (the `CRISIS_RULING_PENDING` allowlist entries removed — the three edges now answer to G1 like every other edge), `tests/ci/deletion-phase-6.pg.ci.test.ts` P6.1-P6.4, mutations M28-M30.


SCL-095 | 2026-09-18 | Doc 01 V8 §5.1 retains deletion-request evidence for seven years and consent evidence for one, neither figure with a cited basis; both become 24 months with identity, then identity is STRIPPED rather than the row deleted, and a dated aggregate survives permanently | PROPOSED
Id: `SCL-095` re-derived at the moment of use, 2026-09-18, across every remote ref after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch) and the head branches of the seven open PRs (#789, #788, #787, #782, #778, #774, #728). Highest allocated anywhere is `SCL-094`. No collision. First of four sequential allocations this session (SCL-095..098), plus two more filed below.
Change: amend Doc 01 V8 §5.1 so the deletion-request and consent-evidence tiers read: `Deletion-request evidence and consent evidence are retained with identity for 24 months from the response date. At 24 months the identity is stripped — the row is not deleted — and the dated, identity-free aggregate survives permanently.`
WAS: §5.1 sets a seven-year tier for deletion-request evidence and a one-year tier for consent evidence. Neither carries a citation. The retention-matrix reconciliation of 2026-09-17 (`docs/SpecAudit/retention-matrix-reconciliation.md`) traced every stated period to a source and found no regulator naming either figure.
IS: `supabase/migrations/20260917120000_deletion_sweeps_and_config.sql` already strips rather than deletes at the configured window, and the window is a runtime config rather than a literal, so this ruling is a change of value and of spec text, not of mechanism. The strip is proved by `tests/ci/deletion-phases-235.pg.ci.test.ts` P5.1/P5.2 and by mutation M18, which turns the strip into a DELETE and requires P5.1 to redden.
Rationale (owner ruling, 2026-09-17): CCPA §7101(a) is the only period any regulator names for request records, and §7101(c) grants an explicit safe harbour for maintaining them where they are not used for another purpose. Twenty-four months sits inside that. The permanent identity-free aggregate covers the five-year federal civil-penalty window without retaining anybody's identity, which is the whole point: the platform should be able to prove its deletion process ran without keeping the people it ran on.
Why this surfaced now: the retention-matrix reconciliation asked what each stated period was FOR, and these two had no answer.
Owner action: amend Doc 01 V8 §5.1 with the text above.
Build artifact: none new — the sweep already implements strip-not-delete; this sets the number and the spec text. `server/lib/account-deletion-execute.ts` (the sweep at the top of every pass), `supabase/migrations/20260917120000_deletion_sweeps_and_config.sql`.

SCL-096 | 2026-09-18 | The evidence design was argued as a choice between per-person proof and process-level proof; both exist, and the either/or framing was wrong | PROPOSED
Id: `SCL-096` re-derived with SCL-095 in the same pass (see its derivation note); second of four sequential allocations.
Change: record as a ruling that no document need choose. Proposed note for Doc 01 V8 §5.1, beside the SCL-095 text: `Within the 24-month window a request of the form "confirm you deleted this account" is answerable per person: the deletion log retains the subject address. After the strip, what survives is process-level — that a request was made on a date, what it was, and how it was answered — with no person attached. Both levels are intended; the second is not a degraded copy of the first.`
WAS: the Phase 1 design discussion treated per-person evidence and process-level evidence as alternatives, and the register carried that framing forward into SCL-085/SCL-088.
IS: `deletion_request_log` retains `subject_email` and `requester_email` until the strip, so the per-person question is answerable by searching the address; after the strip the same row survives carrying `requested_on`, `responded_on`, `status`, `request_channel` and `denial_basis`, which is the process-level record. `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.7 proves no free text from the request row reaches the evidence side, and P5.1 proves the strip leaves the row rather than removing it.
Rationale (owner ruling, 2026-09-17): the two levels answer different questions asked by different people at different times, and the architecture already produces both. Recording the ruling stops the question being re-opened as though a trade-off were still outstanding.
Why this surfaced now: the retention-matrix reconciliation re-read the evidence bundle against the question "who could ask what, and when".
Owner action: add the note to §5.1 alongside the SCL-095 amendment.
Build artifact: none — ruling only; the behaviour it describes is built and tested.

SCL-097 | 2026-09-18 | The rank-join residual between the pseudonymous side and the evidence side is ACCEPTED, with its mitigations recorded, and is not a defect to be re-raised | PROPOSED
Id: `SCL-097` re-derived with SCL-095 in the same pass; third of four sequential allocations.
Change: record the acceptance and its boundary. Proposed addition to Doc 05E §6, after INV-05E-02: `Retained activity timestamps co-exist with a dated deletion record. This is a weak correlation reachable only with service-role SQL, not a deterministic join, and it is accepted. The deterministic joins — shared transaction id, shared insertion order, a time-of-deletion column, and request-order execution — are each closed by a named mechanism.`
WAS: at the time it was raised, executor selection had no `ORDER BY`, so execution order WAS request order, joining rank on the `actor_id` side to rank on the evidence side. That was a real deterministic join.
IS: five mitigations, all shipped and pinned by tests. (1) The executor selects `ORDER BY profile_id` — a v4 uuid destroyed with the profile — so execution order is unrelated to request order (C3.3; mutation M1 removes the ORDER BY and reddens it). (2) T3 is batched per run rather than per request. (3) `log_id` is random (`gen_random_uuid()`), not a sequence — asserted structurally by C3.1, which also refuses any `nextval` default on the evidence side. (4) `anonymized_actors.anonymized_at` was dropped entirely (SCL-088). (5) The ledger is rewritten nightly ordered by `actor_id`, so every row shares one `xmin` and carries no insertion order (C3.2; mutation M11 drops the table lock and reddens it).
Rationale (owner ruling, 2026-09-17): what remains after those five is a correlation between an activity timestamp and a request DATE, available only to an operator already holding service-role SQL — who has the plaintext anyway. Accepting it explicitly, with the mitigations on the record, is better than leaving it as an open finding that gets rediscovered and re-argued.
Why this surfaced now: closing the deletion vertical required saying which residuals are accepted rather than outstanding.
Owner action: add the §6 sentence to Doc 05E.
Build artifact: none new — the five mitigations are built. `server/lib/account-deletion-execute.ts`, `supabase/migrations/20260917000000_deletion_evidence_bundle.sql`, `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.1/C3.2/C3.3.

SCL-098 | 2026-09-18 | Doc 03B §29.2 states that FK cascade delete "respects legal hold"; no legal-hold mechanism exists anywhere in the repository or the corpus, and a declarative CASCADE is the one mechanism that cannot be made conditional | PROPOSED
Id: `SCL-098` re-derived with SCL-095 in the same pass; fourth of four sequential allocations.
Change: REMOVE the claim. Delete the third bullet of Doc 03B §29.2 (`FK cascade delete on account deletion respects legal hold: if legal_hold_active = true, deletion fails with specific error; ops resolves per V8 §39 runbook`) and the two bullets above it, or mark the whole subsection as not-yet-specified. Proposed replacement: `Legal hold is not specified at V1. Lyceon is pre-launch and under no preservation obligation. If one arises, the mechanism is ON DELETE RESTRICT plus an explicit handler that reports the hold — not CASCADE, which cannot be conditional.`
WAS: `docs/Spec/Doc 03B — LISA API and Runtime Flow.md:4067-4073` — "Per V8 §39, a student may be placed on legal hold by ops for compliance/litigation reasons. Legal hold prevents deletion … FK cascade delete on account deletion respects legal hold: if `legal_hold_active = true`, deletion fails with specific error".
IS: the string `legal_hold` appears in exactly ONE file in the entire repository — that paragraph. There is no column, no table, no register, no function, no `legal_hold_active` predicate, and no runbook. `grep -rn "legal_hold" --include=*.ts --include=*.sql .` returns nothing outside `docs/Spec`, and within `docs/Spec` it returns only Doc 03B.
Rationale (owner ruling, 2026-09-17): a spec that promises a control which does not exist is worse than silence — it is the shape of thing an auditor relies on and a reader assumes is covered. Two facts make removal rather than implementation the right call now: Lyceon is pre-launch with no pending litigation, and `tutor_conversations.student_id` is now `ON DELETE CASCADE`, which is precisely the mechanism that CANNOT consult a predicate before firing. The clause is not merely unimplemented; as written it is structurally unimplementable in the current design.
Why this surfaced now: the spec-auditor pass on PR #786 raised it against the declarative-FK change, and the Phase 6 reading of §29 confirmed no mechanism exists.
Owner action: remove or rewrite Doc 03B §29.2 as above. Revisit only on a real preservation obligation, at which point the edge becomes RESTRICT with a handler.
Build artifact: none — removal of a claim, not of code. There is no code.

SCL-099 | 2026-09-18 | Doc 03B §29's citations into Doc 01 are systematically misnumbered: §29.2 cites "V8 §39" for legal hold when §39 is the guardian deviation box, and §29.3 cites "V8 §41" for data export when §41 is the account-deletion deviation box | PROPOSED
Id: `SCL-099` re-derived in the same pass as SCL-095..098, 2026-09-18; fifth allocation of this session.
Change: renumber Doc 03B §29's cross-references to Doc 01 V8, or state which Doc 01 version §29 was written against. This entry records the defect; it does not propose the corrected numbers, because establishing what §29 MEANT to cite is a separate reading of both documents.
WAS: `Doc 03B §29.2:4067` — "Per V8 §39, a student may be placed on legal hold". `Doc 03B §29.3:4075` — "Data export (V8 §41)". In `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md`, `§39` is titled **"Guardian deviation box"** (line 1828) and `§41` is titled **"Account deletion deviation box"** (line 2014). Neither concerns legal hold or data export. §40 is "Account deletion lifecycle".
IS: unchanged — reported, not fixed, per the owner ruling on A5.
Rationale (owner ruling, 2026-09-17): two adjacent citations both landing on deviation boxes is a pattern, not a typo — §29 reads as though written against a different Doc 01 numbering. A wrong citation is worse than a missing one: it sends a reader to a real section that says something else, and it makes a claim look sourced. SCL-098 removes one of the claims; the citation defect underneath it survives that removal and would otherwise be rediscovered.
Why this surfaced now: verifying SCL-098's claim required opening the cited section, which turned out to be about something else.
Owner action: decide which Doc 01 version Doc 03B §29 was written against and renumber, or annotate §29 with the version it cites. Separate from SCL-098 and not blocked by it.
Build artifact: none — documentation defect.

SCL-100 | 2026-09-18 | Doc 06D §6.2's `deletion_verification_records` DDL violates the evidence-side structural rule in three of its seven columns, and §6 names a "signed manifest artifact" whose content, format, store and signing key are defined nowhere | PROPOSED
Id: `SCL-100` re-derived in the same pass as SCL-095..099, 2026-09-18; sixth and final allocation of this session.
Change: amend Doc 06D §6.2 to the built shape, and define the manifest as the record. Proposed §6.2 DDL: `CREATE TABLE deletion_verification_records ( log_id uuid PRIMARY KEY REFERENCES deletion_request_log(log_id) ON DELETE CASCADE, verification_outcome text NOT NULL CHECK (verification_outcome IN ('pass','fail')), layers_verified jsonb NOT NULL, proof_manifest_ref text NOT NULL, deleted_profile_id uuid );` Proposed §6.2 note: `The record IS the manifest. proof_manifest_ref is a SHA-256 over its canonical form, which gives tamper-evidence without a signing key and satisfies §8.7 by construction, because the record carries no PII.` Proposed §6.5 change: strike failure condition (c).
WAS: §6.2 declares `id uuid PRIMARY KEY`, `verification_started_at timestamptz NOT NULL`, `verification_completed_at timestamptz`, `deletion_request_id text` referencing `account_deletion_requests.id`, and a three-value outcome enum including `in_progress`. §6.5(c) pages on an `in_progress` row older than one hour. §6.2 describes `proof_manifest_ref` as the "path/hash of signed manifest artifact"; §3.1 and §4.2 call it a "signed deletion-proof manifest"; §8.7 governs what a proof artifact may contain. No section defines the manifest's schema, format, storage or signing mechanism.
IS: `supabase/migrations/20260918000000_crisis_severance_and_verification.sql` builds the amended shape. THREE conflicts resolved in favour of the evidence-side rule, which is the stricter and the load-bearing one: (1) `id uuid` — the structural rule permits no uuid but the random `log_id`, and §6.2's own key is redundant once `log_id` is the key; (2) the two `timestamptz` columns — a time-of-deletion signal on the evidence side is exactly what SCL-088 removed from the ledger; (3) `deletion_request_id` — re-pointed to `log_id` per SCL-091 as ruled. `in_progress` is dropped because verification runs inside T3, in one transaction, so a row is never observable mid-flight and §6.5(c)'s stuck state cannot occur. That is elimination of a HAZARD, not of an ALARM — the distinction matters because SCL-091 as ruled is about controls that are blind to failures which CAN still happen; this is the opposite case and the two must not be confused.
ONE CARVE-OUT, PROVEN NOT ASSERTED: `deleted_profile_id` is a uuid on the evidence side, kept so the conformance job can re-scan for it and confirm absence — the difference between recording a pass and being able to re-derive one, which is what "executable proof" means in INV-06-08. It is sound only if no RETAINED row still carries that uuid. `tests/ci/deletion-phase-6.pg.ci.test.ts` P6.6 sweeps every uuid column in the public schema after a real deletion and requires the verification record to be the only hit; mutation M32 stops `apply_audit_logs_retention('strip_identity', …)` nulling `target_profile_id` and reddens it.
`proof_manifest_ref` is NOT NULL here where §6.2 requires it only for a pass: a failed verification is evidence too, and evidence that cannot be shown to be unaltered is not evidence.
Rationale (owner ruling, 2026-09-17, B2 and B3): "signed" is unimplementable without a key or a store the platform does not have, and inventing both would be spec authorship wearing an implementation hat. `layers_verified` already carries what §4.2 asks the manifest to cover, so a content hash over the record gives the property the manifest was for.
Why this surfaced now: Phase 6 built §6.2 for the first time; the DDL could not be implemented literally without breaking the structural rule the evidence bundle rests on.
Owner action: amend Doc 06D §6.2 and §6.5 as above.
Build artifact: `supabase/migrations/20260918000000_crisis_severance_and_verification.sql` (table + `record_deletion_verification`), `tests/ci/deletion-phase-6.pg.ci.test.ts` P6.5/P6.6, `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.1 (structural test extended with the single named carve-out), mutations M31/M32.


SCL-101 | 2026-09-21 | The published Privacy Policy stated no retention period for any category; v3 publishes eleven, of which four have an enforcing mechanism, one is a build commitment with no mechanism, and three claims the draft makes were deliberately not published because nothing performs them | PROPOSED
Id: `SCL-101` re-derived at the moment of use, 2026-09-21, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref>` across EVERY remote ref (not only `docs/SpecAudit/SPEC_CHANGES_LOG.md` — the wider scan returns the same maximum) and against the head branches of the four open PRs (#790 `calendar`, #787 `cleanup`, #778 `claude/lucid-shannon-nmjr3n`, #728 `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a`), all of which are remote branches already covered by that scan. Highest allocated anywhere is `SCL-100`. No collision. Single allocation this session. The number in the commissioning brief was not consulted.
Change: amend `docs/Spec/Lyceon Privacy Policy.md` §9 (and its §9.7 summary table) to the eleven periods now published at `legal/privacy-policy/v3/en.md` §6, reproduced below. The published document is the one users are shown and the one the acceptance ledger records consent against; the draft is the one that has drifted.

THE ELEVEN PERIODS AS PUBLISHED, each with the mechanism that enforces it or the absence of one.
  1. In-app notifications — 90 days. ENFORCED. `public.notification_retention_days()` returns a literal 90 (`supabase/migrations/20260915100000_notification_retention_sweep_and_feed_archive.sql:37-45`) and `sweep_notification_retention` reads it; scheduled `0 5 * * *` by `vercel.json`. One definition, and the sweep reads it.
  2. Deletion grace window — 7 days. ENFORCED. The soft-delete window and the `execute-deletions` cron at `0 2 * * *`.
  3. Deletion-request evidence with the email address — 24 months, then the identity is STRIPPED and the dated outcome survives. ENFORCED. `public.deletion_evidence_retention_months()` returns 24 (`20260917120000_deletion_sweeps_and_config.sql:77-85`); the strip nulls `subject_email`/`requester_email` rather than deleting the row. Per SCL-085 and SCL-095.
  4. Parent or guardian consent record — 3 years. NOT ENFORCED BY ANY MECHANISM IN THIS REPO. No config key, no function, no sweep names a consent-evidence period; the only retention constants in the schema are the four in this list. The period is a commitment, and it is the SECOND of the two consent clocks (see below).
  5. Payment records — 7 years. NOT ENFORCED BY LYCEON. These live in Stripe and are governed by Stripe's retention, which is what the draft §9.6 already says ("governed by Stripe's retention practices"). Published as a period because a user asking "how long do you keep my payment data" deserves a number, not a pointer to a vendor.
  6. Do-not-contact list — held until the user revokes it. ENFORCED. The Resend suppression call ordered after the completion notice (SCL-090); it is the only way the request can be honoured, which is why it is the one entry with no expiry.
  7. Billing Terms consent — no less than 3 years from the date of consent, or 1 year after the subscription ends, whichever is longer. NOT ENFORCED BY ANY MECHANISM. FIRST of the two consent clocks.
  8. Security, sign-in and administrative records — 365 days, with the identity removed IMMEDIATELY on account deletion and the record itself surviving the rest of the window. ENFORCED. `public.audit_logs_retention_days()` returns the `anonymization_retention_days` config value and defaults to 365 (`20260917100000_deletion_audit_actions.sql:104-128`); `apply_audit_logs_retention('strip_identity', …)` performs the immediate severance.
  9. Configuration records — 7 years. NOT ENFORCED. No sweep touches `*_config_history`. Published because these rows survive account deletion with their attribution severed (SCL-093) and a reader is entitled to know they persist; the 7 years is a commitment, not an observed behaviour.
 10. Analytics — 12 months. NOT ENFORCED BY LYCEON. Vercel Analytics retention is a vendor dashboard setting. Nothing in this repo reads or asserts it.
 11. De-identified analytics — up to 24 months, then aggregate only. NOT ENFORCED. Same vendor caveat, plus the BigQuery archive (`lyceon_analytics_archive_prod`) carries NO partition expiration by deliberate decision (Doc 07B §5.1, `infra/terraform/bigquery.tf:26-30` — "retention is 'forever' for the pseudonymized 13+ class"). The published "then only in aggregate" and the dataset's "no expiry" are not the same statement, and closing that is the single largest build commitment this policy creates.
THE 90-DAY CATCH-ALL IS A BUILD COMMITMENT, NOT A DESCRIPTION. §6.7 as published reads "Where we keep operational records that include information about you and are not listed above, we keep them for no more than 90 days." NOTHING ENFORCES IT. There is no residual sweep, no inventory of what falls under "not listed above", and no gate that would notice a new table accumulating identity-bearing rows outside the ten categories. It was published anyway, on the owner's instruction, because the alternative — a policy silent on everything unenumerated — is the state v2 was in and is worse. It is recorded here as a commitment so it is not later mistaken for an as-built claim. Closing it needs (a) an enumeration of identity-bearing tables outside the ten categories and (b) a sweep, in that order; (a) alone is worth doing first, because it may turn out the set is empty, in which case the sentence is already true.
THE TWO CONSENT CLOCKS ARE SEPARATE AND RUN IN OPPOSITE DIRECTIONS, which is why §6.3 exists as its own subsection rather than as a line in §6.2. Deletion-request and parent/guardian consent evidence is STRIPPED at 24 months (item 3; SCL-095's ruling replaced Doc 01 V8 §5.1's uncited seven-year and one-year tiers with a single 24-month strip). Billing Terms consent is HELD for at least three years from consent, or one year past the subscription's end, whichever is longer (item 7) — a period that can exceed 24 months and has a floor tied to the subscription, not to the request. A single "consent evidence" line would have had to pick one, and picking either would make the policy false about the other. `legal/privacy-policy/v3/en.md:41` already cross-references "Section 6.3" for the billing-terms record, which is why §6.3 kept that number through the rewrite; a renumbering that orphans it is caught by `tests/ci/retention-policy-publication.contract.test.ts`.
THREE CLAIMS THE DRAFT MAKES AND v3 DELIBERATELY DOES NOT, each because no mechanism performs them. Do not reinstate any of them without the mechanism landing first.
  (i) 12-MONTH INACTIVITY DELETION. `docs/Spec/Lyceon Privacy Policy.md:33`, `:253`, §9.2 (`:460`) and three rows of the §9.7 table state that account-attributable data is deleted after 12 months of inactivity. There is no inactivity job, no reader of a last-activity timestamp, and no pre-deletion notice anywhere in the build; `vercel.json` has six cron entries and none is an inactivity sweep. Doc 07E §5.1 itself defers the trigger to V1.1+. Already filed as SCL-092 (PROPOSED, unresolved); this entry does not duplicate that ruling, it records that v3 shipped without the claim while SCL-092 remains open.
  (ii) A FOUR-TIER AUDIT RETENTION SCHEDULE. Doc 01 V8 §5.1 sets 90 / 365 / 7-year / permanent tiers by audit category. The build has ONE audit window — `audit_logs_retention_days()`, default 365 — applied uniformly. v3 publishes 365 days because that is what runs.
  (iii) AN `audit_logs_archive` COLD TIER. Referenced in the spec corpus; the table does not exist. v3 makes no claim that expired security records move anywhere.
DIVERGENCE BETWEEN THE PUBLISHED POLICY AND THE `docs/Spec` DRAFT — REPORTED, NOT RECONCILED, per the commissioning brief. Six, beyond the three above:
  (a) LISA CONVERSATION RETENTION. Draft §9.7 states conversation content is kept for "seven (7) days after the conversation is closed, abandoned, or your entitlement to access LISA is lost". v3 §6.1 says instead: "Tutor conversations are kept while your account is open, and are deleted when your account is deleted." The narrower wording is forced by the finding below on `deleted_at` and is the one place this PR's text departs from the wording the brief approved.
  (b) ANONYMIZED LEARNING RECORDS. Draft §9.5/§9.7 claim indefinite retention of anonymized structured learning data for AI training. v3 §6.2 states that learning activity is anonymized and states no horizon for the anonymized remainder. Neither is wrong; they are different disclosures, and the draft's is the broader claim.
  (c) FLAGGED-CONVERSATION CARVE-OUT. Draft §9.7 keeps safety-flagged conversation content "up to ninety (90) days after resolution". v3 is silent on it. Doc 03 §14.2 says 180 days. Three numbers, three documents.
  (d) A CITED "COOKIE POLICY" THAT DOES NOT EXIST. Draft §9.7 and §8 (`:399`) point readers to a Cookie Policy for "cookie categories, vendors, retention periods, and opt-out mechanisms". `legal/` has nine slugs and none is `cookie-policy`. The legal cross-reference gate scans `legal/` only, so a draft citing a non-existent document is not caught by it.
  (e) A CITED "CHILDREN'S ONLINE PRIVACY NOTICE" THAT DOES NOT EXIST. Draft §9.4 refers readers to it. Same nine slugs; it is not one of them.
  (f) A COOKIE CONSENT BANNER THE DRAFT DESCRIBES AS PRESENT. Draft `:399`: "The Service displays a cookie consent banner that allows you to accept or refuse non-essential cookies". There is no banner in `client/src`. v3 §9 makes no such claim; it says cookies are controlled through browser settings, which is true.
Rationale: v2 published no retention period for any category while the spec corpus carried at least four mutually inconsistent sets of them. The exposure of publishing eleven numbers is that five of them are commitments rather than descriptions; the exposure of publishing none is that the platform's actual practice is undisclosed, which is the condition the amended COPPA Rule specifically addresses. The first exposure is bounded and written down here. The second is not.
Why this surfaced now: the retention-matrix reconciliation of 2026-09-17 (`docs/SpecAudit/retention-matrix-reconciliation.md`) traced every stated period to its mechanism. Publishing was the next step, and publishing is what forced each number to be either enforced or named as a commitment.
Owner action: rule on the §9 amendment above; separately, rule whether (d), (e) and (f) are documents and features to be built or citations to be struck. They are cheap to strike and expensive to leave, because each one is a published promise of a document a regulator can ask to see.
Build artifact: `legal/privacy-policy/v3/` (`en.md` + `meta.yml`), `legal/privacy-policy/manifest.json` (`current` -> `v3`), `server/lib/legal-registry.generated.ts` (regenerated), `tests/ci/retention-policy-publication.contract.test.ts` suite A.
AMENDED 2026-09-22 — ITEMS (ii) AND (iii) NOW HAVE A SECOND HOME, AND IT IS A CONFIG TABLE. The owner ruling "F2 — seed `observability_runtime_config` from the published policy. Same rule. Note that nothing reads the table yet" was implemented, and doing so put both findings in front of Doc 01A App A.5, which this entry had not previously examined.
A.5 declares five keys, three of them Legal-owned. `audit_retention_by_category` is pointed at Doc 01 V8 §5.1 — item (ii)'s four tiers. `cold_log_retention_days` carries a launch value of 365 and is described as "cold archive retention before purge" — item (iii)'s tier that does not exist. So the two claims v3 declined to publish are also the two that A.5 would have had the build declare in a table, which is where a period that nothing enforces is hardest to see: `observability_runtime_config` is read by NO code in this repo, a fact the ruling states and the migration records on the table itself.
WHAT WAS SEEDED, AND WHY ONLY THAT. `audit_retention_by_category` holds ONE category, `security_and_administrative`, because v4 §6.5 publishes one period for that whole class and `audit_logs_retention_days()` enforces one window. `hot_log_retention_days` holds v4 §6.7's ceiling, enforced by `sweep_operational_log_retention`. `cold_log_retention_days` is NOT seeded — declaring an archive tier that does not exist is exactly what the BigQuery archive was, removed by SCL-106 the same day. `alert_thresholds` is NOT seeded: it needs `infra/alert-registry.yaml`, which SCL-107 names as a prerequisite and INV-07-09 constrains. `log_level_default` is not a retention period and is outside the ruling's scope.
NEITHER SEEDED VALUE IS TYPED. Each is `to_jsonb(<the function that enforces it>)`, so the period is still defined exactly once and the row is a projection. `tests/ci/observability-retention-config.pg.ci.test.ts` asserts declared == enforced (F2.2, F2.3), asserts the derivation itself on the migration source (F2.8, because a literal 365 is correct today and would pass the comparisons until the config behind the function moved), and asserts the two absences (F2.4, F2.5). Mutations M75-M81 prove each one reddens.
This amendment asks for nothing new. It records that (ii) and (iii) reach further than the published policy — into Doc 01A A.5 — and that the build has answered both the same way in both places: publish and seed what runs, and leave what does not run visibly empty.


SCL-101 ADDENDUM — TWO FINDINGS REPORTED UNDER THE SAME BRIEF, NOT SEPARATE RULINGS
FINDING 1 — NOTHING SETS `tutor_conversations.deleted_at`, SO THE 7-DAY TUTOR SWEEP HAS A PERMANENTLY EMPTY INPUT. `server/services/retention-sweep.ts:113` documents the column as "set when entitlement lapses". That writer does not exist. Every write to the table in the codebase is: `server/services/tutor-crisis.ts:501` (`crisis_flagged`), `server/services/tutor-runtime.ts:1380` (`updated_at`), `server/services/tutor-runtime.ts:1761` (`status`, `closed_at`), and `server/services/retention-sweep.ts:140` (the hard `.delete()` this sweep performs). Every `SET deleted_at` in SQL is on `public.profiles`. `sweep7d` filters `deleted_at IS NOT NULL AND deleted_at < now() - 7 days`, so it matches zero rows today and will match zero rows until something soft-deletes a conversation. CONSEQUENCE FOR THE PUBLISHED TEXT: the approved wording said tutor conversations are deleted seven days after the conversation closes or entitlement lapses. Publishing that would have been a false statement about a mechanism with no trigger. v3 publishes the narrower true statement instead — kept while the account is open, deleted when the account is deleted — which IS enforced, by the `tutor_conversations.student_id` CASCADE that SCL-093's migration created. The broader claim becomes publishable the day an entitlement-lapse writer lands, and not before. This is a report, not a fix, per the brief.
FINDING 2 — THE RETENTION SWEEP ROUTE HAD NO CALLER FOR THIRTEEN MONTHS OF ITS EXISTENCE. `server/routes/internal-retention-routes.ts` (2026-08-20) carries the comment "Called by Cloud Scheduler (one job per retention tier)". No Cloud Scheduler job existed: `infra/terraform/` had zero scheduler resources and the Cloud Scheduler API was not enabled. `vercel.json` schedules six sibling sweeps and cannot schedule this one, because Vercel Cron issues an unauthenticated GET and this route is a POST behind `oidcAuthMiddlewareWithConfigGuard`. `infra/terraform/cloud-scheduler.tf` provisions the caller. Authorisation is not IAM: the target is Vercel over public HTTPS, so there is no `run.invoker` binding to grant. It is the two claims the middleware checks — `aud` against `RETENTION_SWEEP_OIDC_AUDIENCE` and `email` against `CLOUD_TASKS_SERVICE_ACCOUNT`. Because that second env var holds exactly one address, the job MUST sign as the existing `lisa-cloud-tasks` service account; a dedicated per-schedule identity would buy a nightly 401, not isolation. THE OTHER THREE TIERS ARE STILL UNSCHEDULED AND THIS IS A REAL GAP: 90d and 180d need `BIGQUERY_ARCHIVE_DATASET`, which appears in no output, no README row and no deployment note, so they would return `ok:false, reason:"archive_client_not_configured"` every night; 365d returns `ok:false, reason:"365d_tables_not_provisioned"` unconditionally because the tables do not exist. Scheduling a job that cannot do its work is worse than not scheduling it, so they are named here rather than provisioned.
Build artifact: `infra/terraform/cloud-scheduler.tf`, `infra/terraform/variables.tf` (`app_base_url`), `infra/terraform/outputs.tf` (`retention_sweep_oidc_audience`), `infra/terraform/README.md` (resource table, plan counts 5 -> 7, env-var row), `tests/ci/retention-policy-publication.contract.test.ts` suite C.


SCL-102 | 2026-09-21 | Doc 03B §29.2 specifies LISA's integration with a legal-hold mechanism that exists nowhere in the locked corpus outside 03B itself; the cite resolves to the guardian deviation box, and the concept was deliberately removed rather than mis-numbered | PROPOSED
Id: `SCL-102` re-derived at the moment of use, 2026-09-21, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref>` across EVERY remote ref and against the head branches of all nine open PRs (#801, #800, #799, #798, #797, #790, #787, #778, #728), each already covered by that scan. Highest allocated anywhere is `SCL-101`. No collision. First of three sequential allocations this session; SCL-103 and SCL-104 follow.
Change: strike Doc 03B §29.2 in its entirety, and strike "and V8 §39 legal hold" from the §29 lede (`Doc 03B — LISA API and Runtime Flow.md:4043`). Do NOT renumber the cite: there is nothing to renumber it to.
WAS: `Doc 03B — LISA API and Runtime Flow.md:4065-4073` §29.2 "Legal hold" states three things, each citing `V8 §39`: (a) "a student may be placed on legal hold by ops for compliance/litigation reasons. Legal hold prevents deletion"; (b) "Deletion of any tutor-scoped row is blocked by V8 §39 `legal_hold_active(student_id)` check"; (c) "if `legal_hold_active = true`, deletion fails with specific error; ops resolves per V8 §39 runbook".
IS: `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1828` §39 is `Guardian deviation box` — a current-state deviation note closing Part VI (Guardian Trust & Consent), about `guardian_links`, `guardian_link_audit`, `guardian_consent_requests` and `profiles.guardian_profile_id`. Zero relation to legal hold.
NO CORRECT TARGET EXISTS, AND THIS IS NOT A NUMBERING SLIP. A case-insensitive search for `legal.hold`, `legal_hold` and `litigation` across Doc 01 returns ZERO hits. Corpus-wide, `legal.hold` hits ONLY inside Doc 03B (lines 4039, 4041, 4043, 4065, 4067, 4071, 4072, 4073, 4091, 4211). Three pieces of negative evidence make the absence structural rather than editorial:
  1. `account_deletion_requests` (Doc 01 Appendix B.6, `:2489`) has no `legal_hold` column and its status CHECK is `('pending','cancelled','completed')`. The schema cannot represent the state §29.2 assumes.
  2. §40.5 (hard delete at T+7) describes an unconditional cron-driven `deidentify_user(profile_id)` that consults no hold. The deletion driver as specified cannot honour one.
  3. Doc 06D's dependency header carries `V8 §40.5 / §5.1 / §44 / Appendix E` as bounded forward-reference FWD-06-02. Legal hold is not in that list, which independently confirms it was never spec'd into Doc 01 V8.
The nearest adjacent text is Doc 01 §44 Support-mediated operations (header `:2093`, bullet `:2106`) "Account deletion force-through (e.g., legal demand)" — the OPPOSITE operation, an admin forcing a deletion through on legal demand rather than ops preventing one. Citing it would invert the meaning.
Rationale: the owner brief of 2026-09-21 places legal hold out of scope — "Deliberately removed from the spec. Nothing to build until Lyceon faces a preservation obligation." That ruling makes §29.2 not merely mis-cited but obsolete: it specifies LISA's integration with a mechanism the platform has decided not to have. A feature document that describes downstream behaviour for a non-existent upstream is worse than silence, because a reader cannot tell the difference between "unimplemented" and "not real". Striking it is the honest close; renumbering would manufacture a target.
Why this surfaced now: the 2026-09-21 brief asked for the §29 citations to be corrected. Reading what the cites actually point at is what revealed that two of the three claims have no referent at all.
Owner action: strike §29.2 and the lede clause. If a preservation obligation ever arrives, legal hold is authored in Doc 01 first and 03B's integration section is written against it — in that order, which is the order this entry preserves.
Build artifact: none — read-only audit. `docs/Spec` is canonical and was not edited.

SCL-103 | 2026-09-21 | Doc 03B §29.3 makes LISA a contributing producer to a Doc 01-orchestrated data-subject export flow that Doc 01 does not contain; the cite resolves to the account-deletion deviation box, and Doc 03 Main still marks the same dependency as pending | PROPOSED
Id: `SCL-103` re-derived in the same pass as SCL-102, 2026-09-21; second of three sequential allocations this session.
Change: replace Doc 03B §29.3's cite with an explicit pending marker rather than a section number, matching how Doc 03 Main already handles the same dependency. Proposed §29.3 lede: `Data export (Doc 01 data-subject-rights implementation — PENDING, no section exists as of Doc 01 V8.0). When a student export flow is specified, 03B contributes: ...` — keeping the contributor list, which is sound and is the part 03B actually owns.
WAS: `Doc 03B — LISA API and Runtime Flow.md:4075-4082` §29.3 is headed "Data export (V8 §41)" and opens "When a student requests data export per V8 §41: V8 orchestrates the export; 03B contributes: conversations + messages (full text), question links, memory summaries, exposures, injection log ...".
IS: `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:2014` §41 is `Account deletion deviation box` — a current-state deviation note closing Part VII (Account Deletion). Zero relation to data export.
NO CORRECT TARGET EXISTS. Searching Doc 01 for `data export`, `export request`, `dsar`, `portability`, `gdpr` and `ccpa` returns three hits, none a data-export section:
  - `:244` `### **GDPR / data deletion interaction**` — a §5.1 subsection about audit-log anonymization AFTER hard delete, not export.
  - `:259` "Users: can request export of their own audit logs (GDPR Article 15 right of access) via support escalation" — the only export-shaped sentence in Doc 01. Scoped to `audit_logs` only, mechanism is manual support escalation, and it contemplates no feature-doc contributors. It cannot support "V8 orchestrates the export" with 03B contributing conversations and memory summaries. Its home section is §5.1 `Audit log retention and PII boundaries`, which would be a WORSE cite than §41: it would imply LISA conversation content is audit-log data.
  - `:2899` Appendix E ownership-matrix row for `audit_logs` reading `Admin panel; user GDPR export flow (via support)` — a read-access annotation, not a spec.
Doc 01 V8 ends at §48; there is no §49+ to absorb it. A new section and almost certainly a new Part would have to be authored.
THE PARENT DOCUMENT ALREADY SAYS SO, WHICH IS WHAT MAKES THIS A REGRESSION RATHER THAN A GAP. `Doc 03 — LISA (AI Tutor System).md:1272-1274` specifies student data export "per Doc 01 V6.1 (pending) data subject rights implementation", and `:1286` marks it `[BUSINESS TARGET — Pending Legal Implementation]`. Doc 03B §29.3 silently upgraded that honest pending forward-reference into a hard `V8 §41` cite pointing at an unrelated deviation box. The information was not missing when §29.3 was written; it was discarded.
Rationale: the contributor list in §29.3 is the useful part and is 03B's to own — it says what LISA would hand to an export, including the exclusions (caches and internal observability are not user data). That survives. What must go is the claim that an orchestrator exists. Keeping the pending marker rather than a section number means the next author cannot mistake absence for a broken link.
Why this surfaced now: as SCL-102.
Owner action: amend §29.3's lede as above, or author the data-subject-rights section in Doc 01 and cite it properly. The second is the real fix; the first stops the document lying in the meantime.
Build artifact: none — read-only audit.

SCL-104 | 2026-09-21 | Doc 03B §29.4 cites Doc 01 V8 §42 for a backup retention policy; §42 is the interfaces table, and backup retention is owned by a different document entirely | PROPOSED
Id: `SCL-104` re-derived in the same pass as SCL-102, 2026-09-21; third and final allocation of this session.
NOT IN THE COMMISSIONING BRIEF. The 2026-09-21 brief names §29.2 and §29.3. §29.4 was found while resolving those two and is the same defect class, so it is filed rather than left for the next reader to rediscover.
Change: re-point Doc 03B §29.4's cite from `V8 §42` to Doc 06D §7 (Backup Substrate & RPO/RTO Targets) and Doc 06D §9 (Retention Policy Registry & Enforcement), with backup infrastructure topology at Doc 06A §15. Then RECONCILE the numbers: §29.4's "30 days" is 03B's own assertion and must match whatever 06D §7 states, or be struck.
WAS: `Doc 03B — LISA API and Runtime Flow.md:4084-4091` §29.4 "Backup purge policy" opens "Per V8 §42 backup retention:" and asserts Postgres full backups retained 30 days, account deletion purging backups on the same 30-day cycle, a 30-day maximum window where deleted student data could still exist in backups, and "Legal hold extends backup retention indefinitely for relevant rows".
IS: `Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:2022` §42 is `Interfaces provided by V8` — a table of canonical interfaces consumed by other docs (`EntitlementService.*`, `supabaseAuthMiddleware`, role helpers, `profile-service.ts`, guardian linking, soft-delete status check, `auditLog.emit`). No backup, retention or purge content. Searching Doc 01 for `backup` returns only mobile and TLS material: `android:allowBackup="false"` (`:377`) and certificate backup pins (`:520`, `:542`, `:545`, `:547`, `:549`, `:2351`, `:2433`, `:2865`). Zero hits for backup retention, PITR or restore.
THIS ONE DIFFERS FROM SCL-102 AND SCL-103: a correct target DOES exist, in another document. `Lyceon — Document 06D_ Data Protection, Backup_DR & Compliance Operations.md:218` is `§7 — Backup Substrate & RPO/RTO Targets` and `:402` is `§9 — Retention Policy Registry & Enforcement`. So this is a cross-document mis-cite, not a reference to unwritten spec, and it is the cheapest of the three to close.
ONE CLAUSE CANNOT BE RE-POINTED AND MUST BE STRUCK: "Legal hold extends backup retention indefinitely for relevant rows" depends on the same non-existent mechanism as SCL-102. Re-pointing §29.4 at 06D without striking that sentence would leave a live reference to a concept the owner has ruled out of scope.
Rationale: the three bad cites share a root cause visible in the numbering. Doc 01's §39 and §41 are the deviation boxes BRACKETING §40, and §40 is the one cite in §29 that is correct. §29 is labelled a V3-era hardening item (`Doc 03B:4039`, Part XIX "(hardening item)"), and `Doc 03B:4211` lists "legal hold integration" among patterns "expected to apply back to V8, 01A, and 03A in the consolidated hardening pass". §29 was written against an ASSUMED Doc 01 §39/§41/§42 that the retrofit never delivered — consistent with someone numbering forward from §40 rather than reading Doc 01.
Why this surfaced now: as SCL-102. The brief asked for two citations; reading §29 as a whole found the third.
Owner action: re-point §29.4 to Doc 06D §7/§9 and Doc 06A §15, strike the legal-hold clause, and reconcile the 30-day figure against 06D §7's actual numbers rather than leaving 03B as a second place where a backup window is written down.
Build artifact: none — read-only audit.


SCL-105 | 2026-09-22 | Privacy Policy v3 §6.5 publishes a seven-year period for configuration records, but nineteen of the twenty tables holding them are APPEND-ONLY by a Doc 01A §5 invariant enforced by trigger; the published period cannot be enforced without weakening a tamper-evidence property, and the owner ruling that asked for the sweep was given without that fact | PROPOSED
Id: `SCL-105` re-derived at the moment of use, 2026-09-22, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref>` across all 32 remote refs, which covers every open PR head branch. Highest allocated anywhere is `SCL-104` (PR #802, this workstream). No collision. Single allocation.
Change: rule between the two options below, then either (a) amend Doc 01A §5 to carve out retention deletion, or (b) amend Privacy Policy §6.5. One of the two documents must move; they cannot both be true as written.
WAS: v3 §6.5 as published reads "Records of how our systems were configured are kept for 7 years. These describe our operations, not you." The owner ruling of 2026-09-22 (B2) asked for "all thirteen config-history tables, catalog-driven" on the reasoning that "the published sentence covers all of them".
IS: TWO facts neither the policy nor the ruling accounted for, both established against a fresh-apply database rather than read off a migration.
  1. THE COUNT IS 18, NOT 13. `genesis.sql:442-480`'s DO loop builds 12 `*_config_history` tables; `calendar_runtime_config_history` adds one; and `exam`, `full_length_adaptive`, `practice`, `review` and `tutor_context` add five more in later migrations. The 13 reported when the ruling was sought was CC's error — the loop plus calendar — and is corrected here. The ruling's substance is unaffected: catalog-driven selection is exactly why the number need not be known, which is the same argument SCL-093 made for the FK bucket.
  2. THEY CANNOT BE DELETED FROM. Twenty tables carry the shared `public.prevent_update_delete()` trigger — the 18 `*_config_history`, plus `mastery_constants_history` and `abuse_score_incidents`. Each has a BEFORE DELETE OR UPDATE FOR EACH ROW trigger raising `Table % is append-only; UPDATE and DELETE are not permitted`. Doc 01A §5 states the property as "History is append-only." A sweep against any of them raises at run time; it does not silently retain, but it does not delete either.
PROVED, NOT ASSERTED, AND ONE VACUOUS PROOF CAUGHT ON THE WAY. The first check ran `DELETE FROM public.auth_runtime_config_history` against an EMPTY table and reported success — a row-level trigger does not fire when there are no rows. Re-run with one seeded row, the delete is refused and the row survives. `tests/ci/financial-record-retention.pg.ci.test.ts` B2.9 pins both halves: at least 19 tables under the shared guard, and a refusal against a real row with the row still present afterwards.
THE ONE PRECEDENT, AND WHY IT IS NOT AUTOMATICALLY THE ANSWER. `audit_logs` is also append-only and IS swept, via SCL-087/R3: it was given its OWN guard function with a single exemption gated on a transaction-local GUC that `apply_audit_logs_retention` sets. That migration states its own scope limit verbatim — "The shared guard is deliberately not modified: nineteen other append-only tables use it and must not inherit this exemption." Those nineteen are the tables at issue here. Extending the pattern to them is mechanically straightforward and would be REUSE rather than invention; it is nonetheless a deliberate weakening of a tamper-evidence property across the whole governance-history surface, which is an owner decision and not a build detail. It is filed rather than assumed.
TWO OPTIONS, both defensible, neither free:
  (a) SWEEP IT. Give the `%_config_history` set its own guard function with one retention exemption, mirroring SCL-087 exactly: transaction-local GUC, set only by `sweep_configuration_record_retention`, revoked from PUBLIC, service_role only. §6.5 becomes true. Cost: governance history stops being provably append-only — a compromised service_role could delete it within a transaction that sets the GUC, which is precisely the property Doc 01A §5 exists to deny. Mitigation would be a second gate asserting the exemption appears in exactly one function, which is what SCL-087 already does for audit_logs.
  (b) AMEND §6.5. Publish what is actually true: configuration history is retained indefinitely and is append-only, and it describes operations rather than people. Cost: a published indefinite retention, which is the thing v3 was written to stop doing — though §6.5 already tells the reader these records "describe our operations, not you", which is the honest basis for keeping them.
CC's RECOMMENDATION IS (b), stated because the brief asks for one. §6.5's own sentence already disclaims that the records are about the reader, the tables carry no student identity beyond an operator attribution that SCL-093 severs at deletion, and the tamper-evidence property is load-bearing for exactly the audit posture this vertical is being built to support. Deleting governance history to satisfy a number the platform chose, when the alternative is publishing the true behaviour, trades a real property for a cosmetic one. Option (a) remains available and cheap if the owner disagrees.
NOT AFFECTED, and built: v3 §6.2 (payment records, seven years). `deletion_billing_record` and `stripe_webhook_events` carry no append-only trigger and are swept by `supabase/migrations/20260922000000_seven_year_retention.sql`. `mastery_constants_change_log` — named in the commissioning brief — is ALSO deletable, but it is a governance change log rather than configuration history and its seven-year disposition follows whichever way §6.5 is ruled; note that the brief's name and the append-only table differ by one word (`mastery_constants_change_log` vs `mastery_constants_history`) and the append-only one is the config record.
Rationale: a published retention period with no mechanism is the defect SCL-101 catalogued and this brief exists to close. Discovering that one of them cannot be given a mechanism without weakening an invariant is a better outcome than building a sweep that raises nightly, and a far better one than a sweep that appears to work.
Why this surfaced now: building the ruling. The append-only trigger is invisible from the migration that creates the tables — genesis.sql attaches it in the same DO loop — and only a real DELETE against a real row reveals it.
Owner action: rule (a) or (b). Under (a), a second migration extends the SCL-087 pattern and the configuration sweep joins the same cron pass. Under (b), §6.5 is amended in a v4 of the Privacy Policy and this entry closes as the record of why.
Build artifact: `supabase/migrations/20260922000000_seven_year_retention.sql` (§6.2 only, deliberately), `tests/ci/financial-record-retention.pg.ci.test.ts` B2.9 (the blocker, pinned), mutations M39-M44.
OWNER RULING 2026-09-22 — OPTION (b), AMENDED IN PLACE WHILE STILL PROPOSED (the status is the owner's to set). Verbatim: "§6.5 config history — amend the policy, keep append-only. CC is right. Those 19 tables are tamper-evident governance records, they carry no student identity after SCL-093, and weakening their guard to honour a deletion promise about operator records is backwards. Change v4's §6.5 to say configuration history is kept as a permanent operational record containing no personal information. Fix it in #806 before merge so v4 never publishes a promise we just decided not to build."
WHAT SHIPPED, AND THE ONE PLACE THE WORDING DIFFERS FROM THE RULING. `legal/privacy-policy/v4/en.md` §6.5 second paragraph now reads "Records of how our systems were configured are kept permanently, as an operational record. These describe our operations, not you." The ruling's phrase "containing no personal information" is NOT published, and the difference is deliberate: `*_config_history.changed_by_profile_id` holds the profile id of the STAFF MEMBER who made a change, and it is severed only when that person's own account is deleted (SCL-093's SET NULL). A profile id is personal data while it is there, so an absolute "no personal information" would be a published claim the schema contradicts. The ruling's substance — these records are about operations, not about the reader — is already carried by the sentence that was kept, which was in v3 and v4 alike and is true. The reasoning the ruling gives ("no STUDENT identity after SCL-093") is exactly right and is what the published text supports.
AMENDED BEFORE v4 EVER REACHED `cleanup`, not by publishing a v5. `scripts/ci/legal-immutability-gate.mjs` freezes a published version directory by comparing it against the SAME PATH ON THE BASE REF, and only for directories that already exist there. v4 exists only on this stack's branches, so amending it in place is what the gate permits and what it is for — the alternative, publishing v5 one day after v4 to correct a promise nobody was ever shown, would re-prompt every account for re-acceptance (`server/routes/legal-routes.ts:124` computes `alreadyHeld` by exact version match) to fix text that never went live.
`content_hash` regenerated (sha256 of en.md), `server/lib/legal-registry.generated.ts` regenerated, and the `dist/public/legal/` deploy copy rebuilt — the body-purity gate caught that third one, which is what it is for. Five legal gates PASS; the 34-assertion publication suite PASS.
NOT CHANGED: §6.2's seven-year period for payment records, which is a different sentence about a different surface and IS enforced by `sweep_financial_record_retention`. Only §6.5's second paragraph moved.


SCL-106 | 2026-09-22 | Privacy Policy v3/v4 §6.6 publishes a 24-month ceiling on de-identified analytics data, but Doc 07B §5.3 states partition-expiration is NOT set on archive tables and Doc 07E §5.2 gives the class an indefinite horizon with "No expiry"; separately, §5.4's absolute no-PII invariant for the archive layer is violated today by the four `retention__*` tables, each of which carries a real `student_id` | PROPOSED
Id: `SCL-106` re-derived at the moment of use, 2026-09-22, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref>` over `docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref, then checked against the six open PRs (#806, #805, #790, #787, #778, #728 — all remote branches already covered by that scan). Highest allocated anywhere is `SCL-105` (PR #805, this workstream). No collision. Single allocation.
Change: amend Doc 07B §5.3's partition-expiration bullet and Doc 07E §5.2's retention horizon so that the `lyceon_analytics_archive_<env>` tables holding raw per-student rows exported by the Doc 03 §14.2 retention sweep are excluded from the keep-forever class and carry a 24-month partition expiration. Separately, rule on the §5.4 violation below.
WAS: Doc 07B §5.3 — "**Partition-expiration:** NOT set on event tables (retention is 'forever' for the pseudonymized 13+ class per 07E §5.2; deletion is cascade-driven per §12, not partition-expiration-driven). System-state-archive tables (§13) similarly carry no partition expiration. **This is the one place 07B deviates from BigQuery default cost-hygiene** ... and the deviation is deliberate and documented: retention is policy-driven (07E), not TTL-driven." Doc 07E §5.2 — "**Retention horizon:** indefinite. No expiry." And 07E §5.4 (`:242`) — "there is no business need at V1 to distinguish 'events retained for 24 months' from 'events retained for 7 years' — once pseudonymized, the data has no per-class lifecycle distinction."
IS: the published policy states a per-class lifecycle distinction, in the sentence the platform shows users. `legal/privacy-policy/v4/en.md:197` — "Where analytics data has been separated from anything identifying, we keep it for up to 24 months, then only in aggregate." SCL-101 item 11 already recorded that this number had no mechanism and called closing it "the single largest build commitment this policy creates". The owner ruling of 2026-09-22 (B3) closed it with the native mechanism: "partition the archive by date and use BigQuery's partition expiration ... No scheduled delete jobs."
WHY THE PUBLISHED POLICY WINS HERE, AND WHY THIS IS NOT AN ARGUMENT AGAINST §5.3 GENERALLY. §5.3's rationale is not "expiration is bad"; it is "retention is 'forever' for the pseudonymized 13+ class per 07E §5.2". That premise is false of these four tables. `archiveRows()` exports `select("*")` rows straight out of Supabase, and the checked-in schemas name what that means: `retention__crisis_review_cases` carries `student_id`, `reviewer_id` and `review_notes`; `retention__tutor_injection_log` carries `student_id`, `conversation_id` and `message_id`; both instruction tables carry `student_id`. These are not pseudonymized, they carry no `analytics_user_id`, and no HMAC has been applied. So the sentence that justifies no-expiry does not describe them, and the keep-forever class they were being kept under is not the class they belong to. §5.3's rule stands for the PostHog-derived event tables and for the §13 system-state-archive aggregates — which is why the 24-month expiration is set per table on the four `retention__*` tables and NOT as a dataset default, even though a dataset default would have been the tidier chokepoint. A dataset default would silently start expiring the §13 aggregates §5.3 protects, in the same dataset §5.1 names as their home.
THE SECOND FINDING, WHICH IS LARGER THAN THE FIRST AND IS REPORTED NOT FIXED. Doc 07B §5.4 states the no-PII invariant in absolute terms: "No table in any warehouse dataset has an **identity-bearing** column. The only user identifier anywhere in the warehouse is `analytics_user_id` ... There is no `email`, no `name`, no `phone`, no `DOB`, no `supabase_user_id`" and "**Everywhere else the ban is absolute:** the normalized (§8), model (§9/§10), archive (§13) ... layers MUST NOT introduce unconstrained JSON or free-text columns." The four archive schemas violate it on both counts: a `student_id` that IS the Supabase user id, and `review_notes` free text written by a human reviewer about a minor in crisis. Consequences, stated plainly: (1) the archive is a second identity store, which §3 threat 8 exists to prevent; (2) it is not covered by the published §6.6 sentence at all, because §6.6 governs analytics data "separated from anything identifying" and this is not separated — so the 24-month expiration this change installs is the right mechanism for the wrong sentence, and the archive's real disclosure obligation is unmet in the published policy; (3) `ci/historical-pii-conformance` (07E §12, 07B §11) is the gate that would catch it and is declared V1.1+, so it has never run. The archive has never actually held a row (see below), so nothing is leaked today. THE CHEAPEST RESOLUTION IS TO NOT ARCHIVE AT ALL: `docs/SpecAudit/retention-matrix-reconciliation.md:487` already names it — "drop the BigQuery archival step and delete outright — archival is a product choice, not a legal one." That would close §6.6's exposure for these tables, delete an entire PII-bearing copy of minors' data, and remove the dependency question below. It contradicts the earlier Karl ruling that set BigQuery as the archival destination, which is why it is filed here rather than done.
NOTHING HAS EVER BEEN ARCHIVED, AND THE REASON IS A MISSING DEPENDENCY, NOT A MISSING CONFIG VALUE. `createBigQueryArchiveClient()` (`server/services/retention-archive.ts`) `require`s `@google-cloud/bigquery`. That package is in NO `package.json` in this monorepo and is absent from `pnpm-lock.yaml`; it appears exactly once in the repo, as `--external:@google-cloud/bigquery` in the `build:vercel` esbuild line, which tells the bundler not to bundle a module that is not installed. So the require throws, `getArchiveClient()` catches it and logs a warning, and the 90d and 180d tiers return `{ok:false, reason:"archive_client_not_configured"}` — the same answer they give when the env var is unset, which is why the missing dependency was invisible behind the missing env var. SCL-101 ADDENDUM FINDING 2 named `BIGQUERY_ARCHIVE_DATASET` as the blocker for those two tiers. That was incomplete: the env var is one of three prerequisites. Wiring it (done: `bigquery_archive_dataset` output + README row) and creating the partitioned tables (done: `google_bigquery_table.retention_archive`) leaves the dependency, and adding a dependency needs owner approval under the standing rule. Until it is approved, the two tiers stay unscheduled in `cloud-scheduler.tf`, because a nightly job that returns ok:false is worse than no job. `tests/ci/bigquery-archive-partitioning.contract.test.ts` B3.19 pins the biconditional in both directions: the tiers must be scheduled if and only if the dependency is installed, so the day it lands, the missing schedule is a failing test rather than a forgotten one.
WHY 730 DAYS AND NOT 731. "Up to 24 months" is an upper bound. 2 x 365 = 730 is inside it for every start date; 731 (leap-inclusive) sits one day outside it in the worst case. B3.9 does not take 730 on trust — it reads the number of months out of the published policy text, resolved through `manifest.json`, and asserts the implemented window is `<= floor(months * 365 / 12)` and within one month of it. Editing the constant without editing the policy fails; editing the policy without the constant fails.
WHY THE PARTITION KEY IS THE ARCHIVE DATE. Doc 07B §13 already names the shape — "every archived aggregate carries the `event_date` partition + an `_archived_at` timestamp" — so no new column convention is invented. `event_date` is `DATE(_archived_at)` in UTC, not the source row's `created_at`. The clock the policy promises runs from when the row lands in BigQuery: a 90-day-old row partitioned by `created_at` would arrive 90 days into its 730-day life, and a row from an older backlog would arrive in a partition that had already expired.
THREE DRIFTS FOUND IN A GATE THAT EXISTED AND WAS NEVER RUN, reported here because they are the reason the archive would have failed on its first real insert. `scripts/ci/retention-archive-drift-check.mjs` has been in the repo since 2026-08-27 to catch Postgres columns absent from the BigQuery schema. No workflow invoked it. Run against the pre-change tree it FAILS: `crisis_review_cases.category` was added 2026-09-17 (`20260917000002_crisis_review_cases_category.sql`) and never reached the schema, and `conversation_id`/`student_id` became nullable on 2026-09-18 (`20260918000000_crisis_severance_and_verification.sql`, this workstream's own change) while the schema still said REQUIRED. An unknown field fails a BigQuery streaming insert, and archive failure blocks the Supabase delete by design (LISA-RET-001/002) — so the drift would not have corrupted the archive, it would have silently stopped the 90d/180d tiers from deleting anything. The gate is now wired into `ci.yml` and the schemas are regenerated.
NOTHING DOWNSTREAM DEPENDS ON THE ARCHIVE BEING UNBOUNDED — asked and answered. Every reference to `retention__*` or the archive dataset in the repo is a writer, a generator, a gate, Terraform, or documentation: `retention-archive.ts`, `retention-sweep.ts`, `generate-bq-archive-schemas.mjs`, `retention-archive-drift-check.mjs`, `bigquery.tf`, `imports.tf`, `infra/terraform/README.md`, the negative-control test, and two SpecAudit notes. There is no reader. Doc 07E §11's system-state-archive registry — the one place an indefinite ML-corpus claim attaches — indexes prompt templates, scoring constants and the mastery constants change log, and names none of these four tables. Doc 07C dashboards are declared-shape V1.1+ and read the normalized layer, not the archive. No ML training corpus exists in the codebase (`training_corpus` matches nothing).
THE 365d TIER'S TABLES STILL DO NOT EXIST — reported, not built, per the brief. `sweep365d` returns `{ok:false, reason:"365d_tables_not_provisioned"}` unconditionally. The spec names LISA cost telemetry and quota appeal records (Doc 03 §14.2); neither table is in `genesis-schema.expected.sql` nor in any migration. It is not in `ARCHIVE_TABLE_MAP` either, so this change does not touch it.
Rationale: SCL-101 published eleven periods and named five of them as commitments rather than descriptions. This closes the one it called the largest, using the mechanism the platform already pays for rather than a sweep job — a partition expiration cannot fail silently in the way a scheduled delete can, because there is no schedule to miss. The cost is a divergence from two locked sections, recorded here in full rather than absorbed.
Why this surfaced now: implementing the ruling. Setting a partition expiration requires a partition column, requiring a column requires the schema, and reading the schema is what exposed both the three drifts and the `student_id` that makes §5.4 the larger finding.
Owner action: (1) rule on the §5.3 / §5.2 amendment above; (2) rule on the §5.4 violation — amend §5.4 to permit identity-bearing columns in the retention-export layer, or stop archiving these four tables and delete outright; (3) approve or refuse `@google-cloud/bigquery`, which decides whether the 90d and 180d tiers run at all. Under (2)-stop-archiving, (3) becomes moot and the four tables and this expiration are deleted with it.
Build artifact: `server/services/retention-archive.ts` (`ARCHIVE_PARTITION_FIELD`, `ARCHIVE_PARTITION_EXPIRATION_DAYS`/`_MS`, the `event_date` stamp), `infra/terraform/bigquery.tf` (`google_bigquery_table.retention_archive`, dataset comment corrected), `infra/terraform/outputs.tf` (`bigquery_archive_dataset`, `bigquery_archive_tables`), `infra/terraform/cloud-scheduler.tf` (unscheduled-tier note), `infra/terraform/README.md`, `scripts/retention/generate-bq-archive-schemas.mjs`, `scripts/ci/retention-archive-drift-check.mjs`, the four regenerated `scripts/retention/schemas/*.json`, `.github/workflows/ci.yml` (drift gate wired), `tests/ci/bigquery-archive-partitioning.contract.test.ts` (20 assertions), mutations M50-M57.

SCL-106 — OWNER RULING 2026-09-22, AMENDED IN PLACE WHILE STILL PROPOSED. THE ARCHIVE IS REMOVED, NOT EXPIRED. The ruling reverses the earlier BigQuery-destination decision and supersedes everything above about a 24-month partition expiration. Verbatim: "Doc 07B §5.4 — stop archiving, delete outright. This reverses my earlier BigQuery ruling, which was made before anyone knew the archive carries `student_id`, `reviewer_id` and free-text notes about minors in crisis. BigQuery is the worst home for those. Nothing has ever been archived, so there's nothing to migrate. The 90d and 180d tutor tiers delete instead of archive." And on the dependency: "`@google-cloud/bigquery` — not needed. Falls away with the ruling above." And on this PR: "#809 — strip the four BigQuery tables and the partition expiry; keep the drift-gate wiring. That gate was real, red, and wired into nothing — worth keeping regardless."
WHAT THIS MEANS FOR THE FINDINGS ABOVE. Finding (a) — the §5.3 / §5.2 divergence — IS WITHDRAWN. No partition expiration is set anywhere, so Doc 07B §5.3 and Doc 07E §5.2 need no amendment and this entry no longer asks for one. Finding (b) — the §5.4 no-PII violation — is RESOLVED IN THE STRONGEST DIRECTION AVAILABLE: rather than amending §5.4 to permit identity-bearing columns in the archive layer, the layer stops existing for these four tables. §5.4 stands unamended and unviolated. The §6.6 mismatch the entry recorded — that these rows are not "separated from anything identifying" and so were never the data §6.6 governs — is what made the 24-month mechanism the right answer to the wrong sentence; with the archive gone, §6.6 governs only the Vercel analytics surface, which is a vendor setting.
WHAT SHIPPED IN #809 AFTER THE RULING. Everything the partition expiry needed is reverted to its pre-B3 state, byte-for-byte where that is possible: no `google_bigquery_table` resource, no `ARCHIVE_PARTITION_*` constants, no `event_date` stamp, no `bigquery_archive_dataset`/`bigquery_archive_tables` outputs, no README rows, no partitioning contract suite, and mutations M50-M57 removed (`scripts/ci/deletion-evidence-gate.mutations.sh` is now identical to its pre-B3 content). TWO THINGS ARE KEPT, both on the owner's instruction and both independent of archiving: the `ci.yml` step that runs `scripts/ci/retention-archive-drift-check.mjs`, and the regenerated schemas that make it green. THE DRIFT IT CAUGHT, STATED PRECISELY: it is three columns in ONE table, not four tables' worth — `crisis_review_cases` gained `category` on 2026-09-17 and never reached the schema, and its `conversation_id` and `student_id` went nullable on 2026-09-18 while the schema still said REQUIRED. The other three schema files change only by the generator's own formatting. A gate that had existed since 2026-08-27, run by no workflow, red the first time it ran.
THE DATASET'S OWN JUSTIFICATION WAS WRONG AND IS NOW MARKED. `infra/terraform/bigquery.tf` cited Doc 07B §5.1 line 173 — "retention is 'forever' for the pseudonymized 13+ class" — as the reason for setting no expiration. That sentence never described these tables, because they are not pseudonymized. The comment now records that, and records that the archive is retired rather than left looking deliberate.
STILL OWED, AND NOT IN #809: the sweeps themselves. `sweep90d` and `sweep180d` still call `archiveRows` and still decline with `archive_client_not_configured`. A follow-up PR makes them delete outright, retires `server/services/retention-archive.ts`, the four schemas, the generator and this drift gate with it, and schedules the two tiers — which is the first time either has ever been able to run. That PR is where §14.2's "archived data is moved to cold storage in aggregated form" gets its own SCL, because the ruling supersedes that sentence too.
Owner action on this entry is now: none for (a), which is withdrawn; none for (b), which is resolved by removal. The entry stays PROPOSED only so the owner can close it against the follow-up PR.

SCL-107 | 2026-09-22 | Writing the Doc 06D §9.1 retention registry for real found four things the schema cannot express or does not have: no encoding for a deliberately-indefinite period, no encoding for a compound "whichever is longer" period, no `purge_substrate` value for a native substrate TTL, and — the largest — Doc 07E §6 builds both of its canonical rows on two §9.1 fields that Doc 06D does not contain, citing a Doc 06D change record Doc 06D also does not contain | PROPOSED
Id: `SCL-107` re-derived at the moment of use, 2026-09-22, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref including the newly-pushed `claude/r4-review-ui` (which tops out at SCL-090). Highest allocated anywhere is `SCL-106` (PR #809, this workstream, pushed earlier today). No collision. Single allocation.
Change: four amendments to Doc 06D §9.1 and one to Doc 07E §6.1, each below. The registry file itself is built and shipped; these are the places the schema had to be strained to hold real data.
WAS: Doc 06D §9.1 declares twelve fields per policy, an enumerated `purge_substrate`, and (per §9.3 condition (i)) permits `retention_horizon_seconds IS NULL` only when `partial_provable_until` carries a forward-ref token. Doc 07E §6.1 states: "The Doc 06D §9.1 schema now includes `retention_horizon_months` + `calendar_month_semantics` fields (applied via Doc 06D in-lock-cycle additive RB-06D-V1-19)."
IS: `infra/retention-policy-registry.yaml` now exists with 16 rows covering every period Privacy Policy v4 §6 publishes. Four of those rows could not be encoded as the schema stands.
FINDING (a) — NO ENCODING FOR A PERIOD THAT IS INDEFINITE BY DESIGN. v4 §6.2's do-not-contact line: "If you asked us not to contact you again, we keep your email address on a do-not-contact list until you tell us otherwise. That is the only way we can honour the request." `RPOL-SUPPRESS-01` therefore has a null horizon and no forward-ref token, which §9.3 (i) fails. The token field means "the canonical owner has not set a horizon yet"; this owner has set one, and it is "no expiry", for a reason that will not change. The schema needs a way to say deliberately-indefinite that is distinguishable from not-yet-decided — Doc 07E §5.2 wants the same thing for class 2 and reaches for a forward-ref token to get it. `tests/ci/retention-policy-registry.contract.test.ts` F1.7 pins this as the ONLY row in that state, so a second one cannot appear quietly.
FINDING (b) — NO ENCODING FOR A COMPOUND PERIOD. v4 §6.3: Billing Terms consent is kept "for no less than three years from the date of consent, or one year after the subscription ends, whichever is longer." The schema holds one scalar horizon. `RPOL-CONSENT-02` encodes the 36-month floor and the subscription-relative term is simply lost. §6.3 exists as its own subsection precisely BECAUSE this clock runs differently from §6.2's (SCL-101 recorded that the two consent clocks run in opposite directions), and the registry cannot currently say so. A conformance job reading this row would check the wrong thing for any account whose subscription ended more than two years after consent.
FINDING (c) — NO `purge_substrate` VALUE FOR A NATIVE SUBSTRATE TTL. The enum is {pg_cron, scheduled_job, doc05d_cascade, doc01v6_t_plus_7, doc03_lisa_cron, manual}. `RPOL-ANALYTICS-04`'s purge is a BigQuery partition expiration (SCL-106): the substrate deletes on its own, with no job to schedule, no operator to page, and no run record for §9.4 (e)'s independent-source rule to read. `manual` is false in both directions — it implies an operator who does not exist, and it trips §9.3 (g)'s "manual substrate without a paging alert". It is encoded as `manual` under protest and named here. A `substrate_native_ttl` value would fit, and §9.4 would need to say what "observed purge" means when the substrate keeps no record of one.
FINDING (d) — TWO LOCKED DOCUMENTS DISAGREE ABOUT THE SCHEMA ONE REGISTERS AGAINST, AND THIS ONE IS MEASURED. Doc 06D contains ZERO occurrences of `retention_horizon_months`, ZERO of `calendar_month_semantics`, ZERO of `RB-06D-V1-19` and ZERO of `CR-06D-06`. Its own cleanup register and closing line stop at `RB-06D-V1-01..18` / `CR-06D-05`. Doc 07E references those four 14, 14, 19 and 7 times respectively, states the extension is "APPLIED 2026-05-26", and builds BOTH of its canonical registry rows (`RPOL-ANALYTICS-01`, `RPOL-ANALYTICS-02`) on the two fields. So Doc 07E's rows are registered against a schema that does not have the fields they use, and the change record certifying the extension exists only in the consuming document. Either the additive was drafted and never landed in Doc 06D, or Doc 06D's copy in this repo predates it. F1.1 pins the asymmetry in BOTH directions — the two fields must appear in 07E and must NOT appear in 06D — so the day the additive lands, the test fails and the pin comes out rather than rotting.
THE ALERT REGISTRY IS A NAMED PREREQUISITE, NOT AN OMISSION, per the owner ruling. `infra/alert-registry.yaml` (Doc 06C §7) does not exist. §9.3 (d) requires every `purge_alert_id` to resolve there and §9.3 (g) fails any `manual` substrate without one. Six rows are `manual` because no mechanism exists for their published period, so six rows cannot satisfy (g) at any price until that file does. Every `purge_alert_id` in the registry is therefore null — which is exactly what Doc 07E §6 does for its own two rows, citing INV-07-09. The registry carries a `prerequisites:` block naming the file, its owning section, the two §9.3 conditions it blocks, and this entry. F1.12 asserts the biconditional: alert ids are null exactly while that file is absent, so creating it turns the nulls into a failing test rather than a forgotten follow-up. It is not created here because Doc 07 Parent §4 gives the reason not to — an alert with no rotation owner and no runbook makes 06C §11/§10 obligations unsatisfiable.
ONE DECISION TAKEN THAT THE OWNER SHOULD RATIFY OR OVERRULE. §9.2 rule 2 requires `canonical_owner_doc_and_section` to "resolve to a referenced doc + § anchor". For eleven of the sixteen rows the document that owns the number is the PUBLISHED privacy policy, not a `docs/Spec` section — so they cite `legal/privacy-policy/v4/en.md §6.x`. The justification: it is a versioned, immutable, section-numbered document in this repo; it is the document users are shown; it is what the acceptance ledger records consent against; and where the `docs/Spec` draft and the published policy disagree on a period, SCL-101 established that the published one is the promise. F1.8 additionally requires every such citation to point at the CURRENT version resolved through `manifest.json`, so publishing a v5 fails this suite until the registry is re-pointed — a registry citing a superseded policy version cites a promise nobody was shown. If the owner wants spec-only citations, eleven rows become `cited_per_project_handoff_record` placeholders and the registry stops being able to state a number.
AN EARLIER POSITION OF MINE IS SUPERSEDED, AND SAYING SO IS THE POINT. SCL-093's 2026-09-15 amendment recorded that the Doc 06D §9 registry entry was "now that the sweep exists — the Doc 06D §9 registry entry for the class (`infra/retention-policy-registry.yaml`), which this build does not write because the registry substrate is the owner's." The F1 ruling reverses that. The registry header records the reversal so it does not later read as drift.
ONE GATE FIXED IN PASSING, AND A SECOND UNRUN GATE FOUND. `scripts/ci/secret-class-inventory-check.ts` carried a minimal YAML parser whose scalar half tested `null`/`true`/`false` BEFORE stripping an inline comment — so `required: true # note` parsed as the STRING "true" and `entry.required === true` was false, silently opting that entry out of the required-have-consumers check. No line in that manifest is written that way today, so the fix is behaviour-preserving there; it is a live correctness fix for the retention registry, where `purge_alert_id: null  # see prerequisites` parsed as the string "null". The parser's generic half is now `scripts/ci/lib/minimal-yaml.ts`, consumed by both gates rather than forked a third time, and it throws on a block scalar rather than returning ">-" as a value. SEPARATELY: that gate is wired into no workflow and exits 1 today on 12 stale consumer references. One of the 13 was mine — `BIGQUERY_ARCHIVE_DATASET` pointed at `retention-archive.ts:81` and SCL-106's edit moved the constant to :96 — and is corrected. The other 12 are not this workstream's and are reported, not touched. This is the SECOND gate in two days found to exist and never run (`retention-archive-drift-check.mjs` was the first, and it was red). Wiring this one would turn CI red on the 12, which is why it is reported rather than wired.
Rationale: SCL-101 published eleven periods and named five as commitments rather than descriptions. A registry is how a commitment stops being invisible: every period now has a row, every row names the mechanism or says plainly that none exists, and F1.10 asserts the registry's numbers ARE the constants the SQL uses — 90 from `notification_retention_days()`, 90 from `operational_log_retention_days()`, 2557 from `financial_record_retention_days()`, 24 from `deletion_evidence_retention_months()`, and 730 from `ARCHIVE_PARTITION_EXPIRATION_DAYS`. A registry whose numbers drift from the mechanism's is worse than no registry, because it documents a schedule nothing runs.
Why this surfaced now: building the file. Each of (a), (b) and (c) is a row that could not be written without either lying or leaving a field empty, and (d) is what happens when a test asks the owning document to confirm a field name it was told the document has.
Owner action: (1) rule on (a), (b) and (c) — three §9.1 schema amendments, each small; (2) rule on (d), which is a question for whoever owns the Doc 06D lock cycle, not a build decision, and which blocks nothing today because the fields are in use regardless; (3) ratify or overrule the published-policy-as-canonical-owner citation; (4) confirm which of the 31 missing `infra/*` files the F1 ruling meant by "explicitly forbidden" — see `docs/SpecAudit/missing-infra-config-inventory.md`, which finds no file forbidden as a file and names the alert registry as the likely intent, with the narrower constraint being "no analytics-layer alert rows" rather than "do not create it".
Build artifact: `infra/retention-policy-registry.yaml` (16 rows + the prerequisites block), `scripts/ci/lib/minimal-yaml.ts` (new, shared), `scripts/ci/secret-class-inventory-check.ts` (consumes it; one stale consumer line corrected), `infra/secret-class-inventory.yaml` (:81 -> :96), `docs/SpecAudit/missing-infra-config-inventory.md` (the 31, reported not created), `tests/ci/retention-policy-registry.contract.test.ts` (17 assertions).

SCL-107 — OWNER RULINGS 2026-09-22, AMENDED IN PLACE WHILE STILL PROPOSED. Four of the questions this entry asked are answered; two findings change shape as a result.
RATIFIED — THE PUBLISHED POLICY IS THE CANONICAL OWNER. Verbatim: "Published policy is the canonical owner of retention periods. The registry and spec derive from it, not the other way round." This settles the decision the entry flagged for ratification. Eleven of the registry's rows cite `legal/privacy-policy/v4/en.md §6.x` as `canonical_owner_doc_and_section`, and F1.8 additionally pins every such citation to the CURRENT version resolved through `manifest.json`, so publishing a v5 fails the suite until the registry is re-pointed at it. The ruling also settles the direction of travel for anything that disagrees: where `docs/Spec` and the published policy state different periods, the spec is what moves.
CORRECTED — NO FILE IS "EXPLICITLY FORBIDDEN", AND THE CLAIM WAS CC's OWN. Verbatim: "'Explicitly forbidden' file — none. That claim came from CC's own earlier report and CC now can't confirm it. Record it as a correction. The alert registry gets built by its own workstream, without analytics-layer alert rows." The F1 breadth ruling that commissioned the inventory said "one is explicitly forbidden"; that phrase entered the record from an earlier CC report and no sentence in the locked corpus supports it. `docs/SpecAudit/missing-infra-config-inventory.md` is corrected: none of the 31 is forbidden as a file. What IS forbidden is narrower and real — Doc 07 Parent INV-07-09 is a negative invariant ("No Doc 07 V1 mechanism produces an alert") with its own proving mechanism `ci/doc07-v1-no-alerts`, so `infra/alert-registry.yaml` must be built WITHOUT analytics-layer alert rows. That is now the recorded constraint, and the file belongs to the Doc 06C workstream.
FINDING (a) HAS A SECOND INSTANCE, WHICH CHANGES WHAT IT IS. The entry filed one row that §9.3 (i) cannot express — `RPOL-SUPPRESS-01`, a do-not-contact list that is indefinite by design rather than pending a forward-ref. The §6.5 ruling of the same day produced a second: configuration history is now published as permanent (see SCL-105's amendment), so `RPOL-CONFIG-01` has a null horizon and no token for exactly the same reason. Two rows in one registry, hours apart, is not an edge case in the schema — it is a missing value. `tests/ci/retention-policy-registry.contract.test.ts` F1.7 pins BOTH by name, so a third cannot arrive quietly. The ask is unchanged in substance and stronger in evidence: §9.1 needs a way to say deliberately-indefinite that is distinguishable from not-yet-decided.
`RPOL-CONFIG-01` STAYS IN THE REGISTRY, AND WHY THAT MATTERS. The §6.5 ruling described these tables as containing no personal information. The row is kept because that is not quite true and the registry should not pretend otherwise: `*_config_history.changed_by_profile_id` holds the profile id of the STAFF MEMBER who made a change, severed only when that person's own account is deleted (SCL-093's SET NULL). It is a PII surface with a permanent horizon, which is exactly what a PII-surface registry is for. The published text was written to match (see SCL-105's amendment), so the policy, the registry and the schema now say the same thing.
`RPOL-ANALYTICS-04` IS DELETED, NOT RE-HORIZONED. SCL-106's ruling removes the BigQuery archive rather than expiring it. The row is deleted rather than kept with a null horizon because the SURFACE is being deleted: nothing has ever been written to it, and a follow-up PR removes `server/services/retention-archive.ts` and its callers. A retention policy for a surface that has never held a row and is on its way out would be the registry documenting something that does not exist — the failure mode this file exists to end, pointed the other way. §6.6 stays covered by `RPOL-ANALYTICS-03`, the Vercel analytics surface, which is what §6.6 now governs. The registry is 15 rows.
STILL OPEN ON THIS ENTRY: findings (b) and (c) — the compound "whichever is longer" period §6.3 publishes, and the missing `purge_substrate` value for a native substrate TTL — and finding (d), the Doc 06D / Doc 07E disagreement over `RB-06D-V1-19`. (c) is now less urgent, since the one surface that needed it was the BigQuery archive and that surface is going; it is left filed because the next native-TTL substrate will hit it again and the schema will still have nothing to say.

SCL-108 | 2026-09-22 | Four locked sections describe a cold-storage archival step for the LISA 90d/180d tiers — a nightly export to S3-or-equivalent behind an HMAC callback pair, with deletion gated on the export completing. The 2026-09-22 ruling removes archiving from those tiers. The build now deletes outright, which contradicts all four | PROPOSED
Id: `SCL-108` re-derived at the moment of use, 2026-09-22, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref, and cross-checked against all eleven open PRs (#805, #806, #809, #810, #813, #814, #815, #816, #728, #778, #787). Highest allocated anywhere is `SCL-107` (PR #810, this workstream, earlier today). No collision. Single allocation.
Change: four amendments, each striking or re-scoping an archival step that no longer has an implementation. SCL-106 foresaw this one and named it: "that PR is where §14.2's 'archived data is moved to cold storage in aggregated form' gets its own SCL, because the ruling supersedes that sentence too." Three further sections turned out to say the same thing, which is why this is an entry rather than a footnote.
WAS (1): Doc 03 §14.2, Data Retention Matrix — "**Automatic archival:** Tables with time-based retention (90d, 180d, 365d) auto-archive on daily cron. Archived data is moved to cold storage (aggregated form for analytics); raw records deleted."
WAS (2): Doc 03A §19.3, Archival job for instruction data — a nightly `tutor_instruction_archival` pg_cron job at `0 4 * * *` calling `public.trigger_instruction_archival_job()`, which posts to `/api/internal/tutor/archival/run` under the `archival-scheduler → archival-worker` service-pair HMAC of 01A §62; the worker writes to cold storage and calls back to `/api/internal/tutor/archival/complete`, and only that callback deletes the rows from the primary tables.
WAS (3): Doc 01A §68 "Consumed by" — a row for an "Audit archival job" on the Main API that moves `audit_logs` rows to cold storage per V8 §5.1.
WAS (4): Doc 01 §265 — audit logs older than 90 days "transition from primary `audit_logs` table to cold storage (`audit_logs_archive` — compressed Postgres table, or external archive per Doc 01A observability sinks)."
IS: the 90d and 180d tiers delete outright. `sweep90d` and `sweep180d` issue two deletes each against Supabase and return the count; there is no export, no cold storage, no callback, and no state in which a delete is withheld because a copy could not be written. `server/services/retention-archive.ts`, `scripts/retention/generate-bq-archive-schemas.mjs`, `scripts/ci/retention-archive-drift-check.mjs` and the four `scripts/retention/schemas/*.json` are deleted. For the first time either tier can run, both are scheduled: `google_cloud_scheduler_job.retention_sweep_90d` at `40 5 * * *` and `retention_sweep_180d` at `50 5 * * *`.
WHAT THE RULING ACTUALLY DECIDED, AND WHAT IT DID NOT. Verbatim: "Doc 07B §5.4 — stop archiving, delete outright. This reverses my earlier BigQuery ruling, which was made before anyone knew the archive carries `student_id`, `reviewer_id` and free-text notes about minors in crisis. BigQuery is the worst home for those. Nothing has ever been archived, so there's nothing to migrate. The 90d and 180d tutor tiers delete instead of archive." The ruling names BigQuery and names the two tutor tiers. WAS (1) and WAS (2) are inside that scope and are struck. WAS (3) and WAS (4) concern `audit_logs`, which is a different table on a different clock and is NOT in scope — they are recorded here because the same phrase, "cold storage", now has no implementation anywhere in the repo, and an amendment that leaves them standing leaves two sections pointing at a mechanism that does not exist. The proposal for those two is narrower: mark them as describing a V1.1+ mechanism rather than current behaviour. SCL-101 item (iii) already records the same absence from the other side: "AN `audit_logs_archive` COLD TIER. Referenced in the spec corpus; the table does not exist." That entry chose not to publish a claim about where expired security records go; this one asks for the corpus to stop asserting they go somewhere.
THE ARCHIVE NEVER HELD A ROW, WHICH IS WHAT MAKES THIS A SPEC AMENDMENT AND NOT A DATA MIGRATION. `@google-cloud/bigquery` appears in no `package.json` in this monorepo and in no entry of `pnpm-lock.yaml`; it occurs once in the repo, as `--external:@google-cloud/bigquery` in the `build:vercel` esbuild line. `createBigQueryArchiveClient()` `require`d it, the require threw, `getArchiveClient()` caught, and both tiers returned `archive_client_not_configured` on every call. Neither tier was scheduled, so in practice neither was ever called either. Two published retention periods, zero rows deleted, zero rows archived, for the whole life of the code. That is the finding underneath the ruling: the archival step in WAS (1) and WAS (2) was never load-bearing, and removing it loses nothing that ever existed.
WHAT IS LOST BY STRIKING (1), STATED PLAINLY. §14.2's parenthetical "(aggregated form for analytics)" is the only place the locked corpus contemplates instruction-exposure or crisis-review data surviving its retention window in any form. Deleting outright forecloses that. This is the right trade and is worth naming rather than burying: the four tables carry `student_id` throughout and `crisis_review_cases` additionally carries `reviewer_id` and `review_notes` — human free text about a minor in crisis — so an "aggregated form" that preserved analytic value would have had to be built, from scratch, against Doc 07B §5.4's absolute ban on identity-bearing columns and free text in any warehouse dataset. No aggregation exists, none is specified beyond that parenthetical, and no consumer of one exists: every reference to `retention__*` in the repo was a writer, a generator, a gate, Terraform or a comment. There is no reader. Doc 07E §11's system-state-archive registry, the one place an indefinite ML-corpus claim could attach, indexes prompt templates, scoring constants and the mastery constants change log, and names none of these four tables.
Why this surfaced now: implementing the ruling. SCL-106 named §14.2 in advance; §19.3, §68 and Doc 01 §265 came out of grepping the corpus for "cold storage" to make sure §14.2 was the only one. It was not.
Owner action: (1) strike or re-scope Doc 03 §14.2's archival bullet and Doc 03A §19.3 in full — the pg_cron job, the two endpoints and the service-pair HMAC in §19.3 have no implementation and, after this ruling, no intended one; (2) rule on WAS (3) and WAS (4), which are out of the ruling's scope and are proposed as V1.1+ markings rather than strikes; (3) note that 365d is still unscheduled and unimplemented for the separate reason recorded in SCL-106 — LISA cost telemetry and quota appeals exist in neither `genesis-schema.expected.sql` nor any migration — so §14.2's "(90d, 180d, 365d)" cannot be fully satisfied by any amendment here.
Build artifact: `server/services/retention-sweep.ts` (`sweep90d`/`sweep180d` rewritten to delete; `SweepOpts` reduced to `{ now }`), `server/routes/internal-retention-routes.ts` (`getArchiveClient()` removed), deleted: `server/services/retention-archive.ts`, `scripts/retention/generate-bq-archive-schemas.mjs`, `scripts/ci/retention-archive-drift-check.mjs`, `scripts/retention/schemas/` (4 files); `infra/terraform/cloud-scheduler.tf` (90d + 180d jobs), `infra/terraform/bigquery.tf` (dataset retired in place), `infra/terraform/outputs.tf` (`retention_sweep_job_names`), `infra/terraform/README.md`, `infra/secret-class-inventory.yaml` (`BIGQUERY_ARCHIVE_DATASET` removed), `infra/retention-policy-registry.yaml` (RPOL-ANALYTICS-04 note to past tense), `.github/workflows/ci.yml` (drift step removed), `tests/ci/retention-sweep.negative-control.contract.test.ts` (32 assertions, incl. 3 that pin the absence of an archive path in comment-stripped source), `tests/ci/retention-policy-publication.contract.test.ts` (+9: the tier-coverage block, 43 total), `tests/ci/lib/strip-comments.ts` + its 13-assertion self-test, mutations M65-M74.


SCL-109 | 2026-09-22 | Doc 02B §16 specifies review as SM-2 spaced repetition over a proposed `review_schedule`, with tutor pre-submission and skipped questions excluded; the engine in production is practice's loop over a miss-and-skip queue, and §16 must describe what was built | PROPOSED
Id: `SCL-109` re-derived at the moment of use, 2026-09-22, across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote ref, and again over all of `docs/`) and the head branches of the six open PRs (#825 `claude/calendar-review-enable`, #821 `review`, #820 `calendar`, #787 `cleanup`, #778 `claude/lucid-shannon-nmjr3n`, #728 `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a`). Highest allocated anywhere is `SCL-108` (`origin/cleanup`, unmerged under PR #787, therefore claimed). No collision. Ten entries are allocated in this session, sequentially: SCL-109 through SCL-118.
Change: rewrite Doc 02B §16 ("Review Engine and Spaced Repetition") to specify the engine that is live. The section keeps its number and its place; its Purpose, Launch Scope Matrix, Entry to Review, Review Schedule Table, Review Queue Presentation, Tutor in Review, Tutor-Assisted Correctness, Review Completion, Canonical Writer and Calendar Integration Flag subsections are all affected. SM-2 and tutor-in-review do not disappear from the document — they move from launch scope to target state.
WAS, verbatim (Doc 02B V4, `docs/Spec/Lyceon — Document 02B_ Runtime Engines (V4).md`):
  §16 Purpose (`:706`): "Review is where learning consolidates. When a student gets a practice or exam question wrong, that specific question enters their review queue. Over time, spaced repetition surfaces it at scheduled intervals. Students reason through the question with tutor assistance before submitting, submit an answer, and either graduate the item from review (correct enough times at expanding intervals) or reset its schedule (if they missed it)."
  §16 Canonical Writer (`:712`): "`review-session-routes.ts` is the canonical writer for review tables."
  §16 Entry to Review (`:733`): "A question enters a student's review queue when they answer it incorrectly in practice or exam. Skipped questions (served but not submitted) do not enter review. Review entry is automatic; students do not opt in or out per question. Review entries are created for all users regardless of tier (free users accumulate invisibly per §12)."
  §16 Review Schedule Table (Target State) (`:752-762`): "SM-2 scheduling requires per-(profile, question) state that persists beyond any individual session... V4 proposes a new `review_schedule` table capturing the SM-2 state: Link to `profiles.id`; Link to `public.questions.id`; `repetition_count`, `interval_days`, `ease_factor`, `next_review_at`; Lifecycle status: active, graduated, retired; First-missed context (session where the miss occurred)... This is a target-state addition per CR-02B-23."
  §16 Review Queue Presentation (`:770`): "The review queue is the set of items where `next_review_at <= now()` and `status = 'active'` for the profile. The UI surfaces due items as a continuous stream, sorted most-recently-missed first by default, with option to filter by original practice session or exam. There is no cap on the queue."
  §16 Launch Scope Matrix (`:719-723`) carries the rows "Premium-only review access | Yes | Yes", "Tutor pre-submit with architectural answer-withholding | Yes | Yes", "`review_schedule` table | Yes, if feasible at launch | Yes" and "One-success graduation (simplified) | Yes | No".
  §16 Calendar Integration Flag (`:794`): "The study calendar (future Doc 04\) must prioritize due review items above new practice when generating daily study plans."
IS: the engine shipped between 2026-09-17 and 2026-09-22 and verified in production on 2026-09-22.
  DESIGN PRINCIPLE, and the reason §16 gets shorter rather than longer: review is practice with a different pool. Session create and idempotency, prefill, snapshot immutability, option-token shuffle, grading, skip, resume, the open-session list, 7-day inactivity abandonment, middleware, CSRF, response shapes and the client question loop are practice's, reused or mirrored. Any difference not stated in §16 is a defect, not a variation.
  ENTRY. A question enters review when it is answered incorrectly OR SKIPPED in practice, diagnostic sessions included. A correct practice answer never touches the queue. Entry is automatic and applies to every tier.
  QUEUE (`review_schedule`). One row per miss or skip, carrying `source_engine` (`practice`, `full_length`, `review`), `source_session_id`, `source_item_id`, `source_outcome` (`incorrect`, `skipped`), `queued_at`, `status` (`active`, `graduated`, `superseded`, `retired`), `closed_at` and `closed_by_item_id` (`20260921000000_review_queue_runtime.sql:95-126`). A new miss or skip SUPERSEDES the question's open entry rather than mutating it, so the history is one row per event and at most one entry per (student, question) is active — `uq_review_schedule_open_question`, a partial unique index on `status = 'active'` (`:139-140`, ruling 12). `(source_engine, source_item_id)` is unique, which is the writer's idempotency key (`:143-144`). The queue stores NO question metadata (ruling 19).
  WRITERS. `review_queue_record` and `review_queue_graduate`, called only by two triggers: `trg_practice_item_enqueue_review` on `practice_session_items` (`:475`) and `trg_review_item_resolve` on `review_session_items` (`:537`). The second also writes `review_error_attempts` with `id` = the review item's id (ruling 11, `:499`). Both run inside the item's compare-and-swap UPDATE. The API never writes either table. Sessions and items are written by the review routes, `server/routes/review-canonical.ts`.
  POOLS. Three modes: `queue` (all active entries), `session` (questions with any entry from one past practice, review or full-length session that are still active), `filter` (section, domain and skill, with practice's predicate). Active entries are joined to `servable_questions` (`server/services/review-pool.ts:165`) and ordered by `queued_at`, then `question_id` (`:102-103`, ruling 7). The whole pool is prefilled at creation, or `target_count` items when a size is given. The same question may be open in several sessions. An empty pool returns 422 `REVIEW_POOL_EMPTY` before any row is written (`review-canonical.ts:545-548`).
  OUTCOMES.
  | Action | Queue | Attempt row | Mastery event |
  | ----- | ----- | ----- | ----- |
  | Correct | Entry graduated | Yes | Yes: source `review`, event id = item id |
  | Wrong | Entry superseded; new active entry (source `review`) at the back | Yes | Yes |
  | Skip | Requeued, with outcome `skipped` | No | No |
  SESSIONS. Practice's shape: modes `queue | session | filter` (`20260921000000:199-201`), statuses `created`, `active`, `completed`, `abandoned` (`:208-212`). Several may be open at once, up to practice's `max_concurrent_sessions`, counted separately from practice's but read from practice's configured value so the two cannot drift (`review-canonical.ts:502` calls `loadPracticeConfig()`). Resumable at `/review/session/:sessionId`. Abandoned by End Session or by the 7-day sweep, whose TTL is imported from the practice module rather than declared twice (`server/lib/review-stale-session-sweep.ts:20-23`). Abandonment never changes the queue, and abandoned sessions never appear in the UI (ruling 17).
  PICKERS. `GET /api/review/pool` (`review-canonical.ts:1397-1401`) returns counts by section, domain and skill plus past sessions with open entries. Labels are computed at read time in the student's timezone.
  CALENDAR. The calendar reads `review_schedule(student_id, status, queued_at)` and answered `review_session_items`. Review never reads calendar tables. Doc 05F, not "future Doc 04", is the owning document; see SCL-115 to SCL-118.
  TARGET STATE. SM-2 intervals and tutor-in-review, both re-addable by additive migration; neither exists at launch.
Rationale: the old review runtime targeted a schema that no longer existed and returned 503 in production. It was removed (PR #794), the schema was rebuilt (#795), the API rewritten (#799) and the UI built (#807), with fixes in #815 and #824. The rulings that produced this shape are recorded in `docs/contracts/review-contract.md` and in the migration's own comments, cited by number above: 4 (one correct answer graduates, `20260921000000:392`), 6 (polymorphic `source_session_id`, no stub code for full-length), 7 (oldest first), 9 (LISA out at launch), 11 (item id is the mastery event id), 12 (supersede, do not mutate), 17 (abandoned sessions appear in no open list), 18 (a retired question keeps its entry and stops being poolable), 19 (no stored question metadata), 21 (`review_question_history`, a `security_invoker` view granted to `service_role` only). The spec's SM-2 model is not wrong as a target; it is wrong as a description of the launch engine, and §16 currently reads as the latter.
Evidence: migration `supabase/migrations/20260921000000_review_queue_runtime.sql`; PRs #794, #795, #799, #807, #815, #824; an owner production walk on 2026-09-22 covering six attempts keyed to item ids, with every queue transition verified row by row (3 wrong -> `superseded` plus a new `active` row with `source_engine: review`; 3 correct -> `graduated`; `closed_by_item_id` == attempt id == session item id on all six; two sessions ended from the landing page and the question screen, both `abandoned`, both leaving their queue entries `active`). Production re-verified for this entry on 2026-09-22: `review_schedule` carries exactly the thirteen columns above, `trg_practice_item_enqueue_review` and `trg_review_item_resolve` are installed, and `review_queue_record` / `review_queue_graduate` / `review_item_resolve` exist.
Supersedes: CR-02B-03 in part (SM-2 and tutor-led pre-submission reasoning at launch), CR-02B-16 in whole (tutor-assisted correctness equivalence for SM-2 — there is no SM-2 and no tutor), CR-02B-23 in whole (`review_schedule` as a proposed target-state table). CR-02B-29 is RETAINED unchanged; see SCL-111.
Owner action: rewrite §16 as above; record a new change record in Doc 02B §39 and mark CR-02B-03, CR-02B-16 and CR-02B-23 as stated.
Amended 2026-09-22, in place, while still PROPOSED (owner ruling, 2026-09-22 — the ruled plan is now in the repo as `docs/plans/Lyceon_Review_Vertical_Plan.md`, PR #830). Every ruling this entry rests on is sourceable, and the list above was truncated only because the file did not exist when it was written. The full set, from plan §3: 1 (delete the old review layer), 2 (practice misses AND SKIPS both enter the queue — the ruling that reverses §16's "Skipped questions (served but not submitted) do not enter review"), 3 (the practice writer is a trigger on the item's answered-or-skipped update, atomic with the CAS), 4, 5 (backfill existing practice misses and skips through the same queue function, `20260921000000:593`), 6, 7, 8 (all tables altered in place, never dropped and recreated), 9, 11, 12, 13 (a correct practice answer never touches the queue), 14, 15 (prefill the whole pool; the same question may sit in two open sessions), 16 (a review skip requeues at the back), 17, 18, 19, 20 (session picker labels are computed at read time), 21. Ruling 10 belongs to SCL-110. Clause by clause: ENTRY is rulings 2 and 13; WRITERS' compare-and-swap is 3; POOLS' prefill and multiple open sessions is 15; OUTCOMES is 4, 7 and 16; PICKERS is 20; CALENDAR is 14. Nothing in the entry above changes — these are the citations it would have carried.

SCL-110 | 2026-09-22 | Doc 02B §12 gates the review queue behind premium and lists interactive tutor in review as a premium feature; review is free and unlimited for every tier and tutor in review does not exist at launch | PROPOSED
Id: `SCL-110` re-derived at the moment of use, 2026-09-22 (see SCL-109 for the derivation; second of ten sequential allocations this session).
Change: amend Doc 02B §12 (Entitlement Gate System) so review is a free-tier capability with no quota, and so the two tutor-in-review rows describe a deferred capability rather than a premium one. The Free Tier paragraph, the Premium Tier paragraph, four Entitlement Matrix rows, the "Review Entry Accumulation for Free Users" subsection, the freemium thesis in "Why This Matters" and the "Tradeoff Documentation" paragraph are all affected.
WAS, verbatim (Doc 02B V4, same file):
  §12 Premium Tier (`:467`): "Premium users receive unlimited practice, full review with spaced repetition and interactive tutor, full-length exams, tutor in practice and review (absent in active exams), complete mastery breakdown including domain-level and skill-level detail and the competency map, historical trend data, calendar and study plan, and all future premium features."
  §12 Entitlement Matrix (`:476-478`): "| Interactive tutor in review | No | Yes |", "| Review queue access | No (entries accumulate for post-upgrade reveal) | Yes |", "| Spaced repetition | No | Yes |".
  §12 Review Entry Accumulation for Free Users (`:506`): "When a free user misses a practice question, a review queue entry is created in `review_session_items` (or via the target-state `review_schedule` table). Free users cannot access the review surface, so these entries accumulate invisibly. Upon upgrade, the full review queue is visible and actionable. Free users do not see a teaser count for accumulated review items — visibility is either fully hidden (current-state) or fully revealed post-upgrade; no intermediate state to avoid freemium friction."
  §12 Why This Matters (`:514`): "Lyceon's thesis is that practice alone is an insufficient SAT prep experience — students need review (to consolidate learning), tutor (to understand their mistakes), mastery insight (to know what to work on), exams (to measure progress), and a study plan (to organize their time). The free tier gives enough practice to establish a habit and prove question quality; everything else is the product."
  §12 Tradeoff Documentation (`:518`): "Accepting no-free-tutor and no-free-review means some free users will churn before experiencing the product's core value."
IS: review is FREE FOR ALL TIERS, with no quota. Every user's misses and skips enter the queue and every user can work it: the review routes carry no entitlement check and no daily-quota check (ruling 10, recorded in `docs/contracts/review-contract.md:69`). The concurrent-session cap is not a quota — it is a resource guard, counted separately from practice's but read from practice's configured value. Tutor in review is DEFERRED post-launch for both tiers (ruling 9). Spaced repetition (SM-2) is target state, not a tier boundary (SCL-109). The freemium thesis no longer counts review among the paid features; the rest of the thesis — tutor, mastery detail, exams, study plan — stands unchanged, and so does "no-free-tutor" in the tradeoff paragraph.
Rationale: owner ruling 10. A queue of the student's own mistakes is the cheapest thing the platform can give away and the strongest reason to come back; withholding it made the free tier a demo of question quality with no loop. The matrix rows that price it are not merely inaccurate now, they describe a gate no code implements, which is the more dangerous kind of wrong: a reader implementing from §12 would ADD a gate the platform deliberately removed.
Why this surfaced now: the review rebuild shipped a surface that §12 says free users cannot reach.
Owner action: amend §12's two tier paragraphs, the four matrix rows, the accumulation subsection, the thesis sentence and the tradeoff paragraph as above; the "Review queue access" row becomes "Yes | Yes" and "Interactive tutor in review" becomes a deferred row for both tiers.
Supersedes: CR-02B-02 in part — "All other features (review, tutor, exams, mastery detail, calendar) premium" no longer holds for review. The 40-question practice quota and the midnight America/Chicago reset are untouched.
Build artifact: `server/routes/review-canonical.ts` (no entitlement or quota middleware on any review route), `docs/contracts/review-contract.md`.
Amended 2026-09-22, in place, while still PROPOSED: ruling 10 is plan §3 ("Review is free.") and §2 row 7 ("Free daily quota | None; review is free and unlimited"), `docs/plans/Lyceon_Review_Vertical_Plan.md`. The `docs/contracts/review-contract.md:69` citation above stands.

SCL-111 | 2026-09-22 | Doc 02B §20 and §21 describe tutor-in-review as live at launch; it is deferred post-launch, and the architectural answer-withholding rule that governs it must be retained rather than deleted with it | PROPOSED
Id: `SCL-111` re-derived at the moment of use, 2026-09-22 (see SCL-109; third of ten sequential allocations this session).
Change: amend Doc 02B §20 (Reveal Matrix and Enforcement) and §21 (Tutor Runtime Rules) so that the tutor-in-review surface is marked DEFERRED POST-LAUNCH, while the answer-withholding rule stays in the document, in force, for when it is wired. The two review rows of the reveal matrix itself do not change.
WAS, verbatim (Doc 02B V4, same file):
  §20 Per-Endpoint Enforcement (`:1085`): "**Tutor (review pre-submit):** receives question context and options but does NOT receive correct\_answer or explanation. Cannot leak what it doesn't have."
  §21 Surface-Aware Behavior (`:1115`): "**In review (pre-submit):** Tutor is available before submission. Student reasons with tutor support. Tutor receives question stem, passage, options, and student's in-progress reasoning — but **NOT the correct answer or explanation**. This architectural answer-withholding (per CR-02B-29) prevents leakage regardless of prompt behavior. Tutor guides by Socratic questioning without having the answer to leak."
  §21 Question Awareness (`:1150`): "| Review (pre-submit) | Yes | **No** | **No** | In-progress reasoning only |".
IS: nothing in review reads or writes `tutor_messages`, and `review_error_attempts.used_tutor` is written `false` by the trigger on every row (`20260921000000_review_queue_runtime.sql:509`, "ruling 9: LISA is out at launch"). The column exists and is always `false` at launch.
  RETAINED UNCHANGED: the rule that tutor context in review carries no `correct_answer`, no `explanation` and no `option_metadata` before submission — CR-02B-29 — together with §20's and §21's statements of it. It is not deleted along with the surface it governs; it is the precondition for ever wiring that surface.
  UNCHANGED AND HOLDING AS BUILT: §20's two review rows, "Review pre-submission question: stem, passage, options, assets. No correct\_answer, explanation, option\_metadata" (`:1082`) and "Review post-submission response: correctness, correct answer key, explanation. No option\_metadata" (`:1083`). The rebuilt engine implements exactly this through one sanitizer, `toStudentSafeQuestionDTO`.
Rationale: owner ruling 9. The danger in this amendment is the obvious edit — striking the tutor-in-review paragraphs entirely — because CR-02B-29 is the only place the answer-withholding architecture is written down, and a future tutor-in-review build that starts from a §21 with no review row would have no rule to implement against. Deferring a surface and deleting its safety rule are different edits; only the first is authorised here.
Why this surfaced now: the rebuild shipped review with no tutor, so the document now describes a live surface that does not exist.
Owner action: mark the §21 review-pre-submit paragraph and the §20 tutor-review-pre-submit bullet DEFERRED POST-LAUNCH, keeping their text as the rule for when it lands; keep the §21 Question Awareness row; state explicitly that CR-02B-29 is retained.
Build artifact: `supabase/migrations/20260921000000_review_queue_runtime.sql:509`, `docs/contracts/review-contract.md:86-89`.
Amended 2026-09-22, in place, while still PROPOSED: ruling 9 is plan §3, "LISA is out at launch; `used_tutor` stays `false`", `docs/plans/Lyceon_Review_Vertical_Plan.md`.

SCL-112 | 2026-09-22 | Doc 02B §22 says review has no resume and abandons in-progress work; review sessions resume exactly as practice sessions do, and §22 as written contradicts Doc 05F §15.1 | PROPOSED
Id: `SCL-112` re-derived at the moment of use, 2026-09-22 (see SCL-109; fourth of ten sequential allocations this session).
Change: replace Doc 02B §22's "Review Session Resume" subsection.
WAS, verbatim (Doc 02B V4, same file, §22 Review Session Resume, `:1208`): "Review is queue-based. No "resume" per se; student returns, sees current due items. In-progress tutor interactions (attempted but not submitted) are abandoned at launch (per §21); item remains in queue for fresh attempt."
IS: review sessions resume exactly as practice sessions do — by URL (`/review/session/:sessionId`) and from the open-session list, with the served item restored from the session's own snapshot. Several sessions may be open at once, up to practice's `max_concurrent_sessions`. Ending a session, or the 7-day sweep abandoning it, leaves every queue entry untouched: the questions come back in the next session's pool (ruling 17, `server/lib/review-stale-session-sweep.ts:29-33`). Abandoned and completed sessions appear in no open list, on either engine. "First finalized submission wins for the attempt instance", §22's existing Concurrent Submission Resolution rule for review (`:1225`), is UNCHANGED and is enforced by the item's compare-and-swap UPDATE.
Rationale: rulings 17 and 18. §22 as written is not merely stale — it contradicts another locked document. Doc 05F §15.1 makes `CalendarLaunchService` the sole owner of a session-create idempotency key forwarded unchanged to the engine, which presumes a resumable session to return to; and Doc 05F §9.3's review adapter is specified against `review_session_items` rows that only exist because the session materialises its pool at creation. A queue-based surface with "no resume per se" has no such rows.
Why this surfaced now: the rebuild made review a prefilled, resumable session engine, and the production walk exercised both resume paths.
Owner action: replace the §22 Review Session Resume paragraph as above; leave the §22 review concurrency rule alone.
Build artifact: `client/src/pages/resume-review.tsx`, `server/routes/review-canonical.ts` (resume and state routes), `server/lib/review-stale-session-sweep.ts`, PR #807.
Amended 2026-09-22, in place, while still PROPOSED — CITATION CORRECTED. This entry cites "rulings 17 and 18", taken from the brief before the ruled plan was in the repo. With plan §3 readable (`docs/plans/Lyceon_Review_Vertical_Plan.md`), ruling 18 is "A retired question's queue entry is left alone. The servable join excludes it everywhere" and supports nothing here. The correct pair is 15 and 17: ruling 15, "Prefill the whole pool (1a). The same question may sit in two open sessions (2)", is what carries the several-open-sessions clause, and ruling 17 stands for abandonment and the open list. Owner concurs, 2026-09-22: "SCL-112 and SCL-116 cited ruling 18, which is about retired questions and supports neither." Read the Rationale line above as "rulings 15 and 17".

SCL-113 | 2026-09-22 | Doc 02B §8 lists `review_schedule` as proposed, `review_session_events` as phasing out and `review-session-routes.ts` as the review writer; the first is in production, the second does not exist, and the third was deleted | PROPOSED
Id: `SCL-113` re-derived at the moment of use, 2026-09-22 (see SCL-109; fifth of ten sequential allocations this session).
Change: amend Doc 02B §8 (Schema Integration and Canonical Tables) — the Review Runtime table, the Canonical Writer Map row, the Runtime Configuration row for `review_runtime_config`, and the Prefill Timing Variation bullet for review.
WAS, verbatim (Doc 02B V4, same file):
  §8 Review Runtime (`:266-270`): "| Session envelope | `review_sessions` | Canonical; owned by `review-session-routes.ts` |", "| Legacy event log | `review_session_events` | Phasing out per CR-02B-28 |", "| SM-2 scheduling | `review_schedule` (proposed new) | Per-(profile, question) scheduling state; target-state addition per CR-02B-23 |".
  §8 Canonical Writer Map (`:322`): "| Review runtime | `review-session-routes.ts` | review\_sessions, review\_session\_items, review\_error\_attempts, review\_session\_events (legacy phase-out), review\_schedule (target) |".
  §8 Runtime Configuration (`:311`): "| Review runtime config | `review_runtime_config` | SM-2 intervals, ease factors, graduation thresholds |".
  §8 Prefill Timing Variation (`:339`): "**Review:** Queue-based, no session-creation prefill per se. Due items surface continuously; no session-scoped materialization. §16 documents this."
IS, verified against production on 2026-09-22:
  `review_schedule` IS IN PRODUCTION, since 2026-09-21, in the shape SCL-109 describes — not a proposal and not SM-2 state. Its thirteen columns are `id`, `student_id`, `question_id`, `queued_at`, `source_engine`, `source_session_id`, `source_item_id`, `source_outcome`, `status`, `closed_at`, `closed_by_item_id`, `created_at`, `updated_at`.
  `review_session_events` DOES NOT EXIST. It is absent from production's `public` schema, from `supabase/migrations/`, and from `scripts/ci/genesis-schema.expected.sql` (zero occurrences). It survives only in `docs/SpecAudit/_legacy-migrations/supabase-migrations-preBaseline/`. It is dropped, not phasing out.
  WRITERS. `review_schedule` and `review_error_attempts` have exactly two writers, both triggers (`trg_practice_item_enqueue_review`, `trg_review_item_resolve`); the API never writes either. `review_sessions` and `review_session_items` are written by `server/routes/review-canonical.ts`. `review-session-routes.ts` no longer exists — PR #794 deleted it.
  `review_error_attempts` IS FROZEN IN SHAPE. Nine functions read it in production and none of them belong to review: `canonical_mastery_events`, `canonical_mastery_events_for_student`, `compute_streak_days`, `compute_longest_streak_days`, `refresh_skill_kpi`, `refresh_domain_kpi`, `refresh_section_kpi`, `refresh_overall_kpi`, `execute_account_deletion_cascade`. The only other function naming the table is its own writer, `review_item_resolve`.
  `review_runtime_config` RETAINS ITS KEYS AND THEY ARE INERT. Production holds exactly seven: `sm2_initial_interval_days`, `sm2_second_interval_days`, `sm2_initial_ease_factor`, `sm2_ease_factor_min`, `sm2_ease_factor_max`, `sm2_graduation_repetition_count`, `tutor_assisted_equivalence`. No review code reads any of them. Review reads PRACTICE's session limit (`loadPracticeConfig()`, `review-canonical.ts:502`) and practice's abandonment TTL (`STALE_PRACTICE_SESSION_TTL_DAYS`, imported).
  PREFILL. Review prefills like practice: the whole pool at session creation, or `target_count` items when a size is given. The §8 bullet is the exact opposite of what runs.
  Also in production and not in §8: `review_question_history`, a `security_invoker` view over the queue granted to `service_role` only (ruling 21, `20260921000000:553-560`).
Rationale: rulings 8, 12, 14, 17, 19 and 21. §8 is the table-level map engineers implement from; three of its five review rows name artefacts that do not exist, and the prefill bullet would lead an implementer to build the wrong thing.
Why this surfaced now: PR #795 rebuilt the schema and PR #794 deleted the old writer.
Owner action: amend the four §8 items above; add `review_question_history` to the Review Runtime table; note in the Runtime Configuration row that the SM-2 keys are retained for the target state and read by nothing.
Adjacent, not superseded: SCL-002's Q3 ruling classifies `review_schedule` as L1 identity-linked state for the hard-delete cascade. That classification survives this entry unchanged.
Supersedes: CR-02B-28 as it applies to `review_session_events` — there is nothing left to phase out. Its `practice_events` half stands.
Build artifact: `supabase/migrations/20260921000000_review_queue_runtime.sql`, `server/routes/review-canonical.ts`, `server/services/review-pool.ts`, `server/lib/review-stale-session-sweep.ts`, `scripts/ci/genesis-schema.expected.sql`.
Amended 2026-09-22, in place, while still PROPOSED: ruling 8 is plan §3, "All tables are altered in place, never dropped and recreated" (`docs/plans/Lyceon_Review_Vertical_Plan.md`) — which is why `review_schedule` is the same table §8 calls proposed rather than a new one beside it. Rulings 12, 14, 17, 19 and 21 are the same section.

SCL-114 | 2026-09-22 | Eight further passages of Doc 02B restate the old review model — the naming list, the surface model, the quota rationale, four event-log references, the constants doctrine, the debt register, the refactor checklist and three worked examples | PROPOSED
Id: `SCL-114` re-derived at the moment of use, 2026-09-22 (see SCL-109; sixth of ten sequential allocations this session).
Change: a consistency sweep. These passages are not independent decisions; each restates a claim that SCL-109 to SCL-113 amend, and each becomes false once those land. They are logged as one entry because they share one cause and one edit.
WAS, verbatim (Doc 02B V4, same file), with what each becomes:
  §6 Naming Conventions (`:154`): "Review: `review_sessions`, `review_session_items`, `review_error_attempts` (canonical); `review_session_events` legacy; `review_schedule` proposed new table for SM-2" -> `review_session_events` struck; `review_schedule` canonical and in production, not for SM-2 (SCL-113).
  §9 Runtime Surface Model (`:360`): "Review replays the original missed question (not a similar-question variant) with tutor assistance available **before submission** — the student reasons through the question with tutor support, submits, and sees whether they understood. Review is governed by spaced repetition: correctly retrieved items resurface at expanding intervals; missed items resurface sooner." -> original-item replay stands; the tutor clause and the spaced-repetition clause become target state (SCL-109, SCL-111). Misses AND SKIPS enter.
  §13 Freemium Quota (`:574`): "Questions viewed in review surfaces (review is premium-only anyway)" -> the parenthetical is false; review is free (SCL-110). The rule it qualifies — review questions do not count against the practice quota — is correct and stands, for a different reason: review has no quota at all.
  §8 Verification Before Refactor (`:350`), §25 Runtime Event Flow (`:1419`), §26 Verification Before Refactor (`:1467`), §29 Failure Modes (`:1563`), §34 Known Architectural Debt (`:1833`) and §36 Verification Before Refactor Checklist (`:1967`) each name `review_session_events` as a legacy writer to be phased out or watched -> struck in all six places; the table does not exist (SCL-113). The brief that commissioned this entry named §26 and §29; the other four were found by sweep and are reported here rather than left.
  §33 Constants Doctrine (`:1758`): "**SM-2 interval changes take effect on next schedule computation,** not retroactively. Already-scheduled review items keep their existing `next_review_at` until they're processed." -> target state; there is no SM-2 at launch and no `next_review_at` column (it was renamed to `queued_at`).
  §40 Example One (`:2183`, `:2187`, `:2193`): "a review queue entry is created (free user accumulation per §12)"; the upgrade CTA "Upgrade to unlock unlimited practice, interactive tutor, review with spaced repetition, and full-length exams"; and "The review entry from the wrong answer is now visible and has SM-2 schedule." -> all three corrected per SCL-110: the entry is created and is immediately visible and actionable, the CTA no longer sells review, and there is no SM-2 schedule. The brief named one line here; there are three.
  §40 Example Three (`:2239-2261`, "SM-2 Review Trajectory for One Item Over 30 Days") and Example Four (`:2263-2302`, "Tutor-in-Review with Architectural Answer-Withholding") -> marked TARGET STATE in full. Both are internally consistent and both describe behaviour that does not exist; Example Four remains the clearest statement of CR-02B-29, which SCL-111 retains.
IS: as stated inline above.
Rationale: an amendment to §16 that leaves eight passages contradicting it produces a document that argues with itself, and the next reader cannot tell which half is current. This is the sweep the naming doctrine in §6 exists to force.
Why this surfaced now: SCL-109 to SCL-113.
Owner action: apply the eight edits above together with SCL-109 to SCL-113, or not at all.
Build artifact: none; this entry is a consequence of the others.

SCL-115 | 2026-09-22 | Doc 05F §4's review seam row names `review_schedule(next_review_at, status)` and `review_sessions(source_origin, client_instance_id)`; the column was renamed and `source_origin` was dropped | PROPOSED
Id: `SCL-115` re-derived at the moment of use, 2026-09-22 (see SCL-109; seventh of ten sequential allocations this session).
Change: replace the review row of Doc 05F §4 (Cross-Document Seam Table).
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:140`): "| Review due / create / items | Doc 02B §16 | `review_schedule(next_review_at, status)`; `review_sessions(source_origin, client_instance_id)`; the canonical finalized Review activity timestamp on `review_session_items`, verified under G-08-03 | Review adapter; due-by-date; counter reads items. |"
IS: `review_schedule(student_id, status, queued_at)`; `review_sessions(status)`; `review_session_items(status, answered_at, question_section, question_domain, question_skill)`.
  `next_review_at` was RENAMED to `queued_at` (`20260921000000_review_queue_runtime.sql:95`), and the SM-2 columns beside it — `repetition_count`, `interval_days`, `ease_factor`, `first_missed_session_id` — were dropped (`:98-102`). The same migration updated `calendar_build_plan_input` accordingly, in a section headed "Calendar (agreed with the calendar team, ruling 14)" (`:658`).
  `source_origin` NEVER EXISTED and does not exist now: production's `review_sessions` columns are `id`, `student_id`, `actor_id`, `mode`, `filters`, `target_count`, `status`, `platform`, `client_instance_id`, `created_at`, `updated_at`, `last_activity_at`, `completed_at`, `abandoned_at`. See SCL-118.
  The activity timestamp is no longer deferred: it is `review_session_items.answered_at`, with the finalized predicate `status = 'answered'`, matching practice's own seam row (§4, `:139`) field for field. `review_session_items` carries both `answered_at` and `occurred_at` in production; `answered_at` is the one the adapter reads, and naming it in the seam table is what stops the wrong one being picked.
Rationale: ruling 14, agreed with the calendar team and executed in the migration. A seam table that names a renamed column and a column that never existed cannot be implemented from.
Why this surfaced now: the review rebuild renamed the column the calendar reads.
Owner action: replace the §4 review row as above.
Build artifact: `supabase/migrations/20260921000000_review_queue_runtime.sql:95-102, 658+`; production column list verified 2026-09-22.
Amended 2026-09-22, in place, while still PROPOSED: ruling 14 is plan §3 in full — "`next_review_at` becomes `queued_at`. Drop the SM-2 columns and `first_missed_session_id`. The calendar changes two lines in the same migration, as the calendar team agreed." (`docs/plans/Lyceon_Review_Vertical_Plan.md`).

SCL-116 | 2026-09-22 | Doc 05F §9.3's review adapter passes `source_origin='calendar'`, defers its activity timestamp to G-08-03 and declares no terminal state; all three must be restated against the engine as built | PROPOSED
Id: `SCL-116` re-derived at the moment of use, 2026-09-22 (see SCL-109; eighth of ten sequential allocations this session).
Change: replace the `create` and `activityUnits` bullets of Doc 05F §9.3 (Review adapter) and add a `progress` bullet.
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:448-449`):
  "- `create(block, size)` → review session create with `source_origin='calendar'`, `client_instance_id`, `ctx.idempotency_key` forwarded unchanged (SCL-08-B); the review surface shows "Clear N due" from the block."
  "- `activityUnits(date)` → one unit per finalized `review_session_items` row on the local date, using the exact canonical Review activity timestamp and ownership join verified under G-08-03 (Doc 08 does not invent the column). `matches` → `unit.engine = 'review'`. `nextLaunchSize` → `remaining`; the review surface shows "Clear N due" with `N = size`. No terminal state needed."
IS:
  `create(block, size)` -> `mode='queue'`, `target_count = size`, `platform`, `client_instance_id`, and `ctx.idempotency_key` forwarded unchanged and stored as practice stores it. NO `source_origin`: the column does not exist and the calendar records its own launches (SCL-118). The rest of the bullet — "Clear N due" from the block — is unchanged.
  `activityUnits(date)` -> one unit per `review_session_items` row with `status = 'answered'` on the local date of `answered_at`; `unit_id` = the item's id; section, domain and skill from the item's `question_section`, `question_domain`, `question_skill` columns; ownership through `student_id`. `matches` and `nextLaunchSize` are unchanged.
  `progress` -> review DOES have terminal states, so the adapter needs the mapping it currently declares unnecessary: `created` or `active` -> active; `completed` -> completed; `abandoned` -> abandoned (`20260921000000_review_queue_runtime.sql:208-212`).
Rationale: calendar seam brief items H1 to H3, and rulings 11 and 18. The `unit_id` choice is ruling 11's consequence and not a free one: the review item's id is also the attempt row's id and the mastery event id, so a calendar unit keyed on it joins to the mastery record without a second identifier.
Why this surfaced now: the rebuilt engine gave review the session lifecycle §9.3 was written without.
Owner action: replace the two bullets and add the third.
Note, recorded because the entry would be incomplete without it and NOT proposed as a change here: `review_estimated_seconds_per_item = 120` (Doc 05F §23 SCL-08-F, Appendix `:782`) was set on the assumption of a LISA conversation per item. LISA is out of review at launch (ruling 9, SCL-111), so the estimate is now high by an unmeasured margin. The constant is calendar-owned until Doc 02B claims it, so no change is proposed here; it is flagged for the calendar owner.
Build artifact: `supabase/migrations/20260921000000_review_queue_runtime.sql`, `server/routes/review-canonical.ts`; production column list for `review_session_items` verified 2026-09-22.
Amended 2026-09-22, in place, while still PROPOSED — CITATION CORRECTED, and one clause of the IS is WRONG. (a) Citations: this entry cites "rulings 11 and 18", again from the brief. Ruling 18 is about retired questions and supports nothing here; the correct set is 11, 15 and 17 (`docs/plans/Lyceon_Review_Vertical_Plan.md` §3) — ruling 15, "The whole pool at creation, or the calendar's size", is what licenses `target_count = size`, and ruling 17 is what gives review the terminal states the `progress` mapping needs. Ruling 11 stands and was already load-bearing for `unit_id`. (b) CORRECTION: the `activityUnits` bullet above says the unit carries "section, domain and skill from the item's `question_section`, `question_domain`, `question_skill` columns". THE UNIT HAS NO SKILL FIELD. `activityUnitSchema` (`packages/shared/src/calendar/allocate.ts:61-72`) is `.strict()` and its whole shape is `engine`, `unit_id`, `occurred_at`, `local_date`, `section`, `domain`, `form_id`; a `skills` key would be REJECTED at parse. The bullet should read: one unit per `review_session_items` row with `status = 'answered'` on the local date of `answered_at`, carrying `unit_id` = the item's id, `section` and `domain` from `question_section` and `question_domain`, `form_id: null`, and ownership through `student_id`. The rest of the entry is confirmed against the shipped adapter, 2026-09-22 — see the verification line below. (Doc 05F §9.2's PRACTICE bullet names `skills = question_skill IS NULL ? [] : [question_skill]` and is stale against the same `.strict()` schema; that is 05F-owned and outside this entry, reported to the owner rather than amended here.)
VERIFIED AGAINST THE SHIPPED ADAPTER, 2026-09-22 (`server/services/calendar/adapters/review.ts`, PR #825, branch `claude/calendar-review-enable`): `create` passes `poolSpec: { mode: "queue" }`, `targetCount: size` ("THIS launch's size, not the block target"), `clientInstanceId`, and `idempotencyKey` forwarded unchanged, with no `source_origin` — SCL-118 confirmed. `activityUnits` filters `.eq("status", "answered")` and windows `.gte/.lt` on `answered_at` (`:140-144`), which is this entry's predicate exactly, and the adapter's own note gives a sharper reason than this entry did: "`status = 'answered'`, never `answered_at IS NOT NULL`. A SKIPPED review item carries a non-null `answered_at` too -- production has such rows today -- and a skip is not retrieval." `progress` maps `completed`/`abandoned` to themselves and `created`/`active` to active (`:183-193`), as stated.

SCL-117 | 2026-09-22 | Doc 05F §20's deploy gate G-08-03 clears on an SM-2 writer and a `source_origin` parameter, neither of which will ever exist; the gate must name what actually proves the seam | PROPOSED
Id: `SCL-117` re-derived at the moment of use, 2026-09-22 (see SCL-109; ninth of ten sequential allocations this session).
Change: replace the G-08-03 row of Doc 05F §20 (Forward References, Deploy Gates, Audit Rule).
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:754`): "| G-08-03 | `review_schedule` SM-2 writer live; review create accepts `source_origin='calendar'` + key (SCL-08-B); **exact canonical Review activity timestamp, ownership join, and finalized-unit predicate verified against the installed schema** — the adapter consumes that field, Doc 08 does not name one | Review wave |"
IS, four clauses, all satisfiable and three already satisfied:
  1. The review QUEUE writer is live — both triggers, `trg_practice_item_enqueue_review` and `trg_review_item_resolve`, in production since 2026-09-21. There is no SM-2 writer and there will not be one at launch (SCL-109).
  2. Review create accepts the opaque idempotency key. `source_origin` is struck (SCL-118).
  3. The activity timestamp is `review_session_items.answered_at`, the finalized predicate is `status = 'answered'`, and ownership is `student_id` — as declared by Doc 02B §16 as amended (SCL-109) and named in the §4 seam row (SCL-115), so the gate no longer defers the naming.
  4. `tests/ci/calendar.launch-contract.review.test.ts` passes against the REAL review API, with `create` SUCCEEDING.
  CORRECTION TO THE BRIEF THAT COMMISSIONED THIS ENTRY, recorded rather than adapted: the brief states that this contract test "was referenced by Doc 05F but never shipped". It shipped on 2026-09-18 and is in the tree. What is true is narrower and is what clause 4 pins: the file today asserts the contract against the STUB adapter, whose `create` DECLINES, and its own header says so — "The review engine has not shipped. Its adapter is a stub that fails OPEN... When the real engine lands, it must pass this file with `create` SUCCEEDING instead of declining — every other assertion here stays exactly as written." The gate clears when that swap is made, not when the file appears.
Rationale: calendar seam brief H4. A deploy gate whose clearing condition is a writer the platform has ruled out cannot ever be cleared, which makes it a permanent block rather than a gate.
Why this surfaced now: the review wave landed and the gate's conditions did not survive it.
Owner action: replace the G-08-03 row with the four clauses above.
Build artifact: `tests/ci/calendar.launch-contract.review.test.ts`, `server/services/calendar/adapters/stub.ts` (the adapter the test pins today).
Amended 2026-09-22, in place, while still PROPOSED: clause 4 of the restated gate is now MET. `server/services/calendar/adapters/review.ts` is the real adapter, not the fail-open stub, and `tests/ci/calendar.launch-contract.review.test.ts` runs against it with `create` succeeding. Production, read 2026-09-22: `calendar_runtime_config.enabled_block_types` is `["practice", "review"]` (seam item H7), `calendar_build_plan_input` joins `servable_questions` (H5), and three `review` rows exist in `calendar_blocks`. Clauses 1 to 3 were already met. STATE WORTH THE OWNER'S EYE, recorded because it is the kind of thing a register exists to catch: the two enabling migrations (`20260925000000`, `20260928000000`) are applied to PRODUCTION but exist on NO integration branch — `git ls-tree` finds them only on `claude/calendar-review-enable` (PR #825, open). The database is ahead of every mergeable branch, and the adapter that serves the flag production has already flipped is in that same unmerged PR.

SCL-118 | 2026-09-22 | Doc 05F §23's open item SCL-08-B asks Doc 02B for `source_origin='calendar'` on review create; the column does not exist and the calendar records its own launches | PROPOSED
Id: `SCL-118` re-derived at the moment of use, 2026-09-22 (see SCL-109; tenth and last of ten sequential allocations this session).
Change: amend the SCL-08-B open item in Doc 05F §23 (Open Items and SCLs).
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:819`): "2. **SCL-08-B** — Doc 02B review seam: `source_origin='calendar'`, opaque idempotency key on create, "Clear N due" header."
IS: drop `source_origin`. The opaque idempotency key on create and the "Clear N due" header stand. Review stores the key as practice stores it, and the calendar records its own launches in `calendar_block_launches` — the engine does not need to carry the calendar's provenance for the calendar to know what it launched.
  `source_origin` is not a column review lost in the rebuild; it is a column review never had. Production's `review_sessions` has no such column, and neither the rebuilt schema nor its predecessor defines one.
Rationale: as SCL-116. Asking another document for a field that duplicates a record you already hold is a seam that costs both sides and buys nothing; the ask is withdrawn rather than met.
Why this surfaced now: the review rebuild closed out the seam and the ask was never satisfiable.
Owner action: amend the SCL-08-B line; nothing else in §23 changes.
Build artifact: production column list for `public.review_sessions`, verified 2026-09-22.

SCL-119 | 2026-09-23 | SCL-079's proposed spec text binds the INV-03-02 live-exam gate to `full_length_exam_sessions.user_id`, a pre-baseline table that no migration creates and that the Doc 04 family replaces with `test_sessions.student_id`; and since E1 the gate SCL-032 and SCL-079 both describe does not exist anywhere in the build | PROPOSED
Id: `SCL-119` allocated 2026-09-23 as max+1 across every remote branch (max SCL-118 on `origin/calendar` and siblings); first of two sequential allocations this session (SCL-120 is on `claude/e2-scoring-catalogue`).
Change: restate the table, column and live-state predicate that SCL-079 proposes for Doc 03B §3.4 / INV-03-02 and Doc 01 V8 §27.3 step 6, against the Doc 04A schema; and record that, from E1 until E9, the gate is not implemented.
WAS, verbatim (SCL-079 IS, this log): "query error → `return false` (fail OPEN), log warning. Table name corrected to `full_length_exam_sessions`. Column corrected to `user_id`. When the query succeeds: active exam row → `true` (block, INV-03-02 enforced); no row → `false` (allow)."
  And (Doc 01 V8 §27.3, `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1187`): "6. **Live exam not in progress** — if `blocked_during_live_exam`, check no active full-length exam → else `live_exam_in_progress`"
IS: the live-exam check reads Doc 04A's session header — `test_sessions` (Doc 04A V2.2 §5.3), keyed on `student_id`, "live" meaning `state = 'active'`. SCL-079's fail-OPEN posture on query error, and SCL-032's scope (POST /api/tutor/messages only), are unchanged. `full_length_exam_sessions` and `user_id` are struck from SCL-079: they named a pre-baseline table that no migration in `supabase/migrations/` creates and that the Doc 04 rebuild does not reintroduce.
  OPEN QUESTION for the owner, recorded rather than decided: whether `state = 'section_break'` also counts as live. Doc 04A §3 (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:138`) says "Doc 03 governs tutor behavior while the session is `active`", which reads as `active` only; a student on the 10-minute break between sections is mid-exam by any plain reading. The IS above takes the literal 04A text.
INTERIM, stated so SCL-032 and SCL-079 are not read as describing live code: E1 (exam deletion, 2026-09-23) removed `EntitlementService.isLiveExamInProgress` and the POST /messages gate that called it (`server/routes/tutor-runtime.ts`, step 4). In production the gate queried a table that does not exist and failed open on every call (SCL-079), so it blocked nothing; removing it changed no observable behaviour. But from E1 onward Doc 01 §27.3 step 6 and INV-03-02 have NO enforcement anywhere, and `entitlement_features.blocked_during_live_exam = true` on `tutor_access` has no reader. This is tracked as G-EX-06: the live-exam tutor gate is restored in E9 against the real `test_sessions`, and the exam vertical does not close until it is. The `tutor_unavailable_during_live_exam` error code stays in the Doc 03B §5.9 taxonomy for that reinstatement.
Rationale (owner ruling 2026-09-23): SCL-079 corrected a table name to one that was itself pre-baseline; left as written, it would direct E9 to rebuild the gate against a table the Doc 04 family never creates. The interim is recorded here because the only other record of it is a code comment, and a comment is not a gate.
Why this surfaced now: E1 deleted the pre-baseline exam runtime, and with it the gate's only data source and the gate itself.
Owner action: amend SCL-079's IS as above (or fold both into Doc 03B §3.4 on its next revision), and rule on the `section_break` question. G-EX-06 closes when E9 restores the gate; this entry is then marked with the E9 artifact.
Build artifact: `claude/e1-exam-deletion` — `server/services/entitlement-service.ts` (`isLiveExamInProgress` removed), `server/routes/tutor-runtime.ts` step 4 (removal note citing G-EX-06), `tests/ci/exam-gate-fail-open.ci.test.ts` (deleted with the function).
