# Scoping: the `pnpm lint` baseline

**Status:** scoped, not started. Owner ruling 2026-09-25: "scope it as its own piece."
**Measured:** 2026-09-26 on `cleanup` @ `7d1d4b5e`, via `pnpm -s run lint -f json`.

## Why this is worth doing, in one line

`pnpm lint` exits 1 with **1342 findings**, so a new violation is indistinguishable from the
existing pile. That is the same absence-of-signal class the deletion vertical kept finding: the
check runs, the check is red, and its redness carries no information. **The goal is not 1342
fixes. It is restoring the signal.**

## What the 1342 actually are

139 files of 913 carry a finding. 1341 errors, 1 warning.

| rule | count |
|---|---|
| `no-console` | 654 |
| `@typescript-eslint/no-explicit-any` | 367 |
| `no-undef` | 228 |
| `@typescript-eslint/no-unused-vars` | 54 |
| tail (9 rules, ≤8 each) | 39 |

**The headline finding: roughly 43% is eslint configuration, not defects.** Measured, not assumed:

- **`no-undef` — 228, and all 228 are config.** Every one is in a `.js` (197) or `.mjs` (31)
  file, and 222 of them are `console` (179), `process` (43) and `Buffer` (2) — Node globals in
  Node scripts, where they are correct. The rule is firing because those files get no Node env.
  `no-undef` should be off for TypeScript entirely (typescript-eslint resolves identifiers) and
  the script files need `globals.node`. **Zero of these are real.**
- **`no-console` — 654, of which ~346 are in paths where console is correct**: `tests/*` (263),
  `scripts/ci` (55), `server/scripts` (28). CLAUDE.md §16 says "No `console.log` in **production
  code**" — the rule is currently applied everywhere, so it flags test harnesses and CI scripts
  for doing the right thing.

That leaves the residue that is genuinely worth attention:

| real finding | count | note |
|---|---|---|
| `no-explicit-any` in production paths | **151** | `server/routes` 61, `server/logger.ts` 24, `client/src` 23, `apps/api` 11, `server/index.ts` 10, `server/middleware` 5. **`any` is a named CLAUDE.md hard stop**, so each is a stated-invariant violation. |
| `no-console` in production surfaces | **171** | `apps/api` 91, `client/src` 47, `server/index.ts` 33. The structured logger exists; these bypass it. |
| `no-explicit-any` in tests | 216 | Lower stakes, but the hard stop is not scoped to production in CLAUDE.md's wording. Needs a ruling: does the `any` ban cover test code? |
| `no-unused-vars` | 54 | Mechanical. |
| tail | 39 | `no-useless-escape` 8, `no-misleading-character-class` 8, `no-empty` 6, `no-require-imports` 4, and a handful of others. `no-empty` is worth reading individually — CLAUDE.md forbids silent catch. |

## Proposed approach, in order

**Step 1 — fix the config, measure again.** Turn `no-undef` off for TS, add `globals.node` to
`.js`/`.mjs` scripts, and scope `no-console` to production paths (exempt `tests/**`,
`scripts/**`, `server/scripts/**`). Expected to remove ~574 findings **without touching a line of
product code**. Nothing here is a behaviour change; it makes the linter describe this repo's
actual shape. One PR, mechanical, easy to review.

**Step 2 — ratchet, do not boil the ocean.** With the count honest, freeze the residue as a
baseline and fail CI on anything NEW. This is what restores the signal, and it is available
immediately after step 1 — it does not wait for the backlog to reach zero. Without a ratchet the
backlog regrows faster than it is paid down, which is how it got to 1342.

**Step 3 — pay down the real backlog by class, each its own PR.** Suggested order by value:
`no-empty` (6, may hide silent catches — an invariant), then `no-explicit-any` in
`server/routes` + `server/middleware` (66, boundary code where `unknown` + Zod is the stated
pattern), then `server/logger.ts` (24, one file), then the rest.

**Deliberately excluded:** the 216 test-side `any`s, pending a ruling on whether the hard stop
covers test code. Doing them speculatively would be the largest and least valuable slice.

## Two things to decide before starting

1. **Does the `any` hard stop cover test code?** 216 of the 367 are in tests. CLAUDE.md does not
   say. The answer changes the size of this piece by more than half.
2. **Is a lint ratchet acceptable in CI**, i.e. green with a known non-zero baseline? The
   alternative is staying red until zero, which means staying signal-less for however long that
   takes.

## What this scoping is not

Not measured: whether any of the 1342 masks a live defect. The classes above are style and
type-safety findings; `no-empty` is the only one that could hide a behaviour bug, and it is 6
occurrences. No claim is made here about production.
