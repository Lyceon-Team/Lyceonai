# Codex audit of #1073 + #1108 + #1113: the four fixes

Codex audited the three student-UI PRs together on `cleanup` @ `a6a737ff` and found four
problems. Karl accepted all four on 2026-10-05 and asked for them to be fixed in one follow-up
PR into `cleanup`. This file holds the proof for each fix. Every command was run from the repo root
on branch `claude/student-ui-audit-fixes`.

---

## 1. No `console.*` in student client code (HIGH)

### What changed

Every `console` call is gone from the client code that ships (no replacement logger):

| File | Calls removed | What the failure path does now |
|---|---|---|
| `client/src/features/calendar/api/client.ts` | 2 (`console.error`) | Throws its existing message, which names the resource only |
| `client/src/features/exam/api/exam-api.ts` | 1 (`console.error`) | Throws its existing message |
| `client/src/lib/csrf.ts` | 9 (`console.log` ×6, `console.error` ×3) | Throws or returns exactly as before |
| `client/src/components/MathRenderer.tsx` | 2 (`console.warn`) | Falls back to plain text, as before |

In `csrf.ts`, removing the calls left some dead code, which also went:
- a `.catch` that only logged and rethrew;
- two blocks left empty;
- an unused `url` variable.

The `any` parameter there is now `unknown`, narrowed before use. All four files are lint-clean
under the full `eslint.config.mjs`.

### CI fails on any new console call

`pnpm lint` already set `no-console` to error, but it runs in the advisory `ci-known-gaps` job,
so a new console call never failed CI.
- **The new check:** `eslint.no-console.config.mjs`, run by `pnpm run lint:no-console`. It checks
  one rule, `no-console`, on `client/src/**/*.{ts,tsx}`.
- **Inline comments can't switch it off:** it sets `noInlineConfig`, so an `eslint-disable`
  comment has no effect.
- **Where it runs:** a new blocking step, "Client — no console (blocking)", in the required `ci`
  job.
- **Not checked:** test files, which don't ship and spy on `console` to assert silence.

Each plant below was applied, the lint run, and the file restored:

| Plant | `pnpm -s run lint:no-console` |
|---|---|
| none | exit 0 |
| P1: `console.log("plant");` added at `client/src/lib/csrf.ts:11` | exit 1, `11:3 error Unexpected console statement no-console` |
| P2: `// eslint-disable-next-line no-console` + `console.warn("plant");` at `client/src/components/MathRenderer.tsx:58` | exit 1: the disable comment is reported "has no effect because you have 'noInlineConfig'", then `59:7 error Unexpected console statement` |
| P3: the `client/src/pages/home.tsx` line removed from the config's ignore list | exit 1, `90:7` and `107:5 error Unexpected console statement` |

### Two exclusions, handed to the SEO vertical (register F-74)

Both files are outside this vertical's scope (the scope boundary, Karl, 2026-10-05), so they are
excluded by name in the config and not edited here:
- **`client/src/pages/home.tsx`** is the public landing page, mounted at `/` (`client/src/App.tsx:194`). It has 2 console calls.
- **`client/src/lib/analytics/consent.ts`** is the cookie-consent module from SEO Wave 1C, commit `7f9d8069`. It has 1 console call.
  - That call is the only statement in a `.catch`, so deleting it alone would leave a silent catch.

The lint fails if either entry is removed from the ignore list before the SEO vertical removes its
calls (plant P3).

### Grep proof

Before, on `a6a737ff`, there were 19 matches, counting comments:

```
$ git grep -n "console\." a6a737ff -- 'client/src/*' ':!*.test.*' ':!**/__tests__/**' | wc -l
19
```

After:

```
$ rg -n "console\." client/src --glob "!**/*.test.*" --glob "!**/__tests__/**"
client/src/pages/home.tsx:90:      console.error("Sign out failed:", error);
client/src/pages/home.tsx:107:    console.debug("hero_cta_click", { ctaText });
client/src/lib/analytics/consent.ts:149:    console.warn(
client/src/main.tsx:20:// Coding Standards §16 bans console.log in product code.
client/src/features/calendar/api/client.ts:52: * Karl 2026-10-05: no `console.*` in student client code, no replacement logger). The thrown

$ rg -n "console\." client/src --glob "!**/*.test.*" --glob "!**/__tests__/**" | rg -v "^client/src/pages/home.tsx|^client/src/lib/analytics/consent.ts" | rg -v '^\S+:\d+:\s*(//|\*)'
(exit 1: no matches)
```

The only `console` text left outside the two SEO files is in comments. Nothing under `client/`
outside `client/src` calls `console` either (`client/shots` included; `rg` exit 1).

### Tests

`client/src/features/calendar/api/client.test.ts` now asserts the calendar client writes nothing
to the console (`error`, `warn`, `log`, `info` or `debug`) in two cases:
- a body that fails the schema;
- a body that is not JSON (a new test).

It also checks the thrown message names the route and carries no plan content.

