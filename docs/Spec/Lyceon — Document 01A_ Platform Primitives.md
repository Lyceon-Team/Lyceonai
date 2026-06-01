# **Lyceon — Document 01A: Platform Primitives**

**Version:** V1.0 **Status:** CANONICAL **Last updated:** 2026-04-23 **Owners:** Founder / CTO review **Governed by:** Document 00 (Authoritative Platform Directive) **Depends on:** Neon Postgres, Supabase, Cloud Run, Vercel **Applies to:** All Lyceon platform features — every feature doc consumes 01A primitives. Identity concerns are in Doc 01 V8; 01A contains the cross-cutting infrastructure layer.

**V1.0 scope:** First release of the Platform Primitives canonical spec. Seven services defined: Config doctrine (§1-§9), Observability (§10-§19), Caching Strategy (§20-§28), IdempotencyService (§29-§38), RateLimitLedger (§39-§47), AbuseScoreService (§48-§60), Internal Service Auth (§61-§71). Each service specifies interface, reference implementation, deviation box, and integration points. Dependency-ordered presentation per author directive: foundational patterns (config, observability, caching) come before request-scoped services (idempotency, rate limiting, abuse scoring, service auth). Companion artifacts extend existing Doc 01 series — 01.1 Test Matrix, 01.2 Migration Runbooks, 01.3 Engineer Runbooks — no parallel 01A companion series.

---

# **Part 0 — Preamble**

## **0.1 Purpose**

