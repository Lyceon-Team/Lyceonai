/**
 * Deletion-completed notice — real PostgreSQL proof.
 *
 * @spec [Doc-01_V8 §40.5 Hard delete at T+7; SCL-083 (PROPOSED); contracts/notifications.contract.md
 *        §0.4 direct sends, C0.6 (best-effort, no retry); Doc-01A_V1.0 §14 redaction;
 *        owner brief 2026-09-15 Part A, tests A4.1–A4.5] | @implemented [2026-09-15]
 *
 * plain English: drives the REAL `executeDueDeletions` driver against the REAL
 * `deidentify_user` / `complete_and_anonymize_account` / cascade functions on a throwaway
 * Postgres. Substituted: the database transport (`supabaseServer`-shaped admin → SQL via
 * tests/helpers/pg-supabase, plus a storage stub because a bare Postgres has no Storage), the
 * Stripe client (never reached — no subscription rows), and the network (fake Resend that
 * records every request and can be told to reject). Every logger call and every console call
 * is captured so the recipient address can be proven absent from ALL log output.
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

const DB_NAME = "deletion_completed_ci";
const USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const EMAIL_A = "deleted-person-alpha@example.test";
const EMAIL_B = "deleted-person-beta@example.test";
const FROM_EMAIL = "notifications@send.example.test";

let pg: Client;

// ── Fake Resend ──────────────────────────────────────────────────────────────
type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const fakeResend = {
  mode: "ok" as "ok" | "reject",
  requests: [] as CapturedRequest[],
  nextId: 1,
};
async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  fakeResend.requests.push({
    url: typeof input === "string" ? input : input.toString(),
    headers: Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    ),
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  if (fakeResend.mode === "reject") {
    return new Response(
      JSON.stringify({ statusCode: 500, name: "internal", message: "boom" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ id: `re_${fakeResend.nextId++}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Log capture: every logger call AND every console call, stringified ──────
const captured: string[] = [];
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]) => {
    captured.push(
      args
        .map((a) => {
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" "),
    );
  };
  return {
    logger: {
      info: record,
      warn: record,
      error: record,
      debug: record,
    },
  };
});

// The Stripe client must never be constructed here (no subscription rows are seeded).
vi.mock("../../server/lib/stripe/client", () => ({
  getStripeClient: () => {
    throw new Error("getStripeClient must not be called in this suite");
  },
}));

// ── Call-order recorder: proves the address READ precedes the RPCs (A4.1) ───
const callOrder: string[] = [];

function buildAdmin() {
  const base = makePgSupabase(pg);
  return {
    from: (table: string) => {
      const builder = base.from(table);
      if (table === "profiles") callOrder.push("read:profiles");
      return builder;
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      callOrder.push(`rpc:${fn}`);
      return base.rpc(fn, args);
    },
    storage: {
      listBuckets: async () => ({ data: [], error: null }),
      from: () => ({
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
}

async function seedUser(id: string, email: string): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    email,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1, $2, 'student', 'Someone')`,
    [id, email],
  );
}

async function seedDueDeletion(profileId: string): Promise<string> {
  const r = await pg.query(
    `INSERT INTO public.account_deletion_requests
       (profile_id, scheduled_hard_delete_at, actor_profile_id, status, requested_at)
     VALUES ($1, now() - interval '1 hour', $1, 'pending', now() - interval '8 days')
     RETURNING id`,
    [profileId],
  );
  return String(r.rows[0].id);
}

/**
 * "absent" once the cascade has run: execute_account_deletion_cascade PS-4 deletes the
 * account_deletion_requests row itself (the request is part of the account's footprint), so a
 * completed deletion is observed as the row being GONE, never as status = 'completed'.
 */
async function requestStatus(id: string): Promise<string> {
  const r = await pg.query(
    `SELECT status FROM public.account_deletion_requests WHERE id = $1`,
    [id],
  );
  return r.rowCount === 0 ? "absent" : String(r.rows[0]?.status);
}

