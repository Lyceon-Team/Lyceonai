/**
 * The email send gate on real Postgres: every state, threshold and transition, the parent pause,
 * the plan-aware rules, engagement, campaigns, milestones, the dispatcher and the lifecycle rule
 * asking the gate, the Keep me posted link, the Resend mirror, grants and the deletion cascade.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30) "Acceptance"; owner rulings
 *       2026-11-02 rounds 1 and 2; contracts/notifications.contract.md C15; SCL-263]
 *       | @implemented [2026-11-02]
 *
 * plain English: the whole migration pipeline, then the shared lifecycle scenario
 * (`lifecycle.pg-harness.ts`: real profiles, real answered items) with a service_role probe for
 * every gate call. Time is measured from D0, a moment after the people are created; every call
 * passes its own `p_now`, so no case depends on the wall clock. Each case uses its own people.
 * Each `it` name below is the anchor one plant in scripts/ci/email-gate.mutations.sh reddens.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Client } from "pg";
import { makePgSupabase, PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  DAY,
  morningAfter,
  setupLifecycleDb,
  yearsAgo,
  type LifecycleDb,
} from "./lifecycle.pg-harness";
import {
  EMAIL_KIND_CATEGORY,
  EMAIL_KINDS,
} from "../../packages/shared/src/email-gate";
import { NOTIFICATION_EVENT_TYPES } from "../../packages/shared/src/notifications-schema";
import type { EmailSendInput } from "../../server/lib/notifications/transport";

process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "email-gate-ci-secret";
process.env.PUBLIC_SITE_URL = "https://lyceon.test";

let pgRef: Client;
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pgRef);
  },
}));
vi.mock("../../server/middleware/rate-limit", () => ({
  anonymousBucketRateLimit:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));
const logs: string[] = [];
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]): void => {
    logs.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

type Decision = { allow: boolean; reason: string; state: string | null };

describe.skipIf(!PG_AVAILABLE)("email send gate → real PG", () => {
  let h: LifecycleDb;
  let pg: Client;
  let D0: Date;
  const day = (n: number): Date => new Date(D0.getTime() + n * DAY);
  let providerSeq = 0;

  async function student(
    opts: { dob?: string | null; role?: "student" | "guardian" } = {},
  ): Promise<{ id: string; email: string }> {
    return h.person({
      completedAt: null,
      ...(opts.dob === undefined ? {} : { dob: opts.dob }),
      ...(opts.role === undefined ? {} : { role: opts.role }),
    });
  }
  async function decide(id: string, kind: string, at: Date): Promise<Decision> {
    return h.asProbe(async () => {
      const r = await pg.query<{ d: Decision }>(
        `SELECT public.email_gate_decide($1, $2, $3::timestamptz) AS d`,
        [id, kind, at.toISOString()],
      );
      return r.rows[0]!.d;
    });
  }
  async function refresh(id: string, at: Date): Promise<string> {
    return h.asProbe(async () => {
      const r = await pg.query<{ s: string }>(
        `SELECT public.email_gate_refresh($1, $2::timestamptz) AS s`,
        [id, at.toISOString()],
      );
      return r.rows[0]!.s;
    });
  }
  /** A governed email that went out at `at` (a sent pipeline message). */
  async function governedSend(
    id: string,
    at: Date,
    kind = "missed_plan_alert",
  ): Promise<void> {
    await pg.query(
      `WITH e AS (SELECT gen_random_uuid() AS id)
       SELECT public.emit_notification_event(e.id, $2, $1::uuid,
         jsonb_build_array(jsonb_build_object('profile_id', $1::uuid, 'channels', jsonb_build_array('email'))),
         '{}'::jsonb) FROM e`,
      [id, kind],
    );
    await pg.query(
      `UPDATE public.notification_messages m SET status = 'sent', sent_at = $2
         FROM public.notification_events e
        WHERE e.event_id = m.event_id AND m.recipient_profile_id = $1
          AND m.channel = 'email' AND m.status = 'queued' AND e.event_type = $3`,
      [id, at.toISOString(), kind],
    );
  }
  async function engagement(
    email: string,
    at: Date,
    type: "email.clicked" | "email.opened",
  ): Promise<string> {
    providerSeq += 1;
    return h.asProbe(async () => {
      const r = await pg.query<{ r: string }>(
        `SELECT public.record_email_engagement_event($1, $2, $3, $4::timestamptz, ARRAY[$5]) AS r`,
        [
          `evt_${providerSeq}`,
          `re_x${providerSeq}`,
          type,
          at.toISOString(),
          email,
        ],
      );
      return r.rows[0]!.r;
    });
  }
  async function stateRow(
    id: string,
  ): Promise<{ state: string; pause_episode: number } | undefined> {
    const r = await pg.query<{ state: string; pause_episode: number }>(
      `SELECT state, pause_episode FROM public.email_gate_state WHERE profile_id = $1`,
      [id],
    );
    return r.rows[0];
  }
  async function count(sql: string, params: unknown[]): Promise<number> {
    const r = await pg.query<{ n: number }>(sql, params);
    return r.rows[0]!.n;
  }
  async function pauseNotes(id: string): Promise<number> {
    return count(
      `SELECT count(*)::int AS n FROM public.notification_events
        WHERE event_type = 'email_gate_paused_notice' AND subject_profile_id = $1`,
      [id],
    );
  }
  /** A paused student: idle 15 days, three unengaged governed emails. */
  async function pausedStudent(): Promise<{ id: string; email: string }> {
    const s = await student();
    for (const n of [2, 3, 4]) await governedSend(s.id, day(n));
    expect(await refresh(s.id, day(15))).toBe("paused");
    return s;
  }
  async function planDays(
    id: string,
    days: { date: string; outcome: "did_work" | "missed" }[],
    through: string,
    at: Date,
  ): Promise<{ recorded: number; run: number; state: string }> {
    return h.asProbe(async () => {
      const r = await pg.query<{
        r: { recorded: number; run: number; state: string };
      }>(
        `SELECT public.email_gate_record_plan_days($1, $2::jsonb, 'UTC', $3::date, $4::timestamptz) AS r`,
        [id, JSON.stringify(days), through, at.toISOString()],
      );
      return r.rows[0]!.r;
    });
  }
  const iso = (d: Date): string => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    h = await setupLifecycleDb("email_gate_pg_ci", "e9a7e000");
    pg = h.pg;
    pgRef = pg;
    await pg.query(
      `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz`,
    );
    D0 = new Date(Date.now() + 5 * 60_000);
  }, 300_000);

  afterAll(async () => {
    await pg?.end();
  });

  it("C1: SQL email_category and the shared map agree on every kind; an unknown kind is refused", async () => {
    for (const t of NOTIFICATION_EVENT_TYPES) {
      expect(EMAIL_KIND_CATEGORY[t]).toBeDefined();
    }
    for (const kind of EMAIL_KINDS) {
      const r = await pg.query<{ c: string }>(
        `SELECT public.email_category($1) AS c`,
        [kind],
      );
      expect(r.rows[0]?.c, kind).toBe(EMAIL_KIND_CATEGORY[kind]);
    }
    await expect(
      pg.query(`SELECT public.email_category('not_a_kind')`),
    ).rejects.toThrow(/unknown email kind/);
  });

  it("S1: active within 7 days of activity: governed emails allowed", async () => {
    const s = await student();
    await h.answer(s.id, 1, day(1));
    expect(await decide(s.id, "review_ask", day(7.5))).toEqual({
      allow: true,
      reason: "active",
      state: "active",
    });
  });

  it("S2: cooling after 7 days: one governed email per 7 days, the QOTD exempt", async () => {
    const s = await student();
    expect((await decide(s.id, "review_ask", day(6.9))).state).toBe("active");
    expect(await decide(s.id, "review_ask", day(8))).toEqual({
      allow: true,
      reason: "cooling",
      state: "cooling",
    });
    await governedSend(s.id, day(8), "review_ask");
    expect(await decide(s.id, "missed_plan_alert", day(10))).toMatchObject({
      allow: false,
      reason: "cooling_cap",
    });
    expect(await decide(s.id, "qotd_daily", day(10))).toMatchObject({
      allow: true,
      reason: "cooling_qotd_exempt",
    });
    // A QOTD email never spends the cap.
    await governedSend(s.id, day(10), "qotd_daily");
    expect(await decide(s.id, "missed_plan_alert", day(15.1))).toMatchObject({
      allow: true,
      state: "cooling",
    });
  });

  it("S3: paused needs 14+ days without activity AND 3 unengaged governed emails", async () => {
    const s = await student();
    for (const n of [2, 3, 4]) await governedSend(s.id, day(n));
    expect(await refresh(s.id, day(13.5))).toBe("cooling");
    expect(await refresh(s.id, day(14.5))).toBe("paused");
    const two = await student();
    for (const n of [2, 3]) await governedSend(two.id, day(n));
    expect(await refresh(two.id, day(30))).toBe("cooling");
  });

  it("S4: a click resets the unengaged count; an open does not", async () => {
    const clicked = await student();
    const opened = await student();
    for (const s of [clicked, opened]) {
      for (const n of [2, 3, 4]) await governedSend(s.id, day(n));
    }
    expect(await engagement(clicked.email, day(5), "email.clicked")).toBe(
      "recorded",
    );
    expect(await engagement(opened.email, day(5), "email.opened")).toBe(
      "recorded",
    );
    expect(await refresh(clicked.id, day(16))).toBe("cooling");
    expect(await refresh(opened.id, day(16))).toBe("paused");
  });

  it("S5: an email counts as unengaged only after its 72-hour window", async () => {
    const s = await student();
    for (const n of [2, 3, 14]) await governedSend(s.id, day(n));
    expect(await refresh(s.id, day(16.9))).toBe("cooling");
    expect(await refresh(s.id, day(17.1))).toBe("paused");
  });

  it("S6: paused refuses governed (QOTD too); always, notice and milestone emails still go", async () => {
    const s = await pausedStudent();
    expect(await decide(s.id, "review_ask", day(15.5))).toMatchObject({
      allow: false,
      reason: "paused",
    });
    expect(await decide(s.id, "qotd_daily", day(15.5))).toMatchObject({
      allow: false,
      reason: "paused",
    });
    expect((await decide(s.id, "guardian_linked", day(15.5))).allow).toBe(true);
    expect(
      (await decide(s.id, "email_gate_paused_notice", day(15.5))).allow,
    ).toBe(true);
    expect(await decide(s.id, "sat_week_before", day(15.5))).toMatchObject({
      allow: true,
      reason: "milestone",
    });
  });

  it("S7: the pause note is emitted once per episode, to 13+ students only", async () => {
    const s = await pausedStudent();
    expect(await pauseNotes(s.id)).toBe(1);
    await refresh(s.id, day(16));
    await refresh(s.id, day(20));
    expect(await pauseNotes(s.id)).toBe(1);
    const note = await pg.query<{ channel: string; payload: unknown }>(
      `SELECT m.channel, e.payload FROM public.notification_events e
         JOIN public.notification_messages m ON m.event_id = e.event_id
        WHERE e.event_type = 'email_gate_paused_notice' AND e.subject_profile_id = $1`,
      [s.id],
    );
    expect(note.rows).toEqual([
      {
        channel: "email",
        payload: { first_name: "Ana", episode: 1, test_date: null },
      },
    ]);
    const young = await student({ dob: yearsAgo(11) });
    for (const n of [2, 3, 4]) await governedSend(young.id, day(n));
    expect(await refresh(young.id, day(15))).toBe("paused");
    expect(await pauseNotes(young.id)).toBe(0);
  });

  it("S8: wake-up: any activity after the pause makes the student active", async () => {
    const s = await pausedStudent();
    await h.answer(s.id, 1, day(18));
    expect(await decide(s.id, "review_ask", day(18.5))).toMatchObject({
      allow: true,
      state: "active",
    });
    const t = await pg.query(
      `SELECT from_state, to_state, actor, reason FROM public.email_gate_transitions
        WHERE profile_id = $1 ORDER BY occurred_at, id`,
      [s.id],
    );
    expect(t.rows).toEqual([
      {
        from_state: "active",
        to_state: "paused",
        actor: "system",
        reason: "inactive_and_unengaged",
      },
      {
        from_state: "paused",
        to_state: "active",
        actor: "system",
        reason: "recent_activity",
      },
    ]);
  });

  it("S9: paused stays paused without a wake (sticky): a click resets the count but is not a wake", async () => {
    const s = await pausedStudent();
    // Without the sticky rule this click would drop the unengaged count to 0 (cooling).
    await engagement(s.email, day(16), "email.clicked");
    expect(await refresh(s.id, day(20))).toBe("paused");
  });

  it("K1: the signed Keep me posted link: the GET changes nothing; the POST lifts the pause; a tampered token is refused", async () => {
    const s = await pausedStudent();
    const { createPublicEmailKeepPostedRouter } =
      await import("../../server/routes/public-email-keep-posted-routes");
    const { qotdEmailLinkToken } =
      await import("../../server/services/qotd/qotd-email-links");
    const app = express();
    app.use(
      "/api/public/email",
      createPublicEmailKeepPostedRouter(
        () => makePgSupabase(pg),
        () => day(16),
      ),
    );
    const t = qotdEmailLinkToken("email_keep_posted", s.id);
    const url = `/api/public/email/keep-posted?t=${encodeURIComponent(t)}`;
    expect((await request(app).get(url)).status).toBe(200);
    expect((await stateRow(s.id))?.state).toBe("paused");
    const tampered = `${t.slice(0, -2)}AA`;
    expect(
      (
        await request(app).post(
          `/api/public/email/keep-posted?t=${encodeURIComponent(tampered)}`,
        )
      ).status,
    ).toBe(400);
    // Another email's token (the review ask's stop link) is not accepted here.
    const foreign = qotdEmailLinkToken("review_ask_stop", s.id);
    expect(
      (
        await request(app).post(
          `/api/public/email/keep-posted?t=${encodeURIComponent(foreign)}`,
        )
      ).status,
    ).toBe(400);
    expect((await stateRow(s.id))?.state).toBe("paused");
    expect((await request(app).post(url)).status).toBe(200);
    expect((await stateRow(s.id))?.state).toBe("active");
    expect((await request(app).post(url)).status).toBe(200); // idempotent
    const last = await pg.query(
      `SELECT actor, to_state FROM public.email_gate_transitions
        WHERE profile_id = $1 ORDER BY id DESC LIMIT 1`,
      [s.id],
    );
    expect(last.rows[0]).toEqual({
      actor: "keep_me_posted",
      to_state: "active",
    });
  });

  it("K2: after Keep me posted, a new pause needs new unengaged emails and is a new episode", async () => {
    const s = await pausedStudent();
    await h.asProbe(() =>
      pg.query(`SELECT public.email_gate_keep_posted($1, $2::timestamptz)`, [
        s.id,
        day(16).toISOString(),
      ]),
    );
    expect(await refresh(s.id, day(31))).toBe("cooling");
    for (const n of [17, 18, 19]) await governedSend(s.id, day(n));
    expect(await refresh(s.id, day(31))).toBe("paused");
    expect(await stateRow(s.id)).toEqual({ state: "paused", pause_episode: 2 });
    expect(await pauseNotes(s.id)).toBe(2);
  });

  it("M1: every change is queued for Resend's email_state, never for an under-13", async () => {
    const s = await pausedStudent();
    const row = await pg.query(
      `SELECT email_state, synced_at FROM public.email_gate_resend_outbox WHERE profile_id = $1`,
      [s.id],
    );
    expect(row.rows).toEqual([{ email_state: "paused", synced_at: null }]);
    const young = await student({ dob: yearsAgo(11) });
    expect(await refresh(young.id, day(8))).toBe("cooling");
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.email_gate_resend_outbox WHERE profile_id = $1`,
        [young.id],
      ),
    ).toBe(0);
  });

  it("M2: a failed mirror backs off and never blocks a send; the next run syncs it", async () => {
    const s = await pausedStudent();
    await h.answer(s.id, 1, day(17));
    expect((await decide(s.id, "review_ask", day(17.5))).allow).toBe(true);
    const { runEmailGateJob } =
      await import("../../server/services/email-gate/email-gate-job");
    const calls: string[] = [];
    const failing = await h.asProbe(() =>
      runEmailGateJob({
        db: makePgSupabase(pg),
        now: day(17.6),
        updateContactProperties: async (_email, properties, ctx) => {
          calls.push(`${ctx.recipientProfileId}:${properties.email_state}`);
          return {
            ok: false,
            error: {
              kind: "provider_rejected",
              message: "HTTP 500",
              status: 500,
            },
          };
        },
      }),
    );
    expect(calls).toContain(`${s.id}:active`);
    expect(failing.mirrorFailed).toBeGreaterThan(0);
    const after = await pg.query<{ attempts: number; due: boolean }>(
      `SELECT attempts, next_attempt_at > $2::timestamptz AS due
         FROM public.email_gate_resend_outbox WHERE profile_id = $1`,
      [s.id, day(17.6).toISOString()],
    );
    expect(after.rows[0]).toEqual({ attempts: 1, due: true });
    // The gate itself is untouched by the mirror.
    expect((await decide(s.id, "review_ask", day(17.6))).allow).toBe(true);
    const ok = await h.asProbe(() =>
      runEmailGateJob({
        db: makePgSupabase(pg),
        now: day(18),
        updateContactProperties: async () => ({
          ok: true,
          value: { updated: true },
        }),
      }),
    );
    expect(ok.mirrored).toBeGreaterThan(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.email_gate_resend_outbox
          WHERE profile_id = $1 AND synced_at IS NOT NULL AND email_state = 'active'`,
        [s.id],
      ),
    ).toBe(1);
    // No address in any log line.
    expect(logs.join("\n")).not.toContain(s.email);
  });

  it("P1: on a plan, 2 missed planned days in a row is cooling", async () => {
    const s = await student();
    const r = await planDays(
      s.id,
      [
        { date: iso(day(1)), outcome: "missed" },
        { date: iso(day(2)), outcome: "missed" },
      ],
      iso(day(2)),
      day(3),
    );
    expect(r).toEqual({ recorded: 2, run: 2, state: "cooling" });
  });

  it("P2: a missed planned day with activity of any kind is not missed", async () => {
    const s = await student();
    await h.answer(s.id, 1, new Date(`${iso(day(2))}T12:00:00Z`));
    const r = await planDays(
      s.id,
      [
        { date: iso(day(1)), outcome: "missed" },
        { date: iso(day(2)), outcome: "missed" },
      ],
      iso(day(2)),
      day(3),
    );
    expect(r.run).toBe(0);
    expect(r.state).toBe("active");
  });

  it("P3: days without a planned block never count; a rerun records nothing twice", async () => {
    const s = await student();
    const days = [
      { date: iso(day(1)), outcome: "missed" as const },
      // day 2 and 3: no planned block, not in the list
      { date: iso(day(4)), outcome: "missed" as const },
    ];
    expect(await planDays(s.id, days, iso(day(4)), day(5))).toMatchObject({
      recorded: 2,
      run: 2,
    });
    expect(await planDays(s.id, days, iso(day(4)), day(5))).toMatchObject({
      recorded: 0,
      run: 2,
    });
  });

  it("P4: on a plan, paused needs 3 missed planned days AND 14 days AND 3 unengaged emails", async () => {
    const s = await student();
    for (const n of [2, 3, 4]) await governedSend(s.id, day(n));
    const missed = (ns: number[]) =>
      ns.map((n) => ({ date: iso(day(n)), outcome: "missed" as const }));
    expect(
      (await planDays(s.id, missed([10, 11, 12]), iso(day(12)), day(13))).state,
    ).toBe("cooling");
    expect(
      (await planDays(s.id, missed([13]), iso(day(13)), day(14.5))).state,
    ).toBe("paused");
    // Off-plan activity after the last missed day wakes them and breaks the run.
    await h.answer(s.id, 1, day(15));
    expect(await refresh(s.id, day(15.5))).toBe("active");
  });

  it("P5: on a plan, a long quiet stretch with no missed planned days stays active", async () => {
    const s = await student();
    const r = await planDays(
      s.id,
      [{ date: iso(day(9)), outcome: "did_work" }],
      iso(day(9)),
      day(10),
    );
    // did_work with no answered item recorded here: the plan says on track.
    expect(r.state).toBe("active");
  });

  describe("G: the parent pause", () => {
    let kid: { id: string; email: string };
    let parent: { id: string; email: string };
    async function guardianRefresh(
      at: Date,
    ): Promise<{ opened: number; closed: number }> {
      return h.asProbe(async () => {
        const r = await pg.query<{ r: { opened: number; closed: number } }>(
          `SELECT public.email_gate_guardian_refresh($1::timestamptz) AS r`,
          [at.toISOString()],
        );
        return r.rows[0]!.r;
      });
    }
    async function openPauses(): Promise<
      { episode: number; resume_reason: string | null }[]
    > {
      const r = await pg.query(
        `SELECT episode, resume_reason FROM public.email_gate_guardian_pauses
          WHERE guardian_id = $1 AND student_id = $2 ORDER BY episode`,
        [parent.id, kid.id],
      );
      return r.rows;
    }
    beforeAll(async () => {
      kid = await student();
      parent = await student({ role: "guardian", dob: null });
      await h.entitle(kid.id, D0);
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
         VALUES ($1, $2, 'active', 'student', now(), now())`,
        [parent.id, kid.id],
      );
    });

    it("G1: after 7 days without student activity, one parent pause email, once per episode", async () => {
      await h.answer(kid.id, 1, day(1));
      expect((await guardianRefresh(day(7.5))).opened).toBe(0);
      expect((await guardianRefresh(day(8.5))).opened).toBe(1);
      expect((await guardianRefresh(day(9.5))).opened).toBe(0);
      const ev = await pg.query(
        `SELECT m.recipient_profile_id, m.channel, e.payload FROM public.notification_events e
           JOIN public.notification_messages m ON m.event_id = e.event_id
          WHERE e.event_type = 'email_gate_guardian_paused' AND e.subject_profile_id = $1`,
        [kid.id],
      );
      expect(ev.rows).toEqual([
        {
          recipient_profile_id: parent.id,
          channel: "email",
          payload: {
            student_first_name: "Ana",
            guardian_first_name: "Ana",
            test_date: null,
            episode: 1,
          },
        },
      ]);
    });

    it("G2: the digest leaves a paused student out", async () => {
      // Something to report for the kid today: a back-on-track event on the digest day.
      const digestDay = await pg.query<{ d: string }>(
        `SELECT public.chicago_day($1::timestamptz)::text AS d`,
        [day(9.5).toISOString()],
      );
      await pg.query(
        `SELECT public.emit_notification_event(gen_random_uuid(), 'back_on_track', $1::uuid, '[]'::jsonb,
           jsonb_build_object('digest_date', $2::text))`,
        [kid.id, digestDay.rows[0]!.d],
      );
      const r = await h.asProbe(() =>
        pg.query<{ r: { emitted: number } }>(
          `SELECT public.guardian_daily_digest_notify($1::timestamptz, 500) AS r`,
          [day(9.5).toISOString()],
        ),
      );
      expect(r.rows[0]!.r.emitted).toBe(0);
      expect(await refresh(parent.id, day(9.5))).toBe("paused");
    });

    it("G3: student activity resumes the digest; a new episode needs new activity", async () => {
      await h.answer(kid.id, 1, day(10));
      expect((await guardianRefresh(day(10.5))).closed).toBe(1);
      expect(await openPauses()).toEqual([
        { episode: 1, resume_reason: "student_active" },
      ]);
      expect((await guardianRefresh(day(18.5))).opened).toBe(1);
      expect(await openPauses()).toEqual([
        { episode: 1, resume_reason: "student_active" },
        { episode: 2, resume_reason: null },
      ]);
    });

    it("G4: a guardian sign-in resumes it, and no new pause opens without student activity", async () => {
      await pg.query(
        `UPDATE auth.users SET last_sign_in_at = $2 WHERE id = $1`,
        [parent.id, day(19).toISOString()],
      );
      // Closed by the sign-in, and NOT reopened in the same pass: no student activity since.
      expect(await guardianRefresh(day(19.5))).toEqual({
        opened: 0,
        closed: 1,
      });
      expect((await openPauses())[1]?.resume_reason).toBe("guardian_login");
      expect((await guardianRefresh(day(40))).opened).toBe(0);
      expect(await openPauses()).toHaveLength(2);
    });
  });

  it("E1: engagement events are stored once per svix-id with the recipient", async () => {
    const s = await student();
    const r1 = await h.asProbe(() =>
      pg.query<{ r: string }>(
        `SELECT public.record_email_engagement_event('evt_dupe', 're_dupe', 'email.clicked', $1::timestamptz, ARRAY[upper($2)]) AS r`,
        [day(1).toISOString(), s.email],
      ),
    );
    const r2 = await h.asProbe(() =>
      pg.query<{ r: string }>(
        `SELECT public.record_email_engagement_event('evt_dupe', 're_dupe', 'email.clicked', $1::timestamptz, ARRAY[$2]) AS r`,
        [day(1).toISOString(), s.email],
      ),
    );
    expect([r1.rows[0]!.r, r2.rows[0]!.r]).toEqual(["recorded", "duplicate"]);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.notification_delivery_events
          WHERE provider_event_id = 'evt_dupe' AND recipient_profile_id = $1`,
        [s.id],
      ),
    ).toBe(1);
  });

  it("R1: record_campaign_send counts as a governed send; idempotent by Resend id", async () => {
    const s = await student();
    const rec = (resendId: string, at: Date) =>
      h.asProbe(async () => {
        const r = await pg.query<{ r: string }>(
          `SELECT public.record_campaign_send($1, 'fall-push', 'A', $2::timestamptz, $3) AS r`,
          [s.email, at.toISOString(), resendId],
        );
        return r.rows[0]!.r;
      });
    expect(await rec("re_c1", day(2))).toBe("recorded");
    expect(await rec("re_c1", day(2))).toBe("duplicate");
    expect(
      await h.asProbe(async () => {
        const r = await pg.query<{ r: string }>(
          `SELECT public.record_campaign_send('nobody@nowhere.test', 'x', NULL, now(), 're_c0') AS r`,
        );
        return r.rows[0]!.r;
      }),
    ).toBe("unknown_recipient");
    await rec("re_c2", day(3));
    await rec("re_c3", day(4));
    expect(await refresh(s.id, day(15))).toBe("paused");
    // ...and a campaign send spends the cooling cap.
    const c = await student();
    await h.asProbe(() =>
      pg.query(
        `SELECT public.record_campaign_send($1, 'x', NULL, $2::timestamptz, 're_c4')`,
        [c.email, day(8).toISOString()],
      ),
    );
    expect((await decide(c.id, "review_ask", day(9))).reason).toBe(
      "cooling_cap",
    );
  });

  it("V1: email_gate_status flags who may get a governed or milestone email", async () => {
    const active = await student();
    const young = await student({ dob: yearsAgo(11) });
    const paused = await pausedStudent();
    const r = await h.asProbe(() =>
      pg.query<{
        profile_id: string;
        state: string;
        may_send_governed: boolean;
        may_send_milestone: boolean;
      }>(
        `SELECT profile_id, state, may_send_governed, may_send_milestone
           FROM public.email_gate_status WHERE profile_id = ANY($1::uuid[])`,
        [[active.id, young.id, paused.id]],
      ),
    );
    const by = new Map(r.rows.map((row) => [row.profile_id, row]));
    expect(by.get(active.id)).toMatchObject({
      state: "active",
      may_send_governed: true,
      may_send_milestone: true,
    });
    expect(by.get(young.id)).toMatchObject({
      may_send_governed: false,
      may_send_milestone: false,
    });
    expect(by.get(paused.id)).toMatchObject({
      state: "paused",
      may_send_governed: false,
      may_send_milestone: true,
    });
  });

  it("A1: grants: service_role only; anon and authenticated read nothing and call nothing", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const rel of [
        "email_gate_status",
        "email_gate_state",
        "email_gate_transitions",
        "email_campaign_sends",
        "email_gate_guardian_pauses",
        "email_gate_resend_outbox",
        "notification_runtime_config",
      ]) {
        const r = await pg.query<{ ok: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`,
          [role, `public.${rel}`],
        );
        expect(r.rows[0]?.ok, `${role} ${rel}`).toBe(false);
      }
      for (const fn of [
        "public.email_gate_decide(uuid, text, timestamptz)",
        "public.record_campaign_send(text, text, text, timestamptz, text)",
        "public.email_gate_keep_posted(uuid, timestamptz)",
      ]) {
        const r = await pg.query<{ ok: boolean }>(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
          [role, fn],
        );
        expect(r.rows[0]?.ok, `${role} ${fn}`).toBe(false);
      }
    }
    const svc = await pg.query<{ ok: boolean }>(
      `SELECT has_table_privilege('service_role', 'public.email_gate_status', 'SELECT')
          AND has_function_privilege('service_role', 'public.record_campaign_send(text, text, text, timestamptz, text)', 'EXECUTE') AS ok`,
    );
    expect(svc.rows[0]?.ok).toBe(true);
  });

  it("X1: deleting a profile removes every gate row (cascade)", async () => {
    const s = await pausedStudent();
    await h.asProbe(() =>
      pg.query(
        `SELECT public.record_campaign_send($1, 'x', NULL, $2::timestamptz, 're_del')`,
        [s.email, day(1).toISOString()],
      ),
    );
    await engagement(s.email, day(1), "email.clicked");
    await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [s.id]);
    for (const [table, col] of [
      ["email_gate_state", "profile_id"],
      ["email_gate_transitions", "profile_id"],
      ["email_gate_resend_outbox", "profile_id"],
      ["email_campaign_sends", "profile_id"],
      ["notification_delivery_events", "recipient_profile_id"],
    ] as const) {
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.${table} WHERE ${col} = $1`,
          [s.id],
        ),
        table,
      ).toBe(0);
    }
  });

  describe("T: milestones", () => {
    async function milestones(
      at: Date,
      release: Record<string, string>,
    ): Promise<{
      week_before: number;
      day_after: number;
      scores_released: number;
    }> {
      return h.asProbe(async () => {
        const r = await pg.query<{
          r: {
            week_before: number;
            day_after: number;
            scores_released: number;
          };
        }>(
          `SELECT public.email_milestones_notify($1::timestamptz, $2::jsonb) AS r`,
          [at.toISOString(), JSON.stringify(release)],
        );
        return r.rows[0]!.r;
      });
    }
    async function events(id: string, type: string): Promise<unknown[]> {
      const r = await pg.query(
        `SELECT payload FROM public.notification_events WHERE event_type = $2 AND subject_profile_id = $1`,
        [id, type],
      );
      return r.rows.map((row) => row.payload);
    }
    /** Noon UTC on day n's date: a milestone run that never straddles a date boundary. */
    const noon = (n: number): Date => new Date(`${iso(day(n))}T12:00:00Z`);
    let s: { id: string; email: string };
    let young: { id: string; email: string };
    let testDate: string;
    let releaseDate: string;
    beforeAll(async () => {
      s = await student();
      young = await student({ dob: yearsAgo(11) });
      testDate = iso(day(30));
      releaseDate = iso(day(43));
      for (const p of [s, young]) {
        await pg.query(
          `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates)
           VALUES ($1, 'UTC', ARRAY[$2::date])`,
          [p.id, testDate],
        );
      }
    });

    it("T1: a week before: once per test date, 13+ only, even while paused", async () => {
      expect((await milestones(noon(22), {})).week_before).toBe(0);
      for (const n of [2, 3, 4]) await governedSend(s.id, day(n));
      expect(await refresh(s.id, day(23))).toBe("paused");
      expect((await milestones(noon(23), {})).week_before).toBe(1);
      expect((await milestones(noon(24), {})).week_before).toBe(0);
      expect(await events(s.id, "sat_week_before")).toEqual([
        { first_name: "Ana", test_date: testDate },
      ]);
      expect(await events(young.id, "sat_week_before")).toEqual([]);
      expect((await decide(s.id, "sat_week_before", noon(23))).allow).toBe(
        true,
      );
    });

    it("T2: the day after, with the release date when published and ahead", async () => {
      expect(
        (await milestones(noon(31), { [testDate]: releaseDate })).day_after,
      ).toBe(1);
      expect(await events(s.id, "sat_day_after")).toEqual([
        { first_name: "Ana", test_date: testDate, release_date: releaseDate },
      ]);
    });

    it("T3: release day: once, and only when College Board published a date", async () => {
      expect((await milestones(noon(43), {})).scores_released).toBe(0);
      expect(
        (await milestones(noon(43), { [testDate]: releaseDate }))
          .scores_released,
      ).toBe(1);
      expect(
        (await milestones(noon(44), { [testDate]: releaseDate }))
          .scores_released,
      ).toBe(0);
      expect(await events(s.id, "sat_scores_released")).toEqual([
        { first_name: "Ana", test_date: testDate, release_date: releaseDate },
      ]);
    });
  });

  describe("D: the dispatcher asks the gate at send time", () => {
    function transport(sent: EmailSendInput[]) {
      return async (input: EmailSendInput) => {
        sent.push(input);
        return {
          ok: true as const,
          value: { providerMessageId: `re_d${sent.length}`, scheduledAt: null },
        };
      };
    }
    /** 17:00 UTC on day n: inside the 08:00–21:00 Chicago sending window. */
    const sendTime = (n: number): Date => {
      const d = day(n);
      d.setUTCHours(17, 0, 0, 0);
      return d;
    };
    async function emit(
      id: string,
      kind: string,
      payload: unknown,
    ): Promise<string> {
      const r = await pg.query<{ id: string }>(
        `WITH e AS (SELECT gen_random_uuid() AS id)
         SELECT e.id::text AS id, public.emit_notification_event(e.id, $2, $1::uuid,
           jsonb_build_array(jsonb_build_object('profile_id', $1::uuid, 'channels', jsonb_build_array('email'))),
           $3::jsonb) FROM e`,
        [id, kind, JSON.stringify(payload)],
      );
      return r.rows[0]!.id;
    }

    it("D1: a governed email to a paused student is refused and never retried; a milestone still goes, tracked", async () => {
      const s = await pausedStudent();
      const { dispatchQueuedMessages } =
        await import("../../server/lib/notifications/dispatch");
      const sent: EmailSendInput[] = [];
      const governed = await emit(s.id, "missed_plan_alert", {
        student_first_name: "Ana",
        missed_days: 2,
        last_missed_date: iso(day(14)),
        digest_date: iso(day(15)),
      });
      const milestone = await emit(s.id, "sat_week_before", {
        first_name: "Ana",
        test_date: iso(day(22)),
      });
      const g = await dispatchQueuedMessages({
        eventId: governed,
        transport: transport(sent),
        now: sendTime(16),
      });
      expect(g.gated).toBe(1);
      expect(sent).toHaveLength(0);
      const row = await pg.query(
        `SELECT status, last_error FROM public.notification_messages WHERE event_id = $1`,
        [governed],
      );
      expect(row.rows[0]).toEqual({
        status: "failed",
        last_error: "email_gate:paused",
      });
      const m = await dispatchQueuedMessages({
        eventId: milestone,
        transport: transport(sent),
        now: sendTime(16),
      });
      expect(m.sent).toBe(1);
      expect(sent[0]?.sender).toBe("tracked");
      expect(sent[0]?.subject).toBe("SAT: one week to go");
      expect(sent[0]?.text).toContain("Karl, Founder, Lyceon");
    });

    it("D2: the pause note goes untracked with the signed Keep me posted link; withdrawn if the pause ended", async () => {
      const s = await pausedStudent();
      const { dispatchQueuedMessages } =
        await import("../../server/lib/notifications/dispatch");
      const note = await pg.query<{ id: string }>(
        `SELECT event_id::text AS id FROM public.notification_events
          WHERE event_type = 'email_gate_paused_notice' AND subject_profile_id = $1`,
        [s.id],
      );
      const sent: EmailSendInput[] = [];
      await dispatchQueuedMessages({
        eventId: note.rows[0]!.id,
        transport: transport(sent),
        now: sendTime(15),
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.sender).toBe("untracked");
      expect(sent[0]?.subject).toBe("Pausing your SAT reminders");
      expect(sent[0]?.text).toContain(
        "https://lyceon.test/api/public/email/keep-posted?t=",
      );
      // A second student whose pause ended before the note went: withdrawn.
      const woke = await pausedStudent();
      await h.answer(woke.id, 1, day(15.2));
      await refresh(woke.id, day(15.3));
      const wokeNote = await pg.query<{ id: string }>(
        `SELECT event_id::text AS id FROM public.notification_events
          WHERE event_type = 'email_gate_paused_notice' AND subject_profile_id = $1`,
        [woke.id],
      );
      await dispatchQueuedMessages({
        eventId: wokeNote.rows[0]!.id,
        transport: transport(sent),
        now: sendTime(16),
      });
      expect(sent).toHaveLength(1);
    });
  });

  it("L1: the lifecycle rule asks the gate: refused, nothing reaches Resend and the trigger stays pending", async () => {
    const s = await h.person({ completedAt: D0.toISOString() });
    // Cooling (8 days idle) with a campaign email 2 days ago: the cap refuses the reminder.
    await h.asProbe(() =>
      pg.query(
        `SELECT public.record_campaign_send($1, 'x', NULL, $2::timestamptz, 're_lc')`,
        [s.email, day(6).toISOString()],
      ),
    );
    const at = morningAfter(D0, 8);
    const { summary, sent } = await h.runRule(at);
    expect(sent.filter((x) => x.email === s.email)).toEqual([]);
    expect(summary.gated).toBeGreaterThanOrEqual(1);
    expect(await h.state(s.id, "lifecycle_reminder_due")).toBe("pending");
  });
  describe("LP: who moves to paused at launch (Karl, 2026-11-02, revised)", () => {
    const LAUNCH = "2026-09-27";
    async function createdAt(id: string, iso: string): Promise<void> {
      await pg.query(
        `UPDATE public.profiles SET created_at = $2 WHERE id = $1`,
        [id, iso],
      );
    }
    async function reasonOf(id: string): Promise<string | undefined> {
      const r = await pg.query<{ reason: string }>(
        `SELECT reason FROM public.email_gate_state WHERE profile_id = $1`,
        [id],
      );
      return r.rows[0]?.reason;
    }

    it("LP1: last activity before the launch date: paused, no pause note; activity since wakes them", async () => {
      const s = await student();
      await createdAt(s.id, "2026-09-01T12:00:00Z");
      await h.answer(s.id, 1, new Date("2026-09-20T12:00:00Z"));
      expect(await refresh(s.id, day(1))).toBe("paused");
      expect(await reasonOf(s.id)).toBe("pre_launch_inactive");
      expect(await pauseNotes(s.id)).toBe(0);
      expect(await decide(s.id, "review_ask", day(1))).toMatchObject({
        allow: false,
        reason: "paused",
      });
      await h.answer(s.id, 1, day(2));
      expect(await refresh(s.id, day(2.5))).toBe("active");
    });

    it("LP2: signed up before the launch and never active: paused; active since the launch: the normal rules", async () => {
      const never = await student();
      await createdAt(never.id, "2026-09-01T12:00:00Z");
      expect(await refresh(never.id, day(1))).toBe("paused");
      // The launch date is the start of 2026-09-27 in America/Chicago (05:00 UTC).
      const before = await student();
      await createdAt(before.id, "2026-09-01T12:00:00Z");
      await h.answer(before.id, 1, new Date(`${LAUNCH}T04:59:00Z`));
      expect(await refresh(before.id, day(1))).toBe("paused");
      const after = await student();
      await createdAt(after.id, "2026-09-01T12:00:00Z");
      await h.answer(after.id, 1, new Date(`${LAUNCH}T05:01:00Z`));
      expect(await refresh(after.id, day(1))).not.toBe("paused");
      expect(await reasonOf(after.id)).not.toBe("pre_launch_inactive");
      // Signed up after the launch, never active: the normal rules (3 days: active).
      const fresh = await student();
      expect(await refresh(fresh.id, day(3))).toBe("active");
    });

    it("LP3: the backfill moves them now, recorded as backfill, with no pause note; a rerun moves no one", async () => {
      const a = await student();
      const b = await student();
      for (const p of [a, b]) await createdAt(p.id, "2026-09-02T12:00:00Z");
      await h.answer(b.id, 1, new Date("2026-09-10T12:00:00Z"));
      const moved = await h.asProbe(async () => {
        const r = await pg.query<{ n: number }>(
          `SELECT public.email_gate_launch_backfill($1::timestamptz) AS n`,
          [day(3).toISOString()],
        );
        return r.rows[0]!.n;
      });
      expect(moved).toBe(2);
      for (const p of [a, b]) {
        const t = await pg.query(
          `SELECT from_state, to_state, actor, reason FROM public.email_gate_transitions
            WHERE profile_id = $1`,
          [p.id],
        );
        expect(t.rows).toEqual([
          {
            from_state: "active",
            to_state: "paused",
            actor: "backfill",
            reason: "pre_launch_inactive",
          },
        ]);
        expect(await pauseNotes(p.id)).toBe(0);
      }
      const again = await h.asProbe(async () => {
        const r = await pg.query<{ n: number }>(
          `SELECT public.email_gate_launch_backfill($1::timestamptz) AS n`,
          [day(3).toISOString()],
        );
        return r.rows[0]!.n;
      });
      expect(again).toBe(0);
    });

    it("LP4: a guardian quiet since before the launch is paused: no digest, no parent pause email; a sign-in wakes them", async () => {
      const kid = await student();
      const parent = await student({ role: "guardian", dob: null });
      await createdAt(parent.id, "2026-09-01T12:00:00Z");
      await h.entitle(kid.id, D0);
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
         VALUES ($1, $2, 'active', 'student', now(), now())`,
        [parent.id, kid.id],
      );
      await h.answer(kid.id, 1, day(0.5));
      expect(
        await decide(parent.id, "guardian_daily_digest", day(9)),
      ).toMatchObject({
        allow: false,
        reason: "paused",
        state: "paused",
      });
      await h.asProbe(() =>
        pg.query(`SELECT public.email_gate_guardian_refresh($1::timestamptz)`, [
          day(9).toISOString(),
        ]),
      );
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.email_gate_guardian_pauses WHERE guardian_id = $1`,
          [parent.id],
        ),
      ).toBe(0);
      await pg.query(
        `UPDATE auth.users SET last_sign_in_at = $2 WHERE id = $1`,
        [parent.id, day(10).toISOString()],
      );
      expect(
        (await decide(parent.id, "guardian_daily_digest", day(10.5))).allow,
      ).toBe(true);
    });

    it("LP5: internal and test accounts are paused whatever their dates, activity never wakes them, and they get no milestone", async () => {
      await pg.query(
        `UPDATE public.notification_runtime_config
            SET value = '["lyceon.ai", "Karl.Own@Mail.Example"]'::jsonb
          WHERE key = 'email_gate_internal_denylist'`,
      );
      const testLocal = await h.person({
        completedAt: null,
        email: "qa.test1@school.example",
      });
      const staff = await h.person({
        completedAt: null,
        email: "staff@lyceon.ai",
      });
      const sub = await h.person({
        completedAt: null,
        email: "ops@eu.lyceon.ai",
      });
      const own = await h.person({
        completedAt: null,
        email: "karl.own@mail.example",
      });
      const notInternal = await h.person({
        completedAt: null,
        email: "maya@protest.example",
      });
      for (const p of [testLocal, staff, sub, own]) {
        await h.answer(p.id, 1, day(1));
        expect(
          await decide(p.id, "review_ask", day(1.5)),
          p.email,
        ).toMatchObject({
          allow: false,
          reason: "internal_account",
          state: "paused",
        });
        expect((await decide(p.id, "sat_week_before", day(1.5))).reason).toBe(
          "internal_account",
        );
        expect((await decide(p.id, "guardian_linked", day(1.5))).allow).toBe(
          true,
        );
        expect(await pauseNotes(p.id)).toBe(0);
      }
      // "test" in the local part, like the lifecycle lane (isDenylisted); in the domain alone
      // it is not internal.
      await h.answer(notInternal.id, 1, day(1));
      expect((await decide(notInternal.id, "review_ask", day(1.5))).allow).toBe(
        true,
      );
      // No milestone for an internal account with a test date in its window.
      const testDate = iso(day(8));
      await pg.query(
        `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates)
         VALUES ($1, 'UTC', ARRAY[$2::date])`,
        [staff.id, testDate],
      );
      await h.asProbe(() =>
        pg.query(
          `SELECT public.email_milestones_notify($1::timestamptz, '{}'::jsonb)`,
          [day(1.5).toISOString()],
        ),
      );
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.notification_events
            WHERE event_type = 'sat_week_before' AND subject_profile_id = $1`,
          [staff.id],
        ),
      ).toBe(0);
    });
  });
});
