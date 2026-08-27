# Replit Remnant Sweep — evidence for scoping a purge workstream

**Date:** 2026-08-20 · **Scope:** working tree at branch head. **No git history searched.**
**Authority:** delete within billing / entitlement / secrets (Charter §4). Report everywhere else.
`ops/env/REPLIT_ENV_KEYS_2026-01-17.txt` is owner-approved for deletion regardless of surface.

This sweep exists because four remnants were found by tripping over them rather than by looking:
two webhook endpoints on Replit URLs, code targeting `guardian_links` columns that exist only on
another table, `.env.example`'s dead `_TEST`/`_LIVE` key model, and the Replit key inventory. That is
a surface property, not four coincidences.

---

## 1. Findings

| `file:line` | What it is | Surface | Action |
|---|---|---|---|
| `package.json:122` | **`"stripe-replit-sync": "^1.0.0"`** — its own `package.json` describes it as *"Stripe Sync Engine to sync Stripe data to Postgres"*. **Zero imports in source.** This is the provenance of SCL-050's 29-table `stripe` schema and, in all likelihood, of the two Replit-hosted webhook endpoints. | **billing** | **DELETED** (`pnpm remove`; lockfile −43 lines, no transitive churn) |
| `ops/env/REPLIT_ENV_KEYS_2026-01-17.txt` (154 lines) | Replit environment-variable **name** inventory. Structurally verified names-only: 0 lines match `NAME=VALUE`, 0 match any credential pattern. | secrets | **DELETED** (owner-approved; directory `ops/env/` removed with it) |
| `.replit:47` | `[userenv.development] V4_DEBUG_AUTH_BYPASS = "true"` — **an auth-bypass flag set true in a deploy config**. Verified dead: `grep -rn V4_DEBUG_AUTH_BYPASS --include=*.ts` → zero readers. | auth/secrets-adjacent | **REPORTED.** Dead today. Flagged because restoring any Replit config would reintroduce a live auth bypass. Deleting `.replit` is the purge workstream's call. |
| `.replit:44` | `CORS_ORIGINS` includes a `*.kirk.replit.dev` origin alongside the real domains | other (deploy config) | REPORTED |
| `.replit:40` | `[objectStorage] defaultBucketID = "replit-objstore-…"` — a bucket identifier, not a credential | other | REPORTED |
| `.replit` (whole file) | Nix channel, package-manager run commands that contradict the repo's pnpm-only rule (enforced by a hook), port 5000→80 mapping, `[agent] integrations` incl. `stripe:2.0.0` | other | REPORTED |
| `.replitignore` | Cloud Run packaging ignore list; excludes `server/`, `apps/`, `client/src` | other | REPORTED |
| `replit.md` | Platform overview doc, describes the app as "SAT Learning Copilot" with bearer-token auth — contradicts Doc 01 V8 §7.2.1, which rejects Bearer for user-facing routes | other (docs) | REPORTED — stale *and* wrong |
| `package.json:134-135` | `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-runtime-error-modal` devDependencies. Only reference is a commented-out line. | other (build) | REPORTED — not removed; devDependency changes are outside this vertical |
| `vite.config.ts:14` | Commented-out `@replit/vite-plugin-cartographer` import | other | REPORTED |
| `tests/playwright.config.ts:8` | `baseURL` falls back to a hardcoded `…-00-1sx2x4owrojd1.kirk.replit.dev` URL | other (test infra) | **REPORTED — highest non-billing priority.** An E2E run without `BASE_URL` set silently targets a dead Replit host. |
| `apps/workers/tutor-orchestrator/cloudbuild.yaml:13` | `--service-account lyceon-tasks-sa@replit-cop.iam.gserviceaccount.com` — the live **GCP project is named `replit-cop`** | other (LISA/workers) | REPORTED — naming remnant on live infrastructure; renaming a GCP project is not a code change |
| `server/index.ts:94-95` | Comments: "required for Replit infrastructure", "Replit's infrastructure" justifying `trust proxy` | other | REPORTED — the setting is still right for Vercel; only the justification is stale |
| `server/index.ts:911` | Startup hint: *"set PUBLIC_SITE_URL or use REPLIT_DEV_DOMAIN fallback"* — `REPLIT_DEV_DOMAIN` has no reader | other | REPORTED |
| `scripts/apply_migrations.ts:129` | *"Set SUPABASE_DB_URL in Replit Secrets"* — this script is already slated for removal by WS-M M3.1 | other | REPORTED |
| `apps/api/src/lib/supabase-server.ts:5` | Comment: direct Postgres connections are "flaky from Replit" | other | REPORTED |
| `docs/ENV.md`, `docs/OPERATIONS.md`, `docs/qa/guardian.md`, `docs/qa/release-gates.md` | Replit references in operational docs | other (docs) | REPORTED |

## 2. Credential sweep — negative result, stated as such

Eight credential shapes swept across the working tree (excluding `node_modules/`, `dist/`,
`pnpm-lock.yaml`, `docs/Spec/`):

```
sk_(live|test)_…   pk_(live|test)_…   rk_(live|test)_…   whsec_…
AKIA[0-9A-Z]{16}   -----BEGIN … PRIVATE KEY-----   AIza…   3-segment JWT
```

**Zero real credential values found.** The only `postgres://user:pass@host` matches are four
placeholders, verified individually with the secret portion masked before display:

| File:line | Form |
|---|---|
| `database/SUPABASE_MIGRATION_STATUS.md:344` | `postgres.[PROJECT-REF]:…@aws-0-us-east-1.pooler.supabase.com` — documentation template |
| `scripts/generate_migration_proof.sh:16` | `postgresql://user:…@host:port/database` — literal example inside an `echo` |
| `scripts/ci/tutor-schema-proof.sh:54` | `${PGUSER}:${PGPASSWORD}@${PGHOST}` — shell interpolation |
| `scripts/ci/tutor-schema-proof-negative-control.sh:56` | same |

**No rotation is indicated by this sweep.** That is a finding about the working tree only — this
sweep did not search git history, and a value committed and later removed would not appear here.

## 3. What the sweep changes about the four known remnants

Two of the four now have a named cause rather than being unexplained:

- The `stripe` sync schema (SCL-050, 29 tables) and the Stripe-managed webhook endpoints are what
  `stripe-replit-sync` exists to create. Removing the package does not remove the schema — that is
  still `STRIPE_DDL_QUEUE.md` D-3, owner-applied — but it stops anything reintroducing it.
- `.env.example`'s `_TEST`/`_LIVE` model matches the `STRIPE_ENV`-driven key selection that
  `server/lib/stripeClient.ts` carried before Phase C rebuilt it. Both are Replit-era artefacts of a
  single-container two-mode deployment; neither survives a per-environment Vercel model.

The other two (`guardian_links` column drift, the key inventory) are unrelated to Stripe and belong
to `WS-GL` and to the purge workstream respectively.

## 4. Recommended scope for the purge workstream

Not actioned here. Ordered by risk, from the evidence above:

1. `tests/playwright.config.ts:8` — a live default pointing at a dead host.
2. `.replit` — delete, or at minimum remove `V4_DEBUG_AUTH_BYPASS` and the `kirk.replit.dev` CORS origin.
3. `@replit/*` devDependencies + the commented `vite.config.ts` import.
4. `replit.md` — stale and contradicts Doc 01 V8 §7.2.1 on Bearer tokens.
5. Comment and doc references — cosmetic, but each is a false trail for the next reader.
6. `replit-cop` GCP project naming — infrastructure, not code.
