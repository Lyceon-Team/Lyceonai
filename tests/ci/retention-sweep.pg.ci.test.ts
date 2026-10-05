/**
 * The tutor retention sweep against real Postgres.
 *
 * @spec [Doc-03_V1.1 §14.2 (retention matrix: "Crisis-flagged conversations | 180 days (extended
 *       for safety review) | Manual purge by safety review queue owner after incident closure");
 *       owner rulings 2026-10-05 RS-00 (a conversation is crisis-flagged when any
 *       crisis_review_cases or crisis_review_events row links to it; the 7d tier never deletes it,
 *       its cascade rows, or the student's memory summary while one exists)]
 *       | @implemented [2026-10-05]
 *
 * plain English: a throwaway database built from this repo's migrations, the real
 * `TIER_HANDLERS` from server/services/retention-sweep.ts, and the PG harness standing in for
 * supabase-js. No mock decides what a column is called or what a foreign key does: the in-memory
 * mocks are how a sweep on a column that does not exist (`tutor_instruction_exposures.created_at`)
 * passed its tests. Flags come from the real producer, `flag_conversation_for_crisis_review`.
 *
 * Runs only where PGHOST is set; named by file in CI (.github/workflows/ci.yml).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "retention_sweep_pg_ci";

const ANA = "0d7d7d7d-0000-4000-8000-00000000000a";
const BEN = "0d7d7d7d-0000-4000-8000-00000000000b";
const ANA_FLAGGED = "0d7d7d7d-0000-4000-8000-0000000000a1";
const ANA_PLAIN = "0d7d7d7d-0000-4000-8000-0000000000a2";
const BEN_PLAIN = "0d7d7d7d-0000-4000-8000-0000000000b1";
const BEN_EVENT_ONLY = "0d7d7d7d-0000-4000-8000-0000000000b2";
const BEN_CASE_HOST = "0d7d7d7d-0000-4000-8000-0000000000b3";

let pg: Client;

async function q<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await pg.query(sql, args)).rows as T[];
}

async function conversation(
  id: string,
  student: string,
  deletedDaysAgo: number | null,
  messages = 3,
): Promise<void> {
  await q(
    `INSERT INTO public.tutor_conversations
       (id, student_id, entry_mode, source_surface, crisis_flagged)
     VALUES ($1, $2, 'general', 'dashboard', false)`,
    [id, student],
  );
  for (let i = 0; i < messages; i += 1) {
    await q(
      `INSERT INTO public.tutor_messages (conversation_id, student_id, role, message)
       VALUES ($1, $2, $3, 'fixture')`,
      [id, student, i % 2 === 0 ? "student" : "tutor"],
    );
  }
  if (deletedDaysAgo !== null) {
    await q(
      `UPDATE public.tutor_conversations
          SET deleted_at = now() - make_interval(days => $2)
        WHERE id = $1`,
      [id, deletedDaysAgo],
    );
  }
}

async function memorySummary(student: string): Promise<void> {
  await q(
    `INSERT INTO public.tutor_memory_summaries (student_id, summary_type, content_json)
     VALUES ($1, 'teaching_profile', $2::jsonb)`,
    [
      student,
      JSON.stringify({
        summary_version: "1.0",
        learning_style_signals: [],
        last_struggled_skill: null,
        last_mastered_skill: null,
        engagement_summary: "fixture",
      }),
    ],
  );
}

/** Flag through the real producer: it writes the case and its event. */
async function flag(conversationId: string, student: string): Promise<void> {
  await q(
    `SELECT public.flag_conversation_for_crisis_review($1, $2, 'signature', NULL, NULL, 'crisis')`,
    [conversationId, student],
  );
}

const count = async (sql: string, args: unknown[]): Promise<number> =>
  Number((await q<{ n: string }>(sql, args))[0]!.n);

const conversationExists = (id: string): Promise<number> =>
  count(`SELECT count(*) AS n FROM public.tutor_conversations WHERE id = $1`, [
    id,
  ]);
const messagesOf = (id: string): Promise<number> =>
  count(
    `SELECT count(*) AS n FROM public.tutor_messages WHERE conversation_id = $1`,
    [id],
  );
const summariesOf = (student: string): Promise<number> =>
  count(
    `SELECT count(*) AS n FROM public.tutor_memory_summaries WHERE student_id = $1`,
    [student],
  );

