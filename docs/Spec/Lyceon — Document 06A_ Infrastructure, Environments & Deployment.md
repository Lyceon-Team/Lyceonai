# **Lyceon — Document 06A: Infrastructure, Environments & Deployment**

**Version:** V1.0 **Status:** LOCKED 2026-05-18 (draft-for-lock cleanup round 1 applied in-lock-cycle, RB-06A-V1-01..10; no version bump) **Last updated:** 2026-05-18 **Owners:** Founder / CTO review **Governed by:** Document 06 Parent V1.0 (LOCKED 2026-05-18) → Document 00 (Authoritative Platform Directive) **Depends on:** Doc 06 Parent V1.0; Doc 01A V1.0 (Platform Primitives, CANONICAL); Doc 03C V3.0 (LISA GCP substrate, CANONICAL); Doc 01 (Identity — V8 canonical per 01A/03 family; V6.0 provided; **06A has no V8-gated content** — see §18). **Forward-references (bounded, non-spec-lock-blocking):** Doc 07 (Analytics — not drafted); Doc 01.2 (Migration Runbooks) / Doc 03C Operations Runbook V1 (pending) for runbook bodies. **Applies to:** Portfolio infrastructure topology, the platform environment model, CI/CD and release-gate governance, schema-migration recovery governance, queue/outbox inventory governance, and the prod-data-in-lower-environment prohibition across the Lyceon platform — **excluding** the LISA-tier GCP substrate, which is canonical in Doc 03C and only referenced here.

---

# **§1 — Purpose & Position in the Doc 06 Family**

06A is the first Doc 06 sub-document and the operational substrate the other four build on. It answers: *where does Lyceon run, how is it environment-partitioned, how does code reach production safely, and how is each of those guarantees proven?*

06A owns the operational/proof wrapper for four Parent invariants: **INV-06-01** (no deploy without gates), **INV-06-03** (no prod data in lower envs — jointly with 06D), **INV-06-05** (every queue/outbox has a recovery path), **INV-06-06** (every migration has rollback or tested forward-fix). Per Parent §4 (Executable-Proof Doctrine) and Parent §6.13, every capability statement here names a proving mechanism and supplies the six-element implemented-definition. Per Parent §5 (Reference-Not-Redefine), 06A references 01A and 03C by exact § and never restates their bodies.

---

# **§2 — Scope and the 03C Boundary (Watch-Item 2, Explicit)**

## **2.1 06A owns**