Plants:
- `console.error("plant");` at `client/src/features/calendar/api/client.ts:76`, inside the
  not-JSON `catch` at :75: 1 test fails ("a body that is not JSON …").
- The same line at `client.ts:83`, inside `if (!result.success)` at :82: 2 tests fail.

---

## 2. The student calendar no longer uses `calendar.css` (MEDIUM)

**Owner ruling (Karl, 2026-10-05):** split it. The guardian calendar
(`client/src/pages/guardian-student-calendar.tsx:59`) also imports `calendar.css`. So do its
generated 16px floor (`scripts/gen-guardian-type-floor.mjs`, `--check` runs in CI) and the
production proof that closed G4-07. Deleting the file here would break the guardian surface. So:
- **The student calendar:** everything it renders is ported into `calendar-student.css`, on the
  student tokens. The student page no longer imports `calendar.css`.
- **The guardian calendar:** keeps `calendar.css` unchanged. Retiring the file is handed to the
  guardian vertical (register F-75).

### What was ported and what wasn't

**Ported:** everything the student tree renders, with every selector scoped
`.lyceon-calendar.lyc-cal …` so none of it matches on the guardian page:
- the root, buttons and focus ring;
- banners;
- the week grid and its day states;
- block cards and test-day marks;
- the month grid;
- the day menu;
- the scrim and the block, create and settings sheets;
- the setup popup;
- the day strip;
- reduced motion and the 767, 639 and 640px breakpoints.

**Not ported:** rules for classes the student tree never renders (checked against every
`className` in `CalendarView` and `features/calendar/components/`): `.app`, `.rail`, `.who`,
`.mini`, `.mgrid`, `.legend`, `.main`, `.top`, `.range`, `.arrows`, `.back`, `.topdiv`,
`.btn.icon`, `.seg`, `.spacer`, `.facts`, `.slot`, `.item`, `.navrow`, `.streakline`, `.countline`,
`.ptarget`, `.prange`, `.absent`, and the 900px and 1180px blocks.

### Grep proof

```
$ git grep -n 'calendar\.css' a6a737ff -- client/src/pages/calendar.tsx
client/src/pages/calendar.tsx:84:import "@/features/calendar/calendar.css";     # before

$ rg -n "calendar\.css" client tests scripts      # after (imports only; comments omitted)
client/shots/main.tsx:36:import "@/features/calendar/calendar.css";
client/src/pages/guardian-student-calendar.tsx:59:import "@/features/calendar/calendar.css";
```

