# Stripe Vertical — Grounding Audit (READ-ONLY)

**Type:** Read-only grounding audit. No implementation, no design, no recommendation.
**Date executed:** 2026-08-19
**Repo SHA / branch:** `claude/stripe-grounding-audit-u2tus0`
**Prod project:** Supabase `hncolwkccbbjkfithhlo` (MVP, us-east-2, PG 17.6.1.008) — all `SELECT`, no DDL, no DML.
**Deliverable scope:** this file only. No existing file was modified.

---

## ⚠️ CONDITION ON EVERY ANSWER BELOW — READ FIRST

**Doc 01 exists at V8.0 and V8 is the governing version.** Verified:

```
$ head -3 "docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md"
**Version:** V8.0 **Status:** CANONICAL (supersedes V7.1, V7.0, V6.0)
```

No version later than V8.0 exists in the corpus. **However — a second, superseded Doc 01 file is
still physically present in `docs/Spec/`:**

```
docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust (V6).md
  → **Version:** 6.0 **Status:** Authoritative Product + Engineering Directive
```

This matters for this audit specifically, because **the two files give opposite answers on payer
identity** (see Q-A1). A reader grepping `docs/Spec/` for "Stripe customer" hits the V6 file first
by filename sort. Every answer below is read against **V8.0 only**; V6 is cited only where it
conflicts.

The same duplication exists for Doc 00 (`Lyceon — Authoritative Platform Directive (Document 00,
V6).md` and `Lyceon — Document 00_ Authoritative Platform Directive (V6).md`, both V6.0) and for
Doc 03C (`Doc 03C — GCP Orchestration.md` V2.1 alongside `Doc 03C — GCP Orchestration V3.md` V3.0).
Neither affects a billing answer.

---

## 1. Corpus grounding

### 1.1 Document inventory

Version and status strings are taken verbatim from each file's header line. "Last commit" is
`git log -1 --format=%cs -- <file>`. Files with no `**Version:**` / `**Status:**` token in their
first 20 lines are recorded as blank, not guessed.

| File (under `docs/Spec/`) | Version (as stated in file) | Status (as stated in file) | Last commit |
|---|---|---|---|
| `Doc 02C — Mastery, KPI & Database Canonical Contract.md` | V4.0 | CANONICAL (supersedes V3.1) | 2026-05-31 |
| `Doc 03 — LISA (AI Tutor System).md` | V1.1 | CANONICAL (supersedes V1.0) | 2026-05-31 |
| `Doc 03A — LISA Context & Memory Runtime.md` | V3.0 | CANONICAL (supersedes V2.0) | 2026-05-31 |
| `Doc 03B — LISA API and Runtime Flow.md` | V4.1 | CANONICAL | 2026-05-31 |
| `Doc 03C — GCP Orchestration V3.md` | V3.0 | CANONICAL — FINAL | 2026-05-31 |
| `Doc 03C — GCP Orchestration.md` | V2.1 | CANONICAL (superseded in practice by V3 file) | 2026-05-31 |
| `Doc 03C — Operations Runbook V3.md` | V3.0 | Draft for lock | 2026-05-31 |
| `Doc 03C.1 — LISA Orchestrator Test Matrix V1.1.md` | V1.1 | Draft for lock | 2026-05-31 |
| `Doc 03D — LISA Evaluation & Quality V1.2.md` | (none in header) | (none in header) | 2026-08-15 |
| `Doc 04 — Full-Length Exams, Scoring, Diagnostics & Readiness.md` | V3.0 | (blank) | 2026-05-31 |
| `Doc 04A — Exam Runtime & Session State.md` | V2.2 | (blank) | 2026-06-06 |
| `Doc 04B Full length scoring V4.3/Lyceon_Doc_04B_V43.md` | 4.3 | Reviewer-Cleanup Pass; formula locked v1.0 | 2026-06-05 |
| `Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md` | V1.0 | (blank) | 2026-05-31 |
| `Doc 04D — Exam Audit, Observability, Reliability & Failure Handling.md` | V1.0 | (blank) | 2026-05-31 |
| `Doc 05 state of repo and Supabase audit .md` | (none) | (none) | 2026-05-31 |
| `Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md` | (none in header) | (none) | 2026-05-31 |
| `Doc 05A — Mastery Formula & Skill Mastery.md` | (none in header) | (none) | 2026-06-13 |
| `Doc 05B — Domain Mastery & KPI Rollups.md` | (none in header) | (none) | 2026-05-31 |
| `Doc 05C — Score Projections & Snapshots.md` | (none in header) | (none) | 2026-05-31 |
| `Doc 05D — Mastery Audit, Recompute & Constants Governance.md` | (none in header) | (none) | 2026-05-31 |
| `Doc_05E_Anonymization_Actor_ID.md` | (none) | LOCKED | 2026-06-26 |
| **`Lyceon Privacy Policy.md`** | (none) | Effective 2026-05-31 | 2026-06-27 |
| **`Lyceon Refund Policy.md`** | (none) | Effective 2026-05-31 | 2026-05-31 |
| **`Lyceon Subscription and Auto-Renewal Notice.md`** | (none) | Effective 2026-05-31 | 2026-05-31 |
| `Lyceon — Authoritative Platform Directive (Document 00, V6).md` | 6.0 | LOCKED 2026-06-02 | 2026-06-08 |
| `Lyceon — Doc 03 ADR-001_ LISA Storage Architecture.md` | (none) | (none) | 2026-06-06 |
| `Lyceon — Document 00_ Authoritative Platform Directive (V6).md` | 6.0 | LOCKED 2026-06-02 | 2026-06-09 |
| **`Lyceon — Document 01A_ Platform Primitives.md`** | V1.0 | CANONICAL | 2026-05-31 |
| ~~`Lyceon — Document 01_ … Guardian Trust (V6).md`~~ | 6.0 | **SUPERSEDED by V8 — still present** | 2026-05-31 |
| **`Lyceon — Document 01_ … Guardian Trust.md`** | **V8.0** | **CANONICAL (supersedes V7.1, V7.0, V6.0)** | 2026-06-27 |
| `Lyceon — Document 02 Preamble … (V3 Final).md` | 3.0 | Final Authoritative Control Document | 2026-05-31 |
| `Lyceon — Document 02A_ Question Generation … (V6).md` | 6.0 | Authoritative SWE Specification | 2026-05-31 |
| `Lyceon — Document 02B_ Runtime Engines (V4).md` | 4.0 | Authoritative SWE Specification | 2026-06-23 |
| `Lyceon — Document 06 (Parent)_ Reliability, Infra, Security & Compliance Ops.md` | V1.0 | LOCKED 2026-05-18 | 2026-05-31 |
| `Lyceon — Document 06A_ Infrastructure, Environments & Deployment.md` | V1.0 | LOCKED 2026-05-18 | 2026-05-31 |
| **`Lyceon — Document 06B_ Security Operations, Secrets & Access.md`** | V1.0 | LOCKED 2026-05-21 | 2026-05-31 |
| `Lyceon — Document 06C_ Observability Operations, SLOs & Incident Response.md` | V1.0 | LOCKED 2026-05-21 | 2026-05-31 |
| `Lyceon — Document 06D_ Data Protection, Backup_DR & Compliance Operations.md` | V1.0 | LOCKED 2026-05-21 | 2026-05-31 |
| `Lyceon — Document 06E_ Cost, Capacity, Vendor & Outage Operations.md` | V1.0 | LOCKED | 2026-05-31 |
| `Lyceon — Document 07 Parent_ Metrics, Warehousing, Analytics & Decision Systems.md` | V1.0 | LOCKED | 2026-05-31 |
| `Lyceon — Document 07A_ Event Schema & Tracking Standards.md` | V1.0 | LOCKED | 2026-05-31 |
| `Lyceon — Document 07B_ BigQuery Warehouse …md` | V1.0 | LOCKED 2026-05-28 | 2026-05-31 |
| `Lyceon — Document 07C_ Dashboards & Decision Surfaces.md` | V1.0 | LOCKED 2026-05-28 | 2026-05-31 |
| `Lyceon — Document 07D_ Experimentation Analytics.md` | V1.0 | **DRAFT (pre-lock)** | 2026-05-31 |
| `Lyceon — Document 07E_ Analytics Retention, Privacy & Cascade.md` | V1.0 | LOCKED 2026-05-26 | 2026-05-31 |
| `Lyceon — Document 08_ Expansion.md` | (none) | **Strategic vision artifact. Not a contract.** | 2026-05-31 |
| **`Lyceon — Document 09_ Financial Direction, Pricing Posture …md`** | V1.0 | **DIRECTIONAL LOCK-CANDIDATE — explicitly "not contract-grade"** | 2026-05-31 |
| **`Lyceon — Document 10_ Brand, Public Narrative & Pre-Launch Legal Document Program.md`** | V1.0 | LOCKED 2026-05-31 | 2026-05-31 |
| `lyceon-coding-standards.md` | (none) | (none) | 2026-06-06 |

**Load-bearing status note.** Doc 09 is the only document that bodies pricing structure, trial
posture, currency, and proration. Its own header says: *"Doc 09 is a **directional document**, not a
contract document."* Anything in this audit sourced to Doc 09 is direction, not locked contract.

### 1.2 Doc 01 version — see the banner above

Doc 01 is at **V8.0** and has not been superseded. Answers below are conditioned on V8.0.

### 1.3 Topic ownership

| Topic | Canonical owner (verified) | Heading printed verbatim |
|---|---|---|
| Billing / Stripe runtime | Doc 01 V8 **Part IV — Billing & Stripe** (§20–§24) | `# **Part IV — Billing & Stripe**` |
| Subscriptions (state model) | Doc 01 V8 §21 | `## **§21 Subscription states and transitions**` |
| Entitlements (service + evaluation) | Doc 01 V8 **Part V — EntitlementService (Canonical Spec)** (§25–§34) | `# **Part V — EntitlementService (Canonical Spec)**` |
| Customer model (payer identity) | Doc 01 V8 §20 "Who pays" + §31.4 | `## **§20 Subscription model**` / `### **31.4 Guardian paying for linked student**` |
| Guardian ↔ student linkage | Doc 01 V8 **Part VI — Guardian Trust & Consent** (§35–§39) | `# **Part VI — Guardian Trust & Consent**` |
| Per-feature access control | Doc 01 V8 §27 | `## **§27 Feature-to-entitlement mapping**` |
| Pricing structure / trial / currency / proration | **Doc 09** §5–§6 (directional only) | `# **§5 — Pricing Direction**` |
| Stripe financial-record retention | Doc 09 §9 | `# **§9 — Stripe Financial-Records Retention Direction**` |
| Idempotency primitive | Doc 01A **Part IV — IdempotencyService** (§29–§38) | `# **Part IV — IdempotencyService**` |
| Rate-limit primitive | Doc 01A **Part V — RateLimitLedger** (§39–§47) | `# **Part V — RateLimitLedger**` |
| Log redaction / PII in logs | Doc 01A §14 | `## **§14 PII redaction rules (extends V8 §5.1)**` |
| Secret storage + rotation | Doc 06B §4 | `# **§4 — Secret-Class Inventory & Per-Platform Binding (Q-06B-1 = a)**` |
| Table write-ownership | Doc 01 V8 **Appendix E** | `# **Appendix E — DB Table Ownership Matrix**` |
| Country eligibility signal | Doc 03 **Part XI — Invariants** → INV-03-08 | `# **Part XI — Invariants**` |
| Legal-artifact program | Doc 10 §9–§11 | `# **§9 — Surface 2: Pre-Launch Legal-Document Inventory**` |

**Overlap → CONTRADICTORY:** two documents claim the launch tier structure. Doc 01 V8 §20 owns it
("Subscription tiers (at launch)"); Doc 09 §5.2 also bodies it ("The current tier-structure
direction"). They disagree — see Q-B1.

**Non-overlap confirmed:** Doc 01 V8 §25.3 explicitly disclaims the adjacent territories —
*"Not a billing service (that's §20-§23) … Not a rate limiter (that's Doc 01A `RateLimitLedger`)."*
Doc 09's header explicitly excludes identity/role taxonomy and Stripe runtime mechanics.

### 1.4 Legal bundle

| Artifact | Path | Status |
|---|---|---|
| Refund Policy | `docs/Spec/Lyceon Refund Policy.md` | **Present.** Effective 2026-05-31. |
| Subscription / Auto-Renewal Notice | `docs/Spec/Lyceon Subscription and Auto-Renewal Notice.md` | **Present.** Effective 2026-05-31. |
| Privacy Policy | `docs/Spec/Lyceon Privacy Policy.md` | **Present.** Last commit 2026-06-27. |
| **Parent / Guardian Terms** | — | **DOES NOT EXIST as an artifact.** Only a Doc 10 §9.4 directional summary. |
| **Student Terms of Use / ToS** | — | **DOES NOT EXIST as an artifact.** Only a Doc 10 §9.3 directional summary. |

Proof of absence:

```
$ find docs -iname "*term*" -o -iname "*tos*" -o -iname "*parent*"
docs/Spec/Lyceon — Document 07 Parent_ Metrics, Warehousing, Analytics & Decision Systems.md
docs/Spec/Lyceon — Document 06 (Parent)_ Reliability, Infrastructure, Security & Compliance Operations.md
docs/Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md
```

(Three hits, all "Parent" in the doc-family sense. Zero legal-terms artifacts.)

```
$ grep -rln -i "Parent Terms\|Student Terms of Service\|Student ToS" docs/Spec/
docs/Spec/Lyceon — Authoritative Platform Directive (Document 00, V6).md
docs/Spec/Lyceon — Document 10_ Brand, Public Narrative & Pre-Launch Legal Document Program.md
docs/Spec/Lyceon — Document 00_ Authoritative Platform Directive (V6).md
```

Every hit is a *reference to a future artifact*, not the artifact. Doc 10 line 124 states it
outright: *"The published terms of service (the Student ToS, Parent Terms, etc. are separate
artifacts)."* Doc 10 CR-10-01 confirms the only existing versions are **Dec 2025 drafts** used as
"directional reference only," and those drafts are known-wrong on refunds (Doc 10 §3 Risk 6: *"The
existing Dec 2025 ToS and Parent Terms drafts say 'fees are non-refundable'"* — contradicting the
shipped Refund Policy).

**Consequence for this audit:** Q-A2 (contract capacity of a minor) cannot be answered from the
corpus because the two documents that would answer it have not been written.

### 1.5 SPEC_CHANGES_LOG — billing / entitlement / Stripe / access-control entries

`docs/SpecAudit/SPEC_CHANGES_LOG.md` contains **39 distinct SCL IDs** (`grep -oE "SCL-[0-9]+" | sort -u | wc -l` → 39).

Scan for billing-domain entries:

```
$ awk '/^SCL-[0-9]/{id=$0} /[Ee]ntitle|[Ss]tripe|[Bb]illing|past_due|entitlement_active|canAccessFeature|subscription/{if(id!="")print id}' \
    docs/SpecAudit/SPEC_CHANGES_LOG.md | sort -u
SCL-014 | Doc 05A §4.6/§11.4 (canonical_mastery_events source tables) | OPEN (owner-promoted 2026-08-14)
SCL-025 | 2026-08-04 | Doc 03B §3.1, Doc 03 §21.3, Doc 07E (safety review access path) | OPEN (owner-promoted 2026-08-14)
SCL-029 | 2026-08-13 | Doc 03 INV-03-03 past_due status (platform entitlement predicate wins) | OPEN (owner-promoted 2026-08-14)
```

| ID | Status | One-line subject | Billing relevance |
|---|---|---|---|
| **SCL-029** | OPEN (owner-promoted 2026-08-14) | Doc 03 INV-03-03 `past_due`: the platform entitlement predicate wins; entitled set is `{active, past_due, trialing}` | **Direct.** Fixes the entitled-status set corpus-wide. Karl ruling 2026-08-13. |
| **SCL-025** | OPEN (owner-promoted 2026-08-14) | Safety-review access path is a separate surface, *"Not routed through `canAccessFeature` — different authorization axis"* | **Access control.** Carves an explicit exception out of the `canAccessFeature` axis. |
| SCL-014 | OPEN (owner-promoted 2026-08-14) | Doc 05A §4.6/§11.4 `canonical_mastery_events` source tables | Matched on the word "entitlement" in prose only; no billing content. Listed for completeness. |

**There are no other SCL entries touching billing, Stripe, entitlement, or access control.** The
task brief's expectation that SCL-029 has siblings is not borne out: SCL-025 is the only genuine
sibling, and it is an authorization-axis carve-out rather than a billing delta. SCL-030 through
SCL-041 are entirely LISA/tutor (Doc 03/03A/03B/03C/03D) and question-bank (Doc 02A/02B,
`questions_governance.md`).

### 1.6 Current sanctioned path to production for a migration

