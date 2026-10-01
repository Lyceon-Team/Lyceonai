# F-24 triage: the 41 `pnpm check` errors (read-only, 2026-09-30)

Brief 5, audit finding 3. No code was changed. Fixes follow in a separate brief after Karl's ruling.

## 1. Same set on `main` and `cleanup`

| Ref | Commit | `grep -c 'error TS'` |
|---|---|---|
| `origin/main` | `917c9af4` | 41 |
| `origin/cleanup` | `f15c1806` | 41 |

Compared as sorted `file(line,col): error TSnnnn` keys: identical (`diff` empty). The only textual difference in the full output is the order in which TypeScript prints the properties of one object type inside the message at `server/services/tutor-compaction.ts:184`. The student UI vertical added none of these errors.

## 2. The logger contract several rows depend on

`server/logger.ts`: `info` / `warn` / `debug(component, operation, message, data?, context?)`; `error(component, operation, message, error?, data?, context?)`. Outside development the entry is written as JSON with `message` → `message` and `operation` → `event`. A call with one or two arguments therefore puts the prose in `component` and, with two, the data object in `event`; `message` is `undefined` and `JSON.stringify` drops it. Nothing throws. `createLogEntry` keeps only `userId`, `requestId` and `ip` from the `context` argument.

## 3. Classification

**Type-only** means that the code behaves correctly at runtime; only the static types are wrong or loose. **Likely runtime bug** means that the code misbehaves when it runs.

| File:line:col | TS | Class | Reasoning (decisive evidence) |
|---|---|---|---|
| `server/routes/account-deletion-routes.ts:269:34` | 2339 | **Likely runtime bug** (F-32) | `admin.auth.admin.signOutUser` does not exist in `@supabase/auth-js` 2.104.1 (0 matches in `dist/main/GoTrueAdminApi.js`; the admin API has `signOut(jwt, scope)`). The call throws `TypeError` every time; the surrounding `try` catches it. |
| `server/routes/practice-canonical.ts:311:12` | 2554 | **Likely runtime bug** (F-34, logs only) | `logger.warn("Rate limiter config unavailable…")`: one argument, so the fail-closed 503 is logged with no `message` or `event`. The 503 itself is correct. |
| `practice-canonical.ts:613:5` | 2322 | Type-only | `difficulty` is typed `unknown` on `CanonicalQuestionRowLike`; every real source returns `difficulty int`. |
| `practice-canonical.ts:617:20`, `:617:42` | 2339 | Type-only | `exam` is not selected; the `typeof` guard makes it `null`; nothing reads it downstream. |
| `practice-canonical.ts:619:16`, `:620:13` | 2339 | Type-only | `structure_cluster_id` exists in no migration; always `null`; no consumer (dead code). |
| `practice-canonical.ts:1507:16` | 2554 | **Likely runtime bug** (F-34, logs only) | `logger.warn("Quota dry-run unavailable…")`: same slot shift as `:311`. |
| `practice-canonical.ts:1732:26` | 2769 | Type-only | Callback typed `SessionItemRow`, insert selects `id, ordinal`; only those are read. |
| `practice-canonical.ts:1886:35`, `:2528:37`, `:3210:35`, `:3799:35` | 2345 | Type-only | `TERMINAL_DB_STATUSES.includes(session.status)`: the tuple is narrow only in types; the DB CHECK allows `created/active/completed/abandoned`. |
| `practice-canonical.ts:2168:28` | 2345 | Type-only | `SessionRow` requires `user_id`, which the select omits; the callback never reads it. |
| `practice-canonical.ts:3097:14`, `:3105:12`, `:3114:10` | 2554 | **Likely runtime bug** (F-34, logs only) | Two-argument `logger.info`: message undefined, data in `event`. `:3105` is "baseline insert failed (non-fatal)" at `info`, with the Postgres error in `event`, so no error tracking fires. `tests/diagnostic.handler-pg.ci.test.ts:944` asserts on `args[0]`, which pins the wrong shape. |
| `practice-canonical.ts:3218:64` | 2345 | Type-only here; **exposes F-33** | The answer path reads only `item_type`, `explanation`, `correct_answer`, all selected. But `SESSION_ITEM_SELECT` (`:264`) omits `question_assets` and `question_estimated_time_seconds`, and the serving paths use the same select (see F-33). |
| `practice-canonical.ts:3276:11` | 2322 | Type-only | `reEmitDiagnosticMasteryIfNeeded` reads only selected columns. |
| `server/routes/diagnostic-routes.ts:68:22`, `:77:17`, `:454:24`, `:457:19` | 2352 | Type-only | `req.requestId` / `req.user` are set by middleware; the casts are unneeded but read correct values. |
| `diagnostic-routes.ts:245:14`, `:264:12`, `:280:14`, `:296:12`, `:426:10` | 2554 | **Likely runtime bug** (F-34, logs only) | Two-argument `logger.warn/error/info("[diagnostic] …", {…})`. The "insufficient domain/skill coverage" 503 errors (`:264`, `:280`, `:296`) reach Cloud Logging and the error monitor with no `message` and an object in `event`. Nothing sensitive: the data is ids and counts, still redacted. |
| `diagnostic-routes.ts:381:5` | 2322 | Type-only | `client_instance_id` can be `null`; both columns are nullable and a null binding is treated as unbound. The real client always sends one. |
| `server/services/tutor-compaction.ts:184:5` | 2322 | Type-only | `MessageRow` is hand-declared with `string`; DB CHECK constraints guarantee the literal values. (CLAUDE.md inline-shape smell.) |
| `tutor-compaction.ts:508:11`, `:517:9` | 2353 | **Likely runtime bug** (F-35, logs only) | `{ studentId, summaryType }` passed as `context`; `createLogEntry` keeps only `userId/requestId/ip`, so both are dropped. No privacy leak (the identifier is never emitted); the warning loses its correlation keys. |
| `server/services/tutor-context.ts:411:29`, `:427:13`, `:437:16`, `:441:18`, `:442:22`, `:446:29`, `:447:29` | 2339 | Type-only | The `.select()` string is built by concatenation, so postgrest-js types the row as `GenericStringError`. At runtime the string is valid and every column exists. Anti-leak holds: `question_correct_answer` is never selected, and `question_explanation` only when post-submit (`:383`, gated again at `:436-438`). |
| `client/src/components/math/DesmosCalculator.tsx:224:24`, `:269:10` | 2352 | Type-only | An expando handler on the Desmos instance; guarded by `typeof handler === "function"`. |

