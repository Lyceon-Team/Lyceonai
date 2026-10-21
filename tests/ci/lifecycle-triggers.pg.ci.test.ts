/**
 * The behaviour triggers on real Postgres: each condition at its exact threshold, once ever, the
 * one-per-3-days cap across every lifecycle email, the priority order, the self-cancel at send
 * time, quiet hours and the exclusions.
 *
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21) PR 2 tests: "each trigger fires only on its exact condition and threshold;
 *       never twice; the cap holds across all lifecycle emails; the priority order; self-cancel
 *       at send time; quiet hours; exclusions; grants"; owner answers the same day ("Pro since" =
 *       entitlements.created_at; the diagnostic counts toward the 10; only after launch; 14-day
 *       windows); contracts/notifications.contract.md C14A.5; SCL-240] | @implemented [2026-10-21]
 *
 * plain English: the shared scenario (tests/ci/lifecycle.pg-harness.ts), times measured from
 * the triggers' cutover T (`lifecycle_triggers_since()`, the same instant as the reminder's).
 * Students here completed onboarding long before it, so the founding reminder stays out of every
 * case except the ones about the cap and the priority order. Grants are covered by the reminder suite's R12 (the
 * same functions).
 *   D1 diagnostic: due exactly 48 h after it started; not before
 *   D2 diagnostic: completed or abandoned, started before T, or older than 14 days: never
 *   P1 Pro: due exactly 48 h after the entitlement; past_due counts
 *   P2 Pro: a plan, a cancelled entitlement, or entitled before T: never
 *   F1 practising: the 10th answered item makes it due; the diagnostic counts, QOTD does not
 *   F2 practising: 9 items, entitled, or the 10th before T: never
 *   N1 never twice: still true weeks later, nothing more
 *   C1 the cap: one lifecycle email per 3 days, across every trigger and the reminder
 *   O1 the priority order: reminder, diagnostic, Pro, practising (Pro and practising are never
 *      due together: one needs an entitlement, the other none)
 *   S1 self-cancel: a waiting trigger the student has since acted on is resolved, never sent
 *   Q1 outside the two send slots: nothing claimed or sent
 *   T1 both cutovers are 2026-10-21 08:00 UTC (owner rulings on #1284)
 *   X1 exclusions: under 13, unknown age, deleted, deletion pending, a guardian, denylisted
 *   E1 each trigger reaches Resend as its own event, with an empty payload
 *   L2 PR 1's reminder rows (payload {}) count toward the cap and are never re-sent
 *   K1 the sweep never blocks a student's own writes (FK checks on profiles)
 *   W1 the retention sweep deletes a sent row; no trigger ever fires again
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
  type Person,
  type Trigger,
} from "./lifecycle.pg-harness";

vi.mock("../../server/logger", () => {
  const record = (): void => undefined;
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

const DIAG: Trigger = "lifecycle_diagnostic_unfinished";
const PRO: Trigger = "lifecycle_pro_no_plan";
const FREE: Trigger = "lifecycle_practising_free";
const REMINDER: Trigger = "lifecycle_reminder_due";
const HOUR = 3_600_000;

let db: LifecycleDb;
let T: Date;

/** A student out of the reminder's reach (onboarded long before its cutover). */
async function student(p: Person = {}): Promise<{ id: string; email: string }> {
  return db.person({
    completedAt: new Date(db.REMINDER_SINCE.getTime() - 60 * DAY).toISOString(),
    ...p,
  });
}

const at = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

