/**
 * Hot paths — the timing line through the REAL routes and the REAL log sink, and the two
 * caches against a fresh read of the real database.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2 ("Tests: timings emitted with
 *        steps and no content (redaction test), caches (... the cached result equals a fresh
 *        read)"); Doc-01A_V1.0 §10 (structured JSON to stdout), §24; Coding Standards §12.1]
 * | @implemented [2026-10-13]
 *
 * plain English:
 *   TIMING. Each of the four routes is driven once through the real router while stdout is
 *   captured, and the real logger's JSON lines are parsed. Presence first: exactly ONE
 *   `route_timing` line per request, naming that route, carrying that request's id in
 *   `request_id`, and listing the route's own steps. Then absence: the line's `data` has only
 *   the seven timing fields, each step only `{step, ms, at_ms}`, and the serialised line
 *   contains none of the content the request touched — no uuid (session, item, student), no
 *   stem, explanation, option text, served token, answer key or client attempt key.
 *   CACHES. The skill catalog served from cache equals a fresh `canonical_skill_catalog` read
 *   made directly in SQL, a second call does not touch the database, and a new triple published
 *   behind the cache appears only after invalidation (the documented invalidation story). The
 *   timezone answer for known and unknown zones equals `calendar_is_known_timezone` asked
 *   directly, and is asked of the database once per zone.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  STUDENT,
  bootHarness,
  buildApp,
  closeOpenSessions,
  correctTokenFor,
  harness,
  setupBody,
  shutdownHarness,
} from "../perf/hot-paths.harness";

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
vi.mock("../../apps/api/src/lib/supabase-admin", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { getSupabaseAdmin: () => h.transport() };
});
vi.mock("../../server/middleware/supabase-auth.js", async () => {
  const h = await import("../perf/hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/supabase-auth", async () => {
  const h = await import("../perf/hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));

const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type TimingLine = {
  event: string;
  component: string;
  request_id?: string;
  data: Record<string, unknown>;
};

/** Run `fn` with stdout captured; return the parsed `route_timing` JSON lines it produced. */
async function captureTimingLines(
  fn: () => Promise<void>,
): Promise<TimingLine[]> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    });
  try {
    await fn();
    // `finish` fires after the body is flushed; give the emit a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    spy.mockRestore();
  }
  return chunks
    .join("")
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as TimingLine)
    .filter((l) => l.event === "route_timing");
}

function assertContentFree(line: TimingLine, forbidden: string[]): void {
  expect(line.component).toBe("PERF");
  expect(Object.keys(line.data).sort()).toEqual(
    [
      "pre_handler_ms",
      "route",
      "status",
      "step_count",
      "steps",
      "steps_dropped",
      "total_ms",
    ].sort(),
  );
  for (const step of line.data.steps as Array<Record<string, unknown>>) {
    expect(Object.keys(step).sort()).toEqual(["at_ms", "ms", "step"]);
    expect(step.step).toMatch(/^[a-z_]+$/);
  }
  const { request_id: _id, ...rest } = line;
  const serialised = JSON.stringify(rest);
  expect(serialised).not.toMatch(UUID_ANYWHERE);
  for (const value of forbidden) expect(serialised).not.toContain(value);
}

function stepNames(line: TimingLine): string[] {
  return (line.data.steps as Array<{ step: string }>).map((s) => s.step);
}

