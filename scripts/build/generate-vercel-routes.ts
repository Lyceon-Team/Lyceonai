/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F2, F12] | @implemented [2026-10-03]
 *
 * plain English: writes vercel.json's `routes` from infra/route-surface-classification.yaml
 * (`buildVercelRoutes` in shared/seo/route-registry.ts). The security-headers route and the
 * function routes are re-emitted unchanged; every other top-level key of vercel.json is untouched.
 *
 *   pnpm run generate:vercel-routes          rewrite vercel.json
 *   pnpm run generate:vercel-routes --check  exit 1 if vercel.json differs from what it would write
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVercelRoutes,
  parseRouteRegistry,
  type VercelRoute,
} from "../../shared/seo/route-registry";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERCEL = resolve(ROOT, "vercel.json");

const current = readFileSync(VERCEL, "utf8");
const config = JSON.parse(current) as { routes?: VercelRoute[] } & Record<
  string,
  unknown
>;
const registry = parseRouteRegistry(
  readFileSync(
    resolve(ROOT, "infra/route-surface-classification.yaml"),
    "utf8",
  ),
);
const next = `${JSON.stringify({ ...config, routes: buildVercelRoutes(registry, config.routes ?? []) }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (next !== current) {
    process.stderr.write(
      "vercel.json routes are not what the registry generates — run `pnpm run generate:vercel-routes`\n",
    );
    process.exit(1);
  }
  process.stdout.write("vercel.json routes match the registry\n");
} else {
  writeFileSync(VERCEL, next);
  process.stdout.write("vercel.json routes written from the registry\n");
}
