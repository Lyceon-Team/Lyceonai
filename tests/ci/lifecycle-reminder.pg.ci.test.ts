/**
 * The founding reminder, decided by Lyceon: `lifecycle_reminder_claim` over real Postgres, and the
 * real rule (`runLifecycleReminderRule`) on top of it, called as a service_role probe role.
 *
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21) PR 1 tests: "no event before 3 days, none if entitled, none in quiet hours,
 *       never twice, age/deletion/denylist exclusions, grants as service_role"; owner answers the
 *       same day (ledger record, morning Chicago sweep, only new signups);
 *       contracts/notifications.contract.md C14A.4; SCL-239] | @implemented [2026-10-21]
 *
 * plain English: the whole migration pipeline, then direct calls. Substituted: Resend (a recorder
 * behind the ContactsTransport type) and the profile reads (plain SQL). The claim and the release
 * run through the probe role, which holds exactly service_role's grants plus BYPASSRLS (as
 * Supabase's service_role has) — the #1248 lesson. Every time is measured from the cutover
 * (`lifecycle_reminder_since()`), never the wall clock: each student completes onboarding minutes
 * after it, and `p_now` is a morning days later.
 *   R1  nothing before 3 days; due at exactly 3 days
 *   R2  entitled: never
 *   R3  under 13, unknown age: never
 *   R4  deleted, deletion pending: never
 *   R5  a guardian: never (the reminder is per student)
 *   R6  onboarded before the cutover: never (the old Automation still reminds them)
 *   R7  never twice (claim, rule, claim again)
 *   R8  denylisted: claimed and kept, never sent
 *   R9  quiet hours: the rule claims nothing
 *   R10 a refused send releases the claim; the next morning sends it
 *   R11 the ledger row has no message, so the dispatcher never sees it
 *   R12 grants: anon and authenticated execute nothing; service_role runs claim and release
 * Runs only where PGHOST is set; named by file in CI.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const logged = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]) => {
    logged.push(args);
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

const DB_NAME = "lifecycle_reminder_ci";
const PROBE_ROLE = "lc_service_role_probe";
let pg: Client;
let n = 0;
/** lifecycle_reminder_since(), read once. */
let SINCE: Date;

const yearsAgo = (years: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

/** The cutover's day + N at 15:00 UTC: 09:00–10:00 Chicago, inside the window, ≥ 3 days on. */
function morning(daysAhead = 4): Date {
  const d = new Date(SINCE);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}

/** 03:00 Chicago on the same day: quiet hours. */
function night(daysAhead = 4): Date {
  const d = morning(daysAhead);
  d.setUTCHours(8, 0, 0, 0);
  return d;
}

type Person = {
  role?: "student" | "guardian";
  dob?: string | null;
  completedAt?: string | null;
  email?: string;
};

async function person(p: Person = {}): Promise<string> {
  n += 1;
  const id = `1c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const email = p.email ?? `student${n}@school.example`;
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, email],
  );
  await pg.query(
    `INSERT INTO public.profiles
       (id, email, role, display_name, date_of_birth, profile_completed_at)
     VALUES ($1, $2, $3, 'Ana Lopez', $4::date, $5::timestamptz)`,
    [
      id,
      email,
      p.role ?? "student",
      p.dob === undefined ? yearsAgo(15) : p.dob,
      // Minutes after the cutover, unless the case says otherwise.
      p.completedAt ?? new Date(SINCE.getTime() + n * 60_000).toISOString(),
    ],
  );
  return id;
}

async function asProbe<T>(fn: () => Promise<T>): Promise<T> {
  await pg.query(`SET ROLE ${PROBE_ROLE}`);
  try {
    return await fn();
  } finally {
    await pg.query("RESET ROLE");
  }
}

async function claim(at: Date): Promise<string[]> {
  return asProbe(async () => {
    const r = await pg.query<{ id: string }>(
      `SELECT public.lifecycle_reminder_claim($1::timestamptz, 500) AS id`,
      [at.toISOString()],
    );
    return r.rows.map((row) => row.id);
  });
}

async function recorded(id: string): Promise<number> {
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.notification_events
      WHERE event_type = 'lifecycle_reminder_due' AND subject_profile_id = $1`,
    [id],
  );
  return r.rows[0]?.n ?? 0;
}