describe.skipIf(!PG_AVAILABLE)("tutor retention sweep → real PG", () => {
  let TIER_HANDLERS: (typeof import("../../server/services/retention-sweep"))["TIER_HANDLERS"];

  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    ({ TIER_HANDLERS } = await import("../../server/services/retention-sweep"));
    for (const [id, email] of [
      [ANA, "rs-ana@example.test"],
      [BEN, "rs-ben@example.test"],
    ] as const) {
      await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        id,
        email,
      ]);
      await q(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, 'student')
           ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
        [id, email],
      );
    }
  }, 240_000);

  afterAll(async () => {
    await pg?.end();
  });

  const sweep = (tier: "7d" | "90d" | "180d", dryRun = false) =>
    TIER_HANDLERS[tier]!(
      makePgSupabase(pg) as unknown as Parameters<
        (typeof TIER_HANDLERS)["7d"]
      >[0],
      dryRun,
      { now: new Date() },
    );

  describe("RS-00: the 7d tier keeps crisis-flagged conversations", () => {
    beforeEach(async () => {
      await q(`DELETE FROM public.crisis_review_cases`);
      await q(`DELETE FROM public.tutor_memory_summaries`);
      await q(`DELETE FROM public.tutor_conversations`);
      // Ana: one flagged and one plain conversation, both soft-deleted 10 days ago.
      await conversation(ANA_FLAGGED, ANA, null);
      await flag(ANA_FLAGGED, ANA);
      await q(
        `UPDATE public.tutor_conversations SET deleted_at = now() - interval '10 days' WHERE id = $1`,
        [ANA_FLAGGED],
      );
      await conversation(ANA_PLAIN, ANA, 10);
      await memorySummary(ANA);
      // Ben: a plain expired conversation, and one linked ONLY by a crisis_review_events row
      // (its case belongs to another conversation of his, which is live).
      await conversation(BEN_PLAIN, BEN, 10);
      await conversation(BEN_CASE_HOST, BEN, null, 1);
      await flag(BEN_CASE_HOST, BEN);
      await conversation(BEN_EVENT_ONLY, BEN, 10);
      await q(
        `INSERT INTO public.crisis_review_events (case_id, conversation_id, student_id, event_type)
         SELECT id, $1, $2, 'signal_received'
           FROM public.crisis_review_cases
          WHERE conversation_id = $3`,
        [BEN_EVENT_ONLY, BEN, BEN_CASE_HOST],
      );
      await memorySummary(BEN);
    });

    it("presence first: the fixture is what it says", async () => {
      expect(
        await count(
          `SELECT count(*) AS n FROM public.crisis_review_cases WHERE conversation_id = $1`,
          [ANA_FLAGGED],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM public.crisis_review_events WHERE conversation_id = $1`,
          [BEN_EVENT_ONLY],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM public.crisis_review_cases WHERE conversation_id = $1`,
          [BEN_EVENT_ONLY],
        ),
      ).toBe(0);
      for (const id of [ANA_FLAGGED, ANA_PLAIN, BEN_PLAIN, BEN_EVENT_ONLY]) {
        expect(await messagesOf(id), id).toBe(3);
      }
    });

    it("a flagged soft-deleted conversation older than 7 days survives with all its messages; an unflagged one is deleted", async () => {
      const result = await sweep("7d");
      expect(result).toMatchObject({ ok: true, tier: "7d", dry_run: false });
      // Flagged by a case: kept, with every message.
      expect(await conversationExists(ANA_FLAGGED)).toBe(1);
      expect(await messagesOf(ANA_FLAGGED)).toBe(3);
      // Flagged by an event alone: kept too.
      expect(await conversationExists(BEN_EVENT_ONLY)).toBe(1);
      expect(await messagesOf(BEN_EVENT_ONLY)).toBe(3);
      // Unflagged and past 7 days: gone, messages with it.
      expect(await conversationExists(ANA_PLAIN)).toBe(0);
      expect(await messagesOf(ANA_PLAIN)).toBe(0);
      expect(await conversationExists(BEN_PLAIN)).toBe(0);
      expect(await messagesOf(BEN_PLAIN)).toBe(0);
      // The case still points at its conversation (no SET NULL ran).
      expect(
        await count(
          `SELECT count(*) AS n FROM public.crisis_review_cases WHERE conversation_id = $1`,
          [ANA_FLAGGED],
        ),
      ).toBe(1);
      expect(result.ok && result.deleted_count).toBe(2);
    });

    it("the memory summary stays while the student has a flagged conversation", async () => {
      await sweep("7d");
      // Ana's only remaining conversation is a flagged, soft-deleted one: keep her summary.
      expect(await summariesOf(ANA)).toBe(1);
      // Ben still has a live conversation: keep his (the existing recovery rule).
      expect(await summariesOf(BEN)).toBe(1);
    });

    it("a student whose expired conversations are all unflagged loses the memory summary", async () => {
      await q(`DELETE FROM public.crisis_review_cases`);
      await q(`DELETE FROM public.tutor_conversations WHERE student_id = $1`, [
        BEN,
      ]);
      await q(`DELETE FROM public.tutor_conversations WHERE id = $1`, [
        ANA_FLAGGED,
      ]);
      expect(await summariesOf(ANA)).toBe(1);
      await sweep("7d");
      expect(await conversationExists(ANA_PLAIN)).toBe(0);
      expect(await summariesOf(ANA)).toBe(0);
    });
  });

  /**
   * The 7d cases that lived in the filtering-mock suite until RS-00 moved the tier into SQL,
   * ported one for one against the real function.
   */
  describe("7d tier on real PG (ported from the mock suite)", () => {
    const CAROL = ANA;
    const C_OLD = "0d7d7d7d-0000-4000-8000-0000000000c1";
    const C_RECENT = "0d7d7d7d-0000-4000-8000-0000000000c2";
    const C_LIVE = "0d7d7d7d-0000-4000-8000-0000000000c3";
    const D_RECENT = "0d7d7d7d-0000-4000-8000-0000000000d1";

    beforeEach(async () => {
      await q(`DELETE FROM public.crisis_review_cases`);
      await q(`DELETE FROM public.tutor_memory_summaries`);
      await q(`DELETE FROM public.tutor_injection_log`);
      await q(`DELETE FROM public.tutor_conversations`);
    });

    it("deletes an expired row, keeps one inside the window, never touches a live one", async () => {
      await conversation(C_OLD, CAROL, 10);
      await conversation(C_RECENT, CAROL, 3);
      await conversation(C_LIVE, CAROL, null);
      await sweep("7d");
      expect(await conversationExists(C_OLD)).toBe(0);
      expect(await conversationExists(C_RECENT)).toBe(1);
      expect(await conversationExists(C_LIVE)).toBe(1);
    });

    it("dry run deletes nothing and counts every table, cascades included", async () => {
      await conversation(C_OLD, CAROL, 10, 4);
      await memorySummary(CAROL);
      const result = await sweep("7d", true);
      expect(result).toMatchObject({
        ok: true,
        dry_run: true,
        deleted_count: 1,
      });
      if (!result.ok) throw new Error(result.reason);
      const byTable = Object.fromEntries(
        (result.per_table ?? []).map((r) => [r.table, r.count]),
      );
      expect(byTable).toMatchObject({
        tutor_conversations: 1,
        tutor_messages: 4,
        tutor_memory_summaries: 1,
      });
      expect(await conversationExists(C_OLD)).toBe(1);
      expect(await messagesOf(C_OLD)).toBe(4);
      expect(await summariesOf(CAROL)).toBe(1);
    });

    it("cross-student: another student's unexpired row survives", async () => {
      await conversation(C_OLD, CAROL, 10);
      await conversation(D_RECENT, BEN, 3);
      await sweep("7d");
      expect(await conversationExists(C_OLD)).toBe(0);
      expect(await conversationExists(D_RECENT)).toBe(1);
    });

    it("memory summaries survive while a conversation is still inside the recovery window", async () => {
      await conversation(C_OLD, CAROL, 10);
      await conversation(C_RECENT, CAROL, 3);
      await memorySummary(CAROL);
      await sweep("7d");
      expect(await conversationExists(C_OLD)).toBe(0);
      expect(await summariesOf(CAROL)).toBe(1);
    });

    it("the boundary is the database's clock: 6 days 23 hours is kept, 7 days 1 minute is not", async () => {
      await conversation(C_RECENT, CAROL, null);
      await conversation(C_OLD, CAROL, null);
      await q(
        `UPDATE public.tutor_conversations SET deleted_at = now() - interval '6 days 23 hours' WHERE id = $1`,
        [C_RECENT],
      );
      await q(
        `UPDATE public.tutor_conversations SET deleted_at = now() - interval '7 days 1 minute' WHERE id = $1`,
        [C_OLD],
      );
      await sweep("7d");
      expect(await conversationExists(C_RECENT)).toBe(1);
      expect(await conversationExists(C_OLD)).toBe(0);
    });

    it("the 7d tier does not touch the 180d tier's rows", async () => {
      await conversation(C_LIVE, CAROL, null);
      await q(
        `INSERT INTO public.tutor_injection_log
           (conversation_id, student_id, detection_layer, action_taken, detected_at)
         VALUES ($1, $2, 'fixture', 'fixture', now() - interval '200 days')`,
        [C_LIVE, CAROL],
      );
      await sweep("7d");
      expect(
        await count(`SELECT count(*) AS n FROM public.tutor_injection_log`, []),
      ).toBe(1);
    });

    it("empty table: ok, deleted_count 0", async () => {
      expect(await sweep("7d")).toMatchObject({ ok: true, deleted_count: 0 });
    });

    it("AUDIT-003 on real PG: a failing memory-summary delete fails the run and deletes nothing", async () => {
      await conversation(C_OLD, CAROL, 10);
      await memorySummary(CAROL);
      await q(`CREATE FUNCTION pg_temp.rs_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$
                 BEGIN RAISE EXCEPTION 'planted: memory summary delete refused'; END $f$`);
      await q(`CREATE TRIGGER rs_refuse BEFORE DELETE ON public.tutor_memory_summaries
                 FOR EACH ROW EXECUTE FUNCTION pg_temp.rs_refuse()`);
      try {
        const result = await sweep("7d");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("planted");
        // One transaction: the conversation is still there, with its messages.
        expect(await conversationExists(C_OLD)).toBe(1);
        expect(await messagesOf(C_OLD)).toBe(3);
        expect(await summariesOf(CAROL)).toBe(1);
      } finally {
        await q(`DROP TRIGGER rs_refuse ON public.tutor_memory_summaries`);
      }
    });
  });
});