Totals: **28 type-only, 13 likely runtime bug** (41). The 13 lines are three defects: F-32 (1 line), F-34 (10 lines) and F-35 (2 lines). A fourth defect, F-33, carries no error line of its own: `:3218` is type-only where it sits, and it exposes the fault in `SESSION_ITEM_SELECT`.

## 4. First priority: `account-deletion-routes.ts:269` (F-32)

- **Where:** `POST /api/account/delete`, only on the V2 lifecycle path (`isDeletionLifecycleV2Enabled()`, `ACCOUNT_DELETION_LIFECYCLE_V2 === "true"`, `server/lib/account-deletion-execute.ts:162`). Whether that flag is on in production is not verifiable from here.
- **Would it throw in production?** The call does throw: `TypeError: admin.auth.admin.signOutUser is not a function`. The `try` at `:268-283` catches it and logs `signout_best_effort_failed` at ERROR. The request continues.
- **What the student sees:** a normal success. The deletion is queued, the recovery email is sent, and the response is 200 with the scheduled date.
- **What does not happen:** the request-time session kill (Doc 01 §40.2.1 Phase 3, defence in depth) never happens, so the student's other devices stay signed in. The server's `pending_deletion` gate (`server/middleware/supabase-auth.ts:737-743`) still refuses those sessions everywhere outside its allowed set, which limits the harm. Every V2 deletion request also writes one false ERROR line.
- **Test coverage:** mock only, and the mock is dead. `server/__tests__/deletion-lifecycle.test.ts:531` gives its mock admin client a `signOutUser` that the real client lacks. That mock feeds `executeDueDeletions`, which never calls it. No test drives the route's V2 path with the real client.
- **Spec note:** Doc 01 itself names `supabase.auth.admin.signOutUser(profileId)` (`docs/Spec/… Document 01 …md:1871, 1922`, and §17A.1 / CR-01-39 for role elevation). The API the spec prescribes does not exist in supabase-js 2.104.1. The spec is read-only, so this goes to Karl: the fix must pick a real revocation mechanism, and the spec text needs an SCL.

## 5. Closed (2026-09-30)

Brief 6 fixed the 13 runtime-bug lines (41 → 26). Brief 7 fixed the remaining 26 type-only errors without changing behaviour (26 → 0) and made `pnpm run check` a blocking CI step. No type-only error turned out to hide a runtime defect. Register F-24 is Closed; its row records each fix.
