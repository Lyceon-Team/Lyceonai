/**
 * The one lifecycle-email scenario on real Postgres, shared by the founding reminder's suite and
 * the behaviour triggers' suite (CLAUDE.md, "one scenario, shared": two hand-built fixtures for
 * one resource drift).
 *
 * @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
 *       2026-10-21); contracts/notifications.contract.md C14A.4–C14A.5; SCL-239, SCL-240]
 *       | @implemented [2026-10-21]
 *
 * plain English: the whole migration pipeline, then a probe role holding exactly service_role's
 * grants plus BYPASSRLS (as Supabase's service_role has; the #1248 lesson) for every call the
 * server makes. Fixtures write the real tables the conditions read (profiles, entitlements,
 * practice sessions and items, calendar plan versions and dates). The rule under test is the
 * real `runLifecycleRule` over the real `lifecycle_claim`; only Resend is a recorder. Every time
 * is measured from a cutover (`lifecycle_reminder_since()` / `lifecycle_triggers_since()`),
 * never the wall clock.
 */
import { Client } from "pg";
import { bootstrapPgDatabase, pgConnConfig } from "../helpers/pg-supabase";

export const PROBE_ROLE = "lc_service_role_probe";
export const DAY = 86_400_000;

export type Trigger =
  | "lifecycle_reminder_due"
  | "lifecycle_diagnostic_unfinished"
  | "lifecycle_pro_no_plan"
  | "lifecycle_practising_free";

export type Person = {
  role?: "student" | "guardian";
  dob?: string | null;
  completedAt?: string | null;
  email?: string;
};

export type Sent = {
  event: string;
  email: string;
  payload: Record<string, string>;
};