Per `docs/plans/WS-M_Migration_Integrity.md` (V1.1, "Draft for Karl approval", 2026-08-04): **there
is currently no open path — the workstream declares an explicit freeze.** §4 states *"No new
migrations are authored anywhere in the program until M1.2 passes. Not LISA, not full-length, not
calendar."* The sequence that must complete first is M0 (read-only ground truth: replay the repo
migrations to a throwaway DB and hash-diff every object against a live prod introspection snapshot,
then triage each divergence as repo-ahead / prod-ahead / conflict, with a Karl ruling required on
`conflict` and `prod-ahead`), then M1.1 (`supabase migration repair --status applied <version>` for
the unrecorded versions — **Karl-only, writes prod, not delegable**), then M1.2 (Claude verifies the
ledger is complete and matches the repo file set). Only after M1.2 does authoring resume, and the
steady-state doctrine M3.3 establishes is that **prod applies go through the Supabase migration
system; the SQL editor is for read-only diagnosis** — because the current defect is precisely that
SQL-editor application produces correct schema and no ledger entry. The enforcement that makes this
stick (`ci/prod-schema-parity` with a negative control, M2.1–M2.3) does not exist yet, and the
existing `scripts/ci/genesis-fresh-apply.sh` gate is documented in §0.2 as a **tautological test** —
it diffs a replay against `genesis-schema.expected.sql`, a committed snapshot of its own output, and
so passes at 100% under exactly the regression it appears to guard.

**Live re-verification (2026-08-19) — the gap has widened since the plan was written:**

```sql
SELECT count(*) AS ledger_rows, min(version) AS oldest, max(version) AS newest
FROM supabase_migrations.schema_migrations;
-- [{"ledger_rows":16,"oldest":"00000000000000","newest":"20260624020000"}]
```

```
$ ls supabase/migrations/*.sql | wc -l
45
```

The plan recorded 32 repo files / 16 applied / 16 unapplied. Today: **45 repo files, still 16 ledger
rows — 29 unrecorded.** Thirteen further migrations were authored after 2026-08-04 despite the §4
freeze, including `20260809000000_entitlements_profile_id_unique_and_webhook_events.sql`, which is
the migration that created `stripe_webhook_events` and the `entitlements` UNIQUE(profile_id) index.
Both objects are confirmed live in production (§3.2), and neither appears in the ledger.

---

## 2. Questions

### Classification tally (all 31 questions)

| Classification | Count | Question IDs |
|---|---|---|
| **SPEC-DETERMINED** | 20 | Q-A4, Q-A6, Q-B2, Q-B3, Q-B4, Q-B5, Q-B6, Q-C1, Q-C2, Q-C4, Q-C5, Q-C6, Q-C7, Q-C8, Q-D1, Q-D4, Q-D5, Q-D6, Q-E3, Q-E4 |
| **SPEC-SILENT** | **8** | **Q-A2, Q-A3, Q-A5, Q-C3, Q-C9, Q-D2, Q-E1, Q-E2** |
| **SPEC-CONTRADICTORY** | 1 | Q-B1 |
| **SPEC-VS-REPO-DIVERGENT** | 2 | Q-A1, Q-D3 |

20 + 8 + 1 + 2 = 31.

Three further questions carry a **partial** silence inside an otherwise-determined answer, counted
above under SPEC-DETERMINED but flagged inline: **Q-A4** (the `client_reference_id` / checkout-metadata
mechanism), **Q-C2** (the post-checkout read race), **Q-C7** (the in-product dunning surface).
Counting those, **11 distinct things the corpus does not determine.**


Classification per §0.5. Where a question is compound and its parts classify differently, the
headline classification is given for the part a design ruling turns on, and the other part is
labelled inline — this is stated explicitly rather than collapsed.

### A. Customer model

---

**Q-A1 — Who is the Stripe Customer?**
**Classification: SPEC-VS-REPO-DIVERGENT**

**SPEC (Doc 01 V8 §20, heading verbatim: `## **§20 Subscription model**`):**
- *"Stripe Customer per Lyceon profile (one-to-one, `profiles.stripe_customer_id`)"*
- Sub-heading `### **Who pays**`, guardian case: *"guardian initiates Checkout on student's behalf;
  payment method on guardian's Stripe customer; **entitlement attaches to the student profile**, not
  the guardian (§31)"*
- Doc 01 V8 §31.4 (heading verbatim: `### **31.4 Guardian paying for linked student**`):
  *"Guardian pays for student (Stripe Customer is guardian; `stripe_customer_id` on guardian's
  profile)."*

So V8's answer is unambiguous: **student-pays → student is the Customer; guardian-pays → the
guardian is the Customer, and the entitlement still lands on the student profile.**

**REPO — does the opposite in the guardian case.** `server/routes/billing-routes.ts:131-142` sets
`profileId = linkedStudentId` for `role === "guardian"`, then `:184` reads
`getProfileStripeCustomerId(profileId)` and `:186-196` creates the Customer against **that same
student `profileId`**, persisting it to the student's profile via `setProfileStripeCustomerId`
(`server/lib/account.ts:400-418`). The Customer is created with
`email: req.user!.email` (`billing-routes.ts:188`) — the **guardian's** email on the **student's**
Stripe Customer.

**Which is older:** the repo implements the *superseded* V6 model. `docs/Spec/Lyceon — Document 01_
… (V6).md:1767` reads: *"Checkout: student is the Stripe customer (identified by
`profiles.stripe_customer_id` on student's profile); guardian's payment method is the funding
source."* V8 (last commit 2026-06-27) reversed this; the code (`@implemented 2026-08-09`) is newer
than V8 but follows V6. **The spec is newer than the code and the code matches the retired spec.**

**Compounding:** the V6 file is still in `docs/Spec/`, so both answers are citable from the
"canonical, immutable" corpus.

---

**Q-A2 — May a minor be the account holder of a paid subscription? Is the guardian required to be the contracting party?**
**Classification: SPEC-SILENT**

Searched for contract-capacity language across the whole corpus:

```
$ grep -rnE -i "contracting party" docs/Spec/          # (no output)
$ grep -rnE -i "legal capacity" docs/Spec/             # (no output)
$ grep -rnE -i "capacity to contract" docs/Spec/       # (no output)
$ grep -rnE -i "enter into a contract" docs/Spec/      # (no output)
$ grep -rnE -i "age of majority" docs/Spec/            # 0 hit(s)
$ grep -rnE -i "18 or older" docs/Spec/                # 0 hit(s)
```

`grep -rniE "bind.*contract"` returns 4 hits — all four are about *spec* documents binding
engineering (Doc 07E:954, Doc 06C:3, Doc 09:3, Doc 10:1035), none about consumer contract capacity.

What the corpus **does** say, and why it is not an answer: Doc 01 V8 §20 "Who pays" describes both
"Student pays for self" and "Guardian pays for linked student" as supported flows, and A.4 sets
`min_age_years = 13`. That establishes that a 13-year-old *may transact* operationally. It says
nothing about whether a minor can be the **contracting party** — which is the legal-capacity
question, and which by construction lives in the Parent Terms and the Student ToS. **Neither
document exists** (§1.4). Doc 10 §9.4 records only a directional summary and explicitly notes
(CR-10-02) that Lyceon *"does not implement COPPA-grade VPC."*

Doc 09 §14 criterion #6 and watch item **W-09-10** keep the adjacent product decision formally open:
*"Whether Lyceon V1 permits under-13 paying users at all … Open; gate-list defined; LAUNCH-GATING IF
UNDER-13 PAID USERS POSSIBLE."* See also the CONTRADICTORY finding at Q-B1 note (b).

---

**Q-A3 — Multi-student household: one payer, several students?**
**Classification: SPEC-SILENT**

No document states whether a household with two or more students is supported at launch, nor how a
second student would be purchased.

```
$ grep -rn -i "quantity" docs/Spec/          # 0 hit(s) — no per-seat/quantity model anywhere
$ grep -rn -i "seat" docs/Spec/              # 5 hits, all Doc 09 §5.4 (future enterprise), Doc 06E/07C vendor pricing
```

**What is determined, and what it does not settle.** Doc 01 V8 §20 fixes the shape *if* it happens:
*"Stripe Subscription per entitled profile"* — one subscription per student, never quantity-N. Doc
01 V8 §31.3 (heading verbatim: `### **31.3 Guardian with multiple linked students**`) confirms a
guardian **may** link several students and derives premium if *any one* is active. Doc 01 V8 §31.2.1
even sketches a V2 aggregate query for *"Guardian linked to >10 students (edge case; V2 product
target for school accounts)."*

But nothing says how the guardian *buys* the second one. §20 also says *"Stripe Customer per Lyceon
profile (one-to-one)"* — under V8's own guardian-pays rule (Customer = guardian), one guardian
Customer would have to carry N subscriptions with different `profiles.id` metadata, and that is
never stated. **The repo forecloses it regardless:** `billing-routes.ts:143` calls
`getPrimaryGuardianLink(userId)` and takes `link?.student_user_id` — the *primary* link only. A
guardian with two linked students has no path to buy for the second.

---

**Q-A4 — Purchase ordering: profile before checkout, or checkout creates it?**
**Classification: SPEC-DETERMINED** (ordering) — **sub-question on `client_reference_id` / checkout metadata: SPEC-SILENT**

**Ordering — determined.** Doc 01 V8 §3 (heading verbatim: `## **§3 Canonical writer:
\`profile-service.ts\`**`) makes `profile-service.ts` the single writer for `profiles`, and
Appendix E's ownership matrix confirms the Stripe webhook handler is **not** a `profiles` writer
(its only single-writer entries are `entitlements` and `stripe_webhook_events`). §20 keys the Stripe
Customer to an existing profile (`profiles.stripe_customer_id`). **The profile therefore exists
before checkout; checkout cannot create it.**

**Mechanism — silent.** No spec statement exists on `client_reference_id`, on checkout metadata
keys, or on provisioning order as an explicit rule:

```
$ grep -rn -i "client_reference_id" docs/Spec/        # (no output)
$ grep -rn -i 'client\\_reference\\_id' docs/Spec/     # (no output — escaped form used in the corpus)
$ grep -rn -i "checkout metadata" docs/Spec/           # (no output)
$ grep -rn -i "checkout.session" docs/Spec/
docs/Spec/…(V6).md:618:2. Stripe checkout session created; student is the customer, guardian is the payment source
docs/Spec/…(V6).md:1767:**Stripe flow.** Client creates Stripe checkout session. …
docs/Spec/…Guardian Trust.md:969:| `checkout.session.completed` | Create or update subscription record; flip entitlement to premium |
```

Only one V8 hit, and it is the §22.1 event table — not a metadata contract. The repo nonetheless
depends on both: `billing-routes.ts:240-256` writes `metadata.profile_id` / `payer_user_id` /
`payer_role` / `linked_student_id` / `plan` / `environment` and sets `client_reference_id: profileId`
on both the session and `subscription_data.metadata`; `webhookHandlers.ts:13-28` then resolves the
profile from `metadata.profile_id || metadata.account_id || client_reference_id`. **That entire
identity-carrying contract has no spec basis.**

---

**Q-A5 — Self-serve adult students (18+, no guardian link) in scope at launch?**
**Classification: SPEC-SILENT**

```
$ grep -rn -i "adult student" docs/Spec/      # 0 hit(s)
$ grep -rn -i "18 or older" docs/Spec/        # 0 hit(s)
$ grep -rn -i "age of majority" docs/Spec/    # 0 hit(s)
$ grep -rn -i "self-serve" docs/Spec/
docs/Spec/Lyceon Subscription and Auto-Renewal Notice.md:300:### **11.1 Self-Serve Online Cancellation — Primary Method**
docs/Spec/Lyceon Subscription and Auto-Renewal Notice.md:407:For cancellation, the primary method is the self-serve Stripe customer portal …
docs/Spec/Lyceon Refund Policy.md:202:### **7.2 Self-Serve Cancellation vs. Refund Request**
docs/Spec/Lyceon Refund Policy.md:204:You can cancel your subscription yourself at any time …
```

All four "self-serve" hits are about *cancellation*, not about self-serve adult signup. No document
addresses an 18+ unaccompanied cohort.

**Adjacent, and not a substitute for an answer:** Doc 01 V8 §37.1 (`### **37.1 Under-13 gating**`)
makes guardian consent an **under-13** gate only; A.4 sets `min_age_years = 13`. A student aged 13+
therefore needs no guardian link to be entitled. But "13+ needs no guardian" is not the same
proposition as "18+ adults are a launch cohort" — the latter carries the contract-capacity,
marketing, and ToS consequences that Q-A2 shows are unwritten. Doc 10 §2.4's age-threshold taxonomy
names *"Lyceon student minor under-18"* as a category, which reads as though 18+ is out of the
target demographic, but it is a taxonomy entry, not a scope statement.

---

**Q-A6 — Canonical writer for `entitlements`?**
**Classification: SPEC-DETERMINED**

Doc 01 V8 **Appendix E** (heading verbatim: `# **Appendix E — DB Table Ownership Matrix**`;
sub-heading `## **Ownership matrix**`). The `entitlements` row:

| Table | Ownership Class | Canonical Writer | Readers (allowed) | Notes |
|---|---|---|---|---|
| `entitlements` | Single-writer | **Stripe webhook handler (billing-service module) + admin override path** | `EntitlementService` via DB read | Writes on subscription lifecycle events only; admin override separately audited |

Related rows: `entitlement_features` → **Admin-mutable**, writer "Admin panel + DB migration seed";
`entitlement_runtime_config` → **Admin-mutable**, writer "Admin panel / ops tool";
`stripe_webhook_events` → **Single-writer**, writer "Stripe webhook handler".

CI enforcement is also specified in Appendix E: *"Linter rule rejects `supabase.from('<table>')
.insert/update/delete/upsert` outside the named canonical writer module."*

**Repo conformance:** `upsertEntitlement` (`server/lib/account.ts:353-370`) is the only writer, and
its sole caller is `webhookHandlers.ts:127`. Conformant. The admin override path does not exist.
The Appendix-E linter rule does not exist (`grep -rn "canonical-writer-exception"` → no output in
any `.ts`/`.tsx`/`.js`; no lint rule references the ownership matrix).

---

### B. Catalog and trial

---

**Q-B1 — Price/plan objects at launch; Price IDs or a price-catalog table?**
**Classification: SPEC-CONTRADICTORY**

Two locked-corpus documents give different launch tier counts.

- **Doc 01 V8 §20**, sub-heading verbatim `### **Subscription tiers (at launch)**`: two tiers —
  Free and Premium. Reinforced structurally by Appendix B.2's
  `tier TEXT NOT NULL CHECK (tier IN ('free', 'premium'))`, a two-value domain.
- **Doc 09 §5.2**, heading verbatim `## **5.2 The current tier-structure direction**`: *"Lyceon's V1
  pricing posture is a **freemium-plus-three-paid-tiers shape**"* — three paid tiers differentiated
  by billing period (monthly / multi-month / annual), with §5.3 adding a discount ladder.

I am **not resolving this.** Note that the two are reconcilable only under an unstated mapping —
three Stripe Prices collapsing to one entitlement `tier='premium'` — which no document asserts, and
Doc 09 §5.9 explicitly treats the tier *shape* as something Stripe owns and Doc 09 must be amended
to track. Two further notes:

(a) **Price IDs and price-catalog table: no doc names either.**
```
$ grep -rn -i "price_id\|price ID\|prod_\|price catalog\|price_catalog\|stripe price" docs/Spec/   # (no output)
```
Doc 09 §1.4 and §2.2 instead assign pricing magnitudes to *"Stripe production state — Never in Doc 09
— runtime canonical"*, and §5.1 states: *"Doc 09 NEVER hardcodes pricing magnitudes."*

(b) **Doc 09 vs Doc 10 on the under-13 paid decision — a second contradiction.** Doc 10:224 asserts
*"Lyceon V1 blocks under-13 paid users per Doc 09 §14 criterion #6 + Q-09-LOCK confirmation"*, while
Doc 09's own W-09-10 records that decision as *"Open; gate-list defined"* and §14 criterion #6
requires it to be *resolved before* Doc 09 can transition out of lock-candidate. Doc 10 states as
settled what Doc 09 states as open.

---

**Q-B2 — Trial length; payment method at trial start?**
**Classification: SPEC-DETERMINED — no trial at launch, so the payment-method question does not arise**

Four independent corpus statements agree:

1. Doc 01 V8 **Appendix A.4** (`## **A.4 \`entitlement_runtime_config\`**`), key
   `trial_period_days`: Launch Value **0**, Min 0, Max 30, Owner Product, description *"Trial period
   (none at launch)"*.
2. Doc 01 V8 §21 table row: `trialing` → *"Premium trial (not at launch)"*.
3. Doc 09 §5.5 (`## **5.5 Trial mechanics direction**`): *"**V1 trial posture is Trial-A (no
   trial)**"*, with day-1 charge on subscription start.
4. **Auto-Renewal Notice §6.8** (`### **6.8 Free-to-Pay Conversions**`): *"Lyceon does not currently
   offer free trials that automatically convert to paid subscriptions."* This is the legally
   load-bearing one — §6.8 goes on to commit that *if* a trial is added, the California ARL
   free-to-pay conversion disclosures under Bus. & Prof. Code § 17601(a)(1) and § 17602 apply and
   the Notice must be updated. Introducing a trial is therefore a legal-artifact change, not a
   config flip, even though A.4 exposes `trial_period_days` with a max of 30.

