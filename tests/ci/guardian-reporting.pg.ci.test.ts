/**
 * Guardian roster and guardian-side unlink — runtime contract → real PostgreSQL.
 *
 * @spec [Doc-01_V8 §31.4 per-student entitlement, §35 linkage, §36.3 revocation, §38.1, §14
 *   Layer 3 audit logging, §12.1; owner ruling 2026-09-03 ("a lapsed subscriber with a Customer
 *   goes to the portal, not to checkout"); owner ruling 2026-08-27 Q7 (404 for a non-party,
 *   409 for a party whose link is not active); Guardian_Closure_Plan G1-04/G1-05]
 * | @implemented [2026-08-24] | @revised [2026-11-02 — converted to real Postgres]
 *
 * plain English: drives the REAL `/api/guardian/students` and `DELETE /api/guardian/link/:id`
 * routes over the REAL account layer, entitlement evaluator, `revoke_guardian_link_audited`,
 * notification outbox and dispatcher, against a throwaway database with every migration
 * applied. Substituted: the database TRANSPORT (tests/helpers/pg-supabase), the auth boundary
 * (a fixed guardian session), and the network (global `fetch` → an in-memory fake Resend).
 *
 * WHAT CHANGED ON 2026-11-02, AND WHY. This file was `guardian-reporting.contract.test.ts`,
 * accepted by scripts/ci/guardian-schema-truth-gate.mjs until 2026-11-01. It replaced
 * `server/lib/account` wholesale, the entitlement service, the dispatcher and `supabaseServer`,
 * and fed them hand-written link and entitlement rows. Its assertions are kept; what each one
 * now stands on is real:
 *
 *   roster + dashboard_viewed   was: a captured fake insert   → now: the row read back from
 *                                                               `audit_logs`.
 *   entitlement_lapsed matrix   was: mocked `{tier, status}`  → now: a real `entitlements` row
 *                                                               per status, evaluated by the real
 *                                                               `entitlement_active`. An `active`
 *                                                               control is ADDED, so the matrix
 *                                                               can come out true.
 *   link lookup fails closed    was: `mockRejectedValueOnce`  → now: the table is taken away
 *                                                               (renamed) so the real reader's
 *                                                               real query fails.
 *   409 at revoke time          was: a mocked domain throw    → now: the student really revokes
 *                                                               between the route's party check
 *                                                               and its RPC (see `beforeRevoke`).
 *   successful unlink           was: `toHaveBeenCalledWith`   → now: `revoked_by_profile_id` on
 *                                                               the row, ONE `guardian_link_revoked`
 *                                                               audit row, and the student's email
 *                                                               actually dispatched for THIS
 *                                                               revocation's event.
 *   Q7 404 / 409                was: mocked party lookup      → now: real link rows (none / a
 *                                                               revoked one).
 *
 * ONE ASSERTION WAS NOT CARRIED: "nothing was written to `system_event_logs`". That table exists
 * in no migration, so a write to it cannot succeed against this database; the guarantee it
 * stood for — the dashboard view is recorded in `audit_logs` — is the INSTRUMENT case's
 * presence assertion.
 *
 * Every case was observed FAILING once under a plant on the code under test (recorded in the
 * PR body, with the exact line each plant mutated).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { pinDaytimeClock, releaseClock } from "../helpers/daytime-clock";
import { notificationEventId } from "../../server/lib/notifications/event-id";
// The wire codes come from the contract module, not from string literals here: the first draft
// of the Q7 accept case asserted "WRONG_ACCEPTOR" and got a 500, because the real constant is
// "GUARDIAN_LINK_WRONG_ACCEPTOR". A test that spells the contract itself can disagree with it.
import { GUARDIAN_LINK_ERROR } from "../../packages/shared/src/guardian-link-schema";

const DB_NAME = "guardian_reporting_ci";
const GUARDIAN = "9e111111-1111-4111-8111-111111111111";
const STUDENT = "9e222222-2222-4222-8222-222222222222";
const SECOND_STUDENT = "9e333333-3333-4333-8333-333333333333";
const OUTSIDER = "9e444444-4444-4444-8444-444444444444";
const STUDENT_EMAIL = "sam@example.test";

let pg: Client;

/** Every `.rpc` the code under test makes, by function name. The call still reaches Postgres. */
const rpcCalls: string[] = [];
/**
 * Runs once, immediately BEFORE the next `revoke_guardian_link_audited` call reaches Postgres.
 * It is how a real concurrent revoke is placed between the route's party read and its write —
 * the only way that 409 path exists in production — without substituting either.
 */
