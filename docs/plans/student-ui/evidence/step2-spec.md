# Step 2: Student UI vertical (Track A + §2 rulings) checked against the locked spec

Read-only check. Repo `/home/user/Lyceonai` @ `claude/student-ui-docs`. Register: `docs/plans/student-ui/student-ui-vertical.md`.
Short names used below:
- D01 = `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md`
- D01A = `docs/Spec/Lyceon — Document 01A_ Platform Primitives.md`
- D02B = `docs/Spec/Lyceon — Document 02B_ Runtime Engines (V4).md`
- D03B = `docs/Spec/Doc 03B — LISA API and Runtime Flow.md`
- D04A = `docs/Spec/Doc 04A — Exam Runtime & Session State.md`
- D04C = `docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md`
- D05P = `docs/Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md`
- D05B = `docs/Spec/Doc 05B — Domain Mastery & KPI Rollups.md`
- D05C = `docs/Spec/Doc 05C — Score Projections & Snapshots.md`
- D05F = `docs/Spec/Lyceon_Doc_05F.md`
- CS = `docs/Spec/lyceon-coding-standards.md`
- SCL = `docs/SpecAudit/SPEC_CHANGES_LOG.md`

How the SCL register governs: under SCL-159 (RULING, SCL:3867) locked documents are never edited, and "the register IS the change record". PROPOSED means "authorised but not live". APPLIED means "LIVE in code, database or configuration". An SCL entry therefore amends the document it names.

---

## Q1. What status and body does the spec require for an entitlement denial? Does 402 + `{error:{message, code:"entitlement_required", details:{feature}}}` agree?

**CONFLICTS. The spec has no single denial contract. It is split by surface, and UI-01's uniform 402 in the nested shape disagrees with three locked documents.**

| Source | What it says | file:line |
|---|---|---|
| D01 (EntitlementService) | Gives the interface only, no HTTP status: `canAccessFeature` "returns allow/deny + reason". The only HTTP code it defines is for failure: "`503 Service Unavailable` with error code `entitlement_check_unavailable`" | D01:1047, D01:1090-1093, D01:1310 |
| D01 role helper | `403` `{ error: { code: 'role_not_permitted', message: ... } }`. This is for role, not entitlement | D01:900-904 |
| D01A error catalog | Has no entitlement error class. The HTTP map covers 409/429/401/503/500 only | D01A:147-161 |
| CS §8.2 | `{ error: { message: string; code?: string; details?: unknown } }` | CS:280-287 |
| CS §8.3 | Lists `Unauthorized | 403`. **402 is not mentioned anywhere in CS.** | CS:290-301 |
| **D03B §5.9, LISA** | "`Not Paid tier or inactive entitlement | 403 | entitlement_required`" and "**Status code change from V1 (CR-03B-21):** V1 used `402 Payment Required` for entitlement failures. V2 changes to `403 Forbidden` with `error.code = "entitlement_required"`. Rationale: 402 has inconsistent handling across HTTP proxies, CDNs, browser fetch, and client SDKs…" | D03B:487, D03B:498. Also :281-282, :416, :642, :1964, :2645, :3168, and the `tutor_error_codes` seed `('entitlement_required', 403, …)` at :3525 |
| D03A (older) | "Doc 03B API translates to 402 Payment Required". Superseded by D03B CR-03B-21 | D03A:1517-1518 |
| **D04A §16, exam runtime** | "**Entitlement.** Verify the authenticated student holds an active product entitlement that includes full-length exams (per Doc 01). Fail → `403 forbidden`." and "`forbidden` \| 403 \| Authenticated, but no entitlement or not the session owner" | D04A:1380, D04A:1392 |
| D04 Parent | "Auth failures are blocking (return 401/403). Entitlement failures are blocking." | D04:448 |
| **D05F §15, calendar** | "Errors: 400 · 401 · 402 (**shared CTA payload, flat platform shape so the existing upgrade component recognises it**; also the guardian's student being unentitled) … Every other calendar error uses the nested envelope of Coding Standards §8.2. **A policy denial is a decision, not a fault:** it settles at 402 or 403 with a structured log, never a 500." | D05F:740 (SCL-137 widens this to "402, 403 or 409", SCL:3650) |
| D05F §16 | "Student premium: full surface; free: 402 CTA; lapse: 402, rows retained." | D05F:760 |
| Review brief | "a policy denial is a decision; it settles at 200 or 402 with a structured log, never a 500." | `docs/Spec/Review_Vertical_Standards_Brief.md:55` |
| D01A §44, rate limits/quota | `429` with `{"error":{"code":"rate_limit_exceeded", …, "bucket", "limit", "resetAt", "retryAfterSeconds"}}`. `practice_daily_free` is a RateLimitLedger bucket | D01A:1170-1192, D01A:1219, D01A:2106 |