Portfolio infrastructure topology and the platform stack inventory (§3); the under-utilized-leverage map (§4); the platform environment model and environment matrix (§6–§7); the prod-data-in-lower-env prohibition and its provenance-scan coverage matrix (§8); CI/CD topology and the release-gate registry as a declarative manifest (§9–§10); the schema-migration recovery contract (§11); the queue/outbox inventory (§12); platform deploy/rollback runbook *shapes* (§13); the deploy-time secret-injection boundary (§14, 06A's slice only); and backup *infrastructure topology* as a fact (§15, targets owned by 06D).

## **2.2 06A explicitly does NOT own — the 03C boundary**

The LISA-tier GCP substrate is **canonical in Doc 03C V3.0** and is referenced here, never restated:

| LISA-tier concern | Canonical owner (referenced, never restated) |
| ----- | ----- |
| GCP project topology, environment tiers for LISA | Doc 03C §13.1 |
| Cloud Run operational contract, blue-green, rollback | Doc 03C §28B (§28B.6 blue-green, §28B.7 rollback, §28B.8 config) |
| LISA schema-migration ordering \+ break-glass verification | Doc 03C §29, §29.3 |
| LISA network/IAM/secret/Vertex isolation | Doc 03C §12 |
| LISA cost observability | Doc 03C §11.3 (06E-referenced) |

06A owns only the **portfolio project-inventory pointer** that records *"GCP LISA tier exists; its deploy/rollback/migration/isolation contracts are Doc 03C-canonical."* Any 06A line that states a Cloud Run rollout step, a GCP project name, or a LISA migration-ordering rule is a `DD-06-REDEF` defect (Parent §5.3) caught by the §20 audit's 03C-boundary pass.

## **2.3 Inheritance**

06A inherits Doc 00 (server-authoritative, no client trust, deterministic, auditable, data-protection-by-default) and Parent §11.3 (the canonical "production data" definition — 06A enforces it and **may not narrow it**).

---

# **§3 — Platform / Stack Inventory**

The confirmed Lyceon platform stack. Each row records the current role and the canonical owner for any concern that is owned elsewhere (Decision 5). This table is itself a Doc 06A-owned registry (`infra-stack-inventory`, §3.2).

| Platform | Current role | Canonical owner for governed concerns | 06A treatment |
| ----- | ----- | ----- | ----- |
| **Vercel** | Frontend deployment; possibly backend API host (**OPEN — §18.1**) | Deploy-gate governance \= 06A §10; LISA deploy ≠ Vercel (03C) | First-class; §6–§13 |
| **Supabase** | Auth \+ primary Postgres DB; custom SMTP (password reset) | Auth/identity \= Doc 01; primitives \= 01A; pooler mode \= **01A §26 (canonical)**; backup targets \= 06D | First-class; §6–§8, §15 |
| **Cloudflare** | Authoritative DNS | Edge rate-limit ≠ canonical limiter (01A §39–§47 is canonical); internal-endpoint non-exposure \= 01A §69 | First-class inventory entry with thin operational scope; §3.1, §4, §14 |
| **GitHub** | Repository, version control, CI/CD execution location | Coding-standards monorepo layout; Doc 06 release-gate governance \= 06A §10 | First-class; §9–§11 |
| **GCP** | LISA orchestration \+ Gemini API (Vertex AI) | **Doc 03C V3.0 (canonical, entire LISA substrate)** | Inventory pointer only; §2.2 |
| **Sentry** | Error aggregation \+ (leverage) cron monitoring, release health | Observability *conventions* \+ redaction \= **01A §10–§19.1 (§14 PII, §19 sinks/retention)**; observability *ops* \= 06C | Inventory \+ sink fact; §3.1, §4; policy → 06C |
| **Microsoft Clarity** | Session replay \+ heatmaps | **FLAGGED — §5 finding.** PII/minors conflict with 01A §14, coding-standards §12.2, COPPA posture | Conservative default \+ compliance gate; §5 |
| **Postman \+ Fern** | API debugging (Postman) \+ typed SDK/OpenAPI generation (Fern) | API contract SSOT \= coding-standards `packages/shared` \+ `contracts/` | Dev/test tooling; §4 leverage |

## **3.1 First-class inventory entries with thin operational scope**

* **Cloudflare** is authoritative DNS today. Edge WAF / CDN / DDoS / Turnstile / Access are **under-used leverage** (§4), not current scope. Cloudflare is **not** a rate-limiter: 01A §39–§47 (`RateLimitLedger`) is the canonical limiter; any Cloudflare edge rate-limit is *defense-in-depth only* and must be documented as non-canonical (Decision 5).  
* **Sentry and Clarity occupy different observability axes and MUST NOT be conflated** (RB-06A-V1-09):  
  * **Sentry** is **operational observability** — error aggregation, performance traces, release-health regression signal. It is a §19 sink consuming 01A's logger/redaction conventions; its content is operational events, not user behavior.  
  * **Clarity** is **behavioral analytics / session replay / heatmaps** — it captures user interactions verbatim, including (on authenticated surfaces) student answers, tutor exchanges, and potential PII. The privacy axis is fundamentally different from Sentry's.  
  * **Privacy posture is therefore different by tool, not uniform**: Sentry's redaction config (mandatory per 01A §14, owned by 06C/06D) is sufficient for its content class; Clarity on authenticated surfaces is a separate, registered compliance-gated decision (§5). A tool-uniform "observability sinks" framing would obscure this — explicitly forbidden.  
  * 06A records only the infrastructure fact that these sinks exist. Their configuration policies (Sentry redaction \+ retention per 01A §14/§19; Clarity surface-scope per §5) are 06C/06D-owned.

## **3.2 `infra-stack-inventory` registry (proving-mechanism, Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Versioned `infra/stack-inventory.yaml` in repo; validated by CI check `ci/stack-inventory-parity` |
| Trigger cadence | Per PR touching `infra/**` \+ nightly |
| Input registry | The deployed-platform set (read from deploy configs \+ DNS zone \+ CI provider) |
| Failure condition | A deployed platform absent from the inventory, or an inventory entry with no canonical-owner reference for a governed concern → CI fail |
| Proof artifact | `stack-inventory-parity` CI record (retained per CI policy) |
| Owner / paging | Platform/CTO; routed per 01A §18 (referenced, not restated) |

---

# **§4 — Under-Utilized Leverage (Explicit Request)**

Per the standing request: for each platform, the leverage Lyceon is not yet using, and how each maps to a Doc 06 invariant so it is adoptable as a *proving mechanism*, not a nice-to-have. **Every leverage item that touches a sibling-owned concern references the canonical owner and is defense-in-depth, never a redefinition.**

| Platform | Under-used leverage | Maps to | Decision-5 guard |
| ----- | ----- | ----- | ----- |
| **GitHub** | (a) **Environments \+ required reviewers** as the deploy-gate enforcement substrate for `ci/release-gates` (INV-06-01) and the compliance-gate block (INV-06-11). (b) **OIDC keyless deploy** to Vercel/GCP — eliminates long-lived deploy secrets (feeds 06B; reduces INV-06-02 surface). (c) **Secret-scanning push protection** — pre-merge block on committed secrets (INV-06-02, 06B-owned; 06A wires it into release gates). (d) **CODEOWNERS** as the machine-readable owner map feeding the §6.13 "owner" element platform-wide. (e) **Branch protection / required status checks** \= the literal enforcement of "no deploy without gates." | INV-06-01, \-02, \-06, \-11 | GitHub Environments *enforce* the gate; the gate *definitions* live in the §10 manifest, not in GitHub config |
| **Vercel** | (a) **Cron** as an execution location for selected `ops/*` scheduled jobs (candidate executor for INV-06-04's registry; 06C-owned). (b) **Instant rollback** as the deploy-rollback runbook mechanism (§13). (c) **Log drains** → Sentry / log aggregator, satisfying 01A §19 sink wiring. (d) **Deployment protection / preview-env auth** enforcing INV-06-03 on ephemeral preview envs (§6.3). | INV-06-03, \-04 (06C), \-06 | Cron/rollback are *mechanisms*; the job/gate *registries* are 06A/06C-owned |
| **Supabase** | (a) **PITR** as the backup substrate for `ops/restore-test` (INV-06-09; targets 06D-owned, §15). (b) **Database branching** as the per-PR ephemeral-DB for Vercel preview envs (§6.3, Q3=a) — keeps preview data isolated, no prod data (INV-06-03). (c) **Vault** as a candidate secret store (feeds 06B). (d) **Read replicas** for lower-risk analytics reads (feeds Doc 07 seam, FWD). (e) Supavisor **session-mode** port for the LISTEN connection — **this decision is 01A §26-canonical (Option 3); 06A references, does not re-decide.** | INV-06-03, \-09 | PITR/branching are infra facts; RPO/RTO targets \= 06D; pooler mode \= 01A §26 |
| **Cloudflare** | (a) **Access / Tunnel** as the reverse-proxy enforcement of 01A §69 (internal `/api/internal/*` not publicly reachable) — strong defense-in-depth for the HMAC-auth seam. (b) **WAF / DDoS / Bot** as edge defense-in-depth (NOT the canonical limiter — 01A §39–§47). (c) **Turnstile** as a candidate abuse signal feeding 01A §52 incident taxonomy (06B). (d) **Zone-level TLS / HSTS** baseline. | INV-06-02 (defense-in-depth), \-12 | §69 enforcement is *additive*; the canonical auth/limiter remain 01A; Cloudflare never redefines them |
| **Sentry** | (a) **Crons** as the heartbeat/failure-alert executor for the INV-06-04 scheduled-job registry (06C-owned; 06A notes the executor candidate). (b) **Release tracking** tying each deploy to a Sentry release → per-deploy regression signal feeding `ci/release-gates`. (c) **Source maps** for readable stack traces (must respect 01A §14 — no PII in breadcrumbs; Sentry PII scrubbing is mandatory configuration, 06C/06D-owned policy). | INV-06-01, \-04 (06C) | Sentry is a §19 sink; redaction config is mandatory per 01A §14; policy \= 06C/06D |
| **Postman \+ Fern** | (a) **Newman** (Postman CLI) collection run as a release-gate check — API-contract regression as a blocking gate (INV-06-01). (b) **Fern-generated OpenAPI \+ typed SDK** as the API-contract proof artifact, aligned to coding-standards `packages/shared` SSOT \+ `contracts/` folder — the contract becomes a durable artifact a gate can diff against. | INV-06-01 | The contract SSOT is coding-standards-owned; Fern *generates* the artifact, does not define the contract |

**Net leverage finding:** the highest-value un-used items are **GitHub Environments \+ required reviewers** (the natural enforcement substrate for INV-06-01/-11 — no custom pipeline code needed), **Supabase branching \+ PITR** (directly satisfy INV-06-03 isolation and INV-06-09 restore substrate), and **Cloudflare Access** (turns 01A §69 from a policy statement into an enforced control). These are folded into the relevant sections below as the recommended execution substrates.

---

# **§5 — FINDING: Microsoft Clarity Session Replay on Minor-Facing Surfaces**

## **5.1 The conflict (stated plainly)**

Microsoft Clarity records session replays, heatmaps, and interaction telemetry. On **authenticated student surfaces** that captures, by construction: student answers (academic-integrity content), potential DOB/PII, and tutor interactions. This directly conflicts with:

* **01A §14** — raw student answers and raw tutor prompts/responses are on the never-log list; full DOB is never logged.  
* **Coding-standards §12.2** — "no invasive analytics on student-facing pages; minimize data collection on all student surfaces."  
* **Doc 00 / minors posture** — data-protection-by-default; the compliance brief's COPPA/GDPR-K position (the entire SAT-prep demographic is minors in several jurisdictions).

Session replay of minors performing academic work is a high-risk processing activity. This is a compliance finding, not a tooling preference.

## **5.2 Conservative default applied in this draft (overridable at review)**

Pending an explicit decision, 06A specifies the conservative posture:

1. **Clarity is permitted only on unauthenticated marketing / logged-out surfaces.** It is **prohibited on any authenticated student, guardian, or tutor surface.**  
2. Where permitted, **input/text masking is on by default** (Clarity's strict masking), and no element rendering user content is unmasked.  
3. **Any expansion of Clarity to an authenticated surface is a registered compliance gate** in the §10 release-gate manifest (`gate: clarity-authenticated-surface`), owned by the INV-06-11 compliance process (06D), and cannot ship without that gate's evidence/approval artifact.

## **5.3 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | CI check `ci/clarity-surface-scope` (static scan: Clarity snippet/SDK presence per route \+ auth-state classification) |
| Trigger cadence | Per PR \+ nightly |
| Input registry | **`infra/route-surface-classification.yaml`** (§5.3.1) — the route table annotated with auth-state, Clarity-allowance, and masking requirement; the §10 manifest's `clarity-authenticated-surface` gate state |
| Failure condition | Clarity present on any authenticated route, OR present on a marketing route with masking disabled, OR authenticated-surface use without an approved compliance-gate artifact → CI fail (blocks deploy) |
| Proof artifact | `clarity-surface-scope` record conforming to the §10.5 envelope \+ the per-mechanism extra fields in §10.5.1 (routes scanned, per-route surface\_class / Clarity presence / masking status / gate artifact ref) |
| Owner / paging | Compliance owner (06D process); routed per 01A §18 |

### **5.3.1 Route-surface-classification registry (`infra/route-surface-classification.yaml`)**

routes:  
  \- path\_pattern: \<route or glob\>  
    surface\_class: \[unauth\_marketing | authenticated\_student | authenticated\_guardian | authenticated\_admin | internal\]  
    clarity\_allowed: \<true | false\>     \# false by default for any authenticated\_\* class  
    masking\_required: \<true | false\>    \# true mandatory for any clarity\_allowed: true  
    owning\_doc: \<feature doc that defines the route\>  
    last\_classified\_at: \<iso8601\>

**Ownership and conformance:**

* The registry is **Doc 06A-owned**; entries are added by the feature doc that introduces the route (`owning_doc`), reviewed by the compliance owner (06D process) for any change to `surface_class` or `clarity_allowed`.  
* A deployed route absent from the registry is a `ci/clarity-surface-scope` failure (unclassified routes default to deny — Clarity scan fails closed).  
* Any change to `clarity_allowed: true` on an `authenticated_*` route REQUIRES an approved `clarity-authenticated-surface` compliance-gate artifact (§10.3, §10.5.1) — the gate enforces the §5.2 conservative default.

## **5.4 Decision required from product owner**

This draft proceeds on §5.2. The alternative postures are: (A) keep §5.2 as the permanent rule; (B) permit masked Clarity on authenticated surfaces *only* after the 06D compliance gate clears with documented DPIA-style evidence; (C) drop Clarity entirely and use a privacy-preserving analytics tool. **Lean: A** (cleanest; session replay buys little on a minors learning platform and the risk asymmetry is severe). This is flagged as an open decision in §18 and registered as a compliance-gate candidate regardless of choice.

---

# **§6 — Platform Environment Model**

## **6.1 Canonical three-tier model (references Parent §11, not a redefinition)**

The platform environment model is the three-tier model **canonical in Parent §11 / 01A §2 & §7** (`development | staging | production`) and instantiated for the LISA tier in Doc 03C §13.1. 06A references it and does not re-author the enum. Divergence is a `DD-06-REDEF` defect (Parent §11.4).

## **6.2 Per-tier posture**

| Tier | Purpose | Data class permitted (per Parent §11.3) | Deploy-gate stringency |
| ----- | ----- | ----- | ----- |
| `production` | Canonical, user-facing | Production data | Full `ci/release-gates` (all blocking gates) |
| `staging` | Pre-production parity | **No production data** (anonymized only) | Full gates except production-only compliance attestations |
| `development` | Per-engineer / per-feature | **No production data** | Lint \+ unit gates; relaxed for iteration |

## **6.3 Vercel preview deployments (Q3=a — ephemeral `development` sub-class, NOT a fourth tier)**

Vercel emits a preview deployment per PR. 06A classifies these as a **non-canonical, ephemeral sub-class of `development`** — explicitly *not* a fourth environment tier (so 01A §2/§7's enum is untouched; Decision 5 preserved). Rules:

1. Preview deploys are `development`\-class: **production data is prohibited** (INV-06-03 / Parent §11.3 apply in full).  
2. **Preview DB isolation is outcome-based:** Supabase database branching (§4 leverage) **where available**; otherwise, an equivalent isolated, non-production database seeded only with synthetic or anonymized fixtures. **Sharing the production or staging database with previews is prohibited** under all conditions. The invariant is "isolated, non-prod, synthetic/anonymized seed only" — the *tool* implementing it may change without a 06A version bump (Tier-1 in-lock-cycle); the *invariant* may not.  
3. Preview surfaces are **deployment-protected** (Vercel preview-env auth) — never publicly indexable, never carrying real user sessions.  
4. The `ops/lower-env-data-provenance-scan` coverage matrix (§8) **includes the preview sub-class as a scanned environment**.

This is the single point where 06A's infra reality (Vercel auto-previews) meets 01A's three-value enum; it is resolved by *classification under `development`*, not by adding a tier.

---

# **§7 — Environment Matrix Registry**

The portfolio environment matrix is a Doc 06A-owned declarative registry mapping each tier to its concrete platform projects. It does **not** restate 03C's GCP project names (those are 03C §13.1-canonical); it records the *pointer* and the cross-platform binding.

## **7.1 Matrix shape (`infra/environment-matrix.yaml`)**

environment\_matrix:  
  \- tier: production  
    vercel\_project\_frontend: \<prod frontend ref\>  
    vercel\_project\_bff\_api: \<prod BFF/API serverless ref\>   \# V1 binding (§18.1)  
    worker\_host: \<prod worker runtime ref\>                  \# separate process, never co-located with BFF (§18.1)  
    supabase\_project: \<prod project ref\>  
    gcp\_lisa\_tier: "Doc 03C §13.1 canonical — pointer only"  
    cloudflare\_zone: \<prod zone\>  
    secret\_scope: production  
    data\_class: production  
  \- tier: staging  
    vercel\_project\_frontend: \<staging frontend ref\>  
    vercel\_project\_bff\_api: \<staging BFF/API serverless ref\>  
    worker\_host: \<staging worker runtime ref\>  
    supabase\_project: \<staging ref\>  
    gcp\_lisa\_tier: "Doc 03C §13.1 canonical — pointer only"  
    cloudflare\_zone: \<staging zone\>  
    secret\_scope: staging  
    data\_class: anonymized\_only  
  \- tier: development  
    sub\_class: \[engineer\_local, vercel\_preview\_ephemeral\]  
    supabase: branch\_db\_or\_equivalent\_isolated\_non\_prod\_db   \# §6.3, RB-06A-V1-07  
    worker\_host: not\_required\_for\_preview                    \# workers only in staging/production  
    secret\_scope: development  
    data\_class: synthetic\_or\_anonymized\_only

## **7.2 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | `ci/environment-matrix-parity` (GitHub Actions) |
| Trigger cadence | Per PR touching `infra/**` \+ per deploy |
| Input registry | Deployed Vercel/Supabase/Cloudflare projects; the GCP-LISA pointer (presence-only, not contents) |
| Failure condition | A deployed project not in the matrix; a tier with a `data_class` weaker than its §6.2 posture; a `gcp_lisa_tier` cell containing anything beyond the canonical pointer (would be `DD-06-REDEF`) |
| Proof artifact | `environment-matrix-parity` CI record |
| Owner / paging | Platform/CTO; per 01A §18 |

---

# **§8 — Prod-Data-in-Lower-Env Prohibition & Provenance-Scan Coverage Matrix (INV-06-03)**

## **8.1 Rule**

No production data (per the canonical Parent §11.3 definition — **06A enforces, may not narrow**) reaches `staging`, `development`, or any `vercel_preview_ephemeral` surface without anonymization. 06A owns the *enforcement*; Parent §11.3 owns the *definition*.

## **8.2 Provenance-scan coverage matrix (the concrete registry, watch-item 3\)**

`ops/lower-env-data-provenance-scan` must cover **every medium** in Parent §11.3. The coverage matrix is a Doc 06A-owned registry:

| Medium (Parent §11.3) | Scanner surface | Pass condition |
| ----- | ----- | ----- |
| DB rows | Lower-env DB content fingerprint vs production-identifier patterns | No production-identifier match |
| DB dumps / exports | Export-artifact scan in lower-env storage | No production-derived dump present |
| Object-storage files | Lower-env bucket scan | No production-derived object |
| Logs / traces with identifiers | Lower-env log-sink sample scan (respecting 01A §14 redaction) | No unredacted production identifier |
| Analytics exports | Lower-env analytics dataset scan | No production-derived export |
| Backups / PITR snapshots | Lower-env restore-target scan | No production snapshot restored to lower env without anonymization |
| Screenshots | Lower-env asset/store scan | No production-user screenshot |
| Model/RAG payloads | Lower-env tutor/RAG fixture scan | No production prompt/response/context |

## **8.3 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled job `ops/lower-env-data-provenance-scan` (executor candidate: Vercel Cron or Supabase scheduled function; final binding 06C-coordinated) |
| Trigger cadence | Nightly, all lower environments incl. `vercel_preview_ephemeral` |
| Input registry | The §8.2 coverage matrix (all 8 media) \+ the §7 environment matrix |
| Failure condition | A production-data hit in any medium → raise `LOWER_ENV_PROD_DATA_DETECTED`; missing coverage for any §11.3 medium → scan is non-conformant (a control gap, itself a finding) |
| Proof artifact | Provenance-scan report row \+ per-medium coverage attestation |
| Owner / paging | Platform/CTO \+ compliance (06D); per 01A §18 |

DB-only coverage is explicitly a gamed control and fails conformance.

---

# **§9 — CI/CD Topology**

## **9.1 Execution substrate**

CI/CD executes on **GitHub Actions** (the §6.13 "execution location" for every Doc 06 `ci/*` mechanism unless a sub-doc names otherwise). Deploy targets: Vercel (frontend, and backend if §18.1 resolves that way), Supabase (migrations), GCP (LISA — **invoked via Doc 03C-canonical pipeline, not redefined here**).

## **9.2 Enforcement substrate (recommended, from §4 leverage)**

* **GitHub branch protection \+ required status checks** \= the literal enforcement of INV-06-01 (no deploy without gates). The *gate set* is the §10 manifest; GitHub *enforces* it.  
* **GitHub Environments \+ required reviewers** \= the enforcement of INV-06-11 (compliance gates as deploy gates) and any human-approval gate.  
* **GitHub OIDC** \= keyless deploy to Vercel/GCP — long-lived deploy secrets eliminated (security posture for 06B; shrinks INV-06-02 surface).  
* **Secret-scanning push protection** \= pre-merge enforcement feeding INV-06-02 (06B-owned rule; 06A wires it as a release-gate input).

## **9.3 Boundary**

06A owns CI/CD *governance and topology*. The LISA build/deploy pipeline is **Doc 03C-canonical** (§2.2); 06A references it as one deploy target and does not specify its steps.

---

# **§10 — Release-Gate Registry (Declarative Manifest — Q2=a)**

## **10.1 Principle**

`ci/release-gates` (INV-06-01, the aggregate gate) reads a **declarative, versioned manifest** — `infra/release-gates.yaml`. Adding a gate (e.g. Doc 05D `BLOCKING_PRIVACY_GAP`, a future COPPA gate, the §5 `clarity-authenticated-surface` gate) is a **manifest entry, not a pipeline-code change**. This is the only shape that satisfies Parent §6.13 mechanically and keeps INV-06-11 (compliance-gates-are-deploy-gates) as *data, not code*.

## **10.2 Manifest entry schema**

release\_gates:  
  \- gate\_id: \<stable id\>  
    owning\_doc: \<Doc that owns the rule, e.g. "Doc 05D"\>  
    blocking\_condition: \<machine-evaluable predicate or named check\>  
    proof\_artifact\_ref: \<where the pass/fail evidence is recorded\>  
    owner: \<CODEOWNERS-resolved owner\>  
    severity\_on\_fail: \<01A §18 tier — referenced, not restated\>  
    environment\_scope: \[production | staging | all\]  
    type: \[ci\_check | compliance\_attestation | human\_approval\]  
    blocking\_stage: \[pre\_merge | pre\_deploy | production\_deploy\]   \# RB-06A-V1-04  
    depends\_on: \[\<gate\_id\>, …\]                                     \# other gates that must pass first; default \[\]

**Dependency / stage semantics (RB-06A-V1-04):** `ci/release-gates` evaluates gates topologically by `depends_on` within each `blocking_stage`, then by stage order (`pre_merge` → `pre_deploy` → `production_deploy`). A gate whose `depends_on` set includes any failed gate is **skipped with reason `dependency_unsatisfied`** (recorded in the §10.5 envelope's `gates_skipped_with_reason[]`) and contributes a `fail` to the aggregate result. Dependency cycles in the manifest are a `DD-06-PROOF` defect and fail manifest conformance.

## **10.3 Seed entries (referenced rules, not restated)**

| gate\_id | owning\_doc | type |
| ----- | ----- | ----- |
| `compliance-privacy-gap` | Doc 05D (`BLOCKING_PRIVACY_GAP`) | compliance\_attestation |
| `migration-recovery-present` | Doc 06A §11 | ci\_check |
| `queue-outbox-recovery-parity` | Doc 06A §12 | ci\_check |
| `no-server-secret-in-client` | Doc 06B (INV-06-02) | ci\_check |
| `lower-env-data-provenance` | Doc 06A §8 | ci\_check |
| `clarity-authenticated-surface` | Doc 06D compliance process (§5) | compliance\_attestation |

The manifest *references* each owning doc's rule; it does not restate the rule body (Decision 5). 05D's `BLOCKING_PRIVACY_GAP` remains 05D-canonical with its conservative-hard-delete fallback (referenced, not restated).

## **10.4 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | `ci/release-gates` on GitHub Actions; enforced via GitHub branch protection \+ Environments (§9.2) |
| Trigger cadence | Every deploy-targeted PR/merge; production-scope gates additionally on the production deploy |
| Input registry | `infra/release-gates.yaml` |
| Failure condition | Any manifest gate with `environment_scope` covering the target unsatisfied → deploy blocked; a referenced `owning_doc` gate with no resolvable `proof_artifact_ref` → manifest non-conformant |
| Proof artifact | Per-deploy aggregate gate-state record (every gate id \+ pass/fail \+ artifact ref) conforming to the §10.5 envelope |
| Owner / paging | Release owner; compliance gates → 06D owner; per 01A §18 |

## **10.5 Standard 06A Proof Artifact Envelope (RB-06A-V1-01)**

The Parent §6.13 six-element contract requires a "proof artifact schema/location" per mechanism. To make that concrete and uniform, **every 06A-owned proof artifact (CI record, scheduled-job report row, gate-state record) MUST conform to the following envelope**:

common\_envelope:  
  proof\_id:              \<uuid\>  
  mechanism\_id:          \<e.g. "ci/release-gates" | "ops/lower-env-data-provenance-scan"\>  
  executed\_at:           \<iso8601 UTC\>  
  git\_sha:               \<commit SHA; required for ci/\* mechanisms\>  
  deploy\_id:             \<deploy identifier; required when scoped to a deploy\>  
  environment\_scope:     \<production | staging | development | vercel\_preview\_ephemeral | all\>  
  input\_registry\_ref:    \<file path / table — the §6.13 "input registry"\>  
  input\_registry\_hash:   \<sha256 of the registry contents at execution time — tamper-evidence\>  
  result:                \<pass | fail\>  
  failure\_code:          \<stable code | null\>  
  failure\_message:       \<human-readable | null\>  
  artifact\_url:          \<durable CI run URL | object-storage URL | null\>  
  table\_row\_id:          \<durable DB row id when persisted to a table | null\>  
  owner:                 \<CODEOWNERS-resolved owner\>

`artifact_url` **or** `table_row_id` must be non-null (the artifact is durably reachable). `input_registry_hash` is mandatory so a proof's referenced registry state is recoverable for audit.

### **10.5.1 Per-mechanism extra-field matrix**

In addition to the common envelope, each 06A mechanism MUST include these mechanism-specific fields:

| Mechanism | Required extra fields |
| ----- | ----- |
| `ci/stack-inventory-parity` (§3.2) | `observed_platforms[]`, `declared_inventory_hash`, `missing_canonical_owner_refs[]` |
| `ci/environment-matrix-parity` (§7.2) | `observed_project_refs[]`, `declared_matrix_hash`, `data_class_violations[]`, `gcp_lisa_tier_redefinition_detected: bool` |
| `ci/clarity-surface-scope` (§5.3) | `routes_scanned[]`, per-route `{route_id, surface_class, clarity_present, masking_status, gate_artifact_ref}` |
| `ops/lower-env-data-provenance-scan` (§8.3) | per-medium `{medium, scanner_version, scope_covered, sampled_size, violations_count}` for all 8 Parent §11.3 media |
| `ci/release-gates` (§10.4) | per-gate `{gate_id, gate_result, proof_artifact_ref, blocking_stage}`; `aggregate_result`; `gates_skipped_with_reason[]` |
| `ci/migration-recovery-present` (§11.3) | `migration_id`, `recovery_type` (reversible | forward\_fix\_only), `dry_run_artifact_ref`, `data_impact`, `requires_backup_before_apply`, `lisa_tier: bool` |
| `ci/queue-dlq-parity` (§12.3) | per-entry `{queue_or_outbox_id, kind, storage_location, retry_path_present, terminal_state_present, owner_alert_present, replay_path_present, replay_actor}` |
| `ci/runbook-shape-conformance` (§13.2) | per-runbook `{runbook_id, missing_required_shape_fields[], missing_executable_proof_criterion: bool, lisa_tier_03c_restatement_detected: bool}` |

### **10.5.2 Conformance**

A proof artifact missing any common-envelope field or its mechanism-specific extra fields is a **`DD-06-PROOF` defect** (Parent §6.13) and the mechanism is non-conformant. The §20 executable-proof audit pass verifies envelope conformance against this contract.

---

# **§11 — Schema-Migration Recovery Contract (INV-06-06)**

## **11.1 Rule**

Every schema migration ships with **either** a dry-run-tested rollback **or** a documented, tested forward-fix recovery plan (Parent INV-06-06; consistent with Doc 05D INV-05D-13's forward-only posture — referenced, not restated). For the **LISA tier**, migration ordering and break-glass verification are **Doc 03C §29.3-canonical**; 06A references and does not restate the ordering rules.

## **11.2 Migration-recovery manifest (per-migration registry)**

migration:  
  id: \<migration id\>  
  type: \[reversible | forward\_fix\_only\]  
  rollback\_script\_ref: \<path\>          \# required if type \== reversible  
  forward\_fix\_plan\_ref: \<doc/path\>     \# required if type \== forward\_fix\_only  
  dry\_run\_proof\_ref: \<CI artifact\>     \# required for both  
  data\_impact: \[none | additive\_only | transforms\_data | deletes\_data\]   \# RB-06A-V1-06  
  requires\_backup\_before\_apply: \<bool\> \# RB-06A-V1-06 — mandatory true if data\_impact ∈ {transforms\_data, deletes\_data}  
  lisa\_tier: \<true|false\>              \# if true: ordering per Doc 03C §29.3 (referenced)  
  owner: \<CODEOWNERS-resolved\>

**Data-safety gate (RB-06A-V1-06):** a migration declaring `data_impact ∈ {transforms_data, deletes_data}` MUST set `requires_backup_before_apply: true` and the production deploy of that migration is conditional on a recorded pre-apply backup-and-verify artifact (the `ops/restore-test` substrate is reused — substrate is 06D-owned per §15; 06A wires the gate). A `reversible` migration that *transforms or deletes data* is still high-risk: the rollback script's correctness against the transformed data must be part of the `dry_run_proof_ref`. `ci/migration-recovery-present` fails if `requires_backup_before_apply` is false but `data_impact ∈ {transforms_data, deletes_data}`.

## **11.3 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | `ci/migration-recovery-present` (GitHub Actions, migration-PR template gate) |
| Trigger cadence | Every PR introducing a migration |
| Input registry | The §11.2 manifest entry for each migration in the PR |
| Failure condition | A migration with neither a dry-run-tested rollback nor a tested forward-fix plan; a `lisa_tier: true` migration whose PR restates 03C §29.3 ordering instead of referencing it (`DD-06-REDEF`) |
| Proof artifact | `migration-recovery` CI record \+ dry-run proof artifact |
| Owner / paging | Migration owner; per 01A §18 |

---

# **§12 — Queue / Outbox Inventory (INV-06-05)**

## **12.1 Rule**

Every async queue **or transactional outbox** has: a bounded-retry path, a terminal failure state, an owner alert, and a replay/remediation path (Parent INV-06-05). The inventory is a Doc 06A-owned registry; the *queue/outbox definitions themselves* are owned by their feature docs and **referenced, never restated**.

## **12.2 Inventory registry (`infra/queue-outbox-inventory.yaml`)**

queues\_and\_outboxes:  
  \- id: \<name\>  
    kind: \[external\_queue | transactional\_outbox\]  
    owning\_doc: \<e.g. "Doc 05C", "Doc 05D §11.N", "Doc 03C §8.2", "Doc 04B"\>  
    storage\_location: \[postgres\_table | external\_queue | vercel\_cron | github\_action | gcp\_cloud\_tasks | other\]   \# RB-06A-V1-05  
    retry\_policy\_ref: \<owning-doc section\>  
    terminal\_failure\_state: \<e.g. DB 'failed' status | external DLQ\>  
    owner\_alert: \<01A §18 routing — referenced\>  
    replay\_path\_ref: \<owning-doc section / runbook shape\>  
    replay\_actor: \[service\_role | admin\_only | worker | scheduled\_job\]     \# RB-06A-V1-05 — replay IS a privileged op (Parent INV-06-07)  
    replay\_permission\_ref: \<Doc 01 / Doc 06B section authorizing the replay actor\>   \# RB-06A-V1-05

**Privileged-replay note (RB-06A-V1-05):** queue/outbox replay is a privileged operation that emits audit records under Parent INV-06-07 (Doc 06B audit-coverage \+ 01A §5 config-history \+ Doc 05D admin-RLS). The inventory records *which actor class* may replay each entry and *which canonical doc* authorizes it; the authorization rules themselves remain owned by their canonical docs (Decision 5). `ci/queue-dlq-parity` (§12.3) verifies these fields are populated.

Seed entries (referenced, not restated): Doc 05C `projection_refresh_outbox`; Doc 05D §11.N additive `attempt_count` \+ terminal `failed`; Doc 04B scoring outbox; Doc 03C §8.2 LISA queue topology (`lisa-compaction`, `lisa-memory-refresh`, `lisa-pending-reconciliation`).

## **12.3 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | `ci/queue-dlq-parity` (GitHub Actions, static audit) |
| Trigger cadence | Per PR touching queue/outbox code \+ per deploy |
| Input registry | `infra/queue-outbox-inventory.yaml` |
| Failure condition | A declared queue/outbox missing any of {bounded retry, terminal failure state, owner alert, replay path}; an inventory entry restating an owning-doc retry body instead of referencing it (`DD-06-REDEF`); a queue/outbox in code absent from the inventory |
| Proof artifact | `queue-outbox-parity` CI record |
| Owner / paging | Owning-doc owner per entry; per 01A §18 |

---

# **§13 — Deploy & Rollback Runbook Shapes (Decision 3\)**

06A owns runbook *required-shape contracts and the inventory pointer*, not bodies (Parent §12). Bodies live in `docs/runbooks/` / Doc 01.2 / Doc 03C Operations Runbook V1 (pending; FWD).

## **13.1 Required-shape — platform deploy runbook**

Stable id; target platform (Vercel | Supabase | GCP-LISA→**Doc 03C §28B canonical, pointer only**); pre-deploy gate set (= §10 manifest scope); deploy mechanism; rollback mechanism (Vercel instant rollback | Supabase migration recovery per §11 | GCP-LISA per **Doc 03C §28B.7**, referenced); the **executable-proof acceptance criterion** (the runnable check proving the deploy restored/maintained the guaranteed state); owner; 01A §18 paging.

## **13.2 Proving mechanism (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | `ci/runbook-shape-conformance` (lint of runbook front-matter against the §13.1 required-shape) |
| Trigger cadence | Per PR touching `docs/runbooks/**` \+ nightly |
| Input registry | The runbook inventory pointer (id → location → owning doc) |
| Failure condition | A deploy/rollback runbook missing a required-shape field or its executable-proof criterion; a LISA-tier runbook restating 03C §28B steps instead of referencing them |
| Proof artifact | `runbook-shape-conformance` CI record |
| Owner / paging | Runbook owner; per 01A §18 |

---

# **§14 — Deploy-Time Secret-Injection Boundary (06A's slice only)**

06A owns only the **deploy-time** boundary: build-time vs runtime secret separation, and that no privileged secret enters a client bundle at build (INV-06-02 — **rule owned by 06B \+ 01A §64**, referenced; 06A wires the build-time enforcement).

* Build outputs must contain **no** server/service-role secret (INV-06-02). Enforcement: `ci/no-server-secret-in-client` (06B-owned check) is a §10 manifest gate; 06A guarantees it runs at build.  
* Recommended posture (from §4): **GitHub OIDC keyless deploy** — no long-lived deploy credentials; runtime secrets injected from the secret store (06B-owned policy; candidates: Supabase Vault, platform secret managers) per environment scope (§7).  
* Secret-storage policy, rotation, HMAC service-auth \= **Doc 06B \+ 01A §61–§71 canonical**; 06A references and does not restate.

---

# **§15 — Backup Infrastructure Topology (Fact Only — Targets Owned by 06D)**

06A records the infrastructure *fact*: the primary DB is Supabase Postgres with **PITR available** as the restore substrate that `ops/restore-test` (**INV-06-09; the mechanism, its targets, and its acceptance obligation are entirely Doc 06D-owned** — referenced here, not a 06A acceptance item) consumes. 06A owns **none** of: the `ops/restore-test` mechanism, RPO/RTO targets, restore-test acceptance target, restore cadence — all **Doc 06D-canonical** (Parent §3, §16 criterion 9). 06A's only obligation: the §7 environment matrix records the backup-capable production project, and the §8 provenance scan covers the "backups/PITR snapshots" medium so a production snapshot cannot be restored into a lower env unanonymized.

---

# **§16 — Hard Invariants Owned/Championed by 06A**

Each carries the Parent §6.13 six-element implemented-definition (full tables in the cited sections). Status: **specified, not yet deploy-proven** until each sub-mechanism's owning artifact is implemented (Parent §6.13).

| Invariant | 06A section | Proving mechanism | Status |
| ----- | ----- | ----- | ----- |
| INV-06-01 (no deploy without gates) | §10 | `ci/release-gates` (manifest-driven) \+ GitHub enforcement | Specified |
| INV-06-03 (no prod data in lower envs) — joint w/ 06D | §8 | `ops/lower-env-data-provenance-scan` (8-medium coverage) | Specified |
| INV-06-05 (queue/outbox recovery) | §12 | `ci/queue-dlq-parity` (inventory-driven) | Specified |
| INV-06-06 (migration rollback or forward-fix) | §11 | `ci/migration-recovery-present` (manifest-driven) | Specified |
| INV-06-02 (no server secret to client) — **06B-owned, 06A wires build-time** | §14 | `ci/no-server-secret-in-client` (06B) as a §10 gate | Referenced |
| INV-06-11 (compliance gates \= deploy gates) — **06D-owned, 06A provides the registry mechanism** | §10 | §10 manifest \+ GitHub Environments | Referenced |

06A introduces no new invariants; it operationalizes Parent invariants. 06A-local proving mechanisms additionally introduced for self-governance: `ci/stack-inventory-parity` (§3.2), `ci/environment-matrix-parity` (§7.2), `ci/clarity-surface-scope` (§5.3), `ci/runbook-shape-conformance` (§13.2).

---

# **§17 — Cross-Document Seam Table (Grounded by Exact §)**

| Seam | 06A side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| Config doctrine / `*_runtime_config` | §3, §10 | 01A §1–§9 | RESOLVED |
| Pooler / LISTEN-connection mode (Supabase Supavisor vs direct) | §4 (Supabase) | **01A §26 (Option 3 canonical) \+ §77 review trigger** | RESOLVED — referenced; 06A does not re-decide |
| Caching topology | §3.1 | 01A §20–§28.1 | RESOLVED |
| Observability conventions / PII redaction / sinks-retention | §3.1, §8.2 | 01A §10–§19.1 (§14, §19) | RESOLVED — sinks are infra facts; conventions referenced |
| Internal-endpoint non-exposure (Cloudflare Access leverage) | §4 (Cloudflare) | 01A §69 | RESOLVED — Cloudflare Access is additive enforcement, not redefinition |
| Rate limiting (Cloudflare WAF leverage) | §3.1, §4 | 01A §39–§47 | RESOLVED — edge WAF \= defense-in-depth only; canonical limiter unchanged |
| Internal service auth / secrets / rotation | §14 | 01A §61–§71; Doc 06B | RESOLVED — 06A owns only build-time boundary |
| LISA GCP deploy / env / rollback / Cloud Run / migration ordering | §2.2, §9.3, §11.1, §13.1 | **Doc 03C §13, §28B, §29, §29.3** | RESOLVED — pointer only; 03C-boundary audit pass enforces |
| LISA queue topology | §12.2 | Doc 03C §8.2 | RESOLVED |
| Scoring / projection outboxes | §12.2 | Doc 04B; Doc 05C `projection_refresh_outbox`; Doc 05D §11.N | RESOLVED |
| Production-data definition | §8.1 | **Parent §11.3 (canonical)** | RESOLVED — 06A enforces, may not narrow |
| Compliance privacy deploy gate | §10.3 | Doc 05D `BLOCKING_PRIVACY_GAP`; INV-06-11 (06D process) | RESOLVED — referenced; 06A owns registry mechanism only |
| Backup RPO/RTO targets | §15 | **Doc 06D (canonical)** | RESOLVED — 06A owns infra fact only |
| Scheduled-job monitoring (Sentry Crons / Vercel Cron executors) | §4, §8.3 | **Doc 06C (INV-06-04 owner)** | RESOLVED — 06A names executor candidates; 06C owns the registry |
| Analytics / read-replica seam | §4 (Supabase) | Doc 07 (not drafted) | OPEN — bounded FORWARD\_REF (Parent FWD-06-01) |
| Identity / auth (Supabase Auth) | §3 | Doc 01 (V8 canonical; V6.0 provided) | RESOLVED for 06A — **06A has no V8-gated content**; auth rules are Doc 01-owned, not 06A |

---

# **§18 — Open Decisions & FORWARD\_REFs**

None block 06A spec lock (the Parent enumerated-gates pattern). Explicitly carried:

1. **§18.1 — Backend API hosting (V1 LOCKED; future evolution \= Tier-2 additive).** Frontend on Vercel is confirmed; LISA on GCP Cloud Run is 03C-canonical. **V1 BINDING:** the main BFF/API runtime is **Vercel serverless functions**. Long-running and worker paths are hosted on a **separate worker process / runtime**, never co-located with the user-facing API runtime (coding-standards rule: "workers/OCR/embedding work never runs in the user-facing server process"). The §7 environment matrix is written against this V1 binding. Any later cutover (dedicated Node host, Supabase edge functions, alternative serverless platform) is a **Tier-2 additive infra topology update** (Parent §19.3) and does not require a 06A rewrite. The worker-host platform binding itself remains a Tier-2 decision pending workload sizing (candidates: GCP Cloud Run worker service, a dedicated container host); 06A registers the *separation* as the V1 invariant, not the specific worker platform.  
2. **§18.2 — Microsoft Clarity posture (§5.4).** Draft proceeds on the conservative §5.2 default \+ `clarity-authenticated-surface` compliance gate. Product-owner decision required (A/B/C per §5.4). Registered as a compliance-gate candidate regardless.  
3. **§18.3 — Supabase as V1 environment-matrix basis (Neon cutover \= Tier-2 \+ 01A reconciliation).** **The 06A V1 environment matrix is written against the current Supabase-managed Postgres deployment.** 01A header depends on both Supabase and Neon Postgres; 01A §26 owns the pooler decision (Option 3 canonical) and 01A §77 carries the Neon-pooling architectural resolution as an 01A review trigger. **Any cutover to Neon is a Tier-2 additive infra topology update (Parent §19.3) plus an 01A review-trigger reconciliation; it does not require a 06A rewrite.** 06A does not decide the Supabase/Neon resolution — that remains 01A §26/§77-owned.  
4. **§18.4 — Doc 07 analytics/read-replica seam** — bounded FORWARD\_REF (Parent FWD-06-01); reconciles when Doc 07 drafts.  
5. **§18.5 — Runbook bodies** — Doc 01.2 / Doc 03C Operations Runbook V1 (pending); 06A owns shape \+ inventory pointer only (Parent FWD-06-04).

---

# **§19 — Acceptance Criteria (Executable-Proof Framed)**

06A is acceptance-complete when **(A) all 06A-owned criteria pass** AND **(B) all cross-doc gate-entry-presence criteria pass**. 06A does not require cross-doc *body* implementations for its own lock — only the gate-entry and registry-reference presence (RB-06A-V1-08).

### **A — 06A-owned criteria**

1. `ci/stack-inventory-parity` fails on a deployed platform absent from `infra/stack-inventory.yaml` or an entry lacking a canonical-owner reference for a governed concern (§3.2).  
2. `ci/environment-matrix-parity` fails on an unmatrixed deployed project, a tier with a data-class weaker than its §6.2 posture, a missing `vercel_project_bff_api` or `worker_host` in production/staging (§18.1 V1 binding), or a `gcp_lisa_tier` cell containing more than the canonical pointer (§7.2).  
3. `ci/clarity-surface-scope` fails on Clarity present on any authenticated route, unmasked on a marketing route, expanded to an authenticated surface without an approved 06D compliance-gate artifact, or on a deployed route absent from `infra/route-surface-classification.yaml` (defaults to deny) (§5.3, §5.3.1).  
4. `ops/lower-env-data-provenance-scan` runs nightly across all lower envs incl. `vercel_preview_ephemeral`, covers all 8 Parent §11.3 media, and raises `LOWER_ENV_PROD_DATA_DETECTED` on an induced violation in any medium (§8.3).  
5. `ci/release-gates` reads `infra/release-gates.yaml`, evaluates gates topologically by `depends_on` within each `blocking_stage`, blocks a deploy when any in-scope manifest gate is unsatisfied, and records a per-deploy aggregate gate-state artifact (RB-06A-V1-04, §10.4).  
6. `ci/migration-recovery-present` fails a migration PR with neither a dry-run-tested rollback nor a tested forward-fix plan; fails when `data_impact ∈ {transforms_data, deletes_data}` and `requires_backup_before_apply` is false (RB-06A-V1-06); a `lisa_tier: true` migration references Doc 03C §29.3 ordering rather than restating it (§11.3).  
7. `ci/queue-dlq-parity` fails when a declared queue/outbox lacks any of {bounded retry, terminal failure state, owner alert, replay path, `storage_location`, `replay_actor`, `replay_permission_ref`} (RB-06A-V1-05), validating either an external DLQ or a DB terminal `failed` status; the 05C/05D/04B/03C entries are present as referenced inventory (§12.3).  
8. `ci/runbook-shape-conformance` fails a deploy/rollback runbook missing a required-shape field or its executable-proof criterion, and flags any LISA-tier runbook restating 03C §28B (§13.2).  
9. Every 06A-owned proof artifact conforms to the §10.5 Standard Proof Artifact Envelope and the §10.5.1 per-mechanism extra-field matrix; an artifact missing any common-envelope field or its mechanism-specific extras is a `DD-06-PROOF` defect (§10.5.2).

### **B — Cross-doc gate-entry-presence criteria (06A's slice only)**

10. **INV-06-02 (06B-owned scanner body):** 06A's slice is satisfied when (a) `no-server-secret-in-client` is present as an entry in `infra/release-gates.yaml` with `environment_scope` covering production, (b) the gate is enforced by `ci/release-gates`, and (c) the build-time secret-injection boundary (§14) is in place. **The scanner implementation itself is accepted in 06B; 06A does not accept the scanner body.** (RB-06A-V1-08.)  
11. **INV-06-09 (06D-owned `ops/restore-test`):** 06A's slice is satisfied when (a) the §7 environment matrix records the backup-capable production project, and (b) the §8 provenance scan covers the "backups/PITR snapshots" medium. **The `ops/restore-test` mechanism, its targets, and its acceptance are owned by 06D; 06A does not accept them** (§15).  
12. **INV-06-11 (06D-owned compliance process):** 06A's slice is satisfied when `infra/release-gates.yaml` carries each registered compliance gate as a referenced entry with a resolvable `proof_artifact_ref`. **The compliance evidence/approval process is owned by 06D; 06A does not accept the process body.**

### **C — Audit closure**

13. The §20 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects, zero 03C-boundary-pass violations, and zero §10.5 envelope-conformance violations.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job / scheduled job / manifest / registry) supplies all six §6.13 elements.

---

# **§20 — Audit Profile**

Inherits the Parent §17 six passes (structure / redefinition-detection / seam-resolution / executable-proof / forward-ref closure / runbook-shape), plus two 06A-specific passes:

7. **03C-boundary pass** — flags any 06A line that states a GCP project name, a Cloud Run rollout/rollback step, or a LISA migration-ordering rule instead of a Doc 03C §13/§28B/§29.3 pointer (`DD-06-REDEF`, watch-item 2). High-priority targets: §2.2, §9.3, §11, §13.  
8. **Registry-schema-completeness pass** — every Doc 06A-owned registry (stack inventory, environment matrix, release-gate manifest, migration-recovery manifest, queue/outbox inventory, provenance coverage matrix) has a defined schema and a §6.13 six-element proving-mechanism table; a named registry without both is a `DD-06-PROOF` defect (watch-item 3).

Known false-positive class (carried): §-header rows; the §4 leverage table and §5 finding (they *name* sibling-owned concerns to reference/guard them, not restate them); the §17 seam citations; the §10/§11/§12 manifest schemas (they define 06A-owned shapes, not sibling bodies).

---

# **§21 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-06A-V1-NN` cleanup → audit); `.bak`/`.bak2` before each pass; status semantics — draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§22 — Change Records**

**CR-06A-01** — Doc 06A V1.0 established. Scope \= portfolio infra topology, environment model, CI/CD \+ release-gate governance, migration recovery, queue/outbox inventory, prod-data-in-lower-env enforcement. Owns operational/proof wrapper for INV-06-01/-03/-05/-06; references INV-06-02 (06B) and INV-06-11 (06D) registry mechanism. 03C boundary made explicit and audit-enforced (§2.2, §20 pass 7).

**CR-06A-02** — Stack inventory recorded (Vercel, Supabase, Cloudflare, GitHub, GCP, Sentry, Clarity, Postman/Fern) with canonical-owner references per governed concern (§3). Under-utilized-leverage map produced per product-owner request (§4); highest-value items (GitHub Environments+required reviewers, Supabase branching+PITR, Cloudflare Access) folded in as recommended execution substrates.

**CR-06A-03** — FINDING (§5): Microsoft Clarity session-replay conflicts with 01A §14 / coding-standards §12.2 / minors posture. Conservative default applied (marketing-only, masked, authenticated-surface use behind a registered compliance gate); product-owner decision flagged (§5.4 / §18.2).

**CR-06A-04** — Pre-draft Q\&A locked: Q-06A-1 \= three platforms first-class \+ Cloudflare(DNS) first-class with thin operational scope \+ full stack inventory \+ leverage call-out; Q-06A-2 \= (a) declarative release-gate manifest; Q-06A-3 \= (a) Vercel preview \= ephemeral `development` sub-class (no fourth tier; preview-DB isolation outcome-based per RB-06A-V1-07). Open decisions carried (§18): backend-host topology (LOCKED in CR-06A-05 below), Clarity posture, Supabase/Neon pooler (01A §26/§77-owned), Doc 07 seam, runbook bodies.

**CR-06A-05** — Draft-for-lock cleanup round 1 (external SWE review, 2026-05-18), RB-06A-V1-01..10 applied in-lock-cycle, **no version bump**, status transitioned `DRAFT` → `LOCKED`. 2 blockers (01: §10.5 Standard Proof Artifact Envelope \+ §10.5.1 per-mechanism extras matrix — "CI record" replaced with concrete 12-field schemas; 02: §18.1 V1 BFF/API host LOCKED \= Vercel serverless functions \+ separate worker host, §7 matrix updated, future cutover \= Tier-2 additive). 6 highs (03: `infra/route-surface-classification.yaml` registry feeds `ci/clarity-surface-scope`, defaults-to-deny; 04: `depends_on` \+ `blocking_stage` on release-gate manifest, topological evaluation, cycle \= defect; 05: queue/outbox inventory gains `storage_location` \+ `replay_actor` \+ `replay_permission_ref` — replay is a privileged op under INV-06-07; 06: migration-recovery manifest gains `data_impact` \+ `requires_backup_before_apply` — data-affecting migrations gated on pre-apply backup proof; 07: preview DB isolation outcome-based, shared prod/staging prohibited absolutely; 08: §19 acceptance split A/B/C — 06A-owned vs cross-doc gate-presence vs audit-closure; INV-06-02 06A-slice clarified). 2 mediums (09: terminology normalized; Sentry operational-observability vs Clarity behavioral/session-replay split with privacy-axis distinction; 10: Supabase V1 binding, Neon cutover \= Tier-2 \+ 01A reconciliation). Re-audit clean across all 8 §20 passes; zero `DD-06-*` defects; zero 03C-boundary violations; zero §10.5 envelope-conformance violations.

---

# **§23 — Cleanup Register (RB-06A-V1-NN)**

Round 1 (external SWE review, 2026-05-18): 2 blockers \+ 6 highs \+ 2 mediums, all accepted and applied in-lock-cycle. No version bump; draft-for-lock pass transitioned status `DRAFT` → `LOCKED`.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06A-V1-01 | BLOCKER | SWE B1 | §10.5 added: Standard 06A Proof Artifact Envelope (12 common fields incl. `proof_id`, `mechanism_id`, `git_sha`, `environment_scope`, `input_registry_ref`, `input_registry_hash`, `result`, `failure_code`, `artifact_url`/`table_row_id`, `owner`); §10.5.1 per-mechanism extra-field matrix for all 8 06A mechanisms; §10.5.2 envelope conformance \= `DD-06-PROOF` defect. |
| RB-06A-V1-02 | BLOCKER | SWE B2 | §18.1 LOCKED: V1 BFF/API runtime \= Vercel serverless functions; long-running/worker paths on a separate worker process (coding-standards rule). §7.1 matrix updated with `vercel_project_bff_api` \+ `worker_host` per tier. Future cutover \= Tier-2 additive (no 06A rewrite). |
| RB-06A-V1-03 | HIGH | SWE H1 | §5.3.1 added: `infra/route-surface-classification.yaml` registry (path\_pattern, surface\_class, clarity\_allowed, masking\_required, owning\_doc, last\_classified\_at). `ci/clarity-surface-scope` consumes it; unclassified routes default to deny; any `clarity_allowed: true` on authenticated\_\* requires the §10 compliance gate. |
| RB-06A-V1-04 | HIGH | SWE H2 | §10.2 added `depends_on: []` and `blocking_stage: [pre_merge|pre_deploy|production_deploy]` to release-gate manifest schema. Topological evaluation within stage, then stage order; gate with failed dependency skipped+fail with reason; cycles \= manifest non-conformance. |
| RB-06A-V1-05 | HIGH | SWE H3 | §12.2 queue/outbox inventory gains `storage_location`, `replay_actor`, `replay_permission_ref`. Replay recorded as a privileged op under Parent INV-06-07 (audit substrates 06B \+ 01A §5 \+ 05D admin-RLS, referenced not restated); authorization rules remain canonical-doc-owned. `ci/queue-dlq-parity` verifies population. |
| RB-06A-V1-06 | HIGH | SWE H4 | §11.2 migration-recovery manifest gains `data_impact` (none|additive\_only|transforms\_data|deletes\_data) \+ `requires_backup_before_apply` (mandatory true if data\_impact ∈ {transforms\_data, deletes\_data}). Production deploy of data-affecting migration conditional on pre-apply backup-and-verify artifact; reversible-but-data-affecting migrations require rollback dry-run against transformed data. |
| RB-06A-V1-07 | HIGH | SWE H5 | §6.3 preview DB isolation made outcome-based: Supabase database branching where available; otherwise equivalent isolated non-production DB seeded only with synthetic/anonymized fixtures. **Sharing production or staging DB with previews prohibited absolutely.** Tool may change Tier-1; invariant may not. |
| RB-06A-V1-08 | HIGH | SWE H6 | §19 acceptance split into A (06A-owned criteria), B (cross-doc gate-entry-presence — 06A's slice only), C (audit closure). INV-06-02 06A-slice \= gate-entry presence \+ build-time boundary; scanner body owned by 06B. Same pattern applied to INV-06-09 (06D-owned `ops/restore-test`) and INV-06-11 (06D-owned compliance process). |
| RB-06A-V1-09 | MEDIUM | SWE M1 \+ M3 | "First-class-thin" normalized to "First-class inventory entry with thin operational scope" (§3, §3.1). §3.1 reorganized: Sentry (operational observability) and Clarity (behavioral analytics / session replay) are different observability axes with different privacy postures; tool-uniform "observability sinks" framing explicitly forbidden; per-tool policy ownership clarified (Sentry redaction \= 06C/06D; Clarity surface-scope \= §5). |
| RB-06A-V1-10 | MEDIUM | SWE M2 | §18.3 reframed: Supabase-managed Postgres is the 06A V1 environment-matrix basis; any Neon cutover is a Tier-2 additive topology update plus an 01A §26/§77 review-trigger reconciliation (no 06A rewrite). Supabase/Neon resolution remains 01A-owned. |

**Convention:** `.bak`/`.bak2` before each pass; resolved items tagged `RB-06A-V1-NN`; a §22 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes leave status/version/lock-date unchanged (Parent §8).

---

*End of Doc 06A V1.0 (LOCKED 2026-05-18; RB-06A-V1-01..10 applied in-lock-cycle, no version bump). Next: 06B (Security Operations, Secrets & Access).*