describe.skipIf(!PG_AVAILABLE)(
  "hot paths: timing line and caches (real routes, real PG)",
  () => {
    let app: Express;

    beforeAll(async () => {
      await bootHarness("hot_paths_observability_ci");
      app = await buildApp();
    }, 240_000);

    afterAll(async () => {
      await shutdownHarness();
    });

    afterEach(() => {
      harness.actingStudent = STUDENT;
    });

    it("practice start, answer, review start and calendar read each emit one content-free line", async () => {
      await closeOpenSessions();
      const put = await request(app)
        .put("/api/calendar/profile")
        .send(setupBody());
      expect(put.status).toBe(200);

      let sessionId = "";
      let itemId = "";
      let token = "";
      const startLines = await captureTimingLines(async () => {
        const res = await request(app)
          .post("/api/practice/sessions")
          .set("x-request-id", "rid-start")
          .send({
            sections: ["M"],
            target_question_count: 5,
            idempotency_key: "obs-start",
            client_instance_id: "obs-client",
          });
        expect(res.status).toBe(200);
        sessionId = res.body.sessionId as string;
      });
      const [item] = (
        await harness.setup!.query(
          `SELECT id FROM public.practice_session_items WHERE session_id = $1 AND ordinal = 1`,
          [sessionId],
        )
      ).rows as Array<{ id: string }>;
      itemId = item!.id;
      token = await correctTokenFor(itemId);
      const [itemRow] = (
        await harness.setup!.query(
          `SELECT question_id, question_stem, question_explanation, question_correct_answer
           FROM public.practice_session_items WHERE id = $1`,
          [itemId],
        )
      ).rows as Array<Record<string, string>>;

      const answerLines = await captureTimingLines(async () => {
        const res = await request(app)
          .post("/api/practice/answer")
          .set("x-request-id", "rid-answer")
          .send({
            sessionId,
            sessionItemId: itemId,
            selectedAnswer: token,
            clientAttemptId: "obs-attempt-key",
          });
        expect(res.status).toBe(200);
      });

      await closeOpenSessions();
      const reviewLines = await captureTimingLines(async () => {
        const res = await request(app)
          .post("/api/review/sessions")
          .set("x-request-id", "rid-review")
          .send({
            mode: "queue",
            idempotency_key: "obs-review",
            client_instance_id: "obs-client",
          });
        expect(res.status).toBe(200);
      });

      const calendarLines = await captureTimingLines(async () => {
        const res = await request(app)
          .get("/api/calendar")
          .set("x-request-id", "rid-calendar");
        expect(res.status).toBe(200);
      });

      // Presence: one line per request, the right route, the right id, the route's own steps.
      for (const [lines, route] of [
        [startLines, "practice.session_start"],
        [answerLines, "practice.answer_submit"],
        [reviewLines, "review.session_start"],
        [calendarLines, "calendar.read"],
      ] as const) {
        expect(lines).toHaveLength(1);
        expect(lines[0]!.data.route).toBe(route);
        expect(lines[0]!.data.status).toBe(200);
      }
      expect(stepNames(startLines[0]!)).toEqual([
        "config",
        "open_sessions",
        "config",
        "exclude_ids",
        "quota_dry_run",
        "pool_select",
        "session_insert",
        "items_insert",
        "quota_reserve",
        "session_update",
      ]);
      expect(stepNames(answerLines[0]!)).toEqual([
        "attempt_lookup",
        "load_session",
        "load_item",
        "item_update",
        "count_resolved",
        "mastery_emit",
        "stats",
        "session_update",
      ]);
      expect(stepNames(reviewLines[0]!)).toEqual([
        "open_sessions",
        "config",
        "review_pool",
        "session_insert",
        "items_insert",
        "session_update",
      ]);
      expect(stepNames(calendarLines[0]!)).toEqual(
        expect.arrayContaining([
          "profile",
          "entitlement",
          "config",
          "first_open_probe",
          "streak",
          "diagnostic",
          "projection",
          "current_plan",
          "unacknowledged_change",
          "activity_units",
        ]),
      );
      // The duplicate profile read is gone: the calendar read asks for the profile once.
      expect(
        stepNames(calendarLines[0]!).filter((s) => s === "profile"),
      ).toHaveLength(1);

      // Absence: nothing the requests touched is on any line.
      const forbidden = [
        sessionId,
        itemId,
        STUDENT,
        token,
        "obs-attempt-key",
        "obs-start",
        "obs-review",
        itemRow!.question_id!,
        itemRow!.question_stem!,
        itemRow!.question_explanation!,
        `"${itemRow!.question_correct_answer!}"`,
      ];
      for (const [lines, rid] of [
        [startLines, "rid-start"],
        [answerLines, "rid-answer"],
        [reviewLines, "rid-review"],
        [calendarLines, "rid-calendar"],
      ] as const) {
        expect(lines[0]!.request_id).toBe(rid);
        assertContentFree(lines[0]!, forbidden);
      }
    });

    it("the cached skill catalog equals a fresh read, is read once, and changes only after invalidation", async () => {
      const { fetchSkillCatalog, invalidateSkillCatalogCache } =
        await import("../../apps/api/src/services/skill-catalog-read");
      invalidateSkillCatalogCache();
      const fresh = (
        await harness.setup!.query(
          `SELECT section, domain, skill FROM public.canonical_skill_catalog`,
        )
      ).rows as Array<{ section: string; domain: string; skill: string }>;
      const sortedFresh = [...fresh].sort(
        (a, b) =>
          a.section.localeCompare(b.section, "en") ||
          a.domain.localeCompare(b.domain, "en") ||
          a.skill.localeCompare(b.skill, "en"),
      );
      expect(sortedFresh.length).toBeGreaterThan(0);

      const before = harness.roundTrips;
      const first = await fetchSkillCatalog();
      const second = await fetchSkillCatalog();
      expect(harness.roundTrips - before).toBe(1);
      expect(first).toEqual(sortedFresh);
      expect(second).toEqual(first);
      // A copy per caller: mutating one result cannot change the next.
      first[0]!.skill = "MUTATED";
      expect((await fetchSkillCatalog())[0]!.skill).not.toBe("MUTATED");

      // A triple published behind the cache: invisible until invalidation, then present.
      await harness.setup!.query(
        `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ('SATM1NEWSK0', 'M', 1, 'Algebra', ARRAY['ALG.NEW'], 1, 'Stem new',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'C', 'Expl new',
         '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
         'published', 'mcq', now())`,
      );
      expect(
        (await fetchSkillCatalog()).some((e) => e.skill === "ALG.NEW"),
      ).toBe(false);
      invalidateSkillCatalogCache();
      expect(
        (await fetchSkillCatalog()).some((e) => e.skill === "ALG.NEW"),
      ).toBe(true);
      await harness.setup!.query(
        `DELETE FROM public.questions WHERE id = 'SATM1NEWSK0'`,
      );
      invalidateSkillCatalogCache();
    });

    it("the cached timezone answer equals the database's, and each zone is asked once", async () => {
      const { resolveStoredTimezone, invalidateKnownTimezoneCache } =
        await import("../../server/services/calendar/profile-service");
      invalidateKnownTimezoneCache();
      const zones = [
        "America/New_York",
        "Asia/Tokyo",
        "Mars/Olympus",
        "Not/AZone",
      ];
      const truth = new Map<string, boolean>();
      for (const z of zones) {
        const r = await harness.setup!.query(
          `SELECT public.calendar_is_known_timezone($1) AS known`,
          [z],
        );
        truth.set(z, (r.rows[0] as { known: boolean }).known);
      }
      expect([...truth.values()]).toEqual([true, true, false, false]);

      const before = harness.roundTrips;
      for (let pass = 0; pass < 3; pass += 1) {
        for (const z of zones) {
          const resolved = await resolveStoredTimezone(z, "rid-tz");
          expect(resolved).toEqual(
            truth.get(z)
              ? { timezone: z, fellBack: false }
              : { timezone: "America/Chicago", fellBack: true },
          );
        }
      }
      expect(harness.roundTrips - before).toBe(zones.length);
      invalidateKnownTimezoneCache();
    });
  },
);