describe.skipIf(!PG_AVAILABLE)("lifecycle behaviour triggers → real PG", () => {
  beforeAll(async () => {
    db = await setupLifecycleDb("lifecycle_triggers_ci", "1d000000");
    T = db.TRIGGERS_SINCE;
  }, 300_000);

  afterAll(async () => {
    await db?.pg.end();
  });

  it("D1 diagnostic: due exactly 48 h after it started; not before", async () => {
    await db.clear();
    const { id } = await student();
    const started = at(T, HOUR);
    await db.session(id, "diagnostic", started);
    expect(await db.claim(at(started, 48 * HOUR - 60_000))).toEqual([]);
    expect(await db.state(id, DIAG)).toBeNull();
    expect(await db.claim(at(started, 48 * HOUR))).toEqual([[id, DIAG]]);
    expect(await db.state(id, DIAG)).toBe("sent");
    // 'created' is in flight too (a session row before its first item).
    await db.clear();
    const created = await student();
    await db.session(created.id, "diagnostic", started, "created");
    expect(await db.claim(at(started, 48 * HOUR))).toEqual([
      [created.id, DIAG],
    ]);
  });

  it("D2 diagnostic: completed, abandoned, started before T, or older than 14 days: never", async () => {
    await db.clear();
    const due = await student();
    await db.session(due.id, "diagnostic", at(T, HOUR));
    const completed = await student();
    await db.session(completed.id, "diagnostic", at(T, HOUR), "completed");
    const abandoned = await student();
    await db.session(abandoned.id, "diagnostic", at(T, HOUR), "abandoned");
    const early = await student();
    await db.session(early.id, "diagnostic", at(T, -HOUR));
    expect(await db.claim(at(T, 3 * DAY))).toEqual([[due.id, DIAG]]);
    for (const p of [completed, abandoned, early]) {
      expect(await db.state(p.id, DIAG), p.id).toBeNull();
    }
    // The window: started at T+1h, so it stops being due 14 days later.
    await db.clear();
    const late = await student();
    await db.session(late.id, "diagnostic", at(T, HOUR));
    expect(await db.claim(at(T, HOUR + 14 * DAY))).toEqual([]);
    expect(await db.claim(at(T, HOUR + 14 * DAY - 60_000))).toEqual([
      [late.id, DIAG],
    ]);
  });

  it("P1 Pro: due exactly 48 h after the entitlement; past_due counts", async () => {
    await db.clear();
    const { id } = await student();
    const since = at(T, HOUR);
    await db.entitle(id, since);
    expect(await db.claim(at(since, 48 * HOUR - 60_000))).toEqual([]);
    expect(await db.claim(at(since, 48 * HOUR))).toEqual([[id, PRO]]);
    await db.clear();
    const pastDue = await student();
    await db.entitle(pastDue.id, since, "past_due");
    expect(await db.claim(at(since, 3 * DAY))).toEqual([[pastDue.id, PRO]]);
  });

  it("P2 Pro: a plan, a cancelled entitlement, or entitled before T: never", async () => {
    await db.clear();
    const due = await student();
    await db.entitle(due.id, at(T, HOUR));
    const planned = await student();
    await db.entitle(planned.id, at(T, HOUR));
    await db.plan(planned.id);
    const cancelled = await student();
    await db.entitle(cancelled.id, at(T, HOUR), "canceled");
    const early = await student();
    await db.entitle(early.id, at(T, -HOUR));
    expect(await db.claim(at(T, 3 * DAY))).toEqual([[due.id, PRO]]);
    for (const p of [planned, cancelled, early]) {
      expect(await db.state(p.id, PRO), p.id).toBeNull();
    }
  });

  it("F1 practising: the 10th answered item makes it due; the diagnostic counts, QOTD does not", async () => {
    await db.clear();
    const ten = await student();
    const tenth = at(T, 2 * DAY);
    await db.answer(ten.id, 10, tenth);
    expect(await db.claim(at(tenth, -60_000))).toEqual([]); // only 9 by then
    expect(await db.claim(tenth)).toEqual([[ten.id, FREE]]);

    await db.clear();
    const withDiagnostic = await student();
    await db.answer(withDiagnostic.id, 9, at(T, DAY));
    await db.answer(withDiagnostic.id, 1, at(T, 2 * DAY), "diagnostic");
    const withQotd = await student();
    await db.answer(withQotd.id, 9, at(T, DAY));
    await db.answer(withQotd.id, 1, at(T, 2 * DAY), "qotd");
    expect(await db.claim(at(T, 3 * DAY))).toEqual([[withDiagnostic.id, FREE]]);
    expect(await db.state(withQotd.id, FREE)).toBeNull();
  });

  it("F3 practising: items with only occurred_at (answered_at unset) still count, and still window", async () => {
    await db.clear();
    const { id } = await student();
    await db.answer(id, 10, at(T, 2 * DAY), "structured", true);
    expect(await db.claim(at(T, 2 * DAY + 60_000))).toEqual([[id, FREE]]);
    await db.clear();
    const old = await student();
    await db.answer(old.id, 10, at(T, 2 * DAY), "structured", true);
    expect(await db.claim(at(T, 16 * DAY + 60_000))).toEqual([]);
  });

  it("F2 practising: 9 items, entitled, or the 10th before T: never", async () => {
    await db.clear();
    const due = await student();
    await db.answer(due.id, 10, at(T, DAY));
    const nine = await student();
    await db.answer(nine.id, 9, at(T, DAY));
    const entitled = await student();
    await db.answer(entitled.id, 10, at(T, DAY));
    await db.entitle(entitled.id, at(T, -30 * DAY));
    const early = await student();
    await db.answer(early.id, 10, at(T, -HOUR));
    expect(await db.claim(at(T, 2 * DAY))).toEqual([[due.id, FREE]]);
    for (const p of [nine, entitled, early]) {
      expect(await db.state(p.id, FREE), p.id).toBeNull();
    }
  });

  it("N1 never twice: still true weeks later, nothing more", async () => {
    await db.clear();
    const { id } = await student();
    await db.session(id, "diagnostic", at(T, HOUR));
    expect(await db.claim(at(T, 3 * DAY))).toEqual([[id, DIAG]]);
    for (const d of [4, 7, 10, 13]) {
      expect(await db.claim(at(T, d * DAY)), String(d)).toEqual([]);
    }
    expect(await db.state(id, DIAG)).toBe("sent");
  });

  it("C1 the cap: one lifecycle email per 3 days, across every trigger and the reminder", async () => {
    await db.clear();
    // Onboarded just after the cutover, and a diagnostic started two days later: on the 4th
    // day's slot both the reminder and the diagnostic nudge are due.
    const { id } = await db.person({ completedAt: at(T, HOUR).toISOString() });
    await db.session(id, "diagnostic", at(T, 2 * DAY));
    const m0 = morningAfter(T, 4);
    expect(await db.claim(m0)).toEqual([[id, REMINDER]]);
    expect(await db.state(id, DIAG)).toBe("pending");
    expect(await db.claim(at(m0, 2 * DAY))).toEqual([]); // the reminder went 2 days ago
    expect(await db.claim(at(m0, 3 * DAY - 60_000))).toEqual([]);
    expect(await db.claim(at(m0, 3 * DAY))).toEqual([[id, DIAG]]); // the cap clears
  });

  it("O1 the priority order: reminder, then diagnostic, then practising; diagnostic before Pro", async () => {
    await db.clear();
    const three = await db.person({ completedAt: at(T, HOUR).toISOString() });
    await db.session(three.id, "diagnostic", at(T, HOUR));
    await db.answer(three.id, 10, at(T, 2 * DAY));
    const m = morningAfter(T, 4); // all three due at once
    expect(await db.claim(m)).toEqual([[three.id, REMINDER]]);
    expect(await db.state(three.id, DIAG)).toBe("pending");
    expect(await db.state(three.id, FREE)).toBe("pending");
    expect(await db.claim(at(m, 3 * DAY))).toEqual([[three.id, DIAG]]);
    expect(await db.claim(at(m, 6 * DAY))).toEqual([[three.id, FREE]]);

    await db.clear();
    // Pro and a diagnostic together (practising needs no entitlement, so it cannot join them).
    const two = await student();
    await db.entitle(two.id, at(T, HOUR));
    await db.session(two.id, "diagnostic", at(T, HOUR));
    const m2 = morningAfter(T, 3);
    expect(await db.claim(m2)).toEqual([[two.id, DIAG]]);
    expect(await db.claim(at(m2, 3 * DAY))).toEqual([[two.id, PRO]]);
  });

  it("S1 self-cancel: a waiting trigger the student has since acted on is resolved, never sent", async () => {
    await db.clear();
    const { id } = await student();
    await db.entitle(id, at(T, HOUR));
    await db.session(id, "diagnostic", at(T, HOUR));
    const m = morningAfter(T, 3);
    expect(await db.claim(m)).toEqual([[id, DIAG]]);
    expect(await db.state(id, PRO)).toBe("pending");
    await db.plan(id); // the student made a plan while Pro was waiting
    expect(await db.claim(at(m, 3 * DAY))).toEqual([]);
    expect(await db.state(id, PRO)).toBe("resolved");
    expect(await db.claim(at(m, 6 * DAY))).toEqual([]); // and never later
  });

  it("Q1 outside a send slot (the old 14:00 sweep): the rule claims and sends nothing; the slot run does", async () => {
    await db.clear();
    const { id } = await student();
    await db.session(id, "diagnostic", at(T, HOUR));
    const quiet = await db.runRule(nightAfter(T, 3));
    expect(quiet.summary).toMatchObject({ ran: false, claimed: 0 });
    expect(await db.state(id, DIAG)).toBeNull();
    expect((await db.runRule(morningAfter(T, 3))).sent).toHaveLength(1);
  });

  it("X1 exclusions: under 13, unknown age, deleted, deletion pending, a guardian, denylisted", async () => {
    await db.clear();
    const due = await student();
    const child = await student({ dob: yearsAgo(11) });
    const unknownAge = await student({ dob: null });
    const deleted = await student();
    const pending = await student();
    const guardian = await student({ role: "guardian", dob: yearsAgo(40) });
    const listed = await student({ email: "kid@lyceon.ai" });
    for (const p of [
      due,
      child,
      unknownAge,
      deleted,
      pending,
      guardian,
      listed,
    ]) {
      await db.session(p.id, "diagnostic", at(T, HOUR));
    }
    await db.pg.query(
      `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
      [deleted.id],
    );
    await db.pg.query(
      `INSERT INTO public.account_deletion_requests (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
       VALUES ($1, now() + interval '30 days', $1, 'pending')`,
      [pending.id],
    );
    const run = await db.runRule(morningAfter(T, 3), { denylist: "lyceon.ai" });
    expect(run.sent).toEqual([
      { event: "lyceon.diagnostic_unfinished", email: due.email, payload: {} },
    ]);
    for (const p of [child, unknownAge, deleted, pending, guardian]) {
      expect(await db.state(p.id, DIAG), p.id).toBeNull();
    }
    expect(await db.state(listed.id, DIAG)).toBe("sent"); // claimed, kept, never sent
  });

  it("E1 each trigger reaches Resend as its own event, with an empty payload", async () => {
    await db.clear();
    const diag = await student();
    await db.session(diag.id, "diagnostic", at(T, HOUR));
    const pro = await student();
    await db.entitle(pro.id, at(T, HOUR));
    const free = await student();
    await db.answer(free.id, 10, at(T, 2 * DAY));
    const run = await db.runRule(morningAfter(T, 3));
    expect(run.sent.map((s) => [s.email, s.event, s.payload]).sort()).toEqual(
      [
        [diag.email, "lyceon.diagnostic_unfinished", {}],
        [pro.email, "lyceon.pro_no_plan", {}],
        [free.email, "lyceon.practising_free", {}],
      ].sort(),
    );
  });

  it("L2 PR 1's reminder rows (payload {}) count toward the cap and are never re-sent", async () => {
    await db.clear();
    // Onboarded so the reminder is still in its window, and reminded by PR 1 two days ago.
    const { id } = await db.person({
      completedAt: at(T, -4 * DAY).toISOString(),
    });
    await db.session(id, "diagnostic", at(T, HOUR));
    const m = morningAfter(T, 3);
    const sentByPr1 = at(m, -2 * DAY);
    await db.legacyReminder(id, sentByPr1);
    expect(await db.claim(m)).toEqual([]); // the cap, from the legacy row
    expect(await db.state(id, DIAG)).toBe("pending");
    expect(await db.claim(at(sentByPr1, 3 * DAY))).toEqual([[id, DIAG]]);
    expect(await db.claim(at(sentByPr1, 6 * DAY))).toEqual([]); // no second reminder
    expect(await db.state(id, REMINDER)).toBe("sent");
  });

  it("K1 the sweep never blocks a student's own writes (FK checks on profiles)", async () => {
    await db.clear();
    const { id } = await student();
    await db.answer(id, 3, at(T, DAY)); // recent activity: a claim candidate, so it is locked
    const other = await db.otherConnection();
    try {
      await db.pg.query("BEGIN");
      await db.claim(at(T, 2 * DAY)); // holds its row locks until COMMIT
      await other.query("SET lock_timeout = '2s'");
      const ins = await other.query<{ id: string }>(
        `INSERT INTO public.practice_sessions
           (user_id, actor_id, mode, target_count, platform, status)
         VALUES ($1, $1, 'structured', 10, 'web', 'active') RETURNING id`,
        [id],
      );
      expect(ins.rows).toHaveLength(1);
      await other.query(`DELETE FROM public.practice_sessions WHERE id = $1`, [
        ins.rows[0]!.id,
      ]);
    } finally {
      await db.pg.query("ROLLBACK");
      await other.end();
    }
  });

  it("W1 the retention sweep deletes a sent row; no trigger ever fires again", async () => {
    await db.clear();
    const diag = await student();
    await db.session(diag.id, "diagnostic", at(T, HOUR));
    const pro = await student();
    await db.entitle(pro.id, at(T, HOUR));
    const free = await student();
    await db.answer(free.id, 10, at(T, 2 * DAY));
    expect((await db.runRule(morningAfter(T, 3))).sent).toHaveLength(3);
    await db.pg.query(
      `UPDATE public.notification_events SET created_at = now() - interval '91 days'
        WHERE event_type LIKE 'lifecycle\\_%'`,
    );
    await db.asProbe(() =>
      db.pg.query(`SELECT * FROM public.sweep_notification_retention(1000)`),
    );
    for (const p of [diag, pro, free]) {
      for (const t of [DIAG, PRO, FREE]) {
        expect(await db.state(p.id, t)).toBeNull(); // the sweep's effect
      }
    }
    // The sweep can only take a row 90+ days after it was written: every window is long shut.
    for (const d of [95, 120, 400]) {
      expect(await db.claim(morningAfter(T, d)), String(d)).toEqual([]);
    }
  });

  it("T1 both cutovers are 2026-10-21 08:00 UTC; a trigger a second before never fires", async () => {
    expect(T.toISOString()).toBe("2026-10-21T08:00:00.000Z");
    expect(db.REMINDER_SINCE.toISOString()).toBe("2026-10-21T08:00:00.000Z");
    await db.clear();
    const after = await student();
    await db.session(after.id, "diagnostic", at(T, 0));
    const before = await student();
    await db.session(before.id, "diagnostic", at(T, -1000));
    expect(await db.claim(morningAfter(T, 3))).toEqual([[after.id, DIAG]]);
    expect(await db.state(before.id, DIAG)).toBeNull();
  });
});
