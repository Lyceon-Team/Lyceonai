/**
 * The review ask on real Postgres: the trigger, the hard limits, the one follow-up email (through
 * the real dispatcher, quiet hours included), the "Stop review requests" link, storage and the
 * grants as service_role.
 *
 * @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *       2026-10-20) acceptance: "eligibility and the trigger; age rules; the snooze and 2-ask
 *       cap; the email respects unsubscribe and quiet hours; storage persists; grants work as
 *       service_role" and Storage ("store no review content; deletion cascade classified; grants
 *       checked as service_role (the #1248 lesson)"); Karl's Step 0 decisions 3, 4, 5, 6
 *       (2026-10-20); supabase/migrations/20261107000000_review_ask.sql]
 *       | @implemented [2026-10-20]
 *
 * plain English: the whole migration pipeline up to 20261107000000, legacy prompt rows seeded,
 * then the migration applied, so its backfill runs on real rows. Everything after runs the real
 * SQL; the server modules run over the shared `makePgSupabase` transport. Substituted: the email
 * transport (captured), the logger (captured) and the analytics emitter (captured).
 *
 * Grants are exercised, not read: every function is CALLED as a role holding exactly
 * service_role's grants (plus BYPASSRLS, as Supabase's service_role has), which is how #1248's gap
 * (a function service_role could execute but whose tables it could not write) would show. Runs only where PGHOST is set; named by file in CI.
 */
import express from "express";
import request from "supertest";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyMigrationsFrom,
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "review_ask_ci";
const MIGRATION = "20261107000000_review_ask.sql";
process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "review-ask-ci-secret";
process.env.PUBLIC_SITE_URL = "https://lyceon.test";
const TRUSTPILOT = "https://www.trustpilot.com/evaluate/lyceon.test";
process.env.VITE_TRUSTPILOT_REVIEW_URL = TRUSTPILOT;

let pg: Client;
const logs: string[] = [];
const emitted: { name: string; payload: Record<string, unknown> }[] = [];

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));
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
vi.mock("../../server/lib/analytics/emit-event", () => ({
  emitEvent: async (
    _id: string,
    name: string,
    payload: Record<string, unknown>,
  ) => {
    emitted.push({ name, payload });
    return { ok: true };
  },
}));
// The stop route's per-IP limiter reads the rate-limit ledger; the ledger is proved elsewhere.
vi.mock("../../server/middleware/rate-limit", () => ({
  anonymousBucketRateLimit:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

// ── People ──────────────────────────────────────────────────────────────────
const P = (n: number): string =>
  `9e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Trigger
const T_READY = P(1); // 8 days, 3 practice
const T_YOUNG = P(2); // 6 days, 3 practice
const T_QOTD = P(3); // 8 days, 2 practice + 5 qotd
const T_MIXED = P(4); // 8 days, Find your blind spots + 1 practice + 1 review
const T_ABANDONED = P(5); // 8 days, 3 abandoned
const T_DELETED = P(6); // 8 days, 3 practice, deleted
const G_READY = P(10); // guardian, link 8 days to G_STUDENT (entitled, 3 sessions)
const G_NEW_LINK = P(11); // guardian, link 6 days
const G_UNENTITLED = P(12); // guardian, link 8 days to an unentitled student
const G_STUDENT = P(13);
const G_STUDENT_UNENTITLED = P(14);
// Limits
const L1 = P(20);
const L2 = P(21);
const L3 = P(22);
// Email rule
const E_ADULT = P(30); // 19, asked 4 days ago, unanswered → email
const E_TEEN = P(31); // 17, asked 4 days ago → no email
const E_EARLY = P(32); // 19, asked 2 days ago → not yet
const E_LATE = P(33); // 19, asked 15 days ago → never
const E_SNOOZED = P(34); // 19, asked 4 days ago, Not now → no email
const E_GUARDIAN = P(35); // guardian 40, asked 4 days ago → email
const E_WITHDRAWN = P(36); // 19, queued, then answers in the app → not sent
const E_STOP = P(37); // 19, uses the stop link
// Legacy rows (backfill)
const B_REVIEWED = P(40);
const B_DISMISSED = P(41);
const B_SHOWN = P(42);
const B_TWICE = P(43);

const ADULT = "2000-01-01";
const GUARDIAN = "1980-01-01";
const TEEN15 = "2011-06-01";
const seventeen = (): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 17);
  return d.toISOString().slice(0, 10);
};

async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pg.query(sql, params)).rows as T[];
}
async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await q<T>(sql, params);
  if (rows[0] === undefined) throw new Error(`no row: ${sql}`);
  return rows[0];
}

async function person(
  id: string,
  role: "student" | "guardian",
  dob: string,
  createdDaysAgo = 30,
  name = "Robin Example",
): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, `${id}@example.test`],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5::date, now(), now() - make_interval(days => $6::int))`,
    [id, `${id}@example.test`, role, name, dob, createdDaysAgo],
  );
}

async function practice(
  id: string,
  n: number,
  mode = "structured",
  status = "completed",
): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await pg.query(
      `INSERT INTO public.practice_sessions
         (user_id, actor_id, mode, target_count, platform, status, completed_at, abandoned_at)
       VALUES ($1, $1, $2, 3, 'web', $3,
               CASE WHEN $3 = 'completed' THEN now() END,
               CASE WHEN $3 = 'abandoned' THEN now() END)`,
      [id, mode, status],
    );
  }
}

