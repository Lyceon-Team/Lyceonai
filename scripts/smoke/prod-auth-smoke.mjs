#!/usr/bin/env node
/**
 * @spec [contracts/auth-standard-flow.contract.md AS-7] | @implemented 2026-06-18
 * Post-deploy PRODUCTION auth smoke test. Exercises a REAL auth round-trip against the live
 * deployment — sign in with a seeded probe account, confirm a native session cookie is set, then
 * confirm GET /api/profile returns 200 authenticated. This is the gate that would have caught the
 * legal_acceptances outage: CI mocks the DB, so a missing prod table slipped through; this hits the
 * real stack end-to-end. Exits 1 on any failure (fails the deploy gate), 0 on pass, 0 (skip) when no
 * probe credentials are configured.
 *
 * Usage: SMOKE_BASE_URL=https://lyceon.ai SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/smoke/prod-auth-smoke.mjs
 */

const BASE = (process.env.SMOKE_BASE_URL || "https://lyceon.ai").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`SMOKE OK:   ${msg}`);
}

if (!EMAIL || !PASSWORD) {
  console.log(
    "SMOKE SKIP: set SMOKE_EMAIL + SMOKE_PASSWORD (a seeded probe account) to run the prod auth smoke.",
  );
  process.exit(0);
}

const cookies = new Map();
function storeSetCookie(res) {
  const set =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  for (const c of set) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) {
      cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}
function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function main() {
  // 1) CSRF token (signin is CSRF-protected) — also seeds the csrf cookie.
  const csrfRes = await fetch(`${BASE}/api/csrf-token`, {
    headers: { cookie: cookieHeader() },
  });
  if (!csrfRes.ok) fail(`/api/csrf-token returned ${csrfRes.status}`);
  storeSetCookie(csrfRes);
  const { csrfToken } = await csrfRes.json();
  if (!csrfToken) fail("/api/csrf-token returned no csrfToken");
  ok("obtained CSRF token");

  // 2) Sign in — expect 200 AND a native sb-*-auth-token session cookie.
  const signinRes = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      cookie: cookieHeader(),
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (signinRes.status !== 200) {
    fail(`/api/auth/signin returned ${signinRes.status} (expected 200)`);
  }
  storeSetCookie(signinRes);
  const hasSession = [...cookies.keys()].some((k) =>
    /^sb-.*-auth-token/.test(k),
  );
  if (!hasSession) {
    fail("signin returned 200 but set no sb-*-auth-token session cookie");
  }
  ok("signin established a native session cookie");

  // 3) Profile hydration — the step that 401'd during the outage. Must be 200 + authenticated.
  const profileRes = await fetch(`${BASE}/api/profile`, {
    headers: { cookie: cookieHeader() },
  });
  if (profileRes.status !== 200) {
    fail(
      `/api/profile returned ${profileRes.status} (expected 200) — session did not propagate`,
    );
  }
  const profile = await profileRes.json();
  if (!profile || profile.authenticated !== true) {
    fail("/api/profile 200 but authenticated !== true");
  }
  ok(`/api/profile 200 authenticated as ${profile.user?.email ?? "<unknown>"}`);

  console.log("SMOKE PASS: login -> session -> /api/profile 200");
}

main().catch((err) => fail(err?.message || String(err)));
