# **Doc 02C — Mastery, KPI & Database Canonical Contract**

**Version:** V4.0 **Status:** CANONICAL (supersedes V3.1) **Supersedes:** V3.1 (2026-04), V3 (2026-03), PDF-05 (Adaptive/Mastery Engine), portions of PDF-09 (KPIs & Analytics), Db\_Canonical\_Runtime\_Contract.pdf (mastery sections) **Owners:** Lyceon Platform Team **Last updated:** 2026-04-22 **Document family:** Doc 02 Preamble \+ 02A (Question Generation) \+ 02B (Runtime Engines) \+ 02C (this document)

---

## **Executive Summary of V4**

V4 replaces the running-additive mastery update algorithm from V3.1 with a **pooled weighted-fraction formula** that evaluates mastery as the ratio of weighted correct contributions to event count. The update preserves all V3.1 architectural decisions (weekly snapshots, Monday 3am recompute, active-only handling, 26-week lookback, cluster deprecation path, scaling tiers, algorithm evolution governance, full-length truth anchor, post-exam score reporting loop). Only the inner mastery formula and its constants change.

**What changes in V4:**

1. **Per-event math:** mastery \= MIN(1.0, SUM(is\_correct × source\_weight × difficulty\_weight) / COUNT of events). No alpha, no running-additive updates, no negative deltas for fails.  
2. **Source weights replace pass/fail deltas:** review 0.8, practice 1.0, test 1.5. Each event's numerator contribution scales by source\_family and difficulty.  
3. **Difficulty multipliers:** easy 0.8, medium 1.0, hard 1.2. Applied uniformly (same multiplier whether pass or fail — fails simply contribute 0 to numerator, so the multiplier only matters for correct answers).  
4. **Half-life across weekly snapshots:** weekly\_snapshot values combined with 0.5^(weeks\_ago / 3\) weighting. Inner per-week snapshot uses pooled V4 formula without time weighting.  
5. **Retired constants:** alpha, base\_delta\_practice\_pass, base\_delta\_practice\_fail, base\_delta\_review\_pass, base\_delta\_review\_fail, base\_delta\_test\_pass, base\_delta\_test\_fail.  
6. **New columns:** mastery\_numerator, mastery\_denominator on student\_skill\_mastery (running sums for real-time computation).  
7. **New table:** student\_skill\_weekly\_snapshot (stores per-week pooled mastery values; enables weekly recompute and trend charts).

**What stays the same from V3.1:**

1. 0-4 mastery level ladder  
2. Weekly recompute architecture (Monday 3am America/Chicago pg\_cron)  
3. Active-only handling (has\_activity\_this\_week \= TRUE; no zero-fill, no carry-forward)  
4. 26-week lookback window  
5. mastery\_events table for audit and analytics  
6. Real-time RPC between batches; batch re-anchors weekly  
7. Cluster tier deprecation path (§31)  
8. Scaling evolution tiers (§32)  
9. Algorithm evolution governance (§33)  
10. Projection calibration roadmap (§34)  
11. Post-exam score reporting loop (§34.X)  
12. Idempotency \+ missed-run recovery (§18.X)  
13. Full-length truth anchor (§23.1-23.4)  
14. Evidence-quality extension to projection as target-state (§24.X)  
15. Extended-inactivity decay as future-target (§20.X)  
16. Official SAT blueprint weights (Math: Algebra 0.35, Advanced Math 0.35, PSDA 0.15, Geom/Trig 0.15; RW: Craft and Structure 0.28, Info and Ideas 0.26, Standard English 0.26, Expression of Ideas 0.20; College Board provenance)  
17. Three-level verification labeling (verified from RPC body / documented by intent / proposed)

**Intent of V4:** Address the double-counting problem identified in V3.1 pooled review sessions (where negative base deltas for fails caused fails to count twice — once via subtraction, once via denominator mass in V3 running-additive math). V4's pooled weighted-fraction formula treats fails as zero contribution to numerator while still counting in denominator, eliminating double-counting. Source and difficulty weights reward harder and higher-value evidence without per-event clamping catastrophes.

---

## **Part I — Context**

### **§1 — Purpose**

Doc 02C defines the canonical mastery engine, KPI rollup structure, and database contracts for Lyceon's SAT preparation platform. It specifies:

1. How per-event learning outcomes translate into per-skill mastery scores  
2. How per-skill mastery aggregates into per-domain mastery  
3. How per-domain mastery combines into per-section projection  
4. How full-length exam results interact with derived projection  
5. How all of the above are persisted, recomputed, and audited  
6. The SQL contracts (RPCs, tables, triggers, pg\_cron jobs) that implement this system

Doc 02C is authoritative for all mastery, KPI, and database decisions. Conflicts with earlier PDFs (PDF-05, PDF-09, Db\_Canonical\_Runtime\_Contract) are resolved in favor of Doc 02C.

### **§2 — Scope**

**In scope:**

* Per-skill mastery computation (Level 1 real-time \+ Level 2 weekly batch)  
* Difficulty bucketing and source\_family categorization  
* Weekly snapshot structure and half-life recompute  
* Domain and section aggregation formulas  
* Section projection computation (scaled score midpoint \+ band)  
* Full-length truth anchor and post-exam reporting loop  
* Schema contracts for all mastery-related tables and RPCs  
* Constants catalog (mastery\_constants, kpi\_constants)  
* Verification queries and before-implementation checks  
* Migration plan from V3.1

**Out of scope:**

* Question generation and content metadata (Doc 02A)  
* Runtime engine UX (Doc 02B)  
* Identity, access, billing (Doc 01\)  
* Platform infrastructure beyond what mastery requires

### **§3 — Dependencies**

* Doc 00 (Authoritative Platform Directive) — platform invariants  
* Doc 01 V6 (Identity, Access, Billing, Guardian Trust) — student\_id normalization, entitlement model, guardian derivation  
* Doc 02 Preamble V3 — Doc 02 structural conventions  
* Doc 02A V6 — Question Generation; determines difficulty metadata source  
* Doc 02B V4 — Runtime Engines; determines source\_family event emission contract  
* Official SAT Blueprint (College Board Digital SAT) — section/domain weight anchors  
* Supabase Postgres 15+ with pgvector, pg\_cron, RLS  
* Database canonical runtime contract (superseded portions)

### **§4 — Glossary (V4 Updated)**

**Event** — A single student attempt on a single question, emitted by a runtime engine. Contains: student\_id, section, domain, skill, difficulty, source\_family, is\_correct, latency\_ms, occurred\_at.

**Source family** — The runtime engine that emitted the event. One of: {practice, review, test}. Constant per event.

**Difficulty bucket** — The question's difficulty class. One of: {easy, medium, hard}. Derived from Doc 02A's difficulty\_rating via normalize\_difficulty\_bucket.

**Source weight** — Multiplicative constant per source\_family used in mastery numerator. review=0.8, practice=1.0, test=1.5.

**Difficulty weight** — Multiplicative constant per difficulty bucket used in mastery numerator. easy=0.8, medium=1.0, hard=1.2.

**Mastery score** — A numeric value in \[0, 1\] representing a student's demonstrated competence on a specific skill. Computed per (student, skill) from weighted event contributions.

**Mastery level** — Discrete label for display (0=Not Started, 1=Needs Work, 2=Developing, 3=Proficient, 4=Strong). Derived from mastery\_score via map\_mastery\_level.

**Mastery numerator** — Running sum: SUM(is\_correct × source\_weight × difficulty\_weight) across all events for a (student, skill). Stored on student\_skill\_mastery.

**Mastery denominator** — Running count: COUNT of all events for a (student, skill). Stored on student\_skill\_mastery. In Level 2 weekly recompute, the "denominator" is half-life weighted SUM across weeks.

**Weekly snapshot** — A (student, skill, week\_start\_date) row in student\_skill\_weekly\_snapshot storing the pooled V4 mastery computed from events in that week only.

**Half-life** — Parameter controlling recency weighting in Level 2 recompute. V4 locked at 3 weeks across weekly snapshots.

**Lookback** — Parameter controlling how far back the Level 2 recompute considers weekly snapshots. V4 locked at 26 weeks.

**Active-only** — Recompute mode that only considers weekly snapshots where has\_activity\_this\_week \= TRUE. Skips weeks with no events. No zero-fill, no carry-forward.

**Domain mastery** — Aggregated mastery for a (student, section, domain) computed from underlying skill masteries, weighted by attempts.

**Section projection** — Computed SAT scaled-score projection for a (student, section), including a midpoint and band width.

**Truth anchor** — Full-length exam result that overrides derived projection for the section on the exam date and for a defined window after.

**Runtime RPC** — apply\_learning\_event\_to\_mastery, the Supabase function invoked by runtime engines after every event. Updates student\_skill\_mastery in real time.

**Weekly batch** — refresh\_weekly\_mastery\_snapshot, the pg\_cron job that runs every Monday 3am America/Chicago and re-anchors mastery\_score using half-life weighted snapshots.

**RETIRED FROM V3:** alpha, base\_delta\_practice\_pass, base\_delta\_practice\_fail, base\_delta\_review\_pass, base\_delta\_review\_fail, base\_delta\_test\_pass, base\_delta\_test\_fail. These no longer exist in mastery\_constants after V4 migration.

### **§5 — Architectural Context**

Lyceon's mastery system operates on three aggregation tiers:

1. **Skill tier** — Atomic unit. Per (student, skill) mastery score. Updated per event via RPC, re-anchored weekly via batch.  
2. **Domain tier** — Per (student, section, domain). Computed from constituent skill masteries, weighted by attempts. Updated when underlying skill mastery changes (via refresh\_domain\_mastery\_for\_student\_domain).  
3. **Section tier** — Per (student, section). Scaled-score projection (midpoint \+ band). Computed from domain masteries weighted by official SAT blueprint. Updated when underlying domain mastery changes.