Per surface:
- **Tutor (UI-01 "LISA … 402")**: CONFLICTS with D03B:487/:498. The spec explicitly moved tutor off 402 and gave a reason. Current code matches the spec (`server/services/tutor-error-codes.ts:54-55`, `httpStatus: 403, code: "entitlement_required"`). No SCL reverses CR-03B-21.
- **Exam runtime (UI-01 "403 → 402")**: CONFLICTS with D04A:1380/:1392. No SCL moves the student exam runtime to 402. SCL-181 (PROPOSED, SCL:4190-4194) moves only the **guardian** exam surface to 402, via the resolver.
- **Calendar (UI-01 "keeps 402 and adopts the [nested] shape")**: The 402 status AGREES (D05F:740, :760). The nested shape CONFLICTS with D05F:740, which names the 402 as a "flat platform shape" and exempts it from the §8.2 nested envelope. The code states this deliberately at `server/lib/http-errors.ts:13-17` ("WHY THIS ONE IS FLAT … owner ruling, 2026-09-17").
- **Mastery / resolver 402**: 402 is settled for `/api/students/*` by SCL-171 (APPLIED, SCL:4005-4015) and SCL-181. The body shape is unspecified apart from D05F's "flat".
- **Practice quota (UI-01 "keeps its own code `practice_quota_exhausted` in the same shape")**: D01A §44/§46 gives 429 `rate_limit_exceeded` for bucket `practice_daily_free`. `contracts/freemium-practice-quota.contract.md:30` says "429 / block on exceed". D02B §13 says only "quota-exhausted response with countdown" and gives no code (D02B:542, :550). Current code returns **402** with `code: PRACTICE_FREE_DAILY_QUOTA_EXCEEDED` (`server/routes/practice-canonical.ts:1124-1130`, `:1481-1486`). No code `practice_quota_exhausted` exists. Keeping 402 conflicts with D01A §44. Whatever UI-01 does here needs an owner ruling.
- The code string `entitlement_required` AGREES with D03B. `details: { feature }` is SPEC SILENT but compatible with CS §8.2 `details?: unknown`.

**Net for UI-00d/UI-01:** a uniform 402 contract needs owner rulings (new SCL entries) that (a) reverse D03B CR-03B-21 for tutor, (b) amend D04A §16 step 2 for exam, (c) amend D05F §15's "flat platform shape" to the nested §8.2 shape, and (d) settle quota at 402 or 429 against D01A §44. CS §8.3 also lacks a 402 row, so (e) CS §8.3 would need a 402 row. Each of these goes into §9 as an owner question. None is an implementation choice.

## Q2. What is the canonical feature key set, including the tutor key?

**AGREES.** D01 §26.1 `FeatureKey` (D01:1112-1121) and the launch seed in §27.2 (D01:1167-1176):
`practice_daily_free` (free), `practice_unlimited`, **`tutor_access`**, `review_full`, `exam_full_length`, `calendar_access`, `mastery_detail`, `historical_trends` (all premium).
The consumers table in §33 (D01:1619-1625) gives "Tutor routes (Doc 03B) | `canAccessFeature(userId, 'tutor_access')`". D03B:68 and :919 say the same. Production genesis seeds exactly these keys (`supabase/migrations/00000000000000_genesis.sql:221-229`).
So UI-01's "the tutor key" is **`tutor_access`**. Replacing `isEntitlementActiveForProfile` with `canAccessFeature('tutor_access')` AGREES with D01 §33 and D01 §34's blocking condition (D01:1632: "any call site still using `isEntitlementActive` … directly").
Two caveats:
- The seed sets `tutor_access` `blocked_during_live_exam = TRUE`, but `canAccessFeature` reads only `required_tier, enabled` (SCL-172, PROPOSED, SCL:4021-4025). Switching LISA to it therefore does not by itself bring back a live-exam block.
- `review_full` is still seeded premium (D01:1172, genesis:225) even though review is free (see R-FREE below).

