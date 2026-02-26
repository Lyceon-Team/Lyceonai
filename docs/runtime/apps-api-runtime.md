# apps/api runtime reality (authoritative)

## What `apps/api` is
`apps/api` is a TypeScript package that provides:
- Express routers under `apps/api/src/routes/*`
- Middleware under `apps/api/src/middleware/*`
- Services / shared libraries used by the production server

It is imported by the production server entrypoint, not the primary production runtime itself.

## Production API runtime (source of truth)
- Entrypoint: `server/index.ts`
- Build (repo root): `pnpm -s run build` → produces `dist/index.js`
- Start (repo root): `pnpm -s run start` → runs `NODE_ENV=production node dist/index.js`

## apps/api scripts (local / tooling)
- `pnpm -C apps/api -s run dev`
  - Runs `src/index.ts` via `tsx` for local development of this package.
- `pnpm -C apps/api -s run build`
  - Bundles `src/index.ts` to `apps/api/dist/` (only relevant if running apps/api standalone).
- `pnpm -C apps/api -s run start`
  - Runs `node dist/index.js` after a local `apps/api` build.

## Notes on Next scripts
`apps/api/package.json` contains `next:*` scripts. These are not part of the production API runtime unless explicitly wired elsewhere.
If/when Next usage is confirmed, document the real entrypoint and deployment target here.

## Determinism rule
All binaries (`esbuild`, `tsx`) must be invoked via `pnpm exec` to avoid PATH-dependent failures.