Cluster tier is **deprecated** (see §31). All production reads go to skill, domain, or section tiers directly. Cluster-tier reads are audited for callers, which are then migrated to skill-tier reads.

Events flow as follows:

Student answers question  
  → Runtime Engine (Doc 02B) emits mastery event  
  → apply\_learning\_event\_to\_mastery RPC called synchronously  
    → Update student\_skill\_mastery (Level 1 real-time mastery\_score)  
    → Insert row into mastery\_events (audit/analytics)  
    → Update student\_kpi\_rollups\_current (per-day aggregates)  
    → Trigger refresh\_domain\_mastery\_for\_student\_domain for affected domain  
    → Trigger refresh\_section\_projection\_for\_student\_section for affected section  
  → RPC returns updated mastery\_score, domain\_score, projection to runtime

  \[Monday 3am America/Chicago\]  
  → refresh\_weekly\_mastery\_snapshot pg\_cron job  
    → Upsert student\_skill\_weekly\_snapshot rows for last 26 weeks  
    → Recompute student\_skill\_mastery.mastery\_score with half-life weighted  
    → Refresh domain mastery for all affected students  
    → Refresh section projection for all affected students

---

## **Part II — Mastery Engine (V4)**

### **§6 — Mastery Ladder**

Mastery score maps to one of five discrete levels for display:

| Score range | Level | Label |
| ----- | ----- | ----- |
| 0.00 \- 0.19 | 0 | Not Started |
| 0.20 \- 0.39 | 1 | Needs Work |
| 0.40 \- 0.59 | 2 | Developing |
| 0.60 \- 0.79 | 3 | Proficient |
| 0.80 \- 1.00 | 4 | Strong |

**Implementation:** map\_mastery\_level(score NUMERIC) RETURNS INTEGER. Pure function, deterministic.

**Display convention:** UI displays integer level (0, 1, 2, 3, 4\) with accompanying label. Internal systems store and manipulate the numeric mastery\_score. Mastery score is never displayed directly to students or guardians.

**Threshold values stored in mastery\_constants:**

* mastery\_level\_1\_threshold \= 0.20  
* mastery\_level\_2\_threshold \= 0.40  
* mastery\_level\_3\_threshold \= 0.60  
* mastery\_level\_4\_threshold \= 0.80

### **§7 — Event Model**

Every learning event is emitted by a runtime engine (practice, review, or test) and processed as follows:

**Event contract (verified from Doc 02B V4):**

Event {  
  student\_id: UUID  
  section: TEXT  \-- 'math' or 'rw'  
  domain: TEXT  \-- canonical domain name  
  skill: TEXT  \-- canonical skill name  
  difficulty\_rating: INTEGER  \-- 1-5 from question metadata  
  source\_family: TEXT  \-- 'practice' | 'review' | 'test'  
  is\_correct: BOOLEAN  
  latency\_ms: INTEGER  
  occurred\_at: TIMESTAMPTZ  
}

**Derived at RPC time:**

* difficulty\_bucket: normalize\_difficulty\_bucket(difficulty\_rating) returns 'easy' | 'medium' | 'hard'

**Difficulty bucket mapping (verified from RPC body):**

* rating 1-2 → easy  
* rating 3 → medium  
* rating 4-5 → hard

### **§8 — Source Family Definitions**

Three source families are recognized. Each corresponds to a runtime engine in Doc 02B.

**practice** — Structured practice sessions. Default learning mode. Source weight: 1.0.

**review** — Post-failure review flow. Student re-attempts a question after failing it, typically with explanation scaffolding. Source weight: 0.8 (reflects scaffolded nature).

**test** — Full-length or section-length exam under timed, realistic conditions. Source weight: 1.5 (reflects the predictive value of exam-condition evidence for SAT readiness).

**Source weights stored in mastery\_constants:**

* source\_weight\_review \= 0.8  
* source\_weight\_practice \= 1.0  
* source\_weight\_test \= 1.5

**Rationale for weight values:**

Review events involve scaffolding (explanations, hints, second-attempt context) and are less predictive of independent SAT performance than practice. Weight 0.8 caps review-only mastery at 0.8 for easy-only evidence and 0.96 for hard-only evidence — meaningful Level 3-4 contribution, not Level 0\.

Practice events are the baseline for independent learning. Weight 1.0 means a perfect medium-practice student reaches mastery 1.0 — the canonical "Strong" case.

Test events are under realistic exam conditions and have direct predictive relationship to actual SAT performance. Weight 1.5 amplifies exam-sourced mastery above practice, achieving 20-30% exam influence at realistic volumes (1-2 exams per week alongside daily practice).

**Test weight selection:** 1.5 was selected after comparative simulation over candidate values 1.3, 1.5, and 1.8. 1.3 produced exam influence roughly proportional to exam volume (no amplification). 1.8 compressed mastery distribution toward the ceiling, reducing level differentiation. 1.5 produced meaningful amplification (exam punches above volume) without compression. Tunable at future review; see §33 algorithm evolution governance.

### **§9 — Intermediate Structure (Unchanged from V3.1)**

Doc 02C retains the three-tier aggregation structure from V3.1: skill → domain → section. No intermediate "cluster" tier (deprecated per §31). Events are always attributed to (student, section, domain, skill, difficulty, source\_family), which uniquely identifies where and how to apply them.

### **§10 — Taxonomy Conventions (Unchanged)**

Canonical section, domain, and skill names are defined in Doc 02A. Doc 02C receives events pre-tagged and does not alter taxonomy. Taxonomy evolution (new skills, renamed domains) is a Doc 02A concern handled via migration.

### **§11 — Event Emission Ordering (Unchanged)**

Events are emitted synchronously by runtime engines on answer submission. apply\_learning\_event\_to\_mastery is called within the same transaction where possible; retry semantics (on network/DB failure) are handled by Doc 02B.

### **§12 — Timezone Anchoring (Unchanged)**

All weekly snapshot computations use America/Chicago as the canonical business timezone. Events are stored in UTC (occurred\_at TIMESTAMPTZ). Weekly buckets are computed by: DATE\_TRUNC('week', occurred\_at AT TIME ZONE 'America/Chicago').

Monday 3am America/Chicago is the weekly batch trigger. This corresponds to 8am UTC in winter (standard time) and 9am UTC in summer (daylight saving). pg\_cron job is scheduled with explicit timezone handling.

### **§13 — Data Retention (Unchanged)**

* mastery\_events: retained indefinitely (audit/analytics)  
* student\_skill\_mastery: current state, overwritten by Level 2 recompute  
* student\_skill\_weekly\_snapshot: retained for 52 weeks minimum (trend charts, longitudinal analysis)  
* student\_domain\_mastery: current state, overwritten on recompute  
* student\_section\_projections: current state, overwritten on recompute  
* student\_kpi\_rollups\_current: per-day aggregates, retained 52 weeks minimum

### **§14 — Idempotency Base Contract (Unchanged)**

All RPCs are designed idempotent with respect to (student, event\_id) tuples. Re-delivery of the same event should not double-count. See §18.X for idempotency enforcement mechanics.

### **§15 — Difficulty Buckets and Multipliers (V4 Updated)**

Each event's difficulty\_rating (1-5 from Doc 02A) is normalized into three buckets:

**Difficulty bucket mapping:**

* rating 1 or 2 → 'easy'  
* rating 3 → 'medium'  
* rating 4 or 5 → 'hard'

**Difficulty weights for V4:**

| Bucket | Weight | Rationale |
| ----- | ----- | ----- |
| easy | 0.8 | Easier questions are less predictive of SAT readiness; weighted below baseline |
| medium | 1.0 | Baseline difficulty; matches average SAT question difficulty |
| hard | 1.2 | Harder questions demonstrate stretch; weighted above baseline |

**Weights stored in mastery\_constants:**

* difficulty\_weight\_easy \= 0.8  
* difficulty\_weight\_medium \= 1.0  
* difficulty\_weight\_hard \= 1.2

**Change from V3:** V3 used difficulty\_multiplier\_hard \= 1.3 (current RPC verified). V4 reduces to 1.2 for narrower spread (1.5× max/min instead of 1.625× in V3). The weight structure preserves monotonicity (easy \< medium \< hard) but with gentler differentiation.

**Applied symmetrically:** The difficulty\_weight multiplies the is\_correct × source\_weight term. When is\_correct \= FALSE, this product is 0 regardless of difficulty\_weight. Therefore difficulty only matters for correct answers — getting a hard question right contributes more to numerator than getting an easy question right. Getting either wrong contributes 0\.

**Helper function (verified from V3 RPC body):**

get\_difficulty\_multiplier(p\_bucket TEXT) RETURNS NUMERIC  
\-- Returns the constant difficulty\_weight\_\<bucket\> from mastery\_constants

This helper is retained in V4 with updated constant values. Callers do not change.

### **§16 — V4 Pooled Weighted-Fraction Formula (New — Replaces V3 Running-Additive)**

**The core V4 formula:**

For each (student, skill), mastery\_score is computed as:

mastery\_score \= MIN(1.0,  
  SUM over all events of (is\_correct × source\_weight × difficulty\_weight)  
  /  
  COUNT of all events  
)

Where:

* `is_correct` \= 1 if event is correct, 0 if incorrect  
* `source_weight` \= constant per source\_family (review 0.8, practice 1.0, test 1.5)  
* `difficulty_weight` \= constant per difficulty bucket (easy 0.8, medium 1.0, hard 1.2)

**Interpretation:**

Numerator sums weighted correct contributions. Each correct event contributes (source × difficulty). Each incorrect event contributes 0\.

Denominator is the raw count of events. Every event (correct or incorrect) increments by 1\.

Ratio is the student's weighted accuracy rate. Clamped to 1.0 as safety ceiling (natural for most cases; only test × hard correct \= 1.5 × 1.2 \= 1.8 per event exceeds 1.0 per-event contribution, and only when volume is test-hard-heavy).

**Why this works:**