Note the residual inconsistency: `trialing` remains a permitted `entitlements.status` value in
Appendix B.2's CHECK and is inside the entitled set per SCL-029, so the *runtime* accepts a status
the *product* does not offer.

---

**Q-B3 — Currency / country: non-USD at launch?**
**Classification: SPEC-DETERMINED — USD-only at V1**

Doc 09 §6.7, heading verbatim `## **6.7 Multi-currency direction (V1.1+ per FWD-09-01)**`:
*"V1 is USD-only (international users pay in USD at Stripe-configured tier rates; foreign-card-to-USD
conversion happens at the customer's card-issuing bank; Lyceon receives USD)."*

This holds even though Tier-1 is a seven-country set (Doc 01 V8 A.4 `tier_1_countries`:
`["US","CA","UK","AU","NZ","IE","SG"]`). Non-USD provisioning is deferred to FWD-09-01 / Doc 08
Dimension 2. **Caveat:** Doc 09 is directional, and the Auto-Renewal Notice §3.2 requires displaying
*"The amount of each Renewal Charge **in your local currency**"* at checkout — a legal requirement
that a USD-only catalog does not obviously satisfy for a Tier-1 customer in AU or SG. I record the
tension; I do not resolve it.

---

**Q-B4 — Sales tax / VAT / Stripe Tax?**
**Classification: SPEC-DETERMINED**

Doc 01 V8 §20, sub-heading verbatim `### **Stripe Tax**`: *"Sales tax / VAT is handled by Stripe Tax.
Enabled for all Tier 1 countries (US, CA, UK, AU, NZ, IE, SG). Tax calculation happens at Checkout
and is included in subscription pricing."*

It is also a launch-blocking criterion (§45, Billing block: *"[ ] Stripe Tax enabled for Tier 1
countries"*) and a §24 blocking condition (*"Stripe Tax not verified on dashboard"*), whose
completion proof is a *"Stripe Tax verified artifact stored in ops doc."* Doc 09's header explicitly
excludes tax nexus/taxability/filing/remittance (accountant + counsel own).

---

**Q-B5 — Refund mechanics: what must the *system* do?**
**Classification: SPEC-DETERMINED**

From `docs/Spec/Lyceon Refund Policy.md`, system-affecting requirements only:

| Requirement | Section (heading verbatim) |
|---|---|
| Two distinct windows: **7 calendar days** from the Initial Subscription Charge; **3 calendar days** from a Renewal Charge | `### **3.1 The Satisfaction Window**` / `### **4.1 The Renewal Grace Window**` |
| **Full refund, no proration** — *"We do not pro-rate based on the days you used the Service"* | `### **3.1 The Satisfaction Window**` |
| Renewal-window refund is conditioned on **"You must not have Used the Service since the Renewal Charge"** — requires a server-side per-account activity signal timestamped against the renewal | `### **4.1 The Renewal Grace Window**` (+ §2 definition of "Used the Service") |
| **Agent-initiated only.** No self-serve refund. *"Self-serve cancellation stops future Renewal Charges but does not, by itself, refund a charge you've already paid"* | `### **7.2 Self-Serve Cancellation vs. Refund Request**` |
| **Entitlement revokes immediately, not at period end** — *"your subscription is canceled immediately and your access to paid features ends as soon as the cancellation is recorded in our systems … This applies to all refunds under this Policy"* | `### **8.1 Cancellation and Access**` (also §3.2, §4.3) |
| Free-tier access survives on the same account | `### **8.1 Cancellation and Access**` |
| Refund to the **original payment method** where technically available; never to a different person than the original payer | `### **7.4 Refund Method**` |
| Refund does **not** delete the account; billing records retained per accounting/tax law | `### **8.2 Data Retention**` |
| Refund issued through Stripe; EU/UK statutory withdrawal refunds initiated **within 14 calendar days** of notice | `### **11. Refund Processing Time**` |
| Lyceon may decline repeated satisfaction-window refunds on objective billing history | `### **3.4 Resubscribing After a Satisfaction-Window Refund**` |

**Note a CONTRADICTORY edge with Doc 09 §5.6**, which characterises renewal refunds as
*"Renewal charges handled case-by-case (not a contractual entitlement; vendor support discretion)"* —
while Refund Policy §4.1 grants an unconditional 3-day renewal grace window as a right. Both are
dated 2026-05-31. The Refund Policy is the published consumer-facing artifact; Doc 09 is
directional. I do not resolve which governs.

---

**Q-B6 — Auto-renewal disclosure: what must be captured/displayed at checkout?**
**Classification: SPEC-DETERMINED**

From `docs/Spec/Lyceon Subscription and Auto-Renewal Notice.md`, implementation requirements only:

| Requirement | Section (heading verbatim) |
|---|---|
| Display at checkout, *"clear, conspicuous, and separate from our broader Terms of Use"*: continues-until-cancelled; renewal frequency; renewal amount **in local currency**; cancellation method; summary of reminder notices; link to the Notice and the Refund Policy | `### **3.2 What You See at Checkout**` |
| **A separately marked checkbox or button** for the Auto-Renewal Offer Terms, distinct from general ToU acceptance — *"required by California Business and Professions Code § 17602(a)"*; blocking (checkout cannot complete without it) | `### **3.2 What You See at Checkout**`, `### **6.2 Affirmative Consent**` |
| **Persist a consent record**: date and time of consent, **version of the terms agreed to**, and the associated account | `### **3.3 Records of Consent**` |
| **Retain consent records** ≥ 3 years from consent or 1 year after termination, whichever is longer | `### **3.3 Records of Consent**`, `### **6.7 Recordkeeping**` |
| **Post-checkout acknowledgment email** carrying the Offer Terms, cancellation rights, and how to cancel; also reachable from account settings | `### **6.3 Acknowledgment**` |
| **Click-to-cancel** via the Stripe customer portal from account settings, same medium as signup, effective immediately for future charges, no extra steps | `### **6.4 Easy Cancellation — "Click to Cancel"**` |
| Reminder notices before renewal (annual and sub-annual cadences) | `### **4.1**`, `### **4.2**`, `### **6.5**` |
| ≥ 30 days' advance notice of a Material Price Increase on renewal | `### **5.1**`, `### **6.6**` |
| **Online withdrawal function** for EU/UK distance contracts, *"at least as easy to use as the process for concluding the contract"* (CRD Art. 11a, applies from 19 June 2026) | `### **7.7 Online Withdrawal Function**` |

The consent-record store (§3.3/§6.7) is the sharpest implementation requirement here: it is a
distinct persisted artifact with its own retention clock, and nothing in Doc 01 V8's schema
appendices provides a table for it.

---

### C. Write path and webhooks

---

**Q-C1 — Are consumed webhook event types enumerated?**
**Classification: SPEC-DETERMINED**

Doc 01 V8 §22.1, heading verbatim `### **22.1 Handled webhook events**`, enumerates **seven**:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`,
`customer.updated`. Each row carries a required action; the `customer.updated` row is *"Sync billing
address → `profiles.country_code` for entitlement gating"*.

I have not supplied any event beyond this list. **Repo delta** (see §3.1, §4): `customer.updated` is
not handled at all; `invoice.payment_succeeded` is not handled (the code switches on
`invoice.paid`, a different Stripe event); both invoice branches only log.

---

**Q-C2 — Webhook-authoritative, synchronous-on-return, or both?**
**Classification: SPEC-DETERMINED — webhook-authoritative** (post-checkout read race: **SPEC-SILENT**)

Doc 01 V8 §22 opening line, under heading verbatim `## **§22 Stripe webhook handling**`:
*"Stripe webhooks are the authoritative trigger for entitlement state changes."* §20 reinforces
*"Stripe webhooks drive entitlement transitions (§22)"*. No synchronous-on-return provisioning path
appears anywhere.

**The post-checkout read race is not addressed.** Nothing states what a client sees when it lands on
`success_url` before `checkout.session.completed` has been processed. The nearest adjacent material
is §28.1's 60s cache TTL and §29's NOTIFY invalidation — both of which *widen* the window rather
than close it, and neither is framed as a race remedy.

Repo confirms webhook-only: `billing-routes.ts:66-68` — *"Entitlement rows are NOT auto-created here
— the webhook upsert is the only writer."* The `success_url` (`:225-231`) is a plain dashboard
redirect with no session-id round-trip.

---

**Q-C3 — Does any spec section define `stripe_webhook_events`' shape or purpose? Raw payload / `livemode` / processed timestamp?**
**Classification: SPEC-SILENT** on shape, raw-payload retention, `livemode`, and processed-timestamp — **purpose is SPEC-DETERMINED**

**Purpose — determined.** Doc 01 V8 §22.2 (`### **22.2 Webhook idempotency**`) records it as the
existing mechanism: *"Audit confirmed `stripe_webhook_events` table with unique constraint on event
ID is already the idempotency mechanism in `server/lib/webhookHandlers.ts:119`."* Appendix E gives it
an ownership row: Single-writer, "Stripe webhook handler", note *"Audit-confirmed existing"*.

**Shape — silent.** No section, and no appendix, defines its columns. Appendix B (Identity Schemas)
runs B.1–B.7 (`profiles`, `entitlements`, `entitlement_features`, `guardian_links`,
`guardian_consent_requests`, `account_deletion_requests`, `audit_logs`) — `stripe_webhook_events` is
absent from the list entirely.

**Raw payload / `livemode` / processed-at — silent.**
```
$ grep -rn -i "livemode" docs/Spec/                # 0 hit(s)
$ grep -rn -i "raw payload" docs/Spec/             # (no output)
$ grep -rn "processed_at" docs/Spec/               # (no output)
```
Nothing requires retaining the raw payload, asserting `livemode`, or recording a processed
timestamp on this table. Note the *opposing* pressure from Doc 01A §14 — see Q-C9.

---

**Q-C4 — Idempotency ownership: `IdempotencyService` primitive, or a sanctioned Stripe-specific ledger?**
**Classification: SPEC-DETERMINED — the primitive is mandatory; the Stripe-specific ledger is explicitly named as a deviation to be migrated away from**

Doc 01A is unambiguous across five separate sites:

- **Doc 01A Part IV** (heading verbatim: `# **Part IV — IdempotencyService**`), §29–§37.
- **§34** (`## **§34 TTL and retention per scope**`) provisions a `stripe_webhook` scope directly:
  *"| `stripe_webhook` | 30 days | Stripe retries up to ~3 days; 30 days retention catches stragglers
  + provides audit window |"*
- **§30** (`## **§30 Method signatures**`) lists `'stripe_webhook'` as a member of the scope union.
- **§36** (`## **§36 Consumed by (interfaces → consumers map)**`): *"| V8 Stripe webhook handler
  (§22.2) | `stripe_webhook` | Dedupe Stripe event retries |"*
- **§38** (`## **§38 IdempotencyService deviation box**`) names the migration explicitly: *"(3)
  Migrate Stripe webhook handler to use `IdempotencyService.checkOrRecord` with `scope =
  'stripe_webhook'`"*, and sets the cutover bar at *"at least one production scope (Stripe webhook)
  migrated and operating for 7 days with zero duplicate processing."*

Doc 01 V8 §22.2 states it from the other side: *"Stripe webhook idempotency is handled via Doc 01A
`IdempotencyService`"*, then labels the current table a **"Current-state deviation"** whose
target-state *"formalizes this via `IdempotencyService` wrapper for consistency with other
idempotency use cases."* §24's blocking condition is *"webhook handler still using raw
unique-constraint idempotency without `IdempotencyService` abstraction"*, and §45 makes *"[ ] Stripe
webhook handling via `IdempotencyService`"* a launch-blocking criterion.

**Answer: consume the primitive.** A hand-rolled Stripe-specific ledger is the documented
current-state deviation, not a sanctioned alternative. `idempotency_records` exists in production
(`to_regclass('public.idempotency_records')` → `idempotency_records`); no `IdempotencyService` TS
module exists (§3.1).

---

**Q-C5 — Entitlement status lifecycle: permitted values, and which event drives each transition?**
**Classification: SPEC-DETERMINED**

Three sections carry it, and they agree:

- **Permitted value set** — Doc 01 V8 Appendix B.2 (`## **B.2 \`entitlements\`**`) CHECK constraint
  fixes the domain at seven statuses plus a two-value `tier` domain. I do not restate the list; it
  is the CHECK in B.2 and is reproduced byte-identically in production (§3.2).
- **Stripe status → Lyceon entitlement → runtime effect** — Doc 01 V8 §21 (heading verbatim:
  `## **§21 Subscription states and transitions**`), an eight-row table. Note it distinguishes
  `canceled (at period end)` from `canceled (immediate)`, which the DB status domain **cannot
  express** — both collapse to `canceled`; the distinction is carried by `cancel_at_period_end` +
  `current_period_end`.
- **Which event drives each write** — Doc 01 V8 §22.1's seven-row action table.

The set is taken from the spec, not inferred from Stripe's own statuses — though note the two
happen to coincide, which is itself specified: Doc 09 §6.2 makes Stripe's `period_start`/`period_end`
canonical.

**Two defects inside the spec, reported per §0.2:**
1. **§27.3 emits a reason not in the §26.1 enum.** §27.3 step 1 returns
   `reason: 'feature_disabled'`, but the `AccessDenialReason` union in §26.1 does not contain
   `feature_disabled`. Doc 01 V8 contradicts itself between §26.1 and §27.3.
2. **SCL-029 widens the entitled set at the platform layer** to `{active, past_due, trialing}` and is
   still `OPEN` — owed into Doc 03 INV-03-03 but not yet folded in.

---

**Q-C6 — `entitlements.grace_period_ends_at`: specified? Stripe-retry mirror or Lyceon-side grace?**
**Classification: SPEC-DETERMINED — specified, and it is a Lyceon-side grace period, not a mirror of Stripe's retry window**

It is specified in four places in Doc 01 V8:

```
$ grep -rn "grace_period_ends_at\|grace\\\\_period\\\\_ends\\\\_at" docs/Spec/
docs/Spec/…Guardian Trust.md:1400:  grace\_period\_ends\_at                      ← §31.2.1 V2 aggregate query
docs/Spec/…Guardian Trust.md:2466:  grace\_period\_ends\_at TIMESTAMPTZ,        ← Appendix B.2 column definition
docs/Spec/…Guardian Trust.md:2607:  entitlements ( tier, status, current\_period\_end, grace\_period\_ends\_at, … )
docs/Spec/…Guardian Trust.md:2631:  graceUntil: ent?.grace\_period\_ends\_at ? new Date(…) : null,
docs/Spec/…Guardian Trust.md:2641:  if (ent.status === 'past\_due' && ent.grace\_period\_ends\_at && new Date(…) > new Date()) return true;
```

Appendix B.2 defines the column under the comment `-- Grace period`. Appendix C's reference
implementation both selects it and makes it the *decisive* predicate for `past_due` entitlement
(line 2641). §26.1's `EntitlementSnapshot` surfaces it as `graceUntil`.

**Lyceon-side, not a Stripe mirror.** Its length comes from a Lyceon config key, not from Stripe:
Appendix A.4 `grace_period_days_past_due` — Launch Value 7, Min 0, Max 30, Owner **Product**,
description *"Premium access during Stripe dunning."* §23 (heading verbatim: `## **§23 Past due and
grace period behavior**`) runs the two clocks **concurrently**: step 3 starts the Lyceon grace period,
step 4 is *"Stripe's Smart Retries attempts charge retry automatically"*, step 7 is *"If grace
expires: entitlement transitions to Free"*. Lyceon's 7 days is a Product decision that happens to
overlap Stripe's retry schedule; it is not derived from it.

**Prod:** the column exists (§3.2). **Repo:** it is never written — `upsertEntitlement`'s select list
(`account.ts:353-370`) and `getEntitlementForProfile`'s (`account.ts:328-344`) both omit it, and
`entitlement_active()` ignores it entirely.

---

**Q-C7 — Dunning terminal state?**
**Classification: SPEC-DETERMINED** (in-product surface: **SPEC-SILENT**)

Doc 01 V8 §21 gives both terminal shapes: `unpaid` → *"Free | Access cuts; user prompted to update
payment method"*; and §23 step 7 → *"If grace expires: entitlement transitions to Free."* So the
answer to "canceled vs unpaid" is: **either Stripe status maps to Free**; Lyceon's terminal state is
tier `free`, and the distinction between `unpaid` and `canceled` is preserved in the status column
but has no differential runtime effect.

**What the student sees** — §23 specifies an email cadence only: Day 0 (payment failed), Day 3
(reminder with update-payment-method link), Day 6 (final warning), Day 8 (transition-to-Free
confirmation). **The in-product surface is silent**: no spec statement describes a banner, a
paywall copy variant, or a grace-period countdown, even though §26.1's `EntitlementSnapshot` carries
`graceUntil` and §26.2 says it exists *"for UX (renewal banner, countdown)."* The data is specified;
the surface that consumes it is not.

**Repo:** no dunning behaviour at all. `invoice.payment_failed` only logs
(`webhookHandlers.ts:315-322`); no email cadence exists; `grace_period_ends_at` is never set.

---

**Q-C8 — Where do the Stripe webhook signing secret and API keys live? Who owns storage and rotation?**
**Classification: SPEC-DETERMINED** (webhook signing secret specifically is **not an enumerated inventory example** — a naming gap)

**Owner: Doc 06B §4** (heading verbatim: `# **§4 — Secret-Class Inventory & Per-Platform Binding
(Q-06B-1 = a)**`). The §4.1 locked V1 binding table:

| Secret class | Examples | Store binding (V1) | Canonical owner |
|---|---|---|---|
| Vercel BFF/API runtime secrets | Supabase service-role key …, **Stripe API key**, Sentry DSN (server), third-party API tokens | **Vercel environment variables**, environment-scoped (`production`/`staging`/`development`) | 06B §4 |

Rotation is owned by the §4.2 registry `infra/secret-class-inventory.yaml` (`rotation_owner`,
`last_rotated_at`), and enforced by §4.4's `ci/secret-class-inventory-parity` gate, whose failure
conditions include *"Deployed secret-named env var absent from inventory"*. §5's scanner registry
carries `id: stripe_secret_key`, `pattern: 'sk_(live|test)_[A-Za-z0-9]{20,}'`, `severity: blocker`.

**Doc 01A Part VII is not the owner** and must not be cited as such. Its heading is
`# **Part VII — Internal Service Auth (HMAC)**`, and §64 (`## **§64 Secret management**`) governs
`service_auth_secrets` for HMAC service-pair secrets only. Doc 06B §4.1 defers to it *only* for
that row.

**The webhook signing secret is not named.** The §4.1 example cell says "Stripe API key"; the signing
secret (`whsec_…`) is a distinct secret class with a distinct rotation surface and appears nowhere:
```
$ grep -rn "STRIPE_WEBHOOK_SECRET\|whsec\|webhook signing secret\|webhook secret" docs/Spec/
docs/Spec/Doc 03C — GCP Orchestration V3.md:3180:* HMAC signing secret: Secret Manager, mounted as env var at startup
docs/Spec/…Guardian Trust.md:1000:  process.env.STRIPE\_WEBHOOK\_SECRET
docs/Spec/Doc 03C — GCP Orchestration.md:2594:* HMAC signing secret: Secret Manager, mounted as env var at startup
```
The only occurrence is inside Doc 01 V8 §22.3's illustrative code block. Under §4.3 hard rule 5
(*"Secret content classification is fail-closed — any secret with an unclassified or unowned binding
fails the §4.4 proving mechanism"*), an unenumerated `STRIPE_WEBHOOK_SECRET` is a §4.4 failure by
construction.

**PROD contradicts the env-var binding.** `stripe._managed_webhooks` holds two rows, each with a
non-null `secret` column — the signing secrets for a test-mode and a live-mode webhook endpoint are
stored **in Postgres**, not in Vercel env vars (§3.2). That store is not a `store:` enum value in
§4.2's registry schema (`[service_auth_secrets_table | vercel_env | worker_host_native |
gcp_secret_manager | github_actions | next_public]`).

---

**Q-C9 — Do anti-leak / logging rules permit persisting a raw Stripe webhook payload?**
**Classification: SPEC-SILENT on database persistence** — the **logging** constraint is SPEC-DETERMINED

**The constraint, and its owner.** Doc 01A §14, heading verbatim
`## **§14 PII redaction rules (extends V8 §5.1)**`. Owner: **Doc 01A §14**, extending Doc 01 V8 §5.1
(`## **§5.1 Audit log retention and PII boundaries**`). §14 has two lists:

- **Never written to any log under any level** — the list includes *"Credit card numbers, payment
  credentials, full Stripe customer metadata."*
- **Always redacted at log-write time** — the table row: *"| Stripe event payloads |
  `stripe_customer_id` reference only, not full customer object |"*. Email addresses are separately
  required to be redacted to first-letter + domain.

§14 closes with the enforcement posture: *"Redaction is implemented in the logger transport layer.
Violations of the blocked-fields list are treated as security incidents, not logging bugs."*

**Why this does not answer the question asked.** Every §14 rule is scoped to **logs** — "written to
any log", "at log-write time", "the logger transport layer". Doc 01 V8 §5.1 likewise governs
`audit_logs` retention and redaction. **Neither governs persisting a raw payload to an application
table**, and no other section does either (§22.1–§22.4 never mention storage of payloads;
`stripe_webhook_events` is undefined in shape per Q-C3). The nearest adjacent statement is Doc 09
§9.3 (`## **9.3 What "Stripe customer records" means for retention direction**`) and Doc 07E's
FWD-07E-04, which both place *Stripe-side* customer records outside the analytics cascade — the
opposite direction from Lyceon-side persistence, and directional in any case.

So: logging a raw Stripe payload is **prohibited** (Doc 01A §14, owner Doc 01A). Persisting one to a
Lyceon table is **unaddressed**. Given Stripe payloads carry guardian email and billing address for
a platform whose users are 13–18, that silence is the gap, not the permission.

**Prod is already exposed to this question.** The `stripe` schema (§3.2) contains 29 sync-engine
tables including `stripe.customers` (26 cols), `stripe.charges` (42), `stripe.invoices` (68) — full
raw Stripe objects. All are currently at 0 rows, and the schema's `nspacl` grants USAGE only to
`postgres` and `service_role` (no `anon`, no `authenticated`), so the boundary holds today. Nothing
in the corpus authorises the store or bounds its retention.

---

### D. Eligibility and access control

---

**Q-D1 — INV-03-08: authoritative source for a user's country?**
**Classification: SPEC-DETERMINED — Stripe billing address, confirmed**

Doc 03, heading verbatim `# **Part XI — Invariants**` → sub-heading `## **Invariant Registry**`,
INV-03-08 at line 2156:

> **INV-03-08 — Tier 1 country gating.** LISA access requires billing address country IN {US, CA, UK,
> AU, NZ, IE, SG} at V1 launch. **The authoritative signal is Stripe billing address, not IP
> geolocation or self-declared country.** Enforced: Doc 03 §12.3, Stripe billing integration.
> Violation: compliance exposure.

Corroborated in Doc 01 V8 §4 (`## **§4 Profile schema (target-state)**`), both in the column comment
(`country_code TEXT, -- ISO 3166-1 alpha-2, from billing address (authoritative)`) and in the schema
rationale: *"`country_code` is populated from Stripe billing address (not self-declared at signup)
per entitlement invariant that country follows billing."* The sync mechanism is §22.1's
`customer.updated` row. Doc 03A:244 and Doc 03B:100/261 consume it by reference.

---

**Q-D2 — An existing subscriber's billing country changes to a non-Tier-1 country. What happens?**
**Classification: SPEC-SILENT**

```
$ grep -rn -i "country change" docs/Spec/
docs/Spec/…Guardian Trust.md:1145:* Called by Stripe webhook handler after entitlement DB write, and by
  `profile-service.ts` after profile updates that affect entitlement (country change, age change, soft-delete)
$ grep -rn -i "changes country" docs/Spec/       # 0 hit(s)
$ grep -rn -i "moves to a non-Tier" docs/Spec/   # 0 hit(s)
$ grep -rn -i "country_code change" docs/Spec/   # 0 hit(s)
```

The single hit is §26.2's invalidation-trigger list. Three mechanisms exist and compose to an
implied *feature-level* outcome — §22.1 `customer.updated` syncs the address into
`profiles.country_code`; §29.2 trigger 2 fires NOTIFY on that write; §27.3 step 4 then denies with
`region_blocked` for any feature carrying `requires_tier_1_country` — but **no document states the
subscription-level consequence.** Unanswered: does the subscription continue billing? Is it
cancelled? Refunded pro-rata? Does the student keep access to the paid period already purchased and
lose only LISA? Is the guardian notified? A user who moves country mid-period would be charged for a
product they are now denied, and nothing sanctions or forbids that.

---

**Q-D3 — `canAccessFeature` signature, reason enum, section heading; and every repo implementation**
**Classification: SPEC-VS-REPO-DIVERGENT**

**⚠️ The premise of the question is wrong, and this is exactly the §0.2 failure mode.** The task
states that "Doc 01 V8 §27.3 specifies `EntitlementService.canAccessFeature(feature, userId,
context)` returning `{ allow, reason }`." Three things are off:

1. **§27.3's heading is `### **27.3 Feature access evaluation order**`** — it specifies the
   seven-step check order, not the signature.