The other hits are comments, the guardian floor generator (`scripts/gen-guardian-type-floor.mjs:27`
reads the guardian's file), and `tests/ci/student-ui-render-blocking.contract.test.ts:50`, which
reads the same file. `client/shots` is a dev-only legacy comparison tool and ships nothing.

```
$ rg -n -i "#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(" client/src/features/calendar/calendar-student.css
exit=1                 # no raw colour
$ rg -n "font-size" client/src/features/calendar/calendar-student.css | rg -v "font-size: (1[4-9]|2[0-9]|30)px;"
exit=1                 # all 47 font-size declarations are 14–30px
$ rg -n "box-shadow|gradient\(" client/src/features/calendar/calendar-student.css | rg -v '^\d+:\s*(\*|/\*)'
exit=1                 # no shadows or gradients outside comments
```

### Tests

`client/src/pages/calendar.ui55.test.tsx` has a new block, "UI-55 split: the student calendar's
import graph never reaches calendar.css". It walks the static and dynamic imports from
`pages/calendar.tsx`.
- **Presence first:** the walk must reach `calendar-student.css` and `CalendarView.tsx`.
- **Then absence:** it must not reach `calendar.css`.
- **The walker can see the import:** a second test checks that the guardian page's walk does reach
  `calendar.css`.

New gate plants, both in `scripts/ci/review-ui-gate.mutations.sh` and both observed red:
- `UI55-SPLIT1`: the `calendar.css` import is restored in `pages/calendar.tsx`.
- `UI55-SPLIT2`: `CalendarView.tsx` imports `./calendar.css`.

FU-C3 (the sheet's z-index) still anchors on the first `.sheet` rule, and still reddens.

### The guardian calendar is unchanged

- `calendar.css`, `guardian-student-calendar.tsx` and `guardian-type-floor.generated.css` have no
  diff against `a6a737ff`.
- `node scripts/gen-guardian-type-floor.mjs --check` prints "GUARDIAN TYPE FLOOR: up to date".
- The browser specs `guardian-surfaces`, `student-calendar` and `student-mastery` on Vite :5173:
  49 passed.
- Before and after the split, all 30 guardian browser-spec shots and the student 390 shot are
  byte-identical.

### What the student sees

- **Computed styles:** a computed-style comparison of every element in the student calendar root,
  before and after, covered 1440 and 390, light and dark, and seven states (week, block sheet, day
  menu, settings sheet, create sheet, month, setup popup). It differs only in:
  - the `.block` transition list, which lost `box-shadow` (nothing visible);
  - border colours on the sheet's and popup's zero-width sides (invisible);
  - the change below.
- **One intended visual change (DESIGN.md §1, "no gradients", "no shadows"):** rest days and
  blocked-out days drew a diagonal hatch. They now have flat tints: rest days `--margin`,
  blocked-out days `--cat-review-bg`. A day under a dragged block is outlined instead of
  inset-shadowed. For Karl: OQ-65. It shows in `UI-55/paid-month--*`, on the days after the test
  date.
- **UI-55 re-captured:** 36 rows, light and dark, desktop and 390, with 0px horizontal overflow.
  The other differences from the previous capture are plan data, which changes from run to run of
  the harness.

---

## 3. The quota Postgres test runs in CI, and fails on any skip (MEDIUM)

`tests/ci/practice-quota.pg.ci.test.ts` runs in its own step in the `practice-integration` job:
"Practice quota (OQ-21 read, OQ-43 Doc 02B §13 rule) → real PG proof". The step:
- sets `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`;
- runs vitest with the JSON reporter;
- passes the report through `scripts/ci/vitest-summary-gate.mjs --file
  tests/ci/practice-quota.pg.ci.test.ts`.

This is the same pattern as F-62's LISA proofs. The gate exits 1 if any test is skipped,
failed or todo, if any file is skipped, if nothing passed, or if the named file has no passed
result with assertions. Its self-test runs in CI too (`ci.yml:1252`).

### CI log on `a6a737ff`

From workflow run 37332146429 (CI, push to `cleanup`), job `practice-integration` (job 111837662900),
colour codes stripped:

```
2026-10-05T15:23:03.1803098Z ##[group]Run set -euo pipefail
2026-10-05T15:23:03.1803475Z pnpm exec vitest run tests/ci/practice-quota.pg.ci.test.ts \
2026-10-05T15:23:03.1803771Z   --reporter=default --reporter=json --outputFile=/tmp/vitest-practice-quota.json
2026-10-05T15:23:03.1804111Z node scripts/ci/vitest-summary-gate.mjs --json /tmp/vitest-practice-quota.json \
2026-10-05T15:23:03.1804381Z   --file tests/ci/practice-quota.pg.ci.test.ts
2026-10-05T15:23:03.1855968Z   PGHOST: localhost
2026-10-05T15:23:05.7867568Z  ✓ tests/ci/practice-quota.pg.ci.test.ts (12 tests) 1905ms
2026-10-05T15:23:05.7868420Z      ✓ limit−1 and limit: the read, the GET /next 402 and the POST /sessions 402 agree  628ms
2026-10-05T15:23:05.7885405Z  Test Files  1 passed (1)
2026-10-05T15:23:05.7886097Z       Tests  12 passed (12)
2026-10-05T15:23:05.8342620Z VITEST SUMMARY GATE: PASS (12 passed, 0 skipped, 0 failed; 1 named file(s) ran with assertions)
```

The same file is also listed in the `ci` job's general `pnpm test` run. That run has no database,
so there it reports `(12 tests | 12 skipped)`, as every `*.pg.ci.test.ts` file does. The proof is
the dedicated step above.

The same log for this PR's head goes in the PR description once CI has run.

### The step fails on a skip

The same two commands, run locally on this branch:

```
$ env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD pnpm exec vitest run tests/ci/practice-quota.pg.ci.test.ts --reporter=default --reporter=json --outputFile=vq-skip.json
 ↓ tests/ci/practice-quota.pg.ci.test.ts (12 tests | 12 skipped)
      Tests  12 skipped (12)
$ node scripts/ci/vitest-summary-gate.mjs --json vq-skip.json --file tests/ci/practice-quota.pg.ci.test.ts
VITEST SUMMARY GATE: no test passed (numPassedTests = 0)
VITEST SUMMARY GATE: 12 test(s) skipped (numPendingTests)
gate_exit=1

$ PGHOST=localhost … pnpm exec vitest run tests/ci/practice-quota.pg.ci.test.ts --reporter=default --reporter=json --outputFile=vq-run.json
 ✓ tests/ci/practice-quota.pg.ci.test.ts (12 tests) 3968ms
      Tests  12 passed (12)
$ node scripts/ci/vitest-summary-gate.mjs --json vq-run.json --file tests/ci/practice-quota.pg.ci.test.ts
VITEST SUMMARY GATE: PASS (12 passed, 0 skipped, 0 failed; 1 named file(s) ran with assertions)
gate_exit=0
```

A single skipped test fails the gate as well (`numPendingTests > 0`); the gate's self-test covers
that case.

---

## 4. knip is reproducible from the repo (LOW)

- **Config:** `knip.json`, committed.
- **Scripts:** `pnpm run deadcode`, and `pnpm run deadcode:production` for shipped code only.
  Both run `pnpm dlx knip@5.88.1`, pinned, with no dependency added.
- **Output:** the run on this branch is pasted in full in [`deletions.md`](deletions.md), section
  "knip, committed (Codex audit finding 4, 2026-10-05)".
- **New finding:** that first run turned up unused student-UI shared exports, recorded as register
  F-76.