1. **Fails don't subtract.** They contribute 0 to numerator. V3's \-0.50 / \-0.30 / \-0.60 base deltas caused double-counting (fail contributed negatively AND denominator mass); V4 eliminates this.  
2. **Higher-value evidence rewards numerator more.** Correct hard test \= 1.5 × 1.2 \= 1.8 numerator; correct easy review \= 0.8 × 0.8 \= 0.64. Students who demonstrate on harder/higher-value content earn more mastery per event.  
3. **Volume dampens individual event impact.** A single event can move mastery at most by ((new\_contribution \- previous\_mastery) / (new\_count)). As total event count grows, each event moves mastery less. Matches intuition about "evidence accumulation."  
4. **Naturally bounded at 1.0.** Clamp is safety, not active math for most cases. Students cannot exceed 1.0 except when test × hard contributions dominate.

**Baseline cases (verify formula produces expected values):**

| Scenario | Expected mastery\_score | Level |
| ----- | ----- | ----- |
| 100 easy practice, all correct | 0.80 | 4 Strong (low) |
| 100 medium practice, all correct | 1.00 | 4 Strong (max) |
| 100 hard practice, all correct | 1.20 → clamped 1.00 | 4 Strong (max) |
| 100 easy review, all correct | 0.64 | 3 Proficient |
| 100 medium review, all correct | 0.80 | 4 Strong (low) |
| 100 hard review, all correct | 0.96 | 4 Strong (high) |
| 100 medium test, all correct | 1.50 → clamped 1.00 | 4 Strong (max) |
| 100 medium practice, 85% correct | 0.85 | 4 Strong |
| 100 medium practice, 50% correct | 0.50 | 2 Developing |

**Per-event contribution table:**

| Source × Difficulty | Correct | Incorrect |
| ----- | ----- | ----- |
| review × easy | 0.64 | 0 |
| review × medium | 0.80 | 0 |
| review × hard | 0.96 | 0 |
| practice × easy | 0.80 | 0 |
| practice × medium | 1.00 | 0 |
| practice × hard | 1.20 | 0 |
| test × easy | 1.20 | 0 |
| test × medium | 1.50 | 0 |
| test × hard | 1.80 | 0 |

Denominator contribution is always 1 per event.

**Worked example 1 — Pure practice student:**

Student: 300 medium practice, 85% correct (255 correct, 45 incorrect).

Numerator \= 255 × 1.0 × 1.0 \+ 45 × 0 \= 255  
Denominator \= 300  
mastery\_score \= MIN(1.0, 255/300) \= 0.85  
Level: 4 Strong

**Worked example 2 — Mixed evidence with exam:**

Student:

* 200 medium practice, 85% correct (170 correct, 30 incorrect)  
* 50 medium review, 100% correct  
* 44 medium test, 60% correct (26 correct, 18 incorrect)

Numerator:  
  Practice correct: 170 × 1.0 × 1.0 \= 170  
  Review correct: 50 × 0.8 × 1.0 \= 40  
  Test correct: 26 × 1.5 × 1.0 \= 39  
  Total: 249

Denominator: 200 \+ 50 \+ 44 \= 294

mastery\_score \= MIN(1.0, 249/294) \= 0.847  
Level: 4 Strong

Exam contribution: 39 / 249 \= 15.7% of numerator while being 44/294 \= 15.0% of denominator volume. Test weight 1.5 modestly amplifies exam influence above volume.

**Worked example 3 — The over-projected practice king:**

Student:

* 300 medium practice, 95% correct  
* 44 medium test, 55% correct

Numerator:  
  Practice: 285 × 1.0 × 1.0 \= 285  
  Test: 24 × 1.5 × 1.0 \= 36  
  Total: 321

Denominator: 344

mastery\_score \= MIN(1.0, 321/344) \= 0.933  
Level: 4 Strong

Vs. practice-only view (no exam data):

mastery\_score \= 285/300 \= 0.95

Adding 44 test events at 55% pulled mastery from 0.95 to 0.93. Modest pull reflects exam influence weight 1.5 vs. practice 1.0 — moderate, not dominant. If more exam amplification is desired, source\_weight\_test can be tuned upward in future (see §33).

**Verification level for V4 formula:** Proposed (this document). Becomes Verified from RPC body once §40 migration completes.

### **§17 — V4 Weekly Snapshot Algorithm (Expanded)**

Weekly snapshots are per (student, skill, week\_start\_date) values of mastery computed from only the events in that week. The snapshot value uses the same V4 pooled formula as Level 1 real-time, but restricted to events in a single week.

**Per-week snapshot formula:**

For each (student, skill, week\_start\_date) with events in that week:  
  weekly\_snapshot \= MIN(1.0,  
    SUM(is\_correct × source\_weight × difficulty\_weight) for events in week  
    /  
    COUNT of events in week  
  )

Snapshot reflects the weighted accuracy rate for events occurring within that calendar week (Monday-Sunday in America/Chicago timezone).

**Storage:** student\_skill\_weekly\_snapshot table, one row per (student, skill, week\_start\_date) with activity.

**Week definition:**

* week\_start\_date: Monday of the ISO week, DATE type  
* week\_end\_date: derived (Sunday 23:59:59.999 America/Chicago, not stored separately)

**has\_activity\_this\_week flag:** TRUE when at least one event exists for (student, skill) in that week. Active-only recompute (§19) skips snapshots where has\_activity\_this\_week \= FALSE. In V4, snapshots are only created when there's activity, so this flag is effectively always TRUE for existing rows. The flag is retained for explicit semantic clarity and future compatibility.

**Schema:**

CREATE TABLE student\_skill\_weekly\_snapshot (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,  
  skill TEXT NOT NULL,  
  week\_start\_date DATE NOT NULL,  
  weekly\_mastery NUMERIC NOT NULL CHECK (weekly\_mastery BETWEEN 0 AND 1),  
  weekly\_event\_count INTEGER NOT NULL CHECK (weekly\_event\_count \>= 1),  
  weekly\_correct\_count INTEGER NOT NULL CHECK (weekly\_correct\_count \>= 0 AND weekly\_correct\_count \<= weekly\_event\_count),  
  weekly\_numerator NUMERIC NOT NULL CHECK (weekly\_numerator \>= 0),  
  has\_activity\_this\_week BOOLEAN NOT NULL DEFAULT TRUE,  
  computed\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  
  UNIQUE (student\_id, skill, week\_start\_date)  
);

CREATE INDEX idx\_weekly\_snapshot\_student\_skill ON student\_skill\_weekly\_snapshot (student\_id, skill);  
CREATE INDEX idx\_weekly\_snapshot\_week ON student\_skill\_weekly\_snapshot (week\_start\_date);

**Generation:** Snapshots are generated by the weekly batch refresh\_weekly\_mastery\_snapshot (§18). They are not generated in real time. Between batches, snapshots are read-only.

**Retention:** Minimum 52 weeks (trend charts, longitudinal analysis). See §13.

### **§18 — Weekly Recompute with Half-Life (V4 Updated)**

**Trigger:** pg\_cron job refresh\_weekly\_mastery\_snapshot, scheduled Monday 3am America/Chicago.

**Steps:**

**Step A — Upsert weekly snapshots for last 26 weeks:**

INSERT INTO student\_skill\_weekly\_snapshot (  
  student\_id, skill, week\_start\_date,  
  weekly\_mastery, weekly\_event\_count, weekly\_correct\_count, weekly\_numerator,  
  has\_activity\_this\_week, computed\_at  
)  
SELECT  
  me.student\_id,  
  me.skill,  
  DATE\_TRUNC('week', me.occurred\_at AT TIME ZONE 'America/Chicago')::DATE AS week\_start\_date,  
  LEAST(1.0,  
    SUM(  
      CASE WHEN me.is\_correct THEN 1 ELSE 0 END  
      \* get\_mastery\_constant\_num('source\_weight\_' || me.source\_family)  
      \* get\_mastery\_constant\_num('difficulty\_weight\_' || normalize\_difficulty\_bucket(me.difficulty\_rating))  
    )  
    / COUNT(\*)  
  )::NUMERIC AS weekly\_mastery,  
  COUNT(\*) AS weekly\_event\_count,  
  SUM(CASE WHEN me.is\_correct THEN 1 ELSE 0 END) AS weekly\_correct\_count,  
  SUM(  
    CASE WHEN me.is\_correct THEN 1 ELSE 0 END  
    \* get\_mastery\_constant\_num('source\_weight\_' || me.source\_family)  
    \* get\_mastery\_constant\_num('difficulty\_weight\_' || normalize\_difficulty\_bucket(me.difficulty\_rating))  
  )::NUMERIC AS weekly\_numerator,  
  TRUE AS has\_activity\_this\_week,  
  NOW() AS computed\_at  
FROM mastery\_events me  
WHERE me.occurred\_at \>= (NOW() \- INTERVAL '26 weeks')  
GROUP BY me.student\_id, me.skill, DATE\_TRUNC('week', me.occurred\_at AT TIME ZONE 'America/Chicago')  
ON CONFLICT (student\_id, skill, week\_start\_date) DO UPDATE SET  
  weekly\_mastery \= EXCLUDED.weekly\_mastery,  
  weekly\_event\_count \= EXCLUDED.weekly\_event\_count,  
  weekly\_correct\_count \= EXCLUDED.weekly\_correct\_count,  
  weekly\_numerator \= EXCLUDED.weekly\_numerator,  
  has\_activity\_this\_week \= TRUE,  
  computed\_at \= NOW();

**Step B — Recompute mastery\_score with half-life weighting:**

UPDATE student\_skill\_mastery ssm  
SET mastery\_score \= subq.recomputed\_mastery,  
    mastery\_level \= map\_mastery\_level(subq.recomputed\_mastery),  
    last\_recomputed\_at \= NOW()  
