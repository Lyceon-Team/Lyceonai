/**
 * The founding reminder, decided by Lyceon: `lifecycle_claim` over real Postgres, and the real
 * rule (`runLifecycleRule`) on top of it, called as a service_role probe role.
 *
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21) PR 1 tests: "no event before 3 days, none if entitled, none in quiet hours,
 *       never twice, age/deletion/denylist exclusions, grants as service_role"; owner answers the
 *       same day (ledger record, morning Chicago sweep, only new signups);
 *       contracts/notifications.contract.md C14A.4; SCL-239; PR 2 moved the claim into
 *       `lifecycle_claim` (C14A.5, SCL-240) with the reminder's condition unchanged]
 *       | @implemented [2026-10-21]
 *
 * plain English: the shared scenario (tests/ci/lifecycle.pg-harness.ts). Every time is measured
 * from the reminder's cutover (`lifecycle_reminder_since()`), never the wall clock: each student
 * completes onboarding minutes after it, and `p_now` is a morning days later.
 *   R1  nothing before 3 days; due at exactly 3 days
 *   R2  entitled, under 13, unknown age, deleted, deletion pending, a guardian, onboarded before
 *       the cutover: never
 *   R7  never twice (claim, rule, claim again)
 *   R8  denylisted: claimed and kept, never sent
 *   R9  quiet hours: the rule claims and sends nothing
 *   R10 a refused send puts it back to pending; the next morning sends it
 *   R11 the ledger row has no message, so the dispatcher never sees it
 *   R12 grants: anon and authenticated execute nothing; service_role runs claim and release
 *   R13 past day 14: never reminded late
 *   R14 the retention sweep deletes the record (90 days); the student is never reminded again
 *   L1  no address appears in any log line
 * Runs only where PGHOST is set; named by file in CI.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  DAY,
  morningAfter,
  nightAfter,
  setupLifecycleDb,
  yearsAgo,
  type LifecycleDb,
} from "./lifecycle.pg-harness";

const logged = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]) => {
    logged.push(args);
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

const REMINDER = "lifecycle_reminder_due" as const;
let db: LifecycleDb;
const morning = (days = 4): Date => morningAfter(db.REMINDER_SINCE, days);

/** The students the claim picked for the reminder. */
async function claimed(at: Date): Promise<string[]> {
  return (await db.claim(at))
    .filter(([, type]) => type === REMINDER)
    .map(([id]) => id);
}