2. The signature lives in **§26.1, heading verbatim `### **26.1 Method signatures**`.**
3. The specified parameter order and return shape differ from the question's on every axis.

**The specified signature, verbatim from §26.1:**

```ts
canAccessFeature(
  studentId: string,
  featureKey: FeatureKey,
  req: AuthenticatedRequest
): Promise<FeatureAccessResult>;
```

**The specified return type, verbatim from §26.1:**

```ts
type FeatureAccessResult = {
  allowed: boolean;
  reason?: AccessDenialReason;
  entitlementSnapshot: EntitlementSnapshot;
};
```

Note: parameters are `(studentId, featureKey, req)` — **not** `(feature, userId, context)`; the
boolean field is **`allowed`**, not `allow`; and `entitlementSnapshot` is a **required third field**,
not optional. §26.2 adds: *"On denial, returns the **first** failing reason (deterministic order per
§27.1)"* — itself a mis-citation inside the spec, since the order is in §27.3, not §27.1.

**The full reason enum, verbatim from §26.1:**

```ts
type AccessDenialReason =
  | 'not_paid'
  | 'expired'
  | 'under_age'
  | 'region_blocked'
  | 'live_exam_in_progress'
  | 'account_soft_deleted'
  | 'abuse_score_lockout';
```

**Plus one more that §27.3 emits and §26.1 does not declare:** step 1 returns
`reason: 'feature_disabled'`. **Doc 01 V8 contradicts itself here** (reported under Q-C5 too).

**Every repo implementation of entitlement checking:**

| # | Location | What it is |
|---|---|---|
| 1 | `server/services/entitlement-service.ts:92-142` — `EntitlementService.canAccessFeature(profileId: string, featureKey: string): Promise<boolean>` | The only thing bearing the spec'd name |
| 2 | `server/services/entitlement-service.ts:47-69` — `isEntitlementActiveForProfile(profileId): Promise<boolean>` | Delegates to the `entitlement_active` RPC |
| 3 | `server/services/kpi-access.ts:78-89` — `resolvePaidKpiAccessForUser(userId, role)` | Parallel ad-hoc gate returning `{hasPaidAccess, accountId, plan, status, currentPeriodEnd, reason}` |
| 4 | `server/services/kpi-access.ts:33-65` — `resolvePaidKpiAccessForStudent(studentUserId)` | Called by #3 |
| 5 | `server/lib/account.ts:639-684` — `resolveLinkedPairPremiumAccessForStudent` | Guardian-pair resolution |
| 6 | `server/lib/account.ts:686-786` — `resolveLinkedPairPremiumAccessForGuardian` | Guardian derivation (§31.4 names this file/line range) |
| 7 | `public.entitlement_active(uuid)` (prod, §3.2) | The canonical SQL predicate |
| 8 | `public._rl_has_active_entitlement(uuid)` (prod, §3.2) | A second, RLS-facing wrapper that defensively probes `pg_proc` before delegating |

**What implementation #1 does and does not implement, against §27.3's seven steps:**

| §27.3 step | Implemented? | Evidence |
|---|---|---|
| 1. Feature exists and is enabled | **Yes** | `entitlement-service.ts:118` — `if (!feature \|\| feature.enabled !== true) return false` |
| 2. Account not soft-deleted (`profiles.deleted_at IS NULL`) | **No** | `profiles` is never read on this path |
| 3. Age eligible (`age_years >= required_age_minimum`) | **No** | `required_age_minimum` has zero application reads (Q-D4) |
| 4. Country eligible (`requires_tier_1_country`) | **No** | `requires_tier_1_country` has zero application reads (Q-D4) |
| 5. Tier sufficient | **Yes** | `:123-131` — free → allow; premium → `isEntitlementActiveForProfile` |
| 6. Live exam not in progress (`blocked_during_live_exam`) | **No** | `isLiveExamInProgress` exists at `:158-182` but `canAccessFeature` never calls it; the column has zero reads |
| 7. Abuse score acceptable (`min_abuse_score_tier`) | **No** | No `AbuseScoreService` exists; the column has zero reads |

**Return contract:** returns bare `Promise<boolean>` — no `reason`, no `entitlementSnapshot`. Every
one of the eight `AccessDenialReason` values is therefore unobservable at every call site. **Two of
seven checks implemented; the denial-reason contract entirely absent.**

**Coverage:** `canAccessFeature` has exactly **two** runtime call sites, both in one legacy file —
`server/routes/legacy/progress.ts:78` (`mastery_detail`) and `:303` (`historical_trends`). Doc 01 V8
§33 (`## **§33 Consumed by**`) requires it on practice, review, exam, tutor, calendar, mastery, and
historical-data routes, and states *"No surface implements its own tier check."* Practice, review,
exam, tutor, and calendar all route through `resolvePaidKpiAccessForUser` or
`isEntitlementActiveForProfile` instead (§3.1).

**Fail-closed posture is correct** where implemented: `:132-141` catches and returns `false`;
`:107-115` fails closed on a feature-read error. This is genuinely stronger than §30.1 requires.

---

**Q-D4 — Which section defines `entitlement_features`? Does any code read its columns?**
**Classification: SPEC-DETERMINED** (definition) — **four of five gating columns have proven-zero application reads**

**Definition:** Doc 01 V8 **§27.1**, heading verbatim `### **27.1 \`entitlement_features\` table**`.
Ten columns incl. the five gating columns. §27.2 (`### **27.2 Launch seed**`) supplies the eight
seed rows. Appendix B.3 is a pointer (*"See §27.1"*). Ownership class per Appendix E:
**Admin-mutable**. §27.1's design intent: *"Feature gates are declarative — adding or modifying a
gate is a DB row change, not a code change."*

**Per-column grep across the whole repo** (`--include=*.ts,*.tsx,*.sql,*.js`, excluding
`node_modules/` and `docs/`):

| Column | Application reads | All hits |
|---|---|---|
| `required_tier` | **4 (1 real read)** | `server/services/entitlement-service.ts:75`, `:79` (comments), **`:103` `.select("required_tier, enabled")`**, `:123` (`=== "free"`) |
| `required_age_minimum` | **ZERO** | `supabase/migrations/00000000000000_genesis.sql:190` (DDL); `scripts/ci/genesis-schema.expected.sql:3661` (snapshot) |
| `requires_tier_1_country` | **ZERO** | `genesis.sql:191` (DDL); `genesis-schema.expected.sql:3662` (snapshot) |
| `blocked_during_live_exam` | **ZERO** | `genesis.sql:192` (DDL), `genesis.sql:200` (seed INSERT column list); `genesis-schema.expected.sql:3663` (snapshot) |
| `min_abuse_score_tier` | **ZERO** | `genesis.sql:193` (DDL); `genesis-schema.expected.sql:3664` (snapshot) |

Every non-`required_tier` hit is DDL or a schema snapshot. **No application code path reads any of
the four.** (`enabled` is read at `:103`/`:118` but is not one of the five gating columns.) Two
searches were run per column — the raw name and the name inside a `.select(...)` context — and both
agree.

The eight production rows (§3.2) carry meaningful values in all four unread columns:
`tutor_access` has `blocked_during_live_exam = true` (matching INV-03-02), all eight have
`requires_tier_1_country = true` (matching INV-03-08), all eight have `required_age_minimum = 13`.
**Four gating policies are configured in production and enforced nowhere.**

---

**Q-D5 — May a client-supplied value influence an entitlement decision anywhere?**
**Classification: SPEC-DETERMINED — no**

Three locked statements, each a MUST NOT:

- Coding Standards **§4.3** (heading verbatim: `### 4.3 Server Is Source of Truth for State and Time`):
  *"Do not trust client claims about role, entitlement, or session state."*
- Coding Standards **§17** (`## 17. What NOT to Generate (Hard Stops)`): *"Client-trusted role or
  entitlement checks"* is an enumerated hard stop.
- Doc 01 V8 **§18** (heading verbatim: `## **§18 No client role trust principle**`), with §18.1
  resolving JWT-role-vs-profile-role in favour of the profile.
- Doc 01 V8 §6.1 (via Coding Standards §6.1): *"Never trust client claims about role or entitlement."*

**Repo — no violating location found.** Verified along every entitlement-reaching input path:

| Path | Finding |
|---|---|
| Checkout body | `billing-routes.ts:31-35` — `z.object({ plan: z.enum([...]) }).strict()`. `.strict()` rejects unknown keys; `plan` selects a price, never an entitlement |
| Checkout subject | `billing-routes.ts:131-153` — `profileId` derives from `req.user.id` or `getPrimaryGuardianLink(userId)`; never from the body |
| Role | `server/middleware/supabase-auth.ts:561` — `role: profile.role`, read from the DB profile, not the JWT. Conformant with §18.1 |
| Entitlement predicate | `entitlement-service.ts:54-56` — RPC keyed solely on `profileId`; the RPC is `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` to `service_role` only (§3.2) |
| Webhook subject | `webhookHandlers.ts:13-28` — resolves from Stripe object metadata / `client_reference_id`, both **server-written at checkout** (`billing-routes.ts:240-256`) and delivered inside a signature-verified payload (`:264`) |
| Feature key | `progress.ts:78`, `:303` — string literals in source, never request-derived |

Guarded by `tests/ci/identity-entitlement.contract.test.ts:316` ("rejects checkout bodies containing
client-controlled billing/account fields").

**One nuance worth the ruling's attention, not a violation:** `webhookHandlers.ts:18` accepts a
legacy `metadata.account_id` fallback *"for in-flight transitions."* An `account_id`-keyed
entitlement model no longer exists (`entitlements` has no `account_id` column, §3.2), so the fallback
is dead but still live code on the identity-resolution path.

---

**Q-D6 — Is `canAccessFeature` scoped to billing/entitlement, or another workstream?**
**Classification: SPEC-DETERMINED — it is the entitlement vertical, and Doc 01 V8 explicitly disclaims billing**

Doc 01 V8 **§25.3**, heading verbatim `### **25.3 Non-goals**`, draws the boundary in one line:

> *"Not a billing service (that's §20-§23) … Not an authorization service (role checks are §15-§19;
> `EntitlementService` only checks entitlement, not role) … Not a rate limiter (that's Doc 01A
> `RateLimitLedger`)."*

`canAccessFeature` is §26.1, inside **Part V — EntitlementService**, which is a *separate Part* from
Part IV — Billing & Stripe. §33's consumer table lists seven feature surfaces and zero billing
routes. §45's launch-criteria checklist keeps them in separate blocks ("Billing:" vs
"EntitlementService:").

**Plan-side ownership agrees and is more specific.** `docs/SpecAudit/50-auth-entitlement/
PHASE-0-PLAN.md:97` names *"`canAccessFeature` consuming `entitlement_features` + `entitlement_active`
as the single route"* gate, and `docs/SpecAudit/30-genesis-recut/GAP-WAVE-MAP.md:105` assigns
GAP-ID-09 (*"entitlement gates on premium routes via `canAccessFeature` (app-layer)"*) to **WS-2/4/5**,
not to a billing workstream. `docs/SpecAudit/40-ws2-ws3/FRONT-OF-WAVE-CODE-AUDIT.md:54` recorded
*"The spec'd gate `EntitlementService.canAccessFeature(...)` **does not exist**"* — since superseded
by the partial implementation found at Q-D3. `docs/SpecAudit/10-gap-registry/gap-registry.md:248`
still carries **GAP-ID-09 — OPEN (confirmed)**.

**Answer: the auth/entitlement workstream owns it, not the Stripe vertical.** SCL-025 carves out one
explicit exception (the safety-review surface is *"Not routed through `canAccessFeature` — different
authorization axis"*).

---

### E. Environment, sequencing, ops

---

**Q-E1 — Stripe environment model; how is `livemode` asserted on inbound webhooks?**
**Classification: SPEC-SILENT**

```
$ grep -rn -i "livemode" docs/Spec/          # 0 hit(s)
$ grep -rn -i "test mode" docs/Spec/
docs/Spec/…(V6).md:646:… test subscription lifecycle end-to-end in Stripe test mode …
$ grep -rn -i "test key" docs/Spec/          # 0 hit(s)
$ grep -rn -i "Stripe account" docs/Spec/    # 0 hit(s)
```

The single "test mode" hit is in the **superseded V6 file**, and is a pre-refactor checklist item,
not an environment model. **No document states one-account-with-test/live-keys vs separate accounts,
and no document requires `livemode` to be asserted on an inbound webhook.** Doc 06A §7's environment
matrix and Doc 06B §4.1's `environment_scope: [production | staging | development | all]` establish
*Lyceon-side* tiering, but neither maps a Lyceon tier onto a Stripe mode.

**This is a live gap, not a hypothetical.** Production has **both** a test-mode and a live-mode
webhook endpoint registered against the same database, each with 89 subscribed event types
(§3.2, `stripe._managed_webhooks`: `livemode: false` / `livemode: true`). Repo-side,
`webhookHandlers.ts:281` logs `livemode: event.livemode` and **never branches on it**; a test-mode
event that reaches the endpoint with a valid test-secret signature would upsert a real entitlement.
`stripeClient.ts:4-29` implements a `STRIPE_ENV` = `"live" | "test"` selector with `_LIVE`/`_TEST`
key suffixes — an environment model invented entirely in code, matching nothing in the corpus.

---

**Q-E2 — Checkout/billing rate limit or abuse scoring? Does it consume `RateLimitLedger`?**
**Classification: SPEC-SILENT**

Doc 01A §39.2 (heading verbatim `### **39.2 Bucket naming**`) enumerates seven buckets; §46
(`## **§46 Consumed by**`) enumerates nine consumers. **No checkout, billing, portal, or payment
bucket appears in either.** Confirmed:

```
$ grep -rn -i "checkout rate limit" docs/Spec/   # 0 hit(s)
$ grep -rn -i "billing rate limit" docs/Spec/    # 0 hit(s)
$ grep -rniE "rate.limit.*checkout" docs/Spec/   # 0 hit(s)
$ grep -rniE "abuse.*checkout" docs/Spec/        # 0 hit(s)
```

Every `RateLimitLedger` hit that is adjacent to billing is about *auth* throttling (Doc 01 V8:55
login/password-reset; :569 login/signup/password-reset/magic-link) or guardian linking (§36.2 →
`guardian_link_attempts_daily`). Doc 01A §41's ledger, §42's abuse multiplier, and §44's 429 shape
all exist as primitives — nothing consumes them for checkout.

Since the spec never requires the behaviour, the "does it consume the primitive rather than a
bespoke limiter" half is moot. **Repo: `POST /api/billing/checkout` has `requireSupabaseAuth` +
`csrfProtection` and no rate limit** (`billing-routes.ts:70-74`). Each unrate-limited call performs
a live `stripe.prices.retrieve` (`:159`) and may create a Stripe Customer (`:186`).

---

**Q-E3 — Customer self-service: Stripe Billing Portal or a custom surface?**
**Classification: SPEC-DETERMINED — Stripe Billing Portal; and the artifacts agree, no conflict**

Doc 01 V8 §20: *"Stripe Billing Portal for self-service subscription management (pause, cancel,
update payment method)."*

The Auto-Renewal Notice does **not** conflict — it names the same mechanism and makes it the
compliance path. §6.4 (heading verbatim `### **6.4 Easy Cancellation — "Click to Cancel"**`):
*"you can cancel online through the Stripe customer portal accessible from your account settings,
using the same medium in which you subscribed … No additional steps beyond the customer portal are
required to cancel. This complies with California Business and Professions Code § 17602(c)–(d)."*
§11.1 (`### **11.1 Self-Serve Online Cancellation — Primary Method**`) and Refund Policy §4.4 / §7.2
say the same.

Two additions the Notice makes that Doc 01 §20 does not carry:
- an **email fallback** (`hello@lyceon.ai`), explicitly *"not required for compliance"* — the portal
  is primary;
