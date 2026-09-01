#!/usr/bin/env node
/**
 * @spec [Doc-01A §3 (bootstrap order); Coding Standards §14]
 * @implemented 2026-09-01
 *
 * plain English: Loads the ACTUAL production bundle (dist/vercel-api.cjs) in a
 * child process with NODE_ENV=production and only the documented production
 * environment set, and asserts that module load completes. This is the gate
 * that would have caught the 2026-08-27 outage, in which a module-scope throw
 * inside an internal route file crashed the whole Vercel function and returned
 * 500 for `/auth/callback` and every `/api/*` route for 4.8 days.
 *
 * expected outcome:
 *   sufficiency — bundle boots with only the manifest's `required` set.
 *   necessity   — removing any one required variable stops it booting.
 *   Non-zero exit on either failure.
 *
 * WHY A PROBE AND NOT A SCANNER. The proximate cause was a `throw` at module
 * scope, so "grep for module-scope throws" looks like the fix. It is not
 * sufficient. The same crash has at least three shapes in this bundle:
 *   1. a literal `throw` at module scope        (the OIDC route files)
 *   2. an import-time CALL to something that throws
 *      (`validateEnvironment()` -> apps/api/src/env.ts)
 *   3. an import-time call to something that calls `process.exit(1)`
 *      (`validateSiteUrl()` -> server/index.ts) — no throw exists to find
 * plus every import-time call into node_modules, which no static analysis of
 * this repo can see. Loading the bundle covers all of them identically,
 * because it asks the only question that matters: does the process start.
 *
 * trade-offs:
 *  - Requires the bundle to be built first. CI builds it via `build:vercel`,
 *    which is also the artifact production runs — before this change CI only
 *    built `dist/index.js` (ESM, --packages=external) and never compiled the
 *    CJS bundle Vercel actually loads.
 *  - The child gets an explicit env, not `process.env`, so a variable that
 *    happens to be set on the CI runner cannot mask a missing one.
 *  - A boot that hangs counts as a failed boot (timeout), because a function
 *    that never finishes initialising serves nothing.
 *
 * DRIFT — the one thing this cannot check. The probe proves the code boots
 * with the manifest. It cannot prove Vercel's production environment actually
 * contains those names; nothing in CI can see Vercel's env. The necessity
 * check is what keeps that gap narrow: a variable cannot be added to the
 * manifest unless the boot genuinely depends on it, so every addition is a
 * deliberate, reviewable act that says "production must now also set this".
 * Closing the gap fully needs a `GET /v9/projects/:id/env` call with a Vercel
 * token in CI, comparing names only. That is a follow-up, not this hotfix.
 *
 * edge cases:
 *  - Bundle missing → exits 2 with the build command to run.
 *  - Child killed by signal → treated as a crash, with the signal reported.
 *  - Successful boot leaves an HTTP listener open; the child exits explicitly
 *    rather than waiting for the event loop to drain.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const BUNDLE = path.join(REPO_ROOT, "dist/vercel-api.cjs");
const MANIFEST = path.join(HERE, "boot-env.manifest.json");
const TIMEOUT_MS = 60_000;
const SENTINEL = "LYCEON_BOOT_OK";

/** Load the bundle, print the sentinel, exit. CommonJS: `node -e` defaults to CJS. */
const LOADER = `require(process.env.__BOOT_BUNDLE);console.log("${SENTINEL}");process.exit(0);`;

/**
 * Boot the bundle once with an exact environment.
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
function bootOnce(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", LOADER], {
      cwd: REPO_ROOT,
      env: { ...env, __BOOT_BUNDLE: BUNDLE, PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (out.includes(SENTINEL) && code === 0) {
        resolve({ ok: true, detail: "boot completed" });
        return;
      }
      const firstError =
        (err.match(/^\s*(?:Error|[A-Za-z]*Error):.*$/m)?.[0] ?? "").trim() ||
        (err.match(/^.*FATAL.*$/m)?.[0] ?? "").trim() ||
        (signal ? `killed by ${signal}` : `exit code ${code}, no error text`);
      resolve({ ok: false, detail: firstError });
    });
  });
}

function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  if (!raw.required || typeof raw.required !== "object") {
    throw new Error(`${MANIFEST}: missing a "required" object`);
  }
  return raw;
}

async function main() {
  const mode = process.argv[2] ?? "--all";

  if (!fs.existsSync(BUNDLE)) {
    console.error(`✗ boot probe: ${path.relative(REPO_ROOT, BUNDLE)} not found`);
    console.error("  Build it first:  pnpm run build:vercel");
    process.exit(2);
  }

  const manifest = loadManifest();
  const required = manifest.required;
  const harness = manifest.harness ?? {};
  const names = Object.keys(required);

  console.log("boot probe — production bundle module-load gate");
  console.log(`  bundle:   ${path.relative(REPO_ROOT, BUNDLE)}`);
  console.log(`  manifest: ${names.length} required variables\n`);

  let failed = false;

  if (mode === "--all" || mode === "--sufficiency") {
    const started = Date.now();
    const res = await bootOnce({ ...harness, ...required });
    const ms = Date.now() - started;
    if (res.ok) {
      console.log(`✓ sufficiency: boots with only the manifest set (${ms}ms)`);
    } else {
      failed = true;
      console.error(`✗ sufficiency: the bundle does NOT boot (${ms}ms)`);
      console.error(`    ${res.detail}`);
      console.error(
        "\n  The production bundle cannot start with the documented environment.",
      );
      console.error(
        "  Either this change made module load depend on something new — move that",
      );
      console.error(
        "  check to request time — or the new variable belongs in",
      );
      console.error(
        "  scripts/ci/boot-env.manifest.json AND in Vercel's production environment.",
      );
    }
  }

  if (mode === "--all" || mode === "--necessity") {
    console.log("");
    for (const name of names) {
      const partial = { ...harness, ...required };
      delete partial[name];
      const res = await bootOnce(partial);
      if (res.ok) {
        failed = true;
        console.error(
          `✗ necessity: boot SUCCEEDS without ${name} — it is not load-bearing`,
        );
        console.error(
          `    Remove it from the manifest, or the manifest is overstating what`,
        );
        console.error(
          `    production must set. Padding here hides real requirements.`,
        );
      } else {
        console.log(`✓ necessity: ${name} — boot fails without it`);
      }
    }
  }

  console.log("");
  if (failed) {
    console.error("BOOT PROBE: FAIL");
    process.exit(1);
  }
  console.log("BOOT PROBE: PASS");
}

main().catch((err) => {
  console.error("✗ boot probe crashed:", err);
  process.exit(2);
});
