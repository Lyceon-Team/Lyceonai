/**
 * Brief 14 Step 5 — the exam notification job: the outcomes it records, its isolation, and the
 * fact that a rerun sends nothing.
 *
 * @spec [Doc-05F_V1.0 §8.1, §12.5 (the daily-job pattern), §7.8 `calendar_job_runs`, §18;
 *        contracts/notifications.contract.md §2.2, §5.1, §5.2, §6.1;
 *        owner ruling 2026-09-26] | @implemented [2026-09-27]
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. The DATE rules ("the local Monday", "the day before") and
 * the completeness rule live in SQL, and they are proved against a real Postgres by gates
 * Z-60..Z-67 in `scripts/ci/calendar-writer-gates.sql` — including the plant where the event id
 * is derived without the kind and the second notice is swallowed. This file is the loop above
 * them: that every considered row gets a `calendar_job_runs` row, that one bad row does not stop
 * the others, that the email is dispatched for a write and NOT for a replay, and that the
 * writer's three return values map to the three outcomes rather than all reading as success.
 *
 * The four that matter:
 *   - a rerun sends nothing. The SQL returns `duplicate`, the job records `skipped_duplicate`,
 *     and the dispatcher is NOT called — "none on a rerun" is Step 5's own validation.
 *   - a completed exam is `skipped_complete`, recorded, and un-dispatched.
 *   - an unentitled student is a recorded skip rather than a filtered one, so all five of this
 *     job's outcome values are reachable.
 *   - one row's failure is caught and the loop continues. The mutation this catches is a `throw`
 *     where the `catch` is, which would leave every later row un-notified.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  errReply,
  makeFakeClient,
  okReply,
  type FakeClient,
} from "./calendar.service-harness";

const S_A = "11111111-1111-1111-1111-111111111111";
const S_B = "22222222-2222-2222-2222-222222222222";
const S_C = "33333333-3333-3333-3333-333333333333";
const BLOCK_A = "aaaaaaaa-0000-4000-8000-000000000001";
const BLOCK_B = "bbbbbbbb-0000-4000-8000-000000000002";
const EXAM_DATE = "2026-10-17";
const TZ = "America/Chicago";

let client: FakeClient;
const jobRuns: Record<string, unknown>[] = [];
const dispatchMock = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return client;
  },
}));

// The dispatcher has its own contract tests; here it only has to be observable, so the
// assertion "dispatched for a write, not for a replay" is about the JOB and not about Resend.
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: (...args: unknown[]) => dispatchMock(...args),
}));

const { runExamNotifications, EXAM_NOTIFY_JOB, EXAM_NOTIFY_OUTCOMES } =
  await import("../../server/services/calendar/exam-notify-job");
const { notificationEventId } =
  await import("../../server/lib/notifications/event-id");

type Candidate = {
  student_id: string;
  block_id: string;
  local_date: string;
  timezone: string;
  kind: string;
  period_key: string;
  outcome: string | null;
};

function row(over: Partial<Candidate> = {}): Candidate {
  return {
    student_id: S_A,
    block_id: BLOCK_A,
    local_date: EXAM_DATE,
    timezone: TZ,
    kind: "full_length_tomorrow",
    period_key: EXAM_DATE,
    outcome: null,
    ...over,
  };
}

/**
 * `emits` is consumed in order, one per `calendar_emit_exam_notification` call, so a test can
 * say "the first row was written and the second was a replay" — which is the shape of a rerun
 * landing on a population where somebody new has appeared.
 */