async function review(id: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.review_sessions
       (student_id, actor_id, mode, target_count, platform, status, completed_at)
     VALUES ($1, $1, 'queue', 3, 'web', 'completed', now())`,
    [id],
  );
}

async function entitle(id: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id)
     VALUES ($1, 'premium', 'active', $2, $3)`,
    [id, `sub_${id.slice(-4)}`, `si_${id.slice(-4)}`],
  );
}

async function link(
  guardian: string,
  student: string,
  daysAgo: number,
): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links
       (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, created_at)
     VALUES ($1, $2, 'active', 'student', now() - make_interval(days => $3::int),
             now() - make_interval(days => $3::int), now() - make_interval(days => $3::int))`,
    [guardian, student, daysAgo],
  );
}

async function usage(id: string): Promise<boolean> {
  return (
    await one<{ ok: boolean }>(`SELECT public.review_ask_usage_met($1) AS ok`, [
      id,
    ])
  ).ok;
}

async function stateOf(id: string): Promise<Record<string, unknown> | null> {
  return (
    (
      await q(
        `SELECT ask_count, last_response, snoozed_until IS NOT NULL AS snoozed,
                reviewed_at IS NOT NULL AS reviewed, email_queued_at IS NOT NULL AS emailed
           FROM public.product_review_prompt_state WHERE profile_id = $1`,
        [id],
      )
    )[0] ?? null
  );
}

/** Claim with whatever last_shown_at is stored (the compare-and-set's expected value). */
async function claim(id: string): Promise<boolean> {
  // The stored text, as the server passes it: a JS Date drops the microseconds and never matches.
  const row = (
    await q<{ t: string | null }>(
      `SELECT last_shown_at::text AS t FROM public.product_review_prompt_state WHERE profile_id = $1`,
      [id],
    )
  )[0];
  return (
    await one<{ ok: boolean }>(
      `SELECT public.product_review_prompt_claim($1, $2::timestamptz) AS ok`,
      [id, row?.t ?? null],
    )
  ).ok;
}

/** Pretend the latest ask was `days` ago (and its snooze, if any, from then). */
async function askedDaysAgo(id: string, days: number): Promise<void> {
  await pg.query(
    `UPDATE public.product_review_prompt_state
        SET last_shown_at = now() - make_interval(days => $2::int),
            snoozed_until = CASE WHEN snoozed_until IS NULL THEN NULL
                                 ELSE now() - make_interval(days => $2::int) + interval '30 days' END
      WHERE profile_id = $1`,
    [id, days],
  );
}

describe.skipIf(!PG_AVAILABLE)("review ask → real PG", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME, { stopBefore: MIGRATION });
    // Legacy prompt rows, as the 120-day cadence left them.
    for (const id of [B_REVIEWED, B_DISMISSED, B_SHOWN, B_TWICE]) {
      await person(id, "student", TEEN15);
    }
    await pg.query(
      `INSERT INTO public.product_review_prompt_state
         (profile_id, last_shown_at, last_dismissed_at, dismiss_count, reviewed_at, reviewed_via)
       VALUES ($1, now() - interval '50 days', NULL, 0, now() - interval '50 days', 'in_app'),
              ($2, now() - interval '10 days', now() - interval '9 days', 1, NULL, NULL),
              ($3, now() - interval '200 days', NULL, 0, NULL, NULL),
              ($4, now() - interval '20 days', now() - interval '19 days', 2, NULL, NULL)`,
      [B_REVIEWED, B_DISMISSED, B_SHOWN, B_TWICE],
    );
    await applyMigrationsFrom(pg, MIGRATION);

    // Trigger fixtures.
    await person(T_READY, "student", TEEN15, 8);
    await practice(T_READY, 3);
    await person(T_YOUNG, "student", TEEN15, 6);
    await practice(T_YOUNG, 3);
    await person(T_QOTD, "student", TEEN15, 8);
    await practice(T_QOTD, 2);
    await practice(T_QOTD, 5, "qotd");
    await person(T_MIXED, "student", TEEN15, 8);
    // One Find your blind spots (at most one completed per student), one practice, one review.
    await practice(T_MIXED, 1, "diagnostic");
    await practice(T_MIXED, 1);
    await review(T_MIXED);
    await person(T_ABANDONED, "student", TEEN15, 8);
    await practice(T_ABANDONED, 3, "structured", "abandoned");
    await person(T_DELETED, "student", TEEN15, 8);
    await practice(T_DELETED, 3);
    await pg.query(
      `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
      [T_DELETED],
    );
    await person(G_STUDENT, "student", TEEN15, 30);
    await practice(G_STUDENT, 3);
    await entitle(G_STUDENT);
    await person(G_STUDENT_UNENTITLED, "student", TEEN15, 30);
    await practice(G_STUDENT_UNENTITLED, 3);
    await person(G_READY, "guardian", GUARDIAN, 30);
    await link(G_READY, G_STUDENT, 8);
    await person(G_NEW_LINK, "guardian", GUARDIAN, 30);
    await link(G_NEW_LINK, G_STUDENT, 6);
    await person(G_UNENTITLED, "guardian", GUARDIAN, 30);
    await link(G_UNENTITLED, G_STUDENT_UNENTITLED, 8);

    for (const id of [L1, L2, L3]) await person(id, "student", TEEN15);
    for (const id of [
      E_ADULT,
      E_EARLY,
      E_LATE,
      E_SNOOZED,
      E_WITHDRAWN,
      E_STOP,
    ]) {
      await person(id, "student", ADULT);
    }
    await person(E_TEEN, "student", seventeen());
    await person(E_GUARDIAN, "guardian", GUARDIAN);
  }, 300_000);

  afterAll(async () => {
    await pg?.end();
  });

  describe("storage: the backfill and what is stored", () => {
    it("legacy rows keep their place: reviewed stays answered, a dismissal is a 30-day snooze, a shown row is one ask", async () => {
      expect(await stateOf(B_REVIEWED)).toMatchObject({
        ask_count: 1,
        last_response: "reviewed",
      });
      expect(await stateOf(B_DISMISSED)).toMatchObject({
        ask_count: 1,
        last_response: "dismissed",
        snoozed: true,
      });
      expect(await stateOf(B_SHOWN)).toMatchObject({
        ask_count: 1,
        last_response: null,
        snoozed: false,
      });
      expect(await stateOf(B_TWICE)).toMatchObject({
        ask_count: 2,
        last_response: "dismissed",
      });
      // Two legacy dismissals are the two asks: never again.
      await pg.query(
        `UPDATE public.product_review_prompt_state SET snoozed_until = now() - interval '1 day'
          WHERE profile_id = $1`,
        [B_TWICE],
      );
      expect(await claim(B_TWICE)).toBe(false);
    });

    it("the state table holds cadence facts only: no rating, text or feedback column", async () => {
      const cols = await q<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'product_review_prompt_state'
          ORDER BY column_name`,
      );
      expect(cols.map((c) => c.column_name)).toEqual([
        "ask_count",
        "dismiss_count",
        "email_queued_at",
        "last_dismissed_at",
        "last_response",
        "last_shown_at",
        "profile_id",
        "reviewed_at",
        "reviewed_via",
        "snoozed_until",
        "updated_at",
      ]);
    });

    it("the review email's payload carries a first name and the audience, nothing else", async () => {
      const [con] = await q<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'notification_events_type_check'`,
      );
      expect(con?.def).toContain("'review_ask'::text");
    });

    it("deletion cascades from profiles (the FK guard's declarative rule)", async () => {
      const [fk] = await q<{ confdeltype: string }>(
        `SELECT c.confdeltype FROM pg_constraint c
          WHERE c.conrelid = 'public.product_review_prompt_state'::regclass AND c.contype = 'f'`,
      );
      expect(fk?.confdeltype).toBe("c");
    });
  });

  describe("the trigger: 7+ days and 3+ completed sessions, QOTD excluded", () => {
    it("a student: 7 days and 3 sessions of practice, review or Find your blind spots", async () => {
      expect(await usage(T_READY)).toBe(true);
      expect(await usage(T_MIXED)).toBe(true);
    });

    it("not before 7 days, not on daily questions, not on abandoned sessions, not when deleted", async () => {
      expect(await usage(T_YOUNG)).toBe(false);
      expect(await usage(T_QOTD)).toBe(false);
      expect(await usage(T_ABANDONED)).toBe(false);
      expect(await usage(T_DELETED)).toBe(false);
    });

    it("a guardian: a link 7+ days old to a student they may see with 3+ sessions", async () => {
      expect(await usage(G_READY)).toBe(true);
      expect(await usage(G_NEW_LINK)).toBe(false);
      // Visibility is guardian_view_decision's: an unentitled student is not visible.
      expect(await usage(G_UNENTITLED)).toBe(false);
    });
  });

  describe("the hard limits, held by the claim whatever the server decided", () => {
    it("two tabs reading the same state ask once", async () => {
      expect(
        (
          await one<{ ok: boolean }>(
            `SELECT public.product_review_prompt_claim($1, NULL) AS ok`,
            [L1],
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await one<{ ok: boolean }>(
            `SELECT public.product_review_prompt_claim($1, NULL) AS ok`,
            [L1],
          )
        ).ok,
      ).toBe(false);
      expect(await stateOf(L1)).toMatchObject({ ask_count: 1 });
    });

    it("a live snooze refuses the claim; one response per ask; a third ask is refused", async () => {
      const respond = async (r: string) =>
        (
          await one<{ ok: boolean }>(
            `SELECT public.product_review_prompt_respond($1, $2) AS ok`,
            [L1, r],
          )
        ).ok;
      expect(await respond("snoozed")).toBe(true);
      expect(await respond("dismissed")).toBe(false);
      expect(await claim(L1)).toBe(false); // snoozed
      await askedDaysAgo(L1, 31);
      expect(await claim(L1)).toBe(true); // the second ask
      expect(await respond("dismissed")).toBe(true);
      await askedDaysAgo(L1, 400);
      expect(await claim(L1)).toBe(false); // never a third
      expect(await stateOf(L1)).toMatchObject({ ask_count: 2 });
    });

    it("an unknown response is refused", async () => {
      await expect(
        pg.query(
          `SELECT public.product_review_prompt_respond($1, 'reviewed')`,
          [L1],
        ),
      ).rejects.toThrow(/snoozed or dismissed/);
    });

    it("feedback sent from the ask ends the asks; feedback from Settings does not", async () => {
      expect(await claim(L2)).toBe(true);
      await pg.query(
        `SELECT public.product_feedback_submit($1, 'student', 'Settings note', 'settings', gen_random_uuid())`,
        [L2],
      );
      expect(await stateOf(L2)).toMatchObject({ last_response: null });
      await pg.query(
        `SELECT public.product_feedback_submit($1, 'student', 'From the ask', 'prompt', gen_random_uuid())`,
        [L2],
      );
      expect(await stateOf(L2)).toMatchObject({ last_response: "feedback" });
      await askedDaysAgo(L2, 400);
      expect(await claim(L2)).toBe(false);
    });

    it("'Stop review requests' ends the asks; after a review it keeps 'reviewed'", async () => {
      await pg.query(`SELECT public.product_review_prompt_stop($1)`, [L3]);
      expect(await stateOf(L3)).toMatchObject({ last_response: "stopped" });
      expect(await claim(L3)).toBe(false);
      await pg.query(`SELECT public.product_review_mark_external($1)`, [
        B_SHOWN,
      ]);
      await pg.query(`SELECT public.product_review_prompt_stop($1)`, [B_SHOWN]);
      expect(await stateOf(B_SHOWN)).toMatchObject({
        last_response: "reviewed",
        reviewed: true,
      });
    });
  });

  describe("the one follow-up email", () => {
    const sent: {
      to: string;
      subject: string;
      text: string;
      html: string;
      fromCategory?: string;
      headers?: Record<string, string>;
    }[] = [];
    const fakeTransport = async (input: {
      to: string;
      subject: string;
      text: string;
      html: string;
      fromCategory?: string;
      headers?: Record<string, string>;
    }) => {
      sent.push(input);
      return {
        ok: true as const,
        value: { providerMessageId: `re_${sent.length}` },
      };
    };
    const tomorrowAt = (hourUtc: number): Date => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(hourUtc, 0, 0, 0);
      return d;
    };
    async function dispatch(at: Date) {
      const { dispatchQueuedMessages } =
        await import("../../server/lib/notifications/dispatch");
      return dispatchQueuedMessages({
        eventType: "review_ask",
        now: at,
        transport: fakeTransport,
      });
    }
    const eventsFor = (id: string) =>
      q<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM public.notification_events
          WHERE event_type = 'review_ask' AND subject_profile_id = $1`,
        [id],
      );

    beforeAll(async () => {
      for (const id of [
        E_ADULT,
        E_TEEN,
        E_EARLY,
        E_LATE,
        E_SNOOZED,
        E_GUARDIAN,
        E_WITHDRAWN,
        E_STOP,
      ]) {
        expect(await claim(id)).toBe(true);
      }
      for (const id of [
        E_ADULT,
        E_TEEN,
        E_SNOOZED,
        E_GUARDIAN,
        E_WITHDRAWN,
        E_STOP,
      ]) {
        await askedDaysAgo(id, 4);
      }
      await askedDaysAgo(E_EARLY, 2);
      await askedDaysAgo(E_LATE, 15);
      await pg.query(
        `SELECT public.product_review_prompt_respond($1, 'snoozed')`,
        [E_SNOOZED],
      );
      await askedDaysAgo(E_SNOOZED, 4);
    });

    it("queues one email to each adult whose first ask is 3-14 days old and unanswered", async () => {
      const { runReviewAskEmailRule } =
        await import("../../server/services/product-feedback/review-ask-email-job");
      const first = await runReviewAskEmailRule(new Date(), makePgSupabase(pg));
      expect(first.emitted).toBeGreaterThanOrEqual(4);
      for (const id of [E_ADULT, E_GUARDIAN, E_WITHDRAWN, E_STOP]) {
        expect(await eventsFor(id)).toHaveLength(1);
        expect(await stateOf(id)).toMatchObject({ emailed: true });
      }
      expect((await eventsFor(E_ADULT))[0]?.payload).toEqual({
        first_name: "Robin",
        audience: "student",
      });
      expect((await eventsFor(E_GUARDIAN))[0]?.payload).toEqual({
        first_name: "Robin",
        audience: "guardian",
      });
    });

    it("none to a 17-year-old, none before 3 days or after 14, none after any response", async () => {
      for (const id of [E_TEEN, E_EARLY, E_LATE, E_SNOOZED]) {
        expect(await eventsFor(id)).toEqual([]);
      }
    });

    it("once per person, ever: a second run queues nothing new", async () => {
      const { runReviewAskEmailRule } =
        await import("../../server/services/product-feedback/review-ask-email-job");
      const again = await runReviewAskEmailRule(new Date(), makePgSupabase(pg));
      expect(again.emitted).toBe(0);
      expect(await eventsFor(E_ADULT)).toHaveLength(1);
      // Even with the marker cleared, the event id is insert-once.
      await pg.query(
        `UPDATE public.product_review_prompt_state SET email_queued_at = NULL WHERE profile_id = $1`,
        [E_ADULT],
      );
      await runReviewAskEmailRule(new Date(), makePgSupabase(pg));
      expect(await eventsFor(E_ADULT)).toHaveLength(1);
      expect(
        await q(
          `SELECT 1 FROM public.notification_messages m JOIN public.notification_events e USING (event_id)
            WHERE e.subject_profile_id = $1`,
          [E_ADULT],
        ),
      ).toHaveLength(1);
    });

    it("quiet hours: nothing goes out at 23:00 Chicago; it goes out after 08:00", async () => {
      // An answer in the app after queueing withdraws the email at send time.
      await pg.query(
        `SELECT public.product_review_prompt_respond($1, 'snoozed')`,
        [E_WITHDRAWN],
      );
      const night = await dispatch(tomorrowAt(4)); // 23:00 CDT / 22:00 CST
      expect(sent).toEqual([]);
      expect(night.selected).toBeGreaterThan(0);
      await dispatch(tomorrowAt(14)); // 09:00 CDT / 08:00 CST
      const to = sent.map((s) => s.to).sort();
      expect(to).toEqual(
        [E_ADULT, E_GUARDIAN, E_STOP].map((id) => `${id}@example.test`).sort(),
      );
      const withdrawn = await one<{ status: string; last_error: string }>(
        `SELECT m.status, m.last_error FROM public.notification_messages m
           JOIN public.notification_events e USING (event_id) WHERE e.subject_profile_id = $1`,
        [E_WITHDRAWN],
      );
      expect(withdrawn.status).toBe("failed");
      expect(withdrawn.last_error).toContain("withdrawn");
    });

    it("the email is the approved draft, from 'Lyceon', with the stop link one click away", () => {
      const mail = sent.find((s) => s.to === `${E_ADULT}@example.test`);
      expect(mail).toBeDefined();
      expect(mail?.subject).toBe("How's Lyceon working for you?");
      expect(mail?.fromCategory).toBe("general");
      expect(mail?.text).toContain(
        "Hi Robin, you've been using Lyceon for a little while. Good or bad, we'd like to hear how it's going.",
      );
      expect(mail?.text).toContain(
        `Leave a review on Trustpilot: ${TRUSTPILOT}`,
      );
      expect(mail?.text).toContain(
        "Send private feedback: https://lyceon.test/dashboard?review=email",
      );
      expect(mail?.text).toContain(
        "You're getting this because you have a Lyceon account.",
      );
      expect(mail?.text).toContain(
        "Lyceon AI, 5650 Central Ave # E7, Toledo, OH 43615",
      );
      expect(mail?.headers?.["List-Unsubscribe"]).toMatch(
        /^<https:\/\/lyceon\.test\/api\/public\/review-ask-email\/stop\?t=[^>]+>$/,
      );
      expect(mail?.headers?.["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
      const guardianMail = sent.find(
        (s) => s.to === `${E_GUARDIAN}@example.test`,
      );
      expect(guardianMail?.text).toContain(
        "https://lyceon.test/guardian?review=email",
      );
      // Identical invitation: two adults' emails differ only in the name and the signed link.
      const other = sent.find((s) => s.to === `${E_STOP}@example.test`);
      const strip = (text: string | undefined): string =>
        (text ?? "").replace(/\?t=[^\s]+/g, "?t=").replace(/Hi \w+,/, "Hi,");
      expect(strip(other?.text)).toBe(strip(mail?.text));
      // Counts only: the audience, never an address or a name.
      expect(
        emitted
          .filter((e) => e.name === "review_ask_email_sent")
          .map((e) => e.payload)
          .sort((a, b) => String(a.audience).localeCompare(String(b.audience))),
      ).toEqual([
        { audience: "guardian" },
        { audience: "student" },
        { audience: "student" },
      ]);
    });

    it("'Stop review requests': the GET changes nothing; the signed POST stops; a tampered or foreign token is refused", async () => {
      const { createPublicReviewAskEmailRouter } =
        await import("../../server/routes/public-review-ask-email-routes");
      const { qotdEmailLinkToken } =
        await import("../../server/services/qotd/qotd-email-links");
      const app = express();
      app.use(
        "/api/public/review-ask-email",
        createPublicReviewAskEmailRouter(() => makePgSupabase(pg)),
      );
      const t = qotdEmailLinkToken("review_ask_stop", E_STOP);
      const url = `/api/public/review-ask-email/stop?t=${encodeURIComponent(t)}`;
      expect((await request(app).get(url)).status).toBe(200);
      expect(await stateOf(E_STOP)).toMatchObject({ last_response: null });
      const tampered = `${t.slice(0, -2)}AA`;
      expect(
        (
          await request(app).post(
            `/api/public/review-ask-email/stop?t=${encodeURIComponent(tampered)}`,
          )
        ).status,
      ).toBe(400);
      const foreign = qotdEmailLinkToken("guardian_digest_unsubscribe", E_STOP);
      expect(
        (
          await request(app).post(
            `/api/public/review-ask-email/stop?t=${encodeURIComponent(foreign)}`,
          )
        ).status,
      ).toBe(400);
      expect(await stateOf(E_STOP)).toMatchObject({ last_response: null });
      expect((await request(app).post(url)).status).toBe(200);
      expect((await request(app).post(url)).status).toBe(200); // idempotent
      expect(await stateOf(E_STOP)).toMatchObject({ last_response: "stopped" });
    });

    it("no log line carries a name, an address or a token", () => {
      expect(logs.length).toBeGreaterThan(0);
      for (const line of logs) {
        expect(line).not.toContain("Robin");
        expect(line).not.toContain("@example.test");
        expect(line).not.toContain("?t=");
      }
    });
  });

  describe("grants: every function runs as service_role (the #1248 lesson)", () => {
    const G = P(90);

    beforeAll(async () => {
      await person(G, "student", ADULT, 30);
      await practice(G, 3);
    });

    it("anon and authenticated cannot execute any of them", async () => {
      const fns = [
        "product_review_prompt_state_for(uuid)",
        "product_review_prompt_claim(uuid, timestamptz)",
        "product_review_prompt_respond(uuid, text)",
        "product_review_prompt_stop(uuid)",
        "product_review_submit(uuid, text, smallint, text, boolean)",
        "product_review_mark_external(uuid)",
        "product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text)",
        "review_ask_completed_sessions(uuid)",
        "review_ask_usage_met(uuid, timestamptz)",
        "review_ask_email_notify(timestamptz, integer)",
      ];
      const rows = await q<{
        fn: string;
        anon: boolean;
        authd: boolean;
        svc: boolean;
      }>(
        `SELECT f AS fn,
                has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE') AS authd,
                has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') AS svc
           FROM unnest($1::text[]) AS f`,
        [fns],
      );
      expect(rows).toHaveLength(fns.length);
      for (const r of rows) {
        expect({ fn: r.fn, anon: r.anon, authd: r.authd, svc: r.svc }).toEqual({
          fn: r.fn,
          anon: false,
          authd: false,
          svc: true,
        });
      }
    });

    it("as service_role: the whole ask round-trips (read, trigger, claim, respond, review, feedback, stop, email rule)", async () => {
      // Exactly service_role's grants (inherited) plus BYPASSRLS, which Supabase's service_role
      // has and the bare-Postgres stub does not: the getting-started suite's probe (#1248).
      await pg.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ra_service_role_probe') THEN
            CREATE ROLE ra_service_role_probe NOLOGIN BYPASSRLS INHERIT;
          END IF;
        END $$;
        GRANT service_role TO ra_service_role_probe;
      `);
      await pg.query("SET ROLE ra_service_role_probe");
      try {
        expect(
          (
            await one<{ ok: boolean }>(
              `SELECT public.review_ask_usage_met($1) AS ok`,
              [G],
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await one<{ n: number }>(
              `SELECT public.review_ask_completed_sessions($1) AS n`,
              [G],
            )
          ).n,
        ).toBe(3);
        expect(
          (
            await one<{ s: unknown }>(
              `SELECT public.product_review_prompt_state_for($1) AS s`,
              [G],
            )
          ).s,
        ).toBeNull();
        expect(
          (
            await one<{ ok: boolean }>(
              `SELECT public.product_review_prompt_claim($1, NULL) AS ok`,
              [G],
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await one<{ ok: boolean }>(
              `SELECT public.product_review_prompt_respond($1, 'snoozed') AS ok`,
              [G],
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await one<{ r: { outcome: string } }>(
              `SELECT public.product_feedback_submit($1, 'student', 'note', 'prompt', gen_random_uuid()) AS r`,
              [G],
            )
          ).r.outcome,
        ).toBe("created");
        expect(
          (
            await one<{ r: { outcome: string } }>(
              `SELECT public.product_review_submit($1, 'student', 4::smallint, NULL, false) AS r`,
              [G],
            )
          ).r.outcome,
        ).toBe("created");
        await pg.query(`SELECT public.product_review_mark_external($1)`, [G]);
        await pg.query(`SELECT public.product_review_prompt_stop($1)`, [G]);
        expect(
          (
            await one<{ r: { emitted: number } }>(
              `SELECT public.review_ask_email_notify(now(), 10) AS r`,
            )
          ).r.emitted,
        ).toBeGreaterThanOrEqual(0);
      } finally {
        await pg.query("RESET ROLE");
      }
      expect(await stateOf(G)).toMatchObject({
        ask_count: 1,
        last_response: "reviewed",
        reviewed: true,
      });
    });

    it("storage persists: what was written as service_role reads back the same through the server's read", async () => {
      const state = await one<{ s: Record<string, unknown> }>(
        `SELECT public.product_review_prompt_state_for($1) AS s`,
        [G],
      );
      expect(Object.keys(state.s).sort()).toEqual([
        "ask_count",
        "email_queued_at",
        "last_response",
        "last_shown_at",
        "reviewed_at",
        "snoozed_until",
      ]);
      expect(state.s).toMatchObject({
        ask_count: 1,
        last_response: "reviewed",
      });
    });

    it("deleting the profile removes its prompt state", async () => {
      await pg.query(
        `DELETE FROM public.practice_sessions WHERE user_id = $1`,
        [G],
      );
      await pg.query(
        `DELETE FROM public.product_reviews WHERE profile_id = $1`,
        [G],
      );
      await pg.query(
        `DELETE FROM public.product_feedback WHERE profile_id = $1`,
        [G],
      );
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [G]);
      expect(await stateOf(G)).toBeNull();
    });
  });
});
