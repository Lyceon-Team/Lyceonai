# Lyceon Spec-Changes Log

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

SCL-042 | 2026-08-19 | Doc 05B §4.9 KPI fan-out — section/overall validators quarantine instead of aborting the mastery transaction | PROPOSED
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
Change: Doc 05B specifies that all four KPI refreshers validate canonical event history and RAISE `KPI_HISTORICAL_DATA_INVALID` on any row with NULL `correct` or NULL `occurred_at` (RB-05B-V1-02, matching 05A's hard-fail pattern per RB-05A-V1-22). Two of the four validate far beyond the event being written: `refresh_section_kpi` scans the whole (student, section) and `refresh_overall_kpi` scans the whole student, with no domain or section filter. Both are invoked by `refresh_domain_mastery` §4.9 inside `apply_mastery_event`'s transaction, downstream of the audit insert. A single malformed row anywhere in a student's history therefore rolls back every mastery write for that student — skill mastery, audit row, domain mastery, and projection refresh counter — permanently and for every domain. This ruling replaces RAISE with counted quarantine in those two functions only.
WAS: All four KPI refreshers hard-fail on NULL `correct`/`occurred_at`. Deployed function bodies carry the inline comment "RB-05B-V1-02: explicit data-integrity validation, no silent NULL filter." The validation predicate in `refresh_section_kpi` is `pi.user_id = p_student_id AND pi.status = 'answered' AND pi.question_section = p_section` UNION the equivalent over `review_error_attempts`; in `refresh_overall_kpi` it is `pi.user_id = p_student_id AND pi.status = 'answered'` with no section or domain restriction. `refresh_domain_mastery` §4.9 documents that any failure in the chain rolls back the whole chain.
IS: In `refresh_section_kpi` and `refresh_overall_kpi` only, the identical predicate now classifies rather than aborts: (a) the count of offending rows is computed into `v_excluded_count`; (b) `AND correct IS NOT NULL AND occurred_at IS NOT NULL` is added to the event CTE (`section_events` / `all_events`) so excluded rows enter no aggregate; (c) `v_excluded_count` is persisted on the KPI row via new column `excluded_event_count integer NOT NULL DEFAULT 0` on `student_section_kpi` and `student_overall_kpi`; (d) when `v_excluded_count > 0`, one row is upserted into new table `mastery_data_quality_incidents` (`incident_id`, `student_id`, `actor_id`, `scope CHECK IN ('section','overall')`, `section`, `refresher`, `excluded_event_count CHECK (> 0)`, `first_seen_at`, `last_seen_at`, `kpi_refresh_version`; UNIQUE on `(student_id, refresher, section)` with the overall scope's NULL section normalised so the constraint is not defeated; RLS enabled, service-role-only grants, revoked from PUBLIC, matching `mastery_event_audit_log`). `compute_mastery_for_entity`, `refresh_domain_kpi`, `refresh_skill_kpi`, `apply_mastery_event`, and 05C's `PROJECTION_MASTERY_TERM_NULL` are unchanged.
Rationale: KPI rollups are display surfaces — streak counts, activity counts, recency-windowed accuracy — and are materialized derivatives under INV-05B-14. Mastery is the product truth anchor from which the projected score derives. The current design lets a data-quality problem in a display surface roll back a valid write to the truth anchor: an inverted dependency in which the less important surface is a hard availability dependency of the more important one. This ruling corrects the direction of that dependency; it does not weaken validation, it relocates the consequence of failed validation from "abort the transaction" to "exclude, count, persist, alert."
This partially reverses RB-05B-V1-02, and the reversal is the part that should be tested hardest. RB-05B-V1-02 was correct to reject the silent NULL filter, and correct for the reason it gave: a silent filter makes corrupt data indistinguishable from absent data and yields a KPI nobody can audit. This ruling does not restore the silent filter. It specifies a third behaviour RB-05B-V1-02 did not consider, because at the time the widening scope was not recognised as distinct from the domain scope. Silent filter: rows dropped, no trace, no blast radius. Hard fail: transaction aborted, the RAISE is the only record, blast radius student-wide. Quarantine: rows excluded, count persisted per student and per refresher with first/last-seen timestamps and an alert, blast radius domain. Quarantine is strictly more auditable than the RAISE, which records only that something was wrong at one instant and leaves no durable artifact. If "counted, persisted, alertable" is judged not materially different from "silent," this ruling should be rejected — that distinction is the whole case.
`refresh_domain_kpi` and `refresh_skill_kpi` remain fail-closed despite costing nothing to change, because for any given event `compute_mastery_for_entity('domain', D)` raises earlier on the same corrupt data, making the domain-scoped KPI raise unreachable for that event. Quarantining them would remove the last fail-closed behaviour at KPI grain for no additional containment.
Evidence:

* Production outage 2026-06-26 → 2026-08-17: 84 answered `practice_session_items` produced zero mastery output. `student_projection_refresh_state` — written by `bump_projection_refresh_counter`, the final statement of `apply_mastery_event` — held zero rows, proving the function never once ran to completion.
* Proximate cause was 42 `practice_session_items` rows with NULL `occurred_at` from a handler defect fixed in `f0bc31e` (2026-08-08). All four affected students held at least one such row.
* Scope proven by counterexample rather than inference: on 2026-08-15 the affected student had two fully clean domains (`Craft and Structure`, `Standard English Conventions`, five diagnostic items each, zero NULLs). Direct read-only invocation of `compute_mastery_for_entity(student,'domain','RW','Craft and Structure',NULL)` returned cleanly (total_events 5, mastery_score 0.5217, level 2), while the poisoned sibling `('M','Advanced Math')` raised `MASTERY_HISTORICAL_DATA_INVALID: bad rows (..., occurred_at=5, ...)`. Zero audit rows existed for the clean domains. Domain-scope validation alone cannot explain that; only the section-wide and student-wide KPI validators can.
* Independent audit (Codex, read-only) confirmed the poison seed in the reproduction test is `status='answered'` in a different SECTION from the event under test, so section-scoped validation cannot account for the failure and `refresh_overall_kpi` is load-bearing.
* Verified read-only against prod 2026-08-19: zero rows with NULL `correct`/`occurred_at` remain, repaired by `20260816000000` and sealed by CHECK `psi_resolved_requires_occurred_at`.

Boundary: this ruling applies only to `refresh_section_kpi` and `refresh_overall_kpi`. It does not relax `compute_mastery_for_entity`'s entity-scope validation — a domain whose own events are corrupt must refuse to produce a mastery number rather than produce a plausible wrong one; that posture is what preserved the evidence during the outage. It does not relax the domain-scoped refreshers. `excluded_event_count` and `mastery_data_quality_incidents` are operator-only: Doc 05 Parent acceptance criterion #20 locks student and guardian read surfaces to `mastery_level`, and surfacing an exclusion count to a student would breach it and expose an internal data-quality problem to someone who can do nothing about it. Alerting routes to the existing mastery derivation-gap surface (`20260816020000` / `20260818000000`) — one surface, one query, one alert; a second channel would recreate the condition that let this outage run seven weeks unnoticed.
Version: Doc 05B V1.0 §4.9 KPI fan-out semantics are superseded for `refresh_section_kpi` and `refresh_overall_kpi` only. RB-05B-V1-02 is partially superseded for the same two functions and stands unchanged for `refresh_domain_kpi` and `refresh_skill_kpi`. INV-05B-14 continues to hold — `excluded_event_count` is recomputed on every refresh from the same event set as every other column and stores no independent state. INV-05B-13 and 05A INV-05A-10 are untouched. Two invariants are added: INV-05B-15 — when either amended refresher excludes any event, the count is persisted on the KPI row AND an incident ledger row exists for that (student, refresher, section); a KPI row with `excluded_event_count > 0` and no ledger row is a defect. INV-05B-16 — a corrupt row in section A must not prevent a valid mastery event in section B from committing its skill mastery row, its audit row, and its projection refresh counter. Proving mechanisms: INV-05B-15 by a gate seeding N corrupt rows in one section and asserting `excluded_event_count = N` plus exactly one ledger row, red when the ledger insert is removed; INV-05B-16 by a gate seeding a corrupt answered row in one section, submitting a clean answer in another, and asserting one `mastery_event_audit_log` row and one `student_projection_refresh_state` row — the outage reproduced as a permanent test — red when the RAISE is restored in `refresh_overall_kpi`.
Owner action: at next spec pass, amend Doc 05B §4.9 to specify quarantine semantics for the two widening refreshers and reword the "any failure rolls back the whole chain" statement to name the new boundary precisely — mastery and domain refresh remain transactional with the event; section and overall KPI aggregation quarantines rather than aborts. Schema change: two `excluded_event_count` columns and one `mastery_data_quality_incidents` table. Code change: `refresh_section_kpi` and `refresh_overall_kpi` bodies. Open for the ruling: (1) whether the `review_error_attempts` NOT-NULL seal ships in this change or separately — that table participates in both amended validators' event sets and has no equivalent to `psi_resolved_requires_occurred_at`, leaving the same defect class an unguarded ingress; (2) retention rule for `mastery_data_quality_incidents`, which is unbounded as specified — inherit Doc 07E or set its own; (3) alert threshold — recommendation is any non-zero pre-launch, since volume is low and a threshold is a place for a real problem to hide.
Artifact: draft under advisory review; implementation PR not yet opened. Rationale for the alternative rejected: moving KPI refresh to an outbox is architecturally cleaner and matches Doc 04B's `mastery_outbox` posture, but does not fix the defect — an outbox-driven `refresh_overall_kpi` still raises on the same data, converting a loud rollback into a silently stale KPI, a worse observability outcome; it also breaks Doc 05B's locked Q3 "sync" answer and weakens INV-05B-14 by making every KPI read a read of possibly-unrefreshed state, at the cost of a new outbox table, dispatcher, retry semantics and ordering guarantees to solve a problem three function bodies solve. The outbox remains worth revisiting only if KPI refresh latency becomes a product problem, which Doc 05B already names as a deferred migration path.

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