FROM (  
  SELECT  
    sws.student\_id,  
    sws.skill,  
    LEAST(1.0,  
      SUM(  
        sws.weekly\_mastery  
        \* POWER(  
            0.5,  
            EXTRACT(EPOCH FROM (NOW() \- sws.week\_start\_date::TIMESTAMPTZ)) / (86400 \* 7 \* 3.0)  
          )  
      )  
      /  
      NULLIF(  
        SUM(  
          POWER(  
            0.5,  
            EXTRACT(EPOCH FROM (NOW() \- sws.week\_start\_date::TIMESTAMPTZ)) / (86400 \* 7 \* 3.0)  
          )  
        ),  
        0  
      )  
    ) AS recomputed\_mastery  
  FROM student\_skill\_weekly\_snapshot sws  
  WHERE sws.has\_activity\_this\_week \= TRUE  
    AND sws.week\_start\_date \>= (NOW() \- INTERVAL '26 weeks')::DATE  
  GROUP BY sws.student\_id, sws.skill  
) AS subq  
WHERE ssm.student\_id \= subq.student\_id  
  AND ssm.skill \= subq.skill;

**Half-life parameter:** 3 weeks (mastery\_half\_life\_weeks \= 3.0 in mastery\_constants). **Lookback:** 26 weeks (mastery\_lookback\_weeks \= 26).

**Step C — Refresh domain mastery and section projection:**

PERFORM refresh\_domain\_mastery\_for\_all\_affected\_students();  
PERFORM refresh\_section\_projection\_for\_all\_affected\_students();

**Active-only enforcement:** The recompute only considers weeks where has\_activity\_this\_week \= TRUE. Weeks with no events are implicitly excluded by the WHERE clause. No zero-fill, no carry-forward.

**Half-life interpretation:**

* Current week (0 weeks ago): weight 1.0  
* 3 weeks ago: weight 0.5  
* 6 weeks ago: weight 0.25  
* 9 weeks ago: weight 0.125  
* 12 weeks ago: weight 0.0625  
* 26 weeks ago: weight \~0.002 (near-zero contribution)

Students with uniform behavior see consistent mastery (half-life cancels when all snapshots equal). Students with improving or declining performance see mastery track recent evidence.

**Worked example — half-life across weeks:**

Student: 10 weeks of activity.

* Weeks 8-9 (old): 50% correct medium practice → snapshot 0.50 each  
* Weeks 6-7: 70% correct medium practice → snapshot 0.70 each  
* Weeks 4-5: 85% correct medium practice → snapshot 0.85 each  
* Weeks 2-3: 90% correct medium practice → snapshot 0.90 each  
* Weeks 0-1 (recent): 95% correct medium practice → snapshot 0.95 each

Half-life weights:

* Week 0: 1.0  
* Week 1: 0.794  
* Week 2: 0.630  
* Week 3: 0.500  
* Week 4: 0.397  
* Week 5: 0.315  
* Week 6: 0.250  
* Week 7: 0.198  
* Week 8: 0.157  
* Week 9: 0.125

Numerator:  
  0.95 × (1.0 \+ 0.794) \+ 0.90 × (0.630 \+ 0.500) \+ 0.85 × (0.397 \+ 0.315)  
  \+ 0.70 × (0.250 \+ 0.198) \+ 0.50 × (0.157 \+ 0.125)  
\= 0.95 × 1.794 \+ 0.90 × 1.130 \+ 0.85 × 0.712 \+ 0.70 × 0.448 \+ 0.50 × 0.282  
\= 1.704 \+ 1.017 \+ 0.605 \+ 0.314 \+ 0.141  
\= 3.781

Denominator:  
  1.794 \+ 1.130 \+ 0.712 \+ 0.448 \+ 0.282 \= 4.366

mastery\_score \= 3.781 / 4.366 \= 0.866  
Level: 4 Strong

Recent weeks (0.95 snapshots, weights \~1.8) dominate over old weeks (0.50 snapshots, weights \~0.28). Student's mastery reflects improving trajectory.

Vs. simple average across all snapshots (no half-life):

avg \= (0.95×2 \+ 0.90×2 \+ 0.85×2 \+ 0.70×2 \+ 0.50×2) / 10 \= 7.80 / 10 \= 0.78

Half-life produces 0.866 vs. naive average 0.78 — a \+0.086 reflecting recency. Improving students see mastery track improvement.

### **§18.X — Idempotency \+ Missed-Run Recovery (Unchanged from V3.1)**

**Idempotency:** apply\_learning\_event\_to\_mastery is safe to retry with the same event. Re-application produces the same student\_skill\_mastery state. Events are deduplicated by (student\_id, occurred\_at, skill, difficulty\_rating) uniqueness in mastery\_events — if a duplicate insert is attempted, the event is logged once; the RPC should be a no-op on retry.

**Missed-run recovery:** If refresh\_weekly\_mastery\_snapshot fails to run on a Monday (pg\_cron outage, DB maintenance, etc.), the next successful run recomputes from all events in the 26-week lookback. No data is lost because events persist in mastery\_events. Snapshots are recomputable from source events. Mastery\_score may be stale until next successful run; domain mastery and section projection will be stale until next successful run.

**Recovery procedure:**

1. Detect failure via pg\_cron log or missing computed\_at on weekly snapshots.  
2. Manually invoke refresh\_weekly\_mastery\_snapshot.  
3. Verify: sample random (student, skill) pairs; confirm weekly\_mastery values match computed expected values from mastery\_events.  
4. Verify: sample student\_skill\_mastery.last\_recomputed\_at updated to match invocation time.

### **§19 — Active-Only Handling (Unchanged from V3.1)**

V3.1 locked Option B (active-only) for weekly recompute: snapshots only exist when has\_activity\_this\_week \= TRUE; the recompute only considers such snapshots; no zero-fill, no carry-forward.

**Rationale:**

* A student who takes a week off should not be penalized (zero-fill would drive mastery toward 0).  
* A student who takes a week off should not artificially maintain old mastery (carry-forward would lock in stale evidence).  
* Active-only honestly represents the evidence: mastery reflects only observed behavior, weighted by recency.

**Implementation:** Step A above only generates snapshots for weeks with events. Step B only aggregates snapshots with has\_activity\_this\_week \= TRUE.

**Behavior during inactivity:**

* Week of inactivity: no snapshot generated. Existing snapshots unchanged.  
* When student returns, the newest snapshot (current week) gets weight 1.0. Old snapshots retain their half-life weights based on week\_start\_date.  
* If student has been inactive for 26+ weeks, all snapshots fall outside lookback window. Mastery\_score defaults to NULL or unchanged until new snapshot is generated. See §20.X for extended-inactivity decay (future-target).

### **§20 — Real-Time Mastery Between Batches (V4 Updated)**

Between Monday batches, mastery is updated in real-time via apply\_learning\_event\_to\_mastery RPC. The RPC uses the simpler pooled formula (without half-life):

mastery\_score \= MIN(1.0, mastery\_numerator / mastery\_denominator)

Where mastery\_numerator and mastery\_denominator are running sums maintained per event on student\_skill\_mastery.

**Per-event update:**

\-- On correct answer  
new\_mastery\_numerator \= old\_mastery\_numerator   
  \+ source\_weight × difficulty\_weight  
new\_mastery\_denominator \= old\_mastery\_denominator \+ 1

\-- On incorrect answer  
new\_mastery\_numerator \= old\_mastery\_numerator  \-- unchanged  
new\_mastery\_denominator \= old\_mastery\_denominator \+ 1

\-- Then  
mastery\_score \= MIN(1.0, new\_mastery\_numerator / new\_mastery\_denominator)

**Drift between real-time and batch:**

Between Monday batches, real-time mastery reflects all-history pooled accuracy without recency weighting. Monday's batch overwrites with half-life weighted value.

**Expected drift:** For students with stable performance, drift is minimal (half-life cancels). For students with changing performance (improving or declining), the Monday batch will shift mastery toward recent evidence by up to \~15% in extreme cases.

**UI implications:** UI can read mastery\_score directly at any time. The Monday batch re-anchoring is transparent to users. Trend charts use weekly\_snapshot directly (not mastery\_score drift).

### **§20.X — Extended-Inactivity Decay (Future-Target, Unchanged)**

Currently: after 26+ weeks of no activity, mastery\_score is unchanged (last recomputed value persists). Future target: implement graceful decay that lowers mastery\_score after N weeks of inactivity (TBD on N, decay curve). Not implemented in V4 launch.

Trigger condition (future): max(week\_start\_date) in student\_skill\_weekly\_snapshot \< NOW() \- INTERVAL 'N weeks'. Action: apply per-week decay factor to mastery\_score. Requires design of decay curve that handles: new domain taxonomies, skill retirement, long-term SAT prep gaps.

Reserved as future-target; see §33 algorithm evolution governance.

---

## **Part III — Domain & Section Aggregation**

### **§21 — Domain Mastery (Unchanged from V3.1)**

Per-domain mastery is computed from constituent skill masteries, weighted by attempts.

**Formula:**

domain\_mastery(student, section, domain) \=   
  SUM(skill\_mastery\_score × skill\_attempts) for all skills in domain  
  /  
  SUM(skill\_attempts) for all skills in domain

Skills with 0 attempts are excluded. Domains with 0 total attempts have mastery \= NULL.

**Function:** refresh\_domain\_mastery\_for\_student\_domain(p\_student\_id UUID, p\_section TEXT, p\_domain TEXT) — rewrites student\_domain\_mastery row for (student, section, domain).

**Trigger:** Called from apply\_learning\_event\_to\_mastery after skill-level update. Called from weekly batch for all active (student, section, domain) tuples.

### **§21.X — Official SAT Blueprint Weights (Unchanged, College Board Provenance)**

Domain mastery aggregates into section mastery using official Digital SAT blueprint weights. Source: College Board Digital SAT Assessment Framework (publicly documented).

**Math section weights:**

* Algebra: 0.35  
* Advanced Math: 0.35  
* Problem Solving and Data Analysis (PSDA): 0.15  
* Geometry and Trigonometry: 0.15