- the **§7.7 online withdrawal function** for EU/UK distance contracts (CRD Art. 11a, from 19 June
  2026), which §7.7 states is *"in addition to, not in place of"* the other paths. Whether the
  Stripe portal discharges Art. 11a is a counsel question the Notice leaves open (*"or an equivalent
  counsel-approved electronic withdrawal mechanism"*).

**Repo:** `POST /api/billing/portal` exists (`billing-routes.ts:690-762`), with a 405 guard on GET
(`:679-683`). No custom cancellation surface exists.

---

**Q-E4 — Spec-defined acceptance criteria / executable proof / test contract for the billing vertical?**
**Classification: SPEC-DETERMINED — criteria exist; Doc-06-style per-capability proving mechanisms do not**

**§45** (heading verbatim `## **§45 V8 Launch Criteria**`) carries two directly relevant blocks:

*Billing:* Stripe webhook handling via `IdempotencyService`; `entitlements` migrated to `profile_id`
FK; `accounts`/`account_members` retired; Stripe Tax enabled for Tier 1; NOTIFY emitted on
entitlement writes.

*EntitlementService:* `packages/shared/services/entitlement-service.ts` implemented per §32; LISTEN
loop running on every API instance; `entitlement_features` populated with launch seed; all call
sites migrated to `EntitlementService.canAccessFeature`; `resolveLinkedPairPremiumAccessForGuardian`
wrapped in `EntitlementService.resolveGuardianEntitlement`; cache TTL / hard staleness / Tier-1
countries configured in `entitlement_runtime_config`.

Other spec-defined proof surfaces:
- **§24** and **§34** deviation boxes each carry an explicit *cutover criteria* / *blocking
  conditions* / *completion proof* triple. §34's completion proof is unusually concrete: *"7-day
  production window with `EntitlementService` as sole entitlement path and zero fallback-reads to
  legacy helpers"* and *"CI check on direct-read prohibition passing."*
- **§45A** (`## **§45A Performance Budgets (SLO/SLI)**`) — latency, availability, throughput, cold
  start, alert thresholds.
- **Doc 01A §36 / §46** consumed-by maps bind the primitives to the Stripe webhook consumer.
- **Doc 07A** registers 5 billing-class analytics events within its 25-event V1 taxonomy.

**The gap in the question's own terms.** Doc 06's discipline is *"every capability names its proving
mechanism"* with a named executable (`ci/…` or `ops/…`), an execution location, a trigger cadence, a
failure condition, a proof artifact, and an owner — Doc 06B §4.4's
`ci/secret-class-inventory-parity` is the exemplar. **Doc 01 V8's billing criteria are unchecked
checkboxes with no named mechanism.** §45 names no `ci/` gate, no `ops/` job, no proof artifact
envelope, and no per-item owner for any billing or entitlement line. The Appendix E linter rule
(*"Linter rule rejects `supabase.from('<table>').insert…`"*) is described but never given a
mechanism name, cadence, or owner.

---

## 3. Independent surface inventory

Produced independently of §2.

### 3.1 Repo surface

**Every file referencing Stripe** (`grep -rln -i "stripe" --include=*.ts,*.tsx,*.js,*.sql,*.json,
*.yml,*.yaml`, excluding `node_modules/` and `docs/`) — 45 files. Grouped:

*Server runtime (8):*

| File:line | Role |
|---|---|
| `server/lib/stripeClient.ts:48` `getUncachableStripeClient()` | SDK factory; `new Stripe(secretKey)` at `:56` |
| `server/lib/stripeClient.ts:59` `getStripePublishableKeySafe()` | Publishable-key accessor |
| `server/lib/webhookHandlers.ts:230` `class WebhookHandlers` / `:231` `processWebhook` | Sole webhook entry point |
| `server/lib/webhookHandlers.ts:74` `handleSubscriptionEvent` · `:148` `handleCheckoutCompleted` · `:180` `tryInsertWebhookEventGate` · `:211` `rollbackWebhookEventGate` · `:13` `requireProfileIdFromStripeObject` · `:30` `extractProfileIdStrict` | Handler internals |
| `server/lib/account.ts:328` `getEntitlementForProfile` · `:353` `upsertEntitlement` · `:377` `getProfileStripeCustomerId` · `:400` `setProfileStripeCustomerId` · `:639`/`:686` linked-pair resolvers · `:788` `mapStripeStatusToEntitlement` | Entitlement + customer-id data layer |
| `server/lib/billingStorage.ts:3` `class BillingStorage` | Reads `stripe.products` / `stripe.prices` via `.schema('stripe' as any)` at `:10,:23,:38,:52` |
| `server/lib/account-deletion-execute.ts:47` `pauseStripeBilling` (called `:167`) | Voids the subscription during deletion |
| `server/services/entitlement-service.ts:41` `class EntitlementService` | `:47`, `:92`, `:158` |
| `server/services/kpi-access.ts:33`, `:78` | Parallel paid-access gate |

*Routes (13 endpoints):*

| Route | Definition | Auth chain |
|---|---|---|
| `POST /api/billing/webhook` | `server/index.ts:117-119` (mounted **before** `express.json()`; `express.raw`) | Stripe signature only; CSRF-exempt by design |
| `POST /api/billing/checkout` | `billing-routes.ts:70-71` | `requireSupabaseAuth` + `csrfProtection` |
| `GET /api/billing/status` | `:310-311` | `requireSupabaseAuth` |
| `GET /api/billing/products` | `:494-495` | `requireSupabaseAuth` + `requireGuardianBillingAccess` |
| `GET /api/billing/plans` | `:653` | `requireSupabaseAuth` |
| `GET /api/billing/products/:productId/prices` | `:654-655` | `requireSupabaseAuth` |
| `GET /api/billing/portal` | `:679` | none — returns 405 |
| `POST /api/billing/portal` | `:690-691` | `requireSupabaseAuth` + `csrfProtection` |
| `GET /api/billing/publishable-key` | `:765` | **none — unauthenticated** |
| `GET /api/billing/debug/env` | `:794-795` | `requireSupabaseAuth` + `requireGuardianBillingAccess` + 404 when `NODE_ENV==='production'` |
| `GET /api/billing/debug/validate` | `:850-851` | same |
| `POST /api/guardian-consent/…` (Stripe Checkout for a $0.50 identity verification) | `guardian-consent-routes.ts:97`, `:186` | Session creation at `:127`; retrieve at `:212`; PaymentIntent cancel at `:419` |
| — | `server/routes/account-deletion-routes.ts:55` sets `stripe_cancellation_status: "pending"` | Deletion lifecycle |

*Workers / jobs:* **none.** No scheduled job, cron, or queue worker touches Stripe.
`server/scripts/seed-products.ts` is a one-shot operator script (`PRICE_CONFIGS` at `:11-15`).

**SDK import and pinned version.**
```
$ grep -rn 'from "stripe"' --include="*.ts" . | grep -v node_modules
server/lib/stripeClient.ts:1:import Stripe from "stripe";
server/lib/webhookHandlers.ts:5:import Stripe from "stripe";
$ grep -n '"stripe"' package.json
121:    "stripe": "^20.4.1",
$ grep -n "^  stripe@" pnpm-lock.yaml
4899:  stripe@20.4.1:
```
**Pinned in lockfile: `stripe@20.4.1`.** Two importers only. No `apiVersion` is pinned on the client
(`stripeClient.ts:56` — `new Stripe(secretKey)` with no options object), so the SDK's bundled default
governs.

**Every Stripe/billing env var read:**

| Var | Read at |
|---|---|
| `STRIPE_SECRET_KEY` | `stripeClient.ts:12`; `billing-routes.ts:807,818,835,860` |
| `STRIPE_SECRET_KEY_LIVE` / `_TEST` | `stripeClient.ts:15,16` |
| `STRIPE_PUBLISHABLE_KEY` | `stripeClient.ts:22`; `billing-routes.ts:808,836` |
| `STRIPE_PUBLISHABLE_KEY_LIVE` / `_TEST` | `stripeClient.ts:25,26` |
| `STRIPE_ENV` | `stripeClient.ts:14,24,52`; `billing-routes.ts:804,834` |
| `STRIPE_WEBHOOK_SECRET` | `webhookHandlers.ts:249`; `billing-routes.ts:837` |
| `STRIPE_PRICE_PARENT_MONTHLY` / `_QUARTERLY` / `_YEARLY` | `billing-routes.ts:40-42,572-574,809-811,838-841,868-870` |
| `SITE_URL` | `billing-routes.ts:222` (checkout redirect base) |

`docs/ENV.md:23-28` documents six of the eleven (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, and the three price IDs). **`STRIPE_ENV` and the four `_LIVE`/`_TEST`
suffixed variants are undocumented** — relevant to Q-E1 and to Doc 06B §4.4's failure condition
*"Deployed secret-named env var absent from inventory."*

**References to the four entitlement objects** (application code, excluding tests/migrations/docs):

| Symbol | Where |
|---|---|
| `entitlements` (table) | `account.ts:331,357`; `account-deletion-execute.ts:54`; `entitlement-write-path.ci.test.ts` (test) |
| `entitlement_active` (RPC) | `entitlement-service.ts:54` — **one call site**, as `tests/ci/entitlement.single-evaluator.contract.test.ts:95` asserts |
| `stripe_webhook_events` | `webhookHandlers.ts:185`, `:213` |
| `entitlement_features` | `entitlement-service.ts:102` — **one read** |
| `entitlement_runtime_config` | **ZERO application reads.** `grep -rn "entitlement_runtime_config" --include=*.ts,*.tsx` → no output outside migrations and `genesis-schema.expected.sql` |

**Call sites of the two named helpers:**

`resolvePaidKpiAccessForUser` — 6 runtime call sites:
`apps/api/src/routes/calendar.ts:483` · `apps/api/src/routes/mastery.ts:118` ·
`server/routes/full-length-exam-routes.ts:105`, `:273` · `server/routes/legacy/progress.ts:58`, `:292`

`EntitlementService.isEntitlementActiveForProfile` — 4 runtime call sites:
`server/lib/account.ts:655`, `:723` · `server/routes/tutor-runtime.ts:190` ·
`server/services/entitlement-service.ts:131` (internal, from `canAccessFeature`)

**Every entitlement/billing test, and whether it can fail.**

The question "would it fail if the behaviour it guards were deleted?" has a prior question here:
**does it run at all?** The required `ci` job runs `route:validate`, `test:security`, `test:ci`,
`check:shared`, `test:shared`, `lint:shared`, `build` (`.github/workflows/ci.yml:45-68`), where
`test:ci = "vitest run tests/ci"` and `test:security` names exactly two files
(`package.json:27,36`). The only other vitest invocations in any workflow are:
```
$ grep -rn "vitest run\|pnpm test" .github/workflows/*.yml
ci.yml:185:  run: pnpm test:integration
ci.yml:294:  run: pnpm exec vitest run tests/ci/diagnostic.handler-pg.ci.test.ts
ci.yml:307:  run: pnpm exec vitest run tests/ci/entitlement-write-path.ci.test.ts
```
**Nothing runs `server/__tests__/**` or `tests/entitlements.webhook.test.ts`.**

| Test file | Tests | Runs in CI? | Would fail if the guarded behaviour were deleted? |
|---|---|---|---|
| `tests/ci/entitlement-write-path.ci.test.ts` | 11 | **Yes** — `practice-integration` job, `ci.yml:300-307`, `PGHOST` set, PG16 service container | **Yes — strongest asset in the vertical.** Applies all migrations to a real PG, calls the real `upsertEntitlement`, proves persistence, `entitlement_active(profile_id)`, upsert idempotency, `past_due` inclusion, `canceled` exclusion, and the `stripe_webhook_events` 23505 replay path. Deleting the upsert or the gate fails it. |
| `tests/ci/entitlement.single-evaluator.contract.test.ts` | 3 | Yes (`tests/ci`) | **Yes, narrowly.** Static source scan: asserts no divergent `isEntitlementActive`, exactly one `entitlement_active` RPC call site, and the evaluator's exact signature string. Catches a *second* evaluator appearing; cannot catch the one evaluator being wrong. |
| `tests/ci/entitlement.status-parity.contract.test.ts` | 3 | Yes | **Partially — file-to-file only.** Regex-extracts `status IN (...)` from `supabase/migrations/20260616120000_…sql` and from `contracts/auth-entitlement-sp25.contract.md` and compares. Would fail if either file's set changed; **would not fail if production drifted from the file** (nothing reads prod). Its own header names the exact drift it was built for. |
| `tests/ci/kpi.gating.contract.test.ts` | 8 | Yes | **Yes.** Mocks `canAccessFeature` and asserts free→`baseline_only`, paid→computed, and two explicit fail-closed-on-throw cases. Deleting a gate flips an assertion. |
| `tests/ci/identity-entitlement.contract.test.ts` | 8 | Yes | **Yes.** Behavioural: guardian checkout denied without a link (409), guardian billing status uses linked-student entitlement, checkout rejects client-controlled billing/account fields, and two fail-closed paths. |
| `tests/ci/guardian-entitlement.admin-audit.contract.test.ts` | 3 | Yes | **Yes.** Denial tests (403 non-guardian/non-admin, 401 unauthenticated) plus an admin audit-log assertion. |
| `tests/ci/surface-ownership.contract.test.ts` | 7 | Yes | Yes for the surfaces it covers (mocks both `canAccessFeature` and `isEntitlementActiveForProfile`). |
| `tests/ci/guardian-full-length-report.contract.test.ts`, `full-length-history.contract.test.ts`, `full-length-quota-denial.contract.test.ts`, `mastery.anti-leak.ci.test.ts`, `mastery.read.contract.test.ts`, `calendar.*.contract.test.ts` | — | Yes | These **mock** `resolvePaidKpiAccessForUser` to a fixed value. They guard the *consuming* surface's behaviour given an access verdict; they do not guard the verdict. Not decoration, but not entitlement coverage. |
| `tests/ci/premium-cta-wiring.contract.test.ts` | 6 | Yes | Static source assertions on client wiring (`readFileSync`). Fails if the CTA wiring is removed. Cosmetic scope. |
| `tests/entitlements.regression.test.ts` | 4 | Yes (`test:security`) | Yes — but **all four are auth/IDOR** (`rag_v2` bearer rejection, cookie requirement, userId-from-auth, admin gate). Despite the filename, **zero entitlement coverage.** Misleadingly named. |
| **`tests/entitlements.webhook.test.ts`** | 4 | **NO** | Content is good — duplicate-replay, out-of-order convergence, guardian-paid→student entitlement, fail-closed on missing metadata. **Never executed by any CI job.** Decoration in the merge gate. |
| **`server/__tests__/billing-truth.test.ts`** | 3 | **NO** | Same. Also carries a broken mock path: `vi.mock("../../logger")` at `:7` resolves to repo-root `logger`, but the SUT imports `"../logger"` (= `server/logger`) — the mock never applies. |
| **`server/__tests__/billing-checkout.test.ts`** | 1 | **NO** | Guardian checkout metadata targeting. Decoration. |
| **`server/__tests__/guardian-payment-access.test.ts`** | 1 | **NO** | *"guardian payment does not grant guardian-owned access when student is not entitled"* — a genuine invariant test. Decoration. |
| **`server/__tests__/deletion-lifecycle.test.ts`** | 43 | **NO** | Largest suite touching `stripe_cancellation_status`. Decoration in the merge gate. (The separate `deletion-deidentify-rehearsal` job at `ci.yml:316` does run real-PG SQL rehearsals — that gate is real, but it is SQL-side, not this suite.) |
| `client/src/lib/billing-client.test.ts` (4), `client/src/pages/upgrade.page.test.tsx` (2) | 6 | Yes | Client-side; assert rendering/fetch shape, not server enforcement. |

**Net: 52 tests across five files that specifically guard webhook idempotency, guardian-paid
attribution, and deletion-time Stripe handling never execute in CI.** The vertical's only real
executable proof is `entitlement-write-path.ci.test.ts` (11 tests, real PG) plus the `tests/ci`
behavioural suites. I could not verify from this session whether the `practice-integration` job is a
*required* check in branch protection; `ci.yml:12` marks only the `ci` job as the required gate in
its own comment.

### 3.2 Production truth

All re-verified 2026-08-19 against `hncolwkccbbjkfithhlo`. No prior document trusted.

**Columns.**
```sql
SELECT c.relname AS table_name, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expr
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN
  ('entitlements','stripe_webhook_events','entitlement_features','entitlement_runtime_config')
ORDER BY c.relname, a.attnum;
```

`entitlements` (12 cols): `id uuid NOT NULL DEFAULT gen_random_uuid()`, `profile_id uuid NOT NULL`,
`tier text NOT NULL`, `status text NOT NULL`, `stripe_subscription_id text`, `stripe_price_id text`,
`current_period_start timestamptz`, `current_period_end timestamptz`,
`cancel_at_period_end boolean DEFAULT false`, **`grace_period_ends_at timestamptz`**,
`created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
→ **Matches Doc 01 V8 Appendix B.2 exactly.**

`stripe_webhook_events` (3 cols): `id text NOT NULL`, `type text NOT NULL`,
`created_at timestamptz NOT NULL DEFAULT now()`. **No `livemode`, no raw payload, no processed-at.**

`entitlement_features` (10 cols): `feature_key text NOT NULL`, `required_tier text NOT NULL`,
`required_age_minimum integer DEFAULT 13`, `requires_tier_1_country boolean DEFAULT true`,
`blocked_during_live_exam boolean DEFAULT false`, `min_abuse_score_tier text DEFAULT 'clean'::text`,
`enabled boolean DEFAULT true`, `description text`, `added_at timestamptz NOT NULL DEFAULT now()`,
`deprecated_at timestamptz`. → **Matches Doc 01 V8 §27.1 exactly.**

`entitlement_runtime_config` (11 cols): `key text NOT NULL`, `value jsonb NOT NULL`,
`value_type text NOT NULL`, `min_value jsonb`, `max_value jsonb`, `allowed_values jsonb`,
`owner text NOT NULL`, `description text NOT NULL`, `environment text NOT NULL DEFAULT 'all'::text`,
`updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by_profile_id uuid`.
→ Matches the Doc 01A §2 config-table template.

**Constraints.**
```sql
SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN (…) ORDER BY c.relname, con.conname;
```
- `entitlements_pkey` PRIMARY KEY (id)
- `entitlements_profile_id_fkey` FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT
- `entitlements_status_check` CHECK (status = ANY (ARRAY['active','past_due','canceled','unpaid','incomplete','incomplete_expired','trialing']))
- `entitlements_stripe_subscription_id_key` UNIQUE (stripe_subscription_id)
- `entitlements_tier_check` CHECK (tier = ANY (ARRAY['free','premium']))
- `entitlement_features_pkey` PRIMARY KEY (feature_key)
- `entitlement_features_required_tier_check` CHECK (required_tier = ANY (ARRAY['free','premium']))
- `entitlement_runtime_config_pkey` PRIMARY KEY (key); `…_environment_check`; `…_value_type_check`; `…_updated_by_profile_id_fkey`
- `stripe_webhook_events_pkey` PRIMARY KEY (id)

**Indexes.**
```sql
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (…);
```
- `entitlements_pkey` UNIQUE (id)
- **`entitlements_profile_id_unique` UNIQUE (profile_id)** ← the upsert `onConflict` target
- `entitlements_stripe_subscription_id_key` UNIQUE (stripe_subscription_id)
- `idx_entitlements_active` (profile_id) **WHERE status='active' OR status='past_due' OR status='trialing'**
- `idx_entitlements_profile` (profile_id)
- `entitlement_features_pkey`, `entitlement_runtime_config_pkey`, `stripe_webhook_events_pkey`

Note `idx_entitlements_active`'s predicate includes `trialing`; Doc 01 V8 Appendix B.2's index
definition covers only `active`/`past_due`. Prod is **ahead** of B.2 here, consistent with SCL-029.

**Row counts.**
```sql
SELECT 'entitlements' t, count(*) n FROM public.entitlements
UNION ALL SELECT 'stripe_webhook_events', count(*) FROM public.stripe_webhook_events
UNION ALL SELECT 'entitlement_features', count(*) FROM public.entitlement_features
UNION ALL SELECT 'entitlement_runtime_config', count(*) FROM public.entitlement_runtime_config;
```
```
[{"t":"entitlements","n":0},
 {"t":"stripe_webhook_events","n":0},
 {"t":"entitlement_features","n":8},
 {"t":"entitlement_runtime_config","n":0}]
```
**`entitlement_runtime_config` is EMPTY.** Doc 01 V8 Appendix A.4 defines seven launch keys
(`entitlement_cache_ttl_seconds`, `entitlement_hard_staleness_seconds`,
`grace_period_days_past_due`, `trial_period_days`, `cancellation_at_period_end_default`,
`tier_1_countries`, `min_age_years`). Zero are seeded. `public.entitlement_runtime_config_history`
also has 0 rows.

**RLS state.**
```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (…);
-- entitlement_features       rls_enabled=true  forced=false
-- entitlement_runtime_config rls_enabled=true  forced=false
-- entitlements               rls_enabled=true  forced=false
-- stripe_webhook_events      rls_enabled=true  forced=false
```

**Policies.**
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN (…);
-- []
```
**RLS enabled, ZERO policies on all four.** This is deny-all for `anon`/`authenticated` and
transparent for `service_role` (BYPASSRLS). Fail-closed and correct — no policy is missing so much
as *deliberately absent*, matching Doc 01 V8 §14's Layer-1 application-filtering-at-launch posture.

**Table grants.**
```sql
SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN (…)
GROUP BY table_name, grantee;
```
All four tables: `postgres` and `service_role` only, each with
`DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`. **No `anon`, no `authenticated`.**

**`entitlement_active()` — full definition.**
```sql
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='entitlement_active';
```
```
signature:         entitlement_active(uuid)
security_definer:  true
config:            ["search_path=public, pg_temp"]

CREATE OR REPLACE FUNCTION public.entitlement_active(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.profile_id = p_profile_id AND e.status IN ('active','past_due','trialing')
  );
$function$
```
**Grants:**
```sql
SELECT p.oid::regprocedure, pg_get_userbyid(acl.grantee), acl.privilege_type FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace,
LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
WHERE n.nspname='public' AND p.proname='entitlement_active';
-- entitlement_active(uuid) | postgres     | EXECUTE
-- entitlement_active(uuid) | service_role | EXECUTE
```
`SECURITY DEFINER` with a pinned `search_path`, EXECUTE to `service_role` only, no `PUBLIC`/`anon`/
`authenticated`. Correct, and matches the SCL-029 status set exactly.

**Triggers on the four tables.**
```sql
SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN (…);
-- entitlement_runtime_config | entitlement_runtime_config_notify |
--   CREATE TRIGGER entitlement_runtime_config_notify AFTER INSERT OR UPDATE
--   ON public.entitlement_runtime_config FOR EACH ROW EXECUTE FUNCTION notify_config_change()
```
**Exactly one.** `entitlements`, `stripe_webhook_events`, and `entitlement_features` have **no
triggers** — so no `updated_at` maintenance, no audit emission, and no `NOTIFY entitlement_invalidate`
at the DB layer.

**Every object matching `%stripe%`, `%billing%`, `%subscri%`, `%entitle%`, `%invoice%`, `%payment%`.**
```sql
SELECT n.nspname, c.relname, c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND (c.relname ILIKE '%stripe%' OR … ) AND c.relkind IN ('r','v','m','p','f')
UNION ALL  SELECT n.nspname, p.proname, 'function' FROM pg_proc p … 
UNION ALL  SELECT n.nspname, t.typname, 'enum' FROM pg_type t WHERE t.typtype='e' … ;
```
```
stripe   | invoice_status                | enum
stripe   | subscription_schedule_status  | enum
stripe   | subscription_status           | enum
public   | _rl_has_active_entitlement    | function
public   | entitlement_active            | function
realtime | subscription_check_filters    | function
public   | entitlement_features          | r
public   | entitlement_runtime_config    | r
public   | entitlement_runtime_config_history | r
public   | entitlements                  | r
public   | stripe_webhook_events         | r
realtime | subscription                  | r
stripe   | active_entitlements           | r
stripe   | invoices                      | r
stripe   | payment_intents               | r
stripe   | payment_methods               | r
stripe   | subscription_items            | r
stripe   | subscription_schedules        | r
stripe   | subscriptions                 | r
```

**🔴 THE LARGEST UNSPECIFIED SURFACE IN THIS AUDIT — an entire `stripe` schema.** Full enumeration:
```sql
SELECT c.relname, c.relkind::text, c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS ncols
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='stripe' AND c.relkind IN ('r','v','m','f','p') ORDER BY 1;
```
29 tables, **every one with `rls = false`**: `_managed_webhooks`(15 cols), `_migrations`(4),
`_sync_status`(8), `accounts`(15), `active_entitlements`(10), `charges`(42),
`checkout_session_line_items`(15), `checkout_sessions`(65), `coupons`(20), `credit_notes`(32),
**`customers`(26)**, `disputes`(20), `early_fraud_warnings`(12), `events`(13), `features`(11),
**`invoices`(68)**, `payment_intents`(40), `payment_methods`(11), `payouts`(31), `plans`(27),
`prices`(21), `products`(21), `refunds`(19), `reviews`(18), `setup_intents`(16),
`subscription_items`(15), `subscription_schedules`(21), `subscriptions`(39), `tax_ids`(12).

This is the Supabase Stripe sync integration. **It appears nowhere in `docs/Spec/`:**
```
$ grep -rn -F -i "sync engine" docs/Spec/          # 0 hit(s)
$ grep -rn -F -i "Stripe Sync" docs/Spec/          # 0 hit(s)
$ grep -rn -F -i "foreign data wrapper" docs/Spec/ # 0 hit(s)
$ grep -rn -F -i "wrappers" docs/Spec/             # 0 hit(s)
$ grep -rn -F -i "stripe schema" docs/Spec/        # 0 hit(s)
$ grep -rn -F -i "stripe." docs/Spec/              # 0 hit(s)
```
Six terms, zero hits.

**Row counts (schema currently unpopulated except webhooks):**
```sql
SELECT 'stripe.customers' t, count(*) n FROM stripe.customers UNION ALL …;
-- customers 0 · subscriptions 0 · prices 0 · products 0 · events 0 · invoices 0 · charges 0
-- checkout_sessions 0 · _sync_status 0 · active_entitlements 0
-- **_managed_webhooks 2**
-- public.entitlement_runtime_config_history 0
```

**Schema-level ACL — the boundary that currently holds:**
```sql
SELECT nspname, nspacl::text FROM pg_namespace WHERE nspname IN ('stripe','public');
-- stripe | {postgres=UC/postgres,service_role=U/postgres}
-- public | {postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=UC/postgres}
```
`anon` and `authenticated` have **no USAGE** on `stripe`. Table grants inside it:
```sql
SELECT grantee, table_name, string_agg(DISTINCT privilege_type,',') FROM information_schema.role_table_grants
WHERE table_schema='stripe' AND grantee IN ('anon','authenticated','service_role','PUBLIC') GROUP BY 1,2;
-- service_role | prices   | SELECT
-- service_role | products | SELECT
```
Only two tables are reachable, read-only, by `service_role`. RLS is off on all 29, but the schema
ACL is what is actually holding — not RLS. **No user-facing exposure today.**

**🔴 Two live Stripe webhook endpoints with signing secrets stored in Postgres:**
```sql
SELECT id, object, enabled, livemode, status, api_version, created, last_synced_at,
       (secret IS NOT NULL) AS secret_present, jsonb_array_length(enabled_events) AS n_events
FROM stripe._managed_webhooks ORDER BY created;
```
```
we_1SoYHjBqixZkD6HCeRTg2ozZ | webhook_endpoint | enabled=NULL | livemode=false | status=enabled
                            | created=1768174983 | last_synced_at=2026-01-11 23:43:03.566+00
                            | secret_present=true | n_events=89
we_1SoaTPDPtjyWEVqEdguPV2TE | webhook_endpoint | enabled=NULL | livemode=true  | status=enabled
                            | created=1768183395 | last_synced_at=2026-01-12 02:03:15.555+00
                            | secret_present=true | n_events=89
```
I deliberately did **not** select the `secret` column; only its non-nullness. Both endpoints subscribe
to the same 89 event types — the full Stripe surface (charges, disputes, credit notes, payouts,
refunds, radar fraud warnings, tax IDs, setup intents, subscription schedules, and
`entitlements.active_entitlement_summary.updated`), against Doc 01 V8 §22.1's specified **seven**.
A test-mode and a live-mode endpoint coexist against one database (see Q-E1).

**Note a naming collision that will confuse any future reader:** `stripe.active_entitlements` and
the subscribed `entitlements.active_entitlement_summary.updated` event refer to **Stripe's own
Entitlements product**, which is unrelated to Lyceon's `public.entitlements`.

**A second entitlement predicate exists in prod:**
```sql
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) FROM pg_proc p …
WHERE n.nspname='public' AND p.proname='_rl_has_active_entitlement';
```
```
_rl_has_active_entitlement(uuid) | prosecdef=false | proconfig=NULL

CREATE OR REPLACE FUNCTION public._rl_has_active_entitlement(p_student_user_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'entitlement_active')
  THEN RETURN COALESCE(public.entitlement_active(p_student_user_id), false); END IF;
  RETURN false;
END;
$function$
```
It delegates correctly and fails closed, so it is not a divergent predicate in behaviour. But it is a
second named entry point that `tests/ci/entitlement.single-evaluator.contract.test.ts` cannot see
(that test scans TypeScript source, not `pg_proc`), and its runtime `pg_proc` existence probe is an
unusual construction for a hot RLS path.

**Migration-ledger state (also §1.6):**
```sql
SELECT count(*) AS ledger_rows, min(version), max(version) FROM supabase_migrations.schema_migrations;
-- [{"ledger_rows":16,"oldest":"00000000000000","newest":"20260624020000"}]
```
```sql
SELECT 'idempotency_records' obj, to_regclass('public.idempotency_records')::text UNION ALL …;
-- idempotency_records       | idempotency_records
-- account_deletion_requests | account_deletion_requests
-- stripe_cancellation_queue | NULL          ← §40.2.1 / §24 target table absent
-- audit_logs                | audit_logs
```

**The 8 `entitlement_features` rows, printed.**
```sql
SELECT feature_key, required_tier, required_age_minimum, requires_tier_1_country,
       blocked_during_live_exam, min_abuse_score_tier, enabled, description, added_at, deprecated_at
FROM public.entitlement_features ORDER BY feature_key;
```

| feature_key | required_tier | required_age_minimum | requires_tier_1_country | blocked_during_live_exam | min_abuse_score_tier | enabled | description | added_at | deprecated_at |
|---|---|---|---|---|---|---|---|---|---|
| `calendar_access` | premium | 13 | true | false | clean | true | Study calendar | 2026-06-09 06:35:14.160438+00 | null |
| `exam_full_length` | premium | 13 | true | false | clean | true | Full-length SAT exams | 2026-06-09 06:35:14.160438+00 | null |
| `historical_trends` | premium | 13 | true | false | clean | true | Historical mastery trend data | 2026-06-09 06:35:14.160438+00 | null |
| `mastery_detail` | premium | 13 | true | false | clean | true | Section/domain/skill-level mastery breakdown | 2026-06-09 06:35:14.160438+00 | null |
| `practice_daily_free` | **free** | 13 | true | false | clean | true | Daily practice quota for free tier | 2026-06-09 06:35:14.160438+00 | null |
| `practice_unlimited` | premium | 13 | true | false | clean | true | Unlimited practice | 2026-06-09 06:35:14.160438+00 | null |
| `review_full` | premium | 13 | true | false | clean | true | Full review with spaced repetition | 2026-06-09 06:35:14.160438+00 | null |
| `tutor_access` | premium | 13 | true | **true** | clean | true | LISA AI tutor access; blocked during live exam | 2026-06-09 06:35:14.160438+00 | null |

All 8 keys, tiers, `blocked_during_live_exam` values, and descriptions match Doc 01 V8 §27.2's launch
seed exactly. Note `historical_trends`/`mastery_detail` are the only two any code gates on.

### 3.3 CI

**The `ci-known-gaps` accepted-failure list**, verbatim from `.github/workflows/ci.yml:99-155`. Job
header comment: *"Visibility job — NOT required for merge. Steps are continue-on-error so the job
stays green, but their failures remain visible … Nothing here is hidden or faked green."*

| # | Step | `continue-on-error` | Comment in the workflow |
|---|---|---|---|
| 1 | `pnpm exec tsc -p tsconfig.ci.json` | true | *"KNOWN GAP: 2 real type errors (exam `section` field drift) — exam domain pass."* |
| 2 | `pnpm run audit:ci` + high/critical check | true | *"KNOWN GAP: advisory-DB dependent; promote to a blocking gate once stable."* |
| 3 | `pnpm run lint` (legacy tree) | true | *"ADVISORY: legacy-tree lint. Graduates to fully blocking when advisory violations reach zero."* |

The narrative register is `docs/alignment/KNOWN-GAPS.md` (30 sections).

**Which entries belong to billing or entitlement: none of the three CI steps is billing-scoped.**
Entry 1 is exam-domain. Entry 2 is dependency-audit. Entry 3 is repo-wide lint, which *does* cover
`server/routes/billing-routes.ts` and `server/lib/webhookHandlers.ts` — and since Coding Standards
§3.2 hard-stops are configured at `error` for the shared package but advisory for the legacy tree,
the `any` usages in the billing path (below) are absorbed here rather than failing the build.

In `KNOWN-GAPS.md`, four sections are owned by the `auth-entitlements` unit but none is a billing
delta: `SIGNIN-MISSING-SAFEPARSE` (:300), `AUDIT-PAYLOAD-CONTRACT-DRIFT` (:390), and two deleted CI
contract tests listed at :69-71 (`auth.ci.test.ts`, `routes.ci.test.ts`,
`csrf-route-family.contract.test.ts`). `:67` records a deleted `practice-contract.test.ts` whose
coverage-to-rebuild explicitly included *"entitlement-loss progression"* — that specific coverage is
still absent.

**Not in the accepted-failure list and therefore not visible anywhere:** the five billing/entitlement
test files that no CI job executes (§3.1). They are neither blocking nor advisory — they are unrun.

---

## 4. Gap register

Observed deltas only. "Blocking?" = does this prevent one test student obtaining one real
entitlement row and passing `denyIfNotEntitled`?

| ID | Spec requirement (Doc§) | Observed state (file:line / SQL output) | Delta type | Blocking? |
|---|---|---|---|---|
| G-01 | Doc 01 V8 §31.4 — *"Stripe Customer is guardian; `stripe_customer_id` on guardian's profile"* | `billing-routes.ts:131-196` creates the Customer on the **student** profile with the guardian's email; matches superseded V6:1767 | DIVERGENT | No |
| G-02 | Doc 01 V8 §22.1 — `customer.updated` → sync billing address to `profiles.country_code` | Not a case in `webhookHandlers.ts:297-334` | ABSENT | No |
| G-03 | Doc 01 V8 §22.1 — `invoice.payment_succeeded` → confirm entitlement, update `current_period_end` | `webhookHandlers.ts:316` handles `invoice.paid` (a different event) and only logs | DIVERGENT | No |
| G-04 | Doc 01 V8 §22.1 / §23 — `invoice.payment_failed` → move to past_due grace period | `webhookHandlers.ts:315-322` logs only; no grace transition | ABSENT | No |
| G-05 | Doc 01 V8 §22.2, §45; Doc 01A §36/§38 — Stripe webhook dedupe via `IdempotencyService` scope `stripe_webhook` | Raw 23505 gate at `webhookHandlers.ts:180-209`. `grep -rn "IdempotencyService" --include=*.ts` → no output (only a `genesis.sql:304` comment) | ABSENT | No |
| G-06 | Doc 01 V8 §22.4, §29.1, §45 — `NOTIFY entitlement_invalidate '{student_id}'` after entitlement writes | `grep -rn "entitlement_invalidate" --include=*.ts,*.tsx,*.sql` (excl. docs) → **0 hits** | ABSENT | No |
| G-07 | Doc 01 V8 §29.3, §45 — LISTEN loop on every API instance | `grep -rn "LISTEN " --include=*.ts` → 1 hit, `tutor-config.ts:324`, a comment stating the Supabase HTTP client cannot LISTEN | ABSENT | No |
| G-08 | Doc 01 V8 §26.1 — `canAccessFeature(studentId, featureKey, req): Promise<FeatureAccessResult>` returning `{allowed, reason?, entitlementSnapshot}` | `entitlement-service.ts:92-95` — `(profileId, featureKey): Promise<boolean>`. No reason, no snapshot | DIVERGENT | No |
| G-09 | Doc 01 V8 §27.3 — 7-step evaluation order | `entitlement-service.ts:100-131` implements steps 1 and 5 only; 2, 3, 4, 6, 7 absent | ABSENT | No |
| G-10 | Doc 01 V8 §27.1 gating columns | `required_age_minimum`, `requires_tier_1_country`, `blocked_during_live_exam`, `min_abuse_score_tier` — **zero application reads** (Q-D4 greps); rows carry live values (§3.2) | ABSENT | No |
| G-11 | Doc 01 V8 §33 — every entitlement-gated surface consumes `EntitlementService`; *"No surface implements its own tier check"* | `canAccessFeature` has 2 call sites, both `legacy/progress.ts:78,303`. Practice/review/exam/tutor/calendar use `resolvePaidKpiAccessForUser` (6 sites) or `isEntitlementActiveForProfile` (4 sites) | DIVERGENT | No |
| G-12 | Doc 01 V8 Appendix A.4 + §45 — cache TTL, hard staleness, Tier-1 countries, grace days, trial days, min age in `entitlement_runtime_config` | `SELECT count(*) FROM entitlement_runtime_config` → **0**. Zero application reads | ABSENT | No |
| G-13 | Doc 01 V8 §28 — in-process entitlement cache, 60s TTL, hard staleness bound | No cache in `entitlement-service.ts`; `:88` states *"No caching — each call reads `entitlement_features` fresh"* | ABSENT | No |
| G-14 | Doc 01 V8 Appendix B.2 + §23 — `grace_period_ends_at` drives past_due entitlement (Appendix C:2641) | Column exists in prod; never written (`account.ts:353-370`), never read (`:328-344`), ignored by `entitlement_active()` | ABSENT | No |
| G-15 | Doc 01 V8 §23 — dunning notification cadence Day 0 / 3 / 6 / 8 | No email or notification path on any billing event | ABSENT | No |
| G-16 | Doc 01 V8 §24, §40.2.1 — `stripeCancellationQueue` Postgres durable queue + retry worker | `to_regclass('public.stripe_cancellation_queue')` → **NULL**. Repo hit is one comment, `20260621000000_account_deletion_lifecycle.sql:33` | ABSENT | No |
| G-17 | Doc 01 V8 Appendix E — CI linter rejecting writes outside the named canonical writer | `grep -rn "canonical-writer-exception"` → no output; no lint rule references the ownership matrix | ABSENT | No |
| G-18 | Doc 01 V8 §32, §45 — `packages/shared/services/entitlement-service.ts` | Implementation lives at `server/services/entitlement-service.ts`; `packages/shared/services/` does not exist | DIVERGENT | No |
| G-19 | Doc 01 V8 §31.4 — `resolveLinkedPairPremiumAccessForGuardian` wrapped in `EntitlementService.resolveGuardianEntitlement` | Still called directly: `billing-routes.ts:16` import, `account.ts:686` | ABSENT | No |
| G-20 | — (no spec basis) | **29-table `stripe` schema in prod** (Supabase Stripe sync integration), incl. `customers`(26), `charges`(42), `invoices`(68). Six-term grep of `docs/Spec/` → 0 hits | UNSPECIFIED | No |
| G-21 | — (no spec basis) | **2 live Stripe webhook endpoints** in `stripe._managed_webhooks`, one `livemode=false` + one `livemode=true`, **89 subscribed events each** vs §22.1's 7 | UNSPECIFIED | No |
| G-22 | Doc 06B §4.1 — Stripe runtime secrets bind to **Vercel env vars** | `stripe._managed_webhooks.secret IS NOT NULL` on both rows — signing secrets stored **in Postgres**, a store outside §4.2's `store:` enum | DIVERGENT | No |
| G-23 | Doc 06B §4.4 — *"Deployed secret-named env var absent from inventory"* fails the parity gate | `STRIPE_ENV`, `STRIPE_SECRET_KEY_LIVE/_TEST`, `STRIPE_PUBLISHABLE_KEY_LIVE/_TEST` are read (`stripeClient.ts:14-26`) and undocumented in `docs/ENV.md`; `infra/secret-class-inventory.yaml` does not exist | ABSENT | No |
| G-24 | — (no spec basis) | `STRIPE_ENV` `"live"\|"test"` selector with `_LIVE`/`_TEST` key suffixes (`stripeClient.ts:4-29`); no corpus environment model (`grep -i "livemode\|Stripe account"` → 0 hits) | UNSPECIFIED | No |
| G-25 | — (no spec basis) | `client_reference_id` + 6 metadata keys carry profile identity end-to-end (`billing-routes.ts:240-256` → `webhookHandlers.ts:13-28`); `grep -i "client_reference_id\|checkout metadata"` in `docs/Spec/` → 0 hits | UNSPECIFIED | No |
| G-26 | — (no spec basis) | Guardian identity verification via a **$0.50 Stripe Checkout charge** (`guardian-consent-routes.ts:95,127,212,419`). Doc 01 V8 §37.2's 8-step consent flow is token-and-email only; `grep -i "0.50\|card verification\|micro-charge"` → 0 relevant hits | UNSPECIFIED | No |
| G-27 | Doc 09 §5.1 — *"Doc 09 NEVER hardcodes pricing magnitudes"*; §1.4 Stripe is runtime-canonical | Two hardcoded and **mutually inconsistent** USD price sets: `billing-routes.ts:527-560` (9999/19999/69999) and `server/scripts/seed-products.ts:11-15` (9900/19900/69900) | DIVERGENT | No |
| G-28 | Doc 01 V8 §20 — two tiers (`free`,`premium`) vs Doc 09 §5.2 — three paid tiers | Both are locked-corpus statements; `entitlements_tier_check` admits only 2 values; `checkoutSchema` (`billing-routes.ts:33`) admits 3 plans | CONTRADICTORY | No |
| G-29 | Doc 01 V8 §26.1 `AccessDenialReason` (7 values) vs §27.3 step 1 emitting `feature_disabled` | Internal to one document, one version | CONTRADICTORY | No |
| G-30 | Doc 09 §5.6 — renewal refunds *"not a contractual entitlement; vendor support discretion"* vs Refund Policy §4.1 — unconditional 3-day Renewal Grace Window | Both artifacts dated 2026-05-31 | CONTRADICTORY | No |
| G-31 | Doc 10:224 — *"Lyceon V1 blocks under-13 paid users per Doc 09 §14 criterion #6"* vs Doc 09 W-09-10 — *"Open; gate-list defined"* | Doc 10 asserts settled what Doc 09 records as open | CONTRADICTORY | No |
| G-32 | Doc 01 V8 §20 — *"Stripe Customer per Lyceon profile (one-to-one)"* + §31.3 multi-student guardians | `billing-routes.ts:143` uses `getPrimaryGuardianLink` — the *primary* link only. No purchase path for a second student | UNSPECIFIED | No |
| G-33 | Auto-Renewal Notice §3.2/§3.3/§6.2/§6.7 — separate ARL consent checkbox at checkout + persisted consent record (timestamp, terms version, account) retained ≥3 yrs | Stripe-hosted Checkout (`billing-routes.ts:236`) with no `consent_collection`/`custom_text`; no consent-record table in prod (`%consent%` sweep returns only `guardian_consent_requests`) | ABSENT | No |
| G-34 | Auto-Renewal Notice §6.3 — post-checkout acknowledgment email carrying Offer Terms + cancellation rights | No acknowledgment path on `checkout.session.completed` (`webhookHandlers.ts:148-178`) | ABSENT | No |
| G-35 | Refund Policy §4.1 — renewal refund conditioned on *"not Used the Service since the Renewal Charge"* | No server-side activity signal timestamped against a renewal exists | ABSENT | No |
| G-36 | Refund Policy §8.1 — refund revokes entitlement **immediately** | `refund.created`/`charge.refunded` are not handled (`webhookHandlers.ts:297-334`); both are among the 89 subscribed at the endpoint | ABSENT | No |
| G-37 | Doc 01 V8 §45 — *"`entitlements` migrated to `profile_id` FK"*, *"`accounts`/`account_members` retired"* | `entitlements.profile_id` FK confirmed in prod (§3.2). **Legacy `account_id` fallback still live** on the webhook identity path: `webhookHandlers.ts:18` | DIVERGENT | No |
| G-38 | Doc 01A §14 — *"Violations of the blocked-fields list are treated as security incidents"*; logger transport must redact | `stripeClient.ts:53` logs `secretKeyPrefix: secretKey.slice(0,8)` (= `sk_live_`, no key material); `billing-routes.ts:118` logs a full `priceId`; `/debug/env:824` returns `secretKeyLast4` (auth + guardian role + 404 in production). No transport-layer redaction implementation found | DIVERGENT | No |
| G-39 | Coding Standards §16 — *"No `console.log` in production code — use the structured logger"* | `server/index.ts:125,136,156` use `console.error` on the webhook path; `billingStorage.ts:29,44,59` use `console.error` | DIVERGENT | No |
| G-40 | Coding Standards §3.2 / §17 — no `any` | `webhookHandlers.ts:265,318,335,340`; `billingStorage.ts:10,23,38,52` (`.schema('stripe' as any)`); `billing-routes.ts:644,684,708,771` and throughout | DIVERGENT | No |
| G-41 | Doc 01 V8 §33 — Guardian dashboard uses `getEntitlementSnapshot(guardianId)` → §31 derivation | `kpi-access.ts:86-88` returns hardcoded free for `role === 'guardian'` with reason *"Guardian access is resolved via linked student entitlement middleware"* — derivation deferred to a different layer | DIVERGENT | No |
| G-42 | Coding Standards §14 — tests required for anti-leak / idempotency / denial behaviour | 5 files / 52 tests (`tests/entitlements.webhook.test.ts`, `server/__tests__/billing-truth.test.ts`, `billing-checkout.test.ts`, `guardian-payment-access.test.ts`, `deletion-lifecycle.test.ts`) are **executed by no CI job** (`grep -rn "vitest run\|pnpm test" .github/workflows/*.yml` → 3 lines, none covering them) | DIVERGENT | No |
| G-43 | Doc 01 V8 §48 / WS-M INV-M-02 — migration ledger is a complete record of what is applied | `schema_migrations` = 16 rows, newest `20260624020000`; repo has **45** files. **29 unrecorded**, incl. `20260809000000` which created `stripe_webhook_events` | DIVERGENT | No |
| G-44 | WS-M §4 — *"No new migrations are authored anywhere in the program until M1.2 passes"* | 13 migration files dated after 2026-08-04 exist in `supabase/migrations/` | DIVERGENT | No |
| G-45 | — (no spec basis) | `public._rl_has_active_entitlement(uuid)` — a second named entitlement entry point in prod, invisible to `entitlement.single-evaluator.contract.test.ts` (which scans TS source only) | UNSPECIFIED | No |
| G-46 | Doc 09 §6.7 — V1 is USD-only vs Auto-Renewal Notice §3.2 — display renewal amount *"in your local currency"* at checkout for all Tier-1 markets | Structural tension between a directional doc and a published legal artifact | CONTRADICTORY | No |
| G-47 | Doc 01A §36 — `IdempotencyService` is the canonical writer of `idempotency_records` | Table exists in prod; no service writes it. `billingStorage.getProduct:6` calls RPC `query_stripe_products`, which **does not exist** in prod (`pg_proc` sweep) — every call silently falls through to a 0-row `stripe.products` read | ABSENT | No |

**Nothing in this register is marked Blocking.** The narrow path — student signs up → `POST
/api/billing/checkout` → Stripe Checkout → `checkout.session.completed` → `upsertEntitlement` →
`entitlement_active()` returns true — is intact end to end and proven by
`tests/ci/entitlement-write-path.ci.test.ts` against real Postgres. Every delta above degrades
correctness, compliance, or observability **around** that path without severing it. The one delta
that would sever it is not present: `entitlements_profile_id_unique` exists in production (§3.2), so
the upsert's `onConflict` target resolves.

---

## 5. Open questions for the owner

1. **Q-A1 payer identity** — V8 §31.4 says the guardian is the Stripe Customer; the code puts the
   Customer on the student profile with the guardian's email. Which is intended, and does the
   superseded V6 file get removed from `docs/Spec/`?
2. **Q-B1 tier count** — Doc 01 V8 §20 says one paid tier; Doc 09 §5.2 says three. Do three Stripe
   Prices collapse to `tier='premium'`, or does the `tier` CHECK domain change?
3. **Q-A2 contract capacity** — may a 13–17-year-old be the contracting party for a paid
   subscription, or must the guardian be? Unanswerable until Parent Terms and Student ToS exist.
4. **Q-A3 multi-student households** — supported at launch? If yes, how does a guardian buy for a
   second student when `getPrimaryGuardianLink` returns one link and §20 says one Customer per profile?
5. **Q-A5 adult self-serve** — is 18+ with no guardian a launch cohort, or is the product
   under-18-only per Doc 10 §2.4's taxonomy?
6. **Under-13 paid users** — Doc 10:224 says blocked; Doc 09 W-09-10 says open and launch-gating.
   Which is it?
7. **Q-D2 country change** — an existing subscriber's billing country moves out of Tier-1. Cancel,
   refund, or continue billing while denying features?
8. **Q-E1 environment model** — one Stripe account with test/live keys, or two accounts? Both a
   test-mode and a live-mode webhook endpoint currently point at the same database. Must `livemode`
   be asserted on inbound webhooks?
9. **The `stripe` schema (G-20/G-21)** — is the Supabase Stripe sync integration sanctioned? It is
   configured, subscribed to 89 event types on two endpoints, and absent from the entire corpus.
10. **Q-C9 raw payload persistence** — Doc 01A §14 forbids raw Stripe payloads in *logs* and is
    silent on *database* persistence, while `stripe.customers`/`charges`/`invoices` are provisioned
    to receive exactly that for a 13–18 user base. Which document owns the persistence rule?
11. **Q-C8 webhook signing secret** — Doc 06B §4.1 binds Stripe secrets to Vercel env vars, but the
    signing secret currently also lives in `stripe._managed_webhooks.secret` in Postgres. Which store
    is canonical, and does §4.2's `store:` enum need a value it does not have?
12. **Q-B6 / G-33 ARL consent capture** — the Notice requires a separately marked consent control at
    checkout and a persisted consent record with a terms version. Stripe-hosted Checkout is the
    current surface and no consent table exists. Which surface owns this?
13. **Q-C3 `stripe_webhook_events` shape** — should it carry `livemode`, a processed timestamp, or a
    payload hash, or is the three-column gate the intended terminal shape?
14. **G-30 renewal refunds** — Doc 09 §5.6 (discretionary) vs Refund Policy §4.1 (3-day right).
    Which governs, and what activity signal satisfies "not Used the Service"?
15. **Q-E2 checkout abuse** — no bucket exists in Doc 01A §39.2 or §46 for checkout. Is an
    unrate-limited endpoint that creates Stripe Customers and calls `prices.retrieve` acceptable?
16. **Q-E4 proving mechanisms** — should the billing/entitlement §45 criteria be re-expressed in
    Doc 06's six-element proving-mechanism form (named `ci/`/`ops/` mechanism, location, cadence,
    failure condition, proof artifact, owner)?