## Q3. Is the free user's diagnostic projection allowed only once, post-diagnostic?

**CONFLICTS (§2 "Free: the diagnostic and its projection … Paid: … every projection after the diagnostic").**
- D02B §12 Free Tier: "Free users also see a final-score projection (single overall score prediction) computed from their mastery." The matrix has "Overall score projection (single number) | Yes | Yes" and "Section-level projection | Yes | Yes" (D02B:462, D02B:481-482). The free projection is ongoing, not frozen at the diagnostic.
- D05C has no student entitlement gate. The student self-read RLS is `USING (student_id = auth.uid())` (D05C:785-790), and the §10.1 visibility matrix gives Student ✓ on current rows and snapshots (D05C:1233-1238). The projection refreshes continuously after the Q4 gate (D05C:28, §12 D05C:1338-1355).
- D05P:577: "Entitlement MAY gate mastery reads. Product surfaces that consume mastery data (dashboards, projections, hexagon) MAY be entitlement-gated at the route level." So gating is **permitted**, but D02B §12 affirmatively grants free users projections.
- No SCL amends D02B §12's projection rows. I grepped SCL for projection + free/paid/entitle and found nothing.
- The spec has no concept of a "diagnostic-only projection" (a snapshot frozen at diagnostic completion). This needs an owner question and an SCL amending D02B §12's two projection rows.

## Q4. Does any spec require the guardian denial to be 402 or 404 (resolveSubject)?

**AGREES with the current resolver (404 for no or revoked link, 402 for an unentitled student). This is settled by SCL, and the base docs said 403.**
- D05F §15: "**404 for a guardian with no link and for a revoked link alike** — a 403 would confirm the student exists…" (D05F:740). §19 row: "free 402, guardian no-link **404**, guardian revoked link **404**, guardian link-but-student-unentitled **402**" (D05F:875).
- SCL-171 (APPLIED, SCL:4005-4015): "§19's Routes row reads **404 / 404 / 402** … `resolveSubject` answers **404** for `not_linked` through the shared `sendNotFound` (`server/middleware/subject-resolver.ts:135`…)".
- SCL-181 (PROPOSED, SCL:4190-4194) extends the same rule to the guardian exam report and supersedes D04C §12.1's original "403 (no body)" and "200 unavailable" for guardians.
- UI-01's "`resolveSubject` adopts the shape" may change only the body. The 404/402 codes must stay. D05F:740 calls that 402 "flat platform shape" (see Q1).

## Q5. Does anything make UI-04 (retire `/tutor`) conflict with the spec?

**SPEC SILENT.** `grep -rn -i 'tutor transparency'` over `docs/Spec` and SCL returns nothing. No spec names the route `/tutor` or `/chat`. Doc 10 names a **legal** "AI Content Disclosure Notice" (Doc 10 row 15, `Lyceon — Document 10_….md:480`; §9.16 at :631-639, "Not yet drafted. Phase 2"). Doc 00 V6:295 requires interactive-AI disclosure to EU users. Neither ties that disclosure to the `/tutor` page.
**Caution, not a conflict:** the public SSR body at `server/seo-content.ts:796-830` is titled "Tutor Safety, Privacy, and Pedagogy". It carries public trust claims ("No answer leakage before submission", "Student data is not sold", guardian read-only), and `trust.tsx:159` and `trust-evidence.tsx:170-173` link to it ("Open /tutor"). Retiring the route removes the only public tutor-disclosure page before the Doc 10 AI notice exists. Suggest an owner question: move that content onto `/trust` (or the future AI notice) rather than delete it.

## Q6. OQ-5: what does Doc 04C require when a student with a lapsed plan opens a past exam report?

