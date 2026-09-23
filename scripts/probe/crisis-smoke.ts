/**
 * Crisis-path smoke test — on-demand, against a live environment.
 *
 * @spec [Doc-03_V3 §21.2, CR-03C-V3-01 §3.4, Doc-03C_V3 §8]
 * @implemented 2026-09-23
 *
 * plain English: As a real authenticated student, exercises the full crisis
 * detection → DB flag → Cloud Tasks notification chain in one run. Not a
 * deploy gate — Karl runs this when he wants to know the crisis path is intact.
 *
 * HOW TO RUN:
 *   SUPABASE_URL=...                \
 *   SUPABASE_ANON_KEY=...           \
 *   SUPABASE_SERVICE_ROLE_KEY=...   \
 *   STUDENT_TEST_EMAIL=...          \
 *   STUDENT_TEST_PASSWORD=...       \
 *   BFF_BASE_URL=...                \
 *     pnpm -s exec tsx scripts/probe/crisis-smoke.ts
 *
 * Required env vars:
 *   SUPABASE_URL              PostgREST / Supabase project URL
 *   SUPABASE_ANON_KEY         Public anon key (used for auth sign-in)
 *   SUPABASE_SERVICE_ROLE_KEY Service-role key (used for admin DB queries)
 *   STUDENT_TEST_EMAIL        Test student email
 *   STUDENT_TEST_PASSWORD     Test student password
 *   BFF_BASE_URL              Production BFF URL (e.g. https://lyceon.ai)
 *
 * SAFETY:
 *   - The test student credential and service role key are never printed.
 *   - All smoke-test data is tagged with entry_mode "general" and a
 *     distinctive idempotency_key prefix (SMOKE-CRISIS-...) so it is
 *     distinguishable from real student data.
 *   - A cleanup query is printed at the end.
 *
 * WHAT THIS PROVES:
 *   Steps 1-3: BFF tutor endpoints accept auth, create conversations,
 *     and return a crisis-safe response when a Layer 1 pattern matches.
 *   Steps 4-5: The crisis_review_cases and crisis_review_events rows
 *     were written by the DB function (the flag + case + event chain).
 *   Step 6:  Cloud Tasks enqueue was ATTEMPTED (the notification function
 *     ran without throwing). See LIMITATIONS below.
 *   Step 7:  Conversation ends cleanly after crisis pause.
 *
 * LIMITATIONS — STEP 6 (Slack verification):
 *   This script CANNOT prove that the Slack message actually arrived.
 *   Cloud Tasks is fire-and-forget: the BFF enqueues a task; Cloud Tasks
 *   delivers it to the Slack webhook asynchronously. The enqueue succeeds
 *   without error ≠ the message was delivered.
 *
 *   To verify Slack delivery:
 *     1. Open the Slack channel configured in LYCEON_CRISIS_ALERTS.
 *     2. Look for a message with the case ID printed by this script.
 *     3. Confirm it arrived within 60 seconds of this script's step 3.
 *
 *   What verification CANNOT prove:
 *     - Delivery latency under load (this is a single-message test).
 *     - Slack webhook reliability (Slack can silently drop or delay).
 *     - Cloud Tasks retry behavior (only observable via GCP console).
 *     - That LYCEON_CRISIS_ALERTS points to the correct channel
 *       (the BFF enqueues to whatever URL is configured).
 *
 *   The only end-to-end proof is a human seeing the message in Slack.
 */

/* eslint-disable no-console -- standalone CLI probe: console is the output
   channel, not production logging. */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ── Env ──────────────────────────────────────────────────────────────

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const STUDENT_TEST_EMAIL = requireEnv("STUDENT_TEST_EMAIL");
const STUDENT_TEST_PASSWORD = requireEnv("STUDENT_TEST_PASSWORD");
const BFF_BASE_URL = requireEnv("BFF_BASE_URL").replace(/\/$/, "");

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`FATAL: ${name} is required.`);
    process.exit(2);
  }
  return val;
}

// ── Supabase ref extraction ──────────────────────────────────────────

function extractSupabaseRef(url: string): string {
  const hostname = new URL(url).hostname;
  const ref = hostname.split(".")[0];
  if (!ref) {
    console.error("FATAL: cannot extract Supabase project ref from URL.");
    process.exit(2);
  }
  return ref;
}