17. **G-42 unrun tests** — five billing/entitlement test files (52 tests) execute in no CI job. Wire
    them in, or delete them?
18. **G-43/G-44 migration ledger** — the unrecorded set has grown from 16 to 29 and 13 migrations
    were authored after the WS-M §4 freeze. Does the Stripe vertical wait on M1.2, or is it exempt?
19. **§26.2's internal mis-citation** — it points at §27.1 for the deterministic denial order, which
    lives in §27.3. Fold into the next spec pass?
20. **G-26 guardian $0.50 verification** — a Stripe Checkout charge is used as an identity signal in
    a flow Doc 01 V8 §37.2 specifies as token-and-email only. Sanctioned, and does it belong to the
    billing vertical or the consent vertical?

---

## 6. Self-check

**1. Did I open every spec section I cited and confirm its heading matches the subject? Any mismatches reported?**
Yes — every citation was read with `sed -n` on its line range and its heading printed. Four mismatches found and reported:
(a) the task brief's own premise that §27.3 carries the `canAccessFeature` signature — it carries the evaluation order; the signature is §26.1 (Q-D3);
(b) Doc 01 V8 §26.2 cites *"deterministic order per §27.1"* — the order is §27.3 (Q-D3, open question 19);
(c) Doc 01 V8 §20 references *"premium features per §30 matrix"* — §30 is "Failure modes"; the permission matrix is §16;
(d) repo annotations: `entitlement-service.ts:2` cites *"Doc-01_V8 §20–§24 entitlements"* (that range is Part IV Billing; EntitlementService is Part V §25–§34), and `:72` cites *"Doc-01_V8 §20 entitlement_features"* (that table is §27.1). Both are the exact defect class §0.2 warns about.