/** The real rule over the real claim, with a recording Resend. */
async function runRule(
  at: Date,
  opts: { refuse?: boolean; denylist?: string } = {},
): Promise<{
  summary: Awaited<
    ReturnType<
      typeof import("../../server/lib/lifecycle-email").runLifecycleReminderRule
    >
  >;
  sent: { event: string; email: string; payload: Record<string, string> }[];
}> {
  const { runLifecycleReminderRule } =
    await import("../../server/lib/lifecycle-email");
  const sent: {
    event: string;
    email: string;
    payload: Record<string, string>;
  }[] = [];
  const contacts = {
    sendEvent: async (
      event: string,
      email: string,
      payload: Record<string, string>,
    ) => {
      if (opts.refuse) {
        return {
          ok: false as const,
          error: { kind: "http" as const, status: 500 },
        };
      }
      sent.push({ event, email, payload });
      return { ok: true as const, value: true as const };
    },
  };
  const summary = await runLifecycleReminderRule(at, {
    contacts: contacts as never,
    loadProfile: async (id: string) => {
      const r = await pg.query(
        `SELECT id, email, role, display_name, date_of_birth::text, deleted_at::text
           FROM public.profiles WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    hasPendingDeletion: async (id: string) => {
      const r = await pg.query(
        `SELECT 1 FROM public.account_deletion_requests
          WHERE profile_id = $1 AND status = 'pending'`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    },
    env: {
      LIFECYCLE_EMAIL_DENYLIST: opts.denylist ?? "",
    } as NodeJS.ProcessEnv,
    now: () => at,
    claimDue: async (now: Date, limit: number) =>
      asProbe(async () => {
        const r = await pg.query<{ id: string }>(
          `SELECT public.lifecycle_reminder_claim($1::timestamptz, $2) AS id`,
          [now.toISOString(), limit],
        );
        return r.rows.map((row) => row.id);
      }),
    release: async (id: string) =>
      asProbe(async () => {
        const r = await pg.query<{ ok: boolean }>(
          `SELECT public.lifecycle_reminder_release($1) AS ok`,
          [id],
        );
        return r.rows[0]?.ok === true;
      }),
  });
  return { summary, sent };
}

/** Each case starts from a clean ledger of reminders, so other cases' students do not interfere. */
async function clearReminders(): Promise<void> {
  await pg.query(
    `UPDATE public.profiles SET profile_completed_at = NULL
      WHERE id::text LIKE '1c000000-%'`,
  );
  await pg.query(
    `DELETE FROM public.notification_events WHERE event_type = 'lifecycle_reminder_due'`,
  );
}

describe.skipIf(!PG_AVAILABLE)("founding reminder → real PG", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    const since = await pg.query<{ t: Date }>(
      `SELECT public.lifecycle_reminder_since() AS t`,
    );
    SINCE = new Date(since.rows[0]!.t);
    await pg.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
          CREATE ROLE ${PROBE_ROLE} NOLOGIN BYPASSRLS INHERIT;
        END IF;
      END $$;
      GRANT service_role TO ${PROBE_ROLE};
    `);
  }, 300_000);

  afterAll(async () => {
    await pg?.end();
  });

  it("R1 nothing before 3 days; due at exactly 3 days", async () => {
    await clearReminders();
    const at = new Date(SINCE.getTime() + 60_000);
    const id = await person({ completedAt: at.toISOString() });
    const threeDays = new Date(at.getTime() + 3 * 86_400_000);
    expect(await claim(new Date(threeDays.getTime() - 60_000))).toEqual([]);
    expect(await recorded(id)).toBe(0);
    expect(await claim(threeDays)).toEqual([id]);
    expect(await recorded(id)).toBe(1);
  });

  it("R2–R6 entitled, under 13, unknown age, deleted, deletion pending, a guardian, onboarded before the cutover: never", async () => {
    await clearReminders();
    const due = await person();
    const entitled = await person();
    await pg.query(
      `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
      [entitled],
    );
    const child = await person({ dob: yearsAgo(11) });
    const unknownAge = await person({ dob: null });
    const deleted = await person();
    await pg.query(
      `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
      [deleted],
    );
    const pending = await person();
    await pg.query(
      `INSERT INTO public.account_deletion_requests (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
       VALUES ($1, now() + interval '30 days', $1, 'pending')`,
      [pending],
    );
    // An adult guardian, so only the role keeps it out (an unknown age would hide the rule).
    const guardian = await person({ role: "guardian", dob: yearsAgo(40) });
    const beforeCutover = await person();
    await pg.query(
      `UPDATE public.profiles
          SET profile_completed_at = public.lifecycle_reminder_since() - interval '1 second'
        WHERE id = $1`,
      [beforeCutover],
    );
    const claimed = await claim(morning());
    expect(claimed).toEqual([due]); // presence first: the plain case is claimed
    for (const id of [
      entitled,
      child,
      unknownAge,
      deleted,
      pending,
      guardian,
      beforeCutover,
    ]) {
      expect(await recorded(id), id).toBe(0);
    }
  });

  it("R7 never twice: the rule sends once, a second morning and a second claim find nothing", async () => {
    await clearReminders();
    const id = await person();
    const first = await runRule(morning());
    expect(first.sent).toEqual([
      {
        event: "lyceon.reminder_due",
        email: `student${n}@school.example`,
        payload: {},
      },
    ]);
    expect(first.summary).toMatchObject({ ran: true, claimed: 1, sent: 1 });
    const second = await runRule(morning(5));
    expect(second.sent).toEqual([]);
    expect(await claim(morning(6))).toEqual([]);
    expect(await recorded(id)).toBe(1);
  });

  it("R8 denylisted (a listed domain, a 'test' address): claimed and kept, never sent", async () => {
    await clearReminders();
    const listed = await person({ email: "kid@lyceon.ai" });
    const tester = await person({ email: "qa.tester@school.example" });
    const run = await runRule(morning(), { denylist: "lyceon.ai" });
    expect(run.summary).toMatchObject({ claimed: 2, skipped: 2, sent: 0 });
    expect(run.sent).toEqual([]);
    expect(await recorded(listed)).toBe(1);
    expect(await recorded(tester)).toBe(1);
    expect((await runRule(morning(5))).sent).toEqual([]);
  });

  it("R9 quiet hours: the rule claims and sends nothing; the morning run does", async () => {
    await clearReminders();
    const id = await person();
    const quiet = await runRule(night());
    expect(quiet.summary).toMatchObject({ ran: false, claimed: 0 });
    expect(quiet.sent).toEqual([]);
    expect(await recorded(id)).toBe(0);
    expect((await runRule(morning())).sent).toHaveLength(1);
  });

  it("R10 a refused send releases the claim; the next morning sends it", async () => {
    await clearReminders();
    const id = await person();
    const refused = await runRule(morning(), { refuse: true });
    expect(refused.summary).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(await recorded(id)).toBe(0);
    const retry = await runRule(morning(5));
    expect(retry.sent).toHaveLength(1);
    expect(await recorded(id)).toBe(1);
  });

  it("R11 the ledger row has no message and the dispatch queue never returns it", async () => {
    await clearReminders();
    const id = await person();
    expect(await claim(morning())).toEqual([id]);
    const msgs = await pg.query(
      `SELECT count(*)::int AS n FROM public.notification_messages m
         JOIN public.notification_events e ON e.event_id = m.event_id
        WHERE e.event_type = 'lifecycle_reminder_due'`,
    );
    expect(msgs.rows[0]?.n).toBe(0);
    const queue = await pg.query(
      `SELECT count(*)::int AS n
         FROM public.notification_dispatch_queue(now() + interval '30 days', 1000, 5, NULL, 'lifecycle_reminder_due')`,
    );
    expect(queue.rows[0]?.n).toBe(0);
    const payload = await pg.query(
      `SELECT payload FROM public.notification_events
        WHERE event_type = 'lifecycle_reminder_due' AND subject_profile_id = $1`,
      [id],
    );
    expect(payload.rows).toEqual([{ payload: {} }]);
  });

  it("R12 grants: anon and authenticated execute nothing; service_role runs claim and release", async () => {
    const fns = [
      "lifecycle_reminder_since()",
      "lifecycle_reminder_claim(timestamptz, integer)",
      "lifecycle_reminder_release(uuid)",
    ];
    const rows = await pg.query(
      `SELECT has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE') AS authd,
              has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') AS svc
         FROM unnest($1::text[]) AS f`,
      [fns],
    );
    expect(rows.rows).toEqual(
      fns.map(() => ({ anon: false, authd: false, svc: true })),
    );
    await clearReminders();
    const id = await person();
    expect(await claim(morning())).toEqual([id]);
    const released = await asProbe(async () => {
      const r = await pg.query<{ ok: boolean }>(
        `SELECT public.lifecycle_reminder_release($1) AS ok`,
        [id],
      );
      return r.rows[0]?.ok;
    });
    expect(released).toBe(true);
    expect(await recorded(id)).toBe(0);
  });

  it("L1 no address appears in any log line", async () => {
    await clearReminders();
    await person({ email: "maria.santos@school.example" });
    logged.length = 0;
    await runRule(morning());
    await runRule(morning(5), { refuse: true });
    const text = JSON.stringify(logged);
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toContain("maria.santos");
    expect(text).not.toContain("@school.example");
  });
});
