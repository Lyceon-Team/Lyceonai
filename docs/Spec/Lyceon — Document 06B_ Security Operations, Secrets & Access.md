# **Lyceon — Document 06B: Security Operations, Secrets & Access**

**Version:** V1.0 **Status:** LOCKED 2026-05-21 (draft-for-lock cleanup round 1 applied in-lock-cycle, RB-06B-V1-01..12; no version bump) **Last updated:** 2026-05-21 **Owners:** Founder / CTO review **Governed by:** Document 06 Parent V1.0 (LOCKED 2026-05-18) → Document 00 (Authoritative Platform Directive) **Depends on:** Doc 06 Parent V1.0; Doc 06A V1.0 (LOCKED 2026-05-18, env matrix \+ §10.5 envelope \+ secret-injection boundary \+ V1 BFF/worker binding); Doc 01A V1.0 (CANONICAL, primitives — §39–§47 rate-limit, §48–§59 abuse, §61–§71 service auth); Doc 01 (Identity/Access/Billing — V6.0 provided; **V8 canonical per 01A/03 family; V6→V8 deltas bounded to FWD-06-02 surface, §17.X**); Doc 03 Main V1.1 (§21.3 safety-review queue, canonical for tutor-class); Doc 03C V3.0 (§12 LISA isolation, §9.4 emergency revoke, canonical); Doc 04B V4.3 / Doc 05D V1.0 (privileged-op audit substrates). **Forward-references (bounded):** Doc 01 V8 §44 support-access audit slice (FWD-06-02, gates the V8-specific portion of INV-06-07 only); Doc 07 (FWD-06-01). **Applies to:** Secret-storage operational policy; HMAC service-auth rotation operations; production access and break-glass; privileged-op audit *process*; abuse-incident operations; Cloudflare-Access enforcement of internal-endpoint non-exposure; the build-time secret-scanner body. **Explicitly excludes:** every primitive *body* owned by 01A §61–§71 / §39–§47 / §48–§59 (referenced, never restated — Decision 5).

---

# **§1 — Purpose & Position in the Doc 06 Family**

06B is the security-operations sub-document. It answers: *who can reach production and how is that bounded, where do secrets live and how do they rotate, what proves every privileged operation is auditable, and how does the platform operate the abuse and rate-limit primitives in real-world incident response?* It is **operations on top of 01A's primitives**, not a redefinition of them.

06B owns the operational/proof wrapper for two Parent invariants outright (**INV-06-02** no server secret to client; **INV-06-07** every privileged operation is auditable) and supplies the body of two cross-doc gates listed in Doc 06A §19.B (the `no-server-secret-in-client` scanner and the privileged-op audit process). Per Parent §4 every capability statement names a proving mechanism with the §6.13 six-element implemented-definition; per Parent §5 every primitive body remains 01A/Doc 01/Doc 03/Doc 03C canonical and is referenced, never restated.

---

# **§2 — Scope and Boundary**

## **2.1 06B owns**

The secret-class inventory and per-platform binding (§4); the build-time secret-injection boundary that 06A wired and the body of the `ci/no-server-secret-in-client` scanner (§5); the **operational** wrapper of HMAC service auth — rotation runbook shape and ownership and scheduling, key-revoke runbook, the rotation-proof artifact (§6); production-access and break-glass governance (§7); the privileged-op audit *process* and `ops/privileged-op-audit-coverage` reconciliation (§8); the abuse-incident operations queue \+ the cross-tier-vocabulary alignment with Doc 03 Main §21.3 (§9); the **rate-limit operations** wrapper (configuration governance, manual override audit — body owned by 01A §39–§47) (§10); the Cloudflare-Access enforcement of 01A §69 (§11).

## **2.2 06B explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| HMAC signing convention (3 headers \+ signing string) | 01A §62 |
| HMAC verification (timing-safe `crypto.timingSafeEqual`) | 01A §63 |
| `service_auth_secrets` table schema \+ governance | 01A §64 |
| Rotation cadence (90-day default) \+ 14-day overlap procedure | 01A §65 |
| Replay tolerance (5-minute default, configurable) | 01A §66 |
| 401 failure-response shape | 01A §67 |
| Service-pair registry (`§68 Consumed by`) | 01A §68 |
| Internal-endpoint non-exposure rule (`/api/internal/*`) | 01A §69 |
| Reference implementation | 01A §70 \+ Appendix C §C.4 |
| Internal-service-auth deviation \+ migration | 01A §71 → Doc 01.2 |
| Abuse tier boundaries (clean / flagged / concerning / high\_risk / critical) | 01A §50 |
| Abuse interface (`getScore`, `recordIncident`, `adjustScore`) | 01A §51 |
| Incident taxonomy (12 types, base scores) | 01A §52 |
| Scoring formula \+ accumulators | 01A §53 |
| Recompute cadence | 01A §54 |
| Abuse ledger schema (`abuse_score_incidents`) | 01A §55 |
| Manual override and appeal | 01A §56, §58 |
| Student-visibility \= none | 01A §57 |
| 429 response shape \+ Retry-After | 01A §44 |
| Rate-limit ledger storage \+ atomic RPC | 01A §39–§41 |
| Rate-limit rollback pattern | 01A §45 |
| `RateLimitLedger` SLO budgets | 01A §74A |
| Service-role write discipline \+ audit-emission rule | Doc 01 V6 §3.1.4 / §3.2 |
| Admin auth (`is_admin_jwt()`) | Doc 01 V6 §4.1 |
| Support-mediated role-switch process | Doc 01 V6 §6 |
| Support-access audit (V8 slice) | **Doc 01 V8 §44 — FWD-06-02** |
| LISA safety-review queue (tutor-class incidents) | Doc 03 Main §21.3 |
| LISA $/user cost cap & alerts (for cost-driven incidents) | Doc 03 Main §24 (06E) |
| Vertex/Cloud Run IAM, network, secret isolation (LISA tier) | Doc 03C §12 |
| LISA emergency revoke | Doc 03C §9.4 |
| Deletion / constants-governance audit substrate | Doc 05D §10, §11, admin-RLS |
| Scoring/mastery audit substrates | Doc 04B / Doc 05A `mastery_event_audit_log` / Doc 05B `mastery_domain_refresh_audit_log` |

## **2.3 03C boundary (watch-item, propagated from 06A)**

Anything LISA-tier — Cloud Run secret injection, Vertex IAM, GCP project-level IAM, LISA emergency revoke — is **Doc 03C V3.0 canonical** and is referenced by exact § only. 06B owns the *cross-platform* wrapper (per-platform binding map, runbook shape, who pages) and does not state a Cloud Run command, an IAM binding string, or a Vertex scope (`DD-06-REDEF` defect; §20 03C-boundary pass).

## **2.4 Inheritance**

06B inherits Doc 00, Parent §11.3 (production-data definition — secrets inside production data are also secrets), Parent §6.13 (named ≠ implemented), 06A §10.5 (Standard Proof Artifact Envelope — every 06B proof artifact conforms), and 06A §18.1 V1 binding (Vercel BFF/API \+ separate worker host).

---

# **§3 — Threat Model (Operational)**

Operational-security threats this document addresses (the primitive bodies in 01A defend against the cryptographic threats; 06B addresses the human/operational ones):

1. **Long-lived secret leakage** — a production secret committed to repo, shipped in a client bundle, or printed in a log persists past the incident. *Defense:* §4 secret-class inventory \+ §5 build-time scanner \+ 01A §14 redaction (referenced) \+ §6 rotation cadence with proof artifact.  
2. **Stale HMAC keys** — 01A §65 specifies the rotation procedure but is silent on *who runs it*; without a named owner and a scheduled drill, rotation drifts past the 90-day cadence. *Defense:* §6 rotation runbook \+ scheduled rotation-drill proof.  
3. **Standing privileged access** — long-lived admin tokens are the highest blast radius. *Defense:* §7 break-glass JIT model \+ dual-approval \+ auto-expiry \+ INV-06-07 audit.  
4. **Unaudited privileged operation** — a service-role write, support action, admin RLS bypass, or break-glass session that lacks an audit row. *Defense:* §8 `ops/privileged-op-audit-coverage` reconciliation against 01A §5 \+ Doc 05D admin-RLS \+ Doc 01 V6 §3.2 \+ V8 §44 (FWD).  
5. **Internal endpoint leakage** — a `/api/internal/*` route reachable from the public internet. *Defense:* 01A §69 (referenced) \+ §11 Cloudflare-Access enforcement \+ verification job.  
6. **Abuse-incident operational lag** — 01A §53 scores the incident, but if no one triages within the SLA, scoring without operations is theatre. *Defense:* §9 two-queue model aligned to Doc 03 §21.3 \+ §58 (referenced).  
7. **Rate-limit config drift** — 01A §39–§47 owns the body; 06B owns the operational governance of `*_runtime_config` changes (especially abuse-multiplier overrides) so a config change cannot silently weaken the limiter. *Defense:* §10 rate-limit config-change audit.

Threats explicitly *not* addressed here (and where they are addressed):

* Cryptographic forgery of an HMAC signature — 01A §62/§63 (timing-safe verify).  
* Replay attacks — 01A §66 (5-minute timestamp window).  
* DDoS / volumetric — Cloudflare WAF (06A §4 leverage, defense-in-depth) \+ 01A §39–§47 (canonical limiter); 06B owns neither body.  
* Identity/authentication of *users* — Doc 01\.

---

# **§4 — Secret-Class Inventory & Per-Platform Binding (Q-06B-1 \= a)**

## **4.1 Locked V1 binding**

Each secret class lives in the platform's native secret store; 01A §64 owns `service_auth_secrets` for HMAC; LISA stays Doc 03C-canonical. No cross-platform runtime fetches on the startup critical path.

| Secret class | Examples | Store binding (V1) | Canonical owner |
| ----- | ----- | ----- | ----- |
| **HMAC service-pair secrets** | Per-pair `service_auth_secrets.secret_material` | **`service_auth_secrets` table (Postgres)** | **01A §64** (referenced, not restated) |
| **Vercel BFF/API runtime secrets** | Supabase service-role key (when needed server-side), Stripe API key, Sentry DSN (server), third-party API tokens | **Vercel environment variables**, environment-scoped (`production` / `staging` / `development`) | 06B §4 — V1 binding |
| **Worker-host runtime secrets** | DB connection string, queue credentials, HMAC bootstrap | **Worker host's native secret mechanism** (binding deferred — §17 W2; the *separation invariant* holds today: workers never share the BFF runtime) | 06B §4 — V1 binding (specific platform binding \= Tier-2 additive) |
| **LISA-tier secrets** | Vertex credentials, Cloud Run service-account keys, Gemini API access | **GCP Secret Manager** (per LISA tier) | **Doc 03C §12.2** (referenced, not restated) |
| **Client/public-safe values** | Supabase anon key, Sentry DSN (client), Clarity project id | **`NEXT_PUBLIC_*` prefixed Vercel env vars** | 06B §4 — V1 binding |
| **Build-time-only secrets** | CI deploy tokens (where used; OIDC keyless is preferred per 06A §9.2) | **GitHub Actions secrets** | 06B §4 — V1 binding |
| **Database PITR / restore credentials** | Supabase API token for restore drills | **Supabase project-level secrets** | 06D (referenced for `ops/restore-test`; not 06B) |

