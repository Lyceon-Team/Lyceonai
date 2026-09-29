# UI-00b / UI-60: server function bundle size (`dist/vercel-api.cjs`)

Recorded 2026-09-29. This is the bundle half of UI-00b ("before") and of UI-60 ("after"). The timing half of UI-00b and the Lighthouse runs target production and are recorded by the Wave 0 session.

## Method

- The bundle is built by `pnpm run build:vercel` (the `buildCommand` in `vercel.json:4`; the script is `package.json:19`). It runs `pnpm -s run build` and then:
  `esbuild server/index.ts --bundle --platform=node --format=cjs --external:@google-cloud/bigquery --outfile=dist/vercel-api.cjs`
- `pnpm -s run build` alone does not produce `dist/vercel-api.cjs`.
- Each ref was built in its own detached worktree after `pnpm install --frozen-lockfile`. Toolchain: Node v22.22.2, pnpm 10.33.0.
- **Before** is `origin/main`, not `cleanup`, because `cleanup` already contains the vertical (owner correction, 2026-09-29).
  - `git merge-base --is-ancestor <vertical merge> origin/main` returns false.
  - `git ls-tree origin/main -- supabase/migrations | grep -c hot_path_fk_index` returns `0`.
- **After** is `origin/cleanup`. All 23 non-merge commits in `origin/main..origin/cleanup` belong to this vertical, so the difference below is the vertical's alone.

## Results

| Figure | Ref | Commit built | Raw bytes | `gzip -9` bytes | sha256 (first 16) |
|---|---|---|---|---|---|
| UI-00b before | `origin/main` | `682c71c3debe65557a51f6a3b240b46cb62742fb` | 5,618,816 | 1,109,294 | `729ece847ba1cf42` |
| UI-60 after | `origin/cleanup` | `1a3af9bd03587b965c4dbd839b499e5a5d7a3245` | 5,604,086 | 1,107,277 | `bcfa2670ca88f446` |
| Difference | | | −14,730 (−0.26%) | −2,017 (−0.18%) | |

The raw size comes from `stat -c %s dist/vercel-api.cjs`, and the gzip size from `gzip -9 -c dist/vercel-api.cjs | wc -c`.

The deployed function may be compressed differently by Vercel. Gzip is given only as a like-for-like comparison.