function scenario(
  candidates: Candidate[],
  options?: { emits?: (string | "throw")[]; candidatesFail?: boolean },
): void {
  jobRuns.length = 0;
  const emits = [...(options?.emits ?? [])];
  client = makeFakeClient({
    tables: {
      calendar_job_runs: (state) => {
        if (state.op === "insert") {
          jobRuns.push(state.payload as Record<string, unknown>);
        }
        return okReply(null);
      },
    },
    rpcs: {
      calendar_exam_notification_candidates: () =>
        options?.candidatesFail === true
          ? errReply("connection reset")
          : okReply(candidates),
      calendar_emit_exam_notification: () => {
        const next = emits.shift() ?? "emitted";
        return next === "throw" ? errReply("deadlock detected") : okReply(next);
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("every row considered is recorded, skips included (§18)", () => {
  it("maps the writer's three return values to three different outcomes", async () => {
    scenario(
      [
        row({ block_id: BLOCK_A }),
        row({ student_id: S_B, block_id: BLOCK_B }),
        row({ student_id: S_C, block_id: BLOCK_B, kind: "full_length_week" }),
      ],
      { emits: ["emitted", "duplicate", "skipped_complete"] },
    );

    const summary = await runExamNotifications();

    expect(summary).toEqual({
      considered: 3,
      ok: 1,
      skipped_no_entitlement: 0,
      skipped_complete: 1,
      skipped_duplicate: 1,
      failed: 0,
    });
    expect(jobRuns.map((r) => r.outcome)).toEqual([
      "ok",
      "skipped_duplicate",
      "skipped_complete",
    ]);
    expect(new Set(jobRuns.map((r) => r.job))).toEqual(
      new Set([EXAM_NOTIFY_JOB]),
    );
  });

  it("records the unentitled skip the SQL decided, rather than filtering it away", async () => {
    scenario([row({ outcome: "skipped_no_entitlement" })]);

    const summary = await runExamNotifications();

    expect(summary.skipped_no_entitlement).toBe(1);
    expect(summary.ok).toBe(0);
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0]?.outcome).toBe("skipped_no_entitlement");
    // And the writer was never asked: a skip the predicate decided is not a write to attempt.
    expect(
      client.rpcs.filter((r) => r.fn === "calendar_emit_exam_notification"),
    ).toHaveLength(0);
  });

  it("every outcome this job can record is one the CHECK admits", () => {
    // The list in the module and the CHECK in 20261012000000 are two statements of one fact.
    // A value here that the column refuses would make the job's own bookkeeping the thing that
    // fails, at 2am, for the student it was recording.
    expect([...EXAM_NOTIFY_OUTCOMES]).toEqual([
      "ok",
      "skipped_no_entitlement",
      "skipped_complete",
      "skipped_duplicate",
      "failed",
    ]);
  });
});

describe("a rerun sends nothing (Step 5's own validation)", () => {
  it("dispatches for a write and NOT for a replay", async () => {
    scenario([row({ block_id: BLOCK_A }), row({ block_id: BLOCK_B })], {
      emits: ["emitted", "duplicate"],
    });

    await runExamNotifications();

    // PRESENCE FIRST: one dispatch, so the absence below is not passing on an empty set.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0]?.[0]).toEqual({
      // The id the SQL derived for the SAME (kind, block) — the TypeScript and SQL derivations
      // are pinned to each other by contract C5.1.
      eventId: notificationEventId("full_length_tomorrow", BLOCK_A),
    });
  });

  it("dispatches nothing at all when every row is a replay", async () => {
    scenario([row({ block_id: BLOCK_A }), row({ block_id: BLOCK_B })], {
      emits: ["duplicate", "duplicate"],
    });

    const summary = await runExamNotifications();

    expect(summary.skipped_duplicate).toBe(2);
    expect(summary.ok).toBe(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("passes the two kinds' own event ids, so one block can notify twice", async () => {
    // The owner's ruling, at the job layer: the same block with two kinds produces two
    // DIFFERENT dispatch ids. Derive the id from the block alone and these collapse to one.
    scenario(
      [
        row({ block_id: BLOCK_A, kind: "full_length_week" }),
        row({ block_id: BLOCK_A, kind: "full_length_tomorrow" }),
      ],
      { emits: ["emitted", "emitted"] },
    );

    await runExamNotifications();

    const ids = dispatchMock.mock.calls.map(
      (call) => (call[0] as { eventId: string }).eventId,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("isolation and failure", () => {
  it("one row's failure is recorded and the loop continues", async () => {
    scenario(
      [
        row({ block_id: BLOCK_A }),
        row({ student_id: S_B, block_id: BLOCK_B }),
        row({ student_id: S_C, block_id: BLOCK_B, kind: "full_length_week" }),
      ],
      { emits: ["emitted", "throw", "emitted"] },
    );

    const summary = await runExamNotifications();

    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(2);
    expect(summary.considered).toBe(3);
    expect(jobRuns.map((r) => r.outcome)).toEqual(["ok", "failed", "ok"]);
    // The failing row's detail says WHAT went wrong in one word and nothing about the student,
    // the block or the date (§18: those are never logged).
    expect(jobRuns[1]?.detail).toEqual({ reason: "threw" });
  });

  it("an unrecognised writer result is a failure, never a silent success", async () => {
    // A return value this job does not know means the SQL contract moved. Reading it as "ok"
    // would record a notification that may never have been written.
    scenario([row()], { emits: ["something_new"] });

    const summary = await runExamNotifications();

    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(0);
    expect(jobRuns[0]?.detail).toEqual({ reason: "unknown_emit_result" });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("an unrecognised candidate outcome is a failure too", async () => {
    scenario([row({ outcome: "skipped_something" })]);

    const summary = await runExamNotifications();

    expect(summary.failed).toBe(1);
    expect(jobRuns[0]?.detail).toEqual({ reason: "unknown_candidate_outcome" });
  });

  it("a population read failure throws, so the cron reports 500 rather than a quiet pass", async () => {
    scenario([], { candidatesFail: true });

    await expect(runExamNotifications()).rejects.toThrow(
      /calendar_exam_notification_candidates_failed/,
    );
    expect(jobRuns).toHaveLength(0);
  });

  it("a malformed candidate row is skipped without being counted", async () => {
    // PostgREST hands back whatever the function returned; a row missing a field is not a row
    // this job can act on, and counting it would make `considered` a lie.
    jobRuns.length = 0;
    client = makeFakeClient({
      tables: { calendar_job_runs: () => okReply(null) },
      rpcs: {
        calendar_exam_notification_candidates: () =>
          okReply([{ student_id: S_A }, row()]),
        calendar_emit_exam_notification: () => okReply("emitted"),
      },
    });

    const summary = await runExamNotifications();

    expect(summary.considered).toBe(1);
    expect(summary.ok).toBe(1);
  });
});