async function profileExists(id: string): Promise<boolean> {
  const r = await pg.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

describe.skipIf(!PG_AVAILABLE)(
  "deletion-completed notice — real Postgres",
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
      fakeResend.mode = "ok";
      fakeResend.requests = [];
      fakeResend.nextId = 1;
      captured.length = 0;
      callOrder.length = 0;
      await pg.query(`DELETE FROM public.account_deletion_requests`);
      await pg.query(`DELETE FROM public.profiles WHERE id IN ($1, $2)`, [
        USER_A,
        USER_B,
      ]);
      await pg.query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [
        USER_A,
        USER_B,
      ]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("A4.1 the address is read BEFORE the RPCs, the deletion commits, and ONE notice goes to that address (asserted by call order)", async () => {
      await seedUser(USER_A, EMAIL_A);
      const requestId = await seedDueDeletion(USER_A);
      const { executeDueDeletions } =
        await import("../../server/lib/account-deletion-execute");

      const summary = await executeDueDeletions(
        buildAdmin() as never,
        "deletion-ci",
      );
      expect(summary).toEqual({
        executedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });

      // Ordering, not inspection: the profiles read is the FIRST call and precedes every rpc.
      const firstRpc = callOrder.findIndex((c) => c.startsWith("rpc:"));
      const addressRead = callOrder.indexOf("read:profiles");
      expect(addressRead).toBe(0);
      expect(firstRpc).toBeGreaterThan(addressRead);
      // Plan v4 §3.4 (2026-09-16): T1.5 pre-clear precedes deidentify, and the evidence
      // housekeeping (reconcile + ledger rewrite) closes the pass. T1/T3 do not appear
      // because this request row was seeded directly and has no log_id.
      expect(callOrder.slice(firstRpc)).toEqual([
        "rpc:preclear_account_deletion_links",
        "rpc:deidentify_user",
        "rpc:complete_and_anonymize_account",
        "rpc:reconcile_deletion_log",
        "rpc:sweep_deletion_evidence",
        "rpc:apply_audit_logs_retention",
        "rpc:rewrite_anonymized_actors",
      ]);

      expect(await requestStatus(requestId)).toBe("absent");
      expect(await profileExists(USER_A)).toBe(false);

      expect(fakeResend.requests).toHaveLength(1);
      const req = fakeResend.requests[0]!;
      expect(req.body.to).toEqual([EMAIL_A]);
      expect(req.body.from).toBe(FROM_EMAIL);
      expect(req.headers["Idempotency-Key"]).toBe(
        `account-deletion-completed:${requestId}`,
      );
      expect(String(req.body.subject)).toMatch(/has been deleted/i);
      const text = String(req.body.text);
      expect(text).toMatch(/were deleted on/i);
      expect(text).not.toMatch(/recover|restore your account|http/i);
      expect(text).not.toContain("Someone");
      expect(Object.keys(req.body).sort()).toEqual([
        "from",
        "html",
        "reply_to",
        "subject",
        "text",
        "to",
      ]);
    });

    it("A4.2 a failed deletion (RPC raises) sends nothing and the row stays pending", async () => {
      await seedUser(USER_A, EMAIL_A);
      const requestId = await seedDueDeletion(USER_A);
      const { executeDueDeletions } =
        await import("../../server/lib/account-deletion-execute");

      const admin = buildAdmin();
      const realRpc = admin.rpc;
      admin.rpc = async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "complete_and_anonymize_account") {
          return {
            data: null,
            error: { message: "simulated cascade failure", code: "P0001" },
          };
        }
        return realRpc(fn, args);
      };

      const summary = await executeDueDeletions(admin as never, "deletion-ci");
      expect(summary.failedCount).toBe(1);
      expect(summary.executedCount).toBe(0);
      expect(await requestStatus(requestId)).toBe("pending");
      expect(fakeResend.requests).toHaveLength(0);
    });

    it("A4.2b a rolled-back deletion transaction leaves the row pending and nothing is sent (SQL-level)", async () => {
      await seedUser(USER_A, EMAIL_A);
      const requestId = await seedDueDeletion(USER_A);

      await pg.query("BEGIN");
      await pg.query(`SELECT public.complete_and_anonymize_account($1, $2)`, [
        requestId,
        USER_A,
      ]);
      expect(await requestStatus(requestId)).toBe("absent"); // inside the tx: cascade removed it
      await pg.query("ROLLBACK");

      expect(await requestStatus(requestId)).toBe("pending");
      expect(await profileExists(USER_A)).toBe(true);
      // Nothing in this test called the sender: the send lives AFTER the driver's RPC returns
      // 'completed', which a rolled-back transaction never does.
      expect(fakeResend.requests).toHaveLength(0);
    });

    it("A4.3 a send failure leaves the deletion committed and the NEXT account in the batch still completes", async () => {
      await seedUser(USER_A, EMAIL_A);
      await seedUser(USER_B, EMAIL_B);
      const requestA = await seedDueDeletion(USER_A);
      const requestB = await seedDueDeletion(USER_B);
      fakeResend.mode = "reject";
      const { executeDueDeletions } =
        await import("../../server/lib/account-deletion-execute");

      const summary = await executeDueDeletions(
        buildAdmin() as never,
        "deletion-ci",
      );
      expect(summary).toEqual({
        executedCount: 2,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(await requestStatus(requestA)).toBe("absent");
      expect(await requestStatus(requestB)).toBe("absent");
      expect(await profileExists(USER_A)).toBe(false);
      expect(await profileExists(USER_B)).toBe(false);
      // Both sends were attempted (and rejected) — one per account, no retry.
      expect(fakeResend.requests).toHaveLength(2);
      expect(
        captured.filter((l) => l.includes("deletion_completed_email_failed")),
      ).toHaveLength(2);
    });

    it("A4.4 the recipient address appears in NO log output (only its redacted form) — success AND failure log lines", async () => {
      const { executeDueDeletions } =
        await import("../../server/lib/account-deletion-execute");

      // Pass 1: the send is accepted → exercises deletion_completed_email_sent.
      await seedUser(USER_A, EMAIL_A);
      await seedDueDeletion(USER_A);
      fakeResend.mode = "ok";
      await executeDueDeletions(buildAdmin() as never, "deletion-ci");
      expect(
        captured.some((l) => l.includes("deletion_completed_email_sent")),
      ).toBe(true);

      // Pass 2: the send is rejected → exercises deletion_completed_email_failed.
      await seedUser(USER_B, EMAIL_B);
      await seedDueDeletion(USER_B);
      fakeResend.mode = "reject";
      await executeDueDeletions(buildAdmin() as never, "deletion-ci");
      expect(
        captured.some((l) => l.includes("deletion_completed_email_failed")),
      ).toBe(true);

      expect(fakeResend.requests).toHaveLength(2);
      const allLogs = captured.join("\n");
      // The literal address — and even its local part — is in no captured log line.
      expect(allLogs).not.toContain(EMAIL_A);
      expect(allLogs).not.toContain(EMAIL_B);
      expect(allLogs).not.toContain("deleted-person-alpha");
      expect(allLogs).not.toContain("deleted-person-beta");
      // Positive control: the redacted forms ARE logged, so both send lines were seen.
      expect(allLogs).toContain("d****@example.test");
      // The Resend request body is the only place the address goes — never a log.
      expect(fakeResend.requests.map((r) => r.body.to)).toEqual([
        [EMAIL_A],
        [EMAIL_B],
      ]);
    });

    it("A4.5 re-running the cron over an already-completed row sends no second email", async () => {
      await seedUser(USER_A, EMAIL_A);
      const requestId = await seedDueDeletion(USER_A);
      const { executeDueDeletions } =
        await import("../../server/lib/account-deletion-execute");

      await executeDueDeletions(buildAdmin() as never, "deletion-ci");
      expect(fakeResend.requests).toHaveLength(1);
      expect(await requestStatus(requestId)).toBe("absent");

      const again = await executeDueDeletions(
        buildAdmin() as never,
        "deletion-ci",
      );
      expect(again).toEqual({
        executedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      });
      expect(fakeResend.requests).toHaveLength(1);

      // Even if a completed row were re-selected, the key is the row id — one email at Resend.
      expect(fakeResend.requests[0]!.headers["Idempotency-Key"]).toBe(
        `account-deletion-completed:${requestId}`,
      );
    });
  },
);
