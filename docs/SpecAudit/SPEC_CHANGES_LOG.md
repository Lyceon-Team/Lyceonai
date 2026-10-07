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

SUPERSEDED IN PART, 2026-09-25 — see SCL-159. Locked documents are no longer
amended at all, so the outcome test above cannot be read literally: "the owner
amends a document" would never be true and every entry would route to a plan
entry. The test is restated, and the boundary it draws is unchanged in substance:

  - Outcome is a change to the system's SPECIFIED BEHAVIOUR  -> SCL, recorded here
  - Outcome is a way of working in this repo                 -> plan entry

The worked examples above all still land on the same side: SCL-070, SCL-072 and
SCL-073 record specified behaviour; the error-class and citation-column examples
record ways of working. Nothing filed before this date is reclassified.

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
- Entry IDs: `SCL-194` (sequential).

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

SCL-079 | 2026-09-01 | WITHDRAWN 2026-09-25 — Doc 03B §3.4 / INV-03-02 — live exam gate fails OPEN on query error | RULING
Status 2026-09-27 (E11 register closeout): PROPOSED -> RULING, WITHDRAWN. Superseded by the owner's standing LISA ruling of 2026-09-25 (E9 rulings, R6): "R6 is withdrawn entirely. Drop it from E9. … the section_break question in SCL-126 is moot … and the SCL-079 fail-open reversal is unnecessary because there's no gate to fail either way." The live-exam tutor gate (G-EX-06) was CLOSED BY WITHDRAWAL, not built: no LISA surface exists in the exam, and `server/routes/tutor-runtime.ts` carries no gate. That removal comment still reads "restored in E9"; it is stale, and correcting it is application code, outside E11. So the fail-open reversal this entry proposed has nothing left to amend.
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

SCL-032 | 2026-08-15 | WITHDRAWN 2026-09-25 — Doc 03B §5.5 step 4 vs implementation scope for INV-03-02 (live exam gate on POST /messages only) | RULING
Status 2026-09-27 (owner ruling): OPEN -> RULING, WITHDRAWN, the same form as SCL-079 and SCL-126. It describes the same INV-03-02 live-exam tutor gate the owner's standing LISA ruling of 2026-09-25 removed (E9 rulings, R6: "R6 is withdrawn entirely. Drop it from E9."). The gate (G-EX-06) was closed by withdrawal, not built. Owner, 2026-09-27: "Leaving one of three entries OPEN is how someone rebuilds the gate from a register that appears to still want it."
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
SCL-175 | 2026-08-06 | Doc 03A §18.4, Doc 03B §4.1 (fifth question-FK column + wire-contract Zod schemas) | OPEN (owner-promoted 2026-08-14)
Id: `SCL-175`, RENUMBERED from `SCL-024` on 2026-09-26 under the owner's standing authority of that
  date to resolve every duplicate id in this file. Two entries headed `SCL-024`: 2026-08-04 (config
  table shape + question FK type) and this one, 2026-08-06. The register's HARD OVERRIDE decides it —
  the LATER allocation renumbers, measured by the entry's own date — so 08-04 keeps `SCL-024` and this
  entry moves. Blast radius measured before the move, not assumed: every reference to `SCL-024` outside
  this file names the 08-04 entry — `docs/Spec/Doc 03D — LISA Evaluation & Quality V1.2.md:316,651`
  ("SCL-024 concerns config table shape and question FK types"), `server/services/tutor-config.ts:2,175`
  (as `SCL-024a`, the Doc 01A §8 config template) and `.github/workflows/ci.yml:65` (a mention of the
  collision itself). NOTHING outside this file cited this 08-06 entry, so no citation breaks — which
  matters because the Doc 03D citation is in `docs/Spec`, read-only and unfixable from here.
  New id derived at the moment of use: `git fetch --all --prune`, then `git grep -hoE 'SCL-[0-9]{3}'`
  over `docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 114 remote refs (max `SCL-174`), then every one
  of the 7 open PRs (#919 #918 #917 #916 #915 #861 #728) for numbers not yet on a branch — none above
  174. Allocated 175, 176, 177 in one pass, ascending by each entry's own date; this is the first.
  Internal references to `SCL-024(b)` below are UNCHANGED and remain correct: they point at the 08-04
  entry, which this change does not move.
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
- Doc 03A §18.7/§18.1/§18.2/§18.5 — SCL-024 (config table → Doc 01A §8; retype four question FK columns UUID→TEXT)
- Doc 03A §18.4, Doc 03B §4.1 — SCL-175 (fifth question-FK column; wire-contract Zod schemas) — renumbered from SCL-024 on 2026-09-26
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
AS BUILT, recorded 2026-09-25 — the line above is stale and is corrected rather than replaced. The exemption this entry ruled on was built in `supabase/migrations/20260917100000_deletion_audit_actions.sql`, and HOW it was built is the part worth keeping: `audit_logs` was given its **own** guard function, `public.audit_logs_retention_guard()` (`:65`), with the single exemption gated on a transaction-local GUC, and the `audit_logs_no_mutate` trigger retargeted to it (`:88-89`) under the same name and timing. The shared `public.prevent_update_delete()` was left untouched, and the migration says why (`:85`): "The shared guard is deliberately not modified: nineteen other append-only tables use it and must not inherit this exemption." Twenty tables carry the shared guard in total — 18 `*_config_history`, `mastery_constants_history`, `abuse_score_incidents` — so `audit_logs` was the twentieth, which is why the comment says nineteen others. `public.apply_audit_logs_retention` at `:145` performs the sweep.
  THE PATTERN, worth naming beyond this instance: an exemption was needed for ONE table out of twenty sharing a guard, and it was taken by forking the guard for that one table rather than by adding a conditional to the shared one. A condition in the shared function would have been an exemption nineteen tables could reach — reachable, untested, and silent. Widening a shared guard to serve one caller is how a guard stops guarding.
  This as-built half was previously recorded nowhere as a subject; it appeared only as a passing precedent reference in SCL-105's prose. Found by the 2026-09-25 coverage audit. Status is left PROPOSED: the ruling's own condition is a spec amendment that SCL-159 now says will not happen, and whether the migration is live in the production catalog is not verified from here.

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

SCL-110 | 2026-09-22 | Doc 02B §12 gates the review queue behind premium and lists interactive tutor in review as a premium feature; review is free and unlimited for every tier and tutor in review does not exist at launch | APPLIED
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
Status PROPOSED -> APPLIED, 2026-09-29. Owner ruling (Karl, 2026-09-29, student UI vertical Step 2 ruling 5): "Review: apply SCL-110. Review is free." Under SCL-159, APPLIED means the change is live in code, database or configuration. The code half is on `main` and `cleanup`: every review route is mounted behind `requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection` only (`server/index.ts` `/api/review` mount), with no entitlement and no quota middleware (`server/routes/review-canonical.ts`). No code path reads the `review_full` feature key: `grep -rn "review_full" server packages apps client/src --include=*.ts --include=*.tsx | grep -v test` returns nothing (2026-09-29). What remains: the `review_full` row is still seeded as a premium-tier feature. It gates nothing, because no reader exists, and it is recorded here so a future reader does not wire a gate to it. Production deployment of the review routes is unverified from this session (CLAUDE.md, "Is it deployed?"). The status rests on the owner's ruling and the code on `main`. The student UI vertical (`docs/plans/student-ui/student-ui-vertical.md` §2) treats review as free for every tier.

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

SCL-153 | 2026-09-23 | Doc 06D §6.5 makes the deletion verification a separate job triggered after the T+7 hard-delete completes; nothing built that job, so for five days the record had a table, a writer and a passing test suite and no caller. The verification belongs inside T3 of the deletion itself, and §6.4 step 2's shape validation was never implemented | PROPOSED
Id: `SCL-153` (originally `SCL-119`, then `SCL-128`) re-derived at the moment of use, 2026-09-23, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref, and cross-checked against all eight open PRs (#849, #848, #847, #846, #845, #843, #778, #728 — every head is an in-repo branch already covered by the fetch). Highest allocated anywhere is `SCL-118` (`origin/cleanup`). No collision. Single allocation.
RENUMBERED 2026-09-25 (twice, and the second time is the interesting one): allocated as `SCL-119` on 2026-09-23 (max was SCL-118 on every remote branch). The LISA workstream allocated `SCL-119` the same day for Doc 03B §7.5, and this entry was moved to `SCL-128` when that collision was resolved — but `SCL-128` had already been allocated on 2026-09-24 by the Doc 04B scoring workstream, so the fix created a second collision. `scripts/ci/scl-duplicate-check.mjs` caught it on `cleanup`, where it was failing `ci` on the base branch for everyone, independent of any one PR.
WHY THIS ENTRY YIELDED AND NOT THE 2026-09-24 ONE, which is the opposite of what the date tiebreak says on its face. The tiebreak exists for the reason the gate itself prints: "Citations resolve by number, so a duplicate makes every reference to it ambiguous." Applying it literally here would have DEFEATED that purpose — four live citations resolve `SCL-128` to the Doc 04B entry (`supabase/migrations/20260930040000_scoring_engine.sql:9` and `:448`, `scripts/ci/scoring-engine-gates.sh:3`, `scripts/ci/scoring-engine-gates.sql:6`), and renumbering it would have broken all four, in a merged migration and two gate scripts. NOTHING cited this entry as `SCL-128`: its number had never been stable long enough to be referenced. Renumbering it costs nothing and touches no other workstream's work, which is also what the register's "never renumber another workstream's branch" clause asks for. On the tiebreak's own terms it is defensible too: measured by when the number 128 was CLAIMED, this entry's claim (during a merge after 2026-09-24) is the later one, even though the entry's date is earlier. Precedent: SCL-126 and SCL-127 renumbered themselves the same way on 2026-09-24 for PR #854.
Change: amend Doc 06D §6.5's Execution location and Trigger cadence rows, and §6.4 step 2, to the built mechanism; and record the one addition to the §6.3 shape.
WAS, verbatim (`docs/Spec/Lyceon — Document 06D_ Data Protection, Backup_DR & Compliance Operations.md`):
  §6.5 Execution location (`:209`): "Scheduled reconciliation job (Vercel Cron) \+ post-T+7-job trigger"
  §6.5 Trigger cadence (`:210`): "Triggered immediately after each Doc 01 V6 §19 T+7 hard-delete job completes for a given `deletion_request_id`; daily aggregate reconciliation against `account_deletion_requests.status`"
  §6.4 step 2 (`:201`): "Validates `p_layers_verified` structure against the §6.3 schema."
IS: the verification runs INSIDE the deletion, as T3, not after it.
  `public.complete_deletion_log` — already the evidence-side transaction that sets `status = 'completed'`, writes the billing record and strips the audit rows — now also calls `public.verify_deletion_layers(profile_id)` per completed deletion and records the result through `public.record_deletion_verification`. One transaction, one xmin, terminal outcome, no window in which a completed deletion has no record.
  `public.verify_deletion_layers(uuid)` is the scan, and it is CATALOG-DRIVEN: it asks `pg_attribute` for every uuid column of every base table in schema `public` and tests each one for the deleted profile's uuid, excluding only `deletion_verification_records.deleted_profile_id`. 216 columns on today's schema. The `identity` layer is that whole-schema sweep; `mastery` and `lisa` ATTRIBUTE a hit to a layer by table-name convention, and the outcome depends on the sweep, not on the two narrow patterns — so a table added tomorrow is swept tomorrow whether or not anybody classifies it.
  The outcome is DERIVED from the scan, never asserted by the caller. `pass` requires identity, mastery and lisa all verified; anything else writes a `fail` ROW, which §6.5 (b) pages on. An absent record and a failed one are not the same claim.
  `public.reconcile_deletion_log` — the crash-recovery path, which completes a log row whose cascade committed but whose T3 never ran — writes an honest `fail` with `deleted_profile_id` NULL. It cannot scan: PS-5 of the cascade consumed the `account_deletion_requests` row in the cascade's own transaction, taking the only surviving copy of the profile uuid with it. §6.5 pages either way, but only the `fail` carries the reason.
  §6.4 step 2 is implemented: the write path refuses a record missing any of the four §6.3 layers, and refuses a `pass` whose in-scope layers are not each `verified: true` or `out_of_scope: true` with a reason. That makes §6.5 failure-condition (d) unreachable rather than merely alarmed — the same argument that removed `in_progress` under SCL-100.
ONE ADDITION TO THE §6.3 SHAPE, named rather than slipped in. Each in-scope layer carries an extra `residual_columns` array — the `table.column` names that still held the uuid, empty on a pass. §6.3 specifies `evidence_query` and `result` and does not forbid further keys; this one exists because "residual=1" tells whoever is paged that something survived and not where, and the difference is the whole distance between an alarm and an investigation.
WHY NOT THE SEPARATE JOB §6.5 DESCRIBES. Three reasons, in order of weight. (i) It has to read a uuid that the deletion destroys: the profile row is gone and the request row is consumed by PS-5, both inside the cascade's transaction, so a job running afterwards has nothing to scan for unless the uuid is handed to it — and handing a deleted profile's uuid to a scheduled job means persisting it somewhere new, which is the opposite of a deletion. T3 still holds it, legitimately, as the dead key it already uses for the audit strip. (ii) A record written in a later transaction is a second chance to not exist; this defect is precisely a gap between "the deletion ran" and "something else was supposed to run". (iii) §6.5's own failure-condition (c), the stuck `in_progress` row, only exists because the spec assumed the verification spanned transactions. SCL-100 already struck it on the grounds that verification runs inside T3 — this entry is the part of that claim that was not actually true yet.
Rationale: a mechanism that exists, passes its tests and is not wired to the path that should invoke it is the failure class this vertical exists to eliminate, and it had reproduced itself in the vertical's own proof layer. Phase 6's suite called `record_deletion_verification` directly from `pg.query`; no TypeScript, no route and no SQL function ever called it. A test that exercises a function is not a test that the function is reachable from production.
Why this surfaced now: a real account deletion ran end to end in production on 2026-09-23 (log `52e18e62-fcf6-4636-99f9-4aefe33db8a2`). Everything else was correct — profile and auth user gone, cascades clean, entitlement removed, ledger and log written, consent copied, billing record `cancelled`, both emails in the right order, three distinct `xmin`s across consent, ledger and log. `deletion_verification_records` had zero rows. That deletion is unprovable under §6.5 and nothing can be backfilled: the profile is gone and the layer counts are unrecoverable. Recorded as GAP-HY-26.
Owner action: (1) amend §6.5's Execution location row to `Inside T3 of the deletion executor (public.complete_deletion_log), in the transaction that sets status = 'completed'`; (2) amend its Trigger cadence row to `Per deletion, synchronously, as part of the deletion's own evidence transaction; public.reconcile_deletion_log records a fail for any completion it resolves, because T3 did not run for those`; (3) amend §6.4 step 2 to state what is validated (four layers present; a pass requires each in-scope layer verified or out_of_scope with a reason); (4) ratify or reject the `residual_columns` addition to §6.3.
Build artifact: `supabase/migrations/20260930000000_deletion_verification_in_t3.sql` (`verify_deletion_layers`, and replacements of `record_deletion_verification`, `complete_deletion_log`, `reconcile_deletion_log`); `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.9 / C3.10 and the C3.6 and C3.1 extensions; `tests/ci/deletion-phase-6.pg.ci.test.ts` P6.7 and the P6.6 corrections; mutations M90-M93 in `scripts/ci/deletion-evidence-gate.mutations.sh`, of which M90 IS this defect planted deliberately.
SCL-119 | 2026-09-23 | Doc 03B §7.5's conversation detail shape omits `title`, `surface` and `crisis_paused_at`, and no locked document defines the crisis pause the client renders from them | PROPOSED
Id: `SCL-119` re-derived at the moment of use, 2026-09-23, after `git fetch --all --prune`, across every remote ref (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`) and the head of each open PR (#849 `claude/e1-exam-deletion`, #848 `claude/e2-scoring-catalogue`, #847, #846, #845, #843, #778 `claude/lucid-shannon-nmjr3n`, #728 dependabot). Highest allocated anywhere is `SCL-118`. First of two sequential allocations this session (SCL-119, SCL-120).
Change: amend Doc 03B V4.1 §7.5 (Response shape) and add a crisis-pause subsection to the conversation lifecycle.
WAS, verbatim (`docs/Spec/Doc 03B — LISA API and Runtime Flow.md:699-727`): the `conversation` object lists `conversation_id`, `entry_mode`, `source_surface`, `status`, `resolved_scope`, `created_at`, `updated_at`, `closed_at` — nothing else. `crisis_paused_at` appears nowhere in `docs/Spec` (full-corpus grep, 2026-09-23).
IS, as built: `server/routes/tutor-runtime.ts` (PR #845) returns three more fields, typed by `conversationDetailSchema` in `packages/shared/src/tutor-lifecycle-schema.ts`:
  - `title: string | null` — first student message, 60 chars, set once (migration `20260922000000_lisa_session_lifecycle.sql`, DEFAULT 'New session').
  - `surface: 'standalone' | 'practice' | 'review' | null`.
  - `crisis_paused_at: timestamptz | null` — set when a crisis turn returns resources; while set, `POST /messages` returns 409 `conversation_crisis_paused`; cleared only by the student via `POST /conversations/:id/resume`.
  `status` is reported as `active | ended`; the DB CHECK still admits `closed | abandoned`, which no code writes and production holds none of.
Rationale: the chat page derives its paused state from `crisis_paused_at`; omitting it made a paused conversation render as live after every reload, with no way to resume (flow map `docs/lisa-flow-map.md` §0.6). The behaviour exists, is load-bearing for a minor-safety surface, and traces only to CC Briefs ("LISA Session Lifecycle", "Close the LISA Vertical"), not to a locked section.
Why this surfaced now: PR #845's spec audit found the fields cited to a section that does not contain them.
Owner action: add the three fields to §7.5, and decide where the crisis pause lives in the spec (Doc 03B conversation lifecycle, or Doc 03 §21 crisis handling) — including the open question the code answers by default: the student alone can resume, regardless of the review case's status.
Build artifact: `server/routes/tutor-runtime.ts` (detail handler), `packages/shared/src/tutor-lifecycle-schema.ts` (`conversationDetailSchema`), `supabase/migrations/20260922000000_lisa_session_lifecycle.sql`.

SCL-120 | 2026-09-23 | Doc 03B §13.7/§14's two-phase idempotency (idempotency_records, advisory lock, reservePending/complete/markFailed) was never built; turn idempotency runs on `tutor_messages.status` | PROPOSED
Id: `SCL-120` — second of two sequential allocations (see SCL-119).
Change: amend Doc 03B V4.1 §13.7 and §14.1–§14.4, or record the as-built design as the V1 implementation.
WAS (`docs/Spec/Doc 03B — LISA API and Runtime Flow.md:1662-1935`): idempotency for `POST /api/tutor/messages` is delegated to 01A `IdempotencyService` with a 03B two-phase extension — `idempotency_records` in `pending → in_progress → completed | failed`, `pg_try_advisory_xact_lock` on the `client_turn_id` hash, `reservePending/complete/markFailed`, and a 01A §35 stuck-record timer. §14.4 names the backstop constraint `tutor_messages_client_turn_unique (conversation_id, client_turn_id)`.
IS, as built (PR #845): no `idempotency_records` table, no advisory lock, no `reservePending`/`complete`/`markFailed` anywhere in `server/`. The backstop is the unique INDEX `idx_tutor_messages_client_turn_idempotency (student_id, conversation_id, client_turn_id, role)` (migration `20260812010000`); the spec's constraint was dropped by `20260806020000`. §14.3's scenarios are applied to the student row's `tutor_messages.status`:
  - student + tutor row → cached replay; different text → 409 `idempotency_conflict`;
  - student row `pending` younger than 300s (01A `in_progress_timeout_seconds` default) → 409 `idempotency_in_progress`, `retry_after_ms: 2000`;
  - `failed`, stale `pending`, or a legacy `completed` row with no reply → compare-and-set back to `pending` (§13.7's `rowCount === 0` guard; zero rows → 409 in-progress), then resume without a second insert;
  - 23505 on the index → error log `idempotency_unique_constraint_violation` + 409 `idempotency_conflict` (§14.4).
Rationale: the as-built design meets §14.3's observable contract for every scenario the client can produce, with one table instead of two. What it does not have: an audit trail of prior failed attempts (§14.3 "Prior failed record is archived"), and content-hash comparison (it compares the sanitized message text).
Why this surfaced now: PR #845's spec audit.
Owner action: either bless the `tutor_messages.status` design as the V1 implementation and amend §13.7/§14 (and §14.4's constraint name), or commission the specified design.
Build artifact: `server/routes/tutor-runtime.ts` (`claimStudentTurnForRetry`, `sendClientTurnUniqueViolation`), `tests/ci/tutor-runtime.retry-and-detail.contract.test.ts`.

SCL-121 | 2026-09-24 | Doc 04B V4.3 §13 validates form composition on string difficulty ('easy'/'medium'/'hard') that the bank does not store, checks difficulty only, and returns a table; the owner ruled integer difficulty, three separate per-module tallies (difficulty, grid-in, domain) and a raise on the first deficient cell. Doc 04A §6.3/§6.4 describe the retired row-returning shape and contradict §13.1 on RW Module 1 | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `validate_form_composition` in `20260930030000_exam_runtime_schema.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-121` allocated 2026-09-24 as max+1 across every remote branch and open PR after `git fetch --all --prune` (max SCL-120, on `origin/exam` and siblings; open PRs #855, #854, #778, #728 carry no higher number). First of five sequential allocations this session (SCL-121..SCL-125).
Change: replace the Doc 04B V4.3 §13.2 reference body and §13.1 tables with the ruled composition contract, and align Doc 04A V2.2 §6.3 step 4 and §6.4.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:1601`): "RETURNS TABLE (section text, module text, valid boolean, expected jsonb, actual jsonb)"
  And (same file, `:1622`): "COUNT(*) FILTER (WHERE q.difficulty = 'easy')   AS easy," (likewise `'medium'` `:1623`, `'hard'` `:1624`; the §11.2 scoring body repeats the string comparison at `:1233`, `:1236`, `:1239`).
  And (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:614`): "For each returned row where valid \= false:"
  And (same file, `:642`): "RW M1:   27 items (no fixed difficulty distribution authored at parent level)"
  And (same file, `:649`): "The function returns one row per `(section, module)` indicating whether the actual composition matches the expected, plus the JSON-formatted actual and expected counts."
IS: `validate_form_composition(p_test_form_id uuid) RETURNS void` — returns normally when the form matches, otherwise RAISES check_violation naming the first deficient cell (section, module, dimension, value, expected, actual). Difficulty is `questions.difficulty` INTEGER 1/2/3 (1 = easy, 2 = medium, 3 = hard) per Doc 02A INV-02A-05. For every (section, module) of the form all of the following must match exactly:
  (1) module total — 27 per RW module, 22 per Math module;
  (2) difficulty (1/2/3) — RW M1 8/11/8, M2A 14/9/4, M2B 4/9/14; Math M1 7/9/6, M2A 11/8/3, M2B 3/8/11 (unchanged numbers);
  (3) grid-in count (`questions.item_type = 'grid_in'`) — Math M1 3, M2A 8, M2B 8; RW 0;
  (4) domain — Math M1: Algebra 8, Advanced Math 7, Problem Solving and Data Analysis 4, Geometry and Trigonometry 3; Math M2A and M2B: 7 / 8 / 3 / 4 in that order; RW M1: Information and Ideas 7, Craft and Structure 8, Expression of Ideas 5, Standard English Conventions 7; RW M2A and M2B: 7 / 7 / 6 / 7 in that order.
  The three tallies are marginals, not a joint cell table. Every item's question must be `status = 'published'` and its `section` must equal the item's section. Check order is deterministic and stated in the function header. Doc 04A §6.3 step 4 becomes "Call validate_form_composition(form_id); if it raises, abort with a structured error carrying the named cell and roll back"; §6.4 lists the four dimensions above, with RW M1 8/11/8.
Rationale (owner ruling 2026-09-24): the bank stores integer difficulty (genesis `questions_difficulty_check` 1..3) and INV-02A-05 forbids any component referencing values outside that set, so §13.2 as written counts zero items in every cell and rejects every form. Difficulty alone does not make a form SAT-shaped: grid-in share and domain balance are part of the Digital SAT module blueprint and were unchecked. A raise naming the cell is the shape the publish handler needs; a table the handler must remember to inspect is a gate that can be forgotten. Domain strings are the bank's exact CHECK-constrained strings: the owner brief wrote "Problem-Solving and Data Analysis"; production and `20260816010000_canonical_domain_checks.sql:62-67` spell it without the hyphen, and the bank string is what is enforced. 04A §6.4's "no fixed difficulty distribution" for RW M1 contradicts 04B §13.1's 8/11/8; 04B owns the function (04A §6.3), so §13.1 governs and 04A is aligned to it.
Why this surfaced now: E3 built the function and tested it against the real 6381-row bank.
Owner action: amend 04B §13.1/§13.2 and 04A §6.3 step 4 / §6.4 as above; decide separately (E4) whether §11.2's `q.difficulty = 'easy'` comparisons are amended in the same revision (they have the same defect and will score zero on every section as written).
Build artifact: `supabase/migrations/20260930030000_exam_runtime_schema.sql` (`validate_form_composition`), `scripts/ci/exam-runtime-schema-gates.sql` checks C1-C7.
SCL-122 | 2026-09-24 | Doc 04B V4.3 §10 names `questions.question_type` with values `multiple_choice` / `student_produced_response`; the bank's column is `item_type` with values `mcq` / `grid_in` | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `is_answer_correct` keyed on `item_type` in `20260930040000_scoring_engine.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-122` allocated 2026-09-24, second of five sequential allocations this session (see SCL-121).
Change: rename the column and values in the Doc 04B §10.1 comparator body and every place §10 refers to question type.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:961`): "--  V4.2 references it as `questions` with columns question_type," and (`:973`) "IF v_question_type = 'multiple_choice' THEN", (`:978`) "IF v_question_type = 'student_produced_response' THEN".
IS: `SELECT item_type, correct_answer, correct_variants ... FROM questions`; `IF v_item_type = 'mcq'` → letter equality; `IF v_item_type = 'grid_in'` → `p_submitted = ANY(correct_variants)`. The §10 comment "Adjust if Doc 02 names differ" is struck: they differ, and this is the adjustment.
Rationale (owner ruling 2026-09-24): `questions.item_type` is `text NOT NULL CHECK (item_type IN ('mcq','grid_in'))` (`20260628010000_grid_in_schema_extension.sql`), with a shape CHECK tying `grid_in` to a non-empty `correct_variants`. A comparator written to §10 verbatim returns `false` for every question ("Unknown question type: explicitly false"), which would score every exam as all-wrong without raising.
Why this surfaced now: E3's composition function needed the item-type column and found §10's names absent from the bank.
Owner action: amend §10.1 as above. E4 implements `is_answer_correct` against the amended text.
Build artifact: `validate_form_composition` reads `questions.item_type` (E3 migration); no comparator exists yet (E4).
SCL-123 | 2026-09-24 | Doc 04A V2.2 §5.1 declares `test_forms.routing_override_approved_by uuid REFERENCES admins(id)` and §5.1.1 says Doc 01 owns `admins`; no locked document defines an `admins` table and production has none (gate G-EX-04) | PROPOSED
Status 2026-09-27 (E11 register closeout): stays PROPOSED — a DECISION is needed, not a status change. Only the interim is ruled and live: `routing_override_approved_by` is CHECK-pinned NULL (`routing_override_pending_admins_g_ex_04`, `20260930030000_exam_runtime_schema.sql`). Owed (G-EX-04): which table the approver references (`admins`, or `profiles` with role admin), and what the attribution does when that admin's account is deleted.
Id: `SCL-123` allocated 2026-09-24, third of five sequential allocations this session (see SCL-121).
Change: state in 04A §5.1 / §5.1.1 what the approver column references, or that the override path is closed until it exists.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:186`): "routing\_override\_approved\_by  uuid NULL REFERENCES admins(id),"
  And (same file, `:288`): "**Admin FK dependency (V2.2 lock-cycle MED1).** Step 2's `REFERENCES admins(id)` requires the `admins` table to exist before this migration runs. Doc 01 owns the `admins` table; coordinate with Doc 01's schema deploy."
IS (interim, as built): `routing_override_approved_by uuid NULL` with no foreign key, plus `CONSTRAINT routing_override_pending_admins_g_ex_04 CHECK (routing_override_approved_by IS NULL)`. With `override_pair_both_or_neither` this keeps all three override columns NULL, so gate (b)'s override branch cannot be taken and out-of-range thresholds cannot publish. The §6.2 trigger body, the immutability list and the pair CHECK are unchanged. When the owner names the approver table (a Doc 01 `admins` table, or `profiles` restricted to role `admin`), one migration drops the pin CHECK and adds the FK. OPEN QUESTION for the owner, recorded rather than decided: which table, and — if `profiles` — what happens to the approver attribution on a published (immutable) form when the approving admin's account is deleted, given `scripts/ci/fk-delete-action-guard.sql` requires every FK into `profiles` to CASCADE, SET NULL, or be allowlisted with a handler, and SET NULL on one column of the override triple violates `override_pair_both_or_neither`.
Rationale: the MED1 lock-cycle point was that the approver must be a verified identity, not free text. A bare uuid with no FK gives neither verification nor a clean future FK (unverified values on immutable published rows would have to be grandfathered with NOT VALID). Closing the path until the reference exists keeps the audit property the spec asked for.
Why this surfaced now: E3 built `test_forms`.
Owner action: name the approver table (G-EX-04) and amend §5.1 / §5.1.1; decide the deletion behaviour of the attribution.
Build artifact: E3 migration (`routing_override_pending_admins_g_ex_04`), gate check P4.
SCL-124 | 2026-09-24 | Doc 04A V2.2 §5.3 gives `test_sessions.student_id` no foreign key and §5.4-§5.6 give the session children no delete action, so an account deletion either leaves identity-linked exam rows behind or is blocked; the Doc 05E disposition of exam activity is unstated | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the `test_sessions.student_id` FK in `20260930030000_exam_runtime_schema.sql`. Its delete action was later superseded by SCL-143 (SET NULL, `20260930080000_exam_deletion_cascade.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-124` allocated 2026-09-24, fourth of five sequential allocations this session (see SCL-121).
Change: add the identity reference and delete actions to the 04A §5 DDL, and record the exam tables' Doc 05E §5 disposition.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:317`): "student\_id               uuid NOT NULL,"; §5.4-§5.6 declare `test_session_id uuid NOT NULL REFERENCES test_sessions(id)` with no ON DELETE clause.
IS (as built): `student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`; `test_session_sections`, `test_answer_submissions`, `test_session_answers` reference `test_sessions(id) ON DELETE CASCADE`. Disposition: DELETED with the account in both privacy modes, until the owner rules otherwise.
  OPEN QUESTION for the owner, recorded rather than decided: Doc 05E §5 classes "activity / event sources" as retained-and-identity-decoupled under anonymize, and exam answers are learning activity. Retaining them requires `actor_id` on `test_sessions` (INV-05E-03, INV-05E-07 fail-closed grouping), a nullable `student_id` with ON DELETE SET NULL, and a hard_delete branch in `execute_account_deletion_cascade`. E3 did not build that, because SET NULL without `actor_id` is exactly the "retained-but-ungrouped row" INV-05E-07 calls a defect. The `exam_runtime_outbox.payload` also carries `student_id` (§13.2, §14.4) with no reference at all; its deletion treatment is unstated.
Rationale: 05E §6 INV-05E-03 requires every user-scoped table to be classified; the fk-delete-action guard enforces it for any FK into `profiles`. CASCADE is the only choice that keeps §5.3's NOT NULL, never blocks a deletion, and cannot retain an ungrouped identity-bearing row. Its cost is under-retention (a deleted student's exam history is not kept for world-model training under anonymize), which is reversible by a later migration; over-retention of an identity is not.
Why this surfaced now: E3 built the tables and ran the FK guard.
Owner action: rule the exam tables' 05E disposition (deleted vs retained under actor_id) and the outbox payload's treatment; amend §5.3-§5.6 DDL accordingly.
Build artifact: E3 migration; gate check D1; `scripts/ci/fk-delete-action-guard.sh` PASS; `tests/ci/deletion-fk-actions.pg.ci.test.ts` and `deletion-phase-6.pg.ci.test.ts` pass.
SCL-125 | 2026-09-24 | Doc 04A V2.2's trigger DDL is weaker than its own invariants: §5.1's immutability trigger covers UPDATE of published rows only (not archived rows, DELETE, the one-way status rule, or form items), and §6.2's publish gate is BEFORE UPDATE only and leaves composition to the handler | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the immutability and invariant triggers in `20260930030000_exam_runtime_schema.sql`. Owner confirmed 2026-09-27: ruled in conversation and read correctly — the stronger-than-spec triggers (archived forms, DELETE, form items, direct-as-published inserts, composition inside the publish trigger); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-125` allocated 2026-09-24, fifth of five sequential allocations this session (see SCL-121).
Change: amend the §5.1 and §6.2 trigger DDL (and §4 #15's enforcement split) to match what E3 built.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:266`): "BEFORE UPDATE ON test\_forms" (immutability; body guards `OLD.status = 'published'` only); (`:588`) "BEFORE UPDATE ON test\_forms" (publish gate); (`:161`) "Conditions (a) and (b) are DB-trigger-enforced; condition (c) is application-handler-enforced."
IS (as built): (1) immutability is `BEFORE UPDATE OR DELETE`, guards `OLD.status IN ('published','archived')`, refuses DELETE of any non-draft form, and refuses any status change other than draft→published and published→archived (§6.1 "one-way", §6.5 "no schema path" back to draft); (2) a separate `BEFORE INSERT OR UPDATE OR DELETE` trigger on `test_form_items` refuses any item change whose form (old or new) is not draft (invariant §4 #4; 04B §13.3 "Published forms cannot have their composition changed"); (3) the publish gate is `BEFORE INSERT OR UPDATE`: an INSERT must be `draft` (a row born `published` would bypass the gate entirely), and draft→published runs (a), (b), then (c) `validate_form_composition()`. The §6.3 handler still calls the function first; (c) is enforced in both places.
Rationale: each gap lets a stated invariant be broken with one SQL statement — an item INSERT into a published form, a DELETE of a published form, a published→draft round trip, an INSERT of an already-published row, or a publish from any path other than the §6.3 handler. The spec's reason for keeping (c) out of the trigger ("requires JOIN traversal", `:595`) is a convenience argument, not a prohibition; the JOIN runs in the trigger in well under a statement's cost.
Why this surfaced now: E3 built the triggers and planted each constraint.
Owner action: amend §4 #15, §5.1 and §6.2 as above.
Build artifact: E3 migration; gate checks F1-F4, I1-I3, P5, C7.

SCL-126 | 2026-09-23 | WITHDRAWN 2026-09-25 — SCL-079's proposed spec text binds the INV-03-02 live-exam gate to `full_length_exam_sessions.user_id`, a pre-baseline table that no migration creates and that the Doc 04 family replaces with `test_sessions.student_id`; and since E1 the gate SCL-032 and SCL-079 both describe does not exist anywhere in the build | RULING
Status 2026-09-27 (E11 register closeout): PROPOSED -> RULING, WITHDRAWN. Superseded by the owner's standing LISA ruling of 2026-09-25 (E9 rulings, R6): "R6 is withdrawn entirely. Drop it from E9. … the section_break question in SCL-126 is moot … and the SCL-079 fail-open reversal is unnecessary because there's no gate to fail either way." The live-exam tutor gate (G-EX-06) was CLOSED BY WITHDRAWAL, not built: no LISA surface exists in the exam, and `server/routes/tutor-runtime.ts` carries no gate. That removal comment still reads "restored in E9"; it is stale, and correcting it is application code, outside E11. So the table, column and live-state predicate (including the section_break question) this entry proposed has nothing left to amend.
Id: `SCL-126` (originally `SCL-119`) allocated 2026-09-23 as max+1 across every remote branch (max SCL-118 on `origin/calendar` and siblings); first of two sequential allocations this session (originally SCL-120 on `claude/e2-scoring-catalogue`, now SCL-127).
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
RENUMBERED 2026-09-24 (merge of main into exam for PR #854): this entry was allocated as `SCL-119` on 2026-09-23. The LISA workstream allocated the same id the same day on `main` (PR #846, commit b75aa08). The register's collision rule (later allocation renumbers, by the entry's own date) cannot decide a same-date tie, and the rule forbids renumbering another workstream's entry, so the exam workstream's entry moves to `SCL-126` = max+1 across all remote branches (max SCL-125). Content unchanged.

SCL-127 | 2026-09-23 | Doc 04B V4.3 §8.3 says `section_total_questions` and `module1_questions` are stored in `scoring_constants` as a convenience cache; Appendix A does not seed them, the scoring function never reads them, and a hand-synced cache with no consumer is a drift source | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `20260930010000_scoring_catalogue.sql` (the two keys are not seeded as `test_forms` columns); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-127` (originally `SCL-120`) allocated 2026-09-23 as max+1 across every remote branch (max SCL-118 on `origin/calendar` and siblings); second of two sequential allocations this session (originally SCL-119 on `claude/e1-exam-deletion`, now SCL-126).
Change: strike the convenience-cache sentence from Doc 04B V4.3 §8.3, and the "constants cache is fallback only" clause in the §11 `compute_section_scaled_score` reference body.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:660`): "Similarly, `section_total_questions` and `module1_questions` are derivable from `test_form_items` for the session's form. They are stored in `scoring_constants` as a convenience cache only; the scoring function MAY read either source. The form is authoritative; the constants cache must match."
  And (same file, `:1175`, inside the `compute_section_scaled_score` reference body): "-- (this is the authoritative source per §8.3; the constants cache is fallback only)"
IS: "Similarly, `section_total_questions` and `module1_questions` are NOT stored in `scoring_constants`. They are derived from `test_form_items` for the session's form at scoring time; the form is the only source." The `:1175` comment becomes "-- (the only source per §8.3)".
Rationale (owner ruling 2026-09-23): Appendix A — the normative v1.0 seed — already omits both keys and says so (`:2459-2460`: "Per §8.3, section_total_questions and module1_questions are also NOT canonical here; they are derived from test_form_items at scoring time"), and the §11 reference body computes N₁ and N_total by counting `test_form_items` and never reads the cache. §8.3 therefore describes rows that do not exist and a read that never happens. A cache nobody reads, which "must match" its source by hand, is a drift source with no consumer; it also sits inside a sealed, hash-attested version, so a mismatch discovered after activation could only be cured by a new scoring model version. The seed follows Appendix A; the spec text is what changes.
Why this surfaced now: E2 (scoring catalogue) seeded Appendix A verbatim and found §8.3 disagreeing with it.
Owner action: amend §8.3 and the `:1175` comment as above. No change to Appendix A, and no change to the seeded catalogue.
Build artifact: `supabase/migrations/20260930010000_scoring_catalogue.sql` (13 Appendix A rows; neither key present), gate check `P1 seed-shape` in `scripts/ci/scoring-catalogue-gates.sql`.
RENUMBERED 2026-09-24 (merge of main into exam for PR #854): this entry was allocated as `SCL-120` on 2026-09-23. The LISA workstream allocated the same id the same day on `main` (PR #846, commit b75aa08). The register's collision rule (later allocation renumbers, by the entry's own date) cannot decide a same-date tie, and the rule forbids renumbering another workstream's entry, so the exam workstream's entry moves to `SCL-127` = max+1 across all remote branches (max SCL-125). Content unchanged.

SCL-128 | 2026-09-24 | Doc 04B V4.3 §11.2 counts Module 2 wrong answers by comparing `questions.difficulty` to 'easy' / 'medium' / 'hard'; the bank stores INTEGER 1/2/3, so the function as written raises on every call. §19.4 repeats the string set | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the integer difficulty comparisons (1 = easy, 2 = medium, 3 = hard) in `20260930040000_scoring_engine.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-128` allocated 2026-09-24 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 65 remote refs: max `SCL-127`, on `origin/exam` and siblings) and every open PR (#778 `claude/lucid-shannon-nmjr3n`, #728 dependabot — both heads are remote branches already scanned, neither carries a higher number). First of two sequential allocations this session (SCL-128, SCL-129).
Change: replace the string difficulty literals in the §11.2 `compute_section_scaled_score` reference body and in §19.4 with the bank's integer codes. This is the §11 half of the delta SCL-121 recorded for §13 (SCL-121's "Owner action" deferred this decision to E4); the comparator half (`question_type` → `item_type`) is SCL-122 and is not repeated here.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:1233`): "AND q.difficulty = 'easy')," — likewise `:1236` "AND q.difficulty = 'medium'),", `:1239` "AND q.difficulty = 'hard')".
  And (same file, `:1978`, §19.4): "If `questions.difficulty` is NULL or outside `('easy','medium','hard')`, the question is not counted in any of the difficulty buckets but is still evaluated for correctness."
IS: `q.difficulty = 1` (easy), `q.difficulty = 2` (medium), `q.difficulty = 3` (hard) at `:1233/:1236/:1239`; §19.4 reads "outside `{1, 2, 3}` (1 = easy, 2 = medium, 3 = hard; Doc 02A INV-02A-05)". The v1.0 formula, its constants and the deduction weights D_e/D_m/D_h are unchanged — the mapping only says which stored code is "easy". Schema adaptation under §23.2 ("bug fixes that bring PL/pgSQL into parity with the Python reference"), not a §23.3 formula change.
Rationale (owner ruling 2026-09-24: 1 = easy, 2 = medium, 3 = hard throughout): `questions.difficulty` is `integer NOT NULL CHECK (difficulty >= 1 AND difficulty <= 3)` (genesis `questions_difficulty_check`) and Doc 02A INV-02A-05 locks that set. Verified on PostgreSQL 16 (E4, 2026-09-24): `SELECT count(*) FILTER (WHERE q.difficulty = 'easy') FROM (SELECT 1 AS difficulty) q` raises `22P02 invalid input syntax for type integer: "easy"` at parse time, even over zero rows — so a §11.2 body copied verbatim would make EVERY scoring call fail with no score_runs row, rather than (as first assumed) silently returning a ceiling-only score. The same holds for SCL-121's §13.2 note ("counts zero items in every cell"): the verbatim body raises. A silent-zero failure would only appear if someone "fixed" the error by casting (`q.difficulty::text = 'easy'`), which is the variant this amendment forecloses.
Why this surfaced now: E4 built `compute_section_scaled_score` and drove the 1,313-scenario sweep and 60 targeted fixtures through it.
Owner action: amend §11.2 (`:1233`, `:1236`, `:1239`) and §19.4 (`:1978`) as above, in the same revision as SCL-121/SCL-122.
Build artifact: `supabase/migrations/20260930040000_scoring_engine.sql` (`compute_section_scaled_score`, D1); `scripts/ci/scoring-parity.sh` (difficulty mapping under parity on the full session path — a 1↔3 swap turns it red).

SCL-129 | 2026-09-24 | Doc 04B V4.3 §9.1/§9.4 make `score_runs` undeletable (FK to `test_sessions` with no delete action, a BEFORE DELETE trigger that always raises) and give `student_id` no identity reference, so an account deletion that removes the student's exam sessions (SCL-124) is blocked by any score row; Doc 05E's disposition of scores is unstated | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `20260930040000_scoring_engine.sql`, superseded in part by SCL-143 (`score_runs.student_id` SET NULL, `20260930080000_exam_deletion_cascade.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-129` allocated 2026-09-24, second of two sequential allocations this session (see SCL-128).
Change: state the account-deletion behaviour of `score_runs` and `score_run_event_ledger` in §9.1/§9.2/§9.4 and align the DDL with SCL-124's disposition of the exam tables.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:727`): "test_session_id          uuid NOT NULL REFERENCES test_sessions(id),"; (`:728`) "student_id               uuid NOT NULL,                                       -- denormalized from test_sessions for index efficiency"; (`:831`) "score_run_id      uuid NOT NULL REFERENCES score_runs(id),"; (`:886`) "RAISE EXCEPTION 'score_runs is insert-once. UPDATE and DELETE are forbidden. Use score_runs_admin_recompute for post-launch calibration audit.';" fired by (`:894`) "CREATE TRIGGER trg_prevent_score_runs_delete" on every DELETE.
IS (as built): `score_runs.test_session_id REFERENCES test_sessions(id) ON DELETE CASCADE`; `score_runs.student_id REFERENCES profiles(id) ON DELETE CASCADE`; `score_run_event_ledger.score_run_id REFERENCES score_runs(id) ON DELETE CASCADE`. `prevent_score_runs_mutation()` keeps the §9.4 message for every UPDATE and for every DELETE EXCEPT one whose parent `test_sessions` row or `profiles` row no longer exists in the transaction — i.e. the FK cascade of an account (or session) deletion. It runs SECURITY DEFINER as the table owner so an RLS-hidden parent cannot fake "gone". Disposition: scores are DELETED with the account in both privacy modes, as SCL-124 rules for the sessions they are computed from, until the owner rules otherwise. `score_runs_admin_recompute` (§9.3) is not built yet; when it is, `original_score_run_id` needs the same decision (its NO ACTION FK would block the cascade again).
  OPEN QUESTION for the owner, recorded rather than decided: under anonymize, Doc 05E §5 retains activity decoupled from identity; a retained score would need `actor_id` (INV-05E-03/-07), a nullable `student_id` with ON DELETE SET NULL, and a trigger carve-out for that SET NULL UPDATE. Not built, for the reason SCL-124 gives (SET NULL without `actor_id` is the ungrouped row INV-05E-07 calls a defect).
Rationale: SCL-124 made `test_sessions.student_id` ON DELETE CASCADE so an account deletion never blocks (`scripts/ci/fk-delete-action-guard.sql` G1). With §9.1 as written, that cascade reaches `score_runs` and either fails the FK (NO ACTION) or, with CASCADE, is refused by the §9.4 trigger — the nightly deletion job would retry forever for every student who finished an exam. The insert-once invariant exists to stop a score being rewritten or quietly removed while its student exists; removing it together with the student is not that. The `student_id` FK makes the identity edge visible to the FK guard instead of leaving an unreferenced identity column.
Why this surfaced now: E4 built `score_runs` on top of E3's CASCADE sessions and ran the FK guard and the deletion cascade.
Owner action: rule the scores' 05E disposition (deleted vs retained under actor_id) together with SCL-124's; amend §9.1 (`:727`, `:728`), §9.2 (`:831`) and §9.4 (`:884-896`) as above.
Build artifact: `supabase/migrations/20260930040000_scoring_engine.sql` (D5, D6); `scripts/ci/scoring-engine-gates.sql` checks DEL1 (cascade succeeds) and IO2/IO5 (every other DELETE/UPDATE still refused); `scripts/ci/fk-delete-action-guard.sh` PASS.

SCL-131 | 2026-09-24 | Doc 04B V4.3 §9.5 and §22.1 make the student read policy depend on `current_student_id()`, a Doc 01 helper that does not exist; the exam runtime tables' student policies use `auth.uid()` directly, as practice and review do | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the `auth.uid()` student read policies in `20260930060000_exam_rls_policies.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-131` allocated 2026-09-24 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 71 remote refs: max `SCL-130`, on `origin/claude/calendar-setup`) and every open PR (their heads are among the scanned remote branches; none carries a higher number). First of six sequential allocations this session (SCL-131 .. SCL-136).
Change: replace the helper in the §9.5 policy with `auth.uid()` and retire §22.1's "single remaining external blocker".
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:919`): "USING (student_id = (SELECT current_student_id()));"; (`:2174`) "Until then, the placeholder is `auth.uid()` for student identity with the explicit caveat that this may need to change. **This is the single remaining external blocker for production deployment of 04B V4.3; it does NOT block document lock.**"
IS: `USING (student_id = auth.uid())`. A profile's primary key IS the auth user id (`profiles.id` = `auth.users.id`), so `auth.uid()` is the student id in every RLS context; the same holds for the Doc 04A runtime tables (`test_sessions.student_id = auth.uid()`, child tables through one `EXISTS` hop on `test_sessions`). §22.1 records that the helper is not used and that introducing it later is one migration with no behaviour change (policy body swap).
Rationale (owner ruling, E6 brief 2026-09-24): practice and review are live in production on exactly this predicate (`supabase/migrations/20260610020000_ws2_practice_review_runtime.sql:269-274`); nothing in the repo defines or calls `current_student_id()`; waiting on it left every exam table deny-all.
Why this surfaced now: E6 wrote the first student policies for the exam tables and for `score_runs`.
Owner action: amend 04B §9.5 (`:919`) and §22.1 (`:2172-2174`) as above.
Build artifact: `supabase/migrations/20260930060000_exam_rls_policies.sql`; `scripts/ci/exam-runtime-api-gates.sql` L1-L9 (as `authenticated`, own rows only).

SCL-132 | 2026-09-24 | Doc 04A V2.2 makes the client name Module 2 as '2A' or '2B' (§10.1, §11.2, §12, §16) while §9.3 forbids telling the student which path they were routed to | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the client sends module '2' (`packages/shared/src/exam-runtime-schema.ts`; `20260930070000_exam_runtime_api.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-132` allocated 2026-09-24, second of six sequential allocations this session (see SCL-131).
Change: the client addresses Module 2 as `'2'`; the server resolves it to the section's locked `module2_path`. Stored rows keep the physical module (`'2A'`/`'2B'`).
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:1053`): "\"module\": \"1\" | \"2A\" | \"2B\","; (`:1073`) "For Module 2 submissions, `module` must equal the section's locked `module2_path` (a request to submit Module 2A on a section routed to 2B returns 409 `module_path_mismatch`)."; (`:988`, `:1116`) the `:module` path segment of the items and submit endpoints; against §9.3 (`:964`) "The routed path is NEVER surfaced to the student in any API response, UI element, or report field."
IS: `:module` and the answer body's `module` take `"1" | "2"`. `module_path_mismatch` (§16.2 `:1399`) is removed: a client cannot name the wrong path. §16.2 also gains the two codes the endpoints need and 04A does not name: `module_not_started` (409; the module has not been started) and `module_not_startable` (409; a start request out of order, e.g. Math Module 1 while RW is active).
Rationale (owner ruling 2026-09-24, "Client sends '2'"): a client that must send `'2B'` has to be told it was routed to B, which is exactly what §9.3 and Parent V3.0 RB-V3-09 forbid; the only other reading exposes the path. The same leak exists in data, so the student column grants leave out `module` (see SCL-131's migration).
Why this surfaced now: E6 built the §16 endpoints.
Owner action: amend §10.1 (`:988`), §11.2 (`:1053`, `:1073`), §12 (`:1116`), §16 table, and §16.2 as above.
Build artifact: `packages/shared/src/exam-runtime-schema.ts` (`examModuleSchema`); `supabase/migrations/20260930070000_exam_runtime_api.sql` (`exam_physical_module`); gate M2L.

SCL-133 | 2026-09-24 | Doc 04A V2.2 serves multiple-choice options as `{label: 'A'..'D', text}` in canonical order and has no place to persist an option shuffle; the exam serves practice's shuffled opaque tokens and stores the canonical letter | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: per-item served option order in `test_session_items` (`20260930070000_exam_runtime_api.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-133` allocated 2026-09-24, third of six sequential allocations this session (see SCL-131).
Change: (1) §10.2 options become `Array<{ id: string; text: string }>` where `id` is an opaque per-session token; §10.2 also carries `passage: string | null` (the bank stores passage text; §10.2 models a passage only as an asset URL) and `correct_answer: null`, `explanation: null` (Coding Standards §5.2). (2) §5 gains `test_session_items (test_session_id, section, module, ordinal, question_id, option_order text[], option_token_map jsonb)`, written once per served item, never updated. (3) §11.1/§11.2: the server resolves the submitted token to the canonical letter BEFORE storing; `test_session_answers.answer` stays the canonical letter §11.1 already specifies; the response echoes the token.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:1010`): "options: Array\<{ label: 'A' | 'B' | 'C' | 'D'; text: string }\>;"; (`:1041`) "**Multiple-choice questions** (used in RW and a subset of Math): the stored answer is a single uppercase letter from the set `{A, B, C, D}`, or `NULL` for explicit omit."
IS: as Change. The resolution rule is the one practice and review use, now one shared function (`resolveSelectedCanonicalKey`, `shared/question-bank-contract.ts`): a served token maps through the stored map; a non-token is read as a canonical letter.
Rationale (owner ruling 2026-09-24: option shuffling "same as practice and review"; the 2026-09-20 shuffle ruling): `is_answer_correct` compares the stored value to the canonical `correct_answer`; storing a displayed position would silently mis-score. Persisting the permutation keeps §4 #9 (resume shows the same screen).
Why this surfaced now: E6 built §10 and §11.
Owner action: amend §5 (new table), §10.2 (`:1004-1014`) and §11.1/§11.2 as above.
Build artifact: `supabase/migrations/20260930070000_exam_runtime_api.sql` (`test_session_items`, `exam_record_item_options`); `server/services/exam-runtime-service.ts`; `tests/ci/exam-runtime.handler-pg.ci.test.ts` (stored answers are canonical letters and grade).

SCL-134 | 2026-09-24 | Doc 04A V2.2 makes the section break unenforced in both modes and confines the mode flag to timer decrement; the owner ruled the break bounded in strict mode. §8.2 is also silent on whether the pause accumulator carries from Module 1 into Module 2 | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: the section break, skippable in both modes and bounded in strict (`20260930070000_exam_runtime_api.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-134` allocated 2026-09-24, fourth of six sequential allocations this session (see SCL-131).
Change: (1) Strict mode: the break runs from RW Module 2 submit for `break_duration_ms`; at zero the server starts Math Module 1 itself, with `module1_started_at` = the break's end (the student loses the time since). The student may start Math earlier (skippable in both modes). Lenient: unchanged — unbounded up to `grace_expires_at`. (2) The mode flag therefore affects break expiry as well as timer decrement; §4 #11, §8.6 and Parent V3.0 hard guarantee #12 say so, and `timing_condition` (Parent #13) is what keeps reports honest about lenient timing, a deliberate deviation from Bluebook. (3) §8.2: `active_paused_ms` resets to 0 when a module starts.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:980`): "The `break_duration_ms` value is informational. No section-state machine transition is gated on a break-timer expiry. The transition out of `section_break` is exclusively driven by the Math Module 1 start request."; (`:157`) "11. **Mode flag affects timer-decrement behavior only.**"; (`:922`) "The mode flag is read in exactly two places in the runtime"; `docs/Spec/Doc 04 — Full-Length Exams, Scoring, Diagnostics & Readiness.md:331` "12. **Mode flag affects timer-pause behavior only.**"
IS: as Change. Scores still depend only on answers (Parent #12's second sentence stands).
Rationale (owner ruling, E6 brief 2026-09-24). For (3): §8.2 adds the accumulator to the ACTIVE module's expiry; carried over, a lenient student's Module 1 pauses would lengthen Module 2.
Why this surfaced now: E6 implemented §8/§9.4.
Owner action: amend 04A §9.4 (`:970-980`), §4 #11 (`:157`), §8.6 (`:903-924`), §8.2/§5.4 (per-module accumulator), and Parent V3.0 §9 #12 (`:331`).
Build artifact: `exam_advance_session` step 2 and `exam_start_module_internal` (20260930070000); gates BR1, BR2, LN1, LS1.

SCL-135 | 2026-09-24 | Doc 04A V2.2 makes the sweep the only writer of abandonment terminal states and has the API answer a past-grace session with 409; the owner ruled inline finalisation at every touch | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: inline finalisation at every touch, `exam_touch_session` (`20260930070000_exam_runtime_api.sql`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-135` allocated 2026-09-24, fifth of six sequential allocations this session (see SCL-131).
Change: any API touch of a past-grace non-terminal session runs the §14.3 steps 2-5 finalisation inline (as §7.3 step 5 already does at create), in the request's transaction. The request then answers: state read -> 200 with the terminal state; session create -> proceeds (§7.3); any other endpoint -> 409 `session_grace_expired` (and `session_terminal` thereafter). The sweep remains, as the backstop for sessions nobody touches. §15.1/§16.1 also state that the state read of a terminal session is 200 with its state (§16.1 step 4 says 409 `session_terminal` for every session-bound endpoint while §15.1's response enumerates `completed`).
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:733`): "State transitions to `abandoned_final` and `partial_scored_abandoned` are executed exclusively by the abandonment-sweep job (§14). No API endpoint writes these states directly."; (`:1208`) "The sweep is the only writer of `abandoned_final` and `partial_scored_abandoned`."; (`:1276`) "No API endpoint transitions a session to `abandoned_final` or `partial_scored_abandoned`. This is deliberate:"; (`:153`) "Any session-bound API request against a non-terminal session whose `grace_expires_at < clock_timestamp()` MUST be rejected with `409 session_grace_expired`."; (`:1382`) "4. **Terminal state check.** If `session.state IN ('completed', 'abandoned_final', 'partial_scored_abandoned')`, return `409 session_terminal`."
IS: as Change. §14.6's race argument still holds: finalisation runs under the session row lock (`FOR UPDATE`) that every runtime operation takes first, so no request is "in the middle" of it.
Rationale (owner ruling, E6 brief 2026-09-24): a sweep-only writer leaves a finished-but-unscored window of up to one sweep cadence; submitted sections should get their partial score as soon as anyone looks.
Why this surfaced now: E6 implemented §14 and §16.1.
Owner action: amend §4 #7 (`:153`), §7.2 (`:733`), §14.1 (`:1205-1210`), §14.6 (`:1274-1282`), §15.1 and §16.1 (`:1382-1383`).
Build artifact: `exam_advance_session`, `exam_touch_session`, `exam_session_state` (20260930070000); gates GR1, GR2, GR3.

SCL-136 | 2026-09-24 | Doc 04A V2.2 puts `student_id` inside the outbox payload and hands scoring to an outbox publisher worker; the owner ruled aggregate_id-only payloads and inline scoring after commit | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `exam_outbox_payload` (`20260930070000_exam_runtime_api.sql`; `server/services/exam-runtime-service.ts`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-136` allocated 2026-09-24, sixth of six sequential allocations this session (see SCL-131).
Change: (1) §13.2/§14.4 payloads carry no `student_id`; `aggregate_id` (the session) is the reference, and consumers join for identity. (2) §13.3: right after the completing (or finalising) transaction commits, the API invokes 04B's `score_test_session_from_outbox` for the new row and marks it `published`; a failure is recorded on the row (`attempts`, `failure_reason`; `failed` after the retry budget) and the row stays `pending`. The scheduled sweep re-drives pending rows. There is no separate publisher worker at MVP.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:1153`, and `:1251` in §14.4): "\"student\_id\": \"uuid\","; (`:1174`) "The outbox publisher worker (§5.7) reads the pending outbox row and publishes the completion event to the scoring pipeline. If publish fails, the worker retries with backoff."
IS: as Change.
Rationale (owner ruling, E6 brief 2026-09-24): a uuid inside jsonb is invisible to every FK cascade and to INV-DELETION-COMPLETE; 04B already reads only `aggregate_id` (`score_test_session_from_outbox`). Session over should mean score available within seconds; a cron cadence cannot meet the < 60 s target.
Why this surfaced now: E6 wrote the first outbox rows and the first caller of 04B's orchestrator.
Owner action: amend §13.2 (`:1149-1162`), §14.4 (`:1247-1260`), §13.3 (`:1170-1176`) and §5.7's status semantics accordingly.
Build artifact: `exam_outbox_payload`, `exam_score_outbox_event`, `exam_abandonment_sweep` (20260930070000); `server/services/exam-runtime-service.ts` (`scoreCommittedOutboxEvents`); gates OB1, SW1; handler-pg walks (outbox `published`, score run present, no scoring call in the test).
SCL-143 | 2026-09-24 | Doc 05D §10.2 and Doc 05E §5 do not say what an account deletion does to a full-length exam: the as-built CASCADE (SCL-124, SCL-129) deleted every session and score in BOTH modes, so anonymize lost the exam record 05E §5 retains, and the cascade's receipt counted none of it | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `20260930080000_exam_deletion_cascade.sql`, with the table walk restored by `20261008000000_deletion_cascade_restore_exam_table_walk.sql`. Still outstanding and stated in the entry: Doc 05D §10.4's hard-delete fallback is compliance's call; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-143` allocated 2026-09-24 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 81 remote refs: max `SCL-142`, on the open `claude/wizardly-franklin-ucty85-w3-*` branches; `SCL-137`..`SCL-141` are on `origin/main`) and every open PR (their heads are among the scanned refs). The E6b brief and the owner's go-ahead named SCL-137; that number was taken on `main` by the calendar close-out before this entry was written, so the register governs (CLAUDE.md, SCL number allocation). One allocation this session.
Change: (1) Doc 05E §5 classifies the full-length exam as activity: `test_sessions` (with `test_session_sections`, `test_session_items`, `test_answer_submissions`, `test_session_answers`) and `score_runs` (with `score_run_event_ledger`) are RETAINED under anonymize, identity-decoupled — `student_id` severed, `actor_id` preserved — and DELETED under hard_delete. The score run is retained although a score is recomputable from the retained answers, because it is the attested record of what the student was told (Doc 04B §9.4 insert-once), not derived state; the owner ruled it so. `exam_runtime_outbox` is identity-free queue state: deleted under hard_delete (as `legal_acceptance_outbox`), retained under anonymize (score runs reference it). (2) Doc 05D §10.2 Layer 2 names the exam tables among the canonical event sources, with the mechanism 05E put in place of the surrogate for every other activity table: `student_id` nullable and `ON DELETE SET NULL`, severed as the profile row is deleted; `actor_id NOT NULL` stamped at write; the INV-05E-07 sentinel covers both identity-bearing exam tables; the anonymize receipt counts the sessions and score runs it retained, BEFORE the profile delete (a severance done by an FK action is invisible to the row counts otherwise). (3) Doc 04A §5.3 and Doc 04B §9.1/§9.4 follow: `test_sessions.student_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL`, `actor_id uuid NOT NULL`; the same on `score_runs`; the §9.4 insert-once trigger admits exactly one UPDATE — the SET NULL of `student_id` as the student's profile is deleted, every other column unchanged — and a DELETE only as the cascade of a deleted session, or of a deleted profile for a row that still names one.
WAS, verbatim (`docs/Spec/Doc_05E_Anonymization_Actor_ID.md:71-72`): "- **Derived state** (mastery, KPI, projections, scheduling): **deleted.** Recomputable from retained activity if ever needed; no value in retaining identity-linked derived rows." / "- **Activity / event sources** (the canonical learning-event record): **retained, identity-decoupled.** Identity link severed; synthetic grouping identifier preserved; client/device fingerprints removed; the structured learning signal kept." — no exam table named, and a score run reads as either. (`docs/Spec/Doc 05D — Mastery Audit, Recompute & Constants Governance.md:858`) "11\. canonical event sources (the practice/review/test answer-event rows" — the answer rows only; the session envelope, the score and the outbox unstated. (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:317`) "student\_id               uuid NOT NULL,"; (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:728`) "student_id               uuid NOT NULL,                                       -- denormalized from test_sessions for index efficiency"; (`:890-896`) the §9.4 triggers raise on every UPDATE and every DELETE.
IS: as Change. Supersedes the "DELETED with the account in both privacy modes, until the owner rules otherwise" disposition of SCL-124 and SCL-129 and answers the OPEN QUESTION each recorded; their DDL lines (`ON DELETE CASCADE` on the two identity columns) are replaced by the above. The session-child and ledger CASCADEs of SCL-124/SCL-129 stand: they now serve hard_delete and a session's own deletion.
  THE DEFECT, stated narrowly (owner correction 2026-09-24): the CASCADE was not silent — SCL-124 and SCL-129 recorded it knowingly, pending this ruling. The two real gaps were (a) anonymize mode lost the exam record entirely, contrary to 05E §5 for activity, and (b) the cascade's `rows_affected` receipt carried no count for any exam row in either mode, so the evidence record understated what was destroyed. Both are closed.
  NO FINGERPRINT to remove: `test_sessions` has no client/device column (04A omits `client_instance_id` by design); the children and the ledger carry no identity; the outbox payload carries none (SCL-136).
Rationale (owner rulings on the E6b pushback, 2026-09-24): production's practice and review severance is exactly this mechanism — `ON DELETE SET NULL` identity FKs, fingerprints nulled by the cascade, `actor_id` stamped at write and sealed (`execute_account_deletion_cascade`, byte-identical to production, md5 `3097cc4b…`). A caller- or setting-based exemption from the insert-once trigger, needed to sever with an explicit UPDATE while the profile still exists, was rejected as the broader hole. The DELETE carve-out gains `student_id IS NOT NULL`: once the column is nullable, `NOT EXISTS (profiles WHERE id = NULL)` is true and every anonymised score row would otherwise be deletable.
Why this surfaced now: E6 put the exam runtime into service, so an exam-taking student's deletion would reach these rows; E6b is the owner's brief to settle SCL-124/SCL-129.
Owner action: amend Doc 05E §5 (`:71-72`) and Doc 05D §10.2 Layer 2 (`:858`) as in (1)-(2); amend Doc 04A §5.3 (`:317`) and Doc 04B §9.1 (`:728`) and §9.4 (`:884-896`) as in (3). Doc 05D §10.4's privacy-conservative fallback (hard-delete Layer 2 until compliance signs off) is untouched by this entry and remains the owner's to reconcile with anonymize being the live default.
Build artifact: `supabase/migrations/20260930080000_exam_deletion_cascade.sql`; `scripts/ci/exam-deletion-cascade-gates.sh` (S1 W1 N1 T1 SN1 SN2 A1 A2 A3 P1 P2 H1 R1 C1); `tests/ci/exam-deletion-cascade.handler-pg.ci.test.ts` (one exam per student through the /api/tests handlers, then both modes); `scripts/ci/scoring-parity.sh` PASS with score rows byte-identical to the base; `scripts/ci/exam-runtime-schema-gates.sql` D1 and `scripts/ci/scoring-engine-gates.sql` DEL1 now assert severance, not removal.

SCL-145 | 2026-09-25 | Doc 04A V2.2 gives a full-length exam no place to keep a student's per-item working state — marked for review, answer elimination, passage highlights — so "resume returns the same state" (§4 #9) cannot include them, and §16 exposes no way to write or read them | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `test_session_item_workspace` in `20260930090000_exam_shell_server.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-145` allocated 2026-09-25 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 86 remote refs: max `SCL-144`, on `origin/claude/wizardly-franklin-ucty85-w3-10-explanation`) and every open PR (their heads are among the scanned refs). First of five sequential allocations this session (SCL-145 .. SCL-149). An earlier scan the same day found max `SCL-143`; `SCL-144` was taken by the Model Armor workstream before this entry was written, so the register governs (CLAUDE.md).
Change: (1) §5 gains `test_session_item_workspace (test_session_id, section, module, ordinal)` — a child of `test_session_items` (ON DELETE CASCADE) holding `marked_for_review boolean`, `eliminated_option_ids text[]`, `highlights jsonb` — kept apart from `test_session_items` so the shuffle pin stays write-once. (2) Eliminations are the item's SERVED option tokens; the server refuses a canonical letter, another item's token, a repeat, and any elimination on a grid-in. (3) Highlights are `[start, end)` ranges in Unicode code points inside the item's passage; no text. (4) No free-text notes: Doc 05E INV-05E-04 requires counsel review before any student-authored free text is retained, and anonymize retains this table. (5) Writes and reads are refused once the module is submitted (409 `module_submitted`), for an item not yet served (409 `session_item_mapping_missing`), and for any session the caller does not own. (6) §16 gains `GET` and `PUT /api/tests/sessions/:session_id/sections/:section/modules/:module/workspace` (a full per-item PUT; a replay is a no-op). (7) §4 #9 "the same state" includes the workspace.
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:155`): "9. **Resume returns the same state.** A student who closes their browser mid-section and returns within the relevant grace window sees the same module, the same questions in the same order, the same answers they already entered, and the correct remaining time (computed per mode)." §5 (`:166-518`) has no working-state table; §16 (`:1361-1373`) lists seven endpoints, none for it.
IS: as Change.
Rationale (owner rulings on the E7 pushback, 2026-09-25): mark-for-review and answer elimination are College Board-standard exam tools and must survive a reload; keying elimination to the served token (never a letter) is the same discipline as resolving a selection to its canonical letter, and is what stops elimination drifting off the shuffle.
Why this surfaced now: E7 (the exam shell) needs them; E7a builds the server half.
Owner action: amend 04A §4 #9, §5 (new table) and §16 (two endpoints) as above.
Build artifact: `supabase/migrations/20260930090000_exam_shell_server.sql` (`test_session_item_workspace`, `exam_module_workspace`, `exam_save_item_workspace`; the account-deletion cascade names and counts the table); `scripts/ci/exam-shell-server-gates.sql` W1-W4, H2; `tests/ci/exam-shell-server.handler-pg.ci.test.ts`.

SCL-146 | 2026-09-25 | Doc 04A V2.2's heartbeat carries no position, so a reload cannot return the student to the question they were on; §15.1's state read has nowhere to report it | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `exam_heartbeat(..., p_ordinal)` in `20260930090000_exam_shell_server.sql`; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-146` allocated 2026-09-25, second of five sequential allocations this session (see SCL-145).
Change: (1) §8.3's heartbeat accepts an optional body `{ "ordinal": int }` — the item on screen in the section's ACTIVE module. The server stores it with the physical module and refuses (400 `invalid_request`) an ordinal that is not an item of the active module. An empty body is today's heartbeat. (2) §15.1's `sections[]` gains `current_ordinal: int | null`, set only while the stored position names the section's active module, so a new module never inherits the last one's position and the module id itself is never exposed (§9.3).
WAS, verbatim (`docs/Spec/Doc 04A — Exam Runtime & Session State.md:822`): "The client posts a heartbeat every 5 seconds while the section UI is in the foreground:" followed by the body-less `POST /api/tests/sessions/:session_id/sections/:section/heartbeat`; §15.1's response example (`:1312-1325`) lists `section`, `state`, `remaining_ms`, `module2_path_locked` per section and no position.
IS: as Change.
Rationale (owner ruling 2026-09-25, "heartbeat ordinal"): a device-only position lands a reloading student on the first unanswered question, which in a timed exam is a real cost; the heartbeat already fires every five seconds per section, so the position rides it.
Why this surfaced now: E7's resume requirement.
Owner action: amend 04A §8.3 (request body) and §15.1 (response field) as above.
Build artifact: `exam_heartbeat(uuid, uuid, text, int)` and `exam_session_body` in 20260930090000; `examHeartbeatRequestSchema`; gate checks H1, H2.

SCL-147 | 2026-09-25 | Doc 04C §16.3 says clients list exam sessions through "a separate listing endpoint" owned by Doc 04A, and Doc 04A §16 defines none — so a student has no way to see which forms exist or what they have sat | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `exam_list_forms` (`20260930090000_exam_shell_server.sql`; `server/services/exam-runtime-service.ts`); production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-147` allocated 2026-09-25, third of five sequential allocations this session (see SCL-145).
Change: 04A §16 gains `GET /api/tests/forms`: every published, selectable form, plus any published or archived form the caller already has a session on; per form its name, size, module timings and break, and the caller's latest session on it with its 04C report state (derived by 04C §5.3's one function). Never routing thresholds, scoring versions, module paths or identities.
WAS, verbatim (`docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md:1198`): "V1.0 does not include a \"list all my exam reports\" endpoint. Clients construct this by listing `test_sessions` (owned by 04A, separate listing endpoint) and calling `/report/status` per session. If Product wants an aggregated endpoint, V1.1 adds it as a projection over the same canonical data." 04A §16 (`:1361-1373`) has no listing endpoint.
IS: as Change. Spec silence, not a prohibition (owner ruling 2026-09-25).
Why this surfaced now: E7's start screen lists the practice tests and the student's result on each.
Owner action: amend 04A §16 (new endpoint) and 04C §16.3 (point at it).
Build artifact: `exam_list_forms` in 20260930090000; `examFormsResponseSchema`; gate F1; handler test "GET /forms".

SCL-148 | 2026-09-25 | Doc 04B §17.1's required disclosure text breaks Doc 04C §15.3's disclosure rules: it contains two of §15.3's forbidden phrases and matches none of its required templates | RULING
Status 2026-09-27 (E11 register closeout): PROPOSED -> RULING. CLOSED by SCL-178 (owner ruling 2026-09-27): §15.3's phrases are permitted in explicit negation, and 04B §17.1's text stands as seeded. The seeded row is already §17.1 verbatim, so nothing needed to be made live.
Id: `SCL-148` allocated 2026-09-25, fourth of five sequential allocations this session (see SCL-145).
Change: reconcile the two documents. Either 04C §15.3 permits negated forms ("not an official College Board score prediction") and adds 04B §17.1's wording as a template, or 04B §17.1's text is revised to satisfy §15.3. Until then the seeded v1.0 row carries 04B §17.1 verbatim (owner ruling 2026-09-25), and Karl varies it through `score_disclosure_versions`.
WAS, verbatim (`docs/Spec/Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md:1838`): "\"Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon's internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more.\"" — against (`docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md:1133-1146`) "`summary` and `full_text_url`\-linked content MUST NOT contain the following phrases or close synonyms:" … "* \"Official SAT score\"" … "* \"College Board score\"" … "`summary` MUST contain language matching at least one of these canonical templates" — "Lyceon-modeled estimate, not an official SAT score", "Practice-aligned estimate, not certified by College Board", "Modeled readiness signal, aligned with a third-party DSAT benchmark". §17.1 contains "College Board score" and "official SAT scores" and matches no template.
IS: as Change; the reconciliation itself is Karl's (04B §17.1: "Variations require Founder/CTO approval").
Why this surfaced now: E7a seeded the first `score_disclosure_versions` row.
Owner action: decide which document moves; amend it.
Build artifact: the seed row in 20260930090000 (§17.1 verbatim); gate R1 asserts it.

SCL-149 | 2026-09-25 | Doc 04C §9.2 contradicts itself on `incompleteness_reason` for a section submitted by Module 2 timeout: `null` when scoreable, and `'timed_out'` when submitted by timeout — a timed-out submitted section is both | APPLIED
Status 2026-09-27 (E11 register closeout): PROPOSED -> APPLIED under SCL-159 (the change is live and this entry records it). Live: `incompletenessReason` in `server/services/exam-report-service.ts` (`incompleteness_reason` null for every scoreable section). Owner confirmed 2026-09-27: ruled in conversation and read correctly — `incompleteness_reason` null for scored sections, `timed_out` dropped, the conservative reading of a section that contradicts itself; production confirmed live by the owner 2026-09-26 ("The whole chain is live in production").
Id: `SCL-149` allocated 2026-09-25, fifth of five sequential allocations this session (see SCL-145).
Change: state one rule. Built: `null` for every scoreable section (the field describes why a section is INCOMPLETE; a submitted section is complete and scored), `'module1_only'` for `module1_submitted`, `'never_attempted'` for `not_started` / `module1_active`; `'timed_out'` is never produced. If Product wants timeout-submitted sections flagged, that is a separate field, not an incompleteness reason.
WAS, verbatim (`docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md:621-622`): "  * `null` when `scoreable: true`" / "  * `'timed_out'` when `section_state = 'submitted'` AND module timeout submit was involved (drawn from `test_session_sections.module2_submitted_by = 'timeout'`)".
IS: as Change.
Why this surfaced now: E7a built the partial payload.
Owner action: amend 04C §9.2 to one rule (and drop `timed_out` from the enum, or move the signal).
Build artifact: `incompletenessReason` in `server/services/exam-report-service.ts`; `tests/ci/exam-report.contract.test.ts` "partial".

SCL-130 | 2026-09-24 | Doc 05F R-08-17 makes a target score required to complete calendar setup, and §8.1 carries it as a required field; the owner reverses that — both target fields become optional data, and nothing in setup blocks | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: the `setup_requires_target_score` CHECK is gone (0 rows in `pg_constraint`); `20261002000000_calendar_target_fields_optional.sql` and the setup code in its Build artifact; production verified 2026-09-27 by read-only query.
Id: `SCL-130` re-derived at the moment of use, 2026-09-24, across every remote branch after `git fetch --all --prune` (`git grep -hoE '^SCL-[0-9]{3} \|' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` on every branch, plus a whole-tree `SCL-1[23][0-9]` scan on every branch). Highest allocated anywhere is `SCL-129`. The head branches of all five open PRs (#863 `claude/e5-exam-forms`, #862 `lisa`, #861 `cleanup`, #860 `exam`, #728 dependabot) are among the scanned refs. No collision. One allocation this session.
Change: **R-08-17 is REVERSED.** §8.1 marks `target_score` and `target_exam_date` OPTIONAL. §15 documents that `GET /api/calendar` answers `setup_required` BEFORE the entitlement gate. §17.1 records the header's three zones of two rows. §17.5 gains the first-visit popup.
WAS: a completed setup had to carry a target score — enforced in three places at once: the `setup_requires_target_score` CHECK on `student_study_profile` (`20260917130000_calendar_v1.sql:217`), a `.refine()` restating it on `studyProfileSchema`, and a server derivation that stamped `setup_completed_at` only on the write that first supplied a score.
IS: nothing in setup is required and nothing blocks. A student can press straight through without answering and still get a plan. `setup_completed_at` is stamped by the first profile write — the student reached the end of the flow.
Rationale (owner ruling 2026-09-24): production on 2026-09-24 held **104 students and ONE study profile**. Nothing in the product collects a test date or a target score except the calendar's setup sheet, and that sheet sat behind `calendar_access` — so a free student could never reach it, and an entitled one met a required field before they had a reason to care about it. The cost is not cosmetic: Doc 05C computes projections with no target to compare against, and no student sees a countdown, because the column that would drive both is empty for 103 of 104 rows. A required field that produces one row in the entire product is not collecting data; it is preventing it.
  The field was required so the plan could be tuned for aggressiveness against the target. That tuning does not exist and is a V2 item, explicitly out of scope — so the constraint was protecting a behaviour that has never shipped, at the cost of the data that behaviour would need.
Scope of the reversal: this is about whether a value must EXIST. `target_score`'s own bounds (400..1600, multiple of 10) are untouched, so a supplied value is still canonical. Using the target to tune the plan remains out of scope.
Owner action: amend Doc 05F §8.1, §15, §17.1 and §17.5 as above, and strike R-08-17. **`docs/Spec/` is read-only to Claude Code** — hard-blocked by `.claude/hooks/block-spec-and-secrets.mjs`, and CLAUDE.md says to surface a needed spec change rather than make it — so the four amendments are drafted in the PR body for the owner to apply. Doc 05F is consolidated (V1) and has no addendum, so there is no in-repo place for them to land in the meantime.
Build artifact: `supabase/migrations/20261002000000_calendar_target_fields_optional.sql` (authored, not applied — drops the CHECK, restates the three column comments); `packages/shared/src/calendar/profile.ts` (the `.refine()` removed); `server/services/calendar/profile-service.ts` (`setup_completed_at` derivation); `server/routes/calendar-routes.ts` (`setup_required` before the gate; `PUT /profile` ungated); `client/src/features/calendar/components/SetupPopup.tsx` (§17.5); `client/src/features/calendar/lib/projection.ts` + `scripts/ci/calendar-projection-gate.mjs` (§17.1's band, composed by addition only); gate `Z-52` in `scripts/ci/calendar-writer-gates.sql` (both fields NULL -> accepted plan), plant recorded in the PR.

SCL-142 | 2026-09-24 | Model Armor runs in the tutor turn path — an input scan before the model and an output scan after it, failing OPEN — and no locked document mentions it; Doc 03 §18.2 and INV-03-12 describe only the deterministic scans, which fail closed | PROPOSED
Id: `SCL-142` allocated 2026-09-24 as max+1 at the moment of use, after `git fetch --all --prune`, across all 80 remote refs (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`). Highest anywhere is `SCL-141`, on `claude/calendar-closeout-final` (PR #877, open, allocations SCL-137..SCL-141). The heads of every open PR (#877, #876 `lisa`, #875, #874, #873, #872, #871, #861 `cleanup`, #728 dependabot) are among the scanned refs; none carries a higher number. One allocation this session.
Change: add Model Armor to Doc 03 §18.2 as a model-backed layer ALONGSIDE Layers 3 and 4 (not a replacement for either), state its failure posture, and add the INV-03-12 carve-out that makes that posture consistent with the invariant.
WAS: `docs/Spec` contains no mention of Model Armor (full-corpus grep, 2026-09-24). Doc 03 §18.2 (`docs/Spec/Doc 03 — LISA (AI Tutor System).md:1440`) defines Layer 3 as `<untrusted_*>` boundary markers (`:1459`) and Layer 4 as signature/phrase output scanning (`:1481`). INV-03-12 (`:2164`), verbatim: "Every LISA response passes through anti-leak and injection-pattern scanning before delivery to client. Failed scans block the response and substitute a safe fallback. Scans are not optional."
IS, as built (PR #875, closure plan W3-1):
  - Input: `sanitizeUserPrompt` on the student's message against template `lyceon-lisa-input-v1`, immediately before the worker call. A match skips the model; the reply is the substitution below.
  - Output: `sanitizeModelResponse` on LISA's reply against `lyceon-lisa-output-v1`, immediately after the worker call; a match is passed to `serializeTutorOutput` as `armorOutputBlocked`, which substitutes.
  - Endpoint `https://modelarmor.us-central1.rep.googleapis.com` (Terraform `var.region`), templates from `tutor_context_runtime_config`, credential from the BFF's single GCP resolver. Timeout 1500 ms per scan.
  - FAIL OPEN: unconfigured template, no credential, token failure, timeout, network error, non-2xx, unparseable body, or partial invocation → the turn proceeds unscanned at that point, and `model_armor_scan_skipped` is logged at ERROR with the reason.
  - The deterministic INV-03-12 scans in `serializeTutorOutput` are unchanged: they run on every reply, including when a Model Armor scan was skipped, and still fail closed.
  - The crisis path returns before either scan; Model Armor cannot suppress a crisis response.
  - Student copy on a block, both points (owner-approved 2026-09-24): "Let's keep this on your SAT prep. What would you like to work on next?"
  - Logs: clean → INFO `model_armor_scan_clean`; blocked → WARN `model_armor_scan_blocked` with the matched filter names; skipped → ERROR. No message text in any line.
  - Owner ruling W3-5 (2026-09-24), built separately: an INPUT block whose matched filters include `dangerous` also opens a crisis review case and alerts, with the neutral copy unchanged — no crisis template, because the filter is broad and not clinical.
Rationale (owner rulings, 2026-09-24): minimise fail-closed except where compliance or integrity requires it — a student must not lose a tutoring turn because a scanner is down; integrity is already held by the deterministic scans, which stay fail-closed. And spec silence is how a control becomes invisible: Model Armor is now a real control in the turn path, so it belongs in the corpus.
Why this surfaced now: PR #875's spec audit found the code citing §18.2 for a mechanism the section does not define, and the fail-open posture reading as a contradiction of INV-03-12.
Owner action: (1) add the Model Armor layer to §18.2 as above; (2) amend INV-03-12 so that it governs the deterministic anti-leak and injection-pattern scans, and state that the model-backed layer fails open with an ERROR log; (3) record W3-5's input-block → review-case rule in §21.3's list of case sources.
Build artifact: `server/services/tutor-model-armor.ts`, `server/routes/tutor-runtime.ts` (steps 13b/14b), `server/services/tutor-output-serializer.ts` (`armorOutputBlocked`), `tests/ci/tutor-model-armor.contract.test.ts`, `infra/terraform/model-armor.tf`.
SCL-137 | 2026-09-24 | Doc 05F §15 lists no status code for a plan the validator refuses and rules that a policy denial "settles at 402 or 403"; a student's own day edit refused by V-01..V-14 is neither, and shipped as a 500 with an empty `rule_ids`. §10.3 names the rejection payload but not the shape of one violation | RULING
Id: `SCL-137` allocated 2026-09-24 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 79 remote refs on `docs/SpecAudit/SPEC_CHANGES_LOG.md`: max `SCL-136`, the exam vertical's sixth allocation of the same day) and every open PR (8 open; every head branch is among the scanned refs, so none carries a higher number). First of five sequential allocations this session (SCL-137 .. SCL-141). The brief that asked for these said "next free numbers after 131"; that was stale by six and was not followed — CLAUDE.md's SCL HARD OVERRIDE puts the register above the instruction.
THIS ENTRY CORRECTS A DEFECT OF MY OWN. The Brief 11 calendar change shipped four `@spec` annotations citing `SCL-131` for this ruling — `packages/shared/src/calendar/plan.ts:220`, `client/src/features/calendar/components/CreateBlockSheet.tsx:4`, `client/src/features/calendar/components/CreateBlockSheet.test.tsx:5`, `tests/ci/calendar.routes.contract.test.ts:422` and `:446` — and no register entry was ever filed. `SCL-131` was legitimately allocated the same day by the exam vertical (Doc 04B §9.5 `current_student_id()`), so those five citations point at another workstream's ruling. Under the collision rule the LATER allocation renumbers; both are dated 2026-09-24, and the exam entry is the one that is filed, so the calendar citations move. They are renumbered to `SCL-137` in the same commit as this entry.
Change: (1) §15's 409 list gains a fifth cause — **a student-authored plan the validator refuses** — answered as `CALENDAR_PLAN_REJECTED` with the refused rules in `error.details.violations`. (2) §15's policy-denial sentence reads "402, 403 or 409". (3) §10.3 states the element shape of `violations[]`: `{ rule, date, detail }`, with `date` null for a whole-horizon rule (V-08's duplicate date, V-11's full-length cap).
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:733`): "Errors: 400 · 401 · 402 (shared CTA payload, flat platform shape so the existing upgrade component recognises it) · 403 guardian gate · 404 · 409 (launch of a past or future date, launch of a complete block, editing a past date, moving a started block) · 429 · 500 (ERROR log, correlation id). Every other calendar error uses the nested envelope of Coding Standards §8.2. **A policy denial is a decision, not a fault:** it settles at 402 or 403 with a structured log, never a 500."; (`:548`) "It returns a rejection as **data** — `{result, violations[]}` — and never raises on a bad plan, because the writer has to record the rejection and fall back; it raises only when the snapshot itself is unusable."
IS: as Change. A rejection whose `mode` is student-authored (`student_edit`, `do_it_now`, `day_regenerate`) is a 409 logged at WARN with `rule_ids`; a rejection under `generated` or `rollback` is the generator refusing its own output, stays a 500, and is logged at ERROR — which is what §18's `calendar.plan_rejected` alert is scoped to, and only that. The writer→mode map is fixed by each function's own defining migration: `calendar_edit_day`→`student_edit`, `calendar_move_block`→`student_edit`, `calendar_do_it_now`→`do_it_now`, `calendar_regenerate_day`→`day_regenerate`, `calendar_persist_version`→`generated`/`rollback`.
Rationale (owner ruling, Brief 11 Step 1, 2026-09-24): production deployment `dpl_4MqjeSU1sV7NRkuh51dJafeb4anQ`, 2026-09-24 08:38:05–08:38:17, served fifteen identical `PUT /api/calendar/days/<date> 500 plan_rejected operation=day_edit rule_ids=[]`. Two defects in one line. The 500 told the client a fault had occurred when the server had made a decision; and `rule_ids` was empty, so the decision was undiagnosable — the log could not say what the plan had been refused for, and neither could anyone reading it afterwards.
  THE EMPTY LIST WAS A SHAPE MISMATCH, not a dropped field. `calendar_validate_plan` builds every violation with `jsonb_build_object('rule', …, 'date', …, 'detail', …)` — an object. `readEnvelope` filtered the array with `typeof rule === "string"`, so every element failed the predicate and the array emptied. Proved by calling the live validator, not by reading. The test that should have caught it asserted `violations: ["V-05", "V-10"]` — bare strings the validator has never produced — so the fixture agreed with the bug and the suite stayed green.
Why this surfaced now: §17.2's "+ Add block" wrote a day nobody had chosen and the validator refused it, which is what put fifteen of these in one deployment's logs.
Owner action: amend Doc 05F §15 (`:733`) and §10.3 (`:548`) as above. `docs/Spec/` is read-only to Claude Code (hard-blocked by `.claude/hooks/block-spec-and-secrets.mjs`), so the amendments are drafted here for the owner to apply; Doc 05F is consolidated at V1.0 and has no addendum.
Build artifact: `packages/shared/src/calendar/plan.ts` (`planViolationSchema`, deliberately NOT `.strict()` — a new SQL field under `.strict()` would fail every element and re-empty the array, which is this defect from the other side); `server/services/calendar/plan-service.ts` (`PlanAuthorship`, per-element `safeParse`, `unreadable` count with its own ERROR log, `logger[studentAuthored ? "warn" : "error"]` carrying `rule_ids`); `server/routes/calendar-routes.ts` (the `rejected` arm splits 409/500 on authorship); `tests/ci/calendar.routes.contract.test.ts` (fixtures rebuilt to the real object shape; a plant that swallows violations turns the suite red).

SCL-138 | 2026-09-24 | Doc 05D §10.2's account-deletion cascade enumerates ten tables by hand and names no calendar table; the eight calendar-owned tables are destroyed today by declarative FK CASCADE, outside that list and outside the receipt it returns | PROPOSED
Id: `SCL-138` allocated 2026-09-24, second of five sequential allocations this session (see SCL-137). This files Doc 05F §23's `SCL-08-A` in the register's canonical three-digit scheme. The `SCL-08-*` ids are Doc 05F's own and are invisible to the register's duplicate gate, which matches `SCL-\d{3}` — §23 (`:934`) says so itself.
Change: §10.2's Layer 1 records that the calendar's eight student-owned tables are destroyed by the declarative `ON DELETE CASCADE` on their `profiles(id)` reference rather than by enumeration, and that `calendar_runtime_config` and `calendar_runtime_config_history` are excluded because they are governance rows, not student data — their only identity edge is an operator attribution column, which is `ON DELETE SET NULL` per SCL-002's amended record. The eight: `student_study_profile`, `calendar_plan_versions`, `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches`, `calendar_mutation_ledger`, `calendar_job_runs`.
WAS, verbatim (`docs/Spec/Doc 05D — Mastery Audit, Recompute & Constants Governance.md:832-843`): "FK-safe order (children before parents; a table with no FK to another in this set may delete in any relative order, but the listed order is canonical and the migration encodes it exactly):" followed by the ten numbered entries `student_section_projection_snapshots` · `student_section_projections` · `student_projection_refresh_state` · `projection_refresh_outbox` · `student_section_kpi` · `student_domain_kpi` · `student_skill_kpi` · `student_overall_kpi` · `student_domain_mastery` · `student_skill_mastery`. No calendar table appears, and neither does `student_study_profile`.
IS: as Change. **The student's calendar data is already destroyed correctly today** — this is not a live retention defect and saying otherwise would be false. Every one of the eight declares `student_id uuid … REFERENCES public.profiles(id) ON DELETE CASCADE` (`supabase/migrations/20260917130000_calendar_v1.sql:204, 231, 261, 283, 348, 366, 386`; `calendar_plan_block_memberships` reaches `profiles` through `calendar_plan_dates` at `:335`), so `DELETE FROM profiles` takes them with it.
  WHAT IS ACTUALLY MISSING IS THE RECORD. `execute_account_deletion_cascade` still walks L1-01..L1-10 by hand and accumulates a per-table row count into the `rows_affected` receipt it returns (`supabase/migrations/20260917130000_declarative_fk_delete_actions.sql:358-387, 599`). A row removed by a declarative cascade is counted nowhere, so the receipt for a student who used the calendar understates what was destroyed by eight tables. The evidence bundle is built from that receipt.
Rationale: the owner brief of 2026-09-17, "Declarative FK Actions, Not an Enumerated Cascade", ruled that an enumerated list is the wrong mechanism — nine FKs into `profiles` had already been forgotten by it. Doc 05D §10.2 still describes the mechanism that brief retired. Adding eight more names to that list would be re-committing the error; the amendment records the disposition instead, which is what a reader of 05D actually needs to know.
Why this surfaced now: Doc 05F §23 has carried `SCL-08-A` as Open (gate G-08-06) since the calendar was drafted, in a scheme the register cannot see. Filing it here is what makes it actionable.
Owner action: amend Doc 05D §10.2 (`:832-843`) as above and close Doc 05F §23's `SCL-08-A` and gate `G-08-06` (`:876`, `:938`) against it. Separately, decide whether the `rows_affected` receipt should count declaratively-cascaded rows at all; if it should, that is a change to `execute_account_deletion_cascade` and not to any spec, and it is out of the calendar's scope.
Build artifact: none — this entry is a spec amendment request. The behaviour it describes is already built: `supabase/migrations/20260917130000_calendar_v1.sql` (the eight CASCADE edges), `scripts/ci/fk-delete-action-guard.sql` G1 (every identity edge must be CASCADE, SET NULL or allowlisted — the calendar's eight pass as CASCADE).

SCL-139 | 2026-09-24 | Doc 05B §7.6 computes the activity streak over UTC days with no rest-day skip; Doc 05F §14 renders that number as the student's streak and has no way to make it right, so `/api/me/streak` ships `history_complete: false` on every path | PROPOSED
Id: `SCL-139` allocated 2026-09-24, third of five sequential allocations this session (see SCL-137). This files Doc 05F §23's `SCL-08-E` in the canonical scheme; §20's gates `G-08-11` and `G-08-12` were already collapsed into it (`:881`).
Change: Doc 05B §7.6 takes the student's local day boundary and skips a scheduled rest day. (1) `compute_streak_days` and `compute_longest_streak_days` bucket `occurred_at` by the student's zone rather than UTC. (2) A day the student's schedule marks as a non-study day does not break the streak: it is skipped, not counted. (3) §7.6's "Streak timezone caveat" and acceptance criterion 7 are rewritten to match, and Doc 05F §14 drops `history_complete: false`.
WAS, verbatim (`docs/Spec/Doc 05B — Domain Mastery & KPI Rollups.md:1389`): "v\_today  date := (p\_t\_now AT TIME ZONE 'UTC')::date;"; (`:1397`) "SELECT (occurred\_at AT TIME ZONE 'UTC')::date AS event\_date, section, domain, skill"; (`:1442`) "**Streak timezone caveat.** V1.0 evaluates streaks in UTC. A student in PST who studies at 11pm local time generates an event with `occurred_at = 7am UTC the next day` — that event counts toward the UTC-day streak, not the PST-day streak. This is a known limitation; a future V1.1 may introduce per-student timezone for streak computation. Documented here so the dashboard doesn't claim wrong streak values."; acceptance 7 (`:1836`) "`compute_streak_days` and `compute_longest_streak_days` helpers are specified in §7.6 with UTC-day interpretation and 730-day safety cap."
IS: as Change. The zone is available and has been since the calendar shipped — `student_study_profile.timezone`, validated by `calendar_is_known_timezone`, falling open to `America/Chicago` for a student who has none (Doc 05F §7.1). The rest-day set is `student_study_profile.study_days`. Both are one join from `student_overall_kpi`, so this needs no new column.
Rationale: §7.6's caveat calls the UTC boundary "a known limitation … documented here so the dashboard doesn't claim wrong streak values". That was adequate while the number appeared only on a dashboard. Doc 05F §14 now renders it in the calendar header as "N day streak" beside a plan that names the student's rest days explicitly, and a student who took a scheduled Sunday off is shown a broken streak by a surface that planned the Sunday. The two statements are on the same screen.
  WHY THE CALENDAR DOES NOT JUST COMPUTE ITS OWN. Doc 05F §14 (`:695`) and formula sheet §8 item 11 both put the streak outside the calendar: "**Doc 05B owns it.** … The calendar computes no streak and stores none: a derived streak beside a stored one would disagree the day they diverge." Writing the corrected math in `server/services/activity-streak.ts` would make the practice page's streak and the calendar's two different numbers. When this lands, the skip belongs in 05B's refresh.
Why this surfaced now: the calendar is the first surface to render the streak next to the schedule that defines a rest day.
Owner action: amend Doc 05B §7.6 (`:1374-1442`) and acceptance 7 (`:1836`) as above, then Doc 05F §14 (`:695`) and §4 (`:149`), and close §23's `SCL-08-E` (`:941`).
Build artifact: `server/services/activity-streak.ts` — `HISTORY_COMPLETE = false` is a named constant at three return sites precisely so the day it flips is one edit; the file's header records why the math is not written there. `packages/shared/src/streak.ts` is named by §14 for pure math it does not yet contain, for the same reason.

SCL-140 | 2026-09-24 | `review_estimated_seconds_per_item` is calendar-owned because Doc 02B's `review_runtime_config` holds SM-2 parameters and no timing key; its value of 120 assumed a LISA conversation per item, and LISA is out of review at launch | PROPOSED
Id: `SCL-140` allocated 2026-09-24, fourth of five sequential allocations this session (see SCL-137). This files Doc 05F §23's `SCL-08-F` in the canonical scheme.
Change: one of two, the owner's choice. (a) Doc 02B claims the constant: `review_runtime_config` gains a review timing key, the calendar reads it through the review adapter's planning call, and Doc 05F §21 drops the row. (b) Doc 02B declines it: Doc 05F §21's row is amended to say the constant is permanently calendar-owned rather than "until Doc 02B claims a review timing constant", and the seam closes. Either way the **value** is re-derived from observed data, not left at 120.
WAS, verbatim (`docs/Spec/Lyceon — Document 02B_ Runtime Engines (V4).md:311`): "| Review runtime config | `review_runtime_config` | SM-2 intervals, ease factors, graduation thresholds |" — intervals, ease factors and graduation thresholds, and no seconds-per-item; (`docs/Spec/Lyceon_Doc_05F.md:899`) "| `review_estimated_seconds_per_item` | 120 | 30–600 | Calendar-owned until Doc 02B claims a review timing constant (SCL-08-F). It errs toward **smaller** review blocks, which is the safe direction: a block that finishes early costs nothing, one that overruns the day costs the rest of the plan. **Revisit once 200 answered review items exist**, measured as `occurred_at − served_at`. |"
IS: as Change. The constant is not decorative — it is the seconds side of §10.3's V-05 day-budget check and of §17.1's "~N min" readout, so it decides how much review fits in a day and what the student is told a block will cost.
Rationale: 120 seconds per review item was set on the assumption that a review item carries a LISA conversation. Ruling 9 (register `SCL-111`) takes LISA out of review at launch, so the estimate is high by a margin nobody has measured, and it is high in the direction that shrinks review blocks — the plan under-schedules review for every student until it is re-derived. §21's own instruction says to revisit at 200 answered review items measured as `occurred_at − served_at`; that count does not exist yet, which is why this is filed as a seam and not as a value change.
Why this surfaced now: the constant was carried as `SCL-08-F` in Doc 05F's private scheme while the register recorded the LISA consequence separately (`SPEC_CHANGES_LOG.md:3258`, filed against a different vertical and explicitly "flagged for the calendar owner"). Neither half could find the other. This entry joins them.
Owner action: rule (a) or (b); amend Doc 02B "Runtime Configuration (Proposed Target-State Tables)" (`:311`) or Doc 05F §21 (`:899`) accordingly, and close §23's `SCL-08-F` (`:942`). Until then the constant stays where it is and the seam stays open — nothing about it is a defect today.
Build artifact: already built as calendar-owned and traceable either way — `supabase/migrations/20260917130000_calendar_v1.sql:760` (the seeded row and its column comment, which names the seam), `server/services/calendar/config.ts:59` (the key's comment, likewise), `scripts/ci/calendar-schema-gates.sql:227` gate C-01 (the config table holds exactly the formula sheet's keys plus this one and the six route/job/provenance keys).

SCL-141 | 2026-09-24 | Doc 05F §23 asks whether any locked document owns a per-domain importance weight; none does, and the calendar's generator weights by mastery level alone — the seam should be declared absent rather than left open | PROPOSED
Id: `SCL-141` allocated 2026-09-24, fifth and last of five sequential allocations this session (see SCL-137). This files Doc 05F §23's `SCL-08-G` in the canonical scheme.
Change: declare the seam ABSENT. Doc 05F §23's `SCL-08-G` closes and §20's gate `G-08-10` closes with it, on the finding that no locked document owns a per-domain importance weight and none is required: a domain's share of a study day is decided by the student's measured mastery in it, and by nothing else.
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:943`): "| SCL-08-G | Does any locked document own a per-domain importance weight? If Doc 05 Parent's macro-average implies equal domains, declare it absent. | Open (G-08-10) |"; (`:880`) "| G-08-10 | Domain importance seam resolved or declared absent | Open (SCL-08-G) |"
IS: absent, and the question's own premise is what settles it. Doc 05 Parent's macro-average is taken across **sources**, not domains — `docs/Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md:188` heads the section "**4.3 Source families and source weights (macro-average weights)**" and `:192` reads "The macro-average source weights sum to 1.0 by design, matching the traditional educational grading analogy (homework + quizzes + final exam, each contributing a category-weighted share to the final grade)"; the three weights are `weight_source_test` 0.50, `weight_source_practice` 0.30 and the flowcard share (`:516-517`). Doc 05B §4 runs that same formula per domain over the events tagged to that domain, independently of every other domain (`Doc 05B — Domain Mastery & KPI Rollups.md:52`), so no cross-domain weight is ever formed. The string "importance" appears nowhere in `docs/Spec/` except the two Doc 05F lines quoted above — the corpus was searched, not assumed.
  THE GENERATOR ALREADY BEHAVES THIS WAY. Formula sheet §2 step 3 weights a domain by the student's mastery LEVEL in it — `weight_by_level` `{"0":5,"1":4,"2":3,"3":2,"4":1}`, with `null_level_weight` 3 for an unmeasured domain (`supabase/migrations/20260917130000_calendar_v1.sql:720-724`). Two domains at the same level get the same weight, whichever they are. Declaring the seam absent changes no code; it records that the absence is a decision.
Rationale: a per-domain importance weight would be a claim that one SAT domain matters more than another at equal mastery. Nothing in the corpus makes that claim, and R-08-26's "unknown mastery is neutral, never inferred" is the same instinct applied one level down — the generator is not allowed to invent a judgement no observation supports. Leaving the question Open implies a locked document might answer it; none will.
Why this surfaced now: `SCL-08-G` and `G-08-10` have been Open since Doc 05F was drafted, in a scheme the register's duplicate gate cannot see. They are the last two calendar items with no register entry behind them.
Owner action: amend Doc 05F §23 (`:943`) to mark `SCL-08-G` **Closed — declared absent**, and §20 (`:880`) to close `G-08-10`.
Build artifact: none. No code changes; the finding is that the code is already correct and the open item was the only thing left.

SCL-144 | 2026-09-25 | SCL-060 REVERSED: the active question's explanation is withheld from the model pre-submit on every surface; possession is the control, not a prompt instruction | PROPOSED
Id: `SCL-144` allocated 2026-09-25 as max+1 at the moment of use, after `git fetch --all --prune`, across all 85 remote refs (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`). Highest anywhere is `SCL-143` (on `origin/exam` and `origin/claude/e6b-exam-deletion-cascade`). The heads of every open PR (#884, #883 `lisa`, #881 `exam`, #861 `cleanup`, #728 dependabot) are among the scanned refs; none carries a higher number. One allocation this session.
Change: reverse SCL-060 (RULING, 2026-08-28). The active question's explanation reaches the model only post-submit. Doc 03D §6.2, §6.3 and §6.6 are amended to match Doc 02B §21's Question Awareness table, which already reads: Review (pre-submit) — correct answer **No**, explanation **No**.
WAS (SCL-060, register `:258-261`): "the active question's explanation is delivered on `question_content.explanation` for all surfaces, pre-submit included … `resolveQuestionContent` … always populates `explanation`. The gate is which question (the active one), not which surface." Its premise: the explanation is internal context for the model, and the leak boundary is INV-03-04 (LISA writing the answer to the student), enforced by an anti-echo directive in the prompt and the output scan.
IS (closure plan W3-10, branch `claude/wizardly-franklin-ucty85-w3-10-explanation`): `resolveQuestionContent` does not select `question_explanation` pre-submit, and returns `explanation: null` pre-submit by an explicit gate. Post-submit, unchanged: the explanation is delivered. `correct_answer` was already post-submit only.
Rationale (owner ruling, 2026-09-25): "Sending `explanation` to the model pre-submit as 'internal context' means the model holds the explanation while the student is still working. CR-02B-29's own principle — cannot leak what it doesn't have — is violated by construction. Prompt instructions are not a control; possession is the control." An anti-echo directive is a request to the model; the output scan is pattern-based and catches phrasings it anticipates. Neither is a guarantee. Not sending the text is.
Consequence, accepted: pre-submit, LISA scaffolds from the stem, passage and options alone, as Doc 02B §21 already specifies for review pre-submit. LISA-AUDIT-001 (2026-08-28, "the pre-submit explanation never reached the production prompt" — BLOCKER) is thereby reversed; its proof test `tests/ci/lisa-audit-b1.8-proof.contract.test.ts` still exercises the worker's pre-submit explanation branch with a hand-built envelope, and is updated with the worker prompt PR, which removes that branch.
Why this surfaced now: LISA Core brief §2.2 (2026-09-25) — tracing what a scoped turn carries found `explanation` on the wire pre-submit.
Owner action: amend Doc 03D §6.2, §6.3, §6.6 to "explanation is delivered post-submit only"; mark SCL-060 superseded by SCL-144.
Build artifact: `server/services/tutor-context.ts` (`resolveQuestionContent`); `tests/ci/tutor-explanation-presubmit.contract.test.ts`.

SCL-150 | 2026-09-25 | SCL-111 AMENDED: tutor-in-review is launch scope, not deferred — Doc 02B §20 and §21's review rows describe the surface as built, and CR-02B-29 governs it live | PROPOSED
Id: `SCL-150` allocated 2026-09-25 as max+1 at the moment of use, after `git fetch --all --prune`, across all 91 remote refs (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`). Highest anywhere is `SCL-149` (on `origin/claude/e7a-exam-server`, SCL-145–149); `SCL-144` is this workstream's (`origin/claude/wizardly-franklin-ucty85-w3-10-explanation`, PR #885) and collides with nothing. Open PR heads are among the scanned refs. One allocation.
Change: amend SCL-111 (PROPOSED, 2026-09-22). SCL-111 marks the tutor-in-review surface DEFERRED POST-LAUNCH while retaining CR-02B-29. The deferral is withdrawn: owner ruling 2026-09-25 promotes LISA in review to launch scope (closure plan W4-1 — "a core purpose of review is learning from mistakes with LISA"). What SCL-111 RETAINED stays retained and is now in force rather than held for later.
WAS, verbatim (SCL-111's Owner action): "mark the §21 review-pre-submit paragraph and the §20 tutor-review-pre-submit bullet DEFERRED POST-LAUNCH, keeping their text as the rule for when it lands; keep the §21 Question Awareness row; state explicitly that CR-02B-29 is retained."
IS, as built on the `lisa` branch (PRs #884, #885, #888, #889):
  Doc 02B §20 Per-Endpoint Enforcement (`:1085`), "Tutor (review pre-submit): receives question context and options but does NOT receive correct_answer or explanation" — HOLDS AS WRITTEN. The pre-submit gate reads `review_session_items.status` (`server/services/tutor-antileak.ts`, `itemIsPreSubmit`; fails closed on no id, no row or error); the explanation is selected only post-submit (`server/services/tutor-context.ts`, `resolveQuestionContent`, SCL-144).
  Doc 02B §21 Surface-Aware Behavior (`:1115`), "In review (pre-submit): Tutor is available before submission … NOT the correct answer or explanation" — HOLDS AS WRITTEN, with one qualification: the tutor receives the stem, passage and options; it does NOT receive "the student's in-progress reasoning" as a field — only what the student types into the conversation.
  Doc 02B §21 Question Awareness (`:1150`), "| Review (pre-submit) | Yes | **No** | **No** | …" — HOLDS AS WRITTEN.
  POST-SUBMIT, NOT WRITTEN IN 02B FOR THE TUTOR — ADD: once the review item is answered or skipped, the tutor receives the correct answer and the explanation, exactly as it does in practice post-submit, matching §20's review post-submission row ("correctness, correct answer key, explanation") for the student.
  STILL TRUE AND UNCHANGED BY THIS ENTRY: `review_error_attempts.used_tutor` is written `false` by the trigger (`20260921000000_review_queue_runtime.sql:509`). Wiring it to real tutor use is a separate change, not made here; a turn in review does not touch grading, attempts or mastery.
  SCOPE: one conversation per review item (`entry_mode: scoped_question`, `source_surface: review`, `source_session_item_id`), resolved against the review tables and the student's ownership (`sessionTablesFor`, PR #888); the client panel beside the review question (PR #889).
Rationale: owner ruling 2026-09-25 (W4-1, launch-blocking for review). SCL-111's care — defer the surface, never delete its safety rule — is exactly what makes this reversal safe: CR-02B-29 was never removed, so the surface is built against it.
Why this surfaced now: closure plan row W3-9 (added 2026-09-25) — "SCL-111 marks tutor-in-review deferred … amend; review is launch scope".
Owner action: supersede SCL-111's deferral with this entry: do NOT mark §20's tutor-review bullet or §21's review-pre-submit paragraph DEFERRED; keep CR-02B-29 as written; add the post-submit tutor row for review as for practice; strike "student's in-progress reasoning" as a tutor input or read it as the student's own messages.
Build artifact: `server/services/tutor-antileak.ts`; `server/services/tutor-context.ts` (`sessionTablesFor`, `resolveScope`, `resolveQuestionContent`); `server/routes/tutor-runtime.ts` (`resolveTrustedScopeForCreate`); `client/src/components/tutor/ScopedTutorPanel.tsx`; `tests/ci/tutor-presubmit-gate.contract.test.ts`, `tests/ci/tutor-review-scope.contract.test.ts`, `client/src/components/tutor/ScopedTutorPanel.contract.test.tsx`.

SCL-151 | 2026-09-25 | INV-05E-07's sentinel asks whether `actor_id` IS NULL. A wrong non-null value is invisible to it, so two write paths set the grouping identifier to the profile's own primary key and every gate passed for weeks. The invariant needs to constrain the VALUE, and the check needs to be catalog-driven | APPLIED
Id: `SCL-151` re-derived at the moment of use, 2026-09-25, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref, and cross-checked against both open PRs (#861 `cleanup` → `main`, #728 dependabot — both in-repo branches already covered by the fetch). Highest allocated anywhere is `SCL-150`. **This entry was drafted as SCL-120 and renumbered before commit**: 120 and 121 are both taken, and `scripts/ci/exam-runtime-schema-gates.sh:6` already cites SCL-121 for Doc 04B §13. That is the collision the re-derivation rule exists to prevent, and it would have shipped. Two entries allocated this session, sequentially: SCL-151 and SCL-152.
Change: amend Doc 05E §6 INV-05E-07 to constrain the value of `actor_id`, not merely its presence.
WAS, verbatim (Doc 05E §6, as implemented in `execute_account_deletion_cascade` since 20260625020000): the invariant is enforced by a fail-closed sentinel that, for each of SEVEN named tables, counts rows where `<identity> = p_profile_id AND actor_id IS NULL` and refuses the deletion if any exist. The spec's wording — "verify every retained row for this user has its grouping identifier" — is satisfied by a non-null value of any kind.
IS: the sentinel discovers its own column set from `pg_attribute` (every `public` base table carrying an `actor_id` column beside a `user_id` or `student_id`) and asserts that every retained row keyed to the profile carries THAT PROFILE'S `actor_id`, read from `profiles` before the identity link is destroyed. One equality subsumes the old check and forbids the identity key. It refuses to run against fewer than seven tables, so a broken catalog query cannot pass vacuously.
  Alongside it, `public.actor_id_integrity_violations()` — the same discovery, whole-schema, four violation classes: NULL with identity present; `actor_id` equal to the row's own identity; `actor_id` equal to ANY `profiles.id`; `actor_id` resolving to neither a live `profiles.actor_id` nor an `anonymized_actors` row. Zero rows = pass. Wired as gate A.7 in `scripts/ci/genesis-fresh-apply.sh`, with a self-test that plants the defect and requires the check to name it — because a fresh schema has no rows and a bare run would be vacuous.
WHY THE OLD FORM COULD NOT CATCH THIS, WHICH IS THE USEFUL PART. Three independent guards all read green:
  (i) the sentinel asked about nullity, and the value written was non-null;
  (ii) the CI fixture (`seedActivity`, `tests/ci/deletion-evidence-bundle.pg.ci.test.ts`) writes `SELECT p.id, p.actor_id FROM profiles`, so the seeded value is correct BY CONSTRUCTION and the bug is unreproducible from the fixtures;
  (iii) no test drives the diagnostic route's session-create path at all, so the writer had no behavioural coverage.
  Nothing in the schema constrained the value. It took a real deletion plus the Doc 06D §6.3 catalog sweep — added five days earlier, for an unrelated reason — to surface it.
MEASURED SCOPE, production 2026-09-25, all nine tables carrying `actor_id` beside an identity column: `practice_session_items` 399 rows, 160 with `actor_id = user_id`, 40 orphaned-and-bogus; `practice_sessions` 35 rows, 4 and 1. `mastery_event_audit_log` (111), `mastery_domain_refresh_audit_log` (129), `review_sessions` (8), `review_session_items` (168), `review_error_attempts` (25), `score_runs` (0), `test_sessions` (0) — all zero and zero. The damage is confined to diagnostic-mode practice.
  PROVENANCE OF THOSE FIGURES: measured by the agent querying production directly, which CLAUDE.md's "ask the catalog, never the ledger" rule now forbids ("never query or write production yourself"). **Independently re-measured against production by the owner, 2026-09-25, and every number matched** — 160 items + 4 sessions to correct, 40 items + 1 session orphaned, and the 7 ledger-backed June orphans confirmed out of the predicate's reach. Cite them as owner-verified, not as the agent's measurement. The repair does not depend on them either way: `20261006000000` uses a general predicate with no hardcoded uuid, reports its own before/after counts by `RAISE NOTICE`, and refuses to commit a partial repair.
THE TWO WRITERS, AND WHY BOTH EXISTED. `server/routes/diagnostic-routes.ts:307`, `const actorId = userId`, flowing to the session insert and to items via `ctx.actorId`. `server/routes/review-canonical.ts:1538`, `actorId: user?.actor_id ?? studentId` — a fallback that NEVER FIRED (zero review rows carry `actor_id = student_id`, measured) but is the same defect latent. Both files declared `user` with a hand-rolled inline type (`{ id: string; role?: string }`, `{ id?: string; actor_id?: string }`) that narrowed `actor_id` away or made it optional; the canonical `SupabaseUser` in `server/middleware/supabase-auth.ts` carries it as `actor_id: string`. The bug's proximate cause is a type annotation that hid the correct field — which is what CLAUDE.md's single-source-of-truth rule is for. Both now consume `SupabaseUser` and fail closed on a missing value rather than substituting one.
Rationale: a nullity check on a field whose whole purpose is to be a SPECIFIC value is not an invariant, it is a presence test. INV-05E-06 says `actor_id` is the synthetic grouping identifier that survives while identity dies; if it may equal the identity, it is not synthetic and nothing survives the severance except the identity itself.
Why this surfaced now: `public.verify_deletion_layers` (SCL-153, wired into T3 on 2026-09-23) was run against the 2026-09-23 deletion on 2026-09-25 and returned `fail`, naming `practice_sessions.actor_id` and `practice_session_items.actor_id`. The scan's first real use found a defect nobody was looking for. Had T3 been wired two days earlier, that deletion would have recorded `fail` naming both columns and §6.5 (b) would have paged at deletion time.
Owner action: (1) amend INV-05E-07's wording from presence to value, as above; (2) ratify `public.actor_id_integrity_violations()` and gate A.7 as the enforcing mechanism; (3) note that the spec has never stated "no profile may have `id = actor_id`" — it is assumed everywhere and asserted nowhere, and violation class (0) now asserts it.
AUTHORISED, 2026-09-25 — owner ruling: "SCL-151 and SCL-152 — approved as filed."
APPLIED, 2026-09-25. Flipped under SCL-159: locked documents are not amended, so APPLIED means the change is LIVE in code, database or configuration and this entry records it. It is. **Owner-verified against the live catalog, 2026-09-25** (owner-run; this session does not query production):
  `public.actor_id_integrity_violations()` -> 0 rows.
  `practice_session_items` with `actor_id = user_id` -> 0, was 160. `practice_sessions` -> 0, was 4.
  Orphaned-and-bogus items/sessions -> 0 / 0, was 40 / 1. The 7 ledger-backed orphans -> untouched, so the predicate selected exactly what it was written to select.
  The 2026-09-23 deleted profile's primary key as an `actor_id` anywhere -> 0.
  The value sentinel -> present in the live `execute_account_deletion_cascade` body.
  Migrations `20261005000000` (guard) and `20261006000000` (correction) are live.
An earlier revision of this line argued the status must stay PROPOSED because the Doc 05E §6 amendment had not landed. That reasoning was correct under the STATUS VALUES ruling of 2026-09-16 and is superseded by SCL-159: the amendment will never land, and the condition it named would never have been met. Retained rather than deleted, because a register that hides its own corrections is the thing this vertical kept finding.
Build artifact: `supabase/migrations/20261005000000_actor_id_integrity_sentinel.sql`; `server/routes/diagnostic-routes.ts`, `server/routes/review-canonical.ts`; `scripts/ci/genesis-fresh-apply.sh` gate A.7 + self-test; `tests/ci/actor-id-writer.contract.test.ts` (D1.1-D1.4), `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.11/C3.12; mutations M94-M97.

SCL-152 | 2026-09-25 | `deletion_verification_records.deleted_profile_id` was granted on the explicit premise that the uuid dies with the profile and joins to nothing retained. Production falsified that premise: 41 retained rows carried the uuid in `actor_id`, making the column a live cross-universe join | APPLIED
Id: `SCL-152` re-derived at the moment of use, 2026-09-25 (see SCL-151; second and last of two sequential allocations this session).
Change: amend Doc 06D §6.2 to remove `deleted_profile_id`, and §6.4 to drop the corresponding RPC parameter. This REVERSES the carve-out SCL-100 asked for and got.
WAS (SCL-100, as applied): `deletion_verification_records` carries `deleted_profile_id uuid` — the one uuid besides `log_id` that the evidence-side structural rule tolerates. Its justification, verbatim from migration 20260918000000: "it lets the conformance job re-scan for that uuid and confirm absence, which is the difference between recording a pass and being able to re-derive one. It is sound only because no retained row carries that uuid once the profile is gone — proven, not assumed, by P6.6, which sweeps every uuid column in the schema."
IS: the column is dropped. `record_deletion_verification` takes three parameters, not four; the old four-argument function is DROPPED rather than replaced, because a CREATE OR REPLACE with a different argument list would leave a second, column-writing overload callable. The canonical form the manifest hash is taken over loses its fourth line — stated out loud because a silently-changed hash basis would be worse than the leak it fixes. No records exist in production (zero rows; the only completed deletion predates the T3 wiring), so nothing is invalidated. `verify_deletion_layers` loses its one exclusion and now sweeps the schema unconditionally: a stronger claim than it shipped with.
  The structural test reverts to forbidding EVERY uuid but `log_id`, with no exception list. P6.6's expectation changes from "exactly one holder, the verification record" to "no holders at all", and its name with it.
WHY THE PREMISE WAS FALSE, AND WHY THAT IS THE WHOLE POINT. The justification was conditional on a property of OTHER tables — that nothing retained carries the profile uuid. P6.6 did prove it, on CI fixtures that write `actor_id` correctly by construction. In production two write paths wrote the profile's primary key as `actor_id` (SCL-151), so for the 2026-09-23 deletion 41 retained rows carried the uuid and this column joined the evidence side to the pseudonymous side on it — the cross-universe join plan v4 §1 rule 3 and SCL-088 forbid outright, and the one C3.2's xmin assertion exists to prevent by a different route.
  The column was a CONVENIENCE: re-deriving absence later. The invariant it weakened is the one the two-universe design rests on. Convenience loses — owner ruling 2026-09-25 R1. Absence is still provable, by the better mechanism: the T3 scan proves it at deletion time and records the per-layer result, and it never needed the uuid stored. It is also what found the residue.
THE CLASS, worth recording beyond this instance: a structural exception justified by a property of code OUTSIDE the structure is only as sound as that code, and it fails silently when the code changes. This one was reviewed, argued, documented and granted — and it was wrong for reasons that had nothing to do with the review. A carve-out whose premise depends on a distant invariant should be refused even when the premise is true at the time.
Rationale: as above. Also: the migration that drops the column REFUSES to run while `public.actor_id_integrity_violations()` returns anything, because dropping it while the 41 rows exist would conceal the join rather than close it.
Why this surfaced now: SCL-151's investigation.
Owner action: (1) amend Doc 06D §6.2's DDL to drop the column and §6.4's signature to three parameters; (2) note that SCL-100's amendment request is thereby partly superseded — its other three column changes stand, this one is withdrawn; (3) rule on whether any future structural carve-out should require its premise to be asserted by a gate rather than by a test, given that this one's premise was tested and still false in production.
AUTHORISED, 2026-09-25 — owner ruling: "SCL-151 and SCL-152 — approved as filed."
APPLIED, 2026-09-25. Flipped under SCL-159, same reasoning as SCL-151. **Owner-verified against the live catalog, 2026-09-25** (owner-run): `deletion_verification_records.deleted_profile_id` is **dropped**, and migration `20261007000000` is live — which also means its own guard passed, since that migration refuses to run while `actor_id_integrity_violations()` returns anything. The carve-out is gone from the live schema, not merely from the repo.
Owner action (3) is now CLOSED by **SCL-160**: a carve-out weakening a structural invariant must name its premise, and that premise must be asserted by a gate reading the live catalog or live data, never by a test reading seeded data; if it cannot be expressed as a catalog query, the carve-out is refused. Owner actions (1) and (2) are superseded by SCL-159 — no spec amendment. Nothing on this entry remains open.
Build artifact: `supabase/migrations/20261007000000_deletion_verification_drop_deleted_profile_id.sql`; `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` (C3.1 exception list removed, C3.6/C3.9 updated), `tests/ci/deletion-phase-6.pg.ci.test.ts` (P6.5 3-arg, P6.6 renamed and absolute); mutation M96 retargeted.

SCL-176 | 2026-09-26 | Doc 03 §4.6's regional crisis resource table lists adult lines where the built system gives students youth lines, has one lane where the built system has two, and says nothing about a student whose country is unknown or outside Tier-1 | PROPOSED
Id: `SCL-176`, RENUMBERED from `SCL-171` on 2026-09-26 under the owner's standing authority of that
  date, which explicitly covers touching another workstream's entries this once. This entry and the
  2026-09-25 entry now headed `SCL-171` both held that id: this one was allocated by #906 in a scan
  that was correct when it ran, and the other pair had ALREADY renumbered once (from `SCL-167`/`SCL-168`)
  into the same numbers. Neither branch was wrong and neither was red alone — the same shape as the
  collision described under the 09-25 `SCL-171`. The HARD OVERRIDE decides it: the LATER allocation
  renumbers, measured by the entry's own date, and 09-26 is later than 09-25. Blast radius agrees with
  the rule rather than fighting it — renumbering this pair breaks exactly ONE citation outside this
  file, `docs/plans/LISA_Closure_Plan.md:263` (row W4-9) on `origin/lisa`, whose owner updates it;
  renumbering the other pair instead would have broken `CLAUDE.md:145` on every branch. Measured across
  all 114 remote refs.
  New id derived at the moment of use (max `SCL-174` across 114 refs; all 7 open PRs checked for
  numbers not yet on a branch, none above 174). Allocated 175, 176, 177 ascending by entry date; this
  is the second, and `SCL-177` below is its pair — they stay adjacent because they are one filing.
ORIGINAL ALLOCATION RECORD, retained: `SCL-171` allocated 2026-09-26 as max+1 at the moment of use, after `git fetch --all --prune`, across all 103 remote refs (`git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md`). Highest anywhere is `SCL-170` (on `origin/main`, `origin/exam`, `origin/claude/e9b-calendar-seam`). Every open PR's head is one of the scanned refs (#901 carries SCL-164–166, #903 SCL-167–168). Two allocations in this session: SCL-171 (this entry) and SCL-172.
Change: amend Doc 03 §4.6 so the resource table is the one students actually receive: youth-specific lines where the code has them, two lanes (crisis and safeguarding) rather than one, ISO `GB` as the key, and a named response for the country the table does not cover.
WAS, verbatim (`docs/Spec/Doc 03 — LISA (AI Tutor System).md:376-386`):
  "**Regional crisis resources (V1 Tier 1 countries):**
   | US | 988 Suicide & Crisis Lifeline (call or text 988\) |
   | CA | Talk Suicide Canada (1-833-456-4566) or text 45645 |
   | UK | Samaritans (116 123\) |
   | IE | Samaritans Ireland (116 123\) |
   | AU | Lifeline (13 11 14\) |
   | NZ | Lifeline Aotearoa (0800 543 354\) |
   | SG | Samaritans of Singapore (1-767) |"
  And (`:392`): "The orchestration layer (Doc 03C) selects the appropriate regional resource based on billing address country (not IP, per Doc 03A context resolution authority)."
  The section is silent on (a) a student whose country is unknown or not in the table, and (b) the abuse/neglect lane: §4.6's own signal list includes "Mentions of family violence or abuse" (`:365`), but the table has only suicide/crisis lines.
IS, as built on `lisa` (`server/services/crisis-resources.ts`, PR #900; tables moved unchanged from `tutor-crisis.ts`):
  Two lanes, selected by the classifier's `category` (`crisis` | `safeguarding`), each keyed by ISO 3166-1 alpha-2 with `UK` accepted as an alias of `GB` (Stripe returns `GB`; §4.6 writes `UK`).
  Crisis lane (`:39-47`):
   | US | 988 Suicide & Crisis Lifeline — call or text 988 |
   | CA | 988 — call or text 988 |
   | GB | Childline 0800 1111; Samaritans 116 123 |
   | IE | Childline Ireland 1800 66 66 66; Pieta 1800 247 247 |
   | AU | Kids Helpline 1800 55 1800 |
   | NZ | Youthline 0800 376 633 or text 234; 1737 |
   | SG | Samaritans of Singapore (SOS) 1767 |
  Safeguarding lane (`:57-65`):
   | US | Childhelp 1-800-422-4453; RAINN 1-800-656-4673 |
   | CA | Kids Help Phone 1-800-668-6868 or text CONNECT to 686868 |
   | GB | Childline 0800 1111 |
   | IE | Childline Ireland 1800 66 66 66 |
   | AU | Kids Helpline 1800 55 1800 |
   | NZ | Youthline 0800 376 633 or text 234 |
   | SG | National Anti-Violence Helpline 1800-777-0000 |
  Unknown or out-of-table country — NEW, the spec has no text for it (`:28-31`): a student whose `profiles.country_code` is null, blank, or not a key above receives a response that NAMES NO NUMBER, in either lane:
   crisis: "If you're in crisis, please reach out to someone right now. Call your local emergency number, or talk to a trusted adult — a parent, teacher, school counselor, or doctor. You don't have to go through this alone."
   safeguarding: "What you've shared matters. Please tell a trusted adult — a parent, teacher, school counselor, or doctor. If you're in danger right now, call your local emergency number."
  Every such resolution is logged at WARN (`crisis_country_defaulted`: student id digested, conversation id, category, reason `no_country` | `unsupported_country`; no crisis content), so ops can find the student.
  Source of the country, unchanged from `:392` and now actually wired: the billing country the INV-03-08 grant gate approved (`Customer.address.country`), written to `profiles.country_code` on every premium grant (PR #900).
Rationale:
  - Youth lines are correct for this product (owner ruling 2026-09-25): students are 15–18, and the youth services (Childline, Childline Ireland, Kids Helpline, Youthline, Kids Help Phone) are staffed for them; the spec's adult lines were chosen without that constraint. The code is right; the spec is stale.
  - The no-number fallback (owner ruling 2026-09-25): a hotline number is right in exactly one country. Before PR #900 an unknown country received the US lines — a student outside the US calling 988 reaches nothing. An honest pointer to local emergency services and a trusted adult works everywhere. The two texts above are verbatim as merged in PR #900.
  - Two lanes: a disclosure of abuse needs an abuse line, not a suicide line; §4.6 already detects both signals but routes only one.
  - Proven in production 2026-09-26 (closure plan W3-3): `country_code = SG` returns Samaritans of Singapore 1767; `XX` and null return the no-number fallback; no 988.
Divergences recorded for the owner, NOT resolved by this entry (number and naming verification is the owner's, and is out of scope):
  - CA crisis lane: the spec's Talk Suicide Canada was replaced in Canada by 9-8-8 (Suicide Crisis Helpline, launched 2023-11-30); the code uses 988 but names it "988 Suicide & Crisis Lifeline", which is the US service's name. The number is right for Canada; the name should be verified.
  - GB and IE crisis lanes add an adult line (Samaritans, Pieta) alongside the youth line; the spec's adult-only choice survives there as the second number.
  - §4.6's template response ("Hey, that sounds heavy. … I'll be here when you come back.", `:388-390`) is not the built wording; this entry does not amend the template.
Relation to other entries: SCL-DRAFT-A-declared-country (2026-08-31) proposes a second, self-declared country column and records that the crisis path is its natural consumer. This entry does not depend on it and does not decide it; if it lands, §4.6's `:392` must say which column the crisis path reads.
Owner action: amend Doc 03 §4.6 — replace the table with the two-lane table above keyed `GB` (with `UK` as an alias), add the unknown-country rule and both no-number texts, and add the WARN as the operational signal. Amend §21.2 step 3 ("Regional crisis resource selected from billing address country") to name the fallback. Verify the CA crisis-lane naming.
Build artifact: `server/services/crisis-resources.ts` (`CRISIS_RESOURCES`, `SAFEGUARDING_RESOURCES`, `UNKNOWN_COUNTRY_*`, `resolveCrisisCountry`); `server/routes/tutor-runtime.ts` (crisis turn, WARN); `server/lib/stripe/webhook-handler.ts` + `server/lib/account.ts` `setProfileCountryCode` (the write path); `tests/ci/crisis-country-resources.contract.test.ts`, `tests/ci/crisis-lane-routing.unit.test.ts`, `tests/ci/entitlement-write-path.ci.test.ts`.

SCL-177 | 2026-09-26 | Doc 03 §21.3 names a crisis review owner, an SLA and a list of review actions but no procedure; the procedure is DEFERRED POST-LAUNCH by owner decision, and the spec should say so | PROPOSED
Id: `SCL-177`, RENUMBERED from `SCL-172` on 2026-09-26 in the same pass and for the same collision as
  `SCL-176` above; see that entry for the rule applied, the blast-radius measurement and the derivation.
  Third and last of the three ids allocated in that pass.
ORIGINAL ALLOCATION RECORD, retained: `SCL-172`, allocated in the same scan as SCL-171 (max `SCL-170` across 103 refs and all open PRs); second of two allocations this session.
Change: record in §21.3 that the safety-review PROCEDURE — how a reviewer works a case from flag to close — is deliberately not specified for launch, so the gap is a stated decision rather than an omission.
WAS, verbatim (`docs/Spec/Doc 03 — LISA (AI Tutor System).md:1598-1613`):
  "Flagged conversations are routed to a safety review queue for human review. …
   * Owner: Founder or designated ops lead (primary reviewer)
   * Backup: Second designated reviewer for on-call coverage
   * Tooling: Shared ticketing system (Linear, Asana, or similar) with crisis-flagged conversations routed as high-priority tickets
   * SLA: Review within 48 hours of flag at launch; tighter SLA (24 hours) target after 30 days of operational experience
   **Review actions:**
   * Confirm classification (true positive / false positive)
   * Check if student continued using LISA after crisis signal (engagement pattern)
   * If concerning pattern, reach out to student via support email (if contact opted-in) with resources
   * If minor and escalation warranted, engage guardian per Doc 01 V6 guardian contact model
   * Update classifier training data for false positives (feedback loop)"
  What §21.3 does not say: when "concerning pattern" or "escalation warranted" is met; who decides and how that decision is recorded; what a reviewer writes on the case; what "resolved" requires; what happens when the SLA is missed; how the backup is engaged. The review actions are a checklist of things a reviewer MAY do, not a procedure for doing them.
IS, as built and as run (the mechanics exist; the procedure does not):
  - Tooling: NOT a ticketing system. An admin dashboard (`client/src/pages/admin/CrisisReviewList.tsx`, `CrisisReviewDetail.tsx`; `server/routes/admin-crisis-review.ts`) over `crisis_review_cases`, with Slack alerts to `#lyceon-crisis` on flag and per-message escalation (closure plan C-03, C-04).
  - Lifecycle: `status` `open` → `in_review` (claim) → `resolved`; `disposition` `true_positive` | `false_positive` (§21.3 review action 1); every view, status change, disposition and note audited (`crisis_review_audit_log.action`).
  - SLA: 48 hours (`public.crisis_review_sla_hours()`, the single definition), matching §21.3's launch figure; an hourly Cloud Scheduler sweep (`infra/terraform/cloud-scheduler-crisis.tf`, `15 * * * *`) raises a Slack breach alert (closure plan W2-2, W2-2a).
  - Exercised for real 2026-09-26: the owner worked all 11 open cases to resolution through the dashboard — the first use of the dashboard, the claim flow and its CSRF protection (closure plan W2-2b).
  So a reviewer can be alerted, claim, record a disposition and resolve inside the SLA; what they should DO between claim and resolve is decided case by case by the owner.
Decision (owner, 2026-09-26): the review procedure is DEFERRED POST-LAUNCH. At launch the owner is the reviewer, uses the dashboard, and applies §21.3's review actions by judgment. A written procedure is owed before a second reviewer works cases alone, and in any case before the V2 staffing triggers §21.3 already names.
Rationale: the risk this entry retires is invisibility, not the gap itself. A spec that names an owner and an SLA reads as if the protocol exists; recording the deferral makes the gap an accepted, dated decision that an auditor, a new reviewer or a later spec revision can see — and removes the ticketing-system tooling line, which describes something that was never built.
Owner action: amend Doc 03 §21.3 — (1) replace the Tooling bullet with the admin dashboard and Slack alerts; (2) add a line stating that the case-handling procedure (escalation criteria, guardian-contact decision and record, resolution requirements, missed-SLA handling, backup engagement) is DEFERRED POST-LAUNCH by owner decision 2026-09-26, the owner reviewing by judgment against the review actions until it is written; (3) name the trigger for writing it: before any second reviewer works cases unsupervised.
Build artifact: none — no code changes with this entry. Evidence: `supabase/migrations/20260813000000_crisis_review_queue.sql` (status, disposition, audit), `supabase/migrations/20260922100000_crisis_flag_atomic.sql` (`crisis_review_sla_hours()`), the admin files above; closure plan rows C-03, C-04, W2-2, W2-2a, W2-2b.
SCL-159 | 2026-09-25 | REGISTER SEMANTICS: locked documents are not amended; the register IS the change record. APPLIED means the change is live in code, database or configuration and this entry records it — not that spec text landed | RULING
Id: `SCL-159` re-derived at the moment of use, 2026-09-25, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref. Highest allocated anywhere is `SCL-158` (SCL-154..158 on `origin/exam` and `origin/claude/e9-exam-seams`). Every open PR checked: #900 and #897 sit on `origin/lisa`/`origin/claude/wizardly-franklin-ucty85-w3-3-country`, #898 on `origin/exam`, #861 on `origin/cleanup`, #728 is dependabot and carries no entry — all in-repo branches already covered by the fetch. Eight entries allocated this session, sequentially: SCL-159 and SCL-160 (the two rulings), then SCL-161 through SCL-166 from the coverage audit below.
Change: owner ruling (Karl, 2026-09-25). The locked corpus under `docs/Spec/` will NOT be edited. The register is the change record, not a queue of pending edits to the documents. Consequently the STATUS VALUES ruling of 2026-09-16 is re-read, WITHOUT coining a fourth value:
  - PROPOSED — the change is authorised but not live.
  - RULING   — a decision was recorded and nothing needs to be made live.
  - APPLIED  — the change is LIVE in code, database or configuration, and this entry records it.
WAS (STATUS VALUES, 2026-09-16, verbatim): "APPLIED — the amendment named in the entry has been MADE in docs/Spec/ … an entry is only APPLIED once the text is actually in the document, not once it is authorised." And: "An entry whose spec text has NOT landed is PROPOSED, however firmly it has been authorised: authorisation is not application."
IS: landing spec text is no longer the condition, because spec text will not land. "Authorisation is not application" SURVIVES intact and is the load-bearing half — it now means authorisation is not the same as the change being live. An entry Karl has approved but whose migration has not been applied is still PROPOSED.
THE COLLISION THIS RULING CREATES, AND WHICH IT MUST THEREFORE RESOLVE — reported before acting, per the brief. This ruling contradicts the register's ADMISSION test, not its status list. `## WHAT IS AN SCL — HARD TEST` (owner ruling 2026-08-31) opens "**An SCL amends the spec.**" and routes by outcome: "Outcome is 'the owner amends a document' -> SCL; Outcome is 'we do X in this repo' -> plan entry". If no document is ever amended, then read literally NOTHING qualifies as an SCL and every entry in this register — including the ~100 already filed and the coverage entries filed alongside this one — becomes a plan entry. That is plainly not the intent, but it is a real contradiction between two owner rulings, and left unresolved it makes the admission rule and the status semantics disagree about what this file is for.
  RESOLVED, by the precedent this register set for itself: the WHAT IS AN SCL section already carries a dated supersession line for exactly this situation — "A prior framing — 'spec-silent means plan entry' — was wrong and is superseded." A supersession note pointing here has been added to that section in the same change, restating the outcome test as: does this record a change to the SYSTEM'S SPECIFIED BEHAVIOUR (-> SCL, recorded here), or a way of working in this repo (-> plan entry). Under the restated test every existing entry remains admissible and nothing is reclassified.
  Karl: if you would rather author that section's wording yourself, the note is one revert; the substance is yours either way. What could not be left alone is the two rulings openly disagreeing.
WHAT DOES NOT CHANGE. The three-state distinction stands and is still worth keeping — code merged, SQL applied, change recorded — and it is still three states, not one. A merged PR is not an applied migration. What changes is only that the third state is satisfied by the register entry itself rather than by an edit to a locked document. RULING keeps its meaning; note that its stated scope ("the document already says the right thing", or "this is not a spec matter after all") does not describe an entry whose document says the WRONG thing and will not be corrected — that entry is PROPOSED until the change is live, then APPLIED. SCL-151 and SCL-152 were exactly that case.
Rationale: a register of permanently-unactioned amendment requests is a queue nobody drains, and its statuses stop carrying information — every entry reads PROPOSED forever regardless of whether the behaviour shipped. Binding APPLIED to the live system makes the status answer the question a reader actually has: is this true of the system now?
Why this surfaced now: SCL-151 and SCL-152 were authorised on 2026-09-25 and could not be flipped, because their amendments were never going to land. The status was blocked on a condition that would never be met.
Owner action: none — this entry IS the ruling. Recorded before any status was flipped, since it changes how every future entry is read.
Build artifact: this entry; the supersession note in `## WHAT IS AN SCL — HARD TEST`; the status flips on SCL-151 and SCL-152; `CLAUDE.md` "Is it deployed?" gains the stale-deployment-picture rule from the same brief.

SCL-160 | 2026-09-25 | CARVE-OUT PREMISE: a carve-out weakening a structural invariant must name its premise, and that premise must be asserted by a gate reading the LIVE catalog or LIVE data — never by a test reading seeded data. If the premise cannot be expressed as a catalog query, the carve-out is not granted | RULING
Id: `SCL-160` re-derived at the moment of use, 2026-09-25 (see SCL-159; second of three sequential allocations this session).
Change: owner ruling (Karl, 2026-09-25). This CLOSES SCL-152's Owner action (3), which asked whether a future structural carve-out should require its premise to be gate-asserted rather than test-asserted. It should, and the requirement is now absolute: (1) the carve-out must state its premise explicitly; (2) the premise must be asserted by a gate that reads the live catalog (`pg_attribute`, `pg_constraint`, `pg_proc`, `information_schema`) or live data; (3) a test over seeded fixtures does NOT satisfy (2); (4) if the premise cannot be expressed as a catalog query, the carve-out is refused.
WAS: nothing. A carve-out's premise could be argued in review and evidenced by a test, and `deletion_verification_records.deleted_profile_id` was granted on exactly that basis.
IS: as above.
WHY — THE REASONING IS THE INCIDENT, AND IT IS SHARPER THAN THE CLASS SCL-152 RECORDED. SCL-152 named the class as "a structural exception justified by a property of code OUTSIDE the structure is only as sound as that code". True, but it understates the mechanism. The real defect is that **the premise and its evidence had the same author.** `deleted_profile_id` was granted on the stated premise that no retained row carries the deleted profile's uuid. P6.6 agreed. P6.6 agreed because `seedActivity` (`tests/ci/deletion-evidence-bundle.pg.ci.test.ts`) writes `SELECT p.id, p.actor_id FROM profiles` — it reads both values from the same profile row, so a row where `actor_id = id` is a state the fixture CANNOT EXPRESS. The test was not wrong; it was structurally incapable of disagreeing with the premise it was checking. A fixture that can only construct conforming states proves conformance of the fixture, not of the system.
  A catalog sweep has no such limitation, because it reads what is there rather than what was seeded. This is not hypothetical: `public.verify_deletion_layers` found the violating rows the day it was first pointed at production (SCL-151), against the same premise P6.6 had been affirming for weeks.
Rationale: the strength of a guard is bounded by the range of states its input can take. Seeded data is authored, so its range is the author's imagination; the live catalog's range is reality. Only the second can falsify a premise the author believed.
Why this surfaced now: SCL-152 raised it as Owner action (3) and it was not ruled on at the time; the brief of 2026-09-25 rules on it.
Owner action: none — this entry IS the ruling. SCL-152's Owner action (3) is hereby closed; its (1) and (2) are superseded by SCL-159 (no spec amendment).
Build artifact: this entry. Existing mechanisms that already satisfy the rule and are the pattern to copy: `public.actor_id_integrity_violations()` wired as gate A.7 in `scripts/ci/genesis-fresh-apply.sh` (with a self-test that plants the defect, because a fresh schema has no rows and a bare run would be vacuous); `public.verify_deletion_layers`; gates `B-01`/`B-02` in `scripts/ci/calendar-schema-gates.sql`.

SCL-161 | 2026-09-25 | COVERAGE GAP: 13 of the 49 altered identity FK edges are recorded by no entry — 7 tutor RESTRICT→CASCADE, 5 activity NO ACTION→SET NULL, 1 `review_schedule.student_id` NO ACTION→CASCADE — and neither is the catalog-driven guard that replaced the enumerated cascade list | APPLIED
Id: `SCL-161` re-derived at the moment of use, 2026-09-25 (see SCL-159; first of six coverage entries).
Change: record the 13 edges and the guard. `supabase/migrations/20260917130000_declarative_fk_delete_actions.sql:42-50` alters 49 edges on this pipeline (51 on production). SCL-093 covers only the 36 operator-attribution edges (NO ACTION→SET NULL); SCL-094 covers only the 4 crisis edges. The remaining 13 have no entry at all: 7 tutor `student_id` RESTRICT→CASCADE, 5 activity NO ACTION→SET NULL, 1 `review_schedule.student_id` NO ACTION→CASCADE. Each changes what erasure does to a retained row, which is specified behaviour.
  Separately, `scripts/ci/fk-delete-action-guard.sql` replaced an enumerated cascade list with a `pg_constraint` sweep (G1 at `:104-120`; runner `scripts/ci/fk-delete-action-guard.sh`; CI step `.github/workflows/ci.yml:1186-1194`). Its own header states the point: "This guard does not read a list. It enumerates FROM `pg_constraint`" (`:15`). It appears in the register only inside other entries' Build-artifact lines (SCL-093:2841, SCL-094:2852).
WHY THE GUARD BELONGS ON THE RECORD, not just in a build-artifact line: it is the mechanism that makes erasure-completeness checkable, and under SCL-160 a catalog-reading guard is now the ONLY acceptable evidence for a structural premise. An enumerated list cannot cover an edge added later; the catalog sweep covers edges nobody has written yet. That is a property of the specified guarantee, not a CI convenience.
CORRECTION TO A FIGURE THIS REGISTER DOES NOT CONTAIN: the "~69 FK edges" figure used in session labels appears nowhere in the repo. The committed counts are 49 altered here / 51 on production, plus the 4 crisis edges. 69 is unverified and should not be cited.
WHAT IS VERIFIED FROM HERE: all of the above is live in the repository at the cited lines. Whether the 49 ALTER statements are live in the production catalog is NOT verified — this session does not query production (CLAUDE.md). To flip: `SELECT conname, confdeltype FROM pg_constraint WHERE conname = ANY(...)` against production, or simply confirm `20260917130000` applied.
Rationale: an edge whose delete action nobody recorded is an erasure behaviour nobody can audit. The gap is not that the work was wrong — it is that 13 edges' behaviour is asserted only by a migration comment.
Why this surfaced now: the 2026-09-25 coverage audit. Commit `1a588202` added exactly 20 register lines (SCL-093 and SCL-094) for a change that altered 49 edges and added a new guard.
Owner action: none required by SCL-159 (no spec amendment). Flip to APPLIED once the migration's application is confirmed from the catalog.
Build artifact: `supabase/migrations/20260917130000_declarative_fk_delete_actions.sql`; `scripts/ci/fk-delete-action-guard.sql` / `.sh`; `.github/workflows/ci.yml:1186-1194`.
APPLIED, 2026-09-26. Owner catalog pass against production: FK actions into `profiles` are **45 SET NULL, 21 CASCADE, 6 RESTRICT, 4 NO ACTION** (76 edges). The declarative actions and the catalog-driven guard are live.
THE RESTRICT COUNT, RECONCILED — the owner flagged 6 where 7 was expected, and asked which edge moved. It is not one edge, it is two, and the move was deliberate. `supabase/migrations/20260918000000_crisis_severance_and_verification.sql` converts three crisis edges from RESTRICT to SET NULL under owner ruling A6 (2026-09-17), and **two of those three reference `profiles`**: `crisis_review_cases.student_id` and `crisis_review_audit_log.reviewer_id`. The third, `crisis_review_cases.conversation_id`, references `tutor_conversations`, so it never counted here. `crisis_review_audit_log.case_id` stays RESTRICT by design — the case survives the deletion, so nothing may take its audit trail with it. That work is recorded in SCL-094. So the pre-crisis count was 7, and 7 − 2 = 5.
AND THAT LEAVES A DISCREPANCY THIS ENTRY DOES NOT CLOSE. Measured from the repository rather than asserted: the full migration pipeline applied clean to a throwaway PostgreSQL 16 database on 2026-09-26 yields **SET NULL 46, CASCADE 21, RESTRICT 5, NO ACTION 4** — the same 76 edges, a different split. The five RESTRICT edges the repo produces are, exactly:
  `account_deletion_requests.profile_id`, `entitlements.profile_id`, `guardian_consent_requests.student_profile_id`, `guardian_links.guardian_profile_id`, `guardian_links.student_profile_id`.
  Production reports 6 RESTRICT and 45 SET NULL. **Production therefore agrees with neither the pre-crisis state (7) nor the state this pipeline builds (5): exactly one edge that the repository makes SET NULL is RESTRICT in production.** One extra RESTRICT on an identity edge is an erasure-blocking constraint the repository does not know about.
  Naming it needs one query, which this session cannot run (CLAUDE.md: never query production). For the owner — the rows returned that are NOT in the five above are the answer:
```sql
SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
  FROM pg_constraint c
  JOIN unnest(c.conkey) k(att) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att
 WHERE c.contype = 'f'
   AND c.confrelid = 'public.profiles'::regclass
   AND c.confdeltype = 'r'
 ORDER BY 1, 2;
```
WHY THE GUARD DID NOT CATCH IT, WHICH IS THE PART WORTH KEEPING. `fk-delete-action-guard` is catalog-driven, and this entry praises it for that. But it runs against a **genesis fresh-apply** — a database rebuilt from the migrations — so what it proves is that the repository is self-consistent. It cannot observe production, so a production edge that diverges from the pipeline is invisible to it by construction. That is SCL-160's distinction applied one level out: the guard reads a live catalog, but not the live catalog that matters. A premise asserted against a rebuilt catalog is a premise asserted against the author's own artefact, which is the failure SCL-160 names, wearing better clothes.
  This is recorded here rather than filed as a new entry because it is the same subject, and it is left OPEN: the flip to APPLIED covers what this entry is about — the 13 edges and the guard, both live — and does not claim the repository and production agree edge-for-edge. They do not.

SCL-162 | 2026-09-25 | COVERAGE GAP: the three-transaction deletion execution path (T1 / T1.5 / T2 / T3) is the subject of no entry, although it is the sequence every erasure guarantee depends on | APPLIED
Id: `SCL-162` re-derived at the moment of use, 2026-09-25 (see SCL-159).
Change: record the path. `server/lib/account-deletion-execute.ts:21-27` defines it and `:776-790` runs it: **T1** (`:842`) marks the log executing via `mark_deletion_log_executing`; **T1.5** (`:937`); **T2** (`:959`) performs the cascade; **T3** (`:1081`) completes the log, and since SCL-153 also writes the verification record and the `profile_hard_deleted` audit row. The split is not incidental — it is what keeps the evidence side and the pseudonymous side in different transactions, which is the `xmin` rule of SCL-088 and plan v4 §1 rule 3. Collapsing T2 and T3 would break that invariant silently.
WHY IT MATTERS THAT NO ENTRY OWNS THIS: three separate entries depend on the path without describing it — SCL-088's `xmin` rule is only true BECAUSE of the T2/T3 split; SCL-097's mitigation (2) cites T3 batching; SCL-153 places verification "inside T3". A reader cannot get from any of them to what T1..T3 are. Commit `52231b08`, which built the path, changed ZERO register lines.
WHAT IS VERIFIED FROM HERE: live in the repository at the cited lines, on `cleanup`. NOT verified: whether this code is deployed to production — `cleanup` is an integration branch and Karl owns merges to `main`.
Rationale: the transaction boundaries ARE the privacy guarantee. An invariant enforced by "these two writes happen in different transactions" needs the boundary written down, or the next refactor merges them for tidiness.
Why this surfaced now: the 2026-09-25 coverage audit.
Owner action: none required by SCL-159. Flip to APPLIED once the path is live in production.
Build artifact: `server/lib/account-deletion-execute.ts`; RPCs `mark_deletion_log_executing` and `complete_deletion_log` (`supabase/migrations/20260917000000_deletion_evidence_bundle.sql:912`, `:963`).
APPLIED, 2026-09-26. Owner catalog pass against production: **all three verification functions present** and the four sweep functions live. The T1/T1.5/T2/T3 path is the one production runs.

SCL-163 | 2026-09-25 | COVERAGE GAP: the evidence bundle's own build — three tables, its RPCs, and the `execute_account_deletion_cascade` rewrite — is the subject of no entry, although four downstream entries depend on it | APPLIED
Id: `SCL-163` re-derived at the moment of use, 2026-09-25 (see SCL-159).
Change: record the build. `supabase/migrations/20260917000000_deletion_evidence_bundle.sql` creates `deletion_request_log` (`:65`), `deletion_consent_evidence` (`:81`) and `deletion_billing_record` (`:96`), the bundle RPCs (`:151, :216, :259, :312, :846, :877, :1016, :1046, :1094`), and rewrites `execute_account_deletion_cascade` (`:371`).
WHAT IS RECORDED AND WHAT IS NOT. Recorded as subjects: SCL-091 (the correlation key becomes `log_id`), SCL-100 (`deletion_verification_records` DDL), SCL-153 (verification inside T3), SCL-152 (dropping `deleted_profile_id`). All four are CONSEQUENCES of this schema. The schema, the RPCs and the cascade rewrite themselves are described only inside SCL-085, whose subject is the 24-month evidence retention period. So the register records what was later changed ABOUT the bundle, and not the bundle.
Rationale: the derivative entries are unreadable without it. SCL-152 argues about which uuids a verification record may carry; that argument presumes the evidence-side structural rule, which presumes these three tables exist and why.
WHAT IS VERIFIED FROM HERE: live in the repository at the cited lines. NOT verified: production catalog state. To flip: confirm the three tables exist (`information_schema.tables`) and that `execute_account_deletion_cascade`'s live `prosrc` is the rewritten body.
Why this surfaced now: the 2026-09-25 coverage audit. Same commit as SCL-162 (`52231b08`), same zero register lines.
Owner action: none required by SCL-159.
Build artifact: `supabase/migrations/20260917000000_deletion_evidence_bundle.sql`; `tests/ci/deletion-evidence-bundle.pg.ci.test.ts`.
APPLIED, 2026-09-26. Owner catalog pass against production: **four evidence tables present**; `anonymized_actors.anonymized_at` **dropped**; no suppression table (the bespoke one is gone, per SCL-090). The bundle, its RPCs and the rewritten cascade are live.

SCL-164 | 2026-09-25 | Doc 03A §19.3 and Doc 03 §14.2 describe the retention job as a daily/pg_cron task; the build uses Cloud Scheduler for the three tier sweeps and Vercel Cron for seven other jobs, and there is no pg_cron job anywhere | APPLIED
Id: `SCL-164` re-derived at the moment of use, 2026-09-25 (see SCL-159).
Change: record the scheduling substrate as built. Cloud Scheduler — `infra/terraform/cloud-scheduler.tf:69` (`retention_sweep_7d`, `30 5 * * *`), `:156` (`90d`, `40 5 * * *`), `:202` (`180d`, `50 5 * * *`), all POSTing `/api/internal/retention/sweep` under OIDC (`server/routes/internal-retention-routes.ts:110`); `:249` records the 365d tier as deliberately unscheduled. Vercel Cron — `vercel.json:6-35`, seven jobs including `/api/internal/execute-deletions` (`0 2 * * *`) and `/api/internal/notification-retention-sweep` (`0 5 * * *`). No `pg_cron` job exists for any of them.
  SCL-108 struck the ARCHIVAL half of those two spec sections; it did not touch the scheduling substrate, and no entry does.
Rationale: this is managed-service-first working as intended (CLAUDE.md) and the divergence is in the spec's favour, not against it — but the spec still says pg_cron, so the code and the document disagree and a reader cannot tell which is authoritative. Recording it is what closes that.
NOTE, carried from the audit and not a register matter: `infra/terraform/cloud-scheduler.tf:53` still comments "Only the 7d tier is scheduled", which the 90d/180d resources at `:156`/`:202` in the same file contradict. Stale comment, reported not fixed here.
WHAT IS VERIFIED FROM HERE: the declarations are live in the repository. NOT verified: whether Terraform has been applied in GCP — apply state is not assertable from a checkout, and `terraform plan` was last reported as 9 to add / 3 to import. That gap is itself the reason this entry is PROPOSED rather than APPLIED.
Why this surfaced now: the 2026-09-25 coverage audit. Previously recorded only as FINDING 2 inside SCL-101, whose subject is eleven published Privacy-Policy retention periods.
Owner action: none required by SCL-159. Confirm the Cloud Scheduler jobs exist in GCP to flip.
Build artifact: `infra/terraform/cloud-scheduler.tf`; `vercel.json`; `server/routes/internal-retention-routes.ts`.
APPLIED, 2026-09-26. Owner catalog pass against production: **four sweep functions live**. The substrate is as recorded — Cloud Scheduler for the tier sweeps, Vercel Cron for the rest, no pg_cron. The divergence from Doc 03A §19.3 / Doc 03 §14.2's pg_cron language stands as recorded; under SCL-159 the register is the change record and no document is amended.

SCL-165 | 2026-09-25 | WITHDRAWN 2026-09-26 — the finding was FALSE WHEN FILED, not stale. The writer exists, has since 2026-09-22, with nine CI-wired tests beside it. Retained with its original heading below because a register that deletes its own wrong entries teaches nothing | RULING
Id: `SCL-165` re-derived at the moment of use, 2026-09-25 (see SCL-159).
Change: record the gap and close it. `server/services/retention-sweep.ts:97-211` (`sweep7d`, `@spec [Doc-03_V1.1 §14.2, INV-03-19]`) deletes `tutor_conversations` whose `deleted_at` has aged past 7 days. `:108` comments that `deleted_at` is "set when entitlement lapses". No writer sets it — searched, none found.
THIS IS THE UNWIRED-MECHANISM CLASS AGAIN, and it is worse than the two previous instances because a schedule now runs against it. `20261005000000`'s sentinel and SCL-153's T3 verification were both cases of a mechanism that existed and was not reached. Here the mechanism is reached, on a timer, and finds nothing — so the observable signal is a job completing successfully every night at 05:30 while the retention rule it implements has never deleted a row. A green scheduled job is stronger false assurance than no job at all.
Rationale: INV-03-19 and Doc 03 §14.2 specify that tutor conversations are deleted 7 days after entitlement lapses. That is not happening. The sweep is correct; its input is never populated. Either the entitlement-lapse path must write `deleted_at`, or the sweep must derive expiry from entitlement state directly rather than from a column nobody sets.
WHAT IS VERIFIED FROM HERE: the sweep body and the absent writer are both established from the repository. NOT verified: whether any `tutor_conversations` row in production carries a non-null `deleted_at`. The query that would settle it, for the owner to run:
  `SELECT count(*) AS total, count(deleted_at) AS with_deleted_at FROM public.tutor_conversations;`
  If `with_deleted_at` is 0, the tier has deleted nothing since it was specified.
Why this surfaced now: the 2026-09-25 coverage audit. Previously recorded only as FINDING 1 inside SCL-101 and explicitly "a report, not a fix" — which is exactly how a finding stops being acted on.
Owner action: rule on which of the two fixes to take. This one is a live privacy gap, not bookkeeping: a retention promise with no enforcement.
Build artifact: none yet — this entry is the finding. `server/services/retention-sweep.ts:97-211`; `infra/terraform/cloud-scheduler.tf:69-116`.
WITHDRAWN 2026-09-26. **Everything above this line is wrong, and it was wrong when it was written.** Retained verbatim rather than deleted, per the discipline this vertical has applied throughout: a register that quietly removes its own false entries is a register whose silence carries no information.
THE WRITER EXISTS AND DID WHEN THIS WAS FILED. `supabase/migrations/20260922010000_tutor_lapse_severance.sql` defines `public.sync_tutor_conversations_on_entitlement_change()` and the trigger `entitlements_sync_tutor_conversations` (`AFTER INSERT OR UPDATE OF status ON public.entitlements`). It stamps `tutor_conversations.deleted_at = now()` when `public.entitlement_active(profile_id)` turns false, and CLEARS it when it turns true, so a returning student keeps their history. Commit `f7ce898e`, dated 2026-09-22 — three days BEFORE this entry was filed, on `cleanup`, and present at this branch's own base commit.
  Its header addresses, by name, the exact finding this entry re-reported: "`retention-sweep.ts:113` has documented `deleted_at` as 'set when entitlement lapses' since 2026-08-20. That writer did not exist... **This is the writer.**" It cites "SCL-101 addendum finding 1" — the finding this entry was re-treading.
  It is tested: `tests/ci/tutor-lapse-severance.pg.ci.test.ts`, nine cases C1.1-C1.9, wired at `.github/workflows/ci.yml:1309` with two mutations pointed at it (`scripts/ci/deletion-evidence-gate.mutations.sh:468`, `:747`). **C1.6 is named "the 7-day sweep's predicate now matches a row (it never did before)"** — precisely the test this entry proposed adding as its open item. C1.3 pins FIRST LAPSE WINS; C1.4 pins the resubscribe clear; C1.7 pins that the predicate reads only `status`, which is what makes `UPDATE OF status` sufficient and stops the trigger's column list rotting against the predicate's body.
WHY THIS ENTRY WAS WRONG, STATED PRECISELY, because the wrong diagnosis is more instructive than the right one. The owner's first reading was that the finding had gone STALE — that a migration landed after the agent's last production read. That is not what happened and the record should not say it did. The migration was in the repository, on the base branch, three days early, with a test suite and CI wiring. Nothing about production was involved. The agent's coverage audit searched for a writer, reported "searched, none found", and the finding was filed on that report without the central claim ever being verified against the migrations directory. One `grep` over `supabase/migrations/` for `deleted_at` would have ended it.
THE IRONY IS THE POINT, AND IT IS WORTH MORE THAN THE FINDING WAS. This entry accused the system of false assurance from an unverified green signal — "a green scheduled job is stronger false assurance than no job at all". It was itself an unverified RED signal, which is the same defect with the sign flipped and is in some ways worse: a false alarm spends the owner's attention, and it spent it on a privacy claim. **The register's own standard, from SCL-160 filed the same day: a claim's evidence must be capable of disagreeing with it.** "An agent searched and found nothing" cannot disagree with "nothing exists" — absence of evidence was reported as evidence of absence, by a process structurally unable to distinguish the two. SCL-160 demanded catalog-backed evidence for a carve-out's premise. The same standard applies to a defect claim, and this entry did not meet it.
NOTHING REMAINS OPEN. The writer is live (owner-verified in the production catalog, 2026-09-26). The sweep is scheduled. The test the owner asked for already exists and runs in CI. Production currently shows 17 tutor conversations and zero carrying `deleted_at`, which is correct and not a defect: no entitlement has lapsed yet, so the mechanism has had no input. **A mechanism that is wired and has not yet had an input is a different thing from a mechanism with no input** — that distinction is what this entry got backwards, and it is the only thing in it worth keeping.
Status RULING, not PROPOSED: per this register's STATUS VALUES, a decision recorded where no amendment is needed and "this is not a spec matter after all". No fourth value coined for a withdrawal.

SCL-166 | 2026-09-25 | COVERAGE GAP: runtime-config seeding is recorded for `observability_runtime_config` only, and only as an amendment inside another entry; `calendar_runtime_config` and `account_deletion_runtime_config` seeds are recorded nowhere, including one bound that deviates from Doc 05F §21 | APPLIED
Id: `SCL-166` re-derived at the moment of use, 2026-09-25 (see SCL-159; last of six coverage entries).
Change: record all three seeds, and the deviation. Seeds as built:
  `observability_runtime_config` — `supabase/migrations/20260922020000_observability_retention_config.sql:74-96`, seeded from the published Privacy Policy v4 §6.5/§6.7 via `to_jsonb(<enforcing function>)`; `cold_log_retention_days` and `alert_thresholds` deliberately unseeded. Recorded, but only as an amendment inside SCL-101 (line 2963), whose subject is something else.
  `account_deletion_runtime_config` — `supabase/migrations/20260917120000_deletion_sweeps_and_config.sql:62-71`, seeded from Doc 01 V8 App A.5. No entry.
  `calendar_runtime_config` — `supabase/migrations/20260917130000_calendar_v1.sql:705` and `20260917140000_calendar_route_constants.sql:73`, seeded from Doc 05F §8.1/§21. No entry.
THE DEVIATION, which is the part that actually needs a ruling: `weekly_job_interval_minutes` is specified by Doc 05F §21 as a bound of 15..360 launching at 60; the seeded upper bound is **1440**. A config bound widened past its specified range is a silent behaviour change — the spec's ceiling exists to stop the weekly regeneration drifting into a daily-or-worse cadence, and 1440 permits exactly that.
Rationale: a runtime config table is where specified constants go to diverge quietly. The value is no longer in the document that specifies it, and nothing compares the two. This is the same absence-of-signal class as the rest of this vertical: `observability_runtime_config` at least has `tests/ci/observability-retention-config.pg.ci.test.ts` pinning its seeds; the other two have nothing.
PRECISION, because the audit's first reading was looser: only the observability seed comes from a PUBLISHED policy file. The other two come from locked spec docs. "Seeded from the published policy" is true of one of the three, not of the pattern.
WHAT IS VERIFIED FROM HERE: the seed statements and the 1440 bound are live in the repository at the cited lines. NOT verified: the live values in the three config tables. Per CLAUDE.md the config table itself is the authority for "is this config value live", so the queries for the owner:
  `SELECT key, value FROM public.calendar_runtime_config ORDER BY key;`
  `SELECT key, value FROM public.account_deletion_runtime_config ORDER BY key;`
Why this surfaced now: the 2026-09-25 coverage audit.
Owner action: rule on `weekly_job_interval_minutes` — either the 1440 bound is intended and Doc 05F §21's range is what the register records as superseded, or the seed is wrong and should be 360.
CORRECTION 2026-09-26, TO THIS ENTRY'S OWN CHARACTERISATION — the ruling on it is HELD pending the owner, and the reason is below. This entry called the 1440 bound "a silent behaviour change" and said "the value is no longer in the document that specifies it, and nothing compares the two". **Both halves are false, and checking the migration before writing that sentence would have shown it.**
  It is not silent. `supabase/migrations/20260917140000_calendar_route_constants.sql:67-71` states it as a header note — "One deviation from Doc 05F §21, recorded in the PR: it bounds weekly_job_interval_minutes at 15..360 and launches it at 60, which assumed a sub-daily sweep. The job is a daily Vercel cron, so the launch value is 1440 and the ceiling is raised to match. A bound the launch value already violates is a bound nobody is enforcing." The seeded row's own `description` column repeats it in full (`:88`). The deviation is declared twice, in the two places a reader would look.
  It is not a behaviour change. The row DESCRIBES when an existing job wakes. `/api/internal/calendar-weekly-regen` is scheduled `30 5 * * *` in `vercel.json:32-33` — daily, i.e. 1440 minutes. The config was raised to match a cadence that already existed; it did not cause one.
WHY THE RULING IS HELD RATHER THAN APPLIED. The owner ruled (2026-09-25) "seed 360, not 1440", on this entry's framing that the seed quietly exceeded its spec'd range. Applied literally it would produce the defect it is meant to prevent: the live job wakes every 1440 minutes, so a row reading 360 would state a cadence the system does not run, and — if `value` is required to sit within `min_value`/`max_value` — a seeded value of 1440 under a ceiling of 360 is self-inconsistent on its face. A config row that misdescribes its own live job is the config equivalent of a published policy with no mechanism, which is the standard the ruling invoked, pointed the other way.
  The real question is therefore not 360-vs-1440 but which artefact is wrong: Doc 05F §21's 15..360 range (written when the sweep was assumed sub-daily) or the daily Vercel cron. Three coherent outcomes, for the owner: (a) the cron is right and §21 is superseded — record that here and leave the seed at 1440; (b) §21 is right and the job should wake sub-daily — that is a `vercel.json` schedule change first, with the seed following it; (c) the ceiling returns to 360 AND the seed to 360 AND the cron changes to match, all in one change. What must not happen is the seed alone moving to 360 while the cron stays daily.
Also recorded, since this entry claimed otherwise: `tests/ci/student-resources.contract.test.ts:130` and `tests/ci/calendar.service-harness.ts:187` both pin `weekly_job_interval_minutes` at 1440, so the value is not unguarded — a change to it reddens two suites.
RULED 2026-09-26 — outcome (a) of the three offered. **Doc 05F §21's bound for `weekly_job_interval_minutes` is superseded: the ceiling is 1440, not 360.** Owner ruling: the seed describes the cron, the cron is daily and correct, and moving the seed alone would create the exact defect the earlier ruling existed to prevent. The 2026-09-25 "seed 360" instruction is withdrawn; holding it rather than applying it was correct.
  NOTHING IS EDITED IN `docs/Spec`, and that is not an omission. Under SCL-159 the locked corpus is not amended and this register IS the change record, so "change §21's bound to 1440" is DISCHARGED BY THIS ENTRY EXISTING. A future reader who finds §21 saying 15..360 should read it as superseded here. No code changes follow: the seed stays 1440, `min_value`/`max_value` stay 15/1440, and `/api/internal/calendar-weekly-regen` stays `30 5 * * *`.
  This is the first entry filed under SCL-159's semantics where the spec and the register disagree on their face and the register wins. Worth noticing as a precedent: §21 is now a section whose published text is wrong and will stay wrong, and the only thing between a future reader and that wrong text is this entry. That is the trade SCL-159 makes, taken deliberately.
APPLIED, 2026-09-26. Owner catalog pass against production: config seeded — **3 rows `account_deletion_runtime_config`, 2 rows `observability_runtime_config`**. The seeds this entry records are live. `calendar_runtime_config` was not enumerated in that pass; per CLAUDE.md the config table itself is the authority for whether a config value is live, so that half is recorded here and unverified from this session.
Build artifact: the three migrations cited above; `tests/ci/observability-retention-config.pg.ci.test.ts`.
SCL-171 | 2026-09-25 | Doc 05F §19's test matrix specifies 403 for a guardian with no link and 403 for a link to an unentitled student; the ruled and shipped behaviour is 404 and 402, which §16 already describes — the document contradicts itself | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: no code change was needed: `server/middleware/subject-resolver.ts` and `20260827000000_guardian_view_decision.sql` already serve the ruled 404 / 402, asserted by `tests/ci/student-resources.contract.test.ts`; production verified 2026-09-27 by read-only query.
Id: `SCL-171`, RENUMBERED from `SCL-167` on 2026-09-26. Originally allocated 2026-09-25 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE 'SCL-[0-9]{3}'` over all 99 remote refs on `docs/SpecAudit/SPEC_CHANGES_LOG.md`: max `SCL-166`) and every open PR (6 open — #901, #900, #898, #897, #861, #728; every head branch is among the scanned refs, so none carries a higher number).
  WHY IT COLLIDED ANYWAY: the E9b workstream allocated `SCL-167`..`SCL-170` concurrently on `claude/e9b-calendar-seam`, a branch that did not exist when the scan above ran, and #902 merged it to `main`. The owner merged `main` into `claude/guardian-calendar` on 2026-09-26 at 05:17 UTC (`8ffe431c`), which put both pairs in one file and turned `ci` red on `scripts/ci/scl-duplicate-check.mjs`. That is the gate working exactly as intended, on a duplicate neither branch had on its own — the case the register's HARD OVERRIDE anticipates and the reason the gate re-runs after a merge rather than only at allocation time.
  WHICH SIDE RENUMBERS, and why it is not a coin toss: both entries are dated 2026-09-25, so the register's "the LATER allocation renumbers, measured by the entry's own date" does not decide it. What decides it is blast radius plus the standing rule never to renumber another workstream's branch. E9b's ids are already merged to `main` and cited from ~20 files, one of them the body of a shipped `COMMENT ON FUNCTION` in `supabase/migrations/20261004000000_calendar_full_length_seam.sql:206` that is pinned byte-for-byte in `scripts/ci/genesis-schema.expected.sql:5765` — so renumbering theirs would be a production schema change, not a docs edit, and would break live citations. These two entries were cited from exactly two places: this file and `CLAUDE.md`. So these two renumber to max+1 and max+2 and E9b's `SCL-167`..`SCL-170` stand untouched.
  Renumbered ids derived at the moment of use, not taken from any instruction: `git fetch --all --prune` then `git grep -hoE '^SCL-[0-9]{3}'` over `docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote ref gives max `SCL-170`; open PRs were checked for entries not yet on any branch. So `SCL-171` (this entry) and `SCL-172`. First of two sequential renumbers (SCL-171, SCL-172).
Change: §19's Routes row reads **404 / 404 / 402** across the three guardian denials — **404** no link, **404** revoked link, **402** link to an unentitled student — matching §16 and the resolver. The free-student **402** in the same row is correct and unchanged.
APPROVED by the owner 2026-09-26, quoted verbatim and under this entry's then-id: "SCL-167 — approved, §19's denial row becomes 404/404/402, spec only." (That approval is THIS entry, renumbered to `SCL-171` on 2026-09-26 — see the Id line. The quote is left exactly as the owner gave it rather than edited to match the new number: a verbatim record that is silently corrected is no longer verbatim.) The three-value form is the owner's; the entry as first filed named only two denials and did not state the REVOKED case explicitly, which is the one a reader would most likely get wrong. A revoked link reaches 404 by the same term as no link at all: `guardian_view_decision` requires `gl.status = 'active'`, so a revoked row is not a link as far as the gate is concerned and returns `not_linked` (`supabase/migrations/20260827000000_guardian_view_decision.sql:102-106`). Byte-identical denial bodies for "no such student" and "you are unrelated to them" are deliberate — `sendNotFound` is one function for exactly that reason (`server/middleware/subject-resolver.ts:75-82`), and a revoked link distinguishable by its bytes would reopen the enumeration channel the 404 closes.
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:860`): "| Routes | Denial per route (free 402, guardian no-link 403, guardian link-but-student-free 403) and the streak route asserted to have **no** entitlement check. The guardian payload asserted to contain the block and none of §16's withheld keys, at both levels. |"
IS: the same row with `403` replaced by `404` for no-link and for a revoked link, and by `402` for link-but-unentitled. Everything else in the row is correct and stays.
Rationale: §16 (`:753`) already sends the guardian read "through the existing `resolveSubject` + entitlement-gate pattern", and that pattern's codes are settled. `resolveSubject` answers **404** for `not_linked` through the shared `sendNotFound` (`server/middleware/subject-resolver.ts:135`, `:75-82`) because Doc 05B §10.3 requires it — "Unrelated authenticated users get 404, not 403 — this avoids leaking whether the student_id exists" — and a 403 would confirm the student exists to anyone who can guess a uuid. It answers **402** for `student_unentitled` (`:127-134`) under an explicit owner ruling of 2026-08-27 (OQ1), whose own comment reads "DO NOT 'correct' this back to a uniform 404 without a new ruling", because collapsing it would delete the paywall path the guardian upgrade flow depends on.
  So §19 and §16 describe the same two denials with different codes, inside one locked document. §19 is the outlier: it is a test-matrix row, while §16 is the contract and the resolver is the implementation, and the resolver's codes carry a ruling that §19 predates.
Why this surfaced now: Brief 12 specified the guardian denial tests from §19. Writing them as specified would have asserted 403 and gone red against ruled behaviour — the row would have produced a false defect report rather than a test.
Owner action: amend Doc 05F §19 (`:860`) as above. `docs/Spec/` is read-only to Claude Code (hard-blocked by `.claude/hooks/block-spec-and-secrets.mjs`), so the amendment is drafted here; **no code changes** — the code is correct and the brief says so explicitly.
Build artifact: none. `server/middleware/subject-resolver.ts` and `supabase/migrations/20260827000000_guardian_view_decision.sql` already implement the ruled codes; `tests/ci/student-resources.contract.test.ts` already asserts them.

SCL-172 | 2026-09-25 | THREE declarative gates on `entitlement_features` — `required_age_minimum`, `requires_tier_1_country`, `min_abuse_score_tier` — are populated on every feature row and read by nothing: `canAccessFeature` selects `required_tier, enabled` only, so none has ever been evaluated | PROPOSED
Id: `SCL-172`, RENUMBERED from `SCL-168` on 2026-09-26 for the collision described under SCL-171 (E9b allocated `SCL-168` concurrently and merged it to `main` first). Originally allocated 2026-09-25, second of two sequential allocations this session (see SCL-171).
Change: Doc 01 rules what `required_age_minimum` is for. Either (a) `canAccessFeature` must consult it, in which case Doc 01 §27 states the term and what a caller under the minimum receives — a 403, a 402, or a distinct code — or (b) the column is declared vestigial and dropped, so no future reader mistakes a populated column for an enforced rule.
WAS, verbatim (`supabase/migrations/00000000000000_genesis.sql:211`): "  required_age_minimum    INTEGER DEFAULT 13," — inside `CREATE TABLE public.entitlement_features`, alongside `requires_tier_1_country` and `min_abuse_score_tier`, which are in the same position.
IS: never read. `EntitlementService.canAccessFeature` is the one call site for feature access on the subject-scoped surface (`server/routes/student-resources.ts:184-189` names it as such) and its query is `.select("required_tier, enabled")` (`server/services/entitlement-service.ts:142`). The column is populated — 13 on both `calendar_access` and `mastery_detail`, verified read-only by the owner 2026-09-25 — and no code path compares it to anything.
Rationale: this is the failure class the mastery vertical already named one layer up, in the comment on `requiresEntitlement` (`server/routes/student-resources.ts:84-96`): "a mechanism that reads as the single source of truth, is typed, is documented, and is not consulted. A table nobody queries is a comment with a type annotation." The same is true of a column nobody selects, and it is worse here than there: this is a platform for 13-18 year olds, so a populated `required_age_minimum` reads to any auditor as an enforced age gate. It is not one. Nothing is currently mis-served because of it — every feature's minimum is 13 and the platform's floor is 13 — so this is a latent misrepresentation, not a live defect, which is why it is filed rather than fixed.
  `requires_tier_1_country` and `min_abuse_score_tier` sit in the same table and are equally unread by `canAccessFeature`; if (a) is ruled, they need the same answer, and the ruling should say whether it covers them.
Why this surfaced now: Brief 12 asked what mastery's guardian path does for a minor. The answer is nothing — `guardian_view_decision` is an active link and `entitlement_active`, with no age term (`20260827000000_guardian_view_decision.sql:99-109`) — and looking for where the platform DOES gate on age is what found the column.
OWNER SCOPE RULING, 2026-09-26: filed, not decided here. Verbatim: "file it, don't decide it here. `required_age_minimum` is populated at 13 on both features and never read; `requires_tier_1_country` and `min_abuse_score_tier` sit in the same position. Three dead gates on a product for 15-18 year olds is a Doc 01 ruling with legal weight, not a calendar cleanup. Flag it to me separately when the entitlement work comes up."
  So this entry is NOT waiting on a calendar decision and must not be closed by one. It is a Doc 01 ruling with legal weight, to be raised with the owner when the entitlement vertical is next open. The title and subject line are widened from one column to three accordingly, because the owner's framing is that the COUNT is the finding: one unread column is an oversight, three is a pattern in how declarative gates on this table were built.
  ON THE AGE RANGE, recorded rather than silently reconciled: the owner's framing says "15-18 year olds". CLAUDE.md's first line and Doc 00 both say the platform serves students **13-18**, and `required_age_minimum` is seeded at exactly **13** — which is the COPPA boundary, and the reason this column exists at all. The discrepancy moves the ruling's weight in one direction only (a younger floor makes an unenforced age gate more consequential, not less), so nothing here is softened by it; but a ruling with legal weight should carry the right number, and 13 is the number in the schema.
Owner action: when the entitlement work is next open, rule (a) or (b) for all three columns and amend Doc 01 §27 accordingly. Out of the calendar's scope either way; no behaviour change here.
Build artifact: none — reported, not fixed, per the brief.
SCL-154 | 2026-09-25 | Doc 05C §8.3 and Doc 05D §12.3 require the projection refresh request to be written "in the SAME transaction" that finalises the full-length section score; Doc 04B §16.1 and §5.16 say the scoring transaction commits exactly two artifacts, `score_runs` and `score_run_event_ledger`, "and nothing else" — the two cannot both hold | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `exam_apply_scored_seams(uuid)` present; `20260930110000_exam_seams.sql`; production verified 2026-09-27 by read-only query.
Id: `SCL-154` allocated 2026-09-25 after `git fetch --all --prune`, scanning `docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote branch (highest `SCL-153`) plus a whole-tree `SCL-15[4-9]` scan on every branch (no hit). Open PRs #895 (`lisa`), #894 (`cleanup`, carries SCL-151/152), #861, #728 are among the scanned refs. First of five sequential allocations this session (SCL-154 .. SCL-158).
Change: **04B §16.1 wins** (owner ruling R1, E9). Scoring commits its two artifacts only. The consumer (`exam_score_outbox_event`) then enqueues ONE more `exam_runtime_outbox` event for the session, `test_session_scored` (a new value of 04A §5.7's `event_type`; at most one per session by a partial unique index), carrying `score_run_id`. That event is consumed in a SEPARATE call — its own transaction — by `exam_apply_scored_seams`, which writes the review queue (SCL-158), the full-length mastery events (SCL-156) and the projection refresh request (SCL-155), all idempotent, with the outbox's existing attempts / 5-strike dead letter, re-driven by the sweep. The E5 hook `emit_score_run_side_effects` is removed rather than filled.
WAS, verbatim: 04B §16.1 (`docs/Spec/Lyceon_Doc_04B_V43.md:1793`) "The scoring transaction commits exactly two artifacts — `score_runs` and `score_run_event_ledger` — and nothing else."; 05C §8.3 / 05D §12.3: the outbox insert "in the SAME transaction that finalizes the full-length section score".
IS: the projection row is written seconds after the score, by the seams event, never inside the scoring transaction.
Rationale (owner ruling 2026-09-25): 05C/05D say "same transaction" to guarantee the row is never lost; an outbox with retry and dead-lettering gives the same guarantee without coupling a projection refresh to the integrity of a scoring transaction — a seam failure must never un-score a test. And "same transaction" was not achievable as built: the E5 hook runs as `lyceon_scoring_owner`, which has no INSERT on `projection_refresh_outbox` (verified in production, `has_table_privilege` false); widening a role that exists to be narrow was the only alternative.
The anonymised student (E6b): a score can land with `student_id` NULL. The seams re-read `test_sessions.student_id` when they RUN (never from the payload) and skip review, mastery and the projection row when it is NULL or the profile is gone, recording `result.outcome = 'skipped_no_student'` on the event. The score still computes.
Why this surfaced now: E9 wired the first writers of all three seams.
Owner action: amend 05C §8.3 and 05D §12.3 to "written by the post-scoring outbox event, not the scoring transaction"; add `test_session_scored` to 04A §5.7's event types.
Build artifact: `supabase/migrations/20260930110000_exam_seams.sql` §1, §7, §8; `scripts/ci/exam-seams-gates.sql` S2, S6, S7 (plant P7 — seams inside the scoring transaction — fails the scoring itself); `scripts/ci/scoring-engine-gates.sql` G1 (the hook must not exist).

SCL-155 | 2026-09-25 | Doc 05C §7.7's `projection_refresh_outbox` keys on `student_id` alone, so "one refresh request per completed full-length" cannot be enforced — every replay of the writer would add a row | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `20260930110000_exam_seams.sql` (`projection_refresh_outbox.test_session_id`); production verified 2026-09-27 by read-only query.
Id: `SCL-155` allocated 2026-09-25, second of five (see SCL-154).
Change: add `test_session_id uuid NULL` with a partial unique index (`WHERE test_session_id IS NOT NULL`); the writer inserts `ON CONFLICT DO NOTHING`. Written for `completed` sessions only (a partial session has no complete section, 05D §12.2). No FK: queue state, like `exam_runtime_outbox.aggregate_id`; the row leaves with the student through the deletion cascade. The consumer is NOT built — it is WS-4's (owner ruling R2); rows accumulating unread at launch volume is accepted.
WAS: 05C §7.7 DDL `(outbox_id bigint, student_id uuid NOT NULL, reason CHECK = 'full_length_completed', requested_at, processed_at)`, no uniqueness.
IS: the same plus the nullable session key and its partial unique index.
Owner action: amend 05C §7.7's DDL; note 05D §9.1's `attempt_count` / `failed` columns are still absent from 05C's table (pre-existing, for WS-4).
Build artifact: migration §2 and §7; gate S5 (one row per completion after replays; none for partial), plant P5.

SCL-156 | 2026-09-25 | Doc 05A §6.2 derives full-length mastery events from denormalised `test_session_answers` columns (`tsa.id`, `correct`, `domain`, `skill`, `difficulty`, `answered_at`) that Doc 04A never defines and production does not have, and forbids joining `questions`; Doc 05 Parent §11.4 prescribes the join | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: the `full_length_answer_events` arm of `canonical_mastery_events`; `20260930110000_exam_seams.sql`; production verified 2026-09-27 by read-only query.
Id: `SCL-156` allocated 2026-09-25, third of five (see SCL-154).
Change (owner ruling R3): one additive arm of `canonical_mastery_events`, over the view `full_length_answer_events`: answered items of SUBMITTED sections, joined `test_session_answers → test_form_items → questions` for domain, `skill_codes[1]` (practice's skill) and difficulty; correctness by `is_answer_correct()` (the scorer's); `event_id = test_session_answers.last_submission_id` (a uuid, unique per submission, stable once the section submits — the arm admits no row before then); `occurred_at` = that submission's `created_at`. Blanks produce no event. An unsubmitted section yields no row, so `apply_mastery_event` raises `MASTERY_EVENT_NOT_DERIVED` even when a caller claims `section_state = 'submitted'`.
Rationale for the join over 05A's rule: the exam has no denormalised copy of domain, skill and difficulty, and creating one would be a second source of truth for facts Doc 02 owns. Blanks: mastery is earned from observed events only; a blank is not one (04B still scores it wrong).
Contradiction noted, not resolved silently: Doc 05 Parent §6.5 says mastery follows scoring; §11.4 says eligibility is not gated on scoring. Built per §6.5 (owner ruling): the arm is read by the post-scoring seams, so a session in `failed_requires_review` contributes no mastery until it is scored.
WAS: 05A §6.2 SQL over `tsa.id`, `tsa.correct`, `tsa.domain`, `tsa.skill`, `tsa.difficulty`, `tsa.answered_at`, `tsa.section_index`.
IS: as Change.
Owner action: amend 05A §6.2 to the joined form and state the event_id; reconcile Parent §6.5 / §11.4.
Build artifact: migration §3, §6, §7; gate S3 (plant P3 — the arm without the submitted gate — applies unsubmitted answers).

SCL-157 | 2026-09-25 | Doc 05D §12.2 defines `full_length_section_scores` by columns only; it does not say where the score, `completed_at` and the row `id` come from, and its "partial never is_complete" sits beside a per-section `is_complete` definition that a partial session's scored section would satisfy | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `20260930110000_exam_seams.sql` (05C's section-score surface); production verified 2026-09-27 by read-only query.
Id: `SCL-157` allocated 2026-09-25, fourth of five (see SCL-154).
Change (owner ruling R5): a `security_invoker` view over `score_runs` (one row per session) unpivoted into one row per SCORED section: `section_scaled_score` = `rw_scaled` / `math_scaled`; `is_complete` = the session is `completed` (a partial session's scored section is present with `false` and never read by 05C's `is_complete = true` filter); `completed_at` = `test_sessions.completed_at`; `id = md5(score_run_id || ':' || section)::uuid` — deterministic, and stable because score runs are insert-once (04B §9.4), which is what 05C's `id DESC` tiebreak needs. Rows of a student-less (anonymised) session are excluded. `compute_section_projection` is NOT wired to it (owner ruling R2: 05C closes its own WS-4 forward-ref); the 8-domain gate is untouched.
Owner action: amend 05D §12.2 with the sources, the id derivation and the partial rule.
Build artifact: migration §4; gate S4 (05C §5.7's LIMIT 1 / OFFSET 1 reads verbatim, column order, id stability; plant P4).

SCL-158 | 2026-09-25 | No document defines how a full-length exam feeds the review queue — Doc 05F §9.4 names the exam-review seam (`source_engine 'full_length'`) and `review_queue_record` accepts it, but which items are enqueued, with what outcome and what `source_item_id`, is unowned | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `20260930110000_exam_seams.sql` (misses and blanks enqueued for review); production verified 2026-09-27 by read-only query.
Id: `SCL-158` allocated 2026-09-25, fifth of five (see SCL-154).
Change (owner ruling R4): enumerate the items actually SERVED (`test_session_items` — the routed Module 2 path only; the form carries both 2A and 2B, and an unserved item is not a blank) in SUBMITTED modules (Module 1 once `module1_submitted`; Module 2 once the section is `submitted`). Wrong → `source_outcome 'incorrect'`; blank (never answered, or explicit omit) → `'skipped'`; correct → nothing. `source_item_id = md5('full_length:' || session || ':' || section || ':' || physical module || ':' || ordinal)::uuid` — `review_queue_record` dedupes on `(source_engine, source_item_id uuid)` and exam items have no uuid, so the id is derived and a replay returns the existing row. `queued_at` = the session's completed/abandoned time. Run after scoring success, from the seams event (SCL-154), not inside scoring.
Owner action: record the rule in Doc 05F §9.4's exam-review seam (or 02B's review queue section).
Build artifact: migration §7; gate S1 (every miss and blank, nothing else; plants P1 and P2), S2 (no duplicate on replay).

SCL-167 | 2026-09-25 | Doc 05F §7.4 fixes a full_length block's scope at exactly one key, `{form_id}`, so a calendar-placed test cannot carry its timing, and §17.2 gives the student nothing to choose on a full-length block while practice and review expose their scope keys in the same sheet | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: the `{form_id, exam_mode}` full_length scope; `20261004000000_calendar_full_length_seam.sql`; production verified 2026-09-27 by read-only query.
Id: `SCL-167` allocated 2026-09-25 after `git fetch --all --prune`, scanning `docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote branch (highest `SCL-166`, on `claude/scl-coverage-and-register-semantics`) and the open PRs (#900, #898, #897, #861, #728: none past SCL-166). First of four sequential allocations this session (SCL-167 .. SCL-170). An earlier scan the same session found `SCL-158` as the maximum; the register moved while this change was built, so the later allocation took the next free numbers.
Change (owner ruling, E9b "precedent decides"): the scope is `{form_id, exam_mode}`, both keys required-present. `exam_mode` is the exam engine's own `test_sessions.mode` vocabulary (`strict` = test-day timing, `lenient` = practice timing), reused, never restated; `form_id` null means "the next test" (SCL-168). A generated block carries `{form_id: null, exam_mode: 'strict'}`: a calendar-placed full-length is a rehearsal, and practice timing is the deliberate opt-out. Both keys are edited as practice's section and domains are — in `CreateBlockSheet` and `BlockSheet` (one shared `FullLengthFields`), saved as a §12.4 day edit — and nothing is collected at launch.
WAS, verbatim: 05F §7.4 / sheet §8 item 3 "full_length: {\"form_id\"}"; `calendar_scope_is_valid` required `scope ?& ARRAY['form_id']` and exactly one key.
IS: `scope ?& ARRAY['form_id','exam_mode']`, exactly two keys, `exam_mode IN ('strict','lenient')`. Production held no full_length block when this was written (read-only query, 0 rows), so no stored row predates the shape.
Owner action: record the two-key shape against 05F §7.4 and §17.2.
Build artifact: `supabase/migrations/20261004000000_calendar_full_length_seam.sql` §1 and §6; `packages/shared/src/calendar/scope.ts`; `client/src/features/calendar/components/FullLengthFields.tsx`; gate FL1; `tests/e2e/calendar-full-length.spec.ts`.

SCL-168 | 2026-09-25 | Doc 05F §9.4 has the full-length adapter create "by form_id or Doc 04 rotation with the key forwarded"; no Doc 04 defines a rotation, and `exam_create_session` takes no idempotency key | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `exam_next_form_for_student(uuid)` present; `20261004000000_calendar_full_length_seam.sql`; production verified 2026-09-27 by read-only query.
Id: `SCL-168` allocated 2026-09-25, second of four (see SCL-167).
Change (owner rulings, E9b): (1) THE NEXT TEST replaces the rotation. `exam_next_form_for_student(student)`: the student's LIVE session's form if one is live (so a launch resumes it); else the first selectable published form they have never completed, in `/api/tests/forms` order (`published_at, name, id`); else the form they completed least recently. Deterministic — no randomness anywhere in selection. NULL when nothing is selectable. (2) THE KEY IS NOT HONOURED, because it does not exist: `exam_create_session(student, form, mode)` has no idempotency parameter, so the adapter forwards nothing and says so. De-duplication is the exam's own rule of one live session per student: with no form named, a launch resolves to the live session's form and the engine answers 200 with that session — the same session a forwarded key would have replayed, which is what heals a crash between create and `calendar_link_launch` (§15.1). (3) A block that NAMES a form while a different form's session is live is refused by the engine (409 `existing_active_session`) and reaches the student as every engine refusal does: `engine_error` → 502 `CALENDAR_ENGINE_ERROR`. The brief's proposed "409 that resumes" was withdrawn by the owner as bespoke. (4) The adapter checks `exam_full_length` itself: the exam route checks it in its handler, not in `createExamSession`, and `calendar_access` alone must not start an exam.
WAS, verbatim: 05F §9.4 "`create` by `form_id` or Doc 04 rotation with the key forwarded".
IS: as Change. `nextLaunchSize` → 1 (§9.4), not the stub's `remaining`.
Owner action: record the next-test rule (it belongs to Doc 04's form selection) and the missing idempotency key against 05F §9.4.
Build artifact: migration §3; `server/services/calendar/adapters/full-length.ts`; gate FL2; `tests/ci/calendar.launch-contract.full_length.test.ts` (launch twice → same session; different form → 502, nothing started; no `exam_full_length` → 502, nothing started).

SCL-169 | 2026-09-25 | Doc 05F §10.1 lists `exams { last_completed_local_date; days_since_exam; missed_count; reviewed; weak_domains[] }` and §9.4 "a per-exam missed count and weak-domain list", but no document defines `missed_count`, `reviewed` or `weak_domains` | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `weak_level_max` = 1 in `calendar_runtime_config`; `20261004000000_calendar_full_length_seam.sql`; production verified 2026-09-27 by read-only query.
Id: `SCL-169` allocated 2026-09-25, third of four (see SCL-167).
Change (owner rulings, E9b): the builder reads every fact from its owner and computes none. The last exam is the newest `test_sessions` row in `completed`, dated by `completed_at` in the profile's timezone. `missed_count` = that exam's review-queue rows (`source_engine 'full_length'`, `source_session_id` = the exam) that are ACTIVE and SERVABLE (the H5 rule: never plan against rows review will refuse to serve); NULL until E9's seams event has applied, because before that the rows do not exist and unknown is not zero. `reviewed` = a COMPLETED session-mode review sourced from that exam, OR the seams have applied and nothing from it is outstanding. `weak_domains` = Doc 05B's own `student_domain_mastery.mastery_level` at or below `calendar_runtime_config.weak_level_max` (seeded 1: formula sheet §6's L0-L1), in canonical order; an unmeasured (NULL) level is never weak. The SAME row is read by `calendar_compute_plan`'s per-domain explanation step, which carried `<= 1` as a literal — one definition, so the calendar and the mastery engine cannot disagree about a student in the same week. The row belongs in `calendar_runtime_config`: 05B owns the levels, 05F's formula sheet owns what counts as weak for planning. `source_session_id` is added to `exams{}` for SCL-170. "exams" is no longer pushed into `degraded[]`.
Why `reviewed` has a second arm (not in the brief): the generator holds an exam-review debt open while `missed_count = 0` and `reviewed` is not true, and while it is open it places NO ordinary review. A perfect exam, or one whose misses were cleared in queue review, would otherwise suppress review for the whole horizon, indefinitely. The fix is in the builder, not the oracle.
Consequence recorded (owner): `post_exam_multiplier` ×2 now lands on domains `weight_by_level` already weights heaviest (L0 → 5, L1 → 4); the two constants interact and should be tuned together.
WAS: 05F §10.1 names the fields; 20260925000000's builder emitted them NULL and pushed "exams" into `degraded[]`.
IS: as Change.
Owner action: record the three definitions against 05F §10.1/§9.4; note the weak_level_max / post_exam_multiplier interaction for whoever tunes the weights.
Build artifact: migration §2, §5, §6; `scripts/ci/reference/calendar_parity_emit.py` (states the oracle's own `L <= 1` as `weak_level_max = 1`; the parity constants check pins the row, and 6018 byte-exact comparisons plus every per-domain explanation key prove the SQL reads it as the oracle applies it — `docs/Spec/calendar_formula_reference.py` untouched); gates FL3-FL8, C-01.

SCL-170 | 2026-09-25 | Formula sheet §2 step 4 places an exam-review block after a completed full-length, but the generator scoped it `{"mode":"queue"}` — which reviews the oldest outstanding mistakes, not that exam's, and can never make `reviewed` true, so the block would be re-placed on every regeneration | APPLIED
Status 2026-09-27 (owner ruling, register sweep): RULING -> APPLIED. Under SCL-159 an entry recording built, live behaviour is APPLIED, not RULING; the owner ruled this class be swept in one pass. Live: `calendar_exam_review_scope(text,text)` present; `20261004000000_calendar_full_length_seam.sql`. Still outstanding, as the entry says: its own Owner action on the day-0 placement of the exam review (E9b finding F1); production verified 2026-09-27 by read-only query.
Id: `SCL-170` allocated 2026-09-25, fourth of four (see SCL-167).
Change (owner ruling, option (a)): a real exam review is `{"mode":"session","source_engine":"full_length","source_session_id":<the exam>}` — the seam §9.4 names — built by one helper, `calendar_exam_review_scope`, for both generators; the placeholder for an exam placed but not yet sat stays `{"mode":"queue"}` (no session exists yet); an `exam_review` with no session id raises (a malformed snapshot: the builder always emits the id with the date). The review adapter passes the block's scope through as review's own pool spec (`{mode:'session', source}`) instead of always sending `queue`.
Why the oracle did not move: the owner ruled the oracle would move in lockstep, but `docs/Spec/calendar_formula_reference.py` is read-only, and it did not need to — the parity projection is `[block_type, practice mix, target_count, explanation_key]` plus per-domain keys, which a review block's scope is not part of. Parity: 6018 comparisons byte-exact, 3000-case suites zero violations, both generators.
FINDING, not fixed (owner decision needed): the generator places a pending exam review on the FIRST study day of its horizon, which for a generation on the exam's own day is that day. When the generation does not own that day — the student edited it (it holds the exam block they added), or the trigger is `weekly` / `post_exam`, which own from tomorrow (R-08-32) — `calendar_drop_unowned_dates` / `calendar_drop_today_for_system` remove it, and the next generation places it on ITS day 0 again. The review therefore reaches the plan only through a regeneration that owns its first day (the student's Refresh on a non-overridden day, or Reset on that day). The placement is the oracle's; changing it is a formula decision.
WAS: `jsonb_build_object('mode','queue')` for every generated review block.
IS: as Change.
Owner action: record the exam-review scope against formula sheet §2 step 4 / §9.4; rule on the day-0 placement finding.
Build artifact: migration §4 and §6; `server/services/calendar/adapters/review.ts`; gate FL9; contract test (generator output; Reset persists it; Start launches a session review of that exam).

SCL-173 | 2026-09-26 | Doc 05F §16 withholds four things from a guardian, and TWO of them cover the target score — R-08-22 by name and "the projection has no profile" by implication, which also catches `target_exam_date`. Both are reversed: a guardian sees the target, the test date and Doc 05C's band | RULING
Id: `SCL-173` allocated 2026-09-26 as max+1 across every remote branch after `git fetch --all --prune` (`git grep -hoE '^SCL-[0-9]{3}'` over `docs/SpecAudit/SPEC_CHANGES_LOG.md` on every remote ref: max `SCL-172`, this session's own from #903) and both open PRs (#861 `cleanup`, #728 dependabot — each head branch is among the scanned refs, so neither carries a higher number). First of two sequential allocations this session (SCL-173, SCL-174).
Change: §16's withholding list becomes **"no controls, no explanation copy, and no profile beyond `target_score` and `target_exam_date`"**. R-08-22 is struck. The guardian ready payload gains three fields: `target_score` (nullable), `target_exam_date` (nullable, for the days-to-test line only) and `projection` (Doc 05C's per-section rows, read 1:1, optional exactly as on the student payload).
  THE SECOND CLAUSE IS THE POINT OF THIS ENTRY. The brief that prompted it reversed R-08-22 and asked for all three fields. R-08-22 alone does not authorise `target_exam_date`: it is a `student_study_profile` column (§7.1 `:227`) and §518 names it inside the plan input's `profile` object, so §16's "the projection has **no profile**" withholds it independently. Serving it on an R-08-22 reversal alone would have been working around a live clause. Raised before implementing; the owner extended the reversal, with the reason that carries it: "A stated test date is a fact about the goal, not a control, and 'N days to test' is the same category as the target itself."
WAS, verbatim (`docs/Spec/Lyceon_Doc_05F.md:753`): "The projection has no profile, no target score (R-08-22), no controls, and no explanation copy at either level"; and `:118` "| R-08-22 | Guardians do not see target score. |"
IS: §753's clause reads "The projection has no controls, no explanation copy at either level, and no profile beyond `target_score` and `target_exam_date`"; R-08-22's row at `:118` is struck and replaced by "Guardians see the target score and the target exam date; no other profile field." The rest of §753 — the distinct type, the `resolveSubject` gate, INV-08-12, the explanation-copy clause and its both-levels reasoning — is correct and unchanged.
Rationale (owner): "Guardians see the target score. It is the student's stated goal, and a projection with nothing to compare against is half a fact." The withheld remainder is withheld for a reason that still holds: `timezone`, `study_days_mask`, `daily_minutes`, `full_length_weekday` and `planner_mode` are scheduling inputs a guardian has no path to change, `bounds` and `enabled_block_types` exist only to constrain a write, and the explanation copy is §17.6's.
  A PRECEDENT, recorded because it shows the clause had already drifted: when `estimates` was admitted on the owner's ruling of 2026-09-22, the reasoning captured in `packages/shared/src/calendar/api.ts` read §16's exclusions as "controls, explanation copy and the target score" — a THREE-item list that silently dropped "no profile". The list has now been settled once, in one place, rather than narrowed a clause at a time.
NAMING, fixed in the same amendment: §16 uses "projection" for the guardian DTO's SHAPE ("a distinct guardian projection type") while Doc 05C uses it for a score band — and this change puts a field literally called `projection` on that DTO. Two senses of one word in one section. The amendment renames the shape sense to **"guardian view model"** and leaves "projection" to mean Doc 05C's band.
Why this surfaced now: the guardian calendar renders since #903, and its header fell back to the STUDENT's empty-state copy — "Set a target", "Add your test date", "Answer a few questions to see your projection" — three instructions addressed to someone with no write path. The missing data and the wrong copy were one defect.
  EMPTY STATES DIFFER, and that is not cosmetic: where the student sees an action the guardian sees a statement ("No target set", "No test date", "Not enough practice yet"). A guardian is never shown a CTA, which is the part of §16 that did not change.
Owner action: amend Doc 05F §753 and the R-08-22 row at `:118` as above; rename the DTO sense of "projection" to "guardian view model" in §753 and §718; add the guardian payload to §4's seam row as a Doc 05C consumer.
Build artifact: `packages/shared/src/calendar/api.ts` (`guardianCalendarReadyResponseSchema`, still `.strict()`); `server/services/calendar/read-service.ts` (`readGuardianCalendar` — the two fields named one at a time off the profile it already loads, never spread, per CLAUDE.md's anti-leak chokepoint rule); `client/src/features/calendar/components/Chrome.tsx` (`ABSENT_COPY`, `viewer`); `client/src/pages/guardian-student-calendar.tsx`; tests: `guardian-readonly.tree.test.tsx` (the tree-walk still asserts zero controls with the sheet open), `tests/ci/calendar.wire-contract.test.ts` (the real serializer through the real client schema), `tests/ci/calendar.read-service.test.ts` (the guardian key chokepoint), `packages/shared/src/__tests__/calendar-api.test.ts`, `tests/ci/student-resources.contract.test.ts`.

SCL-174 | 2026-09-26 | The guardian calendar shows a parent the plan and the projection but not a single completed exam result, which is the most convincing evidence the product holds — approved in principle, deferred until the exam vertical is exercised | PROPOSED
Id: `SCL-174` allocated 2026-09-26, second of two sequential allocations this session (see SCL-173).
Change: the guardian calendar surfaces COMPLETED full-length section scores and totals — "practice test 3: 1180, up from 1090" — read 1:1 from Doc 04, with no controls, no answers and no per-question detail. The same shape as SCL-173's projection admission: Doc 04's own data, unrecomputed, on a read-only surface.
OWNER RULING, 2026-09-26, verbatim: "A parent seeing 'practice test 3: 1180, up from 1090' is the single most convincing thing the product can show them, and it's the same argument as the projection: Doc 04's data, read 1:1, no controls. But there is nothing to show yet — zero full-length blocks planned, one `test_sessions` row, and the exam engine still being wired. Building the guardian half against a seam that isn't exercised would be guessing at a payload shape."
  So this is APPROVED IN PRINCIPLE and NOT IMPLEMENTED. It is not blocked on a decision; it is blocked on the seam existing. Filed now so the decision is not relitigated later, and so the guardian half is built from a payload that has carried real rows rather than from a guess at one.
IS: nothing. The guardian payload carries `facts.full_lengths_completed`, a COUNT, and no scores.
Rationale: the same one the owner gave for the projection — a parent needs something to compare against. A count of completed exams answers "did they sit it"; a score answers "is it working", which is the question a paying guardian actually has.
Why this surfaced now: SCL-173 put the projection on the guardian payload, which makes the absence of actual results the conspicuous gap next to it — a projected band with no realised scores beside it invites the comparison it cannot support.
Owner action: when the exam vertical lands, implement alongside the `form_id` and launch checks already queued for that validation — the owner's words: "It should be one of the five things I check on your signal." Then rule the payload shape against Doc 04 and extend §16's admitted list a third time, in one amendment rather than per field.
Build artifact: none — filed, not built, by ruling.

SCL-178 | 2026-09-27 | CLOSES SCL-148: Doc 04C §15.3's forbidden phrases are permitted where they appear in explicit NEGATION. Doc 04B §17.1's disclosure text stands as seeded; the seeded v1.0 row is already §17.1 verbatim, so nothing in production changes | RULING
Id: `SCL-178` re-derived at the moment of use, 2026-09-27, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest allocated anywhere is `SCL-177`. Open PRs checked: the only open PR is #728 (dependabot), which carries no entry. Two entries allocated this session, sequentially: SCL-178, then SCL-179.
Change: owner ruling (Karl, 2026-09-27). This amends Doc 04C §15.3 (the register is the amendment, per SCL-159; neither document is edited). §15.3's list of forbidden phrases exists to stop Lyceon implying an affiliation with, or an equivalence to, the College Board's scores. Doc 04B §17.1's sentence does the opposite: it disclaims exactly that. A phrase on the §15.3 list is therefore PERMITTED where it appears in explicit negation of the affiliation or equivalence it names ("not an official College Board score prediction", "may differ from official SAT scores"). It remains forbidden in any affirmative or ambiguous use. 04B §17.1's text stands as written.
WAS, verbatim (`docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md`, §15.3): "`summary` and `full_text_url`\-linked content MUST NOT contain the following phrases or close synonyms:" … "\"Official SAT score\"" … "\"College Board score\"" … "`summary` MUST contain language matching at least one of these canonical templates".
IS: the same list, read as forbidding AFFIRMATIVE use only. A phrase from the list inside an explicit negation is permitted. 04B §17.1's sentence satisfies §15.3 as amended: it contains both phrases, each inside a negation, and it carries the substance of the first template (a Lyceon-modeled estimate that is not an official SAT score).
A literal reading was not merely strict; it could not be satisfied at all. §15.3's own first required template, "Lyceon-modeled estimate, not an official SAT score", contains "official SAT score", a phrase the same section forbids. So the two halves of §15.3 already disagreed with each other, and the negation reading is the only one under which the section is self-consistent. Reading the ban literally would also outlaw the strongest disclaimer the product has.
Production, verified 2026-09-27 (read-only SELECT on `public.score_disclosure_versions`): one row, `v1.0` / `disclosure-v1.0`, `superseded_at` NULL, `summary` equal to 04B §17.1 verbatim, "Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon's internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more." Nothing in production changes: the row already conforms to §15.3 as amended.
Outstanding, and not built here: 04C §19 item 11 requires "a content-linter test [that] scans `score_disclosure_versions.summary` rows and fails CI on any violation". No such linter exists in the repo today; gate R1 (`scripts/ci/exam-shell-server-gates.sql`) only pins the seeded text. Whoever builds that linter must encode the negation allowance, or it will fail on the text this entry rules correct. §15.3 also governs `full_text_url`-linked content, which SCL-179 now makes the student terms.
Rationale: the owner's, above. A rule's purpose governs its reading when its letter would defeat the purpose.
Why this surfaced now: E7a seeded the first `score_disclosure_versions` row and SCL-148 recorded the conflict; the exam vertical is live, and E11 closes the register.
Owner action: none. This entry IS the ruling, and SCL-148 is closed by it.
Build artifact: none. The seed row in `20260930090000_exam_shell_server.sql` is unchanged, and gate R1 still asserts it.

SCL-179 | 2026-09-27 | The score disclosure lives inside the existing student and guardian terms, not in a standalone document, and the exam needs no acceptance of its own; `full_text_url` points at `/legal/student-terms` instead of the non-existent `/legal/score-disclosure` | PROPOSED
Id: `SCL-179` re-derived at the moment of use, 2026-09-27 (see SCL-178; second of two sequential allocations).
Change: owner ruling (Karl, 2026-09-27). (1) The full-length exam is an in-app feature. The student accepted the terms at signup; no additional acceptance exists for the exam, and none is needed. (2) The score disclosure's full text lives inside the existing student and parent/guardian terms, not in a separate disclosure document. This amends the reading of Doc 04C §15.1, whose `DisclosureBlock.full_text_url` is commented "link to the full disclosure document", implying a standalone one. (3) The seeded row's `full_text_url` is `/legal/student-terms`; owner's choice 2026-09-27, over `/legal/parent-guardian-terms` or holding the change.
WAS, verbatim (04C §15.1): "full\_text\_url: string;             // link to the full disclosure document". Seeded value: '/legal/score-disclosure' (`20260930090000_exam_shell_server.sql`, note D9: "No legal document by that slug exists yet").
IS: `full_text_url` links into the existing terms. The v1.0 row reads '/legal/student-terms'.
Verified, not assumed:
  - (1) Confirmed by reading the code: the exam routes use only the site-wide guards `requireProfileComplete` and `requireConsentCompliance` (`server/routes/exam-runtime-routes.ts:177`, `server/routes/exam-report-routes.ts:133`). No exam-specific acceptance exists anywhere in `client/src/features/exam` or the exam services.
  - The link target exists. `/legal/:slug` serves `student-terms` (`docs/route-registry.md`; `legal/student-terms/v2/`), and `/terms` redirects 301 to it (`server/index.ts:350`).
TWO GAPS THIS RULING LEAVES OPEN, recorded rather than resolved, because both are Content / Legal's (04C §15.2: "Authoring of `summary` and `full_text_url` content lives with Content / Legal"):
  (a) Neither terms document carries score-disclosure text today. `legal/student-terms/v2/en.md` has §8 "No Guarantees" ("LYCEON does not guarantee test score improvements…") and lists "Your score projections and exam results" among what a guardian can see. `legal/parent-guardian-terms/v2/en.md` has §2 "Educational Purpose" and the same guardian-visibility line. Neither states what a Lyceon scaled score is or is not. Until one does, the "Learn more" link leads to terms that do not contain the disclosure the link promises. Adding that text means a new terms version, and publishing a new version is what re-consent keys on (`client/src/components/legal/ReconsentModal.tsx` compares each document's accepted version with the current one and prompts when they differ), so the content change may itself prompt users to accept again. That is the owner's call, not this entry's.
  (b) The legal page has no fragment deep-linking. `client/src/pages/legal-doc.tsx` scrolls to a section only from its own table of contents, never from a URL `#fragment`. So the link lands at the top of the student terms, and a `#section` suffix would do nothing until that is built.
  Also: the row holds one URL, so a guardian following "Learn more" reaches the STUDENT terms, not their own. That is the owner's choice (3).
Rationale: the owner's. A disclosure the student already agreed to, inside the terms they accepted, needs no second acceptance and no second document.
Why this surfaced now: the seeded link has pointed at a page that does not exist since E7a (20260930090000, D9). The exam report renders it as "Learn more" (`client/src/features/exam/components/DisclosedScore.tsx:26`), so every live report has carried a dead link.
Owner action: apply `supabase/migrations/20261009000000_score_disclosure_full_text_url.sql` (data only: one guarded UPDATE of one row, idempotent, asserting the result). Then flip this entry to APPLIED once the production row reads '/legal/student-terms'; it is PROPOSED until then, because authorisation is not application (SCL-159). Separately, decide (a) and (b) above.
Build artifact: `supabase/migrations/20261009000000_score_disclosure_full_text_url.sql`. Tested on a fresh local PG16 built from every migration: the row reads '/legal/student-terms'; a re-run updates 0 rows and passes; and a planted third value ('/legal/other') is left alone while the assertion raises and names it.

SCL-180 | 2026-09-27 | Doc 04 Parent Q9 narrowed: a guardian sees the per-domain breakdown (correct of total, by domain, per scored section). Every other Q9 exclusion stands. Doc 04C §8.1/§9.1 gain `domain_breakdown`; §7.2's aggregation lives in a 04B-predicate SQL function | PROPOSED
Id: `SCL-180` re-derived at the moment of use, 2026-09-27, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest allocated anywhere is `SCL-179`. Open PRs checked: #930 (lisa), #929 (exam) and #728 (dependabot); #929 edits existing entries only and allocates none, and the others carry no entry. Two entries allocated this session, sequentially: SCL-180, then SCL-181.
Change: owner ruling (Karl, 2026-09-27, G1 brief and rulings): "Breakdown in, answers and skills out", and "the breakdown should be there per our UI rulings earlier. it should be part of the report". Three amendments (the register is the amendment, per SCL-159; no document is edited):
  (1) Doc 04 Parent Q9. The guardian headline gains exactly one thing: the per-domain breakdown, meaning the eight canonical domains, each with `correct` of `total` for a SCORED section, identical to the rows the student sees.
  (2) Doc 04C §8.1 (scored) and §9.1 (partial_scored) payloads gain `domain_breakdown: [{section, domain, correct, total}]`, for scored sections only. This is what fills the Score breakdown tab E7b built disabled ("The Score breakdown tab is E8 — it needs per-domain counts no endpoint serves yet").
  (3) Doc 04C §7.2 places "alternate aggregations (e.g., per-domain estimates)" in 04B. The aggregation is a new SQL function, `exam_domain_breakdown`, rather than a 04B scoring output. It counts with 04B's own correctness predicate `is_answer_correct` over the served items, and gate D2 proves that each section's rows sum to `score_runs`' `module1_correct + module2_correct`. It is not an estimate and derives no scaled score; §7.2's first sentence ("MUST NOT re-derive scaled scores from raw answers") is untouched.
WAS, verbatim (Doc 04 Parent, Q9): "Headline only at MVP: scaled section scores + total + completion timestamp + `timing_condition` + `is_first_seen_form_attempt` + `attempt_number_for_form`. Guardian does NOT see: domain breakdowns, skill diagnostics, pacing analytics, individual answers, routing decisions, or raw scores. Future expansion possible behind explicit product review."
IS: the same headline, plus the per-domain breakdown. Guardian does NOT see: skill diagnostics, pacing analytics, individual answers, routing decisions, or raw scores. Those five exclusions stand unchanged. The disclosure block travels with every score to the guardian, as it does to the student (04C §15.1).
Precondition, gated rather than argued (SCL-160). A per-domain TOTAL would reveal the Module 2 path if 2A and 2B differed by domain. They cannot: `validate_form_composition` (20260930030000) pins identical per-domain quotas for 2A and 2B at publish, and gate D3 (`scripts/ci/exam-domain-breakdown-gates.sql`) reads every published form's live rows and fails if any (form, section, domain) cell differs. Production was read the same way on 2026-09-27 (read-only SELECT): all three published forms are identical in 2A and 2B for all eight domains. The function reads `module2_path` to choose the served items and never emits it; gate D4 fails on any key beyond the four, and on any module or path token.
FOR THE OWNER, stated plainly. "Raw scores" stays excluded as a FIELD, but correct-of-total by domain has an arithmetic consequence: a section's rows sum to that section's raw correct count. Nothing below the section is recoverable. Every domain mixes Module 1 and Module 2 items, so the per-module split that 04C §7.1 keeps admin-only (the "routing trajectory") cannot be reconstructed. A guardian can therefore add up the section raw total; a student already MAY see it (Q7-partial: "04C MAY display the completed-section raw"). The ruling puts the breakdown in; this entry does not treat that sum as a breach, and says so rather than leaving it implicit.
Rationale: the owner's. The breakdown is the part of the report a parent can act on; answers, skills, routing, pacing and raw fields stay out.
Why this surfaced now: G1 (the guardian exam results surface) needed the breakdown to exist on the student report first.
Owner action: apply `supabase/migrations/20261010000000_exam_domain_breakdown.sql` (additive: one new function, service_role only). This entry is PROPOSED until then, because authorisation is not application (SCL-159).
Build artifact: `supabase/migrations/20261010000000_exam_domain_breakdown.sql`; gate `scripts/ci/exam-domain-breakdown-gates.{sh,sql}` (D1-D6); `packages/shared/src/exam-report-schema.ts` (`examDomainBreakdownRowSchema`, strict, the domain must belong to its section); `server/services/exam-report-service.ts` (a breakdown not covering exactly the scored sections is a §16.7 integrity violation); `client/src/features/exam/components/DomainBreakdown.tsx`.
Amended 2026-09-29, in place, while still PROPOSED (precedent: SCL-106, SCL-110). Owner ruling (Karl, 2026-09-29, student UI vertical Step 2 ruling 7): "Exam report domain breakdown: seven segmented bars per domain, like the official SAT score report. No 'N of M correct' anywhere in the student UI, and not in the payload either." This changes what the STUDENT report carries (amendment (2) above). The guardian amendment (1) is not changed by this ruling (see below).
  (2′) Doc 04C §8.1 (scored) and §9.1 (partial_scored), STUDENT payload: `domain_breakdown` rows are `{section, domain, segments_filled}`, never `correct` or `total`. `segments_filled = round_half_up(correct × 7 / total)`, clamped to 0..7. The server computes it at read time in the report endpoint, as a pure domain function over the rows `exam_domain_breakdown` already returns. Nothing is stored and no migration is added; the SQL function and gates D1-D6 are unchanged. A domain whose `total = 0` (a partial or abandoned test) is omitted from `domain_breakdown`, and the payload records it with a machine-readable reason so the report can say why.
  WAS (this entry's amendment (2), for the student): "`domain_breakdown: [{section, domain, correct, total}]`, for scored sections only."
  IS (student): `domain_breakdown: [{section, domain, segments_filled}]`, plus the omitted domains with their reason. `correct` and `total` are absent from the student payload.
  FOR THE OWNER, the arithmetic consequence restated. The section-sum observation above ("a section's rows sum to that section's raw correct count") no longer holds for the student payload. Seven segments per domain is a coarsened ordinal; no raw count is recoverable from it.
  Guardian: amendment (1) and the guardian payload keep `correct` of `total` for now. The guardian report is out of scope of the student UI vertical, and a finding in `docs/plans/student-ui/student-ui-vertical.md` §8 records that it must follow the same seven-segment rule in the guardian vertical. When it does, this entry is amended again.
  Build artifact (student half): branch `claude/student-ui-exam-domain-segments` (register row UI-19).

SCL-181 | 2026-09-27 | Doc 04C §12 and §16.2: the guardian report lives at `/api/students/:studentId/tests/:sessionId/report` behind the existing subject resolver, with 404 for no or revoked link and 402 for a lapsed entitlement; a list at `/api/students/:studentId/tests`; a guardian projection narrower than §12.2's minimum | PROPOSED
Id: `SCL-181` re-derived at the moment of use, 2026-09-27 (see SCL-180; second of two sequential allocations).
Change: owner ruling (Karl, 2026-09-27, G1): "Existing pattern + SCL". The guardian exam surface uses the same access mechanism as the guardian mastery and calendar reads: the `/api/students` mount, `resolveSubject` → `guardian_view_decision`, and the per-path `requiresEntitlement` table. It does not use a `/api/guardian/…` family with its own predicate. There is one visibility predicate, not two. Amendments:
  (1) PATH. §12.1 and §16.2's `GET /api/guardian/students/:student_id/tests/:session_id/report` becomes `GET /api/students/:studentId/tests/:sessionId/report`. §16.2's `/report/status` variant is not built: a guardian page does not poll.
  (2) DENIALS. §12.1 step 3 answers 403 (no body) for an inactive or absent link; this surface answers the resolver's 404, byte-identical for never-linked, revoked, another guardian's student, and a session that is not this student's, so none can be told apart (the same anti-enumeration goal). §12.1 step 4 answers 200 with an `unavailable` payload for a lapsed entitlement; this surface answers 402, which is the resolver's `student_unentitled` answer and the answer mastery and calendar give. An entitled student without the `exam_full_length` feature also gets 402 (`entitlementGate`), which is §2.6 condition 2 ("entitlement covering full-length exams").
  (3) ENVELOPE. `{ ok: true, report, requestId }`, the /api/students envelope, not §16.8's `{ data, meta }`.
  (4) PROJECTION. §12.2's omissions are a floor. The guardian payload also omits `review_unlocked` (guardians cannot review, §12.3); `score.score_run_id`, `scoring_model_version` and `scored_at` (internal record identity); `score.partial_display_scaled` and `sections[]` (they restate `rw_scaled`/`math_scaled` and `completed_sections`); the failed state's `failure_summary` (a message addressed to the student, plus an incident reference that is operational, §12.3); and `unavailable_at`/`resume_action`. The result is still a strict subset (§2.6 rule 7), just a smaller one. Each guardian state is its own `.strict()` schema built from named fields, so a field added to the student report reaches a guardian only if someone names it there.
  (5) LIST. §16.3 defers a listing to V1.1 and says clients list via 04A. `GET /api/students/:studentId/tests` is that 04A listing (`exam_list_forms`, the source of the student's `/api/tests/forms`), projected to the forms the student has sat, with the latest attempt on each: session id, form, mode, attempt number and report state. No second listing query exists.
  (6) ONE PAYLOAD, BOTH CALLERS. As with the calendar, the route serves the guardian projection to whoever the resolver admits. A student reading themselves there gets the narrow view, and their full report stays at `/api/tests/sessions/:id/report`.
WAS, verbatim (04C §12.1): "`GET /api/guardian/students/:student_id/tests/:session_id/report`" … "If false (link inactive OR never linked): classify as `never_existed` → return `403 forbidden` (no body)." … "If false: classify as `revoked` with `reason: 'entitlement_lapsed'` → return HTTP 200 with the `unavailable` payload (§11.5b)." (§16.3): "V1.0 does not include a \"list all my exam reports\" endpoint."
IS: as (1)-(6).
Where an anonymised or deleted student's path ends: at the resolver. The deletion executor's pre-clear (`preclear_account_deletion_links`) deletes the student's guardian links before anonymisation, so `guardian_view_decision` returns `not_linked` and the guardian receives the same 404. The retained exam then names no student (`test_sessions.student_id` NULL, 20260930080000). Proven in `tests/ci/guardian-exam-results.handler-pg.ci.test.ts`.
Supersedes, for exam results only: the 2026-08-28 delete-and-ship that removed `/api/guardian/students/:studentId/exams/full-length/sessions` and `/api/guardian/students/:studentId/tests/:sessionId/report` "as outside the four-item guardian scope" (`scripts/ci/retired-endpoints-gate.mjs`). Those paths stay retired; their entries now name the G1 routes as the replacement.
Rationale: the owner's. Every earlier guardian surface that got its own route family also got its own privilege divergence, which is what `student-resources.ts`'s header records ("Three for three"). One resolver cannot disagree with itself.
Known, not fixed here: `scripts/ci/subject-resolver-chokepoint-gate.mjs` R3 checks that a FILE imports `resolveSubject`, not that each registration uses it. A route in `student-resources.ts` registered without the resolver passes the gate. The G1 real-PG test goes red on that plant; the gate itself is a separate change.
Owner action: none beyond merging. No migration; the routes are code.
Build artifact: `packages/shared/src/exam-guardian-report-schema.ts`; `packages/shared/src/student-resources.ts` (`STUDENT_EXAM_PATHS`); `server/routes/student-resources.ts` (two GET routes and two `requiresEntitlement` rows); `client/src/features/exam/pages/GuardianExamResultsPage.tsx`; `tests/ci/guardian-exam-results.handler-pg.ci.test.ts`.

SCL-182 | 2026-09-27 | The score disclosure is the summary alone: no "Learn more", no separate disclosure document, no terms change and no re-acceptance. Clients never render `full_text_url`; the column and the payload field stay as Doc 04C §15.1/§15.2 specify | PROPOSED
Id: `SCL-182` re-derived at the moment of use, 2026-09-27, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest allocated anywhere is `SCL-181` (on `origin/exam`). Open PRs checked: #931 (`calendar`, covered by the fetch) and #728 (dependabot, no entry). One entry allocated.
Change: owner ruling (Karl, 2026-09-27, G2): "no 'Learn more', no separate disclosure document, no terms change and no re-acceptance prompt. The summary text on the score screen stands alone — it already says what a Lyceon score is and is not." This amends Doc 04C §15.1 (the register is the amendment, per SCL-159; the document is not edited). §15.1 comments `full_text_url` as "link to the full disclosure document", which implies a separate document reachable from the payload. There is none, and none will be written: the disclosure lives in `summary` alone.
WAS, verbatim (04C §15.1): "full\_text\_url: string;             // link to the full disclosure document" … "Clients MAY render the `summary` inline with the score and the `full_text_url` as a \"Learn more\" link. Clients MUST NOT render a scaled score without rendering the `summary` adjacent to it."
IS: clients render the `summary` and never render `full_text_url`, for students and guardians alike. The adjacency rule is unchanged and still enforced: a scaled score never renders without its summary beside it.
DATA MODEL: unchanged, deliberately. `score_disclosure_versions.full_text_url` stays `text NOT NULL` and the payload's `DisclosureBlock` keeps all three fields, exactly as §15.1/§15.2 specify. This is a UI ruling, not a schema change. The alternative (make the column nullable and null the row) was weighed and rejected. Every call site was read: the only consumer of the value was the one `<a>` in `DisclosedScore.tsx`, so a nullable column would have changed §15.2's table, the strict shared schema, the E7a seed and gate R1, all to remove a link that one line of client code already stops drawing. The row keeps its current value, '/legal/student-terms' (production, read-only SELECT 2026-09-27), carried in the payload and not rendered.
Supersedes, in part: SCL-179. Its (2), the disclosure's full text living inside the student and guardian terms, and (3), `full_text_url` pointing there, no longer describe anything a user sees. Its two open gaps, (a) the terms carry no disclosure text and (b) the legal page has no fragment deep-linking, are moot: no link leads to either. SCL-179 (1), no exam-specific acceptance, stands. SCL-179's migration is live (the row reads '/legal/student-terms'), so its build artifact needs no owner action. SCL-179's own status line is not edited here.
Also: 04C §15.3 governs "`full_text_url`-linked content"; with no link, that clause has no content to govern. §15.3's rules on `summary` stand, as SCL-178 reads them.
Rationale: the owner's. The summary is the disclosure; a link to a document that does not exist, or to terms that say nothing about scores, promised more than it delivered.
Why this surfaced now: SCL-179 left the link pointing at terms without disclosure text (gap (a)), and the owner ruled the link out rather than write that text.
Owner action: none beyond merging; no migration. PROPOSED until the client change is live (SCL-159: authorisation is not application), as SCL-181.
Build artifact: `client/src/features/exam/components/DisclosedScore.tsx` (`DisclosureNote` renders the summary only; both the student report and the guardian results page render through it). Tests: `ExamReportPage.test.tsx` and `GuardianExamResultsPage.test.tsx` assert the note is exactly the summary, contains no link, and that the payload's `full_text_url` appears nowhere in the page; each reddens if the link is restored. The adjacency plants ("refuses to render a score without its disclosure", "no score is drawn without its disclosure") are unchanged and green.

SCL-183 | 2026-09-27 | Doc 05F: exam placement is arithmetic on a student-chosen frequency and preferred weekday, not a precedence ladder. R-08-27 restated, §8.1 gains the frequency, §22.7's worked example rewritten, §9.4 and §21's "G-08-02 open" prose retired, and two practice-test notification events added to the notifications contract | PROPOSED
Id: `SCL-183` re-derived at the moment of use, 2026-09-27, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest allocated anywhere is `SCL-182` (on `origin/main`, `origin/calendar`, `origin/exam` and `origin/claude/g2-small-corrections`). Open PRs checked, all four: #940 (`claude/batch-005-launch-gw211p`), #938 (`claude/guardian-audit`), #931 (`calendar`) and #728 (dependabot) — every head branch is in this repository and therefore covered by the fetch, and none carries an entry above 182. One entry allocated.
Change: owner brief and rulings (Karl, 2026-09-26/27, Brief 14). Placement was built as a precedence ladder — a cadence anchor, every-Nth-weekday-occurrence counting, and a minimum gap — while practice and review simply take what the student chose. It is now arithmetic on what the student chose. Five amendments (the register is the amendment, per SCL-159; no document is edited):
  (1) R-08-27. The student picks a FREQUENCY and a preferred weekday, one setting in two columns: `full_length_interval_weeks` ∈ {1,2,3,4} beside `full_length_weekday`, both set or both null, enforced by `CONSTRAINT full_length_pair CHECK ((full_length_interval_weeks IS NULL) = (full_length_weekday IS NULL))`. Neither means no automatic exams. There is no hidden default on either side: the UI supplies the other half whenever the student answers one.
  (2) §8.1's setup table gains the row. "Practice test frequency | Weekly / Every 2 weeks / Every 3 weeks / Monthly / None | 1–4 or null, `default_full_length_interval_weeks` prefills | `full_length_interval_weeks`". The VALUE is weeks; the five labels are copy, so renaming "Monthly" never migrates data.
  (3) §22.7's worked example is wrong twice over and is rewritten. See WAS/IS below.
  (4) §9.4 and §21 carry the full-length engine as unbuilt. It is built: `20261004010000_calendar_enable_full_length_block_type.sql` put `full_length` into `enabled_block_types`, so G-08-02's own exit condition is met. §9.4's "ships as a fail-open stub" paragraph and §21's "`full_length` is added only when G-08-02 closes" both describe a state the product has left. Not listed in the brief; found while writing this entry, and recorded rather than left for the next reader to trip over.
  (5) NOTIFICATIONS. Two event types, `full_length_week` (the Monday of a week holding a full-length) and `full_length_tomorrow`, are added to `contracts/notifications.contract.md` §1.1, §2.3, §5.1 and §8.1. Owner ruling 2026-09-26: "two event types, not one with a kind in the payload". That is mechanical, not stylistic — `notification_event_id(event_type, source_id)` hashes the TYPE, so two types are what let one exam block carry two independently-replayable notices; one type with `{"kind": ...}` in its payload derives one id per block and the second notice is swallowed by the same ON CONFLICT that makes the first a safe replay.
WAS, verbatim (Doc 05F §22.7 "Exam precedence"): "Target 7 Nov, `full_length_weekday` = Saturday, horizon 26 Oct – 8 Nov. The final rehearsal is the last Saturday at least `final_exam_lead_days` before the target: Sat 31 Oct. The next cadence Saturday falls outside the horizon. One exam placed, key `final_rehearsal`, and the following study day carries the exam-review block."
IS: "Target 7 Nov, Saturdays every 2 weeks, set up 20 Sep, horizon 26 Oct – 8 Nov. The rehearsal is the last Saturday at least `final_exam_lead_days` before the target: Sat 31 Oct, anchored to the real test and never shifted. The cadence series runs from the setup date in 14-day steps to the next Saturday on or after each step; the step landing inside the horizon is Sat 7 Nov, which is on the target and therefore refused. One exam placed, key `final_rehearsal`, and the following study day carries the exam-review block." The section's TITLE also stops being true: there is no precedence any more, so it reads "Exam placement".
WAS, verbatim (§9.4): "Ships as a **fail-open stub**: `create` returns `{ ok: false, reason: 'engine_unavailable' }` as data … `full_length` is absent from `enabled_block_types`, and while it is absent `calendar_build_plan_input` nulls `full_length_weekday` and the exam facts". (§21): "`enabled_block_types` | `[\"practice\",\"review\"]` | — | V-03, and the builder's input neutralisation (§10.1). `full_length` is added only when G-08-02 closes."
IS: the adapter is real (`server/services/calendar/adapters/full-length.ts`), `enabled_block_types` is `["practice","review","full_length"]`, and the neutralisation RULE stays exactly as written — it is what makes an engine switched off cost the student nothing, and it now also nulls `full_length_interval_weeks`. G-08-02 in §20 moves to Closed.
THE TWO DEFECTS THIS FIXES, both verified in production and neither a porting bug:
  (a) the anchor was the first preferred weekday ON OR AFTER the setup date, so the first exam landed on the day the student set up — 26 Sep, for a profile created 22 Sep;
  (b) that date carried `is_user_override = true` from an earlier day edit, so the narrowing step dropped it, and the next occurrence sat one day outside the 14-day horizon. NO EXAM COULD EVER BE PLACED, and no refresh or profile change would have fixed it.
  Placement now starts one full interval after the setup date (or after the last completed exam), so (a) is arithmetically impossible; and an overridden occurrence SHIFTS rather than vanishing, so (b) cannot recur silently.
THE SHIFT IS +7 DAYS, NEVER +1…6, and that was a push-back the owner ruled on (2026-09-26, option A). The brief asked for a day-by-day shift of up to six days. V-02 — live at `20260917140000_calendar_route_constants.sql:250-255`, pinned at `scripts/ci/genesis-schema.expected.sql` — requires `EXTRACT(DOW FROM v_date) = p_wd` for every created `full_length` in `generated` AND `day_regenerate`. A +1…6 shift can never satisfy it, so the brief's own instruction would have produced a plan the validator rejects. The ruling: shift to the next occurrence of the SAME weekday.
WHEN NEITHER DATE IS AVAILABLE, THE PLAN SAYS SO. Two overridden occurrences record `{"kind":"full_length_suppressed","date":"…"}` in `degraded[]` (owner ruling 2026-09-26: structured, not a marker string, so a surface can name the date). It reaches both ready payloads as `full_length_suppressions` and BOTH SURFACES render it — owner ruling 2026-09-26: "Guardians see the suppression. It's a fact about the plan, not a control and not a profile field — the same category as the projection and the test date. That's precisely the silence this whole change exists to end; withholding it would rebuild the defect on the guardian side." With the guardian's own copy: "a statement, never an action", no CTA, the same rule as "No target set". A suppression must NEVER force `fallback_v1`: only the marker strings `mastery` and `review_queue` do (formula sheet §5A), and `calendar_persist_version`'s reader was widened to read structured entries without treating them as degradation.
Retired, in code and in config: `full_length_every_n_occurrences` and `full_length_min_gap_days`. The gap is implied by the frequency, and two rules saying one thing is how they drift apart. `max_full_length_per_horizon` stays, and it still counts the rehearsal (owner ruling 2026-09-26: "keep it").
Rationale: the owner's. Placement should take what the student chose, exactly as practice and review do. A ladder of three interacting rules produced a profile on which the feature could not work at all, and no amount of porting the ladder correctly would have changed that.
Why this surfaced now: a production profile (student amingwa08, set up 22 Sep) had no exam in its plan and no refresh would put one there.
Owner action: apply, in order, `supabase/migrations/20261010000000_full_length_interval_weeks.sql` (column, backfill of weekday-non-null rows to 2, the pair CHECK, and the new config row), `20261011000000_exam_placement_frequency.sql` (the rewritten `calendar_place_full_lengths` and four inherited bodies, the two retired config keys, `generator_version` → 20261011000000) and `20261012000000_calendar_exam_notifications.sql` (two event types, the `exam_notify` job value and two outcomes, three functions). Then register the Vercel cron for `/api/internal/calendar-exam-notify`. This entry is PROPOSED until all three are live in production, because authorisation is not application (SCL-159), and because this session cannot read production: the deployment state of every migration named here is unverified from here and stated as authored, never as applied.
Build artifact: the three migrations above; `scripts/ci/calendar-writer-gates.sql` Z-53..Z-59 (the pair and the placement) and Z-60..Z-67 (the notifications); `scripts/ci/calendar-parity.ts` and `scripts/ci/reference/calendar_parity_emit.py` (12 fixtures plus the seeded suite, byte-exact on PG 17); `scripts/ci/calendar-schema-gates.sql` B-02 (three new bodies pinned); `packages/shared/src/calendar/profile.ts` (`fullLengthIntervalWeeksSchema`, the pair refinement, `fullLengthsBeforeTarget`); `packages/shared/src/calendar/api.ts` (`exam_planning`, `full_length_suppressions` on both payloads); `packages/shared/src/notifications-schema.ts`; `client/src/features/calendar/copy/exam-cadence.ts` (one readout, both forms); `client/src/features/calendar/components/{SetupPopup,SettingsSheet}.tsx`; `client/src/features/calendar/components/Chrome.tsx` (`FullLengthSuppressionNotice`); `server/services/calendar/exam-notify-job.ts`; `server/lib/notifications/templates/full-length.ts`; `server/routes/internal-cron-routes.ts`; `vercel.json`.
AMENDED 2026-09-29 (Brief 17) — THE FIRST SITTING RULE THIS ENTRY DESCRIBES WAS WRONG, and the correction belongs here rather than in a new entry because it changes the rule this entry states, not a different one. Item (1) above said placement runs "from the last completed exam or the setup date, + interval_weeks x 7". Spending the first interval BEFORE the first sitting means a fortnightly student's first exam can never land in their first horizon, and a monthly student's certainly cannot: the interval consumes the window. Weekly was the only cadence that worked, which is why every gate this entry shipped (Z-56..Z-59, all weekly or monthly-with-a-rehearsal) stayed green over it.
Evidence, production, profile 59ce67c7: `study_days_mask = 62` (Mon-Fri), `full_length_weekday = 6`, `full_length_interval_weeks = 2`, set up 29 Sep, no target date. 29 Sep + 14 = 13 Oct, next Saturday 17 Oct, horizon ends 12 Oct. The Saturdays IN the horizon (3 Oct, 10 Oct) were owned plan dates carrying zero full-length blocks. This is the mirror of the anchor defect (a) that this entry replaced: that one put the first exam ON the setup day, this one puts it past the end of the window, and "strictly after, then interval" is the only rule that avoids both.
WAS, verbatim (formula sheet §2 Step 2 item 2, as this entry left it): "**The series**: start from the **last completed full-length's local date**, or the **setup date** when there is none. Add `interval_weeks × 7` days, then take the **next preferred weekday on or after** that. Repeat through the horizon."
IS: "**The series.** The **first** sitting is the first preferred weekday **strictly after the setup date** — no interval is applied before a student has sat one. After a completed full-length, the next is `interval_weeks × 7` days from that sitting, snapped forward to the preferred weekday. Every later one is `interval_weeks × 7` from its predecessor, through the horizon." Plus, stated in the sheet because it looked like a bug to three readers: AN EXAM DAY NEED NOT BE A STUDY DAY — the study-days mask governs practice and review, not the sitting the student explicitly scheduled.
`default_full_length_weekday` (6, bounds 0..6) is added to §21/§4 beside `default_full_length_interval_weeks`. Same category exactly — a SURFACE default the generator never reads — but with one difference worth recording: the oracle carries it in `C`, so the parity gate DOES cross-check its value, where the interval default is checked by the C-01 key list alone. §22.7's worked example is updated to the corrected arithmetic. The setup form's practice-test-day row opens on it instead of on None; R-08-27 is untouched, because the row opening on a value and the payload carrying one are two different questions (the display shows the served default, the payload sends null until the student answers, and `full_length_pair` integrity is asserted over all 144 ordered tap pairs across the two rows).
Retired with it: `DEFAULT_EXAM_WEEKDAY = 6` in `client/src/features/calendar/copy/exam-cadence.ts`. Doc 05F §17 forbids a literal where a config value exists, and this is why: the constant was read by two surfaces, so an operator moving the default would have moved it on neither.
Owner action for the amendment: apply `supabase/migrations/20261013000000_first_sitting_rule.sql` (the corrected `calendar_place_full_lengths`, the new config key, `generator_version` -> 20261013000000). This entry stays PROPOSED until every migration it names is live, which now includes that one; the deployment state of all four is unverified from this session.
Build artifact for the amendment: `supabase/migrations/20261013000000_first_sitting_rule.sql`; `scripts/ci/calendar-writer-gates.sql` Z-68..Z-69 (a new fortnightly student sees a sitting in their first horizon, on a non-study day; after a completed sitting the next is a full interval) and Z-56's corrected rationale; `scripts/ci/calendar-schema-gates.sql` (C-01 gains the key, B-02 re-records `calendar_place_full_lengths` at 7497/e8056c8f); `scripts/ci/genesis-schema.expected.sql` regenerated FROM THE DATABASE; `packages/shared/src/calendar/api.ts` (`default_full_length_weekday` on both the setup-defaults and exam-planning schemas); `server/services/calendar/config.ts` and `read-service.ts`; `client/src/features/calendar/components/{SetupPopup,SettingsSheet}.tsx`; `client/src/features/calendar/copy/exam-cadence.ts`. The three artefacts this was ported FROM — the oracle, the fixtures and the formula sheet — were committed by the owner (c1161211, 42503593, 6835fb6c) and are not edited here.

SCL-187 | 2026-09-29 | Doc 00 §11/§13 and Doc 01 §37: an under-13 student may use Lyceon only while a guardian link is active; the redeemed link replaces the email-consent flow; a guardian gives a date of birth and must be 18 or older | APPLIED
Id: `SCL-187` derived at the moment of use, 2026-09-29, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 53 remote refs: highest allocated anywhere is `SCL-186` (claimed by #971, `claude/student-ui-no-raw-accuracy`). Open PRs checked, all sixteen (#977, #976, #975, #974, #973, #972, #971, #970, #969, #968, #967, #966, #964, #959, #940, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner rulings recorded: R6 and R10 (2026-09-27), in `docs/plans/Guardian_Closure_Plan.md`.
1. Under-13 access (R6). A student whose profile says they are under 13 may reach a learning surface only while at least one guardian link to them is ACTIVE. With no active link they reach only the guardian-linking surface (their link code, regenerate, the guardian email invite, the list of their guardians) and account essentials (sign-in/out, profile, legal acceptance, notifications, account deletion). Unlinking the last guardian closes access again, automatically: the rule is derived from the link on every request, never stored. LISA stays closed to every under-13 account regardless of any link (Doc 03 §12.5, unchanged).
2. The link replaces the email-consent flow (R6). Doc 01 §37.1 steps 3–4 and §37.2–§37.4 (a `guardian_email` prompt, a consent request row, a consent email, token expiry and resend) are retired: none of it ever worked in production (KNOWN-GAPS CONSENT-FLOW-SCHEMA-MISMATCH — the code queried columns the table never had). A guardian redeeming the student's link code is the connecting act. Whether that act is sufficient consent in law is NOT decided here: it is on the counsel backlog with the Privacy Policy wording, which this entry does not touch.
3. Guardian age (R10). A guardian gives a date of birth through the same field as a student and must be 18 or older, at sign-up and before redeeming a code; once a profile is complete its date of birth is fixed (the one exception: a guardian with none on file may add it once).
Conflict this entry resolves, stated plainly: Doc 00 §11 and §13 set the V1 COPPA posture as "a genuine server-side age gate blocks under-13 account creation — no knowingly permitted under-13 accounts … no COPPA VPC flow". Rule 1 knowingly permits an under-13 account to exist, gated on a guardian link. That is a change to a launch-gating legal posture, not a detail, and it is why this entry is PROPOSED rather than recorded as settled: the locked documents are unchanged, and the owner ruled R6 with legal sufficiency explicitly out of scope and routed to counsel.
Build artifact (Wave 2 PR #978): G2-05 removes the consent flow and derives "guardian connected" from an active link (`server/lib/guardian-link-state.ts`); G2-04 (next in the same PR, not yet built at this entry's date) is to enforce rule 1 per request on every learning mount; G2-03 locks the date of birth after completion; G1-02 (merged, #961) enforces rule 3 at sign-up and redeem.
Status 2026-09-29 (owner ruling): ACCEPTED — under-13 students may use the platform once a guardian links; whether the link is sufficient consent in law stays on the counsel backlog. The status value stays PROPOSED, because SCL-159 defines exactly three values and PROPOSED is "authorised but not live": G2-04 and G2-05 are built in PR #978 and not deployed. When the Wave 2 deploy is live, this entry moves to APPLIED.
Status 2026-09-30 (owner, production-verified): PROPOSED -> APPLIED. The Wave 2 deploy is live, which is the condition the line above set. Owner production proofs, 2026-09-30: an under-13 profile (d708ede4) completed at 02:22:40Z and made no learning calls while unlinked; a guardian redeemed its code at 02:46:05Z (201, link 3ad1db5e) and its learning reads returned 200 from 02:46:10Z; `profiles.guardian_consent` is dropped; a guardian under 18 was refused with GUARDIAN_UNDER_18 at 02:33:58Z; trigger `profiles_lock_date_of_birth` is enabled with function md5 `9af5b72a48ecd38efff94f766209b05f`, matching #978. The unlink-mid-session case is proved by the G2-04 PG suite, not in production. Rows G1-02 and G2-01..G2-06 in `docs/plans/Guardian_Closure_Plan.md` are CLOSED on these proofs.

SCL-184 | 2026-09-29 | Doc 05F: a block is launchable on ANY date (R-08-34 new; §15.1 step 1 rewritten), and a unit from an engine session linked to a block belongs to that block whatever date it happened on (§13 gains a pass ahead of the date match; R-08-24 amended; §7.7's "never for progress" narrowed; §9.1's ActivityUnit gains `session_id`) | PROPOSED
Id: `SCL-184` re-derived at the moment of use, 2026-09-29, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest allocated anywhere is `SCL-183` (on `origin/main`, `origin/cleanup`, `origin/review` and five `origin/claude/guardian-g1-*` branches). All 15 open PRs checked — #955, #954, #953, #952, #951, #950, #949, #948, #947, #946, #945, #944, #940, #938, #728 — every head branch lives in this repository and is therefore covered by the fetch, and none carries an entry above 183. One entry allocated.
Change: owner ruling R-08-34 (Karl, 2026-09-29, Brief 15). "A block is launchable on any date, past or future. The calendar is a plan, never a gate; a student who is ahead of schedule is succeeding, and a missed day the student wants to pick up is exactly the behaviour to encourage." Six amendments (the register is the amendment, per SCL-159; no document is edited):
  (1) R-08-34, NEW, added to §6's ruling register: "A block is launchable on any date. The date a block sits on is a plan, not a permission. Work done against a block counts for that block whether it was done early, on the day, or late."
  (2) §15.1 step 1. The 409 for any date other than the student's local today is gone. See WAS/IS below.
  (3) §13. A pass is added AHEAD of the date-and-scope match: a unit from an engine session that a `calendar_block_launches` row ties to block B belongs to B, regardless of the unit's own local date. Engine equality is NOT relaxed — see the reading below.
  (4) R-08-24. Amended to admit exactly one derived-from-stored-state exception, and to say which.
  (5) §7.7. Its last clause — "Used for Resume/Continue and `calendar_launch_rate` only. Never for progress." — is narrowed. THIS WAS NOT IN THE BRIEF'S LIST; see the note below on why it has to be, and on the two live database comments that also state it.
  (6) §9.1. `ActivityUnit` gains `session_id`. Also not in the brief's list, and the rule in (3) is unimplementable without it.
WAS, verbatim (§15.1 step 1): "load the block; **409 unless `scheduled_date` = the student's local today** — past → \"Do it now\"; future → view-only; studying ahead happens directly in the engines and shows as today's actual or extra work;"
IS: "load the block. There is no date check: a block launches on its own date whatever today is (R-08-34). Every other refusal in this sequence stands — `already_complete` at step 3, an engine absent from `enabled_block_types`, and every adapter decline returned as data."
WAS, verbatim (§7.7, last sentence): "Used for Resume/Continue and `calendar_launch_rate` only. Never for progress."
IS: "Used for Resume/Continue, `calendar_launch_rate`, and — since R-08-34 — the §13 allocator's attribution pass, which is the ONE place a launch row feeds progress. It contributes no quantity: the row says which block a session belongs to, and the units are still the engines' own immutable facts, counted by the allocator. A launch row can move work from one block to another; it can never create any."
WHY §7.7 HAD TO BE NAMED, since the brief amended R-08-24 and not this. R-08-24 states the principle ("progress is derived by the allocator from immutable engine activity; nothing about completion is stored, matched or reconciled") and §7.7 states a blanket prohibition on one table. The amendment in (4) satisfies the first and leaves the second false as written, and "never" is the word this corpus treats as a hard stop. It is stated in FIVE places, which is the part worth recording:
  - `docs/Spec/Lyceon_Doc_05F.md:367` — canonical, hook-blocked, amended by this entry;
  - `supabase/migrations/20260917130000_calendar_v1.sql:360` — the live `COMMENT ON TABLE`;
  - `supabase/migrations/20260917130000_calendar_v1.sql:2493` — the live `COMMENT ON FUNCTION calendar_link_launch`;
  - `scripts/ci/genesis-schema.expected.sql:11571` — the pinned dump, which follows from the two above;
  - `supabase/migrations/20261012000000_calendar_exam_notifications.sql:155` — `calendar_full_length_complete`'s comment, which cites §7.7 as its reason for deriving completeness from `test_sessions`.
  The last of those is NOT made false: that function still derives exam completeness from `test_sessions` and never from a launch row, so its claim about itself stands; only its citation of a now-narrower blanket rule is loose, and its behaviour is unchanged by this brief. NEEDS A RULING: the two live COMMENTs are false as written once this ships. Correcting them is a comment-only migration plus a genesis regeneration — no behaviour, no function body. This session has not written one, because whether a live comment is worth a migration is the owner's call and not a defect to fix unasked.
R-08-24, WAS verbatim: "Progress is derived by the allocator from immutable engine activity; nothing about completion is stored, matched or reconciled."
IS: "Progress is derived by the allocator from immutable engine activity. Nothing about completion is stored, matched or reconciled. ATTRIBUTION — which block a unit counts for — may additionally read a `calendar_block_launches` row, for the session that row names and for nothing else. That row carries no quantity, no status and no completion: it answers 'which block did this session come from', a question only the launch knows the answer to. Everything else remains derived."
THE READING OF (3) THAT MATTERS, because the obvious wider one is wrong. R-08-34 relaxes the DATE and not §13's first clause. Engine equality still has to hold before a linked unit counts: a day edit can leave a practice session linked to a block that is now a review block — the launch service's own resume branch hit exactly that in production on 2026-09-22 — and counting review items toward a practice block's target would make a block report work of a kind it never asked for. Such a unit falls through to the ordinary match, finds nothing, and lands in extra work, where it is visible and attributed to nobody who did not earn it.
CONSERVATION (INV-08-21) IS UNCHANGED AS A PROPERTY AND TOOK TWO CHANGES TO KEEP. `sum(allocated) + sum(extra) = units_considered` still holds per day, and each unit is still counted exactly once across the range. Both halves are needed and neither is sufficient:
  - the allocator DROPS a unit whose session is linked to a block that is not on the day being allocated, before anything counts it, so a unit worked ahead is not extra work on the day it happened;
  - `buildCalendarRange` INJECTS that unit into its block's own day, so it is progress there.
  With only the first, the work disappears. With only the second, it is extra work today and progress tomorrow — the double count the invariant exists to forbid. A linked unit surplus to its block's target is not special: once the block is full the leftovers behave like any other unit on the block's day.
SCOPE LIMIT, STATED RATHER THAN DISCOVERED. The read path attributes linked units that are already in the requested window's unit set. A block inside the window whose work was done outside it is not attributed, because the units are fetched per (engine, date) for the dates in the window. Fetching by session across all time would mean an unbounded per-block query on every calendar read, for a case that needs a student to launch a block and do the work more than a fortnight apart. The launch path has no such limit — it reads by session precisely so `already_complete` cannot be wrong — so the refusal that matters is exact even where the display is not.
§9.1, ADDED: `ActivityUnit` gains `session_id: string | null` — the engine session the unit came out of. Paired with `engine` it is what a launch row points at, and without it the rule in (3) cannot be expressed: the shape carried `unit_id` and nothing about its parent. Both item tables have had the column since `20260610020000` (`practice_session_items.session_id` at `:105`, `review_session_items.session_id` at `:170`); the adapters simply never selected it. Null is the fail-closed value — no session, no link, ordinary matching. §9.1 also gains `unitsForSessions(studentId, sessionIds, timeZone)` beside `activityUnits`, because a date-keyed read cannot return work done on a date other than the block's.
ANTI-LEAK, verified in the same change rather than asserted (CLAUDE.md's chokepoint rule): an `ActivityUnit` reaches no client. `dayBlockSchema` is `.strict()` over `{block, actual, progress, status}` and `dayExtraWorkSchema` omits `unit_ids` outright, so neither a unit id nor a session id has a path to a payload.
ALREADY COVERED, not re-filed: the brief also asked for `exam_mode` on §7.4's full-length scope. **SCL-167 did that on 2026-09-25** and is APPLIED — its WAS/IS records `{"form_id"}` becoming `{form_id, exam_mode}`, both keys required-present, and `calendar_scope_is_valid`'s two-key check. Restating it here would put two register entries on one clause, which is the divergence the register's own duplicate gate exists to catch. Cited instead.
Rationale: the owner's. A plan that refuses the work it planned is a gate wearing a calendar's clothes. The two defects it produced in practice were a student ahead of schedule whose work showed as extra questions rather than as the block they had just launched, and a student behind who could not touch the block at all.
Why this surfaced now: production carried a `calendar_block_launches` row with `engine='full_length'` against a live `test_sessions` row — the exam seam works — but only because the block had been moved to today first.
Owner action: none beyond merging; no migration, the change is code. Decide the §7.7 COMMENT question above. This entry is PROPOSED until the change is live, because authorisation is not application (SCL-159), and because this session does not read production: the deployment state of anything named here is unverified from here.
Build artifact: `packages/shared/src/calendar/allocate.ts` (`session_id`, `linkedSessionSchema`, the two-pass allocator); `packages/shared/src/calendar/read-model.ts` (the per-day injection); `server/services/calendar/launch-service.ts` (the date gate and `not_today` removed; `linkedSessions`/`unitsForSessions` deps); `server/routes/calendar-routes.ts` (the `CALENDAR_NOT_TODAY` arm removed); `server/services/calendar/launch-deps.ts`; all three adapters in `server/services/calendar/adapters/`; `server/services/calendar/read-service.ts` (all launch rows, not just the latest); `client/src/features/calendar/components/BlockSheet.tsx`. Tests: `scripts/ci/fixtures/calendar_allocator_fixtures.json` (two range fixtures, each with two identically-scoped blocks so only the linked pass can produce the expectation); `packages/shared/src/__tests__/calendar-allocator.test.ts` (the conservation property generates linked sessions in three shapes and asserts the linked rule, not only the sum); `client/src/features/calendar/components/BlockSheet.test.tsx` (23 render tests at three date positions); `tests/ci/calendar.launch-service.test.ts`; `tests/ci/calendar.routes.contract.test.ts`.

SCL-185 | 2026-09-29 | ENTITLEMENT DENIAL, CLIENT CONTRACT: every paid-feature denial carries `code: "entitlement_required"` and `details.feature` (the `canAccessFeature` key) on the status each document already mandates (tutor 403, exam 403, calendar 402 in the flat shape). The client reads a denial by its `code`, never its status | PROPOSED
Id: `SCL-185` allocated 2026-09-29 as max+1 across every remote branch after `git fetch --all --prune`: `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` over all 41 remote refs gives a maximum of `SCL-184` (on `origin/calendar` and `origin/claude/anyday-launch`), and a whole-tree `SCL-1[89][0-9]` scan of every ref agrees. Open PRs checked: #963 (`calendar`), #962 (`claude/guardian-one-sub-per-student`), #959 (`claude/student-ui-docs`, this change), #940 (`claude/batch-005-launch-gw211p`) and #728 (dependabot). Every head branch is among the scanned refs, and none carries a higher number. First of two sequential allocations this session: SCL-185, then SCL-186.
Change: owner ruling (Karl, 2026-09-29, student UI vertical Step 2 ruling 1, "UI-01, amended"). Three documents each mandate a different denial for the same situation, a student without the paid feature. The ruling keeps every status and unifies what the body says. The register is the amendment, per SCL-159; no document is edited.
  (1) Doc 03B §5.9 (tutor). Status stays 403 with `error.code = "entitlement_required"` (CR-03B-21 stands). The body gains `error.details.feature = "tutor_access"`. The tutor keeps its own predicate, `isEntitlementActiveForProfile`. It does NOT move to `canAccessFeature`. There is no live-exam gate on the tutor: the owner's standing LISA ruling of 2026-09-25 (E9 rulings, R6) withdrew it, recorded as SCL-032, SCL-079 and SCL-126 (all WITHDRAWN). Corrected 2026-09-30 (owner, Brief 5): this sentence first said the tutor keeps "the live-exam block", which contradicted that standing rule; the code (`server/routes/tutor-runtime.ts`, POST /messages step 4) was right.
  (2) Doc 04A §16.1 step 2 and §16.2 (exam runtime). Status stays 403. The ENTITLEMENT failure's code becomes `entitlement_required` with `details.feature = "exam_full_length"`. The session-ownership failure in §16.1 step 3 keeps `403 forbidden`, so the two are no longer indistinguishable by body.
  (3) Doc 05F §15 (calendar) and the `entitlementGate` resources (`calendar_access`, `mastery_detail`). Status stays 402 in the FLAT platform shape (owner ruling 2026-09-17, `server/lib/http-errors.ts`). The flat body's `code` becomes `entitlement_required`, and it gains `details: { feature }`.
  (4) Client contract. One helper reads an entitlement denial from both the flat and the nested shapes. It keys off `code === "entitlement_required"` and returns the `feature`, never branching on the status. The upgrade modal (student UI vertical row UI-44) opens from that feature. The Zod schema for the denial body and the feature enum live in `packages/shared`.
WAS, verbatim: Doc 03B §5.9, "| Not Paid tier or inactive entitlement | 403 | `entitlement_required` |". Doc 04A §16.1, "2. **Entitlement.** Verify the authenticated student holds an active product entitlement that includes full-length exams (per Doc 01). Fail → `403 forbidden`." Doc 04A §16.2, "| `forbidden` | 403 | Authenticated, but no entitlement or not the session owner |". Doc 05F §15, "402 (shared CTA payload, flat platform shape so the existing upgrade component recognises it; also the guardian's student being unentitled)".
IS: the statuses above, unchanged. On every paid-feature denial, `code = "entitlement_required"` and `details.feature = <canAccessFeature key>`, in the body shape that surface already uses. Doc 04A's `forbidden` row now means "not the session owner" only.
Out of scope, stated so it is not read as covered: the guardian-facing `student_unentitled` 402 from `resolveSubject` (guardian vertical); the practice free daily quota, which returns 402 `PRACTICE_FREE_DAILY_QUOTA_EXCEEDED` where Doc 01A §44 specifies 429 `rate_limit_exceeded` (recorded as a finding in `docs/plans/student-ui/student-ui-vertical.md` §8, not changed); and the lapsed-entitlement exam report, which stays HTTP 200 `unavailable` per Doc 04C.
Rationale: the owner's. One client contract lets one upgrade modal serve every paid surface without re-litigating three documents' status choices, each of which had its own reason (CR-03B-21's proxy-handling argument, 04A's code table, 05F's flat CTA payload).
Owner action: none beyond merging the build artifact. This entry is PROPOSED until the change is live (SCL-159).
Build artifact: branch `claude/student-ui-entitlement-contract` (register row UI-01).

SCL-186 | 2026-09-29 | Doc 05 Parent §12.2 requires product copy to show "your recency-weighted accuracy is Y%"; students see no raw accuracy figure anywhere. Mastery is shown as the level only | PROPOSED
Id: `SCL-186` allocated 2026-09-29 as max+1 after SCL-185, in the same session and against the same scan (see SCL-185 for the derivation). Second of two sequential allocations.
Change: owner ruling (Karl, 2026-09-29, student UI vertical Step 2 ruling 6): "Raw accuracy: remove every student-visible raw accuracy figure, including the sentence at Doc 05 Parent:646. Allocate an SCL amending Doc 05 Parent to strike it." The register is the amendment, per SCL-159; no document is edited.
WAS, verbatim (Doc 05 Parent §12.2, "No AI-confidence overlays on mastery", line 646): "Mastery values are computed from a deterministic formula, not from a model. There is no "AI thinks you're at level 3" framing. The product copy MUST present mastery as a measurement: "you've answered X questions for this skill; your recency-weighted accuracy is Y%.""
IS: "Mastery values are computed from a deterministic formula, not from a model. There is no "AI thinks you're at level 3" framing. The product copy presents mastery as its level (`mastery_level`, Doc 05 AC#20) and never as a raw or recency-weighted accuracy percentage." The prohibition on AI-confidence framing and §12.3's prohibition on probability framing are unchanged.
Scope: every student-visible surface. That includes the KPI tiles and pills that show a weekly or session accuracy percentage today (for example `client/src/pages/lyceon-dashboard.tsx` "Accuracy (7d)", `client/src/pages/practice.tsx` "Accuracy", `client/src/components/layout/PracticeShell.tsx` accuracy pill). Counts of the student's own activity (questions answered, sessions, streak) are unaffected.
Rationale: the owner's. A raw percentage beside a mastery level gives the student two measures of one thing, and the one that moves fastest is the least meaningful.
Owner action: none beyond merging the build artifact. PROPOSED until live (SCL-159).
Build artifact: student UI vertical register row UI-1A (`docs/plans/student-ui/student-ui-vertical.md`).

SCL-188 | 2026-09-30 | Doc 05B §10: a guardian's KPI read is the current streak only. §10's table narrows `student_overall_kpi` to `current_streak_days` for a guardian and withdraws `student_section_kpi` and `student_domain_kpi` from the guardian surface; §10.3's RB-05B-V1-05 admits one role-aware projection, on the KPI routes | APPLIED
Id: `SCL-188` derived at the moment of use, 2026-09-30, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 65 remote refs: highest allocated anywhere is `SCL-187`. Open PRs checked, all three (#984, #940, #728): every head branch is in this repository and therefore covered by the fetch. Two entries allocated in this session, in order: SCL-188 (this one, G3-01) and SCL-189 (G3-02).
Owner ruling recorded: R3 (`docs/plans/Guardian_Closure_Plan.md`): "Remove the 7-day questions and 7-day accuracy tiles completely … The server stops sending these counters to guardians." Plan row G3-01.
WAS, verbatim (Doc 05B §10 table, rows 2–4): "`student_section_kpi` | YES — section engagement aggregates | active link + active entitlement"; "`student_domain_kpi` | YES — domain engagement aggregates | active link + active entitlement"; "`student_overall_kpi` | YES — overall engagement aggregates | active link + active entitlement".
IS: "`student_section_kpi` | NO — the route answers a guardian with an empty list (§10.4 semantics) | n/a"; "`student_domain_kpi` | NO — as `student_section_kpi` | n/a"; "`student_overall_kpi` | YES — `current_streak_days` ONLY, served as `{ currentStreakDays }` | active link + active entitlement".
WAS, verbatim (§10's guardian query example): "SELECT events_total, events_last_7d, accuracy_last_7d, current_streak_days, last_active_at FROM student_overall_kpi WHERE student_id = $1;"
IS: "SELECT current_streak_days FROM student_overall_kpi WHERE student_id = $1;"
WAS, verbatim (§10.3, RB-05B-V1-05): "route handlers MUST NOT branch into different SQL predicates or projections by caller role. A single path-layer authorization check that accepts either student-self or active linked guardian is REQUIRED — that check inherently inspects the caller-to-student relationship and is the only permitted role-aware branch."
IS: the same rule, with ONE named exception: "the KPI routes (`kpi/overall`, `kpi/sections`, `kpi/domains`) project by the path-layer result — `via = 'guardian'` receives the streak only, from a SELECT of that one column. The branch reads the resolver's server-side answer, never a client claim. No other route gains a role-aware projection."
Why the exception is the honest form: the alternative that keeps RB-05B-V1-05 literal — dropping the guardian RLS policies and GRANTs so the shared SELECT returns nothing for a guardian — cannot express "the streak but not the counters" on one row, because a column GRANT on `authenticated` is shared by the student and the guardian. The route already runs on the service role, so the GRANT is not the enforcing layer for this surface; the route projection is.
NOT CHANGED, stated so it is not assumed: the database's guardian read policies on the three KPI tables. They are not reached by this route (service role), and dropping them is a migration, not part of G3-01. Recorded for the owner, not acted on.
Rationale: the owner's (R3). Seven-day question and accuracy counts, shown to a parent, invite judging a child by volume and a percentage; the streak is the one engagement signal the ruling keeps.
Anti-leak, verified in the same change (CLAUDE.md's chokepoint rule): the guardian branch of `kpi/overall` parses through the `.strict()` shared schema `guardianKpiOverallSchema` before it is sent — an added field is a 500, never a leak — and the guardian reader never SELECTs the removed columns. The student branch parses `studentKpiOverallSchema` with STRIP and logs each dropped key path once (`toStudentKpiOverallWire`), by owner ruling 2026-09-30 on #994: a field added to the student builder without a schema update must fail CI, not a student's dashboard, so the strict check for the student shape lives in the wire-contract test (the parse must be the identity on real route output).
Owner action: none beyond merging; no migration. This entry is PROPOSED until the change is live (SCL-159). Production proof named by G3-01: a request as a guardian to `kpi/overall` shows the streak only.
Build artifact: `packages/shared/src/student-resources.ts` (the kpi/overall schemas; `StudentKpiView` now inferred from them); `server/services/canonical-runtime-views.ts` (`readGuardianKpiOverall`); `server/routes/student-resources.ts` (the `via` projection on the three KPI routes); `client/src/pages/guardian-dashboard.tsx` and `client/src/components/guardian/GuardianTemplatePreview.tsx` (the two tiles removed). Tests: `tests/ci/student-resources.contract.test.ts` (G3-01 block: wire key set, strict parse, recursive `events_*`/`accuracy_*`/`week_*` sweep over all three routes, presence on the student side first; five cases red without the route change); `client/src/components/guardian/GuardianCta.test.tsx`.
Status 2026-09-30 (owner, production-verified): PROPOSED -> APPLIED. Live on build `dpl_4jB6vv9DiuVNSAtEsS9kXs7YiCwH` (#994): the guardian's `GET /api/students/3f18cbe2…/kpi/overall` returns 84 bytes, down from 3,300 on the previous build (requests `8c142971`, `34c6461a`, `e6c07a53`, `3156e30d`, 09:17–09:23Z, all 200). Row G3-01 is CLOSED on this proof.
SCL-189 | 2026-09-30 | Amends SCL-180 (Doc 04 Parent Q9; Doc 04C §8.1/§9.1 guardian payloads): the guardian's per-domain breakdown is a bar only — `{section, domain, bar_pct}` — with no `correct` and no `total`. The student's breakdown is unchanged | APPLIED
Id: `SCL-189`, the second of two entries allocated in this session by the derivation recorded under SCL-188 (2026-09-30, all 65 remote refs, highest `SCL-187`; open PRs #984, #940, #728 all in-repository).
Owner ruling recorded: R4 (`docs/plans/Guardian_Closure_Plan.md`): "Exam results: remove the per-domain x/y counts and keep the per-domain bar. … Amends SCL-180." Plan row G3-02.
WAS, verbatim (SCL-180 amendment 1): "The guardian headline gains exactly one thing: the per-domain breakdown, meaning the eight canonical domains, each with `correct` of `total` for a SCORED section, identical to the rows the student sees."
IS: "The guardian headline gains exactly one thing: the per-domain breakdown, meaning the eight canonical domains for each SCORED section, each as the length of the bar the student sees — `bar_pct`, the student's `correct / total` as a whole percent 0–100, rounded half-up. The counts are the student's alone."
WAS, verbatim (SCL-180 amendment 2): the guardian payloads gain `domain_breakdown: [{section, domain, correct, total}]`.
IS: the guardian payloads (scored and partial_scored) carry `domain_breakdown: [{section, domain, bar_pct}]`, `.strict()`. The student payloads keep `[{section, domain, correct, total}]` exactly as SCL-180 left them.
Why a percent and not the fraction: the bar is what R4 keeps, and a whole percent is the bar's resolution on screen. A raw fraction would travel the counts' ratio at full precision for no visible gain.
Recorded, not resolved: SCL-180's own note that a guardian could add up a section's raw total from the rows no longer applies to counts; from percentages alone a section's raw correct cannot be summed, because the per-domain totals are not sent.
Anti-leak, verified in the same change: the guardian rows are built from named fields by `toGuardianDomainBars` and parsed by `guardianDomainBarsSchema` inside `toGuardianExamReport`; a row carrying `correct` or `total` throws there, before the route sends anything.
Owner action: none beyond merging; no migration (the SQL function `exam_domain_breakdown` and its gate D4 are the student's source and are unchanged). PROPOSED until live (SCL-159). Production proof named by G3-02: a guardian exam report payload from production, pasted into the PR.
Build artifact: `packages/shared/src/exam-guardian-report-schema.ts` (`guardianDomainBarRowSchema`, `guardianDomainBarsSchema`, `toGuardianDomainBars`; both guardian states use them); `client/src/features/exam/components/DomainBreakdown.tsx` (one component: counts when the row has them, bar only when it does not); `client/src/features/exam/pages/ExamReportPage.tsx` (`ScoreTabs` accepts either row). Tests: `client/src/features/exam/guardian-domain-bars.test.ts` (strict-schema: fails if `correct` or `total` appear; rows derived from the real projection, presence first); `client/src/features/exam/pages/GuardianExamResultsPage.test.tsx`; `tests/ci/guardian-exam-results.handler-pg.ci.test.ts` (real route over real Postgres: guardian rows equal the bars of the student's rows, key set exactly `bar_pct, domain, section`). Six cases red without the schema change.

SCL-190 | 2026-09-30 | Doc 01 §40.2 step 4 and §40.2.1 Phase 3: at deletion-request time, sessions are revoked with `supabase.auth.admin.signOut(<the request's own access token>, 'others')` (amended 2026-10-01 from `'global'`), which exists, instead of `supabase.auth.admin.signOutUser(profileId)`, which does not. No ban; best-effort; ERROR log with event name and request id only | PROPOSED
Id: `SCL-190` allocated 2026-09-30 as max+1 across every remote branch after `git fetch --all --prune`: `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` over all 67 remote refs gives a maximum of `SCL-189` (on `origin/claude/guardian-wave-3` only, which also carries SCL-188). Open PRs checked: every open PR's head is one of the scanned remote branches (`guardian`, `cleanup`, `claude/student-ui-audit-followups`, `claude/batch-005-launch-gw211p`, a dependabot branch), so no unmerged entry is unaccounted for.
Change: owner ruling (Karl, 2026-09-30, Brief 6, register F-32). Doc 01 prescribes `await supabase.auth.admin.signOutUser(profileId)` twice for the deletion request: §40.2 step 4 ("Invalidate sessions", `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:1871`) and §40.2.1 Phase 3 ("Session and cache invalidation (post-commit, best-effort)", `:1922`). `@supabase/auth-js` 2.104.1 has no `signOutUser` (0 matches in `dist/main/GoTrueAdminApi.js`); its admin API revokes by the user's own token: `signOut(jwt, scope)`. Implemented as written, the call threw `TypeError` on every deletion request and revoked nothing; production had 2 deletion requests (owner read, 2026-09-30), so it has almost certainly run and failed at least once.
WAS, verbatim (§40.2.1 Phase 3, :1920-1925): "// Phase 3: Session and cache invalidation (post-commit, best-effort) / try { await supabase.auth.admin.signOutUser(profileId); } catch (err) { logger.warn('session\_invalidation\_failed', { profileId, err }); }". §40.2 step 4 (:1870-1871): "// 4\. Invalidate sessions / await supabase.auth.admin.signOutUser(profileId);".
IS (as amended 2026-10-01): both places read `await supabase.auth.admin.signOut(accessToken, 'others')`, where `accessToken` is the access token of the authenticated request that asked for the deletion (the request's own server-side session, as the auth middleware validated and, if it refreshed it, re-issued it). `others` revokes every refresh token the account holds except the requesting session's, so every other device is signed out once its current access token expires, and the device that asked stays signed in, confined by the pending-deletion gate. The user is NOT banned: the recovery link (§40.4) must still let them sign in to cancel. Phase 3 stays best-effort and post-commit: a failure never fails the request; it is logged at ERROR with the event name and the request id only (no profile id, no token, no provider message). Access tokens already issued stay valid until expiry (up to the §7.1 one-hour TTL); the pending-deletion gate refuses those sessions outside its allowed set, and is the backstop.
Amended 2026-10-01 (in place, still PROPOSED; owner ruling, Brief 10, register F-44): scope `others`, not `global`. As first built (`'global'`), the revoke also signed out the browser that made the request. The product's own reload after a successful request, which is meant to show the pending-deletion screen with its cancel button (`PendingDeletionScreen`, rendered app-wide for a pending account), landed on `/login` instead (observed in production 2026-10-01, register F-32 and F-44 proof). `others` keeps that one session. Nothing is lost: the pending-deletion gate confines it to the allowlisted paths, and the pending screen's only two calls (`GET /api/profile`, `POST /api/account/cancel-deletion`) are on the list. `@supabase/auth-js` 2.104.1 accepts the scope: `SIGN_OUT_SCOPES = ["global", "local", "others"]` (`dist/module/lib/types.d.ts:1647`), and `signOut` sends it as `POST /logout?scope=others` with the requesting token (`dist/module/GoTrueAdminApi.js:59-68`).
Scope: the deletion request only. Doc 01 §17A.1 (`:820`, `:847-849`) and CR-01-39 (`:2355`) prescribe the same nonexistent call for privileged role elevation; this entry does not rule on them. The fix there cannot be the same call, because the elevation is not initiated by the user whose sessions must end, so no token of theirs is to hand. It needs its own ruling.
Rationale: the owner's. Revoke-by-token is the mechanism the platform provides; banning would close the recovery path §40.4 requires.
Owner action: none beyond merging the build artifact. PROPOSED until live (SCL-159). Production proof: a fresh free test account requests deletion from two browsers; the second browser's refresh then fails, and (as amended 2026-10-01) the requesting browser stays signed in on the pending-deletion screen.
Build artifact: `server/routes/account-deletion-routes.ts` (`revokeSessionsAtDeletionRequest`); test `tests/ci/account-deletion-session-revoke.test.ts`; register F-32 (`docs/plans/student-ui/student-ui-vertical.md`).

SCL-191 | 2026-09-30 | POST-EXAM SCORE REPORT AND RENEWAL DECISION: Doc 01 V8 Appendix A.4 `entitlement_runtime_config` gains four keys; `entitlements` gains `payer_profile_id`; a student's self-reported REAL SAT score is stored paired with the projection snapshot that was live on the exam date, and a subscription ends at period end on the payer's word or on a fortnight of silence | PROPOSED
Id: `SCL-191` re-derived at the moment of use, 2026-09-30, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1`: the highest allocated anywhere is `SCL-190` (on `origin/claude/typecheck-runtime-fixes`, which is unmerged — an unmerged claim is still a claim). All 4 open PRs checked — #995 (`claude/student-ui-audit-followups`), #984 (`cleanup` → `main`), #940 (`claude/batch-005-launch-gw211p`), #728 (dependabot) — every head branch lives in this repository and is therefore covered by the fetch, and none carries an entry above 190. One entry allocated.
Change: owner FEATURE BRIEF "Post-exam score report and renewal decision" (Karl, 2026-09-30) plus eight rulings the same day. The register is the amendment, per SCL-159; no document is edited.
  (1) **Doc 01 V8 Appendix A.4** `entitlement_runtime_config` gains four keys. WAS/IS below.
  (2) **Doc 01 V8 §20–§24 / genesis `entitlements`** gains `payer_profile_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL`. The payer previously existed only in Stripe subscription metadata (`server/lib/stripe/webhook-handler.ts:1334`); Doc 01 §36.4 asks the PAYER "keep or cancel?", so a job that must decide who to email needs it as a fact about our own row.
  (3) **NEW BEHAVIOUR, unspecified anywhere in the locked corpus** — stated so it is not mistaken for an amendment. Nothing in `docs/Spec` specifies a student self-reporting their real College Board score, a projection-versus-actual validation dataset, or a renewal decision point. Doc 04C's "score report" is Lyceon's own MODELLED score for a practice full-length and is a different object; Doc 04's every use of "retake" is about our own practice exams, not the real sitting; Doc 05C §2.1 calibrates the projection against completed full-lengths and says nothing about official scores. **Searched and found absent** (`grep -i` for self-report / actual score / official score / retake / cancel_at_period_end across the corpus), which is the standing answer to "is this specified?": if the shape is unspecified, say so and proceed.
  (4) **contracts/notifications.contract.md** gains two event types (C1.1) and two §2.3 recipient rows. Not a spec change — that file is the contract, not the corpus — recorded here because the CHECK it pins is one.
WAS, verbatim (Doc 01 V8 Appendix A.4, the whole table): the seven rows `entitlement_cache_ttl_seconds` 60, `entitlement_hard_staleness_seconds` 300, `grace_period_days_past_due` 7, `trial_period_days` 0, `cancellation_at_period_end_default` `true`, `tier_1_countries` `["US","CA","UK","AU","NZ","IE","SG"]`, `min_age_years` 13.
IS: those seven, plus
  | `score_prompt_offset_days` | 18 | 13 | 45 | Product | Days after `target_exam_date` before the score prompt fires |
  | `score_prompt_max_exam_age_days` | 45 | 18 | 180 | Product | Oldest `target_exam_date` the score prompt fires for; beyond it the student takes the billing-cycle anchor |
  | `renewal_reminder_lead_days` | 21 | 14 | 60 | Product | Days before `current_period_end` the billing-cycle renewal reminder fires |
  | `renewal_no_answer_window_days` | 14 | 3 | 60 | Product | Days of silence after the prompt before `cancel_at_period_end` is set |
WHY 18 AND NOT THE BRIEF'S 15 (owner ruling #2, on the reasoning rather than the number). College Board publishes "approximately 10 business days after test day" for SAT Weekend (satsuite.collegeboard.org/scores/sat), which from a Saturday administration lands on the Friday 13 CALENDAR days later — the 13-day pattern the brief observed, and the reason it is almost always a Friday. 18 is that plus five days, so the score has been in the student's hands over a weekend before we ask. **The June 2027 exception is recorded in the annotation at the owner's instruction** — that administration releases at 16 days, on a MONDAY — so the next reader who sees 18, reads it as "13 plus a buffer" and tightens it knows what they would break. The offset is a config row and not a constant precisely because College Board owns the fact.
WHY THE LEAD MUST EXCEED THE WINDOW, and why that is enforced in code rather than left to an operator. 21 − 14 leaves seven days between the no-answer cancellation and the invoice. Configured the other way round, the cancellation lands AFTER the charge it exists to stop — the exact failure this flow was built to prevent, arrived at through the config table. `getExamRenewalConfig` refuses to run the job on that pair, and refuses again if `score_prompt_max_exam_age_days <= score_prompt_offset_days` (which would give the exam anchor an empty window and drop every student silently to the billing-cycle path).
THE EIGHT RULINGS, each with where it lands:
  #1 **Billing-cycle fallback.** Half of entitled students have no `target_exam_date` (owner's production report, 2026-09-29: 1 of 2 study-profile rows populated, against 4 entitled students). They take a renewal reminder anchored on `current_period_end` and NO score prompt. `exam_score_renewal_candidates`' second UNION arm. **Nobody is exempt:** an exam date older than the age bound falls to the same arm, so the only students outside the population are those with a live sitting still ahead of them, and that expires by itself.
  #2 Offset 18, config not constant, June 2027 recorded. Above, and in `entitlement-runtime-config.ts`'s annotation.
  #3 **No-answer window 14 days.** "Silence cannot mean renew forever, because that is the case this exists to prevent."
  #4 **Last write wins, both versions retained.** `exam_score_reports` and `exam_renewal_decisions` are append-only with no UNIQUE on (student, occasion); the read orders by `reported_at`/`decided_at` DESC and takes one. A dataset in which a row can be silently rewritten is a dataset nobody can audit.
  #5 **Consume the existing job shape** — `calendar_job_runs` gains `job = 'exam_score_renewal'` and four outcomes, and the candidates/emitter/per-row-outcome/cron-route pattern is `exam-notify-job.ts`'s line for line. **Timezone in the predicate**, following `calendar_exam_notification_candidates`' own `(p_now AT TIME ZONE cp.timezone)::date`. **Two event types**, because `notification_event_id` hashes the type. **And the caution stands:** `full_length` blocks are practice tests in a study plan, so `calendar_full_length_complete` is deliberately NOT consulted — whether a student finished a practice test says nothing about whether they sat the SAT. Pattern taken, predicate not.
  #6 **Cancellation writes to Stripe, never to our column.** `server/lib/stripe/renewal-cancellation.ts` is the one writer and it calls `subscriptions.update({cancel_at_period_end})`; `entitlements.cancel_at_period_end` keeps its single writer at `webhook-handler.ts:726`. SCL-047's country-egress path is the precedent. The test asserts BOTH — the exact Stripe call, and that our column is still false until the webhook mirrors it.
  #7 **Projection snapshots store the id and the timestamp**, and "no projection" is explicit. `exam_score_report_projections` carries `snapshot_id` and `snapshot_at` beside the values, with `projection_status ∈ {snapshot, gated, none}` — THREE values because "no projection" has two causes: no snapshot existed at all (`none`), or one existed and Doc 05C §5.3's whole-student 8-domain gate was holding the projection NULL (`gated`). A consumer that cannot tell them apart averages both as a zero.
  #8 Branch `cleanup`, per the routing table (billing / entitlement).
THE EIGHT EDGE CASES, each with the behaviour decided and where it is annotated (owner: "Everything in §6 of the brief is yours to decide and annotate"):
  1. No `target_exam_date` → the billing-cycle anchor (#1).
  2. An old exam date → bounded by `score_prompt_max_exam_age_days`, and the student falls through to the billing-cycle anchor rather than out of the population.
  3. Already cancelled → `entitlement_active` is false → `skipped_no_entitlement`, recorded not filtered.
  4. **Guardian-paid — who receives the email.** The brief's own framing is the answer: the student reports the score, the payer decides renewal. So the score prompt always goes to the student, and `renewal_decision_requested` goes to the payer ONLY when the payer is somebody else — a self-paid student gets one email, not two on the same morning. The guardian gets **no new write route**: Doc 01 §928 already gives them the Customer Portal, and a second cancellation path over a student's occasion would fork it. The student's own answer still counts for what it is evidence of — "retaking" is a fact about studying and blocks the cancellation whoever says it; "not retaking" from somebody who is not the payer cannot spend their money, and is recorded with `action: 'none'` while the payer's silence decides.
  5. Reports twice → last write wins, both retained (#4).
  6. Sets a new exam date without answering → treated as retaking. A FUTURE `target_exam_date` is the answer, read at sweep time as a predicate rather than caught by a trigger, and recorded as `skipped_new_exam_date`.
  7. Implausible score → refused in Zod (400 with a readable message) AND by four column CHECKs, including `total_score = rw_score + math_score`. Both, because the schema is what makes a bad body a 400 and the CHECK is what makes a bad row unrepresentable whatever the caller is — and the CHECK is the one a future backfill script will meet.
  8. `cancel_at_period_end` already set → `skipped_cancel_pending`, and `setCancelAtPeriodEnd` reads Stripe before writing so a second pass is a no-op rather than a second webhook per student per day.
ANTI-LEAK, verified in the same change rather than asserted (CLAUDE.md's chokepoint rule): no reported score, amount or price reaches a notification payload — `postExamNoticePayloadSchema` is `.strict()` over `{anchor, occasion_key}` and the emitter builds exactly that object. `/api/score-report` serves the caller's OWN report only, keyed on the session id, and the three new tables are RLS-enabled with no policy for `anon` or `authenticated` (service role only, the `notification_events` posture). No score is logged: `score_report_recorded` carries the anchor and nothing else.
DELETION: all three new tables reference `profiles` with `ON DELETE CASCADE`, and `entitlements.payer_profile_id` with `ON DELETE SET NULL` (another identity's attribution, the `guardian_links.accepted_by_profile_id` precedent). `scripts/ci/fk-delete-action-guard.sql` enumerates from `pg_constraint`, so all four edges are in scope and pass without an allowlist change and without touching `execute_account_deletion_cascade`'s body.
Rationale: the owner's, and the second purpose is the one that compounds — "we collect paired projection-versus-actual scores, the validation Doc 04B's formula has never had against real students."
Owner action: apply `supabase/migrations/20261015000000_exam_score_renewal_decision.sql`, and confirm the Vercel cron at `30 6 * * *` is registered. This entry is PROPOSED until the change is live, because authorisation is not application (SCL-159), and because this session does not read production: the deployment state of anything named here is unverified from here.
Build artifact: `supabase/migrations/20261015000000_exam_score_renewal_decision.sql`; `packages/shared/src/exam-score-renewal-schema.ts`; `packages/shared/src/notifications-schema.ts` (two event types, `postExamNoticePayloadSchema`); `server/lib/entitlement-runtime-config.ts` (`getExamRenewalConfig`); `server/lib/stripe/renewal-cancellation.ts`; `server/lib/stripe/webhook-handler.ts` (both entitlement writers record the payer); `server/lib/account.ts`; `server/lib/notifications/templates/post-exam.ts` + `index.ts`; `server/services/exam-score-renewal/job.ts` and `service.ts`; `server/routes/score-report-routes.ts`; `server/routes/internal-cron-routes.ts`; `server/index.ts`; `client/src/pages/score-report.tsx`; `client/src/App.tsx`; `vercel.json`; `contracts/notifications.contract.md`; `docs/route-registry.md`; `scripts/ci/genesis-schema.expected.sql` (regenerated). Tests: `tests/ci/exam-score-renewal.contract.test.ts` — 18 cases against a real Postgres with the real migration pipeline, registered by file in `.github/workflows/ci.yml` because the `ci` job sets no `PGHOST`. Nine mutations planted and each observed reddening its own case, each confirmed by line number on a unique anchor.
Status 2026-09-30 (owner, production-verified): PROPOSED -> APPLIED. Live on build `dpl_4jB6vv9DiuVNSAtEsS9kXs7YiCwH` (#994): the guardian exam report at `/students/3f18cbe2…/tests/7a79cc5f…` returned 200 and shows per-domain bars with no counts; the guardian envelope is parsed strictly, so a 200 means no `correct` or `total` key was sent. Row G3-02 is CLOSED on this proof.

SCL-195 | 2026-10-01 | STUDENT BACKGROUND AND SCHOOL REFERENCE DATA: Doc 01 §4 and the Privacy Policy §5 gain four optional, student-supplied fields (graduation year, GPA band, high school, up to three ordered dream colleges), held outside `profiles`, plus two federal reference lists the school fields point at; none is shown to a guardian or used in any calculation | PROPOSED
Id: `SCL-195` derived at the moment of use, 2026-10-01, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1`: the highest allocated anywhere is `SCL-194` (on `origin/claude/guardian-wave-4-final`, unmerged — an unmerged claim is still a claim). Re-derived at commit time, same day: still `SCL-194`. Open PRs checked then: a question-bank batch PR (head `claude/batch-005-launch-gw211p`, no new register entry) and a Dependabot PR (no register change); every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Change: owner Brief 8, rulings 1 and 3 (Karl, 2026-10-01). The register is the amendment, per SCL-159; no document is edited.
  (1) **NEW DATA CATEGORIES, unspecified anywhere in the locked corpus** — stated so it is not mistaken for an amendment of something that exists. Doc 01 §4 (`profiles`, target-state) and Appendix B.1 list no graduation year, GPA, high school or college preference, and the Privacy Policy §5 "Account Information" row lists "name or username; email address; account type; stated age or grade level; target exam date". This entry adds them as SPECIFIED behaviour:
      `student_background (student_id PK → profiles ON DELETE CASCADE, graduation_year smallint NULL, gpa_range text NULL ∈ {lt_2_0, 2_0_2_49, 2_5_2_99, 3_0_3_49, 3_5_3_79, 3_8_4_0, gt_4_0}, high_school_id → ref_high_schools NULL)` and `student_dream_schools (student_id → profiles ON DELETE CASCADE, position 1..3, college_id → ref_colleges; UNIQUE (student_id, college_id))`.
      Every field optional and clearable. `graduation_year` runs from the current year to the current year + 6. "My school isn't listed" stores NOTHING: there is no free-text field.
  (2) **NOT ON `profiles`.** Ruling 1: `profiles` is Doc 01's table. Doc 01 §1/§3's "canonical identity on profiles, one canonical writer" is unchanged: these tables are not identity, and their one writer is `save_student_background`.
  (3) **REFERENCE DATA.** `ref_colleges`: U.S. Department of Education College Scorecard, keyed by IPEDS UNITID; currently operating (`CURROPER = 1`), four-year (`ICLEVEL = 1`), degree-granting (`HIGHDEG ∈ {3, 4}`). `ref_high_schools`: NCES Common Core of Data (public; key `nces:<NCESSCH>`; offers grade 12 and operating) plus NCES Private School Universe Survey (private; key `pss:<PPIN>`; highest grade 12). Loaded only from a committed snapshot whose manifest records source URL, vintage, filter rules and SHA-256 of every file; the import never deletes a row, it retires it.
  (4) **PURPOSE AND LIMITS, as spec text.** Dream schools are shown on the student's own calendar as motivation only and have NO effect on target score, projection, mastery, selection or any other calculation. None of the four fields appears on any guardian surface (Doc 05B §10's guardian projections are unchanged, and no guardian route reads these tables). Background fields are never sold, shared or used for advertising, and are analysed only in aggregate with a minimum group size of 10.
WAS (Doc 01 §4 / Appendix B.1): no such fields. WAS (Privacy Policy §5, Account Information, Examples): "Name or username; email address; account type (Student or Guardian); stated age or grade level; target exam date".
IS: as (1)–(4). The Privacy Policy wording is NOT written here: it is legal text, routed to the owner and counsel as a PRE-LAUNCH condition — the policy must list these categories and their purposes BEFORE any UI collects them (register row UI-S8, `docs/plans/student-ui/student-ui-vertical.md`). No UI collects them in the change that builds this.
NOT DONE, stated so it is not assumed: pg_trgm. The ruling asked whether it is available and to report before adding any extension. No migration enables it and production's extension list is not readable from here; the search uses none (case-insensitive substring, prefix-first, capped at 20, ~40 ms over the full high-school list on a local Postgres 16).
Rationale: the owner's. A student's graduation year and target colleges are the context a study plan is for; collecting them as structured, optional, federal-list references keeps them minimal (Doc 00 §6) and keeps free text — the usual home of accidental PII — out entirely.
Owner action: apply `supabase/migrations/20261016000000_settings_background_reference.sql`; then run `SUPABASE_DB_URL=… pnpm exec tsx scripts/reference-data/import-reference-data.ts` once (it verifies every snapshot hash first and is idempotent); and close UI-S8 before any Settings UI collects these fields. PROPOSED until live (SCL-159); this session does not read production.
Build artifact: `supabase/migrations/20261016000000_settings_background_reference.sql`; `packages/shared/src/student-background-schema.ts`; `server/services/student-background.ts`; `server/routes/student-background-routes.ts`; `content/reference/{colleges.csv, high_schools.csv, manifest.json}`; `scripts/reference-data/{build-reference-snapshot.py, import-reference-data.ts}`; tests `tests/ci/student-background.pg.ci.test.ts`, `tests/ci/reference-snapshot.ci.test.ts`; register rows UI-S1 to UI-S9.
SCL-192 | 2026-09-30 | Amends SCL-180 and SCL-189 (and SCL-181's guardian exam list): each item of the guardian exam list, `GET /api/students/:studentId/tests`, carries `completed_at` — the latest attempt's completion instant, null when it never completed. The student's own forms listing is unchanged | APPLIED
Id: `SCL-192` derived at the moment of use, 2026-09-30, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 71 remote refs: highest allocated anywhere is `SCL-191`. Open PRs checked, all six (#1001, #1000, #999, #984, #940, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: 2026-09-30 on #998 — "Add `completed_at` to each guardian exam list item … The Dashboard's latest test is the newest `completed_at`." Plan rows G4-03 and G4-05.
WAS (SCL-181, the guardian list item): `{session_id, test_form_id, test_form_name, mode, attempt_number_for_form, report_state}`, `.strict()`, one row per form the student has sat, in form order.
IS: the same six fields plus `completed_at: string | null`, required-present, `.strict()`. The guardian Dashboard's "latest full-length test" is the item with the newest non-null `completed_at`.
Why it was needed: the list carried no date and is in form order, so "latest" could not be derived from it (#998 establish item 1(e)); the alternative, one report fetch per form, costs a request per form.
No migration and no student payload change: `exam_list_forms` (last defined in `supabase/migrations/20260930090000_exam_shell_server.sql`) has always emitted `latest_session.completed_at`; the server's row schema dropped it. `listExamFormsWithCompletion` now keeps it, keyed by session id, and only the guardian list reads it. SCL-180's and SCL-189's exclusions are unaffected: a completion instant is part of the headline the guardian already sees on the report (`completed_at`).
Owner action: none beyond merging. PROPOSED until live (SCL-159).
Build artifact: `server/services/exam-runtime-service.ts` (`listExamFormsWithCompletion`); `packages/shared/src/exam-guardian-report-schema.ts` (`guardianExamListItemSchema.completed_at`, `toGuardianExamList(forms, completedAt)`); `server/routes/student-resources.ts`. Tests: `tests/ci/guardian-exam-results.handler-pg.ci.test.ts` (real route over real Postgres: every item carries the key on the raw body, and the scored item's instant equals its report's); `client/src/features/exam/guardian-domain-bars.test.ts` (strict: an item without `completed_at` fails). Both red without the change.
Status 2026-10-01 (owner, production-verified): PROPOSED -> APPLIED. Live on build `dpl_9RQ6uRfNpmpFL9uv1Js2XNVDJmjQ` (#1003 merge `4cbc6fa`, carried by #1013 merge `3c0de2a`): Karl's click-through on the preview and production, 2026-10-01 — "everything passes" — includes the guardian exam list and the Dashboard's latest test, which reads `completed_at`. Rows G4-03 and G4-05 are CLOSED on this proof.
SCL-193 | 2026-10-01 | Amends SCL-188 (Doc 05B §10, the guardian's `kpi/overall`): `currentStreakDays` is `number | null`. `null` means the streak is unknown — the student's zone could not be read, so "as of today" (G-NEW-16) could not be worked out. Every streak surface (the calendar's `streak.current`, `/api/me/streak`, both audiences of `kpi/overall`) answers that case the same way: 200 with a null streak, never a 500 | APPLIED
Id: `SCL-193` derived at the moment of use, 2026-10-01, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 72 remote refs: highest allocated anywhere is `SCL-192`. Open PRs checked, all six (#1003, #1000, #999, #984, #940, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner decision recorded: 2026-10-01 on #1003 — "Streak when the timezone can't be read: both the calendar and `kpi/overall` return the streak as unknown (`null`), never a 500. Test both." Plan row G-NEW-16.
WAS (SCL-188, the guardian body): `{ currentStreakDays }`, a non-negative integer, `.strict()`. A failed zone read inside `currentStreakAsOfToday` threw, and both `kpi/overall` audiences answered 500; the calendar caught it and served `null`.
IS: `{ currentStreakDays: number | null }`, `.strict()`. `currentStreakAsOfToday` catches the zone read itself, logs `ACTIVITY_STREAK timezone_read_failed` (error class only, no student content), and returns `null`; the student's `current_streak` metric carries `value: null` (its schema was already `number | null`) with its own "can't be shown right now" guidance. A failed read of `student_overall_kpi` itself still throws on `kpi/overall` — that is the resource, not the decoration — exactly as before.
Why `null` and not `0`: a zero asserts "no study days in a row", which nothing established; `null` is the "unknown" the calendar already used, and the client renders no streak for it.
Owner action: none beyond merging; no migration. PROPOSED until live (SCL-159).
Build artifact: `server/services/activity-streak.ts` (`currentStreakAsOfToday` fails open; `getStudentActivityStreak` reads its `null`); `server/services/canonical-runtime-views.ts` (`buildStudentMetrics`, `guidanceForMetric`); `packages/shared/src/student-resources.ts` (`guardianKpiOverallSchema`). Tests: `tests/ci/student-resources.contract.test.ts` (G-NEW-16 block: with the `student_study_profile.timezone` read failing, the guardian `kpi/overall`, the student `kpi/overall` and the calendar all answer 200 and a null streak, each body through its shared schema; presence first. Red before the change: `[500, 500, 200]`).
Status 2026-10-01 (owner, production-verified): PROPOSED -> APPLIED. Live on build `dpl_9RQ6uRfNpmpFL9uv1Js2XNVDJmjQ` (#1003 merge `4cbc6fa`, row commit `eb07c14`): Karl's click-through, 2026-10-01 — "everything passes"; on the new build the student KPI reads answered 200 with no 4xx or 5xx (owner, 2026-10-01). Row G-NEW-16 is CLOSED on this proof.
SCL-194 | 2026-10-01 | Amends Doc 05B §10.4 (and the §10.3 route list's "guardian queries return 0 rows" note on `mastery/skills`) and SCL-188: guardians see no skills, anywhere. `GET /api/students/:studentId/mastery/skills`, and every skill-level read, answers a guardian session 403 with a logged code, decided by role before the subject resolver reads anything; it no longer answers 200 with `[]`. The student's own skill read is unchanged | APPLIED
Id: `SCL-194` derived at the moment of use, 2026-10-01, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 78 remote refs: highest allocated anywhere is `SCL-193`. Open PRs checked, all three (#1015, #1013, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: 2026-10-01 on #1013 (review, item 2) — "Guardians see no skills, anywhere … The server refuses guardian callers on every skill-level read, returning 403 with a logged code … SCL: if the locked spec currently allows guardian skill reads, carry one SCL at max+1." It does: §10.4 mandates "HTTP 200 with `[]`, not 403" for a linked, entitled guardian.
WAS (§10.4): "a guardian calling `GET /api/students/{student_id}/mastery/skills` receives HTTP 200 with `[]`, not 403", after path-layer authorization and the entitlement gate; §10.3 lists the route as "guardian queries return 0 rows". SCL-188: "No other route gains a role-aware projection."
IS: a guardian calling any skill-level read receives HTTP 403, refused by the platform's student-only gate (`requireStudentOrAdmin`, which logs `AUTH guardian_blocked`), ahead of the subject resolver. On `mastery/skills` the gate runs BEFORE path-layer authorization, so a guardian gets the same 403 for a linked, an unlinked and an unentitled student. This is a role refusal, not a role-aware projection, so SCL-188's sentence stands for projections and gains this one exception for refusal. A student (and an admin) is served exactly as before.
Also amends, resolving the open disagreement DIS-02 (`docs/plans/guardian-audit.md`) in the direction Doc 05 §15.2/AC#19, 05A and 05B already took: Doc 01 §38.1 :1805 "Skill-level mastery (yes)" reads "(no)", and §38.3 :1821's `student_skill_mastery` row is domain-level only for a guardian. NOT amended here, and surfaced to the owner instead: the Privacy Policy §6.2 :362 still tells families guardians see "skill-level … mastery indicators". That is legal text, so its wording is the owner's (and counsel's) to change; until it is, it over-states what a guardian sees, never under-states it.
Why §10.4's leak argument does not reopen: §10.4 rejected 403 because it "would imply the resource exists but is forbidden — leaking that skill mastery rows exist for that student". The new 403 is decided from the caller's role alone, before any read of the link, the entitlement or the rows, so it is identical for every student and every state of their data — it carries no information about any of them. The §10.3 enumeration rule (404 for an unrelated caller) is not weakened: an unlinked guardian learns nothing it did not know, since the answer is the same 403 for every studentId.
Surfaces established at three levels (UI, client calls, server) before the change: the only guardian-reachable skill read was this route (200 `[]`); every other skill-level route (`/api/practice/diagnostic/sessions/:sessionId/weakest-skills`, the practice, review, tests, progress, calendar, `/api/me` and tutor mounts) was already 403 behind `requireStudentOrAdmin`/`requireStudentOnly`; no guardian page requested skills (`dashboard.endpoint-map.test.tsx`) or rendered a skill name, link or drill-down. One guardian-facing string promised skill data — the guardian-link invite email ("skill-level mastery") — and is corrected in the same change.
Owner action: none beyond merging; no migration. PROPOSED until live (SCL-159).
Build artifact: `server/routes/student-resources.ts` (the skills route: `requireStudentOrAdmin` ahead of `resolveSubject`; the `via === 'guardian'` empty-list branch deleted); `client/src/components/mastery/DomainGrid.tsx` (required `viewer`; `viewer="guardian"` draws no Skills control whatever it is handed); `client/src/pages/mastery.tsx`, `client/src/features/guardian/GuardianDashboardTab.tsx` (callers); `server/lib/notifications/templates/guardian-link-invite.ts` (copy); `packages/shared/src/student-resources.ts` (header). `docs/route-registry.md` and `docs/entitlements-map.md` already list the route as student/admin, which is now true, and are unchanged. Tests: `tests/ci/student-resources.contract.test.ts` (a guardian gets 403 with `guardian_blocked` logged once, for linked, unlinked and unentitled students, and the resolver never runs; the student still gets their rows; red before the change: 200, 404, 402); `tests/ci/guardian-denial-sweep.pg.ci.test.ts` (G1-11: every route whose path names a skill must carry a student gate, whatever prefix it lives under, and a guardian session gets 403 on each; red before: the skills route was ungated under `/api/students/` and answered 404); `client/src/features/guardian/no-skills.test.tsx` (a guardian render of the Dashboard, the exam list and the exam detail contains none of the question bank's 29 skill names, no skill link or control, and makes no skills request, with any skills request answered by a full skill list as bait; the UI was already clean, so its failure was shown by three plants, each red: a drill-down handed to the guardian grid, a skills fetch from the Dashboard, a skill name on the exam detail); `client/src/components/mastery/DomainGrid.test.tsx` (`viewer="guardian"` handed a drill-down renders none; red before).
Status 2026-10-01 (owner, production-verified, student half): PROPOSED -> APPLIED. Live on build `dpl_9RQ6uRfNpmpFL9uv1Js2XNVDJmjQ` (#1013 merge `3c0de2a`, commit `59e65c8`). The student half is observed: `GET /api/students/3f18cbe2…/mastery/skills` returned 200 (4,524 bytes) for the student at 09:43:36Z (request `739463dc`). The guardian half (403) is proved by `tests/ci/student-resources.contract.test.ts` and the G1-11 sweep (green in CI run 36845087793); its production observation is the owner's own check, and row G-NEW-18 stays IN PROGRESS until it is pasted.
Status 2026-10-02 (owner, production-verified, guardian half): the guardian 403 is observed on build `dpl_54CM3iC8xRkL46L5QWJ59aqFBqem`: at 00:43:08Z a guardian session's `GET /api/students/3f18cbe2…/mastery/skills` answered 403 (148 bytes), request `da74befa`, logged `AUTH guardian_blocked`. Both halves are now observed in production; row G-NEW-18 is CLOSED.
SCL-196 | 2026-10-01 | Amends Doc 05B §2.4 (enforcement line) and §11.1 (policy list), and Doc 05C §7.4 (read policies) and §11.1 ("must exist" list): the six KPI / mastery / projection tables — `student_overall_kpi`, `student_section_kpi`, `student_domain_kpi`, `student_domain_mastery`, `student_section_projections`, `student_section_projection_snapshots` — carry NO read policy. RLS stays enabled, so `anon` and `authenticated` read zero rows (denial by absence). Every read is the service role's, and guardian visibility is enforced in the route layer. The boolean gate forms `guardian_can_view_student(uuid)` / `guardian_can_view_student_as(uuid,uuid)` are dropped with them | PROPOSED
Id: `SCL-196` derived at the moment of use, 2026-10-01, after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across all 81 remote refs: highest allocated anywhere is `SCL-195`. Open PRs checked, all four (#1021, #1020, #1016, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: G-NEW-15 (owner, production catalog, 2026-09-30, #994 review), approved for the guardian closeout (owner brief 2026-10-01, Part B category F: "the dead `*_guardian_read` and `*_student_read` policies on the six KPI, mastery and projection tables (G-NEW-15, approved)").
WAS (Doc 05B §2.4): "every 05B-owned guardian-accessible table has an explicit `*_guardian_read` RLS policy gated on `(active link, active entitlement)` per Parent §11.1"; §11.1 lists `student_domain_mastery_student_read` / `_guardian_read`, `student_section_kpi_*`, `student_domain_kpi_*` and `student_overall_kpi_*` as things that MUST be verified. Doc 05C §7.4 defines `student_section_projections_{student,guardian}_read` and `projection_snapshots_{student,guardian}_read`; §11.1: "Must exist" for all four.
IS: none of those twelve policies exists. With RLS enabled and no read policy, a direct `anon` / `authenticated` read of any of the six tables returns zero rows. Reads go through the service role in `apps/api` and `server/`. The guardian half of Parent §11.1's condition (active link AND active entitlement) is enforced once, by `guardian_view_decision` through `resolveSubject` and the route-table entitlement gate. SCL-188 / SCL-189 / SCL-194 shape what a guardian then sees. `student_skill_kpi_student_read` and `student_skill_mastery_student_read` are not touched (handed off to `cleanup`, same class).
Why: the policies read as a live access path and are not the one the app uses. More than that: the migration pipeline grants `authenticated` COLUMN-level SELECT on all six tables (a table-level grant query does not show it). Where those grants exist, the guardian policies are LIVE: a guardian's JWT could read a linked, entitled student's KPI counters straight through PostgREST, around SCL-188's projection. The rewritten guardian-mirror gate was red on exactly that before the migration: a guardian directly read 1 domain-mastery row of a linked student (`1|0|0`). Production, per G-NEW-15, grants no SELECT; whether column-level grants exist there is for the owner's verify query.
Owner action: apply `supabase/migrations/20261017000000_guardian_closeout_dead_rls_and_consent_column.sql`, then run the read-only verify in the guardian closeout PR. PROPOSED until live (SCL-159).
Build artifact: the migration (12 `DROP POLICY`, 2 `DROP FUNCTION`, `profiles.consent_given_at` dropped, `guardian_view_decision`'s catalog comment corrected); `scripts/ci/genesis-schema.expected.sql` (regenerated; the diff is exactly those objects). Gates:
- `scripts/ci/guardian-view-decision-gate.sql`: GATE 0 pins `guardian_view_decision` only; GATE 9 asserts the boolean forms are gone (red without the migration); GATE 11 asserts no policy consults a guardian gate; GATE 12 asserts RLS on and no read policy on the six tables; GATE 13 asserts the two-argument form is service-role only. Mutations M1/M2 still red.
- `scripts/ci/guardian-mirror-gates.sh`, rewritten: a guardian linked to an entitled student, an unlinked guardian, and the student themselves each read zero rows directly. It checks presence first: 3 seeded rows. Red before: `1|0|0`.
- `scripts/ci/05b-domain-kpi-gates.sh` / `05c-projection-gates.sh`: `0|0` policies.
- `tests/ci/guardian-revoke-party.pg.ci.test.ts`: the four remaining guardian functions read f/f/f/t.
- `scripts/ci/subject-resolver-chokepoint-gate.mjs`: the `_as` call tell is removed.
Status 2026-10-02 (owner, production-verified): PROPOSED -> APPLIED. Migration `20261017000000` applied in production and verified read-only (owner report, 2026-10-02): the twelve policies are gone from `pg_policies`, `guardian_can_view_student` and `guardian_can_view_student_as` are gone and nothing references them, `profiles.consent_given_at` is gone, RLS is still enabled on the six tables, and there has been no 5xx since. Row G-NEW-15 is CLOSED. The column grants this entry's Why names are revoked by SCL-198.
SCL-197 | 2026-10-02 | Amends Doc 01 §12.1 step 2 and Doc 01A §44 for the password-reset throttle only: the `password_reset_requests_hourly` bucket counts against the PROFILE that owns the normalised address, not the address; an address with no account is not counted; and an over-limit request answers the same 200 as any other, with no 429 and no `Retry-After`, every outcome held to a minimum response time | APPLIED
Id: `SCL-197` derived at the moment of use, 2026-10-02, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across 84 remote refs: the highest allocated anywhere is `SCL-196` (on the open guardian closeout branch, unmerged; an unmerged claim is still a claim). Open PRs checked: the guardian closeout PR (carries SCL-196), a question-bank batch PR (no new register entry) and a Dependabot PR (no register change); every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: Brief 12 ruling 1 (Karl, 2026-10-02): "The reset-request throttle moves to RateLimitLedger, keyed per normalized email, per Doc 01 §12.1. The response is identical whether or not the email exists." This entry records how that was met where the two locked documents cannot both be read literally, for the owner to ratify or overrule.
WAS (Doc 01 §12.1 step 2): "Rate-limited via `RateLimitLedger` bucket `password_reset:{email}` (default: 3/hour)"; Doc 01 Appendix: `password_reset_rate_per_hour`, "Per-email password reset requests per hour". WAS (Doc 01A §41): the ledger is `rate_limit_ledger (profile_id UUID NOT NULL REFERENCES profiles(id) …, PRIMARY KEY (profile_id, bucket_key, window_start))`. WAS (Doc 01A §44 / §47): a denial is a 429 with `Retry-After`, and a 429 without it is a blocking condition.
IS:
  (1) **Keyed by the account behind the address.** `password_reset_subject(email)` (service_role only) finds the profile whose `lower(email)` equals the trimmed, lower-cased address, live before soft-deleted, and the bucket `password_reset_requests_hourly` (Doc 01A §39.2 / §46's name; 3 per 3600 s) counts against that profile. Every address a reset can reach belongs to a profile, so this is "per email" for every address that can receive a reset, and it needs no change to §41's table.
  (2) **An address with no account is not counted.** §41's ledger cannot hold a row for it. Nothing is mailed to such an address (Supabase sends no recovery email without an account), so leaving it uncounted lets no email through; what it does allow is unbounded lookups for unknown addresses, since the in-memory per-IP limiter on this route is removed with this change (it counted per server instance and so held nothing on serverless). Supabase's project-level auth email rate limit is unaffected.
  (3) **No 429 on this route.** An over-limit request sends nothing and answers exactly as an allowed or unknown one: the same 200 body, no `Retry-After`. A 429 or `Retry-After` that only an existing account can earn is an account-existence oracle, which AS3-AS5-RESET-ENUM-001 forbids; anti-enumeration takes precedence over §44's shape on this one route.
  (4) **A minimum response time.** Only a sending request reaches the provider, so a suppressed one would answer faster. Every outcome is held until 2,000 ms after the handler began (`PASSWORD_RESET_RESPONSE_FLOOR_MS`). Residual, stated: a provider round trip slower than the floor still finishes later than a suppressed request, so the channel is narrowed, not closed. Unknown and known addresses already differed in provider timing before this change.
Rationale: (1) and (2) are what §41 permits; (3) and (4) are what the ruling's "identical response" requires.
Owner action: ratify or overrule (1)–(4); apply `supabase/migrations/20261018000000_password_reset_ledger.sql`. PROPOSED until live (SCL-159). This session does not write production.
Build artifact: `supabase/migrations/20261018000000_password_reset_ledger.sql`; `server/lib/password-credentials.ts` (`decidePasswordResetSend`, `holdPasswordResetResponse`); `server/routes/supabase-auth-routes.ts` (`/reset-password`); test `tests/ci/password-reset-sessions.pg.ci.test.ts`; register row F-46.

Status 2026-10-02 (owner ruling, Karl): RATIFIED, (1)-(4) as written; PROPOSED -> APPLIED on the owner's instruction. Live state at that date: the migration `20261018000000_password_reset_ledger.sql` is applied to production (owner's report, 2026-10-02; `password_reset_subject` and the `password_reset_requests_hourly` bucket read present from the production catalog the same day). The route code (`decidePasswordResetSend`, the 2 s floor, the post-recovery revoke) is on `cleanup` and NOT yet on `main`: production build `dpl_Ep6hNCPrMX4iuUNV2KQtuAQLmrM6` (`main` @ `59997248`) does not contain it. It goes live with the next `cleanup` → `main` merge.
SCL-198 | 2026-10-02 | Amends Doc 05A §2.4 (item 1 and its defence-in-depth note), INV-05A-12, §7.3, §7.4, §10.1, §10.3 (step 4) and §13 (acceptance 8 and 9); Doc 05B §3.2 (its INV-05A-12 row), §5.4, §6.6, §6.7, §10 (the read-path comments) and §10.5, §15 (acceptance 4), and its §2.4 / §11.1 as SCL-196 left them; Doc 05C §7.5, §10.5 and §15 (acceptance 13), and its §7.4 / §11.1 as SCL-196 left them: `authenticated` (and `anon`) hold NO SELECT on the eight KPI / mastery / projection tables — `student_overall_kpi`, `student_section_kpi`, `student_domain_kpi`, `student_domain_mastery`, `student_section_projections`, `student_section_projection_snapshots`, `student_skill_kpi`, `student_skill_mastery` — and `student_skill_kpi_student_read` / `student_skill_mastery_student_read` are dropped. A direct read is refused (no grant), not filtered to zero rows (no policy). RLS stays enabled; every read is the service role's | PROPOSED
Id: `SCL-198` derived at the moment of use, 2026-10-02, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1`: the highest allocated anywhere is `SCL-197` (on `origin/claude/f46-f48` only, unmerged, open PR #1029 — an unmerged claim is still a claim). Open PRs checked, all three (#1029, #1016, #728): every head branch is in this repository and therefore covered by the fetch, and none carries an entry above 197. One entry allocated.
Owner ruling recorded: owner brief 2026-10-02 ("Guardian vertical: last PR", item 2: "Revoke the dead column grants … REVOKE the column-level SELECT from `authenticated` on [the eight tables]; drop `student_skill_kpi_student_read` and `student_skill_mastery_student_read`"), closing the closure plan's handed-off rows inventory F6 and "Column grants".
WAS: Doc 05A §7.3 defines `student_skill_mastery_student_read` (students read their own rows) and §7.4 grants `authenticated` SELECT on the safe columns `(student_id, section, domain, skill, mastery_level, computed_at)` as defense-in-depth for INV-05A-12; §2.4 item 1 describes that pair as the row-level enforcement of the exposed-field contract; §10.1 verifies both, §10.3 step 4 installs both, §13 acceptance 8 requires the policy. Doc 05B §6.6 defines `student_skill_kpi_student_read` (and the KPI tables' read policies SCL-196 already removed), §5.4 and §6.7 grant `authenticated` the safe columns of `student_domain_mastery` and the four KPI tables, and §15 acceptance 4 requires those RLS policies and grants. Doc 05C §7.5 grants `authenticated` the guardian-visible columns of the two projection tables. In the pipeline after SCL-196: 70 column grants across the eight tables (11 / 10 / 10 / 5 / 8 / 9 / 11 / 6) and one student read policy on each skill table. The grant is the ingredient that made G-NEW-15's guardian policies live; with it in place, one new read policy reopens a direct PostgREST path around the route layer.
IS: no column of the eight tables is readable by `authenticated` or `anon`; no policy exists on either skill table; RLS is enabled on all eight; `service_role` keeps its grants. A direct `authenticated` read fails with 42501 (permission denied). The column-visibility contracts themselves are unchanged (Doc 05A §7.2, Doc 05B §5.2 / §6.5, Doc 05C §7.3: what a student, and a linked and entitled guardian, may see): they are enforced where every read already happens, the service-role route layer (`resolveSubject` → `guardian_view_decision`, SCL-188 / SCL-189 / SCL-194's projections, INV-05A-12's route projection to `mastery_level`). INV-05A-12's database layer becomes strictly narrower — `authenticated` reads no column, the unsafe ones included — so its guarantee (no `mastery_score` / `mastery_pct` / per-source accuracy readable by `authenticated`) holds a fortiori. Doc 05A §10.1's verification of §7.3 / §7.4 now verifies their absence (GATE 14). The passages that name the grant as a layer — Doc 05A §2.4's "row-level RLS + column-level GRANTs + route-layer projection" and §13 acceptance 9; Doc 05B §3.2's INV-05A-12 row, §10's "guarded by … policy + column GRANTs" read-path comments and §10.5 ("Column GRANT on `authenticated` (§5.4) restricts SELECT to `mastery_level`"); Doc 05C §10.5 ("payloads expose only the columns GRANTed to `authenticated` in §7.5") and §15 acceptance 13 — read with the database layer now granting `authenticated` nothing: the exposed-column lists they reference stand as the route projection's lists, and every column they withhold stays withheld.
Why: nothing reads these tables with a user JWT. Established before the change: `git grep` over `client/`, `server/`, `apps/`, `scripts/` finds nineteen `.from(<table>)` reads, every one on `supabaseServer` or `getSupabaseAdmin()` (service role); the client issues no `supabase.from(...)`; the anon-key clients (`scripts/probe/*`, `server/routes/supabase-auth-routes.ts`, `server/lib/password-credentials.ts`) never name these tables. Catalog (migrated pipeline): no function `authenticated` or `anon` may execute reads them; the one dependent view (`student_diagnostic_states`) is not readable by `authenticated`; no trigger function reads them.
Owner action: apply `supabase/migrations/20261019000000_guardian_final_purge_revoke_kpi_column_grants.sql` (it checks its own post-condition and raises if any grant or skill policy remains), then run the read-only verify in the guardian final-purge PR. PROPOSED until live (SCL-159). Rollback (exact; proven on the migrated pipeline by dump-compare): in the migration's header.
Build artifact: the migration (8 `REVOKE SELECT ON TABLE … FROM authenticated, anon` — a table-level REVOKE also revokes every column-level grant — and 2 `DROP POLICY`); `scripts/ci/genesis-schema.expected.sql` regenerated (504 lines removed, none added: the 70 column grants with their dump headers, and the 2 policies). Gates:
- `scripts/ci/guardian-view-decision-gate.sql` GATE 14: `has_any_column_privilege` is false for `authenticated` and `anon` on all eight; RLS on all eight; zero policies on the two skill tables; presence first — `service_role` still reads all eight. Plants in `guardian-view-decision-gate.mutations.sh`: M3 (re-grant one column after the migration's own check) reds GATE 14 naming `student_skill_kpi`; M4 (re-create a skill-table read policy) reds GATE 14 naming the policy count. M1/M2 still red GATE 0. 9/9.
- `scripts/ci/guardian-mirror-gates.sh`: a direct `authenticated` read, as a guardian linked to an entitled student and as the student themselves, is refused (42501), after a presence check of 3 seeded rows; red without the migration (`0|0|0`). The column-grant check now expects `false|false|false|0` (no column of `student_domain_mastery` readable, `mastery_level` included; no policy on `student_skill_kpi`).

SCL-214 | 2026-10-05 | Amends Doc 05F §17.3, §17.4 and §17.6's student copy: a single full-length sitting is named a "full-length test" everywhere a student reads it (owner ruling OQ-62 (b)). Copy only; no behaviour, key, route or data change | PROPOSED
Id: `SCL-214` allocated 2026-10-05 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest anywhere `SCL-213` (on `claude/cleanup-main-sync-1069`, `claude/seo-wave1c-analytics` and `main`). Open PRs checked (#1069, #1048, #728): all three are in-repo branches covered by the scan; none claims above `SCL-213`.
Change (owner ruling, Karl, 2026-10-05, student-UI register §9 OQ-62 (b), verbatim): "\"full-length test\" wording, with grep proof." OQ-62 (b) listed the student strings that still named a sitting "practice test", "test" or "full-length" after the "Tests" → "Full-Length" label change; the ruling names every such sitting a "full-length test".
WAS (§17.3, verbatim): "study days, time per day, SAT date, target score, practice-test day (weekday or None — independent of study days), timezone, and an **Auto plan** toggle."
WAS (§17.4, verbatim): ""Your plan was refreshed for the week" / "…after your exam" / "…was restored by support"."
WAS (§17.6, rows, verbatim): "| `exam_review` | "Going over what you missed on your last full-length." |", "| `exam_review_placeholder` | "Going over what you missed on your last practice test." |", "| `exam_cadence` | "A full-length every two weeks keeps you test-ready." |", "| `post_exam` | "Your last test pointed here." |".
IS (§17.3): "… target score, full-length test day (weekday or None — independent of study days), …" (the settings and setup controls read "Full-length test day" / "Full-length test frequency").
IS (§17.4): the post-exam banner reads "Your plan was updated after your full-length test." (the other two unchanged).
IS (§17.6): `exam_review` and `exam_review_placeholder` → "Going over what you missed on your last full-length test."; `exam_cadence` → "A full-length test every two weeks keeps you test-ready."; `post_exam` → "Your last full-length test pointed here."
Not changed: every key, trigger and rule in §17.3, §17.4 and §17.6; the section/page label "Full-Length" (owner ruling 2026-10-05); Doc 04C §10.4's example message (`EXAM_REPORT_FAILED_MESSAGE`, kept verbatim as spec copy); guardian copy (the ruling is about students); the database's form names ("Practice Test 1/2/3"), which students still see as row titles (open for Karl).
Rationale: one name for one thing. The student saw "practice test", "test", "exam" and "full-length" for the same sitting across the calendar, the review picker, the report and the notifications; after the label became "Full-Length", the sitting's name follows it.
Owner action: none beyond acceptance of this entry. PROPOSED until Doc 05F §17.3, §17.4 and §17.6 carry the text; the code already follows it.
Build artifact: built on `claude/nav-fulllength-wording` (commits `c0bf18f5`, `b90c47f3`, `16e87b92`), for the student-UI navigation follow-up PR: `client/src/features/calendar/copy/explanations.ts`, `copy/banner.ts`, `copy/exam-cadence.ts`, `components/SetupPopup.tsx`, `components/SettingsSheet.tsx` and the other student strings listed with old → new and grep proof in `docs/plans/student-ui/evidence/wave5/full-length-naming.md` ("2026-10-05: 'full-length test' wording"); tests and 51 plants there.
SCL-212 | 2026-10-05 | Amends Doc 05F §15 (API surface), INV-08-11, INV-08-20, §14 (the `streak` row) and §19 (the Routes row), with formula sheet §8 items 11 and 19: the standalone `GET /api/me/streak` route is retired. No client called it — no student page (SCL-211 removed the student calendar's read; the practice page's streak went with UI-51) and not the guardian calendar, which reads the streak inside its own payload. The streak is still computed exactly as before and served inside both calendar payloads (`streak`) and `kpi/overall` (`currentStreakDays`) | PROPOSED
Id: `SCL-212` allocated 2026-10-05 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref (151 refs): the highest anywhere is `SCL-211` (on `claude/student-ui-followups` and `cleanup`, from #1073). Open PRs checked (all 4 open: #1102, #1069, #1048, #728): every head branch is in this repository and so covered by the fetch; the log lines added in their diffs claim nothing above `SCL-194` (#1102), and #728 does not touch the log. One entry allocated.
Change (owner ruling, Karl, 2026-10-05, student-UI register §9 OQ-61 (a), verbatim): "(a) No student page using /api/me/streak is fine. If the guardian calendar doesn't use it either, add it to the deletion sweep with grep proof." The guardian calendar does not use it (proof: `docs/plans/student-ui/evidence/wave5/deletions.md`, "OQ-61 (a): /api/me/streak"), so the route is deleted.
WAS (§15, the route table row, verbatim): "| GET `/api/me/streak` | student (any tier) | — | `{ current, longest, history_complete }` — **no `calendar_access` check** (INV-08-20) | — |"
WAS (§5, INV-08-11, verbatim): "Every route under `/api/calendar` and the guardian calendar route enforces `calendar_access` server-side. `GET /api/me/streak` is explicitly exempt (R-08-25, INV-08-20). | Denial tests per route; presence test that the streak route has no entitlement check; plant."
WAS (§5, INV-08-20, verbatim): "**Streak independence.** Streak eligibility never depends on calendar launch, block completion, plan adherence, or `calendar_access`. | Streak service reads `student_overall_kpi` only, asserted; `GET /api/me/streak` has no entitlement gate, asserted, with a plant."
WAS (§14, the `streak` row, opening, verbatim): "**Doc 05B owns it.** `GET /api/me/streak` reads `student_overall_kpi.current_streak_days` and `longest_streak_days` and serves them with **no `calendar_access` check** (INV-08-20)."
WAS (§19, the Routes row, verbatim): "Denial per route (free 402, guardian no-link **404**, guardian revoked link **404**, guardian link-but-student-unentitled **402**) and the streak route asserted to have **no** entitlement check."
WAS (formula sheet §8 item 11, verbatim): "Streak is **not calendar-owned**: `/api/me/streak` reads `student_overall_kpi.current_streak_days / longest_streak_days` (Doc 05B). SCL-08-E asks 05B for a student-local day boundary and the rest-day skip; until then the route returns 05B's UTC value with `history_complete: false`."
WAS (formula sheet §8 item 19, last clause, verbatim): "closes G-08-12: `/api/me/streak` returns a real `current` for every student"
IS (§15): the route table has no `GET /api/me/streak` row. The streak travels as the `streak` field (`{ current, longest, history_complete }`) of `GET /api/calendar` (student) and `GET /api/students/:studentId/calendar` (guardian, §16), and as `currentStreakDays` of `GET /api/students/:studentId/kpi/overall` (Doc 05B §10, SCL-188 / SCL-193).
IS (INV-08-11): "Every route under `/api/calendar` and the guardian calendar route enforces `calendar_access` server-side." The exemption sentence and the streak route's presence test fall away with the route.
IS (INV-08-20): "Streak eligibility never depends on calendar launch, block completion, plan adherence, or `calendar_access`." Proving mechanism: the streak service reads `student_overall_kpi` only (unchanged, `server/services/activity-streak.ts`); there is no longer a streak route to assert ungated.
IS (§14, the `streak` row): "**Doc 05B owns it.** The calendar reads `student_overall_kpi.current_streak_days` and `longest_streak_days` through the platform streak service and embeds them in its payload; nothing gates them on `calendar_access` (INV-08-20)." The rest of the row (no calendar-computed streak; SCL-139; `history_complete: false`) stands, with "the route returns" read as "the service returns". (Its last sentence was already amended for the student calendar by SCL-211.)
IS (§19, Routes row): the clause "and the streak route asserted to have **no** entitlement check" falls away.
IS (formula sheet items 11 and 19): read `/api/me/streak` as "the platform streak service (`server/services/activity-streak.ts`)", which every streak surface reads.
Not changed:
  - The streak itself: Doc 05B's definition, `student_overall_kpi`, `streakAsOfToday` (G-NEW-16), the null-on-unknown-zone rule (SCL-193), `history_complete: false` (SCL-139), R-08-09's and R-08-25's "platform-wide, not calendar-owned".
  - `streakSummarySchema` and the `streak` field of both calendar payloads; `kpi/overall`'s `currentStreakDays`; the guardian calendar's and guardian Dashboard's streak line (both read the guardian calendar payload).
  - Every other §15 route and its gate. No database object changes: the route read only `student_overall_kpi`, which the service still reads.
Rationale: SCL-211 removed the last student read; the guardian surfaces read the streak from their own payload. A served, ungated route with no caller is surface to keep secure and tested for nothing, and the ruling puts it in the deletion sweep. `scripts/ci/retired-endpoints-gate.mjs` now refuses the path anywhere in the tree, so a caller cannot come back unnoticed.
Owner action: none beyond acceptance of this entry. PROPOSED until Doc 05F §5 / §14 / §15 / §19 and formula sheet items 11 and 19 are amended on their next revision; the code already follows it.
Owner acceptance (Karl, 2026-10-05): accepted ("SCL-212 accepted"). Status stays PROPOSED until Doc 05F carries the text, per this log's convention.
Build artifact: built on `claude/fu-oq61`, for the student-UI follow-up PR. `server/routes/calendar-routes.ts` (handler and `streakRouter` removed); `server/index.ts` (mount removed); `tests/ci/calendar.routes.contract.test.ts`, `tests/ci/under-13-link-gate.pg.ci.test.ts`, `tests/e2e/{exam,student}-harness/server.ts`, `scripts/ops/calendar-route-smoke.sh`, `docs/route-registry.md` (the route's tests, mounts and listings); `scripts/ci/retired-endpoints-gate.mjs` (new row; per-row `historicalRecords`) and its self-test (cases 6 and 7); `client/src/pages/calendar.ui55.test.tsx` (`streakReads()`) with plant UI55-NS2 re-pointed in `scripts/ci/review-ui-gate.mutations.sh`. Grep proof: `docs/plans/student-ui/evidence/wave5/deletions.md`, "OQ-61 (a): /api/me/streak".
SCL-211 | 2026-10-05 | Amends Doc 05F §17 (its visual-contract sentence), §17.1 (layout) and §17.5 (the free student's setup) for the STUDENT calendar: DESIGN.md's calendar (signed off 2026-10-02) and `Calendar.dc.html` supersede `docs/design/calendar-prototype.html` for the student layout. The student page sits in the App shell: a Canvas-style header (Week/Month, Today and the arrows; the range centred; Edit schedule and Regenerate plan), the grid, and a right panel (mini month, goal card with days-to-test, target and projected, "Your schedule", Show filters). The test day is starred. No streak line and no facts strip. A free student gets an inline setup form plus the plan upsell card instead of the popup's third panel, and the form is read-only after the first save (goals are edited in Settings, OQ-25). The guardian calendar is not changed | PROPOSED
Id: `SCL-211` allocated 2026-10-05 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref (143 refs): the highest anywhere is `SCL-210`, on `origin/claude/guardian-domaingrid-g5-10` only (commit `8ec47f05`, open PR #1092; an unmerged claim is still a claim). `SCL-209` is on `claude/student-ui-wave4` (#1073), `claude/oq50-quota` (#1094) and `claude/guardian-domaingrid-g5-10`. Open PRs checked (all 6 open: #1094, #1092, #1073, #1069, #1048, #728): every head branch is in this repository and so covered by the fetch, and none carries an entry above `SCL-210`. One entry allocated.
Change (owner ruling, Karl, 2026-10-05, student-UI register §9 OQ-56, verbatim): "OQ-56: allocate an SCL amending Doc 05F §17.1 and §17.5 to the signed-off design. Drop the streak line and the facts strip to match the design. Accept (b) setup form read-only after first save, and (d) guardian star to the guardian vertical." The side-by-side of the spec text, DESIGN.md and UI-55 as built is in `docs/plans/student-ui/evidence/wave5/owner-questions-OQ51-60.md` (OQ-56).
WAS (§17, verbatim): "The visual contract is `docs/design/calendar-prototype.html`, committed and byte-identical to the approved design."
WAS (§17.1, opening, verbatim): "Reachable from the **Calendar tab in the app's top navigation**, and from a per-student link on the guardian dashboard. A free student sees the tab and the page answers 402 with the upgrade CTA — that is the upsell path, not a hidden route."
WAS (§17.1 item 1, verbatim): "**Left rail** — the Lyceon wordmark (links to the dashboard), the student's identity, a mini-month that navigates the main view, a **"Your schedule"** summary line, and block-type filters. The rail carries **no edit control**: **Edit schedule** in the header is the single entry point, and the duplicate that once sat here was the kind of second door that drifts from the first."
WAS (§17.1 item 2, verbatim): "**Top bar** — three zones, two rows each. **Left:** **← Dashboard** on top; **Edit schedule** and **Refresh plan** side by side beneath. **Centre:** previous/next, **Today**, the visible range and the **Week / Month** toggle on top (Week default); `🔥 N day streak · N days to test` beneath. **Right:** the **target score** on top and the **projected range** beneath, number first with the label trailing, both centred on one axis, the target set two type steps above the range. A student with no projection gets a statement in that slot, never a blank or a zero."
WAS (§17.1 item 7, verbatim): "**Facts strip** — the §14 facts for the visible range."
WAS (§17.5, last sentence of "Setup required", verbatim): "A free student sees a third panel after step 2 — what their plan would be, and the upgrade CTA — with their answers already saved either way."
Read with (§14, the `streak` row, last sentence, verbatim): "Rendered in the calendar header and on the practice page." For the student calendar this no longer holds (below); the row's data contract is not touched.
IS (§17, visual contract): for the STUDENT calendar the visual contract is DESIGN.md "Calendar" (`docs/plans/student-ui/design/DESIGN.md` §4, signed off 2026-10-02) and its prototype `docs/plans/student-ui/design/prototype/Calendar.dc.html`; they supersede `docs/design/calendar-prototype.html` for the student layout. The guardian calendar keeps the layout §17.1 describes (its own rail and three-zone top bar) until the guardian vertical says otherwise.
IS (§17.1, student layout, replacing items 1, 2 and 7 for the student; items 3 to 6 and drag-to-move stand):
  1. **App shell, not a calendar rail.** The page sits in the student App shell (the shell's rail carries Calendar; for a free student the lock is a hint and the item still navigates; on a phone Calendar is reached from the avatar menu and from Home, DESIGN.md "Mobile"). The calendar has no rail, wordmark or identity block of its own and no "← Dashboard".
  2. **Header** — Week/Month, **Today** and the previous/next arrows on the left (Week default); the visible range centred (`M/D – M/D` in week view, the month name in month view); **Edit schedule** and **Regenerate plan** (`POST /api/calendar/plan/regenerate`, §15) on the right. **Edit schedule** is still the single entry point to the §17.3 sheet. "Refresh plan" is named "Regenerate plan". Nothing sits under the range: **no streak line**.
  3. **Right panel** (the shell's 340px panel): the mini month, navigable; the **goal card** — days until the SAT with a ★ date pill, **Target** and **Projected** side by side (the projection read 1:1 from Doc 05C, a statement when absent, never a blank or a zero), and "Edit goals" (to Settings); the **"Your schedule"** summary line; the **Show** category filters.
  4. **The test day is starred** in the week view, the month view and the mini month.
  5. **No facts strip.**
IS (§17.5, free student): a free student does not get the popup's third panel. The page shows an inline setup form (test date and target score, each optional per SCL-130) beside the plan upsell card, with the mini month and a Target-only goal card in the right panel. The answers are stored before the entitlement gate exactly as §15 says ("Setup renders before the entitlement gate"), through `PUT /api/calendar/profile`, and read back through the ungated `GET /api/calendar/profile` (OQ-25). Before the first save the form is editable; once a profile exists it shows the saved test date and target read-only with "Edit goals in Settings", and goals are edited in Settings (OQ-25). The plan grids stay premium.
Not changed:
  - Data contracts: `GET /api/calendar` (both discriminants, `facts`, `streak`, `estimates`, `entitled`, `defaults`), `GET /api/me/streak` with INV-08-20 / INV-08-11 (served, ungated, tested server-side), `PUT /api/calendar/profile`, the §16 guardian view model. §14's facts and streak are still computed and served. The guardian calendar renders both (its top bar's streak line, the facts strip under its grid); the guardian Dashboard renders the streak through `HeaderFacts` and the week's blocks-completed count from `facts`. As built after this change no STUDENT surface renders the streak or the facts (the practice page's streak went with UI-51's "Weekly Activity" card), and the student client no longer calls `GET /api/me/streak`; the route stays, as §15 and INV-08-20 define it.
  - The paid student's first visit: the §17.5 two-step setup popup over the blurred plan stays as written (step 1 the test date with the opt-out and the target with the live days-to-go readout; step 2 study days, time per day and practice-test day, preselected from `defaults`; every step skippable; dismissible; reopens until a profile exists). UI-55 opens it only for a student served `setup_required` with `entitled` not false; its last press saves the profile and the plan is built.
  - §17.2 day editor, §17.3 settings sheet, §17.4 plan-updated banner, §17.5's other states, §17.6 "why this block" copy, §17.7 interaction rules; the week and month views and the side sheet (§17.1 items 3 to 6).
  - The guardian calendar (§16, and §17.1's guardian entry point). Starring the test day on the guardian grid is ruled to the guardian vertical (OQ-56 (d)); nothing here changes it.
  - Not ruled, kept as built (OQ-56 (a) and (c)): the free page has no Week/Month or Regenerate header (both would only answer 402), though the prototype draws one; the goal card's "Edit goals" and the free card's "Edit goals in Settings" both go to `/profile` (Settings, whose first section for a student is Profile).
Rationale: DESIGN.md and its prototype were signed off on 2026-10-02, after Doc 05F §17 was written against `docs/design/calendar-prototype.html`; the student calendar was rebuilt to the newer design (UI-55) and the spec still described the old one. The streak line and the facts strip were the two spec-only items UI-55 had kept; the ruling drops them to match the design. Read-only after the first save keeps one place to edit goals (Settings), as OQ-25 ruled for free students.
Owner action: none beyond acceptance of this entry. PROPOSED until the amendment is made in Doc 05F §17 / §17.1 / §17.5 (and §14's "Rendered in" sentence) on its next revision; the code already follows it.
Build artifact: built on `claude/oq56-calendar`, for draft PR #1073. `client/src/features/calendar/components/StudentChrome.tsx` (no streak line under the range); `client/src/features/calendar/CalendarView.tsx` (`FactsStrip` for the guardian surface only); `client/src/pages/calendar.tsx` (no streak read); `client/src/features/calendar/api/{client,queries,keys,index}.ts` and `client/src/lib/query-freshness.ts` (the unused student streak read removed); `client/src/features/calendar/components/FreeCalendar.tsx` (read-only after the first save). Tests: `client/src/pages/calendar.ui55.test.tsx` ("paid: no streak line and no facts strip", the free read-only cases); plants UI55-NF1, NS1, NS2 and RO1 to RO6 in `scripts/ci/review-ui-gate.mutations.sh`. Screenshots: `docs/plans/student-ui/evidence/wave5/UI-55/`.
SCL-209 | 2026-10-05 | Amends Doc 02B §13 "What Counts Against Quota" and "Quota Check Mechanism": a SKIPPED practice question counts against the free daily quota exactly as a submitted one does, and DIAGNOSTIC questions (answered or skipped) count nothing; the diagnostic's next question is never refused by the free quota. The count is dated by `practice_session_items.occurred_at`. §16's "Skipped questions (served but not submitted)" stays the review-entry rule it is, and no longer defines what the quota excludes | PROPOSED
Id: `SCL-209` allocated 2026-10-05 after `git fetch --all --prune`, by every `SCL-[0-9]{3}` added to `docs/SpecAudit/SPEC_CHANGES_LOG.md` in the history of every remote ref (`git log --remotes -p -- docs/SpecAudit/SPEC_CHANGES_LOG.md`): highest anywhere `SCL-208` (on `claude/seo-g7-legal-drafts`, open PR #1084). Open PRs checked (all 10 open: #1092, #1091, #1084, #1076, #1073, #1072, #1070, #1069, #1048, #728): every head SHA equals its fetched remote ref, so the scan covered them; none claims above `SCL-208`.
Change (owner ruling, Karl, 2026-10-05, student-UI register §9 OQ-50, verbatim: "skips count, diagnostic doesn't, SCL against Doc 02B"). OQ-50 had asked whether to accept three consequences of following Doc 02B literally after OQ-43 / F-61: (a) skips do not count, (b) a question already on screen can still be answered after the limit, (c) diagnostic answers count. (a) and (c) are ruled the other way; (b) was not ruled and stays as built.
WAS (§13 "What Counts Against Quota", verbatim): "Only practice question submissions count against the daily quota. Specifically excluded: * Questions served but not answered (abandoned session, browser close before submit) * Questions viewed in review surfaces (review is premium-only anyway) * Exam questions (exams are premium-only)" — read with §16's "Skipped questions (served but not submitted) do not enter review", which makes a skip a question "served but not submitted" and so excluded.
WAS (§13 "Quota Check Mechanism", verbatim, second paragraph): "Implementation approach: query against `practice_session_items` counting submissions where `answered_at >= today_midnight_configured_timezone` for the profile."
IS (§13 "What Counts Against Quota"): "Practice questions the student RESOLVES count against the daily quota: a submitted answer or a skip, one each; an idempotent replay is the same question and counts once. Specifically excluded: questions served and not yet answered or skipped (abandoned session, browser close); diagnostic questions, answered or skipped (the diagnostic is free and is not interrupted by the quota); questions viewed in review surfaces; exam questions."
IS (§13 "Quota Check Mechanism"): "... counting the profile's practice items answered or skipped, outside diagnostic sessions, whose `occurred_at` falls in the current configured-timezone day." The two refusal points stay session start and next question; a diagnostic session's next question is not refused.
Not changed: the reset (configured-timezone midnight, America/Chicago at launch), the daily value, the pre-cap at session creation, the 402 shapes, the paid tier (unlimited) and its per-session cap. §16's review rule (a skip does not enter review) is unchanged; it simply stops doubling as the quota's definition. Not ruled, kept: an item already on screen when the limit is reached can still be answered or skipped (OQ-50 (b)).
Why `occurred_at`: CHECK `psi_resolved_requires_occurred_at` guarantees it on every answered or skipped row; nothing guarantees `answered_at`. Mastery (20260921000000) and the calendar's practice adapter (2026-09-22) already date resolved items by it.
Rationale: a skip reveals the stem, so a free student could page through unlimited stems by skipping; and the diagnostic is the free baseline every student is meant to finish in one sitting — before this, a free student who had used the day's quota was refused mid-diagnostic, because the diagnostic's questions 2..40 are served by the practice next-question route, which reserves quota.
Owner action: apply `supabase/migrations/20261024000000_practice_quota_skips_count_diagnostic_exempt.sql` (after `20261023000000`, whose deployment state is unverified from here). PROPOSED until live (SCL-159).
Owner confirmation (Karl, 2026-10-05): the §16 reading above is confirmed — SCL-209 changes only the quota's definition of a skip; §16 and review behaviour are unchanged. Deployment, per the owner's report of 2026-10-05: production's `check_and_reserve_practice_quota` body md5 is `981f5c39…` (the `20260630000000` body), so neither `20261023000000` nor `20261024000000` is applied; Karl applies both, in that order, right before #1073 merges. Update, per the owner's report of 2026-10-05 (later the same day): both applied; the live body md5 is `3280430166fd61987c6a77ed91f2ac88`, a single function with the unchanged signature.
Build artifact: the migration (`CREATE OR REPLACE` of `check_and_reserve_practice_quota`, same signature and ACL; the count and the cap branch only; no table, column, constraint or data change); `scripts/ci/genesis-schema.expected.sql` (that body only); `tests/ci/practice-quota.pg.ci.test.ts` extended (real routes over real PG, in CI); `server/lib/practice-quota.ts`, `contracts/freemium-practice-quota.contract.md` and the register's F-61 / OQ-50 rows updated. Built on `claude/oq50-quota`, for draft PR #1073.
SCL-207 | 2026-10-03 | Amends Doc 04C §16.3 ("Multi-session listing (optional MVP, deferred to V1.1)"): the aggregated listing is in V1.0. `GET /api/tests/sessions?state=scored` returns the caller's own scored full-length sessions, newest first, each row carrying only `session_id`, `test_form_name`, `completed_at`, `total_scaled`, `rw_scaled`, `math_scaled` and the full §15.1 disclosure block. It is paid-gated (`exam_full_length`) and capped at 50 rows with no cursor | PROPOSED
Id: `SCL-207` allocated 2026-10-03 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest anywhere `SCL-206` (on `claude/exam-projection-blend`, now in `cleanup`). Open PRs checked (all 10 open; the log's added lines in each): highest claimed `SCL-206` (#1069), none above it.
Change (owner ruling, Karl, 2026-10-03, student-UI register §9 OQ-40: "allocate an SCL bringing the score history (Doc 04C §16.3) into V1.0"; the read itself was approved 2026-10-02 as OQ-30: "A read of the student's completed full-length results (date, total, sections)").
WAS (§16.3, verbatim): "V1.0 does not include a "list all my exam reports" endpoint. Clients construct this by listing `test_sessions` (owned by 04A, separate listing endpoint) and calling `/report/status` per session. If Product wants an aggregated endpoint, V1.1 adds it as a projection over the same canonical data."
IS: V1.0 includes the aggregated endpoint, built as §16.3 already describes it: a projection over the same canonical data. Scored means what §5.3 says (`test_sessions.state = 'completed'` with a `score_runs` row carrying `total_scaled`); scores are read from `score_runs`, never recomputed (§7.1/§7.2); every row carries the §15.1 disclosure bound to its run's `scoring_model_version`, and a missing disclosure fails the whole response (500, §16.7) rather than ship a bare score. Order: auth, then entitlement (403 `entitlement_required`, SCL-185), then the Zod query (`state` must be `scored`; anything else 400), then the read.
Not changed: no item, answer, explanation, module path, decomposition, routing threshold or per-domain correct/total is listed (§8.3; Step 2 ruling 7). Partial-scored, pending, failed and in-progress sessions are not listed. The per-session report and `/report/status` are unchanged. Guardians get no new read.
Why: the Full-Length home's score history panel (student-UI DESIGN.md §4, row UI-54) needs the student's past results without one request per session.
Owner action: apply `supabase/migrations/20261020010000_exam_scored_sessions.sql`. PROPOSED until live (SCL-159).
Deployment, per the owner's report of 2026-10-05: live in production — `exam_scored_sessions` body md5 `4b17c452171384c363d67ec8330da689`, args `p_student_id uuid, p_limit integer`.
Build artifact: the migration (`exam_scored_sessions(p_student_id, p_limit)`, STABLE, service_role only); `packages/shared/src/exam-scored-sessions-schema.ts` (`.strict()` rows derived from `examReportScoredSchema`); the route in `server/routes/exam-report-routes.ts`; `tests/ci/exam-scored-sessions.handler-pg.ci.test.ts` (real route over real PG, in CI); `scripts/ci/genesis-schema.expected.sql` regenerated. Built on `claude/oq30-scored-sessions`, now in draft PR #1073.
SCL-206 | 2026-10-03 | Doc 05C §5.7's full-length blend goes live: the score projection is the mean of the mastery term and up to the two most recent COMPLETED full-length section scores (States A/B/C), bound to `full_length_section_scores` (SCL-157). The §8.3 outbox gets its consumer: an API read-through for the session just finished, plus a pg_cron drain every 30 seconds. Every completed exam counts, retakes included | PROPOSED
Id: `SCL-206` allocated 2026-10-03 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest `SCL-205` (on `claude/exam-review-picker`, open PR #1045). Open PRs checked (#1054, #1053, #1048, #1045, #728): their heads are remote branches the scan covered.
Change (owner ruling, Karl, 2026-10-03: "the full length exam wiring for the mastery formula has to happen. with the 2 most recent full lengths added to the formula like the spec says"; "yes, we need to wire in the score projection part"):
  1. `compute_section_projection`'s §5.7 named forward-ref ("State A only … pre-WS-4", 20260613020000) is replaced by §5.7's own SQL, verbatim: two reads of `full_length_section_scores` (`is_complete = true`, `ORDER BY completed_at DESC, id DESC`, `LIMIT 1` / `OFFSET 1 LIMIT 1`), the denominator adapting 1 → 2 → 3. The rest of the body is unchanged. Both `BLOCKING_UPSTREAM_GAP` items 05C §11.C names are closed by SCL-157 (the 04B surface, named) and SCL-154/155 (the outbox row, written per completed session).
  2. §8.3 step 2, the consumer: `projection_refresh_outbox_process(outbox_id)` refreshes both sections, resets the throttle counter and stamps `processed_at` (a processed row is a no-op). `projection_refresh_outbox_drain(limit)` takes the oldest unprocessed rows (SKIP LOCKED), each in its own subtransaction: a row whose refresh raises stays pending and is counted and reported by WARNING with its SQLSTATE only; the rest drain.
  3. §8.3 step 3, the read-through: `projection_refresh_after_exam(seams_event_id)` refreshes the session that was just finished. The API calls it once that session's seams event has committed, so the report already reflects the test.
  4. 05D's worker schedule: pg_cron, `projection-refresh-outbox-drain`, every 30 seconds (`scripts/ops/projection-refresh-outbox-cron.sql`, owner-run; the E6 R6 precedent). pg_cron is the platform's managed scheduler, already live for `exam-abandonment-sweep`.
WAS: 05C §5.7 / §11.C: `compute_section_projection` "MUST NOT be deployed until" the 04B surface is named. 20260613020000 shipped State A (`fl1 = fl2 = NULL`, denominator 1), and nothing read `projection_refresh_outbox` (SCL-155: "The consumer is NOT built"). A finished full-length changed the projection only through its answers' mastery, at the 40-event throttle.
IS: §5.7 as written. A finished full-length enters the projection directly, refreshed in the request that finished it.
RETAKES (owner ruling 2026-10-03, asked and answered): "Every completed exam". The two most recent completed full-lengths count whether or not the form was seen before, exactly as §5.7 is written. This SUPERSEDES the 2026-10-02 note in `docs/plans/student-ui/student-ui-vertical.md` §7 ("retakes excluded"), which asked to be re-cleared at pickup and was. Mastery is unchanged by the same ruling ("Keep as is"): every answered item of a submitted section feeds mastery, retake or not (Doc 05 §4.3 / §11.4).
Not changed: abandoned and partial exams never count (`is_complete` = the session completed, SCL-157; P5). Below the Q4 gate the projection stays NULL whatever exams exist (INV-05C-14). There is no staleness window (Q1 State D). The 24-hour time trigger (§8.2 item 2, the 05D daily sweep) is still unbuilt; it is not part of this change.
Trade-off recorded: a row that fails forever is retried on every drain. The §7.7 table has no attempts column and none is added. At launch volume this is one WARNING per run, not a backlog.
Production at allocation (read-only, 2026-10-03): `projection_refresh_outbox` holds 2 rows, both unprocessed (written since E9, never consumed). The drain consumes them on its first run.
Owner action: (1) apply `supabase/migrations/20261022000000_05c_full_length_blend.sql`; (2) run `scripts/ops/projection-refresh-outbox-cron.sql` once. PROPOSED until both are live (SCL-159).
Build artifact:
  - The migration and the API read-through (`server/services/exam-runtime-service.ts` `refreshProjectionAfterExam`).
  - `scripts/ci/projection_parity.py` + `05c-projection-gates.sh`: States A/B/C, three-way bit-exact (PL/pgSQL == Python reference == spec) over 9 fixtures. These include §6.7 Example 1 (630 (610–660)) and §13.1 P1–P5. Red without the migration (P2: pg 480, ref 520), with ascending order (P3, P4, Example 1) and with no `is_complete` filter (P5).
  - `scripts/ci/projection-full-length-gates.{sh,sql}` J1–J6 run on real exams through the real view, and the CI step "Projection full-length blend gates (SCL-206)" runs them. Each plant tested turned its check red:
    - no migration: all six red;
    - oldest first: J1;
    - no `is_complete` filter: J2;
    - no per-row isolation: J5 (with J1 and J2 also red);
    - no counter reset: J5.
  - `tests/ci/exam-shell-server.handler-pg` "report: scored": an exam finished through the API leaves its outbox row processed and both sections at `fl1 800, fl_count 1, denominator 2`. It is red with the API call removed.
  - `genesis-schema.expected.sql` regenerated. `no-hardcoded-constants.mjs` guards the three consumer bodies.
SCL-205 | 2026-10-03 | Amends SCL-158 (exam → review queue): a full-length section feeds the review queue ONLY once the whole section is `submitted` (both modules). A section that stopped at `module1_submitted` — an abandoned exam — queues nothing, though its Module 1 holds misses. No answered-count or percentage threshold exists | PROPOSED
Id: `SCL-205` allocated 2026-10-03 after `git fetch --all --prune`, by `git grep -hoE 'SCL-[0-9]{3}' <ref> -- docs/SpecAudit/SPEC_CHANGES_LOG.md` across every remote ref: highest anywhere `SCL-204`. Open PRs checked (#1053, #1048, #1045, #728): their heads are remote branches the scan covered.
Change (owner ruling, Karl, 2026-10-03): "abandoned module 1's should not be added to review" and "questions from every module have to be submitted. no percent logic or anything needed." `exam_apply_scored_seams`' review loop selects served items whose SECTION is `submitted`, for Module 1 and Module 2 alike.
WAS (SCL-158, verbatim): "in SUBMITTED modules (Module 1 once `module1_submitted`; Module 2 once the section is `submitted`)".
IS: "in SUBMITTED SECTIONS (both modules: `test_session_sections.state = 'submitted'`)". Everything else in SCL-158 (served items only, wrong → `incorrect`, blank → `skipped`, the derived `source_item_id`, `queued_at`, after scoring from the seams event) stands.
Rationale: the queue now agrees with the two documents that already drew the line at the section: Doc 04C §13.3 / §4.3 ("Sections in `module1_submitted` state are NOT review-eligible even though Module 1 answers exist") and Doc 05 Parent §11.4 ("Module-1-only partials do not feed mastery" — `full_length_answer_events` already filters `sec.state = 'submitted'`). Score, review eligibility, mastery and the review queue all count the same sections.
Not a change (recorded so it is not re-asked): a 60%-unanswered "not graded" rule was raised and withdrawn in the same ruling. Doc 04B §15 / Doc 04A §4 #13 stand — blanks in a submitted module score as wrong; a section is scored, reviewable and queued iff it is `submitted`.
Why this surfaced now: exam → review picker work (PR #1045) asked whether an abandoned exam's Module 1 belongs in review; 04C §13.3 and SCL-158 disagreed.
Production at allocation (read-only, 2026-10-03): 17 of 247 `full_length` review rows come from a section not `submitted` (1 student). This change does not touch them.
Owner action: (1) apply `20261021000000_exam_review_submitted_sections_only.sql` — PROPOSED until live (SCL-159); (2) decide whether to remove the 17 existing rows (a data change; not made here).
Build artifact: `supabase/migrations/20261021000000_exam_review_submitted_sections_only.sql` (`CREATE OR REPLACE` of the function; one predicate); `scripts/ci/genesis-schema.expected.sql` (that predicate and its comment only); `scripts/ci/exam-seams-gates.sql` expectation narrowed + new check S9 (PART: Math left at `module1_submitted` with 16 misses/blanks queues 0; red without the migration: "Math rows queued 16"); `tests/ci/exam-review.handler-pg.ci.test.ts` E6 (red without the migration).
SCL-200 | 2026-10-03 | Amends Doc 01 V8 §0.2, Doc 02A §Out-of-scope, Doc 02 Preamble §19 and Doc 02B §37: the "future Doc 05 (Trust, Growth, Compliance)" role for PUBLIC / MARKETING SURFACES and the content engine is assigned to a new Doc 10A. Doc 02B §34's B7 (cross-domain writes consolidation), also assigned to that future Doc 05, is NOT moved and is recorded as unassigned | PROPOSED
Id: `SCL-200` derived at the moment of use, 2026-10-03, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across 101 remote refs: the highest allocated anywhere is `SCL-199` (on `origin/main`, `origin/guardian`, `origin/claude/guardian-wave-5`, `origin/claude/guardian-e2e-fixed-clock`; not yet on `seo`). Open PRs checked, all three (#1048, #1045, #728): every head branch is in this repository and therefore covered by the fetch, and none carries an entry above 199. Five entries allocated in sequence: SCL-200 (this), SCL-201, SCL-202, SCL-203, SCL-204.
Owner ruling recorded: SEO & Marketing vertical plan (`docs/plans/seo/seo-marketing-vertical.md`) §1 R6 (Karl, 2026-10-02): "New spec doc Doc 10A (next available letter) owns public/marketing surfaces and the content engine; takes the 'future Trust/Growth doc' role cited by Docs 01/02A/02B (SCL records it)." Scope confirmed 2026-10-03 (Wave 0 Step 0 reply, item 1): Doc 10A takes only the public-surface half of Doc 02B §37; B7 is recorded as unassigned; the Doc 02 Preamble §19 reference is included. Plan row G1.
WAS, verbatim:
  - Doc 01 V8 §0.2 (`Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:45`): "Marketing and growth surfaces (future Doc 05\)"
  - Doc 02A Out of scope (`Lyceon — Document 02A_ Question Generation & Content Supply Chain (V6).md:80`): "… marketing or public question previews (future Doc 05), …"
  - Doc 02 Preamble §19 (`Lyceon — Document 02 Preamble_ Assessment Content & Runtime Governance (V3 Final).md:492`): "marketing/trust/compliance (Doc 05\)"
  - Doc 02B §37 (`Lyceon — Document 02B_ Runtime Engines (V4).md:2007`): "**Doc 05** (Trust, Growth, Compliance, future) — 05 owns cross-domain concerns flagged in §34 (cross-domain writes, public surfaces)"
  - Doc 02B §34 B7 (same file, `:1819-1821`): "Cross-Domain Writes (B7) — Doc 05 owns … Consolidation is Doc 05 scope."
  The "Doc 05" that exists is the Mastery family (Docs 05, 05A–05F); no document owns public or marketing surfaces.
IS:
  - Public and marketing surfaces (pages, metadata, structured data, public question previews including the Question of the Day, the content engine, public-facing analytics surfaces) are owned by **Doc 10A** wherever Doc 01 §0.2, Doc 02A, Doc 02 Preamble §19 and Doc 02B §37 say "future Doc 05" for them.
  - Doc 10A sits under Doc 10 (Brand, Public Narrative & Pre-Launch Legal Document Program) and is governed by the Public Disclosure Doctrine (plan §0; CLAUDE.md). Until Doc 10A locks, the plan's §1 rulings are the operative direction for these surfaces.
  - Doc 02B §34 B7 and the "cross-domain writes" half of §37 are NOT assigned to Doc 10A. They have no owning document: recorded here as UNASSIGNED so a later reader does not infer that Doc 10A took them.
Why: four locked documents route public surfaces to a document that was never written, and the "Doc 05" name was reused for Mastery. Without an owner, every public-surface decision in the SEO vertical has no spec home to trace to (CLAUDE.md: every implementation traces to a named spec section).
Owner action: draft and lock Doc 10A (plan row G6). Decide an owner for Doc 02B §34 B7 separately; this entry does not.
Build artifact: none (governance). Plan rows G1, G6.
Widened 2026-10-05 (Doc 10A draft Q-10A-1, Karl's answer, 2026-10-05; no new number: this widens this entry's own WAS to citations it missed, so it is annotated in place, as SCL-201 was on the same day; nothing here takes a number). Four further "future Doc 05" citations, verbatim, with what Doc 10A takes from each: (a) Doc 02B (`Lyceon — Document 02B_ Runtime Engines (V4).md:79`): "… or public-facing marketing surfaces (future Doc 05)." — taken by Doc 10A in full; (b) Doc 02 Preamble (`Lyceon — Document 02 Preamble_ Assessment Content & Runtime Governance (V3 Final).md:156`): "Future Document 05 (Trust / Growth / Compliance)" — Doc 10A takes the public / marketing half only, as for Preamble:492; (c) Doc 01 V8 (`Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:2034`): "Guardian linking and consent flows | Doc 05 (Growth), Doc 04 (Calendar) | Under-13 gates, family plan handling (future)" — NOT taken: guardian linking and consent are not a public surface (they route to `cleanup` / WS-GL per CLAUDE.md branch routing); recorded so a reader does not infer Doc 10A took them; (d) Doc 01A (`Lyceon — Document 01A_ Platform Primitives.md:1878`): "Future Doc 05 (Growth) | Observability | Instrumentation" — Doc 10A takes the consent-gated browser analytics on public surfaces only (Doc 10A draft §6); server instrumentation stays with the Doc 07 family. Doc 10A draft §1.1 (`docs/plans/seo/doc-10a-draft.md`).

SCL-201 | 2026-10-03 | Amends Doc 07A §3 (threat 9), §4, §9.2 (steps 1 and 2), §9.3.1 and §9.4: PostHog runs in the BROWSER as well as the server — the browser SDK (`posthog-js`) on public and signed-in pages on PostHog's standard defaults, cookieless until consent, IP discarded, no PII in events, never `identify`, under-13 excluded; the server-side `emitEvent` wrapper stays for signed-in business events and gains `user_signed_up.signup_source` from first-touch UTM. Vercel Analytics is retired | PROPOSED
Id: `SCL-201`, allocated in sequence after SCL-200 in the same derivation (highest elsewhere `SCL-199`, 2026-10-03, 101 refs; open PRs #1048, #1045, #728).
Owner ruling recorded: plan §1 R11 ("PostHog (free tier) on public pages, cookieless until consent, no `identify`, session replay per R32; Doc 07A server-side `emitEvent` for signed-in events incl. `user_signed_up.signup_source` from first-touch UTM; Vercel Analytics retired. SCL required (departs from Doc 07A §9.2/§9.3.1)"), R12 (PostHog is the marketing data hub), R12a (project settings: IP anonymization on, console-log capture off, cookieless mode on, timezone America/Chicago; applied 2026-10-02), R32 (PostHog product analytics on PostHog's standard defaults, public and signed-in pages, consent-gated, under-13 excluded), and the 2026-10-03 Step 0 reply, item 2 (amend the autocapture lines; restate §9.2 step 1; "no `identify`" is the browser SDK only). Plan row G2.
WAS, verbatim (`Lyceon — Document 07A_ Event Schema & Tracking Standards.md`):
  - §9.2 step 1 (`:1203`): "**Reject direct SDK usage outside wrapper** — enforced at lint/build time (see §9.4); the wrapper module is the only file in the codebase that imports the PostHog SDK."
  - §9.2 step 2 (`:1204`): "… **all V1 events including `user_signed_up` fire identified** — the wrapper has no pre-auth/anonymous path at V1."
  - §9.3.1 (`:1233`): "This is the only V1 SDK call path for event emission. Browser-side `posthog-js` is NOT used at V1 (no autocapture, no client-side `posthog.capture()` calls; all emissions are server-side from authenticated request handlers OR webhook handlers)."
  - §3 threat 9 (`:90`): "… §9 wrapper-library contract explicitly states autocapture is DISABLED at V1 (PostHog SDK config `autocapture: false`) …"
  - §4 (`:133`): "Autocapture re-evaluation (V1: PostHog autocapture DISABLED per §3 threat 9; V1.1+: if pageview tracking becomes needed, register `page_viewed` …)"
  - §9.4 (`:1269`): "**Autocapture** — per §3 threat 9, autocapture is DISABLED at V1 (`autocapture: false` in PostHog SDK config); the wrapper does not handle DOM events."
  Support, NOT amended: Doc 07 Parent §6.1 (`Lyceon — Document 07 Parent_ Metrics, Warehousing, Analytics & Decision Systems.md:192`) already names PostHog the "V1 analytics substrate … product analytics + dashboards + A/B testing + feature flags + funnels + session replay".
  Outside the locked corpus, routed not amended: the published Privacy Policy v4 §6.6 (`legal/privacy-policy/v4/en.md:197`) says "We use Vercel Analytics to understand how the service is used."
IS:
  1. **Two PostHog paths.** (a) Server: the `emitEvent` wrapper (§9) is unchanged for Lyceon-explicit business events, identified by the HMAC `analytics_user_id` (§7.1). (b) Browser: `posthog-js` on public and signed-in pages, on PostHog's standard defaults (autocapture and pageviews on), started only after cookie consent (cookieless before it), with IP discarded, no PII in any event property, and never `identify` / `alias` from the browser — browser events stay anonymous and are never joined to `analytics_user_id`. Users under 13 are excluded: the browser SDK does not start for them.
  2. **§9.2 step 1 restated:** the PostHog SDK is imported by exactly two modules — the server `emitEvent` wrapper (`posthog-node`) and one client init module (`posthog-js`). Any other import fails the §9.4 lint, as today.
  3. **§9.2 step 2:** unchanged for the server wrapper (no anonymous server path). The browser path is the only anonymous path, and it carries no registered business events.
  4. **Autocapture** (§3 threat 9, §4, §9.4): enabled in the browser SDK by the defaults. Autocaptured events and `$pageview` are PostHog-native and are NOT entries in `infra/event-schema-registry.yaml`; the registry, its strict-tier schemas and `ci/event-schema-registry-parity` continue to govern the Lyceon-explicit events emitted through `emitEvent`. Threat 9's "no governance" risk is answered by that split, not by disabling autocapture.
  5. **Server `identify()` stays.** "No `identify`" (R11) is the browser SDK only. The pseudonymous Person Property path of §7.5 (`:1108`) and §9.3.2 (`:1235`) — `posthog-node` `identify()` / `$set` with `analytics_user_id` — is unchanged.
  6. **`user_signed_up.signup_source`** is set server-side from the visitor's first-touch UTM, captured before signup and carried to the post-signup handler (§9.2 step 2's emission point is unchanged).
  7. **Vercel Analytics is retired** (`@vercel/analytics`). The Privacy Policy update (PostHog replaces Vercel Analytics; consent; cookies) is legal text routed to the legal track (plan row G7), not written here.
Why: the vertical needs anonymous public-page analytics (entry points, funnels, attribution) that the identified-only, server-only V1 contract cannot provide, and one analytics tool rather than two (R12).
Owner action: none on the spec text beyond validating this entry; Privacy Policy and Cookie Policy changes via G7 before the browser SDK ships to production.
Build artifact: plan rows F10 (PostHog per R11; `emitEvent` incl. `signup_source`; under-13 excluded) and F11 (cookie banner). Proof named in the plan: prod signup with source (SHOT/READ), `ci/event-schema-registry-parity`, `ci/pii-redaction-conformance`, under-13 test.
Superseded in part 2026-10-05 (G6 Step 0, owner answer 3; no new number: this marks part of this entry's own IS as superseded by a later owner ruling, so it is annotated in place, as SCL-199 was narrowed in place; nothing here takes a number). IS 1's "(cookieless before it)" is SUPERSEDED: nothing loads or sends before Accept — the browser SDK is a dynamic import made only after Accept (`client/src/lib/analytics/posthog-client.ts:8-14`; `client/src/components/consent/CookieConsentRoot.tsx:142-150`), as built and per plan F7. Plan R11 and R12a's "cookieless until consent" are marked superseded in the plan the same day. The rest of IS 1–7 is unchanged. Doc 10A draft §6.1 (`docs/plans/seo/doc-10a-draft.md`).

SCL-202 | 2026-10-03 | Amends Doc 01A §41 (and §39–§47 by extension) and Doc 06A §4 row (c): PUBLIC, UNAUTHENTICATED endpoints are rate-limited by a durable ledger keyed on an HMAC of the caller's IP, plus Cloudflare Turnstile verification on submit. Doc 01A remains the canonical limiter | PROPOSED
Id: `SCL-202`, allocated in sequence after SCL-201 (highest elsewhere `SCL-199`, 2026-10-03, 101 refs; open PRs #1048, #1045, #728).
Owner ruling recorded: plan §1 R19 ("Abuse protection: Cloudflare Turnstile on submit + durable hashed-IP rate limit (SCL)"); 2026-10-03 Step 0 reply, item 3 ("Keyed hash (HMAC with a server secret), raw IP never stored, rows expire with their window, Doc 01A remains the canonical limiter"). Plan row G3.
WAS, verbatim:
  - Doc 01A §41 (`Lyceon — Document 01A_ Platform Primitives.md:1085-1097`): "CREATE TABLE rate\_limit\_ledger ( profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, … PRIMARY KEY (profile\_id, bucket\_key, window\_start) );" — every bucket is keyed on a profile, so an unauthenticated caller has no bucket. SCL-080 recorded this as a known residual: "a per-IP or global limit on code entry is not expressible. An unauthenticated attacker has no bucket."
  - Doc 06A §3.1 (`Lyceon — Document 06A_ Infrastructure, Environments & Deployment.md:58`): "Cloudflare is **not** a rate-limiter: 01A §39–§47 (`RateLimitLedger`) is the canonical limiter; any Cloudflare edge rate-limit is *defense-in-depth only* and must be documented as non-canonical (Decision 5)." — unchanged, and this entry complies with it.
  - Doc 06A §4 (`:87`): "(c) **Turnstile** as a candidate abuse signal feeding 01A §52 incident taxonomy (06B)."
IS:
  1. **Anonymous buckets in Doc 01A.** For public endpoints with no authenticated caller, the RateLimitLedger keys a bucket on `HMAC-SHA256(server_secret, client_ip)` instead of `profile_id`. The raw IP is never stored or logged. Rows expire with their window, like profile-keyed rows. Bucket definitions, the atomic check-and-increment, and the 429 / `Retry-After` / `X-RateLimit-*` response of §44 apply unchanged. Doc 01A remains the canonical limiter; any edge rate-limit stays defense-in-depth (Doc 06A §3.1, unchanged).
  2. **Turnstile on submit.** A public endpoint that accepts a submission verifies a Cloudflare Turnstile token server-side before any other work; a missing or invalid token is rejected. Doc 06A §4 row (c) moves from "candidate abuse signal" to in use for public submit endpoints.
  3. The server secret is created and held by the owner (plan §4: "Secrets are created and stored by Karl only").
Why: the Question of the Day (plan R16–R18) is answerable without login, which is the first public write endpoint; the existing limiter cannot bound it. The keyed hash keeps the limiter durable across serverless instances without retaining an IP.
Owner action: none on spec text beyond validating this entry; create the Turnstile keys and the HMAC secret when Q2 is ready (plan §7).
Build artifact: plan row Q2 (public QOTD API: Turnstile + hashed-IP limiter). Proof named in the plan: CI route tests (429, missing token rejected) and LOG in prod.

SCL-203 | 2026-10-03 | Amends Doc 10 §6.2: the four launch public-facing analytics surfaces (Students-Helped, Average Score Improvement, Total Questions Answered, LISA Conversations) are PARKED until post-launch; none ships at launch | PROPOSED
Id: `SCL-203`, allocated in sequence after SCL-202 (highest elsewhere `SCL-199`, 2026-10-03, 101 refs; open PRs #1048, #1045, #728).
Owner ruling recorded: plan §1 R31 ("Removed/parked by doctrine: `/trust/evidence`; Doc 10 §6 public counters. Average score improvement (baseline → projection → reported actual) is post-launch, with real data, n≥100, Karl-approved") and Public Disclosure Doctrine rule 4 ("Proof stays internal … Nothing is published as 'evidence'"); scope confirmed 2026-10-03 (Step 0 reply, item 4): Doc 10 §6.2 only. `/trust/evidence` is not in any locked document and its removal is plan row F14, not an SCL. Plan row G4.
WAS, verbatim (Doc 10 §6.2, `Lyceon — Document 10_ Brand, Public Narrative & Pre-Launch Legal Document Program.md:324-334`): "## 6.2 The launch direction: four public-facing surfaces — Four public-facing analytics surfaces directionally planned for launch: 1. Students-Helped Counter … 2. Average Score Improvement Aggregate … 3. Total Questions Answered Counter … 4. LISA Conversations Counter (Conditional) …"
IS: no public-facing analytics surface ships at launch. Post-launch, any of the four may be proposed again only with real data, a cohort of n≥100 where a cohort applies, and Karl's written approval (doctrine rule 5); the Average Score Improvement aggregate is the named post-launch candidate (baseline → projection → reported actual). Doc 10 §6.3–§6.5 (what is not planned, the privacy-and-cardinality discipline, V1.1+ direction) are unchanged and govern any later proposal.
Why: a public counter is a statistic from Lyceon's own data, which the doctrine puts behind the approval gate (rule 5) and keeps proof internal (rule 4); at launch the numbers would be small and the small-cell threshold Doc 10 §6.4 relies on (Doc 07E §15 W5) is not set.
Owner action: none beyond validating this entry.
Build artifact: none. Plan rows G4, F14 (`/trust/evidence`, separate).

SCL-204 | 2026-10-03 | Amends Coding Standards §12.2, Doc 07E §10.2 and Doc 06A §5: PostHog session replay is permitted on public AND signed-in pages, on PostHog's defaults, with `ph-no-capture` on the question/answer area (practice, review, full-length exam) and on the LISA conversation; consent-gated; under-13 excluded. Replay on signed-in pages ships only through Doc 06A §5.2's existing compliance-gate pattern | PROPOSED
Id: `SCL-204`, allocated in sequence after SCL-203 (highest elsewhere `SCL-199`, 2026-10-03, 101 refs; open PRs #1048, #1045, #728).
Owner ruling recorded: plan §1 R32 (2026-10-02, scope 2026-10-03): "PostHog product analytics + session replay on PostHog's standard defaults (amends R11 and R12a; SCL G9 against Coding Standards §12.2, Doc 07E §10.2 and Doc 06A §5). Purpose: entry points, clicks, dead ends, drop-off. Scope: public and signed-in pages. The one standard exception: `ph-no-capture` on the question/answer area (practice, review, full-length exam) and on the LISA conversation, per Coding Standards §12 (student answers and tutor content are never captured); nothing else masked beyond defaults. Starts only after cookie consent; under-13 excluded; disclosed in the Privacy and Cookie Policies; PostHog DPA accepted." 2026-10-03 Step 0 reply, item 5: keep the gate — reuse Doc 06A §5.2's compliance-gate pattern, with F15's proof as the evidence artifact. Plan rows G9, F15.
WAS, verbatim:
  - Coding Standards §12.2 (`docs/Spec/lyceon-coding-standards.md:406`): "No invasive analytics on student-facing pages"
  - Doc 07E §10.2 (`Lyceon — Document 07E_ Analytics Retention, Privacy & Cascade.md:639`): "Lyceon does not currently use PostHog session recordings (Doc 07A V1.0 §6 event taxonomy excludes session recordings) but the parameter is set defensively to `true` so any future PostHog config that enables recordings doesn't leave under-13 recordings behind."
  - Doc 06A §5.2 (`Lyceon — Document 06A_ Infrastructure, Environments & Deployment.md:107-113`): "1. **Clarity is permitted only on unauthenticated marketing / logged-out surfaces.** It is **prohibited on any authenticated student, guardian, or tutor surface.** 2. Where permitted, **input/text masking is on by default** … 3. **Any expansion of Clarity to an authenticated surface is a registered compliance gate** in the §10 release-gate manifest (`gate: clarity-authenticated-surface`) … and cannot ship without that gate's evidence/approval artifact."
IS:
  1. **Coding Standards §12.2:** "no invasive analytics" is read as: session replay is permitted on student-facing pages only with `ph-no-capture` on the question/answer area (practice, review, full-length exam) and the LISA conversation, after consent, and never for users under 13. Student answers and tutor content are never captured (Coding Standards §12.1 and Doc 01A §14's never-log list are unchanged and are what the exclusion enforces). "Minimize data collection on all student surfaces" stands.
  2. **Doc 07E §10.2:** Lyceon uses PostHog session recordings. `delete_recordings: true` in the under-13 cascade is no longer only defensive; it is the path that removes any recording for a user later found to be under 13. The cascade is otherwise unchanged.
  3. **Doc 06A §5:** the replay tool is PostHog, not Microsoft Clarity. Item 1 is widened from logged-out surfaces to public and signed-in surfaces. Item 2's masking default is PostHog's (inputs masked), plus `ph-no-capture` on the two areas above; nothing else beyond defaults. Item 3's gate pattern is KEPT and applied to PostHog: replay on any signed-in surface is a registered compliance gate in the §10 release-gate manifest, and cannot ship without its evidence artifact — plan row F15's proof (CI: no capture before consent or for under-13; SHOT of PostHog receiving pageviews and a replay; SHOT of a real practice replay with the question/answer area blank). §5.3's proving mechanism and `infra/route-surface-classification.yaml` (§5.3.1) carry the replay allowance per route.
Why: the vertical needs to see where visitors and students enter, click, stall and drop off; replay on PostHog's defaults is the category's standard tool for that (doctrine rule 1), and the two exclusions are exactly the content the corpus already forbids capturing.
Owner action: none on spec text beyond validating this entry; Privacy and Cookie Policy disclosure via G7; accept the PostHog DPA.
Build artifact: plan row F15 (behind F11). Proof as in IS item 3.
SCL-199 | 2026-10-02 (narrowed 2026-10-03) | Amends SCL-181 and SCL-192 (the guardian exam list, `GET /api/students/:studentId/tests`): each item carries two more of the student's own lifecycle facts — `session_state` and `abandoned_at` — each required-present. NO score field is on the list: scores reach a guardian only through the report route (`GET /api/students/:studentId/tests/:sessionId/report`). `exam_list_forms` is unchanged (both fields were already in its `latest_session`). The student's own forms listing is unchanged | PROPOSED
Id: `SCL-199` derived at the moment of use, 2026-10-02, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1`: the highest allocated anywhere is `SCL-198`. Open PRs checked, all eight (#1037, #1036, #1035, #1034, #1033, #1032, #1016, #728): every head branch is in this repository and therefore covered by the fetch, and none carries an entry above 198. One entry allocated.
Re-checked 2026-10-02 when G5-08 widened this entry (still unmerged, on `claude/guardian-wave-5` only): after `git fetch --all --prune`, no branch carries an entry numbered 199 or above except this one, so the entry is amended in place rather than a new number allocated.
Narrowed 2026-10-03 (G5-09, on `claude/guardian-report-only-scores`; no new number: a narrowing withdraws part of this entry's own change, so it is amended in place rather than allocated afresh; nothing here takes a number, so the register's moving maximum is not consulted). Owner brief 2026-10-03: "remove the second score path. Scores reach the guardian only through the existing report endpoint … Withdraw SCL-199, or reduce it to whatever list fields are still genuinely needed." WITHDRAWN from this entry: `total_scaled`, `rw_scaled`, `math_scaled` on the list item, their state refinement, and migration `20261020000000_guardian_exam_list_total.sql` (never applied, per the owner, so the file is deleted rather than reversed; `scripts/ci/genesis-schema.expected.sql` regenerated, its three lines removed). KEPT: `session_state` and `abandoned_at`, which the list needs to choose sessions and to say the student's card word, and which are lifecycle fields, never scores.
Owner briefs recorded: 2026-10-02, Guardian Wave 5, row G5-04 — "Change chip: latest total minus the previous completed test's total … Establish first: does the guardian exam list carry each item's total score? If not, add the total to the guardian list item, with a strict schema, a wire test and an SCL at max+1." Established: it did not (SCL-192's item has seven fields, no score). Row G5-08 (same day) — "the guardian exam view mirrors the student's exam outcomes exactly, read-only … States: they map one to one onto the student's states, from the same producer fields … Change chip: it compares the latest scored outcome (including a partial score, labelled as the student labels it) with the previous scored outcome." Owner decision of the same day: a partial score is compared section to section (the student's own sentence says a partial has no total, and a section score and a total are different scales). Plan rows G5-04, G5-08; ruling R13.
WAS (SCL-192): `{session_id, test_form_id, test_form_name, mode, attempt_number_for_form, report_state, completed_at}`, `.strict()`.
IS: the same seven fields plus `session_state` (the student's `latest_session.state`, which is what tells the student's "In progress" from "Not finished" for the same `not_completed` report state) and `abandoned_at` (a partial score's outcome instant: it is abandoned, never completed), both required-present, `.strict()` — so a planted score key fails the schema.
Established 2026-10-03, against the list as it stood before #1040 (merge-base `34f89b38^1`): `completed_at` was already on the guardian list item (SCL-192). `session_state` and `abandoned_at` were NOT on the item; both were already emitted by `exam_list_forms` (`state` reached the item's source as `latest_session.state`; `abandoned_at` was dropped by the server's `formRowSchema`). So no migration is needed for either; this entry carries them.
Why it is needed: the Dashboard card picks the newest attempt to END (completed or abandoned: a partial score has no `completed_at`), and the list word must be the student's own (`formCardStateLabel` reads the session state). Neither can be read from `report_state` and `completed_at` alone.
Disclosure: no new information reaches a guardian, and both fields are ones the student also sees (Doc 04C §2.6 rule 7): the session state is the student's own card state; the instant is the student report's "Ended" line, which the guardian report already serves. No score, answer, explanation, count, domain, skill or decomposition field is added.
Owner action: none on the database. Read-only verify (owner-run, optional): `SELECT position('''total_scaled'', r.total_scaled' IN prosrc) = 0 FROM pg_proc WHERE oid = 'public.exam_list_forms(uuid)'::regprocedure;` returns true (the withdrawn migration is not live). PROPOSED until the server change is live (SCL-159).
Build artifact: `packages/shared/src/exam-guardian-report-schema.ts` (`guardianExamListItemSchema` with the two lifecycle fields and no score; `guardianListSessionFactsSchema` = `{completed_at, abandoned_at}`; `toGuardianExamList(forms, sessions)`); `server/services/exam-runtime-service.ts` (`formRowSchema.latest_session` parses `abandoned_at`; `listExamFormsWithCompletion` returns the instants map). Tests: `tests/ci/guardian-exam-results.handler-pg.ci.test.ts` (WIRE, real Postgres: every raw list item has both keys and no key matching `/scaled|score/`, scored, partial and pending alike); `client/src/features/exam/guardian-domain-bars.test.ts` (each key required; G5-09: no projected item in any of five report states has a score key, and the schema refuses each planted one); `tests/ci/guardian-exam-mirror.handler-pg.ci.test.tsx` (G5-08/G5-09: one real session per state; no list item carries a score field; the card's report reads are its own and, for the chip, the previous scored test's). Plant: a `total_scaled` key restored on the projection and schema reds 7 RTL and 4 real-Postgres cases.
SCL-208 | 2026-10-03 | Doc 10 §9.16, §9.14 and §9.2: the G7 legal drafts depart from three Doc 10 directions — the AI Content Disclosure describes LISA, scoring and progress by outcome only (doctrine rule 2); the Children's Online Privacy Notice follows SCL-187's guardian-linked under-13 access, not the "V1 13+ posture; under-13 hard-delete"; and the Privacy Policy states only enforced retention periods, by reference to the published v4 §6, not the 12-month-inactivity / indefinite-ML-retention language (SCL-092) | PROPOSED
Id: `SCL-208` derived at the moment of use, 2026-10-03, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across 133 remote refs: the highest allocated anywhere is `SCL-207` (on `origin/claude/student-ui-wave4`, `origin/claude/ui50-home` … `origin/claude/ui55-calendar`, `origin/claude/student-screenshot-harness`, `origin/claude/wave4-rulings-client`; not on `seo`). Open PRs checked, all fifteen (#1083, #1082, #1081, #1080, #1079, #1078, #1077, #1076, #1073, #1072, #1070, #1069, #1056, #1048, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: Karl, 2026-10-03 (G7 Step 0 reply, item 1): "generic wording is approved for §9.16, §9.14 (follow SCL-187) and §9.2 (enforced periods by reference). Write one PROPOSED SCL in this PR recording those three departures from Doc 10, citing doctrine rule 2 and SCL-187/092." Plan row G7.
WAS, verbatim:
  (1) Doc 10 §9.16 (`Lyceon — Document 10_ Brand, Public Narrative & Pre-Launch Legal Document Program.md:637`), "What it directionally covers": "… LISA's safeguards (Doc 03 LISA system design); … the mastery engine \+ scoring formula as automated systems (Doc 04B \+ Doc 05B) …".
  (2) Doc 10 §9.14 (`:617`): "Lyceon's V1 13+ posture; under-13 hard-delete-everywhere if a minor is identified".
  (3) Doc 10 §9.2 (`:495`, `:497`): "the 12-month-inactivity → pseudonymized-retention model (W7-named disclosure language per Doc 07E §8.3)" and (`:497`) "Lyceon retains pseudonymized records of platform interactions indefinitely for product improvement and AI model training. Personal information is retained for 12 months from last activity and then deleted."
IS:
  (1) The AI Content Disclosure states that LISA's replies are AI-generated, can be wrong, and that scores and progress are "calculated automatically"; it says safety is supported by "automated safety checks and human review" and describes no prompt, model logic, guardrail, scoring formula, progress calculation or selection logic. Any counsel request to describe those goes back to Karl under doctrine rule 2.
  (2) The Children's Online Privacy Notice and Privacy Policy v5 §4 follow SCL-187 (APPLIED 2026-09-30): an under-13 student may use learning features only while a parent or guardian link is active; LISA is closed to every under-13 account; an unlinked under-13 account is limited, not hard-deleted. Whether link redemption is sufficient consent in law stays on the counsel backlog (SCL-187 item 2; SCL-051).
  (3) Privacy Policy v5 §6 states only periods an enforcing mechanism performs, carried from published v4 §6 (SCL-101), with one correction to match enforcement (consent evidence: IP and browser stripped at 24 months, dated record kept — SCL-085/SCL-095, `supabase/migrations/20260917120000_deletion_sweeps_and_config.sql:156-166`). No 12-month-inactivity deletion is claimed (SCL-092: no mechanism exists) and no indefinite ML-training retention is claimed. v5 §6.6 also drops v4's "up to 24 months, then only in aggregate" analytics sentence (no LYCEON-controlled de-identified analytics tier exists; the BigQuery archive it related to was never used, SCL-106). Owner ruling, Karl, 2026-10-05: the drafts describe the launch state, with no interim-state markers; the processors are those at launch (PostHog analytics and session recording, Cloudflare Turnstile, Trustpilot, plus the existing set), so v5 §6.6 names PostHog only, with its periods left blank ([●]) for completion.
Why: (1) Public Disclosure Doctrine rule 2 (`CLAUDE.md:32`; `docs/plans/seo/seo-marketing-vertical.md:14`) forbids publishing anything that lets someone work out mastery computation, the scoring formula, LISA's logic or guardrails, or selection logic; Doc 10 §9.16's direction predates the doctrine. (2) SCL-187 changed the launch-gating under-13 posture after Doc 10 locked; a notice written to §9.14 as locked would misstate what the product does. (3) A published retention commitment that production does not perform is worse than none (SCL-092's own rationale); Doc 07E §5.1 defers the inactivity trigger to V1.1+.
Owner action: none beyond validating this entry. Doc 10 §9.2, §9.14 and §9.16 are unchanged; the drafts in `docs/compliance/legal-drafts/` cite this entry.
Build artifact: none (docs only). Drafts: `docs/compliance/legal-drafts/ai-content-disclosure.md`, `childrens-privacy-notice.md`, `parental-consent-mechanism.md`, `privacy-policy-v5.md`.
SCL-210 | 2026-10-05 | Amends SCL-189 (Doc 04 Parent Q9; Doc 04C §8.1/§9.1 guardian payloads, `GET /api/students/:studentId/tests/:sessionId/report`): the guardian's per-domain breakdown is the student's own seven segments — each row `{section, domain, segments_filled}`, computed by the student's rule (SCL-180 ruling 7: round half up of correct × 7 / total) for the student's scored sections, in the student's canonical order. `bar_pct` is removed; `correct` and `total` stay off the guardian wire. The segment count is the shared constant `DOMAIN_SEGMENT_COUNT` (7) and is not sent. No database change | PROPOSED
Id: `SCL-210` derived at the moment of use, 2026-10-05, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1`: the highest allocated anywhere is `SCL-209`. Open PRs checked (#1093, #1092, #1073, #1070, #1069, #1048, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner decision recorded: 2026-10-05, Guardian_Closure_Plan G5-11, option 1 — "Each guardian domain row becomes `{ section, domain, segments_filled }` … computed by the student's own `exam-domain-segments.ts` rule, in the guardian projection. Remove `bar_pct`. The guardian schema stays strict … Don't send the segment count … Record an SCL at max+1 amending SCL-189. No database change."
WAS (SCL-189): `{section, domain, bar_pct}`, `bar_pct` = round(100 × correct / total), `.strict()`; rows in the order `exam_domain_breakdown` returned them; drawn as one continuous bar (`DomainBreakdown`).
IS: `{section, domain, segments_filled}` (0–7), the shared `examDomainSegmentsSchema` (`.strict()`, so `bar_pct`, `correct` and `total` fail the parse; duplicate domains refused), built by `toDomainSegments(rows, scoredSections).domain_segments` — the student projection's own function — with scored sections `["RW","M"]` for a scored report and `completed_sections` for a partial one. Rows are in canonical order (RW then M, canonical domain order). The guardian detail renders the student's `DomainSegments` component with these rows.
Why: the student's fill cannot be recovered from a whole percent. Established 2026-10-05 over every total 1–60: 25 (correct, total) pairs fill differently from a percent than from the counts, and five percent values are ambiguous (7%, 21%, 36%, 64%, 93%) — for example 3 of 14 and 4 of 19 both round to 21% but fill 2 and 1 segments. Three of the mismatches are at a total of 14, a real domain size (1/14, 3/14, 9/14).
Disclosure: strictly less than SCL-189 sent — 8 possible values per domain instead of 101 — and exactly what the student sees for the same session (Doc 04C §2.6 rule 7). No count, percentage, answer, skill or question id is added. R4 holds: no "N of M correct" on any guardian surface.
Owner action: none on the database. PROPOSED until the server change is live (SCL-159).
Build artifact: `packages/shared/src/exam-guardian-report-schema.ts` (`guardianDomainSegments`; scored and partial `domain_breakdown: examDomainSegmentsSchema`; `guardianDomainBarRowSchema`, `toGuardianDomainBars` and `GuardianDomainBarRow` deleted); `client/src/features/exam/pages/GuardianExamResultsPage.tsx` (renders `DomainSegments`); `client/src/features/exam/components/DomainBreakdown.tsx` deleted (its only caller was the guardian page). Tests: `client/src/features/exam/guardian-domain-bars.test.ts` (rows equal the student projection's for scored, partial and a 1/14, 3/14, 9/14, 4/19 report; each row exactly three keys; the schema refuses `bar_pct`, `correct`, `total`); `client/src/features/exam/pages/breakdown-parity.test.tsx` (RTL: student `ReportBody` and guardian `GuardianReportBody` for the same session draw the same domains, order, segments and filled counts); `tests/ci/guardian-exam-results.handler-pg.ci.test.ts` (WIRE, real Postgres: each raw row is exactly `{domain, section, segments_filled}`, equals the counts' own rule and the student's `domain_segments`); `tests/ci/guardian-exam-mirror.handler-pg.ci.test.tsx` (real sessions, scored and partial plus one answered so Information and Ideas is 3 of 14: the guardian detail's Score breakdown equals the student's; the 3/14 domain fills 2 on both sides); `tests/ci/exam-report.contract.test.ts`. Plants: a percent-based fill reds 6 cases (including the real 3/14 session); a reversed order reds 9.
SCL-213 | 2026-10-05 | Amends Doc 07A §4 (launch-required inventory: "All 25 V1 events", "infra/event-schema-registry.yaml … populated with the 25 V1 event registrations") and §6.1: the V1 LAUNCH set is seven events — user_signed_up, user_signed_in, user_signed_out, exam_started, exam_section_submitted, tutor_session_started, tutor_session_ended. The other eighteen §6 entries are DEFERRED, not removed: their §6 schemas stand unchanged, and each is registered (and so becomes emittable) when its server site can satisfy its schema as written | PROPOSED
Id: `SCL-213` derived at the moment of use, 2026-10-05, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across 153 remote refs: the highest allocated anywhere is `SCL-212` (on `origin/claude/fu-oq61`; not on `seo`). Open PRs checked (#1105, #1104, #1103, #1069, #1048, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: Wave 1C Step 0 reply, 2026-10-05, decision 3 — "Events: launch with the 7 events; defer the other 18 via one `PROPOSED` register entry amending Doc 07A §4. No format amendments now."
WAS, verbatim (`Lyceon — Document 07A_ Event Schema & Tracking Standards.md`), §4 "Launch-required at V1": "`infra/event-schema-registry.yaml` exists and is populated with the 25 V1 event registrations (§5 + §6)" and "All 25 V1 events are strict-tier with full JSON Schema (§6)"; §6.1's per-class table of 25.
IS:
  1. **Launch set (seven, strict-tier, §6 schemas verbatim).** auth: user_signed_up (fires at onboarding completion — the first point the under-13 exclusion can be decided — once, guarded by the set-once analytics_user_id write), user_signed_in, user_signed_out (`explicit` only; the server never observes session expiry or a security logout); exam: exam_started (a NEW session only), exam_section_submitted (physical module 1 / 2A / 2B from the section row); tutor: tutor_session_started (a NEW conversation only), tutor_session_ended (single-winner transition).
  2. **Deferred (eighteen), each with the concrete reason it cannot be emitted schema-valid today:**
     - cohort ×3 (exam_date_set_at_signup, exam_date_set_via_calendar_prompt, exam_date_changed_in_settings): no `infra/sat-test-calendar.yaml` (§10) to derive `exam_date_cohort_id`; onboarding collects no exam date.
     - billing ×5: Lyceon has no trials (subscription_trial_started never fires); `invoice.payment_succeeded` / `invoice.payment_failed`, the spec's sources for renewed / payment_failed, are deliberately ignored under the Stripe single-writer rule; `renewal_count`, `failure_count` and a cancellation-reason category are stored nowhere; `plan_id` needs a mapping from Stripe price ids.
     - practice ×3: `question_id` is a text canonical id, not a uuid; `section` is null for mixed-section sessions and uses RW/M, not rw/math; the completion write repeats on replay.
     - exam ×3 (exam_completed, exam_section_partial_abandoned, exam_resumed): completion and abandonment are decided inside SQL functions and the cron sweep, out of the server's sight; a resume is indistinguishable from a first start.
     - mastery ×2: skill and domain ids are text codes, not uuids; mastery levels are 0–4, the schema says 1–5; both are SQL-only.
     - system ×2: error_caught has no error class / severity taxonomy; consent_captured's `consent_version` must be semver and legal document versions are `"1.0"`-shaped.
  3. A deferred event is NOT registered, so the wrapper refuses it at runtime (`event_not_registered`) and `ci/event-schema-registry-parity` fails any code that emits it. Registering one later is a registry PR against its unchanged §6 entry; a format change, if one is chosen instead, is a separate SCL.
  4. Person properties: only `analytics_user_id` (§7.1) is declared at launch. `exam_date`, `exam_date_cohort_id` and `exam_date_source` (§7.2–§7.4) are set only by the deferred cohort events and are declared with them.
  5. **Wrapper departures from §9.2 / §7.1 at this launch (the step order itself is §9.2's: subject resolved and record loaded, base fields refused, registry looked up, then the payload).** (a) Refusal reasons beyond §9.2's three: `analytics_not_configured` (no key or salt — the product runs without analytics), `excluded_under_13_or_age_unknown` (SCL-201 IS 1), `account_not_onboarded` (every event but user_signed_up waits for onboarding completion, so a new account's first analytics_user_id write is its user_signed_up), `not_first_identity` (the once-only guard of IS 1), `redaction_method_unsupported` (§8.1.1 `bucket` has no V1 table), `identity_unavailable` (the record read or the set-once write failed) and `send_failed`. (b) `schema_validation_failed` carries `details` as failing paths and keywords only, never values. (c) Step 11 (person-property updates) is not built: only the deferred cohort events use it. (d) §7.1's "computed ONCE at signup" is implemented as computed on the account's first emission, which by (a) is its user_signed_up; for accounts that completed onboarding before this launch it is their first later event, and they emit no user_signed_up. (e) §7.1's per-environment salts are one server-only variable, `ANALYTICS_SALT`, with a separate value in each Vercel environment (Production, Preview), rather than three differently-named variables.
  6. **Signed-in surfaces: no element text in autocapture.** Owner ruling 2026-10-05: on signed-in surfaces the browser SDK runs with PostHog's `mask_all_text: true`, so a clicked element's text is not recorded (a button or link there can carry a student's name); public pages keep PostHog's default. A signed-in surface is any page rendered behind the role gate (`RequireRole`). This resolves, for autocapture, the tension between SCL-201 IS 1 ("no PII in any event property") and SCL-204's "nothing else masked beyond defaults", which stays as written for session replay.
  7. **Addendum, 2026-10-05 (F13): the homepage hero experiment `homepage-hero`.** Owner ruling 2026-10-05, F13 Step 0 decisions 5 and 6 ("Experiment: confirmed, running now. Record it as an addendum to SCL-213 and note in the plan that it supersedes R13/P2 by Karl's ruling"). A PostHog experiment on PostHog's standard feature-flag mechanism, browser-only, no new Doc 07A §6 event: (a) Variant A ("control") is prerendered and is all a visitor without analytics consent ever sees; no consent means the SDK never loads, so no flag is requested. (b) With consent, the SDK's flag request assigns the variant; it is kept in localStorage under `ph_lyceon_homepage_hero` (the `ph_` prefix puts it inside withdrawal's PostHog storage deletion) and the hero does not change on that view. (c) From the next homepage view, an inline script (sha256 in the page CSP, checked against the built page) shows a stored Variant B before first paint, and the React hero renders the same variant, so nothing shifts after paint. (d) Exposure is PostHog's own `$feature_flag_called` (`$feature_flag: "homepage-hero"`, `$feature_flag_response`), sent only on a view that shows the stored variant; reading the flag sends nothing (`send_event: false`). (e) Under-13 and age-unknown accounts are excluded as for every browser event (the SDK never starts). Consent validity for the variant is the consent store's own rule (`consentIsCurrent`). Trade-off accepted by the owner: a visitor who signs up from the view where consent was given is never in the experiment. Artifacts: `client/src/lib/analytics/hero-experiment.ts`, `posthog-client.ts` (`recordHeroExposure`), `client/src/pages/home.tsx`; tests `hero-experiment.test.ts` (inline script vs module parity), `tests/ci/csp-hero-hash.ci.test.ts`, `tests/e2e/analytics-consent.spec.ts` (no consent → A and no flag request; consent → assigned; next view → B).
Why: the §6 schemas are strict (`additionalProperties: false`, uuid formats, fixed enums). An event the code cannot fill as written would be refused by the wrapper on every emission, so registering it would ship a contract that is never met. Seven sites fill their schemas exactly today.
Disclosure: none beyond Doc 07A §6 — the launch set is a subset of the spec's events with the spec's own schemas.
Owner action: none on spec text beyond validating this entry.
Build artifact: `infra/event-schema-registry.yaml` (seven entries); `server/lib/analytics/emit-event.ts`; the seven call sites; `ci/event-schema-registry-parity` and `ci/pii-redaction-conformance` (`scripts/ci/event-schema-registry-parity.ts`, `scripts/ci/pii-redaction-conformance.ts`). Plan row F10.

SCL-215 | 2026-10-05 | Amends Doc 01 V8 §5.1 (D01:251, the audit-log purge): guardian-link consent rows are excluded from the age-based audit purge and kept permanently. D01:222 ("Guardian consent events | Permanent") governs over D01:251 ("audit logs are hard-deleted") for the three consent actions | PROPOSED
Id: `SCL-215` derived at the moment of use, 2026-10-05, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across every remote ref: the highest allocated anywhere is `SCL-214`. Open PRs checked (#1118, #1115, #1113, #1048, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: Karl, 2026-10-05, cleanup-retention brief row C-02 — "The `guardian_link_*` audit rows are the consent records, kept permanently. No one-year anonymising step for live accounts. Identity is already stripped when an account is deleted … This settles D01:251 against D01:222 in favour of 222."
WAS (D01:222, verbatim): "| Guardian consent events | Permanent (anonymized after 1 year) | COPPA compliance evidence |"
WAS (D01:251, verbatim): "* After `account_deletion_runtime_config.anonymization_retention_days` (default 365), audit logs are hard-deleted"
IS: audit_logs rows whose action is `guardian_link_initiated`, `guardian_link_accepted` or `guardian_link_revoked` (the three actions `guardian_link_audit` writes; 20260828000000_guardian_link_audited_transitions.sql:114/173/220 and later redefinitions) are never purged by age. Every other audit row is purged after the window as before. Their actor and target ids are still severed at account deletion (`strip_identity`, unchanged), which is the anonymisation; there is no separate one-year anonymising step for a live account, because it would erase who consented while the link is still active. Parent `legal_acceptances` rows are unaffected: they are copied into `deletion_consent_evidence` at deletion and kept there. `guardian_link_redeem` is a `legal_acceptances.consent_source`, not an audit action.
Why: `apply_audit_logs_retention('purge_expired')` deleted every audit row past 365 days with no action filter, so the COPPA consent evidence D01:222 keeps permanently would have gone at one year. Production (owner, read-only, 2026-10-05): 21 such rows, all younger than a year, so nothing has been lost.
Disclosure: none; internal retention only.
Owner action: apply `supabase/migrations/20261027000000_audit_purge_keeps_guardian_consent.sql`. PROPOSED until live (SCL-159). Rollback (exact): in the migration's header.
Build artifact: the migration (one predicate added to the function body; otherwise 20260917100000's body verbatim); `scripts/ci/genesis-schema.expected.sql` regenerated (4 lines). Proof: `tests/ci/deletion-phases-235.pg.ci.test.ts` P5.7 (real Postgres; four rows two years old, presence asserted first; the purge deletes the one non-consent row and keeps all three consent rows); red before the migration (4 deleted, not 1). Plants in `scripts/ci/deletion-evidence-gate.mutations.sh`: M98 (drop the exclusion) reddens P5.7; M32 re-pointed to the function's new last definition (resolved at run time, `MIGAUDITRET`) and still reddens P6.6.

SCL-216 | 2026-10-05 | Amends Doc 03 §14.2 (D03:1255, crisis-flagged conversations) and the account-deletion cascade it meets (Doc 05D §10 / Doc 05E §5): a crisis-flagged conversation and its messages survive account deletion, de-linked from the student (student_id NULL), until the safety review queue owner purges them by hand. Crisis data outranks the Privacy Policy's under-13 "hard deletion across all Lyceon systems … LISA conversation data" (PP:477, 481); the wording goes to the counsel backlog | PROPOSED
Id: `SCL-216` allocated sequentially in the same session as `SCL-215` (2026-10-05), from the same register scan (highest anywhere `SCL-214`; open PRs #1118, #1115, #1113, #1048, #728 covered by the fetch). One entry allocated.
Owner ruling recorded: Karl, 2026-10-05, cleanup-retention brief row C-01 — "A crisis-flagged conversation (RS-00 definition: any linked `crisis_review_cases` or `crisis_review_events` row) survives account deletion, de-linked from the student, until the safety owner purges it manually. This is de-linked, not anonymous … Crisis data outranks the Privacy Policy's under-13 'across all Lyceon systems' line … Record a counsel-backlog row for the wording; don't edit legal text."
WAS (D03:1255, verbatim): "| Crisis-flagged conversations | 180 days (extended for safety review) | Manual purge by safety review queue owner after incident closure | 180 days |" — silent on account deletion; the build's profile FK CASCADE (20260917130000_declarative_fk_delete_actions.sql:138-139) destroyed the transcript whenever the account was deleted, while the 7d retention sweep (RS-00) kept it.
WAS (PP:477, verbatim): "Where we determine that a user is under thirteen (13) years of age, the account undergoes hard deletion across all Lyceon systems. This includes:" and PP:481 "* LISA conversation data".
IS: on account deletion (both `hard_delete` and `anonymize`), every conversation of that student named by any `crisis_review_cases` or `crisis_review_events` row survives with all its messages; `student_id` is NULL on the conversation and on each message, and the conversation is marked `crisis_flagged`. The crisis case keeps its `conversation_id`. Unflagged conversations are deleted as before; child rows that carry their own student_id (instruction rows, question links, injection log, memory summaries) are deleted as before. A NULL student_id is permitted only on a flagged conversation (CHECK) and only on a message of a de-linked flagged conversation (constraint trigger). The record is de-linked, not anonymous: the transcript is the student's own words. Removal stays manual by the safety owner (D03:1255).
Why: the RS-00 ruling holds flagged transcripts against the 7d sweep; the account cascade was a second door through which they were destroyed. Production context (owner, 2026-09-18, Phase 6): two of 117 profiles held crisis-flagged conversations. In practice no under-13 LISA rows exist (LISA is blocked for under-13), so the PP conflict has no rows today.
Disclosure: counsel backlog — the Privacy Policy's under-13 hard-deletion list names LISA conversation data; no legal text is edited here.
Owner action: apply `supabase/migrations/20261027000001_crisis_hold_on_account_deletion.sql`. PROPOSED until live (SCL-159).
Build artifact: the migration (two DROP NOT NULL, CHECK `tutor_conversations_null_student_only_flagged`, constraint trigger `tutor_messages_null_student_only_flagged`, `execute_account_deletion_cascade` = 20261008000000's body plus the CRISIS HOLD block); `server/services/tutor-compaction.ts` refuses a conversation with no student (`conversation_owner_deleted`); genesis snapshot regenerated. Proof: `tests/ci/deletion-phase-6.pg.ci.test.ts` P6.8 (both modes; red first: all three conversations destroyed), P6.9, P6.10; `server/__tests__/tutor-compaction.test.ts` (red first). Plants M99–M102 in `scripts/ci/deletion-evidence-gate.mutations.sh`, each reddening its own case.

SCL-217 | 2026-10-05 | Amends Doc 01A Part IV §31 / the idempotency TTL table and purge cron (01A:959-975), Doc 01A Part VII §61–§71 (HMAC internal service auth, §64 `service_auth_secrets`) and Doc 01 V8 D01:608 (`profiles.last_login_at`): the three primitives are retired, never having been built or written. Internal service auth is OIDC only (Doc 03C §9.3) | PROPOSED
Id: `SCL-217` allocated sequentially in the same session as `SCL-215` and `SCL-216` (2026-10-05), from the same register scan (highest anywhere `SCL-214`). One entry allocated.
Owner ruling recorded: Karl, 2026-10-05, cleanup-retention brief row C-03 — "Q16: retire `idempotency_records` and `idempotency_runtime_config` (no writer). Stripe webhook records stay at 7 years. Q17: `service_auth_secrets`, the HMAC signing code … No route uses that signing method any more; everything uses OIDC. … `profiles.last_login_at`: Drop the column (it's never written)." The inactivity signal is `auth.users.last_sign_in_at` (recorded ruling, C-04).
WAS (01A:973-975, verbatim): "Expired records are purged by a daily cron (`idempotency_retention_cron`): DELETE FROM idempotency\_records WHERE expires\_at \< now();" with the per-scope TTL table above it (01A:961-971).
WAS (01A Part VII, 01A:1595, heading verbatim): "Part VII — Internal Service Auth (HMAC)", §61–§71, with §64 "Secret management" over `service_auth_secrets`.
WAS (D01:608, verbatim): "5. `profiles.last_login_at` updated on successful authentication"
IS: `idempotency_records`, `idempotency_runtime_config` (+ `_history`) and `service_auth_secrets` do not exist; `profiles.last_login_at` does not exist. Idempotency is carried by domain columns (`tutor_messages.client_turn_id`, `test_answer_submissions.idempotency_key`, `calendar_mutation_ledger.idempotency_key`, `practice_session_items.client_attempt_id`, …) and `stripe_webhook_events`, which stays at 7 years (B2, 2026-09-22). Every internal route authenticates by OIDC with an exact audience (`packages/shared/internal-auth/verify-oidc-middleware.ts`); there is no HMAC path. No column records last login; the activity signal for inactivity is `auth.users.last_sign_in_at` (ruling recorded in `docs/plans/Cleanup_Retention_Plan.md`, C-04).
Why: none of the three was ever written. Established 2026-10-05: `idempotency_records` has no writer (`server/lib/stripe/purchase-idempotency.ts`, `server/routes/tutor-runtime.ts` both say so); the HMAC modules were imported by no route (the three internal route files import `verify-oidc-middleware` only) and by one test proof; `last_login_at` appears only in genesis and an unused client type field.
Disclosure: none.
Owner action: run the read-only pre-apply counts in the PR, then apply `supabase/migrations/20261027000002_drop_dead_retention_tables.sql`. PROPOSED until live (SCL-159).
Build artifact: the migration (plain DROPs, no CASCADE); `packages/shared/internal-auth/{load-secrets,sign-request,verify-middleware}.ts` deleted and the barrel reduced to the OIDC exports; proof (g) removed from `tests/ci/memory-compaction.ephemeral-pg.proof.test.ts`; `client/src/lib/supabase.ts` type field removed; `scripts/ci/genesis-fresh-apply.sh` C.5 list and `contracts/ws1-genesis-foundation.contract.md` C.1/C.5 updated; genesis snapshot regenerated (removals only, 0 lines added). Also C-03: `tests/ci/audit-changes-no-email.contract.test.ts` (Q15, no SCL: a check, not a behaviour change).

SCL-219 | 2026-10-05 | Records amendments to the Privacy Policy (`docs/Spec/Lyceon Privacy Policy.md`, not edited — SCL only, owner ruling 2026-10-05) as published in `legal/privacy-policy/v5`: guardian visibility, flagged LISA content held until the safety review closes, the account-deletion exception for flagged content, the 12-month inactivity deletion with a 48-hour notice, and four contradiction fixes (analytics provider, under-13 accounts, consent-record retention, the 365-day audit line). Every account re-accepts | PROPOSED
Id: `SCL-219` derived at the moment of use, 2026-10-05, after `git fetch --all --prune`, by the register scan across every remote ref: the highest allocated anywhere is `SCL-218` (on `origin/claude/seo-doc-10a`). Open PRs' head branches are in this repository and covered by the fetch. One entry allocated.
Owner ruling recorded: Karl, 2026-10-05 — "One-time permission: Privacy Policy text changes (counsel-approved, 2026-10-05). Karl grants a one-time exception to the no-legal-edits rule for exactly the changes below." And the v5 rulings: "Re-acceptance: accepted. Publish as v5, and every user re-accepts." "Contradictions: fold all four into v5 … Mark each draft 'pending counsel wording'." "Spec copy: SCL only; don't edit `docs/Spec`." Counsel approval of the redeemed guardian link as under-13 consent (SCL-187) is recorded by the same permission; no text change.
WAS (legal/privacy-policy/v4/en.md, sealed, unchanged): v4 (4.0, 2026-09-22) is current; guardian visibility is described at v4:123; flagged LISA content, inactivity deletion and the 48-hour notice are not in §6.1/§6.2; v4:176 keeps consent records "3 years"; v4:187 describes under-13 accounts without the guardian-link condition; v4:191 gives the 365-day audit line with no exception; v4:197 and the provider table name Vercel Analytics.
IS: `legal/privacy-policy/v5/en.md` (5.0) is current (`manifest.json` `current: "v5"`). Changes against v4, and nothing else: (1) v4:123 guardian visibility — domain-level mastery, calendar and progress, projected and target scores, full-length test results; no skill-level detail, answers or LISA conversations (resolves SCL-194's Privacy Policy row). (2) §6.1: flagged conversations kept until the safety review team closes the case, then deleted by that team. (3) §6.2: flagged conversations are the one exception to deletion — disconnected from the account, kept until the review closes. (4) §6.1: inactive accounts deleted after 12 months, with at least 48 hours' email notice to the user (and a student's linked guardian); signing in cancels. (A) Analytics is PostHog, consent-only, never under 13. (B) Under-13 accounts only with an active guardian connection, otherwise deleted. (C) Consent records kept permanently (SCL-215). (D) The 365-day audit line excepts guardian connect/disconnect records (SCL-215). (A)–(D) and the first sentence of (4) are drafts pending counsel wording.
Why: counsel approved (1)–(4) on 2026-10-05; v4 is sealed by the immutability gate, so any text change is a new version, and the outstanding-consent check compares the accepted `doc_version` with the current one, so every account is asked to re-accept.
Disclosure: this entry is the disclosure. `effective_date` in `v5/meta.yml` is 2026-10-05 and is set to the sign-off date before merge.
Owner action: send the v5 diff to counsel; nothing merges until counsel signs off on the final text.
Build artifact: `legal/privacy-policy/v5/{en.md,meta.yml}`; `legal/privacy-policy/manifest.json`; `server/lib/legal-registry.generated.ts` (regenerated); `tests/ci/consent-outstanding-set.contract.test.ts` (a v4 acceptance is re-asked for v5, and only for that; red with the manifest on v4). Plan rows: `docs/plans/Guardian_Closure_Plan.md` and `docs/plans/Cleanup_Retention_Plan.md` counsel backlogs.
SCL-218 | 2026-10-05 | Amends Doc 10 §8.2 (the QOTD explanation source), §7.2 (the written-testimonials direction) and §11.6 (Category 1 approval): Doc 10A's three departures from locked Doc 10 — the Question of the Day reveals a PRE-WRITTEN explanation, not LISA's; testimonials come only from opted-in, anonymous in-app reviews; a Lyceon-specific Category 1 claim needs Karl's written approval (Public Disclosure Doctrine rule 5). To be ruled at Doc 10A's lock | PROPOSED
Id: `SCL-218` derived at the moment of use, 2026-10-05, after `git fetch --all --prune`, by `git branch -r --format='%(refname:short)' | while read b; do git grep -hoE 'SCL-[0-9]{3}' "$b" -- docs/SpecAudit/SPEC_CHANGES_LOG.md; done | sort -u | tail -1` across 171 remote refs: the highest allocated anywhere is `SCL-217`; no branch carries 218 or above. Open PRs checked, all six (#1125, #1124, #1123, #1115, #1048, #728): every head branch is in this repository and therefore covered by the fetch. One entry allocated.
Owner ruling recorded: Karl, 2026-10-05, answers on #1125 (Doc 10A draft §11.3), item 2 — "Departures from Doc 10: yes. Add one PROPOSED SCL recording Doc 10A's departures from locked Doc 10 (§8.2 explanation source, the testimonials direction, Category 1 now under Karl's approval rule), to be ruled at lock." Underlying rulings: plan R17 (`docs/plans/seo/seo-marketing-vertical.md:59`, "pre-written explanation revealed on submit (not LISA)"), R29 (`:80`, "Testimonials only from opted-in reviews, anonymous, labelled as testimonials, bucketed student/guardian; no first-party aggregate rating"), doctrine rule 5 (`:17`) and G6 Step 0 answer 5 (2026-10-05: Doc 10 §11.6's four categories with rule 5 layered on top). Plan row G6.
WAS, verbatim (`Lyceon — Document 10_ Brand, Public Narrative & Pre-Launch Legal Document Program.md`):
  (1) §8.2 (`:419`): "LISA's explanation of each QOTD demonstrates LISA's pedagogical voice publicly; this is brand voice consistency between in-product and in-channel"
  (2) §7.2 (`:384`): "**Written testimonials.** Opt-in collection from students who voluntarily provide testimonials about their Lyceon experience. Used on marketing site with student consent and demographic representation discipline …"
  (3) §11.6 (`:864`, Category 1 row): "No founder approval required if claim is true on the live product as of publication"; (`:871`): "Only Category 1 and Category 3 claims may appear on public marketing pages without founder review"
IS:
  (1) The QOTD reveals the question's pre-written explanation on submit; LISA is not involved in the public QOTD (`server/routes/public-qotd-routes.ts:308-317`; Doc 10A draft §5.3). Doc 10 §8.2's other brand-and-trust bullets stand.
  (2) Testimonials come only from in-app reviews whose author ticked "Lyceon may quote this anonymously" (unticked by default): anonymous, labelled as testimonials, bucketed student/guardian; no first-party aggregate rating; never paid, incentivised, fabricated or a synthetic person (`client/src/components/product-feedback/ReviewPrompt.tsx:270-284`; Doc 10A draft §7.6). §7.2's demographic-representation discipline (§7.3) still applies to which opted-in reviews are shown.
  (3) Doc 10 §11.6's four categories stand. A Category 1 claim that is Lyceon-specific needs Karl's written approval before publication; generic, industry-standard wording (doctrine rule 1) needs none. Doctrine rule 2 refuses a mechanism whatever its category, so §11.6's own Category 1 example "Lyceon adapts question difficulty to your mastery level" (`:864`) is not usable public copy (Doc 10A draft §3.1, CR-10A-02).
Why: Doc 10 locked 2026-05-31; the doctrine (2026-10-02) and rulings R17/R29 came later and govern every public surface (plan R7). Without an entry, Doc 10A would contradict a locked document silently.
Disclosure: none — these narrow what is published.
Owner action: rule this entry at Doc 10A's lock. Doc 10 §7.2, §8.2 and §11.6 are unchanged until then.
Build artifact: none (docs only). Doc 10A draft `docs/plans/seo/doc-10a-draft.md` §1.4, §3.1, §5.3, §7.6, §11.2, CR-10A-02, CR-10A-03.

SCL-220 | 2026-10-07 | Records amendments to the Privacy Policy (`docs/Spec/Lyceon Privacy Policy.md`, not edited — SCL only) as published in `legal/privacy-policy/v6`: the SEO and marketing vertical's launch items (cookie consent and its log, Global Privacy Control, first-touch attribution, homepage experiment, session recording, Question of the Day, in-app reviews and private feedback, the Trustpilot link, marketing email consent) folded into v5's text; analytics events kept up to 12 months, session recordings 30 days. v6 is the single launch version; every account re-accepts | PROPOSED
Id: `SCL-220` derived at the moment of use, 2026-10-07, after `git fetch --all --prune`, by the register scan across every remote ref: the highest allocated anywhere is `SCL-219`. Every open PR's head branch is in this repository and covered by the fetch. One entry allocated.
Owner ruling recorded: Karl, 2026-10-07 — "v5 (#1128) is published on `main` and sealed by the immutability gate. Karl's ruling: one more version, v6, which bundles every remaining policy change before launch. After v6 the policy stays frozen through launch. v5 stays untouched." Bound rulings: session replay on per R32 / SCL-204 (public and signed-in pages, after consent, never under 13; masked: question and answer areas, LISA conversations, review and feedback text, typed inputs; recordings 30 days); analytics events kept up to 12 months, then deleted; in-app analytics disclosed; US only at launch. The CTO advisor's brief of 2026-10-06 (P-1 to P-4) is covered: P-1 is decided by R32 (replay on, masked, disclosed, not off); P-2 is the §6.6 retention line; P-3 — v5's sentence "We use PostHog to understand how the service is used, only if you accept analytics cookies, and never for users under 13." does not say the signed-in app, so §9 adds it; P-4 — no ad, social or attribution pixel exists, PostHog runs with person_profiles identified_only and no identify call, no surveys or heatmaps, one feature flag (homepage-hero), Question of the Day stores only daily totals, marketing email consent is logged, processors Resend and Cloudflare (Turnstile) added.
WAS (legal/privacy-policy/v5/en.md, sealed, unchanged): §6.6 "Analytics data is kept for 12 months. Where analytics data has been separated from anything identifying, we keep it for up to 24 months, then only in aggregate."; §9 "Cookies and Tracking" with no consent, GPC, session recording or attribution text; no reviews, feedback, marketing consent, Question of the Day, Resend or Cloudflare.
IS: `legal/privacy-policy/v6/en.md` (6.0) is current. Against v5, and nothing else: §1.1 reviews, private feedback, marketing choice; §1.3 cookies point to §9, first-touch channel; §2 analytics and testing, reviews and feedback, anonymous quoting, marketing record, opt-in marketing; §4.3 under-13 exclusions (analytics and recording, marketing, reviews; private feedback allowed); §5.2 PostHog row widened to session recording, Resend and Cloudflare (Turnstile) added, the stale Google Cloud (BigQuery) row removed (the archive was removed by the owner ruling of 2026-09-22), Trustpilot described as a link to its own site (nothing sent to it); §6.1 reviews, feedback and marketing record deleted with the account; §6.6 events up to 12 months then deleted, recordings 30 days; §8.1 GPC honored; §9 rewritten as "Cookies, Analytics and Session Recording" (consent and its log, GPC as refusal, website and signed-in app, IP anonymized, masking, first-touch, testing, under-13 exclusion), §9.1 Question of the Day, §9.2 Marketing Emails. The separate draft `docs/compliance/legal-drafts/privacy-policy-v5.md` is retired with a pointer to v6.
Owner answers recorded: Karl, 2026-10-07 — (1) Trustpilot: the link only, for guardians and students 18+; invitations are post-launch. (2) "You can opt out of marketing emails at any time in your account settings or by using the unsubscribe link in any marketing email." (3) Billing Terms and Parent/Guardian Terms unchanged; v6 keeps its general international sections. (4) Remove the stale BigQuery processor row. (5) "We keep a record of your cookie choices for as long as needed to show that we have your consent." (6) Session replay described in standard terms: session recordings of how pages are used, only with consent, certain content masked, kept for 30 days.
Folded in (Karl, 2026-10-07, legal-drafts brief — "Fold content into Privacy Policy v6 where that's standard"): the Children's Online Privacy Notice (§4 intro, §4.1 corrected to what an unlinked under-13 account holds — v5 said only the guardian email, the account holds name, email, date of birth and sign-in details — §4.3 COPPA collection/use/disclosure statements, §4.4 parent rights to review, correct, delete and refuse further collection, §4.7 operator contact and material-change notice); the California Notice at Collection (§8.1 categories table, retention matching the registry); Do Not Sell or Share / GPC (§5.4: none in the past 12 months, under-16 opt-in, GPC as opt-out); the Sub-Processor List (§5.2: Google sign-in, Desmos and Slack added, Google Cloud row widened to content safety and background processing, update-before-engaging commitment). The drafts in `docs/compliance/legal-drafts/` are retired with pointers. Karl supplies the postal address and telephone number in §4.7 before merge.
Why: one counsel review and one re-acceptance for everything shipping at launch. Facts read 2026-10-07: PostHog project `anonymize_ips: true`, `session_recording_masking_config.maskAllInputs: true`, `session_recording_retention_period: 30d`; code as cited in the PR.
Disclosure: this entry. Approved by Karl (the approver; there is no external counsel) on 2026-10-07; `effective_date` in `v6/meta.yml` is 2026-10-07.
Owner action: Karl merges #1138 to `cleanup`, then `main`. Before the first marketing email is sent, the unsubscribe link §9.2 promises must exist (not built today).
Build artifact: `legal/privacy-policy/v6/{en.md,meta.yml}`; `manifest.json` `current: "v6"`; `server/lib/legal-registry.generated.ts`; `infra/retention-policy-registry.yaml` (citations to v6; RPOL-ANALYTICS-03 is now PostHog events; RPOL-ANALYTICS-05 session recordings, 30 days); `tests/ci/consent-outstanding-set.contract.test.ts` (5.0 and 4.0 acceptances are re-asked for v6; red with the manifest on v5); `tests/ci/retention-policy-registry.contract.test.ts` F1.9 bounds §6 at the next top-level heading; `tests/ci/retention-policy-publication.contract.test.ts` pins the published body; mutation M59 re-pointed; plan ruling R34 in `docs/plans/seo/seo-marketing-vertical.md`.