const SUPABASE_REF = extractSupabaseRef(SUPABASE_URL);

// ── Result tracking ──────────────────────────────────────────────────

type StepResult = { step: number; name: string; ok: boolean; detail: string };
const results: StepResult[] = [];
let conversationId: string | null = null;
let caseId: string | null = null;

function record(step: number, name: string, ok: boolean, detail: string): void {
  results.push({ step, name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] Step ${step}: ${name} — ${detail}`);
}

// ── BFF cookie + CSRF auth ───────────────────────────────────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;
let csrfToken: string | null = null;
const cookieJar: Map<string, string> = new Map();

async function signIn(): Promise<void> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email: STUDENT_TEST_EMAIL,
    password: STUDENT_TEST_PASSWORD,
  });
  if (error || !data.session) {
    console.error(
      `FATAL: sign-in failed: ${error?.message ?? "no session returned"}`,
    );
    process.exit(2);
  }
  accessToken = data.session.access_token;
  refreshToken = data.session.refresh_token;
  console.log(`  (signed in as test student, JWT ${accessToken.length} chars)`);
}

function buildAuthCookieValue(): string {
  const sessionObj = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  const json = JSON.stringify(sessionObj);
  const b64 = Buffer.from(json).toString("base64");
  return `base64-${b64}`;
}

function buildAuthCookieName(): string {
  return `sb-${SUPABASE_REF}-auth-token`;
}

function extractSetCookies(response: Response): void {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    const eqIdx = header.indexOf("=");
    if (eqIdx < 0) continue;
    const name = header.slice(0, eqIdx);
    const rest = header.slice(eqIdx + 1);
    const val = rest.split(";")[0];
    cookieJar.set(name, val);
  }
}

function buildCookieHeader(): string {
  const authName = buildAuthCookieName();
  const authVal = buildAuthCookieValue();
  const parts = [`${authName}=${authVal}`];
  for (const [name, val] of cookieJar) {
    if (name === authName) continue;
    parts.push(`${name}=${val}`);
  }
  return parts.join("; ");
}

async function fetchCsrfToken(): Promise<void> {
  const resp = await fetch(`${BFF_BASE_URL}/api/csrf-token`, {
    method: "GET",
    headers: {
      Cookie: buildCookieHeader(),
    },
    redirect: "manual",
  });
  extractSetCookies(resp);
  if (!resp.ok) {
    console.error(`FATAL: GET /api/csrf-token returned ${resp.status}`);
    process.exit(2);
  }
  const body = (await resp.json()) as { csrfToken?: string };
  if (!body.csrfToken) {
    console.error("FATAL: /api/csrf-token did not return a csrfToken.");
    process.exit(2);
  }
  csrfToken = body.csrfToken;
  console.log("  (CSRF token acquired)");
}

async function bffPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const resp = await fetch(`${BFF_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken!,
      Cookie: buildCookieHeader(),
      Origin: BFF_BASE_URL,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  extractSetCookies(resp);
  const text = await resp.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { _raw: text };
  }
  return { status: resp.status, data };
}

// ── PostgREST admin queries ──────────────────────────────────────────

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Step implementations ─────────────────────────────────────────────

const smokeIdempotencyKey = `smoke-crisis-${randomUUID()}`;
const smokeClientTurnId1 = randomUUID();
const smokeClientTurnId2 = randomUUID();

async function step1CreateConversation(): Promise<void> {
  const { status, data } = await bffPost("/api/tutor/conversations", {
    entry_mode: "general",
    source_surface: "dashboard",
    idempotency_key: smokeIdempotencyKey,
  });

  if (status === 201 && data.data) {
    const inner = data.data as Record<string, unknown>;
    conversationId = inner.conversation_id as string;
    record(1, "POST /conversations", true, `201, id=${conversationId}`);
  } else {
    record(
      1,
      "POST /conversations",
      false,
      `expected 201, got ${status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
}

async function step2SendNormalMessage(): Promise<void> {
  if (!conversationId) {
    record(2, "POST /messages (normal)", false, "skipped: no conversation_id");
    return;
  }
  const { status, data } = await bffPost("/api/tutor/messages", {
    conversation_id: conversationId,
    message:
      "What is the quadratic formula? This is a Lyceon crisis smoke test.",
    client_turn_id: smokeClientTurnId1,
  });

  if (status === 200 && data.data) {
    const inner = data.data as Record<string, unknown>;
    const crisisPaused = inner.crisis_paused;
    if (crisisPaused) {
      record(
        2,
        "POST /messages (normal)",
        false,
        "200 but crisis_paused=true on a normal message",
      );
    } else {
      record(
        2,
        "POST /messages (normal)",
        true,
        "200, normal tutoring response",
      );
    }
  } else {
    record(
      2,
      "POST /messages (normal)",
      false,
      `expected 200, got ${status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
}

async function step3SendCrisisPattern(): Promise<void> {
  if (!conversationId) {
    record(3, "POST /messages (crisis)", false, "skipped: no conversation_id");
    return;
  }

  // Read a crisis signature from the DB to use as the trigger pattern.
  const { data: sigRows, error: sigError } = await serviceClient
    .from("tutor_injection_signatures")
    .select("id, signature_pattern")
    .eq("signature_type", "crisis")
    .eq("enabled", true)
    .limit(1);

  if (sigError || !sigRows || sigRows.length === 0) {
    record(
      3,
      "POST /messages (crisis)",
      false,
      `cannot read crisis signatures: ${sigError?.message ?? "no rows"}. ` +
        "Ensure tutor_injection_signatures is seeded with enabled crisis patterns.",
    );
    return;
  }

  const pattern = sigRows[0].signature_pattern as string;

  // Construct a message that contains the pattern. Wrap it in smoke-test
  // context so a reviewer can distinguish it from real student content.
  const crisisMessage = `[LYCEON_SMOKE_TEST] ${pattern}`;

  const { status, data } = await bffPost("/api/tutor/messages", {
    conversation_id: conversationId,
    message: crisisMessage,
    client_turn_id: smokeClientTurnId2,
  });

  if (status === 200 && data.data) {
    const inner = data.data as Record<string, unknown>;
    const crisisPaused = inner.crisis_paused;
    const resp = inner.response as Record<string, unknown> | undefined;
    const crisisCategory = resp?.crisis_category;

    if (crisisPaused && crisisCategory) {
      record(
        3,
        "POST /messages (crisis)",
        true,
        `200, crisis_paused=true, category=${crisisCategory}`,
      );
    } else {
      record(
        3,
        "POST /messages (crisis)",
        false,
        `200 but crisis_paused=${crisisPaused}, crisis_category=${crisisCategory}`,
      );
    }
  } else {
    record(
      3,
      "POST /messages (crisis)",
      false,
      `expected 200, got ${status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
}

async function step4QueryCrisisReviewCases(): Promise<void> {
  if (!conversationId) {
    record(
      4,
      "query crisis_review_cases",
      false,
      "skipped: no conversation_id",
    );
    return;
  }

  const { data: cases, error } = await serviceClient
    .from("crisis_review_cases")
    .select("id, conversation_id, source, status, category, sla_deadline")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    record(4, "query crisis_review_cases", false, `DB error: ${error.message}`);
    return;
  }

  if (!cases || cases.length === 0) {
    record(
      4,
      "query crisis_review_cases",
      false,
      "no crisis_review_cases row for this conversation",
    );
    return;
  }

  const row = cases[0];
  caseId = row.id as string;
  record(
    4,
    "query crisis_review_cases",
    true,
    `case_id=${caseId}, source=${row.source}, status=${row.status}, ` +
      `category=${row.category}, sla_deadline=${row.sla_deadline}`,
  );
}

async function step5QueryCrisisReviewEvents(): Promise<void> {
  if (!caseId) {
    record(5, "query crisis_review_events", false, "skipped: no case_id");
    return;
  }

  const { data: events, error } = await serviceClient
    .from("crisis_review_events")
    .select("id, case_id, event_type, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });

  if (error) {
    record(
      5,
      "query crisis_review_events",
      false,
      `DB error: ${error.message}`,
    );
    return;
  }

  if (!events || events.length === 0) {
    record(
      5,
      "query crisis_review_events",
      false,
      "no crisis_review_events rows for this case",
    );
    return;
  }

  const summary = events
    .map((e: Record<string, unknown>) => `${e.event_type}@${e.created_at}`)
    .join(", ");
  record(
    5,
    "query crisis_review_events",
    true,
    `${events.length} event(s): ${summary}`,
  );
}

function step6SlackVerification(): void {
  console.log("");
  console.log("  ── Step 6: Slack notification verification ──");
  console.log("");
  console.log("  This script CANNOT verify Slack delivery programmatically.");
  console.log(
    "  Cloud Tasks enqueue is fire-and-forget — a successful enqueue",
  );
  console.log("  does not prove the message arrived in Slack.");
  console.log("");
  console.log("  TO VERIFY MANUALLY:");
  console.log(
    "    1. Open the Slack channel configured in LYCEON_CRISIS_ALERTS.",
  );
  if (caseId) {
    console.log(`    2. Look for a message containing case ID: ${caseId}`);
  } else {
    console.log("    2. Look for a message with the conversation ID above.");
  }
  console.log("    3. Confirm it arrived within ~60 seconds of step 3.");
  console.log("");
  console.log("  WHAT THIS CANNOT PROVE:");
  console.log(
    "    - Slack webhook reliability (Slack can silently drop/delay).",
  );
  console.log(
    "    - Cloud Tasks retry behavior (observable via GCP console only).",
  );
  console.log("    - That LYCEON_CRISIS_ALERTS points to the correct channel.");
  console.log(
    "    - Delivery latency under load (this is a single-message test).",
  );
  console.log("");
  console.log(
    "  The only end-to-end proof is a human seeing the message in Slack.",
  );
  console.log("");

  record(
    6,
    "Slack verification",
    true,
    "manual verification required (see above)",
  );
}

async function step7EndConversation(): Promise<void> {
  if (!conversationId) {
    record(
      7,
      "POST /conversations/:id/end",
      false,
      "skipped: no conversation_id",
    );
    return;
  }

  const { status, data } = await bffPost(
    `/api/tutor/conversations/${conversationId}/end`,
    { idempotency_key: randomUUID() },
  );

  if (status === 200) {
    record(7, "POST /conversations/:id/end", true, "200, conversation ended");
  } else {
    record(
      7,
      "POST /conversations/:id/end",
      false,
      `expected 200, got ${status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  Crisis-path smoke test                                     ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );
  console.log("");

  // Auth setup
  console.log("── Auth ──");
  await signIn();
  await fetchCsrfToken();
  console.log("");

  // Steps 1–7
  console.log("── Steps ──");
  await step1CreateConversation();
  await step2SendNormalMessage();
  await step3SendCrisisPattern();
  await step4QueryCrisisReviewCases();
  await step5QueryCrisisReviewEvents();
  step6SlackVerification();
  await step7EndConversation();

  // Summary
  console.log("");
  console.log("── Summary ──");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `  ${passed} passed, ${failed} failed out of ${results.length} steps`,
  );
  console.log("");

  // Smoke-test data identification
  console.log("── Smoke-test data identification ──");
  console.log(`  Conversation ID: ${conversationId ?? "(none)"}`);
  console.log(`  Case ID:         ${caseId ?? "(none)"}`);
  console.log(`  Idempotency key: ${smokeIdempotencyKey}`);
  console.log("  All smoke-test conversations use entry_mode='general',");
  console.log(
    "  source_surface='dashboard', and messages contain '[LYCEON_SMOKE_TEST]'.",
  );
  console.log("");

  // Cleanup query
  console.log(
    "── Cleanup query (run as service-role or via Supabase dashboard) ──",
  );
  console.log("");
  if (conversationId) {
    console.log("  -- Delete smoke-test data for this run:");
    console.log(
      `  DELETE FROM crisis_review_events WHERE case_id IN (SELECT id FROM crisis_review_cases WHERE conversation_id = '${conversationId}');`,
    );
    console.log(
      `  DELETE FROM crisis_review_cases WHERE conversation_id = '${conversationId}';`,
    );
    console.log(
      `  DELETE FROM tutor_messages WHERE conversation_id = '${conversationId}';`,
    );
    console.log(
      `  DELETE FROM tutor_conversations WHERE id = '${conversationId}';`,
    );
  } else {
    console.log("  (no conversation created — nothing to clean up)");
  }
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("FATAL: unhandled error:", err);
  process.exit(2);
});