**Reading & Writing section weights:**

* Craft and Structure: 0.28  
* Information and Ideas: 0.26  
* Standard English Conventions: 0.26  
* Expression of Ideas: 0.20

**Storage:** kpi\_constants table, keys `sat_blueprint_math_<domain>` and `sat_blueprint_rw_<domain>`.

**Provenance:** Documented by College Board. Weights may adjust in future College Board releases; update handled per §33 algorithm evolution governance.

### **§22 — Section Mastery Intermediate (Unchanged)**

Section mastery (before projection) is computed as:

section\_mastery(student, section) \=   
  SUM(domain\_mastery(student, section, domain) × blueprint\_weight(section, domain))  
  for all domains in section with non-NULL domain\_mastery

**Function:** Inline in refresh\_section\_projection\_for\_student\_section. Not a standalone table column; derived as part of projection computation.

### **§23 — Section Projection (Unchanged from V3.1)**

**Inputs:**

* section\_mastery (computed per §22)  
* relevant\_question\_count (for band width)  
* full-length truth anchor (if applicable, per §23.1-23.4)

**Midpoint formula (heuristic):**

projected\_score\_mid \= 200 \+ (section\_mastery × 600\)    
\-- produces scaled score in \[200, 800\] range, SAT convention

**Band width formula:**

band\_width \= f(relevant\_question\_count, confidence\_parameter)  
\-- wider band with less evidence; narrows as evidence grows

**Function:** compute\_projection\_delta — returns (projected\_score\_mid, projected\_score\_low, projected\_score\_high, band\_width, relevant\_question\_count).

**Future calibration:** The 200 \+ mastery × 600 heuristic is launch-tier approximation. §34 defines calibration roadmap using actual SAT result data to refine the mapping curve. Until calibration, the heuristic is used with clear documentation.

### **§23.1 — §23.4 — Full-Length Truth Anchor (Unchanged from V3.1)**

When a student completes a full-length (or full-section) exam, the exam's scaled score (computed by Doc 02B test engine) becomes the authoritative projection for that section for a defined window:

**§23.1 Exam completion event:** Test engine emits a post-exam projection override with:

* student\_id, section  
* exam\_scaled\_score (e.g., 720 for Math)  
* exam\_completion\_timestamp  
* override\_duration (N days)

**§23.2 Override application:** student\_section\_projections is updated:

* projected\_score\_mid \= exam\_scaled\_score  
* projected\_score\_low \= exam\_scaled\_score \- exam\_band\_low (smaller band due to high-quality evidence)  
* projected\_score\_high \= exam\_scaled\_score \+ exam\_band\_high  
* projection\_source \= 'full\_length\_anchor'  
* anchor\_expiry\_at \= exam\_completion\_timestamp \+ (override\_duration days)

**§23.3 Override decay:** After anchor\_expiry\_at, projection returns to computed-from-mastery. Default override\_duration \= 7 days. Configurable via kpi\_constants.full\_length\_anchor\_duration\_days.

**§23.4 Multiple exams:** Most recent exam wins. If a new exam is completed before previous anchor expires, the new exam's scaled score replaces the override.

### **§24 — Projection Calibration (Roadmap; see §34)**

Unchanged from V3.1. Calibration is future-target; launch uses the 200 \+ mastery × 600 heuristic.

### **§24.X — Evidence-Quality as Projection Target-State (Unchanged from V3.1)**

Future target: incorporate evidence quality into projection band width. Events from test engine weighted more heavily in relevant\_question\_count than practice/review. Proposed constants:

* projection\_evidence\_weight\_test \= 1.5  
* projection\_evidence\_weight\_practice \= 1.0  
* projection\_evidence\_weight\_review \= 0.5

Not implemented in V4 launch. Reserved for calibration roadmap (§34).

---

## **Part IV — Governance & Operations**

### **§25 — Audit Trail**

All mastery events are persisted in mastery\_events. This table is append-only; updates and deletes are prohibited at the application layer.

**Schema:**

CREATE TABLE mastery\_events (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL REFERENCES students(id),  
  section TEXT NOT NULL,  
  domain TEXT NOT NULL,  
  skill TEXT NOT NULL,  
  difficulty\_rating INTEGER NOT NULL CHECK (difficulty\_rating BETWEEN 1 AND 5),  
  source\_family TEXT NOT NULL CHECK (source\_family IN ('practice', 'review', 'test')),  
  is\_correct BOOLEAN NOT NULL,  
  latency\_ms INTEGER,  
  occurred\_at TIMESTAMPTZ NOT NULL,  
  rpc\_invocation\_id UUID,  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  
);

CREATE INDEX idx\_mastery\_events\_student\_skill\_time ON mastery\_events (student\_id, skill, occurred\_at);  
CREATE INDEX idx\_mastery\_events\_time ON mastery\_events (occurred\_at);  
CREATE INDEX idx\_mastery\_events\_section\_domain ON mastery\_events (section, domain);

Used for:

1. Recomputing weekly snapshots (Step A of weekly batch)  
2. Analytics and research  
3. Student-facing activity timelines  
4. Guardian reports  
5. Audit investigations

### **§26 — Monitoring and Alerts**

**Weekly batch monitoring:**

* Alert: refresh\_weekly\_mastery\_snapshot fails to run within 24 hours of scheduled time.  
* Alert: snapshot generation produces 0 rows (indicates event ingestion failure upstream).  
* Alert: mastery\_score drift exceeds 0.30 between consecutive weekly runs for \>5% of active students (indicates formula or data anomaly).

**Real-time RPC monitoring:**

* Alert: apply\_learning\_event\_to\_mastery p99 latency exceeds 500ms.  
* Alert: RPC error rate exceeds 1% over 5-minute window.  
* Alert: mastery\_numerator exceeds mastery\_denominator × max\_per\_event\_contribution (1.8 for test × hard correct). Indicates possible data corruption.

**Invariant monitoring:**

* Verify weekly: all mastery\_score values in \[0, 1\].  
* Verify weekly: all weekly\_mastery values in \[0, 1\].  
* Verify weekly: all domain\_mastery values in \[0, 1\].  
* Verify weekly: all section\_projection midpoints in \[200, 800\] for Math and RW sections.

### **§27 — Event Logging Conventions**

All RPCs log to structured logs with fields:

* rpc\_name  
* invocation\_id (UUID)  
* student\_id  
* input\_params (sanitized)  
* output\_summary (mastery\_score, mastery\_level, duration\_ms)  
* error (if applicable)

Logs are retained 52 weeks for compliance and debugging.

### **§28 — Reporting Hooks**

student\_skill\_mastery, student\_domain\_mastery, and student\_section\_projections power:

* Student dashboard  
* Guardian dashboard (derived view, per Doc 01\)  
* Tutor dashboard  
* Teacher dashboard (when applicable per Doc 01\)  
* Admin analytics  
* Longitudinal trend charts (from student\_skill\_weekly\_snapshot)

### **§29 — Appendix A: Constants Catalog (V4 Final)**

All mastery and KPI constants are stored in `mastery_constants` (for mastery computation) and `kpi_constants` (for KPI/projection).

**mastery\_constants (V4 final):**

| Key | Value | Purpose | Changed from V3? |
| ----- | ----- | ----- | ----- |
| source\_weight\_review | 0.8 | Numerator multiplier for review events | NEW in V4 |
| source\_weight\_practice | 1.0 | Numerator multiplier for practice events | NEW in V4 |
| source\_weight\_test | 1.5 | Numerator multiplier for test events | NEW in V4 |
| difficulty\_weight\_easy | 0.8 | Numerator multiplier for easy questions | UNCHANGED (was difficulty\_multiplier\_easy) |
| difficulty\_weight\_medium | 1.0 | Numerator multiplier for medium questions | UNCHANGED |
| difficulty\_weight\_hard | 1.2 | Numerator multiplier for hard questions | CHANGED (was 1.3) |
| mastery\_min | 0.0 | Safety floor | UNCHANGED |
| mastery\_max | 1.0 | Safety ceiling (clamp) | UNCHANGED |
| mastery\_level\_1\_threshold | 0.20 | Level 0→1 boundary | UNCHANGED |
| mastery\_level\_2\_threshold | 0.40 | Level 1→2 boundary | UNCHANGED |
| mastery\_level\_3\_threshold | 0.60 | Level 2→3 boundary | UNCHANGED |
| mastery\_level\_4\_threshold | 0.80 | Level 3→4 boundary | UNCHANGED |
| mastery\_half\_life\_weeks | 3.0 | Half-life for weekly recompute | CHANGED (was 3 for weekly snapshots in V3.1) |
| mastery\_lookback\_weeks | 26 | Lookback window for weekly recompute | UNCHANGED |

**RETIRED in V4 (removed from mastery\_constants via migration):**

| Key | V3 Value | V4 Status |
| ----- | ----- | ----- |
| alpha | 0.2 | REMOVED |
| base\_delta\_practice\_pass | \+0.60 | REMOVED |
| base\_delta\_practice\_fail | \-0.50 | REMOVED |
| base\_delta\_review\_pass | \+0.40 | REMOVED |
| base\_delta\_review\_fail | \-0.30 | REMOVED |
| base\_delta\_test\_pass | \+0.80 | REMOVED |
| base\_delta\_test\_fail | \-0.60 | REMOVED |
| difficulty\_multiplier\_easy | 0.8 | RENAMED to difficulty\_weight\_easy |
| difficulty\_multiplier\_medium | 1.0 | RENAMED to difficulty\_weight\_medium |
| difficulty\_multiplier\_hard | 1.3 | RENAMED AND CHANGED VALUE to difficulty\_weight\_hard (1.2) |

**kpi\_constants (unchanged from V3.1):**

