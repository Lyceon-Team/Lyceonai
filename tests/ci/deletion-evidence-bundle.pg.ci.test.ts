/**
 * Account-deletion evidence bundle — real PostgreSQL proof.
 *
 * @spec [SCL-085 / SCL-086 / SCL-088 (PROPOSED); Doc-05E §2, §3 Rule 4, §6 INV-05E-01/02/05;
 *        Doc-01_V8 §40.2.1 (`stripe.subscriptions.cancel(…, { prorate: false })`), §40.5;
 *        plan v4 §1 (two universes, three rules), §3.4 (three transactions), §3.5, §3.7;
 *        owner brief 2026-09-16 "Deletion Vertical" C3 tests 1-7 and B3] | @implemented [2026-09-16]
 *
 * plain English: drives the REAL `executeDueDeletions` driver against the REAL RPCs and the
 * REAL cascade on a throwaway Postgres built from `supabase/migrations`, and proves the
 * invariant the evidence bundle exists to keep:
 *
 *   1. no evidence-side surface carries a timestamp, a uuid other than the random log_id, or
 *      a foreign key outside the bundle (structural, from information_schema);
 *   2. no evidence row shares a transaction id (xmin) with any actor_id-side row;
 *   3. execution order (visible on the actor_id side through xmin) does not reproduce the
 *      evidence side's order — it is ORDER BY profile_id, and this test fails if that is removed;
 *   4. a guardian's deletion touches their students' rows in a transaction of its own;
 *   5. a cancelled request logs `cancelled` and deletes nothing;
 *   6. a rolled-back cascade leaves `executing` and the reconciler resolves it both ways;
 *   7. no free text from the request row reaches the evidence side;
 *   B3. Stripe is cancelled with the spec's arguments, a Stripe failure records failed_manual
 *       with the deletion still completing, and the billing record carries no actor_id and no email.
 *
 * Substituted: the database transport (supabase-shaped admin → SQL via tests/helpers/pg-supabase,
 * plus a storage stub), the Stripe client (a recorder with scripted outcomes), the network (a
 * fake Resend that accepts every send), and the logger (captured, silent).
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
import { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "deletion_evidence_ci";
const FROM_EMAIL = "notifications@send.example.test";

// Six users who request deletion in THIS order, with uuids chosen so that profile_id order is a
// non-trivial permutation of request order (neither the same nor its reverse): execution
// ORDER BY profile_id runs two, four, one, six, five, three while the evidence side was written
// one..six. A reversal would be derivable from the evidence side; a scramble is what production
// looks like (v4 uuids are unrelated to request time).
const USERS = [
  { id: "cccccccc-0000-4000-8000-000000000001", email: "one@evidence.test" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", email: "two@evidence.test" },
  { id: "ffffffff-0000-4000-8000-000000000003", email: "three@evidence.test" },
  { id: "bbbbbbbb-0000-4000-8000-000000000004", email: "four@evidence.test" },
  { id: "eeeeeeee-0000-4000-8000-000000000005", email: "five@evidence.test" },
  { id: "dddddddd-0000-4000-8000-000000000006", email: "six@evidence.test" },
] as const;
const GUARDIAN = {
  id: "99999999-0000-4000-8000-000000000009",
  email: "guardian@evidence.test",
};
const STUDENT = {
  id: "88888888-0000-4000-8000-000000000008",
  email: "student@evidence.test",
};
const EVIDENCE_TABLES = [
  "deletion_request_log",
  "deletion_consent_evidence",
  "deletion_billing_record",
] as const;

let pg: Client;

// ── Stripe recorder ──────────────────────────────────────────────────────────
type StripeSub = {
  id: string;
  status: string;
  items: { data: Array<{ id: string }> };
};
const stripeState = {
  constructed: 0,
  calls: [] as Array<{ method: string; args: unknown[] }>,
  owned: [] as Array<{ id: string; status: string }>,
  retrieve: null as StripeSub | null,
  cancelThrows: false,
  itemDelThrows: false,
};
vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => {
    stripeState.constructed += 1;
    return {
      subscriptions: {
        list: async (args: unknown) => {
          stripeState.calls.push({
            method: "subscriptions.list",
            args: [args],
          });
          return { data: stripeState.owned };
        },
        retrieve: async (id: string) => {
          stripeState.calls.push({
            method: "subscriptions.retrieve",
            args: [id],
          });
          if (!stripeState.retrieve)
            throw new Error(`no such subscription ${id}`);
          return stripeState.retrieve;
        },
        cancel: async (id: string, params: unknown) => {
          stripeState.calls.push({
            method: "subscriptions.cancel",
            args: [id, params],
          });
          if (stripeState.cancelThrows)
            throw new Error("stripe: service unavailable");
          return { id, status: "canceled" };
        },
      },
      subscriptionItems: {
        del: async (id: string, params: unknown) => {
          stripeState.calls.push({
            method: "subscriptionItems.del",
            args: [id, params],
          });
          if (stripeState.itemDelThrows)
            throw new Error("stripe: item delete unavailable");
          return { id, deleted: true };
        },
      },
    };
  },
}));

// ── Logger recorder (the PAGE is an error-severity event with a stable name); fake Resend ──
const logged: Array<{ level: string; component: string; event: string }> = [];
vi.mock("../../server/logger", () => {
  const rec =
    (level: string) =>
    (component: string, event: string): void => {
      logged.push({ level, component, event });
    };
  return {
    logger: {
      info: rec("info"),
      warn: rec("warn"),
      error: rec("error"),
      debug: rec("debug"),
    },
  };
});
function pages(event: string): number {
  return logged.filter(
    (l) =>
      l.level === "error" && l.component === "DELETION" && l.event === event,
  ).length;
}
async function fakeFetch(): Promise<Response> {
  return new Response(JSON.stringify({ id: "re_1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildAdmin() {
  const base = makePgSupabase(pg);
  return {
    from: (table: string) => base.from(table),
    rpc: async (fn: string, args?: Record<string, unknown>) =>
      base.rpc(fn, args),
    storage: {
      listBuckets: async () => ({ data: [], error: null }),
      from: () => ({ list: async () => ({ data: [], error: null }) }),
    },
  };
}

async function runExecutor(): Promise<{
  executedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const { executeDueDeletions } =
    await import("../../server/lib/account-deletion-execute");
  return executeDueDeletions(buildAdmin() as never, "evidence-ci");
}

// ── Seeds (all through the real schema; the RPC writes the log row) ──────────
async function seedUser(
  id: string,
  email: string,
  opts?: { role?: string; stripeCustomerId?: string },
): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    email,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, stripe_customer_id)
     VALUES ($1, $2, $3, 'Someone', $4)`,
    [id, email, opts?.role ?? "student", opts?.stripeCustomerId ?? null],
  );
}
async function actorIdOf(profileId: string): Promise<string> {
  const r = await pg.query(
    `SELECT actor_id FROM public.profiles WHERE id = $1`,
    [profileId],
  );
  return String(r.rows[0]?.actor_id);
}
async function seedActivity(profileId: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.practice_sessions (user_id, actor_id, mode, target_count, platform, client_instance_id)
     SELECT p.id, p.actor_id, 'flow', 5, 'web', 'client-' || left(p.id::text, 8)
       FROM public.profiles p WHERE p.id = $1`,
    [profileId],
  );
}
async function seedConsent(profileId: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.legal_acceptances
       (user_id, doc_key, doc_version, actor_type, minor, consent_source, ip_address, user_agent, accepted_at)
     VALUES ($1, 'student-terms', 'v2', 'student', true, 'email_signup_form', '203.0.113.7',
             'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
             now() - interval '30 days')`,
    [profileId],
  );
}
async function seedEntitlement(
  profileId: string,
  subscriptionId: string,
  itemId: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id)
     VALUES ($1, 'premium', 'active', $2, $3)`,
    [profileId, subscriptionId, itemId],
  );
}
/** The whole row plus its transaction id, so "never touched" is asserted directly, not by absence of error. */
async function entitlementSnapshot(
  profileId: string,
): Promise<Record<string, unknown> | null> {
  const r = await pg.query(
    `SELECT xmin::text AS x, profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id
       FROM public.entitlements WHERE profile_id = $1`,
    [profileId],
  );
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}
async function billingRow(
  logId: string,
): Promise<Record<string, unknown> | null> {
  const r = await pg.query(
    `SELECT stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id, final_status,
            cancelled_on::text AS cancelled_on
       FROM public.deletion_billing_record WHERE log_id = $1`,
    [logId],
  );
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}
/** Request via the real RPC (T0 writes the log row), then make it due. */
async function requestAndMakeDue(
  profileId: string,
): Promise<{ requestId: string; logId: string }> {
  await pg.query(
    `SELECT * FROM public.request_account_deletion($1, $1, $2, 7)`,
    [profileId, `hash-${profileId}`],
  );
  const r = await pg.query(
    `UPDATE public.account_deletion_requests
        SET scheduled_hard_delete_at = now() - interval '1 hour'
      WHERE profile_id = $1 AND status = 'pending'
      RETURNING id, log_id`,
    [profileId],
  );
  return { requestId: String(r.rows[0]?.id), logId: String(r.rows[0]?.log_id) };
}
async function logRow(logId: string): Promise<Record<string, unknown> | null> {
  const r = await pg.query(
    `SELECT log_id, subject_email, requester_email, request_channel, status, denial_basis,
            suppression_requested, requested_on::text AS requested_on, responded_on::text AS responded_on
       FROM public.deletion_request_log WHERE log_id = $1`,
    [logId],
  );
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}
async function profileExists(id: string): Promise<boolean> {
  const r = await pg.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
async function todayUtc(): Promise<string> {
  const r = await pg.query(
    `SELECT (now() AT TIME ZONE 'utc')::date::text AS d`,
  );
  return String(r.rows[0]?.d);
}
/** xmin values of a table's rows matching an optional predicate, as numbers. */
async function xmins(sql: string, params: unknown[] = []): Promise<number[]> {
  const r = await pg.query(sql, params);
  return r.rows.map((row) => Number((row as { x: string }).x));
}
async function evidenceXmins(): Promise<number[]> {
  const out: number[] = [];
  for (const t of EVIDENCE_TABLES) {
    out.push(...(await xmins(`SELECT xmin::text AS x FROM public.${t}`)));
  }
  return out;
}

describe.skipIf(!PG_AVAILABLE)(
  "deletion evidence bundle — real Postgres",
  () => {
    beforeAll(async () => {
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
      stripeState.constructed = 0;
      stripeState.calls = [];
      stripeState.owned = [];
      stripeState.retrieve = null;
      stripeState.cancelThrows = false;
      stripeState.itemDelThrows = false;
      logged.length = 0;
      // child → parent; evidence tables cascade from the log
      await pg.query(`DELETE FROM public.deletion_request_log`);
      await pg.query(`DROP TABLE IF EXISTS public._evidence_ci_block`);
      await pg.query(`DELETE FROM public.account_deletion_requests`);
      await pg.query(`DELETE FROM public.practice_sessions`);
      await pg.query(`DELETE FROM public.legal_acceptances`);
      await pg.query(`DELETE FROM public.guardian_consent_requests`);
      await pg.query(`DELETE FROM public.entitlements`);
      await pg.query(`DELETE FROM public.anonymized_actors`);
      await pg.query(
        `DELETE FROM public.profiles WHERE email LIKE '%@evidence.test' OR email LIKE 'deleted_%'`,
      );
      await pg.query(
        `DELETE FROM auth.users WHERE email LIKE '%@evidence.test'`,
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // ── C3.1 ────────────────────────────────────────────────────────────────────
    it("C3.1 structural: evidence tables carry no timestamp column, no uuid but the random log_id, no FK outside the bundle, RLS on with zero policies", async () => {
      const cols = await pg.query(
        `SELECT table_name, column_name, data_type, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
        [[...EVIDENCE_TABLES]],
      );
      expect(cols.rowCount).toBeGreaterThan(0);
      const timestampCols = cols.rows.filter((c) =>
        String(c.data_type).startsWith("timestamp"),
      );
      expect(timestampCols).toEqual([]);
      const uuidCols = cols.rows.filter(
        (c) => c.data_type === "uuid" && c.column_name !== "log_id",
      );
      expect(uuidCols).toEqual([]);
      const identityLeak = cols.rows.filter((c) =>
        [
          "actor_id",
          "profile_id",
          "user_id",
          "email",
          "created_at",
          "updated_at",
        ].includes(String(c.column_name)),
      );
      expect(identityLeak).toEqual([]);
      // the log_id default is random, not a sequence
      const logIdDefault = cols.rows.find(
        (c) =>
          c.table_name === "deletion_request_log" && c.column_name === "log_id",
      );
      expect(String(logIdDefault?.column_default)).toBe("gen_random_uuid()");
      expect(
        cols.rows.some((c) =>
          String(c.column_default ?? "").includes("nextval"),
        ),
      ).toBe(false);

      const fks = await pg.query(
        `SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1::text[])`,
        [EVIDENCE_TABLES.map((t) => `${t}`)],
      );
      for (const fk of fks.rows) {
        expect(EVIDENCE_TABLES).toContain(String(fk.ref));
      }
      // and nothing outside the bundle points INTO it either (an identity-side FK would let
      // the identity side block or cascade evidence rows)
      const inbound = await pg.query(
        `SELECT c.conrelid::regclass::text AS tbl
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid::regclass::text = ANY($1::text[])
          AND NOT (c.conrelid::regclass::text = ANY($1::text[]))`,
        [[...EVIDENCE_TABLES]],
      );
      expect(inbound.rows).toEqual([]);

      const rls = await pg.query(
        `SELECT c.relname, c.relrowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
        [[...EVIDENCE_TABLES]],
      );
      expect(rls.rowCount).toBe(EVIDENCE_TABLES.length);
      for (const r of rls.rows) {
        expect(r.relrowsecurity).toBe(true);
        expect(Number(r.policies)).toBe(0);
      }
      // and the actor_id side lost its timestamp
      const ledger = await pg.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'anonymized_actors' ORDER BY ordinal_position`,
      );
      expect(ledger.rows.map((r) => r.column_name)).toEqual(["actor_id"]);
    });

    // ── C3.2 ────────────────────────────────────────────────────────────────────
    it("C3.2 cross-universe xmin: no evidence row shares a transaction id with any actor_id-side row", async () => {
      const trio = USERS.slice(0, 3);
      for (const u of trio) {
        await seedUser(u.id, u.email);
        await seedActivity(u.id);
        await seedConsent(u.id);
        await requestAndMakeDue(u.id);
      }
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 3,
        skippedCount: 0,
        failedCount: 0,
      });

      const evidence = await evidenceXmins();
      expect(evidence.length).toBeGreaterThanOrEqual(6); // 3 log rows + 3 consent rows
      const actorSide = [
        ...(await xmins(
          `SELECT xmin::text AS x FROM public.practice_sessions`,
        )),
        ...(await xmins(
          `SELECT xmin::text AS x FROM public.anonymized_actors`,
        )),
      ];
      expect(actorSide.length).toBe(6); // 3 activity rows (re-stamped by the cascade) + 3 ledger rows
      const shared = evidence.filter((x) => actorSide.includes(x));
      expect(shared).toEqual([]);
      // the ledger was rewritten: one xmin for all rows, no insertion order
      const ledgerXmins = new Set(
        await xmins(`SELECT xmin::text AS x FROM public.anonymized_actors`),
      );
      expect(ledgerXmins.size).toBe(1);
      // and the rewrite holds the table against a concurrent cascade insert (a row committed
      // between its snapshot and its DELETE would otherwise be lost)
      const def = await pg.query(
        `SELECT pg_get_functiondef('public.rewrite_anonymized_actors()'::regprocedure) AS d`,
      );
      expect(String(def.rows[0]?.d)).toContain(
        "LOCK TABLE public.anonymized_actors IN ACCESS EXCLUSIVE MODE",
      );
    });

    // ── C3.3 ────────────────────────────────────────────────────────────────────
    it("C3.3 rank: execution order is ORDER BY profile_id and does not reproduce the evidence side's request order", async () => {
      const byActor = new Map<string, string>(); // actor_id → email
      // request in USERS order, a scramble of profile_id order (see USERS)
      for (const u of USERS) {
        await seedUser(u.id, u.email);
        await seedActivity(u.id);
        byActor.set(await actorIdOf(u.id), u.email);
        await requestAndMakeDue(u.id);
      }
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 6,
        skippedCount: 0,
        failedCount: 0,
      });

      // actor_id side: the cascade re-stamped each user's activity row in its own T2, so the
      // xmin order of practice_sessions IS the execution order.
      const exec = await pg.query(
        `SELECT actor_id::text AS actor FROM public.practice_sessions ORDER BY xmin::text::bigint`,
      );
      const executionOrder = exec.rows.map((r) => byActor.get(String(r.actor)));
      // evidence side: the only physical order it has (ctid after T0/T1/T3), and the only
      // column orders (none: log_id is random, the dates are equal)
      const ev = await pg.query(
        `SELECT subject_email FROM public.deletion_request_log ORDER BY ctid`,
      );
      const evidenceOrder = ev.rows.map((r) => String(r.subject_email));
      const evByLogId = await pg.query(
        `SELECT subject_email FROM public.deletion_request_log ORDER BY log_id`,
      );
      const evidenceByLogId = evByLogId.rows.map((r) =>
        String(r.subject_email),
      );

      const profileIdOrder = [...USERS]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((u) => u.email);
      expect(executionOrder).toEqual(profileIdOrder);
      // the invariant: nothing retained on the evidence side reproduces execution order,
      // forwards or backwards
      for (const order of [evidenceOrder, evidenceByLogId]) {
        expect(order).not.toEqual(executionOrder);
        expect(order).not.toEqual([...executionOrder].reverse());
      }
    });

    // ── C3.4 ────────────────────────────────────────────────────────────────────
    it("C3.4 guardian pre-clear: a live student's consent row is not written in the guardian's cascade transaction", async () => {
      await seedUser(GUARDIAN.id, GUARDIAN.email, { role: "guardian" });
      await seedUser(STUDENT.id, STUDENT.email);
      await seedActivity(GUARDIAN.id); // captures the guardian's T2 xmin
      await pg.query(
        `UPDATE public.profiles SET guardian_email = $2 WHERE id = $1`,
        [STUDENT.id, GUARDIAN.email],
      );
      await pg.query(
        `INSERT INTO public.guardian_consent_requests
         (student_profile_id, guardian_profile_id, guardian_email, status, consent_token, consent_token_expires_at)
       VALUES ($1, $2, $3, 'consented', 'tok-evidence-ci', now() + interval '1 day')`,
        [STUDENT.id, GUARDIAN.id, GUARDIAN.email],
      );
      await requestAndMakeDue(GUARDIAN.id);

      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(GUARDIAN.id)).toBe(false);
      expect(await profileExists(STUDENT.id)).toBe(true);

      const consent = await pg.query(
        `SELECT xmin::text AS x, guardian_profile_id FROM public.guardian_consent_requests WHERE student_profile_id = $1`,
        [STUDENT.id],
      );
      expect(consent.rowCount).toBe(1);
      expect(consent.rows[0]?.guardian_profile_id).toBeNull();
      const consentXmin = Number(consent.rows[0]?.x);
      const guardianT2 = await xmins(
        `SELECT xmin::text AS x FROM public.practice_sessions`,
      );
      expect(guardianT2).toHaveLength(1);
      expect(consentXmin).not.toBe(guardianT2[0]);
      const ledger = await xmins(
        `SELECT xmin::text AS x FROM public.anonymized_actors`,
      );
      expect(ledger).not.toContain(consentXmin);
      // and the live student's row was written BEFORE the cascade (T1.5 precedes T2)
      expect(consentXmin).toBeLessThan(guardianT2[0]!);
    });

    // ── C3.5 ────────────────────────────────────────────────────────────────────
    it("C3.5 cancelled: an in-app cancel logs `cancelled` with a response date and nothing is deleted", async () => {
      const u = USERS[0];
      await seedUser(u.id, u.email);
      const { logId } = await requestAndMakeDue(u.id);
      expect((await logRow(logId))?.status).toBe("pending");
      const cancelled = await pg.query(
        `SELECT public.cancel_account_deletion($1) AS id`,
        [u.id],
      );
      expect(String(cancelled.rows[0]?.id)).toBe(u.id);
      const row = await logRow(logId);
      expect(row?.status).toBe("cancelled");
      expect(String(row?.responded_on)).toContain(await todayUtc());
      expect(row?.subject_email).toBe(u.email);
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(u.id)).toBe(true);
      expect((await logRow(logId))?.status).toBe("cancelled");
    });

    // ── C3.6 ────────────────────────────────────────────────────────────────────
    it("C3.6 rolled-back cascade leaves `executing`; the reconciler reverts it to pending, and completes a row whose request is gone", async () => {
      // (a) cascade RAISEs (operator-config preflight) → T2 rolls back → reconciler reverts
      const x = USERS[0];
      await seedUser(x.id, x.email);
      const { logId: logX } = await requestAndMakeDue(x.id);
      // A foreign key that REFUSES the delete, so T2 raises and rolls back. This used to be an
      // `auth_runtime_config` row caught by the cascade's operator-FK preflight; that preflight is
      // gone (2026-09-17, "Declarative FK Actions"): those 36 edges are now ON DELETE SET NULL and
      // no longer block anybody. The assertion here was never about operator config — it is about
      // what the executor and the reconciler do when T2 rolls back — so the vehicle is now a
      // purpose-built RESTRICT edge owned by this test, which cannot stop biting when a schema
      // decision elsewhere changes.
      await pg.query(`
      CREATE TABLE public._evidence_ci_block (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_profile_id uuid NOT NULL
          REFERENCES public.profiles(id) ON DELETE RESTRICT
      )`);
      await pg.query(
        `INSERT INTO public._evidence_ci_block (owner_profile_id) VALUES ($1)`,
        [x.id],
      );
      const first = await runExecutor();
      expect(first).toEqual({
        executedCount: 0,
        skippedCount: 0,
        failedCount: 1,
      });
      expect(await profileExists(x.id)).toBe(true);
      const pendingReq = await pg.query(
        `SELECT status FROM public.account_deletion_requests WHERE profile_id = $1`,
        [x.id],
      );
      expect(pendingReq.rows[0]?.status).toBe("pending");
      // the reconciler ran at the end of the pass: executing → pending
      expect((await logRow(logX))?.status).toBe("pending");

      await pg.query(`DROP TABLE public._evidence_ci_block`);
      const second = await runExecutor();
      expect(second).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(x.id)).toBe(false);
      const done = await logRow(logX);
      expect(done?.status).toBe("completed");
      expect(String(done?.responded_on)).toContain(await todayUtc());

      // (b) process died between T2 and T3: request row gone, log still executing → completed
      const y = USERS[1];
      await seedUser(y.id, y.email);
      const { requestId, logId: logY } = await requestAndMakeDue(y.id);
      await pg.query(
        `SELECT public.mark_deletion_log_executing(ARRAY[$1::uuid])`,
        [logY],
      );
      expect((await logRow(logY))?.status).toBe("executing");
      await pg.query(`SELECT public.preclear_account_deletion_links($1)`, [
        y.id,
      ]);
      await pg.query(`SELECT public.deidentify_user($1, $2)`, [
        y.id,
        `deleted_${y.id}@deleted.lyceon.ai`,
      ]);
      const t2 = await pg.query(
        `SELECT public.complete_and_anonymize_account($1, $2) AS r`,
        [requestId, y.id],
      );
      expect((t2.rows[0]?.r as { status?: string }).status).toBe("completed");
      expect((await logRow(logY))?.status).toBe("executing");
      await pg.query(`SELECT public.reconcile_deletion_log()`);
      const rec = await logRow(logY);
      expect(rec?.status).toBe("completed");
      expect(String(rec?.responded_on)).toContain(await todayUtc());
    });

    // ── C3.7 ────────────────────────────────────────────────────────────────────
    it("C3.7 no free text from the request row reaches the evidence side", async () => {
      const u = USERS[2];
      const SENTINEL = "REASON_SENTINEL_4f2a9c";
      await seedUser(u.id, u.email);
      await seedConsent(u.id);
      const { logId } = await requestAndMakeDue(u.id);
      await pg.query(
        `UPDATE public.account_deletion_requests SET deletion_reason = $2 WHERE log_id = $1`,
        [logId, SENTINEL],
      );
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect((await logRow(logId))?.status).toBe("completed");
      const cols = await pg.query(
        `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
          AND data_type IN ('text', 'character varying')`,
        [[...EVIDENCE_TABLES]],
      );
      expect(cols.rowCount).toBeGreaterThan(0);
      for (const c of cols.rows) {
        const hit = await pg.query(
          `SELECT count(*)::int AS n FROM public."${String(c.table_name)}" WHERE "${String(c.column_name)}" LIKE $1`,
          [`%${SENTINEL}%`],
        );
        expect({
          table: c.table_name,
          column: c.column_name,
          hits: hit.rows[0]?.n,
        }).toEqual({
          table: c.table_name,
          column: c.column_name,
          hits: 0,
        });
      }
      // the recovery-token hash is in the same class: it never crosses either
      const hashHit = await pg.query(
        `SELECT count(*)::int AS n FROM public.deletion_request_log
        WHERE subject_email LIKE '%hash-%' OR requester_email LIKE '%hash-%'
           OR coalesce(denial_basis, '') LIKE '%hash-%'`,
      );
      expect(hashHit.rows[0]?.n).toBe(0);
    });

    // ── C3.8 ────────────────────────────────────────────────────────────────────
    it("C3.8 consent evidence inherits Doc 01 §5.1 redaction: IP to /24, user agent to browser/OS family, raw values absent", async () => {
      const u = USERS[1];
      await seedUser(u.id, u.email);
      await seedConsent(u.id);
      const { logId } = await requestAndMakeDue(u.id);
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      const rows = await pg.query(
        `SELECT ip_address, user_agent, doc_key, doc_version, actor_type, minor, consent_source, accepted_on::text AS accepted_on
         FROM public.deletion_consent_evidence WHERE log_id = $1`,
        [logId],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]).toMatchObject({
        ip_address: "203.0.113.0/24",
        user_agent: "Chrome/Windows",
        doc_key: "student-terms",
        doc_version: "v2",
        actor_type: "student",
        minor: true,
        consent_source: "email_signup_form",
      });
      const raw = await pg.query(
        `SELECT count(*)::int AS n FROM public.deletion_consent_evidence
        WHERE ip_address = '203.0.113.7' OR user_agent LIKE '%128.0.0.0%'`,
      );
      expect(raw.rows[0]?.n).toBe(0);
    });

    // ── B3 ──────────────────────────────────────────────────────────────────────
    it("B3.1 Stripe: the person's own subscription is cancelled with { prorate: false } and the billing record survives keyed to the log", async () => {
      const u = USERS[3];
      await seedUser(u.id, u.email, { stripeCustomerId: "cus_evidence" });
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id)
       VALUES ($1, 'premium', 'active', 'sub_evidence', 'si_evidence')`,
        [u.id],
      );
      stripeState.owned = [{ id: "sub_evidence", status: "active" }];
      const { logId } = await requestAndMakeDue(u.id);
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(stripeState.constructed).toBe(1);
      expect(stripeState.calls).toEqual([
        {
          method: "subscriptions.list",
          args: [{ customer: "cus_evidence", status: "all", limit: 100 }],
        },
        {
          method: "subscriptions.cancel",
          args: ["sub_evidence", { prorate: false }],
        },
      ]);
      const billing = await pg.query(
        `SELECT stripe_customer_id, stripe_subscription_id, final_status, cancelled_on::text AS cancelled_on
         FROM public.deletion_billing_record WHERE log_id = $1`,
        [logId],
      );
      expect(billing.rowCount).toBe(1);
      expect(billing.rows[0]).toMatchObject({
        stripe_customer_id: "cus_evidence",
        stripe_subscription_id: "sub_evidence",
        final_status: "cancelled",
      });
      expect(String(billing.rows[0]?.cancelled_on)).toContain(await todayUtc());
      expect(await profileExists(u.id)).toBe(false);
    });

    it("B3.2 Stripe failure records failed_manual and the deletion still completes", async () => {
      const u = USERS[4];
      await seedUser(u.id, u.email, { stripeCustomerId: "cus_broken" });
      stripeState.owned = [{ id: "sub_broken", status: "active" }];
      stripeState.cancelThrows = true;
      const { logId } = await requestAndMakeDue(u.id);
      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(u.id)).toBe(false);
      expect((await logRow(logId))?.status).toBe("completed");
      const billing = await pg.query(
        `SELECT final_status, stripe_customer_id FROM public.deletion_billing_record WHERE log_id = $1`,
        [logId],
      );
      expect(billing.rows[0]).toEqual({
        final_status: "failed_manual",
        stripe_customer_id: "cus_broken",
      });
    });

    it("B3.3 billing record structural: no actor_id, no email, no uuid but log_id; no record when there was nothing to bill", async () => {
      const cols = await pg.query(
        `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'deletion_billing_record' ORDER BY ordinal_position`,
      );
      expect(cols.rows.map((c) => c.column_name)).toEqual([
        "log_id",
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_subscription_item_id",
        "cancelled_on",
        "final_status",
      ]);
      expect(
        cols.rows
          .filter((c) => c.data_type === "uuid")
          .map((c) => c.column_name),
      ).toEqual(["log_id"]);
      const u = USERS[5];
      await seedUser(u.id, u.email);
      const { logId } = await requestAndMakeDue(u.id);
      await runExecutor();
      expect(stripeState.constructed).toBe(0);
      const billing = await pg.query(
        `SELECT 1 FROM public.deletion_billing_record WHERE log_id = $1`,
        [logId],
      );
      expect(billing.rowCount).toBe(0);
    });

    // ── B3.4 – B3.7: per-student entitlement on a payer-scoped subscription (owner ruling 2026-09-16 item 3)
    it("B3.4 multi-item subscription: only this student's item is removed, the subscription survives, the sibling's entitlement row is never touched", async () => {
      const me = USERS[0];
      const sibling = USERS[1];
      await seedUser(me.id, me.email);
      await seedUser(sibling.id, sibling.email);
      await seedEntitlement(me.id, "sub_family", "si_me");
      await seedEntitlement(sibling.id, "sub_family", "si_sibling");
      stripeState.retrieve = {
        id: "sub_family",
        status: "active",
        items: { data: [{ id: "si_sibling" }, { id: "si_me" }] },
      };
      const before = await entitlementSnapshot(sibling.id);
      const { logId } = await requestAndMakeDue(me.id);

      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(stripeState.calls).toEqual([
        { method: "subscriptions.retrieve", args: ["sub_family"] },
        {
          method: "subscriptionItems.del",
          args: ["si_me", { proration_behavior: "none" }],
        },
      ]);
      expect(await entitlementSnapshot(me.id)).toBeNull(); // PS-1: the deleting student's row is gone
      expect(await entitlementSnapshot(sibling.id)).toEqual(before); // same row, same xmin: never written
      expect(await billingRow(logId)).toMatchObject({
        stripe_subscription_id: "sub_family",
        stripe_subscription_item_id: "si_me",
        final_status: "item_removed",
      });
    });

    it("B3.5 single-item subscription: the subscription is cancelled with { prorate: false }, not an item removal; a sibling on ANOTHER subscription is never touched", async () => {
      const me = USERS[2];
      const sibling = USERS[3];
      await seedUser(me.id, me.email);
      await seedUser(sibling.id, sibling.email);
      await seedEntitlement(me.id, "sub_solo", "si_solo");
      await seedEntitlement(sibling.id, "sub_other", "si_other");
      stripeState.retrieve = {
        id: "sub_solo",
        status: "active",
        items: { data: [{ id: "si_solo" }] },
      };
      const before = await entitlementSnapshot(sibling.id);
      const { logId } = await requestAndMakeDue(me.id);

      const summary = await runExecutor();
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(stripeState.calls).toEqual([
        { method: "subscriptions.retrieve", args: ["sub_solo"] },
        {
          method: "subscriptions.cancel",
          args: ["sub_solo", { prorate: false }],
        },
      ]);
      expect(
        stripeState.calls.some((c) => c.method === "subscriptionItems.del"),
      ).toBe(false);
      expect(await entitlementSnapshot(sibling.id)).toEqual(before);
      expect(await billingRow(logId)).toMatchObject({
        stripe_subscription_id: "sub_solo",
        stripe_subscription_item_id: "si_solo",
        final_status: "cancelled",
      });
    });

    it("B3.6 Stripe failure on the item-removal path: failed_manual, the page fires, the deletion completes, and the next pass retries to item_removed", async () => {
      const me = USERS[4];
      await seedUser(me.id, me.email);
      await seedEntitlement(me.id, "sub_family2", "si_me2");
      stripeState.retrieve = {
        id: "sub_family2",
        status: "active",
        items: { data: [{ id: "si_other2" }, { id: "si_me2" }] },
      };
      stripeState.itemDelThrows = true;
      const { logId } = await requestAndMakeDue(me.id);

      const first = await runExecutor();
      expect(first).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(me.id)).toBe(false);
      expect(pages("billing_teardown_failed_manual")).toBe(1);
      expect(await billingRow(logId)).toMatchObject({
        final_status: "failed_manual",
        stripe_subscription_item_id: "si_me2",
      });

      // the retry sweep runs at the end of every pass, from the billing record alone
      stripeState.itemDelThrows = false;
      stripeState.calls = [];
      const second = await runExecutor();
      expect(second).toEqual({
        executedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(stripeState.calls).toEqual([
        { method: "subscriptions.retrieve", args: ["sub_family2"] },
        {
          method: "subscriptionItems.del",
          args: ["si_me2", { proration_behavior: "none" }],
        },
      ]);
      const resolved = await billingRow(logId);
      expect(resolved?.final_status).toBe("item_removed");
      expect(String(resolved?.cancelled_on)).toContain(await todayUtc());
    });

    it("B3.7 Stripe failure on the cancel path: failed_manual, the page fires, the deletion completes, the retry resolves to cancelled, and a still-failing retry pages again", async () => {
      const me = USERS[5];
      await seedUser(me.id, me.email);
      await seedEntitlement(me.id, "sub_solo2", "si_solo2");
      stripeState.retrieve = {
        id: "sub_solo2",
        status: "active",
        items: { data: [{ id: "si_solo2" }] },
      };
      stripeState.cancelThrows = true;
      const { logId } = await requestAndMakeDue(me.id);

      const first = await runExecutor();
      expect(first).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await profileExists(me.id)).toBe(false);
      expect(pages("billing_teardown_failed_manual")).toBe(1);
      expect((await billingRow(logId))?.final_status).toBe("failed_manual");

      // still down on the next pass: pages again, record unchanged
      await runExecutor();
      expect(pages("billing_teardown_retry_failed")).toBe(1);
      expect((await billingRow(logId))?.final_status).toBe("failed_manual");

      // back up: resolved
      stripeState.cancelThrows = false;
      await runExecutor();
      expect((await billingRow(logId))?.final_status).toBe("cancelled");
    });
  },
);