describe.skipIf(!PG_AVAILABLE)("founding reminder → real PG", () => {
  beforeAll(async () => {
    db = await setupLifecycleDb("lifecycle_reminder_ci", "1c000000");
  }, 300_000);

  afterAll(async () => {
    await db?.pg.end();
  });

  it("R1 nothing before 3 days; due at exactly 3 days", async () => {
    await db.clear();
    const at = new Date(db.REMINDER_SINCE.getTime() + 60_000);
    const { id } = await db.person({ completedAt: at.toISOString() });
    const threeDays = new Date(at.getTime() + 3 * DAY);
    expect(await claimed(new Date(threeDays.getTime() - 60_000))).toEqual([]);
    expect(await db.state(id, REMINDER)).toBeNull();
    expect(await claimed(threeDays)).toEqual([id]);
    expect(await db.state(id, REMINDER)).toBe("sent");
  });

  it("R2–R6 entitled, under 13, unknown age, deleted, deletion pending, a guardian, onboarded before the cutover: never", async () => {
    await db.clear();
    const due = await db.person();
    const entitled = await db.person();
    await db.entitle(entitled.id, db.REMINDER_SINCE);
    const child = await db.person({ dob: yearsAgo(11) });
    const unknownAge = await db.person({ dob: null });
    const deleted = await db.person();
    await db.pg.query(
      `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
      [deleted.id],
    );
    const pending = await db.person();
    await db.pg.query(
      `INSERT INTO public.account_deletion_requests (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
       VALUES ($1, now() + interval '30 days', $1, 'pending')`,
      [pending.id],
    );
    // An adult guardian, so only the role keeps it out (an unknown age would hide the rule).
    const guardian = await db.person({ role: "guardian", dob: yearsAgo(40) });
    const beforeCutover = await db.person({
      completedAt: new Date(db.REMINDER_SINCE.getTime() - 1000).toISOString(),
    });
    expect(await claimed(morning())).toEqual([due.id]); // presence first
    for (const p of [
      entitled,
      child,
      unknownAge,
      deleted,
      pending,
      guardian,
      beforeCutover,
    ]) {
      expect(await db.state(p.id, REMINDER), p.id).toBeNull();
    }
  });

  it("R7 never twice: the rule sends once, a second morning and a second claim find nothing", async () => {
    await db.clear();
    const { id, email } = await db.person();
    const first = await db.runRule(morning());
    expect(first.sent).toEqual([
      { event: "lyceon.reminder_due", email, payload: {} },
    ]);
    expect(first.summary).toMatchObject({ ran: true, claimed: 1, sent: 1 });
    expect((await db.runRule(morning(8))).sent).toEqual([]);
    expect(await claimed(morning(9))).toEqual([]);
    expect(await db.state(id, REMINDER)).toBe("sent");
  });

  it("R8 denylisted (a listed domain, a 'test' address): claimed and kept, never sent", async () => {
    await db.clear();
    const listed = await db.person({ email: "kid@lyceon.ai" });
    const tester = await db.person({ email: "qa.tester@school.example" });
    const run = await db.runRule(morning(), { denylist: "lyceon.ai" });
    expect(run.summary).toMatchObject({ claimed: 2, skipped: 2, sent: 0 });
    expect(run.sent).toEqual([]);
    expect(await db.state(listed.id, REMINDER)).toBe("sent");
    expect(await db.state(tester.id, REMINDER)).toBe("sent");
    expect((await db.runRule(morning(8))).sent).toEqual([]);
  });

  it("R9 quiet hours: the rule claims and sends nothing; the morning run does", async () => {
    await db.clear();
    const { id } = await db.person();
    const quiet = await db.runRule(nightAfter(db.REMINDER_SINCE, 4));
    expect(quiet.summary).toMatchObject({ ran: false, claimed: 0 });
    expect(quiet.sent).toEqual([]);
    expect(await db.state(id, REMINDER)).toBeNull();
    expect((await db.runRule(morning())).sent).toHaveLength(1);
  });

  it("R10 a refused send releases the claim; the next morning sends it", async () => {
    await db.clear();
    const { id } = await db.person();
    const refused = await db.runRule(morning(), { refuse: true });
    expect(refused.summary).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(await db.state(id, REMINDER)).toBe("pending");
    const retry = await db.runRule(morning(5));
    expect(retry.sent).toHaveLength(1);
    expect(await db.state(id, REMINDER)).toBe("sent");
  });

  it("R11 the ledger row has no message and the dispatch queue never returns it", async () => {
    await db.clear();
    const { id } = await db.person();
    expect(await claimed(morning())).toEqual([id]);
    const msgs = await db.pg.query(
      `SELECT count(*)::int AS n FROM public.notification_messages m
         JOIN public.notification_events e ON e.event_id = m.event_id
        WHERE e.event_type LIKE 'lifecycle\\_%'`,
    );
    expect(msgs.rows[0]?.n).toBe(0);
    const queue = await db.pg.query(
      `SELECT count(*)::int AS n
         FROM public.notification_dispatch_queue(now() + interval '30 days', 1000, 5, NULL, $1)`,
      [REMINDER],
    );
    expect(queue.rows[0]?.n).toBe(0);
  });

  it("R12 grants: anon and authenticated execute nothing; service_role runs claim and release", async () => {
    const fns = [
      "lifecycle_reminder_since()",
      "lifecycle_triggers_since()",
      "lifecycle_due(text, uuid, timestamptz)",
      "lifecycle_claim(timestamptz, integer)",
      "lifecycle_release(uuid, text)",
    ];
    const rows = await db.pg.query(
      `SELECT has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE') AS authd,
              has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') AS svc
         FROM unnest($1::text[]) AS f`,
      [fns],
    );
    expect(rows.rows).toEqual(
      fns.map(() => ({ anon: false, authd: false, svc: true })),
    );
    await db.clear();
    const { id } = await db.person();
    expect(await claimed(morning())).toEqual([id]);
    const released = await db.asProbe(async () => {
      const r = await db.pg.query<{ ok: boolean }>(
        `SELECT public.lifecycle_release($1, $2) AS ok`,
        [id, REMINDER],
      );
      return r.rows[0]?.ok;
    });
    expect(released).toBe(true);
    expect(await db.state(id, REMINDER)).toBe("pending");
  });

  it("R13 due only on days 3 to 14: past day 14 a student is never reminded late", async () => {
    await db.clear();
    const at = new Date(db.REMINDER_SINCE.getTime() + 60_000);
    const { id } = await db.person({ completedAt: at.toISOString() });
    const day = (d: number) => new Date(at.getTime() + d * DAY);
    expect(await claimed(day(14))).toEqual([]);
    expect(await claimed(new Date(day(14).getTime() - 60_000))).toEqual([id]);
  });

  it("R14 the retention sweep deletes the record; the student is never reminded again", async () => {
    await db.clear();
    const retention = await db.pg.query<{ d: number }>(
      `SELECT public.notification_retention_days() AS d`,
    );
    // The bound only holds while the window is shorter than retention.
    expect(retention.rows[0]?.d).toBeGreaterThan(14);
    const { id } = await db.person();
    expect((await db.runRule(morning())).sent).toHaveLength(1);
    await db.pg.query(
      `UPDATE public.notification_events SET created_at = now() - interval '91 days'
        WHERE event_type = $2 AND subject_profile_id = $1`,
      [id, REMINDER],
    );
    await db.asProbe(() =>
      db.pg.query(`SELECT * FROM public.sweep_notification_retention(1000)`),
    );
    expect(await db.state(id, REMINDER)).toBeNull(); // the sweep's effect
    // The sweep can only take a record 90+ days after it was written, so every real re-run is
    // that late: the student is long past day 14.
    for (const days of [95, 120, 400]) {
      expect((await db.runRule(morning(days))).sent, String(days)).toEqual([]);
    }
  });

  it("L1 no address appears in any log line", async () => {
    await db.clear();
    await db.person({ email: "maria.santos@school.example" });
    await db.person({ email: "zed.skipped@lyceon.ai" }); // the skipped path logs too
    logged.length = 0;
    await db.runRule(morning(), { denylist: "lyceon.ai" });
    await db.runRule(morning(8), { refuse: true });
    const text = JSON.stringify(logged);
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toContain("maria.santos");
    expect(text).not.toContain("zed.skipped");
    expect(text).not.toContain("@school.example");
  });
});