| Key | Value | Purpose |
| ----- | ----- | ----- |
| sat\_blueprint\_math\_algebra | 0.35 | Math blueprint weight |
| sat\_blueprint\_math\_advanced\_math | 0.35 | Math blueprint weight |
| sat\_blueprint\_math\_psda | 0.15 | Math blueprint weight |
| sat\_blueprint\_math\_geometry\_trig | 0.15 | Math blueprint weight |
| sat\_blueprint\_rw\_craft\_structure | 0.28 | RW blueprint weight |
| sat\_blueprint\_rw\_info\_ideas | 0.26 | RW blueprint weight |
| sat\_blueprint\_rw\_standard\_english | 0.26 | RW blueprint weight |
| sat\_blueprint\_rw\_expression\_ideas | 0.20 | RW blueprint weight |
| full\_length\_anchor\_duration\_days | 7 | Exam override duration |
| scaled\_score\_math\_min | 200 | SAT scaled score floor |
| scaled\_score\_math\_max | 800 | SAT scaled score ceiling |
| scaled\_score\_rw\_min | 200 | SAT scaled score floor |
| scaled\_score\_rw\_max | 800 | SAT scaled score ceiling |

### **§30 — Verification Levels (Unchanged)**

Three levels of specification authority:

* **Verified from RPC body** — The behavior is confirmed by examining the production RPC SQL. Most authoritative.  
* **Documented by intent** — The behavior is specified in this document. The RPC may not yet match; migration plan §40 aligns RPC with documented intent.  
* **Proposed** — Under discussion; not yet specified for implementation. Subject to revision per §33.

**V4 sections and their verification level at time of V4 adoption:**

* §16 V4 formula: Documented by intent (becomes Verified after §40 migration).  
* §17 Weekly snapshot: Documented by intent.  
* §18 Weekly recompute: Documented by intent.  
* §19 Active-only: Verified from V3.1 migration; preserved in V4.  
* §21-22 Domain aggregation: Verified from V3 RPC body; preserved in V4.  
* §23 Section projection: Documented by intent (heuristic formula in place).  
* §23.1-23.4 Full-length anchor: Documented by intent; implementation in Doc 02B V4.  
* §31-33 Governance: Verified from V3.1.  
* §20.X, §24.X: Proposed (future-target).

### **§31 — Cluster Deprecation (Unchanged from V3.1)**

The cluster tier (aggregation level between skill and domain) is deprecated. V3.1 locked a four-step deprecation path:

1. **Audit reads** — Log every read of student\_cluster\_mastery. Identify callers.  
2. **Deprecate reads** — Replace all callers with skill-tier or domain-tier reads. Log any remaining cluster-tier reads as warnings.  
3. **Lock writes** — Revoke INSERT/UPDATE permission on student\_cluster\_mastery. Any writes now fail.  
4. **Drop table** — After 30 days of zero reads and writes, drop student\_cluster\_mastery.

**V4 status:** Steps 1-2 completed in V3.1 era. Step 3 in progress. Step 4 scheduled post-V4 launch \+ 60 days.

### **§32 — Scaling Evolution Tiers (Unchanged)**

Three tiers of scale, with specific system adaptations at each:

**Tier 1 (launch):** \<1,000 active students. Single-region Supabase. pg\_cron sufficient for weekly batch. No read replicas.

**Tier 2 (growth):** 1,000-10,000 active students. Multi-region considerations. Read replicas for analytics queries. Batch job splits across partitions.

**Tier 3 (scale):** \>10,000 active students. Separate read-only analytics DB. Event streaming for real-time RPC to reduce contention on primary. Materialized views for domain and section aggregates.

V4 launches at Tier 1\. §33 governance handles migrations to Tier 2 and 3\.

### **§33 — Algorithm Evolution Governance (Unchanged from V3.1)**

Changes to the mastery formula (including constants) follow this process:

1. **Proposal** — Written specification of change, rationale, expected impact, rollback plan.  
2. **Review** — Platform team review. Simulation with production event data where possible.  
3. **Approval** — Platform team lead sign-off.  
4. **Staging** — Deploy to staging; run for minimum 2 weeks. Monitor for anomalies.  
5. **Production rollout** — Incremental rollout with feature flag. Start with 5% of students, escalate to 100% over 4 weeks.  
6. **Monitoring** — Alerts on: mastery\_score distribution shifts \>10%, mastery\_level distribution shifts \>10%, mastery\_score drift between consecutive weekly batches exceeds 0.30 for \>5% of students.  
7. **Version bump** — Doc 02C version incremented; change records added.

**V4 itself follows this process:**

* CR-02C-23 through 02C-32 specify the V4 transition.  
* §40 defines the migration plan.  
* Simulation completed (see Appendix D).  
* Production rollout schedule TBD post V4 adoption.

**Emergency rollback:** If V4 rollout produces distribution shifts beyond safe thresholds, revert to V3.1 constants and formula immediately via config flag. mastery\_score column retained; mastery\_numerator/denominator columns can be ignored by rollback logic.

### **§34 — Projection Calibration Roadmap**

Section projection currently uses heuristic `projected_score_mid = 200 + mastery × 600`. Calibration roadmap:

1. Collect actual SAT scores from students (opt-in) and match to projection at test-week.  
2. Compute residual: actual \- projected per student per section.  
3. Fit correction curve (likely non-linear at extremes).  
4. Replace heuristic with fitted curve.  
5. Continuous re-calibration quarterly.

V4 launches with heuristic; calibration proceeds post-launch with real data.

### **§34.X — Post-Exam Score Reporting Loop (Unchanged from V3.1)**

When a student completes a real SAT (reports score to Lyceon), the system:

1. Records actual\_scaled\_score in student\_sat\_reports.  
2. Computes residual against projection at exam-date.  
3. Incorporates residual into calibration dataset.  
4. Displays "Your projection was X; you scored Y" in student dashboard.

Implementation per Doc 02B V4. Data flow anchored in Doc 02C for mastery-side integrity.

---

## **Part V — Change Records**

Preserving V3 and V3.1 change records, appending V4.

**From V3 (pre-V3.1):**

CR-02C-01 — Initial Doc 02C established; supersedes PDF-05.

CR-02C-02 — Mastery ladder defined (0-4 levels with thresholds 0.20/0.40/0.60/0.80).

CR-02C-03 — mastery\_events table introduced for audit and recompute source.

CR-02C-04 — student\_skill\_mastery, student\_domain\_mastery, student\_section\_projections schemas specified.

CR-02C-05 — Official SAT blueprint weights locked with College Board provenance.

CR-02C-06 — Running-additive mastery formula with alpha and base\_delta\_\* constants.

CR-02C-07 — Difficulty multipliers 0.8/1.0/1.3 for easy/medium/hard.

CR-02C-08 — Section projection heuristic `200 + mastery × 600`.

CR-02C-09 — Full-length truth anchor mechanism with 7-day override.

CR-02C-10 — Cluster tier deprecation path (audit → deprecate reads → lock writes → drop).

**From V3.1 (2026-04):**

CR-02C-11 — Active-only weekly recompute (Option B); snapshots with has\_activity\_this\_week \= TRUE; weighted avg with 0.5^(weeks/3) weights across weekly snapshots.

CR-02C-12 — Real-time RPC continues between batches; Monday 3am America/Chicago re-anchors.

CR-02C-13 — Weekly snapshot semantic \= real-time mastery\_score at week boundary (V3.1).

CR-02C-14 — 0-4 mastery levels stored and displayed; no 1-5 drift.

CR-02C-15 — mastery\_events table proposed for audit/analytics (NOT used in recompute — V3.1 decision preserved, expanded in V4).

CR-02C-16 — Weekly snapshot tables (skill \+ section level) proposed.

CR-02C-17 — student\_id normalized everywhere; student\_skill\_mastery.user\_id → student\_id migration tracked.

CR-02C-18 — Three-level verification labeling (verified from RPC body / documented by intent / proposed).

CR-02C-19 — Before-Implementation Checklist with specific SQL queries (§41).

CR-02C-20 — Scaling evolution tiers §32; algorithm evolution governance §33.

CR-02C-21 — Projection calibration roadmap §34.

CR-02C-22 — Post-exam score reporting loop §34.X.

**New in V4 (2026-04-22):**

CR-02C-23 — **V4 algorithm adoption.** Doc 02C transitions from V3.1 running-additive mastery formula to V4 pooled weighted-fraction formula. Supersedes §6-20 of V3.1 specification; V4 §6-20 is canonical.

CR-02C-24 — **Pooled weighted-fraction formula replaces running-additive.** Mastery\_score \= MIN(1.0, SUM(is\_correct × source\_weight × difficulty\_weight) / COUNT of events). Eliminates double-counting of fails (which in V3 contributed both via negative base deltas and denominator mass). Naturally bounded in \[0, 1\] with clamp as safety. See §16.

CR-02C-25 — **Source weights introduced.** source\_weight\_review \= 0.8, source\_weight\_practice \= 1.0, source\_weight\_test \= 1.5. These replace the six base\_delta\_\* constants. Source weight amplifies higher-value evidence (test) in numerator; raw count in denominator remains source-agnostic. See §8.

CR-02C-26 — **Difficulty weight\_hard changed from 1.3 to 1.2.** Narrower spread (1.5× max/min) vs. V3's 1.625×. Preserves monotonicity (easy \< medium \< hard) with gentler differentiation. See §15.

CR-02C-27 — **Retirement of V3 constants.** alpha, base\_delta\_practice\_pass, base\_delta\_practice\_fail, base\_delta\_review\_pass, base\_delta\_review\_fail, base\_delta\_test\_pass, base\_delta\_test\_fail removed from mastery\_constants. Renamed difficulty\_multiplier\_\* to difficulty\_weight\_\*. See §29 Appendix A.

CR-02C-28 — **Weekly snapshots use V4 pooled formula.** Per-week snapshot \= MIN(1.0, SUM(is\_correct × source\_weight × difficulty\_weight) / COUNT of events in week). Computed from mastery\_events, not from student\_skill\_mastery.mastery\_score drift. See §17.