## **4.2 Inventory registry — `infra/secret-class-inventory.yaml`**

secret\_classes:  
  \- id: \<stable id\>  
    description: \<short\>  
    store: \[service\_auth\_secrets\_table | vercel\_env | worker\_host\_native | gcp\_secret\_manager | github\_actions | next\_public\]  
    environment\_scope: \[production | staging | development | all\]  
    canonical\_owner: \<owning doc/§ for the secret's existence and rotation rule\>  
    rotation\_owner: \<06B role responsible for rotation operations\>  
    last\_rotated\_at: \<iso8601 | null\>

## **4.3 Hard rules (operational invariants)**

1. **HMAC service-pair secrets are stored only in `service_auth_secrets` and are never copied into env vars, Vault, source code, logs, build artifacts, or any backup outside that table's governed storage** (01A §64 single-writer governance). Runtime signing/verification code may retrieve the active secret only through the 01A-authorized service-auth path (01A §63 / §70 reference implementation), held in the request context only, never logged, never persisted outside that scope. Storage and controlled retrieval are distinguished; replication of the secret material outside `service_auth_secrets` is the prohibited operation, not the canonical read.  
2. **No `service_role` secret in any Vercel build output, any client bundle, any preview-env runtime, or any worker beyond the user-facing BFF separation** (INV-06-02). Enforced by §5 scanner \+ 01A §69 internal-endpoint segregation.  
3. **No `NEXT_PUBLIC_*` variable contains a server-privileged secret** (the `NEXT_PUBLIC_` prefix is *by design* shipped to clients; the inventory's `store: next_public` row classifies it as such and the §5 scanner asserts no privileged secret is so prefixed).  
4. **Cross-platform secret reads forbidden on the startup critical path** — Vercel does not fetch from GCP Secret Manager at cold start, and vice versa. Cross-platform reads are operational-only (rotation tooling, ops runbooks).  
5. **Secret content classification** is fail-closed — any secret with an unclassified or unowned binding fails the §4.4 proving mechanism.

## **4.4 Proving mechanism — `ci/secret-class-inventory-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching env config / secret tooling, \+ nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/secret-class-inventory.yaml` \+ the deployed env-var name sets (Vercel API per tier) \+ `service_auth_secrets` row count \+ `NEXT_PUBLIC_*` env-var list \+ Doc 03C §12.2 LISA secret-manager binding (presence only, never contents) |
| Failure condition | Deployed secret-named env var absent from inventory; inventory entry without a canonical owner or rotation owner; a privileged-secret name found under `NEXT_PUBLIC_*`; a deployed secret whose `store` does not match its binding; LISA-tier secret content read by 06B (boundary violation) |
| Proof artifact | `secret-class-inventory-parity` record conforming to 06A §10.5 envelope \+ extras: `observed_env_var_names_per_tier[]`, `next_public_violations[]`, `unclassified_secrets[]`, `lisa_tier_binding_present: bool` |
| Owner / paging | Platform/CTO; per 01A §18 |

## **4.5 Supabase service-role key — operational boundary (RB-06B-V1-06)**

The Supabase service-role key bypasses RLS (Doc 01 V6 §3.1.4 / §3.2 — referenced). 06B states the operational rule that synthesizes Doc 00, 01A §69, and 06A §14's constraints into a single boundary:

**The service-role key may exist only in server-only runtime scope and may be used only behind code paths that have already performed server-authenticated ownership / entitlement checks per Doc 01 V6 §3.1.4 (referenced).**

Specifically prohibited:

1. Any client component or browser bundle (enforced by §5 `ci/no-server-secret-in-client`).  
2. Any `vercel_preview_ephemeral` runtime (preview-env secret-scope is `development` per 06A §7; service-role key never bound to development scope).  
3. Untrusted edge middleware (any Vercel Edge runtime that runs before server-auth resolution).  
4. Worker host runtime unless that worker operates in server-only scope with the same entitlement-check discipline.  
5. Logging, breadcrumbs, error reports, metrics tags, or any observability payload (01A §14 PII-redaction class — referenced).  
6. Any non-canonical writer (per Doc 01 V6 §3.1.4 — service-role writes go through canonical writer modules).

Enforced by `ci/secret-class-inventory-parity` (§4.4) \+ `ci/no-server-secret-in-client` (§5) \+ the §10 release-gate manifest entry. **This is a 06B-owned synthesis of operational constraints; the underlying authorization rule remains Doc 01 V6 §3.1.4 canonical.**

## **4.6 `NEXT_PUBLIC_*` discipline (RB-06B-V1-12)**

`NEXT_PUBLIC_*` values are **public configuration, not secrets** — but public configuration is not ungoverned. Every `NEXT_PUBLIC_*` env var:

1. Has an inventory entry in `infra/secret-class-inventory.yaml` with `store: next_public` (per §4.2).  
2. Has a named `canonical_owner` and a stated public-safety classification rationale.  
3. May not carry sensitive endpoint URLs (internal hostnames, admin endpoints), tenant identifiers, or feature-flag data **unless explicitly classified as public** in the inventory entry.

Enforced by `ci/secret-class-inventory-parity` (§4.4) — an undocumented `NEXT_PUBLIC_*` variable fails the parity check.

---

# **§5 — `ci/no-server-secret-in-client` Scanner Body (Cross-Doc Gate Body)**

## **5.1 Scope**

This is the **06B-owned body** of the gate that 06A §19.B-10 references as a gate-entry. INV-06-02 is the rule (Parent); 06B specifies the scanner.

## **5.2 What it asserts**

1. No file emitted into the Vercel client bundle (Next.js `_next/static/**` \+ any client-targeted JS chunk) contains a string matching the inventory's privileged-secret name patterns (the patterns are themselves an input registry — names, not contents).  
2. No environment variable prefixed `NEXT_PUBLIC_*` matches any inventory entry whose `store ≠ next_public`.  
3. No source file under `apps/web/**` references a privileged-secret env name from a non-server-only path (a static scan against the coding-standards monorepo layout).  
4. Build-output secret detection uses **patterns \+ entropy heuristics**, both with named, owned rules (see §5.4). High-entropy literal strings flagged for human triage; named-pattern matches block the build.

## **5.3 Proving mechanism — `ci/no-server-secret-in-client` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, post-build step (after `pnpm -s run build`); also a §10-manifest release gate entry |
| Trigger cadence | Per PR \+ per deploy |
| Input registry | The §5.4 named-pattern set \+ the inventory's privileged-secret name list (from §4.2) \+ the build output (`apps/web/.next/**`) \+ the source tree (`apps/web/**`) |
| Failure condition | Any named-pattern match in build output; any `NEXT_PUBLIC_*` collision; any high-entropy literal exceeding the entropy threshold without an allow-list entry; a privileged-secret env name read from a client-only module |
| Proof artifact | `no-server-secret-in-client` record conforming to 06A §10.5 envelope \+ extras per §5.5 |
| Owner / paging | Platform/CTO; release blocked on fail; per 01A §18 |

## **5.4 Named-pattern registry**

The scanner does not rely on string literals scattered in code. The patterns are a 06B-owned registry:

patterns:  
  \- id: supabase\_service\_role\_jwt\_raw  
    pattern: 'eyJ\[A-Za-z0-9\_-\]{8,}\\\\.\[A-Za-z0-9\_-\]{8,}\\\\.\[A-Za-z0-9\_-\]{8,}'   \# raw JWT shape (header.payload.signature) — pre-filter  
    severity: high                                                              \# cheap pre-filter; decode pass confirms  
    notes: 'Pre-filter for JWT-looking tokens. Real classification requires JWT-decode pass (see scanner\_modes).'  
  \- id: stripe\_secret\_key  
    pattern: 'sk\_(live|test)\_\[A-Za-z0-9\]{20,}'  
    severity: blocker  
  \- id: google\_service\_account\_private\_key  
    pattern: '-----BEGIN PRIVATE KEY-----'  
    severity: blocker  
  \- id: aws\_access\_key\_id  
    pattern: 'AKIA\[0-9A-Z\]{16}'  
    severity: blocker  
  \- id: hmac\_service\_pair\_secret\_shape  
    pattern: '\[A-Za-z0-9+/\]{43}=$'                     \# 32-byte base64 length  
    severity: heuristic                                \# RB-06B-V1-11: downgraded; not blocking on its own  
    blocks\_only\_when\_correlated\_with:                   \# blocking only when correlated:  
      \- pattern\_id\_match: \['supabase\_service\_role\_jwt\_raw','stripe\_secret\_key','aws\_access\_key\_id'\]  
      \- entropy\_context\_above\_threshold: true  
      \- secret\_name\_pattern\_nearby: \['HMAC\_SECRET','SERVICE\_AUTH\_SECRET','SECRET\_MATERIAL'\]  
    notes: 'A 32-byte base64 literal alone is too common; allowlist-friendly. Blocks only when correlated with a named pattern, high entropy in same window, or a secret-name context.'  
scanner\_modes:  
  jwt\_decode:                                          \# RB-06B-V1-10  
    triggered\_by: supabase\_service\_role\_jwt\_raw  
    action: 'base64url-decode header \+ payload; assert payload.role \!= "service\_role" AND payload.aud not in privileged\_audiences'  
    severity\_on\_match: blocker  
    notes: 'Raw regex alone cannot reliably match encoded JWT payloads — encoded role claim may not appear as literal "role":"service\_role". Decode the JWT payload and inspect structurally. Privileged audiences are inventoried in scanner\_modes.jwt\_decode.privileged\_audiences (governed under §5.4.1 allowlist discipline).'  
entropy\_thresholds:  
  shannon\_min\_bits\_per\_char: 4.5  
  min\_length: 32

### **5.4.1 Allowlist governance (RB-06B-V1-05)**

Scanner findings may be suppressed only via a governed allowlist. **Blanket directory or file-glob allowlists are forbidden** — every entry references a specific match.

scanner\_allowlist:  
  \- allowlist\_id: \<stable id; format: 'AL-NNNN'\>  
    pattern\_id: \<pattern matched, or 'entropy\_heuristic'\>  
    file: \<exact path\>  
    match\_locator: \<byte\_offset+length OR sha256 of the matched literal\>  
    reason: \<why this is safe; e.g. 'public fixture for component testing'\>  
    owner: \<CODEOWNERS-resolved\>  
    reviewer: \<distinct from owner\>  
    linked\_ticket: \<issue tracker reference\>  
    granted\_at: \<iso8601\>  
    expires\_at: \<iso8601; MAX 90 days from granted\_at\>

Hard rules:

* `expires_at` REQUIRED; max 90 days from `granted_at`. Expired allowlists fail `ci/no-server-secret-in-client`.  
* `reviewer ≠ owner` (no self-approval).  
* `match_locator` MUST be exact (byte offset+length or content hash) — never a path glob, never a directory wildcard.  
* Allowlist file lives in version control at `infra/scanner-allowlist.yaml`; the file's hash is included in the §5.5 envelope artifact.  
* Adding or modifying an allowlist entry emits a config-history row per 01A §5 (referenced).

GitHub secret-scanning push protection (06A §4 leverage) is enabled as a **complementary** pre-merge guard; `ci/no-server-secret-in-client` is the post-build gate that catches anything secret-scanning misses (build artifacts, transformed code, dynamic injection).

## **5.5 Per-mechanism envelope extras (06A §10.5.1)**

scanner\_version: \<semver\>  
patterns\_registry\_hash: \<sha256 of §5.4 registry at execution\>  
build\_output\_scanned\_paths\[\]:  
matches\[\]:  
  \- { pattern\_id, file, byte\_offset, severity, decision: blocker|warn|allowlisted, allowlist\_ref }  
next\_public\_violations\[\]:  
  \- { env\_var, inventory\_entry\_id, store\_declared }  
entropy\_hits\[\]:  
  \- { file, byte\_offset, length, shannon\_bits\_per\_char, decision }

---

# **§6 — HMAC Service-Auth Rotation Operations**

## **6.1 Scope**

01A §65 owns the rotation procedure (90-day cadence, 14-day overlap, single canonical algorithm). 06B owns: **who runs it, when it is scheduled, what proof the rotation produces, and what runbook governs an HMAC-related failure**. The cryptographic body is not 06B's.

## **6.2 Rotation governance**

* **Rotation owner:** Platform/CTO role (CODEOWNERS-resolved); secondary on rotation-pager schedule.  
* **Cadence:** per 01A §65 (referenced; 90-day default, configurable in `internal_service_auth_runtime_config`); 06B does **not** restate the number — it asserts the rotation event MUST occur within `1.0 × cadence` of the previous rotation timestamp.  
* **Pre-rotation:** the §6.4 proving job runs every 7 days and emits a `WARN` when any pair's `last_rotated_at` is within 21 days of the cadence boundary; emits a `PAGE` when overdue.  
* **Rotation execution:** by the runbook owner, following the runbook shape in §6.5, against the 01A §65 procedure. Body lives in `docs/runbooks/hmac-rotation.md` (Doc 01.2 owns the migration-class body; 06B owns the *operational* shape).  
* **Post-rotation:** within 24h of the new secret going active, the 14-day overlap window is confirmed (both secrets in `service_auth_secrets` with non-null `active_until`); within 14+7 days the old secret's `revoked_at` is set per 01A §65.

## **6.3 Emergency revoke**

If a service-pair secret is suspected leaked: the runbook owner sets `revoked_at = now()` on the affected row in `service_auth_secrets` (per 01A §64 single-writer governance — only admin/ops tooling writes) and a new rotation is started immediately. **No 14-day overlap** in revoke (the overlap exists to prevent outage on planned rotation, not to extend a known-compromised secret). The LISA tier emergency revoke is **Doc 03C §9.4** canonical (referenced; the LISA cron-to-API service pair revokes via §9.4, not via 06B-direct DB manipulation).

## **6.4 Proving mechanism — `ops/hmac-rotation-currency` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled job (executor candidate: Vercel Cron — 06A §4 leverage) reconciling against `service_auth_secrets` |
| Trigger cadence | Every 7 days; ad-hoc on rotation event |
| Input registry | `service_auth_secrets` row set per service pair \+ `internal_service_auth_runtime_config.rotation_cadence_days` (read; reference to 01A §65, not restate) \+ §68 service-pair registry (01A) |
| Failure condition | Any `(caller_service, callee_service)` pair from 01A §68 absent from the table; any pair whose latest non-revoked `created_at` is older than `1.0 × cadence`; any pair with overlapping active secrets older than 21 days (overlap window not closed) |
| Proof artifact | `hmac-rotation-currency` record conforming to 06A §10.5 \+ extras: `pairs_checked[]`, per-pair \`{last\_rotated\_at, days\_since\_rotation, cadence\_days\_referenced, status: ok |
| Owner / paging | Platform/CTO; `WARN` to email/Slack, `PAGE` per 01A §18 on overdue |

## **6.5 Rotation runbook required shape (Parent §12.2)**

Stable id `hmac-rotation`; trigger (scheduled cadence or emergency); pre-conditions (acknowledged ownership of all affected service-pairs from 01A §68); the procedure references **01A §65.1 steps 1–6 verbatim by section** and does not repeat them; the executable-proof acceptance criterion (`ops/hmac-rotation-currency` reports `ok` for the rotated pair within 24h, *and* a synthetic signed request from the rotated caller verifies against the new secret in staging — **the synthetic harness uses a staging-only service pair registered in 01A §68 explicitly for verification purposes; production service-pair secrets are never used in test harnesses, never read outside the production runtime path** — RB-06B-V1-01); owner; 01A §18 paging.

---

# **§7 — Production Access & Break-Glass (Q-06B-2 \= a)**

## **7.1 Steady-state access model**

Steady-state production access uses Doc 01 V6 §4.1 (`is_admin_jwt()`) for admin role evaluation and Doc 01 V6 §3.1.4 / §3.2 for service-role write discipline (referenced, not restated). 06B owns: how that access is *granted, scoped, time-bounded, and audited* in the operational layer.

| Access class | Mechanism | Time bound | 06B obligation |
| ----- | ----- | ----- | ----- |
| Engineering production runtime read | Read-only Supabase project access (per-environment scope, §6.2 06A matrix) | Steady-state | Tracked in §7.5 inventory |
| Service-role write (canonical writers) | Per Doc 01 V6 §3.1.4 — application-layer authorization before write | Per request | Audit emission per Doc 01 V6 §3.2 (referenced) |
| Admin operational action | `is_admin_jwt()` \+ admin UI | Steady-state for the admin role; ops actions audited | INV-06-07; §8 |
| Break-glass (emergency elevation) | §7.2 model — JIT, dual-approval, time-bounded, audited | **Strictly ≤ 1 hour, auto-expiry** | This section |

## **7.2 Break-glass model (locked)**

**Q-06B-2 \= a:** time-bounded JIT elevation via the existing admin role, dual-approval, session ≤ 1 hour with auto-expiry, every action audited. **No new role is introduced.**

1. **Trigger:** an incident requiring direct intervention beyond steady-state admin scope (e.g. an FK-ordered deletion cascade per Doc 05D §10 failed mid-way and requires a DB-direct repair; a service-pair HMAC secret suspected leaked).

**Request:** the requesting operator opens a break-glass request specifying (a) the incident reference, (b) the bounded scope (table set / row set / specific RPC), (c) the requested duration ≤ 1 hour, (d) the justification, and (e) a **machine-readable `allowed_actions` manifest** (RB-06B-V1-04):  
 allowed\_actions:  \- action\_type: \<stable id, e.g. 'update\_row' | 'delete\_row' | 'invoke\_rpc'\>    target\_table: \<table name\>    target\_row\_pk\_pattern: \<exact pk value | glob/regex pattern\>    rpc\_name: \<if action\_type \= invoke\_rpc\>

2. The `allowed_actions` manifest is stored on `privileged_sessions.allowed_actions_ref` (§8.3) at session activation; per-action entries in `privileged_session_actions` are checked against it at write time and at the §7.7 post-session review.  
3. **Dual approval:** the request is approved by **two distinct roles** — founder OR ops-lead, AND a second authorized approver from the same set. Self-approval forbidden. Mirrors the Doc 03 Main §21.3 founder/ops-lead \+ backup pattern operationally.  
4. **Grant:** on dual-approval, the admin session is activated with the bounded scope; session start emits an audit row (see §8); auto-expiry timer starts.  
5. **Scope:** the elevation **uses the existing `admin` role** under Doc 01 V6 §4.1; no new role is created (no role-enum divergence). Bounding is enforced operationally (review queue, audit) rather than by a separate Postgres role; this is honest about the V1 limitation and avoids fragmenting the role surface.  
6. **Auto-expiry:** at the requested duration ≤ 1 hour, the session is terminated regardless of activity; an extension requires a *new* dual-approved request (not a renewal).  
7. **Post-session review (§7.7):** within 24h, every action emitted under the break-glass session id is reviewed against the request's machine-readable `allowed_actions` manifest; **an out-of-scope action is recorded as `review_status = 'out_of_scope'` on its `privileged_session_actions` row and raises a `PAGE`\-severity finding** (RB-06B-V1-04 — not a generic "security finding"; the §13 runbook `break-glass-post-session-review` executes the escalation).

## **7.3 V1 limitation, V1.1 hardening hook (acknowledged honestly)**

V1's bounding is operational (review \+ audit \+ auto-expiry), not Postgres-role-enforced — the admin role retains its full SQL-level capability for the duration. V1.1 hook: a separate `break_glass` Postgres role with column-level / RLS-level constraint enforcement (Q-06B-2 option (b) deferred). This is registered in §17 W4 and is **not** a 06B-V1 blocker because the operational controls \+ the §8 audit \+ the 1-hour ceiling materially reduce blast radius, and a fragmented role surface in V1 would have its own security cost.

## **7.4 Standing-admin-access minimization**

Operational rule: any non-incident admin operation that can be performed via a CODEOWNERS-gated PR (config change, runbook edit, manifest update) MUST be performed that way — NOT via a steady-state admin session. This is asserted by §7.5's standing-access inventory drift check: a sustained increase in steady-state admin sessions without a matching incident-volume increase fails the §7.6 proving mechanism.

## **7.5 Access inventory — `infra/prod-access-inventory.yaml`**

standing\_access:  
  \- principal: \<role or named operator\>  
    access\_class: \[supabase\_read | admin\_role | service\_role\_write\_path | break\_glass\_authorized\_approver\]  
    scope: \<bounded description\>  
    justification: \<one-line\>  
    granted\_at: \<iso8601\>  
    last\_reviewed\_at: \<iso8601\>  
break\_glass:  
  policy:  
    max\_session\_minutes: 60                \# 06B-owned bound (§7.2)  
    dual\_approval\_required: true  
    self\_approval\_forbidden: true  
    auto\_expiry: true  
    extension\_requires\_new\_request: true  
  authorized\_approvers: \[\<role list — founder, ops-lead, …\>\]

## **7.6 Proving mechanism — `ops/prod-access-governance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (executor candidate: Vercel Cron) |
| Trigger cadence | Daily |
| Input registry | `infra/prod-access-inventory.yaml` \+ the deployed admin-role member set (from Doc 01 V6 `is_admin_jwt()` evaluation) \+ break-glass session history (from §8 audit substrate) |
| Failure condition | An admin principal not in `standing_access`; a break-glass session exceeding 60 minutes (auto-expiry failure); a single-approver break-glass grant; an authorized-approver self-approval; a `last_reviewed_at` older than 90 days; **any `privileged_session_actions` row with `review_status = 'out_of_scope'` against its session's `allowed_actions` manifest (PAGE severity per 01A §18 — RB-06B-V1-04)** |
| Proof artifact | `prod-access-governance` record per 06A §10.5 \+ extras: `standing_access_observed[]`, `break_glass_sessions_period[]`, per-session `{session_id, approver_a, approver_b, requested_minutes, actual_minutes, scope_review_status}` |
| Owner / paging | Founder \+ ops-lead; per 01A §18 |

---

# **§8 — Privileged-Op Audit Process (INV-06-07)**

## **8.1 Coverage rule**

INV-06-07 is satisfied when **every privileged operation in the platform emits a durable audit record**. The audit *substrates* are canonical-owned; 06B owns the *coverage reconciliation* that proves no privileged operation slips through the substrate net.

## **8.2 Canonical privileged-op substrates (referenced, never restated)**

| Privileged-op class | Audit substrate (canonical) |
| ----- | ----- |
| Service-role writes (`profile-service.ts`, `mastery-write.ts`, `ensure_account_for_user`, etc.) | Doc 01 V6 §3.2 audit-emission rule |
| Admin operations under `is_admin_jwt()` | Doc 01 V6 §4.1 \+ admin-UI audit (steady-state) |
| Support-mediated operations (V8 §44 slice) | **Doc 01 V8 §44 — FWD-06-02** (V8-gated; V6 surface is steady-state admin) |
| Config changes | 01A §5 config-history |
| Abuse-score `adjustScore` (manual override) | 01A §55 `abuse_score_incidents` \+ 01A §56 audit |
| Account/data deletion cascade | Doc 05D §10 cascade audit \+ admin-RLS |
| HMAC secret rotation/revoke | 06B §6 rotation-proof artifact (this doc) |
| Break-glass session activation/expiry | 06B §7 \+ this section's audit substrate |
| Queue/outbox replay (privileged) | Doc 06A §12.2 `replay_actor` \+ this section |

## **8.3 06B-owned: relational privileged-session \+ privileged-action audit tables (RB-06B-V1-02)**

Two relational tables enable per-action reconciliation, indexing, retention, and unambiguous coverage proofs (an embedded array would defeat §8.4's row-for-row reconciliation). Both tables are single-writer per Doc 01 V6 §3.1.4 discipline (referenced); admin SELECT via explicit RLS per Doc 05D RB-05D-V1-08 (referenced pattern).

CREATE TABLE privileged\_sessions (  
  session\_id           uuid PRIMARY KEY,  
  actor\_user\_id        uuid NOT NULL REFERENCES profiles(id),  
  session\_class        text NOT NULL,           \-- 'break\_glass' | 'standing\_admin\_write'  
  approver\_a\_user\_id   uuid REFERENCES profiles(id),       \-- break-glass only  
  approver\_b\_user\_id   uuid REFERENCES profiles(id),       \-- break-glass only  
  requested\_scope      text NOT NULL,  
  allowed\_actions\_ref  text,                    \-- pointer to machine-readable scope (§7.2 / RB-06B-V1-04)  
  started\_at           timestamptz NOT NULL,  
  expires\_at           timestamptz NOT NULL,  
  ended\_at             timestamptz,  
  ended\_by             text,                    \-- 'auto\_expiry' | 'manual' | 'system\_termination'  
  incident\_ref         text,                    \-- break-glass only  
  CHECK (session\_class IN ('break\_glass','standing\_admin\_write')),  
  CHECK (session\_class \<\> 'break\_glass'  
         OR (approver\_a\_user\_id IS NOT NULL  
             AND approver\_b\_user\_id IS NOT NULL  
             AND approver\_a\_user\_id \<\> approver\_b\_user\_id))   \-- dual-approval \+ no self-approval  
);  
CREATE INDEX idx\_privileged\_sessions\_actor ON privileged\_sessions (actor\_user\_id, started\_at DESC);  
CREATE INDEX idx\_privileged\_sessions\_open  ON privileged\_sessions (expires\_at) WHERE ended\_at IS NULL;

CREATE TABLE privileged\_session\_actions (  
  id                   uuid PRIMARY KEY,  
  session\_id           uuid NOT NULL REFERENCES privileged\_sessions(session\_id),  
  ts                   timestamptz NOT NULL,  
  action\_type          text NOT NULL,  
  target\_table         text,  
  target\_row\_pk        text,  
  payload\_redacted     jsonb NOT NULL,          \-- 01A §14 redaction applied; raw payloads NEVER stored  
  review\_status        text,                    \-- 'in\_scope' | 'out\_of\_scope' | 'pending\_review'  
  CHECK (review\_status IN ('in\_scope','out\_of\_scope','pending\_review') OR review\_status IS NULL)  
);  
CREATE INDEX idx\_privileged\_session\_actions\_session ON privileged\_session\_actions (session\_id, ts);  
CREATE INDEX idx\_privileged\_session\_actions\_oos     ON privileged\_session\_actions (review\_status)  
  WHERE review\_status \= 'out\_of\_scope';

`payload_redacted` content respects 01A §14 PII redaction (referenced); raw payloads NEVER stored. The relational split means `ops/privileged-op-audit-coverage` (§8.4) reconciles **rows in `privileged_session_actions`** against the §8.6 expected-event sources — not an embedded array — so missing audit rows are unambiguously detectable.

## **8.4 Proving mechanism — `ops/privileged-op-audit-coverage` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job |
| Trigger cadence | Daily |
| Input registry | **`infra/privileged-op-source-registry.yaml` (§8.6)** — the per-substrate independent expected-event source, observed audit source, correlation key, and allowed lag — joined against each declared substrate's row count over the reconciliation window |
| Failure condition | For any substrate: observed audit-row count \< expected event count (joined by `correlation_key`, within `allowed_lag_seconds`) — an unaudited privileged op happened; a `privileged_sessions` row whose `expires_at` passed without `ended_at`; a `privileged_session_actions` row dated after its session's `expires_at`; a substrate without a configured expected-event source or correlation key in §8.6 (a control gap is itself a finding); a substrate whose expected-event source equals its observed audit source (cannot prove missing audit rows by self-comparison — RB-06B-V1-03) |
| Proof artifact | `privileged-op-audit-coverage` record per 06A §10.5 \+ extras: per-substrate `{substrate_id, canonical_owner, expected_event_source, observed_audit_source, correlation_key, expected_events, observed_audit_rows, coverage_ratio, lag_observed_max_seconds, finding}` |
| Owner / paging | Platform/CTO \+ compliance (06D); per 01A §18 |

## **8.5 V6/V8 boundary**

The V8 §44 support-access audit slice is FWD-06-02 (Doc 01 V8 pending). For the V6 surface, support-mediated actions audit through the steady-state admin path (Doc 01 V6 §4.1 \+ admin-UI audit). The reconciliation will gain the V8 §44 substrate on V8 provision; until then, support-mediated actions are counted under the standing-admin substrate. This matches the Parent §10 FWD-06-02 partial-gating of INV-06-07.

## **8.6 Privileged-op source registry (`infra/privileged-op-source-registry.yaml`) — RB-06B-V1-03**

Per Parent §6.13, the reconciliation's input registry must name an **independent expected-event source** for each substrate — comparing one audit log against itself cannot prove missing audit rows. The registry is a 06B-owned artifact:

privileged\_op\_sources:  
  \- substrate\_id: service\_role\_writes  
    canonical\_owner: Doc 01 V6 §3.1.4 / §3.2  
    expected\_event\_source: route\_middleware\_invocation\_log    \# independent of audit table  
    observed\_audit\_source: doc01\_service\_role\_audit\_table     \# the audited surface  
    correlation\_key: request\_id                                \# row-level join key  
    allowed\_lag\_seconds: 30  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: Doc 01

  \- substrate\_id: admin\_ui\_actions  
    canonical\_owner: Doc 01 V6 §4.1  
    expected\_event\_source: admin\_ui\_invocation\_log  
    observed\_audit\_source: admin\_action\_audit\_table  
    correlation\_key: admin\_action\_id  
    allowed\_lag\_seconds: 60  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: Doc 01

  \- substrate\_id: support\_mediated\_v8\_44  
    canonical\_owner: Doc 01 V8 §44                             \# FWD-06-02; registry slot reserved  
    expected\_event\_source: \<pending V8 provision\>  
    observed\_audit\_source: \<pending V8 provision\>  
    correlation\_key: \<pending V8 provision\>  
    allowed\_lag\_seconds: 60  
    failure\_condition: \<pending V8 provision\>  
    owner: Doc 01

  \- substrate\_id: config\_changes  
    canonical\_owner: 01A §5 config-history  
    expected\_event\_source: pr\_merged\_config\_diff               \# GitHub Actions emits per merge  
    observed\_audit\_source: 01A\_config\_history\_table  
    correlation\_key: change\_id  
    allowed\_lag\_seconds: 120  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 01A

  \- substrate\_id: abuse\_adjust\_score  
    canonical\_owner: 01A §56  
    expected\_event\_source: adjust\_score\_rpc\_invocation\_log  
    observed\_audit\_source: 01A\_abuse\_score\_incidents (§55) override rows  
    correlation\_key: incident\_id  
    allowed\_lag\_seconds: 30  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 01A

  \- substrate\_id: deletion\_cascade  
    canonical\_owner: Doc 05D §10 \+ admin-RLS  
    expected\_event\_source: deletion\_request\_table (intent layer)  
    observed\_audit\_source: Doc 05D §10 cascade audit  
    correlation\_key: deletion\_request\_id  
    allowed\_lag\_seconds: 300  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 05D

  \- substrate\_id: hmac\_secret\_rotation\_revoke  
    canonical\_owner: 06B §6 (this doc)  
    expected\_event\_source: hmac-rotation runbook invocation log (§13 runbook id 'hmac-rotation' / 'hmac-emergency-revoke')  
    observed\_audit\_source: service\_auth\_secrets row deltas \+ ops/hmac-rotation-currency artifact  
    correlation\_key: service\_pair\_id \+ rotation\_event\_id  
    allowed\_lag\_seconds: 86400                                  \# rotation events permitted up to 24h reconciliation lag  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 06B

  \- substrate\_id: break\_glass\_sessions  
    canonical\_owner: 06B §7  
    expected\_event\_source: break\_glass\_request\_table (intent layer; independent of audit)  
    observed\_audit\_source: privileged\_sessions \+ privileged\_session\_actions (§8.3)  
    correlation\_key: session\_id  
    allowed\_lag\_seconds: 30  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 06B

  \- substrate\_id: queue\_outbox\_replay  
    canonical\_owner: Doc 06A §12.2 (replay\_actor) \+ 06B §8  
    expected\_event\_source: replay\_invocation\_log per queue/outbox id  
    observed\_audit\_source: privileged\_session\_actions (action\_type \= 'queue\_replay') \+ per-queue replay audit (where defined by owning doc)  
    correlation\_key: replay\_event\_id  
    allowed\_lag\_seconds: 60  
    failure\_condition: observed\_count \< expected\_count after allowed\_lag  
    owner: 06B \+ queue owning doc

**Hard rule (RB-06B-V1-03):** `expected_event_source ≠ observed_audit_source` for every entry. If the only available expected-event source IS the audit table (a pure self-comparison would result), the substrate is flagged as a control gap by §8.4 — the registry slot remains, marked `expected_event_source: <intent-layer required>`, and the substrate's INV-06-07 coverage is recorded as partial-provable. This is the same partial-gating discipline Parent §10 / §18 applies to FWD-06-02.

---

# **§9 — Abuse-Incident Operations (Q-06B-3 \= a)**

## **9.1 Locked queue model**

01A §53 owns the scoring formula and §58 owns the V1 appeal process (24h response — referenced, not restated). Doc 03 Main §21.3 owns the LISA safety-review queue (founder/ops-lead \+ backup, 48h→24h SLA target — referenced, canonical). 06B does not redefine either.

**Two queues, one SLA vocabulary:**

1. **Tutor-class incidents** (01A §52 type `tutor_prompt_abuse`, plus any LISA-derived signal) → **Doc 03 Main §21.3 queue (canonical, unchanged)**. 06B does not own this queue.  
2. **All other 11 incident types from 01A §52** (`failed_login_burst`, `password_reset_spam`, `injection_attempt`, `retry_storm`, `quota_farming`, `content_scraping`, `account_sharing_signal`, `payment_dispute`, `guardian_link_spam`, `deletion_retry_abuse`, `role_switch_abuse`) → **06B-owned abuse-ops queue**, same shape, same SLA vocabulary as §21.3 (founder/ops-lead \+ backup, 48h→24h target aligned to 01A §58's 24h appeal-response).

06B does not modify §21.3's behavior — referencing it as the canonical tutor-class workflow; the 06B-owned queue mirrors its shape.

## **9.2 Queue ownership and routing**

* **Routing:** an incident's 01A §52 `incident_type` determines the queue. Routing is deterministic from the type — no human triage step decides which queue.  
* **Queue substrate (RB-06B-V1-08):** 06B requires **two canonical read surfaces** over `abuse_score_incidents` (01A §55, referenced) — one for the tutor-class queue (`tutor_prompt_abuse`), one for the non-tutor queue (the other 11 01A §52 types). Recommended naming pattern (exact names locked during implementation review, not in this spec): `v_tutor_abuse_review_queue` and `v_security_abuse_review_queue`. There is **no separate `abuse_ops_queue` table** — both surfaces are views over 01A §55, preventing dual-write divergence. Both views read from a single canonical row set; a separate queue table is a `DD-06-REDEF` defect.  
* **Triage actions** available to the queue operator:  
  * Confirm and let scoring stand (01A §53 result holds).  
  * **`adjustScore`** (01A §56 — referenced; canonical manual-override RPC). The adjustment is itself an audit-emitting privileged op (§8 coverage).  
  * Mark as false positive (records via `adjustScore` with `delta = -baseline` and reason).  
  * Escalate to Doc 06D compliance process (for incidents implicating compliance gates such as Doc 05D `BLOCKING_PRIVACY_GAP`).

## **9.3 SLA vocabulary alignment**

| Source | SLA | 06B treatment |
| ----- | ----- | ----- |
| Doc 03 Main §21.3 | 48h target → 24h V2 | Canonical for tutor-class; referenced |
| 01A §58 (appeal V1) | 24h response | Canonical for appeal-response surface; referenced |
| 06B-owned queue | 24h target (aligned to §58 \+ §21.3's V2 target) | Locked here |

All three use the same hour-vocabulary; 06B-V1 lands at 24h matching the §58 appeal-response cadence and the §21.3 V2 target.

## **9.4 Proving mechanism — `ops/abuse-queue-sla-conformance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job |
| Trigger cadence | Hourly during operational hours, daily aggregate |
| Input registry | 01A §55 `abuse_score_incidents` rows in the past 30 days, partitioned by `incident_type` (tutor vs non-tutor); the §21.3 queue completion records (read-only for tutor-class, referenced); the 06B-owned queue completion records (for non-tutor) |
| Failure condition | Non-tutor incident at tier ≥ `flagged` (per 01A §50) unprocessed past 24h; tutor-class incident processed in the 06B queue (routing error); routing decision not deterministic from `incident_type` |
| Proof artifact | `abuse-queue-sla-conformance` record per 06A §10.5 \+ extras: per-queue `{queue_id, tier_distribution, sla_breaches, oldest_unprocessed_age_hours, routing_errors_count}` |
| Owner / paging | Founder \+ ops-lead; per 01A §18 |

## **9.5 Cross-doc obligation note**

If Doc 03 §21.3 changes its SLA target (currently 48h→24h V2), the 06B-owned queue's SLA tracks it. 06B does not lead the change; it tracks the canonical owner. A divergence-on-purpose between the two queues would require a Tier-2 06B update with an explicit justification.

---

# **§10 — Rate-Limit Operations Wrapper**

## **10.1 Scope**

01A §39–§47 owns the rate-limit primitive body (storage §41, atomic RPC §40, AbuseScore multiplier §42, 80% soft warn §43, 429 hard limit §44, rollback §45). 06B owns: **operational governance of rate-limit configuration changes, manual override audit, and the operational alarms on limiter health (SLO breach per 01A §74A — referenced)**.

## **10.2 Config-change governance**

Rate-limit thresholds live in `rate_limit_runtime_config` (per 01A Part I config doctrine). 06B operational rule: any change to a rate-limit threshold or abuse-multiplier is:

1. **A CODEOWNERS-gated PR** to the config — not a runtime database update, not a steady-state admin action.  
2. **Emits a config-history row** per 01A §5 (referenced) with actor identity and justification.  
3. **Triggers a `ci/release-gates` evaluation** through the §10 manifest — config changes affecting rate-limit thresholds appear as `pre_deploy` blocking\_stage entries in the release-gate manifest (the manifest entry is 06A-owned; 06B-owned is the rule that rate-limit config changes route through it).

## **10.3 Manual override audit**

A direct (non-PR) write to `rate_limit_runtime_config` is treated as a privileged op and audited via §8. Repeat occurrences (e.g. ≥ 2 within 7 days) raise an operational finding — chronic out-of-band config edits indicate either a missing automation path or a governance breach; either way 06B-investigable.

## **10.4 Proving mechanism — `ops/rate-limit-config-governance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job |
| Trigger cadence | Daily |
| Input registry | `rate_limit_runtime_config` change-history (01A §5 substrate) \+ the PR/CODEOWNERS-merge log for the same period |
| Failure condition | A `rate_limit_runtime_config` change with no corresponding PR; a change without an actor identity; ≥ 2 manual-override changes within 7 days without an open ops investigation; an abuse-multiplier change that weakens a tier's multiplier below 01A §50's defaults without a registered compliance-gate artifact |
| Proof artifact | `rate-limit-config-governance` record per 06A §10.5 \+ extras: per-change \`{change\_id, actor, source: pr |
| Owner / paging | Platform/CTO; per 01A §18 |

---

# **§11 — Internal-Endpoint Non-Exposure (01A §69) Enforcement**

## **11.1 Scope**

01A §69 specifies the rule: `/api/internal/*` endpoints must not be publicly accessible; HMAC verification is the defense-in-depth, the reverse-proxy/ingress rule is the primary. 06B owns the **deployment-side enforcement and the verification proof**.

## **11.2 Enforcement substrate (V1 binding from 06A §4 leverage)**

* **Vercel BFF/API** routes prefixed `/api/internal/*` are placed behind **Cloudflare Access** (or equivalent platform-native ingress restriction); only authenticated service-pair callers reach them.  
* **LISA tier** internal endpoints (Cloud Run) are governed by **Doc 03C §12** (network isolation, ingress controls); 06B does not specify these — references §12 by exact §.  
* **Defense-in-depth:** even if the ingress restriction is bypassed (misconfiguration), 01A §63 HMAC verification still rejects the request with 01A §67's 401 response (both referenced).

## **11.3 Verification (not just configuration)**

Per Parent §6.13 a control is not proven by being configured; it is proven by being *exercised*. 06B specifies a **synthetic public-internet probe** that attempts to reach each `/api/internal/*` route from an external network and asserts the response is the ingress-restriction reject (3xx/4xx without the request reaching the application) — not the HMAC 401\.

If the probe receives a HMAC 401, that is a **finding** (ingress-restriction layer missed; defense-in-depth caught it; ingress must be fixed). If the probe receives a 200 or a route-application error, that is a **critical finding** (both layers failed).

## **11.4 Proving mechanism — `ops/internal-endpoint-exposure-probe` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled job from an external network egress point (a separately-hosted prober — not Vercel, not GCP) |
| Trigger cadence | Daily |
| Input registry | **`infra/route-surface-classification.yaml` (06A §5.3.1, extended per RB-06A-V1-11)** — single canonical route inventory; the probe joins on rows where `is_internal_api: true` AND `surface_class: internal`. Cross-checked against the §10 release-gate manifest entries that reference internal routes for inventory completeness |
| Failure condition | Any route returns 200 / route-application error (critical); any route returns HMAC 401 from the public internet (finding — ingress layer must be fixed); any inventory entry without an observed probe attempt |
| Proof artifact | `internal-endpoint-exposure-probe` record per 06A §10.5 \+ extras: per-route \`{route, probe\_result\_status, probe\_response\_class: ingress\_rejected |
| Owner / paging | Platform/CTO; `PAGE` per 01A §18 on critical |

---

# **§12 — Cloudflare Access as Enforcement Substrate**

06A §4 named Cloudflare Access as under-used leverage; 06B operationalizes it as the V1 enforcement substrate for §11.2 and as a defense-in-depth layer for admin UIs.

## **12.1 Coverage**

* All `/api/internal/*` routes on the Vercel BFF/API (V1 binding per 06A §18.1).  
* All admin-UI routes (defense-in-depth on top of Doc 01 V6 `is_admin_jwt()`).  
* Not the LISA tier (Doc 03C §12 owns; CF Access not in scope for GCP-tier routes).

## **12.2 Operational rule**

A new `/api/internal/*` route MUST be added to the Cloudflare Access policy in the **same PR** that introduces the route. This is enforced via `ci/internal-route-cf-access-parity`:

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, per PR touching `apps/api/**` |
| Trigger cadence | Per PR |
| Input registry | **`infra/route-surface-classification.yaml` (06A §5.3.1, extended per RB-06A-V1-11)** — the canonical route inventory, joined on `is_internal_api: true` AND `requires_cloudflare_access: true`. The deployed Cloudflare Access policy state is fetched via the CF Access API and compared against this canonical inventory. (No separate `infra/cloudflare-access-policies.yaml` mirror — the canonical route registry is the source of truth; the CF Access policy is downstream and must match.) |
| Failure condition | A declared internal route absent from the CF Access policy; a policy entry referencing a route that does not exist (stale rule); a non-internal route mistakenly covered (could break user-facing flow) |
| Proof artifact | `internal-route-cf-access-parity` record per 06A §10.5 \+ extras: `routes_in_code[]`, `routes_in_policy[]`, `mismatches[]` |
| Owner / paging | Platform/CTO; PR-blocking |

## **12.3 Backend-host cutover guard (RB-06B-V1-09)**

If the V1 BFF/API host changes under Doc 06A §18.1 Tier-2 update (e.g. Vercel serverless → dedicated Node host → other), the internal-endpoint ingress restriction **must move with the host** and `ci/internal-route-cf-access-parity` (§12.2) must be replaced or extended with the equivalent ingress check **before the host cutover deploys**. No backend-host cutover may weaken 01A §69 enforcement. Operationally: the Tier-2 06A update that changes the host MUST register a corresponding 06B Tier-2 update modifying §11.2 / §12 enforcement, and the §10 release-gate manifest must block the cutover deploy until the equivalent ingress-restriction proving mechanism is green in the new host's environment.

---

# **§13 — Runbook Required Shapes (Decision 3\)**

06B owns shape \+ inventory pointer for the following runbooks; bodies live in `docs/runbooks/` / Doc 01.2 (per Parent §12). Each runbook conforms to Parent §12.2 required-shape contract:

| Runbook id | Trigger | Owner | Executable-proof acceptance criterion |
| ----- | ----- | ----- | ----- |
| `hmac-rotation` | §6.2 cadence or §6.3 emergency | Platform/CTO | `ops/hmac-rotation-currency` `ok` for rotated pair within 24h \+ staging synthetic-request verification |
| `hmac-emergency-revoke` | §6.3 suspected leak | Platform/CTO | Affected pair's `revoked_at` set; new rotation in progress; `ops/hmac-rotation-currency` shows new active pair within 1h |
| `break-glass-grant` | §7.2 incident requiring elevation | Founder \+ ops-lead (dual) | `privileged_sessions` row created with both approvers (CHECK constraint enforces approver\_a ≠ approver\_b); session auto-expires per §7.5 policy |
| `break-glass-post-session-review` | §7.2 step 7, within 24h of session end | Founder OR ops-lead | All session actions reviewed; out-of-scope action rows in `privileged_session_actions` flagged with `review_status = 'out_of_scope'` and raise PAGE per §7.6 (RB-06B-V1-04) |
| `abuse-incident-triage` | §9 queue entry | Founder \+ ops-lead \+ backup | Action taken (confirm / `adjustScore` / false-positive / escalate); `ops/abuse-queue-sla-conformance` shows resolution within SLA |
| `internal-endpoint-misconfiguration` | §11.4 finding | Platform/CTO | Ingress restriction restored; probe re-runs `ingress_rejected`; root-cause logged |
| `secret-leak-suspected` | §5 scanner blocker or external report | Platform/CTO | Affected secrets rotated/revoked (§6.3 path); §5 scanner clean; impact assessment recorded |

LISA-tier runbook bodies (`lisa-emergency-revoke`, `vertex-credential-rotation`) are **Doc 03C-canonical / Doc 03C Operations Runbook V1 (pending; FWD)**; 06B does not own their shape or body.

---

# **§14 — Hard Invariants Owned/Championed by 06B**

Per Parent §6.13 each is **specified, not deploy-proven** until its proof artifact is implemented.

| Invariant | 06B section | Proving mechanism (06B-owned) | Status |
| ----- | ----- | ----- | ----- |
| INV-06-02 (no server secret to client) | §5 | `ci/no-server-secret-in-client` scanner body | Specified |
| INV-06-07 (every privileged op auditable) | §8 | `ops/privileged-op-audit-coverage` reconciliation | Specified; V8 §44 slice gated on FWD-06-02 |
| INV-06-01 (no deploy without gates) — *06A-owned, 06B contributes the §5 scanner gate body and the §10 rate-limit governance gate* | §5, §10 | Manifest entries `no-server-secret-in-client`, `rate-limit-config-governance` | Referenced |
| 06B-local proving mechanisms (self-governance) | §4, §6, §7, §9, §10, §11, §12 | `ci/secret-class-inventory-parity`, `ops/hmac-rotation-currency`, `ops/prod-access-governance`, `ops/abuse-queue-sla-conformance`, `ops/rate-limit-config-governance`, `ops/internal-endpoint-exposure-probe`, `ci/internal-route-cf-access-parity` | Specified |

06B introduces no new Parent-level invariants; it operationalizes INV-06-02 and INV-06-07 and contributes gate bodies into the §10 release-gate manifest.

---

# **§15 — Per-Mechanism Envelope Extras (06A §10.5.1 Extension)**

The 06A §10.5 envelope is canonical; this section extends the §10.5.1 per-mechanism extra-field matrix with 06B's mechanisms.

| Mechanism | Required extra fields |
| ----- | ----- |
| `ci/secret-class-inventory-parity` (§4.4) | `observed_env_var_names_per_tier[]`, `next_public_violations[]`, `unclassified_secrets[]`, `lisa_tier_binding_present` |
| `ci/no-server-secret-in-client` (§5.3) | `scanner_version`, `patterns_registry_hash`, `scanner_allowlist_hash` (§5.4.1), `build_output_scanned_paths[]`, `matches[]` (per-match: `pattern_id`, `file`, `byte_offset`, `severity`, `decision`, `allowlist_ref`, `expires_at_check`), `jwt_decode_results[]` (RB-06B-V1-10: per-token `{file, decoded_role, decoded_audience, decision}`), `next_public_violations[]`, `entropy_hits[]`, `correlated_blocks[]` (RB-06B-V1-11: cases where heuristic patterns were upgraded to blocker by correlation) |
| `ops/hmac-rotation-currency` (§6.4) | `pairs_checked[]`, per-pair `{last_rotated_at, days_since_rotation, cadence_days_referenced, status, overlap_status}` |
| `ops/prod-access-governance` (§7.6) | `standing_access_observed[]`, `break_glass_sessions_period[]`, per-session `{session_id, approver_a, approver_b, requested_minutes, actual_minutes, allowed_actions_ref, out_of_scope_action_count, scope_review_status}` (RB-06B-V1-04) |
| `ops/privileged-op-audit-coverage` (§8.4) | per-substrate `{substrate_id, canonical_owner, expected_event_source, observed_audit_source, correlation_key, expected_events, observed_audit_rows, coverage_ratio, lag_observed_max_seconds, finding}` (RB-06B-V1-03 — expected and observed sources are distinct and named) |
| `ops/abuse-queue-sla-conformance` (§9.4) | per-queue `{queue_id, tier_distribution, sla_breaches, oldest_unprocessed_age_hours, routing_errors_count}` |
| `ops/rate-limit-config-governance` (§10.4) | per-change `{change_id, actor, source, pr_ref, severity_assessment}` |
| `ops/internal-endpoint-exposure-probe` (§11.4) | per-route `{route, probe_result_status, probe_response_class, finding_severity}` |
| `ci/internal-route-cf-access-parity` (§12.2) | `routes_in_code[]`, `routes_in_policy[]`, `mismatches[]` |

---

# **§16 — Cross-Document Seam Table (Grounded by Exact §)**

| Seam | 06B side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| HMAC signing | §6 | 01A §62 | RESOLVED — referenced |
| HMAC verification | §6, §11 | 01A §63 | RESOLVED |
| `service_auth_secrets` schema \+ governance | §4, §6.3 | 01A §64 | RESOLVED |
| Rotation cadence \+ overlap | §6.2 | 01A §65 (procedure §65.1) | RESOLVED |
| Replay tolerance | §6 (referenced for runbook) | 01A §66 | RESOLVED |
| 401 failure response shape | §11.3 | 01A §67 | RESOLVED |
| Service-pair registry | §6.4 input | 01A §68 | RESOLVED |
| `/api/internal/*` non-exposure rule | §11, §12 | 01A §69 | RESOLVED |
| Reference implementation | §6 (background) | 01A §70 \+ Appendix C §C.4 | RESOLVED |
| Internal-auth deviation/migration | §6 | 01A §71 → Doc 01.2 | RESOLVED — body in Doc 01.2 |
| Abuse tier boundaries | §9, §10 | 01A §50 | RESOLVED |
| Abuse interface | §9.2 | 01A §51 | RESOLVED |
| Incident taxonomy (12 types) | §9.1 routing | 01A §52 | RESOLVED |
| Scoring formula | §9 (background) | 01A §53 | RESOLVED |
| Abuse ledger schema | §9.2 substrate | 01A §55 | RESOLVED |
| Manual override / appeal | §9.2 | 01A §56, §58 | RESOLVED |
| Student-visibility \= none | §9 (background) | 01A §57 | RESOLVED |
| 429 response shape | §10 (background) | 01A §44 | RESOLVED |
| Rate-limit ledger / atomic RPC | §10 | 01A §39–§41 | RESOLVED |
| Logger / PII redaction / alert routing | §8.3 audit content, §11 paging | 01A §10–§19.1 (§14, §18) | RESOLVED |
| Config doctrine \+ §5 config history | §8.2, §10 | 01A §1–§9 (§5) | RESOLVED |
| Service-role write discipline | §7.1 | Doc 01 V6 §3.1.4 / §3.2 | RESOLVED for V6 surface |
| Admin auth `is_admin_jwt()` | §7.1, §7.2 | Doc 01 V6 §4.1 | RESOLVED |
| Support-mediated role-switch | §8.2 | Doc 01 V6 §6 | RESOLVED for V6 surface |
| Support-access audit (V8 slice) | §8.5 | **Doc 01 V8 §44 — FWD-06-02** | OPEN — bounded; INV-06-07 partial-gated only |
| LISA safety-review queue | §9.1 routing | Doc 03 Main §21.3 | RESOLVED — canonical for tutor-class |
| LISA emergency revoke | §6.3 (tutor-pair callout) | Doc 03C §9.4 | RESOLVED |
| LISA IAM / network / Vertex isolation | §4 (LISA row), §11.2 | Doc 03C §12 | RESOLVED |
| Deletion cascade audit | §8.2 | Doc 05D §10, admin-RLS | RESOLVED |
| §10.5 envelope | §15 \+ every proving mechanism | Doc 06 06A §10.5 / Doc 06A §10.5.1 | RESOLVED — extended in §15 |
| Analytics / event-lineage seam | §8 (future analytics consumer of audit substrate) | Doc 07 (not drafted) | OPEN — bounded FORWARD\_REF (Parent FWD-06-01) |

---

# **§17 — Open Items & Watch List**

| ID | Item | Status / handling |
| ----- | ----- | ----- |
| **W1** | Doc 01 V8 §44 support-access slice (FWD-06-02) | Bounded; INV-06-07 partial-provable now (V6 surface \+ 01A §5 \+ Doc 05D admin-RLS); V8 §44 substrate added to §8.4 reconciliation on V8 provision. Non-blocking. |
| **W2** | Worker-host platform binding (Parent §18.1 propagated from 06A) | The separation invariant is locked; the platform (GCP Cloud Run worker / dedicated container / other) is workload-sizing-dependent. 06B's §4 row carries the binding placeholder. 06E will confirm on lock from the cost/capacity side. Non-blocking. |
| **W3** | Clarity posture (Doc 06A §5.4 / §18.2) | Compliance-gate placeholder registered (`clarity-authenticated-surface`); not 06B-blocking. Affects 06D process. |
| **W4** | V1.1 break-glass role-enforcement hardening | A dedicated `break_glass` Postgres role with SQL-level scope enforcement is a V1.1 hook (§7.3). Registered, not blocking. |
| **W5** | LISA-tier internal-endpoint probe scope | §11 / §12 cover Vercel-BFF `/api/internal/*` only. LISA-tier `/api/internal/*` probe is Doc 03C-owned. Confirmed boundary; non-blocking. |
| **W6** | Synthetic-request rotation verification implementation | §6.5 names a staging synthetic-request verification as part of `hmac-rotation` runbook acceptance. The synthetic-request harness body is 06B-implementation. Specified, not deploy-proven (Parent §6.13). |
| **W7** | Cost-driven abuse incidents | LISA $/user cost cap (Doc 03 Main §24) overlaps with abuse-incident `quota_farming`. 06E will define the cost-anomaly handoff to §9 abuse-ops queue. Non-blocking for 06B. |

None of W1–W7 block 06B spec-lock.

---

# **§18 — Acceptance Criteria (Executable-Proof Framed)**

Per the Doc 06A §19 split (A/B/C) — 06B-owned criteria, cross-doc gate-presence criteria, audit closure.

## **A — 06B-owned criteria**

1. `ci/secret-class-inventory-parity` fails on any deployed secret-named env var absent from `infra/secret-class-inventory.yaml`, any inventory entry without canonical/rotation owner, any privileged secret prefixed `NEXT_PUBLIC_*`, any undocumented `NEXT_PUBLIC_*` env var (§4.6 RB-06B-V1-12), any LISA-tier content read (boundary violation) (§4.4).  
2. `ci/no-server-secret-in-client` fails on (a) any named-pattern match in build output, (b) any `NEXT_PUBLIC_*` collision against a non-public inventory entry, (c) any high-entropy literal exceeding the threshold without a governed allowlist entry (§5.4.1 — exact match, owner≠reviewer, ticket, unexpired), (d) any JWT-decoded payload showing `role: service_role` or a privileged audience (RB-06B-V1-10), (e) any expired allowlist entry. The patterns registry (§5.4) and allowlist (§5.4.1) are both present and hashed into the artifact (§5.3).  
3. `ops/hmac-rotation-currency` reports `overdue` on a deliberately-stale service-pair in staging (induced test); the `hmac-rotation` runbook (§6.5) conforms to Parent §12.2 required-shape (§13) and its executable-proof acceptance criterion is verifiable using a **staging-only service pair** (RB-06B-V1-01) — production service-pair secrets are never used in tests (§6.4).  
4. `ops/prod-access-governance` fails on an induced over-60-minute break-glass session, a single-approver grant, an authorized-approver self-approval, a `last_reviewed_at` older than 90 days, **or any `privileged_session_actions` row with `review_status = 'out_of_scope'` against its session's machine-readable `allowed_actions` manifest (PAGE severity — RB-06B-V1-04)**; `infra/prod-access-inventory.yaml` (§7.5) is the canonical input (§7.6).  
5. `ops/privileged-op-audit-coverage` fails on an induced unaudited privileged op across each §8.6 substrate (one synthetic event per substrate); reconciliation joins `expected_event_source` and `observed_audit_source` on the registered `correlation_key` within `allowed_lag_seconds` — **`expected_event_source ≠ observed_audit_source` for every substrate** (RB-06B-V1-03 — self-comparison is a control gap); the V6 support-mediated path audits through the standing-admin substrate; the V8 §44 substrate is gated on FWD-06-02 (§8.4 \+ §8.5 \+ §8.6); `privileged_sessions` \+ `privileged_session_actions` relational tables (RB-06B-V1-02) are the canonical break-glass audit substrate, with per-action rows directly reconcilable.  
6. `ops/abuse-queue-sla-conformance` fails on an induced non-tutor incident at tier ≥ `flagged` left unprocessed past 24h; routing is deterministic from `incident_type`; tutor-class incidents route to Doc 03 §21.3 (not the 06B queue) and a misroute fails the check; both queues read from the **two canonical read surfaces over 01A §55** required by §9.2 (RB-06B-V1-08) — a separate `abuse_ops_queue` table is a defect (§9.4).  
7. `ops/rate-limit-config-governance` fails on a `rate_limit_runtime_config` change without a corresponding PR/CODEOWNERS-merge or without an actor identity; an abuse-multiplier weakening below 01A §50 defaults without a registered compliance-gate artifact fails (§10.4).  
8. `ops/internal-endpoint-exposure-probe` reports `ingress_rejected` for every route in the **`infra/route-surface-classification.yaml`** inventory where `is_internal_api: true` (RB-06B-V1-07); a deliberately-misconfigured staging route reaching application (200) fires `PAGE` severity; receiving an HMAC 401 from the public internet is recorded as a finding (ingress layer missed; defense-in-depth caught) (§11.4).  
9. `ci/internal-route-cf-access-parity` fails on a route with `is_internal_api: true` AND `requires_cloudflare_access: true` in `infra/route-surface-classification.yaml` (RB-06B-V1-07) absent from the deployed Cloudflare Access policy, or a stale policy entry without a backing route. **A future host change under 06A §18.1 Tier-2 MUST extend or replace this check before cutover deploys (RB-06B-V1-09; §12.3).** (§12.2)  
10. Every 06B proof artifact conforms to 06A §10.5 envelope \+ the §15 per-mechanism extras (updated for RB-06B-V1-02/03/04/05/10/11); an artifact missing any common-envelope field or its mechanism-specific extras is a `DD-06-PROOF` defect.

## **B — Cross-doc gate-body criteria (06B's slice only)**

11. **INV-06-02 scanner body:** the `no-server-secret-in-client` gate entry in the 06A `infra/release-gates.yaml` resolves to the §5.3 mechanism (06B-owned body); 06A's wiring (build-time boundary §14, OIDC keyless preference §9.2) is in place. **Scanner body owned here; gate wiring owned by 06A** (RB-06A-V1-08 pattern, mirrored).  
12. **INV-06-07 audit-process:** every §8.2 substrate appears in the §8.4 reconciliation with a configured expected-event source. The V8 §44 slice is partial-gated on FWD-06-02 (§8.5); Parent §10 / §18 enforce the partial-provability semantics.

## **C — Audit closure**

13. The §20 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects; zero 03C-boundary-pass violations; zero §10.5 envelope-conformance violations.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job / scheduled job / manifest / registry) supplies all six §6.13 elements.

---

# **§19 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-06B-V1-NN` cleanup → audit); `.bak` / `.bak2` before each pass; draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§20 — Audit Profile**

Inherits Parent §17 six passes \+ the two 06A-specific passes (03C-boundary, registry-schema-completeness) \+ the §10.5 envelope-conformance pass. Plus two 06B-specific passes:

* **06B Pass 1 — Primitive-body restatement detection:** any 06B line that states (rather than references by exact §) an 01A §50 tier multiplier, an 01A §52 incident type body, an 01A §53 formula term, an 01A §62 signing-string format, an 01A §64 schema field, an 01A §65 rotation step number, a Doc 03 §21.3 SLA hour value (as a 06B-owned hour rather than a referenced number), a Doc 01 V6 §4.1 admin-evaluation body, or a Doc 03C §12 IAM detail is a `DD-06-REDEF` defect. Highest-risk targets: §4 (§64 secret-store discipline), §6 (§65 cadence wording), §8.2 (substrate descriptions), §9.1 (incident-type names — reference, never define).  
* **06B Pass 2 — Audit-substrate exhaustiveness:** every §8.2 substrate row must (a) name a canonical owner doc+§, (b) have a defined expected-event source in §8.4's input registry, (c) be reachable by the §8.4 reconciliation. A substrate row missing any of these is a `DD-06-PROOF` defect.

Known false-positive class: the §2.2 / §16 reference tables themselves (they *cite* sibling-owned bodies — required, not restatement); the §13 runbook table (it states 06B-owned acceptance criteria, not sibling bodies); §15 envelope-extras tables (06B-owned shapes).

---

# **§21 — Change Records**

**CR-06B-01** — Doc 06B V1.0 established. Scope: secret-class inventory \+ per-platform binding; `ci/no-server-secret-in-client` scanner body (cross-doc gate body for INV-06-02); HMAC service-auth rotation operations (cadence body in 01A §65); production access \+ break-glass; privileged-op audit reconciliation (INV-06-07); abuse-incident operations; rate-limit operations wrapper; internal-endpoint non-exposure enforcement; Cloudflare Access integration; 06B-owned runbook shapes. Two Parent invariants owned outright (INV-06-02, INV-06-07).

**CR-06B-02** — Pre-draft alignment: 01A §61–§71 / §50–§59 / §39–§47 anchors pinned by exact §; Doc 01 V6 §3.1.4 / §3.2 / §4.1 / §6 surfaces referenced; Doc 03 Main §21.3 referenced canonical for tutor-class queue; Doc 03C §12 / §9.4 referenced canonical for LISA tier; 03C boundary inherited from 06A §2.2 and enforced in §20 Pass 1\. All primitive bodies remain canonical-owned; 06B is operational-wrapper-only.

**CR-06B-03** — Pre-draft Q\&A locked: Q-06B-1 \= (a) Vercel-native env vars \+ 01A §64 `service_auth_secrets` \+ GCP Secret Manager for LISA tier (per Doc 03C §12.2); Q-06B-2 \= (a) time-bounded JIT elevation via the existing admin role, dual-approval, ≤1h auto-expiry, V1.1 hook for role-level enforcement; Q-06B-3 \= (a) two queues / one SLA vocabulary — Doc 03 §21.3 canonical for `tutor_prompt_abuse`, 06B-owned queue for the other 11 01A §52 types, both reading from 01A §55 ledger (no separate table).

**CR-06B-04** — Draft-for-lock cleanup round 1 (external SWE review, 2026-05-21), RB-06B-V1-01..12 applied in-lock-cycle, **no version bump**, status transitioned `DRAFT` → `LOCKED`. 3 blockers (01: HMAC storage rule clarified — storage vs controlled retrieval distinguished; staging-only service-pair mandated for synthetic verification; 02: `privileged_session_audit.actions_performed[]` embedded-array replaced with relational `privileged_sessions` \+ `privileged_session_actions` tables enabling per-row reconciliation, indexing, retention; 03: `infra/privileged-op-source-registry.yaml` §8.6 added — every audit-coverage substrate names an independent `expected_event_source` \+ `observed_audit_source` \+ `correlation_key` \+ `allowed_lag_seconds`; hard rule `expected ≠ observed` to prevent self-comparison; 8 substrate slots populated, V8 §44 slot reserved). 6 highs (04: machine-readable `allowed_actions` on every break-glass request; out-of-scope action \= PAGE severity, not generic finding; 05: §5.4.1 allowlist governance — stable id, exact match-locator, owner≠reviewer, ticket, max-90-day expiry, no blanket directory allowlists; 06: §4.5 Supabase service-role key operational boundary — server-only runtime, never client/preview/edge-middleware, only behind server-auth+entitlement-check; 07: route registry consolidated — 06B references the extended 06A `infra/route-surface-classification.yaml` (RB-06A-V1-11 propagated) with `is_internal_api`/`requires_cloudflare_access`/`requires_hmac`; no parallel CF Access mirror file; 08: §9.2 requires two canonical read surfaces over 01A §55 with explicit-placeholder discipline — no separate `abuse_ops_queue` table; 09: §12.3 backend-host cutover guard — any §18.1 Tier-2 host change must move/extend §12 enforcement before cutover, no weakening of 01A §69). 3 mediums (10: scanner JWT-decode mode replaces brittle raw regex; payload structural inspection for `role: service_role` and privileged audiences; 11: 32-byte base64 shape downgraded to heuristic, blocking only when correlated with named pattern, entropy context, or secret-name pattern; 12: §4.6 `NEXT_PUBLIC_*` discipline — public configuration is not ungoverned). Cross-doc: RB-06A-V1-11 propagated to LOCKED Doc 06A (`route-surface-classification.yaml` schema extension; no 06A version bump per Parent §8 post-lock additive scope); RB-06A-V1-12 added (backend-host cutover-guard cross-reference for §18.1). Re-audit clean across all 9 §20 passes; zero `DD-06-*` defects; zero 03C-boundary violations; zero envelope-conformance violations; zero primitive-body-restatement defects.

**CR-06B-05** — Post-lock additive cleanup pass (SWE Round 2 review, 2026-05-21), RB-06B-V1-13 applied per Parent §8 post-lock in-lock-cycle scope. Status remains `LOCKED`, version V1.0 unchanged, lock date unchanged. §13 runbook table corrected: two stale `privileged_session_audit` references brought into alignment with the §8.3 relational table names (`privileged_sessions`, `privileged_session_actions`) — naming-drift fix only; no schema, semantic, or behavioral change. Re-audit clean across all 9 §20 passes.

**CR-06B-06** — Post-lock additive cleanup pass (06C-drafting audit, 2026-05-21), RB-06B-V1-14 applied per Parent §8 post-lock in-lock-cycle scope. Status remains `LOCKED`, version V1.0 unchanged, lock date unchanged. Corpus-wide citation-parity correction: 15 occurrences of `Parent §10.5` / `Parent §10.5.1` corrected to the canonical anchor `06A §10.5` / `06A §10.5.1` (the Standard Proof Artifact Envelope was authored in 06A §10.5 per RB-06A-V1-01; Parent §4 / §6.13 remain the doctrinal mandate the envelope conforms to). Substantive doctrine and every envelope/extras requirement unchanged; only the cross-doc §-anchor label is corrected to match the source. Re-audit clean across all 9 §20 passes.

---

# **§22 — Cleanup Register (RB-06B-V1-NN)**

Round 1 (external SWE review, 2026-05-21): 3 blockers \+ 6 highs \+ 3 mediums, all accepted and applied in-lock-cycle. No version bump; draft-for-lock pass transitioned status `DRAFT` → `LOCKED`. Two cross-doc additive entries propagated to LOCKED Doc 06A (RB-06A-V1-11, RB-06A-V1-12) per Parent §8 post-lock additive scope (no 06A version bump).

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06B-V1-01 | BLOCKER | SWE B1 | §4.3 rule 1 reworded: HMAC secrets stored only in `service_auth_secrets`, never copied to env/code/logs/build artifacts; controlled runtime retrieval via 01A-authorized service-auth path is the canonical pattern, held in request context only. §6.5 mandates staging-only service-pair for synthetic verification; production secrets never used in tests. |
| RB-06B-V1-02 | BLOCKER | SWE B2 | §8.3 embedded `actions_performed[]` replaced with relational `privileged_sessions` \+ `privileged_session_actions` tables (proper SQL with FK, indexes, CHECK constraints enforcing dual-approval and no-self-approval). Per-row reconciliation, indexing, retention now possible; §8.4 reconciles `privileged_session_actions` rows directly. |
| RB-06B-V1-03 | BLOCKER | SWE B3 | §8.6 added: `infra/privileged-op-source-registry.yaml` defining per-substrate `expected_event_source`, `observed_audit_source`, `correlation_key`, `allowed_lag_seconds`, `failure_condition`, `owner`. 8 substrate slots populated (service-role-writes, admin-UI, V8-44-reserved, config-changes, abuse-adjust-score, deletion-cascade, hmac-rotation/revoke, break-glass, queue-replay). Hard rule: `expected ≠ observed` for every entry — self-comparison flagged as control gap. §8.4 reconciliation now provably detects missing audit rows. |
| RB-06B-V1-04 | HIGH | SWE H1 | §7.2 step 2 requires machine-readable `allowed_actions` manifest on every break-glass request (action\_type, target\_table, target\_row\_pk\_pattern, rpc\_name). §7.2 step 7 \+ §7.6 failure condition: out-of-scope action in `privileged_session_actions` raises PAGE severity (not generic finding). `privileged_sessions.allowed_actions_ref` stores the pointer; `privileged_session_actions.review_status` records in\_scope/out\_of\_scope/pending\_review. |
| RB-06B-V1-05 | HIGH | SWE H2 | §5.4.1 added: scanner allowlist governance — every entry requires stable allowlist\_id, exact file \+ byte\_offset/length OR content sha256, reason, owner ≠ reviewer, linked ticket, granted\_at, expires\_at (MAX 90 days). Expired allowlists fail CI. No blanket directory or file-glob allowlists. Allowlist file hash included in §5.5 / §10.5 envelope; modifications emit config-history per 01A §5. |
| RB-06B-V1-06 | HIGH | SWE H3 | §4.5 added: Supabase service-role key operational boundary — server-only runtime, behind server-auth+entitlement-check (Doc 01 V6 §3.1.4 referenced). Six explicit prohibitions: client/browser bundle, vercel\_preview\_ephemeral, untrusted edge middleware, non-canonical worker, observability payloads, non-canonical writers. Enforced by §4.4 \+ §5 \+ §10 manifest. |
| RB-06B-V1-07 | HIGH | SWE H4 | Route registry consolidated. RB-06A-V1-11 (cross-doc additive, no 06A version bump) extends `infra/route-surface-classification.yaml` with `is_internal_api`, `requires_cloudflare_access`, `requires_hmac` fields. 06B §11.4 (probe input registry) and §12.2 (CF Access parity input) now both read from this single canonical 06A registry — no parallel CF Access mirror file. One inventory, three consumers (clarity-surface-scope \+ internal-endpoint-exposure-probe \+ internal-route-cf-access-parity). |
| RB-06B-V1-08 | HIGH | SWE H5 | §9.2 explicit: two canonical read surfaces over 01A §55 required (recommended names `v_tutor_abuse_review_queue` / `v_security_abuse_review_queue`; exact names locked at implementation review). No separate `abuse_ops_queue` table — a separate table is a `DD-06-REDEF` defect. |
| RB-06B-V1-09 | HIGH | SWE H6 | §12.3 added: backend-host cutover guard. Any §18.1 Tier-2 host change MUST move/extend §12 ingress enforcement before cutover deploys; §10 release-gate manifest blocks cutover until equivalent ingress-restriction proving mechanism is green in the new host environment. No backend-host cutover may weaken 01A §69. RB-06A-V1-12 (cross-doc additive) cross-references this guard from 06A §18.1. |
| RB-06B-V1-10 | MEDIUM | SWE M1 | §5.4 scanner: raw JWT regex replaced with `supabase_service_role_jwt_raw` (pre-filter, severity=high) \+ new `scanner_modes.jwt_decode` mode that base64url-decodes JWT-looking tokens and structurally inspects payload for `role: service_role` or privileged audiences. Blocker severity on structural match. |
| RB-06B-V1-11 | MEDIUM | SWE M2 | §5.4 scanner: `hmac_service_pair_secret_shape` (32-byte base64) downgraded to `severity: heuristic`. Blocks only when correlated with named pattern, entropy context above threshold, or secret-name-pattern proximity (`HMAC_SECRET`, `SERVICE_AUTH_SECRET`, `SECRET_MATERIAL`). Allowlist-friendly. `correlated_blocks[]` recorded in §15 envelope extras. |
| RB-06B-V1-12 | MEDIUM | SWE M3+M4 | §4.6 added: `NEXT_PUBLIC_*` discipline — public configuration is not ungoverned. Inventory entry \+ canonical owner \+ public-safety classification required. Sensitive endpoint URLs, tenant identifiers, feature-flag data prohibited unless explicitly classified public. Enforced by `ci/secret-class-inventory-parity` (§4.4). Hour-restatement sweep applied: tutor-class queue SLA hours referenced not stated; 06B-owned non-tutor queue stays at 24h aligned to 01A §58. |
| RB-06B-V1-13 | ADDITIVE (post-lock; no version bump per Parent §8) | SWE Round 2 Watch-Item 1 | §13 runbook table: stale `privileged_session_audit` references in two rows (`break-glass-grant`, `break-glass-post-session-review`) corrected to the relational table names introduced by RB-06B-V1-02 (`privileged_sessions`, `privileged_session_actions`). Eliminates §8.3 ↔ §13 naming-drift risk. Lock date unchanged; no behavioral change. |
| RB-06B-V1-14 | ADDITIVE (post-lock; no version bump per Parent §8) | 06C-drafting citation-parity audit (P3) caught the §-anchor miscitation across the corpus | All 15 occurrences of `Parent §10.5` / `Parent §10.5.1` corrected to `06A §10.5` / `06A §10.5.1`. The Standard Proof Artifact Envelope was authored in **06A §10.5** (RB-06A-V1-01, the round-1 cleanup blocker that established the envelope) and inherited by 06B/06C/06D/06E; the *Parent-level mandate* that every proof artifact conform to an envelope remains Parent §4 / §6.13 (the executable-proof doctrine and the six-element contract). The substantive doctrine is unchanged; only the §-anchor was mislabeled. Lock date unchanged; no schema, semantic, or behavioral change. |

**Convention:** `.bak` / `.bak2` before each pass; resolved items tagged `RB-06B-V1-NN`; a §21 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes leave status / version / lock-date unchanged (Parent §8).

---

*End of Doc 06B V1.0 (LOCKED 2026-05-21; RB-06B-V1-01..12 applied in-lock-cycle, no version bump). Next: 06C (Observability Operations, SLOs & Incident Response).*