**2. Does every absence claim carry the literal command and its empty output?**
Yes. Every absence is shown as the command plus its literal result — either explicit `# (no output)` / `# 0 hit(s)`, or a printed non-empty result demonstrating that the only hits are irrelevant (e.g. the `find … -iname "*parent*"` sweep, the `"self-serve"` sweep, the per-column greps in Q-D4). Multiple terms were used per claim: 4 phrasings for contract capacity, 6 for the sync engine, 4 for checkout rate limiting, 3 for `client_reference_id`/metadata, 4 for the environment model. Where a search returned hits I judged irrelevant, I printed them rather than reporting zero.

**3. Did I ever report a spec answer when I had only found repo code?**
No. SPEC / REPO / PROD are kept in separate labelled paragraphs throughout, and every SPEC claim carries a Doc + § + verified heading. Where only code exists, the classification is UNSPECIFIED (G-20, G-21, G-24, G-25, G-26, G-32, G-45) or the answer is SPEC-SILENT. The three near-misses I deliberately did **not** promote: `entitlement_active`'s status set is prod truth confirmed by SCL-029 and the migration file, not a Doc 01 statement (Appendix B.2's CHECK is a domain, not the entitled-set predicate); `resolvePaidKpiAccessForUser` has no spec basis at all; and the three-plan `monthly/quarterly/yearly` shape is code + Doc 09 direction, never Doc 01.

**4. Did I copy any spec table or enumeration into this document instead of referencing it?**
Partly, and deliberately — flagged here rather than hidden. §0.4 permits one short load-bearing line; I exceeded that in four places where the exact text *is* the deliverable: §26.1's signature, return type, and `AccessDenialReason` enum (Q-D3 asks for them verbatim); the §22.1 event names (Q-C1 asks for the list); the Appendix E `entitlements` row (Q-A6 asks for the named writer); and the §27.1 column names (Q-D4 requires per-column grep evidence). Everywhere else I referenced without restating — the `entitlements.status` CHECK domain (Q-C5), the §21 transition table, §27.2's seed values, the Tier-1 country list, and the A.4 config table are all pointed at, not reproduced. The one full table I did print is the **production** `entitlement_features` rows, which §3.2 explicitly requires and which is prod truth, not spec text.

**5. Did I supply an industry-standard answer anywhere the spec was actually silent?**
No. Q-C1 was the trap and I resisted it — the seven §22.1 events are reported and nothing was added from Stripe's standard set, even though production subscribes to 89. Q-E1, Q-E2, Q-D2, Q-A2, Q-A3, Q-A5, Q-C3, Q-C9 are all reported silent with no filled-in default. Where a mechanism exists in code with no spec basis, it is labelled UNSPECIFIED, never presented as the answer.

**6. Did any `SELECT` fail or return an error that I reported as an empty result?**
One query errored and it is disclosed: the first `stripe._managed_webhooks` read used `cardinality(enabled_events)` and failed with `ERROR: 42883: function cardinality(jsonb) does not exist`. It was re-run with `jsonb_array_length` and returned 2 rows — the result reported in §3.2. No other query errored. The genuinely empty results (`pg_policies` → `[]`; `entitlement_runtime_config` → 0 rows; `stripe_cancellation_queue` → `NULL`) all executed successfully.

**7. Is there any recommendation, plan, or proposed design in this document?**
No. §4 records observed deltas only. §5 is questions, not answers — each names an unresolved decision without proposing an option. No sequencing, no effort estimate, no "should", no proposed table, column, module, or migration anywhere. Where a delta has an obvious fix I stated only what is absent. The Blocking column is a factual yes/no about one test student obtaining one entitlement row, not a priority ranking.

---

## 7. Addendum — Phase A verification and the G-28 correction

Added 2026-08-20 after the Phase A multi-student corpus sweep. The body above is unchanged; this
section records two amendments to it.

### 7.1 G-28 is WITHDRAWN — not a contradiction

G-28 recorded Doc 01 V8 §20 ("two tiers") against Doc 09 §5.2 ("three paid tiers") as
`CONTRADICTORY`, and Q-B1 was classified SPEC-CONTRADICTORY on the same basis. **Both are withdrawn.**
§5.2's own closing sentence resolves it: *"The paid tiers deliver the same product … the
differentiation is billing-period commitment."* Doc 09 uses "tier" for a price point; Doc 01 V8 uses
it for an entitlement level. Three Stripe Prices, one `tier='premium'`. The classification was drawn
from §5.2's headline without reading to the end of the subsection — the exact failure mode §0.2 of
this audit warns about, committed by this audit. Corrected classification: **Q-B1 is SPEC-DETERMINED**
(one entitlement tier, three billing periods; no doc names a Price ID or a price-catalog table, which
is unchanged). Recorded as SCL-052.

Revised tally: SPEC-DETERMINED 21 · SPEC-SILENT 8 · SPEC-CONTRADICTORY 0 · SPEC-VS-REPO-DIVERGENT 2.

### 7.2 Q-A3 (multi-student) — premise verified, and the foreclosure relocated

Q-A3 remains **SPEC-SILENT on the purchasing mechanism** — re-verified on twelve terms; `quantity`,
`second student`, `additional student`, and `second subscription` all return zero across `docs/Spec/`
and `docs/plans/`, and `family plan` occurs once corpus-wide as a `(future)` placeholder in Doc 01 V8
§42. But the audit understated what the corpus *does* determine, and misplaced the foreclosure:

- **Doc 01 V8 §35** (heading verified: `## **§35 Guardian-student linkage**`) states *"Guardians are
  linked to **one or more** students"*. Multi-student linkage is spec'd, not merely tolerated.
- **The database does not foreclose it.** `guardian_links` carries only
  `unique_active_link UNIQUE NULLS NOT DISTINCT (guardian_profile_id, student_profile_id, status)` —
  one active link per *pair*, permitting N students per guardian, matching §35 exactly.
- **The foreclosure is entirely application-layer**, and `getPrimaryGuardianLink` was only one of
  four sites. `createGuardianLink` (`server/lib/account.ts:39-72`) refuses the second link outright;
  `getAllGuardianStudentLinks` (`:575-597`) throws on >1 despite its name. Recorded in SCL-045.

### 7.3 New finding — the guardian-link data layer is broken against production

Not visible in the original sweep. All four guardian-link helpers query `student_user_id`,
`account_id`, and `linked_at` — columns that exist in production, in `genesis.sql`, and in no
migration. Every guardian-paid path throws before reaching Stripe. Recorded as a defect, not an SCL,
in `docs/plans/WS-GL_Guardian_Link_Data_Layer.md`.

### 7.4 G-42 refinement — `tests/ci/guardian-linking.contract.test.ts` is not hollow, but overclaims

It is green because `vi.mock('../../server/lib/account', …)` at line 54 replaces the module, so the
real (broken) function never runs. It genuinely guards the route's error-code→HTTP mapping
(`server/routes/guardian-routes.ts:249-279`) — planted-failure verified, yielding
`expected 500 to be 409`. Its `describe` name claims to enforce the 1:1 invariant, which lives in the
mocked-out function. Retires with SCL-045's promotion, never before.

---

**END — Phase A addendum applied 2026-08-20. Phase B recorded in `docs/SpecAudit/SPEC_CHANGES_LOG.md` (SCL-042…SCL-052).**