CR-02C-29 — **Half-life 3 weeks across weekly snapshots.** mastery\_half\_life\_weeks \= 3.0 in mastery\_constants. Weekly recompute weights recent snapshots more heavily via 0.5^(weeks\_ago / 3). Unchanged parameter value from V3.1; V4 application context updated. See §18.

CR-02C-30 — **RPC body rewrite.** apply\_learning\_event\_to\_mastery rewritten to use mastery\_numerator and mastery\_denominator running sums instead of running-additive update. See §40.

CR-02C-31 — **Migration path for existing mastery\_score values.** All existing student\_skill\_mastery rows recomputed from mastery\_events using V4 formula during migration. See §40.

CR-02C-32 — **mastery\_numerator and mastery\_denominator columns added to student\_skill\_mastery.** Running sums maintained per event. Enable real-time pooled formula computation without scanning all events. See §40.

---

## **Part VI — Migration Plan (V3.1 → V4)**

### **§40 — V3.1 → V4 Migration Steps**

**Prerequisites:**

* Doc 02B V4 has emitted mastery events to mastery\_events for at least 4 weeks prior to migration (to ensure rich event history for recomputation).  
* Production backup taken immediately before migration.  
* Staging environment validated V4 formula produces expected mastery\_score values per §41 checklist.

**Step 1 — Schema changes:**

\-- Add new columns to student\_skill\_mastery  
ALTER TABLE student\_skill\_mastery  
  ADD COLUMN IF NOT EXISTS mastery\_numerator NUMERIC NOT NULL DEFAULT 0,  
  ADD COLUMN IF NOT EXISTS mastery\_denominator NUMERIC NOT NULL DEFAULT 0,  
  ADD COLUMN IF NOT EXISTS last\_recomputed\_at TIMESTAMPTZ;

\-- Create student\_skill\_weekly\_snapshot table  
CREATE TABLE IF NOT EXISTS student\_skill\_weekly\_snapshot (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,  
  skill TEXT NOT NULL,  
  week\_start\_date DATE NOT NULL,  
  weekly\_mastery NUMERIC NOT NULL CHECK (weekly\_mastery BETWEEN 0 AND 1),  
  weekly\_event\_count INTEGER NOT NULL CHECK (weekly\_event\_count \>= 1),  
  weekly\_correct\_count INTEGER NOT NULL CHECK (weekly\_correct\_count \>= 0),  
  weekly\_numerator NUMERIC NOT NULL CHECK (weekly\_numerator \>= 0),  
  has\_activity\_this\_week BOOLEAN NOT NULL DEFAULT TRUE,  
  computed\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  
  UNIQUE (student\_id, skill, week\_start\_date)  
);

CREATE INDEX IF NOT EXISTS idx\_weekly\_snapshot\_student\_skill   
  ON student\_skill\_weekly\_snapshot (student\_id, skill);  
CREATE INDEX IF NOT EXISTS idx\_weekly\_snapshot\_week   
  ON student\_skill\_weekly\_snapshot (week\_start\_date);

**Step 2 — Update mastery\_constants:**

\-- Insert new constants  
INSERT INTO mastery\_constants (key, value\_num) VALUES  
  ('source\_weight\_review', 0.8),  
  ('source\_weight\_practice', 1.0),  
  ('source\_weight\_test', 1.5),  
  ('difficulty\_weight\_easy', 0.8),  
  ('difficulty\_weight\_medium', 1.0),  
  ('difficulty\_weight\_hard', 1.2)  
ON CONFLICT (key) DO UPDATE SET value\_num \= EXCLUDED.value\_num;

\-- Delete retired constants  
DELETE FROM mastery\_constants WHERE key IN (  
  'alpha',  
  'base\_delta\_practice\_pass', 'base\_delta\_practice\_fail',  
  'base\_delta\_review\_pass', 'base\_delta\_review\_fail',  
  'base\_delta\_test\_pass', 'base\_delta\_test\_fail',  
  'difficulty\_multiplier\_easy', 'difficulty\_multiplier\_medium', 'difficulty\_multiplier\_hard'  
);

**Step 3 — Rewrite apply\_learning\_event\_to\_mastery RPC:**

CREATE OR REPLACE FUNCTION apply\_learning\_event\_to\_mastery(  
  p\_student\_id UUID,  
  p\_section TEXT,  
  p\_domain TEXT,  
  p\_skill TEXT,  
  p\_difficulty\_rating INTEGER,  
  p\_source\_family TEXT,  
  p\_correct BOOLEAN,  
  p\_latency\_ms INTEGER,  
  p\_occurred\_at TIMESTAMPTZ  
) RETURNS JSONB  
LANGUAGE plpgsql  
AS $$  
DECLARE  
  v\_difficulty\_bucket TEXT;  
  v\_source\_weight NUMERIC;  
  v\_difficulty\_weight NUMERIC;  
  v\_event\_contribution NUMERIC;  
  v\_new\_numerator NUMERIC;  
  v\_new\_denominator NUMERIC;  
  v\_new\_mastery NUMERIC;  
  v\_new\_level INTEGER;  
BEGIN  
  \-- Normalize difficulty bucket  
  v\_difficulty\_bucket := normalize\_difficulty\_bucket(p\_difficulty\_rating);  
    
  \-- Fetch weights  
  v\_source\_weight := get\_mastery\_constant\_num('source\_weight\_' || p\_source\_family);  
  v\_difficulty\_weight := get\_mastery\_constant\_num('difficulty\_weight\_' || v\_difficulty\_bucket);  
    
  \-- Compute this event's numerator contribution  
  v\_event\_contribution := CASE   
    WHEN p\_correct THEN v\_source\_weight \* v\_difficulty\_weight   
    ELSE 0   
  END;  
    
  \-- Atomic upsert of student\_skill\_mastery  
  INSERT INTO student\_skill\_mastery (  
    student\_id, section, domain, skill,  
    mastery\_numerator, mastery\_denominator,  
    mastery\_score, mastery\_level,  
    attempts, correct\_count,  
    last\_event\_at, updated\_at  
  )  
  VALUES (  
    p\_student\_id, p\_section, p\_domain, p\_skill,  
    v\_event\_contribution, 1,  
    LEAST(1.0, v\_event\_contribution),  
    map\_mastery\_level(LEAST(1.0, v\_event\_contribution)),  
    1, CASE WHEN p\_correct THEN 1 ELSE 0 END,  
    p\_occurred\_at, NOW()  
  )  
  ON CONFLICT (student\_id, skill) DO UPDATE SET  
    mastery\_numerator \= student\_skill\_mastery.mastery\_numerator \+ v\_event\_contribution,  
    mastery\_denominator \= student\_skill\_mastery.mastery\_denominator \+ 1,  
    mastery\_score \= LEAST(1.0,   
      (student\_skill\_mastery.mastery\_numerator \+ v\_event\_contribution)   
      / (student\_skill\_mastery.mastery\_denominator \+ 1\)  
    ),  
    mastery\_level \= map\_mastery\_level(LEAST(1.0,  
      (student\_skill\_mastery.mastery\_numerator \+ v\_event\_contribution)   
      / (student\_skill\_mastery.mastery\_denominator \+ 1\)  
    )),  
    attempts \= student\_skill\_mastery.attempts \+ 1,  
    correct\_count \= student\_skill\_mastery.correct\_count \+ CASE WHEN p\_correct THEN 1 ELSE 0 END,  
    last\_event\_at \= GREATEST(student\_skill\_mastery.last\_event\_at, p\_occurred\_at),  
    updated\_at \= NOW()  
  RETURNING mastery\_numerator, mastery\_denominator, mastery\_score, mastery\_level  
  INTO v\_new\_numerator, v\_new\_denominator, v\_new\_mastery, v\_new\_level;  
    
  \-- Insert mastery\_events row (audit trail)  
  INSERT INTO mastery\_events (  
    student\_id, section, domain, skill,  
    difficulty\_rating, source\_family,  
    is\_correct, latency\_ms, occurred\_at  
  ) VALUES (  
    p\_student\_id, p\_section, p\_domain, p\_skill,  
    p\_difficulty\_rating, p\_source\_family,  
    p\_correct, p\_latency\_ms, p\_occurred\_at  
  );  
    
  \-- Refresh domain and section aggregates (async or sync per deployment config)  
  PERFORM refresh\_domain\_mastery\_for\_student\_domain(p\_student\_id, p\_section, p\_domain);  
  PERFORM refresh\_section\_projection\_for\_student\_section(p\_student\_id, p\_section);  
    
  \-- Return updated state  
  RETURN jsonb\_build\_object(  
    'mastery\_numerator', v\_new\_numerator,  
    'mastery\_denominator', v\_new\_denominator,  
    'mastery\_score', v\_new\_mastery,  
    'mastery\_level', v\_new\_level,  
    'event\_contribution', v\_event\_contribution  
  );  
END;  
$$;

**Step 4 — Recompute existing student\_skill\_mastery values from mastery\_events:**

\-- For every (student, skill) with events, recompute numerator/denominator/score  
UPDATE student\_skill\_mastery ssm  
SET   
  mastery\_numerator \= subq.total\_numerator,  
  mastery\_denominator \= subq.total\_events,  
  mastery\_score \= LEAST(1.0, subq.total\_numerator / NULLIF(subq.total\_events, 0)),  
  mastery\_level \= map\_mastery\_level(LEAST(1.0, subq.total\_numerator / NULLIF(subq.total\_events, 0))),  
  last\_recomputed\_at \= NOW()  
FROM (  
  SELECT  
    me.student\_id,  
    me.skill,  
    COUNT(\*) AS total\_events,  
    SUM(  
      CASE WHEN me.is\_correct THEN 1 ELSE 0 END  
      \* get\_mastery\_constant\_num('source\_weight\_' || me.source\_family)  
      \* get\_mastery\_constant\_num('difficulty\_weight\_' || normalize\_difficulty\_bucket(me.difficulty\_rating))  
    ) AS total\_numerator  
  FROM mastery\_events me  
  GROUP BY me.student\_id, me.skill  
) AS subq  
WHERE ssm.student\_id \= subq.student\_id  
  AND ssm.skill \= subq.skill;