**The spec requires today's in-page "unavailable" state (HTTP 200). A UI-01 402 would CONFLICT with D04C.**
- D04C §16, student endpoint: "3. Verify the student's full-length entitlement is active per Doc 01. If false: classify as `revoked` with `reason: 'entitlement_lapsed'` → return HTTP 200 with the `unavailable` payload (§11.5b)." (D04C:914-915)
- D04C §5.3: "Returning HTTP 200 with an `unavailable` payload for revoked cases gives the UI enough information to render actionable copy ('renew your subscription' …). The split is Karl's V1.0 lock-cycle decision" (D04C:360-362)
- The payload carries `unavailable_reason: 'entitlement_lapsed'` and `resume_action: { type: 'renew_entitlement', url }` (D04C:838-844). This payload is already the hook for an upgrade CTA.
- D04D:752 tracks `exam_report_unavailable_returned` "with HTTP 200 (revoked access)".
- SCL-181 changes this to 402 **for the guardian surface only** (SCL:4194). No SCL touches the student report.
- Recommendation: rule OQ-5 as "keep 200 `unavailable`". The upgrade modal can open from `resume_action.type = 'renew_entitlement'` without changing the status. Otherwise an SCL is needed against D04C §16 and D04D:752.

## Q7. Caching and `staleTime` (UI-14), pagination (UI-16), notifications

**UI-14: SPEC SILENT on client `staleTime`.** Relevant constraints:
- D01A Part III (D01A:552-777) covers only **server** in-process caching with LISTEN/NOTIFY ("Postgres-only, no Redis", D01A:556). It says nothing about the client. The §2 ruling "caching doctrine is owned by Doc 01A Part III" AGREES on no new infrastructure but does not govern TanStack defaults.
- CS §11.2: TanStack Query for all server state (CS:346-350). AGREES.
- **D05F:831: "Server state via TanStack Query; refetch on window focus, so returning from a session shows progress without a reload; no polling".** TanStack refetches on focus only when a query is stale, so a long global default `staleTime` would break this on calendar queries. Calendar, and anything else that must reflect just-finished sessions, needs a short or zero `staleTime`.
- D04C §14.3: the `/report` payload in `scoring_pending` SHOULD use `Cache-Control: private, max-age=30`. Once `scored` it MAY be cached aggressively (`max-age=300`), because "only an entitlement change invalidates it" (D04C:1070-1077). Taxonomy and pricing are not mentioned anywhere.

**UI-16:**
- LISA history: **AGREES and already specified.** D03B §8.3 `GET /api/tutor/conversations`: "`limit` (default `validation.pagination_default` = 20, max `validation.pagination_max` = 100)" and "`cursor` (optional) — pagination cursor, opaque base64-encoded per §7.3" (D03B:749-750; cursor format CR-03B-28 at D03B:676-688). Per D01A §6 (no magic numbers, D01A:312-320) and D03B:159 ("pagination defaults … live in `t[utor_runtime_config]`"), 20 must come from config, not a literal.
- Notifications: `contracts/notifications.contract.md` C3.1 (line 112): "The same recipient rule and the same **keyset cursor** apply to both views". The client test is named "cursor pagination" (line 377). The contract gives no page size, so "20" is a new choice but compatible. A cursor already exists, so the row may be partly done already. Verify against code.
- Review past sessions: SPEC SILENT (D02B, `docs/contracts/review-contract.md`).

---

## Row-by-row / ruling-by-ruling verdicts

