/**
 * Deletion vertical, phases 2/3/5 — real PostgreSQL proof.
 *
 * @spec [Doc-01_V8 §5 (the three deletion actions), §5.1 (ids NULL at hard delete; purge after
 *        anonymization_retention_days; PII redaction), App A.5 (grace_period_days,
 *        anonymization_retention_days, scheduled_deletion_job_cron), App E (audit_logs is
 *        append-only); SCL-085 / SCL-087 (PROPOSED); ICO suppression-list guidance;
 *        owner brief 2026-09-17 "Deletion Vertical: Phases 2, 3, 5" §2.4, §3.2, §5.5]
 *        | @implemented [2026-09-17]
 *
 * plain English: drives the REAL RPCs, the REAL executor and the REAL notification dispatcher
 * against a throwaway Postgres built from `supabase/migrations`. Substituted: the database
 * transport (supabase-shaped clients → SQL via tests/helpers/pg-supabase), the Stripe client
 * (never reached), the network (a fake fetch that records provider calls), and the logger
 * (captured, so a sweep that changed nothing can be proven to have said so).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "deletion_phases_235_ci";
const SECRET = "test-suppression-secret-do-not-use-in-prod";
const FROM_EMAIL = "notifications@send.example.test";

const SUBJECT = { id: "a0000000-0000-4000-8000-000000000001", email: "subject@phases.test" };
const OTHER = { id: "b0000000-0000-4000-8000-000000000002", email: "other@phases.test" };
const GUARDIAN = { id: "c0000000-0000-4000-8000-000000000003", email: "guardian@phases.test" };

let pg: Client;

// ── Logger recorder: the sweeps' zero-row lines are an assertion target ──────
type LogLine = { level: string; component: string; event: string; data: unknown };
const logged: LogLine[] = [];
vi.mock("../../server/logger", () => {
  const rec =
    (level: string) =>
    (component: string, event: string, _message?: unknown, a?: unknown, b?: unknown): void => {
      // logger.info/warn take (component, event, message, data); logger.error takes
      // (component, event, message, error, data). Keep the last argument either way.
      logged.push({ level, component, event, data: b ?? a });
    };
  return {
    logger: { info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug") },
  };
});
function lines(component: string, event: string): LogLine[] {
  return logged.filter((l) => l.component === component && l.event === event);
}

// ── Provider calls (Resend) ─────────────────────────────────────────────────
const provider = { calls: [] as Array<{ url: string; body: unknown }> };
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  provider.calls.push({
    url: typeof input === "string" ? input : input.toString(),
    body: JSON.parse(String(init?.body ?? "{}")),
  });
  return new Response(JSON.stringify({ id: "re_1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSupabaseAdmin: () => makePgSupabase(pg) };
});
vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => {
    throw new Error("getStripeClient must not be called in this suite");
  },
}));

function admin() {
  return makePgSupabase(pg) as never;
}
function storageStub() {
  return {
    listBuckets: async () => ({ data: [], error: null }),
    from: () => ({ list: async () => ({ data: [], error: null }) }),
  };
}
async function runExecutor(): Promise<{
  executedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const { executeDueDeletions } = await import("../../server/lib/account-deletion-execute");
  const base = makePgSupabase(pg);
  const client = { from: base.from, rpc: base.rpc, storage: storageStub() };
  return executeDueDeletions(client as never, "phases-ci");
}

async function seedUser(u: { id: string; email: string }, role = "student"): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u.id, u.email]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1, $2, $3, 'Someone')`,
    [u.id, u.email, role],
  );
}
async function seedConsent(profileId: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.legal_acceptances
       (user_id, doc_key, doc_version, actor_type, minor, consent_source, ip_address, user_agent, accepted_at)
     VALUES ($1, 'student-terms', 'v2', 'student', true, 'email_signup_form', '203.0.113.7',
             'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36', now() - interval '30 days')`,
    [profileId],
  );
}
async function request(profileId: string, suppression = false): Promise<{ requestId: string; logId: string }> {
  await pg.query(`SELECT * FROM public.request_account_deletion($1, $1, $2, 7)`, [
    profileId,
    `hash-${profileId}`,
  ]);
  const r = await pg.query(
    `UPDATE public.account_deletion_requests SET scheduled_hard_delete_at = now() - interval '1 hour'
      WHERE profile_id = $1 AND status = 'pending' RETURNING id, log_id`,
    [profileId],
  );
  const logId = String(r.rows[0]?.log_id);
  if (suppression) {
    await pg.query(
      `UPDATE public.deletion_request_log SET suppression_requested = true WHERE log_id = $1`,
      [logId],
    );
  }
  return { requestId: String(r.rows[0]?.id), logId };
}
async function auditRows(action?: string): Promise<Array<Record<string, unknown>>> {
  const r = await pg.query(
    `SELECT xmin::text AS x, actor_profile_id, target_profile_id, action, context
       FROM public.audit_logs ${action ? "WHERE action = $1" : ""} ORDER BY created_at`,
    action ? [action] : [],
  );
  return r.rows as Array<Record<string, unknown>>;
}
async function hashOf(address: string): Promise<string> {
  const { hashSuppressionAddress } = await import("../../server/lib/deletion-suppression");
  const h = hashSuppressionAddress(address, { SUPPRESSION_HMAC_SECRET: SECRET } as NodeJS.ProcessEnv);
  if (h === null) throw new Error("hash unexpectedly null");
  return h;
}

describe.skipIf(!PG_AVAILABLE)("deletion phases 2/3/5 — real Postgres", () => {
  beforeAll(async () => {
    process.env.SUPPRESSION_HMAC_SECRET = SECRET;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFICATION_FROM_EMAIL = FROM_EMAIL;
    process.env.PUBLIC_SITE_URL = "https://app.example.test";
    vi.stubGlobal("fetch", fakeFetch);
    pg = await bootstrapPgDatabase(DB_NAME);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (pg) await pg.end();
  });
  beforeEach(async () => {
    logged.length = 0;
    provider.calls.length = 0;
    process.env.SUPPRESSION_HMAC_SECRET = SECRET;
    await pg.query(`DELETE FROM public.deletion_request_log`);
    await pg.query(`DELETE FROM public.account_deletion_requests`);
    await pg.query(`DELETE FROM public.notification_events`);
    await pg.query(`DELETE FROM public.legal_acceptances`);
    await pg.query(`DELETE FROM public.anonymized_actors`);
    await pg.query(
      `SELECT public.apply_audit_logs_retention('strip_identity', p.id) FROM public.profiles p`,
    );
    await pg.query(
      `DO $$ BEGIN PERFORM set_config('lyceon.audit_logs_retention','on',true);
         DELETE FROM public.audit_logs; END $$;`,
    );
    await pg.query(`DELETE FROM public.profiles WHERE email LIKE '%@phases.test'`);
    await pg.query(`DELETE FROM auth.users WHERE email LIKE '%@phases.test'`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ══ PHASE 3 ═══════════════════════════════════════════════════════════════
  it("P3.1 audit_logs refuses UPDATE and DELETE — the trigger fires, for service_role too", async () => {
    await pg.query(`INSERT INTO public.audit_logs (action) VALUES ('probe')`);
    await expect(
      pg.query(`UPDATE public.audit_logs SET action = 'x' WHERE action = 'probe'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      pg.query(`DELETE FROM public.audit_logs WHERE action = 'probe'`),
    ).rejects.toThrow(/append-only/);
    const still = await pg.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action='probe'`);
    expect(still.rows[0]?.n).toBe(1);
  });

  it("P3.2 the exempt function may strip and purge, and closes the gate behind itself", async () => {
    await pg.query(
      `INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, created_at)
       VALUES ($1, $1, 'probe_old', now() - interval '400 days')`,
      [SUBJECT.id],
    );
    const stripped = await pg.query(
      `SELECT public.apply_audit_logs_retention('strip_identity', $1) AS r`, [SUBJECT.id],
    );
    expect((stripped.rows[0]?.r as { rows: number }).rows).toBe(1);
    const after = await auditRows("probe_old");
    expect(after[0]?.actor_profile_id).toBeNull();
    expect(after[0]?.target_profile_id).toBeNull();

    const purged = await pg.query(`SELECT public.apply_audit_logs_retention('purge_expired') AS r`);
    const p = purged.rows[0]?.r as { rows: number; cutoff: string };
    expect(p.rows).toBe(1);
    expect(p.cutoff).toBeTruthy();
    expect((await auditRows("probe_old")).length).toBe(0);

    // the gate is shut again after the call
    const gate = await pg.query(
      `SELECT coalesce(current_setting('lyceon.audit_logs_retention', true), '<unset>') AS g`,
    );
    expect(String(gate.rows[0]?.g)).not.toBe("on");
  });

  it("P3.3 a second function that tries the same mutation is refused, and exactly one body opens the gate", async () => {
    await pg.query(`INSERT INTO public.audit_logs (action) VALUES ('probe2')`);
    await pg.query(`
      CREATE OR REPLACE FUNCTION public._impostor_audit_purge() RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN DELETE FROM public.audit_logs WHERE action = 'probe2'; END; $f$;`);
    await expect(pg.query(`SELECT public._impostor_audit_purge()`)).rejects.toThrow(/append-only/);
    await pg.query(`DROP FUNCTION public._impostor_audit_purge()`);

    // The structural half: only one function in the schema may open the gate at all. This is
    // what stops a SECOND exempt path being added later without anyone noticing.
    const setters = await pg.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosrc LIKE '%lyceon.audit_logs_retention%'
          AND p.prosrc LIKE '%set_config%'`,
    );
    expect(setters.rows.map((r) => r.proname)).toEqual(["apply_audit_logs_retention"]);
  });

  it("P3.4 profile_soft_deleted at request and profile_restored on both recovery paths, with real ids", async () => {
    await seedUser(SUBJECT);
    await request(SUBJECT.id);
    const soft = await auditRows("profile_soft_deleted");
    expect(soft).toHaveLength(1);
    expect(soft[0]).toMatchObject({ actor_profile_id: SUBJECT.id, target_profile_id: SUBJECT.id });
    expect((soft[0]?.context as Record<string, unknown>).source).toBe("request_account_deletion");

    await pg.query(`SELECT public.cancel_account_deletion($1)`, [SUBJECT.id]);
    let restored = await auditRows("profile_restored");
    expect(restored).toHaveLength(1);
    expect((restored[0]?.context as Record<string, unknown>).path).toBe("in_app");

    await pg.query(`SELECT * FROM public.request_account_deletion($1, $1, 'tok2', 7)`, [SUBJECT.id]);
    await pg.query(`SELECT public.restore_account_deletion('tok2')`);
    restored = await auditRows("profile_restored");
    expect(restored).toHaveLength(2);
    expect((restored[1]?.context as Record<string, unknown>).path).toBe("recovery_token");
  });

  it("P3.5 profile_hard_deleted is written in T3 with a NULL target and shares no xmin with any actor_id-side row", async () => {
    await seedUser(SUBJECT);
    // a pre-existing audit row naming this profile — the at-execution strip's target
    await pg.query(
      `INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action)
       VALUES ($1, $1, 'guardian_link_initiated')`,
      [SUBJECT.id],
    );
    await pg.query(
      `INSERT INTO public.practice_sessions (user_id, actor_id, mode, target_count, platform, client_instance_id)
       SELECT p.id, p.actor_id, 'flow', 5, 'web', 'c1' FROM public.profiles p WHERE p.id = $1`,
      [SUBJECT.id],
    );
    await request(SUBJECT.id);

    expect(await runExecutor()).toEqual({ executedCount: 1, skippedCount: 0, failedCount: 0 });

    const hard = await auditRows("profile_hard_deleted");
    expect(hard).toHaveLength(1);
    expect(hard[0]?.actor_profile_id).toBeNull();
    expect(hard[0]?.target_profile_id).toBeNull();

    // the at-execution strip: the pre-existing row lost its ids
    const guardian = await auditRows("guardian_link_initiated");
    expect(guardian[0]?.actor_profile_id).toBeNull();
    expect(guardian[0]?.target_profile_id).toBeNull();

    // THE ISOLATION THE BRIEF NAMES: no audit row shares a transaction with the pseudonymous side
    const actorSide = await pg.query(
      `SELECT xmin::text AS x FROM public.practice_sessions
       UNION ALL SELECT xmin::text FROM public.anonymized_actors`,
    );
    const actorXmins = actorSide.rows.map((r) => String(r.x));
    expect(actorXmins.length).toBeGreaterThanOrEqual(2);
    for (const row of await auditRows()) {
      expect(actorXmins).not.toContain(String(row.x));
    }
  });

  // ══ PHASE 2 ═══════════════════════════════════════════════════════════════
  it("P2.1 suppression is recorded only when asked, stores no plaintext address, and reaches the provider", async () => {
    await seedUser(SUBJECT);
    await seedUser(OTHER);
    const asked = await request(SUBJECT.id, true);
    const notAsked = await request(OTHER.id, false);

    expect(await runExecutor()).toEqual({ executedCount: 2, skippedCount: 0, failedCount: 0 });

    const rows = await pg.query(`SELECT log_id, address_hash FROM public.deletion_suppression`);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.log_id).toBe(asked.logId);
    expect(rows.rows[0]?.address_hash).toBe(await hashOf(SUBJECT.email));
    expect(notAsked.logId).toBeTruthy();

    // NO PLAINTEXT: search every text column of the table for the literal address
    const leak = await pg.query(
      `SELECT count(*)::int AS n FROM public.deletion_suppression
        WHERE address_hash LIKE '%' || $1 || '%' OR address_hash = $1`,
      [SUBJECT.email],
    );
    expect(leak.rows[0]?.n).toBe(0);

    // the delivery-side half was called with the normalised address
    const suppressionCalls = provider.calls.filter((c) => c.url.endsWith("/suppressions"));
    expect(suppressionCalls).toHaveLength(1);
    expect(suppressionCalls[0]?.body).toEqual({ email: SUBJECT.email });
  });

  it("P2.2 a suppressed address receives no product notification — the dispatcher's guard is observed failing the message", async () => {
    await seedUser(SUBJECT);
    await seedUser(GUARDIAN, "guardian");
    await pg.query(`SELECT public.emit_notification_event($1,'guardian_linked',$2,$3::jsonb,$4::jsonb)`, [
      "d0000000-0000-4000-8000-00000000000d",
      SUBJECT.id,
      JSON.stringify([{ profile_id: GUARDIAN.id, channels: ["email"] }]),
      JSON.stringify({ link_id: "f0000000-0000-4000-8000-0000000000aa", student_display_name: "Sam" }),
    ]);

    const { getSuppressionStatus } = await import("../../server/lib/deletion-suppression");
    const { dispatchQueuedMessages } = await import("../../server/lib/notifications/dispatch");
    const sends: string[] = [];
    const transport = async (input: { to: string }) => {
      sends.push(input.to);
      return { ok: true as const, value: { providerMessageId: "re_x" } };
    };

    // not suppressed yet → it sends
    let summary = await dispatchQueuedMessages({ transport, suppressionCheck: getSuppressionStatus });
    expect(summary.sent).toBe(1);
    expect(sends).toEqual([GUARDIAN.email]);

    // now suppress that address and queue a second message
    const { logId } = await request(GUARDIAN.id, true);
    await pg.query(`SELECT public.record_deletion_suppression($1, $2)`, [
      logId,
      await hashOf(GUARDIAN.email),
    ]);
    await pg.query(`SELECT public.emit_notification_event($1,'guardian_linked',$2,$3::jsonb,$4::jsonb)`, [
      "d0000000-0000-4000-8000-00000000000e",
      SUBJECT.id,
      JSON.stringify([{ profile_id: GUARDIAN.id, channels: ["email"] }]),
      JSON.stringify({ link_id: "f0000000-0000-4000-8000-0000000000aa", student_display_name: "Sam" }),
    ]);
    sends.length = 0;
    summary = await dispatchQueuedMessages({ transport, suppressionCheck: getSuppressionStatus });
    expect(sends).toEqual([]);
    expect(summary.failed).toBe(1);
    const failed = await pg.query(
      `SELECT last_error FROM public.notification_messages WHERE status <> 'sent' AND channel='email'`,
    );
    expect(String(failed.rows[0]?.last_error)).toContain("do-not-contact");
  });

  it("P2.3 the deletion completion notice still sends to a suppressed address, and re-registration still succeeds", async () => {
    await seedUser(SUBJECT);
    await request(SUBJECT.id, true);
    expect(await runExecutor()).toEqual({ executedCount: 1, skippedCount: 0, failedCount: 0 });

    // the suppression exists at the moment the notice is sent — the bypass is observed, not assumed
    const suppressed = await pg.query(
      `SELECT public.is_address_suppressed($1) AS s`, [await hashOf(SUBJECT.email)],
    );
    expect(suppressed.rows[0]?.s).toBe(true);
    const notices = provider.calls.filter((c) => c.url.endsWith("/emails"));
    expect(notices).toHaveLength(1);
    expect((notices[0]?.body as { to: string[] }).to).toEqual([SUBJECT.email]);

    // registration consults nothing: the same address can be used again
    await seedUser({ id: "e0000000-0000-4000-8000-00000000000f", email: SUBJECT.email });
    const back = await pg.query(`SELECT count(*)::int AS n FROM public.profiles WHERE email = $1`, [
      SUBJECT.email,
    ]);
    expect(back.rows[0]?.n).toBe(1);
  });

  it("P2.4 the check defers rather than sends when it cannot tell (no secret)", async () => {
    const { getSuppressionStatus } = await import("../../server/lib/deletion-suppression");
    const status = await getSuppressionStatus("anyone@phases.test", {
      admin: admin(),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(status).toBe("unknown");
  });

  // ══ PHASE 5 ═══════════════════════════════════════════════════════════════
  it("P5.1 a terminal row past 24 months is STRIPPED, not deleted, and its consent evidence with it", async () => {
    await seedUser(SUBJECT);
    await seedConsent(SUBJECT.id);
    const { logId } = await request(SUBJECT.id);
    expect(await runExecutor()).toEqual({ executedCount: 1, skippedCount: 0, failedCount: 0 });
    await pg.query(
      `UPDATE public.deletion_request_log SET responded_on = (now() - interval '25 months')::date
        WHERE log_id = $1`, [logId],
    );

    const swept = await pg.query(`SELECT * FROM public.sweep_deletion_evidence(100)`);
    expect(swept.rows[0]).toMatchObject({ stripped_log_rows: 1, stripped_consent_rows: 1 });

    const row = await pg.query(
      `SELECT subject_email, requester_email, status, denial_basis,
              requested_on::text AS requested_on, responded_on::text AS responded_on
         FROM public.deletion_request_log WHERE log_id = $1`, [logId],
    );
    expect(row.rowCount).toBe(1); // stripped, NOT deleted
    expect(row.rows[0]?.subject_email).toBeNull();
    expect(row.rows[0]?.requester_email).toBeNull();
    expect(row.rows[0]?.status).toBe("completed");
    expect(row.rows[0]?.requested_on).toBeTruthy();
    expect(row.rows[0]?.responded_on).toBeTruthy();

    const consent = await pg.query(
      `SELECT ip_address, user_agent, doc_key, doc_version, actor_type, minor, consent_source,
              accepted_on::text AS accepted_on
         FROM public.deletion_consent_evidence WHERE log_id = $1`, [logId],
    );
    expect(consent.rowCount).toBe(1);
    expect(consent.rows[0]?.ip_address).toBeNull();
    expect(consent.rows[0]?.user_agent).toBeNull();
    expect(consent.rows[0]).toMatchObject({
      doc_key: "student-terms", doc_version: "v2", actor_type: "student",
      minor: true, consent_source: "email_signup_form",
    });
  });

  it("P5.2 a row inside the window is untouched, including at 729 days", async () => {
    await seedUser(SUBJECT);
    await seedConsent(SUBJECT.id);
    const { logId } = await request(SUBJECT.id);
    await runExecutor();
    await pg.query(
      `UPDATE public.deletion_request_log SET responded_on = (now() - interval '729 days')::date
        WHERE log_id = $1`, [logId],
    );
    const swept = await pg.query(`SELECT * FROM public.sweep_deletion_evidence(100)`);
    expect(swept.rows[0]).toMatchObject({ stripped_log_rows: 0, stripped_consent_rows: 0 });
    const row = await pg.query(
      `SELECT subject_email FROM public.deletion_request_log WHERE log_id = $1`, [logId],
    );
    expect(row.rows[0]?.subject_email).toBe(SUBJECT.email);
    const consent = await pg.query(
      `SELECT ip_address FROM public.deletion_consent_evidence WHERE log_id = $1`, [logId],
    );
    expect(consent.rows[0]?.ip_address).toBe("203.0.113.0/24");
  });

  it("P5.3 a suppression record older than the window survives the strip", async () => {
    await seedUser(SUBJECT);
    const { logId } = await request(SUBJECT.id, true);
    await runExecutor();
    await pg.query(
      `UPDATE public.deletion_request_log SET responded_on = (now() - interval '40 months')::date
        WHERE log_id = $1`, [logId],
    );
    await pg.query(`SELECT * FROM public.sweep_deletion_evidence(100)`);
    const kept = await pg.query(
      `SELECT address_hash FROM public.deletion_suppression WHERE log_id = $1`, [logId],
    );
    expect(kept.rowCount).toBe(1);
    expect(kept.rows[0]?.address_hash).toBe(await hashOf(SUBJECT.email));
    // and the promise is still enforceable
    const s = await pg.query(`SELECT public.is_address_suppressed($1) AS s`, [
      await hashOf(SUBJECT.email),
    ]);
    expect(s.rows[0]?.s).toBe(true);
  });

  it("P5.4 both sweeps log a run that changed nothing, with counts and cutoff", async () => {
    logged.length = 0;
    expect(await runExecutor()).toEqual({ executedCount: 0, skippedCount: 0, failedCount: 0 });

    const evidence = lines("DELETION", "evidence_sweep_complete");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.data).toMatchObject({ strippedLogRows: 0, strippedConsentRows: 0 });
    expect((evidence[0]?.data as { cutoff: string }).cutoff).toBeTruthy();

    const audit = lines("DELETION", "audit_purge_complete");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({ purgedRows: 0 });
    expect((audit[0]?.data as { cutoff: string }).cutoff).toBeTruthy();
  });

  it("P5.5 the audit purge runs only through the exempt function, and takes the configured window", async () => {
    await pg.query(
      `INSERT INTO public.audit_logs (action, created_at)
       VALUES ('old_row', now() - interval '400 days'), ('young_row', now() - interval '10 days')`,
    );
    // a direct delete of the same rows is refused
    await expect(
      pg.query(`DELETE FROM public.audit_logs WHERE created_at < now() - interval '365 days'`),
    ).rejects.toThrow(/append-only/);

    await runExecutor();
    const remaining = await pg.query(`SELECT action FROM public.audit_logs ORDER BY action`);
    expect(remaining.rows.map((r) => r.action)).toEqual(["young_row"]);

    // the window comes from the seeded config, not a literal
    await pg.query(
      `UPDATE public.account_deletion_runtime_config SET value = '5'::jsonb
        WHERE key = 'anonymization_retention_days'`,
    );
    const days = await pg.query(`SELECT public.audit_logs_retention_days() AS d`);
    expect(days.rows[0]?.d).toBe(5);
    await runExecutor();
    expect((await pg.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action='young_row'`)).rows[0]?.n).toBe(0);
    await pg.query(
      `UPDATE public.account_deletion_runtime_config SET value = '365'::jsonb
        WHERE key = 'anonymization_retention_days'`,
    );
  });

  it("P5.6 App A.5 is seeded, the grace window is read from it, and the declared cron matches vercel.json", async () => {
    const seeded = await pg.query(
      `SELECT key, value FROM public.account_deletion_runtime_config ORDER BY key`,
    );
    expect(seeded.rows.map((r) => r.key)).toEqual([
      "anonymization_retention_days",
      "grace_period_days",
      "scheduled_deletion_job_cron",
    ]);

    const { getDeletionGraceDays } = await import("../../server/lib/account-deletion-runtime-config");
    expect(await getDeletionGraceDays()).toBe(7);

    // an operator change is honoured
    await pg.query(`UPDATE public.account_deletion_runtime_config SET value='14'::jsonb WHERE key='grace_period_days'`);
    expect(await getDeletionGraceDays()).toBe(14);
    // a value outside App A.5's bounds is refused in favour of the default, loudly
    await pg.query(`UPDATE public.account_deletion_runtime_config SET value='0'::jsonb WHERE key='grace_period_days'`);
    logged.length = 0;
    expect(await getDeletionGraceDays()).toBe(7);
    expect(lines("DELETION", "grace_period_out_of_range")).toHaveLength(1);
    await pg.query(`UPDATE public.account_deletion_runtime_config SET value='7'::jsonb WHERE key='grace_period_days'`);

    // the declared schedule and the deployed one cannot drift apart silently
    const declared = String(
      (await pg.query(
        `SELECT value #>> '{}' AS v FROM public.account_deletion_runtime_config WHERE key='scheduled_deletion_job_cron'`,
      )).rows[0]?.v,
    );
    const vercel = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons: Array<{ path: string; schedule: string }> };
    const deployed = vercel.crons.find((c) => c.path === "/api/internal/execute-deletions");
    expect(deployed?.schedule).toBe("0 2 * * *");
    expect(declared).toBe("daily_at_02_utc");
  });
});