**Step 5 — Generate initial weekly snapshots for last 26 weeks:**

Run refresh\_weekly\_mastery\_snapshot once manually, which generates weekly\_snapshot rows for all active (student, skill, week) tuples in the last 26 weeks.

**Step 6 — Install pg\_cron schedule:**

SELECT cron.schedule(  
  'weekly-mastery-recompute',  
  '0 3 \* \* 1',  \-- Monday 3am  
  $$  
    SELECT refresh\_weekly\_mastery\_snapshot();  
  $$  
);

**Step 7 — Run refresh\_weekly\_mastery\_snapshot once immediately after migration** to re-anchor mastery\_score with half-life weighting on the newly computed snapshots.

**Step 8 — Verification (see §41):**

Run verification queries. If all pass, migration complete.

**Step 9 — Monitor first week post-migration:**

* Monitor mastery\_score distribution. Compare pre-V4 vs. post-V4 distributions. Large shifts may indicate formula or data issues.  
* Monitor mastery\_level distribution. Ensure reasonable spread across levels 0-4.  
* Monitor Monday batch. Verify successful run on first Monday post-migration.

**Rollback plan:** If anomalies detected:

1. Disable pg\_cron schedule.  
2. Restore student\_skill\_mastery.mastery\_score from pre-migration backup.  
3. Ignore mastery\_numerator/mastery\_denominator columns (leave in place, do not use).  
4. Revert RPC to V3 version.  
5. Revert mastery\_constants to V3 values.

### **§41 — Before-Implementation Checklist**

Pre-migration verification queries. All must return expected results before proceeding.

**Check 1 — mastery\_events has sufficient history:**

SELECT COUNT(\*) AS total\_events,  
       COUNT(DISTINCT student\_id) AS unique\_students,  
       MIN(occurred\_at) AS earliest\_event,  
       MAX(occurred\_at) AS latest\_event  
FROM mastery\_events;

Expected: total\_events \> 10,000; earliest\_event is at least 4 weeks before migration date.

**Check 2 — No orphaned mastery rows:**

SELECT COUNT(\*) AS orphans  
FROM student\_skill\_mastery ssm  
WHERE NOT EXISTS (  
  SELECT 1 FROM mastery\_events me  
  WHERE me.student\_id \= ssm.student\_id AND me.skill \= ssm.skill  
);

Expected: 0 orphans.

**Check 3 — Migration impact simulation (staging):**

\-- Compute V4 mastery for all students; compare to V3 mastery.  
\-- Report distribution of |v4 \- v3|.  
\-- Expected: 90%+ of students have |delta| \< 0.20; max delta \< 0.50.

**Check 4 — RPC body matches §40 specification:** Manually verify apply\_learning\_event\_to\_mastery RPC SQL matches Step 3 spec.

**Check 5 — Constants table updated:**

SELECT key, value\_num FROM mastery\_constants   
WHERE key LIKE 'source\_weight\_%' OR key LIKE 'difficulty\_weight\_%' OR key LIKE 'mastery\_%'  
ORDER BY key;

Expected: source\_weight\_review=0.8, source\_weight\_practice=1.0, source\_weight\_test=1.5, difficulty\_weight\_easy=0.8, difficulty\_weight\_medium=1.0, difficulty\_weight\_hard=1.2, mastery\_half\_life\_weeks=3.0, mastery\_lookback\_weeks=26, mastery\_level\_\*\_threshold, mastery\_min=0, mastery\_max=1.

**Check 6 — Retired constants removed:**

SELECT key FROM mastery\_constants   
WHERE key IN (  
  'alpha',  
  'base\_delta\_practice\_pass', 'base\_delta\_practice\_fail',  
  'base\_delta\_review\_pass', 'base\_delta\_review\_fail',  
  'base\_delta\_test\_pass', 'base\_delta\_test\_fail',  
  'difficulty\_multiplier\_easy', 'difficulty\_multiplier\_medium', 'difficulty\_multiplier\_hard'  
);

Expected: 0 rows.

**Check 7 — Weekly snapshot table exists with correct schema:**

SELECT column\_name, data\_type, is\_nullable  
FROM information\_schema.columns  
WHERE table\_name \= 'student\_skill\_weekly\_snapshot'  
ORDER BY ordinal\_position;

Expected columns: id, student\_id, skill, week\_start\_date, weekly\_mastery, weekly\_event\_count, weekly\_correct\_count, weekly\_numerator, has\_activity\_this\_week, computed\_at.

**Check 8 — pg\_cron schedule installed:**

SELECT jobname, schedule, command  
FROM cron.job  
WHERE jobname \= 'weekly-mastery-recompute';

Expected: 1 row with schedule '0 3 \* \* 1'.

**Check 9 — Sample student mastery sanity check:**

SELECT   
  ssm.student\_id, ssm.skill,  
  ssm.mastery\_score, ssm.mastery\_level,  
  ssm.mastery\_numerator, ssm.mastery\_denominator  
FROM student\_skill\_mastery ssm  
ORDER BY RANDOM()  
LIMIT 20;

Expected: mastery\_score \= LEAST(1.0, mastery\_numerator / mastery\_denominator) for all rows. mastery\_level matches map\_mastery\_level(mastery\_score).

**Check 10 — Distribution sanity:**

SELECT   
  mastery\_level,  
  COUNT(\*) AS count,  
  ROUND(COUNT(\*) \* 100.0 / SUM(COUNT(\*)) OVER (), 1\) AS pct  
FROM student\_skill\_mastery  
GROUP BY mastery\_level  
ORDER BY mastery\_level;

Expected: reasonable distribution across levels 0-4; no single level dominates beyond \~40%.

---

## **Part VII — Appendices**

### **Appendix A: Constants Catalog (See §29)**

### **Appendix B: RPC Body Specification (See §40 Step 3\)**

### **Appendix C: Schema Changes (See §40 Step 1\)**

### **Appendix D: V4 Simulation Traces**

**Scenario 1 — Pure easy practice perfect:**

* 100 easy practice, all correct, same day  
* Numerator: 100 × 1.0 × 0.8 \= 80  
* Denominator: 100  
* Mastery: 0.80 → Level 4 (Strong, lower)

**Scenario 2 — Pure medium practice perfect:**

* 100 medium practice, all correct, same day  
* Numerator: 100 × 1.0 × 1.0 \= 100  
* Denominator: 100  
* Mastery: MIN(1.0, 1.0) \= 1.00 → Level 4 (Strong, max)

**Scenario 3 — Pure easy review perfect:**

* 100 easy review, all correct, same day  
* Numerator: 100 × 0.8 × 0.8 \= 64  
* Denominator: 100  
* Mastery: 0.64 → Level 3 (Proficient)

**Scenario 4 — Pure medium test perfect:**

* 44 medium test, all correct  
* Numerator: 44 × 1.5 × 1.0 \= 66  
* Denominator: 44  
* Mastery: MIN(1.0, 66/44) \= MIN(1.0, 1.5) \= 1.00 → Level 4 (Strong)

**Scenario 5 — Realistic mixed:**

* 200 medium practice, 85% correct (170 correct)  
* 50 medium review, 100% correct  
* 44 medium test, 60% correct (26 correct)

Numerator: 170 × 1.0 × 1.0 \+ 50 × 0.8 × 1.0 \+ 26 × 1.5 × 1.0 \= 170 \+ 40 \+ 39 \= 249 Denominator: 294 Mastery: 249/294 \= 0.847 → Level 4 (Strong)

**Scenario 6 — Over-projected practice king:**

* 300 medium practice, 95% correct (285 correct)  
* 44 medium test, 55% correct (24 correct)

Numerator: 285 × 1.0 × 1.0 \+ 24 × 1.5 × 1.0 \= 285 \+ 36 \= 321 Denominator: 344 Mastery: 321/344 \= 0.933 → Level 4 (Strong, high)

Vs. practice-only:

* 285/300 \= 0.95 Delta: adding test evidence at 55% pulled mastery from 0.95 to 0.93. Modest pull; tunable via source\_weight\_test.

**Scenario 7 — Hard exam stretch:**

* 22 hard test, 100% correct  
* Numerator: 22 × 1.5 × 1.2 \= 39.6  
* Denominator: 22  
* Mastery: MIN(1.0, 39.6/22) \= MIN(1.0, 1.80) \= 1.00 → Level 4

Single exam of hard questions, perfect performance, reaches mastery 1.0.

**Scenario 8 — Bad exam performance:**

* 22 medium test, 30% correct (7 correct)  
* Numerator: 7 × 1.5 × 1.0 \= 10.5  
* Denominator: 22  
* Mastery: 10.5/22 \= 0.477 → Level 2 (Developing)

Poor exam performance alone places student at Level 2\.

**Scenario 9 — Long-term improving student (half-life effect):**

See §18 worked example. 10 weeks of practice improving from 50% → 95%. Half-life weighted mastery: 0.866 (Level 4 Strong). Naive average: 0.78 (Level 3 Proficient). Delta: \+0.086 from recency weighting.

**Scenario 10 — Stable student (half-life cancels):**

Student: 10 weeks of consistent 70% medium practice. Every weekly snapshot \= 0.70. Half-life weighted: 0.70 (all equal, weights cancel). Naive average: 0.70 (same).

Half-life has no effect when behavior is uniform. Correct and expected.

### **Appendix E: Verification Queries (See §41)**

---

## **End of Doc 02C V4**

**Canonical version for Lyceon platform as of 2026-04-22.** **Supersedes V3.1. Preserves V3/V3.1 architectural decisions.** **Next review: post V4 launch \+ 30 days (expected 2026-05-22).**