let beforeRevoke: (() => Promise<void>) | null = null;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    const real = makePgSupabase(pg);
    return {
      from: real.from,
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push(fn);
        if (fn === "revoke_guardian_link_audited" && beforeRevoke) {
          const hook = beforeRevoke;
          beforeRevoke = null;
          await hook();
        }
        return real.rpc(fn, args);
      },
    };
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const r = req as express.Request & { user?: unknown; requestId?: string };
      r.user = { id: GUARDIAN, email: "g@example.test", role: "guardian" };
      r.requestId ??= "req-guardian-reporting";
      next();
    },
  };
});

type SentEmail = { to: unknown; subject: unknown };
const fakeResend = { sent: [] as SentEmail[], nextId: 1 };

async function fakeFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<
    string,
    unknown
  >;
  fakeResend.sent.push({ to: body.to, subject: body.subject });
  return new Response(JSON.stringify({ id: `re_${fakeResend.nextId++}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/guardian", router);
  return app;
}

/** The link as SCL-080's writer produces it. Returns its id. */
async function linkActive(student: string): Promise<string> {
  const r = await pg.query(
    `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
     VALUES ($1, $2, 'active', 'student', now(), now(), $2) RETURNING id`,
    [GUARDIAN, student],
  );
  return String(r.rows[0]?.id);
}

/** A revoke performed by the STUDENT through the real function, as their own route does. */
async function studentRevokes(student: string): Promise<void> {
  await pg.query(
    `SELECT public.revoke_guardian_link_audited($1, $2, $2, NULL, 'student-side')`,
    [GUARDIAN, student],
  );
}

async function auditRows(
  action: string,
): Promise<
  Array<{ actor_profile_id: string; context: Record<string, unknown> }>
> {
  const r = await pg.query(
    `SELECT actor_profile_id, context FROM public.audit_logs WHERE action = $1 ORDER BY created_at, id`,
    [action],
  );
  return r.rows as Array<{
    actor_profile_id: string;
    context: Record<string, unknown>;
  }>;
}

async function linkRow(
  student: string,
): Promise<{ status: string; revoked_by_profile_id: string | null }> {
  const r = await pg.query(
    `SELECT status, revoked_by_profile_id FROM public.guardian_links
      WHERE guardian_profile_id = $1 AND student_profile_id = $2
      ORDER BY initiated_at DESC LIMIT 1`,
    [GUARDIAN, student],
  );
  return r.rows[0] as { status: string; revoked_by_profile_id: string | null };
}

describe.skipIf(!PG_AVAILABLE)(
  "Guardian reporting runtime contract (real Postgres)",
  () => {
    beforeAll(async () => {
      // Quiet hours (owner ruling 2026-10-09): the unlink route sends on the process clock, so
      // pin it to Chicago daytime; otherwise "the email was sent" depends on when CI ran.
      pinDaytimeClock();
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.NOTIFICATION_FROM_EMAIL = "notifications@send.example.test";
      process.env.PUBLIC_SITE_URL = "https://app.example.test";
      vi.stubGlobal("fetch", fakeFetch);

      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'g@example.test'),($2,$5),($3,'bea@example.test'),($4,'otto@example.test')`,
        [GUARDIAN, STUDENT, SECOND_STUDENT, OUTSIDER, STUDENT_EMAIL],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth) VALUES
         ($1,'g@example.test','guardian','Gia Guardian','1980-01-01'),
         ($2,$5,'student','Sam Student','2010-01-01'),
         ($3,'bea@example.test','student','Bea Student','2010-01-01'),
         ($4,'otto@example.test','student','Otto Outsider','2010-01-01')`,
        [GUARDIAN, STUDENT, SECOND_STUDENT, OUTSIDER, STUDENT_EMAIL],
      );
    });

    afterAll(async () => {
      releaseClock();
      vi.unstubAllGlobals();
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      rpcCalls.length = 0;
      beforeRevoke = null;
      fakeResend.sent = [];
      await pg.query(`DELETE FROM public.notification_delivery_events`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.entitlements`);
      // audit_logs is append-only by trigger; each case counts only rows it created.
      await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER USER`);
      await pg.query(`DELETE FROM public.audit_logs`);
      await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER USER`);
    });

    /**
     * INSTRUMENT CONTROL as well as a roster case. The fail-closed and revoke cases below
     * assert that a row did NOT reach `audit_logs`; "no row" and "no instrument" look the
     * same, so this case — the real route writing a real `guardian_dashboard_viewed` row into
     * the real table — is what makes those negative assertions mean something.
     */
    it("returns linked students list and records guardian_dashboard_viewed (INSTRUMENT)", async () => {
      await linkActive(STUDENT);

      const response = await request(await buildApp()).get(
        "/api/guardian/students",
      );

      expect(response.status).toBe(200);
      expect(response.body.students).toHaveLength(1);
      expect(response.body.students[0]).toMatchObject({
        id: STUDENT,
        display_name: "Sam Student",
      });

      // G1-04: the event goes to audit_logs, in the link events' shape.
      const viewed = await auditRows("guardian_dashboard_viewed");
      expect(viewed).toHaveLength(1);
      expect(viewed[0]).toMatchObject({
        actor_profile_id: GUARDIAN,
        context: expect.objectContaining({ linked_student_count: 1 }),
      });
    });

    /**
     * `entitlement_lapsed` separates the two states that both leave `has_active_entitlement`
     * false, and which need OPPOSITE controls.
     *
     * @spec [owner ruling 2026-09-03 — "a lapsed subscriber with a Customer goes to the
     *        portal, not to checkout"]
     *
     * Without this field the purchase card offers checkout to a student whose subscription
     * merely lapsed, and `evaluateSubjectPurchaseEligibility` lets it through — `canceled` is
     * not in the platform predicate — so the guardian is sold a SECOND subscription instead
     * of reactivating the first.
     *
     * The `active` row is the control that lets this matrix come out the other way: the same
     * evaluator, the same route, a status the real `entitlement_active` admits.
     */
    it.each([
      ["active", true, false],
      ["canceled", false, true],
      ["unpaid", false, true],
      ["incomplete_expired", false, true],
      // Never completed a first payment: there is nothing to reactivate, so checkout is the
      // right control and this must stay false.
      ["incomplete", false, false],
    ])(
      "a real premium entitlement row with status=%s → has_active_entitlement=%s, entitlement_lapsed=%s",
      async (status, active, lapsed) => {
        await linkActive(STUDENT);
        await pg.query(
          `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', $2)`,
          [STUDENT, status],
        );

        const response = await request(await buildApp()).get(
          "/api/guardian/students",
        );

        expect(response.status).toBe(200);
        expect(response.body.students).toHaveLength(1);
        expect(response.body.students[0].has_active_entitlement).toBe(active);
        expect(response.body.students[0].entitlement_lapsed).toBe(lapsed);
      },
    );

    it("reports a student with no entitlement row as neither funded nor lapsed", async () => {
      await linkActive(STUDENT);

      const response = await request(await buildApp()).get(
        "/api/guardian/students",
      );

      expect(response.status).toBe(200);
      expect(response.body.students).toHaveLength(1);
      expect(response.body.students[0]).toMatchObject({
        has_active_entitlement: false,
        entitlement_lapsed: false,
      });
    });

    it("fails closed when the guardian link source lookup fails for the students list", async () => {
      await linkActive(STUDENT);
      const app = await buildApp();

      // The real reader's real query fails: the table it names is not there.
      await pg.query(
        `ALTER TABLE public.guardian_links RENAME TO guardian_links_ci_offline`,
      );
      try {
        const response = await request(app).get("/api/guardian/students");
        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Internal server error");
        expect(await auditRows("guardian_dashboard_viewed")).toEqual([]);
      } finally {
        await pg.query(
          `ALTER TABLE public.guardian_links_ci_offline RENAME TO guardian_links`,
        );
      }

      // PRESENCE CONTROL: with the table back, the same request is served and recorded, so the
      // empty read above was the failure's doing and not a writer aimed at nothing.
      const served = await request(app).get("/api/guardian/students");
      expect(served.status).toBe(200);
      expect(await auditRows("guardian_dashboard_viewed")).toHaveLength(1);
    });

    /**
     * 409 AT REVOKE TIME — the route's party check saw an ACTIVE link, and by the time its RPC
     * ran the student had revoked it from their side (another device, another tab). The
     * transaction raised LY003, so it wrote nothing; the route must answer 409 and write
     * nothing of its own either.
     */
    it("fails closed on unlink conflict when the link is no longer active, and writes no revoke audit row", async () => {
      await linkActive(STUDENT);
      beforeRevoke = () => studentRevokes(STUDENT);

      const response = await request(await buildApp()).delete(
        `/api/guardian/link/${STUDENT}`,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(GUARDIAN_LINK_ERROR.NOT_ACTIVE);
      // The route DID reach the revoke — this is the RPC's conflict, not the party check's.
      expect(rpcCalls).toContain("revoke_guardian_link_audited");
      // Exactly the student's own revoke row, and nothing from the guardian's attempt.
      const revoked = await auditRows("guardian_link_revoked");
      expect(revoked.map((r) => r.actor_profile_id)).toEqual([STUDENT]);
      expect((await linkRow(STUDENT)).revoked_by_profile_id).toBe(STUDENT);
    });

    /**
     * The revoke audit row is written by `revoke_guardian_link_audited` in the SAME
     * transaction as the status change (migration 20260828000000). The route once wrote its own
     * as a second, best-effort request; if that came back, every revoke would be
     * double-audited. Here the table is read, so exactly one row is the assertion — presence
     * and no duplicate in one.
     */
    it("keeps valid unlink transition behavior and leaves the revoke audit row to the transaction", async () => {
      const revokedLinkId = await linkActive(STUDENT);
      await linkActive(SECOND_STUDENT);

      const response = await request(await buildApp()).delete(
        `/api/guardian/link/${STUDENT}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      // The remaining roster, from the canonical source: the other student, and only them.
      expect(
        (response.body.students as Array<{ id: string }>).map((s) => s.id),
      ).toEqual([SECOND_STUDENT]);

      // §36.3 — the revoker is RECORDED, not assumed: the acting guardian, on the row.
      expect(await linkRow(STUDENT)).toEqual({
        status: "revoked",
        revoked_by_profile_id: GUARDIAN,
      });
      expect((await linkRow(SECOND_STUDENT)).status).toBe("active");

      const revoked = await auditRows("guardian_link_revoked");
      expect(
        revoked,
        "expected exactly the transaction's guardian_link_revoked row — a second means the route double-audited",
      ).toHaveLength(1);
      expect(revoked[0]!.actor_profile_id).toBe(GUARDIAN);

      // §36.3 / contract §6.1: the other party's email for THIS revocation went out inline.
      const msgs = await pg.query(
        `SELECT recipient_profile_id, channel, status FROM public.notification_messages
          WHERE event_id = $1 ORDER BY channel`,
        [notificationEventId("guardian_unlinked", revokedLinkId)],
      );
      // Both of THIS revocation's messages exist, addressed to the student, and the email one
      // was dispatched by the route (it would sit at 'queued' if the route had dispatched any
      // other event id, or none — the in_app status is the outbox's, not the route's).
      expect(
        msgs.rows.map(
          (m: { recipient_profile_id: string; channel: string }) => [
            m.recipient_profile_id,
            m.channel,
          ],
        ),
      ).toEqual([
        [STUDENT, "email"],
        [STUDENT, "in_app"],
      ]);
      expect(msgs.rows[0].status).toBe("sent");
      expect(fakeResend.sent.map((m) => m.to)).toEqual([[STUDENT_EMAIL]]);
    });

    /**
     * @spec [owner ruling 2026-08-27 Q7 — "404 if the caller is not a party to the link at all.
     *        Keep the informative response if they are... Use 409 rather than 403, since it's a
     *        state conflict rather than an authorization failure."] | @implemented [2026-08-28]
     *
     * A guardian NAMED on a revoked link already knows it exists: 409 leaks nothing. A
     * guardian named on NOTHING guessed an id: a 403 would confirm the student is real, so they
     * get the resolver's 404 body verbatim. Neither reaches the transition.
     */
    describe("Q7 — party-hood decides 404 versus 409 on the guardian link routes", () => {
      const NOT_FOUND_BODY = {
        error: "Not found",
        message: "No such student, or you do not have access to them",
      };

      it("revoke: 404s a guardian who is not a party to any link with the student", async () => {
        // The guardian IS linked — to someone else — so the 404 is about party-hood, not about
        // a guardian with no links at all.
        await linkActive(STUDENT);

        const response = await request(await buildApp()).delete(
          `/api/guardian/link/${OUTSIDER}`,
        );

        expect(response.status).toBe(404);
        expect(response.body).toMatchObject(NOT_FOUND_BODY);
        // The transition must not even be attempted for a non-party.
        expect(rpcCalls).not.toContain("revoke_guardian_link_audited");
        expect(await auditRows("guardian_link_revoked")).toEqual([]);
        expect((await linkRow(STUDENT)).status).toBe("active");
      });

      it("revoke: 409s a guardian whose link with the student is already revoked", async () => {
        await linkActive(STUDENT);
        await studentRevokes(STUDENT);
        expect(await auditRows("guardian_link_revoked")).toHaveLength(1);

        const response = await request(await buildApp()).delete(
          `/api/guardian/link/${STUDENT}`,
        );

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe(GUARDIAN_LINK_ERROR.NOT_ACTIVE);
        expect(rpcCalls).not.toContain("revoke_guardian_link_audited");
        expect(await auditRows("guardian_link_revoked")).toHaveLength(1);
      });
    });
  },
);