Doc 01A contains the cross-cutting platform services every feature doc in the Lyceon repo consumes. These are not identity-native concerns (that's Doc 01 V8); they are infrastructure primitives — how services log, how caches invalidate, how rates are limited, how requests are deduplicated, how trust is scored, how services authenticate to each other, how runtime constants live in the database.

Without a canonical 01A, every feature doc reinvents these patterns. The typical failure mode is that each feature invents its own cache, its own rate limiter, its own idempotency mechanism — each subtly different, each requiring separate testing, each diverging over time. Doc 01A prevents that by establishing the one-way-to-do-each-thing contract.

Every primitive in 01A follows the same pattern: canonical interface, clear contract, reference implementation, audit-aware deviation box if current repo differs, consumption map showing which feature docs depend on it.

## **0.2 Scope**

**In scope:** Config doctrine, Observability, Caching strategy, `IdempotencyService`, `RateLimitLedger`, `AbuseScoreService`, Internal service auth.

**Out of scope:** Identity/auth (Doc 01 V8), Entitlement evaluation (V8 `EntitlementService`), Runtime engines (Doc 02 family), Question governance (Doc 02A), Mastery (Doc 02C), Tutor architecture (Doc 03 family), future Doc 04/05/06.

## **0.3 Relationship to Doc 00, Doc 01 V8, and feature docs**

**Doc 00 inheritance:** Every 01A service operates within Doc 00 platform directive — server-authoritative mutations, single writer per canonical table, no client trust, deterministic flow, audit logging, data protection by default.

**Doc 01 V8 interaction:** V8 consumes 01A primitives for its own operation. Specifically:

* V8 Stripe webhook handler consumes `IdempotencyService` (Part IV) for event deduplication  
* V8 authentication and password-reset flows consume `RateLimitLedger` (Part V) for brute-force and abuse prevention  
* V8 `EntitlementService` cache uses the LISTEN/NOTIFY pattern from Part III  
* V8 `EntitlementService.canAccessFeature` consults `AbuseScoreService` (Part VI) for trust-weighted access gating  
* V8 role changes and high-risk identity actions feed `AbuseScoreService` incident signals  
* V8 logging and metrics follow observability conventions (Part II)  
* V8 constants live in `*_runtime_config` tables per config doctrine (Part I)  
* Future internal jobs (audit archival, compaction, hard-delete) use internal service auth (Part VII)

**Feature doc consumption:** Every feature doc consumes 01A primitives. §72 provides the exhaustive provision-to-consumer map.

## **0.4 Target-dominant doctrine**

Consistent with Doc 01 V8 §0.5: 01A describes target state as canonical. Where current repo materially differs, a compact **current-state deviation box** is included in the relevant section using the format:

**Current-state deviation:** \[what repo does today, audit-sourced\] **Target-state:** \[what 01A specifies\] **Migration path:** \[migration steps, pre-conditions, verification criteria\] **Cutover criteria / Blocking conditions / Completion proof:** \[for launch-critical migrations\]

Deviation boxes are present only where material.

## **0.5 Audit lineage**

Per Doc 01 V8 audit (2026-04-23), the repo currently has:

* `apps/api/src/lib/rate-limit-ledger.ts` — existing Postgres RPC ledger pattern  
* `stripe_webhook_events` table with unique constraint — existing idempotency mechanism wrapped in V8 §22.2  
* `server/lib/durable-rate-limiter.ts` — guardian linking rate limiter (V8 §36.2)  
* `metadata.session_start_idempotency_key` — existing idempotency pattern on Postgres  
* `audit_logs` table — existing audit infrastructure (V8 §5.1)  
* `*_runtime_config` tables — partial adoption (V8 Appendix A consolidates)

**Greenfield additions in 01A (not yet in repo):**

* Canonical `IdempotencyService` wrapper around existing mechanisms  
* Canonical `RateLimitLedger` wrapper around existing helper  
* `AbuseScoreService` (entirely new)  
* Internal service auth (HMAC) — audit flagged as missing  
* Formalized observability conventions (partial adoption today)

Every 01A primitive either wraps an existing repo asset (labeled with audit confirmation) or is greenfield (explicitly noted).

## **0.6 Error class catalog**

Every 01A service throws typed errors rather than generic `Error`. This lets callers handle specific failure modes cleanly and lets the observability layer attribute errors to services. Canonical catalog:

// packages/shared/errors/platform-errors.ts

// Caching (Part III)  
export class CacheUnavailableError extends Error {  
  constructor(key: string) {  
    super(\`Cache unavailable and beyond hard-staleness bound: ${key}\`);  
    this.name \= 'CacheUnavailableError';  
  }  
}

// IdempotencyService (Part IV)  
export class IdempotencyConflictError extends Error {  
  constructor(scope: string, clientKey: string) {  
    super(\`Idempotency conflict on ${scope}:${clientKey} — same key used with different content\`);  
    this.name \= 'IdempotencyConflictError';  
  }  
}

export class IdempotencyInProgressError extends Error {  
  constructor(scope: string, clientKey: string) {  
    super(\`Idempotent operation in progress: ${scope}:${clientKey}\`);  
    this.name \= 'IdempotencyInProgressError';  
  }  
}

// RateLimitLedger (Part V)  
export class RateLimitExceededError extends Error {  
  constructor(  
    public bucketKey: string,  
    public resetAt: Date,  
    public retryAfterSeconds: number  
  ) {  
    super(\`Rate limit exceeded: ${bucketKey}\`);  
    this.name \= 'RateLimitExceededError';  
  }  
}

export class RateLimitCheckUnavailableError extends Error {  
  constructor(bucketKey: string) {  
    super(\`Rate limit check unavailable (ledger query failed): ${bucketKey}\`);  
    this.name \= 'RateLimitCheckUnavailableError';  
  }  
}

// AbuseScoreService (Part VI)  
export class AbuseScoreUnavailableError extends Error {  
  constructor(studentId: string) {  
    super(\`Abuse score unavailable for student ${studentId} (DB query failed beyond hard staleness)\`);  
    this.name \= 'AbuseScoreUnavailableError';  
  }  
}

// Internal Service Auth (Part VII)  
export class ServiceAuthSecretMissingError extends Error {  
  constructor(caller: string, callee: string) {  
    super(\`No active secret for service pair: ${caller} → ${callee}\`);  
    this.name \= 'ServiceAuthSecretMissingError';  
  }  
}

export class UnauthorizedError extends Error {  
  constructor(message: string) {  
    super(message);  
    this.name \= 'UnauthorizedError';  
  }  
}

// Config doctrine (Part I)  
export class MissingRequiredConfigError extends Error {  
  constructor(table: string, key: string) {  
    super(\`Missing required config: ${table}.${key}\`);  
    this.name \= 'MissingRequiredConfigError';  
  }  
}

**HTTP response mapping** (invoked by API middleware, not by service code):

| Error class | HTTP status | Response `code` |
| ----- | ----- | ----- |
| `IdempotencyConflictError` | 409 | `idempotency_conflict` |
| `IdempotencyInProgressError` | 409 | `idempotency_in_progress` |
| `RateLimitExceededError` | 429 | `rate_limit_exceeded` |
| `UnauthorizedError` (internal auth) | 401 | `internal_auth_failed` |
| `CacheUnavailableError` | 503 | `service_degraded` |
| `RateLimitCheckUnavailableError` | 503 | `service_degraded` |
| `AbuseScoreUnavailableError` | 503 | `service_degraded` |
| `ServiceAuthSecretMissingError` | 500 | `internal_error` (log as fatal) |
| `MissingRequiredConfigError` | (startup fail) | — (process exits) |

Services throw these directly; API middleware maps to HTTP responses. Errors never leak internal details (secret values, stack traces, DB row shapes) to the client per V8 §45A hygiene.

---

# **Part I — Config Doctrine**

This part comes first because every other 01A service consumes `*_runtime_config` tables. Establishing the config pattern before defining services prevents every section from having to re-explain "values live in DB-backed config."

## **§1 Principle — constants in DB, not in code**

**Every tunable runtime value lives in a DB-backed `*_runtime_config` table.** Magic numbers in code are violations. This principle, originally INV-02B-15 in Doc 02B runtime engine, extends repo-wide per V8 §23 doctrine.

**What qualifies as "tunable":**

* Thresholds (lockout attempts, rate limits, cache TTLs, abuse score tiers)  
* Timing windows (grace periods, cooldowns, retention durations)  
* Enabled/disabled feature flags  
* Country allow-lists, role allow-lists  
* Tier definitions (free, premium features)  
* Environment-specific values that differ dev/staging/production

**What does NOT qualify (stays in code):**

* Core algorithm constants (e.g., mathematical constants, cryptographic key sizes, protocol version strings)  
* Schema structure (table names, column names)  
* Architectural invariants (not tunable by definition)

The test: "If ops needed to change this value at 2am without a code deploy, could they?" If yes → config table. If no → code.

## **§2 `*_runtime_config` table pattern**

Canonical schema:

CREATE TABLE \<service\>\_runtime\_config (  
  key TEXT PRIMARY KEY,  
  value JSONB NOT NULL,  
  value\_type TEXT NOT NULL CHECK (value\_type IN ('integer', 'string', 'boolean', 'array', 'object', 'float')),  
  min\_value JSONB,           \-- for numeric types  
  max\_value JSONB,           \-- for numeric types  
  allowed\_values JSONB,      \-- for enum-like strings/integers  
  owner TEXT NOT NULL,       \-- team or role responsible  
  description TEXT NOT NULL,  
  environment TEXT NOT NULL DEFAULT 'all' CHECK (environment IN ('all', 'development', 'staging', 'production')),  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_by\_profile\_id UUID REFERENCES profiles(id)  
);

**Per-environment values** are handled via the `environment` column (single table, env-filtered at read time). V1 uses this single-table pattern.

## **§3 Config loading and startup**

At process startup, each service module loads its own `<service>_runtime_config` table into memory:

// packages/shared/config/loader.ts  
export async function loadConfig(  
  table: string,  
  environment: string \= process.env.NODE\_ENV  
): Promise\<Record\<string, unknown\>\> {  
  const { data } \= await supabase  
    .from(table)  
    .select('key, value')  
    .or(\`environment.eq.all,environment.eq.${environment}\`);

  return Object.fromEntries(data.map(row \=\> \[row.key, row.value\]));  
}

Startup loads all config tables the service depends on. Missing required keys block startup — services fail fast rather than run with defaults that may mask missing ops work.

**Bootstrap order (fixed, non-negotiable):**

1. `loadAllConfig()` — populates the in-memory config cache from DB (single blocking call at process startup)  
2. Initialize logger, metrics, DB pool  
3. `startConfigInvalidationListener(pool)` — begins receiving `NOTIFY` events (§4)  
4. Start HTTP listener / accept connections

The invalidation listener depends on the cache being populated (step 1 must complete before step 3). The listener itself does not consume config values during its event loop — it only calls `refreshConfigKey(table, key)` with the payload from `NOTIFY`. Services must never call `getConfig(...)` before step 1 completes; violations throw `MissingRequiredConfigError` (§0.6).

## **§4 Refresh cadence — LISTEN/NOTIFY event-driven**

**Config refresh is event-driven via LISTEN/NOTIFY, not TTL polling.**

When ops updates a config value:

1. The update row in `<service>_runtime_config` commits  
2. A DB trigger emits `NOTIFY config_invalidate '<table>:<key>'`  
3. All API instances subscribed to `config_invalidate` channel receive the notification  
4. Each instance re-reads the updated key (or full table) from DB  
5. In-process config map is updated atomically

**No TTL polling** because config changes are infrequent — hammering the DB every 60s per process for unchanged data is wasteful. Event-driven invalidation is correct for the access pattern.

**Trigger for config invalidation:**

CREATE OR REPLACE FUNCTION notify\_config\_change()  
RETURNS TRIGGER AS $$  
BEGIN  
  PERFORM pg\_notify(  
    'config\_invalidate',  
    json\_build\_object(  
      'table', TG\_TABLE\_NAME,  
      'key', NEW.key,  
      'environment', NEW.environment  
    )::text  
  );  
  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

\-- Applied to every \*\_runtime\_config table  
CREATE TRIGGER \<table\>\_notify\_config\_change  
  AFTER INSERT OR UPDATE ON \<table\>  
  FOR EACH ROW EXECUTE FUNCTION notify\_config\_change();

**LISTEN loop in service:**

// packages/shared/config/invalidation-listener.ts  
export async function startConfigInvalidationListener(pool: PgPool) {  
  const listener \= await pool.connect();  
  await listener.query('LISTEN config\_invalidate');  
  listener.on('notification', async (msg) \=\> {  
    const { table, key, environment } \= JSON.parse(msg.payload ?? '{}');  
    if (environment \=== 'all' || environment \=== process.env.NODE\_ENV) {  
      await refreshConfigKey(table, key);  
      logger.info('config\_refreshed', { table, key });  
    }  
  });  
  // Reconnect logic on listener.on('error') per Part III §28 pattern  
}

**Why LISTEN/NOTIFY here and not TTL polling:** consistent with V8 `EntitlementService` pattern (§28-§29). Config change is a rare event; the access pattern is "read once, use forever until changed." TTL polling inverts that pattern needlessly.

## **§5 Change audit trail — `*_runtime_config_history`**

Every config change is append-audited:

CREATE TABLE \<service\>\_runtime\_config\_history (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  table\_name TEXT NOT NULL,  
  key TEXT NOT NULL,  
  old\_value JSONB,  
  new\_value JSONB NOT NULL,  
  changed\_by\_profile\_id UUID REFERENCES profiles(id),  
  change\_reason TEXT,  
  changed\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

Schema-level: history tables are **shared append-only** per V8 Appendix E governance. UPDATE and DELETE prohibited via trigger.

## **§6 CI enforcement — no magic numbers**

Linter rule rejects magic numbers in service code:

// ❌ Violation  
if (attempts \>= 5\) lockoutAccount();

// ✅ Compliant  
if (attempts \>= config.auth.failed\_login\_lockout\_threshold) lockoutAccount();

Enforcement scope:

* All numeric literals \> 1 in service code paths must be either config-sourced or annotated with `// magic-number-exception: <rationale>`  
* Exceptions: array indices (0, 1), loop increments, mathematical constants (π, e)  
* CI check runs on every PR; violations block merge

Enforcement is scoped to `server/`, `apps/api/`, `apps/workers/`, and `packages/shared/services/`. Test code and one-off scripts are exempt.

## **§7 Environment-specific values**

Per §2 schema, `environment` column controls value scoping:

* `environment = 'all'`: value applies to all environments (default)  
* `environment = 'development' | 'staging' | 'production'`: value applies only to that environment

Load-time filter reads both `all` and the current environment; current environment overrides `all` when both exist.

## **§8 Config tables catalog**

Each `*_runtime_config` table groups related config for a single service or subsystem. Established tables per V8 Appendix A:

* `auth_runtime_config`, `auth_mfa_config`, `consent_runtime_config`  
* `entitlement_runtime_config`, `account_deletion_runtime_config`, `mobile_auth_config`

New 01A tables:

* `rate_limit_runtime_config` — rate limit bucket definitions and thresholds  
* `idempotency_runtime_config` — scope TTLs, retention policy  
* `abuse_score_runtime_config` — tier boundaries, incident weights, decay parameters, override respect window  
* `observability_runtime_config` — log levels, retention per category, alert thresholds  
* `caching_runtime_config` — default TTL, hard staleness bounds, channel names  
* `internal_service_auth_config` — timestamp tolerance, rotation cadence (secrets via secret reference, not config values)

Naming convention: `<subsystem>_runtime_config`.

## **§9 Config doctrine deviation box**

**Current-state deviation:** Per V8 audit, `*_runtime_config` pattern is partially adopted. Some constants already live in tables (e.g., `auth_runtime_config`), but magic numbers still exist in service code. LISTEN/NOTIFY config invalidation is not implemented. `*_runtime_config_history` audit tables are not uniformly present. **Target-state:** §1-§8 — every tunable value in `*_runtime_config`, LISTEN/NOTIFY invalidation, history audit tables per config table, CI enforcement on magic numbers. **Migration path:** (1) Inventory magic numbers in existing service code via lint rule; document each. (2) For each, either move to config table or annotate exception. (3) Create history audit tables for every `*_runtime_config` table. (4) Add LISTEN/NOTIFY triggers. (5) Implement config invalidation listener in services. (6) Enable CI enforcement. **Cutover criteria:** (a) lint rule enabled and passing on main with zero unannotated magic-number violations; (b) every `*_runtime_config` table has matching `_history` table with schema-level append-only enforcement; (c) LISTEN/NOTIFY triggers deployed and tested in staging (config change propagates to all instances within 5 seconds); (d) every service with config consumption runs the invalidation listener. **Blocking conditions:** any service still using hard-coded magic numbers outside the exception annotation convention; any `*_runtime_config` table without history audit; LISTEN/NOTIFY invalidation untested. **Completion proof:** CI lint passing; staging config-change propagation measurable in logs; history tables show complete audit coverage for a test window of production config changes. Runbook in Doc 01.2.

---

# **Part II — Observability**

This part establishes the logging, metrics, correlation, and alerting conventions every other service follows. Presenting this before caching/idempotency/rate-limiting lets those sections reference "structured logger per §10" rather than re-defining log conventions.

## **§10 Structured logging principle**

Every log line is structured JSON. No free-text `console.log`. No unstructured stdout. Structured logs are machine-parseable, grep-compatible, and support log-ingestion tooling.

**Canonical log entry shape:**

interface LogEntry {  
  timestamp: string;         // ISO 8601  
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';  
  event: string;             // snake\_case event name  
  message?: string;          // optional human-readable summary  
  request\_id?: string;       // correlation ID (see §12)  
  service: string;           // service name emitting the log  
  environment: string;       // dev / staging / production

  // Event-specific fields (typed per event)  
  \[key: string\]: unknown;  
}

## **§11 Logger interface**

// packages/shared/observability/logger.ts  
export interface Logger {  
  debug(event: string, context?: Record\<string, unknown\>): void;  
  info(event: string, context?: Record\<string, unknown\>): void;  
  warn(event: string, context?: Record\<string, unknown\>): void;  
  error(event: string, context?: Record\<string, unknown\>): void;  
  fatal(event: string, context?: Record\<string, unknown\>): void;  
  child(context: Record\<string, unknown\>): Logger;  // returns logger with merged context  
}

Every module imports `logger` from `packages/shared/observability/logger.ts`. No direct `console` calls in production code.

## **§12 Correlation IDs**

Every request that enters the system at the API boundary gets a `request_id` (UUIDv4) assigned by the first middleware. The `request_id` threads through:

* All log entries for that request  
* Metric labels  
* Downstream service calls (via `X-Request-Id` header)  
* Async job enqueues (persisted in job metadata)  
* Webhook-triggered work (copied from incoming webhook to all derived operations)

**Middleware implementation:**

// server/middleware/correlation.ts  
export function correlationIdMiddleware(req, res, next) {  
  const incoming \= req.headers\['x-request-id'\];  
  req.requestId \= incoming && isValidUUID(incoming) ? incoming : randomUUID();  
  res.setHeader('x-request-id', req.requestId);

  // Attach request-scoped logger  
  req.logger \= baseLogger.child({ request\_id: req.requestId });

  next();  
}

## **§13 Log levels and usage**

| Level | When to use |
| ----- | ----- |
| `debug` | Detailed trace information, disabled in production by default |
| `info` | Normal operational events (request handled, cache hit, event emitted) |
| `warn` | Unexpected but recoverable (cache miss requiring DB fallback, retry succeeded) |
| `error` | Expected failure modes (validation error, upstream service timeout) |
| `fatal` | Unrecoverable state (DB unreachable for sustained period, invariant violation) |

Default production log level: `info`. `debug` is enabled only for diagnostic sessions. `fatal` should trigger immediate alert (§18).

## **§14 PII redaction rules (extends V8 §5.1)**

Certain fields are **never** written to any log under any level:

* Passwords (even hashed)  
* MFA secrets or recovery codes  
* Session tokens, JWTs, refresh tokens  
* Credit card numbers, payment credentials, full Stripe customer metadata  
* Raw student answers (academic integrity)  
* Raw tutor prompts and responses (per V8 and Doc 03 family)  
* Full date of birth (use age\_years if needed)  
* Private message content

Fields **always redacted** (transformed at log-write time):

| Field | Redaction |
| ----- | ----- |
| Email address | First letter \+ domain, e.g., `k****@lyceon.ai` (after 90 days retention, domain-only) |
| IP address | Truncated to /24 (IPv4) or /48 (IPv6) |
| User-Agent | Parsed to browser family \+ OS family; version-specific details dropped |
| Stripe event payloads | `stripe_customer_id` reference only, not full customer object |
| URL paths containing IDs | Pattern-matched and replaced with `:id` placeholder |

Redaction is implemented in the logger transport layer. Violations of the blocked-fields list are treated as security incidents, not logging bugs.

## **§15 Metrics emission**

Metrics are emitted via a canonical metrics interface:

// packages/shared/observability/metrics.ts  
export interface Metrics {  
  counter(name: string, labels?: Record\<string, string\>): void;  
  gauge(name: string, value: number, labels?: Record\<string, string\>): void;  
  histogram(name: string, value: number, labels?: Record\<string, string\>): void;  
  timing(name: string, milliseconds: number, labels?: Record\<string, string\>): void;  
}

**Metric naming convention:** `<subsystem>_<object>_<verb>[_<unit>]`

* `entitlement_check_latency_ms`  
* `rate_limit_check_total` (counter)  
* `tutor_turns_daily` (counter with student\_id in labels)  
* `abuse_score_incident_recorded` (counter with incident\_type label)

**Label cardinality:** keep under 100 values per label. High-cardinality (e.g., per-user) labels are prohibited — use histograms and sampling instead.

**Standard labels** present on most metrics:

* `service` — which service emitted  
* `environment` — dev / staging / production  
* `request_id` — only on detailed histograms sampled for debugging

## **§16 Percentile conventions**

For latency metrics, track P50, P95, P99 at minimum. Some critical-path services track P99.9.

metrics.histogram('entitlement\_check\_latency\_ms', durationMs, {  
  service: 'api',  
  cache\_hit: cacheHit ? 'true' : 'false'  
});

Aggregation and visualization handled by metrics backend (specific backend choice is infrastructure, not spec).

## **§17 Correlation across async boundaries**

When work is enqueued for later processing, the `request_id` must propagate:

await queue.enqueue('stripe\_cancellation', {  
  payload,  
  metadata: {  
    request\_id: req.requestId,  
    enqueued\_at: new Date().toISOString()  
  }  
});

**Job handler:**

async function handleJob(job) {  
  const logger \= baseLogger.child({  
    request\_id: job.metadata.request\_id,  
    job\_id: job.id  
  });  
  // All logs from this handler carry the request\_id of the originating request  
}

**Webhook-triggered derived work:** Stripe webhook handler assigns a `request_id` for the webhook processing run; any derived operations (entitlement invalidation, audit event, queue enqueues) carry that same `request_id`.

## **§18 Alert routing**

Alerts are categorized by severity:

| Severity | Response time | Routing |
| ----- | ----- | ----- |
| Page | Immediate (5 min acknowledgment) | On-call phone / SMS / Slack-page |
| Warn | Next business hour | Slack-warn channel |
| Info | Daily digest | Slack-info channel |
| Debug | None (for dashboards only) | Metrics dashboard |

**Alert fatigue prevention:** alert thresholds live in `observability_runtime_config`; tuning happens via config change, not code change.

## **§19 Log sinks and retention**

| Environment | Primary sink | Retention |
| ----- | ----- | ----- |
| Development | stdout (console-readable format) | None (ephemeral) |
| Staging | Structured JSON to centralized log aggregator | 30 days |
| Production | Structured JSON to centralized log aggregator \+ cold archive after 90 days | 90 days hot, 1 year cold, then purged per §14 |

**PII retention interacts with log retention:** per V8 §5.1, emails in logs transition to domain-only after 90 days; IP addresses are already truncated at write time. Any logs containing retained user context are subject to user deletion per V8 §40.5.

## **§19.1 Observability deviation box**

**Current-state deviation:** Per V8 audit, some structured logging exists but is inconsistent. `console.log` calls still appear in some service paths. Correlation IDs are partially implemented. Metrics emission varies by surface. PII redaction rules are documented but not uniformly enforced. **Target-state:** §10-§19 — canonical logger, correlation IDs threaded end-to-end, structured metrics, enforced PII redaction, consistent log sinks. **Migration path:** (1) Migrate all `console` calls to structured logger. (2) Implement correlation ID middleware. (3) Thread `request_id` through async boundaries (queue, webhooks). (4) Implement redaction transport layer. (5) Add CI check rejecting `console` calls outside test code. (6) Verify metric names follow naming convention. **Cutover criteria:** (a) zero `console` calls in non-test production code (grep-verified); (b) correlation ID present on \>99% of logs in a production sample window; (c) redaction rules tested with staged sensitive-content injection — no sensitive field appears in logs; (d) alert routing tested end-to-end for page/warn/info categories. **Blocking conditions:** any sensitive field (password, MFA secret, session token, full DOB, raw student answer, raw tutor prompt) appearing in a log sample; correlation ID coverage below 99%; any remaining `console.log` or `console.error` call in non-test production code paths; alert routing not tested end-to-end. **Completion proof:** CI check passing; log sampling shows complete correlation coverage; redaction testing demonstrates blocked fields never leak; alert routing validated via runbook test in staging. Runbook in Doc 01.2.

---

# **Part III — Caching Strategy**

This is the canonical caching pattern every 01A and feature-level service follows. Already used by V8 `EntitlementService` (§28-§29); this part formalizes it as the repo-wide pattern.

## **§20 Philosophy — Postgres-only, no Redis**

Lyceon does not run Redis at launch. This is a deliberate constraint: the operational burden of running Redis (another service to monitor, another failure mode, another consistency model to reason about) is not warranted at launch scale. Postgres handles caching duties well enough via the two-tier pattern below.

**Post-launch extensibility:** if Redis becomes necessary (e.g., \>10K DAU, cache hit rates below targets, cross-region read-replica scenarios), the two-tier topology extends naturally — the in-process cache stays; the authoritative layer becomes Redis instead of (or in addition to) Postgres. Consumer interfaces (the service's cache API) are unchanged.

## **§21 Two-tier topology**

**Tier 1: in-process memory cache** (per API instance)

* Data structure: JavaScript `Map<string, CacheEntry>`  
* Scope: per API instance, not shared across instances  
* Access latency: microseconds (local memory lookup)  
* Used for: hot-path read decisions (entitlement checks, role lookups, config values)

**Tier 2: Postgres authoritative storage**

* The source of truth  
* Accessed on cache miss (tier 1\) or cache invalidation (tier 1 wiped)  
* Access latency: milliseconds to tens of milliseconds

**Invalidation: LISTEN/NOTIFY** (§22-§28)

No intermediate tier (no Redis, no Memcached). The gap between "per-instance memory" and "authoritative DB" is bridged by the invalidation pattern, not by a shared cache layer.

## **§22 LISTEN/NOTIFY invalidation pattern**

Postgres's native `LISTEN`/`NOTIFY` mechanism is the canonical invalidation primitive. Industry precedent: GitHub, Basecamp, Supabase itself, and many others use this pattern at scale.

**How it works:**

1. Writer path (service that changes the authoritative data): after DB write commits, emit `NOTIFY <channel> '<payload>'` in the same transaction or immediately after  
2. Channel is scoped per cache type: `entitlement_invalidate`, `config_invalidate`, `abuse_score_invalidate`, etc.  
3. Every API instance runs a background `LISTEN <channel>` loop  
4. On notification received, the instance's in-process cache deletes the affected key

**Example channel naming convention:** `<subsystem>_invalidate`

## **§23 Channel payload convention**

Payload is JSON with the key identifying what to invalidate:

// entitlement\_invalidate channel  
{ "student\_id": "uuid-here" }

// config\_invalidate channel  
{ "table": "auth\_runtime\_config", "key": "session\_ttl\_hours", "environment": "production" }

// abuse\_score\_invalidate channel  
{ "student\_id": "uuid-here" }

Keep payloads under 7800 bytes (Postgres's `NOTIFY` payload limit is 8000 bytes; leave headroom).

## **§24 TTL \+ hard staleness pattern**

Even with LISTEN/NOTIFY, cache entries have a TTL as a safety net. The pattern:

* **TTL (soft expiry):** Normal cache lifetime. Entries older than TTL are treated as expired; next access refreshes from DB.  
* **Hard staleness bound:** Maximum age under which the entry is still usable during DB unavailability. Beyond hard staleness, cache is discarded even if DB is down.

type CacheEntry\<T\> \= {  
  value: T;  
  expiresAt: number;       // TTL boundary  
  hardStaleAt: number;     // hard staleness boundary  
};

**Read flow:**

async function getCached(key: string): Promise\<T\> {  
  const entry \= cache.get(key);  
  const now \= Date.now();

  if (entry && entry.expiresAt \> now) {  
    return entry.value;  // Fresh hit  
  }

  try {  
    const fresh \= await loadFromDb(key);  
    cache.set(key, {  
      value: fresh,  
      expiresAt: now \+ TTL\_MS,  
      hardStaleAt: now \+ HARD\_STALENESS\_MS  
    });  
    return fresh;  
  } catch (dbErr) {  
    if (entry && entry.hardStaleAt \> now) {  
      logger.warn('cache\_stale\_fallback', { key, dbErr });  
      return entry.value;  // Stale but within hard bound  
    }  
    throw new CacheUnavailableError();  // DB down AND cache beyond hard bound  
  }  
}

**Example values (from V8 `EntitlementService`):**

* TTL: 60 seconds  
* Hard staleness: 300 seconds (5 minutes)

Values live per-service in the respective `*_runtime_config` table.

## **§25 Cache key discipline**

Keys follow a convention:

* `<subsystem>:<entity>:<id>`  
* `entitlement:student:<uuid>`  
* `config:auth:session_ttl_hours`  
* `abuse_score:student:<uuid>`

No implicit global namespace — always prefix with subsystem. Avoid keys that include request-specific or high-cardinality data (those should not be cached at this tier).

## **§26 Production modes**

Per V8 §29.5 cross-reference, this section is where LISTEN/NOTIFY production modes are authoritatively specified:

### **Single-instance launch mode**

* One API instance running  
* LISTEN loop on same process that does writes  
* NOTIFY effectively synchronous — same-process listener receives the notification immediately after the writing transaction commits  
* Simplest operating mode; fewest failure modes

### **Multi-instance mode**

* N API instances (typical for post-launch scaling)  
* Each instance runs its own LISTEN loop on its own DB connection  
* NOTIFY fans out to all listeners via Postgres's native pub/sub  
* Each listener independently invalidates its local cache  
* Cross-instance eventual consistency: a few milliseconds of skew is expected and acceptable

### **Degraded mode**

* One or more instances have dropped their LISTEN connection (network glitch, DB connection recycled by pooler, etc.)  
* Affected instances fall back to TTL-only invalidation (60s worst-case staleness for V8 defaults) until reconnection  
* Not a hard failure — cache simply ages out more slowly than ideal  
* Reconnection happens via listener's error-handler logic (§28)

### **Migration mode**

* During rolling deploys, instances cycle  
* LISTEN connections drop and reconnect  
* NOTIFY events emitted during an instance's brief listener-downtime window are missed by that instance  
* Missed events are caught by TTL within 60s — no data integrity risk, only a brief staleness window

### **pgBouncer / connection pooler considerations**

**Important:** LISTEN requires session-mode connections. Transaction-mode pooling (the more efficient default) breaks LISTEN because the listener doesn't hold a persistent session.

**Solutions:**

* **Option 1 — Direct Postgres connection for listener:** the listener connects directly to Postgres (bypassing the pooler) with a dedicated session connection. Other query traffic continues through the pooler.  
* **Option 2 — Supavisor session mode:** Supabase's Supavisor pooler supports session mode; use it on a dedicated port for the listener connection.  
* **Option 3 — Direct connection, pooled writes:** app reads/writes go through pooler; only LISTEN connection is direct.

V1 recommendation: **Option 3**. Most operational simplicity; minimal pooler exception.

## **§27 NOTIFY emission rule**

**NOTIFY is emitted after DB commit, not during the transaction.**

await db.transaction(async (tx) \=\> {  
  await tx.from('entitlements').update(...).eq('profile\_id', id);  
  // Do NOT emit NOTIFY here  
});  
// Emit AFTER commit:  
await supabase.rpc('notify\_entitlement\_invalidate', { p\_student\_id: id });

Why: `pg_notify` inside a transaction is buffered until commit anyway; emitting outside the transaction makes the ordering explicit and avoids confusion about visibility.

**Failure handling on emission:** NOTIFY failure is non-blocking. The write already committed; the cache will eventually invalidate via TTL. Log the NOTIFY failure at WARN level.

## **§28 Listener reconnection logic**

Listener connections drop. The canonical reconnection pattern:

export async function startListener(  
  pool: PgPool,  
  channel: string,  
  onNotification: (payload: string) \=\> void  
) {  
  let attempt \= 0;

  const connect \= async () \=\> {  
    const listener \= await pool.connect();  
    await listener.query(\`LISTEN ${channel}\`);

    listener.on('notification', (msg) \=\> {  
      try {  
        onNotification(msg.payload ?? '');  
        attempt \= 0;  // Reset backoff on success  
      } catch (err) {  
        logger.warn('listener\_notification\_handler\_failed', { channel, err });  
      }  
    });

    listener.on('error', async (err) \=\> {  
      logger.error('listener\_connection\_error', { channel, err });  
      listener.release(true);  
      await reconnect();  
    });

    logger.info('listener\_connected', { channel });  
  };

  const reconnect \= async () \=\> {  
    attempt++;  
    const backoff \= Math.min(60\_000, 1000 \* Math.pow(2, attempt));  
    const jitter \= Math.random() \* 0.3 \* backoff;  
    await new Promise(r \=\> setTimeout(r, backoff \+ jitter));  
    try {  
      await connect();  
    } catch (err) {  
      await reconnect();  // Retry  
    }  
  };

  await connect();  
}

Exponential backoff with jitter caps at 60 seconds. Reconnection is automatic; no manual intervention unless DB is unreachable for \>10 minutes (which triggers a page).

## **§28.1 Caching strategy deviation box**

**Current-state deviation:** Per V8 audit, the caching pattern is not uniformly applied. V8 `EntitlementService` specifies the pattern correctly (§28-§29). Some other services use ad-hoc caches without invalidation, relying only on short TTLs. **Target-state:** §20-§28 — two-tier topology with LISTEN/NOTIFY invalidation for all cross-instance cache invalidation needs. **Migration path:** (1) Inventory existing ad-hoc caches in services. (2) For each, evaluate whether to adopt the two-tier \+ LISTEN/NOTIFY pattern (if cross-instance consistency matters) or remove the cache (if TTL is sufficient). (3) Add LISTEN loop starters to every service requiring cross-instance invalidation. **Cutover criteria:** (a) inventory documented; (b) every service using the pattern runs its LISTEN loop on startup; (c) invalidation tested end-to-end in staging (write → NOTIFY → all instances invalidate within 5s); (d) reconnection logic tested by forced DB restart. **Blocking conditions:** any cross-instance cache without LISTEN/NOTIFY invalidation (TTL-only); listener connection running through transaction-mode pooler (breaks LISTEN); reconnection logic untested against DB restart; any `NOTIFY` emitted before the writing transaction commits. **Completion proof:** staging tests show consistent cache invalidation across multi-instance deployment; no services still using ad-hoc short-TTL pattern for cross-instance data. Runbook in Doc 01.2.

---

# **Part IV — IdempotencyService**

Request-scoped deduplication. Ensures that client retries of mutations do not produce duplicate side effects. Canonical wrapper around Postgres-backed idempotency patterns already present in the repo.

## **§29 Interface and contract**

`IdempotencyService` answers: "Has this client key already been processed for this scope? If yes, what was the result?"

### **29.1 Design principles**

* **Scope-qualified.** An idempotency key like `"abc123"` means nothing in isolation. It means something within a scope like `stripe_webhook` or `practice_session_start`. Each scope has independent key namespaces.  
* **Content-hash verified.** The same key with different content is a client bug or an attack attempt. Returns 409 Conflict (§33).  
* **Retention per scope.** Different scopes have different retention windows (e.g., Stripe webhooks retained 30 days; practice sessions retained 7 days).  
* **Postgres-backed.** No external queue, no external cache. Pattern already proven in repo per V8 audit.

### **29.2 Why canonical JSON \+ SHA-256**

Content hashing is via canonical JSON (RFC 8785 JSON Canonicalization Scheme) \+ SHA-256. This is the industry standard (Stripe, AWS SDK, Cloudflare all use the same approach).

Canonical JSON means:

* Keys sorted alphabetically at every nesting level  
* No insignificant whitespace  
* Consistent number formatting  
* Consistent string escaping

Without canonicalization, `{"a": 1, "b": 2}` and `{"b": 2, "a": 1}` would hash differently despite being semantically identical — breaking idempotency checks.

## **§30 Method signatures**

interface IdempotencyService {  
  /\*\*  
   \* Primary method. Checks if the (scope, clientKey) has been processed.  
   \* If new: runs the handler, persists result, returns handler result.  
   \* If duplicate with same content hash: returns cached result without re-running handler.  
   \* If duplicate with different content hash: throws IdempotencyConflictError (409).  
   \*/  
  checkOrRecord\<T\>(params: {  
    scope: IdempotencyScope;  
    clientKey: string;  
    contentHash: string;  
    handler: () \=\> Promise\<T\>;  
    req?: AuthenticatedRequest;  
  }): Promise\<T\>;

  /\*\*  
   \* Utility for computing contentHash from a JSON-serializable payload.  
   \* Uses canonical JSON per RFC 8785\.  
   \*/  
  hashContent(payload: unknown): string;  
}

type IdempotencyScope \=  
  | 'stripe\_webhook'  
  | 'practice\_session\_start'  
  | 'tutor\_turn'  
  | 'exam\_submit'  
  | 'account\_deletion'  
  | 'guardian\_link\_request'  
  | 'calendar\_regenerate'  
  | ...;

class IdempotencyConflictError extends Error {  
  constructor(scope: string, clientKey: string) {  
    super(\`Idempotency conflict on ${scope}:${clientKey} — same key used with different content\`);  
  }  
}

## **§31 Storage pattern**

Single canonical table for all scopes:

CREATE TABLE idempotency\_records (  
  scope TEXT NOT NULL,  
  client\_key TEXT NOT NULL,  
  content\_hash TEXT NOT NULL,  
  result JSONB,  
  status TEXT NOT NULL CHECK (status IN ('completed', 'in\_progress', 'failed')),  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  completed\_at TIMESTAMPTZ,  
  expires\_at TIMESTAMPTZ NOT NULL,  
  PRIMARY KEY (scope, client\_key)  
);

CREATE INDEX idx\_idempotency\_expires ON idempotency\_records (expires\_at);  
CREATE INDEX idx\_idempotency\_scope\_status ON idempotency\_records (scope, status);

Single writer class: `IdempotencyService` is the canonical writer per V8 Appendix E pattern. Direct writes to this table from other code paths are violations.

## **§32 Execution flow**

async checkOrRecord\<T\>({ scope, clientKey, contentHash, handler }): Promise\<T\> {  
  // Attempt to insert a new in\_progress record  
  const { data: existing, error } \= await supabase  
    .from('idempotency\_records')  
    .insert({  
      scope,  
      client\_key: clientKey,  
      content\_hash: contentHash,  
      status: 'in\_progress',  
      expires\_at: now \+ config.idempotency.ttl\_by\_scope\[scope\]  
    })  
    .select()  
    .single();

  if (existing) {  
    // New record inserted — run the handler  
    try {  
      const result \= await handler();  
      await supabase  
        .from('idempotency\_records')  
        .update({ result, status: 'completed', completed\_at: now() })  
        .eq('scope', scope)  
        .eq('client\_key', clientKey);  
      return result;  
    } catch (err) {  
      await supabase  
        .from('idempotency\_records')  
        .update({ status: 'failed', completed\_at: now() })  
        .eq('scope', scope)  
        .eq('client\_key', clientKey);  
      throw err;  
    }  
  }

  // Insert failed due to unique constraint — record already exists  
  const { data: stored } \= await supabase  
    .from('idempotency\_records')  
    .select()  
    .eq('scope', scope)  
    .eq('client\_key', clientKey)  
    .single();

  if (stored.content\_hash \!== contentHash) {  
    throw new IdempotencyConflictError(scope, clientKey);  
  }

  if (stored.status \=== 'in\_progress') {  
    // Another request is processing this; wait or return 409 with retry-after  
    throw new IdempotencyInProgressError(scope, clientKey);  
  }

  if (stored.status \=== 'failed') {  
    // Previous attempt failed; allow retry by deleting and recursing  
    await supabase.from('idempotency\_records').delete().eq('scope', scope).eq('client\_key', clientKey);  
    return this.checkOrRecord({ scope, clientKey, contentHash, handler });  
  }

  // status \=== 'completed' with matching content — return cached result  
  return stored.result as T;  
}

## **§33 Conflict resolution — duplicate-different content**

Per author decision Q3 \= (a): when the same (scope, clientKey) arrives with a different content hash, respond with **409 Conflict**.

**HTTP response shape:**

{  
  "error": {  
    "code": "idempotency\_conflict",  
    "message": "Idempotency key already used with different content",  
    "scope": "practice\_session\_start",  
    "client\_key": "ps\_abc123"  
  }  
}

**Why 409 over alternatives:**

* Matches Stripe's `idempotency_key_in_use` behavior  
* Matches AWS SDK's `IdempotentParameterMismatchException`  
* Surfaces client-side bugs (reused key with modified payload) rather than silently masking them  
* Prevents attack vectors where an attacker replays a captured key with mutated payload

**Client handling:** Clients receiving 409 should generate a new idempotency key for the new payload. If the mismatch is a bug (client accidentally reused a key), the 409 makes the bug visible.

## **§34 TTL and retention per scope**

Retention is scope-specific, living in `idempotency_runtime_config.ttl_by_scope`:

| Scope | TTL | Rationale |
| ----- | ----- | ----- |
| `stripe_webhook` | 30 days | Stripe retries up to \~3 days; 30 days retention catches stragglers \+ provides audit window |
| `practice_session_start` | 7 days | Client retry windows for flaky connections; longer than any reasonable retry |
| `tutor_turn` | 7 days | Turn-level idempotency; retries during conversation |
| `exam_submit` | 90 days | High-stakes; longer retention for dispute resolution |
| `account_deletion` | 90 days | Sensitive operation; extended audit window |
| `guardian_link_request` | 7 days | Consent flow durability |
| `calendar_regenerate` | 24 hours | Frequent operation; short retention |

Expired records are purged by a daily cron (`idempotency_retention_cron`):

DELETE FROM idempotency\_records WHERE expires\_at \< now();

## **§35 Partial-failure recovery**

The `in_progress` status handles a subtle case: the handler started, but the client's connection dropped before receiving the response. On retry:

* **Handler still running:** Second request sees `status = 'in_progress'`. Returns `IdempotencyInProgressError` (typically surfaces as 409 with retry-after to the client).  
* **Handler completed successfully but response lost:** Second request sees `status = 'completed'`. Returns the cached result — client effectively receives the "lost" response.  
* **Handler failed:** Second request sees `status = 'failed'`. Allowed to retry by deleting the failed record and running the handler again.

This handling is why the service tracks `status`, not just presence/absence of the record.

## **§36 Consumed by (interfaces → consumers map)**

| Consumer | Scope | Purpose |
| ----- | ----- | ----- |
| V8 Stripe webhook handler (§22.2) | `stripe_webhook` | Dedupe Stripe event retries |
| V8 account deletion flow (§40.2.1) | `account_deletion` | Prevent double-delete on client retry |
| Doc 02B practice session start | `practice_session_start` | Prevent duplicate session rows on network retry |
| Doc 03B tutor turn submission | `tutor_turn` | Prevent duplicate tutor turns |
| Doc 02B exam submission | `exam_submit` | Prevent duplicate exam scoring |
| V8 guardian linking (§36) | `guardian_link_request` | Prevent duplicate link attempts |
| Future Doc 04 calendar regeneration | `calendar_regenerate` | Prevent duplicate regeneration on retry |

New scopes are added by:

1. Creating a config entry in `idempotency_runtime_config.ttl_by_scope`  
2. Using the new scope in a `checkOrRecord` call

No schema change required — all scopes share the `idempotency_records` table.

## **§37 Reference implementation**

Full pseudocode in Appendix C §C.2. The §32 inline shows the core flow; appendix expands with canonical JSON hashing utility, error classes, and cron purge logic.

## **§38 IdempotencyService deviation box**

**Current-state deviation:** Per V8 audit, Stripe webhook idempotency exists via `stripe_webhook_events` table with unique constraint. Practice session idempotency exists via `metadata.session_start_idempotency_key` pattern. No canonical `IdempotencyService` module wraps these; each use site implements idempotency directly. **Target-state:** §29-§37 — canonical `IdempotencyService` with scope-qualified keys, canonical JSON \+ SHA-256 content hashing, conflict detection, per-scope TTL. **Migration path:** (1) Create `packages/shared/services/idempotency-service.ts`. (2) Create `idempotency_records` table. (3) Migrate Stripe webhook handler to use `IdempotencyService.checkOrRecord` with `scope = 'stripe_webhook'`. (4) Migrate practice session start similarly. (5) Migrate remaining idempotency patterns. (6) Retire old per-site idempotency tables once migrated. **Cutover criteria:** (a) `idempotency_records` table created and populated for test scopes; (b) at least one production scope (Stripe webhook) migrated and operating for 7 days with zero duplicate processing; (c) 409 conflict tested with contrived mismatched-content scenarios in staging; (d) daily retention cron running. **Blocking conditions:** any mutation endpoint using the service but skipping content-hash verification; retention cron not running (table grows unbounded); direct writes to `idempotency_records` from any code path outside `IdempotencyService` (violates single-writer governance); 409 conflict behavior untested for at least one scope. **Completion proof:** all identified idempotency sites migrated to canonical service; legacy per-site tables dropped; production metrics show expected idempotency hit rate (typically 0.5-2% of requests are retries). Runbook in Doc 01.2.

---

# **Part V — RateLimitLedger**

Request-scoped quota enforcement. Wraps existing repo helper in canonical interface; adds abuse-score-weighted multipliers.

## **§39 Interface and contract**

`RateLimitLedger` answers: "Has this user exceeded their quota for this bucket? If yes, block. If not, count the current action."

### **39.1 Design principles**

* **Bucket-scoped.** Each rate limit is a bucket (e.g., `tutor_turns_daily`, `login_attempts`). Buckets have independent quotas.  
* **Abuse-weighted.** `AbuseScoreService` tier influences quota multipliers (§42).  
* **Postgres-backed ledger.** Proven pattern in repo per V8 audit (`apps/api/src/lib/rate-limit-ledger.ts`).  
* **Idempotent increments via cost parameter.** Allows batching (cost \> 1\) and rollback (§41).

### **39.2 Bucket naming**

Buckets follow the convention `<scope>_<timeframe>`:

* `tutor_turns_daily` — per-day tutor turn limit  
* `login_attempts_15min` — failed login attempts in 15-minute window  
* `password_reset_requests_hourly` — per-hour password reset emails  
* `guardian_link_attempts_daily` — per-day guardian link attempts  
* `calendar_regenerate_hourly` — per-hour calendar regeneration limit  
* `magic_link_requests_hourly` — per-hour magic link email requests  
* `api_requests_per_minute` — general API burst protection

## **§40 Method signatures**

interface RateLimitLedger {  
  /\*\*  
   \* Checks quota and increments if allowed.  
   \* Returns allowed flag \+ remaining quota \+ reset timestamp.  
   \*/  
  checkAndIncrement(params: {  
    studentId: string;  
    bucketKey: string;  
    cost?: number;  // defaults to 1  
    req?: AuthenticatedRequest;  
  }): Promise\<RateLimitResult\>;

  /\*\*  
   \* Rollback an increment (e.g., if the action fails after increment).  
   \*/  
  rollback(params: {  
    studentId: string;  
    bucketKey: string;  
    cost?: number;  
  }): Promise\<void\>;

  /\*\*  
   \* Read-only: get current usage and limit for a bucket.  
   \*/  
  getUsage(studentId: string, bucketKey: string): Promise\<{  
    used: number;  
    limit: number;  
    resetAt: Date;  
  }\>;  
}

type RateLimitResult \= {  
  allowed: boolean;  
  remaining: number;  
  limit: number;  
  resetAt: Date;  
  softWarning: boolean;  // true at ≥80% usage  
  retryAfterSeconds?: number;  // populated on denial  
};

## **§41 Postgres ledger implementation**

Ledger table:

CREATE TABLE rate\_limit\_ledger (  
  profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  
  bucket\_key TEXT NOT NULL,  
  window\_start TIMESTAMPTZ NOT NULL,  
  window\_end TIMESTAMPTZ NOT NULL,  
  used\_count INTEGER NOT NULL DEFAULT 0,  
  limit\_count INTEGER NOT NULL,  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  PRIMARY KEY (profile\_id, bucket\_key, window\_start)  
);

CREATE INDEX idx\_ratelimit\_window\_end ON rate\_limit\_ledger (window\_end);

Increment is via Postgres RPC (atomic):

CREATE OR REPLACE FUNCTION rate\_limit\_check\_and\_increment(  
  p\_profile\_id UUID,  
  p\_bucket\_key TEXT,  
  p\_cost INTEGER,  
  p\_window\_start TIMESTAMPTZ,  
  p\_window\_end TIMESTAMPTZ,  
  p\_limit INTEGER  
) RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, used INTEGER) AS $$  
BEGIN  
  INSERT INTO rate\_limit\_ledger (profile\_id, bucket\_key, window\_start, window\_end, used\_count, limit\_count)  
  VALUES (p\_profile\_id, p\_bucket\_key, p\_window\_start, p\_window\_end, p\_cost, p\_limit)  
  ON CONFLICT (profile\_id, bucket\_key, window\_start) DO UPDATE  
    SET used\_count \= rate\_limit\_ledger.used\_count \+ p\_cost,  
        updated\_at \= now()  
    WHERE rate\_limit\_ledger.used\_count \+ p\_cost \<= p\_limit  
  RETURNING rate\_limit\_ledger.used\_count AS used, (p\_limit \- rate\_limit\_ledger.used\_count) AS remaining, TRUE AS allowed;

  \-- If the update was filtered by the WHERE clause, return denial  
  IF NOT FOUND THEN  
    SELECT used\_count, (p\_limit \- used\_count), FALSE  
    INTO used, remaining, allowed  
    FROM rate\_limit\_ledger  
    WHERE profile\_id \= p\_profile\_id AND bucket\_key \= p\_bucket\_key AND window\_start \= p\_window\_start;  
    RETURN NEXT;  
  END IF;  
END;  
$$ LANGUAGE plpgsql;

**Atomicity:** The `INSERT ... ON CONFLICT DO UPDATE` with `WHERE` clause ensures the check and increment happen atomically at the DB level. No race between read and write.

## **§42 AbuseScore multiplier integration**

Quota limits are modulated by the user's `AbuseScoreService` tier (§48-§55):

async checkAndIncrement({ studentId, bucketKey, cost \= 1 }) {  
  const baseLimit \= config.rateLimits\[bucketKey\].limit;  
  const abuseScore \= await abuseScoreService.getScore(studentId);

  const effectiveLimit \= Math.floor(baseLimit \* abuseScore.multipliers.quota);

  // ... ledger call with effectiveLimit  
}

**Multiplier table (defaults, per `abuse_score_runtime_config.tier_multipliers`):**

| Tier | Quota multiplier |
| ----- | ----- |
| Clean (0-20) | 1.0 (full quota) |
| Flagged (21-40) | 0.75 |
| Concerning (41-60) | 0.50 |
| High-risk (61-80) | 0.25 |
| Critical (81-100) | 0 (blocked entirely) |

This makes abuse-tier enforcement continuous rather than binary — suspicious users are squeezed before being locked out.

## **§43 Soft warning at 80%**

When usage reaches 80% of limit, `RateLimitResult.softWarning = true`. Consumers can surface this to users ("You've used 80 of 100 tutor turns today") without blocking.

const result \= await rateLimiter.checkAndIncrement({ studentId, bucketKey: 'tutor\_turns\_daily' });  
if (result.softWarning) {  
  res.setHeader('X-RateLimit-Warning', \`Approaching limit: ${result.remaining} remaining\`);  
}

Soft warning threshold lives in `rate_limit_runtime_config.soft_warning_threshold_pct` (default 80).

## **§44 Hard limit — 429 response**

On denial:

{  
  "error": {  
    "code": "rate\_limit\_exceeded",  
    "message": "You've reached your limit for this action. Please try again later.",  
    "bucket": "tutor\_turns\_daily",  
    "limit": 100,  
    "resetAt": "2026-04-24T00:00:00Z",  
    "retryAfterSeconds": 14400,  
    "appealUrl": "https://lyceon.ai/support/rate-limit-appeal"  
  }  
}

HTTP response:

* Status: 429 Too Many Requests  
* Header: `Retry-After: 14400`  
* Header: `X-RateLimit-Limit: 100`  
* Header: `X-RateLimit-Remaining: 0`  
* Header: `X-RateLimit-Reset: 1745452800` (Unix timestamp)

## **§45 Rollback pattern**

If an action fails after increment (e.g., downstream error), roll back:

const result \= await rateLimiter.checkAndIncrement({ studentId, bucketKey: 'tutor\_turns\_daily' });  
if (\!result.allowed) return res.status(429).json({ error: ... });

try {  
  await processTutorTurn(...);  
} catch (err) {  
  await rateLimiter.rollback({ studentId, bucketKey: 'tutor\_turns\_daily' });  
  throw err;  
}

Rollback decrements the bucket. Rollbacks are best-effort — if rollback fails, the user has one fewer turn than expected but is not wrongly blocked.

## **§46 Consumed by**

| Consumer | Buckets | Purpose |
| ----- | ----- | ----- |
| V8 login flow (§11) | `login_attempts_15min` | Brute-force protection |
| V8 password reset (§12) | `password_reset_requests_hourly` | Abuse prevention |
| V8 magic link (§10) | `magic_link_requests_hourly` | Abuse prevention |
| V8 guardian linking (§36.2) | `guardian_link_attempts_daily` | Abuse prevention |
| Doc 03B tutor turns | `tutor_turns_daily` | Quota \+ abuse multiplier |
| Doc 02B practice (free tier) | `practice_daily_free` | Free-tier quota |
| Doc 02B exam submits | `exam_submits_hourly` | Abuse prevention |
| Future Doc 04 calendar | `calendar_regenerate_hourly` | Prevent regeneration spam |
| API gateway (global) | `api_requests_per_minute` | Burst protection |

## **§47 RateLimitLedger deviation box**

**Current-state deviation:** Per V8 audit, `apps/api/src/lib/rate-limit-ledger.ts` exists and implements the core ledger pattern. `server/lib/durable-rate-limiter.ts` is a separate helper used for guardian linking. No canonical `RateLimitLedger` interface wraps these; call sites use each helper directly. Abuse-score multiplier integration is absent (`AbuseScoreService` does not yet exist). **Target-state:** §39-§46 — canonical `RateLimitLedger` interface; single wrapper around the Postgres RPC ledger; abuse-score multipliers integrated; consistent response shape with soft warnings and 429 denial. **Migration path:** (1) Create `packages/shared/services/rate-limit-ledger.ts` wrapping existing RPC helper. (2) Consolidate `durable-rate-limiter.ts` into canonical wrapper. (3) Migrate all call sites. (4) Add abuse-score multiplier once `AbuseScoreService` is live. (5) Add soft-warning response header pattern. **Cutover criteria:** (a) canonical wrapper deployed; (b) all identified call sites migrated; (c) `RateLimitLedger` is the only path writing `rate_limit_ledger` table per V8 Appendix E governance; (d) abuse-score multiplier integration active once `AbuseScoreService` ships; (e) 429 response shape consistent across all rate-limited endpoints. **Blocking conditions:** any rate-limited endpoint using direct DB writes or the legacy helper instead of the canonical wrapper; 429 response missing `Retry-After` header; abuse-score multiplier bypassed after `AbuseScoreService` is live; bucket definition missing from `rate_limit_runtime_config.bucket_definitions`. **Completion proof:** grep shows no direct `rate_limit_ledger` writes outside the canonical wrapper; production 429 responses follow §44 shape; abuse-multiplier effect observable in metrics (low-tier users receive different effective limits). Runbook in Doc 01.2.

---

# **Part VI — AbuseScoreService**

Cross-product trust score for students. Feeds rate limiter multipliers (§42), entitlement gates (V8 §27.3 step 7), and high-risk action decisions. Greenfield — entirely new module, no existing repo equivalent.

## **§48 Purpose and scope**

`AbuseScoreService` maintains a per-student trust score (0-100) that reflects observed behavior patterns across the platform. The score feeds:

* Rate limiter multipliers (§42) — suspicious users get reduced quotas  
* Entitlement check (V8 §27.3 step 7\) — critical tier blocks entitlement-gated features  
* High-risk action gates (guardian linking, role switching, account deletion confirmations)  
* Internal trust & safety dashboards

**Cross-product:** incidents from any product surface contribute to the score. A student exhibiting suspicious behavior in practice gets tightened tutor quotas; a student farming calendar regenerations gets scored for it.

## **§49 Design principles**

* **Not visible to students.** Students do not see their abuse score (prevents gaming).  
* **Reversible via support override.** Per V8 §27.3.1, support can adjust scores.  
* **Weighted incidents with time decay.** Recent incidents count more; old incidents fade.  
* **Deterministic and auditable.** Scoring formula is spec'd; weights live in config.  
* **Cached with invalidation.** Score reads hit in-process cache per Part III pattern.

## **§50 Tier boundaries**

Score → tier mapping:

| Score range | Tier | Effect |
| ----- | ----- | ----- |
| 0-20 | `clean` | Full quota (1.0×) |
| 21-40 | `flagged` | 0.75× quota; logged for monitoring |
| 41-60 | `concerning` | 0.50× quota; step-up auth for sensitive actions |
| 61-80 | `high_risk` | 0.25× quota; manual review for elevated permissions |
| 81-100 | `critical` | Entitlement blocked per V8 §27.3 step 7; no new actions until manual review |

Tier boundaries and multipliers live in `abuse_score_runtime_config`. Weights are tunable; tier semantics are fixed.

## **§51 Interface**

interface AbuseScoreService {  
  /\*\*  
   \* Get current score and tier for a student.  
   \* Cached with 60s TTL \+ LISTEN/NOTIFY invalidation.  
   \*/  
  getScore(studentId: string, req?: AuthenticatedRequest): Promise\<AbuseScore\>;

  /\*\*  
   \* Record an incident that contributes to the score.  
   \* Triggers re-computation for severe incidents.  
   \*/  
  recordIncident(params: {  
    studentId: string;  
    incidentType: IncidentType;  
    severity: 1 | 2 | 3 | 4 | 5;  
    context?: Record\<string, unknown\>;  
  }): Promise\<void\>;

  /\*\*  
   \* Manual support override — adjust score with audit.  
   \* Per V8 §27.3.1 abuse lockout override path.  
   \*/  
  adjustScore(params: {  
    studentId: string;  
    newScore: number;  
    reason: string;  
    actorId: string;  
  }): Promise\<void\>;  
}

type AbuseScore \= {  
  studentId: string;  
  score: number;  
  tier: 'clean' | 'flagged' | 'concerning' | 'high\_risk' | 'critical';  
  multipliers: {  
    quota: number;  
    rate: number;  
  };  
  lastComputedAt: Date;  
};

## **§52 Incident taxonomy**

Launch taxonomy (12 incident types):

| Incident Type | Typical Severity | Description |
| ----- | ----- | ----- |
| `failed_login_burst` | 2 | Multiple failed logins in short window |
| `password_reset_spam` | 2 | Repeated password reset requests |
| `injection_attempt` | 5 | SQL injection or prompt injection detected |
| `retry_storm` | 3 | Excessive request retries beyond normal |
| `quota_farming` | 3 | Suspicious pattern of using exactly the free quota daily |
| `content_scraping` | 4 | Patterns indicating automated question extraction |
| `account_sharing_signal` | 4 | Same credential from many devices quickly |
| `payment_dispute` | 5 | Chargeback or fraud claim |
| `guardian_link_spam` | 3 | Attempting many guardian link requests |
| `tutor_prompt_abuse` | 3 | Repeated attempts to make tutor reveal internals |
| `deletion_retry_abuse` | 2 | Repeated deletion requests (possible confusion or abuse) |
| `role_switch_abuse` | 4 | Attempting role elevation through anomalous paths |

Incident types live in `abuse_score_runtime_config.incident_types` with associated base weights.

## **§53 Scoring algorithm**

The canonical formula:

score \= clamp(0, 100, Σᵢ \[severityᵢ × base\_weightᵢ × decay(days\_oldᵢ)\])

where:

decay(days\_old) \= exp(-days\_old / half\_life\_days)

Defaults (tunable in `abuse_score_runtime_config`):

* `base_weights` per incident type (example: `failed_login_burst = 3`, `injection_attempt = 25`, `content_scraping = 20`)  
* `half_life_days = 30` (an incident's weight halves every 30 days)  
* Score is computed nightly per student with any incidents in the last 180 days

**Worked example:**

Student has three incidents:

1. `failed_login_burst` (severity 2, 60 days ago, base\_weight 3\) → `2 × 3 × exp(-60/30) = 6 × 0.135 = 0.81`  
2. `tutor_prompt_abuse` (severity 4, 10 days ago, base\_weight 5\) → `4 × 5 × exp(-10/30) = 20 × 0.717 = 14.3`  
3. `injection_attempt` (severity 5, 3 days ago, base\_weight 25\) → `5 × 25 × exp(-3/30) = 125 × 0.905 = 113.1` → clamped to 100 contribution

Total: `0.81 + 14.3 + 100 = 115.1` → clamped → `100`

Tier: `critical`. Student is blocked from entitlement-gated features pending review.

## **§54 Computation cadence**

Two modes:

### **Real-time (severe incidents)**

For incidents with severity ≥ 4, scoring is recomputed immediately on `recordIncident`:

async recordIncident({ studentId, incidentType, severity, context }) {  
  await persistIncident(studentId, incidentType, severity, context);

  if (severity \>= config.abuse.realtime\_threshold) {  
    const newScore \= await computeScore(studentId);  
    await persistScore(studentId, newScore);  
    await notifyInvalidate(studentId);  // NOTIFY abuse\_score\_invalidate  
  }  
}

### **Nightly batch (time decay)**

A nightly cron recomputes scores for all students with incidents in the last 180 days. This applies time decay:

\-- abuse\_score\_nightly\_cron  
SELECT student\_id FROM abuse\_score\_incidents  
WHERE created\_at \> now() \- interval '180 days'  
GROUP BY student\_id;  
\-- For each, call computeScore() and persist \+ NOTIFY

## **§55 Storage schema**

CREATE TABLE abuse\_score\_incidents (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  
  incident\_type TEXT NOT NULL,  
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),  
  context JSONB,  
  detected\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  source\_module TEXT NOT NULL  \-- which service recorded this  
);

CREATE INDEX idx\_abuse\_incidents\_student ON abuse\_score\_incidents (student\_profile\_id, detected\_at DESC);  
CREATE INDEX idx\_abuse\_incidents\_type ON abuse\_score\_incidents (incident\_type, detected\_at DESC);

CREATE TABLE abuse\_scores (  
  student\_profile\_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,  
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),  
  tier TEXT NOT NULL,  
  computed\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  manual\_override BOOLEAN DEFAULT FALSE,  
  manual\_override\_expires\_at TIMESTAMPTZ,  
  appeal\_history JSONB DEFAULT '\[\]'::jsonb  
);

CREATE INDEX idx\_abuse\_scores\_tier ON abuse\_scores (tier) WHERE tier \!= 'clean';

**Governance classes** (per V8 Appendix E pattern):

* `abuse_score_incidents`: **shared append-only** — multiple services insert; UPDATE/DELETE prohibited at schema level  
* `abuse_scores`: **single-writer** — only `AbuseScoreService` writes

## **§56 Manual override and appeal**

Per V8 §27.3.1, support can override scores:

async adjustScore({ studentId, newScore, reason, actorId }) {  
  const current \= await this.getScore(studentId);

  await supabase.from('abuse\_scores').update({  
    score: newScore,  
    tier: computeTier(newScore),  
    manual\_override: true,  
    manual\_override\_expires\_at: now \+ config.abuse.manual\_override\_respect\_days\_ms,  
    appeal\_history: sql\`appeal\_history || ${JSON.stringify({  
      at: now(),  
      actor\_id: actorId,  
      prior\_score: current.score,  
      new\_score: newScore,  
      reason  
    })}::jsonb\`  
  }).eq('student\_profile\_id', studentId);

  await auditLog.emit({ action: 'abuse\_score\_adjusted', target: studentId, actor: actorId, context: { reason, prior: current.score, new: newScore } });  
  await this.notifyInvalidate(studentId);  
}

**Manual override respect window:** per V8 §27.3.1, nightly batch recomputation does not override manual adjustments within the window (default 30 days, `abuse_score_runtime_config.manual_override_respect_days`).

Appeal history is persisted in `abuse_scores.appeal_history` JSONB array. Every adjustment appends.

## **§57 Student visibility — explicitly none**

Per §49, students do not see their abuse score. Specifically:

* No API endpoint exposes score to student JWTs  
* No dashboard element shows the score  
* Rate limiter denials say "you've reached your limit" without referencing score or tier  
* Entitlement denials say "access currently unavailable" without revealing the `abuse_score_lockout` reason code

**Why:** Making the score visible enables gaming (users learning which actions move the score; users reverse-engineering the scoring). Trust and safety tools work best when adversaries cannot directly observe their score.

**Support can see it:** admin dashboards show the score for escalation purposes. This is appropriate because support access is audited per V8 §44.

## **§58 Appeal process (V1)**

V1 appeals are fully manual:

1. User hit by score-related denial (e.g., can't access tutor due to critical tier)  
2. User contacts support via support form  
3. Support reviews incident history visible in admin dashboard  
4. Support decides whether to override via `adjustScore`  
5. If override granted, score is adjusted; user notified of restoration

V2 target (not V1): automated appeal workflow with structured user input and ML-assisted triage. Not in V1 scope.

## **§59 Reference implementation**

Full pseudocode in Appendix C §C.3. Core structure:

// packages/shared/services/abuse-score-service.ts

export class AbuseScoreService {  
  private cache \= new Map\<string, CacheEntry\<AbuseScore\>\>();

  async getScore(studentId: string): Promise\<AbuseScore\> {  
    const cached \= this.cache.get(studentId);  
    if (cached && cached.expiresAt \> Date.now()) return cached.value;

    const { data } \= await supabase  
      .from('abuse\_scores')  
      .select()  
      .eq('student\_profile\_id', studentId)  
      .single();

    const score: AbuseScore \= data  
      ? {  
          studentId,  
          score: data.score,  
          tier: data.tier,  
          multipliers: this.computeMultipliers(data.tier),  
          lastComputedAt: new Date(data.computed\_at)  
        }  
      : this.cleanScoreDefault(studentId);

    this.cache.set(studentId, {  
      value: score,  
      expiresAt: Date.now() \+ config.abuse.cache\_ttl\_ms,  
      hardStaleAt: Date.now() \+ config.abuse.cache\_hard\_staleness\_ms  
    });

    return score;  
  }

  async recordIncident({ studentId, incidentType, severity, context }) {  
    await supabase.from('abuse\_score\_incidents').insert({  
      student\_profile\_id: studentId,  
      incident\_type: incidentType,  
      severity,  
      context,  
      source\_module: currentModuleName()  
    });

    metrics.counter('abuse\_score\_incident\_recorded', { incident\_type: incidentType });

    if (severity \>= config.abuse.realtime\_threshold) {  
      await this.recomputeAndPersist(studentId);  
      await this.notifyInvalidate(studentId);  
    }  
  }

  async adjustScore({ studentId, newScore, reason, actorId }) {  
    // ... per §56  
  }

  private async recomputeAndPersist(studentId: string): Promise\<void\> {  
    const score \= await this.computeScore(studentId);  
    await supabase.from('abuse\_scores').upsert({  
      student\_profile\_id: studentId,  
      score,  
      tier: this.computeTier(score),  
      computed\_at: new Date()  
    });  
  }

  private async computeScore(studentId: string): Promise\<number\> {  
    const { data: incidents } \= await supabase  
      .from('abuse\_score\_incidents')  
      .select('incident\_type, severity, detected\_at')  
      .eq('student\_profile\_id', studentId)  
      .gte('detected\_at', new Date(Date.now() \- 180 \* 86400 \* 1000));

    const weights \= config.abuse.base\_weights;  
    const halfLifeDays \= config.abuse.half\_life\_days;

    const total \= incidents.reduce((sum, inc) \=\> {  
      const daysOld \= (Date.now() \- new Date(inc.detected\_at).getTime()) / 86400000;  
      const decay \= Math.exp(-daysOld / halfLifeDays);  
      const contribution \= inc.severity \* (weights\[inc.incident\_type\] ?? 1\) \* decay;  
      return sum \+ contribution;  
    }, 0);

    return Math.min(100, Math.max(0, Math.round(total)));  
  }

  private computeTier(score: number): AbuseScore\['tier'\] {  
    if (score \<= 20\) return 'clean';  
    if (score \<= 40\) return 'flagged';  
    if (score \<= 60\) return 'concerning';  
    if (score \<= 80\) return 'high\_risk';  
    return 'critical';  
  }

  private computeMultipliers(tier: string) {  
    return config.abuse.tier\_multipliers\[tier\];  
  }  
}

// Nightly cron  
export async function nightlyAbuseScoreRecompute() {  
  const { data: students } \= await supabase  
    .from('abuse\_score\_incidents')  
    .select('student\_profile\_id')  
    .gte('detected\_at', new Date(Date.now() \- 180 \* 86400 \* 1000))  
    .eq('manual\_override', false);  // skip manual overrides within respect window

  // Deduplicate, batch, recompute each  
  for (const { student\_profile\_id } of dedupe(students)) {  
    await abuseScoreService.recomputeAndPersist(student\_profile\_id);  
  }  
}

## **§60 AbuseScoreService deviation box**

**Current-state deviation:** Greenfield. No existing `AbuseScoreService` or equivalent module in repo. V8 references it; V8 launch depends on 01A delivering it. **Target-state:** §48-§59 — canonical service with scoring algorithm, incident taxonomy, cached reads with LISTEN/NOTIFY invalidation, support override path, nightly batch recompute. **Migration path:** (1) Create `abuse_score_incidents` and `abuse_scores` tables with ownership class enforcement. (2) Create `packages/shared/services/abuse-score-service.ts`. (3) Integrate `recordIncident` calls into services that detect incidents (auth layer, tutor, practice, etc.). (4) Integrate `getScore` into `RateLimitLedger` for multipliers. (5) Integrate `getScore` into V8 `EntitlementService.canAccessFeature` for tier check. (6) Deploy nightly batch recompute cron. (7) Populate `abuse_score_runtime_config` with launch weights and tier boundaries. **Cutover criteria:** (a) tables exist with schema-level governance enforcement; (b) service deployed and tested in staging with synthetic incidents producing expected score transitions; (c) integration points (RateLimitLedger, EntitlementService) consuming scores successfully; (d) nightly cron running and producing score updates; (e) support override flow tested. **Blocking conditions:** scoring formula not reproducible from config (indicates weights not properly externalized); integration points still using hardcoded tier checks rather than consulting service; override path not tested. **Completion proof:** staging scenarios demonstrate all 5 tier transitions; incidents feed scores predictably; support override restores access within 60s (cache TTL); nightly recompute updates scores for decayed incidents. Runbook in Doc 01.2.

---

# **Part VII — Internal Service Auth (HMAC)**

Service-to-service authentication for internal calls. Greenfield — audit flagged as missing. Required for future internal jobs (audit archival, compaction, hard-delete cron) and any service-to-service paths that emerge.

## **§61 Purpose and threat model**

Internal services (cron jobs, workers, admin tools, future microservices) need to authenticate to each other without relying on user sessions. Without a canonical pattern, internal services often use:

* Shared secret tokens (not rotated)  
* IP allow-lists (brittle, wrong for serverless)  
* No authentication (trusting network isolation)

**Threat:** if any internal service is compromised, unauthenticated peer services become compromised with it. Even a misconfigured staging endpoint could call production peers.

**Defense:** HMAC-SHA256 signed requests with timestamp binding and rotating per-service-pair secrets.

## **§62 Signing convention**

Every internal request carries three headers:

* `X-Lyceon-Service-Id` — identifier of the calling service (e.g., `deletion-cron`, `audit-archiver`)  
* `X-Lyceon-Timestamp` — ISO 8601 timestamp of the request  
* `X-Lyceon-Signature-V1` — HMAC-SHA256 signature

### **62.1 Signing string construction**

The string to sign:

\<HTTP\_METHOD\>\\n\<URL\_PATH\>\\n\<TIMESTAMP\>\\n\<SHA256\_OF\_BODY\>

Example:

POST  
/api/internal/audit-archive/run  
2026-04-23T21:34:56Z  
a3f5c8b9d2e1f4a7b6c9d8e2f1a4b7c5e8d9f2a1b4c7d8e5f2a1b4c7d8e5f2a1

Body hash is SHA-256 of the raw request body bytes (empty string hash if no body).

### **62.2 Signature generation**

const signingString \= \`${method}\\n${path}\\n${timestamp}\\n${bodyHash}\`;  
const signature \= hmac('sha256', secret, signingString).toString('hex');

Caller sets `X-Lyceon-Signature-V1: <signature>`.

## **§63 Verification**

Receiver verification:

export function verifyInternalRequest(req): void {  
  const serviceId \= req.headers\['x-lyceon-service-id'\];  
  const timestamp \= req.headers\['x-lyceon-timestamp'\];  
  const signature \= req.headers\['x-lyceon-signature-v1'\];

  if (\!serviceId || \!timestamp || \!signature) {  
    throw new UnauthorizedError('Missing internal auth headers');  
  }

  // Check timestamp tolerance (prevent replay)  
  const timestampDate \= new Date(timestamp);  
  if (isNaN(timestampDate.getTime())) {  
    throw new UnauthorizedError('Invalid timestamp');  
  }  
  const skewMs \= Math.abs(Date.now() \- timestampDate.getTime());  
  if (skewMs \> config.internal\_service\_auth.timestamp\_tolerance\_ms) {  
    throw new UnauthorizedError('Timestamp outside tolerance window');  
  }

  // Look up secret(s) for this service pair  
  const secrets \= await loadServiceSecrets(serviceId, currentServiceName);  
  if (secrets.length \=== 0\) {  
    throw new UnauthorizedError('Unknown service pair');  
  }

  // Compute expected signature  
  const bodyHash \= crypto.createHash('sha256').update(req.rawBody ?? '').digest('hex');  
  const signingString \= \`${req.method}\\n${req.path}\\n${timestamp}\\n${bodyHash}\`;

  // Try each active secret (supports rotation overlap)  
  const valid \= secrets.some(secret \=\> {  
    const expected \= crypto.createHmac('sha256', secret).update(signingString).digest('hex');  
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));  
  });

  if (\!valid) {  
    throw new UnauthorizedError('Invalid signature');  
  }  
}

**Constant-time comparison** via `crypto.timingSafeEqual` prevents timing attacks.

## **§64 Secret management**

Per-service-pair secrets stored in a dedicated table, not in config:

CREATE TABLE service\_auth\_secrets (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  caller\_service TEXT NOT NULL,  
  callee\_service TEXT NOT NULL,  
  secret\_material TEXT NOT NULL,  \-- base64-encoded random bytes  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  active\_until TIMESTAMPTZ NOT NULL,  
  revoked\_at TIMESTAMPTZ,  
  UNIQUE (caller\_service, callee\_service, created\_at)  
);

CREATE INDEX idx\_service\_auth\_active ON service\_auth\_secrets (caller\_service, callee\_service)  
  WHERE revoked\_at IS NULL;

**Governance class:** `service_auth_secrets` is **single-writer** — only admin/ops tooling writes. Runtime services read.

**Secrets themselves:**

* 256 bits (32 bytes) of random material  
* Generated via `crypto.randomBytes(32)`  
* Stored base64-encoded  
* Never logged, never emitted in metrics, never exposed via API

## **§65 Rotation cadence**

**Default: 90-day rotation** per `internal_service_auth_config.rotation_cadence_days`.

### **65.1 Rotation procedure**

1. Generate new secret  
2. Insert new row with `active_until = now + 180 days`  
3. Update existing row's `active_until = now + 14 days` (overlap window)  
4. Both secrets are active for the next 14 days  
5. After 14 days, set old row's `revoked_at = now()`  
6. Cron job purges rows where `revoked_at < now - 7 days`

### **65.2 Why overlapping validity**

During rotation, callers may still hold the old secret (cached, in-flight requests, deploying new code). A hard cutover risks outages. The 14-day overlap gives callers time to pick up the new secret without a service interruption.

## **§66 Timestamp tolerance**

Requests with timestamps more than `timestamp_tolerance_ms` (default: 5 minutes \= 300\_000 ms) from the receiver's clock are rejected.

**Why:** prevents replay attacks. An attacker who captures a valid signed request has at most 5 minutes to replay it before the timestamp makes the request invalid.

**Clock skew considerations:** cloud services occasionally experience clock skew. 5 minutes is generous. Tighter tolerances (1 minute) are recommended once observability confirms clocks are reliable.

## **§67 Failure responses**

All internal auth failures return `401 Unauthorized` with a minimal response — do not leak diagnostic info:

{  
  "error": {  
    "code": "internal\_auth\_failed",  
    "message": "Internal authentication failed"  
  }  
}

Specific failure reasons are logged server-side at `WARN` level (missing headers, timestamp skew, unknown service pair, bad signature), but the response body does not distinguish.

## **§68 Consumed by**

| Caller | Callee | Purpose |
| ----- | ----- | ----- |
| Deletion cron job | Main API | Hard-delete execution per V8 §40.5 |
| Audit archival job | Main API | Move `audit_logs` rows to cold storage per V8 §5.1 |
| Memory compaction worker (Doc 03C) | Main API | Persist compacted tutor memory summaries |
| Nightly abuse score recompute | Main API | Persist score updates per §54 |
| Idempotency retention cron | Main API | Purge expired idempotency records per §34 |
| Admin tooling (when programmatic) | Main API | Ops operations with service-account auth |

**Not applicable:** user-facing API requests. Those use user authentication per Doc 01 V8. Internal auth is strictly for service-to-service.

## **§69 No public exposure**

Internal auth endpoints must not be accessible from the public internet. Enforcement:

* Endpoints hosted under `/api/internal/*` route prefix  
* Reverse proxy / Cloud Run ingress configured to reject `/api/internal/*` requests from public sources  
* Defense-in-depth: even if public access leaked through, HMAC verification still required; unauthenticated requests are rejected

## **§70 Reference implementation**

Full pseudocode in Appendix C §C.4. Core verification and signing utilities:

// packages/shared/internal-auth/sign-request.ts

export async function signInternalRequest(  
  method: string,  
  url: string,  
  body: string | null,  
  callerService: string,  
  calleeService: string  
): Promise\<{ headers: Record\<string, string\> }\> {  
  const timestamp \= new Date().toISOString();  
  const bodyHash \= body  
    ? crypto.createHash('sha256').update(body).digest('hex')  
    : crypto.createHash('sha256').update('').digest('hex');  
  const path \= new URL(url).pathname;

  const signingString \= \`${method}\\n${path}\\n${timestamp}\\n${bodyHash}\`;

  const secret \= await loadActiveSecret(callerService, calleeService);  
  const signature \= crypto.createHmac('sha256', secret)  
    .update(signingString)  
    .digest('hex');

  return {  
    headers: {  
      'X-Lyceon-Service-Id': callerService,  
      'X-Lyceon-Timestamp': timestamp,  
      'X-Lyceon-Signature-V1': signature  
    }  
  };  
}

// packages/shared/internal-auth/verify-middleware.ts

export function internalAuthMiddleware(calleeService: string) {  
  return async (req, res, next) \=\> {  
    try {  
      await verifyInternalRequest(req, calleeService);  
      next();  
    } catch (err) {  
      logger.warn('internal\_auth\_rejected', {  
        reason: err.message,  
        caller: req.headers\['x-lyceon-service-id'\]  
      });  
      return res.status(401).json({  
        error: { code: 'internal\_auth\_failed', message: 'Internal authentication failed' }  
      });  
    }  
  };  
}

## **§71 Internal service auth deviation box**

**Current-state deviation:** Greenfield per V8 audit. Internal services do not currently use a consistent auth mechanism. Some rely on network isolation (Cloud Run IAM); others use no authentication. No canonical signing convention exists. **Target-state:** §61-§70 — HMAC-SHA256 request signing with timestamp binding, per-service-pair secrets, 90-day rotation with overlap, timing-safe verification. **Migration path:** (1) Create `service_auth_secrets` table with governance enforcement. (2) Create `packages/shared/internal-auth/` utilities (signing, verification, middleware). (3) Identify all current and planned internal service-to-service paths; inventory them. (4) For each path, generate initial secrets and deploy signing in caller \+ verification in callee. (5) Enable reverse-proxy enforcement that `/api/internal/*` is not publicly accessible. (6) Set up rotation automation. **Cutover criteria:** (a) signing and verification utilities deployed; (b) at least one internal path (e.g., deletion cron → API) operating with HMAC auth in staging; (c) rotation tested — overlap window validated by rotating a test secret; (d) timestamp tolerance enforced (test with deliberately skewed timestamp); (e) reverse-proxy rejection of public `/api/internal/*` tested. **Blocking conditions:** any service-to-service path still using unauthenticated or shared-bearer auth; `service_auth_secrets` not governed as single-writer; rotation automation absent. **Completion proof:** every internal path signs and verifies; secrets rotated on schedule; staging tests reject requests with invalid signatures, expired timestamps, revoked secrets. Runbook in Doc 01.2.

---

# **Part VIII — Cross-Document Integration**

## **§72 Interfaces provided by 01A**

| 01A Primitive | Consumed by | Usage |
| ----- | ----- | ----- |
| Config doctrine \+ `*_runtime_config` tables | Every doc | Tunable runtime values |
| Logger \+ metrics interface (Part II) | Every doc | Structured observability |
| LISTEN/NOTIFY caching pattern (Part III) | V8 `EntitlementService`, 01A `AbuseScoreService`, future caches | Cross-instance invalidation |
| `IdempotencyService.checkOrRecord` | V8 Stripe webhook, V8 account deletion, Doc 02B practice/exam, Doc 03B tutor, Doc 04 calendar | Mutation deduplication |
| `RateLimitLedger.checkAndIncrement` | V8 login/password-reset/guardian-link, Doc 02B practice/exam, Doc 03B tutor, Doc 04 calendar, API gateway | Quota enforcement |
| `AbuseScoreService.getScore` | V8 `EntitlementService` (tier check), 01A `RateLimitLedger` (multipliers), admin dashboards | Trust-weighted decisions |
| `AbuseScoreService.recordIncident` | Auth layer, tutor, practice, exam, calendar, billing — any service that detects incidents | Incident signal emission |
| `AbuseScoreService.adjustScore` | V8 §44 support-mediated operations | Manual override path |
| Internal service auth (Part VII) | Cron jobs, workers, admin tooling → main API | Service-to-service authentication |

## **§73 Consumption by Doc 01 V8**

Per V8 §43 and the individual sections throughout:

| V8 Consumer | 01A Primitive | Section |
| ----- | ----- | ----- |
| V8 Stripe webhook handler | `IdempotencyService` | V8 §22.2 |
| V8 login | `RateLimitLedger` (`login_attempts_15min`) | V8 §11 |
| V8 password reset | `RateLimitLedger` (`password_reset_requests_hourly`) | V8 §12.1 |
| V8 magic link | `RateLimitLedger` (`magic_link_requests_hourly`) | V8 §10 |
| V8 guardian linking | `RateLimitLedger` (`guardian_link_attempts_daily`) | V8 §36.2 |
| V8 `EntitlementService` | LISTEN/NOTIFY caching pattern | V8 §28-§29 |
| V8 `EntitlementService` tier check | `AbuseScoreService.getScore` | V8 §27.3 step 7 |
| V8 high-risk identity actions | `AbuseScoreService.recordIncident` | Role switch anomalies, repeated failures |
| V8 support-mediated abuse lockout override | `AbuseScoreService.adjustScore` | V8 §27.3.1 |
| V8 logging | Logger \+ metrics (Part II) | Throughout |
| V8 constants | Config doctrine (Part I) | V8 Appendix A |

## **§74 Consumption by feature docs**

| Feature doc | 01A primitives | Primary usage |
| ----- | ----- | ----- |
| Doc 02A (Question Generation) | Config, Observability | Generation pipeline instrumentation |
| Doc 02B (Runtime Engines) | IdempotencyService, RateLimitLedger, AbuseScoreService, Observability | Session start, answer submit, exam submit idempotency; quota enforcement; incident detection |
| Doc 02C (Mastery) | Observability, Config | Scoring observability |
| Doc 03A (Tutor Runtime) | Caching, Observability, Config | Memory and context caching patterns |
| Doc 03B (Tutor API) | IdempotencyService, RateLimitLedger, AbuseScoreService, Observability | Turn idempotency, quota, prompt abuse detection |
| Doc 03C (Tutor Orchestration) | Internal Service Auth, Observability | Cron-to-API auth for compaction |
| Future Doc 04 (Calendar) | IdempotencyService, RateLimitLedger | Regeneration idempotency and quota |
| Future Doc 05 (Growth) | Observability | Instrumentation |
| Future Doc 06 (Multi-exam) | All of the above | Consumes primitive interfaces unchanged |

## **§74A Per-service performance budgets (SLOs)**

Every 01A primitive sits on a hot path. Drift in latency budgets is an architectural signal, not a performance-tuning afterthought. Budgets below are launch-target SLOs; V8 §45A patterns for identity-path SLOs are extended here for cross-cutting primitives. Violations are treated as architectural issues, not tuning issues.

**Disclaimer:** these are launch-target budgets derived from the architecture (in-process cache hit, single Postgres round-trip fallback). Post-launch production measurement will supersede these numbers; any material deviation triggers a review of the relevant primitive's caching or query shape rather than a config tweak.

| Primitive | Operation | P50 target | P95 target | P99 target | Alert threshold |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Config (Part I) | `getConfig(table, key)` in-process read | \<50µs | \<200µs | \<500µs | P99 \> 2ms for 5 minutes |
| Config (Part I) | Cold-start `loadAllConfig()` | \<2s | \<5s | \<10s | Startup \>15s (service unhealthy) |
| Observability (Part II) | `logger.info(...)` write-through | \<100µs | \<500µs | \<2ms | P99 \> 10ms (blocking log call) |
| Observability (Part II) | `metrics.counter/histogram` emit | \<50µs | \<200µs | \<1ms | P99 \> 5ms |
| Caching (Part III) | Cache hit (tier 1, in-process) | \<50µs | \<200µs | \<500µs | P99 \> 2ms |
| Caching (Part III) | Cache miss → Postgres fallback | \<5ms | \<20ms | \<50ms | P99 \> 100ms |
| Caching (Part III) | NOTIFY → all instances invalidated | \<500ms | \<2s | \<5s | P99 \> 10s |
| IdempotencyService (Part IV) | `checkOrRecord` fresh (insert \+ handler \+ update) | handler-bound | handler-bound | handler-bound | — (dominated by handler) |
| IdempotencyService (Part IV) | `checkOrRecord` cached hit (completed status) | \<5ms | \<15ms | \<50ms | P99 \> 100ms |
| IdempotencyService (Part IV) | `checkOrRecord` conflict (409 path) | \<5ms | \<15ms | \<50ms | P99 \> 100ms |
| RateLimitLedger (Part V) | `checkAndIncrement` atomic RPC | \<5ms | \<20ms | \<50ms | P99 \> 100ms |
| RateLimitLedger (Part V) | `getUsage` read | \<5ms | \<15ms | \<50ms | P99 \> 100ms |
| AbuseScoreService (Part VI) | `getScore` cached hit | \<50µs | \<200µs | \<500µs | P99 \> 2ms |
| AbuseScoreService (Part VI) | `getScore` cache miss → DB | \<10ms | \<30ms | \<100ms | P99 \> 200ms |
| AbuseScoreService (Part VI) | `recordIncident` non-real-time (severity \<4) | \<10ms | \<30ms | \<100ms | P99 \> 200ms |
| AbuseScoreService (Part VI) | `recordIncident` real-time recompute (severity ≥4) | \<50ms | \<200ms | \<500ms | P99 \> 1s |
| AbuseScoreService (Part VI) | Nightly batch recompute per student | \<100ms | \<500ms | \<2s | Batch duration \> 30 minutes for baseline student count |
| Internal Service Auth (Part VII) | `signInternalRequest` | \<5ms | \<15ms | \<50ms | P99 \> 100ms (secret load dominates) |
| Internal Service Auth (Part VII) | `verifyInternalRequest` | \<5ms | \<15ms | \<50ms | P99 \> 100ms |

**Enforcement:**

* Alert thresholds live in `observability_runtime_config.alert_thresholds` per §18  
* Each 01A service emits `<service>_operation_latency_ms` histogram per §15 naming convention  
* Dashboards show per-operation percentiles; budget violations surface automatically  
* SLO breach in production triggers Warn-level alert; sustained (\>1hr) breach triggers Page

**Budget revision:** post-launch measurement informs revision. First scheduled revision: 90 days after launch. Major architectural changes (e.g., adding Redis, changing pooler, read-replica adoption) trigger immediate revision.

---

# **Part IX — Acceptance Criteria**

## **§75 Launch-blocking items**

**Config doctrine (Part I):**

* \[ \] CI lint rejects magic numbers outside annotated exceptions  
* \[ \] Every `*_runtime_config` table has matching `_history` audit table  
* \[ \] LISTEN/NOTIFY config invalidation triggers deployed  
* \[ \] Invalidation listener running in every service with config consumption

**Observability (Part II):**

* \[ \] Zero `console` calls in non-test production code (CI enforced)  
* \[ \] Correlation ID middleware on all API routes  
* \[ \] `request_id` threaded through async job enqueues and webhook-derived work  
* \[ \] PII redaction transport layer active  
* \[ \] Metric naming convention enforced

**Caching strategy (Part III):**

* \[ \] V8 `EntitlementService` operating with LISTEN/NOTIFY invalidation in production  
* \[ \] Any other cross-instance caches adopt the two-tier pattern  
* \[ \] Listener reconnection logic tested by induced DB restart

**IdempotencyService (Part IV):**

* \[ \] `idempotency_records` table created  
* \[ \] `IdempotencyService` deployed and consumed by Stripe webhook handler  
* \[ \] 409 conflict tested in staging  
* \[ \] Daily retention cron running

**RateLimitLedger (Part V):**

* \[ \] Canonical wrapper over existing helper deployed  
* \[ \] All V8 rate-limited endpoints using canonical interface  
* \[ \] Abuse-score multiplier integration active  
* \[ \] 429 response shape consistent across endpoints

**AbuseScoreService (Part VI):**

* \[ \] `abuse_score_incidents` and `abuse_scores` tables created with governance class enforcement  
* \[ \] Service deployed with cached reads  
* \[ \] Integration with `RateLimitLedger` multipliers active  
* \[ \] Integration with V8 `EntitlementService.canAccessFeature` (tier check) active  
* \[ \] Nightly batch recompute running  
* \[ \] Support `adjustScore` path tested

**Internal service auth (Part VII):**

* \[ \] `service_auth_secrets` table created with single-writer governance  
* \[ \] HMAC signing and verification utilities deployed  
* \[ \] At least one internal path operational with HMAC auth  
* \[ \] Rotation automation tested  
* \[ \] Reverse-proxy rejection of public `/api/internal/*` verified

## **§76 Migration checklist from current state**

Per the deviation boxes throughout, high-level migration order:

1. **Foundational (Week 1-2):** Config doctrine lint \+ `_history` tables; observability logger migration; correlation ID middleware  
2. **Core services (Week 2-4):** `IdempotencyService` deployment and Stripe webhook migration; `RateLimitLedger` wrapper and call-site migration  
3. **Greenfield services (Week 3-5):** `AbuseScoreService` tables, service, cron; Internal service auth tables, utilities, first integration  
4. **Integration (Week 5-6):** V8 `EntitlementService` \+ `AbuseScoreService` integration; `RateLimitLedger` \+ `AbuseScoreService` multipliers  
5. **Verification (Week 6-7):** end-to-end staging tests, cutover criteria validation

Exact schedule lives in project plan, not spec. Per-service migration runbooks in Doc 01.2.

---

# **Part X — Governance**

## **§77 Review triggers**

01A must be reviewed when:

* Doc 00 platform invariants change  
* New cross-cutting primitive identified that needs canonical treatment  
* Industry pattern shift (e.g., Redis added, new pooler, new auth approach)  
* Security audit finds primitive gap  
* Post-launch scale demands architectural change in any primitive  
* Mobile app introduces new primitive needs (e.g., push notification service)  
* Neon connection pooling resolution enables architecture shifts

## **§78 Lock semantics**

"Locked" means:

* 01A interfaces are authoritative for implementation  
* Changes require explicit version update with change record  
* Consumer docs can rely on interface stability  
* Silent drift in code or DB is not allowed  
* Feature docs reference 01A interfaces; changes to 01A interfaces trigger feature doc review

Post-lock, additive clarification is allowed. Behavior-changing changes require explicit review and version bump.

## **§79 Adding new platform primitives**

If a new primitive is needed (e.g., a message queue, a distributed lock service, a feature flag system), it is added here through this process:

1. Propose the primitive with rationale: what problem does it solve? Why is it cross-cutting? Why can't feature docs solve it individually?  
2. Define the canonical interface  
3. Define storage, failure modes, observability integration, config integration  
4. Identify consumer set  
5. Add to 01A as a new Part  
6. Bump 01A minor version

New primitives do not reopen existing parts unless the new primitive interacts with them.

## **§80 Migration rule**

If live DB or repo contracts differ from 01A:

1. Log the discrepancy with audit finding  
2. Determine canonical truth (spec or production)  
3. Update whichever is wrong  
4. Document reconciliation in change records

01A must not silently drift from deployed reality. Current-state deviation boxes document known gaps; new discoveries require updating the deviation box or closing the gap.

---

# **Part XI — Change Records**

Change record numbering is fresh for 01A (new doc family, `CR-01A-XX`).

**CR-01A-01** — V1.0 established as canonical Platform Primitives spec. Seven services defined: Config doctrine (Part I), Observability (Part II), Caching Strategy (Part III), IdempotencyService (Part IV), RateLimitLedger (Part V), AbuseScoreService (Part VI), Internal Service Auth (Part VII). Dependency-ordered presentation: foundational patterns before request-scoped services. Companion artifacts extend existing Doc 01 series.

**CR-01A-02** — Config doctrine refresh via LISTEN/NOTIFY (Part I §4) rather than TTL polling. Consistent with V8 `EntitlementService` pattern. Event-driven invalidation fits config's "rare change" access pattern better than polling.

**CR-01A-03** — Observability PII redaction made transport-layer enforceable (Part II §14). Redaction is a property of the log pipeline, not individual log call sites. Violations are security incidents.

**CR-01A-04** — Two-tier caching topology formalized as repo-wide pattern (Part III §21). V8 `EntitlementService` was the original example; 01A makes it canonical for all cross-instance caching.

**CR-01A-05** — LISTEN/NOTIFY production modes explicitly enumerated (Part III §26): single-instance, multi-instance, degraded, migration, pgBouncer considerations. Addresses V8 §29.5 cross-reference.

**CR-01A-06** — IdempotencyService canonical interface with scope-qualified keys and canonical JSON \+ SHA-256 content hashing (Part IV §29-§33). 409 Conflict on duplicate-different-content per industry standard (Stripe, AWS).

**CR-01A-07** — RateLimitLedger wrapping existing repo helper in canonical interface (Part V §39). Abuse-score multiplier integration makes tier enforcement continuous (0.25x / 0.5x / 0.75x / 1.0x) rather than binary.

**CR-01A-08** — AbuseScoreService greenfield definition (Part VI §48-§59). Weighted sum with exponential time decay scoring formula. 5 tiers. Manual support override with 30-day respect window per V8 §27.3.1. Student visibility explicitly none (prevents gaming).

**CR-01A-09** — Internal service auth via HMAC-SHA256 with timestamp binding and per-service-pair secrets (Part VII §61-§70). 90-day rotation with 14-day overlap. Timing-safe comparison. Reverse-proxy enforcement that `/api/internal/*` not publicly accessible.

**CR-01A-10** — Shared append-only governance pattern extended to 01A tables: `abuse_score_incidents`, `*_runtime_config_history` (Part I §5, Part VI §55). Schema-level UPDATE/DELETE prohibition. Consistent with V8 Appendix E ownership class framework.

**CR-01A-11** — SWE review sweep additions (pre-delivery hardening): (1) §0.6 Error class catalog enumerates every typed error referenced in pseudocode (`CacheUnavailableError`, `IdempotencyConflictError`, `IdempotencyInProgressError`, `RateLimitExceededError`, `RateLimitCheckUnavailableError`, `AbuseScoreUnavailableError`, `ServiceAuthSecretMissingError`, `UnauthorizedError`, `MissingRequiredConfigError`) with HTTP response mapping; (2) §3 bootstrap order fixed — `loadAllConfig → init logger/metrics/pool → startConfigInvalidationListener → accept connections` (non-negotiable); (3) deviation boxes standardized across all parts to include `Cutover criteria / Blocking conditions / Completion proof`; (4) §74A performance budgets table added — per-primitive P50/P95/P99 SLOs and alert thresholds, extending V8 §45A pattern to cross-cutting primitives.

---

# **Appendix A — Platform Primitives Constants Catalog**

All 01A-scope constants live in DB-backed `*_runtime_config` tables per Part I config doctrine. Tables consolidated below.

## **A.1 `caching_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `default_cache_ttl_seconds` | 60 | 10 | 600 | Engineering | Default in-process cache TTL |
| `default_hard_staleness_seconds` | 300 | 60 | 900 | Engineering | Default hard staleness bound |
| `listener_reconnect_max_backoff_ms` | 60000 | 10000 | 300000 | Engineering | Cap on listener reconnection backoff |
| `pg_notify_payload_size_limit_bytes` | 7800 | — | — | Engineering | Safety margin below PG 8000 limit |

## **A.2 `idempotency_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `ttl_by_scope` | (see §34) | — | — | Engineering | Per-scope retention TTL map |
| `retention_cron_schedule` | `daily_at_03_utc` | — | — | Engineering | Cron schedule for expired record purge |
| `in_progress_timeout_seconds` | 300 | 60 | 1800 | Engineering | Beyond this, `in_progress` records are considered stuck and retryable |

## **A.3 `rate_limit_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `soft_warning_threshold_pct` | 80 | 50 | 95 | Product | % of limit triggering soft warning |
| `bucket_definitions` | (launch seed) | — | — | Product | Map of bucket\_key → { limit, window\_seconds } |

Launch seed of bucket definitions (illustrative):

{  
  "login\_attempts\_15min": { "limit": 5, "window\_seconds": 900 },  
  "password\_reset\_requests\_hourly": { "limit": 3, "window\_seconds": 3600 },  
  "magic\_link\_requests\_hourly": { "limit": 5, "window\_seconds": 3600 },  
  "guardian\_link\_attempts\_daily": { "limit": 10, "window\_seconds": 86400 },  
  "tutor\_turns\_daily": { "limit": 100, "window\_seconds": 86400 },  
  "practice\_daily\_free": { "limit": 20, "window\_seconds": 86400 },  
  "exam\_submits\_hourly": { "limit": 2, "window\_seconds": 3600 },  
  "calendar\_regenerate\_hourly": { "limit": 10, "window\_seconds": 3600 },  
  "api\_requests\_per\_minute": { "limit": 300, "window\_seconds": 60 }  
}

## **A.4 `abuse_score_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `tier_boundaries` | `{"clean":20,"flagged":40,"concerning":60,"high_risk":80}` | — | — | Trust & Safety | Score upper bounds per tier (critical \= 81+) |
| `tier_multipliers` | (see below) | — | — | Trust & Safety | Quota and rate multipliers per tier |
| `base_weights` | (see below) | — | — | Trust & Safety | Per-incident-type base weight |
| `half_life_days` | 30 | 7 | 180 | Trust & Safety | Decay half-life |
| `realtime_threshold` | 4 | 3 | 5 | Trust & Safety | Severity ≥ triggers immediate recompute |
| `manual_override_respect_days` | 30 | 7 | 90 | Trust & Safety | Nightly batch respects manual overrides within this window |
| `cache_ttl_ms` | 60000 | 10000 | 600000 | Engineering | In-process score cache TTL |
| `cache_hard_staleness_ms` | 300000 | 60000 | 900000 | Engineering | Hard staleness bound during DB outage |
| `incident_retention_days` | 180 | 90 | 730 | Trust & Safety | How long incidents are retained for scoring |

**Tier multipliers:**

{  
  "clean":     { "quota": 1.0,  "rate": 1.0 },  
  "flagged":   { "quota": 0.75, "rate": 0.9 },  
  "concerning":{ "quota": 0.5,  "rate": 0.75 },  
  "high\_risk": { "quota": 0.25, "rate": 0.5 },  
  "critical":  { "quota": 0,    "rate": 0 }  
}

**Base weights (launch seed):**

{  
  "failed\_login\_burst": 3,  
  "password\_reset\_spam": 3,  
  "injection\_attempt": 25,  
  "retry\_storm": 5,  
  "quota\_farming": 5,  
  "content\_scraping": 20,  
  "account\_sharing\_signal": 10,  
  "payment\_dispute": 25,  
  "guardian\_link\_spam": 5,  
  "tutor\_prompt\_abuse": 5,  
  "deletion\_retry\_abuse": 3,  
  "role\_switch\_abuse": 15  
}

## **A.5 `observability_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `log_level_default` | `info` | `debug` | `error` | Engineering | Default production log level |
| `alert_thresholds` | (see V8 §45A) | — | — | Engineering | Alert trigger thresholds |
| `audit_retention_by_category` | (see V8 §5.1) | — | — | Legal | Retention per audit event category |
| `hot_log_retention_days` | 90 | 30 | 365 | Legal | Hot log retention before cold archive |
| `cold_log_retention_days` | 365 | 90 | 2555 | Legal | Cold archive retention before purge |

## **A.6 `internal_service_auth_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `timestamp_tolerance_ms` | 300000 | 60000 | 600000 | Security | Max skew between signed timestamp and receiver clock |
| `rotation_cadence_days` | 90 | 30 | 365 | Security | Secret rotation frequency |
| `rotation_overlap_days` | 14 | 3 | 30 | Security | Validity overlap during rotation |
| `secret_byte_length` | 32 | 32 | 64 | Security | Random bytes per secret (fixed at 256 bits) |

---

# **Appendix B — 01A Schemas (Target-State Canonical)**

## **B.1 `*_runtime_config` template**

See Part I §2 for canonical schema. Applied to each `<service>_runtime_config` table listed in Appendix A.

## **B.2 `*_runtime_config_history` template**

See Part I §5 for canonical schema. Applied to each history table. Append-only enforcement via trigger:

CREATE OR REPLACE FUNCTION prevent\_update\_delete()  
RETURNS TRIGGER AS $$  
BEGIN  
  RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE not permitted', TG\_TABLE\_NAME;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER \<history\_table\>\_no\_mutate  
  BEFORE UPDATE OR DELETE ON \<history\_table\>  
  FOR EACH ROW EXECUTE FUNCTION prevent\_update\_delete();

## **B.3 `idempotency_records`**

See Part IV §31.

## **B.4 `rate_limit_ledger`**

See Part V §41.

## **B.5 `abuse_score_incidents`**

See Part VI §55.

## **B.6 `abuse_scores`**

See Part VI §55.

## **B.7 `service_auth_secrets`**

See Part VII §64.

---

# **Appendix C — Reference Implementations**

Full pseudocode for each 01A service. Inline sections in the document showed core structure; this appendix provides complete pseudocode including helper methods and utilities.

## **C.1 Configuration loader and invalidation listener**

// packages/shared/config/runtime-config.ts

let configCache: Record\<string, Record\<string, unknown\>\> \= {};

export async function loadAllConfig(environment: string \= process.env.NODE\_ENV) {  
  const tables \= \[  
    'auth\_runtime\_config',  
    'auth\_mfa\_config',  
    'consent\_runtime\_config',  
    'entitlement\_runtime\_config',  
    'account\_deletion\_runtime\_config',  
    'mobile\_auth\_config',  
    'rate\_limit\_runtime\_config',  
    'idempotency\_runtime\_config',  
    'abuse\_score\_runtime\_config',  
    'observability\_runtime\_config',  
    'caching\_runtime\_config',  
    'internal\_service\_auth\_config'  
  \];

  for (const table of tables) {  
    const { data } \= await supabase  
      .from(table)  
      .select('key, value')  
      .or(\`environment.eq.all,environment.eq.${environment}\`);  
    configCache\[table\] \= Object.fromEntries(data.map(r \=\> \[r.key, r.value\]));  
  }  
}

export function getConfig\<T\>(table: string, key: string, defaultValue?: T): T {  
  const value \= configCache\[table\]?.\[key\];  
  if (value \=== undefined) {  
    if (defaultValue \!== undefined) return defaultValue;  
    throw new Error(\`Missing required config: ${table}.${key}\`);  
  }  
  return value as T;  
}

export async function refreshConfigKey(table: string, key: string) {  
  const environment \= process.env.NODE\_ENV;  
  const { data } \= await supabase  
    .from(table)  
    .select('value')  
    .eq('key', key)  
    .or(\`environment.eq.all,environment.eq.${environment}\`)  
    .single();  
  if (data) {  
    configCache\[table\] ??= {};  
    configCache\[table\]\[key\] \= data.value;  
  }  
}

// Start listener at service startup  
export async function startConfigInvalidationListener(pool: PgPool) {  
  await startListener(pool, 'config\_invalidate', async (payload) \=\> {  
    const { table, key, environment } \= JSON.parse(payload);  
    if (environment \=== 'all' || environment \=== process.env.NODE\_ENV) {  
      await refreshConfigKey(table, key);  
    }  
  });  
}

## **C.2 IdempotencyService**

// packages/shared/services/idempotency-service.ts

import { canonicalize } from 'json-canonicalize';  // RFC 8785  
import { createHash } from 'crypto';

export class IdempotencyService {  
  hashContent(payload: unknown): string {  
    const canonical \= canonicalize(payload);  
    return createHash('sha256').update(canonical).digest('hex');  
  }

  async checkOrRecord\<T\>({  
    scope,  
    clientKey,  
    contentHash,  
    handler,  
    req  
  }: {  
    scope: IdempotencyScope;  
    clientKey: string;  
    contentHash: string;  
    handler: () \=\> Promise\<T\>;  
    req?: AuthenticatedRequest;  
  }): Promise\<T\> {  
    const ttlMs \= getConfig\<Record\<string, number\>\>('idempotency\_runtime\_config', 'ttl\_by\_scope')\[scope\] ?? 86400000;  
    const expiresAt \= new Date(Date.now() \+ ttlMs);

    const { data: inserted, error: insertErr } \= await supabase  
      .from('idempotency\_records')  
      .insert({ scope, client\_key: clientKey, content\_hash: contentHash, status: 'in\_progress', expires\_at: expiresAt })  
      .select()  
      .single();

    if (\!insertErr && inserted) {  
      try {  
        const result \= await handler();  
        await supabase.from('idempotency\_records').update({  
          result,  
          status: 'completed',  
          completed\_at: new Date()  
        }).eq('scope', scope).eq('client\_key', clientKey);  
        metrics.counter('idempotency\_record\_completed', { scope });  
        return result;  
      } catch (err) {  
        await supabase.from('idempotency\_records').update({  
          status: 'failed',  
          completed\_at: new Date()  
        }).eq('scope', scope).eq('client\_key', clientKey);  
        metrics.counter('idempotency\_record\_failed', { scope });  
        throw err;  
      }  
    }

    // Existing record — check content hash  
    const { data: stored } \= await supabase  
      .from('idempotency\_records')  
      .select()  
      .eq('scope', scope)  
      .eq('client\_key', clientKey)  
      .single();

    if (\!stored) throw new Error('Unexpected idempotency insert conflict without existing record');

    if (stored.content\_hash \!== contentHash) {  
      metrics.counter('idempotency\_conflict', { scope });  
      throw new IdempotencyConflictError(scope, clientKey);  
    }

    if (stored.status \=== 'in\_progress') {  
      const ageSec \= (Date.now() \- new Date(stored.created\_at).getTime()) / 1000;  
      const timeoutSec \= getConfig\<number\>('idempotency\_runtime\_config', 'in\_progress\_timeout\_seconds', 300);  
      if (ageSec \> timeoutSec) {  
        // Stuck — allow retry by deleting  
        await supabase.from('idempotency\_records').delete().eq('scope', scope).eq('client\_key', clientKey);  
        return this.checkOrRecord({ scope, clientKey, contentHash, handler, req });  
      }  
      throw new IdempotencyInProgressError(scope, clientKey);  
    }

    if (stored.status \=== 'failed') {  
      await supabase.from('idempotency\_records').delete().eq('scope', scope).eq('client\_key', clientKey);  
      return this.checkOrRecord({ scope, clientKey, contentHash, handler, req });  
    }

    // status \=== 'completed'  
    metrics.counter('idempotency\_duplicate\_hit', { scope });  
    return stored.result as T;  
  }  
}

export async function idempotencyRetentionCron() {  
  await supabase.from('idempotency\_records').delete().lt('expires\_at', new Date());  
}

## **C.3 AbuseScoreService**

See Part VI §59 for inline implementation. Cron is shown separately in the same section.

## **C.4 Internal service auth**

See Part VII §70 for signing and verification utilities. Secret loading:

export async function loadActiveSecret(caller: string, callee: string): Promise\<string\> {  
  const { data } \= await supabase  
    .from('service\_auth\_secrets')  
    .select('secret\_material, active\_until')  
    .eq('caller\_service', caller)  
    .eq('callee\_service', callee)  
    .is('revoked\_at', null)  
    .gt('active\_until', new Date())  
    .order('created\_at', { ascending: false })  
    .limit(1)  
    .single();

  if (\!data) throw new Error(\`No active secret for ${caller} → ${callee}\`);  
  return data.secret\_material;  
}

export async function loadServiceSecrets(caller: string, callee: string): Promise\<string\[\]\> {  
  // Load ALL active secrets for verification (supports rotation overlap)  
  const { data } \= await supabase  
    .from('service\_auth\_secrets')  
    .select('secret\_material')  
    .eq('caller\_service', caller)  
    .eq('callee\_service', callee)  
    .is('revoked\_at', null)  
    .gt('active\_until', new Date());

  return data?.map(r \=\> r.secret\_material) ?? \[\];  
}

---

# **Appendix D — 01A Table Ownership Matrix**

Consistent with V8 Appendix E governance framework. Each 01A-owned table is classified by ownership class.

## **Ownership class definitions (reference to V8 Appendix E)**

* **Single-writer:** Exactly one module writes. Other writes are violations.  
* **Shared append-only:** Multiple modules insert; UPDATE/DELETE schema-prohibited.  
* **Admin-mutable:** Configuration managed by ops tooling; runtime services read only.

## **01A tables**

| Table | Ownership Class | Canonical Writer | Readers | Notes |
| ----- | ----- | ----- | ----- | ----- |
| `idempotency_records` | Single-writer | `IdempotencyService` | `IdempotencyService` (self-read) | All scopes share this table |
| `rate_limit_ledger` | Single-writer | `RateLimitLedger` | `RateLimitLedger` (self-read), admin dashboards | All buckets share this table |
| `abuse_score_incidents` | Shared append-only | Multiple services that detect incidents (auth, tutor, practice, exam, etc.) | `AbuseScoreService` | Append-only via schema trigger |
| `abuse_scores` | Single-writer | `AbuseScoreService` | `RateLimitLedger`, V8 `EntitlementService`, admin dashboards | Manual override appends to `appeal_history` JSONB |
| `service_auth_secrets` | Single-writer | Admin/ops tooling | Internal auth verification code (runtime read) | Secrets themselves never logged |
| `caching_runtime_config` | Admin-mutable | Admin panel / ops | All services at startup \+ NOTIFY refresh | Per Part I |
| `idempotency_runtime_config` | Admin-mutable | Admin panel / ops | `IdempotencyService` | Per Part I |
| `rate_limit_runtime_config` | Admin-mutable | Admin panel / ops | `RateLimitLedger` | Per Part I |
| `abuse_score_runtime_config` | Admin-mutable | Admin panel / ops | `AbuseScoreService` | Per Part I |
| `observability_runtime_config` | Admin-mutable | Admin panel / ops | Every service (log/alert settings) | Per Part I |
| `internal_service_auth_config` | Admin-mutable | Admin panel / ops | Internal auth verification code | Per Part I |
| Each `*_runtime_config_history` table | Shared append-only | Insert trigger from parent `*_runtime_config` table | Admin dashboards | Append-only via schema trigger |

## **CI enforcement**

Per V8 Appendix E pattern:

* **Single-writer:** Linter rejects writes outside named canonical writer module  
* **Shared append-only:** Linter permits inserts from allow-listed modules; schema trigger rejects UPDATE/DELETE at DB level  
* **Admin-mutable:** Linter rejects writes from runtime service code; permitted only from migration scripts and admin tooling

Quarterly audit verifies classification remains accurate as 01A evolves.

---

# **End of Doc 01A V1.0**

**Canonical for Lyceon platform as of 2026-04-23.** **Coordinates with Doc 00 (Platform Directive), Doc 01 V8 (Identity, Access, Billing & Guardian Trust), Doc 02 family (Runtime, pending feature-doc review against V8 \+ 01A), Doc 03 family (Tutor, pending rewrite against V8 \+ 01A).** **Next review trigger:** Doc 01 V8 amendment; new cross-cutting primitive identified; post-launch scale demanding architectural change; mobile app introducing new primitive needs; Neon connection pooling resolution enabling architecture shifts; security audit finding primitive gap.

---

## **Companion Artifacts (Extended from Doc 01 Series)**

Per author decision Q1 \= b, 01A does not have its own parallel companion series. Instead, existing Doc 01 companion artifacts extend to cover 01A:

* **\[LAUNCH-BLOCKING\] Doc 01.1 — Identity and Platform Primitives Test Matrix** — extended from Doc 01 V8 companion. Adds 01A test scenarios: config invalidation propagation, idempotency happy-path and conflict-path, rate limit bucket behavior, abuse score tier transitions, internal auth rotation with overlap, observability redaction coverage. Owner: Engineering. Launch-blocking for 01A primitives in critical path.

* **\[BLOCKING PER MIGRATION\] Doc 01.2 — Identity and Platform Primitives Migration Runbooks** — extended from Doc 01 V8 companion. Adds 01A migrations: config lint rollout; logger migration; correlation ID threading; IdempotencyService adoption; RateLimitLedger consolidation; AbuseScoreService greenfield deployment; internal service auth greenfield deployment. Each follows additive → dual-write → backfill → compare-reads → cutover → cleanup where applicable. Owner: Engineering.

* **\[STRONGLY RECOMMENDED\] Doc 01.3 — Identity and Platform Primitives Engineer Runbooks** — extended from Doc 01 V8 companion. Adds 01A operational walkthroughs: adding a new config key; adding a new rate limit bucket; adding a new idempotency scope; adding a new abuse incident type; rotating an internal service auth secret; debugging LISTEN/NOTIFY delivery issues. Owner: Engineering.

01A stays spec-grade. Companion docs carry the implementation detail. Feature docs consume 01A interfaces.

---

**V1.0 scope summary:** First release of Platform Primitives canonical spec. Seven services: Config doctrine with DB-backed `*_runtime_config` tables \+ LISTEN/NOTIFY invalidation \+ CI-enforced magic-number prohibition; Observability with structured logging \+ correlation IDs \+ PII redaction transport \+ metrics naming convention \+ alert routing; Caching strategy with two-tier topology (in-process \+ Postgres authoritative) \+ LISTEN/NOTIFY cross-instance invalidation \+ TTL/hard-staleness pattern \+ production mode enumeration \+ reconnection logic; IdempotencyService with scope-qualified keys \+ canonical JSON \+ SHA-256 content hashing \+ 409 Conflict on duplicate-different-content \+ per-scope TTL \+ partial-failure recovery via status tracking; RateLimitLedger wrapping existing repo helper \+ abuse-score-weighted multipliers \+ soft warnings at 80% \+ 429 response shape \+ rollback pattern; AbuseScoreService greenfield with weighted-sum-time-decay scoring formula \+ 5 tiers (clean/flagged/concerning/high-risk/critical) \+ 12-type incident taxonomy \+ real-time recompute for severe \+ nightly batch \+ manual support override with 30-day respect window per V8 §27.3.1 \+ explicitly no student visibility; Internal Service Auth with HMAC-SHA256 signing \+ timestamp binding \+ per-service-pair secrets \+ 90-day rotation with 14-day overlap \+ timing-safe verification \+ public reverse-proxy rejection. Governance classes consistent with V8 Appendix E framework (single-writer / shared append-only / admin-mutable) applied to all 01A-owned tables. 10 change records CR-01A-01 through CR-01A-10. Four appendices: Platform Primitives Constants Catalog (6 `*_runtime_config` tables), Schemas (7 tables \+ history template \+ append-only trigger), Reference Implementations (4 services with full pseudocode), 01A Table Ownership Matrix. Companion artifacts extended from Doc 01 series (01.1/01.2/01.3) — no parallel 01A companion series per author decision.