export const yearsAgo = (years: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

/** `base`'s day + N at 15:00 UTC: 09:00–10:00 Chicago, inside the quiet-hours window. */
export function morningAfter(base: Date, daysAhead: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}

/** 03:00 Chicago on that day: quiet hours. */
export function nightAfter(base: Date, daysAhead: number): Date {
  const d = morningAfter(base, daysAhead);
  d.setUTCHours(8, 0, 0, 0);
  return d;
}

/** One of the ten seeded questions (an answer references the bank). */
const questionId = (k: number): string => `SATM1ALG${String(900 + k)}`;

export type LifecycleDb = Awaited<ReturnType<typeof setupLifecycleDb>>;

export async function setupLifecycleDb(dbName: string, idPrefix: string) {
  const pg: Client = await bootstrapPgDatabase(dbName);
  await pg.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
        CREATE ROLE ${PROBE_ROLE} NOLOGIN BYPASSRLS INHERIT;
      END IF;
    END $$;
    GRANT service_role TO ${PROBE_ROLE};
  `);
  // Ten published questions: answered items reference the bank (practice_session_items FK).
  for (let k = 0; k < 10; k++) {
    await pg.query(
      `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ($1, 'M', 1, 'Algebra', ARRAY['ALG.D01'], 1, 'stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'C', 'e',
         '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
         'published', 'mcq', now())
       ON CONFLICT (id) DO NOTHING`,
      [questionId(k)],
    );
  }
  const cut = await pg.query<{ r: Date; t: Date }>(
    `SELECT public.lifecycle_reminder_since() AS r, public.lifecycle_triggers_since() AS t`,
  );
  const REMINDER_SINCE = new Date(cut.rows[0]!.r);
  const TRIGGERS_SINCE = new Date(cut.rows[0]!.t);
  let n = 0;
  let sessionN = 0;

  async function asProbe<T>(fn: () => Promise<T>): Promise<T> {
    await pg.query(`SET ROLE ${PROBE_ROLE}`);
    try {
      return await fn();
    } finally {
      await pg.query("RESET ROLE");
    }
  }

  /** A student (by default) who completed onboarding minutes after the reminder's cutover. */
  async function person(
    p: Person = {},
  ): Promise<{ id: string; email: string }> {
    n += 1;
    const id = `${idPrefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
        p.completedAt === undefined
          ? new Date(REMINDER_SINCE.getTime() + n * 60_000).toISOString()
          : p.completedAt,
      ],
    );
    return { id, email };
  }

  async function entitle(
    id: string,
    createdAt: Date,
    status = "active",
  ): Promise<void> {
    await pg.query(
      `INSERT INTO public.entitlements (profile_id, tier, status, created_at)
       VALUES ($1, 'premium', $2, $3)
       ON CONFLICT (profile_id) DO UPDATE SET status = EXCLUDED.status`,
      [id, status, createdAt.toISOString()],
    );
  }

  async function session(
    id: string,
    mode: string,
    createdAt: Date,
    status = "active",
  ): Promise<string> {
    sessionN += 1;
    const sid = `5e55${idPrefix.slice(4)}-1111-4000-8000-${String(sessionN).padStart(12, "0")}`;
    await pg.query(
      `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, target_count, platform, status, created_at,
          updated_at, last_activity_at, completed_at, abandoned_at)
       VALUES ($1, $2, $2, $3, 10, 'web', $4, $5, $5, $5,
               CASE WHEN $4 = 'completed' THEN $5::timestamptz END,
               CASE WHEN $4 = 'abandoned' THEN $5::timestamptz END)`,
      [sid, id, mode, status, createdAt.toISOString()],
    );
    return sid;
  }

  /**
   * `count` answered items in a session of `mode`, the last one answered at `lastAt`. With
   * `answeredAtNull`, only `occurred_at` is set (the one column the CHECK guarantees for a
   * resolved item), so a reader that windows on `answered_at` alone would miss them.
   */
  async function answer(
    id: string,
    count: number,
    lastAt: Date,
    mode = "structured",
    answeredAtNull = false,
  ): Promise<void> {
    const sid = await session(
      id,
      mode,
      new Date(lastAt.getTime() - DAY),
      "completed",
    );
    for (let k = 0; k < count; k++) {
      const at = new Date(lastAt.getTime() - (count - 1 - k) * 60_000);
      await pg.query(
        `INSERT INTO public.practice_session_items
           (session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
            question_correct_answer, question_explanation, question_domain, question_skill,
            question_difficulty, question_section, status, occurred_at, answered_at)
         VALUES ($1, $2, $2, $3, $4, 'stem', '[]'::jsonb, 'A', 'e', 'Algebra', 'S', 1, 'M',
                 'answered', $5, CASE WHEN $6 THEN NULL ELSE $5::timestamptz END)`,
        [sid, id, k + 1, questionId(k), at.toISOString(), answeredAtNull],
      );
    }
  }

  /** An accepted plan with one date: the student has a study plan. */
  async function plan(id: string): Promise<void> {
    const v = `7a7a${idPrefix.slice(4)}-2222-4000-8000-${String(n).padStart(12, "0")}`;
    await pg.query(
      `INSERT INTO public.calendar_plan_versions
         (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
          input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
       VALUES ($1, $2, 1, 'v1', 'setup', 'student', '{}'::jsonb, 'h', '{}', 'accepted')`,
      [v, id],
    );
    await pg.query(
      `INSERT INTO public.calendar_plan_dates
         (plan_version_id, student_id, scheduled_date, timezone, is_user_override)
       VALUES ($1, $2, '2026-11-02', 'America/Chicago', false)`,
      [v, id],
    );
  }

  /** A row exactly as PR 1 wrote it (payload `{}`, sent when written). */
  async function legacyReminder(id: string, sentAt: Date): Promise<void> {
    await pg.query(
      `INSERT INTO public.notification_events
         (event_id, event_type, subject_profile_id, payload, created_at)
       VALUES (public.notification_event_id('lifecycle_reminder_due', $1::text),
               'lifecycle_reminder_due', $1::uuid, '{}'::jsonb, $2)`,
      [id, sentAt.toISOString()],
    );
  }

  /** A second connection, as another server request would hold. */
  async function otherConnection(): Promise<Client> {
    const c = new Client(pgConnConfig(dbName));
    await c.connect();
    return c;
  }

  /** lifecycle_claim at `at`, as the probe role: [profile, trigger] pairs. */
  async function claim(at: Date): Promise<[string, Trigger][]> {
    return asProbe(async () => {
      const r = await pg.query<{ profile_id: string; event_type: Trigger }>(
        `SELECT profile_id, event_type FROM public.lifecycle_claim($1::timestamptz, 500)`,
        [at.toISOString()],
      );
      return r.rows.map((row) => [row.profile_id, row.event_type]);
    });
  }

  /** The trigger's state for a student: null (no row), 'pending', 'sent' or 'resolved'. */
  async function state(id: string, type: Trigger): Promise<string | null> {
    const r = await pg.query<{ s: string | null }>(
      `SELECT CASE WHEN payload = '{}'::jsonb THEN 'sent' ELSE payload ->> 'state' END AS s
         FROM public.notification_events
        WHERE event_type = $2 AND subject_profile_id = $1`,
      [id, type],
    );
    return r.rows[0]?.s ?? null;
  }

  /** The real rule over the real claim, with a recording Resend. */
  async function runRule(
    at: Date,
    opts: { refuse?: boolean; denylist?: string } = {},
  ): Promise<{
    summary: Awaited<
      ReturnType<
        typeof import("../../server/lib/lifecycle-email").runLifecycleRule
      >
    >;
    sent: Sent[];
  }> {
    const { runLifecycleRule } =
      await import("../../server/lib/lifecycle-email");
    const sent: Sent[] = [];
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
    const summary = await runLifecycleRule(at, {
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
          const r = await pg.query<{ profile_id: string; event_type: Trigger }>(
            `SELECT profile_id, event_type FROM public.lifecycle_claim($1::timestamptz, $2)`,
            [now.toISOString(), limit],
          );
          return r.rows.map((row) => ({
            profileId: row.profile_id,
            trigger: row.event_type,
          }));
        }),
      release: async (c: { profileId: string; trigger: Trigger }) =>
        asProbe(async () => {
          const r = await pg.query<{ ok: boolean }>(
            `SELECT public.lifecycle_release($1, $2) AS ok`,
            [c.profileId, c.trigger],
          );
          return r.rows[0]?.ok === true;
        }),
    });
    return { summary, sent };
  }

  /** A clean slate between cases: no one is onboarded recently, no lifecycle rows, no activity. */
  async function clear(): Promise<void> {
    await pg.query(
      `UPDATE public.profiles SET profile_completed_at = NULL
        WHERE id::text LIKE $1`,
      [`${idPrefix}-%`],
    );
    await pg.query(
      `DELETE FROM public.notification_events WHERE event_type LIKE 'lifecycle\\_%'`,
    );
    await pg.query(
      `DELETE FROM public.practice_session_items WHERE user_id::text LIKE $1`,
      [`${idPrefix}-%`],
    );
    await pg.query(
      `DELETE FROM public.practice_sessions WHERE user_id::text LIKE $1`,
      [`${idPrefix}-%`],
    );
    await pg.query(
      `DELETE FROM public.entitlements WHERE profile_id::text LIKE $1`,
      [`${idPrefix}-%`],
    );
  }

  return {
    pg,
    REMINDER_SINCE,
    TRIGGERS_SINCE,
    asProbe,
    person,
    entitle,
    session,
    answer,
    plan,
    claim,
    legacyReminder,
    otherConnection,
    state,
    runRule,
    clear,
  };
}