| Row / ruling | Verdict | Evidence |
|---|---|---|
| **UI-00d** (denial contract vs Doc 01/01A) | Owner questions are required. Doc 01/01A define **no** entitlement HTTP status. The locked statuses come from D03B (403), D04A (403), D05F (402 flat) and D01A §44 (429 quota) | Q1 table |
| **UI-01** 402 everywhere | **CONFLICTS** with D03B:487/:498 (tutor 403, CR-03B-21), D04A:1380/:1392 (exam 403), D05F:740 (calendar 402 is the *flat* shape) and CS §8.3 (no 402). The feature-key part and "LISA uses `canAccessFeature`" AGREE (D01:1619-1625) | Q1, Q2 |
| **UI-01** practice quota "keeps own code in same shape" | CONFLICTS or needs a ruling. D01A §44/§46 say 429 `rate_limit_exceeded`, and the contract says 429. Code is 402 `PRACTICE_FREE_DAILY_QUOTA_EXCEEDED`, and `practice_quota_exhausted` does not exist | D01A:1170-1192, :1219; contracts/freemium-practice-quota.contract.md:30 |
| **UI-02** gate `PUT /api/calendar/profile` | **CONFLICTS, hard.** D05F §15: "**Setup renders before the entitlement gate.** A free student receives `setup_required` rather than 402, so the popup opens and their test date and target score are stored either way. The 402 applies to the **plan payload**, not to setup … it is the only path by which a free student states either." (D05F:734). SCL-130 (**APPLIED**, SCL:3617-3627) lists "`PUT /profile` ungated" as its build artifact, and the code comment at `server/routes/calendar-routes.ts:543-551` cites it: "SETUP IS NOT GATED (owner ruling 2026-09-24, SCL-130)". UI-02 would reverse an applied owner ruling. Withdraw UI-02 or raise it as an owner question | D05F:734, :799; SCL:3619-3627 |
| **UI-03** return paths | SPEC SILENT (no return-path or `next=` rules anywhere in docs/Spec) | grep empty |
| **UI-04** retire `/tutor` | SPEC SILENT. The caution about the public trust content is in Q5 | Q5 |
| **UI-05** delete `/api/questions*` | AGREES in spirit (CS §5.2 anti-leak, CS §17). No spec requires those routes | grep of `/api/questions` in docs/Spec is empty |
| **UI-07** hide bank counts; `/api/questions/stats` admin-only | SPEC SILENT on bank counts. The "defined error when filters yield none" part AGREES with D02B:1561: "Prefill selection failure (no eligible questions) \| Return error to client; do not create session with fewer than target items without user consent" | D02B:1561 |
| **UI-14** query hygiene / `staleTime` | SPEC SILENT on client cache. Constraints: D05F:831 (refetch on focus), D04C:1070-1077 | Q7 |
| **UI-16** pagination 20 + cursor | LISA AGREES (already specified, config-driven). Notifications already use a keyset cursor, with no size given. Review is SILENT | Q7 |
| **§5 "Doc 08: calendar engine launch and completion contract"** | **WRONG CITATION.** Doc 08 opens: "**Status:** Strategic vision artifact. Not a contract." and "**Doc 08 is not a contract.** Nothing here binds anyone." (`Lyceon — Document 08_ Expansion.md:3`, :13). The calendar contract is **Doc 05F**: "# Lyceon — Document 05F: Study Calendar & Plan Generation … **Status:** LOCKED" and "**Naming:** this document was drafted as 'Doc 08'. Ruling ids keep the `R-08-*`, `INV-08-*` … prefixes" (D05F:1-8). §5 should link `docs/Spec/Lyceon_Doc_05F.md` (plus `Doc_05F_formula_sheet.md`) | as quoted |
| **§2 Free: 40 practice/day** | AGREES. D02B §13: "`practice_runtime_config.daily_quota_free` … (40 at launch)", reset at America/Chicago midnight (D02B:530). CR-02B-02 at D02B:2049. D01A appendix seeds `practice_daily_free` at `limit: 20` (D01A:2106, marked "illustrative"), which disagrees internally. The DB value 40 governs (contract :13-16) | |
| **§2 Free: unlimited review** (R-FREE) | Base docs CONFLICT: D02B §12 "Review queue access \| No" (D02B:477), CR-02B-02 "All other features (review, …) premium" (D02B:2049), D01 `review_full` premium (D01:1172, :1620). **Amended by SCL-110** (PROPOSED, SCL:3180-3195): "review is FREE FOR ALL TIERS, with no quota … Supersedes: CR-02B-02 in part". Its build artifact is live (`review-canonical.ts` ungated). So the ruling AGREES via SCL-110. The stale `review_full` seed row is a separate cleanup | |
| **§2 Free: diagnostic projection only; Paid: every later projection** | **CONFLICTS** with D02B §12 (D02B:462, :481-482). No SCL amends it | Q3 |
| **§2 Paid: Calendar, LISA, Full-Length, mastery** | AGREES. D02B §12 matrix (D02B:474-487), D01 §27.2, D05F R-08-09 (D05F:105) | |
| **§2 Paid: "KPIs"** | Partly SILENT. D02B has `historical_trends` premium but nothing on current KPIs. D05B:646/:652 exposes KPI accuracy to student-self with no tier | |
| **§2 Locked rail item opens a modal with no navigation and no call to the gated endpoint** | **CONFLICTS for Calendar.** D05F §17: "A free student sees the tab and the page answers 402 with the upgrade CTA — that is the upsell path, not a hidden route." (D05F:775). The §17.5 setup popup "opens **before** the entitlement gate" (D05F:799, :734) and is "the only path by which a free student states" a test date or target (D05F:734; SCL-130's rationale SCL:3623). A no-navigation lock on Calendar removes that path. D05F:775 also says "Calendar tab in the app's **top navigation**", which conflicts with "No top nav bar", a minor placement wording point | |
| **§2 Mastery shown as `mastery_level` only** | AGREES. D05P AC#20: "Read surfaces exposed to student-role and guardian-role routes return only `mastery_level` (the integer 0–4) …" (D05P:823) | |
| **§2 No raw accuracy percentages** | The ruling is narrower than the spec, which is allowed, but the spec disagrees with itself. D05B exposes KPI accuracy to the student ("Accuracy columns are exposed", D05B:646, :652). **D05P §12.2: "The product copy MUST present mastery as a measurement: 'you've answered X questions for this skill; your recency-weighted accuracy is Y%.'" (D05P:646)** contradicts both AC#20 and this ruling. Raise an owner question or SCL | |
| **§2 Ladder labels (Foundations…Strong, "Not enough answers yet")** | AGREES with `Doc_05F_formula_sheet.md:41` and the Review brief :90. D02C:107 has older labels ("Not Started, Needs Work…") and is superseded in practice | |
| **§2 Exam report domain breakdown uses the mastery row** | **CONFLICTS** with SCL-180 (PROPOSED 2026-09-27, SCL:4175-4185): D04C §8.1/§9.1 gain `domain_breakdown: [{section, domain, correct, total}]`, "identical to the rows the student sees", built in `client/src/features/exam/components/DomainBreakdown.tsx`. Correct-of-total is not a mastery level. This affects UI-34/UI-42 | |
| **§2 Performance: no new infrastructure; caching per 01A Part III** | AGREES (D01A:556 "Postgres-only, no Redis") | |
| **§2 Suggested for you is paid-only** | SPEC SILENT. Consistent with `mastery_detail` premium | |
| **§2 Students never see bank counts; `/api/questions/stats` admin-only** | SPEC SILENT | |

## Owner questions to add to §9 (proposed)
1. Tutor denial: reverse D03B CR-03B-21 (403 → 402)? Needs an SCL.
2. Exam runtime denial: amend D04A §16 step 2 (403 → 402)? Needs an SCL.
3. The 402 body: nested §8.2, which amends D05F:740 "flat platform shape", or keep it flat? Add a 402 row to CS §8.3?
4. Practice quota: 402 (current code) or 429 (D01A §44, freemium contract)?
5. UI-02 contradicts D05F:734 and SCL-130 (APPLIED). Withdraw UI-02?
6. Calendar lock-without-navigation vs D05F:775/:799 (the free setup path).
7. Free projection after the diagnostic: amend D02B §12 rows "Overall/Section-level projection | Yes | Yes"?
8. Exam report domain breakdown: mastery row (§2) or correct/total (SCL-180)?
9. D05P §12.2 "recency-weighted accuracy is Y%" vs AC#20 and the no-accuracy ruling.
10. OQ-5: the spec answer is "keep 200 `unavailable`" (D04C:915). Confirm, or file an SCL.
11. UI-04: preserve the public "Tutor Safety, Privacy, and Pedagogy" content (seo-content.ts:796+) somewhere before retiring `/tutor`?
